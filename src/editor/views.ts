// How the editor draws what is not plain text: typeset equations, figure
// frames, tables with LaTeX's rules, citations and references as the PDF
// numbers them, footnotes, raw LaTeX. The looks follow editor.py's char
// and block formats (_link_format, _citation_format, _figure_block_format...).
import { parseDropCap, parseIcon, parseMarginNote } from '../core/widgets.ts'
import { dropCapElement, iconElement, marginNoteElement } from './widgetView.ts'
import { FANCY_RULE_GREY, parseFancy, tint } from '../core/fancyTable.ts'
import { autoTableAlignment } from '../core/serializer.ts'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view'
import { placementButton } from './placement.ts'
import type { Inline } from '../core/model.ts'
import { renderMath } from '../math/render.ts'
import { captionHtml, cellDisplayText, cellLook, cellPictures } from './convert.ts'
import type { ReferenceResolver } from '../core/references.ts'
import { inlineRawLook, lengthEm } from './inlineRawLook.ts'

export interface ViewHost {
  resolver(): ReferenceResolver
  bodyPx(): number
  textWidthPx(): number
  resolveImage(path: string): string | null
  onMathDoubleClick(pos: number, display: boolean): void
  onFigureDoubleClick(pos: number): void
  // A double-click on a figure's caption (or label): edit them.
  onCaptionDoubleClick(pos: number): void
  // A picture resized with its handles: its new LaTeX width.
  onFigureResized(pos: number, width: string): void
  onFootnoteDoubleClick(pos: number): void
}

function inlinePlain(nodes: Inline[]): string {
  return nodes.map(n => n.type === 'Text' ? n.text : 'children' in n ? inlinePlain(n.children) : '').join('')
}

function mathEl(latex: string, display: boolean, fontPx: number): HTMLElement {
  const span = document.createElement('span')
  span.className = display ? 'kt-math-svg kt-math-display' : 'kt-math-svg'
  try {
    const r = renderMath(latex, { display, fontPx })
    span.innerHTML = r.svg
    const svg = span.firstElementChild as HTMLElement | null
    if (svg) { svg.style.width = `${r.width}px`; svg.style.height = `${r.height}px` }
    span.style.width = `${r.width}px`
    span.style.height = `${r.height}px`
    // The equation's baseline on the line's.
    if (!display) span.style.verticalAlign = `${-(r.height - r.baseline)}px`
  } catch {
    span.textContent = latex
    span.classList.add('kt-math-source')
  }
  return span
}

class MathInlineView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private host: ViewHost
  constructor(node: PMNode, host: ViewHost, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.host = host
    this.dom = document.createElement('span')
    this.dom.className = 'kt-math-inline'
    this.render()
    this.dom.addEventListener('dblclick', e => {
      e.preventDefault()
      const p = getPos()
      if (p !== undefined) host.onMathDoubleClick(p, false)
      void view
    })
  }
  private render() {
    this.dom.replaceChildren(mathEl(this.node.attrs.latex, false, this.host.bodyPx()))
    this.dom.title = this.node.attrs.latex
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    if (node.attrs.latex !== this.node.attrs.latex) { this.node = node; this.render() }
    this.node = node
    return true
  }
  ignoreMutation() { return true }
  stopEvent() { return false }
}

// The equation number comes from the layout decoration (data-eqno) and
// is drawn right-aligned, centred on the equation (editor.css).
class MathBlockView implements NodeView {
  dom: HTMLElement
  private shown = ''
  private node: PMNode
  private host: ViewHost
  constructor(node: PMNode, host: ViewHost, getPos: () => number | undefined) {
    this.node = node
    this.host = host
    this.dom = document.createElement('div')
    this.dom.className = 'kt-block kt-math-block'
    this.render()
    this.dom.addEventListener('dblclick', e => {
      e.preventDefault()
      const p = getPos()
      if (p !== undefined) host.onMathDoubleClick(p, true)
    })
  }
  render() {
    const key = `${this.node.attrs.latex}|${this.host.bodyPx()}`
    if (key === this.shown) return
    this.dom.replaceChildren(mathEl(this.node.attrs.latex, true, this.host.bodyPx()))
    this.dom.title = this.node.attrs.latex
    this.shown = key
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }
  ignoreMutation() { return true }
}

