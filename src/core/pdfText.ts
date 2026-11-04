// pdf.js → PyMuPDF page.get_text("dict") adapter for the .pdf importer.
//
// The Python importer reads MuPDF's structured text: blocks of lines of
// spans, each span one run of text with a single font, size, flags and
// colour. pdf.js has no such structure (getTextContent() merges and splits
// text by its own rules), so this module walks the operator list itself,
// places every glyph exactly as the canvas renderer would, and feeds the
// glyphs through a port of MuPDF 1.27's stext device grouping
// (fz_add_stext_char_imp in source/fitz/stext-device.c), checked against
// PyMuPDF with hand-written content streams (scripts/make_golden_pdf.py,
// "segmentation" case). Distances are in units of the glyph's font size:
//
//   same line    the baseline moves less than 0.8, and the pen moves back
//                less than 0.8 or forward less than 0.8
//   space        a forward gap of 0.15-0.8 inserts a synthetic " " (unless
//                the previous character is a space or outside the Latin /
//                punctuation ranges); above 0.3 it is a separate span
//   new block    the baseline moves more than 1.5, the writing direction
//                changes, or - on the first glyph of a new text object (BT,
//                or after a colour / state change) - the new line starts
//                more than 0.5 pt right of the current line's start
//   superscript  PyMuPDF's detect_super_script: on a horizontal line, an
//                origin more than 0.1 above the line's first character
//
// Font flags follow MuPDF: base-14 fonts use MuPDF's own metrics; embedded
// fonts take bold / italic / monospace from their name and from the sfnt
// tables pdf.js rebuilt (OS/2 fsSelection, post italicAngle / isFixedPitch).
//
// Nothing here touches the DOM; pdf.js is loaded through an injectable
// loader so the module imports cleanly in Node and in the browser.

import { unzlibSync, zlibSync } from 'fflate'

export type Bbox = [number, number, number, number]

export interface PdfSpan {
  text: string
  size: number
  flags: number
  font: string
  bbox: Bbox
  color?: number
  alpha?: number
  origin?: [number, number]
}
export interface PdfLine { bbox: Bbox; spans: PdfSpan[]; dir?: [number, number]; wmode?: number }
export interface PdfBlock { type: number; bbox: Bbox; lines: PdfLine[] }
export interface PdfTextDict { width: number; height: number; blocks: PdfBlock[] }

// An image ready to save, as PyMuPDF's Pixmap(doc, xref).
export interface PdfPixmap {
  width: number
  height: number
  alpha: boolean
  png(): Uint8Array  // alpha dropped, like Pixmap(csRGB, pix); may throw
}
export interface PdfImage {
  xref: string | number  // de-duplication key across pages
  pixmap(): Promise<PdfPixmap>
}

// What import_pdf reads from the open document.
export interface PdfSource {
  pageCount: number
  metadata: { title?: string; author?: string; keywords?: string }
  pageHeight(page: number): number
  textDict(page: number): Promise<PdfTextDict>
  images(page: number): Promise<PdfImage[]>
  close(): Promise<void>
}

// ---------------- the slice of the pdf.js API used here ----------------

interface PdfJsObjs {
  has(id: string): boolean
  get(id: string, callback?: (v: unknown) => void): unknown
}
interface PdfJsPage {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] }
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>
  commonObjs: PdfJsObjs
  objs: PdfJsObjs
}
interface PdfJsDocument {
  numPages: number
  getPage(n: number): Promise<PdfJsPage>
  getMetadata(): Promise<{ info?: Record<string, unknown> }>
}
export interface PdfJsLib {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfJsDocument>; destroy(): Promise<void> }
  OPS: Record<string, number>
}
export type PdfJsLoader = () => Promise<PdfJsLib>

const defaultLoader: PdfJsLoader = async () => (await import('pdfjs-dist')) as unknown as PdfJsLib

// ---------------- matrices ----------------

type Mat = [number, number, number, number, number, number]

const f32m = (m: Mat): Mat => m.map((v) => Math.fround(v)) as Mat

// fz_concat in single precision: m then n (PDF row-vector convention).
function concat32(m: Mat, n: Mat): Mat {
  const f = Math.fround
  return [
    f(f(m[0] * n[0]) + f(m[1] * n[2])), f(f(m[0] * n[1]) + f(m[1] * n[3])),
    f(f(m[2] * n[0]) + f(m[3] * n[2])), f(f(m[2] * n[1]) + f(m[3] * n[3])),
    f(f(f(m[4] * n[0]) + f(m[5] * n[2])) + n[4]), f(f(f(m[4] * n[1]) + f(m[5] * n[3])) + n[5]),
  ]
}

// fz_pre_translate in single precision.
function preTranslate(m: Mat, tx: number, ty: number): Mat {
  const f = Math.fround
  return [m[0], m[1], m[2], m[3],
    f(f(f(tx * m[0]) + f(ty * m[2])) + m[4]), f(f(f(tx * m[1]) + f(ty * m[3])) + m[5])]
}

// ---------------- fonts ----------------

interface FontInfo {
  name: string
  asc: number
  dsc: number
  flags: number  // italic 2 | serif 4 | mono 8 | bold 16
  fontMatrix0: number
  vertical: boolean
  type3: boolean
}

