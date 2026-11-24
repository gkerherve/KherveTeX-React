// Export a document model tree to a .docx (Word) file. A port of
// khervedoc/docx_exporter.py.
//
// Reverse of the .docx importer: walks the model and builds a Word
// package, mapping each node type back to the Word style / formatting it
// originally came from. Python builds it with python-docx, starting from
// docx.Document() (python-docx's default.docx); this port starts from the
// package python-docx saves for that template (docxTemplate.ts, generated
// by scripts/make_golden_docx.py) and reproduces what python-docx and lxml
// write for each call, so word/document.xml, the relationships, the
// content types and docProps/core.xml are byte-identical to the Python
// app's and the zip entries come in the same order.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { CALLOUT_KINDS, THEOREM_KINDS } from './model.ts'
import type { Document, Inline, Table } from './model.ts'
import type { FileAccess } from './kdocz.ts'
import { DOCX_TEMPLATE_B64 } from './docxTemplate.ts'
import { imageHeader } from './docxImage.ts'
import type { ImageHeader } from './docxImage.ts'
import { PyError, pyIndex } from './docxPackage.ts'
import { basename, join } from './paths.ts'
import { pyIntParse, pyRound, pyTitle, strip } from './py.ts'
import { ReferenceResolver } from './references.ts'
import { byCode } from './pageSizes.ts'
import { formatDate } from './dateFormat.ts'
import { latexToOmml } from './latexOmml.ts'
import { autoBibliography, citeMode, texText } from './autoBibliography.ts'
import type { Run as BibRun } from './autoBibliography.ts'
import { parseTheBibliography } from './bibliography.ts'
import { referables } from './labels.ts'
import { ommlDisplay, ommlInline } from './latexOmml.ts'

// Optional progress callback: (current_block, total_blocks).
export type ProgressCallback = ((current: number, total: number) => void) | null

// What the export needs beyond the document.
export interface DocxOptions {
  // The .bib text of the document's references (its KherveRef library or
  // own list): citations are numbered and the reference list written
  // from it, as the PDF prints them.
  bibText?: string
  // Who signs comments that carry no author (Review > Your name).
  author?: string
}

// ---------------------------------------------------------------- lxml tree

// An element as lxml serialises it: attributes in the order they were set,
// `text` before the children (null = no text node, "" = an empty one, which
// lxml writes as <a></a> rather than <a/>). `nsdecl` holds namespace
// declarations lxml keeps on the element; `raw` a pre-serialised subtree.
class El {
  tag: string
  attrs: [string, string][] = []
  kids: El[] = []
  text: string | null = null
  parent: El | null = null
  nsdecl = ''
  raw: string | null = null
  constructor(tag: string, attrs: [string, string][] = []) {
    this.tag = tag
    for (const [k, v] of attrs) setAttr(this, k, v)
  }
}

// lxml refuses strings XML cannot carry (control characters, U+FFFE/U+FFFF,
// lone surrogates).
// oxlint-disable-next-line no-control-regex
const XML_BAD = /[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
function checkXml(s: string): string {
  if (XML_BAD.test(s)) {
    throw new PyError('ValueError', 'All strings must be XML compatible: Unicode or ASCII, no NULL bytes or control characters')
  }
  return s
}

function setAttr(e: El, k: string, v: string): void {
  checkXml(v)
  const a = e.attrs.find((x) => x[0] === k)
  if (a) a[1] = v
  else e.attrs.push([k, v])
}

function delAttr(e: El, k: string): void {
  e.attrs = e.attrs.filter((x) => x[0] !== k)
}

const getAttr = (e: El, k: string): string | null => e.attrs.find((x) => x[0] === k)?.[1] ?? null

function setText(e: El, s: string): void {
  e.text = checkXml(s)
}

function detach(c: El): void {
  if (c.parent) {
    c.parent.kids.splice(c.parent.kids.indexOf(c), 1)
    c.parent = null
  }
}

function append(p: El, c: El): El {
  detach(c)
  p.kids.push(c)
  c.parent = p
  return c
}

function insertAt(p: El, i: number, c: El): El {
  detach(c)
  p.kids.splice(i, 0, c)
  c.parent = p
  return c
}

const findChild = (p: El, tag: string): El | null => p.kids.find((k) => k.tag === tag) ?? null
const findChildren = (p: El, tag: string): El[] => p.kids.filter((k) => k.tag === tag)

function removeAll(p: El, tag: string): void {
  for (const k of findChildren(p, tag)) detach(k)
}

// BaseOxmlElement.insert_element_before: before the first child found among
// `successors`, searched tag by tag in that order; appended if none is there.
function insertBefore(p: El, c: El, successors: readonly string[]): El {
  for (const t of successors) {
    const s = findChild(p, t)
    if (s) return insertAt(p, p.kids.indexOf(s), c)
  }
  return append(p, c)
}

function getOrAdd(p: El, tag: string, seq: readonly string[]): El {
  return findChild(p, tag) ?? insertBefore(p, new El(tag), seq.slice(seq.indexOf(tag) + 1))
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;')
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;')

function serialize(e: El): string {
  if (e.raw !== null) return e.raw
  let s = '<' + e.tag + e.nsdecl
  for (const [k, v] of e.attrs) s += ` ${k}="${escAttr(v)}"`
  if (e.text === null && !e.kids.length) return s + '/>'
  s += '>' + (e.text === null ? '' : escText(e.text))
  for (const k of e.kids) s += serialize(k)
  return s + `</${e.tag}>`
}

// ---------------------------------------------------------------- python-docx schema order

const RPR_SEQ = [
  'w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike',
  'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid',
  'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz',
  'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign',
  'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath',
] as const
const PPR_SEQ = [
  'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl',
  'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens',
  'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE',
  'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind',
  'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection',
  'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr',
  'w:sectPr', 'w:pPrChange',
] as const
const TCPR_SEQ = [
  'w:cnfStyle', 'w:tcW', 'w:gridSpan', 'w:hMerge', 'w:vMerge', 'w:tcBorders', 'w:shd', 'w:noWrap',
  'w:tcMar', 'w:textDirection', 'w:tcFitText', 'w:vAlign', 'w:hideMark', 'w:headers', 'w:cellIns',
  'w:cellDel', 'w:cellMerge', 'w:tcPrChange',
] as const

// Style names export_docx asks for → their ids in python-docx's default
// template (none of them is a default style, so each gets a w:pStyle).
const PARAGRAPH_STYLE_IDS: Record<string, string> = {
  Title: 'Title', Subtitle: 'Subtitle', 'Heading 1': 'Heading1', 'Heading 2': 'Heading2',
  'Heading 3': 'Heading3', 'Heading 4': 'Heading4', 'Heading 5': 'Heading5',
  'List Number': 'ListNumber', 'List Bullet': 'ListBullet',
}
const TABLE_STYLE_IDS: Record<string, string> = { 'Table Grid': 'TableGrid' }

const RT_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const RT_HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

// EMU per unit (docx.shared.Length).
const EMUS_PER_INCH = 914400
const EMUS_PER_CM = 360000
const EMUS_PER_TWIP = 635
const twips = (emu: number) => pyRound(emu / EMUS_PER_TWIP, 0)
const Inches = (x: number) => Math.trunc(x * EMUS_PER_INCH)
const Cm = (x: number) => Math.trunc(x * EMUS_PER_CM)

function validateRange(v: number, lo: number, hi: number): void {
  if (v < lo || v > hi) throw new PyError('ValueError', `value must be in range ${lo} to ${hi} inclusive, got ${v}`)
}

// ---------------------------------------------------------------- paragraphs and runs

const paraRuns = (p: El) => findChildren(p, 'w:r')

function getOrAddPPr(p: El): El {
  return findChild(p, 'w:pPr') ?? insertAt(p, 0, new El('w:pPr'))
}

function getOrAddRPr(r: El): El {
  return findChild(r, 'w:rPr') ?? insertAt(r, 0, new El('w:rPr'))
}

// Paragraph.alignment = WD_ALIGN_PARAGRAPH.X
type Jc = 'left' | 'center' | 'right' | 'both'
function setAlignment(p: El, jc: Jc): void {
  setAttr(getOrAdd(getOrAddPPr(p), 'w:jc', PPR_SEQ), 'w:val', jc)
}

// A box: the paragraph gets a thin black frame on all four sides (Word's
// paragraph border), the nearest Word has to \fbox.
function setBoxBorder(p: El): void {
  const bdr = getOrAdd(getOrAddPPr(p), 'w:pBdr', PPR_SEQ)
  for (const side of ['w:top', 'w:left', 'w:bottom', 'w:right']) {
    const e = new El(side)
    setAttr(e, 'w:val', 'single')
    setAttr(e, 'w:sz', '6')
    setAttr(e, 'w:space', '4')
    setAttr(e, 'w:color', '000000')
    append(bdr, e)
  }
}

function setPStyle(p: El, style: string): void {
  setAttr(getOrAdd(getOrAddPPr(p), 'w:pStyle', PPR_SEQ), 'w:val', PARAGRAPH_STYLE_IDS[style])
}

// _RunContentAppender: tabs become w:tab, CR / LF w:br, the rest w:t
// (xml:space="preserve" when it has leading or trailing whitespace).
function setRunText(r: El, s: string): void {
  r.kids.filter((k) => k.tag !== 'w:rPr').forEach(detach)
  let buf = ''
  const flush = () => {
    if (buf) {
      const t = new El('w:t')
      setText(t, buf)
      append(r, t)
      if ([...strip(buf)].length < [...buf].length) setAttr(t, 'xml:space', 'preserve')
    }
    buf = ''
  }
  for (const ch of s) {
    if (ch === '\t') {
      flush()
      append(r, new El('w:tab'))
    } else if (ch === '\r' || ch === '\n') {
      flush()
      append(r, new El('w:br'))
    } else {
      buf += ch
    }
  }
  flush()
}

function addRun(p: El, s = ''): El {
  const r = append(p, new El('w:r'))
  if (s) setRunText(r, s)
  return r
}

// CT_RPr._set_bool_val: w:val is omitted for True (its default).
function setBool(r: El, tag: string, value: boolean): void {
  const e = getOrAdd(getOrAddRPr(r), tag, RPR_SEQ)
  if (value) delAttr(e, 'w:val')
  else setAttr(e, 'w:val', '0')
}

const setBold = (r: El, v: boolean) => setBool(r, 'w:b', v)
const setItalic = (r: El, v: boolean) => setBool(r, 'w:i', v)

function setUnderline(r: El): void {
  const rPr = getOrAddRPr(r)
  removeAll(rPr, 'w:u')
  const u = insertBefore(rPr, new El('w:u'), RPR_SEQ.slice(RPR_SEQ.indexOf('w:u') + 1))
  setAttr(u, 'w:val', 'single')
}

function setVertAlign(r: El, val: 'subscript' | 'superscript'): void {
  setAttr(getOrAdd(getOrAddRPr(r), 'w:vertAlign', RPR_SEQ), 'w:val', val)
}

function setFontName(r: El, name: string): void {
  const rPr = getOrAddRPr(r)
  setAttr(getOrAdd(rPr, 'w:rFonts', RPR_SEQ), 'w:ascii', name)
  setAttr(getOrAdd(rPr, 'w:rFonts', RPR_SEQ), 'w:hAnsi', name)
}


// repr() of a model node, which Python's str() of a dataclass gives.
function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return pyStrRepr(v)
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']'
  const o = v as Record<string, unknown>
  if (typeof o.type === 'string') {
    return `${o.type}(` + Object.entries(o).map(([k, x]) => `${k}=${pyRepr(x)}`).join(', ') + ')'
  }
  return '{' + Object.entries(o).map(([k, x]) => `${pyStrRepr(k)}: ${pyRepr(x)}`).join(', ') + '}'
}

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u

function pyStrRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'"
  let out = q
  for (const ch of s) {
    if (ch === q || ch === '\\') out += '\\' + ch
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch !== ' ' && NON_PRINTABLE.test(ch)) {
      const cp = ch.codePointAt(0)!
      if (cp <= 0xff) out += '\\x' + cp.toString(16).padStart(2, '0')
      else if (cp <= 0xffff) out += '\\u' + cp.toString(16).padStart(4, '0')
      else out += '\\U' + cp.toString(16).padStart(8, '0')
    } else out += ch
  }
  return out + q
}

