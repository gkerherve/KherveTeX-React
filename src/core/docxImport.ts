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

import { figure, link, listItem, list as listNode, paragraph, section, table, text, title as titleNode,
  author as authorNode, abstract as abstractNode, document, docMeta } from './model.ts'
import type { Alignment, Block, Document, Inline, ListItem, Mark, Table, Text } from './model.ts'
import type { FileAccess } from './kdocz.ts'
import { join, suffix } from './paths.ts'
import { pyRe, reSearch, strip, zpad } from './py.ts'
import {
  CT, NS, PyError, RT, descendants, find, findall, get, is, iterChildren, localName, lxmlText,
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

  // 3. Regex-based heuristics for custom style names.
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

// core_properties.author
function coreAuthor(pkg: Package): string {
  let cp: Part
  try {
    cp = partWithReltype(pkg.rels, RT.CORE_PROPERTIES)
  } catch (e) {
    if (e instanceof PyError && e.type === 'KeyError') return ''  // CorePropertiesPart.default()
    throw e
  }
  const root = cp.contentType === CT.OPC_CORE_PROPERTIES ? cp.xml?.documentElement : null
  if (!root || !is(root, NS.cp, 'coreProperties')) throw new PyError('AttributeError', "no attribute 'core_properties'")
  const el = find(root, NS.dc, 'creator')
  if (el === null) return ''
  return lxmlText(el) ?? ''
}

// --- Main importer ---------------------------------------------------------

// Import a .docx file. Embedded images are saved to imageDir and referenced
// from Figure blocks.
//
// Recognises custom heading/title/abstract/author/subtitle/caption styles
// by name heuristics and outline level. Imports Word tables, bullet /
// numbered lists, hyperlinks, footnotes, subscript/superscript, and
// paragraph alignment.
export async function importDocx(bytes: Uint8Array, imageDir: string, fs: FileAccess): Promise<Document> {
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
  const author = coreAuthor(src.pkg) || ''

  let imageCounter = 0

  // Walk the document body in order (paragraphs *and* tables interleaved);
  // iterating the paragraphs alone silently drops tables.
  const root = src.part.xml!.documentElement!
  if (!is(root, NS.w, 'document')) throw new PyError('AttributeError', "object has no attribute 'body'")
  const body = find(root, NS.w, 'body')
  if (body === null) throw new PyError('TypeError', "'NoneType' object is not iterable")

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

  for (const childElem of iterChildren(body)) {
    const tag = localName(childElem)

    // --- Table ---
    if (tag === 'tbl') {
      flushList()
      if (is(childElem, NS.w, 'tbl')) {
        const tblNode = _importTable(childElem)
        if (tblNode !== null) children.push(tblNode)
      }
      continue
    }

    if (tag !== 'p') continue
    if (!is(childElem, NS.w, 'p')) continue
    const para = childElem

    const styleId = pStyleId(para)
    const style = paragraphStyle(styles(), styleId)
    const styleName = style ? (style.name || '') : ''
    const [kind, level] = _classifyStyle(styleName, style)

    const textRuns = _runsToInlines(para, src)

    // Detect embedded images.
    const paraImages = await _imagesInParagraph(para, src, imageDir, imageCounter, fs)
    imageCounter += paraImages.length

    if (paraImages.length) {
      flushList()
      for (const path of paraImages) {
        children.push(figure({ path: path.replaceAll('\\', '/'), caption: '', label: null }))
      }
      if (!textRuns.some((r) => r.type === 'Text' && strip(r.text))) continue
    }

    // Detect list paragraphs via numId in the XML (catches styled lists
    // like "List Paragraph" and also paragraphs with ad-hoc numbering).
    const isList = kind === 'list' || _paraIsList(para)
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
    } else if (textRuns.length) {
      children.push(paragraph(textRuns, alignment))
    }
  }

  flushList()

  return document(children, docMeta({ title, author }))
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
function _runElementToInline(runElem: XElement): Text | null {
  const textEl = find(runElem, NS.w, 't')
  if (textEl === null) return null
  const t = lxmlText(textEl)
  if (!t) return null

  const marks: Mark[] = []
  const rpr = find(runElem, NS.w, 'rPr')
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

// --- Image extraction -------------------------------------------------------

// Save any inline images referenced from this paragraph into imageDir.
// Returns the list of saved file paths in document order.
async function _imagesInParagraph(para: XElement, src: Src, imageDir: string, startIdx: number,
  fs: FileAccess): Promise<string[]> {
  const paths: string[] = []
  for (const blip of descendants(para, NS.a, 'blip')) {
    const rid = get(blip, NS.r, 'embed')
    if (!rid) continue
    const rel = src.part.rels.get(rid)
    if (rel === undefined || rel.external) continue
    const part = rel.target!
    const ext = suffix(part.partname) || '.png'
    const outPath = join(imageDir, `image_${zpad(startIdx + paths.length, 3)}${ext}`)
    await fs.write(outPath, part.blob)
    paths.push(outPath)
  }
  return paths
}
