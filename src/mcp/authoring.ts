// Drawings described as plain JSON shapes, for Claude over MCP
// (khervedoc/paint/authoring.py).
//
// A small, stable schema in millimetres (origin top-left, y down) that a
// language model can author without knowing the canvas classes:
//
//     {"type": "rect", "x": 10, "y": 10, "w": 40, "h": 15,
//      "fill": "#eef2f6", "label": "Start"}
//
// `addShapes` turns such a list into canvas items on a scene;
// `sceneToShapes` reads a scene back into the same schema (anything it
// cannot express comes back as {"type": "other", ...}).
import {
  centerOrigin, color, colorArgb, colorName, contentRect, DASH_STYLES, isEmptyRect, leaves, makeBox, makeLine,
  makePath, makePolygon, makeText, MARGIN, newScene, NO_PEN, parseColor, pen, penDash, rectCenter,
  sceneBoundingRect, textBounds, TEXT_MARGIN, vectorItems,
  type BoxItem, type BrushDict, type Cmd, type Dash, type Item, type LabelFields, type PenDict, type Rect,
  type Scene, type TextItem,
} from '../core/paintModel.ts'
import { dropItems, specToItem } from '../core/paintOps.ts'
import { sceneToPdf } from '../core/paintPdf.ts'
import { sceneToSvg } from '../core/paintRender.ts'
import { saveSvg } from '../core/paintSvg.ts'
import { SYMBOL_MODULES, type SymbolModule } from '../core/paintSymbols.ts'
import { pyRound } from '../core/py.ts'

// Symbol libraries usable as {"type": "symbol", "symbol": "lib/name"}.
export const LIBRARIES = ['flowchart', 'electrical', 'optics', 'maths', 'labware', 'arrows'] as const

export const SHAPE_TYPES = ['rect', 'rounded_rect', 'ellipse', 'circle', 'line', 'arrow', 'double_arrow',
  'polygon', 'polyline', 'text', 'symbol']

// Same symbol scale as the drawing dialog, so an MCP-made symbol matches
// one the user drops by hand.
const SYMBOL_PAGE_PX = 900
const SYMBOL_MIN_PX = 90

// canvas.ARROW_HEADS
const ARROW_HEADS = ['filled', 'open', 'stealth', 'double']

export class ShapeError extends Error {}

type Spec = Record<string, unknown>

export function authoringScene(): Scene {
  const scene = newScene(900, 600)
  scene.infinite = true
  scene.showGrid = false
  scene.snap = false
  return scene
}

function pxPerMm(scene: Scene): number {
  return (scene.dpi || 96) / 25.4
}

function library(name: string): SymbolModule {
  if (!(LIBRARIES as readonly string[]).includes(name)) {
    throw new ShapeError(`Unknown symbol library ${pyRepr(name)}; use one of ${LIBRARIES.join(', ')}.`)
  }
  return SYMBOL_MODULES[name as keyof typeof SYMBOL_MODULES]
}

// repr() of a JSON value, as the Python messages quote it.
function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'string') return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replaceAll("'", "\\'")}'`
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export interface SymbolEntry { name: string; label: string; default_size_mm: number[] }
export type SymbolLibraries = Record<string, { reference: string; categories: Record<string, SymbolEntry[]> }>

export function listSymbols(): SymbolLibraries {
  const out: SymbolLibraries = {}
  for (const lib of LIBRARIES) {
    const mod = library(lib)
    const labels = mod.LABELS ?? {}
    const cats = mod.CATEGORIES ?? [['', Object.keys(mod.SIZES)]]
    const categories: Record<string, SymbolEntry[]> = {}
    for (const [cat, names] of cats) {
      categories[cat || 'all'] = names.map(n => ({
        name: n, label: labels[n] ?? n.replaceAll('_', ' '),
        default_size_mm: defaultSymbolMm(mod, n).map(v => pyRound(v, 1)),
      }))
    }
    out[lib] = { reference: `${lib}/<name>`, categories }
  }
  return out
}