// Word's eight sizing handles: corners and side midpoints. The picture
// keeps its aspect ratio (LaTeX sets only its width), so any handle scales
// the whole image (paged_edit.py _HANDLE_CURSORS).
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

// The width a handle dragged by (dx, dy) gives a picture w0 x h0 on screen,
// kept between 24 px and the text width (mouseMoveEvent).
export function resizedWidth(handle: string, w0: number, h0: number, dx: number, dy: number,
  limit: number): number {
  let w: number
  if (handle.includes('e')) w = w0 + dx
  else if (handle.includes('w')) w = w0 - dx
  else if (h0) w = w0 * (h0 + (handle === 's' ? dy : -dy)) / h0
  else w = w0
  return Math.max(24, Math.min(Math.max(40, limit), w))
}

// The LaTeX width of a picture `w` px wide in a text `textW` px wide, as
// _on_image_resized records it ("0.53\textwidth").
export function widthSpec(w: number, textW: number): string {
  const frac = textW > 0 ? Math.max(0.05, Math.min(1, w / textW)) : 0.8
  return `${frac.toFixed(2)}\\textwidth`
}

class FigureView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private host: ViewHost
  private getPos: () => number | undefined
  private view: EditorView
  constructor(node: PMNode, host: ViewHost, getPos: () => number | undefined, view: EditorView) {
    this.node = node
    this.host = host
    this.getPos = getPos
    this.view = view
    this.dom = document.createElement('div')
    this.dom.className = 'kt-block kt-figure'
    this.render()
    this.dom.addEventListener('dblclick', e => {
      e.preventDefault()
      const p = getPos()
      if (p === undefined) return
      const onCaption = (e.target as HTMLElement | null)?.closest?.('.kt-figure-caption, .kt-figure-label')
      if (onCaption) host.onCaptionDoubleClick(p)
      else host.onFigureDoubleClick(p)
    })
  }
  private shown = ''
  render() {
    const a = this.node.attrs
    const src = this.host.resolveImage(a.path)
    // Every image that finishes loading, and every reference refresh,
    // re-renders all atoms. Rebuilding an unchanged figure made a new
    // <img> each time, which the browser decodes again: a thesis with 76
    // figures created ~3000 of them on opening and kept the CPU busy for
    // minutes. Redraw only when what the figure shows has changed.
    // The text width only with an image: a figure built while the editor
    // view itself is still being made has none yet, and asking crashed.
    const extra: { path: string; height?: string; width?: string }[] = a.extra ?? []
    const key = [src ?? '', a.path, a.width, a.height, JSON.stringify(extra), a.caption, a.label, a.align, a.placement,
      src ? this.host.textWidthPx() : 0].join('\n')
    if (key === this.shown) return
    this.shown = key
    this.dom.dataset.align = a.align || 'center'
    const rows: HTMLElement[] = []
    const img = document.createElement('div')
    img.className = 'kt-figure-row kt-figure-image'
    const missing = (text: string) => {
      const s = document.createElement('span')
      s.className = 'kt-figure-missing'
      s.textContent = text
      img.replaceChildren(s)
    }
    if (extra.length > 0) {
      // Several pictures in one row, each at its own height.
      const row = document.createElement('span')
      row.className = 'kt-figure-pics'
      const pics = [{ path: a.path, height: a.height as string, width: a.width as string }, ...extra]
      for (const p of pics) {
        const s = this.host.resolveImage(p.path)
        const im = document.createElement('img')
        im.draggable = false
        if (s) im.src = s
        else im.alt = `[Image: ${p.path}]`
        if (p.height) im.style.height = `${lengthPx(p.height)}px`
        else im.style.width = `${figureWidthPx(p.width || '0.3\\textwidth', this.host.textWidthPx())}px`
        row.appendChild(im)
      }
      img.appendChild(row)
    } else if (src) {
      const im = document.createElement('img')
      im.src = src
      im.draggable = false
      im.style.width = `${figureWidthPx(a.width, this.host.textWidthPx())}px`
      im.onerror = () => missing(`[Image not found: ${a.path}]`)
      const frame = document.createElement('span')
      frame.className = 'kt-figure-frame'
      frame.appendChild(im)
      for (const h of HANDLES) {
        const d = document.createElement('span')
        d.className = 'kt-handle'
        d.dataset.h = h
        d.addEventListener('pointerdown', e => this.startResize(e, h, im))
        frame.appendChild(d)
      }
      img.appendChild(frame)
    } else {
      missing(`[Image: ${a.path}]`)
    }
    rows.push(img)
    if (a.caption) {
      const cap = document.createElement('div')
      cap.className = 'kt-figure-row kt-figure-caption'
      cap.innerHTML = `Figure: ${captionHtml(a.caption)}`
      rows.push(cap)
    }
    if (a.label) {
      const lab = document.createElement('div')
      lab.className = 'kt-figure-row kt-figure-label'
      lab.textContent = `Label: ${a.label}`
      rows.push(lab)
    }
    this.dom.replaceChildren(...rows, placementButton(this.node, this.view, this.getPos))
  }
  // Drag a handle: the picture follows the mouse, its share of the text
  // width shown; on release the width goes into the document.
  private startResize(e: PointerEvent, handle: string, im: HTMLImageElement) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const t = e.currentTarget as HTMLElement
    t.setPointerCapture(e.pointerId)
    // The page is drawn scaled (the zoom): mouse moves are in screen px.
    const scale = im.getBoundingClientRect().width / (im.offsetWidth || 1) || 1
    const w0 = im.offsetWidth
    const h0 = im.offsetHeight
    const textW = this.host.textWidthPx()
    const x0 = e.clientX
    const y0 = e.clientY
    const tip = document.createElement('span')
    tip.className = 'kt-size-tip'
    im.parentElement?.appendChild(tip)
    this.dom.classList.add('kt-resizing')
    let w = w0
    const move = (ev: PointerEvent) => {
      w = resizedWidth(handle, w0, h0, (ev.clientX - x0) / scale, (ev.clientY - y0) / scale, textW)
      im.style.width = `${w}px`
      tip.textContent = `${Math.round(w / textW * 100)}% of the text width`
    }
    const up = () => {
      t.removeEventListener('pointermove', move)
      t.removeEventListener('pointerup', up)
      t.removeEventListener('pointercancel', up)
      tip.remove()
      this.dom.classList.remove('kt-resizing')
      const pos = this.getPos()
      if (pos !== undefined && Math.abs(w - w0) >= 1) this.host.onFigureResized(pos, widthSpec(w, textW))
    }
    t.addEventListener('pointermove', move)
    t.addEventListener('pointerup', up)
    t.addEventListener('pointercancel', up)
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    const changed = node.attrs !== this.node.attrs
    this.node = node
    if (changed) this.render()
    return true
  }
  ignoreMutation() { return true }
  stopEvent(e: Event) { return (e.target as HTMLElement | null)?.classList?.contains('kt-handle') ?? false }
}

