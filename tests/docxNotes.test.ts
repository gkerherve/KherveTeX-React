// The Word export writes what Word itself has: footnotes, signed comments,
// numbered citations with their reference list, cross-reference numbers
// and equations Word can edit.
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { exportDocx } from '../src/core/docxExport.ts'
import type { DocxOptions } from '../src/core/docxExport.ts'
import { importDocx } from '../src/core/docxImport.ts'
import { ommlDisplay, ommlInline } from '../src/core/latexOmml.ts'
import { ommlToLatex, splitNumber } from '../src/core/omml.ts'
import {
  citation, comment, crossRef, docMeta, document, figure, footnote, link, mathBlock, paragraph, rawLatex,
  section, text,
} from '../src/core/model.ts'
import type { Document } from '../src/core/model.ts'
import { memFs } from './docxMemFs.ts'

async function parts(doc: Document, opts: DocxOptions = {}): Promise<Record<string, string>> {
  const z = unzipSync(await exportDocx(doc, '', memFs(), null, opts))
  return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, k.endsWith('.xml') || k.endsWith('.rels') ? strFromU8(v) : '']))
}

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
function back(xml: string): string {
  const d = new DOMParser().parseFromString(`<r xmlns:m="${M}">${xml}</r>`, 'text/xml')
  return ommlToLatex(d.getElementsByTagNameNS(M, 'oMath')[0] as never)
}

