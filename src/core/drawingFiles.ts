// The files a drawing or a flowchart figure keeps beside its PNG preview,
// from drawing_dialog.py (drawing_source_for, next_drawing_path) and
// flowchart_builder.py (flowchart_source_for, next_flowchart_path,
// natural_width). File access is injected, so this runs in Vitest.
import { join, withSuffix } from './paths.ts'
import { pyRound } from './py.ts'
import { pyG } from './paintFormat.ts'
import { zpad } from './py.ts'

export type Exists = (path: string) => Promise<boolean>

// The editable source of a drawing preview: the SVG, else a legacy JSON
// sidecar, else null (not a drawing).
export async function drawingSourceFor(pngPath: string, exists: Exists): Promise<string | null> {
  for (const ext of ['.svg', '.json']) {
    const cand = withSuffix(pngPath, ext)
    if (await exists(cand)) return cand
  }
  return null
}

// First free drawing_NNN.png in `imagesDir` (no sibling of any drawing
// extension may exist either).
export async function nextDrawingPath(imagesDir: string, exists: Exists): Promise<string> {
  for (let i = 1; ; i++) {
    const stem = join(imagesDir, `drawing_${zpad(i, 3)}`)
    let taken = false
    for (const e of ['.png', '.svg', '.pdf', '.json']) {
      if (await exists(stem + e)) { taken = true; break }
    }
    if (!taken) return stem + '.png'
  }
}

// The .flow.json source of a flowchart figure's PNG preview, or null when
// the figure was not made with the flowchart builder.
export async function flowchartSourceFor(pngPath: string, exists: Exists): Promise<string | null> {
  const src = withSuffix(pngPath, '.flow.json')
  return (await exists(src)) ? src : null
}

// First free flowchart_NNN.png in `imagesDir` (no sibling of any
// flowchart extension may exist either).
export async function nextFlowchartPath(imagesDir: string, exists: Exists): Promise<string> {
  for (let i = 1; ; i++) {
    const stem = join(imagesDir, `flowchart_${zpad(i, 3)}`)
    let taken = false
    for (const e of ['.png', '.pdf', '.flow.json', '.tikz']) {
      if (await exists(stem + e)) { taken = true; break }
    }
    if (!taken) return stem + '.png'
  }
}

// The sibling paths of a flowchart figure (save_flowchart writes them all).
export function flowchartSiblings(pngPath: string): { png: string; pdf: string; json: string; tikz: string } {
  return { png: pngPath, pdf: withSuffix(pngPath, '.pdf'), json: withSuffix(pngPath, '.flow.json'),
    tikz: withSuffix(pngPath, '.tikz') }
}

// A figure width that keeps the chart close to its natural size, so the
// text size picked in the builder is roughly what prints. Assumes a 15 cm
// text block (A4 with ordinary margins); never wider than it.
export function naturalWidthFromPoints(widthPt: number | null): string {
  if (widthPt === null || !Number.isFinite(widthPt)) return '0.8\\textwidth'
  const wCm = widthPt / 72 * 2.54
  const frac = Math.min(1.0, Math.max(0.3, pyRound(wCm / 15.0, 2)))
  return `${pyG(frac)}\\textwidth`
}

// The first page's width in points, read from its /MediaBox when the page
// dictionary is plain text (pdf.js reads any PDF; see drawing/pdfInfo.ts).
export function pdfFirstPageWidth(pdf: Uint8Array): number | null {
  const head = new TextDecoder('latin1').decode(pdf)
  const m = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(head)
  if (!m) return null
  return Math.abs(Number(m[3]) - Number(m[1]))
}

export function naturalWidthFromPdf(pdf: Uint8Array): string {
  return naturalWidthFromPoints(pdfFirstPageWidth(pdf))
}
