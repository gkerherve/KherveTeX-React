// SVG import/export — the drawing's editable source format. A port of
// khervedoc/paint/svgio.py, plus the .kpaint item dicts of document.py
// (item_to_dict / item_from_dict: the undo snapshot and clipboard format).
//
// * Write (saveSvg) emits clean, standard SVG: one element per native
//   item, geometry in local coordinates with a translate/rotate transform,
//   the raster layer as an embedded <image>, and KhervePaint-specific bits
//   (grid settings, polygon kind, arrow flag) under a private kp:
//   namespace, so our own files round-trip losslessly while staying
//   readable by any SVG tool. The bytes are ElementTree's.
// * Read (loadSvg) parses an arbitrary SVG into editable native items:
//   <g> becomes a group (so it can be ungrouped), the common primitives
//   become their native items, and anything carrying a non-trivial
//   (scaled / sheared) transform — or a <path> — becomes a path item.

import { DOMParser } from '@xmldom/xmldom'
import type { Element as XElement } from '@xmldom/xmldom'
import {
  addEllipse, addRect, addRoundedRect, alphaF, ARC_KINDS, arcPath, boundingRect, brushFromDict, centerOrigin,
  closeSubpath, color, colorArgb, colorName, cubicTo, DASH_PATTERNS, DASH_STYLES, hasSimpleTransform,
  IDENTITY, itemToParent, lineTo, makeGroup, matInvert, matMul, mapPt, moveTo, newScene,
  parseColor, penDash, penFromDict, quadTo, rectCenter, SUN_CENTER, SUN_FOCAL, SUN_RADIUS, anglePoints,
  textBounds, vectorItems, withAlphaF, DEFAULT_FONT_FAMILY, pyMod,
  type BoxItem, type BrushDict, type Cmd, type Color, type Dash, type GradSpec, type GroupItem, type ImageItem,
  type Item, type LabelFields, type LineItem, type Mat, type PathItem, type PenDict, type PolygonItem, type Pt,
  type Rect, type Scene, type TextItem,
} from './paintModel.ts'
import { pyG } from './paintFormat.ts'

export const SVG_NS = 'http://www.w3.org/2000/svg'
export const XLINK_NS = 'http://www.w3.org/1999/xlink'
// Internal SVG namespace for our private attributes (grid, dim style,
// polygon kind, raster role…). Kept at the original URI — not the renamed
// one — so SVGs saved before the rename still round-trip. It is never
// shown to users (only the "kp:" prefix appears in the file).
export const KP_NS = 'https://kerherve.app/khervepaint'

const EPS = 1e-4
const g = (x: number) => pyG(x)

// ================================================================ the tree
// An ElementTree element: tag, attributes in insertion order ("kp:x" and
// "xlink:href" carry their namespace prefix), text and children.
interface El { tag: string; attrs: [string, string][]; text: string | null; children: El[] }

function el(tag: string, parent?: El): El {
  const e: El = { tag, attrs: [], text: null, children: [] }
  parent?.children.push(e)
  return e
}
function set(e: El, k: string, v: string): void {
  const i = e.attrs.findIndex(a => a[0] === k)
  if (i >= 0) e.attrs[i][1] = v
  else e.attrs.push([k, v])
}

function escAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll('\r', '&#13;').replaceAll('\n', '&#10;').replaceAll('\t', '&#09;')
}
function escText(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// ElementTree(root).write(path, xml_declaration=True, encoding="utf-8")
function serialise(root: El): string {
  const used = new Set<string>()
  const scan = (e: El) => {
    for (const [k] of e.attrs) {
      if (k.startsWith('kp:')) used.add('kp')
      if (k.startsWith('xlink:')) used.add('xlink')
    }
    e.children.forEach(scan)
  }
  scan(root)
  const ns: [string, string][] = [['', SVG_NS]]
  if (used.has('kp')) ns.push(['kp', KP_NS])
  if (used.has('xlink')) ns.push(['xlink', XLINK_NS])
  const out: string[] = ["<?xml version='1.0' encoding='utf-8'?>\n"]
  const write = (e: El, isRoot: boolean) => {
    out.push('<' + e.tag)
    if (isRoot) {
      for (const [p, uri] of ns) out.push(` ${p ? 'xmlns:' + p : 'xmlns'}="${escAttr(uri)}"`)
    }
    for (const [k, v] of e.attrs) out.push(` ${k}="${escAttr(v)}"`)
    if (e.text || e.children.length) {
      out.push('>')
      if (e.text) out.push(escText(e.text))
      for (const c of e.children) write(c, false)
      out.push(`</${e.tag}>`)
    } else {
      out.push(' />')
    }
  }
  write(root, true)
  return out.join('')
}

// json.dumps(value) with Python's default separators and ensure_ascii.
export function pyJsonDumps(v: unknown, ensureAscii = true): string {
  const enc = (x: unknown): string => {
    if (x === null || x === undefined) return 'null'
    if (typeof x === 'boolean') return x ? 'true' : 'false'
    if (typeof x === 'number') return Number.isInteger(x) && !Object.is(x, -0) ? String(x) : pyFloatRepr(x)
    if (typeof x === 'string') {
      const s = JSON.stringify(x)
      return ensureAscii ? s.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : s
    }
    if (Array.isArray(x)) return '[' + x.map(enc).join(', ') + ']'
    return '{' + Object.entries(x as Record<string, unknown>).map(([k, y]) => enc(k) + ': ' + enc(y)).join(', ') + '}'
  }
  return enc(v)
}

function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity'
  if (Number.isInteger(x)) return x.toFixed(1)
  return String(x).replace(/e([+-])(\d)$/, 'e$10$2')
}

// ================================================================ writing
function transformAttr(it: Item): string {
  // Scaled items (incl. resized groups) are emitted as the exact transform
  // matrix, which encodes the centre transform-origin. A bare scale(s)
  // ignores that origin, so the loader — which bakes scaled geometry —
  // would shift the item by origin·(1−s). Rotation-only and translation
  // stay human-readable: the loader rebuilds those about the centre
  // itself, so the simple form round-trips exactly.
  if (!hasSimpleTransform(it)) return matrixAttr(itemToParent(it))
  const parts: string[] = []
  if (Math.abs(it.pos.x) > EPS || Math.abs(it.pos.y) > EPS) parts.push(`translate(${g(it.pos.x)},${g(it.pos.y)})`)
  if (Math.abs(it.rotation) > EPS) parts.push(`rotate(${g(it.rotation)})`)
  return parts.join(' ')
}

function matrixAttr(m: Mat): string {
  return `matrix(${g(m[0])},${g(m[1])},${g(m[2])},${g(m[3])},${g(m[4])},${g(m[5])})`
}

function setCommon(e: El, it: Item): void {
  const tf = transformAttr(it)
  if (tf) set(e, 'transform', tf)
  if (it.opacity < 1 - EPS) set(e, 'opacity', g(it.opacity))
}

function setStroke(e: El, p: PenDict): void {
  if (p.none) {
    set(e, 'stroke', 'none')
    return
  }
  const c = color(p.color)
  set(e, 'stroke', colorName(c))
  set(e, 'stroke-width', g(p.width))
  if (c.a16 < 65535) set(e, 'stroke-opacity', g(alphaF(c)))
  set(e, 'stroke-linecap', 'round')
  set(e, 'stroke-linejoin', 'round')
  const dash = penDash(p)
  if (dash !== 'solid') {
    const w = Math.max(p.width, 1.0)
    set(e, 'stroke-dasharray', DASH_PATTERNS[dash].map(v => g(v * w)).join(','))
    set(e, 'kp:dash', dash)
  }
}

interface Ctx { root: El; defs: El | null; n: number }

function setFill(e: El, b: BrushDict, ctx: Ctx | null): void {
  if (b === null) {
    set(e, 'fill', 'none')
    return
  }
  if ('gradient' in b && ctx !== null) {
    set(e, 'fill', `url(#${gradientDef(ctx, b.gradient)})`)
    return
  }
  const c = color('gradient' in b ? b.gradient.c1 : b.color)
  set(e, 'fill', colorName(c))
  if (c.a16 < 65535) set(e, 'fill-opacity', g(alphaF(c)))
}

