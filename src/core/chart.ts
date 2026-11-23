// Insert ▸ Chart: a chart of its own (not a drawing). A ChartSpec holds the
// data sheet and every option; chartScene() draws it as vector shapes, which
// the app writes as the chart's PDF (what LaTeX includes) and PNG (what the
// page shows), with the spec beside them (chart_NNN.chart.json) so a
// double-click reopens the chart editor.
import { makeBox, makeLine, makePath, makePolygon, makeText, newScene, pen, type Dash, type Item, type Scene } from './paintModel.ts'
import type { Cmd } from './paintGeom.ts'

export type ChartKind =
  | 'column' | 'column_stacked' | 'bar' | 'bar_stacked'
  | 'line' | 'area' | 'scatter' | 'scatter_line' | 'pie' | 'doughnut'

export type Marker = 'none' | 'circle' | 'square' | 'triangle' | 'diamond'
export type LegendPos = 'bottom' | 'right' | 'top' | 'none'

export interface SeriesStyle { color: string; dash: Dash; width: number; marker: Marker; smooth: boolean }

export interface ChartSpec {
  version: 1
  kind: ChartKind
  title: string
  // The sheet: row 0 holds the first column's name and the series names;
  // each other row a category (or an X value) and its values.
  rows: string[][]
  xTitle: string
  yTitle: string
  legend: LegendPos
  gridlines: boolean
  dataLabels: boolean
  palette: string
  yMin: string   // '' = automatic
  yMax: string
  series: SeriesStyle[]   // one per series column (missing ones use the palette)
}

export interface ChartKindInfo { kind: ChartKind; name: string; family: string; text: string; tip: string }

// The gallery, with what each type is for.
export const CHART_KINDS: ChartKindInfo[] = [
  { kind: 'column', name: 'Column', family: 'Column',
    text: 'Vertical bars side by side: compare values across a few categories.',
    tip: 'Use it for counts or amounts per group: samples, months, treatments.' },
  { kind: 'column_stacked', name: 'Stacked column', family: 'Column',
    text: 'Bars stacked on top of each other: how parts add up to a total in each category.',
    tip: 'Each column is the total; each colour is one part of it.' },
  { kind: 'bar', name: 'Bar', family: 'Bar',
    text: 'Horizontal bars: the same as a column chart, with room for long category names.',
    tip: 'Good with many categories or long labels.' },
  { kind: 'bar_stacked', name: 'Stacked bar', family: 'Bar',
    text: 'Horizontal stacked bars: the parts of each total, read from left to right.',
    tip: 'Survey answers, budgets, compositions.' },
  { kind: 'line', name: 'Line', family: 'Line',
    text: 'Points joined by lines: a trend over time or over an ordered sequence.',
    tip: 'Categories are equally spaced; for measured X values use Scatter with lines.' },
  { kind: 'area', name: 'Area', family: 'Line',
    text: 'A line chart filled down to the axis: amounts that change over time.',
    tip: 'Shows volume; series are drawn in order, the first one behind.' },
  { kind: 'scatter', name: 'Scatter (X, Y)', family: 'X Y',
    text: 'Measured points: the first column holds the X values, each other column a Y series.',
    tip: 'Correlations and experimental data. X must be numbers.' },
  { kind: 'scatter_line', name: 'Scatter with lines', family: 'X Y',
    text: 'X, Y points joined by lines, at their true X positions: curves and calibrations.',
    tip: 'Functions, spectra, kinetics. Tick “Smooth” for a curve through the points.' },
  { kind: 'pie', name: 'Pie', family: 'Pie',
    text: 'Slices of one total: the share of each category (first series only).',
    tip: 'Best with 2 to 6 slices that add up to a meaningful whole.' },
  { kind: 'doughnut', name: 'Doughnut', family: 'Pie',
    text: 'A pie with a hole: shares of one total, a lighter look.',
    tip: 'The first series only; the total is printed in the middle.' },
]

