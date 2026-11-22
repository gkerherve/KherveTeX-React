// The File menu: New, Open, Save, Save As, Close, Import, Export, Show in
// file explorer and Open Recent — MainWindow's file actions in
// khervedoc/mainwindow.py (_new, _open_path, _save, _save_as, _write_to,
// _import_tex, _import_md, _export_tex, _export_latex_zip, _export_pdf,
// _show_in_explorer, _remember_recent, _update_title, offer_save_before).
import { isImageName } from '../../core/pictures'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { importMd, importTex, type ImportFs } from '../../core/importers'
import { findMainTex, isArchiveName, readArchive } from '../../core/archive'
import {
  exportLatexZip, isKdoczPath, isLegacyBundle, loadKdocz, NATIVE_SUFFIX, readBundledBib,
  readProjectJson, saveKdocz, type FileAccess,
} from '../../core/kdocz'
import { document as newDocument, fromJson, paragraph, toJson, type DocMeta, type Document as KDocument } from '../../core/model'
import { basename, dirname, join, normalize, suffix, withSuffix } from '../../core/paths'
import { serializeDocument } from '../../core/serializer'
import { serializeDocument as serializeTypst } from '../../core/typstSerializer'
import { isTauri, platform, type FileFilter } from '../../platform'
import { critical, information, messageBox, warning } from '../../platform/MessageBox'
import { chapterPlan, estimatePages, projectFolder, shouldOffer, writeChapterProject, type SplitBy } from '../../core/chapterSplit'
import { loadSettings, setSetting, setting } from '../../platform/settings'
import { hasAction, registerActions, runAction } from '../actions'
import {
  compileUi, docStem, fullCompile, resolvedSourceDir, setImportSourceDir, showCachedPdf, shutdownCompiles,
} from '../compile'
import { appStore, replaceDoc, type LayoutMode } from '../store'
import { setCommandChecked } from '../../ui/commands'
import { GALLERY } from '../../ui/ribbonModel'
import { showWelcomeDialog } from '../../ui/WelcomeDialog'
import { SHORT_NAME, VERSION } from '../../version'
import { getBundledBib, refreshKherverefBib, setBundledBib } from './refs'

const RECENT_FILES_MAX = 8
// project_store.WORK_DIR: working files live in .kherve/ so the folder
// shows only the .ktex.
const WORK_DIR = '.kherve'
const BIB_FILE = 'kherveref.bib'

const OPENABLE_SUFFIXES = new Set(['.ktex', '.ktexz', '.kdocz', '.tex', '.md', '.markdown', '.docx', '.pdf', '.json',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.tbz', '.tbz2'])
const IMAGE_SUFFIXES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp', '.svg'])

// Cited KherveRef entries carried by the open document (from its .ktex),
// used when its library is not on this machine.
let bundledBib = ''
// Set when the document came in through an importer: the title shows
// "<stem> (imported)" until it is saved.
let importedStem: string | null = null
let recent: string[] = []

export function fileAccess(): FileAccess {
  const p = platform()
  return { exists: p.exists, read: p.readFile, write: p.writeFile }
}

// ---- title ----

// MainWindow._update_title: "kTeX vN — <name> [branch]".
// The branch suffix is kept by actions/git.ts for the open document's folder.
let branchSuffix = { path: '', suffix: '' }
export function windowTitle(): string {
  const projectTitle = projectHooks?.title() ?? null
  if (projectTitle !== null) return `${SHORT_NAME} ${VERSION} — ${projectTitle}`
  const path = appStore().get().path
  if (path === null && importedStem !== null) return `${SHORT_NAME} ${VERSION} — ${importedStem} (imported)`
  const branch = path !== null && branchSuffix.path === path ? branchSuffix.suffix : ''
  return `${SHORT_NAME} ${VERSION} — ${path ? basename(path) + branch : 'Untitled'}`
}

export function updateTitle(): void {
  if (!projectHooks?.isOpen()) projectHooks?.onSingleTitle()
  void platform().setTitle(windowTitle()).catch(() => {})
}

// ---- projects (src/app/actions/project.ts) ----

// The project code hooks into the file actions where MainWindow's do:
// _open_path opens a project file as a project, _new and _open_path leave
// the project first, _save saves the project, _update_title names it.
export interface ProjectHooks {
  isOpen(): boolean
  openFromPath(path: string): Promise<void>
  leave(): Promise<void>
  save(): Promise<void>
  // "<project> — <document>" while a project is open, else null.
  title(): string | null
  // _update_title's single-document branch (the Documents list shows it).
  onSingleTitle(): void
  // apply_layout_mode: "page" hides the Documents list.
  onLayoutMode(mode: LayoutMode): void
  // A file drop at a window position: true when the Documents list took it.
  dropAt(x: number, y: number, paths: string[]): boolean
}
let projectHooks: ProjectHooks | null = null
export function setProjectHooks(h: ProjectHooks | null): void {
  projectHooks = h
}

// " [dev]" for the document at `path`.
export function setBranchSuffix(path: string, suffix: string): void {
  if (path === branchSuffix.path && suffix === branchSuffix.suffix) return
  branchSuffix = { path, suffix }
  updateTitle()
  for (const l of branchListeners) l()
}

// The branch of the open document ("" when none): the status bar's path
// label shows it as a tag.
export function currentBranch(): string {
  const path = appStore().get().path
  return path !== null && branchSuffix.path === path ? branchSuffix.suffix.trim().replace(/^\[|\]$/g, '') : ''
}
const branchListeners = new Set<() => void>()
export function subscribeBranch(l: () => void): () => void {
  branchListeners.add(l)
  return () => { branchListeners.delete(l) }
}

// Run after every successful save with (folder, file name, document stem):
// MainWindow._write_to ends with _git_snapshot(path.parent, path.name, stem).
type SaveListener = (folder: string, name: string, stem: string | null) => void | Promise<void>
const saveListeners = new Set<SaveListener>()
export function onAfterSave(l: SaveListener): () => void {
  saveListeners.add(l)
  return () => { saveListeners.delete(l) }
}

let statusTimer: ReturnType<typeof setTimeout> | null = null
// statusBar().showMessage(msg, ms)
function showMessage(msg: string, ms: number): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, ms)
}

