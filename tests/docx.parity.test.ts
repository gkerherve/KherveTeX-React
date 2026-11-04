// .docx import and export parity with the Python app (python-docx 1.2).
// The corpus is written by scripts/make_golden_docx.py.
import { existsSync, readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { importDocx } from '../src/core/docxImport.ts'
import { exportDocx } from '../src/core/docxExport.ts'
import { fromJson, toJson } from '../src/core/model.ts'
import { fromB64, memFs, toB64 } from './docxMemFs.ts'

interface ImportCase { docx: string; imported_json: string; images: Record<string, string> }
interface ExportCase {
  document_json: string
  error?: string
  entries?: string[]
  parts?: Record<string, string>
  media?: Record<string, string>
  roundtrip_json?: string
  roundtrip_images?: string[]
}
interface Corpus {
  import: Record<string, ImportCase>
  export: Record<string, ExportCase>
  files: Record<string, string>
}

const path = new URL('./golden/docx.json', import.meta.url)
const corpus: Corpus = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : { import: {}, export: {}, files: {} }

const errorOf = (e: unknown) => `!ERROR ${(e as { type?: string }).type ?? (e as Error).name}`

async function runImport(bytes: Uint8Array) {
  const fs = memFs()
  let json: string
  try {
    json = toJson(await importDocx(bytes, 'images', fs))
  } catch (e) {
    json = errorOf(e)
  }
  const images: Record<string, string> = {}
  for (const [k, v] of [...fs.files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (k.startsWith('images/')) images[k.slice('images/'.length)] = toB64(v)
  }
  return { json, images }
}

describe('import_docx parity with Python', () => {
  const cases = Object.entries(corpus.import)
  it('has cases', () => expect(cases.length).toBeGreaterThan(0))
  for (const [name, c] of cases) {
    it(name, async () => {
      const got = await runImport(fromB64(c.docx))
      expect(got.json).toBe(c.imported_json)
      expect(got.images).toEqual(c.images)
    })
  }
})

describe('export_docx parity with Python', () => {
  const cases = Object.entries(corpus.export)
  it('has cases', () => expect(cases.length).toBeGreaterThan(0))
  const files = Object.fromEntries(Object.entries(corpus.files).map(([k, v]) => [k, fromB64(v)]))
  for (const [name, c] of cases) {
    it(name, async () => {
      let bytes: Uint8Array
      try {
        bytes = await exportDocx(fromJson(c.document_json), '', memFs(files))
      } catch (e) {
        expect(errorOf(e)).toBe(c.error ?? '(no error)')
        return
      }
      expect(c.error).toBeUndefined()
      const z = unzipSync(bytes)
      expect(Object.keys(z)).toEqual(c.entries)
      for (const [part, text] of Object.entries(c.parts!)) expect(strFromU8(z[part]), part).toBe(text)
      for (const [part, b64] of Object.entries(c.media!)) expect(toB64(z[part]), part).toBe(b64)
      const rt = await runImport(bytes)
      expect(rt.json).toBe(c.roundtrip_json)
      expect(Object.keys(rt.images).sort()).toEqual(c.roundtrip_images)
    })
  }
})