// MuPDF's ascender, descender and flags for the base-14 fonts (its own URW
// replacements), as PyMuPDF 1.27 reports them.
const BASE14: Record<string, [number, number, number]> = {
  'Helvetica': [1.075, -0.299, 0],
  'Helvetica-Oblique': [1.07, -0.284, 2],
  'Helvetica-Bold': [1.07, -0.307, 16],
  'Helvetica-BoldOblique': [1.073, -0.309, 18],
  'Courier': [0.932, -0.317, 8],
  'Courier-Oblique': [0.92, -0.317, 10],
  'Courier-Bold': [1.007, -0.393, 24],
  'Courier-BoldOblique': [0.997, -0.393, 26],
  'Times-Roman': [1.053, -0.281, 4],
  'Times-Italic': [0.951, -0.27, 6],
  'Times-Bold': [1.044, -0.341, 20],
  'Times-BoldItalic': [0.972, -0.324, 22],
  'Symbol': [1.01, -0.293, 0],
  'ZapfDingbats': [0.819, -0.144, 0],
}

// The base-14 font MuPDF substitutes for a non-embedded font name.
function base14For(name: string): string | null {
  if (BASE14[name]) return name
  const n = name.replace(/[\s,_-]/g, '').toLowerCase()
  const bold = /bold|black|heavy/.test(n)
  const italic = /italic|oblique/.test(n)
  if (n.includes('symbol')) return 'Symbol'
  if (n.includes('dingbat')) return 'ZapfDingbats'
  if (n.includes('courier') || n.includes('mono')) {
    return 'Courier' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '')
  }
  if (n.includes('times') || n.includes('serif') || n.includes('roman')) {
    return 'Times' + (bold && italic ? '-BoldItalic' : bold ? '-Bold' : italic ? '-Italic' : '-Roman')
  }
  return 'Helvetica' + (bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : '')
}

// FreeType's style flags from an sfnt (OS/2 fsSelection, else head
// macStyle) and post.isFixedPitch / italicAngle.
function sfntStyle(data: unknown): { bold: boolean; italic: boolean; mono: boolean } | null {
  if (!(data instanceof Uint8Array) || data.length < 12) return null
  try {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const numTables = dv.getUint16(4)
    const tables: Record<string, [number, number]> = {}
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + 16 * i
      if (rec + 16 > data.length) break
      const tag = String.fromCharCode(data[rec], data[rec + 1], data[rec + 2], data[rec + 3])
      tables[tag] = [dv.getUint32(rec + 8), dv.getUint32(rec + 12)]
    }
    let bold = false, italic = false, mono = false
    const os2 = tables['OS/2']
    const head = tables.head
    if (os2 && os2[1] >= 64 && os2[0] + 64 <= data.length) {
      const fs = dv.getUint16(os2[0] + 62)
      italic = (fs & 512) !== 0 || (fs & 1) !== 0
      bold = (fs & 32) !== 0
    } else if (head && head[1] >= 46 && head[0] + 46 <= data.length) {
      const mac = dv.getUint16(head[0] + 44)
      bold = (mac & 1) !== 0
      italic = (mac & 2) !== 0
    }
    const post = tables.post
    if (post && post[1] >= 16 && post[0] + 16 <= data.length) {
      mono = dv.getUint32(post[0] + 12) !== 0
      if (dv.getInt32(post[0] + 4) !== 0) italic = true
    }
    return { bold, italic, mono }
  } catch {
    return null
  }
}

const BOLD_NAME_RE = /bold|black|heavy|^cmbx|^cmb\d|^cmssbx|^cmbsy|^cmmib|^cmbcsc|^cmbtt/i
const SEMIBOLD_RE = /semi-?bold|demi-?bold/i
const ITALIC_NAME_RE = /italic|oblique|^cmti|^cmsl|^cmmi|^cmsy|^cmssi|^cmitt|^cmbxti|^cmbxsl/i
const MONO_NAME_RE = /mono|courier|typewriter|sourcecode|firacode|consol|menlo|fixed|^cmtt|^cmsltt|^cmitt|^cmtex|^lmtt|^ectt|^tctt|^txtt|^pcr/i
const SANS_NAME_RE = /sans|helvet|arial|verdana|calibri|gothic|grotesk|^cmss/i