// ---- new documents ----

// _apply_user_defaults: the user's Document-defaults preferences over a
// new document's meta.
export function applyUserDefaults(meta: DocMeta): DocMeta {
  return {
    ...meta,
    body_font_pt: Number(setting('default/body_font_pt', meta.body_font_pt)),
    body_font_family: String(setting('default/body_font_family', meta.body_font_family)),
    visual_font_family: String(setting('default/visual_font_family', meta.visual_font_family)),
    line_spacing: Number(setting('default/line_spacing', meta.line_spacing)),
    paragraph_indent: Boolean(setting('default/paragraph_indent', meta.paragraph_indent)),
    margin_top_cm: Number(setting('default/margin_top_cm', meta.margin_top_cm)),
    margin_bottom_cm: Number(setting('default/margin_bottom_cm', meta.margin_bottom_cm)),
    margin_left_cm: Number(setting('default/margin_left_cm', meta.margin_left_cm)),
    margin_right_cm: Number(setting('default/margin_right_cm', meta.margin_right_cm)),
    page_size: String(setting('default/page_size', meta.page_size)),
  }
}

// _blank_document: an empty page, what the app opens on and New gives.
export function blankDocument(): KDocument {
  const doc = newDocument([paragraph([])])
  return { ...doc, meta: applyUserDefaults(doc.meta) }
}

// closeEvent: persist the document defaults so new documents start with
// the user's preferred font size, family, margins etc.
function saveUserDefaults(): void {
  const m = appStore().get().doc.meta
  setSetting('default/body_font_pt', m.body_font_pt)
  setSetting('default/body_font_family', m.body_font_family)
  setSetting('default/visual_font_family', m.visual_font_family)
  setSetting('default/line_spacing', m.line_spacing)
  setSetting('default/paragraph_indent', m.paragraph_indent)
  setSetting('default/margin_top_cm', m.margin_top_cm)
  setSetting('default/margin_bottom_cm', m.margin_bottom_cm)
  setSetting('default/margin_left_cm', m.margin_left_cm)
  setSetting('default/margin_right_cm', m.margin_right_cm)
  setSetting('default/page_size', m.page_size)
}

// A document that came from an example or template, not a file.
export function openUnsaved(doc: KDocument): void {
  bundledBib = ''
  setBundledBib('')
  importedStem = null
  setImportSourceDir(null)
  replaceDoc({ ...doc, meta: applyUserDefaults(doc.meta) }, { path: null, dirty: false })
  updateTitle()
}

export async function newDocumentAction(reason = 'starting a new document'): Promise<void> {
  if (!(await offerSaveBefore(reason))) return
  await newBlank()
}

// MainWindow._new, without asking to save (Close project calls it so).
export async function newBlank(): Promise<void> {
  await projectHooks?.leave()
  bundledBib = ''
  setBundledBib('')
  importedStem = null
  setImportSourceDir(null)
  replaceDoc(blankDocument(), { path: null, dirty: false })
  updateTitle()
}

// ---- unsaved changes ----

