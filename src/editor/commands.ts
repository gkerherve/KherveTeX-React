// The editing commands of DocumentEditor (editor.py) as ProseMirror
// commands: paragraph styles, marks, alignment, lists, theorems, tables,
// figures, equations, raw blocks, highlights and comments. Each takes the
// state and an optional dispatch, so they run in tests without a view.
import { Fragment, type Mark, type MarkType, type Node as PMNode, type NodeType, type ResolvedPos } from 'prosemirror-model'
import { AllSelection, EditorState, NodeSelection, Selection, TextSelection, type Transaction } from 'prosemirror-state'
import { CellSelection, TableMap, addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn,
  deleteRow, deleteTable, selectedRect, splitCell } from 'prosemirror-tables'
import * as M from '../core/model.ts'
import { blockToPM, cellDisplayText, newGid } from './convert.ts'
import { mathBlockIsNumbered } from './layout.ts'
import { STYLED_TEXT, schema } from './schema.ts'
import { columnSpecTokens, parseColumnSpec } from './views.ts'

export type Dispatch = (tr: Transaction) => void
export type Command = (state: EditorState, dispatch?: Dispatch) => boolean

const N = schema.nodes

// ---------- where the caret is ----------

export interface Here {
  // The text block the caret is in (paragraph, heading, list item, cell...).
  block: PMNode | null
  blockPos: number
  // The top-level block holding the caret, and its position.
  top: PMNode | null
  topPos: number
}

export function here(state: EditorState): Here {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.$from.depth === 0) {
    return { block: null, blockPos: -1, top: sel.node, topPos: sel.from }
  }
  const $p = sel.$from
  const top = $p.depth >= 1 ? $p.node(1) : null
  const topPos = $p.depth >= 1 ? $p.before(1) : -1
  const block = $p.parent.isTextblock ? $p.parent : null
  const blockPos = block && $p.depth >= 1 ? $p.before($p.depth) : -1
  return { block, blockPos, top, topPos }
}

function inTable($p: ResolvedPos): { table: PMNode; pos: number } | null {
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type === N.table) return { table: $p.node(d), pos: $p.before(d) }
  }
  return null
}

export function currentTable(state: EditorState): { table: PMNode; pos: number } | null {
  return inTable(state.selection.$from)
}

export function currentFigure(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === N.figure) return { node: sel.node, pos: sel.from }
  return null
}

export function currentMathBlock(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === N.math_block) return { node: sel.node, pos: sel.from }
  return null
}

// The inline equation selected or right beside the caret (_has_math_at).
export function currentMathInline(state: EditorState): { node: PMNode; pos: number } | null {
  const sel = state.selection
  if (sel instanceof NodeSelection && sel.node.type === N.math_inline) return { node: sel.node, pos: sel.from }
  if (!sel.empty) return null
  const $p = sel.$from
  if ($p.nodeAfter?.type === N.math_inline) return { node: $p.nodeAfter, pos: $p.pos }
  if ($p.nodeBefore?.type === N.math_inline) return { node: $p.nodeBefore, pos: $p.pos - $p.nodeBefore.nodeSize }
  return null
}

export function currentTheorem(state: EditorState): { node: PMNode; pos: number } | null {
  const h = here(state)
  if (h.block?.type === N.theorem) return { node: h.block, pos: h.blockPos }
  return null
}

// "table", "figure", "equation", "theorem" or null (context_object).
export function contextObject(state: EditorState): 'table' | 'figure' | 'equation' | 'theorem' | null {
  if (currentFigure(state)) return 'figure'
  if (currentTable(state)) return 'table'
  if (currentMathBlock(state) || currentMathInline(state)) return 'equation'
  if (currentTheorem(state)) return 'theorem'
  return null
}

export function selectAllSelection(state: EditorState): Selection {
  return new AllSelection(state.doc)
}

// ---------- paragraph styles (apply_heading) ----------

// Style code of a text block: -1 Title, -2 Author, -3 Abstract, -4
// Keywords, -5 Chapter, -6 Frame, -7 Affiliation, -8 Correspondence,
// 0 Body, 1..5 Heading; -99 for anything else (current_heading_level).
export function headingCode(node: PMNode | null): number {
  if (!node) return -99
  switch (node.type.name) {
    case 'title': return -1
    case 'author': return -2
    case 'abstract': return -3
    case 'keywords': return -4
    case 'frame': return -6
    case 'affiliation': return -7
    case 'correspondence': return -8
    case 'paragraph': return 0
    case 'section': return node.attrs.level === 0 ? -5 : node.attrs.level
  }
  return -99
}

export function currentHeadingLevel(state: EditorState): number {
  return headingCode(here(state).block)
}

const CODE_TYPES: Record<number, string> = {
  [-1]: 'title', [-2]: 'author', [-3]: 'abstract', [-4]: 'keywords', [-6]: 'frame',
  [-7]: 'affiliation', [-8]: 'correspondence',
}

