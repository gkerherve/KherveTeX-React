// The optional Chemical Engineering and Earth Science tabs' elements. Like
// the office ones (office.ts) they are ordinary kTeX elements, a table or a
// drawing, but where CTAN has a package made for the job the PDF uses it:
//   - process flow diagram: chemplants (the standard unit symbols);
//   - McCabe-Thiele and ternary diagrams: pgfplots (its ternary library);
//   - stratigraphic column: TikZ's patterns, the usual lithology fills.
// The editor shows a drawing (draw.ts shapes, as SVG) that follows the PDF.
// Pure: no DOM.
import { drawingTikz, texText, type Drawing, type Shape } from './draw.ts'
import type { TableRow, TableSpec } from './office.ts'

export const FIELD_KINDS = ['pfd', 'streamtable', 'massbalance', 'mccabe', 'ternary', 'rose', 'stratcol'] as const
export type FieldKind = typeof FIELD_KINDS[number]

export const FIELD_NAMES: Record<FieldKind, string> = {
  pfd: 'Process Flow Diagram', streamtable: 'Stream Table', massbalance: 'Mass Balance', mccabe: 'McCabe–Thiele',
  ternary: 'Ternary Diagram', rose: 'Rose Diagram', stratcol: 'Stratigraphic Column',
}

export interface PfdData { units: string[][]; streams: string[][]; color: string }             // [tag, type, x, y, label] · [from, to, kind, label]
export interface StreamTableData { title: string; streams: string; rows: string[][]; color: string } // [property, unit, v1..v6]
export interface MassBalanceData { title: string; unit: string; ins: string; outs: string; rows: string[][]; color: string } // [component, in1..in3, out1..out3]
export interface McCabeData { alpha: number; xF: number; xD: number; xB: number; q: number; R: number; color: string }
export interface TernaryData { a: string; b: string; c: string; rows: string[][]; color: string } // [label, a, b, c]
export interface RoseData { values: string; bin: number; bidirectional: boolean; color: string }
export interface StratColData { title: string; rows: string[][]; color: string }               // [unit, thickness m, lithology, age]

export interface FieldData {
  pfd: PfdData; streamtable: StreamTableData; massbalance: MassBalanceData; mccabe: McCabeData
  ternary: TernaryData; rose: RoseData; stratcol: StratColData
}

export const FIELD_DEFAULTS: FieldData = {
  pfd: {
    color: '1F6FB5',
    units: [['F-1', 'tank', '0', '1', 'Feed tank'], ['P-1', 'centrifugal pump', '3', '0', 'Feed pump'], ['E-1', 'heat exchanger', '6', '0', 'Preheater'],
      ['R-1', 'stirred reactor', '9.5', '1', 'Reactor'], ['C-1', 'condenser', '13', '3', 'Condenser'], ['T-2', 'drum', '13', '-1', 'Product drum']],
    streams: [['F-1', 'P-1', 'main', '1'], ['P-1', 'E-1', 'main', '2'], ['E-1', 'R-1', 'main', '3'], ['R-1', 'C-1', 'main', '4'], ['R-1', 'T-2', 'main', '5']],
  },
  streamtable: {
    title: 'Stream table', streams: '1, 2, 3, 4, 5', color: '1F6FB5', rows: [
      ['Temperature', '°C', '25', '25', '80', '120', '40'], ['Pressure', 'bar', '1.0', '4.0', '3.8', '3.5', '1.2'],
      ['Mass flow', 'kg/h', '1200', '1200', '1200', '310', '890'], ['Water', 'wt%', '62', '62', '62', '95', '50'], ['Ethanol', 'wt%', '38', '38', '38', '5', '50']],
  },
  massbalance: {
    title: 'Mass balance', unit: 'kg/h', ins: 'Feed, Steam', outs: 'Product, Bottoms', color: '1F6FB5', rows: [
      ['Ethanol', '456', '', '', '410', '44', ''], ['Water', '744', '150', '', '35', '857', ''], ['Acetic acid', '12', '', '', '', '12', '']],
  },
  mccabe: { alpha: 2.5, xF: 0.45, xD: 0.95, xB: 0.05, q: 1, R: 1.8, color: '1F6FB5' },
  ternary: { a: 'Q (quartz)', b: 'A (alkali feldspar)', c: 'P (plagioclase)', color: 'C62828', rows: [
    ['Granite', '35', '40', '25'], ['Granodiorite', '30', '15', '55'], ['Tonalite', '28', '5', '67'], ['Syenite', '3', '75', '22']] },
  rose: { values: '12, 15, 18, 22, 25, 28, 31, 35, 40, 44, 48, 52, 55, 61, 64, 95, 102, 110, 118, 124, 131, 140, 152, 165, 172, 178, 195, 205, 212, 223, 228, 236, 248, 255, 300, 315, 330', bin: 15, bidirectional: false, color: '1F6FB5' },
  stratcol: { title: 'Stratigraphic column', color: '333333', rows: [
    ['Glacial till', '4', 'conglomerate', 'Quaternary'], ['Upper sandstone', '12', 'sandstone', 'Jurassic'], ['Black shale', '8', 'shale', 'Jurassic'],
    ['Coal seam', '1.5', 'coal', 'Jurassic'], ['Oolitic limestone', '15', 'limestone', 'Triassic'], ['Red siltstone', '9', 'siltstone', 'Triassic'], ['Basement', '6', 'granite', 'Precambrian']] },
}

