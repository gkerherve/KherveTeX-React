// File ▸ Print and Print preview: MainWindow._pdf_for_printing, _print and
// _print_preview over printing.py. What prints is the typeset PDF, never
// the Visual tab, compiled afresh in full (the live preview may skip
// images or cover only the compile range); a project prints its last
// whole-project compile.
//
// The web view has no QPrinter: in the desktop app the PDF opens in the
// system's PDF viewer, whose Print dialog sends it to the printer at the
// paper size of the document; in a browser the browser prints it.
import { basename, join } from '../../core/paths'
import { isTauri, platform } from '../../platform'
import { critical, information } from '../../platform/MessageBox'
import { showPrintPreview } from '../../ui/dialogs/PrintPreview'
import { registerActions } from '../actions'
import { buildDir, compileUi, fullCompile } from '../compile'
import { appStore } from '../store'

let statusTimer: ReturnType<typeof setTimeout> | null = null
function showMessage(msg: string, ms = 0): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = ms ? setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, ms) : null
}

// "<name>.pdf" — the preview's title and the print job carry it.
export function printName(path: string | null): string {
  return path ? basename(path).split('.')[0] : 'document'
}

export async function pdfForPrinting(): Promise<string | null> {
  const s = appStore().get()
  if (s.project !== null) {
    const last = compileUi().pdfPath
    if (last && s.compile.ok && await platform().exists(last)) return last
    await information('Print', 'Compile the project first (Compiler > Compile PDF), then print.')
    return null
  }
  showMessage('Preparing the pages to print…')
  let result
  try {
    result = await fullCompile('print')
  } finally {
    showMessage('')
  }
  if (result === null) return null
  if (!result.ok || result.pdfPath === null) {
    await critical('Compile failed', result.error || 'Unknown error')
    return null
  }
  const named = join(join(await buildDir(), 'print'), `${printName(s.path)}.pdf`)
  if (named !== result.pdfPath) {
    await platform().writeFile(named, await platform().readFile(result.pdfPath))
  }
  return named
}

// The browser's own print of the PDF, from a hidden frame.
function printInFrame(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/pdf' }))
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.src = url
  frame.onload = () => {
    try { frame.contentWindow?.print() } catch { window.open(url, '_blank') }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60_000)
  }
  document.body.appendChild(frame)
}

export async function printPdf(pdf: string): Promise<void> {
  if (isTauri()) {
    await platform().openPath(pdf)
    showMessage(`Opened ${basename(pdf)} in the PDF viewer — print it from there`, 6000)
    return
  }
  printInFrame(await platform().readFile(pdf))
  showMessage(`Sent ${basename(pdf)} to the printer`, 4000)
}

async function print(): Promise<void> {
  const pdf = await pdfForPrinting()
  if (pdf !== null) await printPdf(pdf)
}

async function printPreview(): Promise<void> {
  const pdf = await pdfForPrinting()
  if (pdf === null) return
  const stem = basename(pdf).replace(/\.pdf$/i, '')
  await showPrintPreview(await platform().readFile(pdf), `Print Preview — ${stem}`, () => { void printPdf(pdf) })
}

registerActions({
  print: () => print(),
  print_preview: () => printPreview(),
})