function fontInfo(f: Record<string, unknown>, raw: RawObjects | null = null): FontInfo {
  const full = typeof f.name === 'string' ? f.name : ''
  const name = full.includes('+') ? full.slice(full.indexOf('+') + 1) : full
  const fm = Array.isArray(f.fontMatrix) ? (f.fontMatrix as number[]) : [0.001]
  const info: FontInfo = {
    name, asc: 0.8, dsc: -0.2, flags: 0,
    fontMatrix0: fm[0] || 0.001, vertical: !!f.vertical, type3: !!f.isType3Font,
  }
  // The FontDescriptor's Ascent / Descent win when given. pdf.js builds a
  // font with no descriptor (a plain base-14 reference) from its own AFM
  // metrics, and only then leaves `composite` unset.
  let asc = typeof f.ascent === 'number' && Number.isFinite(f.ascent) ? f.ascent : 0
  let dsc = typeof f.descent === 'number' && Number.isFinite(f.descent) ? f.descent : 0
  // pdf.js replaces a TrueType font's Ascent / Descent with its hhea values;
  // MuPDF keeps the descriptor's, so read them from the file.
  const desc = full && raw ? raw.descriptor(full) : null
  if (desc && desc.ascent !== 0) [asc, dsc] = [desc.ascent, desc.descent]
  const descriptorMetrics = 'composite' in f && asc !== 0
  // Not embedded: MuPDF substitutes its own base-14 font.
  const sub = f.missingFile ? base14For(name) : null
  if (sub) {
    const [basc, bdsc, flags] = BASE14[sub]
    info.asc = descriptorMetrics ? asc : basc
    info.dsc = descriptorMetrics ? dsc : bdsc
    info.flags = flags
    return info
  }
  // A Type 3 font's ascender and descender are its FontBBox in text space.
  if (info.type3) {
    const bb = f.bbox
    if ((Array.isArray(bb) || ArrayBuffer.isView(bb)) && fm.length >= 6) {
      const b = Array.from(bb as ArrayLike<number>)
      const ys = [b[1], b[3]].flatMap((y) => [b[0], b[2]].map((x) => x * fm[1] + y * fm[3] + fm[5]))
      info.asc = Math.max(...ys)
      info.dsc = Math.min(...ys)
    }
    return info
  }
  // fz_font_ascender(): a font without metrics reads as 0.8 / -0.2.
  if (asc !== 0) {
    info.asc = asc
    info.dsc = dsc
  }
  const style = sfntStyle(f.data)
  const fd = desc?.flags ?? 0
  const t1 = desc?.type1
  const bold = (BOLD_NAME_RE.test(name) && !SEMIBOLD_RE.test(name)) || !!style?.bold || !!f.bold || !!f.black
    || (fd & FD_FORCE_BOLD) !== 0 || (desc?.weight ?? 0) >= 700 || !!t1?.bold
  const italic = ITALIC_NAME_RE.test(name) || !!style?.italic || !!f.italic || (fd & FD_ITALIC) !== 0 || !!t1?.italic
  // Not pdf.js's isMonospace: it marks any subset whose glyphs share one
  // width (a digits-only Times-Bold) as monospaced.
  const mono = MONO_NAME_RE.test(name) || !!style?.mono || (fd & FD_FIXED_PITCH) !== 0 || !!t1?.mono
  const serif = !!f.isSerifFont || !SANS_NAME_RE.test(name)
  info.flags = (italic ? 2 : 0) | (serif ? 4 : 0) | (mono ? 8 : 0) | (bold ? 16 : 0)
  return info
}

// ---------------- MuPDF's stext grouping ----------------

const PARAGRAPH_DIST = 1.5
const SPACE_DIST = 0.15
const SPACE_MAX_DIST = 0.8
const BASE_MAX_DIST = 0.8
const FAKE_BOLD_MAX_DIST = 0.1
const SUPERSCRIPT_DIST = 0.1

// may_add_space(): no synthetic space after a space or after characters
// outside the Latin / Greek / Cyrillic ... and general punctuation ranges.
const mayAddSpace = (lastChar: number): boolean =>
  lastChar !== 0x20 && (lastChar < 0x700 || (lastChar >= 0x2000 && lastChar <= 0x20cf))

interface Glyph {
  text: string
  trm: Mat
  adv: number  // advance in glyph space (em)
  font: FontInfo
  color: number
  alpha: number
  render: number
}

interface BSpan {
  key: string
  text: string
  size: number
  flags: number
  font: string
  color: number
  alpha: number
  bbox: Bbox
  origin: [number, number]
}
interface BLine { dir: [number, number]; start: [number, number]; spans: BSpan[]; bbox: Bbox | null }
interface BBlock { lines: BLine[] }

const f32 = Math.fround
const union = (a: Bbox | null, b: Bbox): Bbox =>
  a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : [...b]

class StextBuilder {
  blocks: BBlock[] = []
  private pen: [number, number] = [0, 0]
  private lastChar = 0x20
  newObject = true
  private readonly width: number
  private readonly height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  // PyMuPDF's char quad: ascender / descender rescaled to a full em when
  // they span less than one (JM_char_quad).
  // MuPDF's quad spans ascender to descender along the glyph's up vector
  // (the trm's second column); when that is less than an em, PyMuPDF
  // rebuilds it a full font size (the trm's expansion) tall.
  private quadBbox(from: [number, number], to: [number, number], up: [number, number], font: FontInfo,
    ndir: [number, number], size: number): Bbox {
    let asc = font.asc
    let dsc = font.dsc
    const ad = asc - dsc
    if (ad < 1) {
      if (asc < 1e-3) {
        dsc = -0.1
        asc = 0.9
      }
      const ad2 = asc - dsc
      asc /= ad2
      dsc /= ad2
      // Rebuilt around the character's origin: a synthetic space between
      // two baselines takes the height of the one it starts on.
      up = [ndir[1] * size, -ndir[0] * size]
      const w = (to[0] - from[0]) * ndir[0] + (to[1] - from[1]) * ndir[1]
      to = [from[0] + w * ndir[0], from[1] + w * ndir[1]]
    }
    const xs: number[] = []
    const ys: number[] = []
    for (const o of [from, to]) {
      for (const k of [asc, dsc]) {
        xs.push(o[0] + k * up[0])
        ys.push(o[1] + k * up[1])
      }
    }
    return [f32(Math.min(...xs)), f32(Math.min(...ys)), f32(Math.max(...xs)), f32(Math.max(...ys))]
  }

