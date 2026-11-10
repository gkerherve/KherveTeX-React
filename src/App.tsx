// The main window: menu bar, ribbon, the grey desk with the A4 page card,
// the PDF side panel and the status bar, laid out as KherveTeX's
// MainWindow in its default "PDF side panel" mode.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { useCommandState } from './ui/commands'
import { MenuBar } from './ui/MenuBar'
import { useCompileUi } from './app/compile'
import { useApp } from './app/store'
import { CodeView } from './codeview/CodeView'
import { EditorPane } from './editor/EditorPane'
import { pagePx } from './editor/layout'
import { PdfPanel } from './preview/PdfPanel'
import { Ribbon } from './ui/Ribbon'
import type { ContextKind } from './ui/ribbonModel'
import { StatusBar } from './ui/StatusBar'
import { isBetaPage } from './ui/pageBeta'
import { ProjectSidebar } from './ui/ProjectSidebar'
import { session } from './app/actions/project'
import { TooltipProvider } from './ui/Tooltip'
import { useGlobalShortcuts } from './ui/globalShortcuts'
import { applyNamedTheme, useThemeName } from './app/actions/theme'
import { currentBranch, recentSnapshot, subscribeBranch, subscribeRecent } from './app/actions/file'
import { runAction } from './app/actions'
import { useDocumentsDock } from './app/actions/project'
import { editorApi } from './app/editorApi'
import { pdfApi } from './preview/PdfView'
import { loadSettings, setting, setSetting } from './platform/settings'
import './App.css'

// A4 at 96 dpi: the PDF panel's page.
const PAGE_W = 794
// The desk's margin around the page card.
const DESK_PAD = 23
const PDF_PAD = 7


