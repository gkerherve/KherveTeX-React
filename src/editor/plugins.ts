// Two decoration layers over the document: the page layout (layout.ts —
import { captionText } from './convert.ts'
// each block's font, margins, numbers and labels, recomputed on every
// change as _apply_page_layout is) and the page breaks (paginate.ts).
import type { PdfTypography } from '../app/pageAnchors.ts'
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import { pageOf, tocBlock, tocEntries, tocWidget } from './toc.ts'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { DocMeta } from '../core/model.ts'
import { tableCellStyles } from './views.ts'
import { BASELINE_AT, anchorTargets, layoutDocument, pdfPageStartBlocks, type PageAnchor, type BlockLayout, type CharStyle, type DocLayout, type PaintedLabel } from './layout.ts'

export interface LayoutPluginState {
  meta: DocMeta
  headingOffset: number[]
  anchors: readonly PageAnchor[]
  // The compiled PDF's body size and columns (pdfTypography), or null.
  typography: PdfTypography | null
  layout: DocLayout
  decos: DecorationSet
}

export const layoutKey = new PluginKey<LayoutPluginState>('kt-layout')

// What the layout plugin listens for in a transaction's meta.
export interface LayoutMeta {
  meta?: DocMeta
  headingOffset?: number[]
  // (page, first text) of each compiled PDF page after the first.
  anchors?: readonly PageAnchor[]
  typography?: PdfTypography | null
}

export function charCss(c: CharStyle): string {
  return `font-family:${c.family};font-size:${c.sizePx}px;font-weight:${c.bold ? 700 : 400};`
    + `font-style:${c.italic ? 'italic' : 'normal'};`
    + (c.upper ? 'text-transform:uppercase;' : '') + (c.color ? `color:${c.color};` : '')
}