// Ask to save unsaved edits before e.g. opening another document. False
// means the user cancelled.
export async function offerSaveBefore(reason: string): Promise<boolean> {
  const s = appStore().get()
  if (!s.dirty) return true
  const name = s.path ? basename(s.path) : 'Untitled'
  const answer = await messageBox({
    title: 'Unsaved changes', icon: 'question',
    text: `Save the changes to ${name} before ${reason}?`,
    buttons: [{ label: 'Save', default: true }, { label: 'Discard' }, { label: 'Cancel' }],
  })
  if (answer === 'Cancel' || answer === null) return false
  if (answer === 'Save') {
    await save()
    // Save As can be cancelled; going on would lose the edits.
    return !appStore().get().dirty
  }
  return true
}

// ---- opening ----

const ARCHIVE_EXTENSIONS = ['zip', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2']

const OPEN_FILTERS: FileFilter[] = [
  { name: 'All supported', extensions: ['ktex', 'ktexz', 'kdocz', 'json', 'tex', 'md', 'markdown', 'docx', 'pdf',
    ...ARCHIVE_EXTENSIONS] },
  { name: 'KherveTeX', extensions: ['ktex', 'ktexz', 'kdocz'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'LaTeX', extensions: ['tex'] },
  { name: 'LaTeX package (.zip, .tar.gz, .tar.bz2)', extensions: ARCHIVE_EXTENSIONS },
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'Word', extensions: ['docx'] },
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'All files', extensions: [] },
]

export async function openAction(): Promise<void> {
  const picked = await platform().openFileDialog({ title: 'Open document', filters: OPEN_FILTERS })
  if (!picked?.length) return
  if (!(await offerSaveBefore(`opening ${basename(picked[0])}`))) return
  await openPath(picked[0])
}

// import_tex with base_dir: \input / \include targets are inlined. The
// importer reads files synchronously, so the files it asks for are fetched
// and the import re-run until it asks for nothing new.
export async function importTexFile(path: string): Promise<KDocument> {
  const p = platform()
  const text = (await p.readText(path)).replace(/\r\n?/g, '\n')
  const known = new Map<string, string | null>()
  for (let round = 0; round < 30; round++) {
    const asked = new Set<string>()
    const fs: ImportFs = {
      isFile: (f) => {
        const k = normalize(f)
        if (!known.has(k)) { asked.add(k); return false }
        return known.get(k) !== null
      },
      readText: (f) => known.get(normalize(f)) ?? null,
      resolve: normalize,
    }
    const doc = importTex(text, dirname(path), fs)
    if (!asked.size) return doc
    for (const f of asked) {
      const st = await p.stat(f)
      known.set(f, st?.isFile ? await p.readText(f).catch(() => null) : null)
    }
  }
  return importTex(text, dirname(path), { isFile: (f) => known.get(normalize(f)) != null,
    readText: (f) => known.get(normalize(f)) ?? null, resolve: normalize })
}

// An imported document replaces this one, untitled ("<stem> (imported)"
// in the title until it is saved). `sourceDir` is where relative paths
// resolve (null for .docx / .pdf imports from their menu: their images
// live in the build dir).
export function finishImport(doc: KDocument, path: string,
  opts: { sourceDir?: string | null; message?: string } = {}): void {
  importedStem = docStem(path)
  // Remember where the file came from so relative \includegraphics paths
  // (e.g. Images/foo.png next to main.tex) resolve when the preview
  // compiles in a temp build dir.
  setImportSourceDir(opts.sourceDir === undefined ? dirname(path) : opts.sourceDir)
  replaceDoc(doc, { path: null, dirty: false })
  updateTitle()
  showMessage(opts.message ?? `Imported ${basename(path)} — Save As to keep it`, opts.message ? 8000 : 6000)
}

// The new window of _overleaf_get: the received version, untitled, with
// the clone folder as its document folder so its figures resolve.
async function loadOverleafVersion(tmp: string, folder: string): Promise<void> {
  const p = platform()
  let doc: KDocument
  try {
    doc = fromJson(await p.readText(tmp))
  } finally {
    await p.remove(dirname(tmp)).catch(() => {})
  }
  setImportSourceDir(folder || null)
  replaceDoc(doc, { path: null, dirty: false })
  updateTitle()
  showMessage('The Overleaf version: save it to keep it.', 8000)
}

function isProjectPathName(path: string): boolean {
  return path.toLowerCase().endsWith('.kdocproj.json')
}

