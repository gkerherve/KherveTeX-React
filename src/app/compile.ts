// The live preview's compile loop: MainWindow._kick_compile,
// _on_compile_done and _update_console, plus the Compiler menu's state
// (engine, skip images, compile range) and Compiler ▸ Compiler status.
//
// Compiles run one at a time; an edit during a compile queues exactly one
// more (_pending_recompile). The PDF lands in the store (compile.pdf) for
// the preview, the log in compile.log for the Console tab.
import { useSyncExternalStore } from 'react'
import {
  cancelRunning, compileTex, compileTypst, downloadTectonicBundle,
  type CompileResult, type CompilerHost,
} from '../core/compiler'
import type { Document as KDocument } from '../core/model'
import { basename, dirname, join } from '../core/paths'
import { serializeDocument } from '../core/serializer'
import { serializeDocument as serializeTypst } from '../core/typstSerializer'
import { platform } from '../platform'
import { COMPILE_UNAVAILABLE } from '../platform/browser'
import {
  escapeHtml, information, messageBox, progressBox, question, warning,
} from '../platform/MessageBox'
import { setSetting, setting } from '../platform/settings'
import { setCommandChecked } from '../ui/commands'
import { TEMPLATE_CHOICES } from '../ui/ribbonModel'
import { editorApi, type EditorApi } from './editorApi'
import type { PageEditing } from './actions/page'
import { pageAnchors } from './pageAnchors'
import { appStore, type AppState } from './store'

export type Engine = 'latex' | 'typst'

// What the preview, the Code tab and the status bar show beside the store.
export interface CompileUi {
  engine: Engine
  skipImages: boolean
  useCompileRange: boolean
  // PdfPreview.show_message: shown instead of the PDF (an error, or no engine).
  message: string | null
  // The last good PDF on disk (the detached window reads it from there).
  pdfPath: string | null
  // _compiler_status_text, e.g. "LaTeX (tectonic): OK".
  statusText: string
  // The Console tab's text turns red after a failed compile.
  consoleError: boolean
}

let ui: CompileUi = {
  engine: 'latex', skipImages: false, useCompileRange: true, message: null,
  pdfPath: null, statusText: '', consoleError: false,
}
const listeners = new Set<() => void>()

export function compileUi(): CompileUi {
  return ui
}

function setUi(patch: Partial<CompileUi>): void {
  ui = { ...ui, ...patch }
  for (const l of listeners) l()
}

