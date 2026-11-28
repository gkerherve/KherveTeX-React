// A PNG wrapped as a PDF of the same pixels (core/pngPdf.ts), and the
// folder its copies are kept in (core/pictureCache.ts).
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { planPngPdf, pngSize, pngToPdf, readPng } from '../src/core/pngPdf.ts'
import { pdfPictures, type PictureHost } from '../src/core/pictureCache.ts'

const be32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

function chunk(type: string, data: number[] | Uint8Array): number[] {
  const body = [...type].map(c => c.charCodeAt(0)).concat([...data])
  return [...be32(data.length), ...body, ...be32(crc32(new Uint8Array(body)) >>> 0)]
}

interface Opts { depth?: number; interlace?: number; extra?: number[][]; idatSplit?: number; noEnd?: boolean }

// A PNG of `rows` (each already led by its filter byte).
function png(w: number, h: number, colorType: number, rows: number[][], o: Opts = {}): Uint8Array {
  const z = deflateSync(new Uint8Array(rows.flat()))
  const cut = o.idatSplit ?? z.length
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be32(w), ...be32(h), o.depth ?? 8, colorType, 0, 0, o.interlace ?? 0]),
    ...(o.extra ?? []).flat(),
    ...chunk('IDAT', z.subarray(0, cut)),
    ...(cut < z.length ? chunk('IDAT', z.subarray(cut)) : []),
    ...(o.noEnd ? [] : chunk('IEND', [])),
  ])
}

const rgb = () => png(2, 2, 2, [[0, 255, 0, 0, 0, 255, 0], [1, 10, 20, 30, 1, 2, 3]])
const rgba = () => png(2, 2, 6, [[0, 255, 0, 0, 128, 0, 255, 0, 255], [1, 10, 20, 30, 40, 1, 2, 3, 4]])
const latin = (b: Uint8Array) => new TextDecoder('latin1').decode(b)

// The data of each stream in a PDF, by object number.
function streams(pdf: Uint8Array): Map<number, Uint8Array> {
  const text = latin(pdf)
  const out = new Map<number, Uint8Array>()
  for (const m of text.matchAll(/(\d+) 0 obj\n<<[^]*?\/Length (\d+)>>\nstream\n/g)) {
    const at = m.index + m[0].length
    out.set(Number(m[1]), pdf.subarray(at, at + Number(m[2])))
  }
  return out
}

