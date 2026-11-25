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
  // The table has a rule between rows (grid): its continued part opens
  // with one, as longtable's \hline in the PDF.
  ruled?: boolean
  // A figure that floats (the document's figures float in its PDF).
  float?: boolean
  // The heading block a line belongs to (its position): in columns a
  // heading is never split, nor left at a column's foot.
  heading?: number
}

export interface PageMeasure {
  sheets: number
}

// WebKit (Safari, and the desktop app's web view) keeps a stale place for
// a column-spanning block (the \\maketitle that runs across the columns)
// after the columns change around it: the title disappears and the second
// column starts at the top of the page. Laying the columns out afresh puts
// it back. Chrome does not need it.
const STALE_SPANNERS = typeof navigator !== 'undefined'
  && /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)

export function refreshColumns(page: HTMLElement): void {
  if (!STALE_SPANNERS || !page.classList.contains('kt-cols')) return
  page.classList.remove('kt-cols')
  void page.offsetHeight
  page.classList.add('kt-cols')
  void page.offsetHeight
}

function zoomOf(root: HTMLElement): number {
  const r = root.getBoundingClientRect()
  return root.offsetWidth ? r.width / root.offsetWidth : 1
}

// The line boxes of a text block, from its inline fragments' rectangles.
export function lineBands(el: HTMLElement): { top: number; bottom: number; left: number }[] {
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

// Where each line after the first of a text block starts, by a binary
// search over its characters' boxes (posAtCoords per line re-reads the
// whole block's boxes: 0.25 ms a line, most of a long chapter's page
// pass). null where it cannot tell: a line that starts with a formula or
// a picture rather than text; the caller asks posAtCoords then.
export function lineStarts(view: EditorView, el: HTMLElement, cuts: number[]): (number | null)[] {
  const nodes: Text[] = []
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if ((n as Text).length) nodes.push(n as Text)
  const starts: number[] = []
  let total = 0
  for (const n of nodes) { starts.push(total); total += n.length }
  if (!total) return cuts.map(() => null)
  const range = document.createRange()
  const at = (i: number): [Text, number] => {
    let lo = 0, hi = nodes.length - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= i) lo = m; else hi = m - 1 }
    return [nodes[lo], i - starts[lo]]
  }
  // The middle of character i's box (a wrapped space may have none: -1).
  const mid = (i: number): number => {
    const [n, o] = at(i)
    range.setStart(n, o)
    range.setEnd(n, o + 1)
    const r = range.getClientRects()
    const box = r.length ? r[r.length - 1] : null
    return box && (box.height > 0) ? (box.top + box.bottom) / 2 : -1
  }
  return cuts.map(cut => {
    // First character below the cut.
    let lo = 0, hi = total
    while (lo < hi) {
      const m = (lo + hi) >> 1
      let y = mid(m), k = m
      while (y < 0 && k + 1 < total) y = mid(++k)
      if (y >= 0 && y > cut) hi = m; else lo = m + 1
    }
    if (lo >= total) return null
    const [n, o] = at(lo)
    // Something not text just before it on this line (a formula, a
    // picture): the line may start with that.
    if (o === 0) {
      const prev = lo > 0 ? at(lo - 1)[0] : null
      for (let x: Node | null = n; x && x !== el; x = x.parentNode) {
        const sib = x.previousSibling
        if (sib) {
          if (sib !== prev && !(prev && sib.contains(prev)) && !(sib.nodeType === 3)) return null
          break
        }
      }
    }
    try { return view.posAtDOM(n, o) } catch { return null }
  })
}

function cssGap(el: HTMLElement): number {
  return parseFloat(el.style.marginTop || '0') || 0
}