function lineHeightCss(L: BlockLayout): string {
  if (L.tall) return `line-height:${L.tall.lead}px;padding-top:${L.tall.padTop}px;padding-bottom:${L.tall.padBottom}px;`
  if (typeof L.lineHeight === 'number') return `line-height:${L.lineHeight}px;`
  if (L.lineHeight === 'normal') return 'line-height:normal;'
  return `line-height:${L.lineHeight.proportional * 1.407}em;`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// Lines the class prints around a block that are not its text: the
// date, "Abstract" above it, "Chapter 1" above a title; "Abstract." or
// "Keywords:" in front of its first line. Placed from the block's first
// baseline, as PagedTextEdit._paint_block_labels does.
function labelWidget(L: BlockLayout, firstBaseline: number): HTMLElement | null {
  if (!L.above.length && !L.runIn) return null
  const box = document.createElement('span')
  box.className = 'kt-labels'
  box.contentEditable = 'false'
  const put = (item: PaintedLabel, x: number | null, baseline: number) => {
    const lh = item.sizePx * 1.2
    const el = document.createElement('span')
    el.className = item.date ? 'kt-label kt-date' : 'kt-label'
    el.style.cssText = charCss({ ...item, upper: false }) + `line-height:${lh}px;`
      + `top:${baseline - BASELINE_AT * lh}px;` + (item.centred ? 'left:0;right:0;text-align:center;'
      : `left:${x ?? 0}px;`)
    el.innerHTML = esc(item.text)
    box.appendChild(el)
  }
  for (const item of L.above) put(item, 0, firstBaseline - item.up)
  if (L.runIn) put(L.runIn, L.runIn.left ?? 0, firstBaseline)
  return box
}

function firstBaselineOf(L: BlockLayout, body: CharStyle): number {
  const c = L.char ?? body
  if (L.tall) return L.tall.padTop + L.tall.lead / 2 + 0.348 * c.sizePx
  const lh = typeof L.lineHeight === 'number' ? L.lineHeight : c.sizePx * 1.407
  // A Latin Modern line's baseline in CSS half-leading (fonts.css sets the
  // ascent and descent so a 1.2 em line puts it at BASELINE_AT).
  return lh / 2 + 0.348 * c.sizePx
}

function buildDecorations(doc: PMNode, layout: DocLayout, anchors: readonly PageAnchor[] = []): DecorationSet {
  const decos: Decoration[] = []
  const byPos = new Map<number, BlockLayout>()
  for (const L of layout.blocks) byPos.set(L.pos, L)
  // Tables of contents (lists of figures, tables): drawn as LaTeX prints them.
  let starts: { page: number; pos: number }[] | null = null
  doc.forEach((node, pos) => {
    if (node.type.name !== 'raw_latex') return
    const t = tocBlock(node.textContent)
    if (!t) return
    const numbers = new Map<number, string>()
    for (const L of layout.blocks) if (L.number) numbers.set(L.pos, L.number.replace(/\s+$/, ''))
    const entries = tocEntries(doc, t.kind, t.depth, numbers)
    if (starts === null) starts = anchors.length ? anchorTargets(doc, anchors).map(a => ({ page: a.page, pos: a.pos })).sort((a, b) => a.pos - b.pos) : []
    const st = starts
    const pages = entries.map(e => pageOf(e.pos, st))
    const key = 'toc' + JSON.stringify([t, entries.map(e => [e.number, e.text, e.level]), pages])
    decos.push(Decoration.widget(pos + node.nodeSize, view => tocWidget(t.kind, entries, pages, p => {
      const d = view.state.doc
      view.dispatch(view.state.tr.setSelection(TextSelection.near(d.resolve(Math.min(p + 1, d.content.size)))).scrollIntoView())
      view.focus()
    }, () => {
      // Remove the block, and leave the caret in the text after it.
      const st = view.state
      let at = -1, size = 0
      st.doc.forEach((n, p) => { if (at < 0 && n.type.name === 'raw_latex' && tocBlock(n.textContent)?.kind === t.kind) { at = p; size = n.nodeSize } })
      if (at < 0) return
      const tr = st.tr.delete(at, at + size)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))))
      view.dispatch(tr.scrollIntoView())
      view.focus()
    }), { side: -1, key, ignoreSelection: true }))
  })
  let tables = 0
  const visit = (node: PMNode, pos: number) => {
    const L = byPos.get(pos)
    if (!L) return
    if (node.type.name === 'table' || node.type.name === 'figure') {
      const attrs: Record<string, string> = { style: `margin-top:${L.gap}px;` }
      if (node.type.name === 'table') {
        tables += 1
        if (node.attrs.caption) attrs['data-caption'] = `Table ${tables}: ${captionText(node.attrs.caption)}`
        for (const c of tableCellStyles(node)) {
          const cell = node.nodeAt(c.offset - 1)
          if (cell) decos.push(Decoration.node(pos + c.offset, pos + c.offset + cell.nodeSize, { style: c.style }))
        }
      }
      decos.push(Decoration.node(pos, pos + node.nodeSize, attrs))
      return
    }
    // List items space with padding: their list does not collapse margins.
    const top = node.type.name === 'list_item' ? `padding-top:${L.gap}px;` : `margin-top:${L.gap}px;`
    let style = `${top}text-align:${L.align};`
      + `margin-left:${L.left}px;margin-right:${L.right}px;text-indent:${L.indent}px;` + lineHeightCss(L)
    if (L.char) style += charCss(L.char)
    if (L.spans) style += 'column-span:all;'
    if (L.marker !== undefined) style += `list-style-type:${JSON.stringify(L.marker + '\u2002')};`
    // Word's shading and borders on a paragraph, as the PDF's box draws them.
    if (node.type.name === 'paragraph' && (node.attrs.shade || node.attrs.border)) {
      const b: string = node.attrs.border || ''
      const line = '0.67px solid #000'
      if (node.attrs.shade) style += `background:${node.attrs.shade};`
      style += 'padding:3px 4px;'
      if (b === 'box') style += `border:${line};`
      if (b === 'top' || b === 'topbottom') style += `border-top:${line};`
      if (b === 'bottom' || b === 'topbottom') style += `border-bottom:${line};`
    }
    if (L.padBottom) style += `padding-bottom:${L.padBottom + (L.tall?.padBottom ?? 0)}px;`
    const attrs: Record<string, string> = { style }
    if (L.number) {
      attrs['data-num'] = L.number
      attrs.class = `kt-numbered kt-num-${L.numberStyle}`
      attrs.style += `--kt-num-gap:${L.numberGap}px;`
    }
    if (node.type.name === 'section') attrs['data-level'] = String(node.attrs.level)
    if (node.type.name === 'raw_latex') {
      // _code_block_format / _bibliography_block_format / _raw_block_format.
      const t = node.textContent
      attrs.class = t.includes('\\begin{lstlisting}') || t.includes('\\begin{verbatim}') ? 'kt-raw-code'
        : t.includes('\\begin{thebibliography}') ? 'kt-raw-bib' : tocBlock(t) ? 'kt-raw-toc' : /^\s*\\(?:newpage|clearpage|pagebreak|cleardoublepage)\s*$/.test(t) ? 'kt-raw-pagebreak' : ''
    }
    if (L.breakBefore) attrs['data-break'] = '1'
    if (L.spans) attrs['data-span'] = '1'
    if (L.equationNumber) attrs['data-eqno'] = L.equationNumber
    decos.push(Decoration.node(pos, pos + node.nodeSize, attrs, { layout: L }))
    const labels = (L.above.length || L.runIn) && node.isTextblock
    if (labels) {
      const base = firstBaselineOf(L, layout.bodyChar)
      const key = JSON.stringify([L.above, L.runIn, base, L.indent])
      decos.push(Decoration.widget(pos + 1, () => labelWidget(L, base)!, { side: -1, key, ignoreSelection: true }))
    }
  }
  doc.forEach((node, offset) => {
    if (node.type.name === 'list') {
      // The list keeps no margin of its own; its items carry Qt's.
      decos.push(Decoration.node(offset, offset + node.nodeSize, { style: 'margin-top:0' }))
      node.forEach((item, o) => visit(item, offset + 1 + o))
    } else {
      visit(node, offset)
    }
  })
  return DecorationSet.create(doc, decos)
}