// ---------------------------------------------------------------- the package being built

// An image part keeps the Image it was made from: a later picture with the
// same bytes reuses the part, and with it that first file's name and size.
interface ImagePart { partname: string; blob: Uint8Array; contentType: string; filename: string; header: ImageHeader }
interface NewRel { rId: string; reltype: string; target: string; external: boolean; part?: ImagePart }

class Builder {
  body: El[] = []
  rIds: Set<string>
  rels: NewRel[] = []
  images: ImagePart[] = []
  shapes = 0
  pageWidth = 0
  leftMargin = 0
  rightMargin = 0
  // Word footnotes (word/footnotes.xml) and comments (word/comments.xml),
  // each serialised; their hyperlinks go in their own parts' relationships.
  footnotes: string[] = []
  comments: string[] = []
  noteRels: NewRel[] = []
  commentRels: NewRel[] = []
  // Inside a footnote or a comment (no notes within notes).
  inNote: 'footnotes' | 'comments' | null = null
  resolver: ReferenceResolver | null = null
  author = ''
  constructor(templateRIds: string[]) {
    this.rIds = new Set(templateRIds)
  }

  // The relationships of the part being written.
  private relsOf(): { rels: NewRel[]; ids: Set<string> } {
    if (this.inNote === null) return { rels: this.rels, ids: this.rIds }
    const rels = this.inNote === 'footnotes' ? this.noteRels : this.commentRels
    return { rels, ids: new Set(rels.map((r) => r.rId)) }
  }

  // Relationships._next_rId: the first free rIdN.
  private nextRId(): string {
    for (let n = 1; ; n++) if (!this.rIds.has(`rId${n}`)) return `rId${n}`
  }

  // part.relate_to(url, RT.HYPERLINK, is_external=True)
  relateExternal(reltype: string, target: string): string {
    const { rels, ids } = this.relsOf()
    const hit = rels.find((r) => r.external && r.reltype === reltype && r.target === target)
    if (hit) return hit.rId
    let rId = this.nextRId()
    if (this.inNote !== null) for (let n = 1; ids.has(rId = `rId${n}`); n++);
    else this.rIds.add(rId)
    rels.push({ rId, reltype, target, external: true })
    return rId
  }

  relatePart(reltype: string, part: ImagePart): string {
    const hit = this.rels.find((r) => !r.external && r.reltype === reltype && r.part === part)
    if (hit) return hit.rId
    const rId = this.nextRId()
    this.rIds.add(rId)
    this.rels.push({ rId, reltype, target: part.partname.slice('/word/'.length), external: false, part })
    return rId
  }

  addParagraph(text = '', style: string | null = null): El {
    const p = new El('w:p')
    this.body.push(p)
    if (text) addRun(p, text)
    if (style !== null) setPStyle(p, style)
    return p
  }
}

// ---------------------------------------------------------------- alignment mapping

