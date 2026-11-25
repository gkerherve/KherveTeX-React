// The PDF preview — khervedoc/preview.py's PdfPreview over pdf.js instead
// of QPdfView: every page in a column with its shadow, live zoom or fit
// width, a status message in place of the PDF after a failed compile, and
// the "Show in Visual" / "Show in Code" right-click actions.
//
// A recompile keeps the reader's place: the page boxes stay in the column
// and each new page is drawn off-screen and swapped in, so the scroll
// position never jumps (show_pdf saved and restored the scroll bar).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { ContextMenu, type ContextMenuState } from './ContextMenu'
import { FORMS_MODE, formLayer, formWidgets, loadPdf, pageText, saveFilled, type PDFDocumentProxy, type TextRun } from './pdfjs'
import { platform } from '../platform'

// QPdfView's zoom factor 1.0 shows a page at the screen's 96 dpi.
const PX_PER_PT = 96 / 72
// The page column's padding (.pdf-panel) on each side.
const PAD = 7

interface PageBox { w: number; h: number; viewBox: number[] }
interface Highlight { page: number; x: number; y: number; w: number; h: number }

export type ShowIn = (target: 'visual' | 'code', snippet: string) => void

export interface PdfViewProps {
  pdf: Uint8Array | null
  message: string | null
  // Percent; ignored while `fit` is on.
  zoom: number
  fit: boolean
  onShowIn?: ShowIn
  // The side panel answers "Show in PDF" (find_text) and current_page().
  primary?: boolean
}

// The preview the rest of the app talks to (MainWindow._pdf_side_panel).
export interface PdfApi {
  findText(text: string): Promise<boolean>
  currentPage(): number
  pageCount(): number
  // Scroll so this point of page `page` (1-based; `frac` 0..1 down it)
  // sits in the middle of the panel: the PDF following the text.
  showSpot(page: number, frac: number): void
  // The page (1-based) the middle of the view shows and how far down it
  // (0..1): for the page view to follow the PDF.
  spotAtMiddle(): { page: number; frac: number } | null
}

// Sent when the user scrolls the PDF (the primary view).
export const PDF_SCROLLED = 'kt-pdf-scrolled'