// ------------------------------------------------------------- helpers

const hex = (c: string) => (/^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '') : '1F6FB5').toUpperCase()
const INK = '333333', GREY = '888888', LIGHT = 'D0D0D0', GOOD = '2E7D32', BAD = 'C62828'
const num = (s: unknown): number => { const v = parseFloat(String(s ?? '').replace(/,/g, '').trim()); return Number.isFinite(v) ? v : NaN }
const fx = (n: number) => String(Math.round(n * 1000) / 1000)
const text = (x: number, y: number, s: string, o: Partial<Extract<Shape, { t: 'text' }>> = {}): Shape => ({ t: 'text', x, y, s, size: 8.5, color: INK, ...o })
const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
const fmt = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100)) : '')

// ------------------------------------------- Chemical Engineering: PFD

// chemplants' units offered (each a TikZ pic of that name).
export const PFD_TYPES = ['tank', 'drum', 'spherical tank', 'silos', 'centrifugal pump', 'reciprocating pump', 'compressor', 'fan', 'turbine',
  'lamination valve', 'heat exchanger', 'plate heat exchanger', 'condenser', 'boiler', 'kettle boiler', 'air heat exchanger', 'pipe furnace',
  'stirred reactor', 'packed bed reactor', 'fluidized bed reactor', 'tube bundle reactor', 'scrubber', 'cyclone', 'settler', 'filter press',
  'bag filter', 'rotary filter', 'stirred crystallizer', 'mill', 'extruder', 'hopper', 'conveyor belt']

const ROUND = /pump|compressor|fan|turbine|heat exchanger|condenser|boiler/
const VESSEL = /tank|drum|reactor|scrubber|settler|crystallizer|silos|hopper/

function pfdUnits(d: PfdData) {
  return d.units.map(r => ({ tag: (r[0] ?? '').trim(), type: PFD_TYPES.includes((r[1] ?? '').trim()) ? r[1].trim() : 'tank', x: num(r[2]), y: num(r[3]), label: r[4] ?? '' }))
    .filter(u => u.tag && Number.isFinite(u.x) && Number.isFinite(u.y))
}
function pfdBox(d: PfdData) {
  const us = pfdUnits(d)
  const xs = us.map(u => u.x), ys = us.map(u => u.y)
  return { us, x0: Math.min(0, ...xs) - 1, y0: Math.min(0, ...ys) - 1.9, x1: Math.max(1, ...xs) + 1, y1: Math.max(1, ...ys) + 1.2 }
}
// Each unit's half width and half height (cm) as drawn: chemplants' pics at
// PFD_SCALE, and the editor's shapes the same size.
const PFD_SCALE = 0.6
function unitSize(type: string): [number, number] {
  if (/reactor|scrubber|silos/.test(type)) return [0.6, 0.95]
  if (type === 'drum') return [0.45, 0.25]
  if (VESSEL.test(type)) return [0.6, 0.9]
  if (/heat|condenser|boiler/.test(type)) return [0.55, 0.55]
  if (ROUND.test(type)) return [0.4, 0.4]
  if (type === 'lamination valve') return [0.3, 0.2]
  if (type === 'cyclone') return [0.45, 0.7]
  return [0.6, 0.45]
}
// A stream's path: across then up/down, from the edge of one unit to the
// edge of the other.
function streamPts(a: { x: number; y: number; type: string }, b: { x: number; y: number; type: string }): [number, number][] {
  const [aw, ah] = unitSize(a.type), [bw, bh] = unitSize(b.type), g = 0.08
  const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y)
  if (Math.abs(a.y - b.y) < 0.01) return [[a.x + sx * (aw + g), a.y], [b.x - sx * (bw + g), b.y]]
  if (Math.abs(a.x - b.x) < 0.01) return [[a.x, a.y + sy * (ah + g)], [b.x, b.y - sy * (bh + g)]]
  // Up to a unit above (overhead vapour): out of the top, then across.
  if (sy > 0) return [[a.x, a.y + ah + g], [a.x, b.y], [b.x - sx * (bw + g), b.y]]
  return [[a.x + sx * (aw + g), a.y], [b.x, a.y], [b.x, b.y - sy * (bh + g)]]
}
const STREAM_LW: Record<string, number> = { main: 1.2, secondary: 0.8, utility: 0.6 }

