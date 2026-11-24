// The Science tab's drawn elements: data plot (spectra), circuit, Feynman
// diagram, MO diagram, Bohr model, element tiles, hazard pictograms,
// reaction scheme, algorithm and lab-notebook entry. Each is a raw block
// like Insert ▸ Elements (widgets.ts): settings + LaTeX; the drawn ones
// share one shape list with the editor (draw.ts). Pure: no DOM.
import { drawingTikz, fmtNum, niceMax, pad, type Drawing, type Shape } from './draw.ts'
import { element, FAMILY_COLORS, shells } from './elements.ts'

const hex = (c: string) => (/^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '') : '1F6FB5').toUpperCase()
const tex = (s: string) => s.replace(/[\\{}$&#^_%~]/g, c => c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\^{}' : c === '~' ? '\\~{}' : '\\' + c)
// Text with $...$ math kept as it is.
const texMath = (s: string) => s.split(/(\$[^$]*\$)/).map((p, i) => (i % 2 ? p : tex(p))).join('')
const INK = '333333', GREY = '999999'
const textW = (s: string, pt = 10) => s.length * 0.019 * pt

export interface PlotData { data: string; xlabel: string; ylabel: string; reverse_x: boolean; points: boolean; y_ticks: boolean; peaks: string; title: string; color: string }
export interface CircuitData { components: string; layout: 'series' | 'parallel'; color: string }
export interface FeynmanData { process: 'annihilation' | 'scattering' | 'compton' | 'beta'; labels: string[]; color: string }
export interface MoData { molecule: string; color: string }
export interface BohrData { element: string; color: string }
export interface ElementTileData { elements: string; show_mass: boolean }
export interface HazardData { pictograms: string[]; signal: 'Danger' | 'Warning' | ''; statements: string }
export interface SchemeData { steps: { name: string; chemfig: string }[]; arrows: { above: string; below: string }[] }
export interface AlgorithmData { title: string; code: string; numbers: boolean }
export interface NotebookData { date: string; title: string; aim: string; method: string; observations: string; result: string; color: string }

export const SCIENCE_DEFAULTS = {
  plot: {
    title: '', xlabel: 'Binding energy (eV)', ylabel: 'Intensity (a.u.)', reverse_x: true, points: false, y_ticks: false, color: '1F6FB5',
    peaks: '458.8: Ti 2p3/2\n464.5: Ti 2p1/2',
    data: 'BE, Ti 2p\n' + Array.from({ length: 61 }, (_, i) => {
      const x = 470 - i * 0.25
      const g = (c: number, w: number, a: number) => a * Math.exp(-((x - c) ** 2) / (2 * w * w))
      return `${x.toFixed(2)}, ${(120 + (x < 461 ? 0 : 60) + g(458.8, 0.6, 1000) + g(464.5, 0.9, 480)).toFixed(0)}`
    }).join('\n'),
  } as PlotData,
  circuit: { layout: 'series', color: '000000', components: 'battery 9 V\nswitch S\nresistor R1 = 100 Ω\nlamp L\nammeter' } as CircuitData,
  feynman: { process: 'annihilation', labels: ['e⁻', 'e⁺', 'μ⁻', 'μ⁺', 'γ'], color: '1F6FB5' } as FeynmanData,
  mo: { molecule: 'O2', color: '1F6FB5' } as MoData,
  bohr: { element: 'Na', color: '1F6FB5' } as BohrData,
  element: { elements: 'H, C, N, O, Fe, Ti', show_mass: true } as ElementTileData,
  hazard: { pictograms: ['flame', 'exclam'], signal: 'Danger', statements: 'H225\nH319\nP210\nP280' } as HazardData,
  scheme: {
    steps: [{ name: 'ethanol', chemfig: 'CH_3-CH_2-OH' }, { name: 'ethanal', chemfig: 'CH_3-C(=[1]O)-[7]H' }, { name: 'ethanoic acid', chemfig: 'CH_3-C(=[1]O)-[7]OH' }],
    arrows: [{ above: '[O]', below: 'K₂Cr₂O₇' }, { above: '[O]', below: 'reflux' }],
  } as SchemeData,
  algorithm: {
    title: 'Bisection method', numbers: true,
    code: 'function Bisect(f, a, b, tol)\n  while b - a > tol\n    m = (a + b) / 2\n    if f(a) * f(m) <= 0 then\n      b = m\n    else\n      a = m\n  return (a + b) / 2',
  } as AlgorithmData,
  notebook: {
    date: '24 Nov 2026', title: 'Sample 12: annealing in air', color: '37474F',
    aim: 'Find whether 2 h at 450 °C removes the carbon contamination.',
    method: 'Anneal in the tube furnace, 5 °C/min ramp, then XPS survey and C 1s region.',
    observations: 'C 1s fell from 18 at.% to 4 at.%; the Ti 2p shape did not change.',
    result: 'Annealing works; use it for samples 13-20.',
  } as NotebookData,
}

// ---------------------------------------------------------------- plot

export function parsePlotData(text: string): { names: string[]; xs: number[]; ys: number[][] } {
  const rows = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  let names: string[] = []
  const xs: number[] = []
  const ys: number[][] = []
  for (const r of rows) {
    const cells = r.split(/[,;\t ]+/).filter(c => c)
    const nums = cells.map(c => parseFloat(c.replace(/,/g, '.')))
    if (nums.some(n => !Number.isFinite(n))) { if (!xs.length) names = r.split(/[,;\t]+/).map(c => c.trim()).slice(1); continue }
    xs.push(nums[0])
    nums.slice(1).forEach((v, j) => { (ys[j] = ys[j] ?? []).push(v) })
  }
  return { names, xs, ys }
}

function niceRange(lo: number, hi: number): { a: number; b: number; step: number } {
  if (!(hi > lo)) { hi = lo + 1 }
  const span = hi - lo
  const { step } = niceMax(span, 5)
  return { a: Math.floor(lo / step) * step, b: Math.ceil(hi / step) * step, step }
}

const SERIES = ['1F6FB5', 'E65100', '2E7D32', '6A1B9A', 'C62828', '00838F']

export function plotDrawing(d: PlotData): Drawing {
  const W = 12, H = 7.2
  const { names, xs, ys } = parsePlotData(d.data)
  const shapes: Shape[] = []
  const L = d.y_ticks ? 1.5 : 0.8, B = 1.1, T = d.title.trim() ? 0.8 : 0.35, R = 0.3
  const pw = W - L - R, ph = H - B - T
  if (d.title.trim()) shapes.push({ t: 'text', x: W / 2, y: H - 0.35, s: d.title, size: 11, bold: true, color: INK })
  const xr = niceRange(Math.min(...xs), Math.max(...xs))
  const all = ys.flat()
  const yr = niceRange(Math.min(0, ...all), Math.max(...all) * 1.05)
  const X = (x: number) => L + (d.reverse_x ? (xr.b - x) : (x - xr.a)) / (xr.b - xr.a) * pw
  const Y = (y: number) => B + (y - yr.a) / (yr.b - yr.a) * ph
  shapes.push({ t: 'rect', x: L, y: B, w: pw, h: ph, stroke: GREY, lw: 0.6 })
  for (let v = xr.a; v <= xr.b + 1e-9; v += xr.step) {
    shapes.push({ t: 'line', pts: [[X(v), B], [X(v), B + 0.12]], stroke: GREY, lw: 0.6 })
    shapes.push({ t: 'text', x: X(v), y: B - 0.12, s: fmtNum(Math.round(v * 1000) / 1000), anchor: 'north', size: 8.5, color: INK })
  }
  if (d.y_ticks) for (let v = yr.a; v <= yr.b + 1e-9; v += yr.step) {
    shapes.push({ t: 'line', pts: [[L, Y(v)], [L + 0.12, Y(v)]], stroke: GREY, lw: 0.6 })
    shapes.push({ t: 'text', x: L - 0.12, y: Y(v), s: fmtNum(Math.round(v * 1000) / 1000), anchor: 'east', size: 8.5, color: INK })
  }
  shapes.push({ t: 'text', x: L + pw / 2, y: 0.25, s: d.xlabel, size: 10, color: INK })
  shapes.push({ t: 'text', x: L - (d.y_ticks ? 1.2 : 0.4), y: B + ph / 2, s: d.ylabel, size: 10, color: INK, rotate: 90 })
  const base = hex(d.color)
  const pal = [base, ...SERIES.filter(c => c !== base)]
  ys.forEach((col, j) => {
    const c = pal[j % pal.length]
    const pts = xs.map((x, i) => [X(x), Y(col[i] ?? 0)] as [number, number])
    if (d.points) for (const [x, y] of pts) shapes.push({ t: 'circle', x, y, r: 0.05, fill: c })
    else if (pts.length > 1) shapes.push({ t: 'line', pts, stroke: c, lw: 1.1 })
  })
  if (ys.length > 1) ys.forEach((_, j) => {
    const y = H - T - 0.35 - j * 0.42, x = L + pw - 2.6
    shapes.push({ t: 'line', pts: [[x, y], [x + 0.5, y]], stroke: pal[j % pal.length], lw: 1.4 })
    shapes.push({ t: 'text', x: x + 0.6, y, s: names[j] ?? `Series ${j + 1}`, anchor: 'west', size: 8.5, color: INK })
  })
  // Peak labels over the curve at their x.
  for (const line of d.peaks.split('\n')) {
    const m = /^\s*([-\d.]+)\s*[:|]\s*(.+)$/.exec(line)
    if (!m || !xs.length || !ys.length) continue
    const px = parseFloat(m[1])
    let k = 0
    xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[k] - px)) k = i })
    const py = Math.max(...ys.map(c => c[k] ?? 0))
    shapes.push({ t: 'line', pts: [[X(px), Y(py) + 0.1], [X(px), Y(py) + 0.45]], stroke: GREY, lw: 0.5 })
    shapes.push({ t: 'text', x: X(px), y: Y(py) + 0.5, s: m[2].trim(), anchor: 'south', size: 8.5, color: INK })
  }
  return { w: W, h: H, shapes }
}