// Write `spec` as a <linearGradient>/<radialGradient> in the file's <defs>
// (created on first use) and return its id.
function gradientDef(ctx: Ctx, spec: GradSpec): string {
  if (ctx.defs === null) {
    ctx.defs = el('defs')
    ctx.root.children.unshift(ctx.defs)
  }
  ctx.n += 1
  const gid = `kpgrad${ctx.n}`
  let stops: [number, 'c1' | 'c2'][] = [[0, 'c1'], [1, 'c2']]
  let ge: El
  if (spec.kind === 'radial') {
    ge = el('radialGradient', ctx.defs)
    set(ge, 'cx', '0.5'); set(ge, 'cy', '0.5'); set(ge, 'r', '0.7071')
  } else if (spec.kind === 'sun') {      // off-centre highlight, light first
    ge = el('radialGradient', ctx.defs)
    set(ge, 'cx', g(SUN_CENTER.x)); set(ge, 'cy', g(SUN_CENTER.y))
    set(ge, 'r', g(SUN_RADIUS))
    set(ge, 'fx', g(SUN_FOCAL.x)); set(ge, 'fy', g(SUN_FOCAL.y))
    stops = [[0, 'c2'], [1, 'c1']]
  } else {
    ge = el('linearGradient', ctx.defs)
    const [x1, y1, x2, y2] = anglePoints(spec.angle ?? 90.0)
    set(ge, 'x1', g(x1)); set(ge, 'y1', g(y1))
    set(ge, 'x2', g(x2)); set(ge, 'y2', g(y2))
  }
  set(ge, 'id', gid)
  set(ge, 'gradientUnits', 'objectBoundingBox')
  for (const [offset, name] of stops) {
    const c = color(spec[name])
    const st = el('stop', ge)
    set(st, 'offset', String(offset))
    set(st, 'stop-color', colorName(c))
    if (c.a16 < 65535) set(st, 'stop-opacity', g(alphaF(c)))
  }
  return gid
}

// A line/arrow as SVG: <line> when straight, or — when bent — a quadratic
// <path> (so any viewer draws the curve) whose endpoints and control point
// ride along in kp: attributes for round-trip.
function lineElement(parent: El, it: LineItem): El {
  if (!it.bend) {
    const e = el('line', parent)
    set(e, 'x1', g(it.x1)); set(e, 'y1', g(it.y1))
    set(e, 'x2', g(it.x2)); set(e, 'y2', g(it.y2))
    return e
  }
  const [bx, by] = it.bend
  const e = el('path', parent)
  set(e, 'd', `M${g(it.x1)},${g(it.y1)} Q${g(bx)},${g(by)} ${g(it.x2)},${g(it.y2)}`)
  set(e, 'fill', 'none')
  set(e, 'kp:x1', g(it.x1)); set(e, 'kp:y1', g(it.y1))
  set(e, 'kp:x2', g(it.x2)); set(e, 'kp:y2', g(it.y2))
  set(e, 'kp:bend', `${g(bx)} ${g(by)}`)
  return e
}

export function painterpathToD(cmds: Cmd[]): string {
  const out: string[] = []
  for (const c of cmds) {
    if (c[0] === 'M') out.push(`M${g(c[1])},${g(c[2])}`)
    else if (c[0] === 'L') out.push(`L${g(c[1])},${g(c[2])}`)
    else out.push(`C${g(c[1])},${g(c[2])} ${g(c[3])},${g(c[4])} ${g(c[5])},${g(c[6])}`)
  }
  return out.join(' ')
}

const GROUP_JSON_KEYS: [string, string][] = [
  ['mol_colors', 'model-colors'], ['mol_tilts', 'model-tilts'],
]

function itemToElement(parent: El, it: Item, ctx: Ctx | null): El | null {
  if (it.type === 'group') {
    const ge = el('g', parent)
    setCommon(ge, it)
    if (it.model) {                          // 3D molecule/crystal model
      set(ge, 'kp:model', String(it.model))
      for (const [k, a] of [['model_az', 'model-az'], ['model_el', 'model-el'], ['model_bond', 'model-bond'],
        ['model_box', 'model-box']] as const) {
        if (it[k] !== null && it[k] !== undefined) set(ge, `kp:${a}`, g(Number(it[k])))
      }
      if (it.model_repr) set(ge, 'kp:model-repr', String(it.model_repr))
      for (const [k, a] of GROUP_JSON_KEYS) {
        const key = k === 'mol_colors' ? 'model_colors' : 'model_tilts'
        if (it[key]) set(ge, `kp:${a}`, pyJsonDumps(it[key]))
      }
      if (it.model_poly) set(ge, 'kp:model-poly', '1')
      if (it.model_cells) set(ge, 'kp:model-cells', pyJsonDumps(it.model_cells))
      if (it.model_atoms) {
        set(ge, 'kp:model-atoms', pyJsonDumps(it.model_atoms))
        set(ge, 'kp:model-bonds', pyJsonDumps(it.model_bonds ?? []))
      }
    }
    if (it.symbol) set(ge, 'kp:symbol', it.symbol)
    if (it.solid) set(ge, 'kp:solid', pyJsonDumps(it.solid))
    if (it.reaction) set(ge, 'kp:reaction', pyJsonDumps(it.reaction, false))
    for (const c of it.children) itemToElement(ge, c, ctx)
    return ge
  }
  let e: El
  switch (it.type) {
    case 'dimension': {
      e = el('line', parent)
      set(e, 'x1', g(it.x1)); set(e, 'y1', g(it.y1))
      set(e, 'x2', g(it.x2)); set(e, 'y2', g(it.y2))
      set(e, 'kp:kind', 'dimension')
      set(e, 'kp:dim-cap', it.capStyle ?? 'arrows')
      set(e, 'kp:dim-ext', it.extension ? '1' : '0')
      set(e, 'kp:dim-dash', it.dash ? '1' : '0')
      set(e, 'kp:dim-unit', it.unit ?? 'mm')
      set(e, 'kp:dim-decimals', String(it.decimals ?? 1))
      if (it.prefix) set(e, 'kp:dim-prefix', it.prefix)
      if (it.suffix) set(e, 'kp:dim-suffix', it.suffix)
      setStroke(e, it.pen)
      break
    }
    case 'arrow':
      e = lineElement(parent, it)
      set(e, 'kp:kind', 'arrow')
      if ((it.head ?? 'filled') !== 'filled') set(e, 'kp:head', it.head!)
      setStroke(e, it.pen)
      break
    case 'line':
      e = lineElement(parent, it)
      setStroke(e, it.pen)
      break
    case 'roundrect':
      e = el('rect', parent)
      set(e, 'x', g(it.x)); set(e, 'y', g(it.y))
      set(e, 'width', g(it.w)); set(e, 'height', g(it.h))
      set(e, 'rx', g(it.radius ?? 12)); set(e, 'ry', g(it.radius ?? 12))
      setStroke(e, it.pen); setFill(e, it.brush, ctx)
      break
    case 'rect':
      e = el('rect', parent)
      set(e, 'x', g(it.x)); set(e, 'y', g(it.y))
      set(e, 'width', g(it.w)); set(e, 'height', g(it.h))
      setStroke(e, it.pen); setFill(e, it.brush, ctx)
      break
    case 'ellipse':
      e = el('ellipse', parent)
      set(e, 'cx', g(it.x + it.w / 2)); set(e, 'cy', g(it.y + it.h / 2))
      set(e, 'rx', g(it.w / 2)); set(e, 'ry', g(it.h / 2))
      setStroke(e, it.pen); setFill(e, it.brush, ctx)
      break
    case 'polygon':
      e = el('polygon', parent)
      set(e, 'points', it.points.map(([x, y]) => `${g(x)},${g(y)}`).join(' '))
      if (it.kind && it.kind !== 'polygon') set(e, 'kp:kind', it.kind)
      setStroke(e, it.pen); setFill(e, it.brush, ctx)
      break
    case 'arc':
      e = el('path', parent)
      set(e, 'd', painterpathToD(arcPath(it.kind ?? 'halfcircle', { x: it.x, y: it.y, w: it.w, h: it.h }, it.flipH, it.flipV)))
      set(e, 'kp:kind', it.kind ?? 'halfcircle')
      set(e, 'kp:ax', g(it.x)); set(e, 'kp:ay', g(it.y))
      set(e, 'kp:aw', g(it.w)); set(e, 'kp:ah', g(it.h))
      if (it.flipH) set(e, 'kp:flip-h', '1')
      if (it.flipV) set(e, 'kp:flip-v', '1')
      setStroke(e, it.pen); setFill(e, it.brush, ctx)
      break
    case 'path':
      e = el('path', parent)
      set(e, 'd', painterpathToD(it.cmds))
      setStroke(e, it.pen); setFill(e, it.brush, ctx)
      break
    case 'text': {
      e = el('text', parent)
      set(e, 'x', '0'); set(e, 'y', '0')
      set(e, 'dominant-baseline', 'text-before-edge')
      set(e, 'font-family', it.family)
      set(e, 'font-size', String(qtPointSize(it.size)))
      if (it.bold) set(e, 'font-weight', 'bold')
      if (it.italic) set(e, 'font-style', 'italic')
      set(e, 'fill', colorName(color(it.color)))
      e.text = it.text
      break
    }
    case 'image': {
      e = el('image', parent)
      set(e, 'x', '0'); set(e, 'y', '0')
      set(e, 'width', String(it._w ?? 0)); set(e, 'height', String(it._h ?? 0))
      set(e, 'xlink:href', `data:image/png;base64,${it.image}`)
      // The image's full transform (translate + rotate + scale) goes out
      // as a matrix so resizing and rotation are saved exactly.
      set(e, 'transform', matrixAttr(itemToParent(it)))
      if (it.opacity < 1 - EPS) set(e, 'opacity', g(it.opacity))
      return e
    }
  }
  setCommon(e, it)
  if ((it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc'
    || it.type === 'polygon') && it.label) {
    emitLabel(parent, e, it)
  }
  return e
}

