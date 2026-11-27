// Where each compiled PDF page starts, for the visual editor's page breaks
// (MainWindow._on_compile_done → set_pdf_page_count / set_page_anchors).
import { openPdfSource, type PdfTextDict } from '../core/pdfText.ts'

const NUMBER_RE = /^(\d+(\.\d+)*|[A-Z](\.\d+)+)$/
const LEADING_NUMBER_RE = /^(\d+(\.\d+)*|[A-Z](\.\d+)+)\s+(?=\S)/

// The lines of page.get_text("text"): each line's spans, block by block.
function textLines(page: PdfTextDict): string[] {
  const out: string[] = []
  for (const b of page.blocks) {
    if (b.type !== 0) continue
    for (const l of b.lines) out.push(l.spans.map(s => s.text).join(''))
  }
  return out
}

// The first printed line of a PDF page, as the editor stores it: running
// page numbers and bare section numbers are skipped, and a leading section
// number ("2.2 Lists" -> "Lists") is dropped because the editor paints
// numbers rather than storing them. Used to find where each PDF page
// starts in the editor.
export function firstTextSnippet(page: PdfTextDict, maxChars = 24): string {
  for (const raw of textLines(page)) {
    let line = raw.split(/\s+/).filter(Boolean).join(' ')
    if (!line || NUMBER_RE.test(line)) continue
    line = line.replace(LEADING_NUMBER_RE, '')
    const chars = [...line]
    if (chars.length < 3) continue
    return chars.slice(0, maxChars).join('')
  }
  return ''
}

// The first few printed lines of a page, each as firstTextSnippet makes
// it, for the editor to try in turn: the first line is often one the editor
// paints rather than stores ("Chapter 1" above the title, "Abstract", a
// running header), and the next one is the text it has. A "Label: text"
// line also offers its text alone ("Keywords: one, two" -> "one, two").
// The page's lines with a running head moved last: a first row near the top
// edge, in type no bigger than the body's, with a header's gap below it.
// A running head repeats a chapter or section title ("1 Describing Your
// Data") that would otherwise match that heading again.
function demoteRunningHead(page: PdfTextDict, all: string[]): string[] {
  const rows: { top: number; bottom: number; size: number; texts: string[] }[] = []
  const sizes: number[] = []
  for (const b of page.blocks) {
    if (b.type !== 0) continue
    for (const l of b.lines) {
      const text = l.spans.map(s => s.text).join('')
      if (!text.trim()) continue
      const size = Math.max(...l.spans.map(s => s.size))
      sizes.push(size)
      const row = rows.find(r => Math.abs(r.top - l.bbox[1]) < 2)
      if (row) { row.bottom = Math.max(row.bottom, l.bbox[3]); row.size = Math.max(row.size, size); row.texts.push(text) }
      else rows.push({ top: l.bbox[1], bottom: l.bbox[3], size, texts: [text] })
    }
  }
  if (rows.length < 3) return all
  rows.sort((a, b) => a.top - b.top)
  sizes.sort((a, b) => a - b)
  const body = sizes[Math.floor(sizes.length / 2)]
  const [head, next] = rows
  const gap = next.top - head.bottom
  const isHead = head.top < page.height * 0.12 && head.size <= body * 1.05
    && gap > Math.max(10, (head.bottom - head.top) * 1.2)
  if (!isHead) return all
  return [...all.filter(l => !head.texts.includes(l)), ...all.filter(l => head.texts.includes(l))]
}

const TOC_ENTRY_RE = /(?:\.\s?){3,}\s*\S*$|\D\s*\d+$/
const LEADER_RE = /(?:\.\s?){3,}\s*\S*$/
const LIST_TITLE_RE = /^(?:(?:table of )?contents|list of (?:figures|tables)|index|inhalt|inhaltsverzeichnis|abbildungsverzeichnis|tabellenverzeichnis|table des mati|sommaire|table des figures|liste des|[ií]ndice|sommario|elenco|содержание|оглавление|список|inhoud|spis|innehåll|indholds|sisällys|obsah)/i

