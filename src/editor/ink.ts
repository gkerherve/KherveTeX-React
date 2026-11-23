// Draw tab, on the page: an SVG layer over the sheets that shows the
// document's ink (DocMeta.ink) and, while a pen or the eraser is chosen,
// takes the pointer — a pen adds a stroke, the eraser removes the strokes
// it touches (Word's stroke eraser). Strokes are kept in millimetres from
// their page's top-left corner, so the PDF puts them at the same place.
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

  private path(s: { pts: number[]; color: string; width: number; alpha?: number }, page: number): SVGPathElement {
    const H = this.host.pageHeightPx()
    const p = document.createElementNS(SVG, 'path')
    let d = ''
    for (let i = 0; i + 1 < s.pts.length; i += 2) {
      d += `${i ? 'L' : 'M'}${(s.pts[i] * PX_MM).toFixed(1)} ${((page - 1) * H + s.pts[i + 1] * PX_MM).toFixed(1)}`
    }
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
      this.host.setInk([...this.host.ink(), stroke])
    }
    this.el.addEventListener('pointermove', move)
    this.el.addEventListener('pointerup', up)
  }

  // Remove the strokes within reach of (x, y) (layout px).
  private erase([x, y]: [number, number]): void {
    const H = this.host.pageHeightPx()
    const page = Math.floor(y / H) + 1
    const mx = x / PX_MM, my = (y - (page - 1) * H) / PX_MM
    const ink = this.host.ink()
    const keep = ink.filter(s => {
      if (s.page !== page) return true
      const reach = 1.5 + s.width * 0.35 / 2
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const ax = s.pts[i], ay = s.pts[i + 1]
        const bx = s.pts[i + 2] ?? ax, by = s.pts[i + 3] ?? ay
        if (distSeg(mx, my, ax, ay, bx, by) <= reach) return false
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