// QFont.pointSize(): an int (a fractional size rounds).
export function qtPointSize(size: number): number {
  return Math.round(size)
}

// Store the shape's label under kp: attributes (lossless) and also emit a
// visible <text> sibling so other SVG viewers show it.
function emitLabel(parent: El, e: El, it: Item & LabelFields): void {
  const lab = labelOf(it)
  set(e, 'kp:label', lab.text)
  set(e, 'kp:label-color', lab.color)
  set(e, 'kp:label-family', lab.family)
  set(e, 'kp:label-size', String(lab.size))
  if (lab.bold) set(e, 'kp:label-bold', '1')
  if (lab.italic) set(e, 'kp:label-italic', '1')
  const c = rectCenter(boundingRect(it))
  const t = el('text', parent)
  set(t, 'x', g(c.x)); set(t, 'y', g(c.y))
  set(t, 'text-anchor', 'middle')
  set(t, 'dominant-baseline', 'central')
  const tf = transformAttr(it)
  if (tf) set(t, 'transform', tf)
  set(t, 'font-family', lab.family)
  set(t, 'font-size', String(lab.size))
  if (lab.bold) set(t, 'font-weight', 'bold')
  if (lab.italic) set(t, 'font-style', 'italic')
  set(t, 'fill', lab.color)
  set(t, 'kp:role', 'label')
  t.text = lab.text
}

// A shape's label with LabelMixin's class defaults filled in; the colour as
// QColor.name() keeps it (no alpha).
export function labelOf(it: LabelFields): { text: string; color: string; family: string; size: number; bold: boolean; italic: boolean } {
  return {
    text: it.label ?? '',
    color: colorName(color(it.labelColor ?? '#1a1a1a')),
    family: it.labelFamily ?? DEFAULT_FONT_FAMILY,
    size: it.labelSize ?? 14,
    bold: !!it.labelBold,
    italic: !!it.labelItalic,
  }
}

// svgio.save_svg: the drawing as an SVG document (the text of the file).
// A blank raster layer (scene.raster === null) is left out, so the file
// stays small and purely vector (export.save_svg).
export function saveSvg(s: Scene): string {
  const w = Math.trunc(s.width)
  const h = Math.trunc(s.height)
  const root = el('svg')
  // Physical size (in) for publication, with a pixel viewBox so the
  // coordinate system stays in px and our loader reads it back exactly.
  set(root, 'width', `${g(w / s.dpi)}in`)
  set(root, 'height', `${g(h / s.dpi)}in`)
  set(root, 'viewBox', `0 0 ${w} ${h}`)
  set(root, 'kp:dpi', String(s.dpi))
  set(root, 'kp:grid-mm', g(s.gridMm))
  set(root, 'kp:grid-show', s.showGrid ? '1' : '0')
  set(root, 'kp:grid-snap', s.snap ? '1' : '0')
  set(root, 'kp:infinite', s.infinite ? '1' : '0')
  if (s.raster) {
    const img = el('image', root)
    set(img, 'x', '0'); set(img, 'y', '0')
    set(img, 'width', String(s.rasterW ?? w))
    set(img, 'height', String(s.rasterH ?? h))
    set(img, 'kp:role', 'raster')
    set(img, 'xlink:href', `data:image/png;base64,${s.raster}`)
  }
  const ctx: Ctx = { root, defs: null, n: 0 }
  for (const it of vectorItems(s)) itemToElement(root, it, ctx)
  return serialise(root)
}

// ================================================================ reading
function colorOf(value: string | null | undefined, fallback = '#000000'): Color {
  if (value === null || value === undefined) return color(fallback)
  const v = value.trim()
  if (v === 'none' || v === 'transparent') return { r: 0, g: 0, b: 0, a16: 0 }
  const m = /^rgba?\(([^)]+)\)/.exec(v)
  if (m) {
    const parts = m[1].split(',').map(p => p.trim())
    const nums = parts.slice(0, 3).map(p => p.endsWith('%') ? Math.round(pyFloat(p.slice(0, -1)) * 2.55)
      : Math.round(pyFloat(p)))
    let c: Color = { r: nums[0] ?? 0, g: nums[1] ?? 0, b: nums[2] ?? 0, a16: 65535 }
    if (parts.length === 4) c = withAlphaF(c, pyFloat(parts[3]))
    return c
  }
  return parseColor(v) ?? color(fallback)
}

// float(text): Python's strict number parse.
function pyFloat(text: string): number {
  const t = text.trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) && !/^[+-]?(inf|infinity|nan)$/i.test(t)) {
    throw new Error(`could not convert string to float: '${text}'`)
  }
  return Number(t.replace(/inf(inity)?/i, 'Infinity'))
}

type Style = Record<string, unknown> & { _opacity?: number; _gradients?: Record<string, GradSpec> }

const attr = (e: XElement, k: string): string | null => (e.hasAttribute(k) ? e.getAttribute(k) : null)
const kp = (e: XElement, k: string): string | null => (e.hasAttributeNS(KP_NS, k) ? e.getAttributeNS(KP_NS, k) : null)
const local = (e: XElement): string => e.localName ?? e.nodeName.replace(/^.*:/, '')
const elementChildren = (e: XElement): XElement[] => {
  const out: XElement[] = []
  for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as XElement)
  return out
}

function resolveStyle(e: XElement, inherited: Style): Style {
  const s: Style = { ...inherited }
  const style = attr(e, 'style')
  if (style) {
    for (const decl of style.split(';')) {
      const i = decl.indexOf(':')
      if (i >= 0) s[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
    }
  }
  for (const key of ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family',
    'font-weight', 'font-style']) {
    const v = attr(e, key)
    if (v !== null) s[key] = v
  }
  const da = attr(e, 'stroke-dasharray')
  if (da !== null) {
    s['stroke-dasharray'] = da
    s._dash = kp(e, 'dash') ?? 'dash'
  }
  const op = attr(e, 'opacity')
  if (op !== null) s._opacity = (s._opacity ?? 1.0) * pyFloat(op)       // opacity composes
  return s
}

function penFromStyle(s: Style): PenDict {
  const stroke = (s.stroke as string | undefined) ?? 'none'
  if (stroke === null || stroke === 'none') return { color: '#ff000000', width: 1, none: true }
  let c = colorOf(stroke)
  if ('stroke-opacity' in s) c = withAlphaF(c, pyFloat(String(s['stroke-opacity'])))
  const p: PenDict = { color: colorArgb(c), width: pyFloat(String(s['stroke-width'] ?? 1)) }
  const dash = s['stroke-dasharray'] as string | undefined
  if (dash && dash.trim() !== 'none') {
    const name = (s._dash as Dash) ?? 'dash'
    const d: Dash = DASH_STYLES.includes(name) ? name : 'dash'
    if (d !== 'solid') p.dash = d
  }
  return p
}

function brushFromStyle(s: Style): BrushDict {
  const fill = (s.fill as string | undefined) ?? '#000000'          // SVG default fill is black
  if (fill === null || fill === 'none') return null
  const m = /^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/.exec(fill)
  if (m) {                                  // paint server: gradient by id
    const spec = s._gradients?.[m[1]]
    return spec ? brushFromDict({ gradient: spec }) : null
  }
  let c = colorOf(fill)
  if ('fill-opacity' in s) c = withAlphaF(c, pyFloat(String(s['fill-opacity'])))
  return { color: colorArgb(c) }
}

function href(e: XElement): string | null {
  return (e.hasAttributeNS(XLINK_NS, 'href') ? e.getAttributeNS(XLINK_NS, 'href') : null) || attr(e, 'href')
}

