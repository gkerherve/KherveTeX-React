// Two decoration layers over the document: the page layout (layout.ts —
import { captionText } from './convert.ts'
import { topBlocks } from './noCompile.ts'
// each block's font, margins, numbers and labels, recomputed on every
// change as _apply_page_layout is) and the page breaks (paginate.ts).
import type { PdfTypography } from '../app/pageAnchors.ts'
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { pageOf, tocBlock, tocEntries, tocWidget } from './toc.ts'
import { parseWidget } from '../core/widgets.ts'
import { deleteBlockAt, selectBlockAt, updateWidget } from './widgetCommands.ts'
import { widgetElement } from './widgetView.ts'

// A double-click on an element: the app opens its edit dialog.
export const WIDGET_EDIT_EVENT = 'kt-widget-edit'

// Typing never lands in an element's hidden LaTeX: a caret that arrives
// there (arrow keys, a click) selects the whole element instead. With an
// element selected, typing or Enter starts a paragraph after it, and the
// arrow keys open an empty one before / after it when there is no text
// there (between two elements, at the start or end of the document), so
// text can always go before, between and after elements. Backspace /
// Delete remove it.
const isWidgetNode = (n: PMNode | null | undefined) => !!n && n.type.name === 'raw_latex' && !!parseWidget(n.textContent)
const textOk = (n: PMNode | null | undefined) => !!n && n.isTextblock && !isWidgetNode(n)

export function widgetGuardPlugin(): Plugin {
  const selected = (state: EditorState) => {
    const sel = state.selection
    const node = (sel as NodeSelection).node
    if (node && isWidgetNode(node)) return { pos: sel.from, node }
    const $p = sel.$from
    if (sel.empty && $p.depth === 1 && isWidgetNode($p.parent)) return { pos: $p.before(), node: $p.parent }
    return null
  }
  const para = (state: EditorState) => state.schema.nodes.paragraph.create({ alignment: 'justify' })
  // A paragraph after (or before) the element, the caret in it; reuses an
  // empty paragraph already there.
  const openAt = (view: EditorView, at: number, text = '') => {
    const st = view.state
    const there = st.doc.resolve(at)
    const near = at >= st.doc.content.size ? null : there.nodeAfter
    let tr = st.tr
    if (!(near && textOk(near) && near.content.size === 0)) tr = tr.insert(at, para(st))
    if (text) tr = tr.insertText(text, at + 1)
    tr.setSelection(TextSelection.create(tr.doc, at + 1 + text.length))
    view.dispatch(tr.scrollIntoView())
    return true
  }
  return new Plugin({
    // A caret inside an element's LaTeX becomes the element selected.
    appendTransaction: (_trs, _old, state) => {
      const sel = state.selection
      const $p = sel.$from
      // (By its JSON type: the class may come from another copy of the module.)
      if (sel.toJSON().type !== 'text' || $p.depth !== 1 || !isWidgetNode($p.parent)) return null
      if (!sel.empty && !isWidgetNode(sel.$to.parent)) return null
      return state.tr.setSelection(NodeSelection.create(state.doc, $p.before()))
    },
    props: {
      handleTextInput: (view, _from, _to, text) => {
        const w = selected(view.state)
        if (!w) return false
        return openAt(view, w.pos + w.node.nodeSize, text)
      },
      handlePaste: (view) => !!selected(view.state),
      handleKeyDown: (view, ev) => {
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return false
        const w = selected(view.state)
        if (!w) {
          // At the edge of a paragraph, an arrow towards an element selects
          // it (the browser would put the caret in its hidden LaTeX).
          const dir = ({ ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' } as const)[ev.key as 'ArrowUp']
          const sel = view.state.selection
          if (!dir || ev.shiftKey || !sel.empty || sel.$from.depth !== 1 || !view.endOfTextblock(dir)) return false
          const back = dir === 'up' || dir === 'left'
          const edge = back ? sel.$from.before() : sel.$from.after()
          const $e = view.state.doc.resolve(edge)
          const n = back ? $e.nodeBefore : $e.nodeAfter
          if (!isWidgetNode(n)) return false
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, back ? edge - n!.nodeSize : edge)).scrollIntoView())
          return true
        }
        const end = w.pos + w.node.nodeSize
        const doc = view.state.doc
        switch (ev.key) {
          case 'Backspace': case 'Delete':
            deleteBlockAt(w.pos)(view.state, view.dispatch); return true
          case 'Enter':
            return openAt(view, end)
          case 'ArrowDown': case 'ArrowRight': {
            const next = end < doc.content.size ? doc.resolve(end).nodeAfter : null
            if (next && !isWidgetNode(next)) {
              if (!next.isTextblock) return false
              view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, end + 1)).scrollIntoView()); return true
            }
            if (next && ev.shiftKey) return false
            return openAt(view, end)
          }
          case 'ArrowUp': case 'ArrowLeft': {
            const prev = doc.resolve(w.pos).nodeBefore
            if (prev && !isWidgetNode(prev)) {
              if (!prev.isTextblock) return false
              view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, w.pos - 1)).scrollIntoView()); return true
            }
            if (ev.shiftKey) return false
            return openAt(view, w.pos)
          }
        }
        return false
      },
    },
  })
}
import { Decoration, DecorationSet } from 'prosemirror-view'
import { calloutColor, isCallout, type DocMeta } from '../core/model.ts'
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

