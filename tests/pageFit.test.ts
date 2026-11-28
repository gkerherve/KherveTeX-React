// What keeps the page view and the PDF page for page (v592): tables that
// fit the text and break when long, the spacing LaTeX sets around lists
// and headings, page starts found where a line repeats, and the lines an
// algorithm prints.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { algorithmRows } from '../src/core/science.ts'
import { autoTableAlignment, breaksTables, serializeDocument, tableIsLong } from '../src/core/serializer.ts'
import { docToPM } from '../src/editor/convert.ts'
import { anchorTargets, layoutDocument, PT_PX } from '../src/editor/layout.ts'

const doc = (blocks: M.Block[], meta: Partial<M.DocMeta> = {}) => M.document(blocks, M.docMeta({ title: '', ...meta }))
const wide = (rows: number) => M.table({
  rows: [['Sample', 'Energy (eV)', 'FWHM', 'Area', 'Comment'],
    ...Array.from({ length: rows }, (_, a) => ['S' + a, '284.80', '1.00', '1000', 'A longer comment that wraps onto a second line in its narrow cell'])],
  caption: 'A table', header: true,
} as never)

describe('automatic table columns', () => {
  it('short tables keep their l columns', () => {
    expect(autoTableAlignment([['a', 'b'], ['1', '2']], 2)).toBe('ll')
  })
  it('wide ones share the line exactly: the table is as wide as the text', () => {
    const spec = autoTableAlignment((wide(3) as M.Table).rows, 5)
    const shares = [...spec.matchAll(/p\{\\dimexpr([\d.]+)\\linewidth-2\\tabcolsep\\relax\}/g)].map(m => Number(m[1]))
    expect(shares).toHaveLength(5)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    // A short column is wide enough for its heading ("Sample", "FWHM" in bold).
    expect(shares[0]).toBeGreaterThanOrEqual(0.12)
    expect(shares[2]).toBeGreaterThanOrEqual(0.1)
    // The long text takes most of the line.
    expect(shares[4]).toBeGreaterThan(0.35)
  })
  it('are set flush left in the PDF, every one of them, with array loaded', () => {
    const tex = serializeDocument(doc([wide(3)]))
    expect(tex).toContain('\\usepackage{array}')
    const line = tex.split('\n').find(l => l.includes('\\begin{tabular}'))!
    expect((line.match(/>\{\\raggedright\\arraybackslash\}p\{/g) ?? []).length).toBe(5)
  })
})

describe('long tables', () => {
  it('a table of many rows is long, a short one is not', () => {
    expect(tableIsLong((wide(40) as M.Table).rows)).toBe(true)
    expect(tableIsLong([['a', 'b'], ['1', '2']])).toBe(false)
  })
  it('is a longtable (it breaks across pages), its header repeated, its caption under it', () => {
    const tex = serializeDocument(doc([wide(40)]))
    expect(tex).toContain('\\usepackage{longtable}')
    expect(tex).toContain('\\begin{longtable}')
    expect(tex).toContain('\\endhead')
    expect(tex).not.toContain('\\begin{tabular}')
    expect(tex.indexOf('\\caption{A table}')).toBeGreaterThan(tex.indexOf('\\endhead'))
  })
  it('a short table stays a tabular in its float', () => {
    const tex = serializeDocument(doc([wide(3)]))
    expect(tex).toContain('\\begin{tabular}')
    expect(tex).not.toContain('\\begin{longtable}')
  })
  it('never in two columns, where longtable does not work', () => {
    expect(breaksTables(M.docMeta({ column_count: 2 }))).toBe(false)
    expect(breaksTables(M.docMeta({ documentclass: 'report' }))).toBe(true)
    expect(serializeDocument(doc([wide(40)], { column_count: 2 }))).not.toContain('\\begin{longtable}')
  })
})

describe('LaTeX spacing in the page view', () => {
  const P = (s: string) => M.paragraph([M.text(s)])
  it('a list: \\topsep + \\partopsep around it, \\itemsep + \\parsep between items (12pt)', () => {
    const L = layoutDocument(docToPM(doc([P('Before.'), M.list(false, [M.listItem([M.text('a')]), M.listItem([M.text('b')]), M.listItem([M.text('c')])]), P('After.')])), M.docMeta({ title: '' }))
    const [, a, b, c, after] = L.blocks
    expect(a.gap).toBeCloseTo(13 * PT_PX, 1)
    expect(b.gap).toBeCloseTo(10 * PT_PX, 1)
    expect(c.gap).toBeCloseTo(10 * PT_PX, 1)
    expect(after.gap).toBeCloseTo(13 * PT_PX, 1)
  })
  it('at 10pt: 10pt around, 8pt between', () => {
    const meta = M.docMeta({ title: '', body_font_pt: 10 })
    const L = layoutDocument(docToPM(M.document([P('Before.'), M.list(false, [M.listItem([M.text('a')]), M.listItem([M.text('b')])]), P('After.')], meta)), meta)
    expect(L.blocks[1].gap).toBeCloseTo(10 * PT_PX, 1)
    expect(L.blocks[2].gap).toBeCloseTo(8 * PT_PX, 1)
  })
  it('a heading straight after a heading leaves only the first one\'s space, less than before text', () => {
    const meta = M.docMeta({ title: '' })
    const two = layoutDocument(docToPM(M.document([P('Text.'), M.section(1, [M.text('A')]), M.section(2, [M.text('B')]), P('Text.')], meta)), meta)
    const one = layoutDocument(docToPM(M.document([P('Text.'), M.section(2, [M.text('B')]), P('Text.')], meta)), meta)
    expect(two.blocks[2].gap).toBeLessThan(one.blocks[1].gap)
    expect(two.blocks[2].gap).toBeGreaterThan(0)
  })
  it('figures and tables stand \\intextsep from the text (14pt at 12pt, 12pt at 10pt)', () => {
    const at = (pt: number) => { const meta = M.docMeta({ title: '', body_font_pt: pt }); return layoutDocument(docToPM(M.document([P('a')], meta)), meta).spacing }
    expect(at(12).intextPx).toBeCloseTo(14 * PT_PX, 5)
    expect(at(10).intextPx).toBeCloseTo(12 * PT_PX, 5)
    expect(at(12).capSkipPx).toBeCloseTo(10 * PT_PX, 5)
  })
})

describe('a project document after others', () => {
  const blocks = [M.section(1, [M.text('Methods')]), M.section(2, [M.text('Samples')]), M.paragraph([M.text('Text.')])]
  it('in a report its Heading 1 is the next chapter, its sections numbered in it', () => {
    const meta = M.docMeta({ title: '', documentclass: 'report' })
    // Two documents before it: two chapters, three sections in the second.
    const L = layoutDocument(docToPM(M.document(blocks, meta)), meta, [0, 2, 3, 0, 0, 0])
    const labels = L.blocks.flatMap(b => [b.number, ...b.above.map(a => a.text)]).join(' | ')
    expect(labels).toContain('Chapter 3')
    expect(labels).toContain('3.1')
  })
  it('in an article its Heading 1 is the next section', () => {
    const meta = M.docMeta({ title: '' })
    const L = layoutDocument(docToPM(M.document(blocks, meta)), meta, [0, 2, 3, 0, 0, 0])
    expect(L.blocks[0].number.trim()).toBe('3')
    expect(L.blocks[1].number.trim()).toBe('3.1')
  })
})

describe('page starts', () => {
  const para = (i: number) => M.paragraph([M.text(`Line ${i}: The sample was cleaned in ultra-high vacuum by repeated cycles of ion bombardment and annealing until no contamination was seen.`)])
  it('a line the document repeats is taken where the page should start, not at its first place', () => {
    const pm = docToPM(doc(Array.from({ length: 60 }, (_, i) => para(i))))
    const t = anchorTargets(pm, [[2, 'bombardment and annealin'], [3, 'bombardment and annealin'], [4, 'bombardment and annealin']])
    expect(t).toHaveLength(3)
    // Three pages on, spread over the document: not all in its first lines.
    const blocks: number[] = []
    pm.forEach((_n, pos) => blocks.push(pos))
    const index = (pos: number) => blocks.indexOf(pos)
    expect(index(t[0].pos)).toBeGreaterThan(8)
    expect(index(t[1].pos)).toBeGreaterThan(index(t[0].pos) + 8)
    expect(index(t[2].pos)).toBeGreaterThan(index(t[1].pos) + 8)
  })
  it('a page starting with a theorem (its label printed, not in its text) starts at the theorem', () => {
    const body = 'Reveal group anneal layer per background strong step terrace defect vacancy dopant carrier mobility gap state density orbital hybrid bond length strain'
    const pm = docToPM(doc([M.paragraph([M.text('Opening words of page one here, and more of them to fill the line.')]), M.theorem('theorem', 'Box', [M.text(body)])]))
    const t = anchorTargets(pm, [[2, 'Theorem 1.1 (Box) Reveal\nbackground strong step te']])
    expect(t).toHaveLength(1)
    expect(t[0].offset).toBe(0)
  })
})

describe('algorithm lines', () => {
  it('include the end lines algpseudocode prints', () => {
    const rows = algorithmRows({ title: 'T', numbers: true, code: 'function F(a)\n  while a > 0\n    a = a - 1\n  return a' })
    expect(rows.map(r => r.text)).toEqual(['function F(a)', 'while a > 0', 'a = a - 1', 'end while', 'return a', 'end function'])
    expect(rows.map(r => r.indent)).toEqual([0, 1, 2, 1, 1, 0])
  })
  it('an else closes nothing', () => {
    const rows = algorithmRows({ title: '', numbers: false, code: 'if x\n  a = 1\nelse\n  a = 2' })
    expect(rows.map(r => r.text)).toEqual(['if x', 'a = 1', 'else', 'a = 2', 'end if'])
  })
})
