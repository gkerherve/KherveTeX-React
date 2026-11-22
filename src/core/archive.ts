// LaTeX packages as archives: .zip, .tar, .tar.gz / .tgz, .tar.bz2 / .tbz2
// (arXiv sources, Overleaf downloads, a journal's template, a colleague's
// project with its figures folder). Read in memory, no DOM: zip and gzip
// through fflate, tar and bzip2 here.

import { gunzipSync, unzipSync } from 'fflate'

// ---- bzip2 ---------------------------------------------------------------

class BitReader {
  private buf = 0
  private count = 0
  pos = 0
  private data: Uint8Array
  constructor(data: Uint8Array) { this.data = data }
  bits(n: number): number {
    while (this.count < n) {
      if (this.pos >= this.data.length) throw new Error('bzip2: the file ends too early')
      this.buf = ((this.buf & 0xffffff) << 8) | this.data[this.pos++]
      this.count += 8
    }
    const v = (this.buf >>> (this.count - n)) & ((1 << n) - 1)
    this.count -= n
    return v
  }
  bit(): number { return this.bits(1) }
  // Skip to the next byte boundary (between concatenated streams).
  align(): void { this.count -= this.count % 8 }
  atEnd(): boolean { return this.pos >= this.data.length && this.count < 8 }
}

interface Huffman { limit: Int32Array; base: Int32Array; start: Int32Array; perm: Int32Array; minLen: number }

function huffman(lengths: number[]): Huffman {
  const minLen = Math.min(...lengths)
  const maxLen = Math.max(...lengths)
  const limit = new Int32Array(maxLen + 2).fill(-1)
  const base = new Int32Array(maxLen + 2)
  const start = new Int32Array(maxLen + 2)
  const perm = new Int32Array(lengths.length)
  let code = 0
  let idx = 0
  for (let len = minLen; len <= maxLen; len++) {
    start[len] = idx
    base[len] = code
    for (let s = 0; s < lengths.length; s++) {
      if (lengths[s] === len) { perm[idx++] = s; code++ }
    }
    limit[len] = code - 1
    code <<= 1
  }
  // Past the longest code nothing matches.
  limit[maxLen + 1] = 0x7fffffff
  return { limit, base, start, perm, minLen }
}

function decodeSymbol(br: BitReader, h: Huffman): number {
  let len = h.minLen
  let code = br.bits(len)
  while (code > h.limit[len]) {
    len++
    if (len >= h.limit.length) throw new Error('bzip2: bad Huffman code')
    code = (code << 1) | br.bit()
  }
  return h.perm[h.start[len] + code - h.base[len]]
}