  addGlyph(g: Glyph): void {
    const [a, b, c, d, e, f] = g.trm
    const size = f32(Math.sqrt(Math.abs(a * d - b * c)))
    if (!(size > 0)) return
    const dir: [number, number] = g.font.vertical ? [-c, -d] : [a, b]
    // MuPDF works in single precision; a TeX interword gap can sit right on
    // the 0.3 em wide-space threshold.
    const len = Math.hypot(dir[0], dir[1]) || 1
    const ndir: [number, number] = [f32(dir[0] / len), f32(dir[1] / len)]
    const p: [number, number] = [f32(e), f32(f)]
    const q: [number, number] = [f32(e + g.adv * dir[0]), f32(f + g.adv * dir[1])]
    const up: [number, number] = [c, d]
    const bbox = this.quadBbox(p, q, up, g.font, ndir, size)
    // Text wholly outside the page is not extracted.
    if (bbox[2] < 0 || bbox[0] > this.width || bbox[3] < 0 || bbox[1] > this.height) return

    // A ligature or a multi-character mapping: the first character carries
    // the glyph and its advance, the rest follow at the pen with none.
    const cps = [...g.text]
    const first = cps[0] ?? '�'
    const cp = first.codePointAt(0) ?? 0xfffd

    // Text drawn twice in the same place (fake bold) is kept once.
    if (cp === this.lastChar && Math.hypot(q[0] - this.pen[0], q[1] - this.pen[1]) / size < FAKE_BOLD_MAX_DIST) return

    let block = this.blocks[this.blocks.length - 1]
    let line = block?.lines[block.lines.length - 1]
    let newPara = false
    let newLine = true
    let addSpace = 0
    if (!block || !line || ndir[0] * line.dir[0] + ndir[1] * line.dir[1] < 0.999) {
      newPara = true
    } else {
      const dx = f32(p[0] - this.pen[0])
      const dy = f32(p[1] - this.pen[1])
      const spacing = f32(f32(f32(ndir[0] * dx) + f32(ndir[1] * dy)) / size)
      const baseOffset = f32(f32(f32(-ndir[1] * dx) + f32(ndir[0] * dy)) / size)
      if (Math.abs(baseOffset) < BASE_MAX_DIST) {
        if (Math.abs(spacing) < SPACE_DIST) {
          newLine = false
        } else if (spacing > -SPACE_MAX_DIST && spacing < 0) {
          // Overlapping characters: accept.
          newLine = false
        } else if (spacing > 0 && spacing < SPACE_MAX_DIST) {
          if (!g.font.vertical && mayAddSpace(this.lastChar)) addSpace = 1 + (spacing > SPACE_DIST * 2 ? 1 : 0)
          newLine = false
        }
      } else if (Math.abs(baseOffset) <= PARAGRAPH_DIST) {
        // A text-indent paragraph in a new text object.
        if (!g.font.vertical && this.newObject && p[0] - line.start[0] > 0.5) newPara = true
      } else {
        newPara = true
      }
    }

    if (newPara || !block) {
      block = { lines: [] }
      this.blocks.push(block)
    }
    if (newPara || newLine || !line) {
      line = { dir: ndir, start: p, spans: [], bbox: null }
      block.lines.push(line)
    }
    const render = g.render & 3
    // PyMuPDF's detect_super_script.
    const start = line.start
    const horizontal = line.dir[0] === 1 && line.dir[1] === 0
    const raised = (o: [number, number]) => horizontal && o[1] < start[1] - size * SUPERSCRIPT_DIST
    if (addSpace) {
      const sb = this.quadBbox(this.pen, p, up, g.font, ndir, size)
      const sflags = g.font.flags | (raised(this.pen) ? 1 : 0)
      this.push(line, ' ', sb, size, sflags, g, `${render}${addSpace > 1 ? 'W' : ''}`, this.pen)
    }
    this.push(line, first, bbox, size, g.font.flags | (raised(p) ? 1 : 0), g, `${render}`, p)
    if (cps.length > 1) {
      const cb = this.quadBbox(q, q, up, g.font, ndir, size)
      const cflags = g.font.flags | (raised(q) ? 1 : 0)
      for (const ch of cps.slice(1)) this.push(line, ch, cb, size, cflags, g, `${render}`, q)
    }
    this.pen = q
    this.lastChar = cps[cps.length - 1]?.codePointAt(0) ?? cp
    this.newObject = false
  }

  private push(line: BLine, text: string, bbox: Bbox, size: number, flags: number,
    g: Glyph, cls: string, origin: [number, number]): void {
    const alpha = g.render === 3 || g.render === 7 ? 0 : Math.round(g.alpha * 255)
    const key = `${g.font.name}\u0000${size}\u0000${flags}\u0000${g.color}\u0000${alpha}\u0000${cls}`
    const last = line.spans[line.spans.length - 1]
    if (last && last.key === key) {
      last.text += text
      last.bbox = union(last.bbox, bbox)
    } else {
      line.spans.push({
        key, text, size, flags, font: g.font.name, color: g.color, alpha,
        bbox: [...bbox], origin: [f32(origin[0]), f32(origin[1])],
      })
    }
    line.bbox = union(line.bbox, bbox)
  }

  toDict(): PdfTextDict {
    const blocks: PdfBlock[] = []
    for (const blk of this.blocks) {
      const lines: PdfLine[] = []
      let bbox: Bbox | null = null
      for (const ln of blk.lines) {
        if (!ln.bbox || !ln.spans.length) continue
        bbox = union(bbox, ln.bbox)
        lines.push({
          bbox: ln.bbox, dir: ln.dir, wmode: 0,
          spans: ln.spans.map(({ key: _key, ...s }) => s),
        })
      }
      if (bbox && lines.length) blocks.push({ type: 0, bbox, lines })
    }
    return { width: this.width, height: this.height, blocks }
  }
}

// MuPDF expands the Latin ligatures unless asked to keep them.
const LIGATURES: Record<string, string> = {
  '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl',
  '\ufb05': 'st', '\ufb06': 'st',
}