export function typeForCode(code: number): { type: NodeType; attrs: Record<string, unknown> } {
  if (code === 0) return { type: N.paragraph, attrs: { alignment: 'justify' } }
  if (code === -5) return { type: N.section, attrs: { level: 0, numbered: true, label: null } }
  if (code >= 1) return { type: N.section, attrs: { level: code, numbered: true, label: null } }
  return { type: N[CODE_TYPES[code]], attrs: {} }
}

// Give the caret's line paragraph style `code`. A heading keeps its label
// and its starred form when it only changes level, as the user state does.
export function applyHeading(code: number, keepNumbered = false): Command {
  return (state, dispatch) => {
    const h = here(state)
    const block = h.block
    if (!block || !STYLED_TEXT.has(block.type.name)) return false
    if (inTable(state.selection.$from)) return false
    const { type, attrs } = typeForCode(code)
    const a = { ...attrs }
    if (type === N.section && block.type === N.section) {
      a.label = block.attrs.label
      if (keepNumbered) a.numbered = block.attrs.numbered
    }
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(h.blockPos, type, a)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export function isHeadingNumbered(state: EditorState): boolean {
  const b = here(state).block
  return !(b?.type === N.section && !b.attrs.numbered)
}

export function toggleHeadingNumbered(numbered: boolean): Command {
  return (state, dispatch) => {
    const h = here(state)
    if (h.block?.type !== N.section) return false
    if (dispatch) dispatch(state.tr.setNodeMarkup(h.blockPos, null, { ...h.block.attrs, numbered }))
    return true
  }
}

// ---------- alignment ----------

export function currentAlignment(state: EditorState): string {
  const f = currentFigure(state)
  if (f) return f.node.attrs.align || 'center'
  const b = here(state).block
  if (!b) return 'justify'
  if (b.type === N.paragraph) return b.attrs.alignment
  if (['title', 'author', 'affiliation', 'correspondence'].includes(b.type.name)) return 'center'
  return 'justify'
}

export function applyAlignment(name: string): Command {
  return (state, dispatch) => {
    const f = currentFigure(state)
    if (f) return setFigureAttrs({ align: name === 'justify' ? 'center' : name })(state, dispatch)
    const { from, to } = state.selection
    const tr = state.tr
    let any = false
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === N.paragraph) {
        tr.setNodeMarkup(pos, null, { ...node.attrs, alignment: name })
        any = true
      }
      return !node.isTextblock
    })
    if (any && dispatch) dispatch(tr)
    return any
  }
}

// ---------- marks ----------

export const MARK_FOR_COMMAND: Record<string, string> = {
  bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough',
  code: 'code', smallcaps: 'smallcaps', sub: 'subscript', super: 'superscript',
}

function markIn(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

// is_mark_active: the caret's character format.
export function isMarkActive(state: EditorState, mark: string): boolean {
  const type = schema.marks[mark]
  if (!type) return false
  const { $from, $to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks())
  return !!type.isInSet($to.marksAcross($from) ?? $to.marks()) || markIn(state, type)
}

// The word around the caret (QTextCursor.WordUnderCursor).
export function wordAt($p: ResolvedPos): { from: number; to: number } | null {
  const parent = $p.parent
  if (!parent.isTextblock) return null
  const text = parent.textBetween(0, parent.content.size, '\u0000', '￼')
  const at = $p.parentOffset
  const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch)
  let a = at, b = at
  while (a > 0 && isWord(text[a - 1])) a--
  while (b < text.length && isWord(text[b])) b++
  if (a === b) return null
  const start = $p.start()
  return { from: start + a, to: start + b }
}

// toggle_mark: on the selection, or the word under the caret, and on what
// is typed next (_merge_format).
export function toggleMark(mark: string): Command {
  return (state, dispatch) => {
    const type = schema.marks[mark]
    if (!type) return false
    const on = !isMarkActive(state, mark)
    let { from, to } = state.selection
    if (state.selection.empty) {
      const w = wordAt(state.selection.$from)
      if (w) { from = w.from; to = w.to }
    }
    if (dispatch) {
      const tr = state.tr
      // Sub- and superscript are one vertical alignment in Qt.
      const other = mark === 'subscript' ? schema.marks.superscript : mark === 'superscript' ? schema.marks.subscript : null
      if (from < to) {
        if (on) {
          if (other) tr.removeMark(from, to, other)
          tr.addMark(from, to, type.create())
        } else {
          tr.removeMark(from, to, type)
        }
      }
      let stored: readonly Mark[] = state.storedMarks || state.selection.$from.marks()
      stored = on ? type.create().addToSet(other ? other.removeFromSet(stored) : stored) : type.removeFromSet(stored)
      if (state.selection.empty) tr.setStoredMarks(stored)
      dispatch(tr)
    }
    return true
  }
}