function defaultSymbolPx(mod: SymbolModule, name: string): [number, number] {
  const [wMm, hMm] = mod.sizeMm(name)
  const scale = SYMBOL_PAGE_PX / (mod.REFERENCE_MM ?? 4800.0)
  let w = wMm * scale
  let h = hMm * scale
  if (Math.max(w, h) > 0 && Math.max(w, h) < SYMBOL_MIN_PX) {
    const k = SYMBOL_MIN_PX / Math.max(w, h)
    w *= k
    h *= k
  }
  return [w, h]
}

function defaultSymbolMm(mod: SymbolModule, name: string): [number, number] {
  const [w, h] = defaultSymbolPx(mod, name)
  const k = 96 / 25.4
  return [w / k, h / k]
}

// ------------------------------------------------------------ building

const has = (spec: Spec, key: string) => Object.prototype.hasOwnProperty.call(spec, key)
const get = (spec: Spec, key: string, dflt: unknown = undefined) => (has(spec, key) ? spec[key] : dflt)

function pyFloat(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (Number.isNaN(n)) throw new TypeError(`float() argument must be a string or a real number, not ${pyRepr(v)}`)
  return n
}

// QColor(str(value)) as the ARGB name the model keeps.
function qcolor(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const c = parseColor(String(value))
  if (!c) throw new ShapeError(`Not a colour: ${pyRepr(value)} (use #rrggbb).`)
  return colorArgb(c)
}

function penOf(spec: Spec, k: number): PenDict {
  const stroke = get(spec, 'stroke', '#1a1a1a')
  if (stroke === null || String(stroke).toLowerCase() === 'none') return { ...NO_PEN }
  const c = qcolor(stroke)!
  const width = Math.max(0.05, pyFloat(get(spec, 'width', 0.5))) * k
  const dash = String(get(spec, 'dash', 'solid')).toLowerCase()
  if (!(DASH_STYLES as string[]).includes(dash)) {
    throw new ShapeError(`dash must be one of ${DASH_STYLES.join(', ')}.`)
  }
  return pen(c, width, dash as Dash)
}

function brushOf(spec: Spec): BrushDict {
  const fill = get(spec, 'fill')
  if (fill === null || fill === undefined || String(fill).toLowerCase() === 'none') return null
  return { color: qcolor(fill)! }
}

interface Font { family: string; size: number; bold: boolean; italic: boolean }

function fontOf(spec: Spec, defaultPt = 11.0): Font {
  return {
    family: 'Helvetica',
    size: Math.max(1.0, pyFloat(get(spec, 'font_size', defaultPt))),
    bold: Boolean(get(spec, 'bold', false)),
    italic: Boolean(get(spec, 'italic', false)),
  }
}

function num(spec: Spec, key: string, dflt?: number): number {
  const v = get(spec, key, dflt)
  if (v === null || v === undefined) throw new ShapeError(`${pyStr(get(spec, 'type'))} needs \`${key}\`.`)
  try {
    return pyFloat(v)
  } catch {
    throw new ShapeError(`\`${key}\` must be a number, got ${pyRepr(v)}.`)
  }
}

const pyStr = (v: unknown): string => (v === undefined || v === null ? 'None' : String(v))

function points(spec: Spec, k: number, minimum: number): [number, number][] {
  let pts = get(spec, 'points')
  if ((pts === undefined || pts === null) && has(spec, 'x1')) {
    pts = [[spec.x1, spec.y1], [spec.x2, spec.y2]]
  }
  if (!Array.isArray(pts) || pts.length < minimum) {
    throw new ShapeError(`${pyStr(get(spec, 'type'))} needs \`points\` with at least ${minimum} [x, y] pairs.`)
  }
  try {
    return pts.map((p): [number, number] => {
      if (!Array.isArray(p) || p.length !== 2) throw new TypeError('pair')
      return [pyFloat(p[0]) * k, pyFloat(p[1]) * k]
    })
  } catch {
    throw new ShapeError('`points` must be [[x, y], ...] numbers.')
  }
}