export async function openPath(path: string): Promise<void> {
  const p = platform()
  const fs = fileAccess()
  // Intercept project files before the normal document path.
  if (isProjectPathName(path) || (isKdoczPath(path) && (await readProjectJson(path, fs)) !== null)) {
    if (projectHooks) await projectHooks.openFromPath(path)
    else await warning('Projects', 'Opening a project (thesis, book) is not in this version yet.')
    return
  }
  await projectHooks?.leave()
  if (isArchiveName(path)) { await importLatexPackage(path); return }
  const sfx = suffix(path).toLowerCase()
  const isImport = ['.tex', '.md', '.markdown', '.docx', '.pdf'].includes(sfx)
  appStore().set({ status: isImport ? 'Importing…' : 'Opening…' })
  let doc: KDocument
  let bib = ''
  try {
    if (isKdoczPath(path)) {
      const extractDir = await p.makeTempDir('kdocz-')
      ;[doc] = await loadKdocz(path, extractDir, fs)
      bib = await readBundledBib(path, fs)
    } else if (sfx === '.tex') {
      doc = await importTexFile(path)
    } else if (sfx === '.md' || sfx === '.markdown') {
      doc = importMd(await p.readText(path))
    } else if (sfx === '.docx' || sfx === '.pdf') {
      const wp = await import('./wordPdf')
      ;[doc] = sfx === '.docx' ? await wp.importDocxFile(path) : await wp.importPdfFile(path)
    } else {
      doc = fromJson(await p.readText(path))
      const bundled = join(join(dirname(path), WORK_DIR), BIB_FILE)
      if (await p.exists(bundled)) bib = await p.readText(bundled)
    }
  } catch (exc) {
    appStore().set({ status: '' })
    await critical('Open failed', exc instanceof Error ? exc.message : String(exc))
    return
  }
  bundledBib = bib
  setBundledBib(bib)
  appStore().set({ status: '' })
  if (isImport) {
    if (await offerChapterSplit(path, doc)) return
    finishImport(doc, path)
    void refreshKherverefBib(doc).catch(() => {})
    return
  }
  if (await offerChapterSplit(path, doc, true)) return
  importedStem = null
  setImportSourceDir(null)
  const cached = join(dirname(path), `${docStem(path)}.pdf`)
  if (await p.exists(cached)) await showCachedPdf(cached)
  replaceDoc(doc, { path, dirty: false })
  updateTitle()
  rememberRecent(path)
  // _refresh_kherveref_bib(doc) feeds the editor the bibliography so
  // citations display as they will compile.
  void refreshKherverefBib(doc).catch(() => {})
}

// ---- split into documents (chapter_split.py; MainWindow._ask_split) ----

function splitFs() {
  const p = platform()
  return { ...fileAccess(), mkdir: (path: string) => p.mkdir(path) }
}

// How to split `doc` into documents: "chapter", "section", or null (kept
// as it is). Splitting by section is offered when the chapters have
// sections.
async function askSplit(name: string, doc: KDocument, folder: string, keepLabel: string): Promise<SplitBy | null> {
  const chapters = chapterPlan(doc).filter(p => p[1] !== 'frontmatter').length
  const sections = chapterPlan(doc, 'section').filter(p => p[1] === 'section').length
  const answer = await messageBox({
    title: 'Split into documents', icon: 'question',
    text: `${name} has ${chapters} chapters${sections ? ` and ${sections} sections` : ''}`
      + ` (about ${estimatePages(doc)} pages).\n\n`
      + 'A long document is faster to edit and compile as a project of smaller documents, one per '
      + 'chapter or one per section; the project still prints the whole document, page for page. '
      + `The documents go in a new folder, \u201c${basename(folder)}\u201d, beside it.`,
    buttons: [{ label: 'Split by chapter', default: true },
      ...(sections ? [{ label: 'Split by section' }] : []), { label: keepLabel }],
  })
  return answer === 'Split by chapter' ? 'chapter' : answer === 'Split by section' ? 'section' : null
}

async function splitAndOpen(doc: KDocument, folder: string, title: string, by: SplitBy): Promise<boolean> {
  let main: string
  try {
    main = await writeChapterProject(doc, folder, title, by, splitFs())
  } catch (exc) {
    await critical('Split into documents', exc instanceof Error ? exc.message : String(exc))
    return false
  }
  if (!projectHooks) return false
  await projectHooks.openFromPath(main)
  showMessage(`Split into ${chapterPlan(doc, by).length} documents in ${basename(folder)}`, 8000)
  return true
}

// A long document with chapters (a thesis, a book), imported or opened:
// offer to make it a project with one document per chapter or per section,
// written to a new folder beside the file. True when it was split and
// opened. A file kept as one document when opened is not asked about again.
async function offerChapterSplit(path: string, doc: KDocument, opened = false): Promise<boolean> {
  if (!projectHooks || !shouldOffer(doc)) return false
  const raw = setting<unknown>('split_declined', [])
  const declined = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  if (opened && declined.includes(path)) return false
  const folder = await projectFolder(path, fileAccess())
  const by = await askSplit(basename(path), doc, folder, 'Keep as one document')
  if (by === null) {
    if (opened) setSetting('split_declined', [...declined, path])
    return false
  }
  return splitAndOpen(doc, folder, docStem(path), by)
}