export const PALETTES: [string, string, string[]][] = [
  ['office', 'Office', ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E']],
  ['colorful', 'Colourful', ['#E6194B', '#3CB44B', '#4363D8', '#F58231', '#911EB4', '#42D4F4', '#F032E6', '#BFEF45']],
  ['science', 'Science (colour-blind safe)', ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442', '#000000']],
  ['blue', 'Blues', ['#08306B', '#2171B5', '#4292C6', '#6BAED6', '#9ECAE1', '#C6DBEF', '#08519C', '#3182BD']],
  ['green', 'Greens', ['#00441B', '#238B45', '#41AB5D', '#74C476', '#A1D99B', '#C7E9C0', '#006D2C', '#31A354']],
  ['warm', 'Warm', ['#7F0000', '#D7301F', '#EF6548', '#FC8D59', '#FDBB84', '#FDD49E', '#B30000', '#E34A33']],
  ['grey', 'Greyscale (print)', ['#252525', '#636363', '#969696', '#BDBDBD', '#525252', '#737373', '#D9D9D9', '#000000']],
]
export const CHART_COLORS = PALETTES[0][2]

export const SAMPLE_ROWS: string[][] = [
  ['Category', 'Series 1', 'Series 2', 'Series 3'],
  ['Category 1', '4.3', '2.4', '2'],
  ['Category 2', '2.5', '4.4', '2'],
  ['Category 3', '3.5', '1.8', '3'],
  ['Category 4', '4.5', '2.8', '5'],
]
export const SAMPLE_XY: string[][] = [
  ['Time (s)', 'Sample A', 'Sample B'],
  ['0', '0', '0'], ['1', '1.8', '1.1'], ['2', '3.1', '2.0'], ['3', '3.9', '2.7'], ['4', '4.4', '3.2'], ['5', '4.7', '3.5'],
]

export function paletteColors(name: string): string[] {
  return (PALETTES.find(p => p[0] === name) ?? PALETTES[0])[2]
}

export function defaultSeries(k: number, palette = 'office'): SeriesStyle {
  const cols = paletteColors(palette)
  return { color: cols[k % cols.length], dash: 'solid', width: 2, marker: 'circle', smooth: false }
}

export function newChartSpec(kind: ChartKind = 'column'): ChartSpec {
  const xy = kind === 'scatter' || kind === 'scatter_line'
  const rows = (xy ? SAMPLE_XY : SAMPLE_ROWS).map(r => [...r])
  return {
    version: 1, kind, title: 'Chart Title', rows, xTitle: '', yTitle: '', legend: 'bottom',
    gridlines: true, dataLabels: false, palette: 'office', yMin: '', yMax: '',
    series: rows[0].slice(1).map((_, k) => defaultSeries(k)),
  }
}

// A saved spec, with defaults for anything missing.
export function chartSpecFrom(json: unknown): ChartSpec | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Partial<ChartSpec>
  if (!Array.isArray(j.rows) || !CHART_KINDS.some(k => k.kind === j.kind)) return null
  const base = newChartSpec(j.kind as ChartKind)
  const spec: ChartSpec = { ...base, ...j, version: 1, rows: j.rows.map(r => (Array.isArray(r) ? r.map(c => String(c ?? '')) : [])) }
  spec.series = seriesFor(spec)
  return spec
}

// One style per series column (new columns take the palette's next colour).
export function seriesFor(spec: ChartSpec): SeriesStyle[] {
  const n = Math.max(0, (spec.rows[0]?.length ?? 1) - 1)
  return Array.from({ length: n }, (_, k) => spec.series[k] ?? defaultSeries(k, spec.palette))
}

// Text pasted from Excel / a CSV as rows of cells.
export function parseSheet(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return []
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  return lines.map(l => l.split(sep).map(c => c.trim()))
}

const num = (s: string | undefined): number => {
  const t = (s ?? '').trim().replace(/\s/g, '')
  if (!t) return NaN
  return Number(/^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t)
}

export interface ChartData { names: string[]; categories: string[]; xs: number[]; values: number[][] }

// The sheet as numbers: the series names, the categories (first column),
// numeric X values (scatter: the first column, or 1, 2, 3… when it holds
// text) and each series' values (NaN for an empty cell).
export function chartData(spec: ChartSpec): ChartData | null {
  const rows = spec.rows.filter((r, i) => i === 0 || r.some(c => c.trim()))
  if (rows.length < 2) return null
  const width = Math.max(...rows.map(r => r.length))
  const names = Array.from({ length: width - 1 }, (_, k) => rows[0][k + 1]?.trim() || `Series ${k + 1}`)
  if (!names.length) return null
  const body = rows.slice(1)
  const categories = body.map(r => r[0]?.trim() ?? '')
  const firstNums = body.map(r => num(r[0]))
  const xs = firstNums.every(v => Number.isFinite(v)) ? firstNums : body.map((_, i) => i + 1)
  const values = names.map((_, k) => body.map(r => num(r[k + 1])))
  return { names, categories, xs, values }
}

// ------------------------------------------------------------- drawing

const W = 720, H = 450
const argb = (hex: string, a = 'ff') => `#${a}${hex.replace('#', '').slice(0, 6).toLowerCase()}`
const fill = (hex: string, a = 'ff') => ({ color: argb(hex, a) })
const NOPEN = pen('#00000000', 0)
const AXIS = '#ff595959', GRID = '#ffd9d9d9', TEXT = '#ff404040'
const textWidth = (s: string, size: number) => s.length * size * 0.53

function label(s: string, x: number, y: number, size = 11, o: { align?: 'left' | 'center' | 'right'; bold?: boolean; color?: string; rotate?: boolean } = {}): Item {
  const w = textWidth(s, size)
  if (o.rotate) {
    // Rotated a quarter turn, reading upwards, centred on (x, y).
    return makeText(s, { pos: { x: x - size * 0.7, y: y + w / 2 }, rotation: -90, size, bold: o.bold ?? false, color: o.color ?? TEXT })
  }
  const left = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x
  return makeText(s, { pos: { x: left, y: y - size * 0.72 }, size, bold: o.bold ?? false, color: o.color ?? TEXT })
}

function niceStep(span: number, ticks = 5): number {
  const raw = span / ticks || 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const m = raw / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p
}
export function fmtNum(v: number): string {
  if (Math.abs(v) < 1e-12) return '0'
  if (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) return v.toExponential(1).replace('e+', 'e')
  return String(+v.toFixed(Math.max(0, 3 - Math.floor(Math.log10(Math.abs(v))))))
}

function axisRange(lo: number, hi: number, fixedLo: number, fixedHi: number): { lo: number; hi: number; step: number } {
  if (Number.isFinite(fixedLo)) lo = fixedLo
  if (Number.isFinite(fixedHi)) hi = fixedHi
  if (hi <= lo) hi = lo + 1
  const step = niceStep(hi - lo)
  return {
    lo: Number.isFinite(fixedLo) ? lo : Math.floor(lo / step + 1e-9) * step,
    hi: Number.isFinite(fixedHi) ? hi : Math.ceil(hi / step - 1e-9) * step,
    step,
  }
}

function markerItem(m: Marker, x: number, y: number, color: string, size = 7): Item | null {
  const r = size / 2
  const b = fill(color), p = pen('#ffffffff', 1)
  switch (m) {
    case 'circle': return makeBox('ellipse', { x: x - r, y: y - r, w: size, h: size }, p, b)
    case 'square': return makeBox('rect', { x: x - r, y: y - r, w: size, h: size }, p, b)
    case 'triangle': return makePolygon('polygon', [[x, y - r * 1.15], [x + r * 1.1, y + r * 0.8], [x - r * 1.1, y + r * 0.8]], p, b)
    case 'diamond': return makePolygon('polygon', [[x, y - r * 1.25], [x + r * 1.1, y], [x, y + r * 1.25], [x - r * 1.1, y]], p, b)
    default: return null
  }
}

// A polyline, or a smooth curve through the points (Catmull–Rom).
function linePath(pts: [number, number][], smooth: boolean): Cmd[] {
  if (!pts.length) return []
  const cmds: Cmd[] = [['M', pts[0][0], pts[0][1]]]
  for (let i = 1; i < pts.length; i++) {
    if (!smooth || pts.length < 3) { cmds.push(['L', pts[i][0], pts[i][1]]); continue }
    const p0 = pts[i - 2] ?? pts[i - 1], p1 = pts[i - 1], p2 = pts[i], p3 = pts[i + 1] ?? p2
    cmds.push(['C', p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]])
  }
  return cmds
}

