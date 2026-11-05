// The live app as the MCP tools see it: MainWindow and its DocumentEditor
// in khervedoc/mcp_tools.py, here the store, the visual editor, the
// compile loop and the file actions.
import { closeHistory } from 'prosemirror-history'
import { Selection, type Transaction } from 'prosemirror-state'
import { runAction } from '../app/actions.ts'
import { newDocumentAction, openPath } from '../app/actions/file.ts'
import { compileUi, engineAvailable, kickCompile, resolvedSourceDir } from '../app/compile.ts'
import { appStore, editDoc } from '../app/store.ts'
import type { Block, DocMeta, Document as KDocument } from '../core/model.ts'
import { setTextMetrics, type Scene } from '../core/paintModel.ts'
import { dirname, isAbsolute, join, withSuffix } from '../core/paths.ts'
import { announceFigureUpdated, canvasToPng, imagesDir } from '../drawing/host.ts'
import * as C from '../editor/commands.ts'
import { editor } from '../editor/controller.ts'
import { docToPM } from '../editor/convert.ts'
import { platform } from '../platform'
import { drawingFiles } from './authoring.ts'
import { ToolError, type CompileOutcome, type ToolHost } from './tools.ts'

const SEPARATOR = '\n' + '─'.repeat(60) + '\n'