// File > Project > Split into documents: the open document as a project
// of its chapters (or sections), in a new folder beside it.
async function splitIntoDocuments(): Promise<void> {
  if (projectHooks?.isOpen()) {
    await information('Split into documents', 'This document is already part of a project.')
    return
  }
  const doc = appStore().get().doc
  if (!chapterPlan(doc).length) {
    await information('Split into documents',
      'The document needs at least two chapters (Chapter or Heading 1 headings) to be split.')
    return
  }
  if (appStore().get().path === null) {
    await information('Split into documents',
      'Save the document first \u2014 the documents of the split go in a folder beside it.')
    await saveAs()
    if (appStore().get().path === null) return
  } else if (appStore().get().dirty) {
    await save()
  }
  const path = appStore().get().path!
  const folder = await projectFolder(path, fileAccess())
  const by = await askSplit(basename(path), appStore().get().doc, folder, 'Cancel')
  if (by) await splitAndOpen(appStore().get().doc, folder, docStem(path), by)
}

// open_dropped: the first document replaces this one (after offering to
// save it); further documents open in windows of their own.
// TODO(visual editor): pictures go into the document as figures
// (editor.drop_image_file).
export async function openDropped(paths: string[]): Promise<void> {
  const docs = paths.filter(f => {
    const s = suffix(f).toLowerCase()
    return OPENABLE_SUFFIXES.has(s) && !IMAGE_SUFFIXES.has(s)
  })
  if (!docs.length) return
  const [first, ...rest] = docs
  if (await offerSaveBefore(`opening ${basename(first)}`)) await openPath(first)
  const { openWindow } = await import('./window')
  for (const path of rest) await openWindow({ kind: 'open', path })
}

// A free folder beside *path* for its unpacked package: "paper" for
// paper.tar.bz2, else "paper (2)"...
async function unpackFolder(path: string): Promise<string> {
  const stem = basename(path).replace(/(\.tar)?\.(zip|tar|gz|tgz|bz2|tbz2?)$/i, '') || 'package'
  let folder = join(dirname(path), stem)
  for (let n = 2; await platform().exists(folder); n++) folder = join(dirname(path), `${stem} (${n})`)
  return folder
}

// File ▸ Import ▸ LaTeX package: a .zip / .tar.gz / .tar.bz2 of a LaTeX
// project (arXiv source, Overleaf download, a journal template). Its files
// (figures folders, .sty, .cls, .bib) are unpacked into a folder beside it,
// so figures show and compile; its main .tex becomes the document.
export async function importLatexPackage(path: string): Promise<void> {
  const p = platform()
  appStore().set({ status: 'Unpacking…' })
  let doc: KDocument
  let mainPath: string
  let folder: string
  let count: number
  try {
    const files = readArchive(await p.readFile(path), basename(path))
    const main = findMainTex(files)
    if (!main) {
      throw new Error(`${basename(path)} has no main LaTeX file (a .tex with \\documentclass). `
        + `It holds: ${[...files.keys()].slice(0, 12).join(', ')}${files.size > 12 ? '…' : ''}`)
    }
    folder = await unpackFolder(path)
    for (const [rel, data] of files) {
      const target = join(folder, rel)
      await p.mkdir(dirname(target))
      await p.writeFile(target, data)
    }
    count = files.size
    mainPath = join(folder, main)
    appStore().set({ status: 'Importing…' })
    doc = await importTexFile(mainPath)
  } catch (exc) {
    appStore().set({ status: '' })
    await critical('Import LaTeX package', exc instanceof Error ? exc.message : String(exc))
    return
  }
  appStore().set({ status: '' })
  bundledBib = ''
  setBundledBib('')
  finishImport(doc, mainPath, { sourceDir: dirname(mainPath),
    message: `Imported ${basename(path)}: ${count} files unpacked into “${basename(folder)}” beside it — Save As to keep the document` })
}

async function importAction(title: string, filters: FileFilter[], kind: 'tex' | 'md'): Promise<void> {
  const picked = await platform().openFileDialog({ title, filters })
  if (!picked?.length) return
  if (!(await offerSaveBefore(`importing ${basename(picked[0])}`))) return
  const path = picked[0]
  appStore().set({ status: 'Importing…' })
  let doc: KDocument
  try {
    doc = kind === 'tex' ? await importTexFile(path) : importMd(await platform().readText(path))
  } catch (exc) {
    appStore().set({ status: '' })
    await critical('Import failed', exc instanceof Error ? exc.message : String(exc))
    return
  }
  appStore().set({ status: '' })
  bundledBib = ''
  setBundledBib('')
  finishImport(doc, path)
}

