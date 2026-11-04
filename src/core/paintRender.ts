// How the drawing engine paints its items (the paint() methods of
// khervedoc/paint/canvas.py: arrowheads, dimension caps and labels, shape
// labels, text), as a tree of drawing primitives that two back ends turn
// into an SVG picture (the canvas, the PNG preview) or a PDF page
// (paintPdf.ts) — scene.render() in Qt.
import {
  ARROW_HEAD, alphaF, cmdsBounds, color, curvePath, DASH_PATTERNS, DEFAULT_FONT_FAMILY, DIM_HEAD, endAngle,
  itemToParent, lineLength, outlinePath, penDash, startAngle, TEXT_MARGIN, textFont, textLines, textMetrics,
  vectorItems, boundingRect,
  type Cmd, type Color, type FontSpec, type GradSpec, type Item, type LabelFields, type LineItem, type Mat,
  type PenDict, type Pt, type Rect, type Scene, type TextItem,
} from './paintModel.ts'
import { labelOf } from './paintSvg.ts'
import { pyFixed } from './py.ts'

export type Fill = { color: Color } | { grad: GradSpec; bbox: Rect }
export interface Stroke { color: Color; width: number; dash: number[]; cap: 'round' | 'butt' | 'square'; join: 'round' | 'miter' | 'bevel' }
export type Prim =
  | { k: 'g'; m: Mat; opacity: number; children: Prim[] }
  | { k: 'path'; cmds: Cmd[]; fill: Fill | null; stroke: Stroke | null; evenOdd?: boolean }
  | { k: 'text'; x: number; y: number; text: string; font: FontSpec; color: Color; anchor: 'start' | 'middle' }
  | { k: 'image'; b64: string; w: number; h: number }

function stroke(p: PenDict, o: Partial<Stroke> = {}): Stroke | null {
  if (p.none) return null
  const w = p.width
  const dash = DASH_PATTERNS[penDash(p)].map(v => v * Math.max(w, 1))
  return { color: color(p.color), width: w, dash, cap: 'round', join: 'round', ...o }
}

function brushFill(it: { brush: import('./paintModel.ts').BrushDict }, path: Cmd[]): Fill | null {
  const b = it.brush
  if (b === null) return null
  if ('gradient' in b) return { grad: b.gradient, bbox: cmdsBounds(path) }
  return { color: color(b.color) }
}

const pt = (x: number, y: number): Pt => ({ x, y })
const poly = (pts: Pt[], close = true): Cmd[] => {
  const c: Cmd[] = pts.map((p, i) => [i === 0 ? 'M' : 'L', p.x, p.y] as Cmd)
  if (close && pts.length) c.push(['L', pts[0].x, pts[0].y])
  return c
}

// ArrowItem._head_polygon
function headPolygon(it: LineItem, tip: Pt, angle: number): Pt[] {
  const head = it.head ?? 'filled'
  const size = ARROW_HEAD + Math.max(0.0, it.pen.width - 2) * 1.5
  const spread = head !== 'stealth' ? Math.PI / 7 : Math.PI / 10
  const left = pt(tip.x - Math.cos(angle - spread) * size, tip.y - Math.sin(angle - spread) * size)
  const right = pt(tip.x - Math.cos(angle + spread) * size, tip.y - Math.sin(angle + spread) * size)
  if (head === 'stealth') {
    const notch = pt(tip.x - Math.cos(angle) * size * 0.65, tip.y - Math.sin(angle) * size * 0.65)
    return [tip, left, notch, right]
  }
  return [tip, left, right]
}

const UNIT_PER_MM: Record<string, number> = { mm: 1.0, cm: 0.1, in: 1.0 / 25.4 }

// DimensionItem._label_text: "{prefix}{value:.{decimals}f} {unit}{suffix}".
export function dimensionLabel(it: LineItem, dpi: number): string {
  const mm = lineLength(it) / Math.max(dpi, 1) * 25.4
  const v = mm * (UNIT_PER_MM[it.unit ?? 'mm'] ?? 1.0)
  return `${it.prefix ?? ''}${pyFixed(v, it.decimals ?? 1)} ${it.unit ?? 'mm'}${it.suffix ?? ''}`
}

