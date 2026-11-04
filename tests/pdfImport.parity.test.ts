// Parity of the .pdf importer with the Python app (tests/golden/pdf.json,
// written by scripts/make_golden_pdf.py).
//
//  1. structure detection: PyMuPDF's own get_text("dict") spans fed into the
//     ported logic must give Python's document JSON byte for byte;
//  2. extraction: pdfText.ts's pdf.js → span dict adapter against PyMuPDF's
//     spans (text, flags, font, size, bbox);
//  3. end to end: importPdf() on the PDF bytes against Python's import_pdf.
//
// PDF_GOLDEN_EXTRA=/path/to.json runs 2 and 3 over a further corpus in the
// same format (e.g. real journal articles dumped locally, not committed).

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FileAccess } from '../src/core/kdocz.ts'
import { toJson } from '../src/core/model.ts'
import { importPdf, importPdfSource } from '../src/core/pdfImport.ts'
import type { PdfSource, PdfTextDict } from '../src/core/pdfImport.ts'
import { openPdfSource } from '../src/core/pdfText.ts'
import type { PdfJsLib } from '../src/core/pdfText.ts'

interface GoldenImage { xref: number; width?: number; height?: number; alpha?: boolean; png_ok: boolean; error?: string }
interface GoldenPage extends PdfTextDict { images: GoldenImage[] }
interface GoldenCase {
  pdf: string
  metadata: { title: string; author: string; keywords: string }
  pages: GoldenPage[]
  imported: string
  progress?: [number, number][]
}
interface Golden { image_dir: string; segmentation_pages?: string[]; cases: Record<string, GoldenCase> }

const load = (p: string | URL): Golden | null => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null)
const golden = load(new URL('./golden/pdf.json', import.meta.url))
const extra = process.env.PDF_GOLDEN_EXTRA ? load(process.env.PDF_GOLDEN_EXTRA) : null

export const loadPdfJs = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLib
const pdfjsDir = fileURLToPath(new URL('../node_modules/pdfjs-dist/', import.meta.url))
export const pdfjsOptions = {
  wasmUrl: `${pdfjsDir}wasm/`, cMapUrl: `${pdfjsDir}cmaps/`, cMapPacked: true,
}
const bytesOf = (c: GoldenCase) => Uint8Array.from(Buffer.from(c.pdf, 'base64'))

// An in-memory FileAccess: Python's figure paths are relative, so the
// written files never touch the disk.
export function memFs(): FileAccess & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    exists: async (p) => files.has(p),
    read: async (p) => {
      const d = files.get(p)
      if (!d) throw new Error(`no such file: ${p}`)
      return d
    },
    write: async (p, d) => { files.set(p, d) },
  }
}

// The open document as PyMuPDF saw it.
function pythonSource(c: GoldenCase): PdfSource {
  return {
    pageCount: c.pages.length,
    metadata: c.metadata,
    pageHeight: (i) => c.pages[i].height,
    textDict: async (i) => c.pages[i],
    images: async (i) => c.pages[i].images.map((img) => ({
      xref: img.xref,
      pixmap: async () => {
        if (img.error && img.width === undefined) throw new Error(img.error)
        return {
          width: img.width!, height: img.height!, alpha: !!img.alpha,
          png: () => {
            if (!img.png_ok) throw new Error(img.error ?? 'save failed')
            return new Uint8Array([0x89])
          },
        }
      },
    })),
    close: async () => {},
  }
}

describe('import_pdf structure detection on PyMuPDF spans', () => {
  it('has the corpus', () => expect(golden && Object.keys(golden.cases).length).toBeGreaterThan(5))
  for (const [name, c] of Object.entries(golden?.cases ?? {})) {
    it(name, async () => {
      const calls: [number, number][] = []
      const doc = await importPdfSource(pythonSource(c), `${golden!.image_dir}/${name}`, memFs(),
        (p, t) => calls.push([p, t]))
      expect(toJson(doc)).toBe(c.imported)
      if (c.progress) expect(calls).toEqual(c.progress)
    })
  }
})

// What the importer reads of a span, with bboxes to 0.05 pt. Type 3 fonts
// are named by MuPDF from the font dictionary, which pdf.js does not expose.
const spanKey = (s: PdfTextDict['blocks'][number]['lines'][number]['spans'][number]) =>
  [JSON.stringify(s.text), Math.round(s.size * 1000) / 1000, s.flags & 27,
    s.font === 'Type3' || /^F\d+$/.test(s.font) ? 'Type3' : s.font].join('|')
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 0.05)

function compareDicts(got: PdfTextDict, want: PdfTextDict): string[] {
  const out: string[] = []
  const wb = want.blocks.filter((b) => b.type === 0)
  if (got.blocks.length !== wb.length) out.push(`${got.blocks.length} blocks, want ${wb.length}`)
  wb.forEach((blk, bi) => {
    const g = got.blocks[bi]
    if (!g) return
    if (!near(g.bbox, blk.bbox)) out.push(`block ${bi} bbox ${g.bbox} want ${blk.bbox}`)
    if (g.lines.length !== blk.lines.length) out.push(`block ${bi}: ${g.lines.length} lines, want ${blk.lines.length}`)
    blk.lines.forEach((ln, li) => {
      const gl = g.lines[li]
      if (!gl) return
      const a = gl.spans.map(spanKey).join(' ‖ ')
      const b = ln.spans.map(spanKey).join(' ‖ ')
      if (a !== b) out.push(`block ${bi} line ${li}:\n  got  ${a}\n  want ${b}`)
      ln.spans.forEach((s, si) => {
        const gs = gl.spans[si]
        if (gs && !near(gs.bbox, s.bbox)) out.push(`block ${bi} line ${li} span ${si} bbox ${gs.bbox} want ${s.bbox}`)
      })
    })
  })
  return out
}

function extractionSuite(title: string, g: Golden | null) {
  describe(title, () => {
    for (const [name, c] of Object.entries(g?.cases ?? {})) {
      it(name, async () => {
        const src = await openPdfSource(bytesOf(c), loadPdfJs, pdfjsOptions)
        try {
          expect(src.pageCount).toBe(c.pages.length)
          for (let i = 0; i < c.pages.length; i++) {
            expect(src.pageHeight(i)).toBeCloseTo(c.pages[i].height, 3)
            const label = g?.segmentation_pages && name === 'segmentation' ? ` (${g.segmentation_pages[i]})` : ''
            expect(compareDicts(await src.textDict(i), c.pages[i]), `page ${i}${label}`).toEqual([])
          }
        } finally {
          await src.close()
        }
      }, 60000)
    }
  })
}

function endToEndSuite(title: string, g: Golden | null) {
  describe(title, () => {
    for (const [name, c] of Object.entries(g?.cases ?? {})) {
      it(name, async () => {
        const fs = memFs()
        const doc = await importPdf(bytesOf(c), `${g!.image_dir}/${name}`, fs, null, { loadPdfJs, pdfjsOptions })
        expect(toJson(doc)).toBe(c.imported)
        // Every figure the document names was written, as a PNG.
        for (const blk of doc.children) {
          if (blk.type !== 'Figure') continue
          const png = fs.files.get(blk.path)
          expect(png, blk.path).toBeDefined()
          expect(Array.from(png!.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47])
        }
      }, 60000)
    }
  })
}

extractionSuite('pdf.js span extraction matches PyMuPDF get_text("dict")', golden)
endToEndSuite('importPdf matches Python import_pdf end to end', golden)
if (extra) {
  extractionSuite('span extraction (extra corpus)', extra)
  endToEndSuite('end to end (extra corpus)', extra)
}
