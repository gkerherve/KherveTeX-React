// Commands for Insert ▸ Elements (checklist, progress bars, timeline, QR
// code, code listing: raw blocks holding their settings, core/widgets.ts)
// and the inline margin notes and drop caps. Each element, once selected,
// opens its own contextual ribbon tab (contextObject in commands.ts).
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, TextSelection, type EditorState } from 'prosemirror-state'
import {
  defaultWidgetText, dropCapLatex, marginNoteLatex, parseDropCap, parseMarginNote, parseWidget, widgetText,
  type DropCap, type MarginNote, type Widget, type WidgetData, type WidgetKind,
} from '../core/widgets.ts'
import type { Command } from './commands.ts'
import { schema } from './schema.ts'

const N = schema.nodes

export interface WidgetAt { pos: number; node: PMNode; widget: Widget }

// The element selected (or holding the caret in its hidden LaTeX).
export function currentWidget(state: EditorState): WidgetAt | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === N.raw_latex) {
    const w = parseWidget(sel.node.textContent)
    return w ? { pos: sel.from, node: sel.node, widget: w } : null
  }
  const $p = sel.$from
  if ($p.parent.type === N.raw_latex && $p.depth >= 1) {
    const w = parseWidget($p.parent.textContent)
    if (w) return { pos: $p.before(), node: $p.parent, widget: w }
  }
  return null
}

// Insert an element with its example settings, selected.
export function insertWidget(kind: WidgetKind): Command {
  return (state, dispatch) => {
    const node = N.raw_latex.create(null, schema.text(defaultWidgetText(kind)))
    const sel = state.selection
    const $p = sel.$from
    let tr = state.tr
    let at: number
    if (sel instanceof NodeSelection && $p.depth === 0) at = sel.to
    else if ($p.depth === 0) at = $p.pos
    else {
      const top = $p.node(1)
      const topPos = $p.before(1)
      if (top.type === N.paragraph && top.content.size === 0) {
        tr = tr.delete(topPos, topPos + top.nodeSize)
        at = topPos
      } else if ($p.depth === 1 && $p.parent.isTextblock && $p.parentOffset === 0) at = topPos
      else at = topPos + top.nodeSize
    }
    if (!dispatch) return true
    tr = tr.insert(at, node)
    // Somewhere to type after it.
    const after = at + node.nodeSize
    const next = tr.doc.resolve(after).nodeAfter
    if (!next || !next.isTextblock) tr = tr.insert(after, N.paragraph.create({ alignment: 'justify' }))
    tr = tr.setSelection(NodeSelection.create(tr.doc, at))
    dispatch(tr.scrollIntoView())
    return true
  }
}

// Change the selected element's settings; it stays selected.
export function updateWidget<K extends WidgetKind>(fn: (data: WidgetData[K], kind: K) => WidgetData[K] | void): Command {
  return (state, dispatch) => {
    const w = currentWidget(state)
    if (!w) return false
    const data = structuredClone(w.widget.data) as WidgetData[K]
    const next = fn(data, w.widget.kind as K) ?? data
    if (dispatch) {
      const node = N.raw_latex.create(w.node.attrs, schema.text(widgetText(w.widget.kind as K, next)))
      const tr = state.tr.replaceWith(w.pos, w.pos + w.node.nodeSize, node)
      tr.setSelection(NodeSelection.create(tr.doc, w.pos))
      dispatch(tr)
    }
    return true
  }
}

// Select the element at pos (a click on its drawing).
export function selectBlockAt(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (!node) return false
    if (dispatch) dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
    return true
  }
}

export function deleteBlockAt(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos)
    if (!node) return false
    if (dispatch) {
      const tr = state.tr.delete(pos, pos + node.nodeSize)
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// ---------- inline: margin notes and drop caps ----------

export type InlineSpecial = { kind: 'marginnote'; pos: number; note: MarginNote } | { kind: 'dropcap'; pos: number; cap: DropCap }

export function currentInlineSpecial(state: EditorState): InlineSpecial | null {
  const sel = state.selection
  if (!(sel instanceof NodeSelection) || sel.node.type !== N.inline_raw) return null
  const latex: string = sel.node.attrs.latex
  const note = parseMarginNote(latex)
  if (note) return { kind: 'marginnote', pos: sel.from, note }
  const cap = parseDropCap(latex)
  if (cap) return { kind: 'dropcap', pos: sel.from, cap }
  return null
}

// Replace the selected inline's LaTeX; it stays selected.
function setInlineLatex(pos: number, latex: string): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, undefined, { latex })
      tr.setSelection(NodeSelection.create(tr.doc, pos))
      dispatch(tr)
    }
    return true
  }
}

export function updateMarginNote(fn: (n: MarginNote) => void): Command {
  return (state, dispatch) => {
    const s = currentInlineSpecial(state)
    if (s?.kind !== 'marginnote') return false
    const n = { ...s.note }
    fn(n)
    return setInlineLatex(s.pos, marginNoteLatex(n))(state, dispatch)
  }
}

