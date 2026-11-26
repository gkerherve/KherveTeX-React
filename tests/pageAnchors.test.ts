// MainWindow._first_text_snippet: where each PDF page starts.
import { describe, expect, it } from 'vitest'
import { firstTextSnippet, pageStartSnippets } from '../src/app/pageAnchors.ts'
import type { PdfTextDict } from '../src/core/pdfText.ts'

const page = (...lines: string[]): PdfTextDict => ({
  width: 595, height: 842,
  blocks: [{ type: 0, bbox: [0, 0, 0, 0], lines: lines.map(t => ({ bbox: [0, 0, 0, 0], spans: [{ text: t, size: 10, flags: 0, font: 'x', bbox: [0, 0, 0, 0] }] })) }],
})

describe('first text snippet', () => {
  it('skips running page numbers and bare section numbers', () => {
    expect(firstTextSnippet(page('3', '2.1', 'Body text continues here'))).toBe('Body text continues here')
  })
  it('drops a leading section number', () => {
    expect(firstTextSnippet(page('2.2 Lists'))).toBe('Lists')
    expect(firstTextSnippet(page('A.1 Appendix stuff'))).toBe('Appendix stuff')
  })
  it('collapses whitespace, skips short lines and cuts at 24 characters', () => {
    expect(firstTextSnippet(page('ab', '  The   quick brown fox jumps over the lazy dog'))).toBe('The quick brown fox jump')
  })
  it('is empty for a page with no text', () => {
    expect(firstTextSnippet(page())).toBe('')
  })
})

describe('page start candidates', () => {
  it('offers the next lines too: the editor paints "Chapter 1" and "Abstract" itself', () => {
    expect(pageStartSnippets(page('Chapter 1', 'Introduction', 'Body text'))).toEqual(['Chapter 1', 'Introduction', 'Body text'])
    expect(pageStartSnippets(page('Abstract', 'This is the abstract.'))).toEqual(['Abstract', 'This is the abstract.'])
  })
  it('takes only the title of a contents page: its entries name later headings', () => {
    expect(pageStartSnippets(page('Contents', '1 Introduction 1', '1.1 Background . . . . . 1', '2 Methods 4', 'Interpretation . . . . . 12')))
      .toEqual(['Contents'])
    expect(pageStartSnippets(page('Interpretation . . . . . 12', 'Limitations . . . . . 12', '6 Conclusion 13', 'Bibliography 15'))).toEqual([])
    // Page numbers and entry numbers as lines of their own, as pdf.js reads them.
    expect(pageStartSnippets(page('Contents', '1', 'Introduction', '4', '1.1', 'Background . . . . . . .', '4',
      '1.2', 'Research questions . . . . .', '4', '2', 'Methods', '7', '2.1', 'Model . . . . . .', '7'))).toEqual(['Contents'])
    expect(pageStartSnippets(page('Interpretation . . . . .', '12', 'Limitations . . . . .', '12', '6', 'Conclusion',
      '13', '6.1', 'Summary . . . . .', '13'))).toEqual([])
  })
  it('reads a page of table rows ending in numbers as text, not as a contents page', () => {
    expect(pageStartSnippets(page('Chapter 1', 'Heading 6', 'Item 0', '0', 'note', 'Item 1', '3', 'note', 'Item 2', '6')).slice(0, 3))
      .toEqual(['Chapter 1', 'Heading 6', 'Item 0'])
  })
  it('offers a "Label: text" line without its label', () => {
    expect(pageStartSnippets(page('Keywords: one, two'))).toEqual(['Keywords: one, two', 'one, two'])
  })
})
