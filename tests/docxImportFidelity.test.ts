// Word files that imported with text or pictures missing, and LaTeX that
// did not compile: a body-level content control, tracked insertions in
// table cells, a palette PNG the engine draws blank, highlights and tracked
// changes inside table cells, and the NUMPAGES footer.
import { unzlibSync, unzipSync, zipSync, zlibSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { _pngOpaqueRgb, importDocx } from '../src/core/docxImport.ts'
import { exportDocx } from '../src/core/docxExport.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { document, paragraph, table, text } from '../src/core/model.ts'
import { memFs } from './docxMemFs.ts'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'

// A .docx whose document.xml is the given body (the styles and the rest of
// the package come from kTeX's own exporter).
async function docxWithBody(body: string): Promise<Uint8Array> {
  const base = await exportDocx(document([paragraph([text('seed')])]), '', memFs())
  const z = unzipSync(base)
  z['word/document.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}${SECT}</w:body></w:document>`)
  return zipSync(z)
}

// A 1-bit palette PNG (two colours) with the given rows of 0/1 pixels.
function palettePng(rows: number[][], palette: number[], trns?: number[]): Uint8Array {
  const width = rows[0].length, height = rows.length
  const raw: number[] = []
  for (const row of rows) {
    raw.push(0)
    let byte = 0, bit = 0
    for (const v of row) {
      byte |= v << (7 - bit); bit++
      if (bit === 8) { raw.push(byte); byte = 0; bit = 0 }
    }
    if (bit) raw.push(byte)
  }
  const chunk = (kind: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, body.length)
    for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i)
    out.set(body, 8)
    return out
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width); hv.setUint32(4, height)
  ihdr.set([1, 3, 0, 0, 0], 8)  // depth 1, palette, deflate, adaptive, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('PLTE', new Uint8Array(palette)),
    ...(trns ? [chunk('tRNS', new Uint8Array(trns))] : []),
    chunk('IDAT', zlibSync(new Uint8Array(raw))),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((s, p) => s + p.length, 0)
  const png = new Uint8Array(total)
  let o = 0
  for (const p of parts) { png.set(p, o); o += p.length }
  return png
}

describe('import_docx keeps what Word shows', () => {
  it('reads paragraphs inside a body-level content control', async () => {
    const bytes = await docxWithBody(
      '<w:sdt><w:sdtContent><w:p><w:r><w:t>Boxed text</w:t></w:r></w:p></w:sdtContent></w:sdt>'
      + '<w:p><w:r><w:t>Plain text</w:t></w:r></w:p>',
    )
    const doc = await importDocx(bytes, 'images', memFs())
    const json = JSON.stringify(doc.children)
    expect(json).toContain('Boxed text')
    expect(json.indexOf('Boxed text')).toBeLessThan(json.indexOf('Plain text'))
  })

  it('reads tracked insertions in a table cell', async () => {
    const bytes = await docxWithBody(
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p>'
      + '<w:ins w:id="1" w:author="Ann" w:date="2020-01-01T00:00:00Z"><w:r><w:t>Inserted cell</w:t></w:r></w:ins>'
      + '</w:p></w:tc></w:tr></w:tbl>',
    )
    const doc = await importDocx(bytes, 'images', memFs())
    const t = doc.children.find((b) => b.type === 'Table')
    // Kept as an insertion (its author's id), as paragraphs keep them.
    expect(t && t.type === 'Table' && t.rows).toEqual([['\\added[id=Ann]{Inserted cell}']])
  })
})

describe('_pngOpaqueRgb', () => {
  it('draws a 1-bit palette picture as 8-bit RGB over white', () => {
    // Palette: index 0 black, index 1 red. Row 0: black, red; row 1: red, black.
    const png = palettePng([[0, 1], [1, 0]], [0, 0, 0, 255, 0, 0])
    const out = _pngOpaqueRgb(png)
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    expect(dv.getUint32(16)).toBe(2)          // width
    expect(out[24]).toBe(8)                   // bit depth
    expect(out[25]).toBe(2)                   // RGB
    // IDAT: find it and inflate.
    let i = 8, idat: Uint8Array | null = null
    while (i + 8 <= out.length) {
      const n = dv.getUint32(i)
      if (String.fromCharCode(out[i + 4], out[i + 5], out[i + 6], out[i + 7]) === 'IDAT') idat = out.subarray(i + 8, i + 8 + n)
      i += 12 + n
    }
    const pixels = unzlibSync(idat!)
    expect([...pixels]).toEqual([
      0, 0, 0, 0, 255, 0, 0,          // row 0 filter, black, red
      0, 255, 0, 0, 0, 0, 0,          // row 1 filter, red, black
    ])
  })

  it('treats a transparent palette entry as white', () => {
    const png = palettePng([[1]], [0, 0, 0, 255, 0, 0], [255, 0])  // index 1 transparent
    const out = _pngOpaqueRgb(png)
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength)
    let i = 8, idat: Uint8Array | null = null
    while (i + 8 <= out.length) {
      const n = dv.getUint32(i)
      if (String.fromCharCode(out[i + 4], out[i + 5], out[i + 6], out[i + 7]) === 'IDAT') idat = out.subarray(i + 8, i + 8 + n)
      i += 12 + n
    }
    expect([...unzlibSync(idat!)]).toEqual([0, 255, 255, 255])
  })

  it('leaves an opaque RGB PNG as it is', () => {
    const png = palettePng([[0]], [0, 0, 0, 255, 255, 255])
    const once = _pngOpaqueRgb(png)
    expect(_pngOpaqueRgb(once)).toBe(once)
  })
})

describe('serializer: markup inside table cells', () => {
  it('defines the highlight colour a cell uses', () => {
    const tex = serializeDocument(document([
      table({ rows: [['\\colorbox{hlYellow}{flagged}']] }),
    ]))
    expect(tex).toContain('\\usepackage{xcolor}')
    expect(tex).toContain('\\definecolor{hlYellow}{HTML}{FFFF00}')
  })

  it('loads changes and the author of a tracked insertion in a cell', () => {
    const tex = serializeDocument(document([
      table({ rows: [['\\added[id=Ann]{new words}']] }),
    ]))
    expect(tex).toContain('\\usepackage[')
    expect(tex).toContain('{changes}')
    expect(tex).toContain('\\definechangesauthor[name={Ann}')
  })
})