// ------------------------------------------------------------- circuits

export const CIRCUIT_PARTS = ['battery', 'cell', 'resistor', 'lamp', 'switch', 'capacitor', 'inductor', 'diode', 'led', 'ammeter', 'voltmeter', 'motor', 'fuse', 'wire']

// One component, centred at (cx, cy), horizontal or vertical, 1.2 cm long.
function part(kind: string, label: string, cx: number, cy: number, vertical: boolean, C: string): Shape[] {
  const out: Shape[] = []
  const P = (x: number, y: number): [number, number] => vertical ? [cx - y, cy + x] : [cx + x, cy + y]
  const line = (pts: [number, number][], lw = 0.9) => out.push({ t: 'line', pts: pts.map(([x, y]) => P(x, y)), stroke: C, lw })
  const wire = (a: number) => { line([[-0.6, 0], [-a, 0]]); line([[a, 0], [0.6, 0]]) }
  const circle = (letter: string) => {
    wire(0.3)
    const [x, y] = P(0, 0)
    out.push({ t: 'circle', x, y, r: 0.3, stroke: C, lw: 0.9, fill: 'FFFFFF' })
    if (letter) out.push({ t: 'text', x, y, s: letter, size: 10, bold: true, color: C })
  }
  switch (kind) {
    case 'resistor': wire(0.4); line([[-0.4, -0.13], [0.4, -0.13], [0.4, 0.13], [-0.4, 0.13], [-0.4, -0.13]]); break
    case 'fuse': wire(0.4); line([[-0.4, -0.1], [0.4, -0.1], [0.4, 0.1], [-0.4, 0.1], [-0.4, -0.1]]); line([[-0.4, 0], [0.4, 0]], 0.6); break
    case 'cell': wire(0.06); line([[-0.06, -0.3], [-0.06, 0.3]]); line([[0.06, -0.15], [0.06, 0.15]], 2); break
    case 'battery': wire(0.2); line([[-0.2, -0.3], [-0.2, 0.3]]); line([[-0.08, -0.15], [-0.08, 0.15]], 2); line([[0.08, -0.3], [0.08, 0.3]]); line([[0.2, -0.15], [0.2, 0.15]], 2); break
    case 'capacitor': wire(0.07); line([[-0.07, -0.28], [-0.07, 0.28]], 1.4); line([[0.07, -0.28], [0.07, 0.28]], 1.4); break
    case 'inductor': {
      wire(0.4)
      const pts: [number, number][] = []
      for (let k = 0; k < 4; k++) for (let a = 0; a <= 12; a++) { const t = Math.PI * a / 12; pts.push([-0.4 + 0.2 * k + 0.1 - 0.1 * Math.cos(t), 0.12 * Math.sin(t)]) }
      line(pts)
      break
    }
    case 'switch': wire(0.3); line([[-0.3, 0], [0.25, 0.25]]); { const [x, y] = P(-0.3, 0); out.push({ t: 'circle', x, y, r: 0.04, fill: C }) } { const [x, y] = P(0.3, 0); out.push({ t: 'circle', x, y, r: 0.04, fill: C }) } break
    case 'diode': case 'led':
      wire(0.2)
      out.push({ t: 'poly', pts: [P(-0.2, -0.2), P(-0.2, 0.2), P(0.18, 0)], fill: C })
      line([[0.2, -0.2], [0.2, 0.2]], 1.2)
      if (kind === 'led') { line([[0.0, 0.25], [0.2, 0.45]], 0.7); line([[0.12, 0.2], [0.32, 0.4]], 0.7) }
      break
    case 'lamp': {
      circle('')
      const r = 0.21
      line([[-r, -r], [r, r]]); line([[-r, r], [r, -r]])
      break
    }
    case 'ammeter': circle('A'); break
    case 'voltmeter': circle('V'); break
    case 'motor': circle('M'); break
    default: line([[-0.6, 0], [0.6, 0]])
  }
  if (label) {
    const [x, y] = P(0, 0.5)
    out.push({ t: 'text', x: vertical ? x - 0.05 : x, y, s: label, anchor: vertical ? 'east' : 'south', size: 9, color: INK })
  }
  return out
}

