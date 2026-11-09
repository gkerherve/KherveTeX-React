// The .docx importer: a port of import_docx and its helpers in
// khervedoc/importers.py. Python reads the file through python-docx 1.2;
// docxPackage.ts reimplements the parts of python-docx it touches, so every
// decision here (style names, list numbering, runs, hyperlinks, images)
// comes out as the Python app makes it — including its blind spots:
//
// - python-docx 1.2 has no footnotes part, so _extract_footnotes always
//   lands in its `except` and adds nothing;
// - ParagraphFormat has no outline_level, so step 2 of _classify_style
//   never applies;
// - runs inside OMML equations (m:oMath / m:oMathPara), w:ins, w:smartTag
//   or w:fldSimple are not direct w:r / w:hyperlink children of the
//   paragraph, so their text is not imported.

import { figure, link, listItem, list as listNode, mathBlock, mathInline, paragraph, section, table, text, title as titleNode,
  author as authorNode, abstract as abstractNode, document, docMeta } from './model.ts'
import type { Alignment, Block, Document, Inline, ListItem, Mark, Table, Text } from './model.ts'
import type { FileAccess } from './kdocz.ts'
import { join, suffix } from './paths.ts'
import { M_NS, TAG_RE, ommlToLatex, splitNumber } from './omml.ts'
import { serializeInlines } from './serializer.ts'
import { pyFixed, pyRe, reSearch, strip, zpad } from './py.ts'
import {
  CT, NS, PyError, RT, descendants, find, findall, get, is, isElement, iterChildren, localName, lxmlText,
  openPackage, paragraphStyle, partWithReltype, pStyleId, relTargetRef, rowCells,
} from './docxPackage.ts'
import type { Package, Part, XElement } from './docxPackage.ts'

// python-docx is always available here.
export function docxAvailable(): boolean {
  return true
}

// --- Style classification --------------------------------------------------

// Exact matches checked first (lowercased).
const _DOCX_STYLE_TO_LEVEL: Record<string, number> = {
  title: -1,
  'heading 1': 1, 'heading 2': 2, 'heading 3': 3,
  'heading 4': 4, 'heading 5': 5, 'heading 6': 5,
}

// Regex patterns tried in order when exact match fails. Each pattern maps a
// Word style name to a model block type. This catches custom styles like
// "ThesisTitle", "1.1 Heading3", "Heading2", "MySubtitle", "Abstract", etc.
const _HEADING_RE = pyRe('heading\\s*(\\d)', 'i')
const _TITLE_RE = pyRe('title', 'i')
const _SUBTITLE_RE = pyRe('sub\\s*title', 'i')
const _AUTHOR_RE = pyRe('author', 'i')
const _NOTE_RE = pyRe('foot\\s*note|end\\s*note', 'i')
const _ABSTRACT_RE = pyRe('abstract', 'i')
const _CAPTION_RE = pyRe('caption', 'i')

// Paragraph alignment from python-docx (WD_ALIGN_PARAGRAPH) to model alignment.
const _DOCX_ALIGNMENT_MAP: Record<string, Alignment> = {
  left: 'left',     // WD_ALIGN_PARAGRAPH.LEFT
  center: 'center', // WD_ALIGN_PARAGRAPH.CENTER
  right: 'right',   // WD_ALIGN_PARAGRAPH.RIGHT
  both: 'justify',  // WD_ALIGN_PARAGRAPH.JUSTIFY
}
// The other w:jc values WD_ALIGN_PARAGRAPH knows; any other value makes
// python-docx raise, which _para_alignment catches.
const _OTHER_JC = new Set(['distribute', 'mediumKashida', 'highKashida', 'lowKashida', 'thaiDistribute'])

// int() of one Unicode decimal digit (\d matches every Nd character).
function digitValue(ch: string): number {
  let k = 0
  let cp = ch.codePointAt(0)!
  while (/\p{Nd}/u.test(String.fromCodePoint(cp - 1))) {
    cp -= 1
    k += 1
  }
  return k % 10
}

type Kind = 'title' | 'heading' | 'subtitle' | 'author' | 'abstract' | 'caption' | 'list' | 'paragraph'

// Return [block_kind, heading_level] for a Word paragraph style.
//
// block_kind is one of: "title", "heading", "subtitle", "author",
// "abstract", "caption", "list", "paragraph".
// heading_level is 1-5 for headings, -1 for title, 0 otherwise.
//
// Checks the built-in outline_level first (reliable even for custom styles
// that derive from Heading N), then falls back to name-based matching.
export function _classifyStyle(styleName: string | null, _styleObj?: unknown): [Kind, number] {
  const name = strip(styleName || '')
  const nameLower = name.toLowerCase()

  // 1. Exact match on the static table.
  if (Object.prototype.hasOwnProperty.call(_DOCX_STYLE_TO_LEVEL, nameLower)) {
    const lvl = _DOCX_STYLE_TO_LEVEL[nameLower]
    return [lvl === -1 ? 'title' : 'heading', Math.max(lvl, 1)]
  }

  // 2. Python asks style_obj.paragraph_format.outline_level, which
  //    python-docx 1.2 does not have: the AttributeError is swallowed, so
  //    this step never decides anything.

  // 3. Regex-based heuristics for custom style names. A journal template's
  // note styles ("RSC F02 Footnotes to Title/Authors") name the title and
  // authors they annotate: they are plain text, not them.
  if (reSearch(_NOTE_RE, name)) return ['paragraph', 0]
  const m = reSearch(_HEADING_RE, name)
  if (m) {
    const lvl = Math.min(digitValue(m[1]), 5)
    return ['heading', Math.max(lvl, 1)]
  }

  if (reSearch(_ABSTRACT_RE, name)) return ['abstract', 0]
  if (reSearch(_SUBTITLE_RE, name) || reSearch(_AUTHOR_RE, name)) return ['author', 0]
  if (reSearch(_TITLE_RE, name)) return ['title', -1]
  if (reSearch(_CAPTION_RE, name)) return ['caption', 0]

  // 4. List styles — detected by name or by numId (handled in caller).
  if (nameLower.includes('list')) return ['list', 0]

  return ['paragraph', 0]
}

// --- The python-docx objects the importer reads ---------------------------

interface Src {
  pkg: Package
  part: Part              // the main document part
  stylesEl(): XElement | null
  numberingEl(): XElement  // throws when python-docx would
}

function openDocx(bytes: Uint8Array): Src {
  const pkg = openPackage(bytes)
  const part = partWithReltype(pkg.rels, RT.OFFICE_DOCUMENT)
  if (part.contentType !== CT.WML_DOCUMENT_MAIN) {
    throw new PyError('ValueError', `file is not a Word file, content type is '${part.contentType}'`)
  }
  return {
    pkg,
    part,
    stylesEl() {
      let sp: Part
      try {
        sp = partWithReltype(part.rels, RT.STYLES)
      } catch (e) {
        if (e instanceof PyError && e.type === 'KeyError') return null  // StylesPart.default()
        throw e
      }
      const root = sp.contentType === CT.WML_STYLES ? sp.xml?.documentElement : null
      if (!root || !is(root, NS.w, 'styles')) throw new PyError('AttributeError', "'Part' object has no attribute 'styles'")
      return root
    },
    numberingEl() {
      let np: Part
      try {
        np = partWithReltype(part.rels, RT.NUMBERING)
      } catch (e) {
        // NumberingPart.new() is not implemented in python-docx.
        if (e instanceof PyError && e.type === 'KeyError') throw new PyError('NotImplementedError', '')
        throw e
      }
      if (np.contentType !== CT.WML_NUMBERING || !np.xml) throw new PyError('AttributeError', "'Part' object has no attribute 'element'")
      return np.xml.documentElement!
    },
  }
}