// The flow, unit by unit (_column_units): lines of text, table rows, and
// whole figures and equations, in document order, at y = f(client y).
function collectUnits(view: EditorView, y0: (clientY: number) => number, floats = false,
  z = 1): { units: Unit[]; spanEnd: number | null } {
  const units: Unit[] = []
  // A floating figure lifted out of the flow last time moved what follows
  // it up by its lift, and is drawn shifted: both are undone here, so the
  // units are measured where they sit with every figure in its place.
  let lifted = 0
  const y = (clientY: number) => y0(clientY) + lifted
  let spanEnd: number | null = null
  let spanning = true
  const textUnits = (el: HTMLElement, start: number, forced: boolean, gap: number, heading?: number) => {
    const bands = lineBands(el)
    const fast = bands.length > 1 && !el.querySelector('[data-kt-pos]')
      ? lineStarts(view, el, bands.slice(1).map(l => l.top)) : []
    bands.forEach((l, i) => {
      let pos = start
      const quick = i > 0 ? fast[i - 1] : null
      if (quick != null) pos = quick
      else if (i > 0) {
        const at = { left: l.left + 0.5, top: (l.top + l.bottom) / 2 }
        // A line drawn by a widget standing for its source (a CV entry,
        // cvView.ts) breaks where that source starts.
        // Found by its box: off screen, elementFromPoint finds nothing.
        const owner = [...el.querySelectorAll<HTMLElement>('[data-kt-pos]')].find(w => {
          const r = w.getBoundingClientRect()
          return at.top >= r.top && at.top <= r.bottom
        })
        const hit = owner ? { pos: Number(owner.dataset.ktPos) } : view.posAtCoords(at)
        pos = hit ? hit.pos : start
      }
      units.push({ top: y(l.top), bottom: y(l.bottom), pos, kind: i === 0 ? 'block' : 'inline', forced: forced && i === 0, gap, heading })
    })
  }
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null
    if (!dom || !(dom instanceof HTMLElement)) return
    // A folded chapter's blocks are not drawn.
    if (dom.classList.contains('kt-folded')) return
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
    // An element (Insert ▸ Elements, Science) and a table of contents are
    // drawn by the widget after their hidden LaTeX: one whole unit, moved
    // to the next sheet rather than cut by it.
    const drawn = dom.nextElementSibling
    if (node.type.name === 'raw_latex' && drawn instanceof HTMLElement && drawn.classList.contains('kt-widget')) {
      const dr = drawn.getBoundingClientRect()
      const top = Math.min(dom.getBoundingClientRect().top, dr.top)
      units.push({ top: y(top), bottom: y(dr.bottom), pos: offset, kind: 'block', forced: dom.dataset.break === '1', gap: cssGap(dom) })
      return
    }
    if (node.isTextblock) {
      textUnits(dom, offset, dom.dataset.break === '1', cssGap(dom), node.type.name === 'section' ? offset : undefined)
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
          gap: i === 0 ? cssGap(dom) : 0, cols, ruled: node.attrs.style === 'grid',
        })
        rowStart += row.nodeSize
      })
      return
    }
    if (floats && node.type.name === 'figure') {
      const dy = parseFloat(dom.dataset.ktDy || '0') || 0
      const lift = parseFloat(dom.dataset.ktLift || '0') || 0
      // Its height from its own box: lifted, it overlaps what follows it,
      // whose spacers would otherwise count inside it.
      const top = y(r.top - dy * z)
      units.push({ top, bottom: top + r.height / z, pos: offset, kind: 'block', forced: false,
        gap: cssGap(dom), float: true })
      lifted += lift
      return
    }
    units.push({ top: y(r.top), bottom: y(r.bottom), pos: offset, kind: 'block', forced: false, gap: cssGap(dom) })
  })
  return { units, spanEnd }
}

// Where the compiled PDF starts a page: a block's position, or (`inline`)
// a position inside a paragraph, whose line then starts the sheet as a
// block the PDF starts a page with does. `blanks`: empty PDF pages just
// before it (a chapter kept to a right-hand page), drawn as blank sheets.
export interface PageStart { pos: number; inline: boolean; blanks: number }

// Mark the units the compiled PDF starts its pages with as forced (a block
// by its position, a line inside a paragraph by the position it holds);
// the blank pages before each, by unit index.
function forcePageStarts(units: Unit[], pageStarts: readonly PageStart[]): Map<number, number> {
  const blanks = new Map<number, number>()
  for (const s of pageStarts) {
    let hit = -1
    if (s.inline) {
      for (let i = 0; i < units.length && units[i].pos <= s.pos; i++) hit = i
      if (hit > 0 && units[hit].kind === 'inline') Object.assign(units[hit], { forced: true, gap: 0 })
      else if (hit > 0 && !units[hit].forced) hit = -1
    } else {
      hit = units.findIndex(u => u.kind === 'block' && u.pos === s.pos)
      if (hit > 0) units[hit].forced = true
    }
    if (hit > 0 && s.blanks > 0) blanks.set(hit, s.blanks)
  }
  return blanks
}

