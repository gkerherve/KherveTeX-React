// Insert ▸ Chart: a chart (column, bar, line, pie, scatter) drawn as a
// drawing's shapes, so it is saved, inserted and edited like any drawing
// (PNG for the page, PDF for LaTeX). The data are Word's chart sheet: a
// first row of series names, then one row per category.
import { makeBox, makeLine, makePolygon, makeText, newScene, pen, type Item, type Scene } from './paintModel.ts'

export type ChartKind = 'column' | 'bar' | 'line' | 'pie' | 'scatter'

export interface ChartData { categories: string[]; series: { name: string; values: number[] }[] }

// Office's chart colours.
export const CHART_COLORS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E']

// "Category, Series 1, Series 2\nQ1, 4.3, 2.4\n..." (commas, semicolons or
// tabs) as chart data; null when there is nothing to draw.
export function parseChartData(text: string): ChartData | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l)
  if (lines.length < 2) return null
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim()))
  const names = rows[0].slice(1)
  if (!names.length) return null
  const categories = rows.slice(1).map((r) => r[0] ?? '')
  const series = names.map((name, k) => ({
    name, values: rows.slice(1).map((r) => {
      const v = parseFloat((r[k + 1] ?? '').replace(',', '.'))
      return Number.isFinite(v) ? v : 0
    }),
  }))
  return { categories, series }
}

const W = 640, H = 400
const ink = '#ff404040'
const txt = (s: string, x: number, y: number, size = 12, o: { center?: boolean; right?: boolean; bold?: boolean } = {}): Item => {
  const w = s.length * size * 0.55
  const left = o.center ? x - w / 2 : o.right ? x - w : x
  return makeText(s, { pos: { x: left, y: y - size * 0.7 }, size, bold: o.bold ?? false, color: '#ff262626' })
}
const fill = (hex: string) => ({ color: `#ff${hex.slice(1).toLowerCase()}` })

// Round axis steps: 1, 2, 5 x 10^n.
function niceStep(max: number, ticks = 5): number {
  const raw = max / ticks || 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p
}
const fmt = (v: number) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v)) : String(+v.toFixed(2)))