// A LaTeX length (3.4cm, 12mm, 1.5in, 20pt) in CSS pixels; 110 when it
// is not one of those.
export function lengthPx(spec: string): number {
  const m = /^([\d.]+)\s*(cm|mm|in|pt)$/.exec((spec || '').trim())
  if (!m) return 110
  const n = Number(m[1])
  return Math.round(n * ({ cm: 37.8, mm: 3.78, in: 96, pt: 1.333 } as Record<string, number>)[m[2]])
}

// On-screen width of a figure from its LaTeX width (0.6\textwidth, 8cm,
// 3in...), as editor._figure_display_size.
export function figureWidthPx(widthSpec: string, textW: number): number {
  const spec = (widthSpec || '').trim()
  const m = /^([\d.]*)\s*\\(textwidth|linewidth|columnwidth|hsize)/.exec(spec)
  const u = /^([\d.]+)\s*(cm|mm|in|pt|bp|px)$/.exec(spec)
  let w: number
  if (m) w = parseFloat(m[1] || '1') * textW
  else if (u) {
    const per: Record<string, number> = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72.27, bp: 96 / 72, px: 1 }
    w = parseFloat(u[1]) * per[u[2]]
  } else w = 0.8 * textW
  if (!Number.isFinite(w)) w = 0.8 * textW
  return Math.max(16, Math.min(w, textW))
}

