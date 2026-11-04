// Port of tests/test_model.py.
import { describe, expect, it } from 'vitest'
import {
  abstract, author, citation, crossRef, docMeta, document, figure, footnote, fromJson,
  inlineRaw, keywords, link, list, listItem, mathBlock, mathInline, paragraph, rawLatex,
  section, table, text, title, toJson,
} from '../src/core/model.ts'

describe('test_model.py', () => {
  it('test_round_trip_preserves_all_node_types', () => {
    const doc = document([
      title([text('My title')]),
      author([text('Jane Doe')]),
      abstract([text('A short summary.')]),
      keywords([text('kw1')]),
      section(2, [text('Heading')]),
      paragraph([
        text('hi ', ['bold', 'italic']),
        mathInline('x^2'),
        link('https://x.com', [text('link')]),
        footnote([text('see below')]),
        citation(['a', 'b'], 'citep'),
        crossRef('sec:1', 'ref'),
        inlineRaw('\\Kstroke'),
      ]),
      list(true, [listItem([text('first')]), listItem([text('second')])]),
      figure({ path: 'img.png', caption: 'Cap', label: 'fig:1', width: '0.5\\textwidth' }),
      table({ rows: [['a', 'b'], ['c', 'd']], caption: 'Cap', alignment: 'll' }),
      mathBlock('\\int x', true, 'eq:i'),
      rawLatex('\\verb|x|'),
    ], docMeta({ title: 'T', author: 'A' }))
    expect(fromJson(toJson(doc))).toEqual(doc)
  })

  it('test_legacy_two_column_bool_loads_as_column_count_2', () => {
    const doc = fromJson('{"type":"Document","meta":{"two_column":true},"children":[]}')
    expect(doc.meta.column_count).toBe(2)
  })

  it('test_legacy_two_column_false_loads_as_column_count_1', () => {
    const doc = fromJson('{"type":"Document","meta":{"two_column":false},"children":[]}')
    expect(doc.meta.column_count).toBe(1)
  })

  it('test_unknown_block_type_raises', () => {
    const bad = '{"type":"Document","meta":{},"children":[{"type":"Sparkle"}]}'
    expect(() => fromJson(bad)).toThrow(/Sparkle/)
  })

  it('test_table_style_round_trips_through_json', () => {
    const doc = document([table({ rows: [['a']], style: 'booktabs' })])
    const back = fromJson(toJson(doc))
    const t = back.children[0]
    expect(t.type).toBe('Table')
    expect(t.type === 'Table' && t.style).toBe('booktabs')
  })
})