describe('Word footnotes', () => {
  it('writes footnotes.xml and a reference in the text', async () => {
    const doc = document([paragraph([text('Body'), footnote([text('See '), link('https://example.org', [text('here')])])])])
    const p = await parts(doc)
    expect(p['word/document.xml']).toContain('<w:footnoteReference w:id="1"/>')
    expect(p['word/footnotes.xml']).toContain('<w:footnote w:id="1">')
    expect(p['word/footnotes.xml']).toContain('w:type="separator"')
    expect(p['word/footnotes.xml']).toContain('<w:t>here</w:t>')
    expect(p['word/_rels/footnotes.xml.rels']).toContain('Target="https://example.org"')
    expect(p['word/_rels/document.xml.rels']).toMatch(/relationships\/footnotes" Target="footnotes.xml"/)
    expect(p['[Content_Types].xml']).toContain('PartName="/word/footnotes.xml"')
    expect(p['word/document.xml']).not.toContain('[See')
  })

  it('adds no part to a document without notes', async () => {
    const p = await parts(document([paragraph([text('x')])]))
    expect(Object.keys(p)).not.toContain('word/footnotes.xml')
    expect(Object.keys(p)).not.toContain('word/comments.xml')
  })
})

describe('Word comments', () => {
  it('are signed with their author, or with Your name', async () => {
    const doc = document([paragraph([
      comment([text('this')], { note: 'Check it', author: 'Ann Lee', timestamp: '2026-11-22 10:15' }),
      text(' and '),
      comment([text('that')], { note: 'Mine' }),
    ])])
    const p = await parts(doc, { author: 'Gwilherm K' })
    const d = p['word/document.xml']
    expect(d).toContain('<w:commentRangeStart w:id="0"/><w:r><w:t>this</w:t></w:r><w:commentRangeEnd w:id="0"/>')
    expect(d).toContain('<w:commentReference w:id="1"/>')
    const c = p['word/comments.xml']
    expect(c).toMatch(/<w:comment w:id="0" w:author="Ann Lee" w:initials="AL" w:date="2026-11-22T\d\d:15:00Z">/)
    expect(c).toContain('<w:t>Check it</w:t>')
    expect(c).toContain('w:author="Gwilherm K" w:initials="GK"')
    expect(p['word/document.xml']).not.toContain('[Check it]')
  })
})

describe('citations and cross-references', () => {
  const bib = '@article{smith2020, author={Smith, John}, title={Decay}, journal={Phys. Rev.}, year={2020}}\n'
    + '@book{doe2019, author={Doe, Jane}, title={A Book}, publisher={Pub}, year={2019}}\n'

  it('numbers citations and writes the reference list', async () => {
    const doc = document([paragraph([text('As shown '), citation(['smith2020', 'doe2019'])])],
      docMeta({ ref_library: 'document', bib_style: 'unsrt' }))
    const d = (await parts(doc, { bibText: bib }))['word/document.xml']
    expect(d).toContain('<w:t>[1, 2]</w:t>')
    expect(d).toContain('<w:t>References</w:t>')
    expect(d).toContain('<w:t>[1]</w:t><w:tab/>')
    expect(d).toContain('Smith. ')
    expect(d).toContain('<w:t>Phys. Rev.</w:t>')
  })

  it('prints author-year citations as the PDF does', async () => {
    const doc = document([paragraph([citation(['smith2020'], 'citep')])], docMeta({ ref_library: 'document' }))
    const d = (await parts(doc, { bibText: bib }))['word/document.xml']
    expect(d).toContain('[Smith, 2020]')
  })

  it('a thebibliography list prints as a reference list', async () => {
    const doc = document([paragraph([citation(['a'])]),
      rawLatex('\\begin{thebibliography}{9}\n\\bibitem{a} A. Author, \\emph{Title}, 2001.\n\\end{thebibliography}')])
    const d = (await parts(doc))['word/document.xml']
    expect(d).toContain('<w:t>[1]</w:t>')
    expect(d).toContain('A. Author, Title, 2001.')
    expect(d).not.toContain('bibitem')
  })

  it('cross-references print the numbers, and headings and captions carry them', async () => {
    const doc = document([
      section(1, [text('Intro')]),
      figure({ path: 'missing.png', caption: 'A plot', label: 'fig:a' }),
      mathBlock('a=b', true, 'eq:a'),
      paragraph([text('See Figure '), crossRef('fig:a'), text(' and '), crossRef('eq:a', 'eqref')]),
    ])
    const d = (await parts(doc))['word/document.xml']
    expect(d).toContain('<w:t>1</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t>')
    expect(d).toContain('<w:t>(1)</w:t>')
    expect(d).toContain('<w:t xml:space="preserve">Figure 1: </w:t>')
    expect(d).toContain('<w:t xml:space="preserve">1\u2003</w:t>')
    // The number at the right margin, in the equation's own row.
    expect(d).toMatch(/<w:jc w:val="right"\/><\/w:pPr><w:r><w:t>\(1\)<\/w:t><\/w:r>/)
  })
})

describe('LaTeX to Word equations', () => {
  const cases: [string, string][] = [
    ['E = mc^2', 'E=mc^{2}'],
    ['x_i^2 + y_{ij}', 'x_{i}^{2}+y_{ij}'],
    ['\\frac{a+b}{c}', '\\frac{a+b}{c}'],
    ['\\sqrt{x} + \\sqrt[3]{y}', '\\sqrt{x}+\\sqrt[3]{y}'],
    ['\\sum_{i=1}^{n} x_i = 1', '\\sum_{i=1}^{n}{x_{i}}=1'],
    ['\\left( \\frac{1}{2} \\right)', '\\left(\\frac{1}{2}\\right)'],
    ['\\alpha + \\beta \\le \\gamma', '\\alpha +\\beta \\leq \\gamma'],
    ['\\hat{x} + \\vec{v}', '\\hat{x}+\\vec{v}'],
    ['\\sin x', '\\sin{x}'],
    ['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', '\\left(\\begin{matrix}1 & 2 \\\\ 3 & 4\\end{matrix}\\right)'],
    ['\\begin{align} a &= b \\\\ c &= d \\end{align}', '\\begin{aligned}a&=b \\\\ c&=d\\end{aligned}'],
    ['\\text{if } x', '\\text{if }x'],
    ["f'(x) - 1", "f'(x)-1"],
  ]
  for (const [tex, want] of cases) {
    it(`round-trips ${tex}`, () => expect(back(ommlInline(tex))).toBe(want))
  }

  it('keeps an unknown command readable', () => {
    expect(ommlInline('\\foo x')).toContain('\\foo')
  })

  it('a numbered equation comes back with its number', () => {
    expect(splitNumber(back(ommlDisplay('a=b', '2')))).toEqual(['a=b', true])
  })

  it('an exported equation imports back as an equation', async () => {
    const bytes = await exportDocx(document([mathBlock('\\frac{1}{2}', true), paragraph([text('x')])]), '', memFs())
    const doc = await importDocx(bytes, 'images', memFs())
    expect(doc.children[0]).toMatchObject({ type: 'MathBlock', latex: '\\frac{1}{2}', numbered: true })
  })
})
