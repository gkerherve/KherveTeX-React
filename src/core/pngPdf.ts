// A PNG as a one-page PDF holding the same pixels, made without decoding
// them: a PNG's compressed data is what a PDF image stores (Flate with the
// PNG predictors), so its IDAT bytes go into the PDF as they are.
//
// Why: xdvipdfmx decodes and recompresses every PNG on every compile (a
// thesis with 76 figures: 13 s of a 14 s compile), but copies a PDF's image
// stream as it is (0.2 s). The page is the picture's natural size (its
// pixels at its own resolution, to the scaled point), so \includegraphics
// sets the same box and the same page breaks, and the colour space is the
// one xdvipdfmx itself would write for that PNG.
//
// A picture with an alpha channel has its colour and alpha bytes parted
// (the PNG filters hold for each part, so nothing is unfiltered) and each
// compressed again: once per picture, the copy is kept (pictureCache).
// What cannot be matched exactly is left alone (null) and compiles as
// before: interlaced files, a gamma the engine corrects the pixels for,
// chromaticities without sRGB, pixels that are not square, 16-bit colour
// keys, a profile that cannot be read.
import { unzlibSync, zlibSync } from 'fflate'

// Changed with the PDF this file writes, so older copies are not used.
const FORMAT = 'k1'

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface PngHead {
  width: number
  height: number
  depth: number
  colorType: number
  interlace: number
  // Pixels per metre (0 when the file gives none, or only an aspect ratio).
  ppmX: number
  ppmY: number
  idat: Uint8Array[]
  plte: Uint8Array | null
  trns: Uint8Array | null
  // The sRGB chunk's rendering intent (0 to 3), or -1 without one.
  srgb: number
  chrm: boolean
  // The gAMA chunk's value (gamma x 100000), or 0 without one.
  gama: number
  iccp: Uint8Array | null
  // The file ends with IEND (it is whole).
  whole: boolean
  // Size and every chunk's own checksum folded into one number: the same
  // picture, wherever it is unpacked, has the same name in the cache.
  print: string
}

const u32 = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0
const tag = (b: Uint8Array, p: number) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3])

export function readPng(b: Uint8Array): PngHead | null {
  if (b.length < 57 || SIG.some((v, i) => b[i] !== v)) return null
  const h: PngHead = {
    width: 0, height: 0, depth: 0, colorType: 0, interlace: 0, ppmX: 0, ppmY: 0, idat: [], plte: null, trns: null,
    srgb: -1, chrm: false, gama: 0, iccp: null, whole: false, print: '',
  }
  let fnv = 0x811c9dc5
  const fold = (v: number) => { fnv = Math.imul(fnv ^ (v & 0xff), 0x01000193) >>> 0 }
  let p = 8
  let first = true
  while (p + 12 <= b.length) {
    const n = u32(b, p)
    const t = tag(b, p + 4)
    const d = p + 8
    if (d + n + 4 > b.length) return null
    if (first !== (t === 'IHDR')) return null
    first = false
    for (let i = 0; i < 4; i++) fold(b[d + n + i])
    if (t === 'IHDR') {
      if (n < 13 || b[d + 10] !== 0 || b[d + 11] !== 0) return null
      h.width = u32(b, d); h.height = u32(b, d + 4); h.depth = b[d + 8]; h.colorType = b[d + 9]; h.interlace = b[d + 12]
    } else if (t === 'IDAT') {
      if (n) h.idat.push(b.subarray(d, d + n))
    } else if (t === 'PLTE') h.plte = b.subarray(d, d + n)
    else if (t === 'tRNS') h.trns = b.subarray(d, d + n)
    else if (t === 'sRGB') h.srgb = n ? b[d] : 0
    else if (t === 'gAMA' && n >= 4) h.gama = u32(b, d)
    else if (t === 'cHRM') h.chrm = true
    else if (t === 'iCCP') h.iccp = b.subarray(d, d + n)
    else if (t === 'pHYs' && n >= 9 && b[d + 8] === 1) { h.ppmX = u32(b, d); h.ppmY = u32(b, d + 4) }
    else if (t === 'IEND') { h.whole = true; break }
    p = d + n + 4
  }
  if (!h.width || !h.height) return null
  h.print = `${h.width}x${h.height}-${b.length.toString(36)}-${fnv.toString(36)}`
  return h
}

