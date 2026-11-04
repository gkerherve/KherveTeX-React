// The flowchart builder's editor geometry, from flowchart_builder.py:
// where a box sits and how big it is (NodeItem), the points an arrow is
// drawn through (EdgeItem.update_path), the box outlines (shape_path) and
// the box text as HTML (_pretty_inline_html). No DOM, so the parity test
// can compare it with the Python editor.
import type { Edge, Node } from '../core/flowchart.ts'
import { pyRound } from '../core/py.ts'
import SYMBOLS from './flowSymbols.json' with { type: 'json' }

export const GX = 160.0          // px per grid column / row on the editor
export const GY = 90.0
export const NODE_W = 128.0
export const NODE_H = 50.0

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

// NodeItem.rect: centred on the box's position.
export function nodeRect(kind: string): Rect {
  const w = kind === 'connector' ? 46.0 : NODE_W
  const h = kind === 'connector' ? 46.0 : (kind === 'decision' ? 64.0 : NODE_H)
  return { x: -w / 2, y: -h / 2, w, h }
}

// A box as the editor places it: its scene position and local rect.
export interface BoxGeom { pos: Pt; rect: Rect; kind: string }

// NodeItem.itemChange: a box snaps to a quarter of the grid.
export function snapPos(p: Pt): Pt {
  return { x: pyRound(p.x / (GX / 4), 0) * (GX / 4), y: pyRound(p.y / (GY / 4), 0) * (GY / 4) }
}

export function boxGeom(n: Node, pos?: Pt): BoxGeom {
  return { pos: pos ?? snapPos({ x: n.x * GX, y: n.y * GY }), rect: nodeRect(n.kind), kind: n.kind }
}

const right = (r: Rect) => r.x + r.w
const bottom = (r: Rect) => r.y + r.h

// Where a line from the centre toward `toward` leaves the box.
function anchor(item: BoxGeom, toward: Pt): Pt {
  const c = item.pos
  const r = item.rect
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (Math.abs(dx) * r.h > Math.abs(dy) * r.w) {
    return { x: c.x + (dx > 0 ? right(r) : r.x), y: c.y }
  }
  return { x: c.x, y: c.y + (dy > 0 ? bottom(r) : r.y) }
}

function sidePoint(item: BoxGeom, side: string): Pt {
  const c = item.pos
  const r = item.rect
  switch (side) {
    case 'north': return { x: c.x, y: c.y + r.y }
    case 'south': return { x: c.x, y: c.y + bottom(r) }
    case 'east': return { x: c.x + right(r), y: c.y }
    default: return { x: c.x + r.x, y: c.y }
  }
}

const STUB: Record<string, [number, number]> = {
  north: [0, -16], south: [0, 16], east: [16, 0], west: [-16, 0],
}

// Mirror flowchart._sided_route: a stub out of the start side, then an
// elbow coming into the end side head on.
function sidedPoints(e: Edge, a: BoxGeom, b: BoxGeom): Pt[] {
  let pts: Pt[]
  if (e.src_side in STUB) {
    const p0 = sidePoint(a, e.src_side)
    pts = [p0, { x: p0.x + STUB[e.src_side][0], y: p0.y + STUB[e.src_side][1] }]
  } else {
    pts = [anchor(a, b.pos)]
  }
  const last = pts[pts.length - 1]
  let p1 = e.dst_side in STUB ? sidePoint(b, e.dst_side) : anchor(b, last)
  if (e.route === 'straight') return [...pts, p1]
  let corner: Pt
  if (e.dst_side === 'north' || e.dst_side === 'south') corner = { x: p1.x, y: last.y }       // -|
  else if (e.dst_side === 'east' || e.dst_side === 'west') corner = { x: last.x, y: p1.y }    // |-
  else if (e.src_side === 'east' || e.src_side === 'west') corner = { x: last.x, y: p1.y }
  else corner = { x: p1.x, y: last.y }
  if (!(e.dst_side in STUB)) p1 = anchor(b, corner)
  return [...pts, corner, p1]
}

const SIDE_DEG: Record<string, number> = { east: 0, north: 90, west: 180, south: 270 }
const radians = (d: number) => d * Math.PI / 180
const degrees = (r: number) => r * 180 / Math.PI

