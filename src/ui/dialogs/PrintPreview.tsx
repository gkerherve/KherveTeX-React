// File ▸ Print preview: printing.PdfPrintPreview — the compiled pages as
// they will print, opened large with the whole page in view (fit), with
// QPrintPreviewDialog's zoom, one / two pages side by side and portrait /
// landscape, and Print from there.
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from '../../preview/pdfjs'
import { openDialog } from './dialogHost'
import './printPreview.css'

function Page({ doc, index, scale, rotate }: { doc: PDFDocumentProxy, index: number, scale: number, rotate: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let task: { cancel(): void } | null = null
    void doc.getPage(index + 1).then(page => {
      if (cancelled || !ref.current) return
      const vp = page.getViewport({ scale: scale * devicePixelRatio, rotation: rotate ? 90 : 0 })
      const c = ref.current
      c.width = Math.round(vp.width)
      c.height = Math.round(vp.height)
      c.style.width = `${vp.width / devicePixelRatio}px`
      c.style.height = `${vp.height / devicePixelRatio}px`
      const t = page.render({ canvas: c, viewport: vp })
      task = t
      t.promise.catch(() => {})
    })
    return () => { cancelled = true; task?.cancel() }
  }, [doc, index, scale, rotate])
  return <canvas ref={ref} className='pp-page' />
}

function Preview({ doc, title, onPrint, close }: {
  doc: PDFDocumentProxy, title: string, onPrint: () => void, close: () => void
}) {
  const [sizes, setSizes] = useState<[number, number][]>([])
  const [zoom, setZoom] = useState<number | null>(null)
  const [facing, setFacing] = useState(false)
  // A landscape sheet turns a portrait page to fill it, as render_pdf does.
  const [landscape, setLandscape] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const [areaSize, setAreaSize] = useState<[number, number]>([800, 600])

  useEffect(() => {
    void Promise.all(Array.from({ length: doc.numPages }, (_, i) =>
      doc.getPage(i + 1).then(p => { const v = p.getViewport({ scale: 1 }); return [v.width, v.height] as [number, number] })))
      .then(s => { setSizes(s); if (s.length) setLandscape(s[0][0] > s[0][1]) })
  }, [doc])
  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(() => setAreaSize([el.clientWidth, el.clientHeight]))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [pw, ph] = sizes[0] ?? [595, 842]
  const pageLandscape = pw > ph
  const rotate = pageLandscape !== landscape
  const [sw, sh] = rotate ? [ph, pw] : [pw, ph]
  const per = facing ? 2 : 1
  const fit = Math.min((areaSize[0] - 40 - (per - 1) * 16) / (sw * per), (areaSize[1] - 40) / sh)
  const scale = zoom ?? Math.max(0.1, fit)
  const pct = Math.round(scale * 100)

  return (
    <div className='dlg dlg-print-preview' role='dialog' aria-modal='true' aria-label={title}>
      <div className='dlg-title'>{title}</div>
      <div className='pp-toolbar'>
        <button type='button' className={zoom === null ? 'on' : ''} onClick={() => setZoom(null)}>Fit page</button>
        <button type='button' onClick={() => setZoom(Math.max(0.1, scale / 1.25))}>Zoom out</button>
        <span className='pp-pct'>{pct}%</span>
        <button type='button' onClick={() => setZoom(Math.min(8, scale * 1.25))}>Zoom in</button>
        <span className='pp-sep' />
        <button type='button' className={!landscape ? 'on' : ''} onClick={() => setLandscape(false)}>Portrait</button>
        <button type='button' className={landscape ? 'on' : ''} onClick={() => setLandscape(true)}>Landscape</button>
        <span className='pp-sep' />
        <button type='button' className={!facing ? 'on' : ''} onClick={() => setFacing(false)}>Single page</button>
        <button type='button' className={facing ? 'on' : ''} onClick={() => setFacing(true)}>Facing pages</button>
        <span className='pp-sep' />
        <button type='button' onClick={onPrint}>Print…</button>
        <span className='pp-grow' />
        <button type='button' autoFocus onClick={close}>Close</button>
      </div>
      <div ref={area} className='pp-area'>
        <div className={'pp-pages' + (facing ? ' facing' : '')}>
          {sizes.map((_, i) => <Page key={i} doc={doc} index={i} scale={scale} rotate={rotate} />)}
        </div>
      </div>
    </div>
  )
}

export async function showPrintPreview(pdf: Uint8Array, title: string, onPrint: () => void): Promise<void> {
  const { loadPdf } = await import('../../preview/pdfjs')
  const { doc, destroy } = await loadPdf(pdf)
  try {
    await openDialog<void>(close => (
      <Preview doc={doc} title={title} onPrint={() => { close(null); onPrint() }} close={() => close(null)} />
    ))
  } finally {
    destroy()
  }
}