function _shadeCell(tc: El, color: string): void {
  const shd = new El('w:shd')
  setAttr(shd, 'w:val', 'clear')
  setAttr(shd, 'w:color', 'auto')
  setAttr(shd, 'w:fill', color.replace(/^#+/, '').toUpperCase())
  append(getOrAddTcPr(tc), shd)
}

// Word's "Repeat as header row at the top of each page".
function _repeatHeaderRow(tr: El): void {
  const el = new El('w:tblHeader')
  setAttr(el, 'w:val', 'true')
  const trPr = findChild(tr, 'w:trPr') ?? insertAt(tr, 0, new El('w:trPr'))
  append(trPr, el)
}

const _ALIGN_MAP: Record<string, Jc> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'both',
}

// ---- heading level → Word style name -------------------------------------

const _HEADING_STYLES: Record<number, string> = {
  1: 'Heading 1', 2: 'Heading 2', 3: 'Heading 3',
  4: 'Heading 4', 5: 'Heading 5',
}

const has = (o: object, k: string | number) => Object.prototype.hasOwnProperty.call(o, k)

// ---- inline rendering ----------------------------------------------------

// Append inline nodes to a paragraph as runs.
function _addInlines(b: Builder, para: El, inlines: Inline[]): void {
  for (const inline of inlines) {
    if (inline.type === 'Text') {
      const run = addRun(para, inline.text)
      for (const mark of inline.marks) {
        if (mark === 'bold') setBold(run, true)
        else if (mark === 'italic') setItalic(run, true)
        else if (mark === 'underline') setUnderline(run)
        else if (mark === 'strikethrough') setBool(run, 'w:strike', true)
        else if (mark === 'subscript') setVertAlign(run, 'subscript')
        else if (mark === 'superscript') setVertAlign(run, 'superscript')
        else if (mark === 'smallcaps') setBool(run, 'w:smallCaps', true)
        else if (mark === 'code') setFontName(run, 'Courier New')
      }
    } else if (inline.type === 'MathInline') {
      // A Word equation the reader can edit.
      append(para, rawEl(ommlInline(inline.latex)))
    } else if (inline.type === 'Link') {
      _addHyperlink(b, para, inline.url, inline.children)
    } else if (inline.type === 'Footnote') {
      if (b.inNote !== null) {
        addRun(para, ` (${plainText(inline.children)})`)
      } else {
        _addFootnote(b, para, inline.children)
      }
    } else if (inline.type === 'Citation') {
      addRun(para, b.resolver ? b.resolver.citeText(inline.keys, inline.style) : `[${inline.keys.join(', ')}]`)
    } else if (inline.type === 'CrossRef') {
      addRun(para, b.resolver ? b.resolver.refText(inline.label, inline.kind) : `[${inline.kind}:${inline.label}]`)
    } else if (inline.type === 'InlineRaw') {
      const run = addRun(para, inline.latex)
      setFontName(run, 'Courier New')
    } else if (inline.type === 'Highlight') {
      addRun(para)
      _addInlinesToRunGroup(b, para, inline.children)
      // Apply highlight via XML — python-docx has limited highlight API
      const colorMap: Record<string, string> = {
        yellow: 'yellow', green: 'green', blue: 'cyan',
        pink: 'magenta', orange: 'darkYellow',
      }
      const wdColor = has(colorMap, inline.color) ? colorMap[inline.color] : 'yellow'
      // para.runs[-len(children):] — every run when there are no children.
      const runs = paraRuns(para)
      const n = inline.children.length
      for (const r of n === 0 ? runs : runs.slice(Math.max(0, runs.length - n))) {
        const rpr = getOrAddRPr(r)
        const hi = new El('w:highlight')
        setAttr(hi, 'w:val', wdColor)
        append(rpr, hi)
      }
    } else if (inline.type === 'Comment') {
      if (b.inNote === 'comments' || !inline.note) {
        _addInlines(b, para, inline.children)
      } else {
        _addComment(b, para, inline)
      }
    }
  }
}

// An element written as given (OMML built as text).
function rawEl(xml: string): El {
  const e = new El('raw')
  e.raw = xml
  return e
}

const plainText = (inl: Inline[]): string => inl.map((i) => (i.type === 'Text' ? i.text
  : i.type === 'MathInline' ? i.latex : 'children' in i ? plainText(i.children) : '')).join('')

// A real Word footnote: the number in the text, the note at the foot of
// the page (word/footnotes.xml).
function _addFootnote(b: Builder, para: El, children: Inline[]): void {
  const id = b.footnotes.length + 1
  const ref = addRun(para)
  setVertAlign(ref, 'superscript')
  append(ref, new El('w:footnoteReference', [['w:id', String(id)]]))
  const p = new El('w:p')
  append(getOrAddPPr(p), new El('w:spacing', [['w:after', '0'], ['w:line', '240'], ['w:lineRule', 'auto']]))
  const mark = addRun(p)
  setVertAlign(mark, 'superscript')
  append(mark, new El('w:footnoteRef'))
  addRun(p, ' ')
  b.inNote = 'footnotes'
  try { _addInlines(b, p, children) } finally { b.inNote = null }
  for (const r of paraRuns(p)) setAttr(getOrAdd(getOrAddRPr(r), 'w:sz', RPR_SEQ), 'w:val', '20')
  b.footnotes.push(`<w:footnote w:id="${id}">${serialize(p)}</w:footnote>`)
}

// A Word comment on the text it covers, signed with its author's name
// (word/comments.xml).
function _addComment(b: Builder, para: El, c: Extract<Inline, { type: 'Comment' }>): void {
  const id = String(b.comments.length)
  append(para, new El('w:commentRangeStart', [['w:id', id]]))
  _addInlines(b, para, c.children)
  append(para, new El('w:commentRangeEnd', [['w:id', id]]))
  const ref = addRun(para)
  append(ref, new El('w:commentReference', [['w:id', id]]))
  const author = c.author || b.author || 'KherveTeX'
  const initials = author.split(/[\s-]+/).filter(Boolean).map((w) => [...w][0].toUpperCase()).join('').slice(0, 4)
  const attrs: [string, string][] = [['w:id', id], ['w:author', author], ['w:initials', initials]]
  const date = wordDate(c.timestamp)
  if (date) attrs.push(['w:date', date])
  const comment = new El('w:comment', attrs)
  const p = append(comment, new El('w:p'))
  const mark = addRun(p)
  append(mark, new El('w:annotationRef'))
  b.inNote = 'comments'
  try {
    addRun(p, (c.resolved ? '[Resolved] ' : '') + c.note)
  } finally { b.inNote = null }
  b.comments.push(serialize(comment))
}

// A comment's timestamp as Word's xsd:dateTime ("2026-11-22T10:15:00Z").
function wordDate(ts: string): string {
  if (!ts) return ''
  const t = Date.parse(/^\d{4}-\d\d-\d\d \d/.test(ts) ? ts.replace(' ', 'T') : ts)
  return Number.isNaN(t) ? '' : new Date(t).toISOString().replace(/\.\d+Z$/, 'Z')
}

// Add inlines as runs (used for nested groups like Highlight children).
function _addInlinesToRunGroup(b: Builder, para: El, inlines: Inline[]): void {
  _addInlines(b, para, inlines)
}

// Insert a hyperlink into a paragraph using low-level OOXML.
function _addHyperlink(b: Builder, para: El, url: string, children: Inline[]): void {
  const rId = b.relateExternal(RT_HYPERLINK, url)

  const hyperlink = new El('w:hyperlink')
  setAttr(hyperlink, 'r:id', rId)

  for (const inline of children) {
    if (inline.type === 'Text') {
      const newRun = new El('w:r')
      const rpr = new El('w:rPr')
      const rStyle = new El('w:rStyle')
      setAttr(rStyle, 'w:val', 'Hyperlink')
      append(rpr, rStyle)
      append(newRun, rpr)
      const t = new El('w:t')
      setText(t, inline.text)
      append(newRun, t)
      append(hyperlink, newRun)
    } else {
      const newRun = new El('w:r')
      const t = new El('w:t')
      setText(t, pyRepr(inline))
      append(newRun, t)
      append(hyperlink, newRun)
    }
  }

  append(para, hyperlink)
}

// ---------------------------------------------------------------- pictures

// os.path.splitext(filename)[1][1:]
function splitextExt(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot > 0 && /[^.]/.test(name.slice(0, dot))) return name.slice(dot + 1)
  return ''
}

// (ext, content type) pairs python-docx files under a Default entry.
const DEFAULT_CONTENT_TYPES = new Set([
  'bmp image/bmp', 'gif image/gif', 'jpe image/jpeg', 'jpeg image/jpeg', 'jpg image/jpeg',
  'png image/png', 'tif image/tiff', 'tiff image/tiff',
])

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