export function pageStartSnippets(page: PdfTextDict, maxLines = 10, maxChars = 24): string[] {
  const out: string[] = []
  const add = (s: string) => { if (s && !out.includes(s)) out.push(s) }
  const one = (text: string) => firstTextSnippet({ width: page.width, height: page.height,
    blocks: [{ type: 0, bbox: [0, 0, 0, 0], lines: [{ bbox: [0, 0, 0, 0], spans: [{ text, size: 0, flags: 0, font: '', bbox: [0, 0, 0, 0] }] }] }] },
  maxChars)
  let count = 0
  const all = textLines(page).filter(l => l.trim())
  // A contents page (or a list of figures): many lines are entries with
  // leader dots or a page number (which may print as a line of its own).
  // Its entries name headings further on, so only its first line, the
  // title, may say where it is (none on a page that continues the list).
  const entry = (l: string) => TOC_ENTRY_RE.test(l.trim())
  const words = all.filter(l => !NUMBER_RE.test(l.trim()))
  // A table of items ending in numbers ("Item 3", "Total 45") is not one:
  // a list has leader dots, or its title on its first page.
  const dotted = words.filter(l => LEADER_RE.test(l)).length >= 2
  const titled = LIST_TITLE_RE.test(words[0]?.trim() ?? '')
  const isList = words.length >= 4 && (dotted || titled) && words.filter(entry).length >= words.length * 0.4
  const lines = isList ? all.slice(0, 1).filter(l => !entry(l)) : demoteRunningHead(page, all)
  for (const raw of lines) {
    const s = one(raw)
    if (!s) continue
    // A list item's line: its marker ("1.", "a)", "•") is painted by the
    // editor, not stored, so the line is looked for without it first.
    const item = /^(?:\d{1,3}[.)]|[a-z][.)]|[ivx]{1,5}[.)]|[•·◦▪∙–-])\s+(\S.*)$/i.exec(raw.trim())
    if (item) add(one(item[1]))
    add(s)
    const label = /^[^\s:]{2,20}:\s*(.+)$/.exec(raw.trim())
    if (label) add(one(label[1]))
    if (++count >= maxLines) break
  }
  return out
}

// One run of text near a page's top or bottom edge (where running heads,
// folios and footers print), in PDF points from the page's top left; the
// page view paints the PDF's own once it has one, so its headers and
// footers read exactly as printed (a page number that restarts after the
// front matter, a title page with none).
export interface FurnitureSpan { text: string; x: number; baseline: number; size: number; font: string; top: number; bottom: number }
export interface PageFurniture { width: number; height: number; spans: FurnitureSpan[] }

// The edge bands searched: the page view keeps what lies in its margins.
const EDGE_BAND = 0.2

export function pageFurniture(page: PdfTextDict): PageFurniture {
  const spans: FurnitureSpan[] = []
  for (const b of page.blocks) {
    if (b.type !== 0) continue
    for (const l of b.lines) {
      const [, top, , bottom] = l.bbox
      if (top > page.height * EDGE_BAND && bottom < page.height * (1 - EDGE_BAND)) continue
      for (const s of l.spans) {
        if (!s.text.trim()) continue
        spans.push({ text: s.text, x: s.bbox[0], baseline: s.origin ? s.origin[1] : s.bbox[3] - s.size * 0.22,
          size: s.size, font: s.font, top, bottom })
      }
    }
  }
  return { width: page.width, height: page.height, spans }
}

// What the PDF's type looks like: the body size (the size most characters
// are set in) and the number of columns (lines starting in each part of
// the page), so the page view can set its text as the PDF did when the
// class or its options print otherwise than the class look measured
// ([11pt]amsart, [sigconf]acmart).
export interface PdfTypography {
  bodyPt: number; cols: number; colGapPt: number
  // In columns: where each column after a page's first starts, as
  // [page + column / 10, candidate first lines] (1.1 = page 1's second
  // column), for the editor to break its columns where the PDF's do.
  columnStarts?: [number, string][]
}

// Each page's columns after the first: the lines whose left edge falls in
// that column (lines spanning the columns, as a title, left out), first by
// height, and their candidate first lines.
export function columnStarts(pages: PdfTextDict[], cols: number): [number, string][] {
  const out: [number, string][] = []
  pages.forEach((page, pi) => {
    type L = { x0: number; x1: number; y: number; line: PdfTextDict['blocks'][number]['lines'][number] }
    const lines: L[] = []
    for (const b of page.blocks) {
      if (b.type !== 0) continue
      for (const l of b.lines) {
        if (!l.spans.map(s => s.text).join('').trim()) continue
        lines.push({ x0: l.bbox[0], x1: l.bbox[2], y: l.bbox[1], line: l })
      }
    }
    const body = lines.filter(l => l.y > page.height * 0.06 && l.y < page.height * 0.93)
    if (body.length < 6) return
    const left = Math.min(...body.map(l => l.x0)), right = Math.max(...body.map(l => l.x1))
    const pitch = (right - left) / cols
    const inCol = (l: L) => (l.x1 - l.x0 > pitch * 1.15 ? -1 : Math.min(cols - 1, Math.floor((l.x0 - left + pitch * 0.08) / pitch)))
    for (let c = 1; c < cols; c++) {
      const mine = body.filter(l => inCol(l) === c).sort((a, b) => a.y - b.y || a.x0 - b.x0)
      if (!mine.length) continue
      const sub: PdfTextDict = { width: page.width, height: page.height,
        blocks: [{ type: 0, bbox: [0, 0, 0, 0], lines: mine.map(m => m.line) }] }
      const snippets = pageStartSnippets(sub)
      if (snippets.length) out.push([pi + 1 + c / 10, snippets.join('\n')])
    }
  })
  return out
}