export function layoutPlugin(meta: DocMeta): Plugin<LayoutPluginState> {
  const compute = (doc: PMNode, m: DocMeta, off: number[], anchors: readonly PageAnchor[],
    typography: PdfTypography | null): LayoutPluginState => {
    const layout = layoutDocument(doc, m, off, anchors.length ? pdfPageStartBlocks(doc, anchors) : new Set(),
      anchors.length > 0, anchors.length ? typography : null)
    return { meta: m, headingOffset: off, anchors, typography, layout, decos: buildDecorations(doc, layout, anchors) }
  }
  return new Plugin<LayoutPluginState>({
    key: layoutKey,
    state: {
      init: (_c, state) => compute(state.doc, meta, [0, 0, 0, 0, 0, 0], [], null),
      apply(tr, prev) {
        const m = tr.getMeta(layoutKey) as LayoutMeta | undefined
        if (!tr.docChanged && !m) return prev
        return compute(tr.doc, m?.meta ?? prev.meta, m?.headingOffset ?? prev.headingOffset,
          m?.anchors ?? prev.anchors, m?.typography !== undefined ? m.typography : prev.typography)
      },
    },
    props: {
      decorations: (state: EditorState) => layoutKey.getState(state)!.decos,
    },
  })
}

// ---------- page breaks ----------

export interface Spacer {
  // Document position the spacer sits at.
  pos: number
  height: number
  // Before a block, at a line start, before a table row, or (columns)
  // across the columns where the next sheet starts.
  // 'float': not a gap but a floating figure (at `pos`) taken out of the
  // flow (`height`, the space it gave up) and drawn `dy` lower, at the top
  // of the next sheet, as LaTeX places a figure that does not fit.
  kind: 'block' | 'inline' | 'row' | 'span' | 'float'
  // How far a floating figure is drawn below its place in the flow.
  dy?: number
  // A row spacer's table width in cells.
  cols?: number
  // A row spacer in a table ruled between rows: the line on the next sheet.
  ruled?: boolean
  // A span spacer inside a paragraph.
  inline?: boolean
}

interface PagesState { spacers: Spacer[]; decos: DecorationSet }

export const pagesKey = new PluginKey<PagesState>('kt-pages')

function spacerEl(s: Spacer): HTMLElement {
  let el: HTMLElement
  if (s.kind === 'row') {
    el = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = Math.max(1, s.cols ?? 1)
    td.style.cssText = `height:${Math.max(0, s.height)}px;padding:0;border:none;background:none`
      + (s.ruled ? ';border-bottom:0.8px solid #000' : '')
    el.appendChild(td)
  } else {
    el = document.createElement(s.kind === 'inline' ? 'span' : 'div')
    if (s.kind === 'block' || s.kind === 'span') {
      if (s.height >= 0) el.style.height = `${s.height}px`
      else { el.style.height = '0px'; el.style.marginBottom = `${s.height}px` }
    } else {
      el.style.height = `${s.height}px`
    }
  }
  el.className = `kt-page-gap kt-page-gap-${s.kind}`
  el.contentEditable = 'false'
  return el
}

function spacerDecos(doc: PMNode, spacers: Spacer[]): DecorationSet {
  const decos: Decoration[] = []
  for (const s of spacers) {
    if (s.kind === 'float') {
      const node = doc.nodeAt(s.pos)
      if (!node) continue
      decos.push(Decoration.node(s.pos, s.pos + node.nodeSize, {
        style: `margin-bottom:${-s.height}px;transform:translateY(${s.dy ?? 0}px);position:relative;z-index:2;`,
        'data-kt-lift': String(s.height), 'data-kt-dy': String(s.dy ?? 0),
      }))
      continue
    }
    // marks: [] keeps the gap outside bold, links, tracked changes...: a
    // page break inside an inline element (<strong>) cannot span the
    // columns, and the text ran on across the gap between sheets.
    decos.push(Decoration.widget(s.pos, () => spacerEl(s),
      { side: -1, marks: [], ignoreSelection: true, key: `gap-${s.pos}-${s.kind}-${s.height.toFixed(2)}-${s.ruled ? 1 : 0}` }))
  }
  return DecorationSet.create(doc, decos)
}

export function pagesPlugin(): Plugin<PagesState> {
  return new Plugin<PagesState>({
    key: pagesKey,
    state: {
      init: (_c, state): PagesState => ({ spacers: [], decos: DecorationSet.create(state.doc, []) }),
      apply(tr, prev): PagesState {
        const set = tr.getMeta(pagesKey) as Spacer[] | undefined
        if (set) return { spacers: set, decos: spacerDecos(tr.doc, set) }
        if (!tr.docChanged) return prev
        // Keep the old breaks, mapped, until the next measurement: no
        // jumping while typing.
        const spacers = prev.spacers.map(s => ({ ...s, pos: tr.mapping.map(s.pos, -1) }))
        return { spacers, decos: prev.decos.map(tr.mapping, tr.doc) }
      },
    },
    props: {
      decorations: state => pagesKey.getState(state)!.decos,
    },
  })
}
