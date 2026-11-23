// Insert ▸ Chart: a chart's files beside the document — chart_NNN.pdf
// (vector, what LaTeX includes), chart_NNN.png (what the page shows) and
// chart_NNN.chart.json (the data and options, so it can be edited again).
// A chart is its own kind of figure (source "chart"), not a drawing.
import { chartScene, chartSpecFrom, type ChartSpec } from '../core/chart'
import { join, withSuffix } from '../core/paths'
import { sceneToPdf } from '../core/paintPdf'
import { sceneToSvg } from '../core/paintRender'
import { exists, readText, writeBytes, writeText } from './host'

export const chartSpecPath = (pngPath: string) => withSuffix(pngPath, '.chart.json')

export async function nextChartPath(imagesDir: string): Promise<string> {
  for (let i = 1; ; i++) {
    const stem = join(imagesDir, `chart_${String(i).padStart(3, '0')}`)
    if (!(await exists(stem + '.png')) && !(await exists(stem + '.pdf')) && !(await exists(stem + '.chart.json'))) return stem + '.png'
  }
}

// The chart's spec, or null when the figure is not a chart.
export async function readChartSpec(pngPath: string): Promise<ChartSpec | null> {
  const p = chartSpecPath(pngPath)
  if (!(await exists(p))) return null
  try { return chartSpecFrom(JSON.parse(await readText(p))) } catch { return null }
}

// The chart as an SVG string (the editor's preview, the PNG).
export function chartSvg(spec: ChartSpec, w: number, h: number): string {
  const sc = chartScene(spec)
  return sceneToSvg(sc, { x: 0, y: 0, w: sc.width, h: sc.height }, w, h)
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
  return new Promise(res => canvas.toBlob(async b => res(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/png'))
}

// Write the three files; false when the PNG could not be made.
export async function saveChart(pngPath: string, spec: ChartSpec): Promise<boolean> {
  const sc = chartScene(spec)
  const rect = { x: 0, y: 0, w: sc.width, h: sc.height }
  await writeText(chartSpecPath(pngPath), JSON.stringify(spec, null, 1))
  await writeBytes(withSuffix(pngPath, '.pdf'), sceneToPdf(sc, rect))
  const png = await svgToPng(sceneToSvg(sc, rect, sc.width * 2, sc.height * 2), sc.width * 2, sc.height * 2)
  if (!png) return false
  await writeBytes(pngPath, png)
  return true
}
