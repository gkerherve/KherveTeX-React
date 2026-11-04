// Real pages, as PagedTextEdit lays the QTextDocument out with a page
// size: a line that would cross a page's bottom margin moves to the next
// sheet, a block that must start a page (a chapter, the title page's end)
// does, and tables, figures and equations move whole. The editor is one
// flow; page breaks are spacers (plugins.ts) sized from a measurement of
// that flow with the spacers taken out again.
import type { EditorView } from 'prosemirror-view'
import type { PageGeometry } from './layout.ts'
import type { Spacer } from './plugins.ts'

interface Unit {
  top: number
  bottom: number
  // The doc position a break before this unit goes to.
  pos: number
  // Block-level break (start of a block) or inline (a line inside one).
  block: boolean
  // Must start a sheet (PageBreak_AlwaysBefore).
  forced: boolean
  // CSS margin above the block, kept by a forced break.
  gap: number
}

export interface PageMeasure {
  sheets: number
}

function zoomOf(root: HTMLElement): number {
  const r = root.getBoundingClientRect()
  return root.offsetWidth ? r.width / root.offsetWidth : 1
}

// The line boxes of a text block, from its inline fragments' rectangles.
function lineBands(el: HTMLElement): { top: number; bottom: number; left: number }[] {
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = [...range.getClientRects()].filter(r => r.height > 0 || r.width > 0)
    .filter(r => !(r.width === 0 && r.height === 0))
  const block = el.getBoundingClientRect()
  if (!rects.length) return [{ top: block.top, bottom: block.bottom, left: block.left }]
  rects.sort((a, b) => a.top - b.top || a.left - b.left)
  const lines: { top: number; bottom: number; left: number }[] = []
  for (const r of rects) {
    const cur = lines[lines.length - 1]
    const mid = (r.top + r.bottom) / 2
    if (cur && mid < cur.bottom - 0.5) {
      cur.top = Math.min(cur.top, r.top)
      cur.bottom = Math.max(cur.bottom, r.bottom)
      cur.left = Math.min(cur.left, r.left)
    } else {
      lines.push({ top: r.top, bottom: r.bottom, left: r.left })
    }
  }
  // Line boxes meet half way between the glyph boxes: the first starts at
  // the block's top, the last ends at its bottom.
  const out = lines.map(l => ({ ...l }))
  out[0].top = block.top
  out[out.length - 1].bottom = block.bottom
  for (let i = 1; i < out.length; i++) {
    const cut = (lines[i - 1].bottom + lines[i].top) / 2
    out[i - 1].bottom = cut
    out[i].top = cut
  }
  return out
}

function cssGap(el: HTMLElement): number {
  return parseFloat(el.style.marginTop || '0') || 0
}

// Measure the flow and work out where the sheets break.
export function computeSpacers(view: EditorView, geo: PageGeometry, page: HTMLElement): { spacers: Spacer[]; measure: PageMeasure } {
  const root = view.dom as HTMLElement
  const z = zoomOf(page) || 1
  // y from the top of the first sheet.
  const origin = page.getBoundingClientRect().top
  const y = (clientY: number) => (clientY - origin) / z
  // Spacer heights currently in the flow, by DOM element.
  const gaps = [...root.querySelectorAll<HTMLElement>('.kt-page-gap')].map(el => {
    const r = el.getBoundingClientRect()
    const h = el.classList.contains('kt-page-gap-block')
      ? r.height / z + (parseFloat(el.style.marginBottom || '0') || 0)
      : r.height / z
    return { at: y(r.top), height: h }
  })
  // Natural y: measured y less the spacers above it.
  const natural = (v: number) => {
    let s = 0
    for (const g of gaps) if (g.at < v - 0.01) s += g.height
    return v - s
  }
  const units: Unit[] = []
  const textUnits = (el: HTMLElement, start: number, forced: boolean, gap: number) => {
    const lines = lineBands(el)
    lines.forEach((l, i) => {
      let pos = start
      if (i > 0) {
        const hit = view.posAtCoords({ left: l.left + 0.5, top: (l.top + l.bottom) / 2 })
        pos = hit ? hit.pos : start
      }
      units.push({ top: natural(y(l.top)), bottom: natural(y(l.bottom)), pos, block: i === 0, forced: forced && i === 0, gap })
    })
  }
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null
    if (!dom || !(dom instanceof HTMLElement)) return
    if (node.type.name === 'list') {
      node.forEach((_item, o) => {
        const li = view.nodeDOM(offset + 1 + o) as HTMLElement | null
        // Items space with padding (no margin collapsing), inside the box.
        if (li instanceof HTMLElement) textUnits(li, offset + 1 + o, false, 0)
      })
      return
    }
    if (node.isTextblock) {
      textUnits(dom, offset, dom.dataset.break === '1', cssGap(dom))
      return
    }
    const r = dom.getBoundingClientRect()
    units.push({ top: natural(y(r.top)), bottom: natural(y(r.bottom)), pos: offset, block: true, forced: false, gap: cssGap(dom) })
  })

  const H = geo.heightPx
  const contentTop = (k: number) => k * H + geo.topPx
  const contentBottom = (k: number) => (k + 1) * H - geo.bottomPx
  const spacers: Spacer[] = []
  let shift = 0
  let k = 0
  let first = true
  for (const u of units) {
    const t = u.top + shift
    const b = u.bottom + shift
    k = Math.max(k, Math.floor(t / H))
    let move = false
    let want = 0
    if (u.forced && !first) {
      move = true
      want = contentTop(k + 1) + u.gap
    } else if (b > contentBottom(k) + 0.5 && t > contentTop(k) + 1) {
      // Does not fit: the next sheet, with the gap above it dropped.
      move = true
      want = contentTop(k + 1)
    }
    if (move) {
      // A spacer before a block sits above its margin.
      const h = u.block ? want - (t - u.gap) - u.gap : want - t
      spacers.push({ pos: u.pos, height: h, block: u.block })
      shift += h
      k += 1
    }
    first = false
  }
  let last = 0
  for (const u of units) last = Math.max(last, u.bottom)
  const sheets = Math.max(1, Math.ceil(Math.max(1, last + shift) / H))
  return { spacers, measure: { sheets } }
}

export function sameSpacers(a: Spacer[], b: Spacer[]): boolean {
  return a.length === b.length && a.every((s, i) =>
    s.pos === b[i].pos && s.block === b[i].block && Math.abs(s.height - b[i].height) < 0.75)
}
