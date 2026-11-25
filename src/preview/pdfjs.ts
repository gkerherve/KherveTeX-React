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

// A PDF form (hyperref's fields: Admin & Office ▸ Form): its fields drawn
// over the page as real inputs (pdf.js's annotation layer), filled in the
// preview; saveFilled() gives the PDF with what was typed.
const noLinks = {
  externalLinkTarget: 0, externalLinkRel: '', externalLinkEnabled: false, isInPresentationMode: false,
  eventBus: { dispatch() {}, on() {}, off() {} },
  getDestinationHash: () => '#', getAnchorUrl: () => '#', addLinkAttributes() {}, executeNamedAction() {},
  executeSetOCGState() {}, goToDestination() {}, goToPage() {}, setHash() {},
}
let viewerCss: Promise<unknown> | null = null

export async function formWidgets(page: import('pdfjs-dist').PDFPageProxy): Promise<unknown[]> {
  const annots = await page.getAnnotations({ intent: 'display' })
  return annots.filter((a: { annotationType: number }) => a.annotationType === pdfjs.AnnotationType.WIDGET)
}

export const FORMS_MODE = pdfjs.AnnotationMode.ENABLE_FORMS

// The page's form fields as inputs, sized to `scale` CSS pixels a point.
export async function formLayer(doc: PDFDocumentProxy, page: import('pdfjs-dist').PDFPageProxy, widgets: unknown[], scale: number): Promise<HTMLDivElement> {
  viewerCss ??= import('pdfjs-dist/web/pdf_viewer.css')
  await viewerCss
  const div = document.createElement('div')
  div.className = 'annotationLayer kt-forms'
  const viewport = page.getViewport({ scale })
  const layer = new pdfjs.AnnotationLayer({
    div, accessibilityManager: null, annotationCanvasMap: null, annotationEditorUIManager: null,
    page, viewport, structTreeLayer: null, commentManager: null, linkService: noLinks, annotationStorage: doc.annotationStorage,
  })
  await layer.render({
    viewport: viewport.clone({ dontFlip: true }), div, annotations: widgets, page, linkService: noLinks as never,
    renderForms: true, annotationStorage: doc.annotationStorage, imageResourcesPath: '', enableScripting: false, hasJSActions: false,
  })
  return div
}

// The PDF with the values typed in its fields.
export async function saveFilled(doc: PDFDocumentProxy): Promise<Uint8Array> {
  return doc.saveDocument()
}