// id -> gradient spec for every two(+)-stop gradient in the tree. Stops may
// live on a referenced base gradient (xlink:href chains, as Inkscape writes
// them); only the first and last stop are kept.
function scanGradients(root: XElement): Record<string, GradSpec> {
  const els = new Map<string, XElement>()
  const all = root.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    const e = all[i] as unknown as XElement
    const n = local(e)
    if ((n === 'linearGradient' || n === 'radialGradient') && attr(e, 'id')) els.set(attr(e, 'id')!, e)
  }
  const stopsOf = (e: XElement, depth = 0): XElement[] => {
    const stops = elementChildren(e).filter(c => local(c) === 'stop')
    if (stops.length || depth > 4) return stops
    const h = href(e)
    if (h && h.startsWith('#') && els.has(h.slice(1))) return stopsOf(els.get(h.slice(1))!, depth + 1)
    return []
  }
  const stopColor = (stop: XElement): Color => {
    const style: Record<string, string> = {}
    for (const decl of (attr(stop, 'style') || '').split(';')) {
      const i = decl.indexOf(':')
      if (i >= 0) style[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
    }
    let c = colorOf(attr(stop, 'stop-color') || style['stop-color'], '#000000')
    const op = attr(stop, 'stop-opacity') || style['stop-opacity']
    if (op !== undefined && op !== null && op !== '') c = withAlphaF(c, pyFloat(op))
    return c
  }
  const frac = (e: XElement, key: string, def: number): number => {
    let v = attr(e, key)
    if (v === null) return def
    v = v.trim()
    return v.endsWith('%') ? pyFloat(v.slice(0, -1)) / 100 : pyFloat(v)
  }
  const specs: Record<string, GradSpec> = {}
  for (const [gid, e] of els) {
    const stops = stopsOf(e)
    if (!stops.length) continue
    const c1 = stopColor(stops[0])
    const c2 = stopColor(stops[stops.length - 1])
    const spec: GradSpec = { c1: colorArgb(c1), c2: colorArgb(c2), angle: 90.0, kind: 'linear' }
    if (local(e) === 'radialGradient') {
      const cx = frac(e, 'cx', 0.5)
      const cy = frac(e, 'cy', 0.5)
      if (Math.abs(cx - 0.5) > 0.01 || Math.abs(cy - 0.5) > 0.01) {
        // off-centre highlight = our "sun" kind (light stop first)
        spec.kind = 'sun'
        ;[spec.c1, spec.c2] = [spec.c2, spec.c1]
      } else {
        spec.kind = 'radial'
      }
    } else {
      const dx = frac(e, 'x2', 1.0) - frac(e, 'x1', 0.0)
      const dy = frac(e, 'y2', 0.0) - frac(e, 'y1', 0.0)
      spec.angle = dx || dy ? pyMod(Math.atan2(dy, dx) * 180 / Math.PI, 360) : 0.0
    }
    specs[gid] = spec
  }
  return specs
}

function qtRotate(deg: number): Mat {
  // QTransform.rotate: exact quarter turns
  const a = ((deg % 360) + 360) % 360
  let c = Math.cos(deg * Math.PI / 180)
  let s = Math.sin(deg * Math.PI / 180)
  if (a === 0) { c = 1; s = 0 } else if (a === 90) { c = 0; s = 1 } else if (a === 180) { c = -1; s = 0 }
  else if (a === 270) { c = 0; s = -1 }
  return [c, s, -s, c, 0, 0]
}

function parseTransform(text: string | null): Mat {
  let t: Mat = [...IDENTITY]
  if (!text) return t
  for (const m of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const name = m[1]
    const n = m[2].trim().split(/[\s,]+/).filter(Boolean).map(pyFloat)
    let op: Mat = [...IDENTITY]
    if (name === 'translate') op = [1, 0, 0, 1, n[0], n.length > 1 ? n[1] : 0]
    else if (name === 'scale') op = [n[0], 0, 0, n.length > 1 ? n[1] : n[0], 0, 0]
    else if (name === 'rotate') {
      if (n.length === 3) op = matMul(matMul([1, 0, 0, 1, -n[1], -n[2]], qtRotate(n[0])), [1, 0, 0, 1, n[1], n[2]])
      else op = qtRotate(n[0])
    } else if (name === 'matrix' && n.length === 6) op = [n[0], n[1], n[2], n[3], n[4], n[5]]
    else if (name === 'skewX') op = [1, 0, Math.tan(n[0] * Math.PI / 180), 1, 0, 0]
    else if (name === 'skewY') op = [1, Math.tan(n[0] * Math.PI / 180), 0, 1, 0, 0]
    t = matMul(op, t)             // right-to-left: leftmost op applied last
  }
  return t
}

// (dx, dy, degrees, simple): simple = pure translation + rotation.
function decompose(tf: Mat): [number, number, number, boolean] {
  const [m11, m12, m21, m22, dx, dy] = tf
  const simple = Math.abs(m11 * m11 + m12 * m12 - 1) < 1e-3 && Math.abs(m11 - m22) < 1e-3
    && Math.abs(m12 + m21) < 1e-3 && (m11 * m22 - m12 * m21) > 0
  return [dx, dy, Math.atan2(m12, m11) * 180 / Math.PI, simple]
}

function finalise<T extends Item>(it: T, total: Mat, style: Style): T {
  const [dx, dy, deg] = decompose(total)
  it.pos = { x: dx, y: dy }
  if (Math.abs(deg) > EPS) {
    centerOrigin(it)
    it.rotation = deg
  }
  if (style._opacity !== undefined) it.opacity = style._opacity
  return it
}

function styled<T extends Item & { pen: PenDict; brush?: BrushDict }>(it: T, style: Style, fill = true): T {
  it.pen = penFromStyle(style)
  if (fill && 'brush' in it) it.brush = brushFromStyle(style)
  return it
}

const base = <T>(o: T): T & { pos: Pt; opacity: number; rotation: number; z: number; scale: number } =>
  ({ ...o, pos: { x: 0, y: 0 }, opacity: 1.0, rotation: 0.0, z: 0.0, scale: 1.0 })

function rectOf(e: XElement): Rect {
  return { x: pyFloat(attr(e, 'x') ?? '0'), y: pyFloat(attr(e, 'y') ?? '0'),
    w: pyFloat(attr(e, 'width') ?? '0'), h: pyFloat(attr(e, 'height') ?? '0') }
}

function bakedPath(localPath: Cmd[], total: Mat, style: Style): PathItem {
  const it = base({ type: 'path' as const, pen: penFromStyle(style), brush: null as BrushDict,
    cmds: localPath.map(c => mapCmdM(c, total)) })
  it.brush = brushFromStyle(style)
  if (style._opacity !== undefined) it.opacity = style._opacity
  return it
}

function mapCmdM(c: Cmd, m: Mat): Cmd {
  if (c[0] === 'C') {
    const a = mapPt(m, { x: c[1], y: c[2] })
    const b = mapPt(m, { x: c[3], y: c[4] })
    const e = mapPt(m, { x: c[5], y: c[6] })
    return ['C', a.x, a.y, b.x, b.y, e.x, e.y]
  }
  const p = mapPt(m, { x: c[1], y: c[2] })
  return [c[0], p.x, p.y]
}

function readDimStyle(it: LineItem, e: XElement): void {
  it.capStyle = kp(e, 'dim-cap') ?? 'arrows'
  it.extension = (kp(e, 'dim-ext') ?? '0') === '1'
  it.dash = (kp(e, 'dim-dash') ?? '0') === '1'
  it.unit = kp(e, 'dim-unit') ?? 'mm'
  it.decimals = Math.trunc(pyFloat(kp(e, 'dim-decimals') ?? '1'))
  it.prefix = kp(e, 'dim-prefix') ?? ''
  it.suffix = kp(e, 'dim-suffix') ?? ''
}

function newLine(kind: string | null, x1: number, y1: number, x2: number, y2: number): LineItem {
  const type = kind === 'arrow' ? 'arrow' : kind === 'dimension' ? 'dimension' : 'line'
  const it: LineItem = base({ type, pen: { color: '#ff000000', width: 1 }, x1, y1, x2, y2 } as LineItem)
  if (type === 'dimension') Object.assign(it, { capStyle: 'arrows', extension: false, dash: false, unit: 'mm', decimals: 1, prefix: '', suffix: '' })
  return it
}

function setHead(it: LineItem, head: string): void {
  if (it.type === 'arrow') it.head = ['filled', 'open', 'stealth', 'double'].includes(head) ? head : 'filled'
}

