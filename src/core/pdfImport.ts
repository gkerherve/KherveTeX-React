// The .pdf importer — a port of the PDF part of khervedoc/importers.py
// (pdf_available ... import_pdf). Python reads the page text with PyMuPDF's
// page.get_text("dict"); here pdfText.ts rebuilds that same blocks / lines /
// spans structure from pdf.js, so the structure detection below is the
// Python logic line for line and only the extraction layer differs.
//
// importPdfSource() is the logic layer: it takes any PdfSource, which is how
// the parity tests feed it the span dicts PyMuPDF itself produced.

import {
  abstract as makeAbstract, author as makeAuthor, docMeta, document as makeDocument,
  figure, keywords as makeKeywords, paragraph, section, text as makeText, title as makeTitle,
} from './model.ts'
import type { Block, Document, Inline, Mark, Text } from './model.ts'
import type { FileAccess } from './kdocz.ts'
import { join } from './paths.ts'
import { isSpace, lstrip, pyRe, pyRound, reMatch, reSearch, strip, zpad } from './py.ts'
import { openPdfSource } from './pdfText.ts'
import type { PdfJsLoader, PdfSource } from './pdfText.ts'

export type { PdfBlock, PdfImage, PdfLine, PdfPixmap, PdfSource, PdfSpan, PdfTextDict } from './pdfText.ts'

// ============================================================
//                       .pdf importer
// ============================================================

// pdf.js is bundled with the app, so the importer is always available.
export function pdfAvailable(): boolean {
  return true
}

// PyMuPDF font-flags bitmask constants.
const _PDF_FLAG_SUPERSCRIPT = 1
const _PDF_FLAG_ITALIC = 2
const _PDF_FLAG_MONOSPACE = 8
const _PDF_FLAG_BOLD = 16

// Margin zones (fraction of page height) used to strip headers / footers.
const _PDF_HEADER_ZONE = 0.06   // top 6 %
const _PDF_FOOTER_ZONE = 0.06   // bottom 6 %

// Minimum image dimension (points) — skip tiny decorative images / icons.
const _PDF_MIN_IMAGE_DIM = 50

// Journal boilerplate patterns to drop entirely.
const _PDF_BOILERPLATE_RE = pyRe(
  '('
  + 'Contents\\s+lists\\s+available\\s+at'
  + '|journal\\s+homepage\\s*:'
  + '|View\\s+Article\\s+Online'
  + '|View\\s+Journal'
  + '|Open\\s+Access\\s+Article'
  + '|This\\s+article\\s+is\\s+licensed\\s+under'
  + '|This\\s+journal\\s+is\\s+.{0,5}The\\s+Royal\\s+Society'
  + '|Cite\\s+this\\s*:'
  + '|Published\\s+on\\s+\\d'
  + '|Received\\s+\\d.*Accepted\\s+\\d'
  + '|Available\\s+online\\s+\\d'
  + '|DOI\\s*:\\s*10\\.\\d'
  + '|https?://doi\\.org/'
  + '|rsc\\.li/'
  + '|www\\.elsevier\\.com'
  + '|Elsevier\\s+[A-Z]\\.?[A-Z]?\\.?\\s+All\\s+rights'
  + '|All\\s+rights\\s+reserved'
  + '|CrossMark'
  + '|ScienceDirect'
  + '|Electronic\\s+supplementary\\s+information'
  + '|E-mail\\s+address(es)?\\s*:'
  + '|Corresponding\\s+author'
  + '|^\\s*PAPER\\s*$'
  + '|^\\s*COMMUNICATION\\s*$'
  + '|^\\s*REVIEW\\s*$'
  + '|^\\s*ARTICLE\\s*$'
  + '|^\\s*LETTER\\s*$'
  + ')',
  'i',
)

// Spaced-out label patterns (e.g. "A B S T R A C T", "A R T I C L E").
const _PDF_SPACED_ABSTRACT_RE = pyRe(
  'A\\s+B\\s+S\\s+T\\s+R\\s+A\\s+C\\s+T', 'i')
const _PDF_SPACED_ARTICLE_RE = pyRe(
  'A\\s+R\\s+T\\s+I\\s+C\\s+L\\s+E', 'i')