// --- Main importer ---------------------------------------------------------

// Import a .docx file. Embedded images are saved to imageDir and referenced
// from Figure blocks.
//
// Recognises custom heading/title/abstract/author/subtitle/caption styles
// by name heuristics and outline level. Imports Word tables, bullet /
// numbered lists, hyperlinks, footnotes, subscript/superscript, and
// paragraph alignment.
const OLE_SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
export const DOC_NOT_SUPPORTED = 'This is an older Word file (.doc), which KherveTeX cannot read. '
  + 'Open it in Word, choose File > Save As > Word Document (.docx), and import the .docx.'

export async function importDocx(bytes: Uint8Array, imageDir: string, fs: FileAccess): Promise<Document> {
  // A Word 97-2003 .doc (an OLE compound file, not a zip) picked as a Word
  // file: say so, rather than the cloud-placeholder message.
  if (OLE_SIGNATURE.every((b, i) => bytes[i] === b)) throw new PyError('OSError', DOC_NOT_SUPPORTED)
  let src: Src
  try {
    src = openDocx(bytes)
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).toLowerCase()
    if (msg.includes('not found') || msg.includes('no such file')) {
      throw new PyError('OSError', 'Cannot open the file — it may not be downloaded locally (OneDrive/cloud placeholder).')
    }
    throw e
  }
  const children: Block[] = []
  let title = ''
  // Not the core properties' author: that is whoever created the file (a
  // template's "David", an admin account), not the document's author, and
  // \maketitle printed it under the title.
  const author = ''

  let imageCounter = 0

  // Walk the document body in order (paragraphs *and* tables interleaved);
  // iterating the paragraphs alone silently drops tables.
  const root = src.part.xml!.documentElement!
  if (!is(root, NS.w, 'document')) throw new PyError('AttributeError', "object has no attribute 'body'")
  const body = find(root, NS.w, 'body')
  if (body === null) throw new PyError('TypeError', "'NoneType' object is not iterable")

  // The text width of the (last) section, in EMU, to size pictures as Word
  // shows them: page width less the left and right margins (twips).
  let textEmu: number | null = null
  const sect = find(body, NS.w, 'sectPr')
  if (sect !== null) {
    const pgSz = find(sect, NS.w, 'pgSz'), pgMar = find(sect, NS.w, 'pgMar')
    const vals = [pgSz && get(pgSz, NS.w, 'w'), pgMar && get(pgMar, NS.w, 'left'), pgMar && get(pgMar, NS.w, 'right')]
    if (vals.every(v => v != null && /^\s*[+-]?\d+\s*$/.test(v))) {
      const [w, l, r] = vals.map(v => parseInt(v!.trim(), 10))
      const tw = w - l - r
      textEmu = tw > 0 ? tw * 635 : null
    }
  }
  const pageSetup = _pageSetup(sect)

  // Track consecutive list paragraphs so we can merge them.
  let pendingListItems: ListItem[] = []
  let pendingListOrdered = false

  const flushList = () => {
    if (pendingListItems.length) {
      children.push(listNode(pendingListOrdered, pendingListItems))
      pendingListItems = []
      pendingListOrdered = false
    }
  }

  let stylesEl: XElement | null | undefined
  const styles = () => (stylesEl === undefined ? (stylesEl = src.stylesEl()) : stylesEl)

  // The Normal style over the document defaults: body text size and the
  // space around and indent of a paragraph that sets none of its own.
  let stylesForDefaults: XElement | null = null
  try { stylesForDefaults = src.stylesEl() } catch { stylesForDefaults = null }
  const [bodyHp, defBefore, defAfter, defFirst, defLine] = _styleDefaults(stylesForDefaults)
  // (no space around it, first line indented, text size, line spacing) for
  // each body paragraph.
  const paraStats: [boolean, boolean, number, number | null][] = []

  const walk = async (elems: Iterable<XElement>): Promise<void> => {
  for (const childElem of elems) {
    const tag = localName(childElem)

    // --- Table ---
    if (tag === 'tbl') {
      flushList()
      // A table holding pictures (instructions beside screenshots, as
      // manuals are written) keeps its layout: its cells become LaTeX with
      // the pictures in them.
      if (is(childElem, NS.w, 'tbl') && descendants(childElem, NS.a, 'blip').length) {
        const [tblNode, next] = await _importPictureTable(childElem, src, imageDir, imageCounter, textEmu, fs,
          (p) => { const st = paragraphStyle(styles(), pStyleId(p)); return _classifyStyle(st ? (st.name || '') : '', st)[0] })
        imageCounter = next
        if (tblNode !== null) children.push(tblNode)
        continue
      }
      if (is(childElem, NS.w, 'tbl')) {
        const tblNode = _importTable(childElem)
        if (tblNode !== null) children.push(tblNode)
      }
      continue
    }

    if (tag !== 'p') continue
    if (!is(childElem, NS.w, 'p')) continue
    const para = childElem

    // Display equations (m:oMathPara): each its own equation block,
    // numbered when "(1)" was typed after it; any text beside them stays a
    // paragraph before them.
    const elementKids = (e: XElement) => [...e.childNodes].filter(isElement) as XElement[]
    const mathParas = elementKids(childElem).filter((c) => c.namespaceURI === M_NS && localName(c) === 'oMathPara')
    if (mathParas.length) {
      flushList()
      const runs = _runsToInlines(para, src)
      // "(1)" typed as text beside the equation: its number.
      const tagged = runs.length > 0 && runs.every((r) => r.type === 'Text')
        && TAG_RE.test(runs.map((r) => (r as Text).text).join(''))
      if (!tagged && runs.some((r) => r.type !== 'Text' || strip(r.text))) children.push(paragraph(runs, _paraAlignment(para)))
      for (const mp of mathParas) {
        for (const om of elementKids(mp)) {
          if (!(om.namespaceURI === M_NS && localName(om) === 'oMath')) continue
          const [latex, numbered] = splitNumber(ommlToLatex(om))
          if (latex) children.push(mathBlock(latex, numbered || tagged, null))
        }
      }
      continue
    }

    const styleId = pStyleId(para)
    const style = paragraphStyle(styles(), styleId)
    const styleName = style ? (style.name || '') : ''
    const [kind, styleLevel] = _classifyStyle(styleName, style)
    let level = styleLevel

    const textRuns = _runsToInlines(para, src)

    // Detect embedded images.
    const paraImages = await _imagesInParagraph(para, src, imageDir, imageCounter, fs, textEmu)
    imageCounter += paraImages.length

    if (paraImages.length) {
      flushList()
      for (const [path, width] of paraImages) {
        const fig = figure({ path: path.replaceAll('\\', '/'), caption: '', label: null })
        if (width) fig.width = width
        children.push(fig)
      }
      if (!textRuns.some((r) => r.type === 'Text' && strip(r.text))) continue
    }

    // A numbered heading ("1.2 Mounting") is a heading, not a list item:
    // LaTeX numbers sections itself. Its numbering level is its depth
    // when that is deeper than the style's.
    if (kind === 'heading') level = Math.min(Math.max(level, _paraListLevel(para) + 1), 5)

    // Detect list paragraphs via numId in the XML (catches styled lists
    // like "List Paragraph" and also paragraphs with ad-hoc numbering).
    const isList = kind === 'list' || (kind !== 'heading' && kind !== 'title' && _paraIsList(para))
    if (isList) {
      const ordered = _paraIsOrdered(para, src)
      if (pendingListItems.length && ordered !== pendingListOrdered) flushList()
      pendingListOrdered = ordered
      pendingListItems.push(listItem(textRuns))
      continue
    }

    flushList()

    // Resolve paragraph alignment.
    const alignment = _paraAlignment(para)

    if (kind === 'title') {
      title = textRuns.filter((r): r is Text => r.type === 'Text').map((r) => r.text).join('')
      children.push(titleNode(textRuns))
    } else if (kind === 'heading') {
      children.push(section(level, textRuns))
    } else if (kind === 'author') {
      children.push(authorNode(textRuns))
    } else if (kind === 'abstract') {
      children.push(abstractNode(textRuns))
    } else if (kind === 'caption') {
      // Captions are kept as italic paragraphs (no dedicated node).
      for (const r of textRuns) {
        if (r.type === 'Text' && !r.marks.includes('italic')) r.marks.push('italic')
      }
      children.push(paragraph(textRuns, 'center'))
    } else {
      // A heading set by hand (bold, larger than the text, no Heading
      // style): an unnumbered section, as Word shows it.
      const hlevel = _directHeadingLevel(childElem, textRuns, bodyHp)
      if (hlevel) {
        children.push(section(hlevel, textRuns.map((r) => {
          const t = r as Text
          return text(t.text, t.marks.filter((m) => m !== 'bold'))
        }), false))
      } else if (textRuns.some((r) => r.type !== 'Text' || strip(r.text))) {
        children.push(paragraph(textRuns, alignment))
        const [before, after, first, line] = _paraSpacing(childElem, defBefore, defAfter, defFirst, defLine)
        paraStats.push([before === 0 && after === 0, first > 0, _firstRunSize(childElem, bodyHp), line])
      } else {
        // A blank line: Word's way of spacing paragraphs. A no-break space
        // keeps it a line in the PDF and on the page.
        children.push(paragraph([text('\u00a0', [])], alignment))
      }
    }
  }
  }
  await walk(iterChildren(body))

  flushList()

  // Word ends a document with blank lines as often as not: they are not
  // space anyone meant to print.
  while (children.length && _isBlankLine(children[children.length - 1])) children.pop()
  children.splice(0, children.length, ..._attachCaptions(children))

  const meta = docMeta({ title, author })
  // Word indents no first line unless told to, and a document whose
  // paragraphs have no space between them (its gaps are blank lines) keeps
  // none: LaTeX's \parindent and KherveTeX's 0.8em made it look unlike the
  // Word page.
  meta.paragraph_indent = paraStats.length > 0 && 2 * paraStats.filter((st) => st[1]).length > paraStats.length
  if (!meta.paragraph_indent && paraStats.length && 2 * paraStats.filter((st) => st[0]).length > paraStats.length) {
    meta.preamble_extras = '\\setlength{\\parskip}{0pt}'
  }
  // The page as Word sets it: paper, margins, text size and line spacing
  // (single, one and a half, double), so pages break near where Word's do.
  if (pageSetup) {
    meta.page_size = pageSetup[0]
    ;[meta.margin_top_cm, meta.margin_bottom_cm, meta.margin_left_cm, meta.margin_right_cm] = pageSetup[1]
  }
  if (paraStats.length) {
    const pt = _mostCommon(paraStats.map((st) => st[2])) / 2
    meta.body_font_pt = pt <= 10.5 ? 10 : pt <= 11.5 ? 11 : 12
    const lines = paraStats.map((st) => st[3]).filter((l): l is number => l !== null)
    if (lines.length) {
      const ls = _mostCommon(lines) / 240
      meta.line_spacing = ls < 1.25 ? 1.0 : ls < 1.75 ? 1.5 : 2.0
    }
  }
  // Figures float, as in a journal: one too tall for the rest of a page goes
  // to the top of the next and the text fills the gap (KherveTeX's own
  // documents keep the float package and pin theirs with [H]).
  meta.packages = meta.packages.filter((p) => p !== 'float')
  // Word and PDF carry no date to print: without \date{} \maketitle
  // would put the day of the import under the title.
  if (children.some((c) => c.type === 'Title')) meta.frontmatter_extras = '\\date{}'
  return document(children, meta)
}