function setLabel(item: LabelFields, spec: Spec): void {
  const text = get(spec, 'label')
  if (!text) return
  item.label = String(text)
  const f = fontOf(spec)
  item.labelFamily = f.family
  // QFont.pointSize(): the rounded size.
  item.labelSize = Math.round(f.size)
  item.labelBold = f.bold
  item.labelItalic = f.italic
  item.labelColor = qcolor(get(spec, 'text_color') || '#1a1a1a')!
}

function textItem(spec: Spec, k: number): TextItem {
  const f = fontOf(spec)
  const item = makeText(String(get(spec, 'text', '')), {
    family: f.family, size: f.size, bold: f.bold, italic: f.italic,
    color: qcolor(get(spec, 'color') || get(spec, 'stroke') || '#1a1a1a')!,
  })
  const x = num(spec, 'x') * k
  const y = num(spec, 'y') * k
  const br = textBounds(item)
  const anchor = String(get(spec, 'anchor', 'center')).toLowerCase()
  if (anchor === 'center') item.pos = { x: x - br.w / 2, y: y - br.h / 2 }
  else if (anchor === 'left') item.pos = { x, y: y - br.h / 2 }
  else if (anchor === 'topleft') item.pos = { x, y }
  else throw new ShapeError('anchor must be center, left or topleft.')
  return item
}

// The group's own child items, nested groups flattened (_leaves).
function childLeaves(item: Item): Item[] {
  return item.type === 'group' ? leaves(item.children) : []
}

function symbolItems(scene: Scene, spec: Spec, k: number): Item[] {
  const ref = String(get(spec, 'symbol', ''))
  const norm = ref.replaceAll(':', '/')
  const cut = norm.indexOf('/')
  const lib = cut < 0 ? norm : norm.slice(0, cut)
  const name = cut < 0 ? '' : norm.slice(cut + 1)
  const mod = library(lib)
  if (!has(mod.SIZES, name)) {
    throw new ShapeError(`No symbol ${pyRepr(name)} in ${lib}; call list_drawing_symbols.`)
  }
  let w: number
  let h: number
  const sw = get(spec, 'w')
  const sh = get(spec, 'h')
  if ((sw !== undefined && sw !== null) || (sh !== undefined && sh !== null)) {
    const [dw, dh] = defaultSymbolPx(mod, name)
    let ww = sw !== undefined && sw !== null ? pyFloat(sw) * k : null
    let hh = sh !== undefined && sh !== null ? pyFloat(sh) * k : null
    if (ww === null) ww = dw * hh! / dh
    if (hh === null) hh = dh * ww / dw
    w = ww
    h = hh
  } else {
    [w, h] = defaultSymbolPx(mod, name)
  }
  const parts = mod.buildSpecs(name, w, h).map(specToItem).filter((x): x is Item => x !== null)
  if (!parts.length) throw new ShapeError(`Symbol ${ref} produced nothing.`)
  const center = { x: num(spec, 'x') * k, y: num(spec, 'y') * k }
  const top = dropItems(scene, parts, center, w, h)
  top.symbol = `${lib}:${name}`
  const label = get(spec, 'label')
  if (label) {
    const texts = childLeaves(top).filter((c): c is TextItem => c.type === 'text')
    if (texts.length) {
      // Flowchart nodes carry a placeholder caption.
      const t = texts[0]
      const old = rectCenter(textBounds(t))
      t.text = String(label)
      if (get(spec, 'font_size')) Object.assign(t, fontOf(spec))
      const now = rectCenter(textBounds(t))
      t.pos = { x: t.pos.x + old.x - now.x, y: t.pos.y + old.y - now.y }
    } else {
      // Arrowheads pad the bounding rect past the ink, and some symbols
      // draw well inside their design box: take the tighter.
      const box = sceneBoundingRect(top)
      const bottom = Math.min(box.y + box.h, center.y + h / 2)
      const cx = box.x + box.w / 2
      const caption = textItem({
        text: label, x: cx / k, y: bottom / k + 1, anchor: 'topleft', font_size: get(spec, 'font_size', 10),
      }, k)
      caption.pos = { x: cx - textBounds(caption).w / 2, y: bottom + 0.5 * k - TEXT_MARGIN }
      scene.items.push(caption)
      return [top, caption]
    }
  }
  return [top]
}

