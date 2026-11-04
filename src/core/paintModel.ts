// The drawing engine's document model: the vector items of
// khervedoc/paint/canvas.py (LineItem, ArrowItem, DimensionItem, RectItem,
// EllipseItem, RoundedRectItem, ArcShapeItem, PolygonItem, PathItem,
// TextItem, ImageItem, GroupItem) and the scene that holds them
// (PaintScene), as plain data.
//
// An item is exactly the dict khervedoc/paint/document.py item_to_dict
// writes (the .kpaint / clipboard / undo snapshot format), plus the
// transform origin Qt keeps on the QGraphicsItem (`_origin`). Geometry is
// item-local; `pos`, `rotation` and `scale` (about the origin) and the
// optional `matrix` place it in its parent, as QGraphicsItem does:
//     parent(p) = pos + origin + R·S·(M(p) − origin)
// No DOM here: the SVG writer/reader, the renderer and the PDF writer
// build on it and run in Vitest.

import {
  addEllipse, addRoundedRect, arcMoveTo, arcTo, bezierBounds, closeSubpath, cmdsBounds,
  type Cmd, type Pt, type Rect, rectCenter, rectUnion, mapRect, emptyRect, isEmptyRect,
  type Mat, matMul, IDENTITY, matFromParts, matIsIdentity, mapPt, lineTo, moveTo,
} from './paintGeom.ts'
import { pyRound } from './py.ts'

export * from './paintGeom.ts'

// ------------------------------------------------------------- tool ids
export const POINTER = 'pointer', PENCIL = 'pencil', LINE = 'line', RECT = 'rect', CIRCLE = 'circle',
  ELLIPSE = 'ellipse', TEXT = 'text'
export const BUCKET = 'bucket', ERASER = 'eraser', PICKER = 'picker'
export const PROTRACTOR = 'protractor'
export const ROOM = 'room'
export const ARROW = 'arrow', ROUNDRECT = 'roundrect'
export const DIMENSION = 'dimension'
export const HALFCIRCLE = 'halfcircle', QUARTERCIRCLE = 'quartercircle'
export const TRIANGLE = 'triangle', DIAMOND = 'diamond', PENTAGON = 'pentagon', HEXAGON = 'hexagon', STAR = 'star'
export const RIGHT_TRIANGLE = 'right_triangle', PARALLELOGRAM = 'parallelogram', TRAPEZOID = 'trapezoid'
export const HEPTAGON = 'heptagon', OCTAGON = 'octagon', STAR6 = 'star6'
export const PLUS = 'plus', CHEVRON = 'chevron', ARROW_RIGHT = 'arrow_right', LIGHTNING = 'lightning', HOUSE = 'house'
export const CHEM_SINGLE = 'chem_single', CHEM_DOUBLE = 'chem_double', CHEM_TRIPLE = 'chem_triple',
  CHEM_WEDGE = 'chem_wedge', CHEM_HASH = 'chem_hash'
export const CHEM_HBOND = 'chem_hbond'
export const CHEM_CHAIN = 'chem_chain'
export const CHEM_BENZENE = 'chem_benzene', CHEM_CYCLOHEXANE = 'chem_cyclohexane', CHEM_CYCLOPENTANE = 'chem_cyclopentane'
export const CHEM_ATOM = 'chem_atom'
export const CHEM_BOND_TOOLS = [CHEM_SINGLE, CHEM_DOUBLE, CHEM_TRIPLE, CHEM_WEDGE, CHEM_HASH, CHEM_HBOND]
export const CHEM_RING_TOOLS = [CHEM_BENZENE, CHEM_CYCLOHEXANE, CHEM_CYCLOPENTANE]
export const CHEM_PLACE_TOOLS = [...CHEM_RING_TOOLS, CHEM_ATOM]
export const CHEM_TOOLS = [...CHEM_BOND_TOOLS, ...CHEM_PLACE_TOOLS, CHEM_CHAIN]
export const ELEC_PLACE = 'elec_place', OPTICS_PLACE = 'optics_place', LABWARE_PLACE = 'labware_place',
  FLOW_PLACE = 'flow_place', ARROW_PLACE = 'arrow_place', MATH_PLACE = 'math_place'
export const PLACE_TOOLS = [ELEC_PLACE, OPTICS_PLACE, LABWARE_PLACE, FLOW_PLACE, ARROW_PLACE, MATH_PLACE]