// clear_formatting: every character format off the selection or the word.
export const clearFormatting: Command = (state, dispatch) => {
  let { from, to } = state.selection
  if (state.selection.empty) {
    const w = wordAt(state.selection.$from)
    if (!w) return false
    from = w.from; to = w.to
  }
  if (dispatch) dispatch(state.tr.removeMark(from, to, null).setStoredMarks([]))
  return true
}

// ---------- lists ----------

// Bullet / numbered list: the caret's lines become items; in a list of
// the other kind the list changes kind; in a list of this kind they leave it.
export function toggleList(ordered: boolean): Command {
  return (state, dispatch) => {
    const $from = state.selection.$from
    if ($from.parent.type === N.list_item) {
      const listPos = $from.before($from.depth - 1)
      const list = $from.node($from.depth - 1)
      if (list.attrs.ordered !== ordered) {
        if (dispatch) dispatch(state.tr.setNodeMarkup(listPos, null, { ...list.attrs, ordered }))
        return true
      }
      return liftListItem(state, dispatch)
    }
    const { from, to } = state.selection
    const targets: { node: PMNode; pos: number }[] = []
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && STYLED_TEXT.has(node.type.name)) targets.push({ node, pos })
      return !node.isTextblock && node.type !== N.table
    })
    if (!targets.length || targets.some(t => state.doc.resolve(t.pos).depth !== 0)) return false
    if (dispatch) {
      const first = targets[0].pos
      const last = targets[targets.length - 1]
      const items = targets.map(t => N.list_item.create(null, t.node.content))
      const list = N.list.create({ ordered }, items)
      const tr = state.tr.replaceWith(first, last.pos + last.node.nodeSize, list)
      const caret = Math.min(tr.doc.content.size, first + 2 + ($from.parentOffset > 0 ? Math.min($from.parentOffset, items[0].content.size) : 0))
      tr.setSelection(TextSelection.create(tr.doc, caret))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// The caret's list item becomes a body paragraph where it stands, the
// list splitting around it (Qt's QTextList.remove).
export const liftListItem: Command = (state, dispatch) => {
  const $from = state.selection.$from
  if ($from.parent.type !== N.list_item) return false
  const list = $from.node($from.depth - 1)
  const listPos = $from.before($from.depth - 1)
  const index = $from.index($from.depth - 1)
  if (dispatch) {
    const before: PMNode[] = [], after: PMNode[] = []
    list.forEach((it, _o, i) => { if (i < index) before.push(it); else if (i > index) after.push(it) })
    const para = N.paragraph.create({ alignment: 'justify' }, $from.parent.content)
    const nodes: PMNode[] = []
    if (before.length) nodes.push(N.list.create(list.attrs, before))
    nodes.push(para)
    if (after.length) nodes.push(N.list.create({ ordered: list.attrs.ordered }, after))
    const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, nodes)
    const paraPos = listPos + (before.length ? nodes[0].nodeSize : 0)
    tr.setSelection(TextSelection.create(tr.doc, paraPos + 1 + $from.parentOffset))
    dispatch(tr.scrollIntoView())
  }
  return true
}

// ---------- block insertion ----------

// Insert `nodes` at the caret as editor.py's insert paths do: replacing
// an empty line, after the line when the caret ends it, else splitting
// it. The caret goes to `caretInto` (an index in nodes) or after them.
export function insertBlocks(nodes: PMNode[], opts: { trailingParagraph?: boolean; select?: number } = {}): Command {
  return (state, dispatch) => {
    if (!nodes.length) return false
    if (inTable(state.selection.$from)) {
      // Never inside a table: after it.
      const t = inTable(state.selection.$from)!
      const at = t.pos + t.table.nodeSize
      if (dispatch) finish(state.tr.insert(at, nodes), at)
      return true
    }
    const sel = state.selection
    const h = here(state)
    let tr = state.tr
    let at: number
    if (sel instanceof NodeSelection && sel.$from.depth === 0) {
      at = sel.to
    } else if (h.top && h.top.type === N.list) {
      at = h.topPos + h.top.nodeSize
    } else if (h.block && h.top && h.block === h.top) {
      const empty = h.block.content.size === 0
      const $p = sel.$from
      if (empty && h.block.type === N.paragraph) {
        tr = tr.delete(h.topPos, h.topPos + h.top.nodeSize)
        at = h.topPos
      } else if ($p.parentOffset === 0) {
        at = h.topPos
      } else if ($p.parentOffset >= h.block.content.size) {
        at = h.topPos + h.top.nodeSize
      } else {
        tr = tr.split($p.pos)
        at = tr.mapping.map($p.pos)
        // Between the two halves.
        at = tr.doc.resolve(at).before(1)
      }
    } else {
      at = h.top ? h.topPos + h.top.nodeSize : state.doc.content.size
    }
    if (dispatch) finish(tr.insert(at, nodes), at)
    return true

    function finish(t: Transaction, pos: number) {
      let end = pos
      for (const n of nodes) end += n.nodeSize
      const next = t.doc.resolve(end).nodeAfter
      if (opts.trailingParagraph && (!next || !next.isTextblock)) {
        t.insert(end, N.paragraph.create({ alignment: 'justify' }))
      }
      if (opts.select !== undefined) {
        let p = pos
        for (let i = 0; i < opts.select; i++) p += nodes[i].nodeSize
        const node = t.doc.nodeAt(p)
        if (node && node.isAtom) t.setSelection(NodeSelection.create(t.doc, p))
        else t.setSelection(Selection.near(t.doc.resolve(p + 1)))
      } else {
        t.setSelection(Selection.near(t.doc.resolve(Math.min(end + 1, t.doc.content.size))))
      }
      dispatch!(t.scrollIntoView())
    }
  }
}