// ---- saving ----

// Where a save or export dialog opens: the document's own folder and name
// with `ext` ("talk.docx" next to talk.ktex), so it saves where you are.
export function defaultTarget(ext: string): string {
  const cur = appStore().get().path
  return cur ? join(dirname(cur), docStem(cur) + ext) : `document${ext}`
}

// What Save As writes for a name the user typed with another format's
// ending: that format, at exactly that path.
const SAVE_AS_EXPORTS: Record<string, (path: string) => Promise<void>> = {}
export function registerSaveAsExport(ext: string, run: (path: string) => Promise<void>): void {
  SAVE_AS_EXPORTS[ext] = run
}

function hasNativeSuffix(path: string): boolean {
  const name = basename(path).toLowerCase()
  return name.endsWith('.ktex') || name.endsWith('.ktexz') || name.endsWith('.ktex.json')
    || name.endsWith('.kdocz') || name.endsWith('.kdoc.json')
}

export async function save(): Promise<void> {
  if (projectHooks?.isOpen()) {
    await projectHooks.save()
    return
  }
  const path = appStore().get().path
  if (path === null) await saveAs()
  else await writeTo(path)
}

export async function saveAs(): Promise<void> {
  const picked = await platform().saveFileDialog({
    title: 'Save document', defaultName: defaultTarget(NATIVE_SUFFIX),
    // Every format Save As can write: macOS would otherwise add .ktex to
    // a name typed as talk.docx (talk.docx.ktex).
    filters: [{ name: 'KherveTeX document', extensions: ['ktex'] }, { name: 'Word', extensions: ['docx'] },
      { name: 'PDF', extensions: ['pdf'] }, { name: 'LaTeX', extensions: ['tex'] },
      { name: 'JSON KherveTeX', extensions: ['json'] }],
  })
  if (!picked) return
  // "talk.docx", "talk.pdf", "talk.tex": that format, where it was asked
  // for (the document keeps its own file).
  const asked = SAVE_AS_EXPORTS[suffix(picked).toLowerCase()]
  if (asked) {
    await asked(picked)
    return
  }
  let path = picked
  // No extension typed: the bundled format, self-contained for documents
  // with images.
  if (!hasNativeSuffix(path)) {
    path = basename(path).toLowerCase().endsWith('.json') ? withSuffix(path, '.ktex.json') : withSuffix(path, NATIVE_SUFFIX)
  }
  importedStem = null
  setImportSourceDir(null)
  appStore().set({ path })
  updateTitle()
  await writeTo(path)
  rememberRecent(path)
}

async function writeTo(target: string): Promise<void> {
  const p = platform()
  const fs = fileAccess()
  let path = target
  appStore().set({ status: 'Saving…' })
  const doc = appStore().get().doc
  // TODO(visual editor): editor.cleanup_orphaned_equations(doc).
  if (isLegacyBundle(path) && path === appStore().get().path) {
    // Old .ktexz / .kdocz bundles become .ktex on their next save; the
    // old file is left in place untouched.
    path = withSuffix(path, NATIVE_SUFFIX)
    appStore().set({ path })
    updateTitle()
    rememberRecent(path)
  }
  // The .tex export sits alongside in both formats so users can inspect
  // the source without unzipping.
  const texBasename = docStem(path)
  // _refresh_kherveref_bib(doc): the cited entries of its library, or the
  // copy the document carries when the library is not on this machine.
  let bibText = doc.meta.ref_library ? bundledBib : ''
  try {
    bibText = await refreshKherverefBib(doc)
    bundledBib = getBundledBib()
  } catch { /* keep the copy it carries */ }
  try {
    if (isKdoczPath(path)) await saveKdocz(doc, path, fs, bibText)
    else await p.writeText(path, toJson(doc))
    const work = join(dirname(path), WORK_DIR)
    await p.mkdir(work)
    if (bibText) await p.writeText(join(work, BIB_FILE), bibText)
    await p.writeText(join(work, `${texBasename}.tex`), serializeDocument(doc))
    if (compileUi().engine === 'typst') await p.writeText(join(work, `${texBasename}.typ`), serializeTypst(doc))
  } catch (exc) {
    appStore().set({ status: '' })
    await critical('Save failed', exc instanceof Error ? exc.message : String(exc))
    return
  }
  // Only clear the flag if nothing was typed while saving.
  appStore().set(s => ({ dirty: s.doc === doc ? false : s.dirty, status: '' }))
  if (path !== target) showMessage(`Saved as ${basename(path)} (new format)`, 6000)
  for (const l of saveListeners) await l(dirname(path), basename(path), texBasename)
}