function pfdDrawing(d: PfdData): Drawing {
  const C = hex(d.color)
  const { us, x0, y0, x1, y1 } = pfdBox(d)
  const at = (x: number, y: number): [number, number] => [x - x0, y - y0]
  const s: Shape[] = []
  const byTag = new Map(us.map(u => [u.tag, u]))
  for (const r of d.streams) {
    const a = byTag.get((r[0] ?? '').trim()), b = byTag.get((r[1] ?? '').trim())
    if (!a || !b) continue
    const kind = (r[2] ?? 'main').trim()
    const pts = streamPts(a, b).map(([x, y]) => at(x, y))
    s.push({ t: 'line', pts, stroke: kind === 'utility' ? GREY : INK, lw: STREAM_LW[kind] ?? 1, dash: kind === 'utility', arrow: true })
    if (r[3]) {
      const [mx, my] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
      s.push({ t: 'rect', x: mx - 0.22, y: my + 0.08, w: 0.44, h: 0.36, fill: 'FFFFFF', stroke: INK, lw: 0.4 }, text(mx, my + 0.26, r[3], { size: 7 }))
    }
  }
  for (const u of us) {
    const [x, y] = at(u.x, u.y)
    if (ROUND.test(u.type)) {
      s.push({ t: 'circle', x, y, r: 0.4, fill: 'FFFFFF', stroke: INK, lw: 0.8 })
      if (/heat|condenser|boiler/.test(u.type)) s.push({ t: 'line', pts: [[x - 0.4, y - 0.08], [x - 0.16, y - 0.08], [x - 0.04, y + 0.2], [x + 0.08, y - 0.2], [x + 0.2, y + 0.08], [x + 0.4, y + 0.08]], stroke: INK, lw: 0.6 })
      else s.push({ t: 'poly', pts: [[x - 0.16, y + 0.24], [x + 0.28, y], [x - 0.16, y - 0.24]], fill: 'FFFFFF', stroke: INK, lw: 0.6 })
    } else if (VESSEL.test(u.type)) {
      const [hw, hh] = unitSize(u.type), w = hw * 2, h = hh * 2
      s.push({ t: 'rect', x: x - w / 2, y: y - h / 2, w, h, fill: 'FFFFFF', stroke: INK, lw: 0.8, r: 0.25 })
      if (/stirred/.test(u.type)) s.push({ t: 'line', pts: [[x, y + h / 2], [x, y - h / 4]], stroke: INK, lw: 0.6 }, { t: 'line', pts: [[x - 0.25, y - h / 4], [x + 0.25, y - h / 4]], stroke: INK, lw: 1 })
    } else if (u.type === 'lamination valve') {
      s.push({ t: 'poly', pts: [[x - 0.35, y + 0.2], [x + 0.35, y - 0.2], [x + 0.35, y + 0.2], [x - 0.35, y - 0.2]], fill: 'FFFFFF', stroke: INK, lw: 0.8 })
    } else if (u.type === 'cyclone') {
      s.push({ t: 'poly', pts: [[x - 0.45, y + 0.7], [x + 0.45, y + 0.7], [x + 0.45, y + 0.2], [x + 0.08, y - 0.7], [x - 0.08, y - 0.7], [x - 0.45, y + 0.2]], fill: 'FFFFFF', stroke: INK, lw: 0.8 })
    } else {
      s.push({ t: 'rect', x: x - 0.65, y: y - 0.45, w: 1.3, h: 0.9, fill: 'FFFFFF', stroke: INK, lw: 0.8 })
    }
    const lh = unitSize(u.type)[1]
    s.push(text(x, y - lh - 0.3, u.tag, { bold: true, color: C, size: 8 }), text(x, y - lh - 0.7, u.label, { size: 7.5 }))
  }
  return { w: x1 - x0, h: y1 - y0, shapes: s }
}

