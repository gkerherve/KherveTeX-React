import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { showWelcome, startFileService } from './app/actions/file'
import { startCompileService } from './app/compile'
import { initStore } from './app/store'
import { setting } from './platform/settings'
import { document as newDocument, paragraph } from './core/model'
import { PDF_WINDOW_HASH, startPdfWindowService } from './preview/pdfLink'
import { PdfWindow } from './preview/PdfWindow'
import './index.css'

if (location.hash === PDF_WINDOW_HASH) {
  // The detached PDF window (layout "window") is this page on its own.
  createRoot(document.getElementById('root')!).render(<StrictMode><PdfWindow /></StrictMode>)
} else {
  initStore({
    doc: newDocument([paragraph([])]),
    path: null, dirty: false, project: null, projectPath: null, chapterIndex: 0,
    tab: 'visual', layout: 'side', autoCompile: true,
    compile: { running: false, ok: null, log: '', pdf: null, serial: 0 },
    status: '', docSerial: 0,
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  // Settings, the command-line file and the window hooks first; then the
  // compile loop (it applies the saved layout and compiles once).
  void startFileService().then(opened => {
    startCompileService()
    startPdfWindowService()
    if (!opened && setting('show_welcome', true)) void showWelcome()
  })
}
