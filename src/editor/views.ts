// How the editor draws what is not plain text: typeset equations, figure
// frames, tables with LaTeX's rules, citations and references as the PDF
// numbers them, footnotes, raw LaTeX. The looks follow editor.py's char
// and block formats (_link_format, _citation_format, _figure_block_format...).
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import type { Inline } from '../core/model.ts'
import { renderMath } from '../math/render.ts'
import { cellDisplayText } from './convert.ts'
import type { ReferenceResolver } from '../core/references.ts'

export interface ViewHost {
  resolver(): ReferenceResolver
  bodyPx(): number
  textWidthPx(): number
  resolveImage(path: string): string | null
  onMathDoubleClick(pos: number, display: boolean): void
  onFigureDoubleClick(pos: number): void
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

class FigureView implements NodeView {
  dom: HTMLElement
  private node: PMNode
  private host: ViewHost
  constructor(node: PMNode, host: ViewHost, getPos: () => number | undefined) {
    this.node = node
    this.host = host
    this.dom = document.createElement('div')
    this.dom.className = 'kt-block kt-figure'
    this.render()
    this.dom.addEventListener('dblclick', e => {
      e.preventDefault()
      const p = getPos()
      if (p !== undefined) host.onFigureDoubleClick(p)
    })
  }
  render() {
    const a = this.node.attrs
    this.dom.dataset.align = a.align || 'center'
    const rows: HTMLElement[] = []
    const img = document.createElement('div')
    img.className = 'kt-figure-row kt-figure-image'
    const src = this.host.resolveImage(a.path)
    const missing = (text: string) => {
      const s = document.createElement('span')
      s.className = 'kt-figure-missing'
      s.textContent = text
      img.replaceChildren(s)
    }
    if (src) {
      const im = document.createElement('img')
      im.src = src
      im.draggable = false
      im.style.width = `${figureWidthPx(a.width, this.host.textWidthPx())}px`
      im.onerror = () => missing(`[Image not found: ${a.path}]`)
      img.appendChild(im)
    } else {
      missing(`[Image: ${a.path}]`)
    }
    rows.push(img)
    if (a.caption) {
      const cap = document.createElement('div')
      cap.className = 'kt-figure-row kt-figure-caption'
      cap.textContent = `Figure: ${a.caption}`
      rows.push(cap)
    }
    if (a.label) {
      const lab = document.createElement('div')
      lab.className = 'kt-figure-row kt-figure-label'
      lab.textContent = `Label: ${a.label}`
      rows.push(lab)
    }
    this.dom.replaceChildren(...rows)
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    const changed = node.attrs !== this.node.attrs
    this.node = node
    if (changed) this.render()
    return true
  }
  ignoreMutation() { return true }
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
  constructor(node: PMNode) {
    this.node = node
    this.dom = document.createElement('div')
    this.dom.className = 'kt-block kt-table-wrap'
    const table = document.createElement('table')
    table.className = 'kt-table'
    this.contentDOM = document.createElement('tbody')
    table.appendChild(this.contentDOM)
    this.dom.appendChild(table)
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    return true
  }
}

// Each cell's borders, alignment, shading and weight, in document order.
export function tableCellStyles(node: PMNode): { offset: number; style: string }[] {
  const out: { offset: number; style: string }[] = []
  const a = node.attrs
  const style: string = a.style || ''
  const booktabs = style === 'booktabs' || style === 'striped'
  const header = !!a.header
  const nrows = node.childCount
  let ncols = 0
  node.firstChild?.forEach(c => { ncols += c.attrs.colspan })
  const last = nrows - 1
  let [aligns, vrules] = parseColumnSpec(a.alignment || '', ncols)
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
      let css = `border-top:${top}px solid ${top ? '#000' : 'transparent'};`
        + `border-bottom:${bottom}px solid ${bottom ? '#000' : 'transparent'};`
        + `border-left:${left}px solid ${left ? '#000' : 'transparent'};`
        + `border-right:${right}px solid ${right ? '#000' : 'transparent'};`
        + `text-align:${al === 'c' ? 'center' : al === 'r' ? 'right' : 'left'};`
        + (bg ? `background:${bg};` : '')
      // Header row bold; unedited cells show their LaTeX's bold / italic.
      if ((r === 0 && header) || (unedited && raw.includes('\\textbf{'))) css += 'font-weight:700;'
      if (unedited && (raw.includes('\\textit{') || raw.includes('\\emph{'))) css += 'font-style:italic;'
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
        this.dom.className = 'kt-inline-raw'
        this.dom.title = a.latex
        // A \\ break should look like a break.
        if (a.latex === '\\\\') this.dom.replaceChildren(document.createElement('br'))
        else this.dom.textContent = a.latex
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
    figure: (node: PMNode, _v: EditorView, getPos: () => number | undefined) => {
      // Registered so a loaded or redrawn image shows at once.
      const v = new FigureView(node, host, getPos)
      atoms.add(v)
      return Object.assign(v, { destroy: () => { atoms.delete(v) } })
    },
    table: (node: PMNode) => new TableView(node),
    raw_float: (node: PMNode) => new RawFloatView(node),
    citation: atom, crossref: atom, footnote: atom, inline_raw: atom, inline_json: atom,
  }
}