function linePrims(it: LineItem, dpi: number): Prim[] {
  const out: Prim[] = []
  if (it.type === 'dimension') {
    const len = lineLength(it)
    if (len < 1) return out
    const c = color(it.pen.color)
    const angle = Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
    const perp = pt(Math.sin(angle), -Math.cos(angle))
    const lineStroke: Stroke = { ...stroke(it.pen)!, dash: it.dash ? DASH_PATTERNS.dash.map(v => v * Math.max(it.pen.width, 1)) : [] }
    if (it.pen.none) return out
    out.push({ k: 'path', cmds: [['M', it.x1, it.y1], ['L', it.x2, it.y2]], fill: null, stroke: lineStroke })
    if (it.extension) {
      const EXT = 14
      for (const p of [pt(it.x1, it.y1), pt(it.x2, it.y2)]) {
        out.push({ k: 'path', cmds: [['M', p.x - perp.x * EXT, p.y - perp.y * EXT], ['L', p.x + perp.x * EXT, p.y + perp.y * EXT]],
          fill: null, stroke: lineStroke })
      }
    }
    const w = it.pen.width
    const cap = it.capStyle ?? 'arrows'
    const plain: Stroke = { color: c, width: w, dash: [], cap: 'butt', join: 'miter' }
    const head = (tip: Pt, other: Pt) => {
      const a = Math.atan2(tip.y - other.y, tip.x - other.x)
      return [tip, pt(tip.x - Math.cos(a - Math.PI / 7) * DIM_HEAD, tip.y - Math.sin(a - Math.PI / 7) * DIM_HEAD),
        pt(tip.x - Math.cos(a + Math.PI / 7) * DIM_HEAD, tip.y - Math.sin(a + Math.PI / 7) * DIM_HEAD)]
    }
    const p1 = pt(it.x1, it.y1)
    const p2 = pt(it.x2, it.y2)
    if (cap === 'arrows') {
      out.push({ k: 'path', cmds: poly(head(p2, p1)), fill: { color: c }, stroke: plain })
      out.push({ k: 'path', cmds: poly(head(p1, p2)), fill: { color: c }, stroke: plain })
    } else if (cap === 'ticks') {
      const d = pt(Math.cos(angle + Math.PI / 4) * 7, Math.sin(angle + Math.PI / 4) * 7)
      for (const p of [p1, p2]) {
        out.push({ k: 'path', cmds: [['M', p.x - d.x, p.y - d.y], ['L', p.x + d.x, p.y + d.y]], fill: null,
          stroke: { ...plain, width: Math.max(w, 1) } })
      }
    } else if (cap === 'dots') {
      for (const p of [p1, p2]) {
        out.push({ k: 'path', cmds: ellipseCmds(p, 4, 4), fill: { color: c }, stroke: plain })
      }
    }
    // length label, offset just off the line at its midpoint
    const mid = pt((it.x1 + it.x2) / 2, (it.y1 + it.y2) / 2)
    const tp = pt(mid.x + perp.x * 14, mid.y + perp.y * 14)
    const font: FontSpec = { family: DEFAULT_FONT_FAMILY, px: 10, bold: false, italic: false }
    const text = dimensionLabel(it, dpi)
    out.push({ k: 'text', x: tp.x - textMetrics().width(text, font) / 2, y: tp.y + textMetrics().ascent(font) / 2 - 1,
      text, font, color: c, anchor: 'start' })
    return out
  }
  const s = stroke(it.pen)
  if (s) out.push({ k: 'path', cmds: curvePath(it), fill: null, stroke: s })
  if (it.type === 'arrow' && lineLength(it) >= 1 && s) {
    const head = it.head ?? 'filled'
    const c = color(it.pen.color)
    const heads = [headPolygon(it, pt(it.x2, it.y2), endAngle(it))]
    if (head === 'double') heads.push(headPolygon(it, pt(it.x1, it.y1), startAngle(it)))
    for (const h of heads) {
      if (head === 'open') {
        out.push({ k: 'path', cmds: poly([h[1], h[0], h[2]], false), fill: null,
          stroke: { color: c, width: it.pen.width, dash: [], cap: 'round', join: 'round' } })
      } else {
        out.push({ k: 'path', cmds: poly(h), fill: { color: c },
          stroke: { color: c, width: it.pen.width, dash: [], cap: 'round', join: 'miter' } })
      }
    }
  }
  return out
}

