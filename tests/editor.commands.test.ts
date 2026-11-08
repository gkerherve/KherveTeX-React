/// <reference lib="dom" />
// The visual editor's commands and keys on the ProseMirror state, ported
// from the KherveTeX tests that drive the Qt DocumentEditor
// (test_theorems, test_table_design, test_object_tools) plus the key
// handling of editor._keep_styles_across_key.
import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { CellSelection, TableMap } from 'prosemirror-tables'
import * as M from '../src/core/model.ts'
import * as C from '../src/editor/commands.ts'
import { docFromPM, docToPM } from '../src/editor/convert.ts'
import { keyCommands } from '../src/editor/keymap.ts'
import type { Node as PMNode } from 'prosemirror-model'

class Ed {
  state: EditorState
  constructor(blocks: M.Block[]) {
    this.state = EditorState.create({ doc: docToPM(M.document(blocks)) })
  }
  run(cmd: C.Command): boolean {
    return cmd(this.state, tr => { this.state = this.state.apply(tr) })
  }
  key(name: string): boolean {
    return this.run(keyCommands({ run: () => true })[name])
  }
  type(text: string): void {
    this.state = this.state.apply(this.state.tr.insertText(text))
  }
  doc(): M.Document {
    return docFromPM(this.state.doc, M.docMeta())
  }
  blocks(): M.Block[] {
    return this.doc().children
  }
  // The caret at offset `at` of the n-th text block (document order).
  caretIn(n: number, at: number | 'end' = 0): void {
    let i = 0, pos = -1
    this.state.doc.descendants((node, p) => {
      if (pos >= 0) return false
      if (node.isTextblock) {
        if (i === n) pos = p + 1 + (at === 'end' ? node.content.size : at)
        i++
        return false
      }
      return true
    })
    this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, pos)))
  }
  // The caret in table cell (r, c) of the first table, or a cell range.
  cells(r: number, c: number, r2?: number, c2?: number): void {
    let tpos = -1
    let table: PMNode | null = null
    this.state.doc.forEach((n, p) => { if (!table && n.type.name === 'table') { table = n; tpos = p } })
    const map = TableMap.get(table!)
    const at = (rr: number, cc: number) => tpos + 1 + map.map[rr * map.width + cc]
    if (r2 === undefined) {
      this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, at(r, c) + 1)))
    } else {
      this.state = this.state.apply(this.state.tr.setSelection(
        CellSelection.create(this.state.doc, at(r, c), at(r2!, c2!))))
    }
  }
  selectBlock(type: string): void {
    let pos = -1
    this.state.doc.forEach((n, p) => { if (pos < 0 && n.type.name === type) pos = p })
    this.state = this.state.apply(this.state.tr.setSelection(NodeSelection.create(this.state.doc, pos)))
  }
  table(): M.Table {
    return this.blocks().find(b => b.type === 'Table') as M.Table
  }
}

describe('test_theorems.py', () => {
  it('test_editor_round_trip_enter_and_kind', () => {
    const ed = new Ed([M.paragraph([M.text('intro')]), M.theorem('definition', 'Open', [M.text('D')])])
    const got = ed.blocks().filter(b => b.type === 'Theorem') as M.Theorem[]
    expect(got.map(b => [b.kind, b.title, b.start])).toEqual([['definition', 'Open', true]])
    ed.caretIn(1, 'end')
    expect(C.contextObject(ed.state)).toBe('theorem')
    ed.key('Enter')
    ed.type('more')
    ed.key('Enter')
    ed.key('Enter')      // empty: leaves the theorem
    ed.type('body')
    const kinds = ed.blocks().map(b => [b.type, b.type === 'Theorem' ? b.start : null])
    expect(kinds.slice(-3)).toEqual([['Theorem', true], ['Theorem', false], ['Paragraph', null]])
    // set_theorem_kind changes the whole theorem, not what follows it.
    ed.caretIn(2, 0)
    ed.run(C.setTheoremKind('lemma'))
    const thms = ed.blocks().filter(b => b.type === 'Theorem') as M.Theorem[]
    expect(thms.map(t => t.kind)).toEqual(['lemma', 'lemma'])
    ed.run(C.setTheoremTitle('Zorn'))
    expect((ed.blocks()[1] as M.Theorem).title).toBe('Zorn')
    expect(C.currentTheoremTitle(ed.state)).toBe('Zorn')
  })

  it('insert_theorem uses an empty line, else adds one after', () => {
    const ed = new Ed([M.paragraph([M.text('a')]), M.paragraph([])])
    ed.caretIn(1)
    ed.run(C.insertTheorem('proof'))
    expect(ed.blocks().map(b => b.type)).toEqual(['Paragraph', 'Theorem'])
    ed.caretIn(0, 'end')
    ed.run(C.insertTheorem('lemma', 'L'))
    expect(ed.blocks().map(b => b.type)).toEqual(['Paragraph', 'Theorem', 'Theorem'])
    expect((ed.blocks()[1] as M.Theorem).kind).toBe('lemma')
  })
})