const COL_SPEC_RE = /\||[@!<>]\{(?:[^{}]|\{[^{}]*\})*\}|[pmbw]\{(?:[^{}]|\{[^{}]*\})*\}|[lcrXSs]/g

// Per-column alignment and, for each of the ncols+1 boundaries, whether a
// vertical rule sits there (editor._parse_column_spec).
export function parseColumnSpec(spec: string, ncols: number): [string[], boolean[]] {
  let aligns: string[] = []
  let vrules: boolean[] = [false]
  for (const tok of (spec || '').match(COL_SPEC_RE) ?? []) {
    if (tok === '|') vrules[vrules.length - 1] = true
    else if ('@!<>'.includes(tok[0])) continue
    else { aligns.push(tok[0] === 'c' ? 'c' : tok[0] === 'r' ? 'r' : 'l'); vrules.push(false) }
  }
  aligns = [...aligns, ...Array(ncols).fill('l')].slice(0, ncols)
  vrules = [...vrules, ...Array(ncols + 1).fill(false)].slice(0, ncols + 1)
  return [aligns, vrules]
}

export function columnSpecTokens(spec: string): string[] {
  return (spec || '').match(COL_SPEC_RE) ?? []
}

// A data table drawn the way LaTeX typesets it (editor._apply_table_rules):
// horizontal rules only (plus '|' from the column spec), natural column
// widths, the caption underneath as "Table N: ...". The rules are cell
// decorations (tableCellStyles), never DOM edits ProseMirror would read
// back as typing.
class TableView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private node: PMNode
  private table: HTMLTableElement
  private place: HTMLElement
  private view: EditorView
  private getPos: () => number | undefined
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = document.createElement('div')
    this.dom.className = 'kt-block kt-table-wrap'
    this.table = document.createElement('table')
    this.table.className = 'kt-table'
    this.contentDOM = document.createElement('tbody')
    this.table.appendChild(this.contentDOM)
    this.dom.appendChild(this.table)
    this.place = placementButton(node, view, getPos)
    this.dom.appendChild(this.place)
    this.size()
  }
  // The placement button is not the table's content.
  ignoreMutation(m: ViewMutationRecord) { return this.place.contains(m.target as Node) }
  // Columns with LaTeX widths (m{0.36\textwidth}) take that share of the
  // text width, as the PDF does; the cells' share is set by tableCellStyles.
  private size() {
    const fr = columnFractions(this.node.attrs.alignment || '')
    const total = fr.reduce((a: number, b) => a + (b ?? 0), 0)
    const fixed = fr.length > 0 && fr.every((f) => f !== null)
    this.table.style.width = fixed ? `${Math.min(100, total * 100 + fr.length * 2)}%` : ''
    this.table.style.tableLayout = fixed ? 'fixed' : ''
    // Its own text size (Font size on a selection holding the table).
    const pt = this.node.attrs.font_size
    this.table.style.fontSize = pt ? `calc(1em * ${pt} / var(--kt-body-pt, 12))` : ''
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    const spec = node.attrs.alignment !== this.node.attrs.alignment || node.attrs.font_size !== this.node.attrs.font_size
    if (node.attrs.placement !== this.node.attrs.placement) {
      const b = placementButton(node, this.view, this.getPos)
      this.place.replaceWith(b)
      this.place = b
    }
    this.node = node
    if (spec) this.size()
    return true
  }
}