// --- Inline extraction (with hyperlinks, footnotes, sub/superscript) -------

// Extract inline content from a paragraph, including hyperlinks.
function _runsToInlines(para: XElement, src: Src): Inline[] {
  const out: Inline[] = []

  // Walk child XML elements to capture hyperlinks in document order.
  // <w:r> = run, <w:hyperlink> = link wrapping one or more runs.
  for (const elem of iterChildren(para)) {
    const tag = localName(elem)

    if (tag === 'r') {
      const inline = _runElementToInline(elem)
      if (inline !== null) out.push(inline)
    } else if (tag === 'oMath' && elem.namespaceURI === M_NS) {
      // A Word equation in the line of text.
      const latex = ommlToLatex(elem)
      if (latex) out.push(mathInline(latex))
    } else if (tag === 'ins') {
      // Text typed with Track Changes on: the document as it now reads, its
      // insertions accepted (deletions, w:del, stay out).
      for (const sub of findall(elem, NS.w, 'r')) {
        const inline = _runElementToInline(sub)
        if (inline !== null) out.push(inline)
      }
    } else if (tag === 'hyperlink') {
      const linkRuns: Inline[] = []
      let url: string | null = ''
      // Resolve the relationship target for the URL.
      const rid = get(elem, NS.r, 'id')
      if (rid) {
        const rel = src.part.rels.get(rid)
        if (rel !== undefined) url = relTargetRef(rel)
      }
      for (const sub of findall(elem, NS.w, 'r')) {
        const inline = _runElementToInline(sub)
        if (inline !== null) linkRuns.push(inline)
      }
      if (linkRuns.length && url) out.push(link(url, linkRuns))
      else out.push(...linkRuns)
    }
  }

  // Append footnote markers at the end of inline content.
  _extractFootnotes(para)

  return out
}

// Convert a <w:r> XML element to a Text inline (or null if empty).
// The Symbol font's characters (by their code, 0x20-0xFF, or the private-use
// U+F020-U+F0FF Word stores them at) to Unicode.
const SYMBOL_FONT: Record<number, string> = {
  0x22: '∀',
  0x24: '∃',
  0x27: '∋',
  0x2A: '∗',
  0x2D: '−',
  0x40: '≅',
  0x41: 'Α',
  0x42: 'Β',
  0x43: 'Χ',
  0x44: 'Δ',
  0x45: 'Ε',
  0x46: 'Φ',
  0x47: 'Γ',
  0x48: 'Η',
  0x49: 'Ι',
  0x4A: 'ϑ',
  0x4B: 'Κ',
  0x4C: 'Λ',
  0x4D: 'Μ',
  0x4E: 'Ν',
  0x4F: 'Ο',
  0x50: 'Π',
  0x51: 'Θ',
  0x52: 'Ρ',
  0x53: 'Σ',
  0x54: 'Τ',
  0x55: 'Υ',
  0x56: 'ς',
  0x57: 'Ω',
  0x58: 'Ξ',
  0x59: 'Ψ',
  0x5A: 'Ζ',
  0x5E: '⊥',
  0x61: 'α',
  0x62: 'β',
  0x63: 'χ',
  0x64: 'δ',
  0x65: 'ε',
  0x66: 'φ',
  0x67: 'γ',
  0x68: 'η',
  0x69: 'ι',
  0x6A: 'ϕ',
  0x6B: 'κ',
  0x6C: 'λ',
  0x6D: 'μ',
  0x6E: 'ν',
  0x6F: 'ο',
  0x70: 'π',
  0x71: 'θ',
  0x72: 'ρ',
  0x73: 'σ',
  0x74: 'τ',
  0x75: 'υ',
  0x76: 'ϖ',
  0x77: 'ω',
  0x78: 'ξ',
  0x79: 'ψ',
  0x7A: 'ζ',
  0x7E: '∼',
  0xA2: '′',
  0xA3: '≤',
  0xA5: '∞',
  0xAB: '↔',
  0xAC: '←',
  0xAD: '↑',
  0xAE: '→',
  0xAF: '↓',
  0xB0: '°',
  0xB1: '±',
  0xB2: '″',
  0xB3: '≥',
  0xB4: '×',
  0xB5: '∝',
  0xB6: '∂',
  0xB7: '•',
  0xB8: '÷',
  0xB9: '≠',
  0xBA: '≡',
  0xBB: '≈',
  0xBC: '…',
  0xC5: '⊕',
  0xC6: '∅',
  0xC7: '∩',
  0xC8: '∪',
  0xCC: '⊂',
  0xCE: '∈',
  0xCF: '∉',
  0xD0: '∠',
  0xD1: '∇',
  0xD6: '√',
  0xD7: '⋅',
  0xDB: '⇔',
  0xDE: '⇒',
  0xE5: '∑',
  0xF2: '∫',
}

