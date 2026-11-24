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

import { figure, highlight, link, paraFormat, type ParaFormat, listItem, list as listNode, mathBlock, mathInline, paragraph, section, table, text, title as titleNode,
  author as authorNode, abstract as abstractNode, document, docMeta, inlineRaw, rawLatex } from './model.ts'
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
import { unzlibSync } from 'fflate'

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
export const DOC_NOT_SUPPORTED = 'This is an older Word file (.doc), which kTeX cannot read. '
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
  let pendingListStyle = ''

  const flushList = () => {
    if (pendingListItems.length) {
      children.push(listNode(pendingListOrdered, pendingListItems, pendingListStyle))
      pendingListItems = []
      pendingListOrdered = false
      pendingListStyle = ''
    }
  }

  let stylesEl: XElement | null | undefined
  const styles = () => (stylesEl === undefined ? (stylesEl = src.stylesEl()) : stylesEl)

  // The Normal style over the document defaults: body text size and the
  // space around and indent of a paragraph that sets none of its own.
  let stylesForDefaults: XElement | null = null
  try { stylesForDefaults = src.stylesEl() } catch { stylesForDefaults = null }
  const [bodyHp, defBefore, defAfter, defFirst, defLine] = _styleDefaults(stylesForDefaults)
  // The body's size and font: the most used in the text (a template sets
  // them on every run, not in Normal), so only text set apart is marked.
  {
    const sizes = new Map<number, number>(), fonts = new Map<string, number>()
    // A paragraph style's own size (its w:rPr), for runs that set none.
    const styleSize = new Map<string, number>()
    if (stylesForDefaults) {
      for (const st of findall(stylesForDefaults, NS.w, 'style')) {
        const rp = find(st, NS.w, 'rPr'), sz = rp === null ? null : find(rp, NS.w, 'sz')
        if (sz !== null) styleSize.set(get(st, NS.w, 'styleId') ?? '', Number(get(sz, NS.w, 'val') ?? 0))
      }
    }
    for (const r of descendants(body, NS.w, 'r')) {
      const n = (lxmlText(find(r, NS.w, 't') ?? r) ?? '').length
      if (!n) continue
      const rpr = find(r, NS.w, 'rPr')
      const sz = rpr === null ? null : find(rpr, NS.w, 'sz')
      let p = r.parentNode as XElement | null
      while (p && p.localName !== 'p') p = p.parentNode as XElement | null
      const own = p ? styleSize.get(pStyleId(p) ?? '') : undefined
      const hp = sz === null ? (own || bodyHp) : Number(get(sz, NS.w, 'val') ?? bodyHp)
      sizes.set(hp, (sizes.get(hp) ?? 0) + n)
      const f = rpr === null ? null : find(rpr, NS.w, 'rFonts')
      const fam = _fontKey((f === null ? '' : get(f, NS.w, 'ascii') || get(f, NS.w, 'hAnsi') || '') || _defaultFont(stylesForDefaults))
      fonts.set(fam, (fonts.get(fam) ?? 0) + n)
    }
    const top = <T>(m: Map<T, number>, d: T) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? d
    _runCtx.bodyHp = top(sizes, bodyHp)
    // Code set in Courier is never the body font, however long.
    fonts.delete('courier')
    _runCtx.bodyFont = top(fonts, '')
  }
  // (no space around it, first line indented, text size, line spacing) for
  // each body paragraph.
  const paraStats: [boolean, boolean, number, number | null][] = []

  let usesCheckBoxes = false
  let blankRoomEmu = 0  // height of text boxes the next blank lines made room for
  const walk = async (elems: Iterable<XElement>): Promise<void> => {
  for (const childElem of elems) {
    // The paragraph before ended a Word section (its w:sectPr).
    let prev = childElem.previousSibling
    while (prev && !isElement(prev)) prev = prev.previousSibling
    if (prev && isElement(prev) && localName(prev) === 'p') {
      const ppr = find(prev, NS.w, 'pPr')
      if (ppr !== null && find(ppr, NS.w, 'sectPr') !== null) children.push(rawLatex(SECTION_MARK))
    }
    const tag = localName(childElem)

    // --- Table ---
    if (tag === 'tbl') {
      flushList()
      // An equation kTeX laid out as a borderless table (centred, its
      // number at the margin; an align one row per line): an equation again.
      const eq = equationTable(childElem)
      if (eq !== null) { children.push(eq); continue }
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
      if (is(childElem, NS.w, 'tbl') && _isFormTable(childElem)) {
        children.push(_importFormTable(childElem, src, textEmu))
        if (descendants(childElem, NS.w, 'checkBox').length) usesCheckBoxes = true
        continue
      }
      if (is(childElem, NS.w, 'tbl')) {
        const tblNode = _importTable(childElem)
        if (tblNode !== null) children.push(tblNode)
      }
      continue
    }

    // A block-level content control (w:sdt: a box Word wraps around its
    // text, often with its text boxes): its content is the body's content.
    if (is(childElem, NS.w, 'sdt')) {
      const content = find(childElem, NS.w, 'sdtContent')
      if (content !== null) await walk(iterChildren(content))
      continue
    }
    if (tag !== 'p') continue
    if (!is(childElem, NS.w, 'p')) continue
    const para = childElem

    // Text boxes anchored in the paragraph (a form's introduction set in a
    // box): their paragraphs and tables, before the paragraph's own text.
    // A box comes twice (mc:Choice and the VML mc:Fallback): the fallback's
    // copy is skipped.
    for (const box of descendants(para, NS.w, 'txbxContent')) {
      let up = box.parentNode as XElement | null, fallback = false
      while (up && up !== para) {
        if (localName(up) === 'Fallback' || (localName(up) === 'txbxContent')) { fallback = true; break }
        up = up.parentNode as XElement | null
      }
      if (!fallback) {
        await walk(iterChildren(box))
        // The blank lines Word kept beside the box (to make room for it)
        // would now add its height again below its text.
        let frame = box.parentNode as XElement | null
        while (frame && frame !== para && localName(frame) !== 'anchor') frame = frame.parentNode as XElement | null
        const ext = frame && frame !== para ? find(frame, NS.wp, 'extent') : null
        if (ext !== null) blankRoomEmu += pyInt(get(ext, null, 'cy'))
      }
    }

    // The date under the title, a DATE field alone in its paragraph (as
    // kTeX writes \\today): the document's own date, not text.
    const fields = descendants(para, NS.w, 'fldSimple')
    if (fields.length === 1 && /^\s*DATE\b/.test(get(fields[0], NS.w, 'instr') ?? '')
      && descendants(para, NS.w, 't').every(t => fields[0].contains(t))) continue

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

    // Sizes and fonts set on runs are kept in body text, not in headings
    // and titles (their own style sets them).
    _runCtx.body = kind === 'paragraph' || kind === 'list'
    const textRuns = _runsToInlines(para, src, kind === 'author')
    _runCtx.body = false

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
      // A bullet or number on an empty paragraph (Word leaves one behind
      // a deleted item) is no item: it would print an empty one.
      if (!textRuns.some((r) => r.type !== 'Text' || strip(r.text))) continue
      // Nested items keep their level; the list takes its top level's
      // kind and style (Word's bullet character or number format).
      const lv = Math.max(0, _paraListLevel(para))
      const ordered = lv > 0 && pendingListItems.length ? pendingListOrdered : _paraIsOrdered(para, src)
      if (pendingListItems.length && lv === 0 && ordered !== pendingListOrdered) flushList()
      if (!pendingListItems.length) pendingListStyle = _listStyle(para, src, ordered)
      pendingListOrdered = ordered
      pendingListItems.push(listItem(textRuns, Math.min(3, lv)))
      continue
    }

    flushList()

    // Resolve paragraph alignment.
    const alignment = _paraAlignment(para)

    if (kind === 'title') {
      // One title: an empty Title paragraph is left out, and a later one
      // ("CONTENTS" set in the Title style) is an unnumbered heading. Two
      // titles printed \maketitle twice, the first with no \title, and the
      // compile stopped.
      if (!textRuns.some((r) => r.type === 'Text' && r.text.trim())) {
        // nothing
      } else if (children.some((c) => c.type === 'Title')) {
        children.push(section(1, textRuns, false))
      } else {
        title = textRuns.filter((r): r is Text => r.type === 'Text').map((r) => r.text).join('')
        children.push(titleNode(textRuns))
      }
    } else if (kind === 'heading') {
      // Tabs in a heading ("Purchase Order<tab>Imperial College") keep a gap.
      const full = paragraphText(childElem)
      const runs: Inline[] = /\S\t+\S/.test(full)
        ? full.trim().split(/\t+/).flatMap((t, i): Inline[] => i ? [{ type: 'InlineRaw', latex: '\\qquad ' }, text(t)] : [text(t)])
        : textRuns
      children.push(section(level, runs, _wordNumbersHeading(para, styles())))
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
        blankRoomEmu = 0
        children.push(paraFormat(paragraph(textRuns, alignment), _paraFormat(childElem)))
        const [before, after, first, line] = _paraSpacing(childElem, defBefore, defAfter, defFirst, defLine)
        paraStats.push([before === 0 && after === 0, first > 0, _firstRunSize(childElem, bodyHp), line])
      } else {
        // A blank line: Word's way of spacing paragraphs. A no-break space
        // keeps it a line in the PDF and on the page.
        if (blankRoomEmu > 0) {
          // Its height: the paragraph mark's size, single spaced.
          blankRoomEmu -= _firstRunSize(childElem, bodyHp) / 2 * 1.15 * 12700
          continue
        }
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
    if (pageSetup[2]) meta.landscape = true
  }
  // Word's headers and footers, as fancyhdr sets them.
  // Underlined text breaks across lines, as in Word (\underline cannot).
  if (JSON.stringify(children).includes('"underline"')) {
    const ul = '\\usepackage[normalem]{ulem}\n\\AtBeginDocument{\\let\\underline\\uline}'
    meta.preamble_extras = meta.preamble_extras ? meta.preamble_extras + '\n' + ul : ul
  }
  const hf = _headerFooterLatex(src, sect)
  if (hf) meta.preamble_extras = meta.preamble_extras ? meta.preamble_extras + '\n' + hf : hf
  if (paraStats.length) {
    const pt = _mostCommon(paraStats.map((st) => st[2])) / 2
    meta.body_font_pt = pt <= 10.5 ? 10 : pt <= 11.5 ? 11 : 12
    const lines = paraStats.map((st) => st[3]).filter((l): l is number => l !== null)
    if (lines.length) {
      const ls = _mostCommon(lines) / 240
      meta.line_spacing = ls < 1.25 ? 1.0 : ls < 1.75 ? 1.5 : 2.0
    }
  }
  // Form tables draw their tick boxes with amssymb's \square and \boxtimes.
  if (usesCheckBoxes && !meta.packages.includes('amssymb')) meta.packages.push('amssymb')
  // Figures float, as in a journal: one too tall for the rest of a page goes
  // to the top of the next and the text fills the gap (KherveTeX's own
  // documents keep the float package and pin theirs with [H]).
  meta.packages = meta.packages.filter((p) => p !== 'float')
  // Word and PDF carry no date to print: without \date{} \maketitle
  // would put the day of the import under the title.
  if (children.some((c) => c.type === 'Title')) meta.frontmatter_extras = '\\date{}'
  // The page in the columns of the section that holds most of the text.
  const columns = _mainColumns(body!)
  if (columns >= 2 && columns <= 4) meta.column_count = columns
  let ordered = _orderColumnAuthors(children)
  // Empty paragraphs before the first text (a template's spacing above its
  // title) printed as lines of their own: before \maketitle they made a
  // page of nothing.
  while (ordered.length && ordered[0].type === 'Paragraph'
    && !ordered[0].children.some((c) => !(c.type === 'Text' && !c.text.trim()))) ordered = ordered.slice(1)
  return document(ordered, meta)
}