function glyphText(unicode: unknown, type3: boolean): string {
  // An unmapped glyph: pdf.js falls back to the raw character code, which
  // for symbol fonts is a control character; MuPDF reports U+FFFD, except
  // in a Type 3 font, where it keeps the code too.
  // oxlint-disable-next-line no-control-regex
  const raw = typeof unicode === 'string' && unicode && (type3 || !/^[\x00-\x1f\x7f-\x9f]$/.test(unicode))
  const u = raw ? unicode : '\ufffd'
  // pdf.js maps some ligature glyph names to strings ("ffi" is "\ufb00i").
  return u.replace(/[\ufb00-\ufb06]/g, (ch) => LIGATURES[ch])
}

function hexColor(v: unknown): number | null {
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return parseInt(v.slice(1), 16)
  if (Array.isArray(v) && v.length >= 3) {
    const [r, g, b] = v.map((x) => Math.max(0, Math.min(255, Math.round(Number(x)))))
    return (r << 16) | (g << 8) | b
  }
  return null
}

// ---------------- the operator-list walk ----------------

interface TextState {
  ctm: Mat
  font: FontInfo | null
  fontSize: number  // signed, as Tf gave it
  charSpacing: number
  wordSpacing: number
  hscale: number
  leading: number
  rise: number
  render: number
  color: number
  alpha: number
  // Tm and Tlm, kept in single precision the way MuPDF's interpreter does.
  tm: Mat
  tlm: Mat
}

interface PageImageRef { objId: string }

function getObj(objs: PdfJsObjs, id: string): Promise<unknown> {
  return new Promise((resolve) => {
    if (objs.has(id)) resolve(objs.get(id))
    else objs.get(id, resolve)
  })
}

async function walkPage(page: PdfJsPage, ops: Record<string, number>, raw: RawObjects): Promise<{ dict: PdfTextDict; images: PageImageRef[] }> {
  const vp = page.getViewport({ scale: 1 })
  const name: Record<number, string> = {}
  for (const [k, v] of Object.entries(ops)) name[v] = k
  const list = await page.getOperatorList()

  // Fonts arrive as common objects; resolve every one the page selects.
  const fonts = new Map<string, FontInfo>()
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = name[list.fnArray[i]]
    const args = list.argsArray[i]
    const ids: string[] = []
    if (op === 'setFont' && typeof args?.[0] === 'string') ids.push(args[0])
    if (op === 'setGState' && Array.isArray(args?.[0])) {
      for (const [k, v] of args[0] as [string, unknown][]) {
        if (k === 'Font' && Array.isArray(v) && typeof v[0] === 'string') ids.push(v[0])
      }
    }
    for (const id of ids) {
      if (fonts.has(id)) continue
      const obj = (await getObj(page.commonObjs, id)) as Record<string, unknown> | null
      fonts.set(id, fontInfo(obj ?? {}, raw))
    }
  }

  const builder = new StextBuilder(vp.width, vp.height)
  const images: PageImageRef[] = []
  const seenImages = new Set<string>()
  let st: TextState = {
    ctm: f32m(vp.transform.slice(0, 6) as Mat), font: null, fontSize: 0,
    charSpacing: 0, wordSpacing: 0, hscale: 1, leading: 0, rise: 0, render: 0,
    color: 0, alpha: 1, tm: [1, 0, 0, 1, 0, 0], tlm: [1, 0, 0, 1, 0, 0],
  }
  const stack: TextState[] = []
  const clone = (s: TextState): TextState => ({ ...s })
  const setFont = (id: unknown, size: unknown) => {
    st.font = typeof id === 'string' ? fonts.get(id) ?? null : null
    st.fontSize = f32(Number(size) || 0)
  }
  const moveText = (x: number, y: number) => {
    st.tlm = preTranslate(st.tlm, f32(x), f32(y))
    st.tm = st.tlm
  }
  const addImage = (id: unknown) => {
    if (typeof id !== 'string' || seenImages.has(id)) return
    seenImages.add(id)
    images.push({ objId: id })
  }

  for (let i = 0; i < list.fnArray.length; i++) {
    const op = name[list.fnArray[i]]
    const args = (list.argsArray[i] ?? []) as unknown[]
    switch (op) {
      case 'save':
        stack.push(clone(st))
        break
      case 'restore':
        if (stack.length) st = stack.pop()!
        builder.newObject = true
        break
      case 'transform':
        st.ctm = concat32(f32m(args.slice(0, 6).map(Number) as Mat), st.ctm)
        builder.newObject = true
        break
      case 'paintFormXObjectBegin': {
        stack.push(clone(st))
        const m = args[0]
        if (Array.isArray(m) || ArrayBuffer.isView(m)) {
          st.ctm = concat32(f32m(Array.from(m as ArrayLike<number>).slice(0, 6) as Mat), st.ctm)
        }
        builder.newObject = true
        break
      }
      case 'paintFormXObjectEnd':
        if (stack.length) st = stack.pop()!
        builder.newObject = true
        break
      case 'beginText':
        st.tm = st.tlm = [1, 0, 0, 1, 0, 0]
        builder.newObject = true
        break
      case 'endText':
        builder.newObject = true
        break
      case 'setFont':
        setFont(args[0], args[1])
        break
      case 'setTextMatrix': {
        const m = args[0]
        const arr = Array.isArray(m) || ArrayBuffer.isView(m) ? Array.from(m as ArrayLike<number>) : args
        st.tm = st.tlm = f32m(arr.slice(0, 6).map(Number) as Mat)
        break
      }
      case 'moveText':
        moveText(Number(args[0]), Number(args[1]))
        break
      case 'setLeadingMoveText':
        st.leading = Number(args[1])
        moveText(Number(args[0]), Number(args[1]))
        break
      case 'nextLine':
        moveText(0, st.leading)
        break
      case 'setLeading':
        st.leading = -Number(args[0])
        break
      case 'setCharSpacing':
        st.charSpacing = Number(args[0])
        break
      case 'setWordSpacing':
        st.wordSpacing = Number(args[0])
        break
      case 'setHScale':
        st.hscale = Number(args[0]) / 100
        break
      case 'setTextRise':
        st.rise = Number(args[0])
        break
      case 'setTextRenderingMode':
        if (st.render !== Number(args[0])) builder.newObject = true
        st.render = Number(args[0])
        break
      case 'setFillRGBColor': {
        const col = hexColor(args[0] ?? args)
        if (col !== null) st.color = col
        builder.newObject = true
        break
      }
      case 'setGState':
        for (const [k, v] of (Array.isArray(args[0]) ? args[0] : []) as [string, unknown][]) {
          if (k === 'ca') st.alpha = Number(v)
          else if (k === 'Font' && Array.isArray(v)) setFont(v[0], v[1])
        }
        builder.newObject = true
        break
      case 'showText':
        showText(st, (args[0] ?? []) as unknown[], builder)
        break
      case 'paintImageXObject':
      case 'paintImageXObjectRepeat':
        addImage(args[0])
        builder.newObject = true
        break
      default:
        // MuPDF starts a new text object on any colour change.
        if (op && /^set(Fill|Stroke)/.test(op)) builder.newObject = true
        else if (op?.startsWith('paint')) builder.newObject = true
    }
  }
  return { dict: builder.toDict(), images }
}