function pfdLatex(d: PfdData): string {
  const C = hex(d.color)
  const { us, x0, y0, x1, y1 } = pfdBox(d)
  const byTag = new Map(us.map(u => [u.tag, u]))
  const body: string[] = [`\\useasboundingbox (${fx(x0)},${fx(y0)}) rectangle (${fx(x1)},${fx(y1)});`]
  for (const u of us) {
    const lh = unitSize(u.type)[1]
    body.push(`\\pic[scale=${PFD_SCALE},transform shape] at (${fx(u.x)},${fx(u.y)}) {${u.type}};`,
      `\\node[font=\\footnotesize\\bfseries,text=kP] at (${fx(u.x)},${fx(u.y - lh - 0.3)}) {${texText(u.tag)}};`,
      `\\node[font=\\scriptsize] at (${fx(u.x)},${fx(u.y - lh - 0.7)}) {${texText(u.label)}};`)
  }
  for (const r of d.streams) {
    const a = byTag.get((r[0] ?? '').trim()), b = byTag.get((r[1] ?? '').trim())
    if (!a || !b) continue
    const kind = (r[2] ?? 'main').trim()
    const style = kind === 'utility' ? 'utility stream' : kind === 'secondary' ? 'secondary stream' : 'main stream'
    const pts = streamPts(a, b)
    body.push(`\\draw[${style}] ${pts.map(([x, y]) => `(${fx(x)},${fx(y)})`).join(' -- ')};`)
    if (r[3]) {
      const [mx, my] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
      body.push(`\\node[draw,fill=white,font=\\scriptsize,inner sep=1.5pt,minimum width=4mm] at (${fx(mx)},${fx(my + 0.26)}) {${texText(r[3])}};`)
    }
  }
  const pic = `\\begin{tikzpicture}[x=1cm,y=1cm]\n${body.join('\n')}\n\\end{tikzpicture}`
  return `\\par\\medskip\\noindent\\begin{center}{\\definecolor{kP}{HTML}{${C}}\\sbox0{${pic}}\\ifdim\\wd0>\\linewidth\\resizebox{\\linewidth}{!}{\\usebox0}\\else\\usebox0\\fi}\\end{center}`
}

// ----------------------------------- Chemical Engineering: the tables

function streamTable(d: StreamTableData): TableSpec {
  const ss = list(d.streams).slice(0, 6)
  return {
    title: d.title, color: d.color,
    cols: [{ align: 'l' }, { align: 'l' }, ...ss.map(() => ({ align: 'r' as const }))],
    header: ['Stream', 'Unit', ...ss],
    rows: d.rows.filter(r => r.some(c => (c ?? '').trim())).map(r => ({ cells: [r[0] ?? '', r[1] ?? '', ...ss.map((_, i) => r[2 + i] ?? '')] })),
  }
}

export function massBalance(d: MassBalanceData) {
  const ins = list(d.ins).slice(0, 3), outs = list(d.outs).slice(0, 3)
  const v = (s: string) => { const n = num(s); return Number.isFinite(n) ? n : 0 }
  const rows = d.rows.filter(r => (r[0] ?? '').trim()).map(r => {
    const i = ins.map((_, k) => v(r[1 + k])), o = outs.map((_, k) => v(r[4 + k]))
    const tin = i.reduce((a, b) => a + b, 0), tout = o.reduce((a, b) => a + b, 0)
    return { name: r[0], i, o, tin, tout }
  })
  return { ins, outs, rows }
}

function massBalanceTable(d: MassBalanceData): TableSpec {
  const { ins, outs, rows } = massBalance(d)
  const closure = (tin: number, tout: number) => (tin > 0 ? tout / tin * 100 : NaN)
  const col = (c: number) => (!Number.isFinite(c) ? undefined : Math.abs(c - 100) <= 2 ? GOOD : BAD)
  const line = (name: string, i: number[], o: number[], tin: number, tout: number, style?: TableRow['style']): TableRow => {
    const c = closure(tin, tout)
    const cells = [name, ...i.map(fmt), fmt(tin), ...o.map(fmt), fmt(tout), Number.isFinite(c) ? `${c.toFixed(1)}%` : '']
    const colors: (string | undefined)[] = cells.map(() => undefined)
    colors[cells.length - 1] = col(c)
    return { cells, style, colors }
  }
  const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0)
  const T: TableRow[] = rows.map(r => line(r.name, r.i, r.o, r.tin, r.tout))
  T.push(line('Total', ins.map((_, k) => sum(r => r.i[k])), outs.map((_, k) => sum(r => r.o[k])), sum(r => r.tin), sum(r => r.tout), 'total'))
  return {
    title: d.title, color: d.color, note: `Flows in ${d.unit}. Closure = out / in: green within 2%, red outside it.`,
    cols: [{ align: 'l' }, ...ins.map(() => ({ align: 'r' as const })), { align: 'r' }, ...outs.map(() => ({ align: 'r' as const })), { align: 'r' }, { align: 'r' }],
    header: ['Component', ...ins.map(n => `In: ${n}`), 'Total in', ...outs.map(n => `Out: ${n}`), 'Total out', 'Closure'],
    rows: T,
  }
}

// ----------------------------------------- Chemical Engineering: McCabe-Thiele

