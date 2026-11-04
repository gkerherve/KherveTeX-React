// Math, graph-axes, vector and symbol glyphs.
// Port of khervedoc/paint/maths.py.
//
// Each `build<Name>(w, h)` returns a list of shape-spec dicts (the AI/
// example format) drawing a symbol inside the box (0,0)-(w,h). Same
// `buildSpecs`/`sizeMm`/`REFERENCE_MM` interface as floorplan/electrical.

import type { SymbolBuilder, SymbolSpec } from './paintSymbols.ts'

export const NAME = 'maths'

const _OUTLINE = '#333333'
const _CURVE = '#2b6cb0'
const _VECTOR = '#d9534f'
const _GRID = '#c8ced6'

export function buildAxes2d(w: number, h: number): SymbolSpec[] {
  const ox = w * 0.15
  const oy = h * 0.85
  return [
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 },
    { shape: 'text', text: 'x', x: w * 0.97, y: oy - h * 0.08, size: Math.min(w, h) * 0.12, color: _OUTLINE },
    { shape: 'text', text: 'y', x: ox + w * 0.07, y: h * 0.08, size: Math.min(w, h) * 0.12, color: _OUTLINE },
  ]
}

export function buildAxes3d(w: number, h: number): SymbolSpec[] {
  const ox = w * 0.4
  const oy = h * 0.5
  return [
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.08, y2: h * 0.92, stroke: _OUTLINE, width: 2 },
    { shape: 'text', text: 'x', x: w * 0.97, y: oy - h * 0.07, size: Math.min(w, h) * 0.11, color: _OUTLINE },
    { shape: 'text', text: 'y', x: ox + w * 0.07, y: h * 0.08, size: Math.min(w, h) * 0.11, color: _OUTLINE },
    { shape: 'text', text: 'z', x: w * 0.05, y: h * 0.97, size: Math.min(w, h) * 0.11, color: _OUTLINE },
  ]
}

export function buildNumberLine(w: number, h: number): SymbolSpec[] {
  const cy = h * 0.5
  const ox = w * 0.08
  const specs: SymbolSpec[] = [
    { shape: 'arrow', x1: ox, y1: cy, x2: w * 0.95, y2: cy, stroke: _OUTLINE, width: 2 },
  ]
  const labels = ['-1', '0', '1', '2']
  const n = labels.length
  const span = w * 0.78
  const start = w * 0.12
  labels.forEach((lab, i) => {
    const tx = start + span * (i / (n - 1))
    specs.push({ shape: 'line', x1: tx, y1: cy - h * 0.08, x2: tx, y2: cy + h * 0.08, stroke: _OUTLINE, width: 1.5 })
    specs.push({
      shape: 'text', text: lab, x: tx, y: cy + h * 0.25, size: Math.min(w, h) * 0.16,
      color: _OUTLINE, anchor: 'center',
    })
  })
  return specs
}

export function buildGridGraph(w: number, h: number): SymbolSpec[] {
  const ox = w * 0.15
  const oy = h * 0.85
  const specs: SymbolSpec[] = []
  const n = 4
  const gx0 = ox
  const gx1 = w * 0.92
  const gy0 = h * 0.1
  const gy1 = oy
  for (let i = 1; i < n + 1; i++) {
    const x = gx0 + (gx1 - gx0) * (i / n)
    specs.push({ shape: 'line', x1: x, y1: gy0, x2: x, y2: gy1, stroke: _GRID, width: 1.5 })
  }
  for (let i = 0; i < n; i++) {
    const y = gy0 + (gy1 - gy0) * (i / n)
    specs.push({ shape: 'line', x1: gx0, y1: y, x2: gx1, y2: y, stroke: _GRID, width: 1.5 })
  }
  specs.push({ shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 })
  specs.push({ shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 })
  return specs
}

export function buildCurve(w: number, h: number): SymbolSpec[] {
  const ox = w * 0.15
  const oy = h * 0.85
  const specs: SymbolSpec[] = [
    { shape: 'arrow', x1: ox, y1: oy, x2: w * 0.95, y2: oy, stroke: _OUTLINE, width: 2 },
    { shape: 'arrow', x1: ox, y1: oy, x2: ox, y2: h * 0.08, stroke: _OUTLINE, width: 2 },
  ]
  const x0 = w * 0.18
  const x1 = w * 0.92
  const ytop = h * 0.12
  const ybot = h * 0.82
  const samples = 24
  const pts: [number, number][] = []
  for (let i = 0; i < samples + 1; i++) {
    const t = i / samples
    const px = x0 + (x1 - x0) * t
    const s = 0.5 * (1.0 + Math.sin(Math.PI * (2.0 * t - 0.5)))
    const py = ybot - (ybot - ytop) * s
    pts.push([px, py])
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1p, y1p] = pts[i]
    const [x2p, y2p] = pts[i + 1]
    specs.push({ shape: 'line', x1: x1p, y1: y1p, x2: x2p, y2: y2p, stroke: _CURVE, width: 2 })
  }
  return specs
}

export function buildVector(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'arrow', x1: w * 0.15, y1: h * 0.85, x2: w * 0.85, y2: h * 0.18, stroke: _VECTOR, width: 2 },
    { shape: 'text', text: 'v', x: w * 0.78, y: h * 0.32, size: Math.min(w, h) * 0.14, color: _VECTOR },
  ]
}