// Text typed in the Symbol font as the Unicode characters it shows.
function _symbolFontText(s: string): string {
  const out: string[] = []
  for (const ch of s) {
    let code = ch.codePointAt(0)!
    if (code >= 0xF020 && code <= 0xF0FF) code -= 0xF000
    out.push(code <= 0xFF && code in SYMBOL_FONT ? SYMBOL_FONT[code] : ch)
  }
  return out.join('')
}

function _runElementToInline(runElem: XElement): Text | null {
  const textEl = find(runElem, NS.w, 't')
  let t = textEl === null ? null : lxmlText(textEl)
  if (!t) {
    // A character inserted from the Symbol font (Insert > Symbol).
    const sym = find(runElem, NS.w, 'sym')
    const code = sym !== null ? (get(sym, NS.w, 'char') || '') : ''
    if (sym !== null && (get(sym, NS.w, 'font') || '').toLowerCase() === 'symbol' && /^[0-9A-Fa-f]{1,4}$/.test(code)) {
      t = _symbolFontText(String.fromCodePoint(parseInt(code, 16)))
    }
  }
  if (!t) return null

  const marks: Mark[] = []
  const rpr = find(runElem, NS.w, 'rPr')
  // Text set in the Symbol font: "n" (or U+F06E) is its ν.
  const fonts = rpr !== null ? find(rpr, NS.w, 'rFonts') : null
  if (fonts !== null && ['ascii', 'hAnsi'].some((a) => (get(fonts, NS.w, a) || '').toLowerCase() === 'symbol')) {
    t = _symbolFontText(t)
  }
  if (rpr !== null) {
    if (find(rpr, NS.w, 'b') !== null) marks.push('bold')
    if (find(rpr, NS.w, 'i') !== null) marks.push('italic')
    const uEl = find(rpr, NS.w, 'u')
    if (uEl !== null && get(uEl, NS.w, 'val') !== 'none') marks.push('underline')
    if (find(rpr, NS.w, 'strike') !== null) marks.push('strikethrough')
    const vert = find(rpr, NS.w, 'vertAlign')
    if (vert !== null) {
      const val = get(vert, NS.w, 'val') ?? ''
      if (val === 'subscript') marks.push('subscript')
      else if (val === 'superscript') marks.push('superscript')
    }
    if (find(rpr, NS.w, 'smallCaps') !== null) marks.push('smallcaps')
  }

  return text(t, marks)
}

// Python appends a Footnote for each w:footnoteReference whose text it
// finds in the footnotes part — through `footnotes_part`, an attribute
// python-docx 1.2 does not have. Every reference therefore ends in the
// `except Exception: continue`, and nothing is added.
function _extractFootnotes(para: XElement): void {
  for (const fnRef of descendants(para, NS.w, 'footnoteReference')) {
    const fnId = get(fnRef, NS.w, 'id')
    if (fnId === null) continue
    // int(fn_id) <= 0 → continue; otherwise the footnotes_part lookup
    // raises AttributeError → continue.
    continue
  }
}

// --- List detection --------------------------------------------------------

// Return true if the paragraph has a numId (bullet or numbered list).
function _paraIsList(para: XElement): boolean {
  const numPr = descendants(para, NS.w, 'numPr')[0]
  if (numPr === undefined) return false
  const numId = find(numPr, NS.w, 'numId')
  return numId !== null && (get(numId, NS.w, 'val') ?? '0') !== '0'
}

// The paragraph's own numbering level (w:numPr/w:ilvl), or -1.
// int(s) or 0 (int() raising, or no value).
function pyInt(v: string | null): number {
  const t = (v ?? '').trim()
  return /^[+-]?\d+$/.test(t) ? parseInt(t, 10) : 0
}

function _paraListLevel(para: XElement): number {
  const numPr = descendants(para, NS.w, 'numPr')[0]
  if (numPr === undefined) return -1
  const ilvl = find(numPr, NS.w, 'ilvl')
  if (ilvl === null) return 0
  const v = (get(ilvl, NS.w, 'val') ?? '').trim()
  return /^[+-]?\d+$/.test(v) ? parseInt(v, 10) : 0
}

// Best-effort check whether the list paragraph is numbered vs. bulleted.
// Looks at the abstract numbering definition's numFmt.
function _paraIsOrdered(para: XElement, src: Src): boolean {
  try {
    const numPr = descendants(para, NS.w, 'numPr')[0]
    if (numPr === undefined) return false
    const numIdEl = find(numPr, NS.w, 'numId')
    const ilvlEl = find(numPr, NS.w, 'ilvl')
    if (numIdEl === null) return false
    const numId = get(numIdEl, NS.w, 'val') ?? '0'
    const ilvl = ilvlEl !== null ? (get(ilvlEl, NS.w, 'val') ?? '0') : '0'
    // Walk the numbering part to find the format.
    const numElem = src.numberingEl()
    // Find <w:num w:numId="..."> → get abstractNumId
    for (const num of findall(numElem, NS.w, 'num')) {
      if (get(num, NS.w, 'numId') === numId) {
        const absRef = find(num, NS.w, 'abstractNumId')
        if (absRef === null) break
        const absId = get(absRef, NS.w, 'val')
        for (const absNum of findall(numElem, NS.w, 'abstractNum')) {
          if (get(absNum, NS.w, 'abstractNumId') === absId) {
            for (const lvl of findall(absNum, NS.w, 'lvl')) {
              if (get(lvl, NS.w, 'ilvl') === ilvl) {
                const fmt = find(lvl, NS.w, 'numFmt')
                if (fmt !== null) {
                  const val = get(fmt, NS.w, 'val') ?? ''
                  return !['bullet', 'none', ''].includes(val)
                }
              }
            }
          }
        }
        break
      }
    }
  } catch {
    // python-docx raising is a bulleted list
  }
  return false
}

// --- Paragraph alignment ---------------------------------------------------