// The page card's own size, before the view's scale: the outer box takes
// the scaled size so the desk scrolls over the page as it is seen.
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setSize(s => s.w === el.offsetWidth && s.h === el.offsetHeight
      ? s : { w: el.offsetWidth, h: el.offsetHeight })
    const ro = new ResizeObserver(read)
    ro.observe(el)
    read()
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

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
  const dark = useThemeName() === 'Dark'
  useGlobalShortcuts(cmd)
  const branch = useSyncExternalStore(subscribeBranch, currentBranch)
  const recent = useSyncExternalStore(subscribeRecent, recentSnapshot)
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const [pdfManualZoom, setPdfManualZoom] = useState<number | null>(null)
  const [pdfWidth, setPdfWidth] = useState(269)
  const [deskRef, deskWidth] = useWidth<HTMLDivElement>()
  const [pdfRef, pdfInner] = useWidth<HTMLDivElement>()
  const [cardRef, card] = useBoxSize<HTMLDivElement>()
  const path = useApp(s => s.path)
  const tab = useApp(s => s.tab)
  const layout = useApp(s => s.layout)
  const log = useApp(s => s.compile.log)
  const status = useApp(s => s.status)
  const compiling = useApp(s => s.compile.running)
  const compilerText = useCompileUi(u => u.statusText)
  // A project names itself and the open document (_update_title).
  const project = useApp(s => s.project)
  const docsPanel = useDocumentsDock()
  useApp(s => s.projectPath)
  useApp(s => s.chapterIndex)
  const fileName = session.titleText() ?? (path ? path.split(/[\\/]/).pop()! : null)
  const showPdf = layout === 'side'
  // The visual page is as wide as the document's paper (or its class's).
  const pageW = pagePx(useApp(s => s.doc.meta)).width
  const docClass = useApp(s => s.doc.meta.documentclass)
  const beta = useApp(s => isBetaPage(s.doc.meta.documentclass, s.example))
  const example = useApp(s => s.example)


  const fitWidth = cmd.isChecked('fit_page_width')
  const fitZoom = deskWidth > 0
    ? Math.max(25, (deskWidth - 2 * DESK_PAD) / pageW * 100) : 100
  // Fitting until a zoom of its own is set (fit turned off keeps the
  // width it fitted, below).
  const zoom = manualZoom ?? fitZoom
  const pdfFitZoom = pdfInner > 0
    ? Math.max(25, (pdfInner - 2 * PDF_PAD) / PAGE_W * 100) : 100
  const pdfZoom = pdfManualZoom ?? pdfFitZoom

  // _toggle_fit_page_width: one command fits the page and the PDF. Turned
  // on, both follow the width; turned off, both keep the zoom they show.
  const shown = useRef({ zoom, pdfZoom })
  shown.current = { zoom, pdfZoom }
  useEffect(() => {
    if (fitWidth) {
      setManualZoom(null)
      setPdfManualZoom(null)
    } else {
      setManualZoom(z => z ?? Math.round(shown.current.zoom))
      setPdfManualZoom(z => z ?? Math.round(shown.current.pdfZoom))
    }
  }, [fitWidth])
  // The PDF follows the text: scrolling the page view scrolls the PDF to
  // the page (and the height on it) the middle of the view shows.
  const [follow, setFollow] = useState(() => setting('pdf_follows_text', true))
  // The window renders before the settings are read.
  useEffect(() => { void loadSettings().then(() => setFollow(setting('pdf_follows_text', true))) }, [])
  // Scroll events come once a frame; the work is two reads and a write.
  const syncPdf = () => {
    const desk = deskRef.current
    if (!follow || !showPdf || !desk) return
    const r = desk.getBoundingClientRect()
    const spot = editorApi()?.pdfSpotAt?.(r.top + r.height / 2)
    if (spot) pdfApi()?.showSpot(spot.page, spot.frac)
  }
  const toggleFollow = () => {
    const on = !follow
    setFollow(on)
    setSetting('pdf_follows_text', on)
  }
  // Turned on, it catches up at once.
  useEffect(() => { if (follow) syncPdf() }, [follow])
  // _on_zoom_slider_changed / _nudge_zoom: zooming by hand ends fitting.
  const endFit = () => {
    if (!fitWidth) return
    cmd.setChecked('fit_page_width', false)
    setSetting('fit_page_width', false)
  }
  const zoomBy = (z: number) => { endFit(); setManualZoom(z) }
  const pdfZoomBy = (z: number) => { endFit(); setPdfManualZoom(z) }

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
          <ProjectSidebar />
          <div ref={deskRef} className='desk' hidden={tab !== 'visual'} onClick={() => setContext(null)}
            onScroll={syncPdf}>
            {beta && (
              <div className='beta-strip' role='note'>
                <span className='beta-tag'>beta</span>
                <span>
                  Page view in beta for {example && !isBetaPage(docClass, null) ? `"${example}"` : docClass}:
                  page breaks, headers and footers may differ from the PDF. The PDF is the reference.
                </span>
              </div>
            )}
            <div className='desk-inner' style={{ padding: DESK_PAD }}>
              {/* The zoom scales the laid-out page; it never lays the text out
                  again, so every zoom and window width shows the same lines
                  and the same page breaks (CSS zoom re-flowed the text at
                  each size, and rounding moved line and page breaks). */}
              <div className='page-scale' style={{ width: card.w * zoom / 100, height: card.h * zoom / 100 }}>
                <div ref={cardRef} className='page-card' style={{ transform: `scale(${zoom / 100})` }}>
                  <EditorPane onContext={setContext} />
                </div>
              </div>
            </div>
          </div>
          {tab === 'code' && <div className='code-pane'><CodeView /></div>}
          {tab === 'console' && <pre className='console-pane'>{log}</pre>}
          {showPdf && <>
            <div className='splitter' onPointerDown={dragSplitter} />
            <div ref={pdfRef} className='pdf-panel' style={{ width: pdfWidth }}>
              <PdfPanel zoom={pdfZoom} fit={fitWidth && pdfManualZoom === null} />
            </div>
          </>}
        </div>
        <StatusBar fileName={fileName} dark={dark} onToggleTheme={() => applyNamedTheme(dark ? 'Light' : 'Dark')}
          dir={session.titleText() === null && path ? path.replace(/[\\/][^\\/]*$/, '') : null}
          branch={session.titleText() === null ? branch : ''} compiling={compiling}
          zoom={Math.round(zoom)} onZoom={zoomBy}
          pdfZoom={Math.round(pdfZoom)} onPdfZoom={pdfZoomBy}
          // _pdf_fit_width_btn: the same Fit page width as View > Zoom.
          pdfFitWidth={fitWidth} onPdfFitWidth={() => cmd.trigger('fit_page_width')}
          pdfFollow={follow} onPdfFollow={toggleFollow}
          showPdfZoom compiler={compilerText} message={status}
          recent={recent} onOpenRecent={p => { void runAction('open_recent', p) }}
          docsPanel={docsPanel} onDocsPanel={project ? () => cmd.trigger('documents_dock') : undefined} />
      </div>
    </TooltipProvider>
  )
}
