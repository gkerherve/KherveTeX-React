// Port of tests/test_docx_exporter.py — model → .docx round-trip verification.
import { describe, expect, it } from 'vitest'
import { exportDocx } from '../src/core/docxExport.ts'
import {
  abstract, author, docMeta, document, keywords, list, listItem, mathBlock, mathInline,
  paragraph, section, table, text, title,
} from '../src/core/model.ts'
import type { Document } from '../src/core/model.ts'
import { memFs } from './docxMemFs.ts'
import { readDocx } from './docxRead.ts'

// Export and re-open it, as docx.Document(path) does.
const exportAndRead = async (doc: Document) => readDocx(await exportDocx(doc, '', memFs()))

const Cm = (x: number) => Math.trunc(x * 360000)

describe('test_docx_exporter.py', () => {
  it('test_title_and_author', async () => {
    const doc = document([title([text('My Paper')]), author([text('Jane Doe')])])
    const out = await exportAndRead(doc)
    const styles = out.paragraphs.map((p) => p.style)
    expect(styles).toContain('Title')
    expect(styles).toContain('Subtitle')
    expect(out.paragraphs[0].text).toBe('My Paper')
    expect(out.paragraphs[1].text).toBe('Jane Doe')
  })

  it('test_section_levels', async () => {
    const doc = document([
      section(1, [text('Intro')]),
      section(2, [text('Sub')]),
      section(3, [text('SubSub')]),
    ])
    const out = await exportAndRead(doc)
    expect(out.paragraphs[0].style).toBe('Heading 1')
    expect(out.paragraphs[1].style).toBe('Heading 2')
    expect(out.paragraphs[2].style).toBe('Heading 3')
  })

  it('test_paragraph_with_marks', async () => {
    const doc = document([
      paragraph([text('bold', ['bold']), text(' normal'), text(' italic', ['italic'])]),
    ])
    const out = await exportAndRead(doc)
    const runs = out.paragraphs[0].runs
    expect(runs[0].bold).toBe(true)
    expect(runs[0].text).toBe('bold')
    expect(runs[2].italic).toBe(true)
  })

  it('test_paragraph_alignment', async () => {
    const doc = document([paragraph([text('centered')], 'center')])
    const out = await exportAndRead(doc)
    expect(out.paragraphs[0].alignment).toBe('center')  // WD_ALIGN_PARAGRAPH.CENTER
  })

  it('test_bullet_list', async () => {
    const doc = document([list(false, [listItem([text('one')]), listItem([text('two')])])])
    const out = await exportAndRead(doc)
    expect(out.paragraphs.length).toBe(2)
    expect(out.paragraphs[0].text).toBe('one')
    expect(out.paragraphs[1].text).toBe('two')
  })

  it('test_table_export', async () => {
    const doc = document([table({ rows: [['Name', 'Age'], ['Alice', '30']], caption: 'People' })])
    const out = await exportAndRead(doc)
    expect(out.tables.length).toBe(1)
    const tbl = out.tables[0]
    expect(tbl.rows[0].cells[0].text).toBe('Name')
    expect(tbl.rows[1].cells[1].text).toBe('30')
  })

  it('test_math_block', async () => {
    const out = await exportAndRead(document([mathBlock('E = mc^2')]))
    expect(out.paragraphs[0].text).toContain('E = mc^2')
  })

  it('test_inline_math', async () => {
    const doc = document([paragraph([text('Energy is '), mathInline('E=mc^2')])])
    const out = await exportAndRead(doc)
    expect(out.paragraphs[0].text).toContain('E=mc^2')
  })

  it('test_page_margins', async () => {
    const meta = docMeta({ margin_top_cm: 3.0, margin_bottom_cm: 3.0, margin_left_cm: 2.0, margin_right_cm: 2.0 })
    const out = await exportAndRead(document([paragraph([text('hello')])], meta))
    const s = out.sections[0]
    expect(Math.abs(s.top_margin - Cm(3.0))).toBeLessThan(Cm(0.01))
    expect(Math.abs(s.left_margin - Cm(2.0))).toBeLessThan(Cm(0.01))
  })

  it('test_abstract_and_keywords', async () => {
    const doc = document([
      abstract([text('This is the abstract.')]),
      keywords([text('python, latex')]),
    ])
    const out = await exportAndRead(doc)
    expect(out.paragraphs[0].text).toContain('This is the abstract.')
    expect(out.paragraphs[1].text).toContain('Keywords:')
    expect(out.paragraphs[1].text).toContain('python, latex')
  })

  it('test_core_properties', async () => {
    const meta = docMeta({ title: 'Test Title', author: 'John Smith' })
    const out = await exportAndRead(document([paragraph([text('body')])], meta))
    expect(out.core_properties.title).toBe('Test Title')
    expect(out.core_properties.author).toBe('John Smith')
  })
})

describe('exportDocx extras', () => {
  it('reports progress after every block', async () => {
    const seen: [number, number][] = []
    await exportDocx(document([paragraph([text('a')]), paragraph([text('b')])]), '', memFs(),
      (i, n) => seen.push([i, n]))
    expect(seen).toEqual([[1, 2], [2, 2]])
  })
})