// Return the model alignment string for a paragraph.
function _paraAlignment(para: XElement): Alignment {
  const pPr = find(para, NS.w, 'pPr')
  const jc = pPr === null ? null : find(pPr, NS.w, 'jc')
  if (jc !== null) {
    const v = get(jc, NS.w, 'val')
    if (v !== null && Object.prototype.hasOwnProperty.call(_DOCX_ALIGNMENT_MAP, v)) return _DOCX_ALIGNMENT_MAP[v]
    if (v !== null && _OTHER_JC.has(v)) return 'justify'
  }
  return 'justify'
}

// --- Table import -----------------------------------------------------------

// CT_R.text: w:t text, with w:tab / w:ptab as tabs, w:br (line breaks only)
// and w:cr as newlines and w:noBreakHyphen as "-".
export function runText(r: XElement): string {
  let s = ''
  for (let n = r.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue
    const e = n as XElement
    if (e.namespaceURI !== NS.w) continue
    switch (e.localName) {
      case 't': s += lxmlText(e) ?? ''; break
      case 'tab': case 'ptab': s += '\t'; break
      case 'cr': s += '\n'; break
      case 'br': s += (get(e, NS.w, 'type') ?? 'textWrapping') === 'textWrapping' ? '\n' : ''; break
      case 'noBreakHyphen': s += '-'; break
    }
  }
  return s
}

// Paragraph.text: its w:r and w:hyperlink children (a hyperlink's own w:r).
export function paragraphText(p: XElement): string {
  let s = ''
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue
    const e = n as XElement
    if (is(e, NS.w, 'r')) s += runText(e)
    else if (is(e, NS.w, 'hyperlink')) s += findall(e, NS.w, 'r').map(runText).join('')
  }
  return s
}

// _Cell.text: its paragraphs' text, one per line.
export function cellText(tc: XElement): string {
  return findall(tc, NS.w, 'p').map(paragraphText).join('\n')
}

// Convert a Word table to a model Table node.
function _importTable(tbl: XElement): Table | null {
  const rows: string[][] = []
  for (const row of findall(tbl, NS.w, 'tr')) {
    const cells: string[] = []
    for (const cell of rowCells(row)) cells.push(strip(cellText(cell)))
    rows.push(cells)
  }
  if (!rows.length) return null
  return table({ rows, caption: '', label: null })
}