export function updateDropCap(fn: (d: DropCap) => void): Command {
  return (state, dispatch) => {
    const s = currentInlineSpecial(state)
    if (s?.kind !== 'dropcap') return false
    const d = { ...s.cap }
    fn(d)
    return setInlineLatex(s.pos, dropCapLatex(d))(state, dispatch)
  }
}

// A margin note at the caret (after the selection), selected.
export function insertMarginNote(note: MarginNote): Command {
  return (state, dispatch) => {
    const $p = state.selection.$to
    if (!$p.parent.inlineContent || $p.parent.type === N.raw_latex) return false
    if (dispatch) {
      const at = state.selection.to
      const tr = state.tr.insert(at, N.inline_raw.create({ latex: marginNoteLatex(note) }))
      tr.setSelection(NodeSelection.create(tr.doc, at))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// A drop cap from the first word of the caret's paragraph.
export function insertDropCap(color = '000000'): Command {
  return (state, dispatch) => {
    const $p = state.selection.$from
    const para = $p.parent
    if (para.type !== N.paragraph || $p.depth < 1) return false
    const start = $p.start()
    const first = para.firstChild
    if (!first?.isText) return false
    const m = /^\s*(\S)(\S*)/u.exec(first.text!)
    if (!m) return false
    if (dispatch) {
      const lead = m[0].length - m[1].length - m[2].length
      const cap: DropCap = { lines: 3, letter: m[1], rest: m[2], color, margin: false, smallcaps: true }
      const tr = state.tr.replaceWith(start + lead, start + m[0].length, N.inline_raw.create({ latex: dropCapLatex(cap) }))
      tr.setSelection(NodeSelection.create(tr.doc, start + lead))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// The drop cap back to plain text.
export const removeDropCap: Command = (state, dispatch) => {
  const s = currentInlineSpecial(state)
  if (s?.kind !== 'dropcap') return false
  if (dispatch) {
    const text = s.cap.letter + s.cap.rest
    const tr = state.tr.replaceWith(s.pos, s.pos + 1, schema.text(text))
    tr.setSelection(TextSelection.create(tr.doc, s.pos + text.length))
    dispatch(tr)
  }
  return true
}

// Delete the selected element, note or drop cap.
export const deleteSpecial: Command = (state, dispatch) => {
  const w = currentWidget(state)
  if (w) return deleteBlockAt(w.pos)(state, dispatch)
  const s = currentInlineSpecial(state)
  if (s?.kind === 'dropcap') return removeDropCap(state, dispatch)
  if (s) {
    if (dispatch) dispatch(state.tr.delete(s.pos, s.pos + 1))
    return true
  }
  return false
}

// Close: the caret after the element, so its tab goes away.
export const leaveSpecial: Command = (state, dispatch) => {
  const w = currentWidget(state)
  if (w) {
    const after = w.pos + w.node.nodeSize
    if (dispatch) {
      let tr = state.tr
      const next = tr.doc.resolve(after).nodeAfter
      if (!next || !next.isTextblock) tr = tr.insert(after, N.paragraph.create({ alignment: 'justify' }))
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
  const s = currentInlineSpecial(state)
  if (s) {
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, s.pos + 1)))
    return true
  }
  return false
}

// The tab's checked buttons, from the selected element's settings.
export function syncElementChecks(state: EditorState, check: (id: string, on: boolean) => void): void {
  const w = currentWidget(state)
  if (w) {
    const d = w.widget.data as unknown as Record<string, unknown>
    switch (w.widget.kind) {
      case 'checklist':
        check(d.style === 'circle' ? 'ck_circle' : 'ck_box', true)
        check(`ck_cols_${d.columns || 1}`, true)
        check('ck_grey', !!d.grey_done)
        break
      case 'progress':
        check(`pg_${d.style}`, true)
        check(`pg_${d.length}`, true)
        check('pg_percent', !!d.percent)
        break
      case 'timeline': check(`tl_${d.layout}`, true); break
      case 'qrcode':
        check(Number(d.size) <= 2 ? 'qr_small' : Number(d.size) >= 4.5 ? 'qr_large' : 'qr_medium', true)
        check(`qr_${d.align}`, true)
        break
      case 'code':
        check(`cd_${d.theme}`, true)
        check('cd_numbers', !!d.numbers)
        check('cd_frame', !!d.frame)
        break
    }
    return
  }
  const sp = currentInlineSpecial(state)
  if (sp?.kind === 'marginnote') check(`mn_${sp.note.style}`, true)
  if (sp?.kind === 'dropcap') {
    check(`dc_lines_${sp.cap.lines}`, true)
    check(sp.cap.margin ? 'dc_margin' : 'dc_dropped', true)
    check('dc_smallcaps', sp.cap.smallcaps)
  }
}