describe('test_table_design.py', () => {
  const fixture = () => new Ed([
    M.paragraph([M.text('x')]),
    M.table({ rows: [['Sample', 'Mass'], ['B', '2.5'], ['A', '10'], ['C', '1']], caption: 'M' }),
    M.paragraph([M.text('y')])])

  it('test_editor_header_sort_shading_style', () => {
    const ed = fixture()
    ed.cells(1, 1)
    ed.run(C.setTableHeader(true))
    expect(C.sortTable(false, ed.state, tr => { ed.state = ed.state.apply(tr) })).toBeNull()
    expect(ed.table().rows.map(r => r[1])).toEqual(['Mass', '1', '2.5', '10'])
    C.sortTable(true, ed.state, tr => { ed.state = ed.state.apply(tr) })
    expect(ed.table().rows.map(r => r[1])).toEqual(['Mass', '10', '2.5', '1'])
    ed.cells(2, 0)
    ed.run(C.setCellShading('#dce8f7'))
    ed.run(C.setTableStyle('grid'))
    ed.cells(0, 0)
    ed.run(C.setTableRepeatHeader(true))
    const t = ed.table()
    expect([t.header, t.repeat_header, t.style]).toEqual([true, true, 'grid'])
    expect(t.shading).toEqual({ '2,0': '#dce8f7' })
    ed.cells(2, 0)
    ed.run(C.setCellShading(null))
    expect(ed.table().shading).toEqual({})
  })

  it('test_editor_merge_and_split', () => {
    const ed = fixture()
    ed.cells(1, 0, 2, 0)
    expect(ed.run(C.tableMergeCells)).toBe(true)
    let t = ed.table()
    expect(t.merges).toEqual([[1, 0, 2, 1]])
    expect(t.rows[1][0]).toBe('B A')
    expect(t.rows[2][0]).toBe('')
    expect(C.sortTable(false, ed.state)).not.toBeNull()   // refused while merged
    ed.cells(1, 0)
    ed.run(C.tableSplitCell)
    t = ed.table()
    expect(t.merges).toEqual([])
  })
})