// Measure the flow and work out where the sheets break.
//
// `pdfPaged`: the forced breaks are where the compiled PDF starts its
// pages. Text that overruns a sheet by a little before the next of them
// then stays on it, into the bottom margin, rather than spilling a line or
// two onto a sheet of its own: the sheet ends where the PDF page does
// (the editor's type sets a few per cent taller or shorter than TeX's).
//
// `floats`: the document's figures float (LaTeX [htbp]). One that does not
// fit in what is left of a sheet is taken out of the flow there, the text
// after it filling the sheet, and drawn at the top of the next sheet, the
// text there starting under it: where LaTeX puts it.
export function computeSpacers(view: EditorView, geo: PageGeometry, page: HTMLElement,
  pageStarts: readonly PageStart[] = [], pdfPaged = false,
  floats = false): { spacers: Spacer[]; measure: PageMeasure } {
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
  const { units } = collectUnits(view, c => natural(yOf(c)), floats, z)
  // The line a mid-paragraph page start falls on: the last line unit at or
  // before it.
  const blanks = forcePageStarts(units, pageStarts)

  const H = geo.heightPx
  const contentTop = (k: number) => k * H + geo.topPx
  const contentBottom = (k: number) => (k + 1) * H - geo.bottomPx
  const slack = pdfPaged ? geo.bottomPx * 0.6 : 0
  // Where the next forced break is, from each unit.
  const nextForced: number[] = new Array(units.length)
  for (let i = units.length - 1, n = units.length; i >= 0; i--) {
    nextForced[i] = n
    if (units[i].forced) n = i
  }
  const spacers: Spacer[] = []
  let shift = 0
  let k = 0
  let first = true
  // Floating figures waiting for the top of the next sheet: where each is
  // drawn now (its top), its height and the space it gave up.
  let pending: { pos: number; top: number; box: number; lift: number }[] = []
  const capacity = contentBottom(0) - contentTop(0)
  // LaTeX's \textfloatsep: between the figures at a page's top and the text.
  const floatSep = 26
  // The pending figures at the top of sheet `sheet`: their spacers, and
  // the height they take there.
  const placePending = (sheet: number): number => {
    if (!pending.length) return 0
    let at = contentTop(sheet)
    for (const p of pending) {
      spacers.push({ pos: p.pos, height: p.lift, kind: 'float', dy: at - p.top })
      at += p.box + 10
    }
    pending = []
    return at - 10 - contentTop(sheet) + floatSep
  }
  units.forEach((u, i) => {
    const t = u.top + shift
    const b = u.bottom + shift
    k = Math.max(k, Math.floor(t / H))
    if (u.float) {
      const box = u.bottom - u.top
      const fits = b <= contentBottom(k) + 0.5 || t <= contentTop(k) + 1
      // Here when it fits and no figure before it waits (floats keep their
      // order); too tall for any sheet's top, it is not moved.
      if (box <= capacity * 0.95 && (!fits || pending.length || (u.forced && !first))) {
        pending.push({ pos: u.pos, top: t, box, lift: box + u.gap })
        shift -= box + u.gap
        first = false
        return
      }
    }
    let move = false
    let want = 0
    // The rest of this PDF page fits in the margin's slack.
    const fitsSlack = () => {
      if (!slack) return false
      let end = b
      for (let j = i + 1; j < nextForced[i]; j++) end = Math.max(end, units[j].bottom + shift)
      return end <= contentBottom(k) + slack
    }
    let skip = 0
    if (u.forced && !first) {
      move = true
      skip = blanks.get(i) ?? 0
      want = contentTop(k + 1 + skip) + u.gap
    } else if (b > contentBottom(k) + 0.5 && t > contentTop(k) + 1 && !fitsSlack()) {
      // Does not fit: the next sheet, with the gap above it dropped.
      move = true
      want = contentTop(k + 1)
    }
    if (move) {
      // The figures waiting go to the top of the new sheet, this unit
      // under them.
      want += placePending(k + 1 + skip)
      // A spacer before a block sits above its margin.
      const h = want - t
      spacers.push({ pos: u.pos, height: h, kind: u.kind, cols: u.cols, ruled: u.ruled })
      shift += h
      k += 1 + skip
    }
    first = false
  })
  let last = 0
  for (const u of units) last = Math.max(last, u.bottom)
  last += shift
  // Figures still waiting at the end: a sheet of their own after the text.
  if (pending.length) last = Math.max(last, contentTop(k + 1) + placePending(k + 1))
  const sheets = Math.max(1, Math.ceil(Math.max(1, last) / H))
  return { spacers, measure: { sheets } }
}