export function parseCircuit(text: string): { kind: string; label: string }[] {
  return text.split('\n').map(l => l.trim()).filter(l => l).map(l => {
    const [k, ...rest] = l.split(/\s+/)
    const kind = CIRCUIT_PARTS.includes(k.toLowerCase()) ? k.toLowerCase() : 'resistor'
    return { kind, label: (CIRCUIT_PARTS.includes(k.toLowerCase()) ? rest.join(' ') : l) }
  })
}

export function circuitDrawing(d: CircuitData): Drawing {
  const C = hex(d.color)
  const parts = parseCircuit(d.components)
  const shapes: Shape[] = []
  const wire = (pts: [number, number][]) => shapes.push({ t: 'line', pts, stroke: C, lw: 0.9 })
  if (d.layout === 'parallel' && parts.length > 1) {
    // The first part on the left; the others side by side between two rails.
    const n = parts.length - 1, gap = 2.2, W = 1.5 + n * gap + 0.5, H = 3.2
    wire([[0.8, 0.4], [W - 0.6, 0.4]]); wire([[0.8, H - 0.4], [W - 0.6, H - 0.4]])
    wire([[0.8, 0.4], [0.8, H / 2 - 0.6]]); wire([[0.8, H / 2 + 0.6], [0.8, H - 0.4]])
    shapes.push(...part(parts[0].kind, parts[0].label, 0.8, H / 2, true, C))
    parts.slice(1).forEach((p, i) => {
      const x = 0.8 + (i + 1) * gap
      wire([[x, 0.4], [x, H / 2 - 0.6]]); wire([[x, H / 2 + 0.6], [x, H - 0.4]])
      shapes.push(...part(p.kind, p.label, x, H / 2, true, C))
      shapes.push({ t: 'circle', x, y: 0.4, r: 0.05, fill: C }, { t: 'circle', x, y: H - 0.4, r: 0.05, fill: C })
    })
    return pad({ w: W, h: H + 0.3, shapes }, 1.4, 0.2)
  }
  // Series: the parts spread around a rectangle, clockwise from the left.
  const n = Math.max(1, parts.length)
  const top = Math.ceil(n / 2), side = n - top
  const W = Math.max(5, top * 1.9 + 1), H = side ? 3.6 : 3
  const x0 = 0.9, x1 = W - 0.3, y0 = 0.3, y1 = H - 0.3
  // Left side: the first part (the source); the top: the next ones; then the right, then the bottom.
  const slots: { cx: number; cy: number; v: boolean }[] = []
  slots.push({ cx: x0, cy: (y0 + y1) / 2, v: true })
  const topN = Math.max(0, Math.ceil((n - 1) * 0.6)), botN = n - 1 - topN
  for (let i = 0; i < topN; i++) slots.push({ cx: x0 + (i + 1) * (x1 - x0) / (topN + 1), cy: y1, v: false })
  for (let i = 0; i < botN; i++) slots.push({ cx: x1 - (i + 1) * (x1 - x0) / (botN + 1), cy: y0, v: false })
  void side
  const corners: [number, number][] = [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]
  // Wires along the sides, broken where a part sits.
  const segs: [number, number, number, number][] = [[x0, y0, x0, y1], [x0, y1, x1, y1], [x1, y1, x1, y0], [x1, y0, x0, y0]]
  for (const [ax, ay, bx, by] of segs) {
    const vert = ax === bx
    const here = slots.filter(s => (vert ? s.v && Math.abs(s.cx - ax) < 1e-6 : !s.v && Math.abs(s.cy - ay) < 1e-6))
    const along = (s: { cx: number; cy: number }) => (vert ? s.cy : s.cx)
    const a = vert ? ay : ax, b = vert ? by : bx
    const cuts = here.map(along).sort((p, q) => (a < b ? p - q : q - p))
    let start = a
    for (const c of cuts) {
      const e = a < b ? c - 0.6 : c + 0.6
      wire(vert ? [[ax, start], [ax, e]] : [[start, ay], [e, ay]])
      start = a < b ? c + 0.6 : c - 0.6
    }
    wire(vert ? [[ax, start], [ax, b]] : [[start, ay], [b, ay]])
  }
  void corners
  parts.forEach((p, i) => { const s = slots[i]; if (s) shapes.push(...part(p.kind, p.label, s.cx, s.cy, s.v, C)) })
  return pad({ w: W + 0.2, h: H, shapes }, 1.4, 0.6)
}