// Parametric polygons created by dragging a bounding rect — all of these
// are vertex polygons, so they explode into their edge lines.
export const POLYGON_KINDS = [TRIANGLE, RIGHT_TRIANGLE, DIAMOND, PARALLELOGRAM,
  TRAPEZOID, PENTAGON, HEXAGON, HEPTAGON, OCTAGON, STAR,
  STAR6, PLUS, CHEVRON, ARROW_RIGHT, LIGHTNING, HOUSE]

// Custom polygons given as fractional (x, y) vertices within the rect.
const POLY_FRACTIONS: Record<string, [number, number][]> = {
  [TRIANGLE]: [[0.5, 0], [1, 1], [0, 1]],
  [RIGHT_TRIANGLE]: [[0, 0], [0, 1], [1, 1]],
  [DIAMOND]: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  [PARALLELOGRAM]: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]],
  [TRAPEZOID]: [[0.25, 0], [0.75, 0], [1, 1], [0, 1]],
  [PLUS]: [[0.34, 0], [0.66, 0], [0.66, 0.34], [1, 0.34], [1, 0.66],
    [0.66, 0.66], [0.66, 1], [0.34, 1], [0.34, 0.66], [0, 0.66],
    [0, 0.34], [0.34, 0.34]],
  [CHEVRON]: [[0, 0], [0.6, 0], [1, 0.5], [0.6, 1], [0, 1], [0.4, 0.5]],
  [ARROW_RIGHT]: [[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1],
    [0.6, 0.7], [0, 0.7]],
  [LIGHTNING]: [[0.6, 0], [0, 0.6], [0.35, 0.6], [0.15, 1], [1, 0.35],
    [0.55, 0.35], [0.75, 0]],
  [HOUSE]: [[0.5, 0], [1, 0.45], [1, 1], [0, 1], [0, 0.45]],
}
// Regular polygons by number of sides.
const POLY_SIDES: Record<string, number> = { [PENTAGON]: 5, [HEXAGON]: 6, [HEPTAGON]: 7, [OCTAGON]: 8 }
// Parametric arc shapes created by dragging a bounding rect.
export const ARC_KINDS = [HALFCIRCLE, QUARTERCIRCLE]
// Tools defined by two points (drag start -> end).
export const TWO_POINT_TOOLS = [LINE, ARROW, DIMENSION]
// Tools defined by a dragged bounding rect.
export const RECT_TOOLS = [RECT, ROOM, CIRCLE, ELLIPSE, ROUNDRECT, ...POLYGON_KINDS, ...ARC_KINDS]
// Tools that rubber-band a new vector item between press and release.
export const SHAPE_TOOLS = [...TWO_POINT_TOOLS, ...RECT_TOOLS]

// Qt picks the platform sans-serif when the family is missing; naming one
// keeps documents consistent across machines that do have it.
export const DEFAULT_FONT_FAMILY = 'Helvetica'
// QFont() — the application font the symbol libraries' text uses.
export const APP_FONT_FAMILY = 'Sans Serif'

// ------------------------------------------------------------- colours
// A colour as QColor keeps it: 8-bit RGB and a 16-bit alpha (alphaF is
// alpha16 / 65535, which is what Python prints with :g).
export interface Color { r: number; g: number; b: number; a16: number }

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080',
  darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
  orange: '#ffa500', purple: '#800080', brown: '#a52a2a', pink: '#ffc0cb', navy: '#000080',
  teal: '#008080', maroon: '#800000', olive: '#808000', lime: '#00ff00', silver: '#c0c0c0',
  gold: '#ffd700', steelblue: '#4682b4', skyblue: '#87ceeb', darkblue: '#00008b',
  darkred: '#8b0000', darkgreen: '#006400', lightblue: '#add8e6', lightgreen: '#90ee90',
  transparent: '#00000000',
}