// Run.add_picture(path, width=Inches(4.5))
function addPicture(b: Builder, run: El, path: string, blob: Uint8Array, widthIn = 4.5): void {
  const newName = basename(path)
  const newHeader = imageHeader(blob)
  // ImageParts.get_or_add_image_part: the same bytes share one part.
  let part = b.images.find((p) => sameBytes(p.blob, blob))
  if (!part) {
    part = {
      partname: `/word/media/image${b.images.length + 1}.${splitextExt(newName)}`, blob,
      contentType: newHeader.contentType, filename: newName, header: newHeader,
    }
    b.images.push(part)
  }
  const rId = b.relatePart(RT_IMAGE, part)
  const { filename, header } = part
  // Image.scaled_dimensions(width=Inches(4.5)): the height keeps the
  // aspect ratio of the size the dpi gives.
  if (header.pxWidth === null || header.pxHeight === null) {
    throw new PyError('TypeError', "unsupported operand type(s) for /: 'NoneType' and 'int'")
  }
  if (header.horzDpi === 0 || header.vertDpi === 0) throw new PyError('ZeroDivisionError', 'division by zero')
  const width = Inches(header.pxWidth / header.horzDpi)
  const height = Inches(header.pxHeight / header.vertDpi)
  const cx = Inches(widthIn)
  if (width === 0) throw new PyError('ZeroDivisionError', 'float division by zero')
  const cy = pyRound(height * (cx / width), 0)
  validateRange(cx, 0, 27273042316900)
  validateRange(cy, 0, 27273042316900)
  // StoryPart.next_id: one more than the largest id="" in the document;
  // the only ones are the pictures' wp:docPr (1, 2, ...) and pic:cNvPr (0).
  b.shapes += 1
  const id = b.shapes
  checkXml(filename)
  const drawing = new El('w:drawing')
  const inline = new El('wp:inline')
  inline.raw =
    '<wp:inline xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${escAttr(filename)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline>'
  append(drawing, inline)
  append(run, drawing)
}

// ---------------------------------------------------------------- tables (python-docx CT_Tbl / CT_Tc)

function getOrAddTcPr(tc: El): El {
  return findChild(tc, 'w:tcPr') ?? insertAt(tc, 0, new El('w:tcPr'))
}

function gridSpan(tc: El): number {
  const tcPr = findChild(tc, 'w:tcPr')
  const gs = tcPr && findChild(tcPr, 'w:gridSpan')
  return gs ? Number(getAttr(gs, 'w:val')) : 1
}

function setGridSpan(tc: El, value: number): void {
  const tcPr = getOrAddTcPr(tc)
  removeAll(tcPr, 'w:gridSpan')
  if (value > 1) setAttr(getOrAdd(tcPr, 'w:gridSpan', TCPR_SEQ), 'w:val', String(value))
}

function vMerge(tc: El): string | null {
  const tcPr = findChild(tc, 'w:tcPr')
  const vm = tcPr && findChild(tcPr, 'w:vMerge')
  return vm ? (getAttr(vm, 'w:val') ?? 'continue') : null
}

function setVMerge(tc: El, value: string | null): void {
  const tcPr = getOrAddTcPr(tc)
  removeAll(tcPr, 'w:vMerge')
  if (value !== null) {
    const vm = insertBefore(tcPr, new El('w:vMerge'), TCPR_SEQ.slice(TCPR_SEQ.indexOf('w:vMerge') + 1))
    if (value !== 'continue') setAttr(vm, 'w:val', value)
  }
}

// CT_Tc.width (twips × 635 when w:type is "dxa", else None).
function tcWidth(tc: El): number | null {
  const tcPr = findChild(tc, 'w:tcPr')
  const tcW = tcPr && findChild(tcPr, 'w:tcW')
  if (!tcW || getAttr(tcW, 'w:type') !== 'dxa') return null
  return Number(getAttr(tcW, 'w:w')) * EMUS_PER_TWIP
}

function setTcWidth(tc: El, emu: number): void {
  const tcW = getOrAdd(getOrAddTcPr(tc), 'w:tcW', TCPR_SEQ)
  setAttr(tcW, 'w:type', 'dxa')
  setAttr(tcW, 'w:w', String(twips(emu)))
}

const trList = (tbl: El) => findChildren(tbl, 'w:tr')
const tcList = (tr: El) => findChildren(tr, 'w:tc')
const trOf = (tc: El) => tc.parent!
const tblOf = (tc: El) => tc.parent!.parent!
const trIdx = (tc: El) => trList(tblOf(tc)).indexOf(trOf(tc))

function gridOffset(tc: El): number {
  let sum = 0
  for (const s of tcList(trOf(tc))) {
    if (s === tc) break
    sum += gridSpan(s)
  }
  return sum
}

function tcAtGridOffset(tr: El, offset: number): El {
  let remaining = offset
  for (const tc of tcList(tr)) {
    if (remaining < 0) break
    if (remaining === 0) return tc
    remaining -= gridSpan(tc)
  }
  throw new PyError('ValueError', `no \`tc\` element at grid_offset=${offset}`)
}

function tcAbove(tc: El): El {
  const i = trIdx(tc)
  if (i === 0) throw new PyError('ValueError', 'no tr above topmost tr in w:tbl')
  return tcAtGridOffset(trList(tblOf(tc))[i - 1], gridOffset(tc))
}

function tcBelow(tc: El): El | null {
  const trs = trList(tblOf(tc))
  const below = trs[trIdx(tc) + 1]
  return below === undefined ? null : tcAtGridOffset(below, gridOffset(tc))
}

function tcTop(tc: El): number {
  const v = vMerge(tc)
  if (v === null || v === 'restart') return trIdx(tc)
  return tcTop(tcAbove(tc))
}

function tcBottom(tc: El): number {
  if (vMerge(tc) !== null) {
    const below = tcBelow(tc)
    if (below !== null && vMerge(below) === 'continue') return tcBottom(below)
  }
  return trIdx(tc) + 1
}

const tcLeft = (tc: El) => gridOffset(tc)
const tcRight = (tc: El) => gridOffset(tc) + gridSpan(tc)

const blockItems = (tc: El) => tc.kids.filter((k) => k.tag === 'w:p' || k.tag === 'w:tbl' || k.tag === 'w:sdt')

function isEmpty(tc: El): boolean {
  const items = blockItems(tc)
  if (items.length > 1) return false
  const only = pyIndex(items, 0)
  return only.tag === 'w:p' && findChildren(only, 'w:r').length === 0
}

function removeTrailingEmptyP(tc: El): void {
  const last = pyIndex(blockItems(tc), -1)
  if (last.tag !== 'w:p') return
  if (findChildren(last, 'w:r').length > 0) return
  detach(last)
}

function moveContentTo(tc: El, other: El): void {
  if (other === tc) return
  if (isEmpty(tc)) return
  removeTrailingEmptyP(other)
  // -- appending moves each element from self to other_tc --
  for (const block of blockItems(tc)) append(other, block)
  // -- add back the required minimum single empty <w:p> element --
  append(tc, new El('w:p'))
}

function swallowNextTc(tc: El, gridWidth: number, topTc: El): void {
  const tcs = tcList(trOf(tc))
  const next = tcs[tcs.indexOf(tc) + 1] ?? null
  if (next === null) throw new PyError('InvalidSpanError', 'not enough grid columns')
  if (gridSpan(tc) + gridSpan(next) > gridWidth) throw new PyError('InvalidSpanError', 'span is not rectangular')
  moveContentTo(next, topTc)
  const w1 = tcWidth(tc)
  const w2 = tcWidth(next)
  if (w1 && w2) setTcWidth(tc, w1 + w2)
  setGridSpan(tc, gridSpan(tc) + gridSpan(next))
  detach(next)
}

function spanToWidth(tc: El, gridWidth: number, topTc: El, vm: string | null): void {
  moveContentTo(tc, topTc)
  while (gridSpan(tc) < gridWidth) swallowNextTc(tc, gridWidth, topTc)
  setVMerge(tc, vm)
}

function growTo(tc: El, width: number, height: number, topTc: El | null = null): void {
  const top = topTc === null ? tc : topTc
  const vm = top !== tc ? 'continue' : height === 1 ? null : 'restart'
  spanToWidth(tc, width, top, vm)
  if (height > 1) growTo(tcBelow(tc)!, width, height - 1, top)
}