function buildLeaf(e: XElement, total: Mat, style: Style): Item | null {
  const tag = local(e)
  const simple = decompose(total)[3]
  if (tag === 'line') {
    const x1 = pyFloat(attr(e, 'x1') ?? '0')
    const y1 = pyFloat(attr(e, 'y1') ?? '0')
    const x2 = pyFloat(attr(e, 'x2') ?? '0')
    const y2 = pyFloat(attr(e, 'y2') ?? '0')
    const kind = kp(e, 'kind')
    if (simple) {
      const it = newLine(kind === 'arrow' || kind === 'dimension' ? kind : null, x1, y1, x2, y2)
      if (it.type === 'dimension') readDimStyle(it, e)
      if (it.type === 'arrow') setHead(it, kp(e, 'head') ?? 'filled')
      return finalise(styled(it, style, false), total, style)
    }
    return bakedPath(lineTo(moveTo([], x1, y1), x2, y2), total, style)
  }
  if (tag === 'rect') {
    const r = rectOf(e)
    const rx = pyFloat(attr(e, 'rx') || '0')
    if (simple && rx > 0) {
      const it = base({ type: 'roundrect' as const, pen: penFromStyle(style), brush: null as BrushDict, ...r, radius: rx }) as BoxItem
      return finalise(styled(it, style), total, style)
    }
    if (simple) {
      const it = base({ type: 'rect' as const, pen: penFromStyle(style), brush: null as BrushDict, ...r }) as BoxItem
      return finalise(styled(it, style), total, style)
    }
    return bakedPath(rx ? addRoundedRect([], r, rx, rx) : addRect([], r), total, style)
  }
  if (tag === 'circle' || tag === 'ellipse') {
    let rx: number
    let ry: number
    if (tag === 'circle') { rx = ry = pyFloat(attr(e, 'r') ?? '0') } else {
      rx = pyFloat(attr(e, 'rx') ?? '0'); ry = pyFloat(attr(e, 'ry') ?? '0')
    }
    const cx = pyFloat(attr(e, 'cx') ?? '0')
    const cy = pyFloat(attr(e, 'cy') ?? '0')
    const r = { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry }
    if (simple) {
      const it = base({ type: 'ellipse' as const, pen: penFromStyle(style), brush: null as BrushDict, ...r }) as BoxItem
      return finalise(styled(it, style), total, style)
    }
    return bakedPath(addEllipse([], r), total, style)
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = parsePoints(attr(e, 'points') ?? '')
    if (simple) {
      const it = base({ type: 'polygon' as const, pen: penFromStyle(style), brush: null as BrushDict,
        kind: kp(e, 'kind') ?? 'polygon', points: pts }) as PolygonItem
      return finalise(styled(it, style), total, style)
    }
    let p: Cmd[] = []
    if (pts.length) {
      p = moveTo(p, pts[0][0], pts[0][1])
      for (const [x, y] of pts.slice(1)) p = lineTo(p, x, y)
      p = lineTo(p, pts[0][0], pts[0][1])         // addPolygon closes the outline
    }
    if (tag === 'polygon') p = closeSubpath(p)
    return bakedPath(p, total, style)
  }
  if (tag === 'path') {
    const kind = kp(e, 'kind')
    if (kp(e, 'bend') !== null && simple) {          // bent line/arrow
      const it = newLine(kind === 'arrow' ? 'arrow' : null, pyFloat(kp(e, 'x1') ?? '0'), pyFloat(kp(e, 'y1') ?? '0'),
        pyFloat(kp(e, 'x2') ?? '0'), pyFloat(kp(e, 'y2') ?? '0'))
      const [bx, by] = kp(e, 'bend')!.trim().split(/[\s,]+/).map(pyFloat)
      it.bend = [bx, by]
      if (it.type === 'arrow') setHead(it, kp(e, 'head') ?? 'filled')
      return finalise(styled(it, style, false), total, style)
    }
    if (kind && ARC_KINDS.includes(kind) && simple) {
      const it = base({ type: 'arc' as const, kind, pen: penFromStyle(style), brush: null as BrushDict,
        x: pyFloat(kp(e, 'ax') ?? '0'), y: pyFloat(kp(e, 'ay') ?? '0'), w: pyFloat(kp(e, 'aw') ?? '0'),
        h: pyFloat(kp(e, 'ah') ?? '0'), flipH: kp(e, 'flip-h') === '1', flipV: kp(e, 'flip-v') === '1' }) as BoxItem
      return finalise(styled(it, style), total, style)
    }
    const localPath = pathFromD(attr(e, 'd') ?? '')
    if (simple) {
      const it = base({ type: 'path' as const, pen: penFromStyle(style), brush: null as BrushDict, cmds: localPath }) as PathItem
      return finalise(styled(it, style), total, style)
    }
    return bakedPath(localPath, total, style)
  }
  if (tag === 'text') return buildText(e, total, style)
  if (tag === 'image') return buildImage(e, total, style)
  return null
}

function itertext(e: XElement): string {
  let s = ''
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue ?? ''
    else if (n.nodeType === 1) s += itertext(n as XElement)
  }
  return s
}

function buildText(e: XElement, total: Mat, style: Style): TextItem {
  const text = itertext(e)
  const sizeStr = String(style['font-size'] ?? '14').replace(/[^\d.]/g, '')
  const size = Math.trunc(pyFloat(sizeStr || '14'))
  const it: TextItem = base({ type: 'text' as const, text: text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, ''),
    color: colorArgb(colorOf((style.fill as string) ?? '#000000')),
    family: String(style['font-family'] ?? 'Segoe UI'), size,
    bold: String(style['font-weight'] ?? '').includes('bold'), italic: style['font-style'] === 'italic' })
  const x = pyFloat(attr(e, 'x') ?? '0')
  let y = pyFloat(attr(e, 'y') ?? '0')
  if (attr(e, 'dominant-baseline') !== 'text-before-edge') y -= size * 0.8     // baseline -> top-left approx
  it.pos = mapPt(total, { x, y })
  const deg = decompose(total)[2]
  if (Math.abs(deg) > EPS) {
    centerOrigin(it)
    it.rotation = deg
  }
  if (style._opacity !== undefined) it.opacity = style._opacity
  return it
}

// The pixel size of a PNG / JPEG / GIF from its header (QPixmap's size).
export function imageSize(b64: string): [number, number] {
  try {
    const bin = atobSafe(b64.slice(0, 4096))
    const u = (i: number) => bin.charCodeAt(i)
    if (bin.startsWith('\x89PNG')) {
      return [(u(16) << 24 | u(17) << 16 | u(18) << 8 | u(19)) >>> 0, (u(20) << 24 | u(21) << 16 | u(22) << 8 | u(23)) >>> 0]
    }
    if (bin.startsWith('GIF')) return [u(6) | u(7) << 8, u(8) | u(9) << 8]
    if (u(0) === 0xff && u(1) === 0xd8) {
      let i = 2
      while (i < bin.length - 9) {
        if (u(i) !== 0xff) { i++; continue }
        const m = u(i + 1)
        const len = u(i + 2) << 8 | u(i + 3)
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return [u(i + 7) << 8 | u(i + 8), u(i + 5) << 8 | u(i + 6)]
        }
        i += 2 + len
      }
    }
  } catch { /* not an image */ }
  return [0, 0]
}

function atobSafe(b64: string): string {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const usable = clean.slice(0, clean.length - (clean.length % 4))
  return atob(usable)
}

function buildImage(e: XElement, total: Mat, style: Style): ImageItem {
  const h = href(e)
  const b64 = h && h.startsWith('data:') ? h.slice(h.indexOf(',') + 1) : ''
  const [natW0, natH0] = b64 ? imageSize(b64) : [0, 0]
  const natw = natW0 || 1
  const nath = natH0 || 1
  const x = pyFloat(attr(e, 'x') ?? '0')
  const y = pyFloat(attr(e, 'y') ?? '0')
  const w = attr(e, 'width') !== null ? pyFloat(attr(e, 'width')!) : natw
  const hh = attr(e, 'height') !== null ? pyFloat(attr(e, 'height')!) : nath
  // native pixels -> element box (scale then translate) -> parent
  const content: Mat = matMul([w / natw, 0, 0, hh / nath, 0, 0], [1, 0, 0, 1, x, y])
  const full = matMul(content, total)
  const it: ImageItem = base({ type: 'image' as const, image: b64, _w: natW0, _h: natH0 })
  it._origin = { x: 0, y: 0 }
  it.matrix = [full[0], full[1], full[2], full[3], 0, 0]
  it.pos = { x: full[4], y: full[5] }
  if (style._opacity !== undefined) it.opacity = style._opacity
  return it
}

