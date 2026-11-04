// Two decoration layers over the document: the page layout (layout.ts —
// each block's font, margins, numbers and labels, recomputed on every
// change as _apply_page_layout is) and the page breaks (paginate.ts).
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { DocMeta } from '../core/model.ts'
import { tableCellStyles } from './views.ts'
import { BASELINE_AT, layoutDocument, type BlockLayout, type CharStyle, type DocLayout, type PaintedLabel } from './layout.ts'

export interface LayoutPluginState {
  meta: DocMeta
  headingOffset: number[]
  layout: DocLayout
  decos: DecorationSet
}

export const layoutKey = new PluginKey<LayoutPluginState>('kt-layout')

// What the layout plugin listens for in a transaction's meta.
export interface LayoutMeta {
  meta?: DocMeta
  headingOffset?: number[]
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
    el.className = 'kt-label'
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

function buildDecorations(doc: PMNode, layout: DocLayout): DecorationSet {
  const decos: Decoration[] = []
  const byPos = new Map<number, BlockLayout>()
  for (const L of layout.blocks) byPos.set(L.pos, L)
  let tables = 0
  const visit = (node: PMNode, pos: number) => {
    const L = byPos.get(pos)
    if (!L) return
    if (node.type.name === 'table' || node.type.name === 'figure') {
      const attrs: Record<string, string> = { style: `margin-top:${L.gap}px;` }
      if (node.type.name === 'table') {
        tables += 1
        if (node.attrs.caption) attrs['data-caption'] = `Table ${tables}: ${node.attrs.caption}`
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
    const attrs: Record<string, string> = { style }
    if (L.number) {
      attrs['data-num'] = L.number
      attrs.class = `kt-numbered kt-num-${L.numberStyle}`
      attrs.style += `--kt-num-gap:${L.numberGap}px;`
    }
    if (node.type.name === 'raw_latex') {
      // _code_block_format / _bibliography_block_format / _raw_block_format.
      const t = node.textContent
      attrs.class = t.includes('\\begin{lstlisting}') || t.includes('\\begin{verbatim}') ? 'kt-raw-code'
        : t.includes('\\begin{thebibliography}') ? 'kt-raw-bib' : ''
    }
    if (L.breakBefore) attrs['data-break'] = '1'
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
  const compute = (doc: PMNode, m: DocMeta, off: number[]): LayoutPluginState => {
    const layout = layoutDocument(doc, m, off)
    return { meta: m, headingOffset: off, layout, decos: buildDecorations(doc, layout) }
  }
  return new Plugin<LayoutPluginState>({
    key: layoutKey,
    state: {
      init: (_c, state) => compute(state.doc, meta, [0, 0, 0, 0, 0, 0]),
      apply(tr, prev) {
        const m = tr.getMeta(layoutKey) as LayoutMeta | undefined
        if (!tr.docChanged && !m) return prev
        return compute(tr.doc, m?.meta ?? prev.meta, m?.headingOffset ?? prev.headingOffset)
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
  // Block-level (before a block) or inline (at a line start).
  block: boolean
}

interface PagesState { spacers: Spacer[]; decos: DecorationSet }

export const pagesKey = new PluginKey<PagesState>('kt-pages')

function spacerDecos(doc: PMNode, spacers: Spacer[]): DecorationSet {
  return DecorationSet.create(doc, spacers.map(s => Decoration.widget(s.pos, () => {
    const el = document.createElement(s.block ? 'div' : 'span')
    el.className = s.block ? 'kt-page-gap kt-page-gap-block' : 'kt-page-gap kt-page-gap-inline'
    el.contentEditable = 'false'
    if (s.height >= 0) el.style.height = `${s.height}px`
    else { el.style.height = '0px'; el.style.marginBottom = `${s.height}px` }
    return el
  }, { side: -1, ignoreSelection: true, key: `gap-${s.pos}-${s.block ? 'b' : 'i'}-${s.height.toFixed(2)}` })))
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
