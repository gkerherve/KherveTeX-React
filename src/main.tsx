import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { showWelcome, startFileService } from './app/actions/file'
import { startCompileService } from './app/compile'
import { scheduleUpdates } from './app/actions/updater'
import { initStore } from './app/store'
import { startMcpIfEnabled } from './mcp/service'
import { loadSettings, setting } from './platform/settings'
import { applyPrefs } from './app/prefs'
import { startTemplatesService } from './app/actions/templates'
import { startThemeService } from './app/actions/theme'
import { startWindowService, windowRequest } from './app/actions/window'
import { document as newDocument, paragraph } from './core/model'
import { PDF_WINDOW_HASH, startPdfWindowService } from './preview/pdfLink'
import { PdfWindow } from './preview/PdfWindow'
import { installWindowFrames } from './ui/windowFrame'
import { Splash, SPLASH_HASH, splashStep } from './ui/Splash'
import './index.css'

// Every dialog moves by its title bar and resizes by its edges (QDialog).
installWindowFrames()

if (location.hash === SPLASH_HASH) {
  // The start-up splash window (tauri.conf.json): the card on a clear page.
  for (const el of [document.documentElement, document.body]) el.style.background = 'transparent'
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'
  createRoot(document.getElementById('root')!).render(<Splash />)
} else if (location.hash === PDF_WINDOW_HASH) {
  // The detached PDF window (layout "window") is this page on its own.
  createRoot(document.getElementById('root')!).render(<StrictMode><PdfWindow /></StrictMode>)
} else {
  initStore({
    doc: newDocument([paragraph([])]),
    path: null, dirty: false, project: null, projectPath: null, chapterIndex: 0,
    tab: 'visual', layout: 'side', autoCompile: true,
    compile: { running: false, ok: null, log: '', pdf: null, serial: 0 },
    status: '', docSerial: 0, example: null,
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  void splashStep('Building the window')

  // Settings, the command-line file and the window hooks first; then the
  // compile loop (it applies the saved layout and compiles once).
  // The saved theme as soon as the settings are in.
  void loadSettings().then(() => { applyPrefs(); startThemeService() })
  void startFileService().then(async opened => {
    void splashStep('Opening the document')
    startWindowService()
    if (await startTemplatesService()) opened = true
    startCompileService()
    startPdfWindowService()
    // win.start_mcp_if_enabled(): the Claude bridge, when the user left it on.
    void startMcpIfEnabled()
    // updater.schedule(): the first check a few seconds after start-up.
    void scheduleUpdates()
    // The main window appears and the splash goes (splash.finish(win)).
    await splashStep('Ready')
    // File ▸ New window starts where the app does: on the Welcome page.
    if (windowRequest()?.kind === 'new') void showWelcome()
    else if (!opened && setting('show_welcome', true)) void showWelcome()
  })
}