function parsePoints(text: string): [number, number][] {
  const nums = text.trim().split(/[\s,]+/).filter(Boolean).map(pyFloat)
  const out: [number, number][] = []
  for (let i = 0; i < nums.length - 1; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

interface LoadCtx { scene: Scene; defs: Map<string, XElement> }

function parseElement(e: XElement, parentTf: Mat, inherited: Style, ctx: LoadCtx, depth = 0): Item | null {
  if (depth > 50) return null               // guard against <use> reference loops
  const tag = local(e)
  const style = resolveStyle(e, inherited)
  const total = matMul(parseTransform(attr(e, 'transform')), parentTf)
  if (tag === 'use') return parseUse(e, total, style, ctx, depth)
  if (tag === 'g' || tag === 'symbol' || tag === 'a' || tag === 'svg') {
    const grp = makeGroup()
    for (const child of elementChildren(e)) {
      const sub = parseElement(child, total, style, ctx, depth + 1)
      if (sub !== null) grp.children.push(sub)
    }
    const model = kp(e, 'model')
    if (model) {                            // 3D molecule/crystal model tag
      grp.model = model
      grp.model_az = floatOrNull(kp(e, 'model-az'))
      grp.model_el = floatOrNull(kp(e, 'model-el'))
      grp.model_bond = floatOrNull(kp(e, 'model-bond'))
      grp.model_box = floatOrNull(kp(e, 'model-box'))
      grp.model_repr = kp(e, 'model-repr') || '3d'
      const cells = jsonOrNull(kp(e, 'model-cells'))
      grp.model_cells = cells ? cells : null
      grp.model_colors = jsonOrNull(kp(e, 'model-colors'))
      grp.model_tilts = jsonOrNull(kp(e, 'model-tilts'))
      grp.model_poly = kp(e, 'model-poly') === '1'
      grp.model_atoms = jsonOrNull(kp(e, 'model-atoms'))
      grp.model_bonds = jsonOrNull(kp(e, 'model-bonds'))
    }
    if (kp(e, 'symbol')) grp.symbol = kp(e, 'symbol')!
    const solid = jsonOrNull(kp(e, 'solid'))
    if (solid && typeof solid === 'object' && !Array.isArray(solid)) grp.solid = solid
    const rxn = jsonOrNull(kp(e, 'reaction'))
    if (rxn && typeof rxn === 'object' && !Array.isArray(rxn)) grp.reaction = rxn
    return grp.children.length ? grp : null
  }
  if (tag === 'image' && kp(e, 'role') === 'raster') {
    const h = href(e)
    if (h && h.startsWith('data:')) {
      const b64 = h.slice(h.indexOf(',') + 1)
      const [w, hh] = imageSize(b64)
      if (w && hh) {
        ctx.scene.raster = b64
        ctx.scene.rasterW = w
        ctx.scene.rasterH = hh
        ctx.scene.width = w
        ctx.scene.height = hh
      }
    }
    return null
  }
  if (tag === 'text' && kp(e, 'role') === 'label') return null   // the shape carries its own label
  if (['defs', 'title', 'desc', 'metadata', 'style'].includes(tag)) return null
  const it = buildLeaf(e, total, style)
  if (it && (it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc'
    || it.type === 'polygon')) readLabel(e, it)
  return it
}

function floatOrNull(t: string | null): number | null {
  if (t === null) return null
  try { return pyFloat(t) } catch { return null }
}
function jsonOrNull(t: string | null): unknown {
  if (!t) return null
  try { return JSON.parse(t) } catch { return null }
}

// Resolve a <use xlink:href="#id"> by cloning the referenced element (from
// <defs> or anywhere by id) with the use's x/y offset applied. Inkscape /
// matplotlib exports lean on <use> for tick marks, markers and text
// rendered as glyph paths — without this they vanish on import.
function parseUse(e: XElement, total: Mat, style: Style, ctx: LoadCtx, depth: number): Item | null {
  const h = href(e)
  if (!h || !h.startsWith('#')) return null
  const target = ctx.defs.get(h.slice(1))
  if (!target) return null
  const x = pyFloat(attr(e, 'x') || '0')
  const y = pyFloat(attr(e, 'y') || '0')
  const b = x || y ? matMul([1, 0, 0, 1, x, y], total) : total
  return parseElement(target, b, style, ctx, depth + 1)
}

function readLabel(e: XElement, it: Item & LabelFields): void {
  const label = kp(e, 'label')
  if (!label) return
  it.label = label
  it.labelSize = Math.trunc(pyFloat(kp(e, 'label-size') ?? '14'))
  it.labelFamily = kp(e, 'label-family') ?? 'Segoe UI'
  it.labelBold = kp(e, 'label-bold') === '1'
  it.labelItalic = kp(e, 'label-italic') === '1'
  it.labelColor = colorArgb(colorOf(kp(e, 'label-color') ?? '#1a1a1a'))
}

// svgio.load_svg: the drawing an SVG document holds.
export function loadSvg(text: string): Scene {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement as unknown as XElement | null
  if (!root || local(root) === 'parsererror') throw new Error('not an SVG document')
  const [width, height] = rootSize(root)
  const scene = newScene(width, height)
  const dpi = kp(root, 'dpi')
  if (dpi !== null) scene.dpi = Math.trunc(pyFloat(dpi))
  const gridMm = kp(root, 'grid-mm')
  const divisions = kp(root, 'grid-divisions')    // legacy: divisions/width
  const legacy = kp(root, 'grid-size')            // legacy: pixel spacing
  if (gridMm !== null) scene.gridMm = pyFloat(gridMm)
  else if (divisions !== null) scene.gridMm = width / Math.max(Math.trunc(pyFloat(divisions)), 1) / scene.dpi * 25.4
  else if (legacy !== null) scene.gridMm = pyFloat(legacy) / scene.dpi * 25.4
  if (gridMm !== null || divisions !== null || legacy !== null) {
    scene.showGrid = (kp(root, 'grid-show') ?? '1') === '1'
    scene.snap = (kp(root, 'grid-snap') ?? '1') === '1'
    scene.infinite = (kp(root, 'infinite') ?? '0') === '1'
  }
  // Map every element that carries an id, so <use href="#id"> can find
  // its referent (glyphs/markers/ticks defined once in <defs>).
  const defs = new Map<string, XElement>()
  const all = root.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) {
    const e = all[i] as unknown as XElement
    if (attr(e, 'id')) defs.set(attr(e, 'id')!, e)
  }
  // Gradient defs ride along in the inherited style dict (it is copied down
  // the tree), so fill="url(#id)" resolves anywhere.
  const baseStyle: Style = { fill: '#000000', stroke: 'none', _gradients: scanGradients(root) }
  const ctx: LoadCtx = { scene, defs }
  let z = 0
  for (const child of elementChildren(root)) {
    const it = parseElement(child, [...IDENTITY], baseStyle, ctx)
    if (it !== null) {
      it.z = z
      z += 1
      settle(it)
      scene.items.push(it)
    }
  }
  return scene
}

// Items built by the loader get the origin addToGroup / addItem leave them
// (center_origin only where the loader called it).
function settle(it: Item): void {
  if (it.type === 'group') {
    it.children.forEach(settle)
    if (it._origin === undefined) it._origin = { x: 0, y: 0 }
  } else if (it._origin === undefined) {
    it._origin = { x: 0, y: 0 }
  }
}

function rootSize(root: XElement): [number, number] {
  const vb = attr(root, 'viewBox')
  if (vb) {
    const nums = vb.trim().split(/[\s,]+/).map(pyFloat)
    if (nums.length === 4) return [Math.trunc(nums[2]), Math.trunc(nums[3])]
  }
  const w = (attr(root, 'width') || '800').replace(/[^\d.]/g, '') || '800'
  const h = (attr(root, 'height') || '600').replace(/[^\d.]/g, '') || '600'
  return [Math.trunc(pyFloat(w)), Math.trunc(pyFloat(h))]
}

// ---------------------------------------------------------------- path data
export function pathFromD(d: string): Cmd[] {
  let path: Cmd[] = []
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0
  const n = tokens.length
  let cur: Pt = { x: 0, y: 0 }
  let start: Pt = { x: 0, y: 0 }
  let prevCmd = ''
  let prevCtrl: Pt | null = null
  const num = (): number => {
    if (i >= n) throw new Error('path data ended early')
    return pyFloat(tokens[i++])
  }
  const pt = (x: number, y: number, rel: boolean): Pt => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y })
  const reflect = (ctrl: Pt | null): Pt => (ctrl === null ? { ...cur } : { x: 2 * cur.x - ctrl.x, y: 2 * cur.y - ctrl.y })
  while (i < n) {
    const tok = tokens[i]
    let cmd: string
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok
      i++
    } else {
      cmd = prevCmd !== 'Z' && prevCmd !== 'z' ? prevCmd : 'L'
    }
    const rel = cmd === cmd.toLowerCase()
    const C = cmd.toUpperCase()
    if (C === 'M') {
      const x = num()
      const y = num()
      cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y }
      path = moveTo(path, cur.x, cur.y)
      start = { ...cur }
      prevCmd = rel ? 'l' : 'L'
    } else if (C === 'L') {
      const x = num()
      const y = num()
      cur = rel ? { x: cur.x + x, y: cur.y + y } : { x, y }
      path = lineTo(path, cur.x, cur.y)
      prevCmd = cmd
    } else if (C === 'H') {
      const x = num()
      cur = { x: rel ? cur.x + x : x, y: cur.y }
      path = lineTo(path, cur.x, cur.y)
      prevCmd = cmd
    } else if (C === 'V') {
      const y = num()
      cur = { x: cur.x, y: rel ? cur.y + y : y }
      path = lineTo(path, cur.x, cur.y)
      prevCmd = cmd
    } else if (C === 'C') {
      const c1 = pt(num(), num(), rel)
      const c2 = pt(num(), num(), rel)
      const end = pt(num(), num(), rel)
      path = cubicTo(path, c1, c2, end)
      prevCtrl = c2; cur = end; prevCmd = cmd
    } else if (C === 'S') {
      const c1: Pt = 'CS'.includes(prevCmd.toUpperCase()) && prevCmd ? reflect(prevCtrl) : { ...cur }
      const c2 = pt(num(), num(), rel)
      const end = pt(num(), num(), rel)
      path = cubicTo(path, c1, c2, end)
      prevCtrl = c2; cur = end; prevCmd = cmd
    } else if (C === 'Q') {
      const c = pt(num(), num(), rel)
      const end = pt(num(), num(), rel)
      path = quadTo(path, c, end)
      prevCtrl = c; cur = end; prevCmd = cmd
    } else if (C === 'T') {
      const c: Pt = 'QT'.includes(prevCmd.toUpperCase()) && prevCmd ? reflect(prevCtrl) : { ...cur }
      const end = pt(num(), num(), rel)
      path = quadTo(path, c, end)
      prevCtrl = c; cur = end; prevCmd = cmd
    } else if (C === 'A') {
      const rx = num()
      const ry = num()
      const rot = num()
      const large = num()
      const sweep = num()
      const end = pt(num(), num(), rel)
      path = arcToSvg(path, cur, rx, ry, rot, large, sweep, end)
      cur = end; prevCmd = cmd
    } else if (C === 'Z') {
      path = closeSubpath(path)
      cur = { ...start }
      prevCmd = cmd
    } else {
      break
    }
  }
  return path
}