// QColor(str): #rgb, #rrggbb, #aarrggbb, #rrrgggbbb, SVG names; null when
// invalid.
export function parseColor(s: string | null | undefined): Color | null {
  if (s === null || s === undefined) return null
  let v = String(s).trim().toLowerCase()
  if (v in NAMED) {
    if (v === 'transparent') return { r: 0, g: 0, b: 0, a16: 0 }
    v = NAMED[v]
  }
  if (!v.startsWith('#')) return null
  const h = v.slice(1)
  if (!/^[0-9a-f]+$/.test(h)) return null
  if (h.length === 3) {
    return { r: parseInt(h[0], 16) * 17, g: parseInt(h[1], 16) * 17, b: parseInt(h[2], 16) * 17, a16: 65535 }
  }
  if (h.length === 6) {
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a16: 65535 }
  }
  if (h.length === 8) {
    return { r: parseInt(h.slice(2, 4), 16), g: parseInt(h.slice(4, 6), 16), b: parseInt(h.slice(6, 8), 16),
      a16: parseInt(h.slice(0, 2), 16) * 257 }
  }
  if (h.length === 9) {
    return { r: parseInt(h.slice(0, 3), 16) >> 4, g: parseInt(h.slice(3, 6), 16) >> 4, b: parseInt(h.slice(6, 9), 16) >> 4, a16: 65535 }
  }
  if (h.length === 12) {
    return { r: parseInt(h.slice(0, 4), 16) >> 8, g: parseInt(h.slice(4, 8), 16) >> 8, b: parseInt(h.slice(8, 12), 16) >> 8, a16: 65535 }
  }
  return null
}

// QColor(str) with Qt's invalid colour read as black (an invalid QColor
// paints and names as black).
export function color(s: string | null | undefined, fallback = '#000000'): Color {
  return parseColor(s) ?? parseColor(fallback) ?? { r: 0, g: 0, b: 0, a16: 65535 }
}

const hx = (n: number) => n.toString(16).padStart(2, '0')
// QColor.name()
export const colorName = (c: Color): string => `#${hx(c.r)}${hx(c.g)}${hx(c.b)}`
// QColor.name(QColor.HexArgb)
export const colorArgb = (c: Color): string => `#${hx(c.a16 >> 8)}${hx(c.r)}${hx(c.g)}${hx(c.b)}`
export const alphaF = (c: Color): number => c.a16 / 65535
export function withAlphaF(c: Color, a: number): Color {
  return { ...c, a16: Math.round(Math.max(0, Math.min(1, a)) * 65535) }
}
export const alpha8 = (c: Color): number => c.a16 >> 8
// CSS rgba() for drawing.
export function cssColor(c: Color, extraAlpha = 1): string {
  return `rgba(${c.r},${c.g},${c.b},${+(alphaF(c) * extraAlpha).toFixed(4)})`
}

// ------------------------------------------------------------- pens / brushes
export type Dash = 'solid' | 'dash' | 'dot' | 'dashdot'
// document._pen_to_dict: colour as #aarrggbb, width, optional dash / none.
export interface PenDict { color: string; width: number; dash?: Dash; none?: boolean }
export interface GradSpec { kind: string; c1: string; c2: string; angle: number }
export type BrushDict = null | { color: string } | { gradient: GradSpec }

export const DASH_STYLES: Dash[] = ['solid', 'dash', 'dot', 'dashdot']
// QPen.dashPattern() in pen widths.
export const DASH_PATTERNS: Record<Dash, number[]> = {
  solid: [], dash: [4, 2], dot: [1, 2], dashdot: [4, 2, 1, 2],
}

export function pen(colorStr = '#ff1a1a1a', width = 2, dash: Dash = 'solid'): PenDict {
  const p: PenDict = { color: colorArgb(color(colorStr)), width }
  if (dash !== 'solid') p.dash = dash
  return p
}
export const NO_PEN: PenDict = { color: '#ff000000', width: 1, none: true }
export const penIsNone = (p: PenDict): boolean => !!p.none
export const penDash = (p: PenDict): Dash => p.dash ?? 'solid'

// --------------------------------------------------------- gradients
// Two-stop gradient fills (gradient.py): ObjectBoundingMode coordinates.
export const FILL_STYLES = ['solid', 'linear', 'radial', 'sun']
export const SUN_CENTER: Pt = { x: 0.35, y: 0.35 }
export const SUN_FOCAL: Pt = { x: 0.25, y: 0.25 }
export const SUN_RADIUS = 0.95

// (x1, y1, x2, y2) of a linear gradient at `angle` degrees inside the unit
// box: 0 = left->right, 90 = top->bottom (y grows down).
export function anglePoints(angle: number): [number, number, number, number] {
  const rad = angle * Math.PI / 180
  const dx = Math.cos(rad) / 2
  const dy = Math.sin(rad) / 2
  return [0.5 - dx, 0.5 - dy, 0.5 + dx, 0.5 + dy]
}

