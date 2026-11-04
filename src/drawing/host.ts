// What the drawing and flowchart dialogs need from the rest of the app:
// the figures folder of the open document (DocumentEditor._images_dir),
// files, the LaTeX engine for the flowchart preview, and turning a PDF
// page into a PNG (pymupdf's get_pixmap). Everything goes through the
// platform layer, so the dialogs never touch Tauri themselves.
import { compilerHost, engineAvailable } from '../app/compile'
import { appStore } from '../app/store'
import { compileTex } from '../core/compiler'
import { dirname, join } from '../core/paths'
import { platform } from '../platform'

const WORK_DIR = '.kherve'

let tempImages: Promise<string> | null = null

// Where new figures go: `.kherve/figures` beside a saved document
// (project_store.work_dir), else one temporary folder per session
// (tempfile.mkdtemp(prefix="khervedoc-imgs-")).
export async function imagesDir(): Promise<string> {
  const path = appStore().get().path
  let dir: string
  if (path) {
    dir = join(join(dirname(path), WORK_DIR), 'figures')
  } else {
    if (!tempImages) tempImages = platform().makeTempDir('khervedoc-imgs-')
    dir = await tempImages
  }
  await platform().mkdir(dir)
  return dir
}

export const exists = (p: string): Promise<boolean> => platform().exists(p)
export const writeBytes = (p: string, b: Uint8Array): Promise<void> => platform().writeFile(p, b)
export const writeText = (p: string, t: string): Promise<void> => platform().writeText(p, t)
export const readText = (p: string): Promise<string> => platform().readText(p)
export const readBytes = (p: string): Promise<Uint8Array> => platform().readFile(p)

// compiler.tectonic_available()
export function latexAvailable(): Promise<boolean> {
  return engineAvailable('latex')
}

let tempRoot: Promise<string> | null = null

// Path(tempfile.gettempdir()) / name — one temp root per session.
async function tempDir(name: string): Promise<string> {
  if (!tempRoot) tempRoot = platform().makeTempDir('khervedoc-draw-')
  return join(await tempRoot, name)
}

// compile_tex(tex, tempdir / workdir, basename): the PDF bytes, or null
// with tectonic's log.
export async function compileToPdf(tex: string, workdir: string, basename: string)
  : Promise<{ pdf: Uint8Array | null; log: string }> {
  try {
    const host = compilerHost()
    const r = await compileTex(tex, await tempDir(workdir), { basename }, host)
    if (r.ok && r.pdfPath) return { pdf: await platform().readFile(r.pdfPath), log: r.log || '' }
    return { pdf: null, log: r.log || r.error || '' }
  } catch (e) {
    return { pdf: null, log: e instanceof Error ? e.message : String(e) }
  }
}

// The first page of a PDF drawn on a white canvas `zoom` × its size in
// points (get_pixmap(matrix=Matrix(z, z), alpha=False)).
export async function pdfToCanvas(pdf: Uint8Array, zoom: (widthPt: number) => number)
  : Promise<{ canvas: HTMLCanvasElement; widthPt: number } | null> {
  try {
    const { loadPdf } = await import('../preview/pdfjs')
    const { doc, destroy } = await loadPdf(pdf)
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const z = zoom(base.width)
    const vp = page.getViewport({ scale: z })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(vp.width))
    canvas.height = Math.max(1, Math.ceil(vp.height))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    destroy()
    return { canvas, widthPt: base.width }
  } catch {
    return null
  }
}

// The first page's width in points (pymupdf page.rect.width).
export async function pdfPageWidth(pdf: Uint8Array): Promise<number | null> {
  try {
    const { loadPdf } = await import('../preview/pdfjs')
    const { doc, destroy } = await loadPdf(pdf)
    const page = await doc.getPage(1)
    const w = page.getViewport({ scale: 1 }).width
    destroy()
    return w
  } catch {
    return null
  }
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise(resolve => {
    canvas.toBlob(async b => {
      if (!b) { resolve(null); return }
      resolve(new Uint8Array(await b.arrayBuffer()))
    }, 'image/png')
  })
}

// Tell the visual editor a figure's image changed on disk (the Python
// editor's refresh_figure_image), so it redraws every figure showing it.
export const FIGURE_UPDATED_EVENT = 'khervetex:figure-updated'

export function announceFigureUpdated(path: string): void {
  window.dispatchEvent(new CustomEvent(FIGURE_UPDATED_EVENT, { detail: { path } }))
}