export function buildAngleArc(w: number, h: number): SymbolSpec[] {
  const vx = w * 0.15
  const vy = h * 0.85
  const specs: SymbolSpec[] = [
    { shape: 'line', x1: vx, y1: vy, x2: w * 0.92, y2: vy, stroke: _OUTLINE, width: 2 },
    { shape: 'line', x1: vx, y1: vy, x2: w * 0.85, y2: h * 0.2, stroke: _OUTLINE, width: 2 },
  ]
  const r = Math.min(w, h) * 0.32
  const a0 = 0.0
  const a1 = Math.atan2(vy - h * 0.2, w * 0.85 - vx)
  const samples = 12
  const arc: [number, number][] = []
  for (let i = 0; i < samples + 1; i++) {
    const a = a0 + (a1 - a0) * (i / samples)
    arc.push([vx + r * Math.cos(a), vy - r * Math.sin(a)])
  }
  for (let i = 0; i < arc.length - 1; i++) {
    const [x1p, y1p] = arc[i]
    const [x2p, y2p] = arc[i + 1]
    specs.push({ shape: 'line', x1: x1p, y1: y1p, x2: x2p, y2: y2p, stroke: _OUTLINE, width: 1.5 })
  }
  const mid = (a0 + a1) * 0.5
  const tr = r * 1.4
  specs.push({
    shape: 'text', text: 'θ',
    x: vx + tr * Math.cos(mid),
    y: vy - tr * Math.sin(mid),
    size: Math.min(w, h) * 0.16, color: _OUTLINE,
  })
  return specs
}

export function buildRightAngle(w: number, h: number): SymbolSpec[] {
  const vx = w * 0.18
  const vy = h * 0.82
  const specs: SymbolSpec[] = [
    { shape: 'line', x1: vx, y1: vy, x2: w * 0.92, y2: vy, stroke: _OUTLINE, width: 2 },
    { shape: 'line', x1: vx, y1: vy, x2: vx, y2: h * 0.1, stroke: _OUTLINE, width: 2 },
  ]
  const s = Math.min(w, h) * 0.18
  specs.push({ shape: 'line', x1: vx + s, y1: vy, x2: vx + s, y2: vy - s, stroke: _OUTLINE, width: 1.5 })
  specs.push({ shape: 'line', x1: vx, y1: vy - s, x2: vx + s, y2: vy - s, stroke: _OUTLINE, width: 1.5 })
  return specs
}

export function buildBrace(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'text', text: '{', x: w * 0.5, y: h * 0.5, size: h * 0.95, color: _OUTLINE, anchor: 'center' },
  ]
}

function _glyph(w: number, h: number, glyph: string, color = _OUTLINE): SymbolSpec[] {
  return [
    { shape: 'text', text: glyph, x: w * 0.5, y: h * 0.5, size: Math.min(w, h) * 0.7, color, anchor: 'center' },
  ]
}

export function buildSum(w: number, h: number): SymbolSpec[] {
  return _glyph(w, h, 'Σ')
}

export function buildIntegral(w: number, h: number): SymbolSpec[] {
  return _glyph(w, h, '∫')
}

export function buildPi(w: number, h: number): SymbolSpec[] {
  return _glyph(w, h, 'π')
}

export function buildInfinity(w: number, h: number): SymbolSpec[] {
  return _glyph(w, h, '∞')
}

export function buildDelta(w: number, h: number): SymbolSpec[] {
  return _glyph(w, h, 'Δ')
}

export function buildTheta(w: number, h: number): SymbolSpec[] {
  return _glyph(w, h, 'θ')
}

export const REFERENCE_MM = 1000.0

export const SIZES: Record<string, [number, number]> = {
  axes_2d: [220.0, 200.0],
  axes_3d: [220.0, 200.0],
  number_line: [220.0, 200.0],
  grid_graph: [220.0, 200.0],
  curve: [220.0, 200.0],
  vector: [200.0, 200.0],
  angle_arc: [200.0, 200.0],
  right_angle: [200.0, 200.0],
  brace: [120.0, 120.0],
  sum: [120.0, 120.0],
  integral: [120.0, 120.0],
  pi: [120.0, 120.0],
  infinity: [120.0, 120.0],
  delta: [120.0, 120.0],
  theta: [120.0, 120.0],
}

export const LABELS: Record<string, string> = {
  axes_2d: '2D axes',
  axes_3d: '3D axes',
  number_line: 'Number line',
  grid_graph: 'Grid graph',
  curve: 'Curve plot',
  vector: 'Vector',
  angle_arc: 'Angle',
  right_angle: 'Right angle',
  brace: 'Brace {',
  sum: 'Sum Σ',
  integral: 'Integral ∫',
  pi: 'Pi π',
  infinity: 'Infinity ∞',
  delta: 'Delta Δ',
  theta: 'Theta θ',
}

export const CATEGORIES: [string, string[]][] = [
  ['Axes & graphs', ['axes_2d', 'axes_3d', 'number_line', 'grid_graph', 'curve']],
  ['Vectors & angles', ['vector', 'angle_arc', 'right_angle', 'brace']],
  ['Symbols', ['sum', 'integral', 'pi', 'infinity', 'delta', 'theta']],
]

const _BUILDERS: Record<string, SymbolBuilder> = {
  axes_2d: buildAxes2d,
  axes_3d: buildAxes3d,
  number_line: buildNumberLine,
  grid_graph: buildGridGraph,
  curve: buildCurve,
  vector: buildVector,
  angle_arc: buildAngleArc,
  right_angle: buildRightAngle,
  brace: buildBrace,
  sum: buildSum,
  integral: buildIntegral,
  pi: buildPi,
  infinity: buildInfinity,
  delta: buildDelta,
  theta: buildTheta,
}

export function buildSpecs(name: string, w: number, h: number): SymbolSpec[] {
  if (!Object.hasOwn(_BUILDERS, name)) throw new Error(`KeyError: '${name}'`)
  return _BUILDERS[name](w, h)
}

export function sizeMm(name: string): [number, number] {
  if (!Object.hasOwn(SIZES, name)) throw new Error(`KeyError: '${name}'`)
  return SIZES[name]
}
