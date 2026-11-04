// Port of tests/test_pdf_importer.py — PDF → document model.
//
// Python builds each fixture with PyMuPDF at test time; there is no PDF
// writer here, so the same fixtures (built by the same calls in
// scripts/make_golden_pdf.py) are read from tests/golden/pdf.json.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Block, Inline } from '../src/core/model.ts'
import { _pdfIsSidebar, _pdfTitleOverlap, importPdf, pdfAvailable } from '../src/core/pdfImport.ts'
import type { PdfJsLib } from '../src/core/pdfText.ts'
import { nodeFs } from './nodeFs.ts'

const golden = JSON.parse(readFileSync(new URL('./golden/pdf.json', import.meta.url), 'utf8')) as {
  cases: Record<string, { pdf: string }>
}

const loadPdfJs = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLib
const pdfjsDir = fileURLToPath(new URL('../node_modules/pdfjs-dist/', import.meta.url))
const pdfjsOptions = { wasmUrl: `${pdfjsDir}wasm/`, cMapUrl: `${pdfjsDir}cmaps/`, cMapPacked: true }

// _make_pdf(callback): the fixture PDF the Python test builds.
const makePdf = (name: string): Uint8Array => Uint8Array.from(Buffer.from(golden.cases[name].pdf, 'base64'))
const mkdtemp = () => mkdtempSync(join(tmpdir(), 'pdfimport-'))

const ofType = <T extends Block['type']>(bs: Block[], t: T) =>
  bs.filter((b) => b.type === t) as Extract<Block, { type: T }>[]
const plainText = (xs: Inline[]) => xs.map((i) => (i.type === 'Text' ? i.text : '')).join('').trim()

const run = (name: string, progress: ((c: number, t: number) => void) | null = null, imageDir = mkdtemp()) =>
  importPdf(makePdf(name), imageDir, nodeFs, progress, { loadPdfJs, pdfjsOptions })

describe('test_pdf_importer', () => {
  it('test_basic_paragraph', async () => {
    const result = await run('basic_paragraph')
    const texts = ofType(result.children, 'Paragraph').map((b) => plainText(b.children))
    expect(texts.some((t) => t.includes('Hello world'))).toBe(true)
  })

  it('test_heading_detected_by_size', async () => {
    const result = await run('heading_detected_by_size')
    const sections = ofType(result.children, 'Section')
    const paragraphs = ofType(result.children, 'Paragraph')
    // The large text should be classified as a section (heading).
    expect(sections.length).toBeGreaterThanOrEqual(1)
    expect(paragraphs.length).toBeGreaterThanOrEqual(1)
  })

  it('test_multi_page', async () => {
    const result = await run('multi_page')
    expect(ofType(result.children, 'Paragraph').length).toBeGreaterThanOrEqual(3)
  })

  it('test_progress_callback', async () => {
    const calls: [number, number][] = []
    await run('progress_callback', (current, total) => calls.push([current, total]))
    expect(calls.length).toBe(2)
    expect(calls[calls.length - 1]).toEqual([2, 2])
  })

  it('test_image_extraction', async () => {
    const result = await run('image_extraction')
    const figures = ofType(result.children, 'Figure')
    expect(figures.length).toBeGreaterThanOrEqual(1)
    expect(existsSync(figures[0].path)).toBe(true)
  })
})

// The helpers import_pdf leans on (no Python test of their own).
describe('pdf importer helpers', () => {
  it('is always available', () => expect(pdfAvailable()).toBe(true))

  it('spots rotated sidebar text', () => {
    expect(_pdfIsSidebar([20, 100, 40, 700], 842)).toBe(true)
    expect(_pdfIsSidebar([20, 100, 60, 700], 842)).toBe(false)
    expect(_pdfIsSidebar([20, 100, 40, 300], 842)).toBe(false)
  })

  it('measures title overlap by words, case-insensitively', () => {
    expect(_pdfTitleOverlap('Oxygen  Vacancies', 'oxygen vacancies at the surface')).toBe(1.0)
    expect(_pdfTitleOverlap('one two three four', 'one two')).toBe(0.5)
    expect(_pdfTitleOverlap('   ', 'anything')).toBe(0.0)
  })
})
