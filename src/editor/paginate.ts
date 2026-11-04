// Real pages, as PagedTextEdit lays the QTextDocument out with a page
// size: a line that would cross a page's bottom margin moves to the next
// sheet, a block that must start a page (a chapter, the title page's end)
// does, a table moves row by row, figures and equations move whole. The
// editor is one flow; page breaks are spacers (plugins.ts) sized from a
// measurement of that flow with the spacers taken out again.
//
// In columns, PagedTextEdit lays the document out as pages one column wide
// and deals them out column by column, sheet by sheet (_column_slots).
// Here the flow is measured one column wide the same way, and each sheet's
// share is then set as one row of CSS columns, the rows separated by
// column-spanning spacers where the next sheet starts.
import type { EditorView } from 'prosemirror-view'
import type { PageGeometry } from './layout.ts'
import type { Spacer } from './plugins.ts'

interface Unit {
  top: number
  bottom: number
  // The doc position a break before this unit goes to.
  pos: number
  // Where the spacer goes: before a block, at a line start, before a row.
  kind: Spacer['kind']
  // Must start a sheet (PageBreak_AlwaysBefore).
  forced: boolean
  // CSS margin above the block, kept by a forced break.
  gap: number
  // Columns of the table a row spacer sits in.
  cols?: number
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

// The flow, unit by unit (_column_units): lines of text, table rows, and
// whole figures and equations, in document order, at y = f(client y).
function collectUnits(view: EditorView, y: (clientY: number) => number): { units: Unit[]; spanEnd: number | null } {
  const units: Unit[] = []
  let spanEnd: number | null = null
  let spanning = true
  const textUnits = (el: HTMLElement, start: number, forced: boolean, gap: number) => {
    lineBands(el).forEach((l, i) => {
      let pos = start
      if (i > 0) {
        const hit = view.posAtCoords({ left: l.left + 0.5, top: (l.top + l.bottom) / 2 })
        pos = hit ? hit.pos : start
      }
      units.push({ top: y(l.top), bottom: y(l.bottom), pos, kind: i === 0 ? 'block' : 'inline', forced: forced && i === 0, gap })
    })
  }
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null
    if (!dom || !(dom instanceof HTMLElement)) return
    // The title block spanning the columns comes first (SPANS_COLUMNS).
    if (spanning && dom.dataset.span === '1') {
      spanEnd = y(dom.getBoundingClientRect().bottom)
      return
    }
    spanning = false
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
    if (node.type.name === 'table') {
      // Row by row, as a QTextTable breaks across pages; the caption
      // under the table goes with the last row.
      const trs = [...dom.querySelectorAll<HTMLElement>('tr')].filter(t => !t.classList.contains('kt-page-gap'))
      let cols = 0
      node.firstChild?.forEach(c => { cols += c.attrs.colspan })
      let rowStart = offset + 1
      node.forEach((row, _o, i) => {
        const tr = trs[i]
        if (!tr) { rowStart += row.nodeSize; return }
        const rr = tr.getBoundingClientRect()
        const last = i === node.childCount - 1
        units.push({
          top: y(i === 0 ? r.top : rr.top), bottom: y(last ? r.bottom : rr.bottom),
          pos: i === 0 ? offset : rowStart, kind: i === 0 ? 'block' : 'row', forced: false,
          gap: i === 0 ? cssGap(dom) : 0, cols,
        })
        rowStart += row.nodeSize
      })
      return
    }
    units.push({ top: y(r.top), bottom: y(r.bottom), pos: offset, kind: 'block', forced: false, gap: cssGap(dom) })
  })
  return { units, spanEnd }
}

