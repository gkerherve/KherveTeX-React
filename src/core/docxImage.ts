// python-docx 1.2's image header parsing (docx/image/*): the pixel size,
// dpi and content type add_picture() derives from a file's first bytes.
// The exporter sizes every picture from these numbers, so they must come
// out exactly as python-docx computes them, including where it gives up.

import { PyError } from './docxPackage.ts'
import { pyRound } from './py.ts'

export interface ImageHeader {
  contentType: string
  defaultExt: string
  pxWidth: number | null   // a TIFF without ImageWidth / ImageLength has none
  pxHeight: number | null
  horzDpi: number
  vertDpi: number
}

// docx.image.helpers.StreamReader over a byte array.
class StreamReader {
  private readonly b: Uint8Array
  private readonly le: boolean
  private readonly base: number
  pos = 0
  constructor(b: Uint8Array, littleEndian: boolean, baseOffset = 0) {
    this.b = b
    this.le = littleEndian
    this.base = baseOffset
  }
  read(count: number): Uint8Array {
    const end = count < 0 ? this.b.length : Math.min(this.b.length, this.pos + count)
    const out = this.b.subarray(Math.min(this.pos, this.b.length), end)
    this.pos = Math.max(this.pos, end)
    return out
  }
  seek(base: number, offset = 0) {
    this.pos = this.base + base + offset
  }
  tell() {
    return this.pos
  }
  private bytes(n: number, base: number, offset: number): Uint8Array {
    this.seek(base, offset)
    const out = this.read(n)
    if (out.length < n) throw new PyError('UnexpectedEndOfFileError', '')
    return out
  }
  readByte(base: number, offset = 0): number {
    return this.bytes(1, base, offset)[0]
  }
  readShort(base: number, offset = 0): number {
    const x = this.bytes(2, base, offset)
    return this.le ? x[0] | (x[1] << 8) : (x[0] << 8) | x[1]
  }
  readLong(base: number, offset = 0): number {
    const x = this.bytes(4, base, offset)
    const v = this.le ? x[0] | (x[1] << 8) | (x[2] << 16) | (x[3] << 24) : (x[0] << 24) | (x[1] << 16) | (x[2] << 8) | x[3]
    return v >>> 0
  }
  readStr(n: number, base: number, offset = 0): string {
    if (n < 0) throw new PyError('error', 'bad char in struct format')
    const x = this.bytes(n, base, offset)
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(x)
    } catch {
      throw new PyError('UnicodeDecodeError', "'utf-8' codec can't decode bytes")
    }
  }
}

// ---------------------------------------------------------------- PNG

