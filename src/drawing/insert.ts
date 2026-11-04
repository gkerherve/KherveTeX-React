// The editor's side of the drawing tools (editor.py insert_drawing,
// insert_flowchart, _edit_existing_figure, _edit_existing_flowchart,
// edit_in_khervepaint): open the dialog, write the figure's files beside
// the document, ask for a caption and label, and insert the Figure.
import { editorApi } from '../app/editorApi'
import { appStore, replaceDoc } from '../app/store'
import { naturalWidthFromPdf, naturalWidthFromPoints, nextFlowchartPath, flowchartSourceFor, drawingSourceFor, flowchartSiblings } from '../core/drawingFiles'
import { Flowchart, toTikz } from '../core/flowchart'
import { figure, type Figure } from '../core/model'
import { dirname, isAbsolute, join } from '../core/paths'
import { escapeText } from '../core/serializer'
import { information, warning } from '../platform/MessageBox'
import {
  announceFigureUpdated, canvasToPng, exists, imagesDir, pdfPageWidth, pdfToCanvas, readText,
  writeBytes, writeText,
} from './host'
import { askFigureDetails } from './modal'

// Put a block at the caret; without a mounted editor, at the end of the
// document.
function insertFigure(fig: Figure): void {
  const api = editorApi()
  if (api) {
    api.insertBlock(fig)
    return
  }
  const doc = appStore().get().doc
  replaceDoc({ ...doc, children: [...doc.children, fig] }, { dirty: true })
}

// ------------------------------------------------------------ flowcharts

// save_flowchart: the vector PDF (what LaTeX includes), its source
// (.flow.json), its TikZ (.tikz) and the PNG preview the Visual tab shows
// (200 dpi). False when the preview could not be rendered.
export async function saveFlowchart(pngPath: string, chart: Flowchart, pdf: Uint8Array, tikz: string): Promise<boolean> {
  const f = flowchartSiblings(pngPath)
  await writeBytes(f.pdf, pdf)
  await writeText(f.json, chart.toJson())
  await writeText(f.tikz, tikz)
  const r = await pdfToCanvas(pdf, () => 200 / 72)
  if (!r) return false
  const png = await canvasToPng(r.canvas)
  if (!png) return false
  await writeBytes(pngPath, png)
  return true
}

// natural_width, reading the page size with pdf.js when the PDF keeps its
// page dictionaries compressed.
export async function naturalWidth(pdf: Uint8Array): Promise<string> {
  const w = await pdfPageWidth(pdf)
  return w !== null ? naturalWidthFromPoints(w) : naturalWidthFromPdf(pdf)
}

export async function insertFlowchart(): Promise<void> {
  const { openFlowchartBuilder } = await import('./FlowchartBuilder')
  const res = await openFlowchartBuilder()
  if (!res) return
  const path = await nextFlowchartPath(await imagesDir(), exists)
  if (!(await saveFlowchart(path, res.chart, res.pdf, res.tikz))) {
    await warning('Flowchart', 'The flowchart preview could not be made.')
    return
  }
  const det = await askFigureDetails(path, 'Flowchart details')
  if (!det) return
  insertFigure(figure({
    path, caption: escapeText(det.caption), label: det.label || null,
    width: await naturalWidth(res.pdf), source: 'flowchart',
  }))
}

async function editExistingFlowchart(pngPath: string): Promise<boolean> {
  let chart: Flowchart
  try {
    const src = await flowchartSourceFor(pngPath, exists)
    if (src === null) throw new Error('missing')
    chart = Flowchart.fromJson(await readText(src))
  } catch {
    await information('Cannot re-edit', "This flowchart's source (.flow.json) is missing or unreadable.")
    return false
  }
  const { openFlowchartBuilder } = await import('./FlowchartBuilder')
  const res = await openFlowchartBuilder(chart)
  if (!res) return false
  if (!(await saveFlowchart(pngPath, res.chart, res.pdf, res.tikz ?? toTikz(res.chart)))) {
    await warning('Flowchart', 'The flowchart preview could not be made.')
    return false
  }
  announceFigureUpdated(pngPath)
  return true
}

// ------------------------------------------------------------ drawings

export async function insertDrawing(): Promise<void> {
  const { openDrawingDialog } = await import('./DrawingDialog')
  const res = await openDrawingDialog(await imagesDir(), null)
  if (!res) return
  const det = await askFigureDetails(res.path, 'Drawing details')
  if (!det) return
  insertFigure(figure({
    path: res.path, caption: escapeText(det.caption), label: det.label || null,
    width: '0.7\\textwidth', source: 'drawing',
  }))
  if (res.handoff) await editInKhervePaint(res.path)
}

export async function editInKhervePaint(pngPath: string): Promise<void> {
  const { openInKhervePaint } = await import('./khervepaintLink')
  await openInKhervePaint(pngPath, true)
}

// _resolve_image_path: an absolute path that exists, else relative to the
// document's folder, else to the figures folder.
async function resolveImagePath(p: string): Promise<string | null> {
  if (!p) return null
  if (isAbsolute(p) && await exists(p)) return p
  const docPath = appStore().get().path
  if (docPath) {
    const c = join(dirname(docPath), p)
    if (await exists(c)) return c
  }
  const c = join(await imagesDir(), p)
  return (await exists(c)) ? c : null
}

// _edit_existing_figure: re-open the editor that made a figure — the
// flowchart builder (a .flow.json source beside the PNG) or the drawing
// dialog (an SVG source, or a legacy JSON sidecar). Returns the figure's
// new `source`, or null when nothing changed.
export async function editFigure(fig: { path: string; source?: string }): Promise<string | null> {
  const resolved = await resolveImagePath(fig.path)
  if (resolved === null) return null
  if (fig.source === 'flowchart' || (await flowchartSourceFor(resolved, exists)) !== null) {
    return (await editExistingFlowchart(resolved)) ? 'flowchart' : null
  }
  if ((await drawingSourceFor(resolved, exists)) === null) {
    await information('Cannot re-edit',
      'This figure was not created with the drawing tool, or its drawing data is missing.')
    return null
  }
  const { openDrawingDialog } = await import('./DrawingDialog')
  const res = await openDrawingDialog(await imagesDir(), resolved)
  if (!res) return null
  // A legacy drawing now has its SVG/PDF too, so LaTeX gets vectors.
  announceFigureUpdated(resolved)
  if (res.handoff) await editInKhervePaint(resolved)
  return 'drawing'
}