interface PdfJsGlyph { unicode?: string; width?: number; isSpace?: boolean; vmetric?: number[] }

// MuPDF's 0.001f.
const F001 = Math.fround(0.001)

// pdf_show_string / pdf_show_char / pdf_show_space: each glyph is placed at
// [size*scale 0 0 size 0 rise] x Tm x CTM, then Tm advances by the glyph's
// /Widths entry plus character (and, after code 32, word) spacing; a TJ
// number moves Tm by -n/1000 of the font size.
function showText(st: TextState, glyphs: unknown[], builder: StextBuilder): void {
  const font = st.font
  if (!font) return
  const size = st.fontSize
  const scale = f32(st.hscale)
  const vertical = font.vertical
  const tsm: Mat = [f32(size * scale), 0, 0, size, 0, f32(st.rise)]
  const advance = (tadj: number) => {
    st.tm = vertical ? preTranslate(st.tm, 0, tadj) : preTranslate(st.tm, f32(tadj * scale), 0)
  }
  for (const item of glyphs) {
    if (typeof item === 'number') {
      advance(f32(f32(-item * size) * F001))
      continue
    }
    if (!item || typeof item !== 'object') continue
    const glyph = item as PdfJsGlyph
    let width = glyph.width ?? 0
    if (vertical && glyph.vmetric) width = -glyph.vmetric[0]
    // MuPDF keeps /Widths as integers (pdf_hmtx), rounding pdfTeX's 763.9.
    const w0 = font.fontMatrix0 === 0.001 ? f32(Math.floor(width + 0.5) * F001) : f32(width * font.fontMatrix0)
    if (size !== 0) {
      builder.addGlyph({
        text: glyphText(glyph.unicode, font.type3),
        trm: concat32(concat32(tsm, st.tm), st.ctm),
        adv: w0,
        font, color: st.color, alpha: st.alpha, render: st.render,
      })
    }
    if (vertical) {
      st.tm = preTranslate(st.tm, 0, f32(f32(w0 * size) + f32(st.charSpacing)))
    } else {
      st.tm = preTranslate(st.tm, f32(f32(f32(w0 * size) + f32(st.charSpacing)) * scale), 0)
    }
    if (glyph.isSpace) advance(f32(st.wordSpacing))
  }
}

// ---------------- images ----------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// A PNG of `rows` (unfiltered scanlines, `stride` bytes each).
export function encodePng(width: number, height: number, colorType: 0 | 2, bitDepth: 1 | 8,
  rows: Uint8Array, stride: number): Uint8Array {
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) raw.set(rows.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, width)
  hv.setUint32(4, height)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// pdf.js ImageKind
const GRAYSCALE_1BPP = 1
const RGB_24BPP = 2
const RGBA_32BPP = 3

interface PdfJsImage { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray; ref?: string }

function imagePixmap(img: PdfJsImage, pngWritable: boolean): PdfPixmap {
  const { width, height } = img
  const kind = img.kind
  return {
    width, height, alpha: kind === RGBA_32BPP,
    png: () => {
      // MuPDF: "pixmap must be grayscale or rgb to write as png".
      if (!pngWritable) throw new Error('unsupported colorspace for png')
      const data = img.data
      if (!data) throw new Error('image has no pixel data')
      if (kind === GRAYSCALE_1BPP) {
        const stride = (width + 7) >> 3
        return encodePng(width, height, 0, 1, new Uint8Array(data.buffer, data.byteOffset, stride * height), stride)
      }
      if (kind === RGB_24BPP) {
        return encodePng(width, height, 2, 8, new Uint8Array(data.buffer, data.byteOffset, width * height * 3), width * 3)
      }
      if (kind === RGBA_32BPP) {
        const rgb = new Uint8Array(width * height * 3)
        for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
          rgb[j] = data[i]
          rgb[j + 1] = data[i + 1]
          rgb[j + 2] = data[i + 2]
        }
        return encodePng(width, height, 2, 8, rgb, width * 3)
      }
      throw new Error(`unsupported image kind ${kind}`)
    },
  }
}