// The brush a gradient spec makes, read back as the spec (brush_spec
// after brush_from_spec): colours through QColor, the linear angle
// through the stop points and round(…, 2) % 360.
export function normaliseSpec(spec: Partial<GradSpec>): GradSpec {
  const kind = spec.kind ?? 'linear'
  const c1 = colorArgb(color(spec.c1 ?? '#ff4aa3ff'))
  const c2 = colorArgb(color(spec.c2 ?? '#ffffffff'))
  if (kind === 'radial') return { c1, c2, angle: 90.0, kind: 'radial' }
  if (kind === 'sun') return { c1, c2, angle: 90.0, kind: 'sun' }
  if (kind !== 'linear') return { c1, c2, angle: 90.0, kind: '' }   // a solid brush
  const [x1, y1, x2, y2] = anglePoints(Number(spec.angle ?? 90.0))
  const dx = x2 - x1
  const dy = y2 - y1
  let angle = 90.0
  if (dx || dy) angle = pyMod(pyRound(Math.atan2(dy, dx) * 180 / Math.PI, 2), 360)
  return { c1, c2, angle, kind: 'linear' }
}

// Python's float % (the result takes the divisor's sign).
export function pyMod(a: number, b: number): number {
  const r = a % b
  if (r === 0) return b < 0 ? -0 : 0
  return (r < 0) !== (b < 0) ? r + b : r
}

// gradient.brush_for: a brush dict for a fill style.
export function brushFor(style: string, c1: string, c2: string, angle = 90.0): BrushDict {
  if (style === 'linear' || style === 'radial' || style === 'sun') {
    return { gradient: normaliseSpec({ kind: style, c1, c2, angle }) }
  }
  return { color: colorArgb(color(c1)) }
}

// document._brush_from_dict, normalised the way a round trip through a
// QBrush normalises it.
export function brushFromDict(d: unknown): BrushDict {
  if (!d || typeof d !== 'object' || Object.keys(d).length === 0) return null
  const o = d as Record<string, unknown>
  if ('gradient' in o) {
    const spec = normaliseSpec(o.gradient as Partial<GradSpec>)
    return spec.kind ? { gradient: spec } : { color: spec.c1 }
  }
  return { color: colorArgb(color((o.color as string) ?? '#ff4aa3ff')) }
}

export function penFromDict(d: unknown): PenDict {
  const o = (d ?? {}) as Record<string, unknown>
  if (o.none) return { ...NO_PEN }
  const p: PenDict = { color: colorArgb(color((o.color as string) ?? '#ff1a1a1a')), width: Number(o.width ?? 2) }
  const dash = (o.dash as Dash) ?? 'solid'
  if (dash !== 'solid' && DASH_STYLES.includes(dash)) p.dash = dash
  return p
}

// ------------------------------------------------------------- items
export interface Common {
  pos: Pt
  opacity: number
  rotation: number
  z: number
  scale: number
  symbol?: string
  // QGraphicsItem.transform() (a group's X/Y-only resize, an image's
  // scale) as [m11, m12, m21, m22, dx, dy].
  matrix?: number[]
  // QGraphicsItem.transformOriginPoint(); not saved (center_origin
  // recomputes it on load).
  _origin?: Pt
}

export interface LabelFields {
  label?: string
  labelColor?: string
  labelFamily?: string
  labelSize?: number
  labelBold?: boolean
  labelItalic?: boolean
}

export interface LineItem extends Common {
  type: 'line' | 'arrow' | 'dimension'
  pen: PenDict
  x1: number; y1: number; x2: number; y2: number
  bend?: [number, number]
  head?: string
  // dimension style
  capStyle?: string
  extension?: boolean
  dash?: boolean
  unit?: string
  decimals?: number
  prefix?: string
  suffix?: string
}
export interface BoxItem extends Common, LabelFields {
  type: 'rect' | 'ellipse' | 'roundrect' | 'arc'
  pen: PenDict
  brush: BrushDict
  x: number; y: number; w: number; h: number
  radius?: number
  kind?: string
  flipH?: boolean
  flipV?: boolean
}
export interface PolygonItem extends Common, LabelFields {
  type: 'polygon'
  pen: PenDict
  brush: BrushDict
  kind: string
  points: [number, number][]
}
export interface PathItem extends Common {
  type: 'path'
  pen: PenDict
  brush: BrushDict
  cmds: Cmd[]
}
export interface TextItem extends Common {
  type: 'text'
  text: string
  color: string
  family: string
  size: number
  bold: boolean
  italic: boolean
}
export interface ImageItem extends Common {
  type: 'image'
  image: string        // base64 PNG
  // pixel size of the PNG (read from its header)
  _w?: number
  _h?: number
}
export interface GroupItem extends Common {
  type: 'group'
  children: Item[]
  [extra: string]: unknown
}

