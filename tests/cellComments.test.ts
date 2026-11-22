// Comments on a table cell's text: \kcomment in the cell's LaTeX, a comment
// mark in the editor, and back.
import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { blockFromPM, blockToPM, cellDisplayText } from '../src/editor/convert.ts'
import { addComment } from '../src/editor/commands.ts'
import { schema } from '../src/editor/schema.ts'
import { table } from '../src/core/model.ts'
import type { Table } from '../src/core/model.ts'

const KC = '\\kcomment[2026-11-22T10:00:00]{Ann}{22 Nov 2026}{Check this}{\\textbf{12} mg}'

describe('comments in table cells', () => {
  it('shows the commented text', () => {
    expect(cellDisplayText(`Dose ${KC} daily`)).toBe('Dose 12 mg daily')
  })
  it('keeps a comment through the editor', () => {
    const t = table({ rows: [[`Dose ${KC} daily`, 'b']], caption: '', label: null, alignment: 'll' })
    const pm = blockToPM(t)
    const cell = pm.firstChild!.firstChild!
    expect(cell.childCount).toBe(3)
    expect(cell.child(1).marks[0].attrs.note).toBe('Check this')
    const back = blockFromPM(pm) as Table
    expect(back.rows[0][0]).toBe(`Dose ${KC} daily`)
  })
  it('adds a comment on a cell', () => {
    const t = table({ rows: [['alpha beta', 'b']], caption: '', label: null, alignment: 'll' })
    const doc = schema.nodes.doc.create(null, [blockToPM(t)])
    let state = EditorState.create({ doc })
    let from = -1
    doc.descendants((n, pos) => { if (n.isText && n.text === 'alpha beta' && from < 0) from = pos })
    state = state.apply(state.tr.setSelection(
      (state.selection.constructor as any).create(state.doc, from + 6, from + 10)))
    addComment('why?', 'Bob', '2026-11-22T11:00:00')(state, (tr) => { state = state.apply(tr) })
    const back = blockFromPM(state.doc.firstChild!) as Table
    expect(back.rows[0][0]).toMatch(/^alpha \\kcomment\[2026-11-22T11:00:00\]\{Bob\}\{[^}]*\}\{why\?\}\{beta\}$/)
  })
})