function ellipseCmds(c: Pt, rx: number, ry: number): Cmd[] {
  const k = 0.5522847498
  return [['M', c.x + rx, c.y],
    ['C', c.x + rx, c.y + ry * k, c.x + rx * k, c.y + ry, c.x, c.y + ry],
    ['C', c.x - rx * k, c.y + ry, c.x - rx, c.y + ry * k, c.x - rx, c.y],
    ['C', c.x - rx, c.y - ry * k, c.x - rx * k, c.y - ry, c.x, c.y - ry],
    ['C', c.x + rx * k, c.y - ry, c.x + rx, c.y - ry * k, c.x + rx, c.y]]
}

// Word-wrap `text` to `width` (Qt.TextWordWrap).
export function wrapText(text: string, font: FontSpec, width: number): string[] {
  const m = textMetrics()
  const out: string[] = []
  for (const para of textLines(text)) {
    const words = para.split(' ')
    let line = ''
    for (const w of words) {
      const cand = line ? line + ' ' + w : w
      if (line && m.width(cand, font) > width) {
        out.push(line)
        line = w
      } else {
        line = cand
      }
    }
    out.push(line)
  }
  return out
}

// LabelMixin._paint_label: the label centred in the bounding rect.
function labelPrims(it: Item & LabelFields): Prim[] {
  if (!it.label) return []
  const lab = labelOf(it)
  const font: FontSpec = { family: lab.family, px: lab.size, bold: lab.bold, italic: lab.italic }
  const r = boundingRect(it)
  const m = textMetrics()
  const lines = wrapText(lab.text, font, r.w)
  const lh = m.lineHeight(font)
  const top = r.y + r.h / 2 - lines.length * lh / 2
  return lines.map((line, i) => ({ k: 'text' as const, x: r.x + r.w / 2, y: top + i * lh + m.ascent(font) + (lh - m.lineHeight(font)) / 2,
    text: line, font, color: color(lab.color), anchor: 'middle' as const }))
}

function textPrims(it: TextItem): Prim[] {
  const font = textFont(it)
  const m = textMetrics()
  return textLines(it.text).map((line, i) => ({ k: 'text' as const, x: TEXT_MARGIN,
    y: TEXT_MARGIN + i * m.lineHeight(font) + m.ascent(font), text: line, font, color: color(it.color), anchor: 'start' as const }))
}

// One item (and its children), in its parent's coordinates.
export function itemPrims(it: Item, dpi = 96): Prim {
  let children: Prim[]
  switch (it.type) {
    case 'line': case 'arrow': case 'dimension':
      children = linePrims(it, dpi)
      break
    case 'rect': case 'ellipse': case 'roundrect': case 'arc': case 'polygon': case 'path': {
      const path = outlinePath(it) ?? []
      children = [{ k: 'path', cmds: path, fill: brushFill(it, path), stroke: stroke(it.pen),
        evenOdd: it.type === 'path' || it.type === 'polygon' }]
      if (it.type !== 'path') children.push(...labelPrims(it))
      break
    }
    case 'text':
      children = textPrims(it)
      break
    case 'image':
      children = [{ k: 'image', b64: it.image, w: it._w ?? 0, h: it._h ?? 0 }]
      break
    case 'group':
      children = [...it.children].map((c, i) => ({ c, i })).sort((a, b) => a.c.z - b.c.z || a.i - b.i)
        .map(({ c }) => itemPrims(c, dpi))
      break
  }
  return { k: 'g', m: itemToParent(it), opacity: it.opacity, children }
}

export function scenePrims(s: Scene): Prim[] {
  return vectorItems(s).map(it => itemPrims(it, s.dpi))
}

// ------------------------------------------------------------- SVG back end
const n = (v: number) => (Number.isFinite(v) ? +v.toFixed(4) : 0)