export type Item = LineItem | BoxItem | PolygonItem | PathItem | TextItem | ImageItem | GroupItem

export function common(o: Partial<Common> = {}): Common {
  return { pos: o.pos ?? { x: 0, y: 0 }, opacity: o.opacity ?? 1.0, rotation: o.rotation ?? 0.0,
    z: o.z ?? 0.0, scale: o.scale ?? 1.0, ...(o.symbol ? { symbol: o.symbol } : {}),
    ...(o.matrix ? { matrix: o.matrix } : {}) }
}

export function makeLine(type: 'line' | 'arrow' | 'dimension', x1: number, y1: number, x2: number, y2: number,
  p: PenDict = pen()): LineItem {
  const it: LineItem = { type, pen: p, x1, y1, x2, y2, ...common() }
  if (type === 'arrow') it.head = 'filled'
  if (type === 'dimension') {
    Object.assign(it, { capStyle: 'arrows', extension: false, dash: false, unit: 'mm', decimals: 1, prefix: '', suffix: '' })
  }
  return it
}
export function makeBox(type: BoxItem['type'], r: Rect, p: PenDict = pen(), b: BrushDict = null): BoxItem {
  const it: BoxItem = { type, pen: p, brush: b, x: r.x, y: r.y, w: r.w, h: r.h, ...common() }
  if (type === 'roundrect') it.radius = 12.0
  if (type === 'arc') { it.kind = HALFCIRCLE; it.flipH = false; it.flipV = false }
  return it
}
export function makePolygon(kind: string, points: [number, number][], p: PenDict = pen(), b: BrushDict = null): PolygonItem {
  return { type: 'polygon', pen: p, brush: b, kind, points, ...common() }
}
export function makePath(cmds: Cmd[], p: PenDict = pen(), b: BrushDict = null): PathItem {
  return { type: 'path', pen: p, brush: b, cmds, ...common() }
}
export function makeText(text = 'Text', o: Partial<TextItem> = {}): TextItem {
  return { type: 'text', text, color: o.color ?? '#ff1a1a1a', family: o.family ?? DEFAULT_FONT_FAMILY,
    size: o.size ?? 14, bold: o.bold ?? false, italic: o.italic ?? false, ...common(o) }
}
export function makeGroup(children: Item[] = []): GroupItem {
  return { type: 'group', children, ...common() }
}

export const LABELLED = new Set(['rect', 'ellipse', 'roundrect', 'arc', 'polygon'])
export const hasLabel = (it: Item): boolean => LABELLED.has(it.type) && !!(it as LabelFields).label
export const isLine = (it: Item): it is LineItem => it.type === 'line' || it.type === 'arrow' || it.type === 'dimension'
export const hasPen = (it: Item): it is LineItem | BoxItem | PolygonItem | PathItem =>
  isLine(it) || it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc'
  || it.type === 'polygon' || it.type === 'path'
export const fillable = (it: Item): it is BoxItem | PolygonItem | PathItem =>
  it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc'
  || it.type === 'polygon' || it.type === 'path'

// Label defaults (LabelMixin class attributes).
export const LABEL_DEFAULTS = { family: DEFAULT_FONT_FAMILY, size: 14, bold: false, italic: false, color: '#1a1a1a' }

// ------------------------------------------------------------- geometry
// polygon_for_kind: vertices of a parametric polygon `kind` inscribed in `rect`.
export function polygonForKind(kind: string, r: Rect): [number, number][] {
  const left = r.x
  const top = r.y
  const w = r.w
  const h = r.h
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const rx = w / 2
  const ry = h / 2
  if (kind in POLY_FRACTIONS) return POLY_FRACTIONS[kind].map(([fx, fy]) => [left + fx * w, top + fy * h])
  if (kind === STAR || kind === STAR6) {
    const points = kind === STAR ? 5 : 6
    const pts: [number, number][] = []
    for (let i = 0; i < points * 2; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / points
      const scale = i % 2 === 0 ? 1.0 : 0.4
      pts.push([cx + rx * scale * Math.cos(ang), cy + ry * scale * Math.sin(ang)])
    }
    return pts
  }
  const sides = POLY_SIDES[kind] ?? 6                  // regular polygon
  const pts: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const ang = -Math.PI / 2 + i * 2 * Math.PI / sides
    pts.push([cx + rx * Math.cos(ang), cy + ry * Math.sin(ang)])
  }
  return pts
}