// The date's × (set by contextMenu.ts, which reaches the app's commands).
export const dateHooks = { remove: () => {} }

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
    if (item.date) {
      // Like an element's box: a frame on hover and a × that removes it
      // (Insert > Date brings it back); right-click picks its format.
      el.title = 'Date: right-click to change its format'
      const x = document.createElement('button')
      x.type = 'button'
      x.className = 'kt-widget-close kt-date-close'
      x.textContent = '\u00d7'
      x.title = 'Remove the date (Insert > Date brings it back)'
      x.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); dateHooks.remove() })
      el.appendChild(x)
    }
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
    // Insert ▸ Elements: the drawing over the hidden LaTeX.
    const w = parseWidget(node.textContent)
    if (w) {
      decos.push(Decoration.widget(pos + node.nodeSize, view => {
        const at = () => {
          const p = view.posAtDOM(dom, 0)
          const before = view.state.doc.resolve(p).nodeBefore
          return before ? p - before.nodeSize : -1
        }
        const act = (fn: (p: number) => void) => () => { const p = at(); if (p >= 0) { fn(p); view.focus() } }
        const dom: HTMLElement = widgetElement(w, {
          select: act(p => selectBlockAt(p)(view.state, view.dispatch)),
          remove: act(p => deleteBlockAt(p)(view.state, view.dispatch)),
          edit: act(p => { selectBlockAt(p)(view.state, view.dispatch); window.dispatchEvent(new CustomEvent(WIDGET_EDIT_EVENT)) }),
          toggle: (i: number) => act(p => {
            selectBlockAt(p)(view.state, view.dispatch)
            updateWidget<'checklist'>(d => { if (d.items[i]) d.items[i].done = !d.items[i].done })(view.state, view.dispatch)
          })(),
        })
        return dom
      }, { side: -1, key: 'w' + node.textContent, ignoreSelection: true, stopEvent: () => true }))
      return
    }
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
  // Callout boxes: which paragraphs open and close each box.
  const callout = new Map<number, { first: boolean; last: boolean; color: string }>()
  {
    const tops: { node: PMNode; pos: number }[] = []
    doc.forEach((node, pos) => tops.push({ node, pos }))
    tops.forEach(({ node, pos }, i) => {
      if (node.type.name !== 'theorem' || !isCallout(node.attrs.kind)) return
      const next = tops[i + 1]?.node
      const last = !next || next.type.name !== 'theorem' || next.attrs.start || next.attrs.kind !== node.attrs.kind
      const prev = tops[i - 1]?.node
      const first = node.attrs.start || !prev || prev.type.name !== 'theorem' || prev.attrs.kind !== node.attrs.kind
      callout.set(pos, { first, last, color: '#' + calloutColor(node.attrs.kind, node.attrs.color) })
    })
  }
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
    // A theorem, lemma, proposition or corollary is italic in the PDF
    // (plain style); definitions, examples, remarks and proofs upright.
    if (node.type.name === 'theorem' && ['theorem', 'lemma', 'proposition', 'corollary'].includes(node.attrs.kind)) style += 'font-style:italic;'
    const box = callout.get(pos)
    if (box) {
      // A titled tcolorbox: coloured frame, a light tint of it inside.
      style += `--kt-callout:${box.color};background:color-mix(in srgb, ${box.color} 7%, white);`
        + `border-left:1px solid ${box.color};border-right:1px solid ${box.color};padding:2px 8px;text-indent:0;`
      if (box.first) style += `border-top:1px solid ${box.color};border-top-left-radius:3px;border-top-right-radius:3px;`
      else style += 'margin-top:0;padding-top:4px;'
      if (box.last) style += `border-bottom:1px solid ${box.color};border-bottom-left-radius:3px;border-bottom-right-radius:3px;padding-bottom:6px;`
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
      attrs.class = parseWidget(t) ? 'kt-raw-widget' : t.includes('\\begin{lstlisting}') || t.includes('\\begin{verbatim}') ? 'kt-raw-code'
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
  // Do not compile: the parts left out greyed, their markers as labels.
  for (const t of topBlocks(doc)) {
    if (t.hidden) decos.push(Decoration.node(t.pos, t.pos + t.node.nodeSize, { class: 'kt-nocompile' }))
    else if (t.marker && t.paired) {
      decos.push(Decoration.node(t.pos, t.pos + t.node.nodeSize, { class: `kt-nc-mark kt-nc-${t.marker}`, contenteditable: 'false' }))
    }
  }
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
  // 'col': (columns) where the next column of a sheet starts, a forced
  // column break, so the browser does not balance the columns its own way.
  kind: 'block' | 'inline' | 'row' | 'span' | 'float' | 'col' | 'fill'
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
    el = document.createElement(s.kind === 'inline' || ((s.kind === 'col' || s.kind === 'fill') && s.inline) ? 'span' : 'div')
    if (s.kind === 'col') {
      el.style.height = '0px'
    } else if (s.kind === 'fill') {
      el.style.height = `${s.height}px`
    } else if (s.kind === 'block' || s.kind === 'span') {
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
