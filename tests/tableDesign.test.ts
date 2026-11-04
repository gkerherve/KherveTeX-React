// Port of tests/test_table_design.py (serializer and model parts).
import { describe, expect, it } from 'vitest'
import { document, fromJson, paragraph, table, text, toJson } from '../src/core/model.ts'
import type { Table } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { serializeDocument as typst } from '../src/core/typstSerializer.ts'

const makeTable = (kw: Partial<Omit<Table, 'type'>> = {}): Table => table({
  rows: [['Name', 'A', 'B'], ['x', '1', ''], ['y', '2', '3'], ['', '4', '5']],
  caption: 'T', label: 'tab:t', alignment: 'lcr',
  merges: [[1, 1, 1, 2], [2, 0, 2, 1]], header: true,
  shading: { '1,1': '#ffeb3b' },
  ...kw,
})

const tex = (t: Table) => serializeDocument(document([paragraph([text('x')]), t]))

describe('test_table_design.py', () => {
  it('test_latex_merges_header_shading', () => {
    const out = tex(makeTable())
    expect(out).toContain('\\textbf{Name} & \\textbf{A} & \\textbf{B}')
    expect(out).toContain('\\multicolumn{2}{c}{\\cellcolor[HTML]{FFEB3B}1}')
    expect(out).toContain('\\multirow{2}{*}{y}')
    for (const pkg of ['multirow', 'colortbl', 'xcolor']) expect(out).toContain(`\\usepackage{${pkg}}`)
  })

  it('test_grid_rules_skip_a_vertically_merged_cell', () => {
    const out = tex(makeTable({ style: 'grid', alignment: '|l|c|r|' }))
    expect(out).toContain('\\multirow{2}{*}{y} & 2 & 3 \\\\ \\cline{2-3}')
  })

  it('test_repeat_header_makes_longtable', () => {
    const out = tex(makeTable({ repeat_header: true, style: 'striped' }))
    expect(out).toContain('\\begin{longtable}{lcr}')
    expect(out).toContain('\\endhead')
    expect(out).toContain('\\usepackage{longtable}')
    expect(out).toContain('\\rowcolor[HTML]{EEF3FA}')
  })

  describe('test_latex_round_trip', () => {
    for (const repeat of [false, true]) {
      for (const style of ['', 'grid', 'plain', 'booktabs', 'striped']) {
        it.skip(`[${style}-${repeat}] — needs importers (import_tex), not ported yet`, () => {})
      }
    }
  })

  it('test_json_round_trip_and_defaults', () => {
    const t = makeTable({ repeat_header: true })
    expect(fromJson(toJson(document([t]))).children[0]).toEqual(t)
    const legacy = fromJson('{"type": "Document", "children": [{"type": "Table", "rows": [["a"]]}]}').children[0]
    expect(legacy.type).toBe('Table')
    if (legacy.type !== 'Table') return
    expect([legacy.merges, legacy.header, legacy.shading]).toEqual([[], false, {}])
  })

  it('test_typst_cells', () => {
    const out = typst(document([makeTable({ repeat_header: true })]))
    expect(out).toContain('table.header([*Name*], [*A*], [*B*])')
    expect(out).toContain('table.cell(colspan: 2, fill: rgb("#ffeb3b"))[1]')
    expect(out).toContain('table.cell(rowspan: 2)[y]')
  })

  it.skip('test_word_export — needs the docx exporter, not ported', () => {})
  it.skip('test_editor_header_sort_shading_style — Qt editor', () => {})
  it.skip('test_editor_merge_and_split — Qt editor', () => {})
})
