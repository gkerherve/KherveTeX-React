// Do not compile: the paragraphs (or any blocks) the selection covers are
// left out of the preview, between the not-compile markers (RawLatex
// lines the compiler wraps in \iffalse...\fi); the editor greys them.
// The same command on hidden blocks brings them back. Export compiles
// everything.
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { NOT_COMPILE_END, NOT_COMPILE_START } from '../core/compiler.ts'
import * as M from '../core/model.ts'
import { blockToPM } from './convert.ts'

export const isNcStart = (n: PMNode) => n.type.name === 'raw_latex' && n.textContent.trim() === NOT_COMPILE_START
export const isNcEnd = (n: PMNode) => n.type.name === 'raw_latex' && n.textContent.trim() === NOT_COMPILE_END

export interface Top { node: PMNode; pos: number; marker: 'start' | 'end' | null; hidden: boolean; paired: boolean }

// The document's top-level blocks: which are markers, which are hidden.
// A start pairs with the next end, as the compiler pairs them.
export function topBlocks(doc: PMNode): Top[] {
  const out: Top[] = []
  doc.forEach((node, pos) => out.push({ node, pos, marker: isNcStart(node) ? 'start' : isNcEnd(node) ? 'end' : null, hidden: false, paired: false }))
  for (let i = 0; i < out.length; i++) {
    if (out[i].marker !== 'start') continue
    const j = out.findIndex((t, k) => k > i && t.marker === 'end' && !t.paired)
    if (j < 0) continue
    out[i].paired = out[j].paired = true
    for (let k = i + 1; k < j; k++) if (!out[k].marker) out[k].hidden = true
    i = j
  }
  return out
}

function selectedRange(state: EditorState, tops: Top[]): [number, number] {
  const { from, to } = state.selection
  let a = tops.findIndex(t => t.pos + t.node.nodeSize > from)
  let b = -1
  for (let i = tops.length - 1; i >= 0; i--) if (tops[i].pos < Math.max(to, from + 1)) { b = i; break }
  if (a < 0) a = tops.length - 1
  if (b < a) b = a
  return [a, b]
}

// Is the caret, or all of the selection, in a part left out?
export function selectionHidden(state: EditorState): boolean {
  const tops = topBlocks(state.doc)
  const [a, b] = selectedRange(state, tops)
  const content = tops.slice(a, b + 1).filter(t => !t.marker)
  return content.length > 0 && content.every(t => t.hidden)
}

// The hidden part that starts at this marker, compiled again: its two
// markers go (the box's button).
export function compileAgainAt(startPos: number) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const tops = topBlocks(state.doc)
    const i = tops.findIndex(t => t.pos === startPos && t.marker === 'start' && t.paired)
    if (i < 0) return false
    const j = tops.findIndex((t, k) => k > i && t.marker === 'end')
    if (j < 0) return false
    if (dispatch) {
      const tr = state.tr.delete(tops[j].pos, tops[j].pos + tops[j].node.nodeSize).delete(tops[i].pos, tops[i].pos + tops[i].node.nodeSize)
      dispatch(tr)
    }
    return true
  }
}

export function toggleNoCompile(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const tops = topBlocks(state.doc)
  if (!tops.length) return false
  const [a, b] = selectedRange(state, tops)
  const content = tops.slice(a, b + 1).filter(t => !t.marker)
  if (!content.length) return false
  if (!dispatch) return true
  const tr = setCompiled(state, tops, from => from >= tops[a].pos && from <= tops[b].pos, content.every(t => t.hidden))
  dispatch(tr.scrollIntoView())
  return true
}