// Append an SVG elliptical arc to `path` as cubic segments.
function arcToSvg(path: Cmd[], p0: Pt, rx: number, ry: number, phiDeg: number, large: number, sweep: number, p1: Pt): Cmd[] {
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return lineTo(path, p1.x, p1.y)
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = phiDeg * Math.PI / 180
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)
  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1p = cosP * dx + sinP * dy
  const y1p = -sinP * dx + cosP * dy
  const denom = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  if (denom === 0) return lineTo(path, p1.x, p1.y)
  const lam = (rx * rx * ry * ry) / denom
  if (lam < 1) {
    const scale = Math.sqrt(lam)
    rx = rx / scale
    ry = ry / scale
  }
  const sign = large === sweep ? -1 : 1
  const num = Math.max(rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, 0)
  const co = denom ? sign * Math.sqrt(num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)) : 0
  const cxp = co * rx * y1p / ry
  const cyp = -co * ry * x1p / rx
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI
  const segments = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)))
  const delta = dtheta / segments
  const t = (4 / 3) * Math.tan(delta / 4)
  let theta = theta1
  const elpt = (ccx: number, ccy: number, cosT: number, sinT: number): Pt => {
    const x = rx * cosT
    const y = ry * sinT
    return { x: ccx + cosP * x - sinP * y, y: ccy + sinP * x + cosP * y }
  }
  let out = path
  for (let k = 0; k < segments; k++) {
    const cos1 = Math.cos(theta)
    const sin1 = Math.sin(theta)
    const cos2 = Math.cos(theta + delta)
    const sin2 = Math.sin(theta + delta)
    const e1 = elpt(cx, cy, cos1, sin1)
    const e2 = elpt(cx, cy, cos2, sin2)
    const d1 = elpt(0, 0, -sin1, cos1)
    const d2 = elpt(0, 0, -sin2, cos2)
    out = cubicTo(out, { x: e1.x + t * d1.x, y: e1.y + t * d1.y }, { x: e2.x - t * d2.x, y: e2.y - t * d2.y }, e2)
    theta += delta
  }
  return out
}

// ================================================================ .kpaint dicts
// document.item_to_dict: the item as the snapshot / clipboard dict, keys in
// Python's order.
export function itemToDict(it: Item): Record<string, unknown> {
  const common: Record<string, unknown> = { pos: { x: it.pos.x, y: it.pos.y }, opacity: it.opacity,
    rotation: it.rotation, z: it.z, scale: it.scale }
  if (it.symbol) common.symbol = it.symbol
  const pen = (p: PenDict) => {
    const d: Record<string, unknown> = { color: p.color, width: p.width }
    if (p.none) d.none = true
    else if (p.dash && p.dash !== 'solid') d.dash = p.dash
    return d
  }
  const label = (l: LabelFields): Record<string, unknown> => {
    if (!l.label) return {}
    const lab = labelOf(l)
    return { label: lab.text, labelColor: colorArgb(color(lab.color)), labelFamily: lab.family, labelSize: lab.size,
      labelBold: lab.bold, labelItalic: lab.italic }
  }
  switch (it.type) {
    case 'dimension':
      return { type: 'dimension', pen: pen(it.pen), x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2,
        capStyle: it.capStyle ?? 'arrows', extension: !!it.extension, dash: !!it.dash, unit: it.unit ?? 'mm',
        decimals: it.decimals ?? 1, prefix: it.prefix ?? '', suffix: it.suffix ?? '', ...common }
    case 'line': case 'arrow': {
      const d: Record<string, unknown> = { type: it.type, pen: pen(it.pen), x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, ...common }
      if (it.bend) d.bend = [it.bend[0], it.bend[1]]
      if (it.type === 'arrow' && (it.head ?? 'filled') !== 'filled') d.head = it.head
      return d
    }
    case 'roundrect':
      return { type: 'roundrect', pen: pen(it.pen), brush: it.brush, radius: it.radius ?? 12,
        x: it.x, y: it.y, w: it.w, h: it.h, ...label(it), ...common }
    case 'arc':
      return { type: 'arc', kind: it.kind ?? 'halfcircle', pen: pen(it.pen), brush: it.brush,
        x: it.x, y: it.y, w: it.w, h: it.h, flipH: !!it.flipH, flipV: !!it.flipV, ...label(it), ...common }
    case 'polygon':
      return { type: 'polygon', pen: pen(it.pen), brush: it.brush, kind: it.kind,
        points: it.points.map(p => [p[0], p[1]]), ...label(it), ...common }
    case 'path':
      return { type: 'path', pen: pen(it.pen), brush: it.brush, cmds: it.cmds.map(c => [...c]), ...common }
    case 'image': {
      const m = itemToParent(it)
      return { type: 'image', image: it.image, matrix: [m[0], m[1], m[2], m[3], m[4], m[5]], ...common }
    }
    case 'rect': case 'ellipse':
      return { type: it.type, pen: pen(it.pen), brush: it.brush, x: it.x, y: it.y, w: it.w, h: it.h, ...label(it), ...common }
    case 'text':
      return { type: 'text', text: it.text, color: colorArgb(color(it.color)), family: it.family,
        size: qtPointSize(it.size), bold: it.bold, italic: it.italic, ...common }
    case 'group': {
      const d: Record<string, unknown> = { type: 'group', children: it.children.map(itemToDict), ...common }
      if (it.matrix && !(it.matrix[0] === 1 && it.matrix[1] === 0 && it.matrix[2] === 0 && it.matrix[3] === 1
        && it.matrix[4] === 0 && it.matrix[5] === 0)) d.matrix = [...it.matrix]
      if (it.model) {
        Object.assign(d, { model: it.model, model_az: it.model_az ?? null, model_el: it.model_el ?? null,
          model_bond: it.model_bond ?? null, model_box: it.model_box ?? null, model_repr: it.model_repr ?? null })
        if (it.model_cells) d.model_cells = [...(it.model_cells as number[])]
        if (it.model_colors) d.model_colors = { ...(it.model_colors as object) }
        if (it.model_tilts) d.model_tilts = { ...(it.model_tilts as object) }
        if (it.model_poly) d.model_poly = true
        if (it.model_atoms) { d.model_atoms = it.model_atoms; d.model_bonds = it.model_bonds }
      }
      if (it.solid) d.solid = { ...(it.solid as object) }
      if (it.reaction) d.reaction = structuredClone(it.reaction)
      return d
    }
  }
}