// arc_path: a half- or quarter-disc filling `rect` (with optional flips).
export function arcPath(kind: string, r: Rect, flipH = false, flipV = false): Cmd[] {
  let path: Cmd[] = []
  if (r.w <= 0 || r.h <= 0) return path
  if (kind === HALFCIRCLE) {
    // flat side on the bottom edge, arc bulging up over the top
    const ell = { x: r.x, y: r.y, w: r.w, h: r.h * 2 }
    path = arcMoveTo(path, ell, 0)
    path = arcTo(path, ell, 0, 180)
    path = closeSubpath(path)
  } else {                                   // quarter: corner at bottom-left
    const ell = { x: r.x - r.w, y: r.y, w: r.w * 2, h: r.h * 2 }
    path = moveTo(path, r.x, r.y + r.h)
    path = arcTo(path, ell, 0, 90)
    path = closeSubpath(path)
  }
  if (flipH || flipV) {
    const c = rectCenter(r)
    // translate(c) · scale(±1) · translate(−c), as QTransform builds it
    const sx = flipH ? -1 : 1
    const sy = flipV ? -1 : 1
    const m: Mat = [sx, 0, 0, sy, c.x + sx * -c.x, c.y + sy * -c.y]
    path = path.map(cmd => mapCmd(cmd, m))
  }
  return path
}

export function mapCmd(c: Cmd, m: Mat): Cmd {
  if (c[0] === 'C') {
    const a = mapPt(m, { x: c[1], y: c[2] })
    const b = mapPt(m, { x: c[3], y: c[4] })
    const e = mapPt(m, { x: c[5], y: c[6] })
    return ['C', a.x, a.y, b.x, b.y, e.x, e.y]
  }
  const p = mapPt(m, { x: c[1], y: c[2] })
  return [c[0], p.x, p.y]
}

// The rounded rect's path (RoundedRectItem._rebuild).
export function roundRectPath(it: BoxItem): Cmd[] {
  const r = Math.min(it.radius ?? 12, it.w / 2, it.h / 2)
  return addRoundedRect([], { x: it.x, y: it.y, w: it.w, h: it.h }, r, r)
}

// An item's outline in item-local coordinates (what it draws / fills).
export function outlinePath(it: Item): Cmd[] | null {
  switch (it.type) {
    case 'rect': return rectPath({ x: it.x, y: it.y, w: it.w, h: it.h })
    case 'ellipse': return addEllipse([], { x: it.x, y: it.y, w: it.w, h: it.h })
    case 'roundrect': return roundRectPath(it)
    case 'arc': return arcPath(it.kind ?? HALFCIRCLE, { x: it.x, y: it.y, w: it.w, h: it.h }, it.flipH, it.flipV)
    case 'polygon': {
      if (!it.points.length) return []
      let p: Cmd[] = []
      it.points.forEach(([x, y], i) => { p = i === 0 ? moveTo(p, x, y) : lineTo(p, x, y) })
      return closeSubpath(lineTo(p, it.points[0][0], it.points[0][1]))
    }
    case 'path': return it.cmds
    default: return null
  }
}

export function rectPath(r: Rect): Cmd[] {
  return [['M', r.x, r.y], ['L', r.x + r.w, r.y], ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h], ['L', r.x, r.y]]
}

// LineItem.curve_path: the straight segment, or the quadratic curve through
// the bend control point (as the cubic QPainterPath.quadTo makes).
export function curvePath(it: LineItem): Cmd[] {
  const p: Cmd[] = [['M', it.x1, it.y1]]
  if (it.bend) {
    const [bx, by] = it.bend
    // QPainterPath.quadTo's cubic
    p.push(['C', (it.x1 + 2 * bx) / 3, (it.y1 + 2 * by) / 3, (it.x2 + 2 * bx) / 3, (it.y2 + 2 * by) / 3, it.x2, it.y2])
  } else if (!(it.x2 === it.x1 && it.y2 === it.y1)) {
    p.push(['L', it.x2, it.y2])
  }
  return p
}

export const lineLength = (it: LineItem): number => Math.hypot(it.x2 - it.x1, it.y2 - it.y1)