// Channels per pixel of each colour type, and which bit depths it allows.
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

// The colour space xdvipdfmx writes for an sRGB chunk.
const SRGB = '[/CalRGB<</WhitePoint[.95046 1 1.08906]/Gamma[2.2 2.2 2.2]'
  + '/Matrix[.41239 .21264 .01933 .35758 .71517 .11919 .18048 .07219 .95053]>>]'
const SGRAY = '[/CalGray<</WhitePoint[.95046 1 1.08906]/Gamma 2.2>>]'
const INTENTS = ['Perceptual', 'RelativeColorimetric', 'Saturation', 'AbsoluteColorimetric']

// The profile of an iCCP chunk, when xdvipdfmx (writing PDF 1.5) embeds it:
// version 4.0 at most, a device profile, of the picture's kind (RGB or
// grey). undefined: a profile it turns down (the picture is then plain
// DeviceRGB / DeviceGray, as without one); null: one that cannot be read.
function iccProfile(chunk: Uint8Array, gray: boolean): Uint8Array | null | undefined {
  let p = 0
  while (p < chunk.length && p < 80 && chunk[p] !== 0) p++
  if (p >= chunk.length - 2 || chunk[p + 1] !== 0) return null
  let prof: Uint8Array
  try { prof = unzlibSync(chunk.subarray(p + 2)) } catch { return null }
  if (prof.length < 128 || tag(prof, 36) !== 'acsp') return null
  const major = prof[8], minor = prof[9]
  if (major > 4 || (major === 4 && minor > 0)) return undefined
  if (!['scnr', 'mntr', 'prtr', 'spac'].includes(tag(prof, 12))) return undefined
  if (tag(prof, 16) !== (gray ? 'GRAY' : 'RGB ')) return undefined
  // Anything unusual in the header is left to xdvipdfmx to judge.
  if (u32(prof, 0) !== prof.length) return null
  return prof
}

const enc = new TextEncoder()