// -------------------------------------------------------------- Feynman

function wavy(a: [number, number], b: [number, number], amp = 0.08, waves = 8): [number, number][] {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy)
  const nx = -dy / L, ny = dx / L
  const n = waves * 12
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, w = amp * Math.sin(t * waves * 2 * Math.PI)
    return [a[0] + dx * t + nx * w, a[1] + dy * t + ny * w] as [number, number]
  })
}

function fermion(a: [number, number], b: [number, number], C: string): Shape[] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, s = 0.12
  return [{ t: 'line', pts: [a, b], stroke: C, lw: 1 },
    { t: 'poly', pts: [[mx + ux * s, my + uy * s], [mx - ux * s - uy * s * 0.8, my - uy * s + ux * s * 0.8], [mx - ux * s + uy * s * 0.8, my - uy * s - ux * s * 0.8]], fill: C }]
}

export const FEYNMAN_PROCESSES: [FeynmanData['process'], string, string[]][] = [
  ['annihilation', 'e⁺e⁻ → μ⁺μ⁻ (s-channel)', ['e⁻', 'e⁺', 'μ⁻', 'μ⁺', 'γ']],
  ['scattering', 'e⁻e⁻ → e⁻e⁻ (t-channel)', ['e⁻', 'e⁻', 'e⁻', 'e⁻', 'γ']],
  ['compton', 'Compton scattering eγ → eγ', ['e⁻', 'γ', 'e⁻', 'γ', 'e⁻']],
  ['beta', 'Beta decay n → p e⁻ ν̄', ['d', 'u', 'e⁻', 'ν̄', 'W⁻']],
]

// Labels in Unicode for the editor; LaTeX for the PDF.
const LABEL_TEX: Record<string, string> = {
  'e⁻': '$e^-$', 'e⁺': '$e^+$', 'μ⁻': '$\\mu^-$', 'μ⁺': '$\\mu^+$', 'γ': '$\\gamma$', 'ν̄': '$\\bar\\nu_e$', 'W⁻': '$W^-$', 'u': '$u$', 'd': '$d$',
}
const labelTex = (s: string) => LABEL_TEX[s] ?? texMath(s)