export function mccabe(d: McCabeData) {
  const a = Math.max(1.01, d.alpha), xD = Math.min(0.999, Math.max(0.001, d.xD)), xB = Math.min(xD - 0.001, Math.max(0.001, d.xB))
  const xF = Math.min(xD - 0.001, Math.max(xB + 0.001, d.xF)), R = Math.max(0.01, d.R), q = d.q
  const eq = (x: number) => a * x / (1 + (a - 1) * x)
  const xOf = (y: number) => y / (a - (a - 1) * y)
  const rect = (x: number) => R / (R + 1) * x + xD / (R + 1)
  // Where the q-line meets the rectifying line.
  let xi: number
  if (Math.abs(q - 1) < 1e-6) xi = xF
  else { const m = q / (q - 1), c = -xF / (q - 1); xi = (c - xD / (R + 1)) / (R / (R + 1) - m) }
  xi = Math.min(xD, Math.max(xB, xi))
  const yi = rect(xi)
  const strip = (x: number) => xB + (yi - xB) / (xi - xB) * (x - xB)
  const steps: [number, number][] = [[xD, xD]]
  let x = xD, y = xD, n = 0, feed = 0
  while (n < 60) {
    const nx = xOf(y)
    steps.push([nx, y]); n++
    if (nx <= xB) break
    if (!feed && nx < xi) feed = n
    y = nx >= xi ? rect(nx) : strip(nx)
    steps.push([nx, y]); x = nx
  }
  void x
  return { a, xD, xB, xF, R, q, xi, yi, eq, steps, stages: n, feed: feed || n, pinch: n >= 60 }
}

function mccabeDrawing(d: McCabeData): Drawing {
  const C = hex(d.color), m = mccabe(d), S = 8, O = 1
  const P = (x: number, y: number): [number, number] => [O + x * S, O + y * S]
  const s: Shape[] = [{ t: 'rect', x: O, y: O, w: S, h: S, stroke: INK, lw: 0.6 }]
  for (let k = 1; k < 10; k++) s.push({ t: 'line', pts: [P(k / 10, 0), P(k / 10, 1)], stroke: 'EEEEEE', lw: 0.3 }, { t: 'line', pts: [P(0, k / 10), P(1, k / 10)], stroke: 'EEEEEE', lw: 0.3 })
  for (let k = 0; k <= 10; k += 2) s.push(text(O + k / 10 * S, O - 0.35, String(k / 10), { size: 7 }), text(O - 0.3, O + k / 10 * S, String(k / 10), { size: 7, anchor: 'east' }))
  s.push({ t: 'line', pts: [P(0, 0), P(1, 1)], stroke: GREY, lw: 0.5 })
  s.push({ t: 'line', pts: Array.from({ length: 51 }, (_, i) => P(i / 50, m.eq(i / 50))), stroke: C, lw: 1.2 })
  s.push({ t: 'line', pts: [P(m.xi, m.yi), P(m.xD, m.xD)], stroke: INK, lw: 0.7 }, { t: 'line', pts: [P(m.xB, m.xB), P(m.xi, m.yi)], stroke: INK, lw: 0.7 })
  s.push({ t: 'line', pts: [P(m.xF, m.xF), P(m.xi, m.yi)], stroke: GREY, lw: 0.6, dash: true })
  s.push({ t: 'line', pts: m.steps.map(([x, y]) => P(x, y)), stroke: BAD, lw: 0.6 })
  for (const [x, l] of [[m.xB, 'x_B'], [m.xF, 'x_F'], [m.xD, 'x_D']] as const) s.push({ t: 'circle', x: P(x, x)[0], y: P(x, x)[1], r: 0.07, fill: INK }, text(P(x, x)[0] + 0.15, P(x, x)[1] - 0.3, l.replace('_', ''), { size: 7, anchor: 'west', tex: `$${l}$` }))
  s.push(text(O + S / 2, O - 0.85, 'x (liquid, light component)', { size: 8 }), text(O - 0.85, O + S / 2, 'y (vapour)', { size: 8, rotate: 90 }))
  s.push(text(O + S / 2, O + S + 0.4, `${m.stages} theoretical stages, feed on stage ${m.feed}${m.pinch ? ' (pinch: R too low)' : ''}  ·  α = ${m.a}, R = ${m.R}, q = ${m.q}`, { size: 8, bold: true }))
  return { w: S + 1.6, h: S + 1.9, shapes: s }
}