// ---- export ----

async function exportTex(): Promise<void> {
  const doc = appStore().get().doc
  if (compileUi().engine === 'typst') {
    const path = await platform().saveFileDialog({ title: 'Export Typst', defaultName: defaultTarget('.typ'),
      filters: [{ name: 'Typst', extensions: ['typ'] }] })
    if (path) await platform().writeText(path, serializeTypst(doc))
  } else {
    const path = await platform().saveFileDialog({ title: 'Export LaTeX', defaultName: defaultTarget('.tex'),
      filters: [{ name: 'LaTeX', extensions: ['tex'] }] })
    if (path) await writeTexTo(path)
  }
}

async function writeTexTo(path: string): Promise<void> {
  await platform().writeText(path, serializeDocument(appStore().get().doc))
  showMessage(`Exported ${path}`, 4000)
}
registerSaveAsExport('.tex', writeTexTo)

async function exportLatexPackage(): Promise<void> {
  const cur = appStore().get().path
  const stem = cur ? docStem(cur) : 'document'
  const picked = await platform().saveFileDialog({ title: 'Export LaTeX package', defaultName: defaultTarget('.zip'),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }] })
  if (!picked) return
  const path = suffix(picked).toLowerCase() === '.zip' ? picked : withSuffix(picked, '.zip')
  const base = resolvedSourceDir() ?? '.'
  await platform().writeFile(path, await exportLatexZip(appStore().get().doc, base, fileAccess(), stem))
  showMessage(`Exported ${path}`, 4000)
}