function spanDimensions(a: El, b: El): [number, number, number, number] {
  const invertedL = (x: El, y: El) => {
    if (tcTop(x) === tcTop(y) && tcBottom(x) !== tcBottom(y)) throw new PyError('InvalidSpanError', 'requested span not rectangular')
    if (tcLeft(x) === tcLeft(y) && tcRight(x) !== tcRight(y)) throw new PyError('InvalidSpanError', 'requested span not rectangular')
  }
  const teeShaped = (x: El, y: El) => {
    let [topMost, other] = tcTop(x) < tcTop(y) ? [x, y] : [y, x]
    if (tcTop(topMost) < tcTop(other) && tcBottom(topMost) > tcBottom(other)) {
      throw new PyError('InvalidSpanError', 'requested span not rectangular')
    }
    ;[topMost, other] = tcLeft(x) < tcLeft(y) ? [x, y] : [y, x]
    if (tcLeft(topMost) < tcLeft(other) && tcRight(topMost) > tcRight(other)) {
      throw new PyError('InvalidSpanError', 'requested span not rectangular')
    }
  }
  invertedL(a, b)
  teeShaped(a, b)
  const top = Math.min(tcTop(a), tcTop(b))
  const left = Math.min(tcLeft(a), tcLeft(b))
  const bottom = Math.max(tcBottom(a), tcBottom(b))
  const right = Math.max(tcRight(a), tcRight(b))
  return [top, left, bottom - top, right - left]
}

// _Cell.merge → CT_Tc.merge
function mergeCells(a: El, b: El): El {
  const [top, left, height, width] = spanDimensions(a, b)
  const topTc = tcAtGridOffset(pyIndex(trList(tblOf(a)), top), left)
  growTo(topTc, width, height)
  return topTc
}

// _Row.cells
function rowCells(tr: El): El[] {
  const out: El[] = []
  const iter = (tc: El) => {
    if (vMerge(tc) === 'continue') {
      iter(tcAbove(tc))
      return
    }
    for (let i = 0; i < gridSpan(tc); i++) out.push(tc)
  }
  for (const tc of tcList(tr)) iter(tc)
  return out
}

const colCount = (tbl: El) => findChildren(findChild(tbl, 'w:tblGrid')!, 'w:gridCol').length

// Table._cells, read by Table.cell(row, col).
function tableCells(tbl: El): El[] {
  const n = colCount(tbl)
  const cells: El[] = []
  for (const tr of trList(tbl)) {
    for (const tc of tcList(tr)) {
      for (let i = 0; i < gridSpan(tc); i++) {
        if (vMerge(tc) === 'continue') cells.push(pyIndex(cells, -n))
        else if (i > 0) cells.push(cells[cells.length - 1])
        else cells.push(tc)
      }
    }
  }
  return cells
}

const tableCell = (tbl: El, r: number, c: number) => pyIndex(tableCells(tbl), c + r * colCount(tbl))

// _Cell.text = s
function setCellText(tc: El, s: string): void {
  tc.kids.filter((k) => k.tag !== 'w:tcPr').forEach(detach)
  const p = append(tc, new El('w:p'))
  const r = append(p, new El('w:r'))
  setRunText(r, s)
}

// CT_Tbl.new_tbl(rows, cols, width) as parsed from python-docx's template
// string (blank text dropped, except inside elements left without children).
function newTable(rows: number, cols: number, width: number): El {
  const colWidth = cols > 0 ? Math.floor(width / cols) : 0
  const tbl = new El('w:tbl')
  const tblPr = append(tbl, new El('w:tblPr'))
  append(tblPr, new El('w:tblW', [['w:type', 'auto'], ['w:w', '0']]))
  append(tblPr, new El('w:tblLook', [
    ['w:firstColumn', '1'], ['w:firstRow', '1'], ['w:lastColumn', '0'], ['w:lastRow', '0'],
    ['w:noHBand', '0'], ['w:noVBand', '1'], ['w:val', '04A0'],
  ]))
  const grid = append(tbl, new El('w:tblGrid'))
  for (let i = 0; i < cols; i++) append(grid, new El('w:gridCol', [['w:w', String(twips(colWidth))]]))
  if (cols === 0) grid.text = '\n  '
  for (let r = 0; r < rows; r++) {
    const tr = append(tbl, new El('w:tr'))
    for (let c = 0; c < cols; c++) {
      const tc = append(tr, new El('w:tc'))
      const tcPr = append(tc, new El('w:tcPr'))
      append(tcPr, new El('w:tcW', [['w:type', 'dxa'], ['w:w', String(twips(colWidth))]]))
      append(tc, new El('w:p'))
    }
    if (cols === 0) tr.text = '\n  '
  }
  return tbl
}

function setTableStyle(tbl: El, style: string): void {
  const tblPr = findChild(tbl, 'w:tblPr')!
  removeAll(tblPr, 'w:tblStyle')
  const ts = insertBefore(tblPr, new El('w:tblStyle'), [
    'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblStyleRowBandSize', 'w:tblStyleColBandSize',
    'w:tblW', 'w:jc', 'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders', 'w:shd', 'w:tblLayout',
    'w:tblCellMar', 'w:tblLook', 'w:tblCaption', 'w:tblDescription', 'w:tblPrChange',
  ])
  setAttr(ts, 'w:val', TABLE_STYLE_IDS[style])
}

function exportTable(b: Builder, block: Table, number?: string): void {
  // Document._block_width: the page width between the margins (a zero
  // margin counts as python-docx's 1 inch fallback).
  const width = (b.pageWidth || Inches(8.5)) - (b.leftMargin || Inches(1)) - (b.rightMargin || Inches(1))
  const tbl = newTable(block.rows.length, block.rows[0].length, width)
  b.body.push(tbl)
  setTableStyle(tbl, 'Table Grid')
  const rowsOf = () => trList(tbl)
  block.rows.forEach((row, rIdx) => {
    row.forEach((cellText, cIdx) => {
      if (cIdx < rowCells(rowsOf()[rIdx]).length) setCellText(rowCells(rowsOf()[rIdx])[cIdx], cellText)
    })
  })
  for (const [key, color] of Object.entries(block.shading)) {
    const parts = key.split(',')
    if (parts.length !== 2) {
      throw new PyError('ValueError', parts.length < 2 ? 'not enough values to unpack (expected 2, got 1)' : 'too many values to unpack (expected 2)')
    }
    const [rIdx, cIdx] = parts.map((v) => {
      try {
        return pyIntParse(v)
      } catch {
        throw new PyError('ValueError', `invalid literal for int() with base 10: '${v}'`)
      }
    })
    if (rIdx < rowsOf().length && cIdx < rowCells(pyIndex(rowsOf(), rIdx)).length) {
      _shadeCell(pyIndex(rowCells(pyIndex(rowsOf(), rIdx)), cIdx), color)
    }
  }
  for (const merge of block.merges) {
    if (merge.length !== 4) throw new PyError('ValueError', 'wrong number of values to unpack (expected 4)')
    const [rIdx, cIdx, rs, cs] = merge
    const a = tableCell(tbl, rIdx, cIdx)
    const bb = tableCell(tbl, Math.min(rIdx + rs, rowsOf().length) - 1, Math.min(cIdx + cs, colCount(tbl)) - 1)
    mergeCells(a, bb)
  }
  if (block.repeat_header && rowsOf().length > 1) _repeatHeaderRow(rowsOf()[0])
  // Bold the first row (header).
  if (block.rows.length > 1) {
    for (const tc of rowCells(rowsOf()[0])) {
      for (const p of findChildren(tc, 'w:p')) {
        for (const run of paraRuns(p)) setBold(run, true)
      }
    }
  }
  tableRules(tbl, block.style || '', rowsOf())
  // The table's own text size, on every run of its cells (half-points).
  if (block.font_size && block.font_size > 0) {
    const half = String(Math.round(block.font_size * 2))
    for (const tr of rowsOf()) {
      for (const tc of rowCells(tr)) {
        for (const p of findChildren(tc, 'w:p')) {
          for (const r of paraRuns(p)) setAttr(getOrAdd(getOrAddRPr(r), 'w:sz', RPR_SEQ), 'w:val', half)
        }
      }
    }
  }
  if (block.caption) captionPara(b, 'Table', number, block.caption, 'center')
}