function mccabeLatex(d: McCabeData): string {
  const C = hex(d.color), m = mccabe(d)
  const co = (pts: [number, number][]) => pts.map(([x, y]) => `(${fx(x)},${fx(y)})`).join(' ')
  return [`\\par\\medskip\\noindent\\begin{center}{\\definecolor{kM}{HTML}{${C}}`,
    '\\begin{tikzpicture}\\begin{axis}[width=8.5cm,height=8.5cm,xmin=0,xmax=1,ymin=0,ymax=1,grid=both,grid style={gray!15},',
    `xlabel={$x$ (liquid, light component)},ylabel={$y$ (vapour)},title={\\small\\bfseries ${m.stages} theoretical stages, feed on stage ${m.feed}${m.pinch ? ' (pinch)' : ''}},`,
    'tick label style={font=\\scriptsize},label style={font=\\small}]',
    '\\addplot[gray,thin,domain=0:1] {x};',
    `\\addplot[kM,thick,domain=0:1,samples=80] {${fx(m.a)}*x/(1+${fx(m.a - 1)}*x)};`,
    `\\addplot[black] coordinates {${co([[m.xi, m.yi], [m.xD, m.xD]])}};`,
    `\\addplot[black] coordinates {${co([[m.xB, m.xB], [m.xi, m.yi]])}};`,
    `\\addplot[gray,dashed] coordinates {${co([[m.xF, m.xF], [m.xi, m.yi]])}};`,
    `\\addplot[red!75!black] coordinates {${co(m.steps)}};`,
    `\\addplot[only marks,mark size=1.5pt] coordinates {${co([[m.xB, m.xB], [m.xF, m.xF], [m.xD, m.xD]])}};`,
    `\\node[anchor=north west,font=\\scriptsize] at (axis cs:${fx(m.xB)},${fx(m.xB)}) {$x_B$};`,
    `\\node[anchor=north west,font=\\scriptsize] at (axis cs:${fx(m.xF)},${fx(m.xF)}) {$x_F$};`,
    `\\node[anchor=north west,font=\\scriptsize] at (axis cs:${fx(m.xD)},${fx(m.xD)}) {$x_D$};`,
    `\\node[anchor=south east,font=\\scriptsize,fill=white] at (axis cs:1,0) {$\\alpha=${fx(m.a)}$, $R=${fx(m.R)}$, $q=${fx(m.q)}$};`,
    '\\end{axis}\\end{tikzpicture}}\\end{center}'].join('\n')
}

// ---------------------------------------------- Earth Science: ternary

function ternaryPoints(d: TernaryData) {
  return d.rows.map(r => {
    const a = num(r[1]), b = num(r[2]), c = num(r[3]), t = a + b + c
    return { label: r[0] ?? '', a: a / t, b: b / t, c: c / t }
  }).filter(p => Number.isFinite(p.a) && Number.isFinite(p.b) && Number.isFinite(p.c))
}

// The first component at the top, the second bottom left, the third bottom
// right (as QAPF is drawn), as pgfplots' ternary axis has them: x = 100 at
// the top, y = 100 bottom left, z = 100 bottom right.
function ternaryDrawing(d: TernaryData): Drawing {
  const C = hex(d.color), S = 8, H = S * Math.sqrt(3) / 2, X = 1.5, Y = 1
  const P = (a: number, b: number, c: number): [number, number] => { const t = a + b + c; return [X + (a / t) * S / 2 + (c / t) * S, Y + (a / t) * H] }
  const s: Shape[] = []
  for (let k = 1; k < 10; k++) {
    const f = k / 10
    s.push({ t: 'line', pts: [P(f, 1 - f, 0), P(f, 0, 1 - f)], stroke: 'E4E4E4', lw: 0.3 }, { t: 'line', pts: [P(1 - f, f, 0), P(0, f, 1 - f)], stroke: 'E4E4E4', lw: 0.3 },
      { t: 'line', pts: [P(1 - f, 0, f), P(0, 1 - f, f)], stroke: 'E4E4E4', lw: 0.3 })
  }
  s.push({ t: 'line', pts: [P(1, 0, 0), P(0, 1, 0), P(0, 0, 1), P(1, 0, 0)], stroke: INK, lw: 0.8 })
  s.push(text(P(1, 0, 0)[0], P(1, 0, 0)[1] + 0.3, d.a, { anchor: 'south', size: 8.5, bold: true }), text(P(0, 1, 0)[0], P(0, 1, 0)[1] - 0.4, d.b, { anchor: 'north', size: 8.5, bold: true }),
    text(P(0, 0, 1)[0], P(0, 0, 1)[1] - 0.4, d.c, { anchor: 'north', size: 8.5, bold: true }))
  for (const p of ternaryPoints(d)) {
    const [x, y] = P(p.a, p.b, p.c)
    s.push({ t: 'circle', x, y, r: 0.09, fill: C }, text(x + 0.15, y + 0.12, p.label, { anchor: 'south west', size: 7.5 }))
  }
  return { w: S + 3, h: H + 2, shapes: s }
}