// Compile (on) or leave out (off) the top-level blocks whose position
// `which` picks: markers again around each run of hidden blocks (the
// paired ones go, new ones are put at the edges of the runs).
export function setCompiled(state: EditorState, tops: Top[], which: (pos: number) => boolean, on: boolean): Transaction {
  for (const t of tops) if (!t.marker && which(t.pos)) t.hidden = !on
  const tr = state.tr
  const blocks = tops.filter(t => !(t.marker && t.paired))
  const inserts: { pos: number; text: string }[] = []
  for (let i = 0; i < blocks.length; i++) {
    const t = blocks[i]
    if (t.marker || !t.hidden) continue
    const prevHidden = i > 0 && !blocks[i - 1].marker && blocks[i - 1].hidden
    const nextHidden = i + 1 < blocks.length && !blocks[i + 1].marker && blocks[i + 1].hidden
    if (!prevHidden) inserts.push({ pos: t.pos, text: NOT_COMPILE_START })
    if (!nextHidden) inserts.push({ pos: t.pos + t.node.nodeSize, text: NOT_COMPILE_END })
  }
  for (const t of [...tops].reverse()) if (t.marker && t.paired) tr.delete(t.pos, t.pos + t.node.nodeSize)
  for (const ins of inserts) {
    tr.insert(tr.mapping.map(ins.pos, ins.text === NOT_COMPILE_START ? -1 : 1), blockToPM(M.rawLatex(ins.text)))
  }
  return tr
}

// ------------------------------------------------- folded while left out

// A part left out of the compile is folded to its label bar - a line of
// what it holds - so the page around it is laid out as the PDF prints it
// (without it). Show opens it to read or edit (the caret going into it
// opens it too); Hide folds it again.
interface FoldState { open: number[]; decos: DecorationSet }
const ncFoldKey = new PluginKey<FoldState>('kt-nc-fold')

// The paired parts: their start marker, the blocks between, the end marker.
function parts(doc: PMNode): { start: Top; end: Top; inner: Top[] }[] {
  const tops = topBlocks(doc)
  const out: { start: Top; end: Top; inner: Top[] }[] = []
  for (let i = 0; i < tops.length; i++) {
    if (tops[i].marker !== 'start' || !tops[i].paired) continue
    const j = tops.findIndex((t, k) => k > i && t.marker === 'end' && t.paired)
    if (j < 0) continue
    out.push({ start: tops[i], end: tops[j], inner: tops.slice(i + 1, j) })
    i = j
  }
  return out
}

function summary(inner: Top[]): string {
  let p = 0, eq = 0, fig = 0, tab = 0, other = 0
  let title = ''
  for (const t of inner) {
    const n = t.node.type.name
    if (n === 'section' && !title) title = t.node.textContent.trim()
    else if (n === 'paragraph') { if (t.node.textContent.trim()) p++ } else if (n === 'math_block') eq++
    else if (n === 'figure') fig++
    else if (n === 'table') tab++
    else if (n !== 'section') other++
  }
  if (!title) {
    const first = inner.find(t => t.node.textContent.trim())
    const text = first?.node.textContent.trim() ?? ''
    // A run-in heading ("Thermal Programmed Desorption (TPD).") or the first words.
    const head = /^(.{4,80}?[.:])\s/.exec(text)?.[1]
    title = head ?? (text.length > 60 ? text.slice(0, 60) + '…' : text)
  }
  const n = (k: number, one: string) => (k ? `${k} ${one}${k > 1 ? 's' : ''}` : '')
  const what = [n(p, 'paragraph'), n(eq, 'equation'), n(fig, 'figure'), n(tab, 'table'), n(other, 'block')].filter(Boolean).join(', ')
  return [title, what].filter(Boolean).join(' · ')
}