describe('a PNG as a PDF of the same pixels', () => {
  it('keeps the compressed pixels as they are', async () => {
    const src = rgb()
    const pdf = (await pngToPdf(src))!
    const text = latin(pdf)
    expect(text.startsWith('%PDF-1.5')).toBe(true)
    expect(text).toContain('/Width 2/Height 2/ColorSpace/DeviceRGB/BitsPerComponent 8')
    expect(text).toContain('/DecodeParms<</Predictor 15/Colors 3/BitsPerComponent 8/Columns 2>>')
    // The image stream is the PNG's own IDAT data, byte for byte.
    expect([...streams(pdf).get(5)!]).toEqual([...readPng(src)!.idat[0]])
    // The cross-reference table points at each object.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    for (const m of text.slice(xref).matchAll(/(\d{10}) 00000 n /g)) expect(text.slice(Number(m[1])).match(/^\d+ 0 obj/)).not.toBeNull()
  })

  it('joins a picture stored in several IDAT chunks', async () => {
    const whole = (await pngToPdf(rgb()))!
    const split = (await pngToPdf(png(2, 2, 2, [[0, 255, 0, 0, 0, 255, 0], [1, 10, 20, 30, 1, 2, 3]], { idatSplit: 5 })))!
    expect([...streams(split).get(5)!]).toEqual([...streams(whole).get(5)!])
  })

  it('is the size the picture has in LaTeX: its pixels at its resolution', async () => {
    // No resolution: 72 to the inch, a pixel a point.
    expect(latin((await pngToPdf(rgb()))!)).toContain('/MediaBox[0 0 2 2]')
    // 300 dpi (11811 pixels a metre).
    const phys = chunk('pHYs', [...be32(11811), ...be32(11811), 1])
    const [w, h] = pngSize(readPng(png(1667, 1, 2, [[0, ...new Array(1667 * 3).fill(0)]], { extra: [phys] }))!)
    expect(w).toBeCloseTo(1667 * 72 / 0.0254 / 11811, 9)
    expect(h).toBeCloseTo(72 / 0.0254 / 11811, 9)
    // Only an aspect ratio (unit 0): none.
    const aspect = chunk('pHYs', [...be32(2), ...be32(2), 0])
    expect(latin((await pngToPdf(png(2, 2, 2, [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]], { extra: [aspect] })))!)).toContain('/MediaBox[0 0 2 2]')
  })

  it('parts colour and alpha, each still under the PNG filters', async () => {
    const pdf = (await pngToPdf(rgba()))!
    const text = latin(pdf)
    expect(text).toContain('/SMask 7 0 R')
    expect(text).toMatch(/7 0 obj\n<<\/Type\/XObject\/Subtype\/Image\/Width 2\/Height 2\/ColorSpace\/DeviceGray\/BitsPerComponent 8\/Filter\/FlateDecode\/DecodeParms<<\/Predictor 15\/Colors 1/)
    const s = streams(pdf)
    expect([...inflateSync(s.get(5)!)]).toEqual([0, 255, 0, 0, 0, 255, 0, 1, 10, 20, 30, 1, 2, 3])
    expect([...inflateSync(s.get(7)!)]).toEqual([0, 128, 255, 1, 40, 4])
  })

  it('writes the colour space the engine writes', async () => {
    const srgb = (await pngToPdf(png(2, 2, 2, [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]], { extra: [chunk('sRGB', [1])] })))!
    expect(latin(srgb)).toContain('/ColorSpace [/CalRGB<</WhitePoint[.95046 1 1.08906]/Gamma[2.2 2.2 2.2]')
    expect(latin(srgb)).toContain('/Intent/RelativeColorimetric')
    const pal = (await pngToPdf(png(2, 1, 3, [[0, 0, 1]], { extra: [chunk('PLTE', [255, 0, 0, 0, 0, 255]), chunk('tRNS', [0])] })))!
    expect(latin(pal)).toContain('/ColorSpace [/Indexed /DeviceRGB 1 <ff00000000ff>]')
    expect(latin(pal)).toContain('/Mask[0 0]')
    // A palette with half-transparent entries: a soft mask of its pixels.
    const soft = (await pngToPdf(png(2, 1, 3, [[0, 0, 1]], { extra: [chunk('PLTE', [255, 0, 0, 0, 0, 255]), chunk('tRNS', [64])] })))!
    expect([...inflateSync(streams(soft).get(7)!)]).toEqual([64, 255])
  })

  it('leaves to the engine what it would not write the same', async () => {
    const rows = [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]]
    expect(await pngToPdf(png(2, 2, 2, rows, { interlace: 1 }))).toBeNull()
    // A linear gamma: the engine corrects the pixels.
    expect(await pngToPdf(png(2, 2, 2, rows, { extra: [chunk('gAMA', be32(100000))] }))).toBeNull()
    expect(await pngToPdf(png(2, 2, 2, rows, { extra: [chunk('gAMA', be32(45455))] }))).not.toBeNull()
    // Chromaticities with no sRGB chunk, pixels that are not square.
    expect(await pngToPdf(png(2, 2, 2, rows, { extra: [chunk('cHRM', new Array(32).fill(1))] }))).toBeNull()
    expect(await pngToPdf(png(2, 2, 2, rows, { extra: [chunk('pHYs', [...be32(1000), ...be32(2000), 1])] }))).toBeNull()
    // A file cut short, and one that is no PNG.
    expect(await pngToPdf(png(2, 2, 2, rows, { noEnd: true }))).toBeNull()
    expect(await pngToPdf(new Uint8Array(100))).toBeNull()
  })

  it('names a copy by the picture, not by where its file is', () => {
    expect(planPngPdf(rgb())!.name).toBe(planPngPdf(rgb())!.name)
    expect(planPngPdf(rgb())!.name).not.toBe(planPngPdf(rgba())!.name)
    expect(planPngPdf(rgb())!.name).toMatch(/^k\d+-2x2-[0-9a-z]+-[0-9a-z]+\.pdf$/)
  })
})