// Word's breaks inside a paragraph (<w:br/>): a line break is LaTeX's \\,
// and in an author paragraph that Word sets in columns (an IEEE paper's
// authors side by side) a column break separates two authors, \and, as
// \maketitle sets them side by side. Dropped, the lines ran together
// ("Surnameline 2:") and off the page.
const LINE_BREAK = '\\\\'
const AUTHOR_BREAK = '\\and{}'
// Between the blocks of two Word sections while a document is read
// (_orderColumnAuthors takes them out again).
const SECTION_MARK = '%% kt-section-end'

// A run holding breaks: each piece of its text, with its formatting, and
// the breaks between them.
function _runWithBreaks(runElem: XElement, author: boolean): Inline[] {
  const out: Inline[] = []
  const rpr = find(runElem, NS.w, 'rPr')
  for (const child of iterChildren(runElem)) {
    const tag = localName(child)
    if (tag === 't') {
      const piece = runElem.cloneNode(false) as XElement
      if (rpr !== null) piece.appendChild(rpr.cloneNode(true))
      piece.appendChild(child.cloneNode(true))
      const inline = _runElementToInline(piece)
      if (inline !== null) out.push(inline)
    } else if (tag === 'br') {
      const kind = get(child, NS.w, 'type') || 'textWrapping'
      if (kind === 'page') continue
      out.push(inlineRaw(author && kind === 'column' ? AUTHOR_BREAK : LINE_BREAK))
    }
  }
  return out
}

// No break at the start or the end of a paragraph (LaTeX: "There's no line
// here to end"), and one where several follow each other.
function _tidyBreaks(out: Inline[]): Inline[] {
  const isBreak = (x: Inline) => x.type === 'InlineRaw' && (x.latex === LINE_BREAK || x.latex === AUTHOR_BREAK)
  const blank = (x: Inline) => x.type === 'Text' && !x.text.trim()
  let tidy: Inline[] = []
  for (const x of out) {
    if (isBreak(x)) {
      while (tidy.length && blank(tidy[tidy.length - 1])) tidy.pop()
      const last = tidy[tidy.length - 1]
      if (!tidy.length || (isBreak(last) && (last as { latex: string }).latex === AUTHOR_BREAK)) continue
      if (isBreak(last)) {
        if ((x as { latex: string }).latex === AUTHOR_BREAK) tidy[tidy.length - 1] = x
        continue
      }
    } else if (blank(x) && tidy.length && isBreak(tidy[tidy.length - 1])) {
      continue
    }
    tidy.push(x)
  }
  let end = tidy.length
  while (end && blank(tidy[end - 1])) end -= 1
  if (end && isBreak(tidy[end - 1])) tidy = tidy.slice(0, end - 1)
  return tidy
}