// The table's rules as the PDF draws them: \hline (the default) and
// booktabs / striped a rule above, one under the header row and one below;
// plain none; grid every line (Word's Table Grid, kept).
function tableRules(tbl: El, style: string, rows: El[]): void {
  if (style === 'grid') return
  const tblPr = findChild(tbl, 'w:tblPr')!
  removeAll(tblPr, 'w:tblBorders')
  const borders = insertBefore(tblPr, new El('w:tblBorders'), ['w:shd', 'w:tblLayout', 'w:tblCellMar', 'w:tblLook', 'w:tblCaption', 'w:tblDescription', 'w:tblPrChange'])
  const heavy = style === 'booktabs' || style === 'striped' ? '12' : '4'
  const outer = style === 'plain' ? null : heavy
  for (const side of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    const line = (side === 'top' || side === 'bottom') && outer
    append(borders, new El(`w:${side}`, line ? [['w:val', 'single'], ['w:sz', outer!], ['w:space', '0'], ['w:color', '000000']] : [['w:val', 'nil']]))
  }
  // Under the header row: a thin rule.
  if (style !== 'plain' && rows.length > 1) {
    for (const tc of rowCells(rows[0])) {
      const tcPr = getOrAddTcPr(tc)
      removeAll(tcPr, 'w:tcBorders')
      const tb = getOrAdd(tcPr, 'w:tcBorders', TCPR_SEQ)
      append(tb, new El('w:bottom', [['w:val', 'single'], ['w:sz', '4'], ['w:space', '0'], ['w:color', '000000']]))
    }
  }
}

// ---------------------------------------------------------------- the template package

let templateCache: { names: string[]; files: Record<string, Uint8Array> } | null = null