export function insertModelBlocks(blocks: M.Block[], opts: { trailingParagraph?: boolean; select?: number } = {}): Command {
  return insertBlocks(blocks.map(fresh), opts)
}

// A new block: no model block to give back verbatim.
export function fresh(b: M.Block): PMNode {
  const n = blockToPM(b)
  return n.type.create({ ...n.attrs, orig: null }, n.content, n.marks)
}

// _insert_raw_block: raw LaTeX, then a body line to go on typing.
export function insertRawBlock(latex: string): Command {
  return insertModelBlocks([M.rawLatex(latex)], { trailingParagraph: true })
}

export function insertMathBlock(latex: string, numbered = false): Command {
  return insertModelBlocks([M.mathBlock(latex, numbered)], { trailingParagraph: true })
}

// Inline nodes at the caret, replacing the selection.
export function insertInlines(inlines: M.Inline[]): Command {
  return (state, dispatch) => {
    const $p = state.selection.$from
    if (!$p.parent.inlineContent) return false
    const pm = fresh(M.paragraph(inlines))
    const parentType = $p.parent.type
    // Table cells hold plain text only.
    const content = parentType === N.table_cell ? Fragment.from(pm.textContent ? schema.text(pm.textContent) : [])
      : pm.content
    if (dispatch) {
      const tr = state.tr.replaceWith(state.selection.from, state.selection.to, content)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// ---------- theorems ----------

// insert_theorem: the current line if it is empty, else a new line after it.
export function insertTheorem(kind: string, title = ''): Command {
  return (state, dispatch) => {
    const h = here(state)
    if (h.block && h.block === h.top && STYLED_TEXT.has(h.block.type.name) && !h.block.textContent.trim()) {
      if (dispatch) {
        dispatch(state.tr.setNodeMarkup(h.blockPos, N.theorem, { kind, title, start: true }))
      }
      return true
    }
    const thm = N.theorem.create({ kind, title, start: true })
    return insertBlocks([thm], { select: 0 })(state, dispatch)
  }
}

// The theorem's paragraphs: its first (start) block and those continuing it.
function theoremGroup(state: EditorState): { pos: number; node: PMNode }[] {
  const t = currentTheorem(state)
  if (!t) return []
  const doc = state.doc
  const blocks: { pos: number; node: PMNode }[] = []
  doc.forEach((node, pos) => blocks.push({ node, pos }))
  let i = blocks.findIndex(b => b.pos === t.pos)
  if (i < 0) return []
  while (i > 0 && !blocks[i].node.attrs.start && blocks[i - 1].node.type === N.theorem) i--
  const out = [blocks[i]]
  const kind = blocks[i].node.attrs.kind
  for (let j = i + 1; j < blocks.length; j++) {
    const n = blocks[j].node
    if (n.type !== N.theorem || n.attrs.start || n.attrs.kind !== kind) break
    out.push(blocks[j])
  }
  return out
}

export function setTheoremKind(kind: string): Command {
  return (state, dispatch) => {
    const group = theoremGroup(state)
    if (!group.length) return false
    if (dispatch) {
      const tr = state.tr
      for (const b of group) tr.setNodeMarkup(b.pos, null, { ...b.node.attrs, kind })
      dispatch(tr)
    }
    return true
  }
}

export function setTheoremTitle(title: string): Command {
  return (state, dispatch) => {
    const group = theoremGroup(state)
    if (!group.length) return false
    if (dispatch) dispatch(state.tr.setNodeMarkup(group[0].pos, null, { ...group[0].node.attrs, title }))
    return true
  }
}

export function currentTheoremKind(state: EditorState): string {
  return currentTheorem(state)?.node.attrs.kind ?? ''
}

export function currentTheoremTitle(state: EditorState): string {
  const g = theoremGroup(state)
  return g.length ? g[0].node.attrs.title || '' : ''
}

// ---------- figures ----------

export function setFigureAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const f = currentFigure(state)
    if (!f) return false
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, ...attrs })
      tr.setSelection(NodeSelection.create(tr.doc, f.pos))
      dispatch(tr)
    }
    return true
  }
}