// Each column's width as a share of the text width, from p/m/b{0.36\textwidth}
// in the column spec; null for a natural-width column (l, c, r, 3cm).
export function columnFractions(spec: string): (number | null)[] {
  const out: (number | null)[] = []
  for (const tok of (spec || '').match(COL_SPEC_RE) ?? []) {
    if (tok === '|' || '@!<>'.includes(tok[0])) continue
    const m = /^[pmb]\{\s*([\d.]*)\s*\\(?:textwidth|linewidth|columnwidth|hsize)\s*\}$/.exec(tok)
    // A Word form's column: p{\dimexpr<share>\linewidth-2\tabcolsep\relax}.
    const d = /^[pmb]\{\\dimexpr\s*([\d.]+)\\(?:textwidth|linewidth)\b/.exec(tok)
    out.push(m ? parseFloat(m[1] || '1') : d ? parseFloat(d[1]) : null)
  }
  return out
}

// A table cell: its text, editable, under a strip with the cell's pictures
// (\includegraphics in its LaTeX), drawn at the cell's width.
class TableCellView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private pics: HTMLElement
  private shown = ''
  private node: PMNode
  private host: ViewHost
  constructor(node: PMNode, host: ViewHost) {
    this.node = node
    this.host = host
    this.dom = document.createElement('td')
    this.pics = document.createElement('div')
    this.pics.className = 'kt-cell-pics'
    this.pics.contentEditable = 'false'
    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'kt-cell-text'
    this.dom.append(this.pics, this.contentDOM)
    this.spans()
    this.render()
  }
  private spans() {
    const a = this.node.attrs
    if (a.colspan !== 1) this.dom.setAttribute('colspan', String(a.colspan)); else this.dom.removeAttribute('colspan')
    if (a.rowspan !== 1) this.dom.setAttribute('rowspan', String(a.rowspan)); else this.dom.removeAttribute('rowspan')
  }
  render() {
    const pics = cellPictures(this.node.attrs.raw ?? '')
    const paths = pics.map((p) => p.path)
    const srcs = paths.map((p) => this.host.resolveImage(p))
    const key = pics.map((p, i) => `${p.cmd}|${srcs[i] ?? ''}`).join('\n')
    if (key === this.shown) return
    this.shown = key
    this.pics.replaceChildren(...paths.map((p, i) => {
      const src = srcs[i]
      if (!src) {
        const miss = document.createElement('div')
        miss.className = 'kt-figure-missing'
        miss.textContent = p.split('/').pop() ?? p
        return miss
      }
      const im = document.createElement('img')
      im.src = src
      im.alt = ''
      im.draggable = false
      // \linewidth fills the cell; any other width is the PDF's.
      const w = pics[i].width
      if (w && !/^[\d.]*\s*\\linewidth$/.test(w)) im.style.width = `${figureWidthPx(w, this.host.textWidthPx())}px`
      return im
    }))
    this.pics.style.display = paths.length ? '' : 'none'
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.spans()
    this.render()
    return true
  }
  ignoreMutation(m: { type: string; target: Node }) {
    return m.type !== 'selection' && this.pics.contains(m.target)
  }
}

// Is all the text of a cell's LaTeX inside \<cmd>{...}?
function allIn(raw: string, cmd: string): boolean {
  if (!raw.includes(`\\${cmd}{`)) return false
  let s = raw
  const re = new RegExp(`\\\\${cmd}\\{[^{}]*\\}`, 'g')
  for (let prev = ''; prev !== s;) {
    prev = s
    s = s.replace(re, '').replace(/\\textcolor\[HTML\]\{[0-9A-Fa-f]{6}\}\{([^{}]*)\}/g, '$1')
  }
  return !cellDisplayText(s).replace(/[\s~]/g, '')
}