function build(scene: Scene, spec: unknown, k: number): Item[] {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new ShapeError('Each shape must be an object.')
  const s = spec as Spec
  const kind = String(get(s, 'type', '')).toLowerCase()
  if (kind === 'symbol') {
    const items = symbolItems(scene, s, k)
    for (const it of items) finish(it, s, it === items[0])
    return items
  }
  let item: Item
  if (kind === 'rect' || kind === 'rounded_rect' || kind === 'ellipse') {
    const rect: Rect = { x: num(s, 'x') * k, y: num(s, 'y') * k, w: num(s, 'w') * k, h: num(s, 'h') * k }
    const box = makeBox(kind === 'rect' ? 'rect' : kind === 'ellipse' ? 'ellipse' : 'roundrect', rect)
    if (kind === 'rounded_rect') box.radius = pyFloat(get(s, 'radius', 2.5)) * k
    box.pen = penOf(s, k)
    box.brush = brushOf(s)
    setLabel(box, s)
    item = box
  } else if (kind === 'circle') {
    const rv = get(s, 'r')
    const r = rv !== undefined && rv !== null ? pyFloat(rv) : num(s, 'w') / 2
    const cx = num(s, 'x')
    const cy = num(s, 'y')
    const box = makeBox('ellipse', { x: (cx - r) * k, y: (cy - r) * k, w: 2 * r * k, h: 2 * r * k })
    box.pen = penOf(s, k)
    box.brush = brushOf(s)
    setLabel(box, s)
    item = box
  } else if (kind === 'line' || kind === 'arrow' || kind === 'double_arrow') {
    const p = points(s, k, 2)
    if (p.length > 2) throw new ShapeError(`${kind} takes exactly two points; use a polyline for bends.`)
    const line = makeLine(kind === 'line' ? 'line' : 'arrow', p[0][0], p[0][1], p[1][0], p[1][1])
    line.pen = penOf(s, k)
    if (kind === 'double_arrow') line.head = 'double'
    else if (kind === 'arrow') {
      const head = String(get(s, 'head', 'filled'))
      line.head = ARROW_HEADS.includes(head) ? head : 'filled'
    }
    item = line
  } else if (kind === 'polygon') {
    const poly = makePolygon('polygon', points(s, k, 3))
    poly.pen = penOf(s, k)
    poly.brush = brushOf(s)
    setLabel(poly, s)
    item = poly
  } else if (kind === 'polyline') {
    const p = points(s, k, 2)
    const cmds: Cmd[] = [['M', p[0][0], p[0][1]], ...p.slice(1).map((q): Cmd => ['L', q[0], q[1]])]
    item = makePath(cmds, penOf(s, k), null)
  } else if (kind === 'text') {
    if (!String(get(s, 'text', '')).trim()) throw new ShapeError('text needs a non-empty `text`.')
    item = textItem(s, k)
  } else {
    throw new ShapeError(`Unknown shape type ${pyRepr(kind)}; use one of ${SHAPE_TYPES.join(', ')}.`)
  }
  scene.items.push(item)
  finish(item, s)
  return [item]
}

function finish(item: Item, spec: Spec, rotate = true): void {
  centerOrigin(item)
  if (rotate && get(spec, 'rotation')) item.rotation = pyFloat(spec.rotation)
  const op = get(spec, 'opacity')
  if (op !== undefined && op !== null) item.opacity = Math.max(0.0, Math.min(1.0, pyFloat(op)))
}