class PdfOut {
  parts: Uint8Array[] = []
  size = 0
  offsets: number[] = []
  add(x: string | Uint8Array): void {
    const b = typeof x === 'string' ? enc.encode(x) : x
    this.parts.push(b)
    this.size += b.length
  }
  obj(n: number, dict: string, stream?: Uint8Array[]): void {
    this.offsets[n] = this.size
    if (!stream) { this.add(`${n} 0 obj\n${dict}\nendobj\n`); return }
    const len = stream.reduce((a, s) => a + s.length, 0)
    this.add(`${n} 0 obj\n${dict.replace('>>END', `/Length ${len}>>`)}\nstream\n`)
    for (const s of stream) this.add(s)
    this.add('\nendstream\nendobj\n')
  }
  finish(count: number): Uint8Array {
    const xref = this.size
    let t = `xref\n0 ${count + 1}\n0000000000 65535 f \n`
    for (let i = 1; i <= count; i++) t += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`
    this.add(`${t}trailer\n<</Size ${count + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`)
    const out = new Uint8Array(this.size)
    let p = 0
    for (const b of this.parts) { out.set(b, p); p += b.length }
    return out
  }
}

// A length in PDF units, with the digits TeX's scaled points need.
const num = (v: number) => v.toFixed(9).replace(/\.?0+$/, '')

// The picture's size in PDF units: its pixels at its own resolution, 72
// to the inch when it gives none (as XeTeX reads it).
export function pngSize(h: Pick<PngHead, 'width' | 'height' | 'ppmX' | 'ppmY'>): [number, number] {
  const dx = h.ppmX ? 72.0 / 0.0254 / h.ppmX : 1
  const dy = h.ppmY ? 72.0 / 0.0254 / h.ppmY : 1
  return [h.width * dx, h.height * dy]
}

interface Plan {
  head: PngHead
  space: string
  icc: Uint8Array | null
  // The alpha channel goes to a soft mask (colour types 4 and 6).
  alpha: boolean
  // A palette's transparency as a soft mask (its indices are read).
  paletteAlpha: boolean
  mask: string
}

function plan(b: Uint8Array): Plan | null {
  const head = readPng(b)
  if (!head || !head.whole || !head.idat.length || head.interlace !== 0) return null
  const { colorType: ct, depth } = head
  if (!(ct in CHANNELS) || !DEPTHS[ct].includes(depth)) return null
  // The first bytes of a zlib stream (deflate, a 32K window at most).
  const z = head.idat[0]
  if ((z[0] & 0x0f) !== 8 || (z.length > 1 && ((z[0] << 8) | z[1]) % 31 !== 0)) return null
  // Pixels that are not square: xdvipdfmx draws them square all the same.
  if (head.ppmX !== head.ppmY) return null
  // A gamma other than a screen's (1 / 2.2): the engine corrects the pixels.
  if (head.gama && (head.gama < 45000 || head.gama > 46000)) return null
  const gray = ct === 0 || ct === 4
  let icc: Uint8Array | null = null
  let intent = ''
  let base = gray ? '/DeviceGray' : '/DeviceRGB'
  if (head.iccp) {
    const prof = iccProfile(head.iccp, gray)
    if (prof === null) return null
    if (prof) { icc = prof; base = '[/ICCBased 6 0 R]' }
  } else if (head.srgb >= 0) {
    base = gray ? SGRAY : SRGB
    intent = `/Intent/${INTENTS[head.srgb] ?? INTENTS[0]}`
  }
  // Chromaticities alone make a calibrated space worked out by xdvipdfmx.
  else if (head.chrm) return null
  let space = base
  if (ct === 3) {
    if (!head.plte || head.plte.length < 3) return null
    const n = Math.min(Math.floor(head.plte.length / 3), 1 << depth)
    let hex = ''
    for (let i = 0; i < n * 3; i++) hex += head.plte[i].toString(16).padStart(2, '0')
    space = `[/Indexed ${base} ${n - 1} <${hex}>]`
  }
  let mask = ''
  let paletteAlpha = false
  if (head.trns) {
    if (ct === 3) {
      // Fully transparent entries are a colour key; any other value makes
      // a soft mask.
      const soft = head.trns.some(v => v !== 0 && v !== 255)
      if (soft) paletteAlpha = true
      else {
        const keys: number[] = []
        head.trns.forEach((v, i) => { if (v === 0) keys.push(i, i) })
        // Several keys: the engine writes them all in one array.
        if (keys.length > 2) return null
        if (keys.length) mask = `/Mask[${keys.join(' ')}]`
      }
    } else if (ct === 0 || ct === 2) {
      if (depth !== 8 || head.trns.length < (ct === 0 ? 2 : 6)) return null
      const keys: number[] = []
      for (let i = 0; i < (ct === 0 ? 1 : 3); i++) { const v = head.trns[i * 2 + 1]; keys.push(v, v) }
      mask = `/Mask[${keys.join(' ')}]`
    }
  }
  return { head, space, icc, alpha: ct === 4 || ct === 6, paletteAlpha, mask: mask + intent }
}

function assemble(pl: Plan, color: Uint8Array[], colors: number, smask: { data: Uint8Array[]; predictor: boolean } | null): Uint8Array {
  const { head } = pl
  const [w, h] = pngSize(head)
  const out = new PdfOut()
  out.add('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n')
  out.obj(1, '<</Type/Catalog/Pages 2 0 R>>')
  out.obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>')
  out.obj(3, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${num(w)} ${num(h)}]/Resources<</XObject<</Im0 5 0 R>>>>/Contents 4 0 R>>`)
  out.obj(4, '<<>>END', [enc.encode(`q ${num(w)} 0 0 ${num(h)} 0 0 cm /Im0 Do Q`)])
  const parms = (n: number) => `/Filter/FlateDecode/DecodeParms<</Predictor 15/Colors ${n}/BitsPerComponent ${head.depth}/Columns ${head.width}>>`
  out.obj(5, `<</Type/XObject/Subtype/Image/Width ${head.width}/Height ${head.height}/ColorSpace${pl.space.startsWith('/') ? '' : ' '}${pl.space}`
    + `/BitsPerComponent ${head.depth}${parms(colors)}${pl.mask}${smask ? '/SMask 7 0 R' : ''}>>END`, color)
  let count = 5
  if (pl.icc || smask) {
    // Object 6 is the profile (an empty object without one).
    if (pl.icc) out.obj(6, `<</N ${pl.head.colorType === 0 || pl.head.colorType === 4 ? 1 : 3}/Filter/FlateDecode>>END`, [zlibSync(pl.icc, { level: 6 })])
    else out.obj(6, 'null')
    count = 6
  }
  if (smask) {
    out.obj(7, `<</Type/XObject/Subtype/Image/Width ${head.width}/Height ${head.height}/ColorSpace/DeviceGray`
      + `/BitsPerComponent ${smask.predictor ? head.depth : 8}`
      + (smask.predictor ? parms(1) : '/Filter/FlateDecode') + '>>END', smask.data)
    count = 7
  }
  return out.finish(count)
}

// Part the colour and alpha bytes of the (still filtered) rows: each row's
// filter byte goes to both, the filters meaning the same for each part.
class Parter {
  private col = 0
  private readonly px: number
  private readonly colorPx: number
  private readonly row: number
  constructor(head: PngHead) {
    const bytes = head.depth / 8
    const ch = CHANNELS[head.colorType]
    this.px = ch * bytes
    this.colorPx = (ch - 1) * bytes
    this.row = 1 + head.width * this.px
  }
  part(chunk: Uint8Array): [Uint8Array, Uint8Array] {
    const { px, colorPx, row } = this
    const c = new Uint8Array(chunk.length)
    const a = new Uint8Array(chunk.length)
    let ci = 0, ai = 0, col = this.col
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i]
      if (col === 0) { c[ci++] = v; a[ai++] = v }
      else if ((col - 1) % px < colorPx) c[ci++] = v
      else a[ai++] = v
      if (++col === row) col = 0
    }
    this.col = col
    return [c.subarray(0, ci), a.subarray(0, ai)]
  }
}