// (text size in half-points, space before, space after, first-line indent in
// twips, line spacing in 240ths or null) of a paragraph that sets none of its
// own: Word's built-ins, the document defaults, then the default paragraph
// style.
function _styleDefaults(stylesEl: XElement | null): [number, number, number, number, number | null] {
  let size = 20, before = 0, after = 0, first = 0
  let line: number | null = 240
  if (stylesEl === null) return [size, before, after, first, line]
  const sources: [XElement | null, XElement | null][] = []
  const dd = find(stylesEl, NS.w, 'docDefaults')
  if (dd !== null) {
    const r = find(dd, NS.w, 'rPrDefault')
    const p = find(dd, NS.w, 'pPrDefault')
    sources.push([r !== null ? find(r, NS.w, 'rPr') : null, p !== null ? find(p, NS.w, 'pPr') : null])
  }
  for (const st of findall(stylesEl, NS.w, 'style')) {
    if (get(st, NS.w, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(get(st, NS.w, 'default') ?? '')) {
      sources.push([find(st, NS.w, 'rPr'), find(st, NS.w, 'pPr')])
      break
    }
  }
  for (const [rpr, ppr] of sources) {
    const sz = rpr !== null ? find(rpr, NS.w, 'sz') : null
    const v = sz !== null ? _twips(get(sz, NS.w, 'val')) : null
    if (v) size = v
    if (ppr !== null) [before, after, first, line] = _spacingOf(ppr, before, after, first, line)
  }
  return [size, before, after, first, line]
}

// The space before / after, first-line indent and line spacing (in 240ths of
// a line, null when exact or at-least) a w:pPr sets, over the given ones.
function _spacingOf(ppr: XElement, before: number, after: number, first: number,
  line: number | null): [number, number, number, number | null] {
  const sp = find(ppr, NS.w, 'spacing')
  if (sp !== null) {
    const b = _twips(get(sp, NS.w, 'before'))
    const a = _twips(get(sp, NS.w, 'after'))
    before = b !== null ? b : before
    after = a !== null ? a : after
    const ln = _twips(get(sp, NS.w, 'line'))
    if (ln !== null) line = (get(sp, NS.w, 'lineRule') || 'auto') === 'auto' ? ln : null
  }
  const ind = find(ppr, NS.w, 'ind')
  if (ind !== null) {
    const f = _twips(get(ind, NS.w, 'firstLine'))
    first = f !== null ? f : first
  }
  return [before, after, first, line]
}

// A paragraph's own space before / after, first-line indent and line
// spacing.
function _paraSpacing(p: XElement, before: number, after: number, first: number,
  line: number | null): [number, number, number, number | null] {
  const ppr = find(p, NS.w, 'pPr')
  return ppr !== null ? _spacingOf(ppr, before, after, first, line) : [before, after, first, line]
}

// (page size code, [top, bottom, left, right] margins in cm) of a w:sectPr,
// or null when it does not give them all.
function _pageSetup(sect: XElement | null): [string, [number, number, number, number]] | null {
  if (sect === null) return null
  const pgSz = find(sect, NS.w, 'pgSz'), pgMar = find(sect, NS.w, 'pgMar')
  if (pgSz === null || pgMar === null) return null
  let w = _twips(get(pgSz, NS.w, 'w')), h = _twips(get(pgSz, NS.w, 'h'))
  const margins = ['top', 'bottom', 'left', 'right'].map((k) => _twips(get(pgMar, NS.w, k)))
  if (w === null || h === null || margins.some((m) => m === null)) return null
  ;[w, h] = [Math.min(w, h), Math.max(w, h)]
  let code = 'A4'
  if (Math.abs(w - 12240) <= 120 && Math.abs(h - 15840) <= 120) code = 'Letter'
  else if (Math.abs(w - 12240) <= 120 && Math.abs(h - 20160) <= 120) code = 'Legal'
  const cm = margins.map((m) => parseFloat(pyFixed(m! * 2.54 / 1440, 2))) as [number, number, number, number]
  return [code, cm]
}

// The text size (half-points) of a paragraph's first run with text.
function _firstRunSize(p: XElement, bodyHp: number): number {
  for (const r of findall(p, NS.w, 'r')) {
    const t = find(r, NS.w, 't')
    if (t === null || !strip(lxmlText(t) ?? '')) continue
    const rpr = find(r, NS.w, 'rPr')
    const sz = rpr !== null ? find(rpr, NS.w, 'sz') : null
    const v = sz !== null ? _twips(get(sz, NS.w, 'val')) : null
    return v ? v : bodyHp
  }
  return bodyHp
}

// The most frequent value, the first seen winning a tie.
function _mostCommon<T>(values: T[]): T {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | undefined
  for (const [v, n] of counts) if (best === undefined || n > counts.get(best)!) best = v
  return best!
}

// "Figure 3 | ...", "Fig. 2. ...", "Table 1: ..." starting a caption
// paragraph: the label LaTeX numbers itself. The separator is required, so a
// paragraph "Figure 2 shows..." after a figure stays text.
const _FIG_CAPTION_RE = pyRe('^\\s*(?:Figure|Fig\\.?)\\s*\\d+[A-Za-z]?\\s*(?:[.:|\u2502\u2503\u2014\u2013-]|\\s[I|]\\s)\\s*')
const _TABLE_CAPTION_RE = pyRe('^\\s*Table\\s*\\d+[A-Za-z]?\\s*(?:[.:|\u2502\u2503\u2014\u2013-]|\\s[I|]\\s)\\s*')

// The LaTeX caption of a caption paragraph ("Figure 1 | Schematic..."), its
// label dropped, or null when the block is not one. The label may run over
// several runs ("Figure " + "1 I"): it is matched in the text of the leading
// text runs and that many characters are taken off them.
function _captionFrom(block: Block, pattern: RegExp): string | null {
  if (block.type !== 'Paragraph') return null
  const lead: string[] = []
  for (const r of block.children) {
    if (r.type !== 'Text') break
    lead.push(r.text)
  }
  pattern.lastIndex = 0
  const m = pattern.exec(lead.join(''))
  if (m === null || m.index !== 0 || m[0].length === 0) return null
  let n = [...m[0]].length
  const runs: Inline[] = []
  for (let r of block.children) {
    if (n > 0 && r.type === 'Text') {
      const cps = [...r.text]
      if (cps.length <= n) { n -= cps.length; continue }
      r = text(cps.slice(n).join(''), [...r.marks])
      n = 0
    }
    runs.push(r)
  }
  const cap = strip(serializeInlines(runs))
  return cap || null
}

// Word's caption paragraphs to the figure above them (a blank line between
// them allowed) and the table below them, so a figure that floats takes its
// caption along.
function _attachCaptions(children: Block[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < children.length) {
    const b = children[i]
    if (b.type === 'Figure' && !b.caption) {
      let j = i + 1
      if (j < children.length && _isBlankLine(children[j])) j += 1
      const cap = j < children.length ? _captionFrom(children[j], _FIG_CAPTION_RE) : null
      if (cap) {
        b.caption = cap
        out.push(b)
        i = j + 1
        continue
      }
    }
    if (b.type === 'Table' && !b.caption && out.length) {
      const cap = _captionFrom(out[out.length - 1], _TABLE_CAPTION_RE)
      if (cap) {
        out.pop()
        b.caption = cap
      }
    }
    out.push(b)
    i += 1
  }
  return out
}

// 1 or 2 for a paragraph formatted as a heading by hand: all bold, short, not
// ending in "." or ":", every run at least a point larger than the body text
// (three points or more: level 1). 0 otherwise.
function _directHeadingLevel(p: XElement, runs: Inline[], bodyHp: number): number {
  if (!runs.length || runs.some((r) => r.type !== 'Text')) return 0
  const texts = (runs as Text[]).filter((r) => strip(r.text))
  if (!texts.length || !texts.every((r) => r.marks.includes('bold'))) return 0
  const plain = strip((runs as Text[]).map((r) => r.text).join(''))
  if ([...plain].length > 150 || plain.endsWith('.') || plain.endsWith(':')) return 0
  const sizes: number[] = []
  for (const r of findall(p, NS.w, 'r')) {
    const t = find(r, NS.w, 't')
    if (t === null || !strip(lxmlText(t) ?? '')) continue
    const rpr = find(r, NS.w, 'rPr')
    const sz = rpr !== null ? find(rpr, NS.w, 'sz') : null
    const v = sz !== null ? _twips(get(sz, NS.w, 'val')) : null
    sizes.push(v ? v : bodyHp)
  }
  if (!sizes.length) return 0
  const smallest = Math.min(...sizes)
  if (smallest >= bodyHp + 6) return 1
  if (smallest >= bodyHp + 2) return 2
  return 0
}

// A blank-line paragraph the importer made (a lone no-break space).
function _isBlankLine(b: Block): boolean {
  return b.type === 'Paragraph' && b.children.length === 1 && b.children[0].type === 'Text'
    && (b.children[0] as Text).text === '\u00a0'
}

// A w:w / w:val width in twips, or null when it is not a whole number.
function _twips(v: string | null): number | null {
  const t = strip(v || '')
  return /^[0-9]+$/.test(t) ? parseInt(t, 10) : null
}

// A Word table holding pictures, as a table whose cells are LaTeX: each
// cell's paragraphs (\par between them), lists and pictures
// (\includegraphics at the column's width). Its columns are m{} at their
// Word widths, so a row's text sits centred beside its picture; the
// serializer makes a table with pictures a longtable, which breaks between
// rows. Returns the table and the next image number.
async function _importPictureTable(tbl: XElement, src: Src, imageDir: string, startIdx: number,
  textEmu: number | null, fs: FileAccess, kindOf: (para: XElement) => Kind): Promise<[Table | null, number]> {
  let count = startIdx

  const cellLatex = async (tc: XElement): Promise<string> => {
    const parts: string[] = []
    let items: string[] = []
    let ordered = false
    const flush = () => {
      if (items.length) {
        const env = ordered ? 'enumerate' : 'itemize'
        parts.push(`\\begin{${env}} ` + items.map((t) => `\\item ${t}`).join(' ') + ` \\end{${env}}`)
        items = []
      }
    }
    const walk = async (elems: Iterable<XElement>): Promise<void> => {
      for (const el of elems) {
        const tag = localName(el)
        if (tag === 'tbl') {
          for (const tr of findall(el, NS.w, 'tr')) {
            for (const inner of findall(tr, NS.w, 'tc')) await walk(iterChildren(inner))
          }
          continue
        }
        if (tag !== 'p') continue
        const text = strip(serializeInlines(_runsToInlines(el, src)))
        const pics = await _imagesInParagraph(el, src, imageDir, count, fs)
        count += pics.length
        for (const [path] of pics) {
          flush()
          parts.push('\\includegraphics[width=\\linewidth]{' + path.replaceAll('\\', '/') + '}')
        }
        if (!text) continue
        if (kindOf(el) === 'list' || _paraIsList(el)) {
          const o = _paraIsOrdered(el, src)
          if (items.length && o !== ordered) flush()
          ordered = o
          items.push(text)
        } else {
          flush()
          parts.push(text)
        }
      }
    }
    await walk(iterChildren(tc))
    flush()
    return parts.join(' \\par ')
  }

  const rows: string[][] = []
  const merges: number[][] = []
  let r = 0
  for (const tr of findall(tbl, NS.w, 'tr')) {
    const row: string[] = []
    for (const tc of findall(tr, NS.w, 'tc')) {
      const tcPr = find(tc, NS.w, 'tcPr')
      const spanEl = tcPr === null ? null : find(tcPr, NS.w, 'gridSpan')
      let span = spanEl !== null ? _twips(get(spanEl, NS.w, 'val')) : null
      span = span && span > 1 ? span : 1
      if (span > 1) merges.push([r, row.length, 1, span])
      row.push(await cellLatex(tc))
      for (let k = 1; k < span; k++) row.push('')
    }
    rows.push(row)
    r++
  }
  if (!rows.length) return [null, count]
  const ncols = Math.max(...rows.map((x) => x.length))
  for (const x of rows) while (x.length < ncols) x.push('')

  // Column widths: Word's grid as a share of the text width, shrunk to 0.9
  // in all so the cell padding still fits on the line.
  const gridEl = find(tbl, NS.w, 'tblGrid')
  const grid = gridEl === null ? [] : findall(gridEl, NS.w, 'gridCol').map((g) => _twips(get(g, NS.w, 'w')))
  let fracs: number[]
  if (textEmu && grid.length === ncols && grid.every((g) => g)) {
    fracs = grid.map((g) => g! * 635 / textEmu)
  } else {
    fracs = Array.from({ length: ncols }, () => 1.0 / ncols)
  }
  const total = fracs.reduce((a, b) => a + b, 0)
  if (total > 0.9) fracs = fracs.map((f) => f * 0.9 / total)
  const spec = fracs.map((f) => `m{${pyFixed(Math.max(f, 0.05), 2)}\\textwidth}`).join('')

  // Ruled when Word draws its borders (a grid style or tblBorders).
  let style = 'plain'
  const pr = find(tbl, NS.w, 'tblPr')
  if (pr !== null) {
    const st = find(pr, NS.w, 'tblStyle')
    const borders = find(pr, NS.w, 'tblBorders')
    if (st !== null && (get(st, NS.w, 'val') || '').toLowerCase().includes('grid')) {
      style = 'grid'
    } else if (borders !== null && [...iterChildren(borders)].some((b) => !['', 'nil', 'none'].includes(get(b, NS.w, 'val') || ''))) {
      style = 'grid'
    }
  }
  return [table({ rows, caption: '', label: null, alignment: spec, style, merges }), count]
}

// --- Image extraction -------------------------------------------------------

// Save any inline images referenced from this paragraph into imageDir.
// Returns the list of saved file paths in document order.
// Saves the paragraph's pictures; each comes with the width it has on the
// Word page as a share of the text width ('' when unknown).
async function _imagesInParagraph(para: XElement, src: Src, imageDir: string, startIdx: number,
  fs: FileAccess, textEmu: number | null = null): Promise<[string, string][]> {
  const paths: [string, string][] = []
  // The size Word shows each picture at: wp:extent of the wp:inline /
  // wp:anchor holding it, in EMU.
  const widths = new Map<XElement, string>()
  for (const tag of ['inline', 'anchor']) {
    for (const frame of descendants(para, NS.wp, tag)) {
      const ext = find(frame, NS.wp, 'extent')
      const cx = ext === null ? 0 : pyInt(get(ext, null, 'cx'))
      if (cx <= 0 || !textEmu) continue
      const frac = Math.max(Math.min(cx / textEmu, 1.0), 0.01)
      for (const b of descendants(frame, NS.a, 'blip')) widths.set(b, `${pyFixed(frac, 2)}\\textwidth`)
    }
  }
  for (const blip of descendants(para, NS.a, 'blip')) {
    const rid = get(blip, NS.r, 'embed')
    if (!rid) continue
    const rel = src.part.rels.get(rid)
    if (rel === undefined || rel.external) continue
    const part = rel.target!
    let ext = suffix(part.partname) || '.png'
    let blob: Uint8Array | null = part.blob
    if (['.emf', '.wmf'].includes(ext.toLowerCase())) {
      // LaTeX cannot read a Windows metafile (XeTeX stops on it). One that
      // only wraps a bitmap (a pasted screenshot) becomes a PNG; any other
      // is left out.
      blob = ext.toLowerCase() === '.emf' ? _emfBitmapPng(blob) : null
      if (blob === null) continue
      ext = '.png'
    } else if (['.tif', '.tiff'].includes(ext.toLowerCase())) {
      // Nor TIFF (XeTeX reads it as EPS and stops); a microscope image is
      // often one. Decoded to a PNG, which also drops the TIFF's
      // resolution: one at 1 dpi made a picture metres wide, past TeX's
      // largest dimension, before width= scaled it.
      blob = _tiffPng(blob)
      if (blob === null) continue
      ext = '.png'
    }
    const outPath = join(imageDir, `image_${zpad(startIdx + paths.length, 3)}${ext}`)
    await fs.write(outPath, blob)
    paths.push([outPath, widths.get(blip) ?? ''])
  }
  return paths
}

// The bitmap of an EMF whose picture is one EMR_STRETCHDIBITS record (how
// Windows stores a pasted screenshot), as a PNG; null for any other
// metafile.
export function _emfBitmapPng(emf: Uint8Array): Uint8Array | null {
  const dv = new DataView(emf.buffer, emf.byteOffset, emf.byteLength)
  const n = emf.length
  let i = 0
  let found = -1
  while (i + 8 <= n) {
    const rtype = dv.getUint32(i, true), size = dv.getUint32(i + 4, true)
    if (size < 8 || i + size > n) return null
    if (rtype === 81) {                       // EMR_STRETCHDIBITS
      if (found >= 0) return null
      found = i
    } else if (rtype !== 1 && rtype !== 14) { // EMR_HEADER, EMR_EOF
      return null
    }
    i += size
  }
  if (found < 0 || found + 80 > n) return null
  const offBmi = dv.getUint32(found + 48, true), cbBmi = dv.getUint32(found + 52, true)
  const offBits = dv.getUint32(found + 56, true), cbBits = dv.getUint32(found + 60, true)
  const bmi = found + offBmi
  if (cbBmi < 40 || bmi + 40 > n) return null
  const width = dv.getInt32(bmi + 4, true), height = dv.getInt32(bmi + 8, true)
  const bits = dv.getUint16(bmi + 14, true), compression = dv.getUint32(bmi + 16, true)
  const clrUsed = dv.getUint32(bmi + 32, true)
  if (width <= 0 || height === 0 || (compression !== 0 && compression !== 3) || ![1, 4, 8, 24, 32].includes(bits)) return null
  if (compression === 3 && bits !== 32) return null
  const rows = Math.abs(height)
  const stride = Math.floor((width * bits + 31) / 32) * 4
  const data = found + offBits
  if (cbBits < stride * rows || data + stride * rows > n) return null
  const palette: number[][] = []
  if (bits <= 8) {
    const count = clrUsed || (1 << bits)
    const pal = bmi + dv.getUint32(bmi, true)
    if (pal + 4 * count > n) return null
    for (let k = 0; k < count; k++) palette.push([emf[pal + 4 * k + 2], emf[pal + 4 * k + 1], emf[pal + 4 * k]])
  }
  const raw = new Uint8Array(rows * (1 + width * 3))
  let o = 0
  for (let y = 0; y < rows; y++) {
    const src = data + (height > 0 ? rows - 1 - y : y) * stride
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      if (bits === 24 || bits === 32) {
        const b = bits / 8, p = src + b * x
        raw[o++] = emf[p + 2]; raw[o++] = emf[p + 1]; raw[o++] = emf[p]
      } else {
        const per = 8 / bits
        const byte = emf[src + Math.floor(x / per)]
        const idx = (byte >> (8 - bits * (x % per + 1))) & ((1 << bits) - 1)
        const c = palette[idx] ?? [0, 0, 0]
        raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2]
      }
    }
  }
  return _pngRgb(width, rows, raw)
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let k = 0; k < 256; k++) {
    let c = k
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[k] = c >>> 0
  }
  return t
})()