// Figure / table caption patterns.
const _PDF_CAPTION_RE = pyRe(
  '^(Fig\\.|Figure|Table)\\s*\\d', 'i')

// Numbered section heading patterns (e.g. "1. Introduction", "3.2. Setup").
const _PDF_NUMBERED_SECTION_RE = pyRe(
  '^(\\d+)\\.(\\d+\\.)?\\s*[A-Z]')

// Keywords label.
const _PDF_KEYWORDS_RE = pyRe('^Keywords?\\s*:', 'i')

// Return True if the block looks like rotated sidebar text — it spans
// most of the page vertically but occupies very little horizontal space.
export function _pdfIsSidebar(blkBbox: readonly number[], pageHeight: number): boolean {
  const y0 = blkBbox[1], y1 = blkBbox[3]
  const x0 = blkBbox[0], x1 = blkBbox[2]
  const height = y1 - y0
  const width = x1 - x0
  return height > pageHeight * 0.4 && width < 30
}

// str.split() with no argument: runs of Python whitespace separate words.
function pySplit(s: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of s) {
    if (isSpace(ch)) {
      if (cur) out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out
}

// Return fraction of words in *a* that also appear in *b* (case-insensitive).
export function _pdfTitleOverlap(a: string, b: string): number {
  const wa = new Set(pySplit(a.toLowerCase()))
  const wb = new Set(pySplit(b.toLowerCase()))
  if (wa.size === 0) return 0.0
  let common = 0
  for (const w of wa) if (wb.has(w)) common++
  return common / wa.size
}

// str.isdigit(): every code point a decimal digit or another Numeric_Type=Digit
// character (superscripts, subscripts, circled digits ...); false when empty.
const PY_DIGIT_RE = /^[\p{Nd}\u00b2\u00b3\u00b9\u1369-\u1371\u19da\u2070\u2074-\u2079\u2080-\u2089\u2460-\u2468\u2474-\u247c\u2488-\u2490\u24ea\u24f5-\u24fd\u24ff\u2776-\u277e\u2780-\u2788\u278a-\u2792\u{10A40}-\u{10A43}\u{1F100}-\u{1F10A}]+$/u
const pyIsdigit = (s: string): boolean => PY_DIGIT_RE.test(s)

// len() counts code points, not UTF-16 units.
const pyLen = (s: string): number => {
  let n = 0
  for (const _ of s) n++
  return n
}

const isText = (n: Inline): n is Text => n.type === 'Text'

const withoutBold = (inlines: Inline[]): void => {
  for (const inl of inlines) {
    if (isText(inl) && inl.marks.includes('bold')) {
      inl.marks = inl.marks.filter((m) => m !== 'bold')
    }
  }
}

export type PdfProgress = (page: number, total: number) => void

// Import a .pdf file into the document model.
//
// Uses pdf.js (PyMuPDF in the Python app) to extract structured text with
// font metrics for heading / bold / italic detection, and embedded images.
// Strips journal headers, footers, boilerplate, sidebar text, and affiliation
// blocks.  Detects abstract, keywords, figure/table captions, and numbered
// section headings.
//
// *progress*, if given, is called as ``progress(page, total_pages)``
// after each page.
//
// Python takes the file's path; the port takes its bytes, since file access
// is injected. Extracted images are written to *imageDir* through *fs* as
// image_000.png, image_001.png ... and the Figure paths are those joined
// paths, '/'-separated (pass the folder the document will resolve them
// against, as Python's caller does).
//
// *opts.loadPdfJs* returns the pdf.js module. The default imports
// 'pdfjs-dist', which in the browser needs GlobalWorkerOptions.workerSrc
// set first, so the app passes
//   () => import('../preview/pdfjs').then(() => import('pdfjs-dist'))
// and Node passes the legacy build ('pdfjs-dist/legacy/build/pdf.mjs').
// *opts.pdfjsOptions* go to getDocument (wasmUrl for JBIG2 / JPX images,
// cMapUrl + cMapPacked for CJK fonts).
export interface ImportPdfOptions {
  loadPdfJs?: PdfJsLoader
  pdfjsOptions?: Record<string, unknown>
}

export async function importPdf(
  bytes: Uint8Array, imageDir: string, fs: FileAccess,
  progress: PdfProgress | null = null,
  opts: ImportPdfOptions = {},
): Promise<Document> {
  const src = await openPdfSource(bytes, opts.loadPdfJs, opts.pdfjsOptions)
  return importPdfSource(src, imageDir, fs, progress)
}

// The body of import_pdf, from `src = pymupdf.open(...)` on.
export async function importPdfSource(
  src: PdfSource, imageDir: string, fs: FileAccess,
  progress: PdfProgress | null = null,
): Promise<Document> {
  const totalPages = src.pageCount

  // Read metadata early so we can use the title to de-duplicate.
  const metaInfo = src.metadata
  const metaTitle = strip(metaInfo.title || '')
  const metaAuthor = strip(metaInfo.author || '')
  const metaKeywords = strip(metaInfo.keywords || '')

  // --- First pass: determine the dominant (body) font size ---------------
  const sizeCounts = new Map<number, number>()
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageH = src.pageHeight(pageIdx)
    const td = await src.textDict(pageIdx)
    for (const blk of td.blocks ?? []) {
      if (blk.type !== 0) continue
      const bbox = blk.bbox
      if (bbox[1] < pageH * _PDF_HEADER_ZONE) continue
      if (bbox[3] > pageH * (1 - _PDF_FOOTER_ZONE)) continue
      for (const line of blk.lines ?? []) {
        for (const span of line.spans ?? []) {
          const t = strip(span.text ?? '')
          if (t) {
            const sz = pyRound(span.size, 1)
            sizeCounts.set(sz, (sizeCounts.get(sz) ?? 0) + pyLen(t))
          }
        }
      }
    }
  }
  let bodySize = 12.0
  if (sizeCounts.size) {
    // max() keeps the first key with the largest count.
    let best = -Infinity
    for (const [sz, n] of sizeCounts) {
      if (n > best) { best = n; bodySize = sz }
    }
  }

  // Heading thresholds relative to body font size.
  const _H1 = bodySize * 1.6
  const _H2 = bodySize * 1.3
  const _H3 = bodySize * 1.05

  // Font sizes below this are treated as fine-print (affiliations, dates,
  // footnotes) and skipped.
  const _FINE_PRINT = bodySize * 0.85

  let children: Block[] = []
  let imageCounter = 0
  const seenXrefs = new Set<string | number>()
  // State: blocks between "A B S T R A C T" label and first section /
  // keywords are captured as Abstract nodes.
  let inAbstractZone = false
  // True once we've seen the title-sized block on page 1 — anything
  // large-font before it is likely the journal masthead.
  let seenTitleBlock = false
  // True once we've seen an author-sized block after the title, then
  // switched to body-sized text (i.e. the abstract has started).
  let seenAuthorBlock = false
  // Track whether we've hit the first numbered section heading. Body
  // text between title/author and first section is likely abstract.
  let seenFirstSection = false

  // --- Second pass: build model blocks -----------------------------------
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageH = src.pageHeight(pageIdx)
    const td = await src.textDict(pageIdx)

    for (const blk of td.blocks ?? []) {
      if (blk.type !== 0) continue

      const bbox = blk.bbox

      // Skip header / footer zones.
      if (bbox[1] < pageH * _PDF_HEADER_ZONE) continue
      if (bbox[3] > pageH * (1 - _PDF_FOOTER_ZONE)) continue

      // Skip sidebar text (rotated CC license, etc.).
      if (_pdfIsSidebar(bbox, pageH)) continue

      // Collect all spans in the block into inline nodes.
      const blockInlines: Inline[] = []
      const blockSizes: number[] = []
      let isAllBold = true

      for (const line of blk.lines ?? []) {
        for (const span of line.spans ?? []) {
          const t = span.text ?? ''
          if (!t) continue
          const flags = span.flags ?? 0
          const sz = span.size ?? bodySize
          blockSizes.push(sz)

          const marks: Mark[] = []
          if (flags & _PDF_FLAG_BOLD) {
            marks.push('bold')
          } else {
            isAllBold = false
          }
          if (flags & _PDF_FLAG_ITALIC) marks.push('italic')
          if (flags & _PDF_FLAG_SUPERSCRIPT) marks.push('superscript')
          if (flags & _PDF_FLAG_MONOSPACE) marks.push('code')

          blockInlines.push(makeText(t, marks))
        }

        // Join lines within the same block: remove trailing hyphens
        // (word split across lines) or add a space.
        if (blockInlines.length) {
          const last = blockInlines[blockInlines.length - 1] as Text
          const lastText = last.text
          if (lastText && lastText[lastText.length - 1] === '-') {
            blockInlines[blockInlines.length - 1] = {
              text: lastText.slice(0, -1), marks: last.marks, type: 'Text',
            }
          } else if (lastText && !isSpace(lastChar(lastText))) {
            blockInlines.push(makeText(' '))
          }
        }
      }

      // Remove trailing whitespace-only nodes.
      while (blockInlines.length
             && isText(blockInlines[blockInlines.length - 1])
             && !strip((blockInlines[blockInlines.length - 1] as Text).text)) {
        blockInlines.pop()
      }

      if (!blockInlines.length) continue

      const plain = strip(blockInlines.filter(isText).map((n) => n.text).join(''))
      if (!plain) continue

      // Skip very short stray text (drop caps, lone symbols).
      if (pyLen(plain) <= 2 && !pyIsdigit(plain)) continue

      const avgSize = blockSizes.length
        ? blockSizes.reduce((a, b) => a + b, 0) / blockSizes.length
        : bodySize

      // Skip fine-print blocks (affiliations, footnotes, dates).
      if (avgSize < _FINE_PRINT) continue

      // --- Drop journal boilerplate ---
      if (reSearch(_PDF_BOILERPLATE_RE, plain)) continue

      // --- Drop blocks that duplicate the metadata title or author ---
      if (metaTitle && _pdfTitleOverlap(plain, metaTitle) > 0.7) {
        if (avgSize > bodySize * 1.1) {
          seenTitleBlock = true
          continue
        }
      }
      if (metaAuthor && _pdfTitleOverlap(plain, metaAuthor) > 0.7) continue

      // On page 1, large-font blocks that appear *before* the title
      // are likely journal mastheads (e.g. "Surface Science",
      // "Journal of Materials Chemistry A"). Only filter when we
      // have a metadata title so we can tell the title apart.
      if (pageIdx === 0 && metaTitle && !seenTitleBlock) {
        if (avgSize >= _H2) continue
      }

      // --- Drop spaced-out label lines ("A B S T R A C T" etc.) ---
      if (reMatch(_PDF_SPACED_ABSTRACT_RE, plain)) {
        inAbstractZone = true
        continue
      }
      if (reMatch(_PDF_SPACED_ARTICLE_RE, plain)) continue

      // --- Detect abstract ---
      const plainLower = plain.toLowerCase()
      if (plainLower.startsWith('abstract')) {
        const body = lstrip(strip(plain.slice('abstract'.length)), '.')
        if (body) {
          children.push(makeAbstract([makeText(body)]))
        } else {
          inAbstractZone = true
        }
        continue
      }

      // --- Detect keywords ---
      const kwM = reMatch(_PDF_KEYWORDS_RE, plain)
      if (kwM) {
        inAbstractZone = false
        const kwText = strip(plain.slice(kwM.index + kwM[0].length))
        if (kwText) children.push(makeKeywords([makeText(kwText)]))
        continue
      }

      // --- Detect figure / table captions ---
      if (reMatch(_PDF_CAPTION_RE, plain)) {
        inAbstractZone = false
        children.push(paragraph(blockInlines, 'center'))
        continue
      }

      // --- Numbered section heading (e.g. "1. Introduction") ---
      // Detected even without bold — Elsevier uses body-weight font.
      const secM = reMatch(_PDF_NUMBERED_SECTION_RE, plain)
      if (secM) {
        inAbstractZone = false
        seenFirstSection = true
        const level = secM[2] === undefined ? 1 : 2
        withoutBold(blockInlines)
        children.push(section(level, blockInlines))
        continue
      }

      // --- Classify heading vs body paragraph by font size ---
      if (avgSize >= _H1) {
        inAbstractZone = false
        seenFirstSection = true
        withoutBold(blockInlines)
        children.push(section(1, blockInlines))
      } else if (avgSize >= _H2) {
        inAbstractZone = false
        seenFirstSection = true
        withoutBold(blockInlines)
        children.push(section(2, blockInlines))
      } else if (avgSize >= _H3 && isAllBold) {
        inAbstractZone = false
        seenFirstSection = true
        withoutBold(blockInlines)
        children.push(section(3, blockInlines))
      } else if (inAbstractZone) {
        children.push(makeAbstract(blockInlines))
      } else if (!seenFirstSection && pageIdx === 0
                 && seenTitleBlock && metaTitle) {
        // On page 1, between title and first section: blocks with
        // font size above body are author lines; body-sized text
        // is the abstract.
        if (avgSize > bodySize * 1.05 && !seenAuthorBlock) {
          children.push(makeAuthor(blockInlines))
        } else if (avgSize > bodySize * 1.05 && seenAuthorBlock) {
          // Still author-sized — another author line.
          children.push(makeAuthor(blockInlines))
        } else {
          seenAuthorBlock = true
          children.push(makeAbstract(blockInlines))
        }
      } else {
        children.push(paragraph(blockInlines))
      }
    }

    // --- Extract images from this page ---------------------------------
    for (const img of await src.images(pageIdx)) {
      const xref = img.xref
      if (seenXrefs.has(xref)) continue
      seenXrefs.add(xref)
      try {
        const pix = await img.pixmap()
        if (pix.width < _PDF_MIN_IMAGE_DIM || pix.height < _PDF_MIN_IMAGE_DIM) continue
        // An alpha channel is dropped (Python converts to csRGB) inside png().
        const outPath = join(imageDir, `image_${zpad(imageCounter, 3)}.png`)
        await fs.write(outPath, pix.png())
        children.push(figure({
          path: outPath.replaceAll('\\', '/'),
          caption: '', label: null,
        }))
        imageCounter += 1
      } catch {
        continue
      }
    }

    if (progress !== null) progress(pageIdx + 1, totalPages)
  }

  await src.close()

  // --- Merge consecutive Abstract blocks into one paragraph --------------
  const merged: Block[] = []
  for (const block of children) {
    const prev = merged[merged.length - 1]
    if (block.type === 'Abstract' && prev && prev.type === 'Abstract') {
      // Append a space then the new inlines to the previous Abstract.
      prev.children.push(makeText(' '))
      prev.children.push(...block.children)
    } else {
      merged.push(block)
    }
  }
  children = merged

  // --- Merge consecutive Author blocks into one --------------------------
  const merged2: Block[] = []
  for (const block of children) {
    const prev = merged2[merged2.length - 1]
    if (block.type === 'Author' && prev && prev.type === 'Author') {
      prev.children.push(makeText(', '))
      prev.children.push(...block.children)
    } else {
      merged2.push(block)
    }
  }
  children = merged2

  // --- Add metadata-derived blocks at the top ----------------------------
  const hasBodyAuthor = children.some((c) => c.type === 'Author')
  if (metaTitle) children.splice(0, 0, makeTitle([makeText(metaTitle)]))
  if (metaAuthor && !hasBodyAuthor) {
    const idx = metaTitle ? 1 : 0
    children.splice(idx, 0, makeAuthor([makeText(metaAuthor)]))
  }

  if (metaKeywords && !children.some((c) => c.type === 'Keywords')) {
    // Insert after Author / Abstract, before first Section.
    let insertAt = children.length
    for (let j = 0; j < children.length; j++) {
      if (children[j].type === 'Section') {
        insertAt = j
        break
      }
    }
    children.splice(insertAt, 0, makeKeywords([makeText(strip(metaKeywords, '; '))]))
  }

  const meta = docMeta({ title: metaTitle, author: metaAuthor })
  // Word and PDF carry no date to print: without \date{} \maketitle
  // would put the day of the import under the title.
  if (metaTitle) meta.frontmatter_extras = '\\date{}'
  return makeDocument(children, meta)
}

// s[-1]: the last code point.
function lastChar(s: string): string {
  const cp = s.codePointAt(s.length - 1) ?? 0
  return cp >= 0xdc00 && cp <= 0xdfff && s.length > 1 ? s.slice(-2) : s.slice(-1)
}