// Measure the flow and work out where the sheets break.
export function computeSpacers(view: EditorView, geo: PageGeometry, page: HTMLElement): { spacers: Spacer[]; measure: PageMeasure } {
  const root = view.dom as HTMLElement
  const z = zoomOf(page) || 1
  // y from the top of the first sheet.
  const origin = page.getBoundingClientRect().top
  const yOf = (clientY: number) => (clientY - origin) / z
  // Spacer heights currently in the flow, by DOM element.
  const gaps = [...root.querySelectorAll<HTMLElement>('.kt-page-gap')].map(el => {
    const r = el.getBoundingClientRect()
    const h = el.classList.contains('kt-page-gap-block')
      ? r.height / z + (parseFloat(el.style.marginBottom || '0') || 0)
      : r.height / z
    return { at: yOf(r.top), height: h }
  })
  // Natural y: measured y less the spacers above it.
  const natural = (v: number) => {
    let s = 0
    for (const g of gaps) if (g.at < v - 0.01) s += g.height
    return v - s
  }
  const { units } = collectUnits(view, c => natural(yOf(c)))

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
      const h = want - t
      spacers.push({ pos: u.pos, height: h, kind: u.kind, cols: u.cols })
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

// Columns: where each sheet starts (_column_slots over a flow measured
// one column wide), then the spanning spacers that put each sheet's share
// on a sheet of its own.
// `shrink[k]` takes px off sheet k's columns: a row of CSS columns
// balances a little differently from Qt's fill, and a sheet whose row ran
// past its bottom margin gives up its last lines on the next round.
export function computeColumnSpacers(view: EditorView, geo: PageGeometry, page: HTMLElement,
  old: readonly Spacer[], shrink: number[]): { spacers: Spacer[]; measure: PageMeasure } {
  const z = zoomOf(page) || 1
  const yOf = (clientY: number) => (clientY - page.getBoundingClientRect().top) / z
  const H = geo.heightPx
  const top = geo.topPx
  const limit = H - geo.bottomPx

  // One column wide, spacers hidden: Qt's flow.
  page.classList.add('kt-col-measure')
  let measured: ReturnType<typeof collectUnits>
  try {
    measured = collectUnits(view, yOf)
  } finally {
    page.classList.remove('kt-col-measure')
  }
  const { units, spanEnd } = measured
  // How far each rendered row runs past its sheet's bottom margin.
  if (old.length && old.every(s => s.kind === 'span')) {
    const els = [...(view.dom as HTMLElement).querySelectorAll<HTMLElement>('.kt-page-gap-span')]
    els.forEach((el, i) => {
      const over = yOf(el.getBoundingClientRect().top) - ((i + 1) * H - geo.bottomPx)
      if (over > 1) shrink[i] = (shrink[i] ?? 0) + over
    })
  }
  const starts: Unit[] = []
  let sheet = 0
  const flowTop = units.length ? units[0].top : top
  const span = spanEnd ?? flowTop
  let usedFrom = span
  let vy = spanEnd ?? top
  let col = 0
  let atStart = true
  for (const u of units) {
    const over = vy + (u.bottom - usedFrom) > limit - (shrink[sheet] ?? 0)
    if (atStart || !(over || u.forced)) { atStart = false; continue }
    const start = u.top
    if (u.forced || col === geo.cols - 1) {
      // A row break needs a block for the spanner: never inside a table.
      starts.push(u.kind === 'row' ? { ...u, kind: 'block' } : u)
      col = 0
      sheet += 1
    } else {
      col += 1
    }
    vy = top
    usedFrom = start
  }

  // Each spanner ends where the next sheet's text begins.
  const sameAt = old.length === starts.length && old.every((s, i) => s.pos === starts[i].pos && s.kind === 'span')
  let spacers: Spacer[]
  if (sameAt) {
    const els = [...(view.dom as HTMLElement).querySelectorAll<HTMLElement>('.kt-page-gap-span')]
    spacers = old.map((s, i) => {
      const el = els[i]
      if (!el) return s
      const t = yOf(el.getBoundingClientRect().top)
      return { ...s, height: Math.max(0, (i + 1) * H + top - t) }
    })
  } else {
    spacers = starts.map(u => ({ pos: u.pos, height: H - limit + top, kind: 'span' as const, inline: u.kind === 'inline' }))
  }
  return { spacers, measure: { sheets: starts.length + 1 } }
}

export function sameSpacers(a: readonly Spacer[], b: readonly Spacer[]): boolean {
  return a.length === b.length && a.every((s, i) =>
    s.pos === b[i].pos && s.kind === b[i].kind && Math.abs(s.height - b[i].height) < 0.75)
}