describe('test_object_tools.py', () => {
  it('test_table_rows_columns_style_and_delete', () => {
    const ed = new Ed([M.paragraph([M.text('x')]), M.table({ rows: [['a', 'b'], ['1', '2']], caption: 'T' }),
      M.paragraph([M.text('y')])])
    ed.cells(0, 0)
    expect(C.contextObject(ed.state)).toBe('table')
    ed.run(C.setTableStyle('booktabs'))
    ed.run(C.tableInsertRow(true))
    ed.run(C.tableInsertColumn(true))
    let t = ed.table()
    expect(t.style).toBe('booktabs')
    expect(t.rows.length).toBe(3)
    expect(t.rows[0].length).toBe(3)
    expect(t.caption).toBe('T')
    ed.run(C.tableDeleteRow)
    expect(ed.table().rows.length).toBe(2)
    ed.run(C.tableDelete)
    expect(ed.blocks().some(b => b.type === 'Table')).toBe(false)
  })

  // _table_columns_changed: a stale "{lcc}" on a 4- or 2-column table
  // would not compile, so inserting or deleting a column drops the spec.
  it('column insert and delete drop the stored column spec', () => {
    const ed = new Ed([M.table({ rows: [['a', 'b', 'c'], ['1', '2', '3']], alignment: 'lcc' })])
    ed.cells(0, 1)
    ed.run(C.setTableStyle('booktabs'))
    expect(ed.table().alignment).toBe('lcc')
    ed.run(C.tableInsertColumn(true))
    expect(ed.table().rows[0].length).toBe(4)
    expect(ed.table().alignment).toBe('')
    const ed2 = new Ed([M.table({ rows: [['a', 'b', 'c']], alignment: 'lcc' })])
    ed2.cells(0, 2)
    ed2.run(C.tableDeleteColumn)
    expect(ed2.table().rows[0]).toEqual(['a', 'b'])
    expect(ed2.table().alignment).toBe('')
  })

  it('test_picture_align_buttons_and_width', () => {
    const ed = new Ed([M.paragraph([M.text('x')]), M.figure({ path: 'p.png' })])
    ed.selectBlock('figure')
    expect(C.contextObject(ed.state)).toBe('figure')
    ed.run(C.applyAlignment('right'))     // Home's align button
    ed.run(C.setFigureWidth(0.25))
    const fig = ed.blocks().find(b => b.type === 'Figure') as M.Figure
    expect([fig.align, fig.width]).toEqual(['right', '0.25\\textwidth'])
    expect(C.currentAlignment(ed.state)).toBe('right')
    ed.run(C.deleteFigure)
    expect(ed.blocks().some(b => b.type === 'Figure')).toBe(false)
  })

  it('test_equation_numbering_and_delete', () => {
    const ed = new Ed([M.mathBlock('a=b'), M.paragraph([M.text('z')])])
    ed.selectBlock('math_block')
    expect(C.contextObject(ed.state)).toBe('equation')
    ed.run(C.setEquationNumbered(true))
    expect((ed.blocks()[0] as M.MathBlock).numbered).toBe(true)
    ed.run(C.deleteEquation)
    expect(ed.blocks().some(b => b.type === 'MathBlock')).toBe(false)
  })

  it('numbering an align environment moves its star (set_math_block_numbered)', () => {
    const ed = new Ed([M.mathBlock('\\begin{align*}a&=b\\end{align*}'), M.paragraph([])])
    ed.selectBlock('math_block')
    expect(C.currentEquationNumbered(ed.state)).toBe(false)
    ed.run(C.setEquationNumbered(true))
    expect((ed.blocks()[0] as M.MathBlock).latex).toBe('\\begin{align}a&=b\\end{align}')
    expect(C.currentEquationNumbered(ed.state)).toBe(true)
  })

  it('test_table_caption_label_and_column_alignment', () => {
    const ed = new Ed([M.paragraph([M.text('x')]), M.table({ rows: [['a', 'b'], ['1', '2']], alignment: '|l|p{3cm}|' }),
      M.paragraph([M.text('y')])])
    ed.cells(0, 0)
    ed.run(C.setCaption('Results', 'tab:res'))
    ed.cells(0, 0)
    expect(C.currentCaption(ed.state)).toEqual(['Results', 'tab:res'])
    ed.run(C.setColumnAlignment('r'))
    const t = ed.table()
    expect([t.caption, t.label]).toEqual(['Results', 'tab:res'])
    expect(t.alignment).toBe('|r|p{3cm}|')
    expect(t.rows.length).toBe(2)
  })

  it('test_picture_caption', () => {
    const ed = new Ed([M.paragraph([M.text('x')]), M.figure({ path: 'p.png', align: 'right' })])
    ed.selectBlock('figure')
    ed.run(C.setCaption('A red square', 'fig:sq'))
    const fig = ed.blocks().find(b => b.type === 'Figure') as M.Figure
    expect([fig.caption, fig.label, fig.align]).toEqual(['A red square', 'fig:sq', 'right'])
  })
})

describe('keys keep block styles (_keep_styles_across_key)', () => {
  it('Enter at the end of a heading starts body text; inside, splits the heading', () => {
    const ed = new Ed([M.section(2, [M.text('Results')])])
    ed.caretIn(0, 'end')
    ed.key('Enter')
    ed.type('body')
    expect(ed.blocks().map(b => b.type)).toEqual(['Section', 'Paragraph'])
    ed.caretIn(0, 3)
    ed.key('Enter')
    const b = ed.blocks()
    expect(b.map(x => x.type)).toEqual(['Section', 'Section', 'Paragraph'])
    expect(b.slice(0, 2).map(x => (x as M.Section).level)).toEqual([2, 2])
  })

  it('Backspace at the start of a line joins it to the previous line, in that style', () => {
    const ed = new Ed([M.section(1, [M.text('Head')]), M.paragraph([M.text('tail')])])
    ed.caretIn(1, 0)
    ed.key('Backspace')
    expect(ed.blocks()).toEqual([M.section(1, [M.text('Headtail')])])
  })

  it('Shift+Enter breaks the line inside the block (U+2028)', () => {
    const ed = new Ed([M.paragraph([M.text('ab')])])
    ed.caretIn(0, 1)
    ed.key('Shift-Enter')
    expect(ed.blocks()).toEqual([M.paragraph([M.text('a b')], 'justify')])
  })

  it('Enter on an empty list item ends the list; Backspace at an item start lifts it', () => {
    const ed = new Ed([M.list(false, [M.listItem([M.text('one')])])])
    ed.caretIn(0, 'end')
    ed.key('Enter')
    ed.type('two')
    expect((ed.blocks()[0] as M.List).items.length).toBe(2)
    ed.key('Enter')
    ed.key('Enter')
    ed.type('after')
    expect(ed.blocks().map(b => b.type)).toEqual(['List', 'Paragraph'])
    ed.caretIn(1, 0)
    ed.key('Backspace')
    expect(ed.blocks().map(b => b.type)).toEqual(['List', 'Paragraph', 'Paragraph'])
  })

  it('Tab moves through table cells and adds a row after the last', () => {
    const ed = new Ed([M.table({ rows: [['a', 'b']] })])
    ed.cells(0, 0)
    ed.key('Tab')
    ed.key('Tab')
    ed.type('new')
    expect(ed.table().rows).toEqual([['a', 'b'], ['new', '']])
  })
})