export function feynmanDrawing(d: FeynmanData): Drawing {
  const C = hex(d.color)
  const L = (i: number) => d.labels[i] ?? ''
  const shapes: Shape[] = []
  const lab = (x: number, y: number, i: number, anchor: 'east' | 'west' | 'south' | 'north') =>
    shapes.push({ t: 'text', x, y, s: L(i), tex: labelTex(L(i)), anchor, size: 11, color: INK })
  const photon = (a: [number, number], b: [number, number]) => shapes.push({ t: 'line', pts: wavy(a, b), stroke: C, lw: 1 })
  switch (d.process) {
    case 'scattering': {
      const v1: [number, number] = [2.5, 2.7], v2: [number, number] = [2.5, 0.7]
      shapes.push(...fermion([0.6, 3.4], v1, C), ...fermion(v1, [4.4, 3.4], C), ...fermion([0.6, 0], v2, C), ...fermion(v2, [4.4, 0], C))
      photon(v1, v2)
      lab(0.5, 3.4, 0, 'east'); lab(0.5, 0, 1, 'east'); lab(4.5, 3.4, 2, 'west'); lab(4.5, 0, 3, 'west'); lab(2.75, 1.7, 4, 'west')
      return { w: 5.4, h: 3.6, shapes }
    }
    case 'compton': {
      const v1: [number, number] = [2, 1.7], v2: [number, number] = [3.6, 1.7]
      shapes.push(...fermion([0.6, 0.2], v1, C), ...fermion(v1, v2, C), ...fermion(v2, [5, 0.2], C))
      photon([0.6, 3.2], v1); photon(v2, [5, 3.2])
      lab(0.5, 0.2, 0, 'east'); lab(0.5, 3.2, 1, 'east'); lab(5.1, 0.2, 2, 'west'); lab(5.1, 3.2, 3, 'west'); lab(2.8, 1.5, 4, 'north')
      return { w: 5.8, h: 3.4, shapes }
    }
    case 'beta': {
      const v1: [number, number] = [2.4, 1.2], v2: [number, number] = [3.8, 2.4]
      shapes.push(...fermion([0.6, 1.2], v1, C), ...fermion(v1, [5, 0.4], C), ...fermion(v2, [5.2, 3.2], C), ...fermion([5.2, 1.7], v2, C))
      shapes.push({ t: 'line', pts: wavy(v1, v2), stroke: C, lw: 1 })
      lab(0.5, 1.2, 0, 'east'); lab(5.1, 0.4, 1, 'west'); lab(5.3, 3.2, 2, 'west'); lab(5.3, 1.7, 3, 'west'); lab(2.9, 2.1, 4, 'south')
      return { w: 6, h: 3.4, shapes }
    }
    default: {
      const v1: [number, number] = [1.8, 1.7], v2: [number, number] = [3.8, 1.7]
      shapes.push(...fermion([0.5, 3.2], v1, C), ...fermion(v1, [0.5, 0.2], C), ...fermion(v2, [5.1, 3.2], C), ...fermion([5.1, 0.2], v2, C))
      photon(v1, v2)
      lab(0.4, 3.2, 0, 'east'); lab(0.4, 0.2, 1, 'east'); lab(5.2, 3.2, 2, 'west'); lab(5.2, 0.2, 3, 'west'); lab(2.8, 2.0, 4, 'south')
      return { w: 5.8, h: 3.4, shapes }
    }
  }
}

// ------------------------------------------------------------ MO diagram

export const MO_MOLECULES = ['H2', 'He2', 'Li2', 'Be2', 'B2', 'C2', 'N2', 'O2', 'F2', 'Ne2']

function arrowUp(x: number, y: number, up: boolean, C: string): Shape[] {
  const a = up ? y - 0.2 : y + 0.2, b = up ? y + 0.2 : y - 0.2
  return [{ t: 'line', pts: [[x, a], [x, b]], stroke: C, lw: 0.9 }, { t: 'poly', pts: [[x, b + (up ? 0.04 : -0.04)], [x - 0.07, b - (up ? 0.1 : -0.1)], [x + 0.07, b - (up ? 0.1 : -0.1)]], fill: C }]
}

// Electrons on a set of degenerate levels: one each, then pairs (Hund).
function fill(n: number, levels: number): [number, boolean][] {
  const out: [number, boolean][] = []
  for (let k = 0; k < Math.min(n, levels); k++) out.push([k, true])
  for (let k = 0; k < Math.min(Math.max(0, n - levels), levels); k++) out.push([k, false])
  return out
}