// Direction (radians) the line arrives at p2 — the curve's end tangent when
// bent, so arrowheads follow the curve.
export function endAngle(it: LineItem): number {
  if (it.bend) {
    const vx = it.x2 - it.bend[0]
    const vy = it.y2 - it.bend[1]
    if (Math.abs(vx) > 1e-9 || Math.abs(vy) > 1e-9) return Math.atan2(vy, vx)
  }
  return Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
}

// Direction the line leaves p1, pointing backwards (for a tail head).
export function startAngle(it: LineItem): number {
  const ref = it.bend ?? [it.x2, it.y2]
  return Math.atan2(it.y1 - ref[1], it.x1 - ref[0])
}

export const ARROW_HEAD = 14
export const DIM_HEAD = 10
export const DIM_LABEL_PAD = 60

// ------------------------------------------------------------- text metrics
// QGraphicsTextItem lays plain text out with a 4 px document margin. Font
// metrics come from the host (canvas measureText in the app); the default
// estimates Helvetica so the core runs without a DOM.
export interface TextMetrics { width(text: string, font: FontSpec): number; ascent(font: FontSpec): number; lineHeight(font: FontSpec): number }
export interface FontSpec { family: string; px: number; bold: boolean; italic: boolean }

let metrics: TextMetrics = {
  width: (t, f) => t.length * f.px * (f.bold ? 0.6 : 0.55),
  ascent: f => f.px * 0.77,
  lineHeight: f => f.px * 1.15,
}
export function setTextMetrics(m: TextMetrics): void { metrics = m }
export function textMetrics(): TextMetrics { return metrics }

export const TEXT_MARGIN = 4
export function textFont(it: TextItem): FontSpec {
  return { family: it.family, px: it.size, bold: it.bold, italic: it.italic }
}
export function textLines(text: string): string[] {
  return text.split(/\r\n|\r|\n|\u2028|\u2029/)
}
// QGraphicsTextItem.boundingRect()
export function textBounds(it: TextItem): Rect {
  const f = textFont(it)
  const lines = textLines(it.text)
  const w = Math.max(...lines.map(l => metrics.width(l, f)), 0)
  return { x: 0, y: 0, w: w + 2 * TEXT_MARGIN + 1, h: lines.length * metrics.lineHeight(f) + 2 * TEXT_MARGIN }
}

// ------------------------------------------------------------- bounds
const halfPen = (p: PenDict) => (p.none ? 0 : p.width / 2)

// QGraphicsItem.boundingRect() in item-local coordinates.
export function boundingRect(it: Item): Rect {
  switch (it.type) {
    case 'line': case 'arrow': case 'dimension': {
      const w = it.pen.width / 2 + 1
      let r = adj(curveBounds(it), -w)
      if (it.type === 'arrow') r = adj(r, -(ARROW_HEAD + it.pen.width))
      if (it.type === 'dimension') r = adj(r, -(DIM_HEAD + it.pen.width + DIM_LABEL_PAD))
      return r
    }
    case 'rect': case 'ellipse':
      return adj({ x: it.x, y: it.y, w: it.w, h: it.h }, -halfPen(it.pen))
    case 'roundrect': case 'arc': case 'path': {
      const path = outlinePath(it)!
      if (!path.length) return emptyRect()
      // A hollow shape is its stroke (whose offset curves hug the path); a
      // filled or labelled one also takes in the path's control points
      // (QGraphicsPathItem's shape().controlPointRect()).
      const hollow = it.brush === null && !(it as LabelFields).label
      return adj(cmdsBounds(path, !hollow), -halfPen(it.pen))
    }
    case 'polygon': {
      if (!it.points.length) return emptyRect()
      const xs = it.points.map(p => p[0])
      const ys = it.points.map(p => p[1])
      const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
      return adj(r, -halfPen(it.pen))
    }
    case 'text': return textBounds(it)
    case 'image': return { x: 0, y: 0, w: it._w ?? 0, h: it._h ?? 0 }
    case 'group': {
      let r: Rect | null = null
      for (const c of it.children) {
        const cr = mapRect(itemToParent(c), boundingRect(c))
        r = r ? rectUnion(r, cr) : cr
      }
      return r ?? emptyRect()
    }
  }
}

