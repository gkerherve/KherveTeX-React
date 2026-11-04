// The .docx importer. KherveTeX has no Python unit tests for import_docx
// (tests/test_importers.py exercises it by hand); these pin the style
// classification against what khervedoc.importers._classify_style returns
// and check a few behaviours the parity corpus also covers end to end.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { _classifyStyle, docxAvailable, importDocx } from '../src/core/docxImport.ts'
import { exportDocx } from '../src/core/docxExport.ts'
import { document, link, list, listItem, paragraph, section, table, text, title } from '../src/core/model.ts'
import { memFs } from './docxMemFs.ts'

const goldenPath = new URL('./golden/docx.json', import.meta.url)
const golden: [string | null, string, number][] = existsSync(goldenPath)
  ? JSON.parse(readFileSync(goldenPath, 'utf8')).classify_style ?? []
  : []

describe('_classify_style parity with Python', () => {
  it('has cases', () => expect(golden.length).toBeGreaterThan(0))
  for (const [name, kind, level] of golden) {
    it(JSON.stringify(name), () => expect(_classifyStyle(name, null)).toEqual([kind, level]))
  }
})

describe('import_docx', () => {
  it('is available', () => expect(docxAvailable()).toBe(true))

  it('reads back what the exporter writes', async () => {
    const fs = memFs()
    const bytes = await exportDocx(document([
      title([text('Doc')]),
      section(2, [text('Part')]),
      paragraph([text('bold', ['bold']), link('https://x.org', [text('site')])], 'center'),
      list(false, [listItem([text('a')]), listItem([text('b')])]),
      table({ rows: [['h1', 'h2'], ['c1', 'c2']] }),
    ]), '', fs)
    const doc = await importDocx(bytes, 'images', fs)
    expect(doc.meta.title).toBe('Doc')
    expect(doc.children.map((b) => b.type)).toEqual(['Title', 'Section', 'Paragraph', 'List', 'Table'])
    const p = doc.children[2]
    expect(p.type === 'Paragraph' && p.alignment).toBe('center')
    expect(p.type === 'Paragraph' && p.children).toEqual([
      text('bold', ['bold']), link('https://x.org', [text('site')]),
    ])
    const t = doc.children[4]
    expect(t.type === 'Table' && t.rows).toEqual([['h1', 'h2'], ['c1', 'c2']])
  })

  it('rejects bytes that are not a package', async () => {
    await expect(importDocx(new Uint8Array([1, 2, 3]), 'images', memFs())).rejects.toThrow(/OSError/)
  })
})