function legendItems(names: string[], colors: string[], styles: SeriesStyle[] | null, pos: LegendPos, area: { x0: number; x1: number; y0: number; y1: number }): Item[] {
  if (pos === 'none' || !names.length) return []
  const out: Item[] = []
  const swatch = (k: number, x: number, y: number) => {
    const st = styles?.[k]
    if (st) {
      out.push(makeLine('line', x, y, x + 22, y, pen(argb(colors[k]), Math.max(1.5, st.width), st.dash)))
      const m = markerItem(st.marker, x + 11, y, colors[k], 7)
      if (m) out.push(m)
      return 28
    }
    out.push(makeBox('rect', { x, y: y - 6, w: 12, h: 12 }, NOPEN, fill(colors[k])))
    return 17
  }
  if (pos === 'right') {
    let y = (area.y0 + area.y1) / 2 - (names.length * 20) / 2 + 10
    names.forEach((n, k) => { const w = swatch(k, area.x1 + 18, y); out.push(label(n, area.x1 + 18 + w, y, 11)); y += 20 })
    return out
  }
  const widths = names.map((n, k) => (styles?.[k] ? 28 : 17) + textWidth(n, 11) + 18)
  const total = widths.reduce((a, b) => a + b, 0)
  let x = W / 2 - total / 2
  const y = pos === 'top' ? area.y0 - 22 : H - 14
  names.forEach((n, k) => { const w = swatch(k, x, y); out.push(label(n, x + w, y, 11)); x += widths[k] })
  return out
}