function foldDecos(doc: PMNode, open: number[]): DecorationSet {
  const decos: Decoration[] = []
  for (const { start, inner } of parts(doc)) {
    const isOpen = open.includes(start.pos)
    if (!isOpen) for (const t of inner) decos.push(Decoration.node(t.pos, t.pos + t.node.nodeSize, { class: 'kt-folded kt-nc-folded' }))
    const at = start.pos
    decos.push(Decoration.widget(at + start.node.nodeSize, view => {
      const bar = document.createElement('div')
      bar.className = 'kt-nc-fold' + (isOpen ? ' open' : '')
      bar.contentEditable = 'false'
      if (!isOpen) {
        const s = document.createElement('span')
        s.className = 'kt-nc-sum'
        s.textContent = summary(inner)
        bar.appendChild(s)
      }
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'kt-nc-toggle'
      b.textContent = isOpen ? 'Hide' : 'Show'
      b.title = isOpen ? 'Fold this part away again: the page is then laid out as the PDF prints it' : 'Open this part to read or edit it (it stays out of the PDF)'
      b.addEventListener('mousedown', ev => {
        ev.preventDefault()
        ev.stopPropagation()
        view.dispatch(view.state.tr.setMeta(ncFoldKey, { toggle: at }))
      })
      bar.appendChild(b)
      return bar
    }, { side: -1, key: `nc-fold:${at}:${isOpen}:${isOpen ? '' : summary(inner)}`, ignoreSelection: true }))
  }
  return DecorationSet.create(doc, decos)
}

// Show or hide every part left out (the right-click menu).
export function setAllNcOpen(open: boolean) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    if (!parts(state.doc).length) return false
    dispatch?.(state.tr.setMeta(ncFoldKey, { all: open }))
    return true
  }
}

export function anyNcPart(state: EditorState): { any: boolean; allOpen: boolean } {
  const ps = parts(state.doc)
  const open = ncFoldKey.getState(state)?.open ?? []
  return { any: ps.length > 0, allOpen: ps.length > 0 && ps.every(p => open.includes(p.start.pos)) }
}

export function ncFoldPlugin(): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: ncFoldKey,
    state: {
      init: (_c, s) => ({ open: [], decos: foldDecos(s.doc, []) }),
      apply: (tr, prev, _old, s) => {
        let open = tr.docChanged ? prev.open.map(p => tr.mapping.map(p, 1)) : prev.open
        const m = tr.getMeta(ncFoldKey) as { toggle?: number; all?: boolean } | undefined
        if (m?.toggle !== undefined) open = open.includes(m.toggle) ? open.filter(p => p !== m.toggle) : [...open, m.toggle]
        if (m?.all !== undefined) open = m.all ? parts(s.doc).map(p => p.start.pos) : []
        // The caret gone into a folded part: it opens.
        if (tr.selectionSet) {
          const h = s.selection.head
          for (const p of parts(s.doc)) {
            if (!open.includes(p.start.pos) && h > p.start.pos + p.start.node.nodeSize && h < p.end.pos) open = [...open, p.start.pos]
          }
        }
        const starts = new Set(parts(s.doc).map(p => p.start.pos))
        open = open.filter(p => starts.has(p))
        const same = open.length === prev.open.length && open.every((p, i) => p === prev.open[i])
        if (same && !tr.docChanged) return prev
        return { open, decos: foldDecos(s.doc, open) }
      },
    },
    props: { decorations: s => ncFoldKey.getState(s)?.decos },
    // The text changed under the caret into a folded part (Do not compile
    // on the caret's paragraph): the caret goes past it, never typing
    // into what is hidden.
    appendTransaction: (trs, _old, s) => {
      if (!trs.some(t => t.docChanged) || trs.some(t => t.selectionSet)) return null
      const open = ncFoldKey.getState(s)?.open ?? []
      const h = s.selection.head
      for (const p of parts(s.doc)) {
        if (open.includes(p.start.pos) || h <= p.start.pos || h >= p.end.pos + p.end.node.nodeSize) continue
        const after = Math.min(p.end.pos + p.end.node.nodeSize, s.doc.content.size)
        return s.tr.setSelection(TextSelection.near(s.doc.resolve(after), 1)).setMeta('addToHistory', false)
      }
      return null
    },
  })
}