// Each cell's borders, alignment, shading and weight, in document order.
export function tableCellStyles(node: PMNode): { offset: number; style: string }[] {
  const out: { offset: number; style: string }[] = []
  const a = node.attrs
  const style: string = a.style || ''
  const booktabs = style === 'booktabs' || style === 'striped'
  const fancy = parseFancy(style)
  const header = !!a.header
  const nrows = node.childCount
  let ncols = 0
  node.firstChild?.forEach(c => { ncols += c.attrs.colspan })
  const last = nrows - 1
  let [aligns, vrules] = parseColumnSpec(a.alignment || '', ncols)
  // No spec: the one the LaTeX gets (l columns, or p{} for long text).
  const spec: string = a.alignment || autoTableAlignment(
    (() => { const rows: string[][] = []; node.forEach(r => { const cells: string[] = []; r.forEach(c => cells.push(c.attrs.raw ?? c.textContent)); rows.push(cells) }); return rows })(), ncols)
  const colTokens = spec.match(COL_SPEC_RE)?.filter((t: string) => t !== '|' && !'@!<>'.includes(t[0])) ?? []
  const fr = columnFractions(a.alignment || '')
  const fixed = fr.length === ncols && fr.every((f) => f !== null)
  const frTotal = fixed ? fr.reduce((x: number, y) => x + y!, 0) || 1 : 1
  if (style === 'grid') vrules = Array(ncols + 1).fill(true)
  let heavy = booktabs ? 1.4 : 0.8
  let thin = 0.8
  if (style === 'plain') heavy = thin = 0
  const taken: boolean[][] = []
  node.forEach((row, rowOffset, r) => {
    let c = 0
    row.forEach((cell, cellOffset) => {
      taken[r] = taken[r] ?? []
      while (taken[r][c]) c++
      for (let dr = 0; dr < cell.attrs.rowspan; dr++) {
        for (let dc = 0; dc < cell.attrs.colspan; dc++) {
          taken[r + dr] = taken[r + dr] ?? []
          taken[r + dr][c + dc] = true
        }
      }
      const bottomRow = r + cell.attrs.rowspan - 1
      const top = r === 0 ? heavy : 0
      const bottom = bottomRow >= last ? heavy : (r === 0 && last > 0 ? thin : style === 'grid' ? 0.8 : 0)
      const left = vrules[c] ? 0.8 : 0
      const right = vrules[Math.min(ncols, c + cell.attrs.colspan)] ? 0.8 : 0
      const shade: string | null = cell.attrs.shade
      const bg = shade ? shade : style === 'striped' && r > 0 && r % 2 === 0 ? '#eef3fa' : ''
      const raw: string = cell.attrs.raw ?? ''
      const unedited = cellDisplayText(raw) === cell.textContent.trim()
      const al = aligns[Math.min(c, aligns.length - 1)]
      const tok = colTokens[Math.min(c, colTokens.length - 1)] ?? ''
      let css = `border-top:${top}px solid ${top ? '#000' : 'transparent'};`
        + `border-bottom:${bottom}px solid ${bottom ? '#000' : 'transparent'};`
        + `border-left:${left}px solid ${left ? '#000' : 'transparent'};`
        + `border-right:${right}px solid ${right ? '#000' : 'transparent'};`
        + `text-align:${al === 'c' ? 'center' : al === 'r' ? 'right' : 'left'};`
        + (bg ? `background:${bg};` : '')
        + (tok[0] === 'm' ? 'vertical-align:middle;' : tok[0] === 'b' ? 'vertical-align:bottom;' : '')
        + (fixed && cell.attrs.colspan === 1 ? `width:${(fr[c]! / frTotal) * 100}%;` : '')
        // An l, c or r column never wraps in LaTeX (the table grows wider,
        // into the margin or the next column): nor does it here, so the
        // table is as tall as the PDF's.
        + (cell.attrs.colspan === 1 && /^[lcr]$/.test(tok) ? 'white-space:nowrap;--kt-cell-ws:pre;' : '')
      // Header row bold; unedited cells show their LaTeX's bold / italic.
      // Bold or italic only when all of the cell's text is (a Word form's
      // cell with a bold heading over plain text is not bold).
      if ((r === 0 && header) || (unedited && allIn(raw, 'textbf'))) css += 'font-weight:700;'
      if (unedited && (allIn(raw, 'textit') || allIn(raw, 'emph'))) css += 'font-style:italic;'
      if (unedited) css += cellLook(raw)
      if (fancy) {
        // Fancy styles: the colour's fills and rules win over the lines above.
        const C = '#' + fancy.color
        const head = r === 0 && header && nrows > 1
        const isLast = bottomRow >= last
        let topL = '0px solid transparent', botL = '0px solid transparent'
        if (fancy.kind === 'accent') {
          if (r === 0) topL = `1.6px solid ${C}`
          if (head) botL = `0.8px solid ${C}`
        } else if (fancy.kind === 'header' && !head && !isLast) botL = `0.6px solid #${FANCY_RULE_GREY}`
        if (isLast) botL = `${fancy.kind === 'accent' ? 1.6 : 1.3}px solid ${C}`
        css += `border-top:${topL};border-bottom:${botL};border-left:0;border-right:0;`
        if (head && fancy.kind !== 'accent') css += `background:${C};color:#fff;font-weight:700;`
        else if (head) css += `color:${C};font-weight:700;`
        else if (fancy.kind === 'banded' && r > 0 && r % 2 === 0 && !shade) css += `background:#${tint(fancy.color, 12)};`
      }
      out.push({ offset: 1 + rowOffset + 1 + cellOffset, style: css })
      c += cell.attrs.colspan
    })
  })
  return out
}