const medianWidth = (a: { x0: number; x1: number }[]) => { const w = a.map(l => l.x1 - l.x0).sort((x, y) => x - y); return w[Math.floor(w.length / 2)] }
const sameWidth = (a: { x0: number; x1: number }[], b: { x0: number; x1: number }[]) => { const x = medianWidth(a), y = medianWidth(b); return Math.min(x, y) >= Math.max(x, y) * 0.8 }

export function pdfTypography(pages: PdfTextDict[]): PdfTypography {
  const chars = new Map<number, number>()
  const votes = [0, 0, 0, 0]
  const gaps: number[] = []
  for (const page of pages) {
    const lines: { x0: number; x1: number }[] = []
    for (const b of page.blocks) {
      if (b.type !== 0) continue
      for (const l of b.lines) {
        const text = l.spans.map(s => s.text).join('')
        if (text.trim().length < 12) continue
        lines.push({ x0: l.bbox[0], x1: l.bbox[2] })
        for (const s of l.spans) {
          const k = Math.round(s.size * 10) / 10
          chars.set(k, (chars.get(k) ?? 0) + s.text.length)
        }
      }
    }
    if (lines.length < 12) continue
    const w = page.width
    const narrow = lines.filter(l => l.x1 - l.x0 < w * 0.5)
    const left = narrow.filter(l => l.x0 < w * 0.3)
    const mid = narrow.filter(l => l.x0 >= w * 0.3 && l.x0 < w * 0.6 && l.x1 - l.x0 < w * 0.36)
    const right = narrow.filter(l => l.x0 >= w * 0.48)
    const share = (a: unknown[]) => a.length / lines.length
    let cols = 1
    if (share(left) >= 0.2 && share(right.filter(l => l.x0 >= w * 0.6)) >= 0.2 && share(mid) >= 0.2) cols = 3
    // Two columns have lines of one width; text wrapped beside a narrower
    // panel (a sidebar's wrapfigure) has wide lines on one side only.
    else if (share(left) >= 0.25 && share(right) >= 0.25 && sameWidth(left, right)) cols = 2
    votes[cols]++
    if (cols === 2) gaps.push(Math.min(...right.map(l => l.x0)) - Math.max(...left.map(l => l.x1)))
  }
  let bodyPt = 10
  let most = -1
  for (const [size, n] of chars) if (n > most) { most = n; bodyPt = size }
  const cols = votes[3] > votes[2] && votes[3] > votes[1] ? 3 : votes[2] > votes[1] ? 2 : 1
  gaps.sort((a, b) => a - b)
  return { bodyPt, cols, colGapPt: gaps.length ? Math.max(6, gaps[Math.floor(gaps.length / 2)]) : 0 }
}

// The page count and [(page_no, first text)] of every page after the
// first (page 1 has no break above it). The text is the page's candidate
// first lines (pageStartSnippets), one per line of the string. Third, each
// page's header and footer text (pageFurniture).
// Text in the page's body, not only its running head or folio (a book's
// blank left-hand page prints those).
function bodyText(page: PdfTextDict): boolean {
  for (const b of page.blocks) {
    if (b.type !== 0) continue
    for (const l of b.lines) {
      const t = l.spans.map(s => s.text).join('').trim()
      if (!t || /^([0-9]+|[ivxlcdm]+)$/i.test(t)) continue
      if (l.bbox[1] > page.height * 0.09 && l.bbox[3] < page.height * 0.91) return true
    }
  }
  return false
}

export async function pageAnchors(pdf: Uint8Array): Promise<[number, [number, string][], PageFurniture[], PdfTypography]> {
  const src = await openPdfSource(pdf)
  try {
    const anchors: [number, string][] = []
    const furniture: PageFurniture[] = []
    const dicts: PdfTextDict[] = []
    for (let i = 0; i < src.pageCount; i++) {
      const dict = await src.textDict(i)
      dicts.push(dict)
      furniture.push(pageFurniture(dict))
      if (i === 0) continue
      // Only a running head and a folio (a two-sided book's blank page): blank.
      if (!bodyText(dict)) continue
      const snippets = pageStartSnippets(dict)
      if (snippets.length) anchors.push([i + 1, snippets.join('\n')])
      // Text but no line to find it by (a contents page continued): listed
      // with no snippet, so it is not taken for a blank page.
      else anchors.push([i + 1, ''])
    }
    const typo = pdfTypography(dicts)
    if (typo.cols > 1) typo.columnStarts = columnStarts(dicts, typo.cols)
    return [src.pageCount, anchors, furniture, typo]
  } finally {
    await src.close()
  }
}