interface Squeezer { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }
type SqueezerCtor = new (format: 'deflate') => Squeezer
const streams = globalThis as { CompressionStream?: SqueezerCtor; DecompressionStream?: SqueezerCtor }

async function drain(r: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  const rd = r.getReader()
  for (;;) {
    const { done, value } = await rd.read()
    if (done) return out
    out.push(value)
  }
}

// With the platform's own (de)compressor, which works off the main thread:
// the window stays responsive whatever the picture's size.
async function splitAlphaNative(head: PngHead, Inflate: SqueezerCtor, Deflate: SqueezerCtor): Promise<[Uint8Array[], Uint8Array[]]> {
  const inf = new Inflate('deflate')
  const cz = new Deflate('deflate')
  const az = new Deflate('deflate')
  const cDone = drain(cz.readable)
  const aDone = drain(az.readable)
  const cw = cz.writable.getWriter()
  const aw = az.writable.getWriter()
  const feed = (async () => {
    const w = inf.writable.getWriter()
    for (const c of head.idat) await w.write(c)
    await w.close()
  })()
  const parter = new Parter(head)
  try {
    const rd = inf.readable.getReader()
    for (;;) {
      const { done, value } = await rd.read()
      if (done) break
      const [c, a] = parter.part(value)
      if (c.length) await cw.write(c)
      if (a.length) await aw.write(a)
    }
    await feed
    await cw.close()
    await aw.close()
    return [await cDone, await aDone]
  } catch (e) {
    // Leave no promise to reject on its own.
    for (const p of [feed, cDone, aDone, cw.abort(), aw.abort()]) void Promise.resolve(p).catch(() => {})
    throw e
  }
}