// Mirror flowchart._curved_route with the same cubic TikZ draws: bowed by
// `bend` degrees, or leaving / arriving at the chosen sides (control
// points 0.3915 × the chord away, TikZ's default).
function curvePoints(e: Edge, ia: BoxGeom, ib: BoxGeom): Pt[] {
  const a = ia.pos
  const b = ib.pos
  const chord = degrees(Math.atan2(-(b.y - a.y), b.x - a.x))
  let out: number
  let inn: number
  if (e.src_side in SIDE_DEG && e.dst_side in SIDE_DEG) {
    out = SIDE_DEG[e.src_side]
    inn = SIDE_DEG[e.dst_side]
  } else {
    out = chord + e.bend
    inn = chord + 180 - e.bend
  }
  const unit = (deg: number): Pt => {            // screen y points down
    const r = radians(deg)
    return { x: Math.cos(r), y: -Math.sin(r) }
  }
  const uo = unit(out)
  const ui = unit(inn)
  const p0 = e.src_side in SIDE_DEG ? sidePoint(ia, e.src_side)
    : anchor(ia, { x: a.x + uo.x * 100, y: a.y + uo.y * 100 })
  const p1 = e.dst_side in SIDE_DEG ? sidePoint(ib, e.dst_side)
    : anchor(ib, { x: b.x + ui.x * 100, y: b.y + ui.y * 100 })
  const k = 0.3915 * Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const c1 = { x: p0.x + uo.x * k, y: p0.y + uo.y * k }
  const c2 = { x: p1.x + ui.x * k, y: p1.y + ui.y * k }
  const pts: Pt[] = []
  for (let i = 0; i < 33; i++) {
    const t = i / 32
    const m = 1 - t
    pts.push({
      x: p0.x * (m * m * m) + c1.x * (3 * m * m * t) + c2.x * (3 * m * t * t) + p1.x * (t * t * t),
      y: p0.y * (m * m * m) + c1.y * (3 * m * m * t) + c2.y * (3 * m * t * t) + p1.y * (t * t * t),
    })
  }
  return pts
}

// EdgeItem.update_path: the points the arrow is drawn through.
export function edgePoints(e: Edge, ia: BoxGeom, ib: BoxGeom, direction: string): Pt[] {
  if (e.route === 'curve') return curvePoints(e, ia, ib)
  if (e.src_side !== 'auto' || e.dst_side !== 'auto') return sidedPoints(e, ia, ib)
  const a = ia.pos
  const b = ib.pos
  const tb = direction === 'TB'
  const straight = e.route === 'straight' || Math.abs(a.x - b.x) < 1 || Math.abs(a.y - b.y) < 1
  const back = (tb && b.y < a.y && Math.abs(a.x - b.x) < 1)
    || (!tb && b.x < a.x && Math.abs(a.y - b.y) < 1)
  if (back) {
    const off = tb ? -(ia.rect.w / 2 + 30) : (ia.rect.h / 2 + 30)
    if (tb) {
      const p1 = { x: a.x + ia.rect.x, y: a.y }
      const p4 = { x: b.x + ib.rect.x, y: b.y }
      return [p1, { x: a.x + off, y: a.y }, { x: a.x + off, y: b.y }, p4]
    }
    const p1 = { x: a.x, y: a.y + bottom(ia.rect) }
    const p4 = { x: b.x, y: b.y + bottom(ib.rect) }
    return [p1, { x: a.x, y: a.y + off }, { x: b.x, y: a.y + off }, p4]
  }
  if (straight) return [anchor(ia, b), anchor(ib, a)]
  const acrossFirst = (ia.kind === 'decision') === tb
  const corner = acrossFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
  return [anchor(ia, corner), corner, anchor(ib, corner)]
}

// EdgeItem._head: the arrowhead triangle at `tip`, coming from `prev`.
export function headPolygon(tip: Pt, prev: Pt): Pt[] {
  const vx = tip.x - prev.x
  const vy = tip.y - prev.y
  const length = Math.max(1e-6, Math.sqrt(vx ** 2 + vy ** 2))
  const ux = vx / length
  const uy = vy / length
  const size = 9
  return [tip,
    { x: tip.x - ux * size - uy * size * 0.45, y: tip.y - uy * size + ux * size * 0.45 },
    { x: tip.x - ux * size + uy * size * 0.45, y: tip.y - uy * size - ux * size * 0.45 }]
}

// The label's anchor: 30 % along the first segment (QPainterPath
// .pointAtPercent(0.25) on a curve, by length).
export function labelPoint(e: Edge, pts: Pt[]): Pt {
  if (e.route === 'curve') return pointAtPercent(pts, 0.25)
  const [a, b] = pts
  return { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 }
}

function pointAtPercent(pts: Pt[], t: number): Pt {
  const lens: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    lens.push(l)
    total += l
  }
  let want = total * t
  for (let i = 1; i < pts.length; i++) {
    const l = lens[i - 1]
    if (want <= l || i === pts.length - 1) {
      const f = l > 0 ? Math.min(1, want / l) : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f }
    }
    want -= l
  }
  return pts[0]
}

// ----------------------------------------------------------- shape paths
const f = (v: number) => String(Math.round(v * 1000) / 1000)