function ternaryLatex(d: TernaryData): string {
  const C = hex(d.color), pts = ternaryPoints(d)
  return [`\\par\\medskip\\noindent\\begin{center}{\\definecolor{kT}{HTML}{${C}}`,
    '\\begin{tikzpicture}\\begin{ternaryaxis}[width=9cm,height=9cm,xmin=0,xmax=100,ymin=0,ymax=100,zmin=0,zmax=100,',
    'clip=false,tick label style={font=\\tiny},major grid style={gray!25},grid=major]',
    `\\node[anchor=south,font=\\small\\bfseries] at (axis cs:100,0,0) [yshift=10pt] {${texText(d.a)}};`,
    `\\node[anchor=north east,font=\\small\\bfseries] at (axis cs:0,100,0) [yshift=-10pt] {${texText(d.b)}};`,
    `\\node[anchor=north west,font=\\small\\bfseries] at (axis cs:0,0,100) [yshift=-10pt] {${texText(d.c)}};`,
    pts.length ? `\\addplot3[only marks,mark=*,mark size=2pt,kT,nodes near coords,point meta=explicit symbolic,every node near coord/.style={font=\\scriptsize,text=black,anchor=south west}] coordinates {${pts.map(p => `(${fx(p.a * 100)},${fx(p.b * 100)},${fx(p.c * 100)}) [${texText(p.label)}]`).join(' ')}};` : '',
    '\\end{ternaryaxis}\\end{tikzpicture}}\\end{center}'].join('\n')
}

// ------------------------------------------------- Earth Science: rose

export function roseBins(d: RoseData) {
  const bin = [5, 10, 15, 20, 30, 45].includes(d.bin) ? d.bin : 15
  const vals = d.values.split(/[\s,;]+/).map(num).filter(Number.isFinite).map(v => ((v % 360) + 360) % 360)
  const all = d.bidirectional ? [...vals, ...vals.map(v => (v + 180) % 360)] : vals
  const counts = Array(Math.round(360 / bin)).fill(0)
  for (const v of all) counts[Math.floor(v / bin) % counts.length]++
  return { bin, counts, n: vals.length }
}

