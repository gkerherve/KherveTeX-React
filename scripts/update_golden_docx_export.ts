// Rewrite the export cases of tests/golden/docx.json from this app's own
// Word export, after a change meant to alter it (the Python app is frozen;
// see CLAUDE.md). The documents, the import cases and the files stay.
//
//   node scripts/update_golden_docx_export.ts [in.json] [out.json]
//
// Both default to tests/golden/docx.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { exportDocx } from '../src/core/docxExport.ts'
import { importDocx } from '../src/core/docxImport.ts'
import { fromJson, toJson } from '../src/core/model.ts'
import { fromB64, memFs, toB64 } from '../tests/docxMemFs.ts'

const GOLDEN = new URL('../tests/golden/docx.json', import.meta.url).pathname
const [inPath = GOLDEN, outPath = inPath] = process.argv.slice(2)

interface ExportCase {
  document_json: string
  error?: string
  entries?: string[]
  parts?: Record<string, string>
  media?: Record<string, string>
  roundtrip_json?: string
  roundtrip_images?: string[]
}

const text = readFileSync(inPath, 'utf8')
const corpus = JSON.parse(text) as { export: Record<string, ExportCase>; files: Record<string, string> }
if (JSON.stringify(corpus) !== text) throw new Error(`${inPath} is not written as JSON.stringify writes it`)
const files = Object.fromEntries(Object.entries(corpus.files).map(([k, v]) => [k, fromB64(v)]))

// The parts the corpus keeps: what export_docx generates.
const PARTS = ['[Content_Types].xml', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml',
  'word/footnotes.xml', 'word/_rels/footnotes.xml.rels', 'word/comments.xml', 'word/_rels/comments.xml.rels']

let changed = 0
for (const [name, c] of Object.entries(corpus.export)) {
  if (c.error !== undefined) continue
  const bytes = await exportDocx(fromJson(c.document_json), '', memFs(files))
  const z = unzipSync(bytes)
  const parts: Record<string, string> = {}
  for (const p of PARTS) if (z[p]) parts[p] = strFromU8(z[p])
  const media: Record<string, string> = {}
  for (const k of Object.keys(z)) if (k.startsWith('word/media/')) media[k] = toB64(z[k])
  const fs = memFs()
  let json: string
  try {
    json = toJson(await importDocx(bytes, 'images', fs))
  } catch (e) {
    json = `!ERROR ${(e as { type?: string }).type ?? (e as Error).name}`
  }
  const images = [...fs.files.keys()].filter((k) => k.startsWith('images/')).map((k) => k.slice('images/'.length)).sort()
  const next: ExportCase = { ...c, entries: Object.keys(z), parts, media, roundtrip_json: json, roundtrip_images: images }
  if (JSON.stringify(next) !== JSON.stringify(c)) {
    changed++
    corpus.export[name] = next
  }
}
writeFileSync(outPath, JSON.stringify(corpus))
console.log(`${changed} export cases rewritten in ${outPath}`)
