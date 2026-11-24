// Enter, Backspace, Delete and Tab as the Qt editor handles them
// (DocumentEditor._keep_styles_across_key, _theorem_key, _run_block_key,
// and QTextEdit's own list and table keys), and the editing shortcuts.
import { baseKeymap, chainCommands, deleteSelection, joinBackward, joinForward, newlineInCode,
  selectNodeBackward, selectNodeForward } from 'prosemirror-commands'
import { redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { TextSelection, type Plugin } from 'prosemirror-state'
import { addRowAfter, goToNextCell } from 'prosemirror-tables'
import { liftListItem, paragraphAfterCallout, type Command } from './commands.ts'
import { isCallout } from '../core/model.ts'
import { schema, STYLED_TEXT } from './schema.ts'

const N = schema.nodes

// Shift+Enter: a line break inside the block (U+2028 in Qt).
const lineBreak: Command = (state, dispatch) => {
  const $p = state.selection.$from
  if (!$p.parent.inlineContent || $p.parent.type === N.table_cell) return false
  if ($p.parent.type.spec.code) return newlineInCode(state, dispatch)
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(N.line_sep.create(null, null, state.storedMarks || $p.marks()), false)
      .scrollIntoView())
  }
  return true
}

// _theorem_key: Enter starts the theorem's next paragraph; Enter on an
// empty one leaves the theorem.
const theoremEnter: Command = (state, dispatch) => {
  const $p = state.selection.$from
  const block = $p.parent
  if (block.type !== N.theorem || $p.depth !== 1) return false
  if (dispatch) {
    const tr = state.tr
    if (!block.textContent.trim() && !block.attrs.start && block.childCount === 0) {
      tr.setNodeMarkup($p.before(1), N.paragraph, { alignment: 'justify' })
    } else {
      tr.deleteSelection()
      const at = tr.selection.from
      tr.split(at, 1, [{ type: N.theorem, attrs: { kind: block.attrs.kind, title: block.attrs.title, start: false, color: block.attrs.color } }])
    }
    dispatch(tr.scrollIntoView())
  }
  return true
}

// _run_block_key, Enter: at the end of a heading Enter starts body text;
// inside one it splits it into two lines of the same style.
const styledEnter: Command = (state, dispatch) => {
  const sel = state.selection
  const $p = sel.$from
  const block = $p.parent
  if ($p.depth !== 1 || !STYLED_TEXT.has(block.type.name) || block.type === N.theorem) return false
  const atEnd = sel.empty && $p.parentOffset === block.content.size
  if (dispatch) {
    const tr = state.tr.deleteSelection()
    const at = tr.selection.from
    const marks = state.storedMarks || $p.marks()
    if (atEnd) {
      // Body text after it; a paragraph keeps its alignment, as Word does.
      const align = block.type === N.paragraph ? block.attrs.alignment : 'justify'
      tr.split(at, 1, [{ type: N.paragraph, attrs: { alignment: align, orig: null } }])
    } else {
      tr.split(at, 1, [{ type: block.type, attrs: { ...block.attrs, orig: null } }])
    }
    // The new line types in the caret's character format.
    if (marks.length) tr.setStoredMarks(marks)
    dispatch(tr.scrollIntoView())
  }
  return true
}

// QTextEdit: Enter in a list item makes the next item; on an empty item it
// ends the list.
const listEnter: Command = (state, dispatch) => {
  const $p = state.selection.$from
  if ($p.parent.type !== N.list_item) return false
  if ($p.parent.content.size === 0) return liftListItem(state, dispatch)
  if (dispatch) {
    const tr = state.tr.deleteSelection()
    tr.split(tr.selection.from, 1)
    dispatch(tr.scrollIntoView())
  }
  return true
}

// A table cell holds one line; Enter does nothing.
const cellEnter: Command = (state) => state.selection.$from.parent.type === N.table_cell