// Authors Word sets in columns, in reading order. Word fills a column
// before the next: an IEEE paper's six authors in three columns come as
// 1, 4 | 2, 5 | 3, 6 (a column break, \and, between columns, a new
// paragraph for the next author down). Read row by row they are 1 to 6, one
// author block whose \and set them side by side. The section marks are
// dropped.
function _orderColumnAuthors(children: Block[]): Block[] {
  const isMark = (b: Block) => b.type === 'RawLatex' && b.text === SECTION_MARK
  const isAnd = (x: Inline) => x.type === 'InlineRaw' && x.latex === AUTHOR_BREAK
  const hasText = (xs: Inline[]) => xs.some((u) => !(u.type === 'Text' && !u.text.trim()))
  const out: Block[] = []
  let i = 0
  while (i < children.length) {
    const b = children[i]
    if (isMark(b)) { i += 1; continue }
    if (b.type !== 'Author') { out.push(b); i += 1; continue }
    const run: Extract<Block, { type: 'Author' }>[] = []
    while (i < children.length && children[i].type === 'Author') {
      run.push(children[i] as Extract<Block, { type: 'Author' }>)
      i += 1
    }
    if (!run.some((a) => a.children.some(isAnd))) { out.push(...run); continue }
    const columns: Inline[][][] = [[]]
    let col = 0
    for (const a of run) {
      let unit: Inline[] = []
      for (const x of [...a.children, null]) {
        if (x === null || isAnd(x)) {
          if (hasText(unit)) columns[col].push(unit)
          if (x !== null) {
            col += 1
            if (col === columns.length) columns.push([])
          }
          unit = []
        } else {
          unit.push(x)
        }
      }
    }
    // Author paragraphs just before (a note under the title, in the Author
    // style) are entries of their own, ahead of the rows.
    const names: Inline[] = []
    const lead: Inline[][] = []
    while (out.length && out[out.length - 1].type === 'Author') {
      const prev = out.pop() as Extract<Block, { type: 'Author' }>
      if (hasText(prev.children)) lead.unshift(prev.children)
    }
    for (const unit of lead) {
      if (names.length) names.push(inlineRaw(AUTHOR_BREAK))
      names.push(...unit)
    }
    const rows = Math.max(...columns.map((c) => c.length))
    for (let row = 0; row < rows; row++) {
      for (const c of columns) {
        if (row < c.length) {
          if (names.length) names.push(inlineRaw(AUTHOR_BREAK))
          names.push(...c[row])
        }
      }
    }
    out.push(authorNode(names))
  }
  return out
}

// The columns of the Word section that holds most of the text (an IEEE
// paper: its title in one column, its authors in three, its body in two).
function _mainColumns(body: XElement): number {
  const cols = (sect: XElement | null): number => {
    const c = sect !== null ? find(sect, NS.w, 'cols') : null
    const n = c !== null ? parseInt(get(c, NS.w, 'num') || '1', 10) : 1
    return Number.isFinite(n) ? Math.max(1, n) : 1
  }
  const sections: [number, number][] = []
  let chars = 0
  for (const el of iterChildren(body)) {
    const tag = localName(el)
    if (tag === 'p' || tag === 'tbl') {
      chars += (el.textContent ?? '').length
      const ppr = tag === 'p' ? find(el, NS.w, 'pPr') : null
      const sect = ppr !== null ? find(ppr, NS.w, 'sectPr') : null
      if (sect !== null) { sections.push([chars, cols(sect)]); chars = 0 }
    } else if (tag === 'sectPr') {
      sections.push([chars, cols(el)])
      chars = 0
    }
  }
  if (!sections.length) return 1
  // max() of the pairs: the most text, then the most columns.
  sections.sort((a, b) => b[0] - a[0] || b[1] - a[1])
  return sections[0][1]
}

// --- Inline extraction (with hyperlinks, footnotes, sub/superscript) -------