// Files in memory, with a count of what was written.
function memHost(files: Record<string, Uint8Array>, mtimes: Record<string, number> = {}) {
  const writes: string[] = []
  const host: PictureHost = {
    exists: async p => p in files,
    stat: async p => (p in files ? { isDir: false, isFile: true, mtime: mtimes[p] ?? 1000, size: files[p].length } : null),
    mkdir: async () => {},
    remove: async p => { delete files[p] },
    listDir: async dir => Object.keys(files).filter(p => p.startsWith(`${dir}/`)).map(p => ({
      name: p.slice(dir.length + 1), path: p, isDir: false, isFile: true, mtime: mtimes[p] ?? 1000,
    })),
    readFile: async p => files[p],
    writeFile: async (p, d) => { files[p] = d; writes.push(p) },
  }
  return { host, writes, files }
}

describe('the pictures\' copies', () => {
  it('makes a copy once, and uses it for the same picture anywhere', async () => {
    const { host, writes, files } = memHost({ '/a/fig.png': rgb(), '/b/same.png': rgb(), '/a/other.png': rgba(), '/a/photo.jpg': new Uint8Array(4) })
    const copy = pdfPictures(host, '/cache', () => 2000)
    const first = await copy('/a/fig.png')
    expect(first).toMatch(/^\/cache\/k\d+-2x2-.*\.pdf$/)
    expect(latin(files[first!]).startsWith('%PDF')).toBe(true)
    expect(writes).toEqual([first, `${first}.ok`])
    expect(await copy('/a/fig.png')).toBe(first)
    expect(await copy('/b/same.png')).toBe(first)
    expect(writes).toHaveLength(2)
    expect(await copy('/a/other.png')).not.toBe(first)
    // Not a PNG, not there.
    expect(await copy('/a/photo.jpg')).toBeNull()
    expect(await copy('/a/missing.png')).toBeNull()
  })

  it('uses a copy kept from an earlier session, and makes again one cut short', async () => {
    const name = planPngPdf(rgb())!.name
    const kept = memHost({ '/a/fig.png': rgb(), [`/cache/${name}`]: new Uint8Array([1]), [`/cache/${name}.ok`]: new Uint8Array(0) })
    expect(await pdfPictures(kept.host, '/cache', () => 2000)('/a/fig.png')).toBe(`/cache/${name}`)
    expect(kept.writes).toEqual([])
    const cut = memHost({ '/a/fig.png': rgb(), [`/cache/${name}`]: new Uint8Array([1]) })
    expect(await pdfPictures(cut.host, '/cache', () => 2000)('/a/fig.png')).toBe(`/cache/${name}`)
    expect(cut.writes).toEqual([`/cache/${name}`, `/cache/${name}.ok`])
    expect(cut.files[`/cache/${name}`].length).toBeGreaterThan(100)
  })

  it('clears out copies not made for a long time', async () => {
    const day = 24 * 3600 * 1000
    const { host, files } = memHost({ '/a/fig.png': rgb(), '/cache/old.pdf': new Uint8Array(1), '/cache/new.pdf': new Uint8Array(1) },
      { '/cache/old.pdf': 1000, '/cache/new.pdf': 80 * day })
    await pdfPictures(host, '/cache', () => 100 * day)('/a/fig.png')
    expect('/cache/old.pdf' in files).toBe(false)
    expect('/cache/new.pdf' in files).toBe(true)
  })

  it('leaves alone a picture the engine must read itself', async () => {
    const rows = [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]]
    const { host, writes } = memHost({ '/a/i.png': png(2, 2, 2, rows, { interlace: 1 }) })
    expect(await pdfPictures(host, '/cache')('/a/i.png')).toBeNull()
    expect(writes).toEqual([])
  })
})