function crc32(parts: Uint8Array[]): number {
  let c = 0xFFFFFFFF
  for (const p of parts) for (let k = 0; k < p.length; k++) c = CRC_TABLE[(c ^ p[k]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function adler32(d: Uint8Array): number {
  let a = 1, b = 0
  for (let k = 0; k < d.length; k += 5552) {
    const end = Math.min(k + 5552, d.length)
    for (let j = k; j < end; j++) { a += d[j]; b += a }
    a %= 65521; b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

// The first image of a TIFF as a PNG, for the baseline kinds Word documents
// carry: 8-bit RGB(A), grey, palette or 1-bit, in strips, uncompressed, LZW
// (with or without the horizontal predictor) or PackBits. null for anything
// else (tiles, 16-bit, JPEG-in-TIFF...).
export function _tiffPng(tif: Uint8Array): Uint8Array | null {
  if (tif.length < 8) return null
  const le = tif[0] === 0x49 && tif[1] === 0x49
  if (!le && !(tif[0] === 0x4D && tif[1] === 0x4D)) return null
  const dv = new DataView(tif.buffer, tif.byteOffset, tif.byteLength)
  const u16 = (o: number) => dv.getUint16(o, le)
  const u32 = (o: number) => dv.getUint32(o, le)
  if (u16(2) !== 42) return null
  const ifd = u32(4)
  if (ifd + 2 > tif.length) return null
  const sizes: Record<number, number> = { 1: 1, 3: 2, 4: 4 }
  const tags = new Map<number, number[]>()
  const n = u16(ifd)
  for (let k = 0; k < n; k++) {
    const at = ifd + 2 + 12 * k
    if (at + 12 > tif.length) return null
    const tag = u16(at), typ = u16(at + 2), count = u32(at + 4)
    if (!(typ in sizes)) continue
    const size = sizes[typ] * count
    const off = size <= 4 ? at + 8 : u32(at + 8)
    if (off + size > tif.length) return null
    const vals: number[] = []
    for (let j = 0; j < count; j++) {
      vals.push(typ === 1 ? tif[off + j] : typ === 3 ? u16(off + 2 * j) : u32(off + 4 * j))
    }
    tags.set(tag, vals)
  }
  const one = (tag: number, def: number) => { const v = tags.get(tag); return v && v.length ? v[0] : def }
  const width = one(256, 0), height = one(257, 0)
  const bits = tags.get(258) ?? [1]
  const spp = one(277, 1)
  const comp = one(259, 1)
  const photo = one(262, -1)
  const predictor = one(317, 1)
  const offsets = tags.get(273), counts = tags.get(279)
  if (width <= 0 || height <= 0 || !offsets?.length || !counts?.length || offsets.length !== counts.length
    || one(284, 1) !== 1 || tags.has(322) || ![1, 5, 32773].includes(comp)
    || ![1, 2].includes(predictor) || bits.some((b) => b !== bits[0])) return null
  const bps = bits[0]
  if (!((bps === 8 && ((photo === 2 && spp >= 3) || ([0, 1, 3].includes(photo) && spp >= 1)))
    || (bps === 1 && [0, 1].includes(photo) && spp === 1))) return null
  if (predictor === 2 && bps !== 8) return null
  const rowBytes = Math.floor((width * spp * bps + 7) / 8)
  const chunks: Uint8Array[] = []
  let total = 0
  offsets.forEach((off, k) => {
    let chunk = tif.subarray(off, Math.min(tif.length, off + counts[k]))
    if (comp === 5) chunk = _tiffLzw(chunk)
    else if (comp === 32773) chunk = _packbits(chunk)
    chunks.push(chunk)
    total += chunk.length
  })
  if (total < rowBytes * height) return null
  const data = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { data.set(c, o); o += c.length }
  const pal = tags.get(320)
  if (photo === 3 && (!pal || pal.length < 3 * 256)) return null
  const raw = new Uint8Array(height * (1 + width * 3))
  let w = 0
  const row = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y++) {
    row.set(data.subarray(y * rowBytes, (y + 1) * rowBytes))
    if (predictor === 2) for (let x = spp; x < rowBytes; x++) row[x] = (row[x] + row[x - spp]) & 0xFF
    raw[w++] = 0
    for (let x = 0; x < width; x++) {
      if (bps === 1) {
        let v = (row[x >> 3] >> (7 - (x & 7))) & 1 ? 255 : 0
        if (photo === 0) v = 255 - v
        raw[w++] = v; raw[w++] = v; raw[w++] = v
      } else if (photo === 2) {
        raw[w++] = row[x * spp]; raw[w++] = row[x * spp + 1]; raw[w++] = row[x * spp + 2]
      } else if (photo === 3) {
        const i = row[x * spp]
        raw[w++] = pal![i] >> 8; raw[w++] = pal![256 + i] >> 8; raw[w++] = pal![512 + i] >> 8
      } else {
        let v = row[x * spp]
        if (photo === 0) v = 255 - v
        raw[w++] = v; raw[w++] = v; raw[w++] = v
      }
    }
  }
  return _pngRgb(width, height, raw)
}

// TIFF LZW: MSB-first 9-12 bit codes, 256 = clear, 257 = end, the code
// width growing one code early.
export function _tiffLzw(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let table: Uint8Array[] = []
  const reset = () => {
    table = []
    for (let i = 0; i < 256; i++) table.push(new Uint8Array([i]))
    table.push(new Uint8Array(0), new Uint8Array(0))
  }
  reset()
  let width = 9
  let pos = 0
  const totalBits = data.length * 8
  let prev: Uint8Array | null = null
  const join = (a: Uint8Array, b: number) => { const r = new Uint8Array(a.length + 1); r.set(a); r[a.length] = b; return r }
  while (pos + width <= totalBits) {
    const byte = pos >> 3
    const chunk = ((data[byte] ?? 0) << 16) | ((data[byte + 1] ?? 0) << 8) | (data[byte + 2] ?? 0)
    const code = (chunk >> (24 - (pos & 7) - width)) & ((1 << width) - 1)
    pos += width
    if (code === 256) { reset(); width = 9; prev = null; continue }
    if (code === 257) break
    let entry: Uint8Array
    if (prev === null) {
      if (code >= 256) break
      entry = table[code]
    } else if (code < table.length) {
      entry = table[code]
      table.push(join(prev, entry[0]))
    } else if (code === table.length) {
      entry = join(prev, prev[0])
      table.push(entry)
    } else {
      break
    }
    for (let j = 0; j < entry.length; j++) out.push(entry[j])
    prev = entry
    if (table.length >= (1 << width) - 1 && width < 12) width++
  }
  return new Uint8Array(out)
}

// TIFF PackBits run-length decoding.
export function _packbits(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < data.length) {
    const n = data[i++]
    if (n < 128) {
      for (let j = 0; j < n + 1 && i + j < data.length; j++) out.push(data[i + j])
      i += n + 1
    } else if (n > 128) {
      if (i < data.length) for (let j = 0; j < 257 - n; j++) out.push(data[i])
      i += 1
    }
  }
  return new Uint8Array(out)
}

// A PNG of filtered RGB rows, its zlib stream in stored (uncompressed)
// blocks so the bytes do not depend on a zlib build. The .ktex is zipped.
function _pngRgb(width: number, height: number, raw: Uint8Array): Uint8Array {
  const out: number[] = []
  const u32 = (v: number) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  const chunk = (kind: string, body: Uint8Array) => {
    const k = new Uint8Array([...kind].map(ch => ch.charCodeAt(0)))
    u32(body.length)
    for (const x of k) out.push(x)
    for (let j = 0; j < body.length; j++) out.push(body[j])
    u32(crc32([k, body]))
  }
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const z = new Uint8Array(2 + raw.length + 5 * blocks + 4)
  z[0] = 0x78; z[1] = 0x01
  let o = 2
  for (let k = 0; k < Math.max(raw.length, 1); k += 65535) {
    const len = Math.min(65535, raw.length - k)
    z[o++] = k + 65535 >= raw.length ? 1 : 0
    z[o++] = len & 255; z[o++] = len >> 8
    z[o++] = ~len & 255; z[o++] = (~len >> 8) & 255
    z.set(raw.subarray(k, k + len), o); o += len
  }
  const ad = adler32(raw)
  z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 255; z[o++] = (ad >>> 8) & 255; z[o++] = ad & 255
  for (const x of [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) out.push(x)
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, width)
  new DataView(ihdr.buffer).setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8)
  chunk('IHDR', ihdr)
  chunk('IDAT', z.subarray(0, o))
  chunk('IEND', new Uint8Array(0))
  return new Uint8Array(out)
}