export function chartScene(kind: ChartKind, data: ChartData, title = ''): Scene {
  const sc = newScene(W + 80, H + 80)
  const items: Item[] = []
  const top = title ? 56 : 24
  if (title) items.push(txt(title, W / 2, 26, 16, { center: true, bold: true }))
  // Legend along the bottom.
  const legend = kind === 'pie' ? data.categories : data.series.map((s) => s.name)
  let lx = 60
  legend.forEach((name, k) => {
    items.push(makeBox('rect', { x: lx, y: H + 22, w: 11, h: 11 }, pen('#00000000', 0), fill(CHART_COLORS[k % CHART_COLORS.length])))
    items.push(txt(name, lx + 16, H + 28, 11))
    lx += 30 + name.length * 7
  })

  if (kind === 'pie') {
    const vals = (data.series[0]?.values ?? []).map((v) => Math.max(0, v))
    const total = vals.reduce((a, b) => a + b, 0) || 1
    const cx = W / 2, cy = (top + H) / 2 + 4, r = Math.min(W, H - top) / 2 - 18
    let a0 = -Math.PI / 2
    vals.forEach((v, k) => {
      const a1 = a0 + (v / total) * 2 * Math.PI
      const pts: [number, number][] = [[cx, cy]]
      const n = Math.max(2, Math.ceil((a1 - a0) / 0.05))
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
      }
      items.push(makePolygon('polygon', pts, pen('#ffffffff', 1.5), fill(CHART_COLORS[k % CHART_COLORS.length])))
      const am = (a0 + a1) / 2
      if (v / total > 0.04) items.push(txt(`${Math.round((v / total) * 100)}%`, cx + r * 0.62 * Math.cos(am), cy + r * 0.62 * Math.sin(am), 12, { center: true, bold: true }))
      a0 = a1
    })
    sc.items = items
    return sc
  }

  // Axes.
  const x0 = 70, x1 = W - 10, y0 = H - 6, y1 = top
  const all = data.series.flatMap((s) => s.values)
  const max = Math.max(0, ...all), min = Math.min(0, ...all)
  const step = niceStep(max - min || 1)
  const hi = Math.ceil(max / step) * step || step, lo = Math.floor(min / step) * step
  const horizontal = kind === 'bar'
  const vScale = (v: number) => horizontal ? x0 + ((v - lo) / (hi - lo)) * (x1 - x0) : y0 - ((v - lo) / (hi - lo)) * (y0 - y1)
  for (let v = lo; v <= hi + step / 2; v += step) {
    const p = vScale(v)
    if (horizontal) {
      items.push(makeLine('line', p, y1, p, y0, pen('#ffd9d9d9', 1)))
      items.push(txt(fmt(v), p, y0 + 14, 10, { center: true }))
    } else {
      items.push(makeLine('line', x0, p, x1, p, pen('#ffd9d9d9', 1)))
      items.push(txt(fmt(v), x0 - 6, p, 10, { right: true }))
    }
  }
  items.push(makeLine('line', x0, y0, x1, y0, pen(ink, 1)))
  items.push(makeLine('line', x0, y1, x0, y0, pen(ink, 1)))
  const nCat = Math.max(1, data.categories.length)
  const nSer = Math.max(1, data.series.length)

  if (kind === 'scatter') {
    // First column of numbers along x, each series along y.
    const xs = data.categories.map((c) => parseFloat(c))
    const xmax = Math.max(...xs.filter(Number.isFinite), 1), xmin = Math.min(0, ...xs.filter(Number.isFinite))
    const xs2 = (v: number) => x0 + ((v - xmin) / (xmax - xmin || 1)) * (x1 - x0)
    const xstep = niceStep(xmax - xmin || 1)
    for (let v = Math.floor(xmin / xstep) * xstep; v <= xmax + xstep / 2; v += xstep) items.push(txt(fmt(v), xs2(v), y0 + 14, 10, { center: true }))
    data.series.forEach((s, k) => s.values.forEach((v, i) => {
      if (!Number.isFinite(xs[i])) return
      items.push(makeBox('ellipse', { x: xs2(xs[i]) - 4, y: vScale(v) - 4, w: 8, h: 8 }, pen('#00000000', 0), fill(CHART_COLORS[k % CHART_COLORS.length])))
    }))
    sc.items = items
    return sc
  }

  const band = (horizontal ? (y0 - y1) : (x1 - x0)) / nCat
  data.categories.forEach((c, i) => {
    const mid = (horizontal ? y1 : x0) + band * (i + 0.5)
    items.push(horizontal ? txt(c, x0 - 6, mid, 11, { right: true }) : txt(c, mid, y0 + 14, 11, { center: true }))
  })
  if (kind === 'line') {
    data.series.forEach((s, k) => {
      const col = CHART_COLORS[k % CHART_COLORS.length]
      const pts = s.values.map((v, i) => [x0 + band * (i + 0.5), vScale(v)] as [number, number])
      for (let i = 1; i < pts.length; i++) items.push(makeLine('line', pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], pen(`#ff${col.slice(1).toLowerCase()}`, 2.5)))
      for (const [x, y] of pts) items.push(makeBox('ellipse', { x: x - 3.5, y: y - 3.5, w: 7, h: 7 }, pen('#00000000', 0), fill(col)))
    })
  } else {
    const inner = band * 0.7, w = inner / nSer
    data.series.forEach((s, k) => s.values.forEach((v, i) => {
      const start = (horizontal ? y1 : x0) + band * i + (band - inner) / 2 + w * k
      const a = vScale(Math.max(v, lo < 0 ? 0 : lo)), b = vScale(v >= 0 ? v : 0)
      const r = horizontal
        ? { x: Math.min(vScale(0 > lo ? 0 : lo), vScale(v)), y: start, w: Math.abs(vScale(v) - vScale(0 > lo ? 0 : lo)), h: w * 0.92 }
        : { x: start, y: Math.min(a, b, vScale(v)), w: w * 0.92, h: Math.abs(vScale(v) - vScale(0 > lo ? 0 : lo)) }
      items.push(makeBox('rect', r, pen('#00000000', 0), fill(CHART_COLORS[k % CHART_COLORS.length])))
    }))
  }
  sc.items = items
  return sc
}