function png(b: Uint8Array): ImageHeader {
  const rdr = new StreamReader(b, false)
  const chunks: { type: string; ihdr?: [number, number]; phys?: [number, number, number] }[] = []
  let chunkOffset = 8
  for (;;) {
    const len = rdr.readLong(chunkOffset)
    const type = rdr.readStr(4, chunkOffset, 4)
    const dataOffset = chunkOffset + 8
    if (type === 'IHDR') chunks.push({ type, ihdr: [rdr.readLong(dataOffset), rdr.readLong(dataOffset, 4)] })
    else if (type === 'pHYs') {
      chunks.push({ type, phys: [rdr.readLong(dataOffset), rdr.readLong(dataOffset, 4), rdr.readByte(dataOffset, 8)] })
    } else chunks.push({ type })
    if (type === 'IEND') break
    chunkOffset += 4 + 4 + len + 4
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR')
  if (!ihdr) throw new PyError('InvalidImageStreamError', 'no IHDR chunk in PNG image')
  const phys = chunks.find((c) => c.type === 'pHYs')?.phys
  const dpi = (units: number, ppu: number) => (units === 1 && ppu ? pyRound(ppu * 0.0254, 0) : 72)
  return {
    contentType: 'image/png', defaultExt: 'png',
    pxWidth: ihdr.ihdr![0], pxHeight: ihdr.ihdr![1],
    horzDpi: phys ? dpi(phys[2], phys[0]) : 72,
    vertDpi: phys ? dpi(phys[2], phys[1]) : 72,
  }
}

// ---------------------------------------------------------------- TIFF

const TIFF_TAG = { IMAGE_WIDTH: 0x0100, IMAGE_LENGTH: 0x0101, X_RESOLUTION: 0x011a, Y_RESOLUTION: 0x011b, RESOLUTION_UNIT: 0x0128 }
type IfdValue = number | string

function tiffParse(b: Uint8Array): ImageHeader {
  const le = !(b[0] === 0x4d && b[1] === 0x4d)  // b"MM" is big-endian
  const rdr = new StreamReader(b, le)
  const ifd0 = rdr.readLong(4)
  const entries = new Map<number, IfdValue>()
  const count = rdr.readShort(ifd0)
  for (let idx = 0; idx < count; idx++) {
    const off = ifd0 + 2 + idx * 12
    const fieldType = rdr.readShort(off, 2)
    const tag = rdr.readShort(off, 0)
    const valueCount = rdr.readLong(off, 4)
    const valueOffset = rdr.readLong(off, 8)
    let value: IfdValue
    if (fieldType === 2) value = rdr.readStr(valueCount - 1, valueOffset)
    else if (fieldType === 3) value = valueCount === 1 ? rdr.readShort(off, 8) : 'Multi-value short integer NOT IMPLEMENTED'
    else if (fieldType === 4) value = valueCount === 1 ? rdr.readLong(off, 8) : 'Multi-value long integer NOT IMPLEMENTED'
    else if (fieldType === 5) {
      if (valueCount === 1) {
        const num = rdr.readLong(valueOffset)
        const den = rdr.readLong(valueOffset, 4)
        if (den === 0) throw new PyError('ZeroDivisionError', 'division by zero')
        value = num / den
      } else value = 'Multi-value Rational NOT IMPLEMENTED'
    } else value = 'UNIMPLEMENTED FIELD TYPE'
    entries.set(tag, value)
  }
  const dpi = (tag: number): number => {
    if (!entries.has(tag)) return 72
    const unit = entries.has(TIFF_TAG.RESOLUTION_UNIT) ? entries.get(TIFF_TAG.RESOLUTION_UNIT)! : 2
    if (unit === 1) return 72
    const perInch = unit === 2 ? 1 : 2.54
    const dots = entries.get(tag)!
    if (typeof dots !== 'number') throw new PyError('TypeError', "type str doesn't define __round__ method")
    return pyRound(dots * perInch, 0)
  }
  // A string value (multi-valued entry) or a missing one only fails when
  // the exporter divides by it, as in Python.
  const num = (v: IfdValue | undefined): number | null => (typeof v === 'number' ? v : null)
  return {
    contentType: 'image/tiff', defaultExt: 'tiff',
    pxWidth: num(entries.get(TIFF_TAG.IMAGE_WIDTH)), pxHeight: num(entries.get(TIFF_TAG.IMAGE_LENGTH)),
    horzDpi: dpi(TIFF_TAG.X_RESOLUTION), vertDpi: dpi(TIFF_TAG.Y_RESOLUTION),
  }
}

// ---------------------------------------------------------------- JPEG

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const STANDALONE = new Set([0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7])
const EOI = 0xd9
const SOS = 0xda
const APP0 = 0xe0
const APP1 = 0xe1

interface Marker { code: number; segmentLength: number; dpi?: [number, number]; size?: [number, number] }

function jpegMarkers(b: Uint8Array): Marker[] {
  const rdr = new StreamReader(b, false)
  const readByte = (): number => {
    const x = rdr.read(1)
    if (!x.length) throw new PyError('Exception', 'unexpected end of file')
    return x[0]
  }
  const next = (start: number): [number, number] => {
    let position = start
    for (;;) {
      rdr.seek(position)
      while (readByte() !== 0xff) { /* find the next 0xFF */ }
      position = rdr.tell() - 1
      rdr.seek(position + 1)
      let byte = readByte()
      while (byte === 0xff) byte = readByte()
      position = rdr.tell() - 1
      if (byte === 0x00) continue
      return [byte, position + 1]
    }
  }
  const markers: Marker[] = []
  let start = 0
  let code: number | null = null
  while (code !== EOI) {
    let offset: number
    ;[code, offset] = next(start)
    let m: Marker
    if (code === APP0) {
      const segmentLength = rdr.readShort(offset)
      const units = rdr.readByte(offset, 9)
      const x = rdr.readShort(offset, 10)
      const y = rdr.readShort(offset, 12)
      const dpi = (d: number) => (units === 1 ? d : units === 2 ? pyRound(d * 2.54, 0) : 72)
      m = { code, segmentLength, dpi: [dpi(x), dpi(y)] }
    } else if (code === APP1) {
      const segmentLength = rdr.readShort(offset)
      rdr.seek(offset + 2)
      const sig = rdr.read(6)
      const isExif = sig.length === 6 && String.fromCharCode(...sig) === 'Exif\0\0'
      if (!isExif) m = { code, segmentLength, dpi: [72, 72] }
      else {
        rdr.seek(offset + 8)
        const tiff = tiffParse(rdr.read(segmentLength - 8).slice())
        m = { code, segmentLength, dpi: [tiff.horzDpi, tiff.vertDpi] }
      }
    } else if (SOF.has(code)) {
      const segmentLength = rdr.readShort(offset)
      const h = rdr.readShort(offset, 3)
      const w = rdr.readShort(offset, 5)
      m = { code, segmentLength, size: [w, h] }
    } else {
      m = { code, segmentLength: STANDALONE.has(code) ? 0 : rdr.readShort(offset) }
    }
    markers.push(m)
    if (code === SOS) break
    start = offset + m.segmentLength
  }
  return markers
}

function jpeg(b: Uint8Array, app: number): ImageHeader {
  const markers = jpegMarkers(b)
  const sof = markers.find((m) => SOF.has(m.code))
  if (!sof) throw new PyError('KeyError', 'no start of frame (SOFn) marker in image')
  const appM = markers.find((m) => m.code === app)
  if (!appM) throw new PyError('KeyError', `no APP${app - APP0} marker in image`)
  return {
    contentType: 'image/jpeg', defaultExt: 'jpg',
    pxWidth: sof.size![0], pxHeight: sof.size![1], horzDpi: appM.dpi![0], vertDpi: appM.dpi![1],
  }
}

// ---------------------------------------------------------------- GIF, BMP

function gif(b: Uint8Array): ImageHeader {
  if (b.length < 10) throw new PyError('error', 'unpack requires a buffer of 4 bytes')
  return { contentType: 'image/gif', defaultExt: 'gif', pxWidth: b[6] | (b[7] << 8), pxHeight: b[8] | (b[9] << 8), horzDpi: 72, vertDpi: 72 }
}

function bmp(b: Uint8Array): ImageHeader {
  const rdr = new StreamReader(b, true)
  const w = rdr.readLong(0x12)
  const h = rdr.readLong(0x16)
  const dpi = (ppm: number) => (ppm === 0 ? 96 : pyRound(ppm * 0.0254, 0))
  const hd = dpi(rdr.readLong(0x26))
  const vd = dpi(rdr.readLong(0x2a))
  return { contentType: 'image/bmp', defaultExt: 'bmp', pxWidth: w, pxHeight: h, horzDpi: hd, vertDpi: vd }
}

// ---------------------------------------------------------------- factory

const startsAt = (b: Uint8Array, offset: number, sig: number[]) => sig.every((x, i) => b[offset + i] === x)
const bytesOf = (s: string) => [...s].map((c) => c.charCodeAt(0))

// _ImageHeaderFactory: the first signature found in the first 32 bytes.
export function imageHeader(blob: Uint8Array): ImageHeader {
  const head = blob.subarray(0, 32)
  const sigs: [(b: Uint8Array) => ImageHeader, number, number[]][] = [
    [png, 0, [0x89, ...bytesOf('PNG\r\n\x1a\n')]],
    [(b) => jpeg(b, APP0), 6, bytesOf('JFIF')],
    [(b) => jpeg(b, APP1), 6, bytesOf('Exif')],
    [gif, 0, bytesOf('GIF87a')],
    [gif, 0, bytesOf('GIF89a')],
    [tiffParse, 0, bytesOf('MM\x00*')],
    [tiffParse, 0, bytesOf('II*\x00')],
    [bmp, 0, bytesOf('BM')],
  ]
  for (const [parse, offset, sig] of sigs) {
    if (head.length >= offset + sig.length && startsAt(head, offset, sig)) return parse(blob)
  }
  throw new PyError('UnrecognizedImageError', '')
}