// Add *shapes* to *scene*; returns how many top-level items were added.
// Throws ShapeError (naming the shape) on a bad spec, leaving the scene
// without any of this call's items.
export function addShapes(scene: Scene, shapes: unknown): number {
  if (!Array.isArray(shapes) || !shapes.length) throw new ShapeError('`shapes` must be a non-empty array.')
  const k = pxPerMm(scene)
  const existing = vectorItems(scene)
  const before = [...scene.items]
  const topZ = existing.length ? Math.max(...existing.map(it => it.z)) : null
  const added: Item[] = []
  try {
    shapes.forEach((spec, i) => {
      try {
        added.push(...build(scene, spec, k))
      } catch (exc) {
        if (exc instanceof ShapeError) throw new ShapeError(`shapes[${i}]: ${exc.message}`)
        throw exc
      }
    })
  } catch (exc) {
    // Everything this call put in the scene goes, even a half-built symbol.
    scene.items = before
    throw exc
  }
  // Appended shapes stay above a loaded drawing.
  if (topZ !== null) for (const it of added) it.z = topZ + 1
  return added.length
}

// ------------------------------------------------------------ reading

const r2 = (v: number) => pyRound(v, 2)

type Shape = Record<string, unknown>

function style(item: { pen: PenDict; brush?: BrushDict }, k: number): Shape {
  const d: Shape = {}
  const p = item.pen
  if (p.none) {
    d.stroke = null
  } else {
    d.stroke = colorName(color(p.color))
    d.width = r2(p.width / k)
    if (penDash(p) !== 'solid') d.dash = penDash(p)
  }
  if ('brush' in item) {
    const b = item.brush
    // A gradient brush's color() is black.
    d.fill = b === null || b === undefined ? null : 'color' in b ? colorName(color(b.color)) : '#000000'
  }
  return d
}

function common(item: Item, d: Shape): Shape {
  if (Math.abs(item.rotation) > 1e-6) d.rotation = r2(item.rotation)
  if (item.opacity < 1) d.opacity = r2(item.opacity)
  const lab = (item as LabelFields).label
  if (['rect', 'ellipse', 'roundrect', 'arc', 'polygon'].includes(item.type) && lab) {
    d.label = lab
    d.font_size = Math.round((item as LabelFields).labelSize ?? 14)
  }
  return d
}

// The Python class each item type is.
const PY_CLASS: Record<string, string> = {
  line: 'LineItem', arrow: 'ArrowItem', dimension: 'DimensionItem', rect: 'RectItem', ellipse: 'EllipseItem',
  roundrect: 'RoundedRectItem', arc: 'ArcShapeItem', polygon: 'PolygonItem', path: 'PathItem', text: 'TextItem',
  image: 'ImageItem', group: 'GroupItem',
}