export function setFigureWidth(fraction: number): Command {
  return setFigureAttrs({ width: `${fraction.toFixed(2)}\\textwidth` })
}

export const deleteSelectedNode: Command = (state, dispatch) => {
  const sel = state.selection
  if (!(sel instanceof NodeSelection)) return false
  if (dispatch) {
    const tr = state.tr.deleteSelection()
    if (tr.doc.childCount === 0) tr.insert(0, N.paragraph.create({ alignment: 'justify' }))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const deleteFigure: Command = (state, dispatch) =>
  currentFigure(state) ? deleteSelectedNode(state, dispatch) : false

// ---------- equations ----------

export function currentEquationNumbered(state: EditorState): boolean {
  const m = currentMathBlock(state)
  return !!m && mathBlockIsNumbered(m.node.attrs.latex, m.node.attrs.numbered)
}

export function setEquationNumbered(on: boolean): Command {
  return (state, dispatch) => {
    const m = currentMathBlock(state)
    if (!m) return false
    if (dispatch) {
      let latex: string = m.node.attrs.latex
      // align / gather / multline… are kept verbatim, so the star on the
      // environment itself is what numbers them, not the block flag.
      const env = /\\begin\{((?:align|gather|multline|flalign|alignat|eqnarray)\*?)\}/.exec(latex)
      if (env) {
        const name = env[1].replace(/\*+$/, '') + (on ? '' : '*')
        const endTag = `\\end{${env[1]}}`
        const endAt = latex.lastIndexOf(endTag)
        if (endAt >= 0) latex = latex.slice(0, endAt) + `\\end{${name}}` + latex.slice(endAt + endTag.length)
        const beginTag = `\\begin{${env[1]}}`
        latex = latex.slice(0, env.index) + `\\begin{${name}}` + latex.slice(env.index + beginTag.length)
      }
      const tr = state.tr.setNodeMarkup(m.pos, null, { ...m.node.attrs, numbered: on, latex })
      tr.setSelection(NodeSelection.create(tr.doc, m.pos))
      dispatch(tr)
    }
    return true
  }
}

export const deleteEquation: Command = (state, dispatch) => {
  if (currentMathBlock(state)) return deleteSelectedNode(state, dispatch)
  const mi = currentMathInline(state)
  if (!mi) return false
  if (dispatch) dispatch(state.tr.delete(mi.pos, mi.pos + mi.node.nodeSize))
  return true
}

// Replace the equation under the caret (Equation ▸ Edit's result).
export function replaceMath(latex: string): Command {
  return (state, dispatch) => {
    const mb = currentMathBlock(state)
    const mi = mb ? null : currentMathInline(state)
    const target = mb ?? mi
    if (!target) return false
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(target.pos, null, { ...target.node.attrs, latex })
      tr.setSelection(NodeSelection.create(tr.doc, target.pos))
      dispatch(tr)
    }
    return true
  }
}

// ---------- tables ----------

export function insertTable(rows: number, cols: number, caption: string, label: string): Command {
  return insertModelBlocks([M.table({
    rows: Array.from({ length: rows }, () => Array(cols).fill('cell')),
    caption, label: label || null, alignment: '',
  })], { select: 0, trailingParagraph: true })
}

function cellCoords(state: EditorState): { table: PMNode; tablePos: number; map: TableMap; row: number; col: number } | null {
  const t = currentTable(state)
  if (!t) return null
  const map = TableMap.get(t.table)
  const $p = state.selection.$from
  let cellPos = -1
  for (let d = $p.depth; d > 0; d--) {
    if ($p.node(d).type === N.table_cell) { cellPos = $p.before(d); break }
  }
  if (state.selection instanceof CellSelection) cellPos = state.selection.$anchorCell.pos
  if (cellPos < 0) return null
  const rect = map.findCell(cellPos - t.pos - 1)
  return { table: t.table, tablePos: t.pos, map, row: rect.top, col: rect.left }
}

export const tableInsertRow = (below: boolean): Command => below ? addRowAfter : addRowBefore
export const tableInsertColumn = (right: boolean): Command => right ? addColumnAfter : addColumnBefore

// table_delete_row: the last row deletes the table.
export const tableDeleteRow: Command = (state, dispatch) => {
  const c = cellCoords(state)
  if (!c) return false
  if (c.map.height <= 1) return deleteTable(state, dispatch)
  return deleteRow(state, dispatch)
}

export const tableDeleteColumn: Command = (state, dispatch) => {
  const c = cellCoords(state)
  if (!c) return false
  if (c.map.width <= 1) return deleteTable(state, dispatch)
  return deleteColumn(state, dispatch)
}

export const tableDelete: Command = (state, dispatch) => currentTable(state) ? deleteTable(state, dispatch) : false

function setTableAttrs(attrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const t = currentTable(state)
    if (!t) return false
    if (dispatch) dispatch(state.tr.setNodeMarkup(t.pos, null, { ...t.table.attrs, ...attrs }))
    return true
  }
}