export function chartScene(spec: ChartSpec): Scene {
  const sc = newScene(W, H)
  const items: Item[] = []
  const data = chartData(spec)
  const styles = seriesFor(spec)
  const colors = styles.map(s => s.color)
  const kind = spec.kind
  // Background, so the PNG and the PDF have the same white card.
  items.push(makeBox('rect', { x: 0, y: 0, w: W, h: H }, NOPEN, fill('#ffffff')))
  let top = 18
  if (spec.title.trim()) { items.push(label(spec.title.trim(), W / 2, 30, 17, { align: 'center', bold: true, color: '#ff262626' })); top = 52 }
  if (!data) { items.push(label('Type numbers in the sheet below to see the chart.', W / 2, H / 2, 13, { align: 'center', color: '#ff8a8a8a' })); sc.items = items; return sc }

  const legendNames = kind === 'pie' || kind === 'doughnut' ? data.categories : data.names
  const legendCols = kind === 'pie' || kind === 'doughnut' ? data.categories.map((_, i) => paletteColors(spec.palette)[i % 8]) : colors
  const lineLike = kind === 'line' || kind === 'scatter_line' || kind === 'scatter'
  const legendW = spec.legend === 'right' ? Math.max(...legendNames.map(n => textWidth(n, 11))) + 60 : 0
  if (spec.legend === 'top') top += 26

  // ---- pie and doughnut
  if (kind === 'pie' || kind === 'doughnut') {
    const vals = data.values[0].map(v => (Number.isFinite(v) ? Math.max(0, v) : 0))
    const total = vals.reduce((a, b) => a + b, 0)
    const bottom = spec.legend === 'bottom' ? H - 34 : H - 14
    const cx = (W - legendW) / 2, cy = (top + bottom) / 2
    const r = Math.min((W - legendW) / 2 - 30, (bottom - top) / 2 - 6)
    const ri = kind === 'doughnut' ? r * 0.55 : 0
    let a0 = -Math.PI / 2
    vals.forEach((v, k) => {
      if (!total || v <= 0) return
      const a1 = a0 + (v / total) * 2 * Math.PI
      const n = Math.max(2, Math.ceil((a1 - a0) / 0.04))
      const pts: [number, number][] = []
      for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) }
      if (ri) for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + ri * Math.cos(a), cy + ri * Math.sin(a)]) }
      else pts.push([cx, cy])
      items.push(makePolygon('polygon', pts, pen('#ffffffff', 2), fill(legendCols[k])))
      const am = (a0 + a1) / 2, share = v / total
      if (share > 0.035) {
        const rr = ri ? (r + ri) / 2 : r * 0.64
        const t = spec.dataLabels ? fmtNum(v) : `${Math.round(share * 100)}%`
        items.push(label(t, cx + rr * Math.cos(am), cy + rr * Math.sin(am) + 4, 12, { align: 'center', bold: true, color: '#ffffffff' }))
      }
      a0 = a1
    })
    if (kind === 'doughnut' && total) {
      items.push(label(fmtNum(total), cx, cy + 2, 20, { align: 'center', bold: true }))
      items.push(label('Total', cx, cy + 20, 11, { align: 'center', color: '#ff7a7a7a' }))
    }
    items.push(...legendItems(legendNames, legendCols, null, spec.legend, { x0: 0, x1: W - legendW, y0: top, y1: bottom }))
    sc.items = items
    return sc
  }

  // ---- charts with axes
  const horizontal = kind === 'bar' || kind === 'bar_stacked'
  const stacked = kind === 'column_stacked' || kind === 'bar_stacked'
  const xy = kind === 'scatter' || kind === 'scatter_line'
  const nCat = Math.max(1, data.categories.length)

  // Value range (stacked: the sums of positives and negatives).
  let vals: number[] = data.values.flat().filter(Number.isFinite)
  if (stacked) {
    vals = []
    for (let i = 0; i < nCat; i++) {
      let p = 0, m = 0
      for (const s of data.values) { const v = s[i]; if (Number.isFinite(v)) { if (v >= 0) p += v; else m += v } }
      vals.push(p, m)
    }
  }
  if (!vals.length) vals = [0, 1]
  const barLike = !lineLike && kind !== 'area'
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (barLike || kind === 'area') { lo = Math.min(0, lo); hi = Math.max(0, hi) }
  else { const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad; if (lo < 0 && Math.min(...vals) >= 0) lo = 0 }
  const V = axisRange(lo, hi, num(spec.yMin), num(spec.yMax))

  // Plot area.
  const valLabelW = Math.max(...[V.lo, V.hi, V.lo + V.step].map(v => textWidth(fmtNum(v), 10.5)))
  const catLabelW = horizontal ? Math.min(160, Math.max(...data.categories.map(c => textWidth(c, 11)))) : 0
  const x0 = 14 + (spec.yTitle.trim() ? 22 : 0) + (horizontal ? catLabelW + 8 : valLabelW + 8)
  const x1 = W - 18 - legendW
  const y0 = H - 30 - (spec.legend === 'bottom' ? 26 : 0) - (spec.xTitle.trim() ? 20 : 0)
  const y1 = top + 6
  const vPos = (v: number) => horizontal ? x0 + ((v - V.lo) / (V.hi - V.lo)) * (x1 - x0) : y0 - ((v - V.lo) / (V.hi - V.lo)) * (y0 - y1)

  // Value gridlines and labels.
  for (let v = V.lo, i = 0; v <= V.hi + V.step * 1e-6 && i < 60; v += V.step, i++) {
    const p = vPos(v)
    if (horizontal) {
      if (spec.gridlines) items.push(makeLine('line', p, y1, p, y0, pen(GRID, 1)))
      items.push(label(fmtNum(v), p, y0 + 15, 10.5, { align: 'center' }))
    } else {
      if (spec.gridlines) items.push(makeLine('line', x0, p, x1, p, pen(GRID, 1)))
      items.push(label(fmtNum(v), x0 - 7, p + 4, 10.5, { align: 'right' }))
    }
  }

  // X positions: categories in bands, or numbers along the axis.
  let xPos: (i: number) => number
  let band = 0
  if (xy) {
    const X = axisRange(Math.min(...data.xs), Math.max(...data.xs), NaN, NaN)
    const xs = (v: number) => x0 + ((v - X.lo) / (X.hi - X.lo)) * (x1 - x0)
    for (let v = X.lo, i = 0; v <= X.hi + X.step * 1e-6 && i < 60; v += X.step, i++) {
      if (spec.gridlines) items.push(makeLine('line', xs(v), y1, xs(v), y0, pen(GRID, 1)))
      items.push(label(fmtNum(v), xs(v), y0 + 15, 10.5, { align: 'center' }))
    }
    xPos = i => xs(data.xs[i])
  } else {
    band = ((horizontal ? y0 - y1 : x1 - x0)) / nCat
    xPos = i => (horizontal ? y1 : x0) + band * (i + 0.5)
    const every = horizontal ? 1 : Math.max(1, Math.ceil(nCat / Math.max(1, Math.floor((x1 - x0) / 60))))
    data.categories.forEach((c, i) => {
      if (i % every) return
      const t = c.length > 22 ? c.slice(0, 21) + '…' : c
      items.push(horizontal ? label(t, x0 - 7, xPos(i) + 4, 11, { align: 'right' }) : label(t, xPos(i), y0 + 15, 11, { align: 'center' }))
    })
  }

  // Axes (the value axis through zero when it is in range).
  const zero = vPos(V.lo <= 0 && V.hi >= 0 ? 0 : V.lo)
  if (horizontal) { items.push(makeLine('line', zero, y1, zero, y0, pen(AXIS, 1))); items.push(makeLine('line', x0, y0, x1, y0, pen(AXIS, 1))) }
  else { items.push(makeLine('line', x0, zero, x1, zero, pen(AXIS, 1))); items.push(makeLine('line', x0, y1, x0, y0, pen(AXIS, 1))) }

  // Axis titles.
  const xt = (horizontal ? spec.yTitle : spec.xTitle).trim(), yt = (horizontal ? spec.xTitle : spec.yTitle).trim()
  if (xt) items.push(label(xt, (x0 + x1) / 2, y0 + 36, 12, { align: 'center', bold: true }))
  if (yt) items.push(label(yt, 16, (y0 + y1) / 2, 12, { rotate: true, bold: true }))

  const dataLabel = (v: number, x: number, y: number) => items.push(label(fmtNum(v), x, y, 10, { align: 'center', color: '#ff262626' }))

  if (barLike) {
    const nSer = stacked ? 1 : Math.max(1, data.values.length)
    const inner = band * 0.72, w = inner / nSer
    const posAcc = new Array(nCat).fill(0), negAcc = new Array(nCat).fill(0)
    data.values.forEach((s, k) => s.forEach((v, i) => {
      if (!Number.isFinite(v)) return
      const start = (horizontal ? y1 : x0) + band * i + (band - inner) / 2 + (stacked ? 0 : w * k)
      let a: number, b: number
      if (stacked) { const base = v >= 0 ? posAcc[i] : negAcc[i]; a = vPos(base); b = vPos(base + v); if (v >= 0) posAcc[i] += v; else negAcc[i] += v }
      else { a = vPos(Math.max(V.lo, Math.min(0, V.hi))); b = vPos(v) }
      const r = horizontal
        ? { x: Math.min(a, b), y: start + w * 0.04, w: Math.abs(b - a), h: w * 0.92 }
        : { x: start + w * 0.04, y: Math.min(a, b), w: w * 0.92, h: Math.abs(b - a) }
      items.push(makeBox('rect', r, NOPEN, fill(colors[k])))
      if (spec.dataLabels) {
        if (stacked) dataLabel(v, horizontal ? r.x + r.w / 2 : r.x + r.w / 2, horizontal ? r.y + r.h / 2 + 4 : r.y + r.h / 2 + 4)
        else if (horizontal) items.push(label(fmtNum(v), Math.max(a, b) + 4, r.y + r.h / 2 + 4, 10))
        else dataLabel(v, r.x + r.w / 2, Math.min(a, b) - 5)
      }
    }))
  } else {
    // Area fills first (behind), then lines and markers.
    data.values.forEach((s, k) => {
      const st = styles[k]
      const pts: [number, number][] = []
      s.forEach((v, i) => { if (Number.isFinite(v)) pts.push([xPos(i), vPos(v)]) })
      if (xy) pts.sort((a, b) => a[0] - b[0])
      if (!pts.length) return
      if (kind === 'area') {
        const base = vPos(Math.max(V.lo, Math.min(0, V.hi)))
        items.push(makePolygon('polygon', [[pts[0][0], base], ...pts, [pts[pts.length - 1][0], base]], NOPEN, fill(st.color, '66')))
      }
      if (kind !== 'scatter') items.push(makePath(linePath(pts, st.smooth), pen(argb(st.color), st.width, st.dash), null))
      const mk = kind === 'scatter' && st.marker === 'none' ? 'circle' : st.marker
      for (const [x, y] of pts) { const m = markerItem(mk, x, y, st.color, kind === 'scatter' ? 8 : 7); if (m) items.push(m) }
      if (spec.dataLabels) s.forEach((v, i) => { if (Number.isFinite(v)) dataLabel(v, xPos(i), vPos(v) - 8) })
    })
  }

  items.push(...legendItems(data.names, colors, lineLike || kind === 'area' ? styles : null, spec.legend, { x0, x1, y0: y1, y1: y0 }))
  sc.items = items
  return sc
}