let primaryApi: PdfApi | null = null
export function pdfApi(): PdfApi | null {
  return primaryApi
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function PdfView({ pdf, message, zoom, fit, onShowIn, primary }: PdfViewProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLElement | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [boxes, setBoxes] = useState<PageBox[]>([])
  const [width, setWidth] = useState(0)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const slots = useRef<(HTMLDivElement | null)[]>([])
  const texts = useRef(new Map<number, TextRun[]>())
  const release = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const el = anchor.current?.parentElement ?? null
    container.current = el
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Load each new PDF; the old one is released once the new one is in.
  useEffect(() => {
    let live = true
    if (!pdf) {
      setDoc(null)
      setBoxes([])
      return
    }
    void (async () => {
      try {
        const { doc: d, destroy } = await loadPdf(pdf)
        // All pages' sizes at once (one after another cost a round trip
        // to pdf.js's worker per page).
        const pages = await Promise.all(Array.from({ length: d.numPages }, (_, i) => d.getPage(i + 1)))
        const sizes: PageBox[] = pages.map(pg => { const vp = pg.getViewport({ scale: 1 }); return { w: vp.width, h: vp.height, viewBox: vp.viewBox } })
        if (!live) { destroy(); return }
        texts.current = new Map()
        setHighlight(null)
        release.current?.()
        release.current = destroy
        setDoc(d)
        setBoxes(sizes)
      } catch (e) {
        console.error('pdf.js could not open the PDF', e)
      }
    })()
    return () => { live = false }
  }, [pdf])

  useEffect(() => () => { release.current?.(); release.current = null }, [])

  // A PDF with form fields: they can be filled in here and saved.
  const [hasForm, setHasForm] = useState(false)
  useEffect(() => { setHasForm(false) }, [doc])
  const saveForm = useCallback(async () => {
    if (!doc) return
    const path = await platform().saveFileDialog({ title: 'Save filled PDF', defaultName: 'filled-form.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!path) return
    await platform().writeFile(path, await saveFilled(doc))
  }, [doc])

  const widest = boxes.reduce((m, b) => Math.max(m, b.w), 0)
  // FitToWidth: the widest page fills the column.
  const scale = fit && widest > 0 && width > 0
    ? Math.max(0.1, (width - 2 * PAD) / widest)
    : Math.max(25, Math.min(400, zoom)) / 100 * PX_PER_PT

  // Draw the pages in and near the view at the current scale, nearest
  // first; the others keep their last drawing and are drawn when scrolled
  // to (redrawing a whole thesis after each compile held up the next one).
  const drawn = useRef(new Map<number, unknown>())
  const [scrollTick, setScrollTick] = useState(0)
  useEffect(() => { drawn.current = new Map() }, [doc, scale])
  useEffect(() => {
    const el = container.current
    if (!el) return
    let raf = 0
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setScrollTick(t => t + 1) }) }
    el.addEventListener('scroll', on, { passive: true })
    return () => { el.removeEventListener('scroll', on); if (raf) cancelAnimationFrame(raf) }
  }, [])
  useEffect(() => {
    if (!doc || !boxes.length) return
    let cancelled = false
    const tasks: { cancel(): void }[] = []
    const el = container.current
    const top = el ? el.scrollTop : 0, h = el ? el.clientHeight : 800
    const mid = top + h / 2
    const near = (i: number) => {
      const s = slots.current[i]
      if (!s) return false
      return s.offsetTop + s.offsetHeight > top - h && s.offsetTop < top + 2 * h
    }
    const order = boxes.map((_, i) => i).filter(i => near(i) && drawn.current.get(i) !== doc).sort((a, b) => {
      const da = Math.abs((slots.current[a]?.offsetTop ?? 0) - mid)
      const db = Math.abs((slots.current[b]?.offsetTop ?? 0) - mid)
      return da - db
    })
    if (!order.length) return
    const ratio = window.devicePixelRatio || 1
    void (async () => {
      for (const i of order) {
        if (cancelled) return
        const slot = slots.current[i]
        if (!slot) continue
        try {
          const page = await doc.getPage(i + 1)
          const vp = page.getViewport({ scale: scale * ratio })
          // A form: its fields are drawn as inputs over the page instead.
          const widgets = await formWidgets(page).catch(() => [])
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(vp.width)
          canvas.height = Math.ceil(vp.height)
          canvas.className = 'pdf-canvas'
          canvas.style.cssText = 'display:block;width:100%;height:100%'
          const task = page.render({ canvas, viewport: vp, ...(widgets.length ? { annotationMode: FORMS_MODE } : {}) })
          tasks.push(task)
          await task.promise
          if (cancelled) return
          slot.querySelector('canvas.pdf-canvas')?.remove()
          slot.prepend(canvas)
          drawn.current.set(i, doc)
          slot.querySelector('.kt-forms')?.remove()
          if (widgets.length) {
            slot.style.setProperty('--total-scale-factor', String(scale))
            slot.style.setProperty('--scale-factor', String(scale))
            slot.style.setProperty('--scale-round-x', '1px')
            slot.style.setProperty('--scale-round-y', '1px')
            const layer = await formLayer(doc, page, widgets, scale)
            if (cancelled) return
            slot.appendChild(layer)
            setHasForm(true)
          }
        } catch {
          // A cancelled render (newer PDF or zoom) is expected.
        }
      }
    })()
    return () => {
      cancelled = true
      for (const t of tasks) t.cancel()
    }
  }, [doc, boxes, scale, scrollTick])

  const runs = useCallback(async (i: number): Promise<TextRun[]> => {
    if (!doc) return []
    let r = texts.current.get(i)
    if (!r) {
      r = await pageText(doc, i)
      texts.current.set(i, r)
    }
    return r
  }, [doc])

  const currentPage = useCallback((): number => {
    const el = container.current
    if (!el || !boxes.length) return 0
    const mid = el.scrollTop + el.clientHeight / 2
    let best = 0
    slots.current.forEach((s, i) => { if (s && s.offsetTop <= mid) best = i })
    return best
  }, [boxes])

  // PdfPreview.find_text: jump to the first match and mark it.
  const findText = useCallback(async (text: string): Promise<boolean> => {
    const want = norm(text).toLowerCase()
    if (!doc || !want) return false
    const words = want.split(' ')
    for (const needle of [want, words.slice(0, 3).join(' ')]) {
      for (let i = 0; i < boxes.length; i++) {
        const rs = (await runs(i)).filter(r => r.str.trim())
        let joined = ''
        const starts: number[] = []
        for (const r of rs) {
          if (joined) joined += ' '
          starts.push(joined.length)
          joined += norm(r.str).toLowerCase()
        }
        const at = joined.indexOf(needle)
        if (at < 0) continue
        let k = 0
        while (k + 1 < starts.length && starts[k + 1] <= at) k++
        const r = rs[k]
        const box = boxes[i]
        if (!r || !box) return false
        const hl = { page: i, x: r.x - box.viewBox[0], y: box.viewBox[3] - r.y - r.h, w: Math.max(r.w, 8), h: r.h * 1.25 }
        setHighlight(hl)
        const slot = slots.current[i]
        const el = container.current
        if (slot && el) el.scrollTop = slot.offsetTop + hl.y * scale - el.clientHeight / 3
        return true
      }
    }
    return false
  }, [doc, boxes, runs, scale])

  useEffect(() => {
    if (!primary) return
    const showSpot = (page: number, frac: number) => {
      const slot = slots.current[Math.max(0, Math.min(boxes.length - 1, page - 1))]
      const el = container.current
      if (!slot || !el) return
      el.scrollTop = Math.max(0, slot.offsetTop + frac * slot.offsetHeight - el.clientHeight / 2)
    }
    const spotAtMiddle = () => {
      const el = container.current
      if (!el || !slots.current.length) return null
      const mid = el.scrollTop + el.clientHeight / 2
      for (let i = 0; i < boxes.length; i++) {
        const s = slots.current[i]
        if (!s) continue
        if (mid < s.offsetTop + s.offsetHeight || i === boxes.length - 1) {
          return { page: i + 1, frac: Math.max(0, Math.min(1, (mid - s.offsetTop) / Math.max(1, s.offsetHeight))) }
        }
      }
      return null
    }
    const api: PdfApi = { findText, currentPage, pageCount: () => boxes.length, showSpot, spotAtMiddle }
    primaryApi = api
    const el = container.current
    const onScroll = () => window.dispatchEvent(new CustomEvent(PDF_SCROLLED))
    el?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el?.removeEventListener('scroll', onScroll)
      if (primaryApi === api) primaryApi = null
    }
  }, [primary, findText, currentPage, boxes])

  // The text line under the pointer (or the page's first line), as the
  // snippet the other views search for.
  // The click point is read before awaiting: React clears currentTarget
  // once the handler returns.
  const snippetAt = async (i: number, e: MouseEvent<HTMLDivElement>): Promise<string> => {
    const rect = e.currentTarget.getBoundingClientRect()
    const box = boxes[i]
    const px = (e.clientX - rect.left) / scale + box.viewBox[0]
    const py = box.viewBox[3] - (e.clientY - rect.top) / scale
    const rs = (await runs(i)).filter(r => r.str.trim())
    if (!rs.length) return ''
    let hit = rs.find(r => px >= r.x && px <= r.x + r.w && py >= r.y - r.h * 0.3 && py <= r.y + r.h)
    if (!hit) hit = rs.reduce((a, b) => (Math.abs(b.y - py) < Math.abs(a.y - py) ? b : a))
    const line = rs.filter(r => Math.abs(r.y - hit.y) < hit.h / 2).sort((a, b) => a.x - b.x)
    let s = norm(line.map(r => r.str).join(' '))
    // A running page number or a bare section number says nothing.
    if (/^[\divxlc.]+$/i.test(s)) s = norm(hit.str)
    s = s.replace(/^\d+(\.\d+)*\s+/, '')
    return s.length > 40 ? s.slice(0, 40).trim() : s
  }

  const onContext = (i: number) => (e: MouseEvent<HTMLDivElement>) => {
    if (!onShowIn) return
    e.preventDefault()
    const x = e.clientX
    const y = e.clientY
    const pending = snippetAt(i, e)
    setMenu({
      x, y, items: [
        { label: 'Show in Visual', run: () => void pending.then(s => onShowIn('visual', s)) },
        { label: 'Show in Code', run: () => void pending.then(s => onShowIn('code', s)) },
      ],
    })
  }

  return (
    <div ref={anchor} style={{ display: 'contents' }}>
      {message && (
        <div className='pdf-message' style={{
          alignSelf: 'stretch', margin: -PAD, marginBottom: 0, padding: 8, color: '#333', background: '#f0f0f0',
          borderBottom: '1px solid #c0c0c0', textAlign: 'center', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          font: '12px var(--ui-font)', userSelect: 'text',
        }}>{message}</div>
      )}
      {!message && hasForm && primary !== false && (
        <div className='pdf-form-bar'>
          <span>This PDF has a form: type in its fields here.</span>
          <button type='button' onClick={() => { void saveForm() }}>Save filled PDF…</button>
        </div>
      )}
      {!message && boxes.map((b, i) => (
        <div key={i} ref={el => { slots.current[i] = el }} className='pdf-page'
          style={{ position: 'relative', width: Math.round(b.w * scale), height: Math.round(b.h * scale) }}
          onContextMenu={onContext(i)}>
          {highlight?.page === i && (
            <div style={{
              position: 'absolute', left: highlight.x * scale, top: highlight.y * scale,
              width: highlight.w * scale, height: highlight.h * scale,
              background: 'rgba(255, 200, 0, 0.35)', outline: '1px solid rgba(220, 150, 0, 0.8)', pointerEvents: 'none',
            }} />
          )}
        </div>
      ))}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