export const setTableStyle = (style: string): Command => setTableAttrs({ style })
// set_table_header: off also stops repeating it.
export const setTableHeader = (on: boolean): Command => setTableAttrs(on ? { header: true } : { header: false, repeat_header: false })
// set_table_repeat_header: on also makes the first row a header.
export const setTableRepeatHeader = (on: boolean): Command => setTableAttrs(on ? { repeat_header: true, header: true } : { repeat_header: false })

export function tableHeader(state: EditorState): [boolean, boolean] {
  const t = currentTable(state)
  return t ? [!!t.table.attrs.header, !!t.table.attrs.repeat_header] : [false, false]
}

export function currentTableStyle(state: EditorState): string {
  return currentTable(state)?.table.attrs.style ?? ''
}

// The selected cells, or the caret's: [tablePos, rect].
function selectedCells(state: EditorState) {
  if (!currentTable(state)) return null
  try {
    return selectedRect(state)
  } catch {
    return null
  }
}

// table_merge_cells: Word keeps the text of every merged cell, joined
// into the first.
export const tableMergeCells: Command = (state, dispatch) => {
  const rect = selectedCells(state)
  if (!rect) return false
  const nr = rect.bottom - rect.top, nc = rect.right - rect.left
  if (nr * nc <= 1) return false
  if (dispatch) {
    const { map, table, tableStart } = rect
    const texts: string[] = []
    const seen = new Set<number>()
    for (let r = rect.top; r < rect.bottom; r++) {
      for (let c = rect.left; c < rect.right; c++) {
        const pos = map.map[r * map.width + c]
        if (seen.has(pos)) continue
        seen.add(pos)
        const t = table.nodeAt(pos)!.textContent.trim()
        if (t) texts.push(t)
      }
    }
    // Every cell of the block but the first goes; the first spans them.
    const tr = state.tr
    const firstPos = map.map[rect.top * map.width + rect.left]
    const first = table.nodeAt(firstPos)!
    const doomed = [...seen].filter(p => p !== firstPos).sort((a, b) => b - a)
    for (const p of doomed) {
      const n = table.nodeAt(p)!
      tr.delete(tr.mapping.map(tableStart + p), tr.mapping.map(tableStart + p + n.nodeSize))
    }
    const at = tr.mapping.map(tableStart + firstPos)
    const joined = texts.join(' ')
    tr.replaceWith(at, at + tr.doc.nodeAt(at)!.nodeSize, N.table_cell.create(
      { ...first.attrs, colspan: nc, rowspan: nr, raw: null, colwidth: null }, joined ? schema.text(joined) : null))
    tr.setSelection(TextSelection.create(tr.doc, at + 1))
    dispatch(tr)
  }
  return true
}

export const tableSplitCell: Command = (state, dispatch) => splitCell(state, dispatch)

// set_cell_shading: the selected cells, or the caret's; null clears.
export function setCellShading(color: string | null): Command {
  return (state, dispatch) => {
    const rect = selectedCells(state)
    if (!rect) return false
    if (dispatch) {
      const tr = state.tr
      const seen = new Set<number>()
      for (let r = rect.top; r < rect.bottom; r++) {
        for (let c = rect.left; c < rect.right; c++) {
          const pos = rect.map.map[r * rect.map.width + c]
          if (seen.has(pos)) continue
          seen.add(pos)
          const cell = rect.table.nodeAt(pos)!
          tr.setNodeMarkup(rect.tableStart + pos, null, { ...cell.attrs, shade: color || null })
        }
      }
      dispatch(tr)
    }
    return true
  }
}

// set_column_alignment: 'l', 'c' or 'r' for the caret's column, keeping
// the rest of the column spec (rules, p{} widths).
export function setColumnAlignment(align: string): Command {
  return (state, dispatch) => {
    const c = cellCoords(state)
    if (!c) return false
    const ncols = c.map.width
    const spec: string = c.table.attrs.alignment || ''
    let toks = columnSpecTokens(spec)
    const isCol = (t: string) => t !== '|' && !'@!<>'.includes(t[0])
    if (toks.filter(isCol).length !== ncols) {
      const [aligns, vrules] = parseColumnSpec(spec, ncols)
      toks = []
      aligns.forEach((a, i) => { if (vrules[i]) toks.push('|'); toks.push(a) })
      if (vrules[vrules.length - 1]) toks.push('|')
    }
    let n = -1
    toks = toks.map(t => {
      if (isCol(t)) { n += 1; if (n === c.col) return align }
      return t
    })
    if (dispatch) dispatch(state.tr.setNodeMarkup(c.tablePos, null, { ...c.table.attrs, alignment: toks.join('') }))
    return true
  }
}

