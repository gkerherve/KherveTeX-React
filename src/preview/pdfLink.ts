// "PDF in its own window" (MainWindow.set_pdf_detached / _PdfWindow): the
// preview in a second window for a second screen. The desktop app opens a
// second Tauri window and tells it which PDF file to show; a browser opens
// a popup and posts it the bytes. Closing that window docks the PDF back
// beside the editor (_reattach_pdf_from_window).
import { emit, emitTo, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { compileUi, subscribeCompileUi } from '../app/compile'
import { appStore } from '../app/store'
import { isTauri } from '../platform'
import { setSetting, setting } from '../platform/settings'
import { setCommandChecked } from '../ui/commands'
import { showInFromPdf } from './PdfPanel'

export const PDF_WINDOW_HASH = '#pdf-window'
const LABEL = 'pdf'
const CHANNEL = 'khervetex-pdf'

// Main window → PDF window: what to show. In Tauri the PDF travels as a
// path (events are JSON); in a browser as bytes over a BroadcastChannel.
export interface PdfUpdate {
  path: string | null
  pdf: Uint8Array | null
  message: string | null
  title: string
}

// PDF window → main window.
export type PdfWindowEvent =
  | { kind: 'ready' }
  | { kind: 'closed'; width: number; height: number }
  | { kind: 'show-in'; target: 'visual' | 'code'; snippet: string }

let tauriWin: WebviewWindow | null = null
let popup: Window | null = null
let channel: BroadcastChannel | null = null
let open = false
let closingQuietly = false

function currentUpdate(): PdfUpdate {
  const s = appStore().get()
  const u = compileUi()
  return { path: s.compile.pdf ? u.pdfPath : null, pdf: s.compile.pdf, message: s.compile.pdf ? null : u.message,
    title: `${document.title} — PDF` }
}

function send(): void {
  if (!open) return
  const u = currentUpdate()
  if (isTauri()) void emitTo(LABEL, 'pdf-update', { ...u, pdf: null })
  else channel?.postMessage(u)
}

function onEvent(e: PdfWindowEvent): void {
  if (e.kind === 'ready') send()
  else if (e.kind === 'show-in') showInFromPdf(e.target, e.snippet)
  else if (e.kind === 'closed') {
    setSetting('pdf_window_geometry', [e.width, e.height])
    open = false
    tauriWin = null
    popup = null
    if (closingQuietly) { closingQuietly = false; return }
    // The window's own close button docks the panel back.
    appStore().set({ layout: 'side', autoCompile: true })
    setCommandChecked('side_by_side', true)
  }
}

let wired = false
function wire(): void {
  if (wired) return
  wired = true
  if (isTauri()) {
    void listen<PdfWindowEvent>('pdf-window', ev => onEvent(ev.payload))
  } else {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = ev => { if ((ev.data as PdfWindowEvent).kind) onEvent(ev.data as PdfWindowEvent) }
  }
  // Every finished compile, and every message, goes to the window.
  let lastSerial = appStore().get().compile.serial
  appStore().subscribe(() => {
    const s = appStore().get().compile.serial
    if (s !== lastSerial) { lastSerial = s; send() }
  })
  subscribeCompileUi(send)
}

export async function openPdfWindow(): Promise<void> {
  wire()
  if (open) return
  open = true
  const [w, h] = setting<[number, number]>('pdf_window_geometry', [760, Math.max(600, window.innerHeight)])
  const title = `${document.title} — PDF`
  if (isTauri()) {
    const existing = await WebviewWindow.getByLabel(LABEL)
    tauriWin = existing ?? new WebviewWindow(LABEL, { url: `index.html${PDF_WINDOW_HASH}`, title, width: w, height: h })
  } else {
    popup = window.open(`${location.pathname}${PDF_WINDOW_HASH}`, CHANNEL, `width=${w},height=${h}`)
    if (!popup) {
      open = false
      appStore().set({ status: 'The browser blocked the PDF window: allow pop-ups for this page' })
    }
  }
}

// close_quietly: closing from here (another layout) must not re-dock.
export async function closePdfWindow(): Promise<void> {
  if (!open) return
  closingQuietly = true
  if (tauriWin) await tauriWin.close().catch(() => {})
  else popup?.close()
  open = false
  tauriWin = null
  popup = null
}

// Follow the layout mode: "window" shows the PDF window, the rest hide it.
export function startPdfWindowService(): void {
  let layout = appStore().get().layout
  if (layout === 'window') void openPdfWindow()
  appStore().subscribe(() => {
    const l = appStore().get().layout
    if (l === layout) return
    layout = l
    if (l === 'window') void openPdfWindow()
    else void closePdfWindow()
  })
  window.addEventListener('beforeunload', () => { void closePdfWindow() })
}

// ---- the PDF window's side ----

export function pdfWindowChannel(onUpdate: (u: PdfUpdate) => void): { post(e: PdfWindowEvent): void; dispose(): void } {
  if (isTauri()) {
    const un = listen<PdfUpdate>('pdf-update', ev => onUpdate(ev.payload))
    return {
      post: e => { void emit('pdf-window', e) },
      dispose: () => { void un.then(f => f()) },
    }
  }
  const ch = new BroadcastChannel(CHANNEL)
  ch.onmessage = ev => { if ('title' in (ev.data as object)) onUpdate(ev.data as PdfUpdate) }
  return { post: e => ch.postMessage(e), dispose: () => ch.close() }
}
