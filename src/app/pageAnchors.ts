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

// The page count and [(page_no, first text)] of every page after the
// first (page 1 has no break above it).
export async function pageAnchors(pdf: Uint8Array): Promise<[number, [number, string][]]> {
  const src = await openPdfSource(pdf)
  try {
    const anchors: [number, string][] = []
    for (let i = 1; i < src.pageCount; i++) {
      const snippet = firstTextSnippet(await src.textDict(i))
      if (snippet) anchors.push([i + 1, snippet])
    }
    return [src.pageCount, anchors]
  } finally {
    await src.close()
  }
}