// Extract inline content from a paragraph, including hyperlinks.
function _runsToInlines(para: XElement, src: Src, author = false): Inline[] {
  const out: Inline[] = []

  // Walk child XML elements to capture hyperlinks in document order.
  // <w:r> = run, <w:hyperlink> = link wrapping one or more runs.
  for (const elem of iterChildren(para)) {
    const tag = localName(elem)

    if (tag === 'r') {
      if (find(elem, NS.w, 'br') !== null) {
        out.push(..._runWithBreaks(elem, author))
        continue
      }
      const inline = _runElementToInline(elem)
      if (inline !== null) out.push(_highlighted(elem, inline))
    } else if (tag === 'oMath' && elem.namespaceURI === M_NS) {
      // A Word equation in the line of text.
      const latex = ommlToLatex(elem)
      if (latex) out.push(mathInline(latex))
    } else if (tag === 'ins') {
      // Text typed with Track Changes on: kept as an insertion (its mark
      // carries the author and date).
      for (const sub of findall(elem, NS.w, 'r')) {
        const inline = _runElementToInline(sub)
        if (inline !== null) out.push(_highlighted(sub, inline))
      }
    } else if (tag === 'del') {
      // Text deleted with Track Changes on: kept, struck through, as a
      // deletion to accept or reject (w:delText holds it).
      for (const sub of findall(elem, NS.w, 'r')) {
        const dt = find(sub, NS.w, 'delText')
        if (dt === null) continue
        const piece = sub.cloneNode(true) as XElement
        const t = piece.ownerDocument!.createElementNS(NS.w, 'w:t')
        t.textContent = lxmlText(dt) ?? ''
        piece.appendChild(t)
        // Read as if in the w:del (for the mark): put it back under it.
        elem.appendChild(piece)
        const inline = _runElementToInline(piece)
        elem.removeChild(piece)
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

  return _tidyBreaks(out)
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
    // What the table leaves out (digits, + = ( ) and the space) is the ASCII
    // character itself.
    out.push(code <= 0xFF ? (SYMBOL_FONT[code] ?? String.fromCodePoint(code)) : ch)
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
  } else if ([...t].some((ch) => ch.codePointAt(0)! >= 0xF020 && ch.codePointAt(0)! <= 0xF0FF)) {
    // Symbol characters whose font comes from the style (an IEEE
    // template's "a + b = γ (1)"): Word stores them at U+F020-F0FF, which
    // no font draws.
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
    // Word's Font group: underline style, colour, size and font.
    const uv = uEl === null ? '' : (get(uEl, NS.w, 'val') ?? 'single')
    const ul = ({ double: 'double', wave: 'wave', wavyDouble: 'wave', wavyHeavy: 'wave', dotted: 'dotted', dottedHeavy: 'dotted',
      dash: 'dashed', dashLong: 'dashed', dashedHeavy: 'dashed', dashDotHeavy: 'dashed', dotDash: 'dashed', dotDotDash: 'dashed' } as Record<string, string>)[uv]
    if (ul) { marks.splice(marks.indexOf('underline'), 1); marks.push(`uline:${ul}`) }
    const col = find(rpr, NS.w, 'color')
    const cv = col === null ? '' : (get(col, NS.w, 'val') ?? '')
    if (_isHex(cv) && cv.toUpperCase() !== '000000') marks.push(`color:${cv.toUpperCase()}`)
    if (_runCtx.body) {
      const sz = find(rpr, NS.w, 'sz')
      const hp = sz === null ? 0 : Number(get(sz, NS.w, 'val') ?? 0)
      if (hp && Math.abs(hp - _runCtx.bodyHp) >= 2) marks.push(`size:${hp / 2}`)
      const f = find(rpr, NS.w, 'rFonts')
      const fam = f === null ? '' : _fontKey(get(f, NS.w, 'ascii') || get(f, NS.w, 'hAnsi') || '')
      if (fam && fam !== _runCtx.bodyFont) marks.push(`font:${fam}`)
    }
  }
  // Tracked: inside w:ins / w:del (Word's Track Changes).
  for (let up = runElem.parentNode as XElement | null; up; up = up.parentNode as XElement | null) {
    if (up.nodeType !== 1 || up.namespaceURI !== NS.w) break
    if (up.localName === 'ins' || up.localName === 'del') {
      const who = encodeURIComponent(get(up, NS.w, 'author') ?? '')
      const when = (get(up, NS.w, 'date') ?? '').replace(/Z$/, '').slice(0, 19)
      marks.push(`${up.localName}:${who}|${when}` as Mark)
      break
    }
    if (up.localName === 'p') break
  }

  return text(t, marks)
}

// A run Word highlights (w:highlight): in kTeX's nearest highlight colour.
function _highlighted(r: XElement, inline: Inline): Inline {
  const rpr = find(r, NS.w, 'rPr')
  const h = rpr === null ? null : find(rpr, NS.w, 'highlight')
  const v = h === null ? '' : (get(h, NS.w, 'val') ?? '')
  if (!v || v === 'none') return inline
  const color = /green/i.test(v) ? 'green' : /cyan|blue|turquoise/i.test(v) ? 'blue'
    : /magenta|pink|red/i.test(v) ? 'pink' : /darkYellow|orange/i.test(v) ? 'orange' : 'yellow'
  return highlight([inline], color)
}

// What the run reader needs from the document: the body text size and
// font, and whether the paragraph is body text.
const _runCtx = { bodyHp: 24, bodyFont: '', body: false }

// A Word font name as one of the fonts kTeX sets (FONT_FAMILIES), or ''.
function _fontKey(name: string): string {
  const n = name.toLowerCase()
  if (/^arial/.test(n)) return 'arial'
  if (/helvetica/.test(n)) return 'helvetica'
  if (/times/.test(n)) return 'times'
  if (/courier|consolas|menlo|monaco/.test(n)) return 'courier'
  if (/palatino|book antiqua/.test(n)) return 'palatino'
  if (/bookman/.test(n)) return 'bookman'
  if (/century gothic|avant/.test(n)) return 'avantgarde'
  if (/charter/.test(n)) return 'charter'
  return ''
}

// The Normal font (document defaults' w:rFonts), '' when it is a theme's.
function _defaultFont(styles: XElement | null): string {
  if (styles === null) return ''
  const dd = find(styles, NS.w, 'docDefaults')
  const r = dd === null ? null : find(dd, NS.w, 'rPrDefault')
  const rpr = r === null ? null : find(r, NS.w, 'rPr')
  const f = rpr === null ? null : find(rpr, NS.w, 'rFonts')
  return f === null ? '' : (get(f, NS.w, 'ascii') ?? '')
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

// --- Headers and footers ---------------------------------------------------

// A header or footer paragraph as [left, centre, right] LaTeX: its text
// split at its tabs (one part: placed by its alignment; two: left and
// right; three: left, centre, right). PAGE and NUMPAGES fields become the
// page number and page count; deleted text and drawings (a decorative
// band in a text box) are left out.
function _hfParagraph(p: XElement): [string, string, string] | null {
  const parts: string[] = ['']
  const sizes: number[] = []
  let field = '', inInstr = false, inResult = false
  const skip = (r: XElement) => {
    for (let up = r.parentNode as XElement | null; up && up !== p; up = up.parentNode as XElement | null) {
      if (up.nodeType === 1 && ['del', 'moveFrom', 'txbxContent', 'drawing', 'pict', 'AlternateContent'].includes(up.localName ?? '')) return true
    }
    return false
  }
  const simpleDone = new Set<XElement>()
  for (const r of descendants(p, NS.w, 'r')) {
    if (skip(r)) continue
    const rpr = find(r, NS.w, 'rPr')
    const par = r.parentNode as XElement
    if (par && par.localName === 'fldSimple') {
      // <w:fldSimple w:instr="PAGE">: its runs are the shown number.
      const f = (get(par, NS.w, 'instr') ?? '').trim().split(/\s+/)[0]?.toUpperCase()
      const cmd = f === 'PAGE' ? '\\thepage{}' : f === 'NUMPAGES' ? '\\pageref{LastPage}' : f === 'DATE' ? '\\today{}' : ''
      if (cmd) {
        if (!simpleDone.has(par)) parts[parts.length - 1] += cmd
        simpleDone.add(par)
        continue
      }
    }
    const inline = _runElementToInline(r)
    const marks = inline ? inline.marks : []
    for (let n = r.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue
      const e = n as XElement
      if (e.namespaceURI !== NS.w) continue
      if (e.localName === 'fldChar') {
        const t = get(e, NS.w, 'fldCharType')
        if (t === 'begin') { inInstr = true; field = '' }
        else if (t === 'separate') {
          inInstr = false; inResult = true
          const f = field.trim().split(/\s+/)[0]?.toUpperCase()
          const cmd = f === 'PAGE' ? '\\thepage{}' : f === 'NUMPAGES' ? '\\pageref{LastPage}' : f === 'DATE' ? '\\today{}' : ''
if (cmd) parts[parts.length - 1] += marks.includes('bold') ? `\\textbf{${cmd}}` : cmd
          else inResult = false  // another field: its shown text stays
        } else if (t === 'end') { inInstr = false; inResult = false }
      } else if (e.localName === 'instrText') field += lxmlText(e) ?? ''
      else if (inInstr || inResult) continue
      else if (e.localName === 'tab' || e.localName === 'ptab') parts.push('')
      else if (e.localName === 't') {
        const t = (lxmlText(e) ?? '').replace(/ {2,}/g, ' ')
        if (!t) continue
        let lt = serializeInlines([{ type: 'Text', text: t, marks: [...marks] } as Text])
        // Spaces at its ends kept ("Page " PAGE " of " NUMPAGES).
        if (/^\s/.test(t) && !/^\s/.test(lt)) lt = ' ' + lt
        if (/\s$/.test(t) && !/\s$/.test(lt)) lt += ' '
        parts[parts.length - 1] += lt
        const sz = rpr === null ? null : find(rpr, NS.w, 'sz')
        if (sz !== null && t.trim()) sizes.push(pyInt(get(sz, NS.w, 'val')))
      }
    }
  }
  const segs = parts.map((x) => x.trim()).filter((x) => x)
  if (!segs.length) return null
  let size = ''
  if (sizes.length) {
    const hp = _mostCommon(sizes)
    size = hp <= 14 ? '\\scriptsize ' : hp <= 17 ? '\\footnotesize ' : hp <= 20 ? '\\small ' : ''
  }
  const z = (x: string) => (x ? size + x : '')
  if (segs.length >= 3) return [z(segs[0]), z(segs[1]), z(segs.slice(2).join(' '))]
  if (segs.length === 2) return [z(segs[0]), '', z(segs[1])]
  const ppr = find(p, NS.w, 'pPr'), jc = ppr === null ? null : find(ppr, NS.w, 'jc')
  const a = jc === null ? '' : get(jc, NS.w, 'val') ?? ''
  return a === 'center' ? ['', z(segs[0]), ''] : a === 'right' || a === 'end' ? ['', '', z(segs[0])] : [z(segs[0]), '', '']
}

// The [left, centre, right] of a header or footer part: its paragraphs
// with text, one line each.
function _hfPart(src: Src, sect: XElement, kind: 'header' | 'footer', type: string): [string, string, string] | null {
  // A section without its own takes the one before's (Word's "Link to
  // previous").
  const all = descendants(src.part.xml!.documentElement!, NS.w, 'sectPr')
  const pick = (sp: XElement) => findall(sp, NS.w, `${kind}Reference`).find((x) => (get(x, NS.w, 'type') ?? 'default') === type)
  let ref = pick(sect)
  for (let k = all.indexOf(sect) - 1; ref === undefined && k >= 0; k--) ref = pick(all[k])
  if (ref === undefined) return null
  const rel = src.part.rels.get(get(ref, NS.r, 'id') ?? '')
  const root = rel === undefined || rel.external ? null : rel.target?.xml?.documentElement ?? null
  if (!root) return null
  const out: [string[], string[], string[]] = [[], [], []]
  const inBox = (p: XElement) => {
    for (let up = p.parentNode as XElement | null; up && up !== root; up = up.parentNode as XElement | null) {
      if (['txbxContent', 'drawing', 'pict', 'AlternateContent'].includes(up.localName ?? '')) return true
    }
    return false
  }
  for (const p of descendants(root, NS.w, 'p').filter((x) => !inBox(x))) {
    const lcr = _hfParagraph(p)
    if (lcr) lcr.forEach((x, k) => { if (x) out[k].push(x) })
  }
  return out.map((x) => x.join('\\\\')) as [string, string, string]
}

// fancyhdr lines for the section's headers and footers, or '' when Word
// has none (LaTeX's page number then stays).
export function _headerFooterLatex(src: Src, sect: XElement | null): string {
  if (sect === null) return ''
  const hasAny = descendants(src.part.xml!.documentElement!, NS.w, 'sectPr')
    .some((sp) => findall(sp, NS.w, 'headerReference').length + findall(sp, NS.w, 'footerReference').length)
  if (!hasAny) return ''
  const rows = { head: 0, foot: 0 }
  const setOf = (type: string) => {
    const h = _hfPart(src, sect, 'header', type), f = _hfPart(src, sect, 'footer', type)
    const lines: string[] = ['\\fancyhf{}']
    // Several lines, or text on both sides: each part in a box standing on
    // the header's (footer's) baseline, so it wraps and grows up as in Word.
    const boxed = (lcr: [string, string, string] | null, k: number) => {
      if (!lcr || !lcr[k]) return ''
      const multi = lcr.some((x) => x.includes('\\\\')) || lcr.filter((x) => x).length > 1
      if (!multi) return lcr[k]
      const w = lcr.filter((x) => x).length > 1 ? '0.48' : '1.0'
      const al = ['\\raggedright', '\\centering', '\\raggedleft'][k]
      return `\\parbox[b]{${w}\\textwidth}{${al} ${lcr[k]}}`
    }
    ;(['L', 'C', 'R'] as const).forEach((pos, k) => {
      if (h && h[k]) lines.push(`\\fancyhead[${pos}]{${boxed(h, k)}}`)
      if (f && f[k]) lines.push(`\\fancyfoot[${pos}]{${boxed(f, k)}}`)
    })
    const count = (lcr: [string, string, string] | null) =>
      lcr ? Math.max(...lcr.map((x) => (x ? x.split('\\\\').length : 0))) : 0
    rows.head = Math.max(rows.head, count(h)); rows.foot = Math.max(rows.foot, count(f))
    return lines
  }
  const main = setOf('default')
  const titlePg = find(sect, NS.w, 'titlePg') !== null
  const first = titlePg ? setOf('first') : main
  const all = main.concat(first).join('\n')
  if (main.length === 1 && first.length === 1) {
    // References to empty parts: Word prints nothing there.
    return '\\usepackage{fancyhdr}\n\\pagestyle{empty}'
  }
  const out = ['\\usepackage{fancyhdr}']
  if (all.includes('LastPage')) out.push('\\usepackage{lastpage}')
  // Room for a header of several lines, and a tall footer taken from the
  // text area (Word's footer grows up into the page).
  const hh = Math.max(15, 12 * rows.head + 3)
  out.push(`\\setlength{\\headheight}{${hh}pt}`, '\\renewcommand{\\headrulewidth}{0pt}')
  if (hh > 15) out.push(`\\addtolength{\\topmargin}{-${hh - 15}pt}`)
  if (rows.foot > 1) {
    // The footer hangs from the text's foot: the text shortened, the footer
    // lowered by as much, so it stays where Word puts it.
    const d = 11 * (rows.foot - 1)
    out.push(`\\addtolength{\\textheight}{-${d}pt}`, `\\addtolength{\\footskip}{${d}pt}`)
  }
  out.push('\\fancypagestyle{plain}{' + first.join('') + '}')
  out.push('\\pagestyle{fancy}', ...main)
  if (titlePg) out.push('\\AtBeginDocument{\\thispagestyle{plain}}')
  return out.join('\n')
}

// Whether Word prints a number before this heading: the paragraph, or its
// style (through basedOn), is in a numbering list. A Heading 1 with none
// (the usual case in a report or a form) prints no number, so neither
// does LaTeX.
export function _wordNumbersHeading(para: XElement, styles: XElement | null): boolean {
  const numOf = (ppr: XElement | null): boolean | null => {
    const np = ppr === null ? null : find(ppr, NS.w, 'numPr')
    if (np === null) return null
    const id = find(np, NS.w, 'numId')
    return id === null ? null : (get(id, NS.w, 'val') ?? '0') !== '0'
  }
  // A number typed before the text ("2.1\u2003Methods", as kTeX's own
  // Word export writes it): numbered.
  if (/^\s*\d+(?:\.\d+)*\.?[\u2003\t ]/.test(paragraphText(para))) return true
  const own = numOf(find(para, NS.w, 'pPr'))
  if (own !== null) return own
  if (styles === null) return true
  let id = pStyleId(para)
  for (let depth = 0; id && depth < 10; depth++) {
    const st = findall(styles, NS.w, 'style').find((x) => get(x, NS.w, 'styleId') === id)
    if (st === undefined) break
    const v = numOf(find(st, NS.w, 'pPr'))
    if (v !== null) return v
    const based = find(st, NS.w, 'basedOn')
    id = based === null ? null : get(based, NS.w, 'val')
  }
  return false
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

// Word's bullet or number format of a list (its first level): kTeX's list
// style ('' = LaTeX's default).
function _listStyle(para: XElement, src: Src, ordered: boolean): string {
  try {
    const numPr = descendants(para, NS.w, 'numPr')[0]
    const numIdEl = numPr === undefined ? null : find(numPr, NS.w, 'numId')
    if (numIdEl === null) return ''
    const numId = get(numIdEl, NS.w, 'val') ?? '0'
    const numElem = src.numberingEl()
    const num = findall(numElem, NS.w, 'num').find((n) => get(n, NS.w, 'numId') === numId)
    const absRef = num === undefined ? null : find(num, NS.w, 'abstractNumId')
    const absId = absRef === null ? null : get(absRef, NS.w, 'val')
    const abs = findall(numElem, NS.w, 'abstractNum').find((a) => get(a, NS.w, 'abstractNumId') === absId)
    if (abs === undefined) return ''
    const lvls = findall(abs, NS.w, 'lvl')
    const lvl0 = lvls.find((l) => (get(l, NS.w, 'ilvl') ?? '0') === '0')
    if (!lvl0) return ''
    const fmtEl = find(lvl0, NS.w, 'numFmt'), txtEl = find(lvl0, NS.w, 'lvlText')
    const fmt = fmtEl === null ? '' : get(fmtEl, NS.w, 'val') ?? ''
    const txt = txtEl === null ? '' : get(txtEl, NS.w, 'val') ?? ''
    if (!ordered) {
      const c = txt.codePointAt(0) ?? 0
      if (txt === 'o' || txt === '◦' || c === 0xF0A1) return 'circle'
      if (c === 0xF0A7 || c === 0xF06E || txt === '▪' || txt === '■') return 'square'
      if (txt === '–' || txt === '-' || txt === '—') return 'dash'
      if (c === 0xF0D8 || txt === '➢' || txt === '►' || txt === '▶') return 'arrow'
      if (c === 0xF0FC || txt === '✓' || txt === '✔') return 'check'
      if (c === 0xF076 || txt === '❖' || txt === '◆') return 'diamond'
      return ''
    }
    // 1. 1.1. 1.1.1.: the second level writes both numbers.
    const lvl1 = lvls.find((l) => get(l, NS.w, 'ilvl') === '1')
    const t1 = lvl1 ? (find(lvl1, NS.w, 'lvlText') ? get(find(lvl1, NS.w, 'lvlText')!, NS.w, 'val') ?? '' : '') : ''
    if (fmt === 'decimal' && /%1\.%2/.test(t1)) return 'legal'
    const paren = txt.endsWith(')')
    if (fmt === 'decimal') return paren ? 'paren' : ''
    if (fmt === 'lowerLetter') return paren ? 'alphaparen' : 'alpha'
    if (fmt === 'upperLetter') return 'Alpha'
    if (fmt === 'lowerRoman') return 'roman'
    if (fmt === 'upperRoman') return 'Roman'
  } catch {
    // no numbering part: LaTeX's default
  }
  return ''
}

// A body paragraph's own indents, shading and borders (its w:pPr), as
// kTeX's paragraph formatting.
function _paraFormat(p: XElement): ParaFormat {
  const ppr = find(p, NS.w, 'pPr')
  if (ppr === null) return {}
  const out: ParaFormat = {}
  const ind = find(ppr, NS.w, 'ind')
  if (ind !== null) {
    const cm = (k: string, k2: string) => {
      const v = Number(get(ind, NS.w, k) ?? get(ind, NS.w, k2) ?? 0)
      return v > 0 ? Math.round(v / 1440 * 2.54 * 100) / 100 : 0
    }
    const left = cm('left', 'start'), right = cm('right', 'end')
    if (left >= 0.2) out.left_cm = left
    if (right >= 0.2) out.right_cm = right
  }
  const shd = find(ppr, NS.w, 'shd')
  const fill = shd === null ? '' : get(shd, NS.w, 'fill') ?? ''
  if (_isHex(fill) && fill.toUpperCase() !== 'FFFFFF') out.shade = `#${fill.toUpperCase()}`
  const bdr = find(ppr, NS.w, 'pBdr')
  if (bdr !== null) {
    const on = (k: string) => {
      const e = find(bdr, NS.w, k)
      return e !== null && !['nil', 'none'].includes(get(e, NS.w, 'val') ?? 'nil')
    }
    const [t, b, l, r] = [on('top'), on('bottom'), on('left') || on('start'), on('right') || on('end')]
    if (l || r) out.border = 'box'
    else if (t && b) out.border = 'topbottom'
    else if (t) out.border = 'top'
    else if (b) out.border = 'bottom'
  }
  return out
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

// Paragraph.text: its w:r, w:hyperlink's w:r and w:ins's w:r children. A
// tracked insertion is text the author kept (Word shows it as an insert
// until it is accepted), so it counts; a deletion (w:delText) does not.
export function paragraphText(p: XElement): string {
  let s = ''
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue
    const e = n as XElement
    if (is(e, NS.w, 'r')) s += runText(e)
    else if (is(e, NS.w, 'hyperlink') || is(e, NS.w, 'ins')) s += findall(e, NS.w, 'r').map(runText).join('')
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

// A table laid out as a form (merged cells, coloured header bars, tick
// boxes): kept as Word draws it rather than flattened to text.
function _isFormTable(tbl: XElement): boolean {
  for (const tc of descendants(tbl, NS.w, 'tc')) {
    const pr = find(tc, NS.w, 'tcPr')
    if (pr === null) continue
    const span = find(pr, NS.w, 'gridSpan')
    if (span !== null && (_twips(get(span, NS.w, 'val')) ?? 1) > 1) return true
    if (find(pr, NS.w, 'vMerge') !== null) return true
    const shd = find(pr, NS.w, 'shd')
    const fill = shd === null ? '' : (get(shd, NS.w, 'fill') || '').toLowerCase()
    if (/^[0-9a-f]{6}$/.test(fill) && fill !== 'ffffff') return true
  }
  if (descendants(tbl, NS.w, 'checkBox').length > 0) return true
  // A box (one column, as a form's free-text answer) or cells holding
  // several paragraphs: their lines and borders kept too.
  const gridEl = find(tbl, NS.w, 'tblGrid')
  if (gridEl !== null && findall(gridEl, NS.w, 'gridCol').length === 1) return true
  return descendants(tbl, NS.w, 'tc').some((tc) => findall(tc, NS.w, 'p').filter((p) => strip(paragraphText(p))).length > 1)
}

const _isHex = (v: string) => /^[0-9A-Fa-f]{6}$/.test(v)
// A fill dark enough that Word writes automatic text on it in white.
function _isDark(fill: string): boolean {
  if (!_isHex(fill)) return false
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b < 110
}

// One cell paragraph as LaTeX: its runs in their colour, a form field's tick
// box as \square or \boxtimes, a typed-in form field's text as shown.
function _formParagraphLatex(p: XElement, dark = false): [string, number[], string] {
  let out = ''
  const sizes: number[] = []
  let inInstr = false  // between a field's begin and separate: its code, not its text
  const runs = descendants(p, NS.w, 'r')
  for (const r of runs) {
    const fc = find(r, NS.w, 'fldChar')
    if (fc !== null) {
      const t = get(fc, NS.w, 'fldCharType')
      if (t === 'begin') {
        inInstr = true
        const cb = descendants(fc, NS.w, 'checkBox')[0]
        if (cb !== undefined) {
          const ch = find(cb, NS.w, 'checked'), def = find(cb, NS.w, 'default')
          const on = ch !== null ? (get(ch, NS.w, 'val') ?? '1') !== '0' && get(ch, NS.w, 'val') !== 'false'
            : def !== null && ['1', 'true'].includes(get(def, NS.w, 'val') ?? '')
          out += on ? '$\\boxtimes$' : '$\\square$'
        }
      } else if (t === 'separate' || t === 'end') inInstr = false
      continue
    }
    if (inInstr) continue
    const inline = _runElementToInline(r)
    // A tab (alone in its run, or leading one): a gap, as Word leaves.
    const tabs = runText(r)
    if (inline === null) { if (tabs.includes('\t')) out += '\\quad '; continue }
    if (tabs.startsWith('\t')) out += '\\quad '
    inline.text = inline.text.replace(/[\t   ]/g, ' ')
    let latex = serializeInlines([inline])
    if (!latex) continue
    // A line break (Shift+Enter) in the run: a new line in the cell.
    const rt = runText(r)
    if (rt.startsWith('\n')) latex = '\\newline ' + latex
    if (rt.length > 1 && rt.endsWith('\n')) latex += '\\newline '
    const rpr = find(r, NS.w, 'rPr')
    const col = rpr === null ? null : find(rpr, NS.w, 'color')
    let cv = col === null ? '' : (get(col, NS.w, 'val') || '')
    // Word draws "automatic" text white on a dark cell.
    if (dark && !_isHex(cv)) cv = 'FFFFFF'
    // Spaces outside the colour: \color swallows a space just after it.
    if (_isHex(cv) && cv !== '000000' && latex.trim()) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(latex)!
      latex = `${m[1]}\\textcolor[HTML]{${cv.toUpperCase()}}{${m[2]}}${m[3]}`
    }
    const sz = rpr === null ? null : find(rpr, NS.w, 'sz')
    if (sz !== null) sizes.push(pyInt(get(sz, NS.w, 'val')))
    out += latex
  }
  const ppr = find(p, NS.w, 'pPr'), jc = ppr === null ? null : find(ppr, NS.w, 'jc')
  // A list item in a cell keeps its bullet.
  if (out.trim() && _paraIsList(p)) out = '\\textbullet~' + out.trim()
  return [out.replace(/ {2,}/g, ' ').trim(), sizes, jc === null ? '' : (get(jc, NS.w, 'val') || '')]
}

// A form table: every cell's paragraphs, merged cells (across and down),
// cell colours and the columns at their Word widths.
function _importFormTable(tbl: XElement, _src: Src, textEmu: number | null): Table {
  const gridEl = find(tbl, NS.w, 'tblGrid')
  const grid = gridEl === null ? [] : findall(gridEl, NS.w, 'gridCol').map((g) => _twips(get(g, NS.w, 'w')) ?? 0)
  const rows: string[][] = []
  const merges: number[][] = []
  const shading: Record<string, string> = {}
  // grid column -> [row, merge index] of the vertical merge open there.
  const openV = new Map<number, [number, number]>()
  const trs = findall(tbl, NS.w, 'tr')
  trs.forEach((tr, r) => {
    const row: string[] = []
    const gb = find(tr, NS.w, 'trPr')
    const before = gb === null ? null : find(gb, NS.w, 'gridBefore')
    for (let k = 0; k < (before === null ? 0 : _twips(get(before, NS.w, 'val')) ?? 0); k++) row.push('')
    for (const tc of findall(tr, NS.w, 'tc')) {
      const pr = find(tc, NS.w, 'tcPr')
      const spanEl = pr === null ? null : find(pr, NS.w, 'gridSpan')
      const span = Math.max(1, spanEl === null ? 1 : _twips(get(spanEl, NS.w, 'val')) ?? 1)
      const vm = pr === null ? null : find(pr, NS.w, 'vMerge')
      const vmVal = vm === null ? null : (get(vm, NS.w, 'val') || 'continue')
      const c = row.length
      if (vmVal === 'continue' && openV.has(c)) {
        merges[openV.get(c)![1]][2] += 1
        for (let k = 0; k < span; k++) row.push('')
        continue
      }
      for (let k = 0; k < span; k++) openV.delete(c + k)
      const shd = pr === null ? null : find(pr, NS.w, 'shd')
      const fill = shd === null ? '' : (get(shd, NS.w, 'fill') || '')
      const paras = findall(tc, NS.w, 'p').map((p) => _formParagraphLatex(p, _isDark(fill)))
      const sizes = paras.flatMap((x) => x[1])
      let body = paras.map((x) => x[0])
      while (body.length && !body[body.length - 1]) body.pop()
      let cell = body.map((t) => t || '~').join(' \\par ')
      // A cell whose text is all centred (or right-aligned) is set so;
      // \arraybackslash keeps the row's \\ ending the row.
      const aligns = new Set(paras.filter((x) => x[0]).map((x) => (x[2] === 'end' ? 'right' : x[2])))
      if (cell && aligns.size === 1 && aligns.has('center')) cell = `\\centering\\arraybackslash ${cell}`
      else if (cell && aligns.size === 1 && aligns.has('right')) cell = `\\raggedleft\\arraybackslash ${cell}`
      if (cell && sizes.length) {
        const hp = _mostCommon(sizes)
        if (hp <= 17) cell = `\\footnotesize ${cell}`
        else if (hp <= 20) cell = `\\small ${cell}`
      }
      if (span > 1 || vmVal === 'restart') {
        merges.push([r, c, 1, span])
        if (vmVal === 'restart') openV.set(c, [r, merges.length - 1])
      }
      if (_isHex(fill) && fill.toLowerCase() !== 'ffffff') shading[`${r},${c}`] = '#' + fill.toUpperCase()
      row.push(cell)
      for (let k = 1; k < span; k++) row.push('')
    }
    rows.push(row)
  })
  // Grid columns no row reaches (every row ends with w:gridAfter): Word
  // draws nothing there.
  const used = Math.max(0, ...rows.map((x) => x.length))
  if (used > 0 && used < grid.length) grid.length = used
  const ncols = Math.max(grid.length, ...rows.map((x) => x.length))
  for (const x of rows) while (x.length < ncols) x.push('')
  // Colour of covered cells: as their merge's first cell.
  for (const [r0, c0, rs, cs] of merges) {
    const col = shading[`${r0},${c0}`]
    if (!col) continue
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) shading[`${r0 + dr},${c0 + dc}`] = col
  }
  // Columns as wide as in Word, a share of the text width less the padding.
  const total = grid.reduce((a, b) => a + b, 0)
  const base = textEmu && total ? Math.min(1, total * 635 / textEmu) : 1
  const fracs = grid.length === ncols && total > 0
    ? grid.map((g) => g / total * base) : Array.from({ length: ncols }, () => 1 / ncols)
  const spec = fracs.map((f) => `p{\\dimexpr${pyFixed(f, 4)}\\linewidth-2\\tabcolsep\\relax}`).join('')
  return table({ rows, caption: '', label: null, alignment: spec, style: 'grid', merges, shading })
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
function _pageSetup(sect: XElement | null): [string, [number, number, number, number], boolean] | null {
  if (sect === null) return null
  const pgSz = find(sect, NS.w, 'pgSz'), pgMar = find(sect, NS.w, 'pgMar')
  if (pgSz === null || pgMar === null) return null
  let w = _twips(get(pgSz, NS.w, 'w')), h = _twips(get(pgSz, NS.w, 'h'))
  const margins = ['top', 'bottom', 'left', 'right'].map((k) => _twips(get(pgMar, NS.w, k)))
  if (w === null || h === null || margins.some((m) => m === null)) return null
  const landscape = get(pgSz, NS.w, 'orient') === 'landscape' || w > h
  ;[w, h] = [Math.min(w, h), Math.max(w, h)]
  let code = 'A4'
  if (Math.abs(w - 12240) <= 120 && Math.abs(h - 15840) <= 120) code = 'Letter'
  else if (Math.abs(w - 12240) <= 120 && Math.abs(h - 20160) <= 120) code = 'Legal'
  const cm = margins.map((m) => parseFloat(pyFixed(m! * 2.54 / 1440, 2))) as [number, number, number, number]
  return [code, cm, landscape]
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
    // A picture whose name lies (a PNG saved as .gif): its own kind.
    const lc = ext.toLowerCase()
    if (blob[0] === 0x89 && blob[1] === 0x50 && blob[2] === 0x4E && blob[3] === 0x47 && lc !== '.png') ext = '.png'
    else if (blob[0] === 0xFF && blob[1] === 0xD8 && !['.jpg', '.jpeg', '.jpe'].includes(lc)) ext = '.jpg'
    if (['.emf', '.wmf'].includes(ext.toLowerCase())) {
      // LaTeX cannot read a Windows metafile (XeTeX stops on it). One that
      // only wraps a bitmap (a pasted screenshot) becomes a PNG; any other
      // is left out.
      blob = ext.toLowerCase() === '.emf' ? _emfBitmapPng(blob) : null
      if (blob === null) continue
      ext = '.png'
    } else if (ext.toLowerCase() === '.gif') {
      // Nor GIF: its first frame becomes a PNG.
      blob = _gifPng(blob)
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
    // A PNG the engine would draw blank (palette, 1-bit, alpha): opaque RGB.
    if (blob && ext.toLowerCase() === '.png') blob = _pngOpaqueRgb(blob)
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

// The first frame of a GIF as a PNG (transparent pixels white), or null
// when it is not one.
export function _gifPng(g: Uint8Array): Uint8Array | null {
  if (g.length < 13 || String.fromCharCode(g[0], g[1], g[2]) !== 'GIF') return null
  const u16 = (i: number) => g[i] | (g[i + 1] << 8)
  const W = u16(6), H = u16(8)
  let pos = 13
  let gct: Uint8Array | null = null
  if (g[10] & 0x80) { const n = 3 << ((g[10] & 7) + 1); gct = g.subarray(pos, pos + n); pos += n }
  let trans = -1
  while (pos < g.length) {
    const b = g[pos++]
    if (b === 0x21) {  // extension
      const label = g[pos++]
      if (label === 0xF9 && g[pos] >= 4 && (g[pos + 1] & 1)) trans = g[pos + 4]
      while (pos < g.length && g[pos] !== 0) pos += g[pos] + 1
      pos++
    } else if (b === 0x2C) {  // image
      const ix = u16(pos), iy = u16(pos + 2), iw = u16(pos + 4), ih = u16(pos + 6), f = g[pos + 8]
      pos += 9
      let pal = gct
      if (f & 0x80) { const n = 3 << ((f & 7) + 1); pal = g.subarray(pos, pos + n); pos += n }
      if (pal === null) return null
      const minCode = g[pos++]
      const data: number[] = []
      while (pos < g.length && g[pos] !== 0) { const n = g[pos]; for (let k = 1; k <= n; k++) data.push(g[pos + k]); pos += n + 1 }
      // LZW
      const clear = 1 << minCode, eoi = clear + 1
      const out = new Uint8Array(iw * ih)
      let o = 0, size = minCode + 1, next = eoi + 1, prev = -1, bit = 0
      const prefix = new Int32Array(4096), suffixB = new Uint8Array(4096), first = new Uint8Array(4096)
      for (let k = 0; k < clear; k++) { prefix[k] = -1; suffixB[k] = k; first[k] = k }
      const stack = new Uint8Array(4097)
      while (o < out.length && (bit + size) <= data.length * 8) {
        let code = 0
        for (let k = 0; k < size; k++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << k
        if (code === clear) { size = minCode + 1; next = eoi + 1; prev = -1; continue }
        if (code === eoi) break
        let c = code, sp = 0
        if (prev === -1) { if (code >= clear) return null; out[o++] = code; prev = code; continue }
        if (code >= next) { stack[sp++] = first[prev]; c = prev }
        while (c >= clear) { stack[sp++] = suffixB[c]; c = prefix[c] }
        stack[sp++] = c
        if (next < 4096) { prefix[next] = prev; suffixB[next] = c; first[next] = c; next++ }
        if (next === (1 << size) && size < 12) size++
        while (sp > 0 && o < out.length) out[o++] = stack[--sp]
        prev = code
      }
      // Interlaced rows in their order.
      const rowOf = (r: number) => r
      let order: number[] = Array.from({ length: ih }, (_, r) => rowOf(r))
      if (f & 0x40) {
        order = []
        for (const [st, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = st; r < ih; r += step) order.push(r)
      }
      const raw = new Uint8Array(H * (1 + 3 * W)).fill(255)
      for (let y = 0; y < H; y++) raw[y * (1 + 3 * W)] = 0
      order.forEach((dy, k) => {
        const y = iy + dy
        if (y >= H) return
        for (let x = 0; x < iw && ix + x < W; x++) {
          const v = out[k * iw + x]
          if (v === trans) continue
          const q = y * (1 + 3 * W) + 1 + 3 * (ix + x)
          raw[q] = pal![3 * v]; raw[q + 1] = pal![3 * v + 1]; raw[q + 2] = pal![3 * v + 2]
        }
      })
      return _pngRgb(W, H, raw)
    } else return null
  }
  return null
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

// A PNG the typesetting engine draws blank: a palette or 1-bit picture (a
// QR code, a line drawing, as Word saves them), or one with an alpha
// channel. Decoded and written again as 8-bit RGB over white, which is
// what it shows on the page. A PNG already in that form, or one this
// cannot read (interlaced, 16-bit), comes back as it is.
export function _pngOpaqueRgb(png: Uint8Array): Uint8Array {
  if (png.length < 33) return png
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  if (dv.getUint32(12) !== 0x49484452) return png  // not IHDR first
  const width = dv.getUint32(16), height = dv.getUint32(20)
  const depth = png[24], ctype = png[25], interlace = png[28]
  if (ctype === 2 && depth === 8) return png
  const chans = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype]
  if (chans === undefined || interlace !== 0 || !width || !height) return png
  if (![1, 2, 4, 8].includes(depth) || (depth < 8 && chans !== 1)) return png
  let pal: Uint8Array | null = null, trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  for (let i = 8; i + 8 <= png.length;) {
    const n = dv.getUint32(i)
    const kind = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7])
    const body = png.subarray(i + 8, i + 8 + n)
    if (kind === 'PLTE') pal = body
    else if (kind === 'tRNS') trns = body
    else if (kind === 'IDAT') idat.push(body)
    else if (kind === 'IEND') break
    i += 12 + n
  }
  if (!idat.length || (ctype === 3 && pal === null)) return png
  const joined = new Uint8Array(idat.reduce((s, b) => s + b.length, 0))
  let o = 0
  for (const b of idat) { joined.set(b, o); o += b.length }
  let raw: Uint8Array
  try { raw = unzlibSync(joined) } catch { return png }
  const stride = Math.ceil(width * chans * depth / 8)
  const bpp = Math.max(1, (chans * depth) >> 3)
  if (raw.length < (stride + 1) * height) return png
  // Undo the scanline filters.
  const px = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0
      const b = y > 0 ? px[row - stride + x] : 0
      const c = y > 0 && x >= bpp ? px[row - stride + x - bpp] : 0
      let pred = 0
      if (type === 1) pred = a
      else if (type === 2) pred = b
      else if (type === 3) pred = (a + b) >> 1
      else if (type === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[row + x] = (raw[src + x] + pred) & 255
    }
  }
  // The sample at index (of the row's samples), read at its bit depth.
  const maxV = (1 << depth) - 1
  const readAt = (y: number, index: number): number => {
    if (depth === 8) return px[y * stride + index]
    const bit = index * depth
    return (px[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxV
  }
  const out = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    out[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      let r: number, g: number, bl: number, alpha = 255
      if (ctype === 3) {
        const v = readAt(y, x)
        r = pal![3 * v] ?? 0; g = pal![3 * v + 1] ?? 0; bl = pal![3 * v + 2] ?? 0
        alpha = trns && v < trns.length ? trns[v] : 255
      } else if (ctype === 0 || ctype === 4) {
        const gray = readAt(y, x * chans) * 255 / maxV
        r = g = bl = gray
        if (ctype === 4) alpha = readAt(y, x * chans + 1)
      } else {
        r = readAt(y, x * chans); g = readAt(y, x * chans + 1); bl = readAt(y, x * chans + 2)
        if (ctype === 6) alpha = readAt(y, x * chans + 3)
      }
      const mix = (c: number) => Math.round((c * alpha + 255 * (255 - alpha)) / 255)
      const at = y * (width * 3 + 1) + 1 + 3 * x
      out[at] = mix(r); out[at + 1] = mix(g); out[at + 2] = mix(bl)
    }
  }
  return _pngRgb(width, height, out)
}

// A table that holds only equations (and their "(n)" numbers), as kTeX's
// Word export lays a numbered equation or an align out: the equation, or
// null for any other table.
function equationTable(tbl: XElement): Block | null {
  const rows = descendants(tbl, NS.w, 'tr')
  if (!rows.length || descendants(tbl, NS.w, 'tbl').length) return null
  const out: { parts: string[]; num: boolean }[] = []
  for (const tr of rows) {
    const parts: string[] = []
    let num = false
    for (const tc of descendants(tr, NS.w, 'tc')) {
      const maths = descendants(tc, M_NS, 'oMath')
      const loose = descendants(tc, NS.w, 't').filter(t => !maths.some(m => m.contains(t))).map(t => t.textContent ?? '').join('').trim()
      if (loose && !/^\(\s*[\w.:-]+\s*\)$/.test(loose)) return null
      if (loose) num = true
      for (const m of maths) parts.push(ommlToLatex(m).trim())
      if (!maths.length) parts.push('')
    }
    if (!parts.some(Boolean)) return null
    out.push({ parts, num })
  }
  const anyNum = out.some(r => r.num)
  // One row, one equation: itself.
  if (out.length === 1 && out[0].parts.filter(Boolean).length === 1) {
    return mathBlock(out[0].parts.find(Boolean)!, anyNum, null)
  }
  // Rows of [left, right] (the empty side columns dropped): an align.
  const lines = out.map(r => {
    const inner = r.parts.slice(1, -1)
    const [left, right] = inner.length >= 2 ? [inner[0], inner.slice(1).join(' ')] : ['', inner[0] ?? '']
    return `  ${left} &${right ? ' ' + right : ''}${anyNum && !r.num ? ' \\nonumber' : ''}`
  })
  const env = anyNum ? 'align' : 'align*'
  return mathBlock(`\\begin{${env}}\n${lines.join(' \\\\\n')}\n\\end{${env}}`, anyNum, null)
}
