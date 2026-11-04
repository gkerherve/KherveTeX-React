// The detached PDF window's page (index.html#pdf-window): only the preview,
// fitting its width, fed by the main window (see pdfWindow.ts).
import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri, platform } from '../platform'
import { PdfView } from './PdfView'
import { pdfWindowChannel, type PdfWindowEvent } from './pdfLink'
import '../App.css'

export function PdfWindow() {
  const [pdf, setPdf] = useState<Uint8Array | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const post = useRef<(e: PdfWindowEvent) => void>(() => {})

  useEffect(() => {
    let serial = 0
    const ch = pdfWindowChannel(async u => {
      const mine = ++serial
      document.title = u.title
      if (isTauri()) void getCurrentWindow().setTitle(u.title).catch(() => {})
      let bytes = u.pdf
      if (!bytes && u.path) {
        try { bytes = await platform().readFile(u.path) } catch { bytes = null }
      }
      if (mine !== serial) return
      setPdf(bytes)
      setMessage(bytes ? null : u.message)
    })
    post.current = ch.post
    ch.post({ kind: 'ready' })
    const closed = () => ch.post({ kind: 'closed', width: window.innerWidth, height: window.innerHeight })
    let unlisten: (() => void) | null = null
    if (isTauri()) {
      void getCurrentWindow().onCloseRequested(() => closed()).then(f => { unlisten = f })
    } else {
      window.addEventListener('beforeunload', closed)
    }
    return () => {
      ch.dispose()
      unlisten?.()
      window.removeEventListener('beforeunload', closed)
    }
  }, [])

  return (
    <div className='pdf-panel' style={{ width: '100vw', height: '100vh', boxSizing: 'border-box' }}>
      <PdfView pdf={pdf} message={message} zoom={100} fit
        onShowIn={(target, snippet) => post.current({ kind: 'show-in', target, snippet })} />
    </div>
  )
}