function splitAlphaSync(head: PngHead): [Uint8Array[], Uint8Array[]] {
  const size = head.idat.reduce((n, s) => n + s.length, 0)
  const all = new Uint8Array(size)
  let p = 0
  for (const s of head.idat) { all.set(s, p); p += s.length }
  const [c, a] = new Parter(head).part(unzlibSync(all))
  return [[zlibSync(c, { level: 4 })], [zlibSync(a, { level: 4 })]]
}

async function splitAlpha(head: PngHead): Promise<[Uint8Array[], Uint8Array[]]> {
  if (streams.CompressionStream && streams.DecompressionStream) {
    return splitAlphaNative(head, streams.DecompressionStream, streams.CompressionStream)
  }
  return splitAlphaSync(head)
}

// The alpha of each pixel of a palette picture, from its indices.
function paletteMask(head: PngHead): Uint8Array[] {
  const size = head.idat.reduce((a, s) => a + s.length, 0)
  const all = new Uint8Array(size)
  let p = 0
  for (const s of head.idat) { all.set(s, p); p += s.length }
  const raw = unzlibSync(all)
  const stride = Math.ceil(head.width * head.depth / 8)
  const alpha = new Uint8Array(head.width * head.height)
  const trns = head.trns!
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  for (let y = 0; y < head.height; y++) {
    const at = y * (stride + 1)
    const f = raw[at]
    for (let x = 0; x < stride; x++) {
      const v = raw[at + 1 + x]
      const a = x ? cur[x - 1] : 0
      const b = prev[x]
      const c = x ? prev[x - 1] : 0
      let pr = 0
      if (f === 1) pr = a
      else if (f === 2) pr = b
      else if (f === 3) pr = (a + b) >> 1
      else if (f === 4) { const pp = a + b - c; const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      cur[x] = (v + pr) & 0xff
    }
    for (let x = 0; x < head.width; x++) {
      const bit = x * head.depth
      const idx = head.depth === 8 ? cur[x] : (cur[bit >> 3] >> (8 - head.depth - (bit & 7))) & ((1 << head.depth) - 1)
      alpha[y * head.width + x] = idx < trns.length ? trns[idx] : 255
    }
    const t = prev; prev = cur; cur = t
  }
  return [zlibSync(alpha, { level: 4 })]
}

async function build(pl: Plan): Promise<Uint8Array | null> {
  try {
    if (pl.alpha) {
      const [color, alpha] = await splitAlpha(pl.head)
      return assemble(pl, color, CHANNELS[pl.head.colorType] - 1, { data: alpha, predictor: true })
    }
    const colors = CHANNELS[pl.head.colorType]
    if (pl.paletteAlpha) return assemble(pl, pl.head.idat, colors, { data: paletteMask(pl.head), predictor: false })
    return assemble(pl, pl.head.idat, colors, null)
  } catch {
    return null
  }
}

// How this PNG becomes a PDF: the name its copy is kept under (the same
// for the same picture, wherever the file is) and the making of it. null
// for a PNG left to the engine.
export function planPngPdf(b: Uint8Array): { name: string; make(): Promise<Uint8Array | null> } | null {
  const pl = plan(b)
  return pl ? { name: `${FORMAT}-${pl.head.print}.pdf`, make: () => build(pl) } : null
}

export async function pngToPdf(b: Uint8Array): Promise<Uint8Array | null> {
  return (await planPngPdf(b)?.make()) ?? null
}
