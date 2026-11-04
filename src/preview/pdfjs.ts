// pdf.js, loaded once, with its worker bundled by Vite.
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

// pdf.js takes ownership of (detaches) the buffer it is given; the store's
// copy must stay readable for the next viewer, so it gets a copy. Returns
// the document and how to release it (the loading task owns its worker side).
export async function loadPdf(bytes: Uint8Array): Promise<{ doc: PDFDocumentProxy; destroy: () => void }> {
  const task = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await task.promise
  return { doc, destroy: () => { void task.destroy() } }
}

// One text run of a page, in PDF points (origin bottom-left).
export interface TextRun { str: string; x: number; y: number; w: number; h: number; eol: boolean }

export async function pageText(doc: PDFDocumentProxy, index: number): Promise<TextRun[]> {
  const page = await doc.getPage(index + 1)
  const tc = await page.getTextContent()
  const out: TextRun[] = []
  for (const it of tc.items) {
    if (!('str' in it)) continue
    const t = it.transform as number[]
    out.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: it.height || Math.hypot(t[2], t[3]), eol: it.hasEOL })
  }
  return out
}