export function currentColumnAlignment(state: EditorState): string {
  const c = cellCoords(state)
  if (!c) return ''
  const [aligns] = parseColumnSpec(c.table.attrs.alignment || '', c.map.width)
  return aligns[c.col] ?? 'l'
}

// sort_table: the data rows by the caret's column, the header row kept
// first, numbers in numeric order. Returns why it cannot sort, or null.
export function sortTable(descending: boolean, state: EditorState, dispatch?: Dispatch): string | null {
  const c = cellCoords(state)
  if (!c) return null
  const { table } = c
  const start = table.attrs.header ? 1 : 0
  let merged = false
  table.forEach((row, _o, r) => row.forEach(cell => {
    if ((cell.attrs.rowspan > 1 || cell.attrs.colspan > 1) && r + cell.attrs.rowspan > start) merged = true
  }))
  if (merged) return 'Split the merged cells before sorting the table.'
  const rows: PMNode[] = []
  table.forEach(r => rows.push(r))
  const key = (row: PMNode): [number, number, string] => {
    const cell = row.childCount > c.col ? row.child(c.col) : null
    const text = cell ? cellDisplayText(cell.textContent) : ''
    const num = text.replace(/,/g, '')
    if (num.trim() !== '' && Number.isFinite(Number(num))) return [0, Number(num), '']
    return [1, 0, text.toLowerCase()]
  }
  const cmp = (a: [number, number, string], b: [number, number, string]) =>
    a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)
  const body = rows.slice(start).map(r => ({ r, k: key(r) }))
  body.sort((x, y) => descending ? cmp(y.k, x.k) : cmp(x.k, y.k))
  if (dispatch) {
    const sorted = [...rows.slice(0, start), ...body.map(b => b.r)]
    const tr = state.tr.replaceWith(c.tablePos + 1, c.tablePos + table.nodeSize - 1, sorted)
    // Keep the caret in its cell, so the table's tools stay open.
    const t2 = tr.doc.nodeAt(c.tablePos)!
    const m2 = TableMap.get(t2)
    const cellPos = c.tablePos + 1 + m2.map[c.row * m2.width + c.col]
    tr.setSelection(TextSelection.create(tr.doc, cellPos + 1))
    dispatch(tr)
  }
  return null
}

// ---------- captions ----------

export function currentCaption(state: EditorState): [string, string] {
  const t = currentTable(state)
  if (t) return [t.table.attrs.caption || '', t.table.attrs.label || '']
  const f = currentFigure(state)
  if (f) return [f.node.attrs.caption || '', f.node.attrs.label || '']
  return ['', '']
}

export function setCaption(caption: string, label: string): Command {
  return (state, dispatch) => {
    const t = currentTable(state)
    if (t) return setTableAttrs({ caption, label: label || null })(state, dispatch)
    return setFigureAttrs({ caption, label: label || null })(state, dispatch)
  }
}

// ---------- highlights and comments ----------

const WRAP_DEPTH = 99

export function addHighlight(color: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    if (empty) return false
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, schema.marks.highlight)
      tr.addMark(from, to, schema.marks.highlight.create({ gid: newGid(), depth: WRAP_DEPTH, color }))
      dispatch(tr)
    }
    return true
  }
}

export const removeHighlight: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection
  if (empty) return false
  if (dispatch) dispatch(state.tr.removeMark(from, to, schema.marks.highlight))
  return true
}

export function addComment(note: string, author: string, timestamp: string): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    if (empty) return false
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, schema.marks.comment)
      tr.addMark(from, to, schema.marks.comment.create({
        gid: newGid(), depth: WRAP_DEPTH, note, author, timestamp, resolved: false,
      }))
      dispatch(tr)
    }
    return true
  }
}

// The span of the comment at the caret: every node carrying its mark.
export function commentSpanAt(state: EditorState, pos: number): { from: number; to: number; mark: Mark } | null {
  const $p = state.doc.resolve(pos)
  const marks = [...($p.nodeAfter?.marks ?? []), ...($p.nodeBefore?.marks ?? [])]
  const mark = marks.find(m => m.type === schema.marks.comment)
  if (!mark) return null
  const parent = $p.parent
  const start = $p.start()
  let from = -1, to = -1
  parent.forEach((child, offset) => {
    if (mark.isInSet(child.marks)) {
      if (from < 0) from = start + offset
      to = start + offset + child.nodeSize
    }
  })
  return from < 0 ? null : { from, to, mark }
}

function selectionOrComment(state: EditorState): { from: number; to: number } | null {
  if (!state.selection.empty) return { from: state.selection.from, to: state.selection.to }
  return commentSpanAt(state, state.selection.from) ?? wordAt(state.selection.$from)
}

