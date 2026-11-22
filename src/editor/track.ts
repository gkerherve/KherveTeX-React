// Track Changes (Review ▸ Track Changes), as Word keeps them: while it is
// on, typed text carries an insertion mark and deleted text stays, struck
// through, with a deletion mark; each with its author and time. Accept or
// Reject settles them. The marks are model marks 'ins:' / 'del:'
// (serializer: \added / \deleted of the changes package).
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model'
import { schema } from './schema.ts'
import type { Command } from './commands.ts'

let tracking = false
let author = ''
let authorSource: (() => string) | null = null
export function setTracking(on: boolean): void { tracking = on }
export function isTracking(): boolean { return tracking }
export function setTrackAuthor(name: string): void { author = name }
// Where the name comes from (Settings ▸ Your name), read at each change.
export function setTrackAuthorSource(f: () => string): void { authorSource = f }

const SKIP = 'kt-track-skip'
export const trackKey = new PluginKey('kt-track')

const now = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Text-only content of a slice inside one textblock, or null (a deletion
// across paragraphs or of a table is not tracked).
function inlineContent(content: Fragment, openStart: number, openEnd: number): Fragment | null {
  if (openStart === 0 && openEnd === 0) return content.childCount && content.firstChild!.isInline ? content : (content.size === 0 ? content : null)
  if (openStart === 1 && openEnd === 1 && content.childCount === 1 && content.firstChild!.isTextblock) return content.firstChild!.content
  return null
}

export function trackPlugin(): Plugin {
  return new Plugin({
    key: trackKey,
    appendTransaction(trs, oldState, newState) {
      if (!tracking) return null
      const user = trs.filter(t => t.docChanged && !t.getMeta(SKIP) && !t.getMeta('kt-remote') && t.getMeta('addToHistory') !== false)
      if (!user.length || user.length !== trs.filter(t => t.docChanged).length) return null
      const ins = schema.marks.trackins, del = schema.marks.trackdel
      const time = now()
      const who = authorSource?.() || author || 'Author'
      // Inserted ranges and deleted pieces, in the final document.
      const inserted: [number, number][] = []
      const deleted: { pos: number; content: Fragment }[] = []
      let backspace = false, forward = false
      trs.forEach((tr, ti) => {
        if (!tr.docChanged) return
        const later = (pos: number, assoc: number, fromStep: number) => {
          let p = tr.mapping.slice(fromStep).map(pos, assoc)
          for (const t of trs.slice(ti + 1)) p = t.mapping.map(p, assoc)
          return p
        }
        tr.steps.forEach((step, si) => {
          if (!(step instanceof ReplaceStep)) return
          const { from, to, slice } = step as unknown as { from: number; to: number; slice: import('prosemirror-model').Slice }
          const before = tr.docs[si]
          if (slice.size) {
            const a = later(from, -1, si + 1)
            const b = later(from + slice.size, 1, si + 1)
            if (b > a) inserted.push([a, b])
          }
          if (to > from) {
            const sl = before.slice(from, to)
            const inline = inlineContent(sl.content, sl.openStart, sl.openEnd)
            if (!inline) return
            // One's own (or anyone's) insertion deleted is simply gone, as in Word.
            const kept: PMNode[] = []
            inline.forEach(n => { if (!n.marks.some(m => m.type === ins)) kept.push(n) })
            if (!kept.length) return
            deleted.push({ pos: later(from, -1, si + 1), content: Fragment.fromArray(kept) })
            const sel = ti === 0 ? oldState.selection : trs[ti - 1].selection
            if (sel.empty && sel.head === to) backspace = true
            if (sel.empty && sel.head === from) forward = true
          }
        })
      })
      if (!inserted.length && !deleted.length) return null
      const tr = newState.tr.setMeta(SKIP, true)
      for (const [a, b] of inserted) {
        tr.removeMark(a, b, del)
        tr.addMark(a, b, ins.create({ author: who, time }))
      }
      // Deleted text goes back, struck through, before what replaced it.
      let caret: number | null = null
      for (const d of [...deleted].sort((x, y) => y.pos - x.pos)) {
        const nodes: PMNode[] = []
        d.content.forEach(n => {
          const has = n.marks.find(m => m.type === del)
          nodes.push(has ? n : n.mark(del.create({ author: who, time }).addToSet(n.marks)))
        })
        const frag = Fragment.fromArray(nodes)
        const at = tr.mapping.map(d.pos, -1)
        tr.insert(at, frag)
        if (backspace) caret = at
        else if (forward) caret = at + frag.size
      }
      if (caret !== null) tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)))
      return tr
    },
  })
}

// ---------- accept / reject ----------

type Change = { from: number; to: number; kind: 'ins' | 'del' }

function changesIn(doc: PMNode, from: number, to: number): Change[] {
  const out: Change[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    for (const m of node.marks) {
      const kind = m.type === schema.marks.trackins ? 'ins' : m.type === schema.marks.trackdel ? 'del' : null
      if (kind) out.push({ from: Math.max(pos, from), to: Math.min(pos + node.nodeSize, to), kind })
    }
    return false
  })
  return out
}

// The change at the caret: the run of text carrying its mark.
function changeAt(state: EditorState): { from: number; to: number } | null {
  const $p = state.selection.$from
  const marks = [...($p.nodeAfter?.marks ?? []), ...($p.nodeBefore?.marks ?? [])]
  const m: Mark | undefined = marks.find(x => x.type === schema.marks.trackins || x.type === schema.marks.trackdel)
  if (!m) return null
  const start = $p.start()
  let from = -1, to = -1
  $p.parent.forEach((child, offset) => {
    const a = start + offset, b = a + child.nodeSize
    if (m.isInSet(child.marks)) { if (from < 0 || a < from) from = a; if (b > to) to = b }
  })
  return from < 0 ? null : { from, to }
}

function settle(accept: boolean, all: boolean): Command {
  return (state, dispatch) => {
    let range: { from: number; to: number } | null
    if (all) range = { from: 0, to: state.doc.content.size }
    else if (!state.selection.empty) range = { from: state.selection.from, to: state.selection.to }
    else range = changeAt(state)
    if (!range) return false
    const changes = changesIn(state.doc, range.from, range.to)
    if (!changes.length) return false
    if (!dispatch) return true
    const tr = state.tr.setMeta(SKIP, true)
    // From the end, so positions hold.
    for (const c of changes.sort((a, b) => b.from - a.from)) {
      const goes = (c.kind === 'ins') !== accept   // reject an insertion, accept a deletion: the text goes
      if (goes) tr.delete(c.from, c.to)
      else tr.removeMark(c.from, c.to, c.kind === 'ins' ? schema.marks.trackins : schema.marks.trackdel)
    }
    dispatch(tr.scrollIntoView())
    return true
  }
}
export const acceptChange = settle(true, false)
export const rejectChange = settle(false, false)
export const acceptAllChanges = settle(true, true)
export const rejectAllChanges = settle(false, true)

// Next / Previous change from the caret.
export function gotoChange(forward: boolean): Command {
  return (state, dispatch) => {
    const all = changesIn(state.doc, 0, state.doc.content.size).sort((a, b) => a.from - b.from)
    const here = forward ? state.selection.to : state.selection.from
    const c = forward ? all.find(x => x.from >= here) ?? all[0] : [...all].reverse().find(x => x.to <= here) ?? all[all.length - 1]
    if (!c) return false
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, c.from, c.to)).scrollIntoView())
    return true
  }
}

export function hasChanges(state: EditorState): boolean {
  return changesIn(state.doc, 0, state.doc.content.size).length > 0
}

export type { Transaction }
