// Captions and labels in the open document: what References ▸ Captions &
// labels and the Cross-reference dialog change. Each item is found by its
// place among the document's blocks (the editor has one top-level node per
// block of the model, core/labels.referables gives the place).
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { makeLabel, referables, takenLabels, type Referable } from '../core/labels.ts'
import { docFromPM } from '../editor/convert.ts'
import { editor } from '../editor/controller.ts'
import { appStore } from './store.ts'

// The document as the editor has it now (the store's copy can lag a
// keystroke behind).
function liveDoc() {
  const e = editor()
  if (!e) return null
  return docFromPM(e.view.state.doc, appStore().get().doc.meta)
}

export function currentReferables(): Referable[] {
  const doc = liveDoc()
  return doc ? referables(doc) : []
}

// The top-level node at `index`: its position and node.
function blockAt(index: number): { pos: number; node: PMNode } | null {
  const e = editor()
  if (!e) return null
  let pos = 0
  const doc = e.view.state.doc
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i)
    if (i === index) return { pos, node }
    pos += node.nodeSize
  }
  return null
}

// Change an item's caption and label; references to its old label follow
// the new one, so none is left pointing nowhere.
export function setCaptionAndLabel(index: number, caption: string | null, label: string | null): boolean {
  const e = editor()
  const at = blockAt(index)
  if (!e || !at) return false
  const old = (at.node.attrs.label as string | null) || null
  const attrs: Record<string, unknown> = { ...at.node.attrs, label: label || null }
  if (caption !== null && 'caption' in at.node.attrs) attrs.caption = caption
  const tr = e.view.state.tr.setNodeMarkup(at.pos, null, attrs)
  if (old && label && old !== label) {
    tr.doc.descendants((n, p) => {
      if (n.type.name === 'crossref' && n.attrs.label === old) tr.setNodeMarkup(p, null, { ...n.attrs, label })
    })
  }
  e.view.dispatch(tr)
  e.syncToolbar()
  return true
}

// References to label `old` now point to `label` (a label renamed in the
// caption dialog).
export function renameReferences(old: string, label: string): void {
  const e = editor()
  if (!e || !old || !label || old === label) return
  const tr = e.view.state.tr
  tr.doc.descendants((n, p) => {
    if (n.type.name === 'crossref' && n.attrs.label === old) tr.setNodeMarkup(p, null, { ...n.attrs, label })
  })
  if (tr.docChanged) e.view.dispatch(tr)
}

// The item's label, made and set now when it has none (a cross-reference
// to it needs one).
export function ensureLabel(r: Referable): string {
  if (r.label) return r.label
  const doc = liveDoc()
  const label = makeLabel(r.kind, r.caption ?? r.text, doc ? takenLabels(doc) : new Set())
  setCaptionAndLabel(r.index, null, label)
  return label
}

// A label for a caption that has none: what the caption action gives a
// new caption, so it can be cross-referenced at once.
export function labelForCaption(kind: 'figure' | 'table', caption: string): string {
  const doc = liveDoc()
  return makeLabel(kind, caption, doc ? takenLabels(doc) : new Set())
}

// Show an item: the figure, table or equation selected, the caret in the
// heading, scrolled into view.
export function goTo(index: number): void {
  const e = editor()
  const at = blockAt(index)
  if (!e || !at) return
  const s = e.view.state
  const sel = at.node.isAtom ? NodeSelection.create(s.doc, at.pos) : TextSelection.near(s.doc.resolve(at.pos + 1))
  e.view.dispatch(s.tr.setSelection(sel).scrollIntoView())
  const dom = e.view.nodeDOM(at.pos) as HTMLElement | null
  dom?.scrollIntoView?.({ block: 'center' })
}