function curveBounds(it: LineItem): Rect {
  if (!it.bend) {
    const x = Math.min(it.x1, it.x2)
    const y = Math.min(it.y1, it.y2)
    return { x, y, w: Math.abs(it.x2 - it.x1), h: Math.abs(it.y2 - it.y1) }
  }
  const c = curvePath(it)[1] as ['C', number, number, number, number, number, number]
  return bezierBounds({ x: it.x1, y: it.y1 }, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, { x: c[5], y: c[6] })
}

function adj(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d }
}

// center_origin: rotate / scale about the item's own centre.
export function centerOrigin(it: Item): void {
  it._origin = rectCenter(boundingRect(it))
}

// The item's local -> parent transform (QGraphicsItem.itemTransform(parent),
// sceneTransform() for a top-level item).
export function itemToParent(it: Item): Mat {
  const o = it._origin ?? { x: 0, y: 0 }
  const m = it.matrix ? matFromParts(it.matrix) : IDENTITY
  const rad = it.rotation * Math.PI / 180
  // Qt's QTransform.rotate snaps exact quarter turns.
  let cos = Math.cos(rad)
  let sin = Math.sin(rad)
  const rot = ((it.rotation % 360) + 360) % 360
  if (rot === 0) { cos = 1; sin = 0 } else if (rot === 90) { cos = 0; sin = 1 }
  else if (rot === 180) { cos = -1; sin = 0 } else if (rot === 270) { cos = 0; sin = -1 }
  const s = it.scale
  // Qt's computedFullTransform: p -> −o -> S -> R -> +o -> transform() -> +pos
  let t: Mat = [1, 0, 0, 1, -o.x, -o.y]
  t = matMul(t, [s, 0, 0, s, 0, 0])
  t = matMul(t, [cos, sin, -sin, cos, 0, 0])
  t = matMul(t, [1, 0, 0, 1, o.x, o.y])
  t = matMul(t, m)
  t = matMul(t, [1, 0, 0, 1, it.pos.x, it.pos.y])
  return t
}

export function sceneBoundingRect(it: Item): Rect {
  return mapRect(itemToParent(it), boundingRect(it))
}

export function hasSimpleTransform(it: Item): boolean {
  return Math.abs(it.scale - 1) <= 1e-4 && (!it.matrix || matIsIdentity(matFromParts(it.matrix)))
}

// ------------------------------------------------------------- the scene
export interface Scene {
  width: number
  height: number
  dpi: number
  gridMm: number
  showGrid: boolean
  snap: boolean
  infinite: boolean
  // The raster layer as a base64 PNG, or null for a blank white page.
  raster: string | null
  rasterW?: number
  rasterH?: number
  // Top-level vector items, bottom to top (vector_items()).
  items: Item[]
}

export function newScene(width = 800, height = 600): Scene {
  return { width, height, dpi: 96, gridMm: 1.0, showGrid: false, snap: true, infinite: true,
    raster: null, items: [] }
}

// vector_items(): bottom to top, a stable sort on z.
export function vectorItems(s: Scene): Item[] {
  return [...s.items].map((it, i) => ({ it, i })).sort((a, b) => a.it.z - b.it.z || a.i - b.i).map(x => x.it)
}

// grid_size: exact pixel spacing between grid lines.
export function gridSize(s: Scene): number {
  return Math.max(1e-6, s.gridMm / 25.4 * s.dpi)
}

// snap: floor(x/g + 0.5) rounds half-up.
export function snap(s: Scene, p: Pt): Pt {
  const g = gridSize(s)
  return { x: Math.floor(p.x / g + 0.5) * g, y: Math.floor(p.y / g + 0.5) * g }
}

// export.content_rect: the tight bounding box of what is drawn.
export function contentRect(s: Scene): Rect {
  let r: Rect = emptyRect()
  for (const it of vectorItems(s)) {
    const b = sceneBoundingRect(it)
    r = isEmptyRect(r) ? b : rectUnion(r, b)
  }
  if (s.raster) {
    const page = { x: 0, y: 0, w: s.width, h: s.height }
    r = isEmptyRect(r) ? page : rectUnion(r, page)
  }
  return r
}

export const MARGIN = 6.0

// Deep copy (snapshots, clipboard).
export function cloneItem<T extends Item>(it: T): T {
  return structuredClone(it)
}

export function leaves(items: Item[]): Item[] {
  const out: Item[] = []
  for (const it of items) {
    if (it.type === 'group') out.push(...leaves(it.children))
    else out.push(it)
  }
  return out
}

export { matMul, mapPt, IDENTITY, mapRect, rectUnion }