// FNV-1a over the pixels: the same image object on two pages decodes to
// the same bytes, which stands in for PyMuPDF's xref de-duplication (pdf.js
// gives a reused image a page-local id first and a global one later).
function imageKey(img: PdfJsImage): string {
  let h = 0x811c9dc5
  const data = img.data
  if (data) {
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193)
  }
  return `${img.width}x${img.height}:${img.kind}:${(h >>> 0).toString(16)}`
}

// pdf.js decodes every image to RGB(A), so whether PyMuPDF could have
// saved it — Pixmap(doc, xref) keeps the image's own colour space, and only
// grey and RGB write as PNG — is read from the image's dictionary in the
// file. Image XObjects are streams, so never inside object streams; a
// colour space the peek cannot resolve counts as writable.
interface Descriptor {
  ascent: number
  descent: number
  flags: number
  weight: number
  // FreeType's style of an embedded Type 1 program (FontInfo /Weight,
  // /ItalicAngle, /isFixedPitch), which is what MuPDF reports.
  type1: { bold: boolean; italic: boolean; mono: boolean } | null
}

// FontDescriptor /Flags bits.
const FD_FIXED_PITCH = 1
const FD_ITALIC = 64
const FD_FORCE_BOLD = 1 << 18

class RawObjects {
  private text: string | null = null
  private streams: string[] | null = null
  private readonly descriptors = new Map<string, Descriptor | null>()
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  // The file as text, plus the inflated object streams (where PDF 1.5+
  // keeps font descriptors).
  private sources(): string[] {
    this.text ??= new TextDecoder('latin1').decode(this.bytes)
    if (this.streams === null) {
      this.streams = []
      const dec = new TextDecoder('latin1')
      const re = /\/Type\s*\/ObjStm\b/g
      for (let m = re.exec(this.text); m; m = re.exec(this.text)) {
        const at = this.text.indexOf('stream', m.index)
        const end = this.text.indexOf('endstream', at)
        if (at < 0 || end < 0) continue
        let start = at + 6
        if (this.text[start] === '\r') start++
        if (this.text[start] === '\n') start++
        try {
          this.streams.push(dec.decode(unzlibSync(this.bytes.subarray(start, end))))
        } catch {
          // Not Flate, or damaged: its descriptors stay unknown.
        }
      }
    }
    return [this.text, ...this.streams]
  }

  // The FontDescriptor named `fontName`.
  descriptor(fontName: string): Descriptor | null {
    if (this.descriptors.has(fontName)) return this.descriptors.get(fontName)!
    let out: Descriptor | null = null
    const esc = fontName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`/FontName\\s*/${esc}(?![^\\s/<>\\[\\]()])`)
    for (const src of this.sources()) {
      const m = re.exec(src)
      if (!m) continue
      const open = src.lastIndexOf('<<', m.index)
      const close = src.indexOf('>>', m.index)
      const d = src.slice(open < 0 ? 0 : open, close < 0 ? undefined : close)
      const num = (key: string) => {
        const v = new RegExp(`/${key}\\s+(-?[\\d.]+)`).exec(d)
        return v ? Number(v[1]) : 0
      }
      const ff = /\/FontFile\s+(\d+)\s+(\d+)\s+R/.exec(d)
      out = {
        ascent: num('Ascent') / 1000, descent: num('Descent') / 1000, flags: num('Flags'), weight: num('FontWeight'),
        type1: ff ? this.type1Style(Number(ff[1]), Number(ff[2])) : null,
      }
      break
    }
    this.descriptors.set(fontName, out)
    return out
  }

  // The dictionary text of object `num gen` (its last definition).
  // The decoded stream of object `num gen` (Flate or unfiltered).
  stream(num: number, gen: number): Uint8Array | null {
    const d = this.dict(num, gen)
    if (d === null) return null
    const text = this.text!
    const at = text.indexOf(d) + d.length
    if (!text.startsWith('stream', at)) return null
    let start = at + 6
    if (text[start] === '\r') start++
    if (text[start] === '\n') start++
    const end = text.indexOf('endstream', start)
    if (end < 0) return null
    const data = this.bytes.subarray(start, end)
    if (/\/Filter\s*\/FlateDecode/.test(d)) {
      try {
        return unzlibSync(data)
      } catch {
        return null
      }
    }
    return /\/Filter/.test(d) ? null : data
  }

  private type1Style(num: number, gen: number): Descriptor['type1'] {
    const data = this.stream(num, gen)
    if (!data) return null
    const head = new TextDecoder('latin1').decode(data.subarray(0, 8192))
    const weight = /\/Weight\s*\(([^)]*)\)/.exec(head)?.[1] ?? ''
    const angle = Number(/\/ItalicAngle\s+(-?[\d.]+)/.exec(head)?.[1] ?? 0)
    return {
      bold: weight === 'Bold' || weight === 'Black',
      italic: angle !== 0,
      mono: /\/isFixedPitch\s+true/.test(head),
    }
  }

  dict(num: number, gen: number): string | null {
    this.text ??= new TextDecoder('latin1').decode(this.bytes)
    const re = new RegExp(`(?:^|[^0-9])${num}\\s+${gen}\\s+obj\\b`, 'g')
    let start = -1
    for (let m = re.exec(this.text); m; m = re.exec(this.text)) start = m.index + m[0].length
    if (start < 0) return null
    const ends = ['stream', 'endobj'].map((k) => this.text!.indexOf(k, start)).filter((i) => i >= 0)
    return this.text.slice(start, ends.length ? Math.min(...ends) : start + 4096)
  }
}