function roseDrawing(d: RoseData): Drawing {
  const C = hex(d.color), { bin, counts, n } = roseBins(d), R = 3.6, cx = 4.6, cy = 4.4
  const max = Math.max(1, ...counts)
  const s: Shape[] = []
  for (let k = 1; k <= 4; k++) s.push({ t: 'circle', x: cx, y: cy, r: R * k / 4, stroke: LIGHT, lw: 0.4 })
  for (let a = 0; a < 360; a += 30) { const t = (90 - a) * Math.PI / 180; s.push({ t: 'line', pts: [[cx, cy], [cx + R * Math.cos(t), cy + R * Math.sin(t)]], stroke: 'E6E6E6', lw: 0.3 }) }
  counts.forEach((c, i) => {
    if (!c) return
    const r = R * Math.sqrt(c / max)    // equal-area: radius by the square root
    s.push({ t: 'wedge', x: cx, y: cy, r, a0: 90 - (i + 1) * bin, a1: 90 - i * bin, fill: C })
  })
  s.push({ t: 'circle', x: cx, y: cy, r: R, stroke: INK, lw: 0.7 })
  for (const [l, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
    const t = (90 - a) * Math.PI / 180
    s.push(text(cx + (R + 0.35) * Math.cos(t), cy + (R + 0.35) * Math.sin(t), l, { bold: true, size: 9 }))
  }
  s.push(text(cx, 0.1, `n = ${n} · ${bin}° classes · outer circle = ${max}${d.bidirectional ? ' · bidirectional' : ''}`, { size: 7.5, color: GREY, anchor: 'south' }))
  return { w: 9.2, h: 8.6, shapes: s }
}

// ----------------------------------- Earth Science: stratigraphic column

export const LITHOLOGIES: Record<string, { fill: string; pattern?: string; w: number }> = {
  sandstone: { fill: 'F3E2A0', pattern: 'dots', w: 2.3 },
  siltstone: { fill: 'DCCFA4', pattern: 'crosshatch dots', w: 2.0 },
  shale: { fill: 'B6BCC4', pattern: 'horizontal lines', w: 1.6 },
  mudstone: { fill: 'A9A99A', pattern: 'horizontal lines', w: 1.6 },
  limestone: { fill: 'AFCDE3', pattern: 'bricks', w: 2.5 },
  dolomite: { fill: 'C3D9E6', pattern: 'crosshatch', w: 2.5 },
  conglomerate: { fill: 'E9C59F', pattern: 'sixpointed stars', w: 2.7 },
  coal: { fill: '2B2B2B', w: 1.4 },
  evaporite: { fill: 'E6D8F2', pattern: 'grid', w: 2.1 },
  granite: { fill: 'E9AFAF', pattern: 'crosshatch', w: 2.8 },
  basalt: { fill: '777777', pattern: 'north east lines', w: 2.8 },
}

function stratLayers(d: StratColData) {
  const ls = d.rows.map(r => ({ name: r[0] ?? '', t: num(r[1]), lith: LITHOLOGIES[(r[2] ?? '').trim().toLowerCase()] ? (r[2] ?? '').trim().toLowerCase() : 'sandstone', age: r[3] ?? '' }))
    .filter(l => Number.isFinite(l.t) && l.t > 0)
  const total = ls.reduce((a, l) => a + l.t, 0) || 1
  const H = Math.min(12, Math.max(5, ls.length * 1.1)), k = H / total
  let y = H + 0.4
  return { H, total, layers: ls.map(l => { const h = l.t * k; y -= h; return { ...l, y, h } }) }
}

function stratDrawing(d: StratColData, forTikz = false): Drawing {
  const C = hex(d.color), { H, total, layers } = stratLayers(d), X = 3.4
  const s: Shape[] = []
  let lastAge = ''
  for (const l of layers) {
    const L = LITHOLOGIES[l.lith]
    s.push({ t: 'rect', x: X, y: l.y, w: L.w, h: l.h, fill: L.fill, stroke: INK, lw: 0.5 })
    s.push(text(X + 3.1, l.y + l.h / 2, `${l.name} (${fmt(l.t)} m)`, { anchor: 'west', size: 8 }))
    if (l.age && l.age !== lastAge) s.push(text(X - 0.4, l.y + l.h, l.age, { anchor: 'north east', size: 7.5, bold: true, color: C }))
    lastAge = l.age
  }
  // A thickness scale on the left.
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(st => total / st <= 6) ?? 1000
  s.push({ t: 'line', pts: [[X - 0.15, 0.4], [X - 0.15, H + 0.4]], stroke: GREY, lw: 0.4 })
  for (let m = 0; m <= total + 1e-9; m += step) {
    const y = 0.4 + m * (H / total)
    s.push({ t: 'line', pts: [[X - 0.25, y], [X - 0.15, y]], stroke: GREY, lw: 0.4 })
  }
  s.push(text(X - 0.15, 0.1, `0-${fmt(total)} m`, { size: 6.5, color: GREY, anchor: 'north' }))
  if (d.title) s.push(text(X + 1.4, H + 0.85, d.title, { bold: true, size: 9.5, color: C }))
  void forTikz
  return { w: 11.5, h: H + 1.2, shapes: s }
}

function stratLatex(d: StratColData): string {
  const dr = stratDrawing(d, true), { layers } = stratLayers(d), X = 3.4
  // The lithology patterns over the colour fills (TikZ patterns library).
  const pats = layers.map(l => { const L = LITHOLOGIES[l.lith]; return L.pattern ? `\\path[pattern=${L.pattern},pattern color=black!55] (${fx(X)},${fx(l.y)}) rectangle (${fx(X + L.w)},${fx(l.y + l.h)});` : '' }).filter(Boolean)
  const tikz = drawingTikz(dr).replace('\n\\end{tikzpicture}', `\n${pats.join('\n')}\n\\end{tikzpicture}`)
  return `\\par\\medskip\\noindent\\begin{center}\n${tikz}\n\\end{center}`
}

// ---------------------------------------------------------- dispatcher

export interface FieldOut { table?: TableSpec; drawing?: Drawing; latex?: string }

export function fieldRender(kind: FieldKind, data: unknown): FieldOut {
  const d = data as never
  switch (kind) {
    case 'pfd': return { drawing: pfdDrawing(d), latex: pfdLatex(d) }
    case 'streamtable': return { table: streamTable(d) }
    case 'massbalance': return { table: massBalanceTable(d) }
    case 'mccabe': return { drawing: mccabeDrawing(d), latex: mccabeLatex(d) }
    case 'ternary': return { drawing: ternaryDrawing(d), latex: ternaryLatex(d) }
    case 'rose': return { drawing: roseDrawing(d) }
    case 'stratcol': return { drawing: stratDrawing(d), latex: stratLatex(d) }
  }
}

export function fieldPackages(kinds: Set<string>): { pkgs: string[]; defs: string[] } {
  const pkgs: string[] = [], defs: string[] = []
  if (kinds.has('pfd')) pkgs.push('chemplants')
  if (kinds.has('mccabe') || kinds.has('ternary')) { pkgs.push('pgfplots'); defs.push('\\pgfplotsset{compat=1.18}') }
  if (kinds.has('ternary')) defs.push('\\usepgfplotslibrary{ternary}')
  if (kinds.has('stratcol')) { pkgs.push('tikz'); defs.push('\\usetikzlibrary{patterns}') }
  return { pkgs, defs }
}