// Columns: where each sheet starts (_column_slots over a flow measured
// one column wide), then the spanning spacers that put each sheet's share
// on a sheet of its own.
// `shrink[k]` takes px off sheet k's columns: a row of CSS columns
// balances a little differently from Qt's fill, and a sheet whose row ran
// past its bottom margin gives up its last lines on the next round.
//
// `pageStarts` / `pdfPaged` as for computeSpacers: each compiled PDF page
// starts a sheet, and a sheet overrunning a little before the next one
// keeps its text rather than moving it on.
export function computeColumnSpacers(view: EditorView, geo: PageGeometry, page: HTMLElement,
  old: readonly Spacer[], shrink: number[], pageStarts: readonly PageStart[] = [],
  pdfPaged = false, columnStarts: readonly PageStart[] = [],
  // Each footnote's mark and the height of its note, set at the foot of
  // its column inside the text area, as LaTeX does.
  foot: { notes: readonly { pos: number; height: number }[] } = { notes: [] },
): { spacers: Spacer[]; measure: PageMeasure } {
  const z = zoomOf(page) || 1
  const yOf = (clientY: number) => (clientY - page.getBoundingClientRect().top) / z
  const H = geo.heightPx
  const top = geo.topPx
  const limit = H - geo.bottomPx

  // One column wide, spacers hidden: Qt's flow. Measured with the columns
  // off altogether: inside a column layout WebKit kept the title spanning
  // the columns at a stale place (after all the text), the text measured
  // a title's height too high, and every sheet ran that far past its foot.
  page.classList.remove('kt-cols')
  page.classList.add('kt-col-measure')
  let measured: ReturnType<typeof collectUnits>
  try {
    void page.offsetHeight
    measured = collectUnits(view, yOf)
  } finally {
    page.classList.remove('kt-col-measure')
    page.classList.add('kt-cols')
    void page.offsetHeight
    refreshColumns(page)
  }
  // The title spanning the columns ends before the first line under it:
  // WebKit placed that block's box wrongly (far down the flow) while the
  // columns were measured, and the first sheet started past its own text.
  const firstTop = measured.units.length ? measured.units[0].top : null
  let spanEnd = measured.spanEnd !== null && firstTop !== null && measured.spanEnd > firstTop ? firstTop : measured.spanEnd
  // No title spanning the columns: they start where the first text does
  // (under whatever stands above it), not at the top margin.
  if (spanEnd === null && firstTop !== null) spanEnd = firstTop - (measured.units[0].gap ?? 0)
  // A table that fits in one column moves whole to the next column, as in
  // the PDF (a column break cannot go between two rows of the page).
  const colRoom = limit - top
  const units: Unit[] = []
  for (let i = 0; i < measured.units.length; i++) {
    const u = measured.units[i]
    let j = i
    while (j + 1 < measured.units.length && measured.units[j + 1].kind === 'row') j++
    // A heading is one unit with the first line after it (LaTeX keeps a
    // heading whole and with its text; WebKit moved a split heading's
    // lines to the next column on its own).
    if (u.heading !== undefined) {
      while (j + 1 < measured.units.length && measured.units[j + 1].heading === u.heading) j++
      if (j + 1 < measured.units.length && !measured.units[j + 1].forced) j++
    }
    if (j > i && measured.units[j].bottom - u.top <= colRoom) {
      units.push({ ...u, bottom: measured.units[j].bottom })
      i = j
    } else units.push(u)
  }
  // The sheets the document itself starts (a chapter, \\newpage), before
  // the PDF's page starts are added.
  const ownStart = new Set(units.filter(u => u.forced))
  forcePageStarts(units, pageStarts)
  // WebKit cannot start a new sheet (a spanner) inside a list: it drew the
  // item twice and ran the rest into a third column off the page. So a
  // sheet never begins inside a list: each unit's list (its first unit's
  // index, or -1), and the PDF's page starts inside one moved to its start.
  const listFirst: number[] = units.map(() => -1)
  // The position before each unit's list (the top-level block).
  const listPos: number[] = units.map(() => -1)
  {
    const doc = view.state.doc
    let key: number | null = null, first = -1
    units.forEach((u, i) => {
      let k: number | null = null
      try {
        const $p = doc.resolve(u.pos)
        if ($p.depth === 0) k = $p.nodeAfter?.type.name === 'list' ? u.pos : null
        else if ($p.node(1).type.name === 'list') k = $p.before(1)
      } catch { k = null }
      if (k === null) { key = null; return }
      if (k !== key) { key = k; first = i }
      listFirst[i] = first
      listPos[i] = k
    })
    units.forEach((u, i) => {
      if (u.forced && listFirst[i] >= 0 && listFirst[i] < i) { u.forced = false; units[listFirst[i]].forced = true }
    })
  }
  // The PDF's own column starts (a document set in columns, compiled):
  // the editor's columns break exactly there, as LaTeX's do.
  const colForced = new Set<Unit>()
  for (const s of columnStarts) {
    let hit = -1
    if (s.inline) {
      // The line it falls in: its block's first line breaks before the
      // block (a PDF column starting with "• Home: the clipboard, ...").
      for (let i = 0; i < units.length && units[i].pos <= s.pos; i++) hit = i
    } else hit = units.findIndex(u => u.kind === 'block' && u.pos === s.pos)
    if (hit > 0 && !units[hit].forced) colForced.add(units[hit])
  }
  const followPdf = colForced.size > 0
  // Following the PDF's columns, a column may use its whole bottom margin
  // before a break of the editor's own: an extra sheet the PDF does not
  // have is worse than a few lines low (narrow columns set looser than
  // TeX's).
  // The bottom margin stays empty, as Page Setup sets it: no column runs
  // into it (it held the page number and the footnotes). A column the
  // editor sets taller than TeX's breaks a line or two early instead.
  const slack = 0
  // How far each rendered sheet's text runs past its bottom margin: from
  // the lines themselves (the last sheet too, which has no spanner after
  // it; WebKit also placed a spanner's box wrongly).
  if (old.length && old.every(s => s.kind === 'span' || s.kind === 'col' || s.kind === 'fill')) {
    // The lowest line of each column of each sheet, and the room its
    // footnotes take at that column's foot.
    const pageLeft = page.getBoundingClientRect().left
    const colW = (geo.widthPx - geo.leftPx - geo.rightPx - (geo.cols - 1) * geo.colGapPx) / geo.cols
    const colOf = (clientX: number) => Math.max(0, Math.min(geo.cols - 1,
      Math.floor(((clientX - pageLeft) / z - geo.leftPx) / (colW + geo.colGapPx))))
    const lowest = new Map<string, number>()
    const noteRoom = new Map<string, number>()
    // Text WebKit ran into a column past the last (right of the page): a
    // row taller than measured overflows sideways, not down.
    const sideways: number[] = []
    const textRight = geo.widthPx - geo.rightPx + 2
    const walk = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue?.trim() || (n.parentElement?.closest('.kt-page-gap, .kt-labels'))) continue
      const r = document.createRange()
      r.selectNodeContents(n)
      for (const b of r.getClientRects()) {
        const y0 = yOf(b.top), y1 = yOf(b.bottom)
        const i = Math.floor(y0 / H)
        const k = `${i},${colOf(b.left + 1)}`
        if (i >= 0 && y1 > (lowest.get(k) ?? -Infinity)) lowest.set(k, y1)
        if (i >= 0 && (b.left - pageLeft) / z > textRight) sideways[i] = (sideways[i] ?? 0) + (y1 - y0)
      }
    }
    for (const nt of foot.notes) {
      let c: { left: number; top: number }
      try { c = view.coordsAtPos(nt.pos) } catch { continue }
      const k = `${Math.floor(yOf(c.top) / H)},${colOf(c.left + 1)}`
      noteRoom.set(k, (noteRoom.get(k) ?? 0) + nt.height)
    }
    // Against what the column may use, and never more than a quarter of a
    // column: the correction added up round after round and once left a
    // sheet almost empty.
    const overBy: number[] = []
    for (const [k, y] of lowest) {
      const i = Number(k.split(',')[0])
      overBy[i] = Math.max(overBy[i] ?? 0, y - (i * H + limit + slack - (noteRoom.get(k) ?? 0)))
    }
    sideways.forEach((h, i) => { overBy[i] = Math.max(overBy[i] ?? 0, h) })
    overBy.forEach((over, i) => {
      if (over > 1) shrink[i] = Math.min((shrink[i] ?? 0) + over, (limit - top) * 0.25)
    })
  }
  const starts: Unit[] = []
  // Column breaks and fillers: every column of every sheet is padded to
  // the sheet's bottom margin and each next column is a forced break, so
  // the browser has nothing left to balance (WebKit balanced a row too
  // short and ran its text into a third column off the page).
  const extra: Spacer[] = []
  let sheet = 0
  const flowTop = units.length ? units[0].top : top
  const span = spanEnd ?? flowTop
  const colTop = () => (sheet === 0 ? (spanEnd ?? top) : top)
  let usedFrom = span
  let vy = spanEnd ?? top
  let col = 0
  let atStart = true
  let prevBottom = span
  const target = () => limit - (shrink[sheet] ?? 0)
  // Where each sheet's row of columns ends (sheet coordinates): its
  // spanner then reaches exactly the next sheet's top margin.
  const rowEnds: number[] = []
  let rowEnd = 0
  // A filler's height is set once its row's end is known (all the
  // row's columns end at the same height, or WebKit balances again).
  const pending: { sp: Spacer; endY: number; sheet: number }[] = []
  const fill = (pos: number, inline: boolean, endY: number) => {
    rowEnd = Math.max(rowEnd, endY, target())
    const sp: Spacer = { pos, height: 0, kind: 'fill', inline }
    pending.push({ sp, endY, sheet })
    extra.push(sp)
  }
  // The empty columns left on a sheet: a break and a full filler each.
  const fillRest = (pos: number, inline: boolean) => {
    for (let c = col + 1; c < geo.cols; c++) {
      extra.push({ pos, height: 0, kind: 'col', inline })
      fill(pos, inline, colTop())
    }
  }
  // The top of the next unit the PDF starts a page with, for each unit.
  const nextForced: number[] = new Array(units.length).fill(Infinity)
  for (let i = units.length - 2; i >= 0; i--) nextForced[i] = units[i + 1].forced ? units[i + 1].top : nextForced[i + 1]
  // The footnotes each unit holds (their notes' heights).
  const noteOf = (ui: number) => {
    const from = units[ui].pos, to = ui + 1 < units.length ? units[ui + 1].pos : Infinity
    let h = 0
    for (const n of foot.notes) if (n.pos >= from && n.pos < to) h += n.height
    return h
  }
  // The notes of the column being filled.
  let noteH = 0
  // The first unit of the column being filled.
  let colStart = 0
  for (let ui = 0; ui < units.length; ui++) {
    let u = units[ui]
    const uNote = foot.notes.length ? noteOf(ui) : 0
    const notes = noteH + uNote
    // The last column of a PDF-paged sheet may run into the margin's slack
    // (not one with footnotes: they stand at the text area's foot).
    const room = target() - notes + (!notes && (col === geo.cols - 1 || followPdf) ? slack : 0)
    let over = vy + (u.bottom - usedFrom) > room
    // A line or two before the PDF's next page: kept on this sheet, low in
    // its margin, rather than alone on a sheet the PDF does not have.
    if (over && pdfPaged && !notes && !u.forced && col === geo.cols - 1 && nextForced[ui] - u.top <= geo.bottomPx * 0.35
      && vy + (nextForced[ui] - usedFrom) <= limit) over = false
    const colBreak = colForced.has(u) && col < geo.cols - 1
    if (atStart || !(over || u.forced || colBreak)) { atStart = false; prevBottom = u.bottom; noteH += uNote; continue }
    noteH = uNote
    // A new sheet inside a list that began lower in this column: the
    // sheet ends before the list instead (see listFirst).
    const lf = listFirst[ui]
    if ((u.forced || col === geo.cols - 1) && lf > colStart && lf < ui) {
      ui = lf
      u = units[ui]
      prevBottom = units[ui - 1].bottom
      noteH = foot.notes.length ? noteOf(ui) : 0
    }
    // A sheet starting at a list starts before the list, not inside it
    // before its first item.
    if ((u.forced || col === geo.cols - 1) && listFirst[ui] === ui && listPos[ui] >= 0 && u.pos !== listPos[ui]) {
      u = { ...u, kind: 'block', pos: listPos[ui] }
    }
    const inline = u.kind === 'inline'
    // This column ends here: padded down to the bottom margin.
    fill(u.pos, inline, vy + (prevBottom - usedFrom))
    if (u.forced || col === geo.cols - 1) {
      // The bottom margin stays empty, so a sheet ends before the PDF's
      // page does: when only a few lines are left before the PDF's next
      // page start, they would stand alone on a sheet. That page start is
      // let go and the text flows on instead.
      if (pdfPaged && !u.forced && nextForced[ui] - u.top <= (limit - top) * 0.3) {
        for (let k = ui + 1; k < units.length; k++) if (units[k].forced) { units[k].forced = false; break }
        for (let k = ui; k >= 0 && nextForced[k] !== Infinity; k--) nextForced[k] = Infinity
      }
      fillRest(u.pos, inline)
      rowEnds.push(rowEnd)
      rowEnd = 0
      // A row break needs a block for the spanner: never inside a table.
      starts.push(u.kind === 'row' ? { ...u, kind: 'block' } : u)
      col = 0
      sheet += 1
    } else {
      // A column break inside a table goes before the table's block.
      extra.push({ pos: u.pos, height: 0, kind: 'col', inline })
      col += 1
    }
    vy = colTop()
    // A chapter (a sheet the document starts) keeps its large space above
    // under the spanner ("Chapter 5"); WebKit drops other blocks' margins at
    // a break.
    usedFrom = u.top - (u.kind === 'block' && col === 0 && ownStart.has(u) ? u.gap : 0)
    prevBottom = u.bottom
    colStart = ui
  }
  // The last sheet: its columns filled too (the text stays in the first
  // ones, as LaTeX fills the left column first).
  if (units.length) {
    const end = view.state.doc.content.size
    fill(end, false, vy + (prevBottom - usedFrom))
    fillRest(end, false)
  }
  rowEnds.push(rowEnd)
  for (const f of pending) f.sp.height = Math.max(0, (rowEnds[f.sheet] ?? 0) - f.endY)
  // Fillers of no height are left out.
  for (let i = extra.length - 1; i >= 0; i--) if (extra[i].kind === 'fill' && extra[i].height < 0.5) extra.splice(i, 1)

  // Each spanner ends where the next sheet's text begins. Every column is
  // filled down to its sheet's bottom margin (less its shrink), so the
  // spanner starts there and its height is known: the rest of the sheet
  // and the next one's top margin (not measured: WebKit reported a
  // spanner's place wrongly and the next sheet's text began too early).
  let spacers: Spacer[] = starts.map((u, i) => ({
    pos: u.pos, height: H - Math.max(rowEnds[i] ?? 0, limit - (shrink[i] ?? 0)) + top, kind: 'span' as const, inline: u.kind === 'inline',
  }))
  // At one place: the filler ending a column, then the break (column or
  // sheet), then the next column's breaks and fillers, in that order.
  const order = (sp: Spacer) => (sp.kind === 'span' ? 1 : 0)
  spacers = [...extra.map((e, i) => ({ e, i })), ...spacers.map((e, i) => ({ e, i: 1e6 + i }))]
    .sort((a, b) => a.e.pos - b.e.pos || order(a.e) - order(b.e) || a.i - b.i).map(x => x.e)
  return { spacers, measure: { sheets: starts.length + 1 } }
}

export function sameSpacers(a: readonly Spacer[], b: readonly Spacer[]): boolean {
  return a.length === b.length && a.every((s, i) =>
    s.pos === b[i].pos && s.kind === b[i].kind && Math.abs(s.height - b[i].height) < 0.75
    && Math.abs((s.dy ?? 0) - (b[i].dy ?? 0)) < 0.75)
}