export function subscribeCompileUi(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useCompileUi<T>(select: (u: CompileUi) => T): T {
  return useSyncExternalStore(subscribeCompileUi, () => select(ui))
}

// ---- where the document lives (MainWindow._current_path and friends) ----

// The folder an imported .tex/.md came from: imported files have no path
// until Save As, but relative \includegraphics paths (Images/foo.png next
// to the .tex) must still resolve in the preview.
let importSourceDir: string | null = null

export function setImportSourceDir(dir: string | null): void {
  importSourceDir = dir
}

// Where to look for relative asset paths: the saved document's folder,
// else an imported .tex's original folder.
export function resolvedSourceDir(): string | null {
  const path = appStore().get().path
  return path !== null ? dirname(path) : importSourceDir
}

// The document's base name, stripping compound extensions.
export function docStem(path: string): string {
  const name = basename(path)
  for (const ext of ['.ktex.json', '.kdoc.json']) if (name.endsWith(ext)) return name.slice(0, -ext.length)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

// ---- the machine, as compiler.ts sees it ----

export function compilerHost(): CompilerHost {
  const p = platform()
  return {
    exists: p.exists,
    stat: p.stat,
    listDir: p.listDir,
    mkdir: p.mkdir,
    copy: p.copy,
    readText: p.readText,
    writeText: p.writeText,
    remove: p.remove,
    findTectonic: async () => (await p.findTectonic())?.path ?? null,
    findTypst: p.findTypst,
    run: p.run,
    cancelRunning: p.cancelRunning,
    styleDirs: p.styleDirs,
    pathListSep: p.pathListSep,
  }
}

let buildDirPromise: Promise<string> | null = null

// One temp build dir per window (tempfile.mkdtemp(prefix="khervedoc-")).
export function buildDir(): Promise<string> {
  if (!buildDirPromise) buildDirPromise = platform().makeTempDir('khervedoc-')
  return buildDirPromise
}

// ---- KherveRef ----

// MainWindow._stage_kherveref_bib: write the cited entries to
// kherveref.bib in each build dir before a compile. Installed by the
// KherveRef area (core/kherveref.ts); until then nothing is staged.
type BibStager = (doc: KDocument, workdirs: string[]) => Promise<void>
let stageBib: BibStager = async () => {}

export function setBibStager(fn: BibStager): void {
  stageBib = fn
}

// ---- engines ----

export async function engineAvailable(engine: Engine): Promise<boolean> {
  const p = platform()
  return engine === 'typst' ? (await p.findTypst()) !== null : (await p.findTectonic()) !== null
}

async function refreshStatusText(): Promise<void> {
  const ok = await engineAvailable(ui.engine)
  setUi({
    statusText: ui.engine === 'typst'
      ? (ok ? 'Typst: OK' : 'Typst: NOT FOUND')
      : (ok ? 'LaTeX (tectonic): OK' : 'tectonic: NOT FOUND'),
  })
}

export function serializeFor(doc: KDocument, engine: Engine = ui.engine): string {
  return engine === 'typst' ? serializeTypst(doc) : serializeDocument(doc)
}

// ---- the compile loop ----

let running = false
let pendingRecompile = false
// Skip recompiling when the source hasn't changed since the last failed
// compile — avoids hammering tectonic with the same broken input on every
// keystroke.
let lastFailedSource: string | null = null
let lastSource: string | null = null
let closed = false

function showMessage(msg: string): void {
  setUi({ message: msg })
  appStore().set(s => ({ compile: { ...s.compile, pdf: null, serial: s.compile.serial + 1 } }))
}

export async function kickCompile(): Promise<void> {
  if (closed) return
  // When a project is open, always compile the full project
  if (projectCompiler !== null && appStore().get().project !== null) {
    await projectCompiler()
    return
  }
  if (!(await engineAvailable(ui.engine))) {
    if (platform().kind === 'browser') showMessage(COMPILE_UNAVAILABLE)
    else if (ui.engine === 'typst') showMessage('typst not installed — install it from https://typst.app/')
    else showMessage('tectonic not installed — install it to see a live preview.')
    return
  }
  if (running) {
    pendingRecompile = true
    return
  }
  const doc = appStore().get().doc
  const engine = ui.engine
  const source = serializeFor(doc, engine)
  if (source === lastFailedSource) return
  lastSource = source
  running = true
  appStore().set(s => ({ compile: { ...s.compile, running: true } }))
  let result: CompileResult
  try {
    const dir = await buildDir()
    if (engine !== 'typst') await stageBib(doc, [dir])
    const opts = {
      sourceDir: resolvedSourceDir(), skipImages: ui.skipImages, useCompileRange: ui.useCompileRange,
    }
    result = engine === 'typst'
      ? await compileTypst(source, dir, opts, compilerHost())
      : await compileTex(source, dir, opts, compilerHost())
  } catch (e) {
    result = { ok: false, pdfPath: null, log: '', error: e instanceof Error ? e.message : String(e) }
  }
  await onCompileDone(result, engine)
}

async function onCompileDone(result: CompileResult, engine: Engine): Promise<void> {
  running = false
  lastFailedSource = result.ok ? null : lastSource
  let pdf: Uint8Array | null = null
  if (result.ok && result.pdfPath !== null) {
    try {
      pdf = await platform().readFile(result.pdfPath)
    } catch (e) {
      result = { ...result, ok: false, error: `could not read the PDF: ${e instanceof Error ? e.message : e}` }
    }
  }
  const log = consoleText(result, engine)
  if (pdf !== null) {
    setUi({ message: null, pdfPath: result.pdfPath, consoleError: false })
    // Cache the PDF next to the document for instant loading.
    const path = appStore().get().path
    if (path !== null) {
      void platform().writeFile(join(dirname(path), `${docStem(path)}.pdf`), pdf).catch(() => {})
    }
    // Tell the editor how many pages the PDF has and the first text of
    // each later page, so its page breaks sit where the PDF's pages start
    // rather than at a uniform spacing (which falls apart when page 1 has
    // a title block).
    const bytes = pdf
    void pageAnchors(bytes).then(([count, anchors, furniture, typography]) => {
      const ed = editorApi() as (EditorApi & Partial<PageEditing>) | null
      ed?.setPageAnchors?.(count, anchors, furniture, typography)
    }).catch(() => {})
  } else {
    const tail = result.log ? result.log.split(/\r?\n/).filter((_, i, a) => i >= a.length - 10).join('\n') : ''
    setUi({ message: `${result.error}\n\n${tail}`, consoleError: true })
  }
  if (result.ok) setUi({ consoleError: false })
  appStore().set(s => ({
    compile: {
      running: false, ok: result.ok, log,
      // A failed compile shows its message, not the stale PDF.
      pdf: pdf ?? (result.ok ? s.compile.pdf : null),
      serial: s.compile.serial + 1,
    },
  }))
  if (pendingRecompile) {
    pendingRecompile = false
    void kickCompile()
  }
}

// ---- projects (MainWindow._compile_project / _on_project_compile_done) ----

// Installed by src/app/actions/project.ts: writes the chapters and the
// master, then calls compileProjectMaster.
let projectCompiler: (() => Promise<void>) | null = null

export function setProjectCompiler(fn: (() => Promise<void>) | null): void {
  projectCompiler = fn
}

// Run the project's master .tex in the build dir (the chapter files are
// already copied there) and show the result. null when tectonic is missing
// or a compile is running (that one queues a recompile, as the single
// document's does).
export async function compileProjectMaster(source: string, sourceDir: string): Promise<CompileResult | null> {
  if (!(await engineAvailable('latex'))) {
    showMessage(platform().kind === 'browser' ? COMPILE_UNAVAILABLE : 'tectonic not installed \u2014 install it to compile.')
    return null
  }
  if (running) {
    pendingRecompile = true
    return null
  }
  running = true
  appStore().set(s => ({ status: 'Compiling project\u2026', compile: { ...s.compile, running: true } }))
  let result: CompileResult
  try {
    const opts = { sourceDir, skipImages: ui.skipImages, useCompileRange: false }
    result = await compileTex(source, await buildDir(), opts, compilerHost())
  } catch (e) {
    result = { ok: false, pdfPath: null, log: '', error: e instanceof Error ? e.message : String(e) }
  }
  running = false
  let pdf: Uint8Array | null = null
  if (result.ok && result.pdfPath !== null) {
    try {
      pdf = await platform().readFile(result.pdfPath)
    } catch (e) {
      result = { ...result, ok: false, error: `could not read the PDF: ${e instanceof Error ? e.message : e}` }
    }
  }
  if (pdf !== null) {
    setUi({ message: null, pdfPath: result.pdfPath, consoleError: false })
  } else {
    const tail = result.log ? result.log.split(/\r?\n/).filter((_, i, a) => i >= a.length - 10).join('\n') : ''
    setUi({ message: `${result.error}\n\n${tail}`, consoleError: true })
  }
  const log = consoleText(result, 'latex')
  appStore().set(s => ({
    status: s.status === 'Compiling project\u2026' ? '' : s.status,
    compile: {
      running: false, ok: result.ok, log,
      pdf: pdf ?? (result.ok ? s.compile.pdf : null),
      serial: s.compile.serial + 1,
    },
  }))
  return result
}

function hhmmss(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// The Console tab, as MainWindow._update_console writes it.
export function consoleText(result: CompileResult, engine: Engine, now = new Date()): string {
  const compiler = engine.charAt(0).toUpperCase() + engine.slice(1)
  const header = result.ok
    ? `[${hhmmss(now)}] ${compiler} — compiled successfully`
    : `[${hhmmss(now)}] ${compiler} — ERROR: ${result.error}`
  return `${header}\n${'─'.repeat(60)}\n${result.log ?? ''}`
}

// A complete, unabridged compile for Export / Print (MainWindow.
// _full_compile_fn): no skipped images, no compile range. null after
// telling the user the engine is missing.
// `proceed` runs between the check and the compile (Export asks for the
// target file there); false stops.
export async function fullCompile(purpose: string, proceed?: () => Promise<boolean>): Promise<CompileResult | null> {
  const engine = ui.engine
  if (!(await engineAvailable(engine))) {
    if (engine === 'typst') await warning('typst missing', `Install typst to ${purpose}.`)
    else await warning('tectonic missing', platform().kind === 'browser'
      ? COMPILE_UNAVAILABLE : `Install tectonic to ${purpose}.`)
    return null
  }
  if (proceed && !(await proceed())) return null
  const doc = appStore().get().doc
  const dir = await buildDir()
  const opts = { sourceDir: resolvedSourceDir() }
  if (engine === 'typst') return compileTypst(serializeTypst(doc), dir, opts, compilerHost())
  await stageBib(doc, [dir, join(dir, 'print')])
  return compileTex(serializeDocument(doc), dir, opts, compilerHost())
}

// Opening a saved document shows the PDF cached beside it at once, before
// its first compile finishes.
export async function showCachedPdf(path: string): Promise<void> {
  try {
    const pdf = await platform().readFile(path)
    setUi({ message: null, pdfPath: path })
    appStore().set(s => ({ compile: { ...s.compile, pdf, serial: s.compile.serial + 1 } }))
  } catch { /* no cached PDF */ }
}

// ---- toggles ----

export function setAutoCompile(on: boolean): void {
  appStore().set({ autoCompile: on })
  if (on) void kickCompile()
}

export function setSkipImages(on: boolean): void {
  setUi({ skipImages: on })
  if (appStore().get().autoCompile) void kickCompile()
}

export function setCompileRange(on: boolean): void {
  setUi({ useCompileRange: on })
  if (appStore().get().autoCompile) void kickCompile()
}

export function setCompiler(engine: Engine): void {
  if (engine === ui.engine) return
  setUi({ engine })
  lastFailedSource = null
  void refreshStatusText()
  if (appStore().get().autoCompile) void kickCompile()
}

// ---- Compiler ▸ Compiler status ----

export interface CompilerStatus {
  path: string | null
  bundled: boolean
  version: string
  cache: string | null
  cacheMb: number
  offline: boolean
}

// What Compiler ▸ Compiler status shows: where tectonic is, its version,
// the package cache, and whether a document compiles from the cache alone
// (no network).
export async function compilerStatus(): Promise<CompilerStatus> {
  const p = platform()
  const eng = await p.findTectonic()
  const st: CompilerStatus = { path: eng?.path ?? null, bundled: false, version: '', cache: null, cacheMb: 0, offline: false }
  if (!eng) return st
  st.bundled = eng.bundled
  const v = await p.run(eng.path, ['--version'], { timeoutSecs: 120 })
  st.version = v.error ? '(did not run)' : v.stdout.trim()
  st.cache = await p.queryTectonicCacheDir(eng.path)
  const cacheDir = st.cache ?? await p.defaultTectonicCacheDir()
  st.cacheMb = (await p.treeSize(cacheDir)) / (1024 * 1024)
  const d = await p.makeTempDir('khervetex-probe-')
  await p.writeText(join(d, 'p.tex'),
    '\\documentclass[12pt]{article}\\usepackage{amsmath,amssymb,'
    + 'graphicx,xurl}\\begin{document}\\section{A}Hi \\textbf{b} '
    + '\\emph{i} \\texttt{t} $x^2$\\end{document}')
  const r = await p.run(eng.path, ['--only-cached', 'p.tex'], { cwd: d, timeoutSecs: 120 })
  st.offline = r.code === 0 && !!(await p.stat(join(d, 'p.pdf')))?.isFile
  void p.remove(d).catch(() => {})
  return st
}

export async function showCompilerStatus(): Promise<void> {
  appStore().set({ status: 'Checking the compiler…' })
  let st: CompilerStatus
  try {
    st = await compilerStatus()
  } finally {
    appStore().set({ status: '' })
  }
  let rows: [string, string][]
  if (st.path === null) {
    rows = [['Engine', "<b style='color:#b91c1c'>tectonic not found</b> — reinstall KherveTeX, or install "
      + 'tectonic and put it on the PATH.']]
  } else {
    const ok = st.offline
      ? "<b style='color:#15803d'>Yes</b> — documents compile without internet"
      : "<b style='color:#b45309'>Not yet</b> — click Download offline bundle (needs internet once)"
    rows = [
      ['Engine', escapeHtml(st.version || 'tectonic')],
      ['Location', st.bundled ? 'bundled with KherveTeX' : escapeHtml(st.path)],
      ['Package cache', escapeHtml(st.cache ?? '—')],
      ['Cache size', `${st.cacheMb.toFixed(0)} MB`],
      ['Offline ready', ok],
    ]
  }
  const html = '<table cellspacing=6>' + rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${v}</td></tr>`).join('')
    + '</table>'
  const clicked = await messageBox({
    title: 'Compiler status', html,
    buttons: [{ label: 'Download offline bundle…', disabled: st.path === null }, { label: 'Close', default: true }],
  })
  if (clicked === 'Download offline bundle…') await downloadBundle()
}

export async function openCache(): Promise<void> {
  const p = platform()
  const eng = await p.findTectonic()
  const d = (eng ? await p.queryTectonicCacheDir(eng.path) : null) ?? await p.defaultTectonicCacheDir()
  if (!d) throw new Error('No package cache here: the browser version has no compiler')
  await p.mkdir(d)
  await p.openPath(d)
}

// Download the TeX packages for offline compilation.
export async function downloadBundle(): Promise<void> {
  if (!(await engineAvailable('latex'))) {
    await warning('tectonic not found', 'tectonic is not installed. Install it first from\n'
      + 'https://tectonic-typesetting.github.io/')
    return
  }
  const yes = await question('Download offline bundle',
    'This will pre-download the TeX packages commonly used by kherveDOC so that compilation works '
    + 'without an internet connection.\n\nProceed?')
  if (!yes) return
  const head = 'Downloading TeX Live bundle…\n'
  const dlg = progressBox('Download offline bundle', head + 'This may take several minutes.')
  const host = compilerHost()
  void dlg.cancelled.then(() => cancelRunning(host))
  const workdir = await platform().makeTempDir('khervedoc-bundle-')
  const [ok, log] = await downloadTectonicBundle(host, workdir, TEMPLATE_CHOICES, line => dlg.setLabel(head + line))
  dlg.close()
  if (ok) {
    await information('Bundle downloaded', 'The full TeX Live bundle has been downloaded.\n'
      + 'Compilation will now work fully offline.')
  } else {
    await warning('Download failed', `The bundle download failed.\n\n${log.slice(-500)}`)
  }
}

// ---- start-up and the store subscription ----

let started = false

// MainWindow wires documentChanged → _on_doc_changed → _kick_compile, the
// layout mode to the PDF panel, and compiles once the window is up.
export function startCompileService(): void {
  if (started) return
  started = true
  void refreshStatusText()
  const store = appStore()
  let prev: AppState = store.get()
  let timer: ReturnType<typeof setTimeout> | null = null
  const showsPdf = (s: AppState) => s.layout === 'side' || s.layout === 'window'

  store.subscribe(() => {
    const s = store.get()
    const was = prev
    prev = s
    // Insert > Date shows the open document's setting.
    if (s.doc.meta.show_date !== was.doc.meta.show_date) setCommandChecked('show_date', s.doc.meta.show_date !== false)
    if (s.layout !== was.layout) {
      // apply_layout_mode: "visual"/"page" switch auto-compile off.
      setCommandChecked('auto_compile', s.autoCompile)
      setSetting('layout_mode', s.layout)
      // _sync_pdf_actions
      setCommandChecked('pdf_panel', showsPdf(s))
      setCommandChecked('pdf_detach', s.layout === 'window')
      if (showsPdf(s) && !showsPdf(was)) void kickCompile()
    }
    if (s.doc !== was.doc && s.autoCompile && showsPdf(s)) {
      if (timer) clearTimeout(timer)
      // A replaced document compiles at once (set_document emits
      // documentChanged directly); typing waits for the editor's 450 ms
      // debounce.
      timer = setTimeout(() => { timer = null; void kickCompile() }, s.docSerial !== was.docSerial ? 0 : 450)
    }
  })

  // Default layout: the PDF in a small panel at the right of the editor.
  const mode = setting<AppState['layout']>('layout_mode', 'side')
  const visual = mode === 'visual' || mode === 'page'
  store.set({ layout: mode, autoCompile: !visual })
  setCommandChecked(visual ? 'visual_only' : mode === 'window' ? 'pdf_window' : 'side_by_side', true)
  setCommandChecked('auto_compile', !visual)
  setCommandChecked('pdf_panel', !visual)
  setCommandChecked('pdf_detach', mode === 'window')
  if (!visual) void kickCompile()
}

// The window is closing: never start another compile, kill the running one.
export async function shutdownCompiles(): Promise<void> {
  closed = true
  await cancelRunning(compilerHost())
}