export function moDrawing(d: MoData): Drawing {
  const C = hex(d.color)
  const sym = d.molecule.replace(/2$/, '')
  const el = element(sym)
  const z = el?.z ?? 8
  const shapes: Shape[] = []
  const lvl = (x: number, y: number, w = 0.7) => shapes.push({ t: 'line', pts: [[x - w / 2, y], [x + w / 2, y]], stroke: INK, lw: 1.1 })
  const dash = (a: [number, number], b: [number, number]) => shapes.push({ t: 'line', pts: [a, b], stroke: GREY, lw: 0.5, dash: true })
  const lab = (x: number, y: number, s: string, t: string, anchor: 'west' | 'east' = 'west') => shapes.push({ t: 'text', x, y, s, tex: t, anchor, size: 9, color: INK })
  const elec = (x: number, y: number, _k: number, up: boolean) => shapes.push(...arrowUp(x + (up ? -0.09 : 0.09), y, up, C))
  if (z <= 2) {
    // H2, He2: 1s only.
    const ao = 2.2, sb = 1.2, sa = 3.2, e = z
    lvl(0.8, ao); lvl(5.2, ao); lvl(3, sb); lvl(3, sa)
    dash([1.15, ao], [2.65, sb]); dash([1.15, ao], [2.65, sa]); dash([4.85, ao], [3.35, sb]); dash([4.85, ao], [3.35, sa])
    for (const x of [0.8, 5.2]) for (const [, up] of fill(e, 1)) elec(x, ao, 0, up)
    const mo = 2 * e
    for (const [, up] of fill(Math.min(2, mo), 1)) elec(3, sb, 0, up)
    for (const [, up] of fill(Math.max(0, mo - 2), 1)) elec(3, sa, 0, up)
    lab(3.45, sb, 'σ1s', '$\\sigma_{1s}$'); lab(3.45, sa, 'σ*1s', '$\\sigma^*_{1s}$'); lab(0.4, ao, '1s', '$1s$', 'east'); lab(5.6, ao, '1s', '$1s$')
    shapes.push({ t: 'text', x: 0.8, y: 0.3, s: sym, size: 10, bold: true, color: INK }, { t: 'text', x: 5.2, y: 0.3, s: sym, size: 10, bold: true, color: INK }, { t: 'text', x: 3, y: 0.3, s: d.molecule.replace('2', '₂'), tex: `${sym}$_2$`, size: 10, bold: true, color: INK })
    return { w: 6.2, h: 3.8, shapes }
  }
  // Second row: 2s and 2p, with the σ2p / π2p order switching after N2.
  const val = z - 2
  const swap = z >= 8
  const s2 = 1.2, s2s = 0.7, s2a = 1.8, p2 = 3.6
  const levels: { key: string; y: number; n: number; s: string; t: string }[] = [
    { key: 's', y: s2s, n: 1, s: 'σ2s', t: '$\\sigma_{2s}$' }, { key: 'sa', y: s2a, n: 1, s: 'σ*2s', t: '$\\sigma^*_{2s}$' },
    { key: 'sp', y: swap ? 2.7 : 3.15, n: 1, s: 'σ2p', t: '$\\sigma_{2p}$' }, { key: 'pp', y: swap ? 3.15 : 2.7, n: 2, s: 'π2p', t: '$\\pi_{2p}$' },
    { key: 'pa', y: 4.4, n: 2, s: 'π*2p', t: '$\\pi^*_{2p}$' }, { key: 'spa', y: 5.0, n: 1, s: 'σ*2p', t: '$\\sigma^*_{2p}$' },
  ]
  // AO columns either side, the MO column in the middle.
  const xl = 1.7, xm = 4.3, xr = 6.9
  for (const x of [xl, xr]) {
    lvl(x, s2, 0.55)
    for (let k = 0; k < 3; k++) lvl(x - 0.6 + k * 0.6, p2, 0.45)
    const sE = Math.min(2, val), pE = Math.max(0, val - 2)
    for (const [, up] of fill(sE, 1)) elec(x, s2, 0, up)
    for (const [k, up] of fill(pE, 3)) elec(x - 0.6 + k * 0.6, p2, k, up)
  }
  lab(xl - 0.95, s2, '2s', '$2s$', 'east'); lab(xl - 0.95, p2, '2p', '$2p$', 'east')
  // MO column, filled from the bottom.
  let left = 2 * val
  const ordered = [...levels].sort((a, b) => a.y - b.y)
  for (const L of ordered) {
    const xs = L.n === 1 ? [xm] : [xm - 0.35, xm + 0.35]
    for (const x of xs) lvl(x, L.y, 0.55)
    const e = Math.min(left, 2 * L.n)
    left -= e
    for (const [k, up] of fill(e, L.n)) elec(xs[k], L.y, k, up)
    lab(xm + (L.n === 1 ? 0.4 : 0.75), L.y, L.s, L.t)
  }
  for (const L of levels) {
    const isS = L.key === 's' || L.key === 'sa'
    const ao = isS ? s2 : p2
    const inL = xm - (L.n === 1 ? 0.3 : 0.65), inR = xm + (L.n === 1 ? 0.3 : 0.65)
    dash([xl + (isS ? 0.3 : 0.85), ao], [inL, L.y]); dash([xr - (isS ? 0.3 : 0.85), ao], [inR, L.y])
  }
  shapes.push({ t: 'text', x: xl, y: 0.15, s: sym, size: 10, bold: true, color: INK }, { t: 'text', x: xr, y: 0.15, s: sym, size: 10, bold: true, color: INK },
    { t: 'text', x: xm, y: 0.15, s: `${sym}₂`, tex: `${sym}$_2$`, size: 10, bold: true, color: INK })
  shapes.push({ t: 'line', pts: [[0.2, 0.4], [0.2, 5.3]], stroke: GREY, lw: 0.6, arrow: true })
  shapes.push({ t: 'text', x: 0.05, y: 2.9, s: 'Energy', size: 8.5, color: '777777', rotate: 90, anchor: 'south' })
  return { w: 8, h: 5.5, shapes }
}

// ----------------------------------------------------------- Bohr model

export function bohrDrawing(d: BohrData): Drawing {
  const C = hex(d.color)
  const el = element(d.element) ?? element(11)!
  const sh = shells(el.z)
  const R0 = 0.55, step = 0.42
  const Rmax = R0 + step * sh.length
  const cx = Rmax + 0.1, cy = Rmax + 0.6
  const shapes: Shape[] = []
  shapes.push({ t: 'circle', x: cx, y: cy, r: R0 * 0.8, fill: C })
  shapes.push({ t: 'text', x: cx, y: cy, s: el.symbol, size: 11, bold: true, color: 'FFFFFF' })
  sh.forEach((n, k) => {
    const r = R0 + step * (k + 1)
    shapes.push({ t: 'circle', x: cx, y: cy, r, stroke: GREY, lw: 0.6 })
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + i * 2 * Math.PI / n
      shapes.push({ t: 'circle', x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), r: 0.07, fill: C })
    }
  })
  shapes.push({ t: 'text', x: cx, y: 0.3, s: `${el.name} (${sh.join(', ')})`, size: 9.5, color: INK })
  return { w: 2 * cx, h: cy + Rmax + 0.1, shapes }
}

// ---------------------------------------------------------- element tiles

export function elementTilesDrawing(d: ElementTileData): Drawing {
  const els = d.elements.split(/[,\s]+/).map(s => element(s)).filter(e => e) as NonNullable<ReturnType<typeof element>>[]
  const S = 2.2, gap = 0.25
  const shapes: Shape[] = []
  els.forEach((e, i) => {
    const x = i * (S + gap), C = FAMILY_COLORS[e.family]
    shapes.push({ t: 'rect', x, y: 0, w: S, h: S, fill: tintHex(C, 14), stroke: C, lw: 1, r: 0.08 })
    shapes.push({ t: 'text', x: x + 0.15, y: S - 0.15, s: String(e.z), anchor: 'north west', size: 9, color: INK })
    shapes.push({ t: 'text', x: x + S / 2, y: S / 2 + 0.12, s: e.symbol, size: 99, bold: true, color: C })
    shapes.push({ t: 'text', x: x + S / 2, y: 0.5, s: e.name, size: e.name.length > 10 ? 7 : 8.5, color: INK })
    if (d.show_mass) shapes.push({ t: 'text', x: x + S / 2, y: 0.18, s: e.mass, size: 7.5, color: '666666' })
  })
  return { w: Math.max(S, els.length * (S + gap) - gap), h: S, shapes }
}