class RawFloatView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement('div')
    this.dom.className = 'kt-block kt-raw-float'
    this.render()
  }
  private render() {
    this.dom.textContent = rawFloatSummary(this.node.attrs.text)
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }
  ignoreMutation() { return true }
}

// editor._latex_to_display: raw LaTeX simplified to readable text.
export function latexToDisplay(s: string): string {
  return s.replace(/\\textit\{([^}]*)\}/g, '$1').replace(/\\textbf\{([^}]*)\}/g, '$1')
    .replace(/\\textsc\{([^}]*)\}/g, '$1').replace(/\\emph\{([^}]*)\}/g, '$1')
    .replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\mathrm\{([^}]*)\}/g, '$1')
    .replace(/\$/g, '').replace(/\\_/g, '_').replace(/\\&/g, '&')
}

function consumeBraced(s: string, i: number): string {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}') { depth--; if (depth === 0) return s.slice(i + 1, j) }
  }
  return s.slice(i + 1)
}

// "[figure*] caption  (label)": the compact summary of a figure* / table*.
export function rawFloatSummary(text: string): string {
  const cap = /\\caption\{/.exec(text)
  const capText = cap ? latexToDisplay(consumeBraced(text, cap.index + cap[0].length - 1) || '') : ''
  const lab = /\\label\{([^}]*)\}/.exec(text)
  const env = text.includes('\\begin{figure*}') ? 'figure*' : 'table*'
  let summary = `[${env}]`
  if (capText) summary += ` ${capText}`
  if (lab) summary += `  (${lab[1]})`
  return summary
}

// Raw inline LaTeX drawn the way the PDF shows it (a picture, a line
// break, nothing for \noindent), with the source kept beside it: the
// View > Show LaTeX source toggle (body.kt-latex-source) swaps the two.
function renderInlineRaw(dom: HTMLElement, latex: string, host: ViewHost) {
  // Layout ▸ Margin Note and Insert ▸ Drop Cap: drawn as the PDF shows them.
  const note = parseMarginNote(latex)
  if (note) { marginNoteElement(dom, note); return }
  const cap = parseDropCap(latex)
  if (cap) { dropCapElement(dom, cap); return }
  const icon = parseIcon(latex)
  if (icon) { iconElement(dom, icon); return }
  dom.title = latex
  const source = document.createElement('span')
  source.className = 'kt-raw-source'
  source.textContent = latex
  const look = inlineRawLook(latex)
  if (look.kind === 'source') {
    dom.className = 'kt-inline-raw'
    dom.replaceChildren(source)
    return
  }
  dom.className = 'kt-inline-raw kt-inline-raw-shown'
  const shown = document.createElement('span')
  shown.className = 'kt-raw-look'
  switch (look.kind) {
    case 'break': shown.appendChild(document.createElement('br')); break
    case 'none': break
    case 'space': shown.style.display = 'inline-block'; shown.style.width = `${look.em}em`; break
    case 'text': shown.textContent = look.text; break
    case 'image': {
      const src = host.resolveImage(look.path)
      if (!src) { shown.textContent = '[image]'; shown.className += ' kt-raw-missing'; break }
      const im = document.createElement('img')
      im.className = 'kt-inline-image'
      im.src = src
      im.alt = look.path
      const body = host.bodyPx()
      const lenPx = (spec: string): number | null => {
        if (/\\(textwidth|linewidth|columnwidth|hsize)/.test(spec)) return figureWidthPx(spec, host.textWidthPx())
        const em = lengthEm(spec)
        return em === null ? null : em * body
      }
      const w = look.width ? lenPx(look.width) : null
      const h = look.height ? lenPx(look.height) : null
      if (w !== null) im.style.width = `${w}px`
      if (h !== null) im.style.height = `${h}px`
      if (w === null && h === null) {
        im.style.maxWidth = `${host.textWidthPx()}px`
        if (look.scale !== null) im.onload = () => { im.style.width = `${im.naturalWidth * look.scale!}px` }
      }
      if (look.raiseEm) im.style.verticalAlign = `${look.raiseEm * body}px`
      im.onerror = () => { shown.textContent = `[Image not found: ${look.path}]`; shown.className += ' kt-raw-missing' }
      shown.appendChild(im)
      break
    }
  }
  dom.replaceChildren(shown, source)
}