async function exportPdf(to: string | null = null): Promise<void> {
  let target: string | null = to
  const result = await fullCompile('export PDF', async () => {
    target ??= await platform().saveFileDialog({ title: 'Export PDF', defaultName: defaultTarget('.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    return target !== null
  })
  if (result === null || target === null) return
  if (result.ok && result.pdfPath !== null) {
    await platform().writeFile(target, await platform().readFile(result.pdfPath))
    showMessage(`Exported ${target}`, 4000)
  } else {
    await critical('Compile failed', result.error || 'Unknown error')
  }
}

registerSaveAsExport('.pdf', path => exportPdf(path))

async function showInExplorer(): Promise<void> {
  const path = appStore().get().path
  if (path === null) {
    showMessage('Save the document first', 3000)
    return
  }
  await platform().reveal(path)
}

// ---- recent files ----

export function recentFiles(): string[] {
  return [...recent]
}

// The list itself, for useSyncExternalStore: a new array only when it
// changes (the status bar's recent-files combo).
export function recentSnapshot(): readonly string[] {
  return recent
}

function rememberRecent(path: string): void {
  recent = [path, ...recent.filter(r => r !== path)].slice(0, RECENT_FILES_MAX)
  setSetting('recent_files', recent)
  for (const l of recentListeners) l()
}

const recentListeners = new Set<() => void>()
// TODO(menus): File ▸ Open Recent lists recentFiles() and runs
// open_recent with the path; the menu model is static for now.
export function subscribeRecent(l: () => void): () => void {
  recentListeners.add(l)
  return () => { recentListeners.delete(l) }
}

async function openRecent(arg: unknown): Promise<void> {
  if (typeof arg !== 'string') return
  if (!(await offerSaveBefore(`opening ${basename(arg)}`))) return
  await openPath(arg)
}

// ---- welcome page ----

// MainWindow.apply_layout_mode: "side" and "window" show the live PDF;
// "visual" and "page" hide it and stop background compiles.
export function applyLayoutMode(mode: LayoutMode): void {
  const visual = mode === 'visual' || mode === 'page'
  projectHooks?.onLayoutMode(mode)
  appStore().set({ layout: mode, autoCompile: !visual })
  setCommandChecked(visual ? 'visual_only' : mode === 'window' ? 'pdf_window' : 'side_by_side', true)
  setCommandChecked('auto_compile', !visual)
  setSetting('layout_mode', mode)
}

// The examples area installs how a gallery entry (its index in
// examples.GALLERY order) opens in place of the empty page
// (MainWindow._open_example_here).
let openExample: ((index: number) => void | Promise<void>) | null = null
export function setExampleOpener(fn: ((index: number) => void | Promise<void>) | null): void {
  openExample = fn
}

const GALLERY_LABELS = GALLERY.flatMap(([, , labels]) => labels)

export async function showWelcome(): Promise<void> {
  const exists = await Promise.all(recent.map(r => platform().exists(r).catch(() => false)))
  const r = await showWelcomeDialog({
    recent: [...recent], recentExists: exists, examples: GALLERY_LABELS,
    layout: setting<LayoutMode>('layout_mode', 'side'), showAtStart: setting('show_welcome', true),
  })
  setSetting('show_welcome', r.showAtStart)
  applyLayoutMode(r.layout)
  const c = r.choice
  if (c.kind === 'new') await newDocumentAction()
  else if (c.kind === 'open') await openAction()
  else if (c.kind === 'project') await runAction('new_project')
  else if (c.kind === 'recent') await openRecent(c.path)
  else if (c.kind === 'tour' || c.kind === 'example') {
    const index = c.kind === 'tour' ? 0 : c.index
    if (openExample) await openExample(index)
    else if (c.kind === 'tour' && hasAction('tour')) await runAction('tour')
    else showMessage('The examples are not in this version yet', 4000)
  }
}

// ---- start-up ----

let started = false

// Load the recent list (existing files only), open a file given on the
// command line, and hook the window's close and file drops.
export async function startFileService(): Promise<boolean> {
  if (started) return false
  started = true
  await loadSettings()
  const p = platform()
  const raw = setting<unknown>('recent_files', [])
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  const exists = await Promise.all(list.map(f => p.exists(f).catch(() => false)))
  recent = list.filter((_, i) => exists[i])
  for (const l of recentListeners) l()
  updateTitle()
  let lastPath = appStore().get().path
  appStore().subscribe(() => {
    const path = appStore().get().path
    if (path !== lastPath) { lastPath = path; updateTitle() }
  })

  if (isTauri()) {
    await getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await offerSaveBefore('closing'))) { e.preventDefault(); return }
      saveUserDefaults()
      await shutdownCompiles()
    })
    await getCurrentWebview().onDragDropEvent(ev => {
      if (ev.payload.type !== 'drop') return
      // The Documents list adds dropped files to the project; opening them
      // here would replace the project instead.
      const r = window.devicePixelRatio || 1
      const x = ev.payload.position.x / r
      const y = ev.payload.position.y / r
      if (projectHooks?.dropAt(x, y, ev.payload.paths)) return
      // Pictures (a file from Finder, the screenshot thumbnail) go into the
      // document where they were dropped; documents open.
      const pictures = ev.payload.paths.filter(isImageName)
      if (pictures.length && appStore().get().tab === 'visual') {
        void import('../pictures.ts').then(m => m.insertPicturePaths(pictures, m.positionAt(x, y)))
      }
      void openDropped(ev.payload.paths)
    })
  } else {
    window.addEventListener('beforeunload', (e) => {
      saveUserDefaults()
      if (appStore().get().dirty) e.preventDefault()
    })
  }

  // A window opened by File ▸ Open in new window (actions/window.ts) opens
  // its document; a template window loads in actions/templates.ts. Only
  // the first window takes a file passed on the command line (a
  // double-clicked .ktex).
  const { windowRequest, isMainWindow } = await import('./window')
  const req = windowRequest()
  if (req?.kind === 'open' && req.path) { await openPath(req.path); return true }
  if (req?.kind === 'template') return true
  if (req?.kind === 'overleaf' && req.path) { await loadOverleafVersion(req.path, req.dir ?? ''); return true }
  if (!(await isMainWindow())) return false
  const args = await p.launchArgs().catch(() => [])
  for (const a of args) {
    if (await p.exists(a)) { await openPath(a); return true }
  }
  return false
}

registerActions({
  new: () => newDocumentAction(),
  // MainWindow wires Close document to _new.
  close_doc: () => newDocumentAction('closing it'),
  open: () => openAction(),
  open_recent: (arg) => openRecent(arg),
  split_documents: () => splitIntoDocuments(),
  save: () => save(),
  save_as: () => saveAs(),
  import_tex: () => importAction('Import LaTeX', [{ name: 'LaTeX', extensions: ['tex'] }, { name: 'All files', extensions: [] }], 'tex'),
  import_package: async () => {
    const picked = await platform().openFileDialog({ title: 'Import a LaTeX package',
      filters: [{ name: 'LaTeX package (.zip, .tar.gz, .tar.bz2)', extensions: ARCHIVE_EXTENSIONS },
        { name: 'All files', extensions: [] }] })
    if (!picked?.length) return
    if (!(await offerSaveBefore(`importing ${basename(picked[0])}`))) return
    await importLatexPackage(picked[0])
  },
  import_md: () => importAction('Import Markdown', [{ name: 'Markdown', extensions: ['md', 'markdown'] }, { name: 'All files', extensions: [] }], 'md'),
  export_tex: () => exportTex(),
  export_latex_zip: () => exportLatexPackage(),
  export_pdf: () => exportPdf(null),
  show_in_explorer: () => showInExplorer(),
  welcome: () => showWelcome(),
})
