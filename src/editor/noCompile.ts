// Do not compile: the paragraphs (or any blocks) the selection covers are
// left out of the preview, between the not-compile markers (RawLatex
// lines the compiler wraps in \iffalse...\fi); the editor greys them.
// The same command on hidden blocks brings them back. Export compiles
// everything.
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
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