describe('formatting commands', () => {
  it('toggle_mark applies to the word under the caret', () => {
    const ed = new Ed([M.paragraph([M.text('hello world')])])
    ed.caretIn(0, 2)
    ed.run(C.toggleMark('bold'))
    expect((ed.blocks()[0] as M.Paragraph).children).toEqual([M.text('hello', ['bold']), M.text(' world')])
    expect(C.isMarkActive(ed.state, 'bold')).toBe(true)
  })

  it('sub- and superscript exclude each other', () => {
    const ed = new Ed([M.paragraph([M.text('x2')])])
    ed.caretIn(0, 1)
    ed.run(C.toggleMark('superscript'))
    ed.run(C.toggleMark('subscript'))
    expect((ed.blocks()[0] as M.Paragraph).children).toEqual([M.text('x2', ['subscript'])])
  })

  it('apply_heading and the numbered toggle', () => {
    const ed = new Ed([M.paragraph([M.text('t')], 'center')])
    ed.caretIn(0)
    ed.run(C.applyHeading(3))
    expect(ed.blocks()[0]).toEqual(M.section(3, [M.text('t')]))
    ed.run(C.toggleHeadingNumbered(false))
    expect(C.isHeadingNumbered(ed.state)).toBe(false)
    expect(C.currentHeadingLevel(ed.state)).toBe(3)
    ed.run(C.applyHeading(-1))
    expect(ed.blocks()[0].type).toBe('Title')
    ed.run(C.applyHeading(0))
    expect(ed.blocks()[0]).toEqual(M.paragraph([M.text('t')], 'justify'))
  })

  it('lists: the lines become items, then the kind changes, then they leave', () => {
    const ed = new Ed([M.paragraph([M.text('a')]), M.paragraph([M.text('b')])])
    ed.state = ed.state.apply(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1, 5)))
    ed.run(C.toggleList(false))
    expect(ed.blocks()).toEqual([M.list(false, [M.listItem([M.text('a')]), M.listItem([M.text('b')])])])
    ed.run(C.toggleList(true))
    expect((ed.blocks()[0] as M.List).ordered).toBe(true)
    ed.run(C.toggleList(true))
    expect(ed.blocks().map(b => b.type)).toEqual(['Paragraph', 'List'])
  })

  it('highlights and comments wrap the selection; accept and reject', () => {
    const ed = new Ed([M.paragraph([M.text('one two three')])])
    ed.state = ed.state.apply(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 5, 8)))
    ed.run(C.addHighlight('green'))
    expect((ed.blocks()[0] as M.Paragraph).children[1]).toEqual(M.highlight([M.text('two')], 'green'))
    ed.state = ed.state.apply(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 9, 14)))
    ed.run(C.addComment('why?', 'Ann', '2026-01-01T00:00:00'))
    expect((ed.blocks()[0] as M.Paragraph).children[3]).toEqual(
      M.comment([M.text('three')], { note: 'why?', author: 'Ann', timestamp: '2026-01-01T00:00:00' }))
    ed.state = ed.state.apply(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1)))
    expect(ed.run(C.findComment(true))).toBe(true)
    ed.run(C.acceptComment)
    expect((ed.blocks()[0] as M.Paragraph).children.at(-1)).toEqual(M.text(' three'))
  })

  it('find, replace and replace all', () => {
    const ed = new Ed([M.paragraph([M.text('cat Cat cat')])])
    const o = { forward: true, caseSensitive: false, wholeWord: false }
    expect(C.find('cat', o, ed.state, tr => { ed.state = ed.state.apply(tr) })).toBe(true)
    expect(ed.state.selection.from).toBe(1)
    expect(C.replaceAll('cat', 'dog', o, ed.state, tr => { ed.state = ed.state.apply(tr) })).toBe(3)
    expect((ed.blocks()[0] as M.Paragraph).children).toEqual([M.text('dog dog dog')])
    expect(C.find('bird', o, ed.state)).toBe(false)
  })

  it('raw blocks split the line at the caret', () => {
    const ed = new Ed([M.paragraph([M.text('abcd')])])
    ed.caretIn(0, 2)
    ed.run(C.insertRawBlock('\\newpage'))
    expect(ed.blocks().map(b => b.type)).toEqual(['Paragraph', 'RawLatex', 'Paragraph'])
    expect((ed.blocks()[1] as M.RawLatex).text).toBe('\\newpage')
  })
})
