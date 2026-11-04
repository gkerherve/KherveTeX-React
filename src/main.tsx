import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initStore } from './app/store'
import { document as newDocument, paragraph } from './core/model'
import './index.css'

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