export function cmdsToD(cmds: Cmd[]): string {
  return cmds.map(c => (c[0] === 'C'
    ? `C${n(c[1])},${n(c[2])} ${n(c[3])},${n(c[4])} ${n(c[5])},${n(c[6])}`
    : `${c[0]}${n(c[1])},${n(c[2])}`)).join(' ')
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function cssFamily(f: string): string {
  const generic = /^(sans serif|sans-serif|\.applesystemuifont)$/i.test(f) ? 'sans-serif' : null
  if (generic) return '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
  return `"${f.replaceAll('"', '')}", Helvetica, Arial, sans-serif`
}

export const rgb = (c: Color) => `rgb(${c.r},${c.g},${c.b})`

interface SvgCtx { defs: string[]; n: number; prefix: string }

function gradDef(ctx: SvgCtx, g: GradSpec): string {
  const id = `${ctx.prefix}g${ctx.n++}`
  const c1 = color(g.c1)
  const c2 = color(g.c2)
  const stop = (off: number, c: Color) => `<stop offset="${off}" stop-color="${rgb(c)}" stop-opacity="${n(alphaF(c))}"/>`
  if (g.kind === 'radial') {
    ctx.defs.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.7071" fx="0.5" fy="0.5">${stop(0, c1)}${stop(1, c2)}</radialGradient>`)
  } else if (g.kind === 'sun') {
    ctx.defs.push(`<radialGradient id="${id}" cx="0.35" cy="0.35" r="0.95" fx="0.25" fy="0.25">${stop(0, c2)}${stop(1, c1)}</radialGradient>`)
  } else {
    const rad = (g.angle ?? 90) * Math.PI / 180
    const dx = Math.cos(rad) / 2
    const dy = Math.sin(rad) / 2
    ctx.defs.push(`<linearGradient id="${id}" x1="${n(0.5 - dx)}" y1="${n(0.5 - dy)}" x2="${n(0.5 + dx)}" y2="${n(0.5 + dy)}">${stop(0, c1)}${stop(1, c2)}</linearGradient>`)
  }
  return id
}

function primSvg(p: Prim, ctx: SvgCtx): string {
  switch (p.k) {
    case 'g': {
      const m = p.m
      const tf = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0 ? ''
        : ` transform="matrix(${m.map(n).join(',')})"`
      const op = p.opacity < 1 ? ` opacity="${n(p.opacity)}"` : ''
      return `<g${tf}${op}>${p.children.map(c => primSvg(c, ctx)).join('')}</g>`
    }
    case 'path': {
      let fill = 'none'
      if (p.fill && 'color' in p.fill) fill = `${rgb(p.fill.color)}" fill-opacity="${n(alphaF(p.fill.color))}`
      else if (p.fill) fill = `url(#${gradDef(ctx, p.fill.grad)})`
      let st = ''
      if (p.stroke) {
        const s = p.stroke
        st = ` stroke="${rgb(s.color)}" stroke-opacity="${n(alphaF(s.color))}" stroke-width="${n(s.width)}"`
          + ` stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"`
          + (s.join === 'miter' ? ' stroke-miterlimit="2"' : '')
          + (s.dash.length ? ` stroke-dasharray="${s.dash.map(n).join(' ')}"` : '')
      }
      const rule = p.evenOdd ? ' fill-rule="evenodd"' : ''
      return `<path d="${cmdsToD(p.cmds)}" fill="${fill}"${rule}${st}/>`
    }
    case 'text': {
      const f = p.font
      return `<text x="${n(p.x)}" y="${n(p.y)}" font-family="${esc(cssFamily(f.family))}" font-size="${n(f.px)}"`
        + `${f.bold ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}`
        + ` fill="${rgb(p.color)}" fill-opacity="${n(alphaF(p.color))}"${p.anchor === 'middle' ? ' text-anchor="middle"' : ''}`
        + ` xml:space="preserve">${esc(p.text)}</text>`
    }
    case 'image':
      return `<image x="0" y="0" width="${p.w}" height="${p.h}" preserveAspectRatio="none" href="data:image/png;base64,${p.b64}"/>`
  }
}

// The markup of a list of primitives (gradient defs included).
export function primsToSvg(prims: Prim[], idPrefix = 'kd'): string {
  const ctx: SvgCtx = { defs: [], n: 0, prefix: idPrefix }
  const body = prims.map(p => primSvg(p, ctx)).join('')
  return (ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '') + body
}

// A standalone picture of `rect` of the scene, `w` × `h` pixels on white
// (export.save_png's render).
export function sceneToSvg(s: Scene, rect: Rect, w: number, h: number, opts: { raster?: boolean; background?: string | null } = {}): string {
  const bg = opts.background === undefined ? '#ffffff' : opts.background
  const raster = opts.raster !== false && s.raster
    ? `<image x="0" y="0" width="${s.rasterW ?? s.width}" height="${s.rasterH ?? s.height}" href="data:image/png;base64,${s.raster}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${n(rect.x)} ${n(rect.y)} ${n(rect.w)} ${n(rect.h)}" preserveAspectRatio="none">`
    + (bg ? `<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}" fill="${bg}"/>` : '')
    + raster + primsToSvg(scenePrims(s)) + '</svg>'
}