// MainWindow._last_compile_result, read back from what the compile loop
// keeps: the store's compile state (its Console text is
// "[time] Engine — compiled successfully | ERROR: <error>", a rule, then
// the engine's log) and the last good PDF.
export function lastCompileFromStore(): CompileOutcome | null {
  const c = appStore().get().compile
  if (c.ok === null) return null
  const cut = c.log.indexOf(SEPARATOR)
  const header = cut < 0 ? c.log : c.log.slice(0, cut)
  const log = cut < 0 ? '' : c.log.slice(cut + SEPARATOR.length)
  const marker = ' — ERROR: '
  const at = header.indexOf(marker)
  return {
    ok: c.ok,
    error: c.ok ? null : at < 0 ? 'Unknown error' : header.slice(at + marker.length),
    pdfPath: c.ok ? compileUi().pdfPath : null,
    log,
    pdf: c.ok ? c.pdf : null,
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// QFontMetrics from the browser's own layout (as the drawing dialog
// installs them), so a drawn text box is as wide as it draws.
let measureCtx: CanvasRenderingContext2D | null = null
function useBrowserMetrics(): void {
  if (measureCtx || typeof document === 'undefined') return
  measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return
  const ctx = measureCtx
  const css = (f: { family: string; px: number; bold: boolean; italic: boolean }) =>
    `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.px}px "${f.family}", Helvetica, Arial, sans-serif`
  setTextMetrics({
    width: (t, f) => { ctx.font = css(f); return ctx.measureText(t).width },
    ascent: f => { ctx.font = css(f); const m = ctx.measureText('Hg'); return m.fontBoundingBoxAscent ?? f.px * 0.77 },
    lineHeight: f => {
      ctx.font = css(f)
      const m = ctx.measureText('Hg')
      return (m.fontBoundingBoxAscent ?? f.px * 0.77) + (m.fontBoundingBoxDescent ?? f.px * 0.23) + 1
    },
  })
}

async function svgToPng(svg: string, w: number, h: number): Promise<Uint8Array | null> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  try { await img.decode() } catch { return null }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvasToPng(canvas)
}

// The visual editor's text is the document: hand any typing still queued
// to the store before reading it.
function flushed(): KDocument {
  editor()?.flushExport()
  return appStore().get().doc
}

// Close the history group around a remote edit, so it is one Ctrl+Z of
// its own (not merged with the user's typing a moment before or after).
function dispatchAsOneStep(build: (tr: Transaction) => void): void {
  const ctl = editor()!
  const tr = ctl.view.state.tr
  build(tr)
  ctl.view.dispatch(closeHistory(tr))
  ctl.view.dispatch(closeHistory(ctl.view.state.tr))
  ctl.flushExport()
}

export async function createAppHost(): Promise<ToolHost> {
  useBrowserMetrics()
  const p = platform()
  const home = await p.homeDir().catch(() => '')

  // _resolve_image_path: an absolute path that exists, else relative to
  // the document's folder, else to the figures folder.
  const resolveImagePath = async (path: string): Promise<string | null> => {
    if (!path) return null
    if (isAbsolute(path) && await p.exists(path)) return path
    const docPath = appStore().get().path
    if (docPath) {
      const c = join(dirname(docPath), path)
      if (await p.exists(c)) return c
    }
    const c = join(await imagesDir(), path)
    return (await p.exists(c)) ? c : null
  }

  return {
    doc: flushed,

    setChildren(children: Block[]) {
      const doc = flushed()
      const next = { ...doc, children }
      if (!editor()) {
        editDoc(next)
        return
      }
      // editor.replace_body: one edit block, caret back at the start.
      dispatchAsOneStep(tr => {
        tr.replaceWith(0, tr.doc.content.size, docToPM(next).content)
        tr.setSelection(Selection.atStart(tr.doc))
      })
    },

    setMeta(meta: DocMeta) {
      const e = editor()
      if (e) {
        e.setMeta(meta)
        e.flushExport()
      } else {
        editDoc({ ...appStore().get().doc, meta })
      }
    },

    unsaved: () => { flushed(); return appStore().get().dirty },
    path: () => appStore().get().path,
    projectPath: () => appStore().get().projectPath,
    docDir: () => resolvedSourceDir(),
    home: () => home,

    lastCompile: lastCompileFromStore,

    // _t_compile_document: force a compile and wait for it.
    async compile() {
      if (!(await engineAvailable(compileUi().engine))) return null
      const store = appStore()
      const before = store.get().compile.serial
      const deadline = Date.now() + 300_000
      await kickCompile()
      // Nothing ran and nothing is queued: the source is the one whose
      // compile failed last time, and that result stands.
      if (!store.get().compile.running && store.get().compile.serial === before) return lastCompileFromStore()
      while (Date.now() < deadline) {
        const c = store.get().compile
        if (!c.running && c.serial !== before) {
          // An edit during the compile queues one more; it starts a
          // moment after this one ends.
          await sleep(250)
          if (!store.get().compile.running) break
          continue
        }
        await sleep(50)
      }
      const c = store.get().compile
      if (c.running || c.serial === before) return null
      return lastCompileFromStore()
    },

    async pdfPageCount(pdf: Uint8Array) {
      const { loadPdf } = await import('../preview/pdfjs.ts')
      const { doc, destroy } = await loadPdf(pdf)
      const n = doc.numPages
      destroy()
      return n
    },

    // pdf[page - 1].get_pixmap(dpi=dpi, alpha=False).tobytes("png")
    async renderPage(pdf: Uint8Array, pageNo: number, dpi: number) {
      const { loadPdf } = await import('../preview/pdfjs.ts')
      const { doc, destroy } = await loadPdf(pdf)
      try {
        const page = await doc.getPage(pageNo)
        const vp = page.getViewport({ scale: dpi / 72 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(vp.width))
        canvas.height = Math.max(1, Math.round(vp.height))
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        // The print intent renders without requestAnimationFrame, which the
        // webview pauses while the window is in the background — as it is
        // whenever Claude, not the user, is in front.
        const task = page.render({ canvas, canvasContext: ctx, viewport: vp, intent: 'print' })
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([task.promise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => { task.cancel(); reject(new ToolError(`Page ${pageNo} could not be rendered.`)) }, 60_000)
          })])
        } finally {
          clearTimeout(timer)
        }
        const png = await canvasToPng(canvas)
        if (!png) throw new ToolError(`Page ${pageNo} could not be rendered.`)
        return png
      } finally {
        destroy()
      }
    },

    replaceText(find: string, repl: string, all: boolean, caseSensitive: boolean) {
      const ctl = editor()
      if (!ctl) throw new ToolError('The visual editor is not open.')
      const opts = { caseSensitive, wholeWord: false }
      let count = 0
      if (all) {
        count = C.replaceAll(find, repl, opts, ctl.view.state, tr => ctl.view.dispatch(closeHistory(tr)))
      } else {
        // qdoc.find(find, 0, flags): the first match from the top.
        const view = ctl.view
        view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)))
        if (C.find(find, { ...opts, forward: true }, view.state, tr => view.dispatch(tr))) {
          C.replace(find, repl, opts, view.state, tr => view.dispatch(closeHistory(tr)))
          count = 1
        }
      }
      if (count) ctl.view.dispatch(closeHistory(ctl.view.state.tr))
      ctl.flushExport()
      return count
    },

    async saveAs(path: string) {
      appStore().set({ path })
      await runAction('save')
    },
    save: () => runAction('save'),
    openPath: (path: string) => openPath(path),
    async newDocument() {
      // The tool has already refused to discard unsaved work; MainWindow._new
      // does not ask again.
      appStore().set({ dirty: false })
      await newDocumentAction()
    },

    exists: (path: string) => p.exists(path),
    isFile: async (path: string) => !!(await p.stat(path))?.isFile,
    readText: (path: string) => p.readText(path),
    readFile: (path: string) => p.readFile(path),
    writeFile: (path: string, data: Uint8Array) => p.writeFile(path, data),
    mkdir: (path: string) => p.mkdir(path),
    imagesDir,
    resolveImagePath,

    async saveDrawing(scene: Scene, pngPath: string) {
      const files = drawingFiles(scene)
      if (files === null) return false
      await p.writeText(withSuffix(pngPath, '.svg'), files.svg)
      await p.writeFile(withSuffix(pngPath, '.pdf'), files.pdf)
      const png = await svgToPng(files.previewSvg, files.w, files.h)
      if (!png) return false
      await p.writeFile(pngPath, png)
      return true
    },

    refreshFigureImage: (pngPath: string) => announceFigureUpdated(pngPath),

    async editInKhervePaint(pngPath: string) {
      const { openInKhervePaint } = await import('../drawing/khervepaintLink.ts')
      return openInKhervePaint(pngPath, false)
    },
  }
}