// The PDF value starting at `i` in `t` (a name, number, reference, array).
function pdfValue(t: string, i: number): string {
  while (i < t.length && /\s/.test(t[i])) i++
  if (t[i] === '[') {
    let depth = 0
    for (let j = i; j < t.length; j++) {
      if (t[j] === '[') depth++
      else if (t[j] === ']' && --depth === 0) return t.slice(i, j + 1)
    }
    return t.slice(i)
  }
  const ref = /^\d+\s+\d+\s+R/.exec(t.slice(i, i + 32))
  if (ref) return ref[0]
  const tok = /^\/?[^\s/[\]<>()]+/.exec(t.slice(i))
  return tok ? tok[0] : ''
}

function colorSpacePngOk(raw: RawObjects, cs: string, depth = 0): boolean {
  if (depth > 8) return true
  const ref = /^(\d+)\s+(\d+)\s+R$/.exec(cs)
  if (ref) {
    const d = raw.dict(Number(ref[1]), Number(ref[2]))
    return d === null ? true : colorSpacePngOk(raw, pdfValue(d, 0), depth + 1)
  }
  if (cs.startsWith('[')) {
    const inner = cs.slice(1, -1)
    const family = pdfValue(inner, 0)
    const rest = inner.slice(inner.indexOf(family) + family.length)
    if (family === '/ICCBased') {
      const r = /^\s*(\d+)\s+(\d+)\s+R/.exec(rest)
      const d = r ? raw.dict(Number(r[1]), Number(r[2])) : null
      const n = d ? /\/N\s+(\d+)/.exec(d) : null
      return !n || n[1] === '1' || n[1] === '3'
    }
    if (family === '/Indexed') return colorSpacePngOk(raw, pdfValue(rest, 0), depth + 1)
    return colorSpacePngOk(raw, family, depth + 1)
  }
  return !['/DeviceCMYK', '/Separation', '/DeviceN', '/Lab'].includes(cs)
}

function imagePngWritable(raw: RawObjects, ref: string | undefined): boolean {
  const m = ref ? /^(\d+)R(\d*)$/.exec(ref) : null
  if (!m) return true
  const d = raw.dict(Number(m[1]), Number(m[2] || 0))
  if (d === null || /\/ImageMask\s+true/.test(d)) return true
  const at = d.indexOf('/ColorSpace')
  return at < 0 ? true : colorSpacePngOk(raw, pdfValue(d, at + '/ColorSpace'.length))
}

// ---------------- the document ----------------

// `options` go to pdf.js's getDocument: where it finds its decoders and
// data in this environment (wasmUrl for JBIG2 / CCITT / JPEG 2000 images,
// cMapUrl + cMapPacked for CJK text, standardFontDataUrl).
export async function openPdfSource(bytes: Uint8Array, loader: PdfJsLoader = defaultLoader,
  options: Record<string, unknown> = {}): Promise<PdfSource> {
  const lib = await loader()
  const raw = new RawObjects(bytes)
  // Without standard font data pdf.js marks a non-embedded font missingFile,
  // which is how a base-14 font is recognised here.
  const { standardFontDataUrl: _unused, ...rest } = options
  const task = lib.getDocument({
    ...rest,
    data: bytes.slice(),  // pdf.js takes ownership of (detaches) the buffer
    fontExtraProperties: true,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    verbosity: 0,
  })
  const doc = await task.promise
  const metaRaw = await doc.getMetadata().catch(() => ({ info: {} }))
  const info: Record<string, unknown> = metaRaw?.info ?? {}
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const pages: PdfJsPage[] = []
  const heights: number[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    pages.push(page)
    heights.push(page.getViewport({ scale: 1 }).height)
  }
  const walked = new Map<number, Promise<{ dict: PdfTextDict; images: PageImageRef[] }>>()
  const walk = (i: number) => {
    let w = walked.get(i)
    if (!w) {
      w = walkPage(pages[i], lib.OPS, raw)
      walked.set(i, w)
    }
    return w
  }
  return {
    pageCount: doc.numPages,
    metadata: { title: str(info.Title), author: str(info.Author), keywords: str(info.Keywords) },
    pageHeight: (i) => heights[i],
    textDict: async (i) => (await walk(i)).dict,
    images: async (i) => {
      const page = pages[i]
      const refs = (await walk(i)).images
      const found: { num: number; image: PdfImage }[] = []
      const seen = new Set<string>()
      for (const ref of refs) {
        const objs = ref.objId.startsWith('g_') ? page.commonObjs : page.objs
        const img = (await getObj(objs, ref.objId)) as PdfJsImage | null
        if (!img || typeof img.width !== 'number') continue
        // The image's object number is PyMuPDF's xref; without one, the
        // pixels stand in for it.
        const xref = img.ref ?? imageKey(img)
        if (seen.has(xref)) continue
        seen.add(xref)
        const num = img.ref ? parseInt(img.ref, 10) : Infinity
        const ok = imagePngWritable(raw, img.ref)
        found.push({ num, image: { xref, pixmap: async () => imagePixmap(img, ok) } })
      }
      // get_images() lists the page's image resources, which are usually
      // in object order; pdf.js reports them in painting order.
      return found.sort((a, b) => a.num - b.num).map((f) => f.image)
    },
    close: () => task.destroy(),
  }
}