function template() {
  if (!templateCache) {
    const bin = atob(DOCX_TEMPLATE_B64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const files = unzipSync(bytes)
    templateCache = { names: Object.keys(files), files }
  }
  return templateCache
}

const XML_DECL = "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>\n"
const PKG_RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WML_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml'
const NOTE_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

// "Figure 2: caption" under a figure, "Table 1: caption" under a table.
function captionPara(b: Builder, name: string, number: string | undefined, caption: string, align: Jc): void {
  const cap = b.addParagraph()
  setAlignment(cap, align)
  if (number) setBold(addRun(cap, `${name} ${number}: `), true)
  addRun(cap, caption)
  for (const run of paraRuns(cap)) setItalic(run, true)
}

// A reference list: a "References" heading and one paragraph per entry,
// its label ("[1]") hanging in the margin.
function referenceList(b: Builder, items: { label: string; runs: BibRun[] }[]): void {
  if (!items.length) return
  b.addParagraph('References', 'Heading 1')
  for (const it of items) {
    const p = b.addParagraph()
    const pPr = getOrAddPPr(p)
    append(pPr, new El('w:ind', [['w:left', '567'], ['w:hanging', '567']]))
    if (it.label) addRun(p, `${it.label}\t`)
    for (const r of it.runs) {
      const run = addRun(p, r.text)
      if (r.italic) setItalic(run, true)
    }
  }
}

// sorted() of str keys: by code point.
const byCodePoint = (a: string, b: string) => {
  const x = [...a].map((c) => c.codePointAt(0)!)
  const y = [...b].map((c) => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
  return x.length - y.length
}

// _ContentTypesItem: Default entries for known (extension, type) pairs, an
// Override for every other part; both sorted.
function contentTypesXml(templateXml: string, images: ImagePart[]): string {
  const defaults = new Map<string, string>()
  const overrides = new Map<string, string>()
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  for (const m of templateXml.matchAll(/<Default Extension="([^"]*)" ContentType="([^"]*)"\/>/g)) defaults.set(unesc(m[1]), unesc(m[2]))
  for (const m of templateXml.matchAll(/<Override PartName="([^"]*)" ContentType="([^"]*)"\/>/g)) overrides.set(unesc(m[1]), unesc(m[2]))
  for (const img of images) {
    const name = img.partname.slice(img.partname.lastIndexOf('/') + 1)
    const ext = splitextExt(name)
    if (DEFAULT_CONTENT_TYPES.has(`${ext.toLowerCase()} ${img.contentType}`)) defaults.set(ext.toLowerCase(), img.contentType)
    else overrides.set(img.partname, img.contentType)
  }
  let s = XML_DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  for (const k of [...defaults.keys()].sort(byCodePoint)) {
    s += `<Default Extension="${escAttr(checkXml(k))}" ContentType="${escAttr(defaults.get(k)!)}"/>`
  }
  for (const k of [...overrides.keys()].sort(byCodePoint)) {
    s += `<Override PartName="${escAttr(checkXml(k))}" ContentType="${escAttr(overrides.get(k)!)}"/>`
  }
  return s + '</Types>'
}

function coreXml(templateXml: string, title: string, author: string): string {
  // CT_CoreProperties._set_element_text
  for (const v of [title, author]) {
    if ([...v].length > 255) throw new PyError('ValueError', `exceeded 255 char limit for property, got:\n\n'${v}'`)
  }
  const t = escText(checkXml(title))
  const a = escText(checkXml(author))
  return templateXml
    .replace(/<dc:title\/>|<dc:title>[^<]*<\/dc:title>/, () => `<dc:title>${t}</dc:title>`)
    .replace(/<dc:creator\/>|<dc:creator>[^<]*<\/dc:creator>/, () => `<dc:creator>${a}</dc:creator>`)
}

// ---- block rendering -----------------------------------------------------

// Serialize a document to .docx bytes. Relative figure paths are looked up
// under `baseDir` (Python resolves them against its working directory).
// `progress`, if given, is called as progress(i, total) after each block is
// written so the UI can update a progress bar.
export async function exportDocx(doc: Document, baseDir: string, fs: FileAccess,
  progress: ProgressCallback = null, options: DocxOptions = {}): Promise<Uint8Array> {
  const tpl = template()
  const docXml = strFromU8(tpl.files['word/document.xml'])
  const relsXml = strFromU8(tpl.files['word/_rels/document.xml.rels'])
  const b = new Builder([...relsXml.matchAll(/ Id="([^"]*)"/g)].map((m) => m[1]))

  // Citations and cross-references print as in the PDF: "[1]", "Smith et
  // al. [2020]", "Figure 2", "(3)".
  const bibText = options.bibText ?? ''
  const autoBib = autoBibliography(doc, bibText)
  let resolver: ReferenceResolver | null = null
  // The number each figure, table, numbered equation and heading prints.
  let numbers = new Map<number, string>()
  try {
    resolver = await ReferenceResolver.load(doc, baseDir || null, bibText, fs)
    resolver.citeMode = citeMode(doc)
    if (resolver.citeMode && !resolver.citeMode.authorYear) resolver.listNumbers = autoBib?.numbers ?? null
    numbers = new Map(referables(doc).map((r) => [r.index, r.number]))
  } catch {
    // A heading level the numbering does not know: unnumbered, as before.
  }
  b.resolver = resolver
  b.author = options.author ?? ''
  const secnumdepth = /\\setcounter\{secnumdepth\}\{(-?\d+)\}/.exec(`${doc.meta.preamble_extras ?? ''}`)
  const numberDepth = secnumdepth ? Number(secnumdepth[1]) : 3

  const meta = doc.meta

  // Set core properties.
  const core = coreXml(strFromU8(tpl.files['docProps/core.xml']), meta.title, meta.author)

  // Set page margins from meta.
  const marginTwips = (cm: number, signed: boolean) => {
    const emu = Cm(cm)
    if (signed) validateRange(emu, -2147483648, 2147483647)
    else validateRange(emu, 0, 2 ** 64 - 1)
    return String(twips(emu))
  }
  const top = marginTwips(meta.margin_top_cm, true)
  const bottom = marginTwips(meta.margin_bottom_cm, true)
  const left = marginTwips(meta.margin_left_cm, false)
  const right = marginTwips(meta.margin_right_cm, false)
  const sectStart = docXml.indexOf('<w:sectPr')
  const sectEnd = docXml.indexOf('</w:sectPr>') + '</w:sectPr>'.length
  // The document's own paper (A4, Letter...) and orientation, as the PDF.
  const paper = byCode(meta.page_size || 'A4')
  let pw = Math.round(paper.width_in * 1440), ph = Math.round(paper.height_in * 1440)
  if (meta.landscape) [pw, ph] = [ph, pw]
  const sectPr = docXml.slice(sectStart, sectEnd)
    .replace(/<w:pgSz [^>]*\/>/, `<w:pgSz w:w="${pw}" w:h="${ph}"${meta.landscape ? ' w:orient="landscape"' : ''}/>`)
    .replace(/<w:pgMar [^>]*\/>/, (pgMar) => pgMar
    .replace(/ w:top="[^"]*"/, ` w:top="${top}"`).replace(/ w:bottom="[^"]*"/, ` w:bottom="${bottom}"`)
    .replace(/ w:left="[^"]*"/, ` w:left="${left}"`).replace(/ w:right="[^"]*"/, ` w:right="${right}"`))
  b.pageWidth = Number(/<w:pgSz w:w="(\d+)"/.exec(sectPr)![1]) * EMUS_PER_TWIP
  b.leftMargin = Number(left) * EMUS_PER_TWIP
  b.rightMargin = Number(right) * EMUS_PER_TWIP

  // The default template has no empty paragraph to remove.

  const total = doc.children.length

  // The date \maketitle prints under the title block (unless switched off).
  const front = new Set(['Title', 'Author', 'Affiliation', 'Correspondence'])
  const lastFront = doc.children.reduce((at, bl, k) => (front.has(bl.type) && doc.children.slice(0, k).every(x => front.has(x.type)) ? k : at), -1)
  const hasTitle = doc.children.some(bl => bl.type === 'Title')
  const textTwips = () => Math.round((b.pageWidth - b.leftMargin - b.rightMargin) / EMUS_PER_TWIP)

  for (let i = 0; i < doc.children.length; i++) {
    const block = doc.children[i]
    if (i === lastFront + 1 && hasTitle && meta.show_date !== false) {
      // A DATE field, as \\today: Word writes the day the file is opened.
      const pic: Record<string, string> = {
        d_month_y: 'd MMMM yyyy', month_d_y: 'MMMM d, yyyy', month_y: 'MMMM yyyy', dd_mm_yyyy: 'dd/MM/yyyy', iso: 'yyyy-MM-dd',
      }
      const fmt = pic[meta.date_format ?? ''] ?? 'MMMM d, yyyy'
      b.body.push(rawEl(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr=" DATE \\@ &quot;${fmt}&quot; "><w:r><w:t>${escText(formatDate(meta.date_format ?? '', new Date(2000, 0, 1), false))}</w:t></w:r></w:fldSimple></w:p>`))
    }
    if (block.type === 'Title') {
      const para = b.addParagraph('', 'Title')
      _addInlines(b, para, block.children)
    } else if (block.type === 'Author') {
      const para = b.addParagraph('', 'Subtitle')
      _addInlines(b, para, block.children)
    } else if (block.type === 'Affiliation' || block.type === 'Correspondence') {
      const para = b.addParagraph()
      setAlignment(para, 'center')
      _addInlines(b, para, block.children)
      for (const run of paraRuns(para)) setItalic(run, block.type === 'Affiliation')
    } else if (block.type === 'Abstract') {
      // Group consecutive abstracts visually — just add as italic paras.
      const para = b.addParagraph()
      _addInlines(b, para, block.children)
      for (const run of paraRuns(para)) setItalic(run, true)
    } else if (block.type === 'Keywords') {
      const para = b.addParagraph()
      const run = addRun(para, 'Keywords: ')
      setBold(run, true)
      _addInlines(b, para, block.children)
    } else if (block.type === 'Section') {
      const style = has(_HEADING_STYLES, block.level) ? _HEADING_STYLES[block.level] : 'Heading 5'
      const para = b.addParagraph('', style)
      // Its number, as LaTeX prints it ("2.1 Methods"), so "Section 2.1"
      // in the text points somewhere.
      const n = numbers.get(i)
      if (n && block.numbered && Math.max(block.level, 1) <= numberDepth) addRun(para, `${n}\u2003`)
      _addInlines(b, para, block.children)
    } else if (block.type === 'Theorem') {
      const para = b.addParagraph()
      if (block.start) {
        const name = has(THEOREM_KINDS, block.kind) ? THEOREM_KINDS[block.kind]
          : has(CALLOUT_KINDS, block.kind) ? CALLOUT_KINDS[block.kind].name : pyTitle(block.kind)
        const head = block.title ? `${name} (${block.title}). ` : `${name}. `
        const run = addRun(para, head)
        const proof = block.kind === 'proof'
        setBold(run, !proof)
        setItalic(run, proof)
      }
      _addInlines(b, para, block.children)
    } else if (block.type === 'Paragraph') {
      const para = b.addParagraph()
      _addInlines(b, para, block.children)
      setAlignment(para, has(_ALIGN_MAP, block.alignment) ? _ALIGN_MAP[block.alignment] : 'both')
    } else if (block.type === 'List') {
      const style = block.ordered ? 'List Number' : 'List Bullet'
      for (const item of block.items) {
        const para = b.addParagraph('', style)
        _addInlines(b, para, item.children)
      }
    } else if (block.type === 'MathBlock') {
      // A Word equation, numbered as in the PDF: centred, its number at the
      // right margin; an align one line per row, the = signs lined up.
      const num = block.numbered ? (numbers.get(i) ?? null) : null
      const rows = alignRows(block.latex.trim())
      if (rows) {
        b.body.push(rawEl(alignTable(rows, num, textTwips())))
      } else if (num !== null) {
        b.body.push(rawEl(alignTable([{ left: '', right: stripEnv(block.latex.trim()), numbered: true, centre: true }], num, textTwips())))
      } else {
        const para = b.addParagraph()
        append(para, rawEl(ommlDisplay(block.latex.trim(), null)))
      }
    } else if (block.type === 'Figure') {
      const align = has(_ALIGN_MAP, block.align) ? _ALIGN_MAP[block.align] : 'center'
      const para = b.addParagraph()
      setAlignment(para, align)
      // Path("") is ".", which exists (and cannot be read as an image).
      const figPath = join(baseDir, block.path === '' ? '.' : block.path)
      if (await fs.exists(figPath)) {
        const run = addRun(para)
        let blob: Uint8Array
        try {
          blob = await fs.read(figPath)
        } catch (e) {
          const code = (e as { code?: string }).code
          throw new PyError(code === 'EISDIR' ? 'IsADirectoryError' : 'OSError', String(e))
        }
        const row = block.extra && block.extra.length > 0
        // A row of pictures shares the text width (about 6 in), each on
        // its own run; a lone picture keeps its 4.5 in.
        const rowIn = row ? 6 / (1 + block.extra!.length) - 0.1 : 4.5
        addPicture(b, run, block.path === '' ? '.' : block.path, blob, rowIn)
        for (const e of block.extra ?? []) {
          const ep = join(baseDir, e.path)
          if (await fs.exists(ep)) {
            addRun(para, ' ')
            addPicture(b, addRun(para), e.path, await fs.read(ep), rowIn)
          } else {
            addRun(para, ` [Image: ${e.path}]`)
          }
        }
      } else {
        addRun(para, `[Image: ${block.path}]`)
      }
      if (block.caption) captionPara(b, 'Figure', numbers.get(i), block.caption, align)
    } else if (block.type === 'Table') {
      if (block.rows.length) exportTable(b, block, numbers.get(i))
    } else if (block.type === 'RawLatex') {
      // A reference list written in the LaTeX prints as one.
      const listed = parseTheBibliography(block.text)
      if (listed) {
        referenceList(b, listed.items.map((it, n) => ({
          label: `[${it.label || (resolver?.cite_numbers.get(it.key) ?? n + 1)}]`,
          runs: [{ text: texText(it.text.replace(/\\newblock\s*/g, ' ')) }],
        })))
      } else if (resolver && /\\bibliography\{|\\printbibliography/.test(block.text) && !autoBib) {
        referenceList(b, [...resolver.cite_numbers.keys()].filter((k) => resolver.entries.has(k)).map((k) => {
          const e = resolver.entries.get(k)!
          const text = [e.author, e.title, e.year].map((x) => texText(x ?? '')).filter(Boolean).join('. ')
          return { label: resolver.citeMode?.authorYear ? '' : `[${resolver.cite_numbers.get(k)}]`, runs: [{ text: text ? `${text}.` : k }] }
        }))
      } else {
        const para = b.addParagraph()
        const run = addRun(para, block.text)
        setFontName(run, 'Courier New')
      }
    } else if (block.type === 'Frame') {
      const para = b.addParagraph('', 'Heading 1')
      _addInlines(b, para, block.children)
    } else if (block.type === 'Box') {
      const para = b.addParagraph()
      setBoxBorder(para)
      _addInlines(b, para, block.children)
    }

    if (progress !== null) progress(i + 1, total)
  }

  // The reference list BibTeX writes at the end of the PDF.
  if (autoBib && autoBib.items.length) referenceList(b, autoBib.items)

  // Package.save: the parts in python-docx's walk order, each followed by
  // its relationships; the new media parts belong to the document part,
  // whose relationships are walked before the package's thumbnail.
  const bodyXml = docXml.slice(0, docXml.indexOf('<w:body>') + '<w:body>'.length) +
    b.body.map(serialize).join('') + sectPr + docXml.slice(sectEnd)
  let rels = ''
  for (const r of b.rels) {
    rels += `<Relationship Id="${r.rId}" Type="${r.reltype}" Target="${escAttr(checkXml(r.target))}"` +
      (r.external ? ' TargetMode="External"/>' : '/>')
  }
  // Footnotes and comments: their parts, only when the document has some.
  const extra: Record<string, string> = {}
  const extraTypes: [string, string][] = []
  const relsFor = (list: NewRel[]) => XML_DECL + `<Relationships xmlns="${PKG_RELS_NS}">` + list.map((r) =>
    `<Relationship Id="${r.rId}" Type="${r.reltype}" Target="${escAttr(checkXml(r.target))}" TargetMode="External"/>`).join('') + '</Relationships>'
  const addPart = (name: string, type: string, rel: string, xml: string, partRels: NewRel[]) => {
    extra[`word/${name}`] = xml
    if (partRels.length) extra[`word/_rels/${name}.rels`] = relsFor(partRels)
    extraTypes.push([`/word/${name}`, type])
    let rId = ''
    for (let n = 1; b.rIds.has(rId = `rId${n}`); n++);
    b.rIds.add(rId)
    rels += `<Relationship Id="${rId}" Type="${OFFICE_RELS}/${rel}" Target="${name}"/>`
  }
  if (b.footnotes.length) {
    addPart('footnotes.xml', `${WML_TYPE}.footnotes+xml`, 'footnotes', XML_DECL + `<w:footnotes ${NOTE_NS}>`
      + '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
      + '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
      + b.footnotes.join('') + '</w:footnotes>', b.noteRels)
  }
  if (b.comments.length) {
    addPart('comments.xml', `${WML_TYPE}.comments+xml`, 'comments',
      XML_DECL + `<w:comments ${NOTE_NS}>` + b.comments.join('') + '</w:comments>', b.commentRels)
  }
  let types = contentTypesXml(strFromU8(tpl.files['[Content_Types].xml']), b.images)
  if (extraTypes.length) {
    types = types.replace('</Types>', extraTypes.map(([n, t]) => `<Override PartName="${n}" ContentType="${t}"/>`).join('') + '</Types>')
  }
  const generated: Record<string, string> = {
    '[Content_Types].xml': types,
    'docProps/core.xml': core,
    'word/document.xml': bodyXml,
    // A current Word file (not "Compatibility Mode", Word 2010's layout).
    'word/settings.xml': strFromU8(tpl.files['word/settings.xml']).replace(
      /(w:name="compatibilityMode" w:uri="http:\/\/schemas.microsoft.com\/office\/word" w:val=")\d+"/, '$115"'),
    'word/_rels/document.xml.rels': relsXml.replace('</Relationships>', rels + '</Relationships>'),
  }
  const files: Zippable = {}
  for (const name of tpl.names) {
    if (name === 'docProps/thumbnail.jpeg') {
      for (const img of b.images) files[img.partname.slice(1)] = img.blob
    }
    files[name] = name in generated ? strToU8(generated[name]) : tpl.files[name]
  }
  for (const [name, xml] of Object.entries(extra)) files[name] = strToU8(xml)
  return zipSync(files, { level: 6 })
}

// The zip entry names of exported bytes, in archive order (for tests and
// diagnostics).
export function docxEntries(bytes: Uint8Array): string[] {
  return Object.keys(unzipSync(bytes))
}

// ---- displayed equations -------------------------------------------------

// An equation environment's body (\\begin{equation}...\\end{equation} off).
function stripEnv(latex: string): string {
  return latex.replace(/^\\begin\{(equation|displaymath)\*?\}\s*/, '').replace(/\s*\\end\{(equation|displaymath)\*?\}$/, '')
    .replace(/\\label\{[^}]*\}/g, '').trim()
}

interface AlignRow { left: string; right: string; numbered: boolean; centre?: boolean }

// The rows of an align / align* / eqnarray (null for anything else): each
// split at its first & into the parts before and after the alignment.
function alignRows(latex: string): AlignRow[] | null {
  const m = /^\\begin\{(align|eqnarray|flalign)(\*?)\}([\s\S]*)\\end\{\1\2\}$/.exec(latex)
  if (!m) return null
  const starred = m[2] === '*'
  const rows: string[] = []
  let depth = 0, cur = ''
  const body = m[3]
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    if (depth === 0 && c === '\\' && body[i + 1] === '\\') { rows.push(cur); cur = ''; i++; continue }
    cur += c
  }
  if (cur.trim()) rows.push(cur)
  return rows.filter(r => r.trim()).map(r => {
    const numbered = !starred && !/\\(nonumber|notag)\b/.test(r)
    const clean = r.replace(/\\(nonumber|notag)\b/g, '').replace(/\\label\{[^}]*\}/g, '')
    const at = clean.indexOf('&')
    const left = at < 0 ? '' : clean.slice(0, at)
    const right = (at < 0 ? clean : clean.slice(at + 1)).replace(/&/g, ' ')
    return { left: left.trim(), right: right.trim(), numbered }
  })
}

// A borderless table across the text width: the left parts right-aligned,
// the right parts left-aligned (so the = signs line up), and each numbered
// row's number at the right margin, counting on from the block's number.
function alignTable(rows: AlignRow[], first: string | null, width: number): string {
  let n = first !== null && /^\d+$/.test(first) ? Number(first) : null
  // Number columns on both sides (the right one holds the numbers), so the
  // equations sit centred on the page, as LaTeX's.
  const colNum = Math.round(width * 0.1), colL = Math.round((width - 2 * colNum) / 2), colR = width - 2 * colNum - colL
  const none = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>'
  const cell = (w: number, jc: string, inner: string, span = 1) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="${jc}"/></w:pPr>${inner}</w:p></w:tc>`
  // A cell holding only maths is a displayed equation to Word, centred on
  // its own unless its justification is set: right before the =, left after.
  const math = (tex: string, jc: 'right' | 'left' | 'center') => (tex
    ? `<m:oMathPara><m:oMathParaPr><m:jc m:val="${jc}"/></m:oMathParaPr><m:oMath>${latexToOmml(tex)}</m:oMath></m:oMathPara>` : '')
  const out = rows.map(r => {
    let label = ''
    if (r.numbered && first !== null) {
      label = `<w:r><w:t>(${escText(n !== null ? String(n) : first)})</w:t></w:r>`
      if (n !== null) n++
    }
    const body = r.centre
      ? cell(colL + colR, 'center', math(r.right, 'center'), 2)
      : cell(colL, 'right', math(r.left, 'right')) + cell(colR, 'left', math(r.right, 'left'))
    return `<w:tr>${cell(colNum, 'left', '')}${body}${cell(colNum, 'right', label)}</w:tr>`
  })
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblBorders>${none}</w:tblBorders><w:tblLayout w:type="fixed"/>`
    + '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid><w:gridCol w:w="${colNum}"/><w:gridCol w:w="${colL}"/><w:gridCol w:w="${colR}"/><w:gridCol w:w="${colNum}"/></w:tblGrid>${out.join('')}</w:tbl>`
}