// QTextEdit: Backspace at the start of a list item takes it out of the list.
const listBackspace: Command = (state, dispatch) => {
  const sel = state.selection
  const $p = sel.$from
  if (!sel.empty || $p.parent.type !== N.list_item || $p.parentOffset !== 0) return false
  return liftListItem(state, dispatch)
}

// Joining never reaches into a table cell or out of one.
const cellEdge = (dir: -1 | 1): Command => (state) => {
  const sel = state.selection
  const $p = sel.$from
  if (!sel.empty || $p.parent.type !== N.table_cell) return false
  return dir < 0 ? $p.parentOffset === 0 : $p.parentOffset === $p.parent.content.size
}

// Tab in a table goes to the next cell, adding a row after the last.
const tableTab: Command = (state, dispatch) => {
  if (goToNextCell(1)(state, dispatch)) return true
  const $p = state.selection.$from
  let inCell = false
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type === N.table_cell) inCell = true
  if (!inCell) return false
  if (!dispatch) return true
  let next = state
  addRowAfter(state, tr => { next = state.apply(tr); dispatch(tr) })
  return goToNextCell(1)(next, dispatch)
}

// Anywhere else Tab types a tab, as QTextEdit accepts it.
const insertTab: Command = (state, dispatch) => {
  const $p = state.selection.$from
  if (!$p.parent.inlineContent) return false
  if (dispatch) dispatch(state.tr.insertText('\t').scrollIntoView())
  return true
}

const selectAll: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)))
  return true
}

// In a box, Cmd/Ctrl+Enter or Shift+Enter: out of it, into a new ordinary
// paragraph after it (Enter adds a paragraph inside the box).
const leaveCallout: Command = (state, dispatch) => {
  const $p = state.selection.$from
  if ($p.depth !== 1 || $p.parent.type !== N.theorem || !isCallout($p.parent.attrs.kind)) return false
  return paragraphAfterCallout(state, dispatch)
}

export interface Shortcuts {
  // A ribbon command by id (bold, find, link...).
  run(id: string): boolean
}

export function keyCommands(sc: Shortcuts): Record<string, Command> {
  const cmd = (id: string): Command => (_s, dispatch) => { if (dispatch) return sc.run(id); return true }
  const keys: Record<string, Command> = {
    Enter: chainCommands(cellEnter, theoremEnter, listEnter, styledEnter, newlineInCode),
    'Shift-Enter': chainCommands(leaveCallout, lineBreak),
    'Mod-Enter': leaveCallout,
    Backspace: chainCommands(deleteSelection, cellEdge(-1), listBackspace, joinBackward, selectNodeBackward),
    Delete: chainCommands(deleteSelection, cellEdge(1), joinForward, selectNodeForward),
    Tab: chainCommands(tableTab, insertTab),
    'Shift-Tab': goToNextCell(-1),
    'Mod-z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    'Mod-a': selectAll,
    'Mod-b': cmd('bold'),
    'Mod-i': cmd('italic'),
    'Mod-u': cmd('underline'),
    'Mod-m': cmd('math_inline'),
    'Mod-Shift-m': cmd('math_block'),
    'Mod-k': cmd('link'),
    'Mod-f': cmd('find'),
    'Mod-h': cmd('replace'),
    'Mod-Shift-h': cmd('highlight'),
    'Mod-Alt-m': cmd('comment'),
    'Mod-Shift-[': cmd('prev_comment'),
    'Mod-Shift-]': cmd('next_comment'),
    'Mod-Shift-g': cmd('symbol'),
    'Mod-Shift-e': cmd('equation_builder'),
    'Mod-Shift-r': cmd('chemistry'),
    'Mod-Shift-t': cmd('chemfig'),
    'Mod-Shift-f': cmd('flowchart'),
    'Mod-Alt-v': cmd('paste_special'),
  }
  return keys
}

export function editorKeymaps(sc: Shortcuts): Plugin[] {
  return [keymap(keyCommands(sc)), keymap(baseKeymap)]
}