// One block: its bytes, run-length decoding included, appended to *out*.
function decodeBlock(br: BitReader, maxSize: number, out: number[][]): void {
  br.bits(16); br.bits(16)                       // block CRC
  if (br.bit()) throw new Error('bzip2: randomised blocks are not supported')
  const origPtr = br.bits(24)
  // The bytes in use.
  const used = br.bits(16)
  const seqToUnseq: number[] = []
  for (let i = 0; i < 16; i++) {
    if (used & (0x8000 >> i)) {
      const bits = br.bits(16)
      for (let j = 0; j < 16; j++) if (bits & (0x8000 >> j)) seqToUnseq.push(i * 16 + j)
    }
  }
  if (!seqToUnseq.length) throw new Error('bzip2: empty block')
  const alphaSize = seqToUnseq.length + 2
  const nGroups = br.bits(3)
  const nSelectors = br.bits(15)
  if (nGroups < 2 || nGroups > 6 || !nSelectors) throw new Error('bzip2: bad tables')
  const mtfGroups = Array.from({ length: nGroups }, (_, i) => i)
  const selectors = new Uint8Array(nSelectors)
  for (let i = 0; i < nSelectors; i++) {
    let j = 0
    while (br.bit()) { j++; if (j >= nGroups) throw new Error('bzip2: bad selector') }
    const v = mtfGroups[j]
    mtfGroups.splice(j, 1)
    mtfGroups.unshift(v)
    selectors[i] = v
  }
  const tables: Huffman[] = []
  for (let t = 0; t < nGroups; t++) {
    const lengths: number[] = []
    let len = br.bits(5)
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (len < 1 || len > 20) throw new Error('bzip2: bad code length')
        if (!br.bit()) break
        len += br.bit() ? -1 : 1
      }
      lengths.push(len)
    }
    tables.push(huffman(lengths))
  }

  const mtf = seqToUnseq.slice()
  const eob = alphaSize - 1
  const tt = new Uint32Array(maxSize)
  const byteCount = new Int32Array(256)
  let count = 0
  let groupIndex = -1
  let groupPos = 0
  let run = 0
  let runPos = 0
  let table = tables[0]
  for (;;) {
    if (groupPos === 0) {
      groupIndex++
      if (groupIndex >= nSelectors) throw new Error('bzip2: too few selectors')
      groupPos = 50
      table = tables[selectors[groupIndex]]
    }
    groupPos--
    const sym = decodeSymbol(br, table)
    if (sym <= 1) {
      if (runPos === 0) { runPos = 1; run = 0 }
      run += (sym + 1) * runPos
      runPos <<= 1
      continue
    }
    if (runPos) {
      const b = mtf[0]
      if (count + run > maxSize) throw new Error('bzip2: block too long')
      byteCount[b] += run
      tt.fill(b, count, count + run)
      count += run
      runPos = 0
    }
    if (sym === eob) break
    const i = sym - 1
    const b = mtf[i]
    mtf.copyWithin(1, 0, i)
    mtf[0] = b
    if (count >= maxSize) throw new Error('bzip2: block too long')
    byteCount[b]++
    tt[count++] = b
  }
  if (origPtr >= count) throw new Error('bzip2: bad block start')

  // Undo the Burrows–Wheeler transform.
  const cf = new Int32Array(256)
  for (let i = 0, sum = 0; i < 256; i++) { cf[i] = sum; sum += byteCount[i] }
  for (let i = 0; i < count; i++) {
    const b = tt[i] & 0xff
    tt[cf[b]++] |= i << 8
  }
  const block: number[] = []
  let tPos = tt[origPtr] >>> 8
  let last = -1
  let rep = 0
  for (let k = 0; k < count; k++) {
    tPos = tt[tPos]
    const ch = tPos & 0xff
    tPos >>>= 8
    if (rep === 4) {
      for (let r = 0; r < ch; r++) block.push(last)
      rep = 0
      last = -1
      continue
    }
    block.push(ch)
    if (ch === last) rep++
    else { last = ch; rep = 1 }
  }
  out.push(block)
}

export function bunzip2(data: Uint8Array): Uint8Array {
  const br = new BitReader(data)
  const out: number[][] = []
  let streams = 0
  while (!br.atEnd()) {
    if (br.bits(8) !== 0x42 || br.bits(8) !== 0x5a || br.bits(8) !== 0x68) {
      if (streams) break                 // trailing padding
      throw new Error('Not a bzip2 file')
    }
    const level = br.bits(8) - 0x30
    if (level < 1 || level > 9) throw new Error('bzip2: bad block size')
    streams++
    for (;;) {
      const hi = br.bits(24)
      const lo = br.bits(24)
      if (hi === 0x314159 && lo === 0x265359) decodeBlock(br, level * 100000, out)
      else if (hi === 0x177245 && lo === 0x385090) { br.bits(16); br.bits(16); break }
      else throw new Error('bzip2: bad block header')
    }
    br.align()
  }
  const total = out.reduce((n, b) => n + b.length, 0)
  const res = new Uint8Array(total)
  let o = 0
  for (const b of out) { res.set(b, o); o += b.length }
  return res
}

// ---- tar -------------------------------------------------------------------

function cstr(b: Uint8Array, from: number, len: number): string {
  let end = from
  while (end < from + len && b[end]) end++
  return new TextDecoder().decode(b.subarray(from, end))
}

// A tar: a ustar header, or an old-style one whose checksum adds up.
export function isTar(b: Uint8Array): boolean {
  if (b.length < 512 || !b[0]) return false
  if (cstr(b, 257, 5) === 'ustar') return true
  const want = parseInt(cstr(b, 148, 8).trim(), 8)
  if (Number.isNaN(want)) return false
  let sum = 0
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : b[i]
  return sum === want
}