// Citations, references, footnotes and verbatim inlines: atoms showing
// their text the way editor.py's char formats do.
class AtomView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private host: ViewHost
  constructor(node: PMNode, host: ViewHost, getPos: () => number | undefined) {
    this.node = node
    this.host = host
    this.dom = document.createElement('span')
    this.render()
    if (node.type.name === 'footnote') {
      this.dom.addEventListener('dblclick', e => {
        e.preventDefault()
        const p = getPos()
        if (p !== undefined) host.onFootnoteDoubleClick(p)
      })
    }
  }
  render() {
    const n = this.node
    const a = n.attrs
    switch (n.type.name) {
      case 'citation':
        this.dom.className = 'kt-citation'
        this.dom.textContent = this.host.resolver().citeText(a.keys, a.style)
        this.dom.title = `\\cite{${(a.keys as string[]).join(',')}}`
        break
      case 'crossref':
        this.dom.className = 'kt-crossref'
        this.dom.textContent = this.host.resolver().refText(a.label, a.kind)
        this.dom.title = `\\${a.kind || 'ref'}{${a.label}}`
        break
      case 'footnote': {
        this.dom.className = 'kt-footnote'
        const note = inlinePlain(a.children as Inline[]) || 'footnote'
        const text = document.createElement('span')
        text.className = 'kt-footnote-text'
        text.textContent = note
        const mark = document.createElement('sup')
        mark.className = 'kt-footnote-mark'
        this.dom.replaceChildren(text, mark)
        this.dom.title = note
        break
      }
      case 'inline_raw':
        renderInlineRaw(this.dom, a.latex as string, this.host)
        break
      case 'inline_json': {
        const m = a.node as Inline | null
        this.dom.className = 'kt-inline-json'
        this.dom.textContent = m && m.type === 'Link' ? m.url : ''
        break
      }
    }
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }
  ignoreMutation() { return true }
}

export function nodeViews(host: ViewHost, atoms: Set<{ render(): void }>) {
  const atom = (node: PMNode, _v: EditorView, getPos: () => number | undefined) => {
    const v = new AtomView(node, host, getPos)
    atoms.add(v)
    const destroy = () => atoms.delete(v)
    return Object.assign(v, { destroy })
  }
  return {
    math_inline: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new MathInlineView(node, host, view, getPos),
    math_block: (node: PMNode, _v: EditorView, getPos: () => number | undefined) =>
      new MathBlockView(node, host, getPos),
    figure: (node: PMNode, view: EditorView, getPos: () => number | undefined) => {
      // Registered so a loaded or redrawn image shows at once.
      const v = new FigureView(node, host, getPos, view)
      atoms.add(v)
      return Object.assign(v, { destroy: () => { atoms.delete(v) } })
    },
    table: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new TableView(node, view, getPos),
    table_cell: (node: PMNode) => {
      // Registered so a cell's picture shows once it has loaded.
      const v = new TableCellView(node, host)
      atoms.add(v)
      return Object.assign(v, { destroy: () => { atoms.delete(v) } })
    },
    raw_float: (node: PMNode) => new RawFloatView(node),
    citation: atom, crossref: atom, footnote: atom, inline_raw: atom, inline_json: atom,
  }
}
