// Port of KherveTeX tests/test_references.py: citation / cross-reference
// display resolution for the visual editor.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  citation, document, figure, mathBlock, paragraph, rawLatex, section, table, text,
} from '../src/core/model.ts'
import type { Block } from '../src/core/model.ts'
import { ReferenceResolver, parseBibtex, shortAuthor } from '../src/core/references.ts'
import { nodeFs } from './nodeFs.ts'

const BIB = String.raw`
@article{smith2020,
  author = {Smith, John and Doe, Anne and Roe, Bob},
  title = {A {Great} Paper},
  year = 2020,
}
@book{doe19, author = "Anne Doe", year = "2019", title = "Book"}
@comment{ignored}
`

const _doc = (...blocks: Block[]) => document(blocks)

const tmpWithBib = () => {
  const d = mkdtempSync(join(tmpdir(), 'refs-'))
  writeFileSync(join(d, 'refs.bib'), BIB, 'utf-8')
  return d
}

describe('references', () => {
  it('test_parse_bibtex_fields', () => {
    const e = parseBibtex(BIB)
    expect(e.get('smith2020')!.year).toBe('2020')
    expect(e.get('smith2020')!.title).toContain('Great')
    expect(e.get('doe19')!.author).toBe('Anne Doe')
    expect(e.has('ignored')).toBe(false)
  })

  it('test_short_author', () => {
    expect(shortAuthor('Smith, John and Doe, Anne and Roe, Bob')).toBe('Smith et al.')
    expect(shortAuthor('Anne Doe and Bo Li')).toBe('Doe and Li')
    expect(shortAuthor('Anne Doe')).toBe('Doe')
  })

  it('test_numeric_citations_follow_first_appearance', async () => {
    const tmpPath = tmpWithBib()
    const doc = _doc(
      paragraph([citation(['doe19']), citation(['smith2020', 'doe19']), citation(['nope'])]),
      rawLatex(String.raw`\bibliography{refs}`),
    )
    const r = await ReferenceResolver.load(doc, tmpPath, '', nodeFs)
    expect(r.citeText(['doe19'])).toBe('[1]')
    expect(r.citeText(['smith2020', 'doe19'])).toBe('[2, 1]')
    expect(r.citeText(['nope'])).toBe('[nope?]')
  })

  it('test_author_year_styles', async () => {
    const tmpPath = tmpWithBib()
    const doc = _doc(rawLatex(String.raw`\addbibresource{refs.bib}`))
    const r = await ReferenceResolver.load(doc, tmpPath, '', nodeFs)
    expect(r.citeText(['smith2020'], 'citet')).toBe('Smith et al. (2020)')
    expect(r.citeText(['smith2020', 'doe19'], 'citep')).toBe('(Smith et al., 2020; Doe, 2019)')
  })

  it('test_thebibliography_labels', () => {
    const doc = _doc(paragraph([citation(['a'])]),
      rawLatex('\\begin{thebibliography}{9}\n\\bibitem[Ab99]{a} x\n\\end{thebibliography}'))
    expect(new ReferenceResolver(doc).citeText(['a'])).toBe('[Ab99]')
  })

  it('test_label_numbering', () => {
    const doc = _doc(
      section(1, [text('A')], true, 'sec:a'),
      section(2, [text('A1')], true, 'sec:a1'),
      section(1, [text('Unnumbered')], false),
      section(1, [text('B')], true, 'sec:b'),
      mathBlock('x', true, 'eq:x'),
      figure({ label: 'fig:1' }), table({ label: 'tab:1' }),
    )
    const r = new ReferenceResolver(doc)
    expect(r.refText('sec:a')).toBe('1')
    expect(r.refText('sec:a1')).toBe('1.1')
    expect(r.refText('sec:b')).toBe('2')
    expect(r.refText('eq:x', 'eqref')).toBe('(1)')
    expect(r.refText('fig:1')).toBe('1')
    expect(r.refText('tab:1')).toBe('1')
    expect(r.refText('missing')).toBe('??')
  })

  it('test_chapter_prefixes', () => {
    const doc = _doc(section(0, [text('C1')]), section(1, [text('S')], true, 's'), figure({ label: 'f' }))
    const r = new ReferenceResolver(doc)
    expect(r.refText('s')).toBe('1.1')
    expect(r.refText('f')).toBe('1.1')
  })
})