export function untar(b: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  let pos = 0
  let longName: string | null = null
  while (pos + 512 <= b.length) {
    if (b.subarray(pos, pos + 512).every(x => x === 0)) break
    let name = cstr(b, pos, 100)
    const size = parseInt(cstr(b, pos + 124, 12).trim() || '0', 8) || 0
    const type = String.fromCharCode(b[pos + 156] || 48)
    const prefix = cstr(b, pos + 257, 6) === 'ustar' ? cstr(b, pos + 345, 155) : ''
    if (prefix) name = `${prefix}/${name}`
    const body = b.subarray(pos + 512, pos + 512 + size)
    pos += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') { longName = cstr(body, 0, body.length); continue }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(body))
      if (m) longName = m[1]
      continue
    }
    if (type === 'g') continue
    if (longName) { name = longName; longName = null }
    if (type === '0' || type === '\0' || type === '7') files.set(name, body.slice())
  }
  return files
}

// ---- archives ----------------------------------------------------------------

// A safe relative path inside the package: '' for one to skip (folders,
// macOS resource forks, paths leaving the folder).
export function cleanPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(x => x && x !== '.')
  if (parts.some(x => x === '..') || !parts.length) return ''
  if (parts[0] === '__MACOSX' || parts[parts.length - 1].startsWith('._')
    || parts[parts.length - 1] === '.DS_Store') return ''
  return parts.join('/')
}

// The files of an archive (path -> bytes), whatever its kind: zip, tar,
// gzip or bzip2 (of a tar or of a single file named after the archive).
export function readArchive(bytes: Uint8Array, name = 'archive'): Map<string, Uint8Array> {
  let files: Map<string, Uint8Array>
  const base = name.replace(/^.*[\\/]/, '')
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    files = new Map(Object.entries(unzipSync(bytes)))
  } else {
    let inner = bytes
    let innerName = base
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      inner = gunzipSync(bytes)
      innerName = base.replace(/\.(gz|tgz)$/i, (_, e) => (e.toLowerCase() === 'tgz' ? '.tar' : ''))
    } else if (bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68) {
      inner = bunzip2(bytes)
      innerName = base.replace(/\.(bz2|tbz2?)$/i, (_, e) => (e.toLowerCase() === 'bz2' ? '' : '.tar'))
    } else if (!isTar(bytes)) {
      throw new Error(`${base} is not an archive kTeX can read (zip, tar, tar.gz or tar.bz2).`)
    }
    files = isTar(inner) ? untar(inner) : new Map([[innerName || 'main.tex', inner]])
  }
  const out = new Map<string, Uint8Array>()
  for (const [p, data] of files) {
    const c = cleanPath(p)
    if (c && !p.endsWith('/')) out.set(c, data)
  }
  return out
}

export const ARCHIVE_SUFFIXES = ['.zip', '.tar', '.tgz', '.gz', '.tbz', '.tbz2', '.bz2']

export function isArchiveName(name: string): boolean {
  const n = name.toLowerCase()
  return ARCHIVE_SUFFIXES.some(s => n.endsWith(s))
}

// The main .tex of a package: one with \documentclass and
// \begin{document}; main.tex (or ms/paper/article/thesis) first, then the
// one nearest the top, then the longest. null when there is none.
export function findMainTex(files: Map<string, Uint8Array>): string | null {
  const dec = new TextDecoder()
  const cands: { path: string; score: number }[] = []
  for (const [p, data] of files) {
    if (!p.toLowerCase().endsWith('.tex')) continue
    const text = dec.decode(data)
    const body = text.replace(/(^|[^\\])%.*$/gm, '$1')
    if (!/\\documentclass/.test(body)) continue
    const stem = p.replace(/^.*\//, '').replace(/\.tex$/i, '').toLowerCase()
    let score = /\\begin\s*\{document\}/.test(body) ? 1000 : 0
    if (['main', 'ms', 'paper', 'article', 'thesis', 'manuscript', 'document'].includes(stem)) score += 100
    score -= p.split('/').length * 10
    score += Math.min(9, Math.log10(data.length + 1))
    cands.push({ path: p, score })
  }
  cands.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return cands[0]?.path ?? null
}