// One top-level canvas item in the authoring schema.
export function itemToShape(item: Item, k: number): Shape {
  const pos = item.pos
  if (item.symbol) {
    const box = sceneBoundingRect(item)
    const sym = String(item.symbol)
    const cut = sym.indexOf(':')
    const lib = cut < 0 ? sym : sym.slice(0, cut)
    const name = cut < 0 ? '' : sym.slice(cut + 1)
    const d: Shape = {
      type: 'symbol', symbol: `${lib}/${name}`, x: r2((box.x + box.w / 2) / k), y: r2((box.y + box.h / 2) / k),
      w: r2(box.w / k), h: r2(box.h / k),
    }
    const texts = childLeaves(item).filter((c): c is TextItem => c.type === 'text').map(c => c.text)
    if (texts.length) d.label = texts[0]
    return common(item, d)
  }
  if (item.type === 'line' || item.type === 'arrow') {
    let kind = 'line'
    if (item.type === 'arrow') kind = item.head === 'double' ? 'double_arrow' : 'arrow'
    const d: Shape = {
      type: kind,
      points: [[r2((item.x1 + pos.x) / k), r2((item.y1 + pos.y) / k)], [r2((item.x2 + pos.x) / k), r2((item.y2 + pos.y) / k)]],
      ...style(item, k),
    }
    delete d.fill
    if (kind === 'arrow' && (item.head ?? 'filled') !== 'filled') d.head = item.head
    return common(item, d)
  }
  if (item.type === 'rect' || item.type === 'ellipse' || item.type === 'roundrect') {
    const b = item as BoxItem
    const r = { x: b.x + pos.x, y: b.y + pos.y, w: b.w, h: b.h }
    const kind = item.type === 'rect' ? 'rect' : item.type === 'ellipse' ? 'ellipse' : 'rounded_rect'
    let d: Shape
    if (kind === 'ellipse' && Math.abs(r.w - r.h) < 0.5) {
      d = { type: 'circle', x: r2((r.x + r.w / 2) / k), y: r2((r.y + r.h / 2) / k), r: r2(r.w / 2 / k) }
    } else {
      d = { type: kind, x: r2(r.x / k), y: r2(r.y / k), w: r2(r.w / k), h: r2(r.h / k) }
    }
    if (kind === 'rounded_rect') d.radius = r2((b.radius ?? 12.0) / k)
    Object.assign(d, style(b, k))
    return common(item, d)
  }
  if (item.type === 'polygon' && item.kind === 'polygon') {
    const d: Shape = {
      type: 'polygon', points: item.points.map(p => [r2((p[0] + pos.x) / k), r2((p[1] + pos.y) / k)]),
      ...style(item, k),
    }
    return common(item, d)
  }
  if (item.type === 'path' && item.brush === null) {
    const els = item.cmds
    if (els.length && els.every(e => e[0] === 'M' || e[0] === 'L') && els.filter(e => e[0] === 'M').length === 1) {
      const d: Shape = {
        type: 'polyline', points: els.map(e => [r2((e[1] + pos.x) / k), r2((e[2] + pos.y) / k)]),
        ...style(item, k),
      }
      delete d.fill
      return common(item, d)
    }
  }
  if (item.type === 'text') {
    const d: Shape = {
      type: 'text', text: item.text, x: r2(pos.x / k), y: r2(pos.y / k), anchor: 'topleft',
      font_size: r2(item.size), color: colorName(color(item.color)),
    }
    if (item.bold) d.bold = true
    if (item.italic) d.italic = true
    return common(item, d)
  }
  const box = sceneBoundingRect(item)
  return { type: 'other', item_type: PY_CLASS[item.type] ?? item.type,
    bbox_mm: [r2(box.x / k), r2(box.y / k), r2(box.w / k), r2(box.h / k)] }
}

export function sceneToShapes(scene: Scene): Shape[] {
  const k = pxPerMm(scene)
  return vectorItems(scene).map(it => itemToShape(it, k))
}

// ------------------------------------------------------------ saving

// What paint/export.save_drawing writes beside <stem>.png: the editable
// SVG, the vector PDF cropped to the content (what LaTeX includes) and
// the SVG to rasterise for the PNG preview (2× supersampled). null when
// there is nothing to save.
export function drawingFiles(scene: Scene): { svg: string; pdf: Uint8Array; previewSvg: string; w: number; h: number } | null {
  let rect = contentRect(scene)
  if (isEmptyRect(rect)) return null
  rect = { x: rect.x - MARGIN, y: rect.y - MARGIN, w: rect.w + 2 * MARGIN, h: rect.h + 2 * MARGIN }
  const w = Math.max(1, Math.round(rect.w * 2))
  const h = Math.max(1, Math.round(rect.h * 2))
  return { svg: saveSvg(scene), pdf: sceneToPdf(scene, rect), previewSvg: sceneToSvg(scene, rect, w, h), w, h }
}
