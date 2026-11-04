// The main window: menu bar, ribbon, the grey desk with the A4 page card,
// the PDF side panel and the status bar, laid out as KherveTeX's
// MainWindow in its default "PDF side panel" mode.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import pkg from '../package.json'
import { useCommandState } from './ui/commands'
import { MenuBar } from './ui/MenuBar'
import { PlaceholderPage } from './ui/PlaceholderPage'
import { Ribbon } from './ui/Ribbon'
import type { ContextKind } from './ui/ribbonModel'
import { StatusBar } from './ui/StatusBar'
import { TooltipProvider } from './ui/Tooltip'
import './App.css'

// A4 at 96 dpi.
const PAGE_W = 794
const PAGE_H = 1123
// The desk's margin around the page card.
const DESK_PAD = 23
const PDF_PAD = 7

const VERSION = pkg.version.split('.').slice(0, 2).join('.')

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export default function App() {
  const cmd = useCommandState()
  const [context, setContext] = useState<ContextKind | null>(null)
  const [dark, setDark] = useState(false)
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const [pdfManualZoom, setPdfManualZoom] = useState<number | null>(null)
  const [pdfWidth, setPdfWidth] = useState(269)
  const [deskRef, deskWidth] = useWidth<HTMLDivElement>()
  const [pdfRef, pdfInner] = useWidth<HTMLDivElement>()
  const fileName = null

  useEffect(() => {
    document.title = `KherveTeX v${VERSION} — ${fileName ?? 'Untitled'}`
  }, [fileName])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  const fitWidth = cmd.isChecked('fit_page_width')
  const fitZoom = deskWidth > 0
    ? Math.max(25, (deskWidth - 2 * DESK_PAD) / PAGE_W * 100) : 100
  const zoom = fitWidth && manualZoom === null ? fitZoom : manualZoom ?? 100
  const pdfFitZoom = pdfInner > 0
    ? Math.max(25, (pdfInner - 2 * PDF_PAD) / PAGE_W * 100) : 100
  const pdfZoom = pdfManualZoom ?? pdfFitZoom

  useEffect(() => { if (fitWidth) setManualZoom(null) }, [fitWidth])

  const dragSplitter = (e: PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const start = pdfWidth
    const move = (ev: globalThis.PointerEvent) =>
      setPdfWidth(Math.min(900, Math.max(120, start - (ev.clientX - startX))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <TooltipProvider>
      <div className='window'>
        <MenuBar cmd={cmd} />
        <Ribbon cmd={cmd} context={context} />
        <div className='workspace'>
          <div ref={deskRef} className='desk' onClick={() => setContext(null)}>
            <div className='desk-inner' style={{ padding: DESK_PAD }}>
              <div className='page-card' style={{ width: PAGE_W, height: PAGE_H, zoom: zoom / 100 }}>
                <PlaceholderPage onContext={setContext} />
              </div>
            </div>
          </div>
          <div className='splitter' onPointerDown={dragSplitter} />
          <div ref={pdfRef} className='pdf-panel' style={{ width: pdfWidth }}>
            {[0, 1].map(i => (
              <div key={i} className='pdf-page'
                style={{ width: PAGE_W, height: PAGE_H, zoom: pdfZoom / 100 }}>
                {i === 0 && <PlaceholderPage />}
              </div>
            ))}
          </div>
        </div>
        <StatusBar fileName={fileName} dark={dark} onToggleTheme={() => setDark(!dark)}
          zoom={Math.round(zoom)} onZoom={setManualZoom}
          // Qt's PDF slider keeps its own value while the page fits the width.
          pdfZoom={pdfManualZoom ?? 100} onPdfZoom={setPdfManualZoom}
          pdfFitWidth={pdfManualZoom === null} onPdfFitWidth={() => setPdfManualZoom(null)}
          showPdfZoom compiler='LaTeX (tectonic): OK' />
      </div>
    </TooltipProvider>
  )
}