// document.item_from_dict: build an item from a snapshot / clipboard dict.
export function itemFromDict(d: Record<string, unknown>): Item {
  const kind = d.type as string
  const num = (k: string, def = 0) => Number(d[k] ?? def)
  let it: Item
  if (kind === 'line' || kind === 'arrow' || kind === 'dimension') {
    const li = newLine(kind === 'line' ? null : kind, num('x1'), num('y1'), num('x2'), num('y2'))
    li.pen = penFromDict(d.pen ?? {})
    if (kind === 'dimension') {
      li.capStyle = (d.capStyle as string) ?? 'arrows'
      li.extension = !!(d.extension ?? false)
      li.dash = !!(d.dash ?? false)
      li.unit = (d.unit as string) ?? 'mm'
      li.decimals = Number(d.decimals ?? 1)
      li.prefix = (d.prefix as string) ?? ''
      li.suffix = (d.suffix as string) ?? ''
    } else if (d.bend !== null && d.bend !== undefined) {
      const b = d.bend as number[]
      li.bend = [b[0], b[1]]
    }
    if (kind === 'arrow') {
      li.head = 'filled'
      setHead(li, (d.head as string) ?? 'filled')
    }
    it = li
  } else if (kind === 'rect' || kind === 'ellipse' || kind === 'roundrect' || kind === 'arc') {
    const b = base({ type: kind, pen: penFromDict(d.pen ?? {}), brush: brushFromDict(d.brush),
      x: num('x'), y: num('y'), w: num('w'), h: num('h') }) as BoxItem
    if (kind === 'roundrect') b.radius = Number(d.radius ?? 12)
    if (kind === 'arc') {
      b.kind = (d.kind as string) ?? 'halfcircle'
      b.flipH = !!(d.flipH ?? false)
      b.flipV = !!(d.flipV ?? false)
    }
    it = b
  } else if (kind === 'polygon') {
    it = base({ type: 'polygon' as const, pen: penFromDict(d.pen ?? {}), brush: brushFromDict(d.brush),
      kind: (d.kind as string) ?? 'polygon', points: ((d.points ?? []) as number[][]).map(p => [p[0], p[1]] as [number, number]) })
  } else if (kind === 'path') {
    it = base({ type: 'path' as const, pen: penFromDict(d.pen ?? {}), brush: brushFromDict(d.brush),
      cmds: qtPathFromCmds((d.cmds ?? []) as Cmd[]) })
  } else if (kind === 'image') {
    const b64 = String(d.image ?? '')
    const [w, h] = imageSize(b64)
    it = base({ type: 'image' as const, image: b64, _w: w, _h: h })
  } else if (kind === 'text') {
    it = base({ type: 'text' as const, text: String(d.text ?? ''), color: colorArgb(color((d.color as string) ?? '#ff1a1a1a')),
      family: String(d.family ?? 'Segoe UI'), size: Number(d.size ?? 14), bold: !!(d.bold ?? false),
      italic: !!(d.italic ?? false) })
  } else if (kind === 'group') {
    const grp = base(makeGroup()) as GroupItem
    for (const cd of (d.children ?? []) as Record<string, unknown>[]) grp.children.push(itemFromDict(cd))
    if (d.model) {
      Object.assign(grp, { model: d.model, model_az: d.model_az ?? null, model_el: d.model_el ?? null,
        model_bond: d.model_bond ?? null, model_box: d.model_box ?? null, model_repr: d.model_repr ?? '3d',
        model_cells: d.model_cells ?? null, model_colors: d.model_colors ?? null, model_tilts: d.model_tilts ?? null,
        model_poly: !!(d.model_poly ?? false), model_atoms: d.model_atoms ?? null, model_bonds: d.model_bonds ?? null })
    }
    if (d.solid && typeof d.solid === 'object') grp.solid = { ...(d.solid as object) }
    if (d.reaction && typeof d.reaction === 'object') grp.reaction = structuredClone(d.reaction)
    it = grp
  } else {
    throw new Error(`unknown item type: ${JSON.stringify(kind)}`)
  }
  if (d.label && (it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc'
    || it.type === 'polygon')) {
    it.label = String(d.label)
    it.labelFamily = String(d.labelFamily ?? 'Segoe UI')
    it.labelSize = Number(d.labelSize ?? 14)
    it.labelBold = !!(d.labelBold ?? false)
    it.labelItalic = !!(d.labelItalic ?? false)
    it.labelColor = colorArgb(color((d.labelColor as string) ?? '#ff1a1a1a'))
  }
  if (d.symbol) it.symbol = String(d.symbol)
  it.opacity = Number(d.opacity ?? 1.0)
  it.z = Number(d.z ?? 0.0)
  if (kind === 'image' && d.matrix) {
    const mx = d.matrix as number[]
    it._origin = { x: 0, y: 0 }
    it.matrix = [mx[0], mx[1], mx[2], mx[3], 0, 0]
    it.pos = { x: mx[4], y: mx[5] }
  } else {
    const pos = (d.pos ?? {}) as { x?: number; y?: number }
    it.pos = { x: pos.x ?? 0, y: pos.y ?? 0 }
    centerOrigin(it)          // rotate/scale about centre as it saved
    it.rotation = Number(d.rotation ?? 0.0)
    it.scale = Number(d.scale ?? 1.0)
    if (d.matrix) {           // group X/Y-only resize transform
      const m = d.matrix as number[]
      it.matrix = [m[0], m[1], m[2], m[3], m[4], m[5]]
    }
  }
  return it
}

// cmds_to_painterpath, with QPainterPath's own element rules.
export function qtPathFromCmds(cmds: Cmd[]): Cmd[] {
  let p: Cmd[] = []
  for (const c of cmds) {
    if (c[0] === 'M') p = moveTo(p, c[1], c[2])
    else if (c[0] === 'L') p = lineTo(p, c[1], c[2])
    else if (c[0] === 'C') p = cubicTo(p, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, { x: c[5], y: c[6] })
  }
  return p
}

// document.scene_to_dict (the undo snapshot). The raster rides along as
// its base64 PNG ("" for the blank page).
export function sceneToDict(s: Scene): Record<string, unknown> {
  return { format: 'kpaint', version: 13, width: Math.trunc(s.width), height: Math.trunc(s.height), dpi: s.dpi,
    grid: { mm: s.gridMm, show: s.showGrid, snap: s.snap, infinite: s.infinite },
    raster: s.raster ?? '', rasterW: s.rasterW, rasterH: s.rasterH,
    items: vectorItems(s).map(itemToDict) }
}

export function dictToScene(data: Record<string, unknown>): Scene {
  if (data.format !== 'kpaint') throw new Error('not a KhervePaint document')
  const s = newScene(Number(data.width ?? 800), Number(data.height ?? 600))
  s.dpi = Number(data.dpi ?? 96)
  const grid = (data.grid ?? {}) as Record<string, unknown>
  if ('mm' in grid) s.gridMm = Number(grid.mm)
  s.showGrid = grid.show === undefined ? true : !!grid.show
  s.snap = grid.snap === undefined ? true : !!grid.snap
  s.infinite = !!(grid.infinite ?? false)
  if (data.raster) {
    s.raster = String(data.raster)
    s.rasterW = Number(data.rasterW ?? s.width)
    s.rasterH = Number(data.rasterH ?? s.height)
  }
  for (const d of (data.items ?? []) as Record<string, unknown>[]) s.items.push(itemFromDict(d))
  return s
}

// ---------------------------------------------------------------- legacy
// load_legacy_json: a drawing saved by the old dialog (PNG + JSON sidecar)
// as editable items.
export function loadLegacyJson(s: Scene, data: Record<string, unknown>): number {
  let count = 0
  for (const d of (data.items ?? []) as Record<string, unknown>[]) {
    const p: PenDict = { color: colorArgb(color((d.color as string) ?? '#000000')), width: Number(d.width ?? 2) }
    const t = (d.type as string) ?? ''
    let it: Item | null = null
    if (t === 'text') {
      it = base({ type: 'text' as const, text: String(d.text ?? ''), color: colorArgb(color((d.color as string) ?? '#000000')),
        family: DEFAULT_FONT_FAMILY, size: Math.trunc(Number(d.font_size ?? 14)), bold: false, italic: false })
      it.pos = { x: Number(d.x ?? 0), y: Number(d.y ?? 0) }
    } else if (t === 'line') {
      it = newLine(null, Number(d.x1 ?? 0), Number(d.y1 ?? 0), Number(d.x2 ?? 0), Number(d.y2 ?? 0))
      it.pen = p
    } else if (t === 'rect' || t === 'ellipse') {
      it = base({ type: t, pen: p, brush: null as BrushDict, x: Number(d.x ?? 0), y: Number(d.y ?? 0),
        w: Number(d.w ?? 0), h: Number(d.h ?? 0) }) as BoxItem
    } else if (t === 'path' || t === 'arrow') {
      const els = (d.elements ?? []) as { t?: string; x: number; y: number }[]
      if (t === 'arrow' && els.length >= 2) {
        const a = newLine('arrow', els[0].x, els[0].y, els[1].x, els[1].y)
        setHead(a, 'open')
        it = a
      } else {
        let path: Cmd[] = []
        for (const e of els) path = e.t === 'M' ? moveTo(path, e.x, e.y) : lineTo(path, e.x, e.y)
        it = base({ type: 'path' as const, pen: p, brush: null as BrushDict, cmds: path })
      }
      ;(it as LineItem | PathItem).pen = p
    }
    if (it !== null) {
      it._origin = { x: 0, y: 0 }
      s.items.push(it)
      count += 1
    }
  }
  return count
}

export { textBounds, matInvert }
