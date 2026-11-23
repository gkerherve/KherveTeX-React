// Draw tab, on the page: an SVG layer over the sheets that shows the
// document's ink (DocMeta.ink) and, while a pen or the eraser is chosen,
// takes the pointer — a pen adds a stroke, the eraser removes the strokes
// it touches (Word's stroke eraser). Strokes are kept in millimetres from
// their page's top-left corner, so the PDF puts them at the same place.
import type { Node as PMNode } from 'prosemirror-model'
import { thin, type InkStroke, type Pen } from '../core/ink.ts'

const PX_MM = 96 / 25.4
const SVG = 'http://www.w3.org/2000/svg'

export type InkTool = { kind: 'pen'; pen: Pen } | { kind: 'eraser' } | null

let tool: InkTool = null
const listeners = new Set<() => void>()
export function inkTool(): InkTool { return tool }
export function setInkTool(t: InkTool): void {
  tool = t
  for (const l of listeners) l()
}
export function onInkTool(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export interface InkHost {
  ink(): InkStroke[]
  setInk(ink: InkStroke[]): void
  pageHeightPx(): number
  pageWidthPx(): number
  // Screen px per layout px (the page zoom).
  zoom(): number
  // The word nearest (x, y) (layout px over the stacked sheets): its
  // paragraph, offset and baseline point; null off the text.
  anchorFor(x: number, y: number): { block: number; offset: number; x: number; y: number } | null
  // Where that word's baseline point is now (layout px), null if gone.
  anchorPoint(a: { block: number; offset: number }): [number, number] | null
}

export class InkLayer {
  readonly el: SVGSVGElement
  private live: SVGPathElement | null = null
  private pts: number[] = []   // layout px while drawing
  private offTool: () => void

  private host: InkHost

  constructor(host: InkHost) {
    this.host = host
    this.el = document.createElementNS(SVG, 'svg')
    this.el.setAttribute('class', 'kt-ink')
    this.el.addEventListener('pointerdown', this.down)
    this.offTool = onInkTool(() => this.syncTool())
    this.syncTool()
  }

  destroy(): void {
    this.offTool()
    this.el.removeEventListener('pointerdown', this.down)
  }

  private syncTool(): void {
    this.el.classList.toggle('drawing', tool?.kind === 'pen')
    this.el.classList.toggle('erasing', tool?.kind === 'eraser')
  }

  // A stroke's points in layout px over the stacked sheets; an anchored
  // stroke moved by as much as its word has moved since it was drawn.
  private placed(s: { pts: number[]; anchor?: InkStroke['anchor'] }, page: number): number[] {
    const H = this.host.pageHeightPx()
    let dx = 0, dy = 0
    if (s.anchor) {
      const now = this.host.anchorPoint(s.anchor)
      if (now) { dx = now[0] - s.anchor.x * PX_MM; dy = now[1] - ((page - 1) * H + s.anchor.y * PX_MM) }
    }
    const out: number[] = []
    for (let i = 0; i + 1 < s.pts.length; i += 2) out.push(s.pts[i] * PX_MM + dx, (page - 1) * H + s.pts[i + 1] * PX_MM + dy)
    return out
  }

  private path(s: { pts: number[]; color: string; width: number; alpha?: number; anchor?: InkStroke['anchor'] }, page: number): SVGPathElement {
    const p = document.createElementNS(SVG, 'path')
    const px = this.placed(s, page)
    let d = ''
    for (let i = 0; i + 1 < px.length; i += 2) d += `${i ? 'L' : 'M'}${px[i].toFixed(1)} ${px[i + 1].toFixed(1)}`
    if (s.pts.length === 2) d += 'l0.01 0'
    p.setAttribute('d', d)
    p.setAttribute('fill', 'none')
    p.setAttribute('stroke', s.color)
    p.setAttribute('stroke-width', String(s.width * 96 / 72))
    p.setAttribute('stroke-linecap', 'round')
    p.setAttribute('stroke-linejoin', 'round')
    if (s.alpha !== undefined && s.alpha < 1) p.setAttribute('stroke-opacity', String(s.alpha))
    return p
  }

  // Draw the document's strokes over `sheets` pages.
  render(sheets: number): void {
    const W = this.host.pageWidthPx(), H = this.host.pageHeightPx()
    this.el.setAttribute('width', String(W))
    this.el.setAttribute('height', String(sheets * H))
    this.el.setAttribute('viewBox', `0 0 ${W} ${sheets * H}`)
    this.el.replaceChildren(...this.host.ink().map(s => this.path(s, s.page)))
    if (this.live) this.el.appendChild(this.live)
  }

  private at(e: PointerEvent): [number, number] {
    const r = this.el.getBoundingClientRect()
    const z = this.host.zoom() || 1
    return [(e.clientX - r.left) / z, (e.clientY - r.top) / z]
  }

  private down = (e: PointerEvent): void => {
    if (!tool || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    this.el.setPointerCapture(e.pointerId)
    if (tool.kind === 'eraser') {
      this.erase(this.at(e))
      const move = (ev: PointerEvent) => this.erase(this.at(ev))
      const up = () => { this.el.removeEventListener('pointermove', move); this.el.removeEventListener('pointerup', up) }
      this.el.addEventListener('pointermove', move)
      this.el.addEventListener('pointerup', up)
      return
    }
    const pen = tool.pen
    const [x, y] = this.at(e)
    this.pts = [x, y]
    const H = this.host.pageHeightPx()
    const page = Math.floor(y / H) + 1
    const toMm = () => {
      const out: number[] = []
      for (let i = 0; i + 1 < this.pts.length; i += 2) {
        out.push(this.pts[i] / PX_MM, (this.pts[i + 1] - (page - 1) * H) / PX_MM)
      }
      return out
    }
    this.live = this.path({ pts: toMm(), color: pen.color, width: pen.width, alpha: pen.alpha }, page)
    this.el.appendChild(this.live)
    const move = (ev: PointerEvent) => {
      const evs = ev.getCoalescedEvents?.() ?? [ev]
      for (const c of evs.length ? evs : [ev]) this.pts.push(...this.at(c))
      const np = this.path({ pts: toMm(), color: pen.color, width: pen.width, alpha: pen.alpha }, page)
      this.live?.setAttribute('d', np.getAttribute('d')!)
    }
    const up = () => {
      this.el.removeEventListener('pointermove', move)
      this.el.removeEventListener('pointerup', up)
      const pts = thin(toMm())
      this.live?.remove()
      this.live = null
      const stroke: InkStroke = { page, color: pen.color, width: pen.width, pts }
      if (pen.alpha !== undefined && pen.alpha < 1) stroke.alpha = pen.alpha
      // Anchored to the word under the stroke's middle, as Word's ink.
      if (pts.length >= 4) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
        for (let i = 0; i + 1 < pts.length; i += 2) {
          x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1])
        }
        const cx = (x0 + x1) / 2 * PX_MM, cy = (page - 1) * H + (y0 + y1) / 2 * PX_MM
        const a = this.host.anchorFor(cx, cy)
        // Only a word on the stroke's page and near it (not across a gap).
        if (a && Math.floor(a.y / H) + 1 === page && Math.abs(a.y - cy) < 25 * PX_MM) {
          stroke.anchor = { block: a.block, offset: a.offset,
            x: Math.round(a.x / PX_MM * 100) / 100, y: Math.round((a.y - (page - 1) * H) / PX_MM * 100) / 100 }
        }
      }
      this.host.setInk([...this.host.ink(), stroke])
    }
    this.el.addEventListener('pointermove', move)
    this.el.addEventListener('pointerup', up)
  }

  // Remove the strokes within reach of (x, y) (layout px).
  private erase([x, y]: [number, number]): void {
    const ink = this.host.ink()
    const keep = ink.filter(s => {
      const reach = (1.5 + s.width * 0.35 / 2) * PX_MM
      const p = this.placed(s, s.page)
      for (let i = 0; i + 1 < p.length; i += 2) {
        const ax = p[i], ay = p[i + 1]
        const bx = p[i + 2] ?? ax, by = p[i + 3] ?? ay
        if (distSeg(x, y, ax, ay, bx, by) <= reach) return false
      }
      return true
    })
    if (keep.length !== ink.length) this.host.setInk(keep)
  }
}

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// ---- Anchors: a paragraph's index and a text offset in it ----
// The offset counts the characters the model keeps as text (a line break
// is a space; math, citations and footnotes count nothing), so the
// serializer finds the same place in the paragraph's inlines.