// shape_path: the outline of a flowchart shape in `r`, as SVG path data
// (the editor and the palette icons).
export function shapePathD(kind: string, r: Rect): string {
  const { x, y, w, h } = r
  const rect = (rx: number, ry: number, rw: number, rh: number) =>
    `M${f(rx)},${f(ry)}H${f(rx + rw)}V${f(ry + rh)}H${f(rx)}Z`
  const ellipse = (ex: number, ey: number, ew: number, eh: number) => {
    const rx = ew / 2
    const ry = eh / 2
    const cx = ex + rx
    const cy = ey + ry
    return `M${f(cx + rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 1 ${f(cx - rx)},${f(cy)}`
      + `A${f(rx)},${f(ry)} 0 1 1 ${f(cx + rx)},${f(cy)}Z`
  }
  if (kind === 'terminal') {
    const rr = Math.min(h / 2, w / 2)
    return `M${f(x + rr)},${f(y)}H${f(x + w - rr)}A${f(rr)},${f(rr)} 0 0 1 ${f(x + w - rr)},${f(y + h)}`
      + `H${f(x + rr)}A${f(rr)},${f(rr)} 0 0 1 ${f(x + rr)},${f(y)}Z`
  }
  if (kind === 'decision') {
    return `M${f(x + w / 2)},${f(y)}L${f(x + w)},${f(y + h / 2)}L${f(x + w / 2)},${f(y + h)}`
      + `L${f(x)},${f(y + h / 2)}Z`
  }
  if (kind === 'io') {
    const k = h * 0.35
    return `M${f(x + k)},${f(y)}L${f(x + w)},${f(y)}L${f(x + w - k)},${f(y + h)}L${f(x)},${f(y + h)}Z`
  }
  if (kind === 'document') {
    return `M${f(x)},${f(y)}L${f(x + w)},${f(y)}L${f(x + w)},${f(y + h * 0.82)}`
      + `C${f(x + w * 0.75)},${f(y + h * 0.6)} ${f(x + w * 0.25)},${f(y + h * 1.05)} ${f(x)},${f(y + h * 0.82)}Z`
  }
  if (kind === 'database') {
    const e = h * 0.18
    return rect(x, y + e / 2, w, h - e) + ellipse(x, y, w, e) + ellipse(x, y + h - e, w, e)
  }
  if (kind === 'connector') {
    const d = Math.min(w, h)
    return ellipse(x + (w - d) / 2, y + (h - d) / 2, d, d)
  }
  let p = rect(x, y, w, h)                          // process, subprocess, note
  if (kind === 'subprocess') p += rect(x + 5, y, w - 10, h)
  return p
}

// ------------------------------------------------- box text on the editor
const MATH_RE = /(?<!\\)\$(.+?)(?<!\\)\$|\\\((.+?)\\\)/g
const SCRIPT_RE = /([\^_])(\{[^{}]*\}|\\[A-Za-z]+|.)/g
const TEXT_ESCAPES: [string, string][] = [['\\%', '%'], ['\\&', '&'], ['\\_', '_'], ['\\#', '#'],
  ['\\{', '{'], ['\\}', '}'], ['\\$', '$'], ['~', '\u00a0'],
  ['---', '—'], ['--', '–']]

const SYMBOL_MAP = SYMBOLS as Record<string, string>

// html.escape(s, quote=False)
function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// A light, readable rendering of inline maths for the editor boxes (the
// preview shows the real typesetting).
function mathHtml(src: string): string {
  let s = src.replace(/\\[A-Za-z]+|\\[,; ]/g, m => SYMBOL_MAP[m] ?? m)
  s = escapeHtml(s)
  s = s.replace(SCRIPT_RE, (_m, op: string, arg: string) => {
    const tag = op === '^' ? 'sup' : 'sub'
    return `<${tag}>${arg.replace(/^[{}]+|[{}]+$/g, '')}</${tag}>`
  })
  return '<i>' + s.replaceAll('{', '').replaceAll('}', '') + '</i>'
}

function plainHtml(text: string): string {
  for (const [a, b] of TEXT_ESCAPES) text = text.replaceAll(a, b)
  return escapeHtml(text)
}

// Box text as it prints: maths rendered, escapes and dashes resolved.
export function prettyInlineHtml(text: string): string {
  const out: string[] = []
  let pos = 0
  for (const m of text.matchAll(MATH_RE)) {
    out.push(plainHtml(text.slice(pos, m.index)))
    out.push(mathHtml(m[1] ?? m[2]))
    pos = m.index + m[0].length
  }
  out.push(plainHtml(text.slice(pos)))
  return out.join('')
}

// NodeItem.paint: the whole box's HTML ("\\" starts a new line).
export function boxHtml(text: string): string {
  return text.replaceAll('\\\\', '\n').split('\n').map(prettyInlineHtml).join('<br>')
}