// accept_comment: the comment's text stays, its note goes.
export const acceptComment: Command = (state, dispatch) => {
  const r = selectionOrComment(state)
  if (!r) return false
  if (dispatch) dispatch(state.tr.removeMark(r.from, r.to, schema.marks.comment))
  return true
}

// reject_comment: the commented text goes.
export const rejectComment: Command = (state, dispatch) => {
  const r = selectionOrComment(state)
  if (!r) return false
  if (dispatch) dispatch(state.tr.delete(r.from, r.to))
  return true
}

// next_comment / prev_comment: select the next or previous comment span.
export function findComment(forward: boolean): Command {
  return (state, dispatch) => {
    const pos = state.selection.from
    const spans: { from: number; to: number }[] = []
    let cur: { from: number; to: number; gid: number } | null = null
    state.doc.descendants((node, p) => {
      if (!node.isInline) return true
      const m = node.marks.find(x => x.type === schema.marks.comment)
      if (m && cur && cur.gid === m.attrs.gid && cur.to === p) { cur.to = p + node.nodeSize; return false }
      if (cur) { spans.push(cur); cur = null }
      if (m) cur = { from: p, to: p + node.nodeSize, gid: m.attrs.gid }
      return false
    })
    if (cur) spans.push(cur)
    const hit = forward ? spans.find(s => s.from > pos) : [...spans].reverse().find(s => s.to < pos)
    if (!hit) return false
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, hit.from, hit.to)).scrollIntoView())
    return true
  }
}

// ---------- find & replace ----------

export interface FindOpts { forward: boolean; caseSensitive: boolean; wholeWord: boolean }

// Every text block's text with a position map, for searching.
function textRuns(doc: PMNode): { text: string; pos: number[] }[] {
  const out: { text: string; pos: number[] }[] = []
  doc.descendants((node, p) => {
    if (!node.isTextblock) return true
    let text = ''
    const pos: number[] = []
    node.forEach((child, off) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) { text += child.text![i]; pos.push(p + 1 + off + i) }
      } else {
        text += '￼'; pos.push(p + 1 + off)
      }
    })
    out.push({ text, pos })
    return false
  })
  return out
}

function matchesIn(doc: PMNode, needle: string, o: { caseSensitive: boolean; wholeWord: boolean }): { from: number; to: number }[] {
  if (!needle) return []
  const out: { from: number; to: number }[] = []
  const n = o.caseSensitive ? needle : needle.toLowerCase()
  for (const run of textRuns(doc)) {
    const hay = o.caseSensitive ? run.text : run.text.toLowerCase()
    let i = hay.indexOf(n)
    while (i >= 0) {
      const before = hay[i - 1], after = hay[i + n.length]
      const isW = (ch?: string) => !!ch && /[\p{L}\p{N}_]/u.test(ch)
      if (!o.wholeWord || (!isW(before) && !isW(after))) {
        out.push({ from: run.pos[i], to: run.pos[i + n.length - 1] + 1 })
      }
      i = hay.indexOf(n, i + Math.max(1, n.length))
    }
  }
  return out
}

// QTextEdit.find with a wrap-around retry, as MainWindow._do_find.
export function find(needle: string, o: FindOpts, state: EditorState, dispatch?: Dispatch): boolean {
  const hits = matchesIn(state.doc, needle, o)
  if (!hits.length) return false
  const { from, to } = state.selection
  const hit = o.forward ? hits.find(h => h.from >= to) ?? hits[0]
    : [...hits].reverse().find(h => h.to <= from) ?? hits[hits.length - 1]
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, hit.from, hit.to)).scrollIntoView())
  return true
}

export function replace(needle: string, repl: string, o: { caseSensitive: boolean; wholeWord: boolean },
  state: EditorState, dispatch?: Dispatch): EditorState | null {
  const sel = state.selection
  const text = state.doc.textBetween(sel.from, sel.to, '\n', '￼')
  const match = !sel.empty && (o.caseSensitive ? text === needle : text.toLowerCase() === needle.toLowerCase())
  let s = state
  if (match) {
    const tr = state.tr.insertText(repl, sel.from, sel.to)
    s = state.apply(tr)
    dispatch?.(tr)
  }
  return s
}

export function replaceAll(needle: string, repl: string, o: { caseSensitive: boolean; wholeWord: boolean },
  state: EditorState, dispatch?: Dispatch): number {
  const hits = matchesIn(state.doc, needle, o)
  if (!hits.length) return 0
  if (dispatch) {
    const tr = state.tr
    for (const h of [...hits].reverse()) {
      const marks = state.doc.resolve(h.from).marksAcross(state.doc.resolve(h.to)) ?? []
      if (repl) tr.replaceWith(h.from, h.to, schema.text(repl, marks))
      else tr.delete(h.from, h.to)
    }
    dispatch(tr)
  }
  return hits.length
}
