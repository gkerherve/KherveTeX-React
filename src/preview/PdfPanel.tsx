// The PDF side panel (MainWindow._pdf_side_panel): the last compile's PDF
// from the store, at the status bar's zoom, or fitting the panel's width.
import { editorApi } from '../app/editorApi'
import { useCompileUi } from '../app/compile'
import { appStore, useApp } from '../app/store'
import { codeViewApi } from '../codeview/codeViewApi'
import { PdfView, type ShowIn } from './PdfView'

// MainWindow._nav_pdf_to_formatted / _nav_pdf_to_latex: the text under the
// pointer, found in the other view; the tab switches either way.
export const showInFromPdf: ShowIn = (target, snippet) => {
  if (target === 'visual') {
    if (snippet) editorApi()?.revealText(snippet)
    appStore().set({ tab: 'visual' })
  } else {
    appStore().set({ tab: 'code' })
    // The Code view mounts with the tab; search once it is there.
    if (snippet) setTimeout(() => codeViewApi()?.scrollToSnippet(snippet), 0)
  }
}

export function PdfPanel({ zoom, fit = false }: { zoom: number; pageW?: number; pageH?: number; fit?: boolean }) {
  const pdf = useApp(s => s.compile.pdf)
  const message = useCompileUi(u => u.message)
  return <PdfView pdf={pdf} message={pdf ? null : message} zoom={zoom} fit={fit} onShowIn={showInFromPdf} primary />
}