function tintHex(c: string, pct: number): string {
  const h = hex(c)
  return [0, 2, 4].map(i => Math.round(255 - (255 - parseInt(h.slice(i, i + 2), 16)) * pct / 100).toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ------------------------------------------------------------- hazards

// GHS pictograms: [key, label, the character the editor shows, the
// fontawesome5 icon the PDF draws inside the red diamond].
export const GHS: [string, string, string, string][] = [
  ['explos', 'Explosive', '💥', 'bomb'], ['flame', 'Flammable', '🔥', 'fire'], ['flame-O', 'Oxidising', '⭘', 'fire-alt'],
  ['bottle', 'Gas under pressure', '🧯', 'prescription-bottle'], ['acid', 'Corrosive', '🧪', 'flask'], ['skull', 'Acute toxicity', '☠', 'skull-crossbones'],
  ['exclam', 'Harmful / irritant', '❗', 'exclamation'], ['health', 'Health hazard', '⚕', 'user-injured'], ['aqpol', 'Environmental hazard', '🐟', 'fish'],
]

// Common hazard (H) and precautionary (P) statements.
export const GHS_TEXT: Record<string, string> = {
  H200: 'Unstable explosive.', H220: 'Extremely flammable gas.', H222: 'Extremely flammable aerosol.', H224: 'Extremely flammable liquid and vapour.',
  H225: 'Highly flammable liquid and vapour.', H226: 'Flammable liquid and vapour.', H228: 'Flammable solid.', H270: 'May cause or intensify fire; oxidiser.',
  H272: 'May intensify fire; oxidiser.', H280: 'Contains gas under pressure; may explode if heated.', H290: 'May be corrosive to metals.',
  H300: 'Fatal if swallowed.', H301: 'Toxic if swallowed.', H302: 'Harmful if swallowed.', H304: 'May be fatal if swallowed and enters airways.',
  H310: 'Fatal in contact with skin.', H311: 'Toxic in contact with skin.', H312: 'Harmful in contact with skin.', H314: 'Causes severe skin burns and eye damage.',
  H315: 'Causes skin irritation.', H317: 'May cause an allergic skin reaction.', H318: 'Causes serious eye damage.', H319: 'Causes serious eye irritation.',
  H330: 'Fatal if inhaled.', H331: 'Toxic if inhaled.', H332: 'Harmful if inhaled.', H334: 'May cause allergy or asthma symptoms or breathing difficulties if inhaled.',
  H335: 'May cause respiratory irritation.', H336: 'May cause drowsiness or dizziness.', H340: 'May cause genetic defects.', H341: 'Suspected of causing genetic defects.',
  H350: 'May cause cancer.', H351: 'Suspected of causing cancer.', H360: 'May damage fertility or the unborn child.', H370: 'Causes damage to organs.',
  H372: 'Causes damage to organs through prolonged or repeated exposure.', H400: 'Very toxic to aquatic life.', H410: 'Very toxic to aquatic life with long lasting effects.',
  H411: 'Toxic to aquatic life with long lasting effects.', H412: 'Harmful to aquatic life with long lasting effects.',
  P201: 'Obtain special instructions before use.', P210: 'Keep away from heat, hot surfaces, sparks, open flames and other ignition sources. No smoking.',
  P233: 'Keep container tightly closed.', P260: 'Do not breathe dust/fume/gas/mist/vapours/spray.', P261: 'Avoid breathing dust/fume/gas/mist/vapours/spray.',
  P264: 'Wash hands thoroughly after handling.', P270: 'Do not eat, drink or smoke when using this product.', P271: 'Use only outdoors or in a well-ventilated area.',
  P273: 'Avoid release to the environment.', P280: 'Wear protective gloves/protective clothing/eye protection/face protection.',
  P301: 'IF SWALLOWED:', P302: 'IF ON SKIN:', P304: 'IF INHALED:', P305: 'IF IN EYES:', P310: 'Immediately call a POISON CENTER/doctor.',
  P338: 'Remove contact lenses, if present and easy to do. Continue rinsing.', P351: 'Rinse cautiously with water for several minutes.',
  P403: 'Store in a well-ventilated place.', P501: 'Dispose of contents/container in accordance with local regulations.',
}

export function hazardDrawing(d: HazardData): Drawing {
  const pics = d.pictograms.map(p => GHS.find(([k]) => k === p)).filter(Boolean) as [string, string, string, string][]
  const S = 1.7, gap = 0.35
  const shapes: Shape[] = []
  pics.forEach(([, , ch, fa], i) => {
    const cx = i * (S + gap) + S / 2, cy = S / 2 + (d.signal ? 0.55 : 0)
    shapes.push({ t: 'poly', pts: [[cx, cy + S / 2], [cx + S / 2, cy], [cx, cy - S / 2], [cx - S / 2, cy]], fill: 'FFFFFF', stroke: 'D50000', lw: 3 })
    shapes.push({ t: 'text', x: cx, y: cy, s: ch, tex: `\\faIcon{${fa}}`, size: 99, color: '000000' })
  })
  const W = Math.max(S, pics.length * (S + gap) - gap)
  if (d.signal) shapes.push({ t: 'text', x: W / 2, y: 0.15, s: d.signal.toUpperCase(), size: 13, bold: true, color: d.signal === 'Danger' ? 'D50000' : '000000' })
  return { w: W, h: S + (d.signal ? 0.55 : 0), shapes }
}

export const hazardLines = (d: HazardData) =>
  d.statements.split('\n').map(l => l.trim().toUpperCase()).filter(l => /^[HP]\d{3}$/.test(l)).map(code => [code, GHS_TEXT[code] ?? ''] as [string, string])

export function hazardLatex(d: HazardData): string {
  const lines = hazardLines(d).map(([c, t]) => `\\textbf{${c}}\\quad ${tex(t)}`).join('\\\\\n')
  return scienceDrawn(hazardDrawing(d)) + (lines ? `\\begin{flushleft}\\small\n${lines}\n\\end{flushleft}\n` : '')
}

// -------------------------------------------------------- reaction scheme

// chemfig text, with Unicode subscripts and arrows typed as LaTeX.
const chemText = (s: string) => texMath(s).replace(/₀|₁|₂|₃|₄|₅|₆|₇|₈|₉/g, c => `\\textsubscript{${'₀₁₂₃₄₅₆₇₈₉'.indexOf(c)}}`)

export function schemeLatex(d: SchemeData): string {
  const parts: string[] = []
  d.steps.forEach((s, i) => {
    if (i > 0) {
      const a = d.arrows[i - 1] ?? { above: '', below: '' }
      parts.push(`\\arrow{->[${chemText(a.above)}][${chemText(a.below)}]}`)
    }
    parts.push(`\\chemname{\\chemfig{${s.chemfig.trim() || '?'}}}{${tex(s.name)}}`)
  })
  return `\\begin{center}\n\\schemestart\n${parts.join('\n')}\n\\schemestop\n\\end{center}\n\\vspace{1.5em}\n`
}

// ------------------------------------------------------------- algorithm

const KEY_OPEN = /^(function|procedure|if|for|while|else if|elseif|else)\b/i

// Indented pseudocode as algpseudocode: blocks follow the indentation.
export function algorithmLatex(d: AlgorithmData): string {
  const lines = d.code.split('\n').filter(l => l.trim())
  const out: string[] = []
  const stack: { ind: number; end: string }[] = []
  const indent = (l: string) => l.length - l.trimStart().length
  const close = (ind: number) => { while (stack.length && stack[stack.length - 1].ind >= ind) out.push(stack.pop()!.end) }
  const txt = (s: string) => texMath(s.replace(/\s*(then|do|:)\s*$/i, '')).replace(/<=/g, '$\\le$').replace(/>=/g, '$\\ge$').replace(/!=/g, '$\\ne$').replace(/ \* /g, ' $\\cdot$ ').replace(/\\textbackslash\{\}leftarrow/g, '$\\leftarrow$')
  for (const raw of lines) {
    const ind = indent(raw)
    const l = raw.trim()
    const isElse = /^(else\b|else if\b|elseif\b)/i.test(l)
    if (isElse) close(ind + 1); else close(ind)
    let m
    if ((m = /^(function|procedure)\s+(\w+)\s*\((.*)\)\s*:?$/i.exec(l))) { out.push(`\\Function{${m[2]}}{${txt(m[3])}}`); stack.push({ ind, end: '\\EndFunction' }) }
    else if ((m = /^(else if|elseif)\s+(.*)$/i.exec(l))) out.push(`\\ElsIf{${txt(m[2])}}`)
    else if (/^else\s*:?$/i.test(l)) out.push('\\Else')
    else if ((m = /^if\s+(.*)$/i.exec(l))) { out.push(`\\If{${txt(m[1])}}`); stack.push({ ind, end: '\\EndIf' }) }
    else if ((m = /^for\s+(.*)$/i.exec(l))) { out.push(`\\For{${txt(m[1])}}`); stack.push({ ind, end: '\\EndFor' }) }
    else if ((m = /^while\s+(.*)$/i.exec(l))) { out.push(`\\While{${txt(m[1])}}`); stack.push({ ind, end: '\\EndWhile' }) }
    else if ((m = /^return\s*(.*)$/i.exec(l))) out.push(`\\State \\Return ${txt(m[1])}`)
    else out.push(`\\State ${txt(l).replace(/^(\w+)\s*=\s*/, '$1 $\\gets$ ')}`)
  }
  close(-1)
  void KEY_OPEN
  return `\\begin{algorithm}[H]\n${d.title.trim() ? `\\caption{${tex(d.title.trim())}}\n` : ''}\\begin{algorithmic}${d.numbers ? '[1]' : ''}\n${out.join('\n')}\n\\end{algorithmic}\n\\end{algorithm}\n`
}

// ---------------------------------------------------------- lab notebook

export function notebookLatex(d: NotebookData): string {
  const C = hex(d.color)
  const row = (k: string, v: string) => v.trim() ? `\\textbf{${k}}\\quad ${texMath(v.trim())}\\par\\smallskip\n` : ''
  return `\\begingroup\\definecolor{kW}{HTML}{${C}}\n\\begin{tcolorbox}[enhanced,breakable,colback=kW!4,colframe=kW,boxrule=0.6pt,arc=1pt,fonttitle=\\bfseries\\sffamily,`
    + `title={${tex(d.title)}\\hfill ${tex(d.date)}},left=6pt,right=6pt]\n`
    + row('Aim', d.aim) + row('Method', d.method) + row('Observations', d.observations) + row('Result', d.result)
    + '\\end{tcolorbox}\n\\endgroup\n'
}

export const scienceDrawn = (d: Drawing) => `\\begin{center}\n${drawingTikz(d)}\n\\end{center}\n`
export { textW as _textW }
