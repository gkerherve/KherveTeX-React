/// <reference lib="dom" />
// The visual editor's model ⇄ ProseMirror conversion is lossless: every
// golden document comes back from the editor with the same document.json.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { canonicalBlock, docFromPM, docToPM, normalizeDoc } from '../src/editor/convert.ts'

const docs: Record<string, { document_json: string }> = JSON.parse(
  readFileSync(new URL('./golden/documents.json', import.meta.url), 'utf-8'))

const roundTrip = (d: M.Document) => docFromPM(docToPM(d), d.meta)
// What an edited block comes back as: the Qt editor's reading of it.
const edited = (d: M.Document) => {
  const blocks: M.Block[] = []
  docToPM(d).forEach(n => { const b = canonicalBlock(n); if (b) blocks.push(b) })
  return M.document(blocks, d.meta)
}

describe('golden documents round-trip through the editor', () => {
  it.each(Object.keys(docs))('%s', (name) => {
    const doc = M.fromJson(docs[name].document_json)
    expect(M.toJson(roundTrip(doc))).toBe(docs[name].document_json)
  })
})

describe('an unedited block comes back verbatim, an edited one as Qt reads it', () => {
  it('merges same-mark neighbours and drops empty runs, like Qt fragments', () => {
    const doc = M.document([M.paragraph([M.text('a', ['bold']), M.text(''), M.text('b', ['bold'])])])
    expect(M.toJson(roundTrip(doc))).toBe(M.toJson(doc))
    expect(edited(doc).children).toEqual(normalizeDoc(doc).children)
    expect((edited(doc).children[0] as M.Paragraph).children).toEqual([M.text('ab', ['bold'])])
  })

  it('keeps marks in the order Python reads them back', () => {
    const doc = M.document([M.paragraph([M.text('x', ['code', 'italic', 'bold'])])])
    expect(M.toJson(roundTrip(doc))).toBe(M.toJson(doc))
    expect((edited(doc).children[0] as M.Paragraph).children).toEqual([M.text('x', ['bold', 'italic', 'code'])])
  })
})

describe('inline wrappers keep their structure', () => {
  const cases: [string, M.Inline[]][] = [
    ['two neighbouring links', [M.link('u', [M.text('a')]), M.link('u', [M.text('b')])]],
    ['a link with formatted text and math', [M.link('http://x', [M.text('a', ['bold']), M.mathInline('x^2'), M.text('b')])]],
    ['a highlight inside a link', [M.link('u', [M.text('a'), M.highlight([M.text('b', ['italic'])], 'green'), M.text('c')])]],
    ['a link inside a highlight', [M.highlight([M.link('u', [M.text('a')])], 'pink')]],
    ['a comment over a citation', [M.comment([M.text('see '), M.citation(['k1', 'k2'], 'citep')],
      { note: 'n', author: 'A', timestamp: 't', resolved: true })]],
    ['an empty link', [M.text('a'), M.link('http://only-url', []), M.text('b')]],
    ['a footnote with math', [M.text('x'), M.footnote([M.text('note '), M.mathInline('y')])]],
    ['line separators', [M.text('a\u2028b', ['bold']), M.inlineRaw('\\\\'), M.text('\u2028')]],
    ['cross-references', [M.crossRef('eq:1', 'eqref'), M.crossRef('s', 'pageref')]],
  ]
  it.each(cases)('%s', (_name, inlines) => {
    const doc = M.document([M.paragraph(inlines, 'left'), M.section(2, inlines, false, 'sec:a')])
    expect(M.toJson(roundTrip(doc))).toBe(M.toJson(doc))
  })
})

describe('blocks keep every field', () => {
  it('tables with merges, shading, raw cells and styles', () => {
    const t = M.table({
      rows: [['\\textbf{H}', 'b', 'c'], ['d', '', 'f'], ['$x$', 'h', 'i']],
      caption: 'Cap', label: 'tab:x', alignment: 'l|cr', style: 'booktabs',
      merges: [[0, 1, 2, 1]], header: true, repeat_header: true, shading: { '0,0': '#ffeb3b', '2,2': '#eeeeee' },
    })
    const doc = M.document([t])
    expect(M.toJson(roundTrip(doc))).toBe(M.toJson(doc))
  })

  it('a table as the Qt editor rebuilds it', () => {
    const t = M.table({ rows: [['a'], ['b', 'c']], merges: [[0, 0, 5, 1]], shading: { '9,9': '#000000' } })
    const doc = M.document([t])
    expect(M.toJson(roundTrip(doc))).toBe(M.toJson(doc))
    expect(M.toJson(edited(doc))).toBe(M.toJson(normalizeDoc(doc)))
    expect((edited(doc).children[0] as M.Table).rows).toEqual([['a', ''], ['', 'c']])
  })

  it('figures, math, theorems, raw LaTeX and figure* summaries', () => {
    const doc = M.document([
      M.figure({ path: 'a.png', caption: 'c', label: 'fig:a', width: '0.5\\textwidth', source: 'drawing', align: 'left' }),
      M.mathBlock('a\nb', true, 'eq:x'),
      M.theorem('lemma', 'Zorn', [M.text('t')], true), M.theorem('lemma', 'Zorn', [], false),
      M.rawLatex('\\begin{verbatim}\n  x\n\\end{verbatim}'), M.rawLatex(''),
      M.rawLatex('\\begin{figure*}\\includegraphics{x}\\caption{C}\\end{figure*}'),
      M.list(true, [M.listItem([M.text('one')]), M.listItem([])]), M.list(false, []),
      M.title([M.text('T')]), M.author([]), M.affiliation([M.text('A')]), M.correspondence([M.text('C')]),
      M.abstract([M.text('Ab')]), M.keywords([M.text('k')]), M.frame([M.text('F')]),
      M.section(0, [M.text('Ch')], false, null),
    ])
    expect(M.toJson(roundTrip(doc))).toBe(M.toJson(doc))
  })

  it('an empty document shows the line every Qt document has, and stays empty', () => {
    const doc = M.document([])
    expect(docToPM(doc).childCount).toBe(1)
    expect(roundTrip(doc).children).toEqual([])
    expect(edited(doc).children).toEqual([M.paragraph([], 'justify')])
  })
})
