// MainWindow._first_text_snippet: where each PDF page starts.
import { describe, expect, it } from 'vitest'
import { firstTextSnippet } from '../src/app/pageAnchors.ts'
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