const leafText = (n: PMNode) => (n.type.name === 'line_sep' ? ' ' : '')

// The anchor at `pos`, moved back to the start of its word; null outside
// a top-level paragraph.
export function anchorAtPos(doc: PMNode, pos: number, toWord = true): { block: number; offset: number; pos: number } | null {
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  if ($p.depth < 1) return null
  const block = $p.index(0)
  const node = doc.child(block)
  if (node.type.name !== 'paragraph') return null
  const start = $p.before(1) + 1
  let rel = $p.pos - start
  const before = node.textBetween(0, rel, '', leafText)
  const word = /[\p{L}\p{N}'’-]+$/u.exec(node.textBetween(0, rel, '', '￼'))
  let offset = before.length
  if (word && toWord) { offset -= word[0].length; rel -= word[0].length }
  return { block, offset, pos: start + rel }
}

// The document position of an anchor; null if its paragraph is gone.
export function posOfAnchor(doc: PMNode, a: { block: number; offset: number }): number | null {
  if (a.block >= doc.childCount) return null
  const node = doc.child(a.block)
  if (node.type.name !== 'paragraph') return null
  let start = 1
  for (let i = 0; i < a.block; i++) start += doc.child(i).nodeSize
  let left = a.offset, found: number | null = null
  node.forEach((c, off) => {
    if (found !== null) return
    const len = c.isText ? c.text!.length : leafText(c).length
    if (left <= len && (c.isText || len)) { found = start + off + (c.isText ? left : 0); return }
    left -= len
  })
  return found ?? (left === 0 || node.content.size === 0 ? start + node.content.size : start + node.content.size)
}
