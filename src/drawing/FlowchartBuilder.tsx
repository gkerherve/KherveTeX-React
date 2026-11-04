// Flowchart builder — build a LaTeX (TikZ) flowchart by clicking.
// A port of khervedoc/flowchart_builder.py (FlowchartBuilderDialog).
//
// Like the equation builder: a palette of the classic flowchart shapes;
// clicking one adds that box after the selected one and joins them with an
// arrow, so a chart grows as fast as you can click. Drag boxes to move
// them (they snap to a grid), Ctrl/⌘-click a box to draw an arrow to it
// from the selected one, and edit the text of a box or the label of an
// arrow in the panel on the right (LaTeX maths welcome). The preview below
// it is compiled with LaTeX — exactly what lands in the document. Tidy up
// lays the chart out by itself; Show LaTeX gives the TikZ code.
//
// The model and the TikZ live in core/flowchart.ts; this is only the editor.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  autoLayout, colours, Flowchart, HEADS, KINDS, SCHEME_NAMES, SIDES, standaloneDoc, swapAxes,
  TEMPLATES, toTikz, type Edge, type Node,
} from '../core/flowchart'
import { pyRound } from '../core/py'
import { warning } from '../platform/MessageBox'
import {
  boxGeom, boxHtml, edgePoints, GX, GY, headPolygon, labelPoint, shapePathD, snapPos,
  type BoxGeom, type Pt, type Rect,
} from './flowGeometry'
import { compileToPdf, latexAvailable, pdfToCanvas } from './host'
import { openModal, type Close } from './modal'
import { showMenu, type MenuEntry } from './PopupMenu'
import './drawing.css'

export interface FlowchartResult { chart: Flowchart; pdf: Uint8Array; tikz: string }

// ------------------------------------------------------------- icons
export function KindIcon({ kind, fill = '#DEEBF7', size = 40 }: { kind: string; fill?: string; size?: number }) {
  let r: Rect = { x: 3, y: size * 0.25, w: size - 6, h: size * 0.5 }
  if (kind === 'decision') r = { x: 3, y: size * 0.15, w: size - 6, h: size * 0.7 }
  if (kind === 'connector') r = { x: size * 0.25, y: size * 0.25, w: size * 0.5, h: size * 0.5 }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <path d={shapePathD(kind, r)} fill={fill} fillRule='evenodd' stroke='#404040' strokeWidth={1.4}
        strokeDasharray={kind === 'note' ? '5.6 2.8' : undefined} />
    </svg>
  )
}

function ToolIcon({ head }: { head: string }) {
  return (
    <svg width={40} height={40} viewBox='0 0 40 40'>
      {head === 'curve'
        ? <path d='M6,30 C8,10 22,6 34,10' fill='none' stroke='#404040' strokeWidth={2} />
        : <line x1={6} y1={30} x2={34} y2={10} stroke='#404040' strokeWidth={2} />}
      {(head === 'end' || head === 'curve') && <polygon points='36,8 26,10 31,17' fill='#404040' />}
    </svg>
  )
}

// ------------------------------------------------------------- helpers
const TOOLS: [string, string, string][] = [
  ['end', 'Arrow', 'Draw an arrow: click the box it starts from, then the box it goes to'],
  ['curve', 'Curve', 'Draw a curved arrow: click the box it starts from, then the box it goes to'],
  ['none', 'Line', 'Draw a plain line between two boxes: click one, then the other'],
]
const ROUTES: [string, string][] = [['auto', 'Automatic'], ['straight', 'Straight'], ['elbow', 'Elbow'],
  ['curve', 'Curved']]

const rectUnion = (a: Rect | null, b: Rect): Rect => {
  if (!a) return b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const adjust = (r: Rect, dx1: number, dy1: number, dx2: number, dy2: number): Rect =>
  ({ x: r.x + dx1, y: r.y + dy1, w: r.w - dx1 + dx2, h: r.h - dy1 + dy2 })
const ptsBounds = (pts: Pt[]): Rect => {
  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy)
}
const inRect = (p: Pt, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
const rectsMeet = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

interface SceneSel { nodes: string[]; edges: Edge[] }

// ------------------------------------------------------------- the dialog
function FlowchartBuilderDialog({ chart, close }: { chart: Flowchart | null; close: Close<FlowchartResult> }) {
  const fcRef = useRef<Flowchart>(chart ?? TEMPLATES['Simple process']())
  const fc = fcRef.current
  const [, setTick] = useState(0)
  const redraw = useCallback(() => setTick(t => t + 1), [])
  const history = useRef<string[]>([fc.toJson()])
  const histI = useRef(0)
  const [sel, setSel] = useState<SceneSel>({ nodes: [], edges: [] })
  const [page, setPage] = useState(0)
  const [propNode, setPropNode] = useState<string | null>(null)
  const propEdge = useRef<Edge | null>(null)
  const [nodeText, setNodeText] = useState('')
  const [edgeLabel, setEdgeLabel] = useState('')
  const [status, setStatus] = useState('')
  const [showCode, setShowCode] = useState(false)
  const [tool, setToolState] = useState<string | null>(null)
  const toolFrom = useRef<string | null>(null)
  const [sceneRect, setSceneRect] = useState<Rect>({ x: -300, y: -200, w: 600, h: 400 })
  const [scale, setScale] = useState(1)
  const [drag, setDrag] = useState<Map<string, Pt> | null>(null)
  const [band, setBand] = useState<Rect | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [split, setSplit] = useState(0.6)
  const viewRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodeTextRef = useRef<HTMLInputElement>(null)
  const edgeLabelRef = useRef<HTMLInputElement>(null)
  const fillInput = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [viewSize, setViewSize] = useState({ w: 600, h: 500 })
  const paletteFills = useMemo(() => colours(fc), [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ---- preview state (refs: the worker outlives renders) ----
  const latexOk = useRef<boolean | null>(null)
  const timer = useRef<number | null>(null)
  const working = useRef(false)
  const pending = useRef(false)
  const lastPdf = useRef<{ tex: string; pdf: Uint8Array } | null>(null)
  const alive = useRef(true)
  const busy = useRef(false)

  const tex = () => standaloneDoc(fcRef.current)

  // ---- geometry of the scene ----
  const boxes = new Map<string, BoxGeom>()
  for (const n of fc.nodes) boxes.set(n.id, boxGeom(n, drag?.get(n.id)))
  const edgeGeo = fc.edges.map(e => {
    const a = boxes.get(e.src)
    const b = boxes.get(e.dst)
    return a && b ? edgePoints(e, a, b, fc.direction) : null
  })

  // The items' bounding rect, from the model as it is now (fit runs after
  // a template or a direction change replaced it).
  const itemsBounds = (): Rect => {
    const f = fcRef.current
    const bs = new Map(f.nodes.map(n => [n.id, boxGeom(n)]))
    let r: Rect | null = null
    for (const b of bs.values()) {
      r = rectUnion(r, adjust({ x: b.pos.x + b.rect.x, y: b.pos.y + b.rect.y, w: b.rect.w, h: b.rect.h }, -4, -4, 4, 4))
    }
    for (const e of f.edges) {
      const a = bs.get(e.src)
      const b = bs.get(e.dst)
      if (a && b) r = rectUnion(r, adjust(ptsBounds(edgePoints(e, a, b, f.direction)), -40, -20, 40, 20))
    }
    return r ?? { x: 0, y: 0, w: 0, h: 0 }
  }

  // ---- the view: scene rect, zoom and scrolling (QGraphicsView) ----
  const svgW = Math.max(viewSize.w, sceneRect.w * scale)
  const svgH = Math.max(viewSize.h, sceneRect.h * scale)
  const vb = {
    x: sceneRect.x - (svgW / scale - sceneRect.w) / 2,
    y: sceneRect.y - (svgH / scale - sceneRect.h) / 2,
    w: svgW / scale, h: svgH / scale,
  }
  const pendingCenter = useRef<{ p: Pt; s: number } | null>(null)
  const centerOn = (p: Pt, s = scale) => { pendingCenter.current = { p, s } }
  useLayoutEffect(() => {
    const c = pendingCenter.current
    const v = viewRef.current
    if (!c || !v) return
    pendingCenter.current = null
    const W = Math.max(v.clientWidth, sceneRect.w * c.s)
    const H = Math.max(v.clientHeight, sceneRect.h * c.s)
    const x0 = sceneRect.x - (W / c.s - sceneRect.w) / 2
    const y0 = sceneRect.y - (H / c.s - sceneRect.h) / 2
    v.scrollLeft = (c.p.x - x0) * c.s - v.clientWidth / 2
    v.scrollTop = (c.p.y - y0) * c.s - v.clientHeight / 2
  })
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    const ro = new ResizeObserver(() => setViewSize({ w: v.clientWidth, h: v.clientHeight }))
    ro.observe(v)
    return () => ro.disconnect()
  }, [])

  const toScene = (ev: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!
    const m = svg.getScreenCTM()!.inverse()
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m)
    return { x: p.x, y: p.y }
  }

  const fit = () => {
    const v = viewRef.current
    if (!v) return
    const r = adjust(itemsBounds(), -40, -40, 40, 40)
    const margin = 2
    let s = Math.min((v.clientWidth - 2 * margin) / Math.max(r.w, 1), (v.clientHeight - 2 * margin) / Math.max(r.h, 1))
    if (s > 1.2) s = 1
    setScale(s)
    centerOn({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, s)
  }
  const fitSoon = () => setTimeout(fit, 0)

  // ---- preview ----
  const startPreview = async () => {
    if (working.current) { pending.current = true; return }
    if (!fcRef.current.nodes.length) { setPreviewUrl(null); return }
    setStatus('Updating the preview…')
    working.current = true
    const t = tex()
    const { pdf, log } = await compileToPdf(t, 'khervedoc_flowprev', 'flow')
    if (alive.current) {
      if (pdf === null) {
        const errs = log.split(/\r?\n/).filter(ln => ln.startsWith('!'))
        setStatus('The chart could not be compiled: ' + (errs.length ? errs[0] : 'see the LaTeX.'))
      } else {
        lastPdf.current = { tex: t, pdf }
        const box = previewRef.current
        const target = Math.max(300, (box?.clientWidth ?? 360) * 2)
        const r = await pdfToCanvas(pdf, w => target / Math.max(1, w))
        if (r && alive.current) setPreviewUrl(r.canvas.toDataURL('image/png'))
        if (lastPdf.current.tex === tex()) setStatus('')
      }
    }
    working.current = false
    if (pending.current && alive.current) {
      pending.current = false
      void startPreview()
    }
  }
  const startRef = useRef(startPreview)
  startRef.current = startPreview

  const schedule = () => {
    const go = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { timer.current = null; void startRef.current() }, 500)
    }
    if (latexOk.current === null) {
      void latexAvailable().then(ok => {
        latexOk.current = ok
        if (ok) go()
        else setStatus('LaTeX is not available — no preview.')
      })
    } else if (latexOk.current) {
      go()
    } else {
      setStatus('LaTeX is not available — no preview.')
    }
  }

  // ---- building the editor from the model ----
  const rebuildScene = () => {
    // _rebuild: items are recreated; only the selected box stays selected.
    const selNode = selectedNodeId()
    const keep = selNode !== null && fcRef.current.node(selNode) !== null ? [selNode] : []
    setDrag(null)
    setSel({ nodes: keep, edges: [] })
    if (keep.length) onSelection({ nodes: keep, edges: [] })
    // scene rect: the items, with room to grow
    setSceneRect(adjust(itemsBounds(), -200, -150, 200, 150))
    redraw()
    schedule()
  }

  // ---- model changes (all undoable) ----
  const commit = (rebuild = true) => {
    const snap = fcRef.current.toJson()
    if (snap !== history.current[histI.current]) {
      history.current.splice(histI.current + 1)
      history.current.push(snap)
      histI.current += 1
    }
    if (rebuild) rebuildScene()
    else {
      redraw()
      schedule()
    }
  }
  const change = (fn: () => void, rebuild = true) => {
    fn()
    commit(rebuild)
  }
  const step = (delta: number) => {
    const i = histI.current + delta
    if (i >= 0 && i < history.current.length) {
      histI.current = i
      fcRef.current = Flowchart.fromJson(history.current[i])
      rebuildScene()
    }
  }

  function selectedNodeId(s: SceneSel = sel): string | null {
    return s.nodes.length ? s.nodes[0] : null
  }

  // ---- selection / properties ----
  function onSelection(s: SceneSel) {
    const f = fcRef.current
    const node = s.nodes.length ? f.node(s.nodes[0]) : null
    if (node) {
      setPropNode(node.id)
      setNodeText(node.text)
      setPage(1)
    } else if (s.edges.length) {
      const e = s.edges[0]
      propEdge.current = e
      setEdgeLabel(e.label)
      setPage(2)
    } else {
      setPage(0)
    }
  }
  const select = (s: SceneSel) => {
    setSel(s)
    onSelection(s)
  }

  const add = (kind: string) => {
    let after = selectedNodeId()
    const f = fcRef.current
    if (after === null && f.nodes.length) after = f.nodes[f.nodes.length - 1].id
    const n = f.add(kind, '', after)
    commit()
    select({ nodes: [n.id], edges: [] })
    setTimeout(() => {
      // view.ensureVisible + focus the text field
      const v = viewRef.current
      const b = boxGeom(n)
      if (v) {
        const left = (b.pos.x - vb.x) * scale
        const top = (b.pos.y - vb.y) * scale
        if (left - 104 < v.scrollLeft) v.scrollLeft = left - 104
        if (left + 104 > v.scrollLeft + v.clientWidth) v.scrollLeft = left + 104 - v.clientWidth
        if (top - 72 < v.scrollTop) v.scrollTop = top - 72
        if (top + 72 > v.scrollTop + v.clientHeight) v.scrollTop = top + 72 - v.clientHeight
      }
      nodeTextRef.current?.focus()
      nodeTextRef.current?.select()
    }, 0)
  }

  const connectTo = (target: string) => {
    const src = selectedNodeId()
    if (src === null) {
      select({ nodes: [target], edges: [] })
      return
    }
    if (fcRef.current.connect(src, target) !== null) {
      commit()
      setStatus('Arrow added. Select it to give it a label.')
    }
  }

  // ---- Arrow / Line tools ----
  const setTool = (head: string, on: boolean) => {
    const t = on ? head : null
    setToolState(t)
    toolFrom.current = null
    const kind = ({ end: 'an arrow', curve: 'a curve' } as Record<string, string>)[head] ?? 'a line'
    setStatus(on ? `Click the box ${kind} starts from…` : '')
  }
  const toolClick = (nid: string | null) => {
    if (tool === null) return
    if (nid === null) {                       // empty space: cancel
      setTool(tool, false)
      return
    }
    if (toolFrom.current === null) {
      toolFrom.current = nid
      select({ nodes: [nid], edges: [] })
      setStatus('…then the box it goes to.')
      return
    }
    const e = fcRef.current.connect(toolFrom.current, nid)
    if (e !== null) {
      if (tool === 'curve') {
        e.head = 'end'
        e.route = 'curve'
      } else {
        e.head = tool
      }
      commit()
    }
    toolFrom.current = null
    const kind = ({ end: 'arrow', curve: 'curve' } as Record<string, string>)[tool] ?? 'line'
    setStatus(`Done. Click the box the next ${kind} starts from, or empty space to stop.`)
  }

  const deleteSelected = () => {
    const f = fcRef.current
    let changed = false
    for (const id of sel.nodes) {
      f.remove(id)
      changed = true
    }
    for (const e of sel.edges) {
      const i = f.edges.indexOf(e)
      if (i >= 0) {
        f.edges.splice(i, 1)
        changed = true
      }
    }
    if (changed) {
      setSel({ nodes: [], edges: [] })
      commit()
    }
  }

  const applyTemplate = (name: string) => {
    if (!name) return
    fcRef.current = TEMPLATES[name]()
    commit()
    fitSoon()
  }

  const setDirection = (d: string) => {
    if (d === fcRef.current.direction) return
    change(() => {
      fcRef.current.direction = d
      swapAxes(fcRef.current)               // turn the chart round
    })
    fitSoon()
  }

  const setNode = (kw: Partial<Node>) => {
    const nid = selectedNodeId()
    if (nid) {
      Object.assign(fcRef.current.node(nid)!, kw)
      commit()
    }
  }
  const setEdge = (kw: Partial<Edge>) => {
    const e = propEdge.current
    if (e !== null && fcRef.current.edges.includes(e)) {
      Object.assign(e, kw)
      commit()
    }
  }
  const reverseEdge = () => {
    const e = propEdge.current
    if (e !== null && fcRef.current.edges.includes(e)) {
      [e.src, e.dst] = [e.dst, e.src];
      [e.src_side, e.dst_side] = [e.dst_side, e.src_side]
      commit()
    }
  }

  const editItem = (target: { node?: string; edge?: Edge }) => {
    if (target.node) select({ nodes: [target.node], edges: [] })
    else if (target.edge) select({ nodes: [], edges: [target.edge] })
    setTimeout(() => {
      const el = target.node ? nodeTextRef.current : edgeLabelRef.current
      el?.focus()
      el?.select()
    }, 0)
  }

  // ---- mouse on the scene ----
  const hit = (p: Pt): { node?: string; edge?: Edge } | null => {
    const f = fcRef.current
    for (let i = f.nodes.length - 1; i >= 0; i--) {        // boxes are on top
      const b = boxes.get(f.nodes[i].id)!
      if (inRect(p, { x: b.pos.x + b.rect.x, y: b.pos.y + b.rect.y, w: b.rect.w, h: b.rect.h })) {
        return { node: f.nodes[i].id }
      }
    }
    for (let i = f.edges.length - 1; i >= 0; i--) {
      const pts = edgeGeo[i]
      if (!pts) continue
      for (let j = 1; j < pts.length; j++) {
        if (segDist(p, pts[j - 1], pts[j]) <= 5) {          // a 10 px stroke
          return { edge: f.edges[i] }
        }
      }
    }
    return null
  }

  const press = useRef<{ start: Pt; item: { node?: string; edge?: Edge } | null; moved: boolean; origin: Map<string, Pt> } | null>(null)

  const onMouseDown = (ev: React.MouseEvent) => {
    viewRef.current?.focus()
    if (ev.button !== 0) return
    const p = toScene(ev)
    const item = hit(p)
    if (tool !== null) {
      toolClick(item?.node ?? null)
      return
    }
    if ((ev.ctrlKey || ev.metaKey) && item?.node) {
      connectTo(item.node)
      return
    }
    let s = sel
    if (item?.node) {
      if (!sel.nodes.includes(item.node)) {
        s = { nodes: [item.node], edges: [] }
        select(s)
      }
    } else if (item?.edge) {
      if (!sel.edges.includes(item.edge)) {
        s = { nodes: [], edges: [item.edge] }
        select(s)
      }
    } else {
      s = { nodes: [], edges: [] }
      select(s)
    }
    const origin = new Map<string, Pt>()
    for (const id of s.nodes) origin.set(id, boxes.get(id)!.pos)
    press.current = { start: p, item, moved: false, origin }
    if (!item) setBand({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onMouseMove = (ev: React.MouseEvent) => {
    const pr = press.current
    if (!pr) return
    const p = toScene(ev)
    if (!pr.item) {
      const r = { x: Math.min(pr.start.x, p.x), y: Math.min(pr.start.y, p.y),
        w: Math.abs(p.x - pr.start.x), h: Math.abs(p.y - pr.start.y) }
      setBand(r)
      const f = fcRef.current
      const nodes = f.nodes.filter(n => {
        const b = boxes.get(n.id)!
        return rectsMeet(r, { x: b.pos.x + b.rect.x, y: b.pos.y + b.rect.y, w: b.rect.w, h: b.rect.h })
      }).map(n => n.id)
      const edges = f.edges.filter((_e, i) => {
        const pts = edgeGeo[i]
        if (!pts) return false
        for (let j = 1; j < pts.length; j++) {
          for (let k = 0; k <= 8; k++) {
            const t = k / 8
            const q = { x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t }
            if (inRect(q, r)) return true
          }
        }
        return false
      })
      setSel({ nodes, edges })
      return
    }
    if (!pr.item.node) return
    const dx = p.x - pr.start.x
    const dy = p.y - pr.start.y
    if (!pr.moved && Math.hypot(dx, dy) * scale < 2) return
    pr.moved = true
    const m = new Map<string, Pt>()
    for (const [id, o] of pr.origin) m.set(id, snapPos({ x: o.x + dx, y: o.y + dy }))
    setDrag(m)
  }

  const onMouseUp = () => {
    const pr = press.current
    press.current = null
    if (!pr) return
    if (!pr.item) {
      setBand(null)
      onSelection(sel)
      return
    }
    if (pr.item.node && pr.moved && drag) {
      let changed = false
      for (const [id, pos] of drag) {
        const n = fcRef.current.node(id)
        if (!n) continue
        const x = pyRound(pos.x / GX, 3)
        const y = pyRound(pos.y / GY, 3)
        if (x !== pyRound(n.x, 3) || y !== pyRound(n.y, 3)) {
          n.x = x
          n.y = y
          changed = true
        }
      }
      setDrag(null)
      if (changed) commit(false)
      return
    }
    if (!pr.moved && (sel.nodes.length + sel.edges.length) > 1) {
      // a click on one of several selected items selects only it
      select(pr.item.node ? { nodes: [pr.item.node], edges: [] } : { nodes: [], edges: [pr.item.edge!] })
    }
  }

  const onDoubleClick = (ev: React.MouseEvent) => {
    if (tool !== null) return
    const item = hit(toScene(ev))
    if (item) editItem(item)
  }

  const onWheel = (ev: React.WheelEvent) => {
    const v = viewRef.current
    if (!v) return
    const f = ev.deltaY < 0 ? 1.15 : 1 / 1.15
    const p = toScene(ev)
    const s = scale * f
    // keep the point under the mouse (AnchorUnderMouse)
    const r = v.getBoundingClientRect()
    setScale(s)
    pendingCenter.current = null
    requestAnimationFrame(() => {
      const W = Math.max(v.clientWidth, sceneRect.w * s)
      const H = Math.max(v.clientHeight, sceneRect.h * s)
      const x0 = sceneRect.x - (W / s - sceneRect.w) / 2
      const y0 = sceneRect.y - (H / s - sceneRect.h) / 2
      v.scrollLeft = (p.x - x0) * s - (ev.clientX - r.left)
      v.scrollTop = (p.y - y0) * s - (ev.clientY - r.top)
    })
  }

  const onContextMenu = (ev: React.MouseEvent) => {
    ev.preventDefault()
    const item = hit(toScene(ev))
    const entries: MenuEntry[] = []
    if (item?.node) {
      const nid = item.node
      select({ nodes: [nid], edges: [] })
      const setKind = (k: string) => {
        Object.assign(fcRef.current.node(nid)!, { kind: k })
        commit()
      }
      entries.push({ label: 'Change shape', sub: Object.entries(KINDS).map(([k, [label]]) =>
        ({ label, icon: <KindIcon kind={k} size={18} />, action: () => setKind(k) })) })
      entries.push({ label: 'Edit text', action: () => editItem(item) })
      entries.push({ label: 'Delete', action: () => {
        fcRef.current.remove(nid)
        setSel({ nodes: [], edges: [] })
        commit()
      } })
    } else if (item?.edge) {
      const e = item.edge
      select({ nodes: [], edges: [e] })
      propEdge.current = e
      const set = (kw: Partial<Edge>) => { Object.assign(e, kw); commit() }
      entries.push({ label: 'Label…', action: () => editItem(item) })
      entries.push({ label: 'Route', sub: ROUTES.map(([k, label]) =>
        ({ label, checked: e.route === k, action: () => set({ route: k }) })) })
      entries.push({ label: 'Arrowheads', sub: Object.entries(HEADS).map(([k, [label]]) =>
        ({ label, checked: e.head === k, action: () => set({ head: k }) })) })
      entries.push({ label: 'Reverse direction', action: reverseEdge })
      entries.push({ label: 'Delete', action: () => {
        const i = fcRef.current.edges.indexOf(e)
        if (i >= 0) fcRef.current.edges.splice(i, 1)
        setSel({ nodes: [], edges: [] })
        commit()
      } })
    } else {
      for (const [k, [label]] of Object.entries(KINDS)) {
        entries.push({ label: `Add ${label.toLowerCase()}`, icon: <KindIcon kind={k} size={18} />, action: () => add(k) })
      }
      entries.push('-')
      entries.push({ label: 'Tidy up', action: () => change(() => autoLayout(fcRef.current)) })
    }
    void showMenu(entries, ev.clientX, ev.clientY)
  }

  // ---- insert ----
  const insert = async () => {
    const f = fcRef.current
    if (!f.nodes.length) { close(null); return }
    const t = tex()
    if (lastPdf.current === null || lastPdf.current.tex !== t) {
      // The preview is behind: compile now (keeping the UI alive).
      busy.current = true
      document.body.style.cursor = 'wait'
      const { pdf } = await compileToPdf(t, 'khervedoc_flowfinal', 'flow')
      document.body.style.cursor = ''
      busy.current = false
      if (pdf === null) {
        await warning('Flowchart', 'The chart could not be compiled.')
        return
      }
      lastPdf.current = { tex: t, pdf }
    }
    close({ chart: f, pdf: lastPdf.current.pdf, tikz: toTikz(f) })
  }

  // ---- lifecycle ----
  useEffect(() => {
    rebuildScene()
    fitSoon()
    return () => {
      alive.current = false
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const typing = (ev.target as HTMLElement).tagName === 'INPUT' || (ev.target as HTMLElement).tagName === 'SELECT'
    const mod = ev.ctrlKey || ev.metaKey
    if (ev.key === 'Escape') { ev.stopPropagation(); close(null); return }
    if (!typing && mod && (ev.key === 'z' || ev.key === 'Z') && !ev.shiftKey) { ev.preventDefault(); step(-1); return }
    if (!typing && mod && (ev.key === 'y' || ev.key === 'Y')) { ev.preventDefault(); step(1); return }
    if (ev.key === 'Enter' && !typing && !busy.current) { ev.preventDefault(); void insert() }
  }

  const onViewKey = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault()
      deleteSelected()
    }
  }

  // ---- render ----
  const cols = colours(fc)
  const pn = propNode !== null ? fc.node(propNode) : null
  const pe = propEdge.current
  const gridLines: ReactNode[] = []
  {
    let x = Math.floor(vb.x / (GX / 2)) * (GX / 2)
    while (x < vb.x + vb.w) {
      gridLines.push(<line key={`x${x}`} x1={x} y1={vb.y} x2={x} y2={vb.y + vb.h} />)
      x += GX / 2
    }
    let y = Math.floor(vb.y / (GY / 2)) * (GY / 2)
    while (y < vb.y + vb.h) {
      gridLines.push(<line key={`y${y}`} x1={vb.x} y1={y} x2={vb.x + vb.w} y2={y} />)
      y += GY / 2
    }
  }

  return (
    <div className='kd-dialog' style={{ width: 1240, height: 780 }} onKeyDown={onKeyDown}>
      <div className='kd-titlebar'>Flowchart builder</div>
      <div className='kd-body'>
        {/* --- top bar --- */}
        <div className='kd-row'>
          <span>Start from:</span>
          <select style={{ width: 180 }} value='' onChange={e => applyTemplate(e.target.value)}>
            <option value=''>—</option>
            {Object.keys(TEMPLATES).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span style={{ marginLeft: 10 }}>Direction:</span>
          <select value={fc.direction} onChange={e => setDirection(e.target.value)}>
            <option value='TB'>Top to bottom</option>
            <option value='LR'>Left to right</option>
          </select>
          <span style={{ marginLeft: 10 }}>Colours:</span>
          <select style={{ width: 104 }} value={SCHEME_NAMES.includes(fc.scheme) ? fc.scheme : SCHEME_NAMES[0]}
            onChange={e => change(() => { fcRef.current.scheme = e.target.value })}>
            {SCHEME_NAMES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ marginLeft: 10 }}>Text:</span>
          <span className='kd-row' style={{ gap: 2 }}>
            <input type='number' min={6} max={24} style={{ width: 64 }} value={fc.font_pt}
              onChange={e => {
                const v = Math.max(6, Math.min(24, Math.round(Number(e.target.value) || 6)))
                change(() => { fcRef.current.font_pt = v })
              }} />
            <span>pt</span>
          </span>
          <button type='button' className='kd-btn' style={{ marginLeft: 10 }} title='Lay the chart out automatically'
            onClick={() => change(() => autoLayout(fcRef.current))}>✨ Tidy up</button>
          <span className='kd-stretch' />
          <button type='button' className='kd-tb' title='Undo (Ctrl+Z)' onClick={() => step(-1)}>↶</button>
          <button type='button' className='kd-tb' title='Redo (Ctrl+Y)' onClick={() => step(1)}>↷</button>
        </div>

        {/* --- shape palette --- */}
        <div className='kd-row' style={{ gap: 4 }}>
          {Object.entries(KINDS).map(([kind, [label]]) => (
            <button key={kind} type='button' className='kd-tb' style={{ minWidth: 92 }}
              title={`Add a “${label}” box after the selected one, joined by an arrow`}
              onClick={() => add(kind)}>
              <KindIcon kind={kind} fill={paletteFills[kind][0]} />
              <span className='kd-tb-label'>{label}</span>
            </button>
          ))}
          <span style={{ width: 12 }} />
          {TOOLS.map(([head, text, tip]) => (
            <button key={head} type='button' className={'kd-tb' + (tool === head ? ' checked' : '')}
              style={{ minWidth: 72 }} title={tip} onClick={() => setTool(head, tool !== head)}>
              <ToolIcon head={head} />
              <span className='kd-tb-label'>{text}</span>
            </button>
          ))}
          <span className='kd-stretch' />
        </div>

        {/* --- editor | properties + preview --- */}
        <div className='kd-split'>
          <div ref={viewRef} className='kd-view' tabIndex={0} style={{ flex: `${split} 1 0`, cursor: tool ? 'crosshair' : 'default' }}
            onKeyDown={onViewKey} onWheel={onWheel}>
            <svg ref={svgRef} width={svgW} height={svgH} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
              onMouseLeave={() => { if (press.current) onMouseUp() }}
              onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
              <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill='#FAFAF8' />
              <g stroke='rgba(0,0,0,0.0627)' strokeWidth={1 / scale}>{gridLines}</g>
              {fc.edges.map((e, i) => {
                const pts = edgeGeo[i]
                if (!pts) return null
                const on = sel.edges.includes(e)
                const col = on ? '#DE6A14' : '#404040'
                const w = on ? 2 : 1.4
                const lp = e.label ? labelPoint(e, pts) : null
                return (
                  <g key={i}>
                    <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill='none' stroke={col}
                      strokeWidth={w} strokeDasharray={e.dashed ? `${4 * w} ${2 * w}` : undefined} />
                    {(e.head === 'end' || e.head === 'both') && pts.length > 1 && (
                      <polygon points={headPolygon(pts[pts.length - 1], pts[pts.length - 2]).map(p => `${p.x},${p.y}`).join(' ')} fill={col} />)}
                    {(e.head === 'start' || e.head === 'both') && pts.length > 1 && (
                      <polygon points={headPolygon(pts[0], pts[1]).map(p => `${p.x},${p.y}`).join(' ')} fill={col} />)}
                    {lp && (
                      <text x={lp.x + 4} y={lp.y - 8} dominantBaseline='central' fontSize={11}
                        fill='#222222' style={{ font: '11px -apple-system, "Segoe UI", system-ui, sans-serif' }}>{e.label}</text>)}
                  </g>
                )
              })}
              {fc.nodes.map(n => {
                const b = boxes.get(n.id)!
                const [fill, textCol] = cols[n.kind] ?? ['#FFFFFF', '#000000']
                const r = b.rect
                const tw = r.w - (n.kind === 'decision' || n.kind === 'io' ? 30 : 10)
                const on = sel.nodes.includes(n.id)
                return (
                  <g key={n.id} transform={`translate(${b.pos.x},${b.pos.y})`} style={{ cursor: tool ? 'crosshair' : 'move' }}>
                    <path d={shapePathD(n.kind, r)} fill={n.fill || fill} fillRule='evenodd' stroke='#404040'
                      strokeWidth={1.4} strokeDasharray={n.kind === 'note' ? '5.6 2.8' : undefined} />
                    <foreignObject x={-tw / 2} y={-150} width={tw} height={300} style={{ pointerEvents: 'none' }}>
                      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: '100%', padding: 4, boxSizing: 'border-box', textAlign: 'center',
                          color: textCol, font: '12px -apple-system, "Segoe UI", system-ui, sans-serif',
                          overflowWrap: 'break-word' }}
                          dangerouslySetInnerHTML={{ __html: boxHtml(n.text) }} />
                      </div>
                    </foreignObject>
                    {on && <rect x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} fill='none'
                      stroke='#DE6A14' strokeWidth={2} strokeDasharray='8 4' />}
                  </g>
                )
              })}
              {band && <rect x={band.x} y={band.y} width={band.w} height={band.h}
                fill='rgba(43,121,215,0.15)' stroke='#2b79d7' strokeWidth={1 / scale} />}
            </svg>
          </div>
          <div className='kd-gutter' onMouseDown={ev => {
            const host = (ev.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
            const move = (m: MouseEvent) => setSplit(Math.max(0.2, Math.min(0.85, (m.clientX - host.left) / host.width)))
            const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
            window.addEventListener('mousemove', move)
            window.addEventListener('mouseup', up)
          }} />
          <div style={{ flex: `${1 - split} 1 0`, display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 6, minWidth: 0 }}>
            <div style={{ flex: 1, minHeight: 0 }}>
              {page === 0 && (
                <div className='kd-muted' style={{ padding: 6, whiteSpace: 'pre-wrap' }}>
                  {'Select a box or an arrow to edit it.\n\nText may contain LaTeX maths, e.g. $x > 0$; \\\\ starts a new line.'}
                </div>)}
              {page === 1 && pn && (
                <div className='kd-form'>
                  <label>Text</label>
                  <input ref={nodeTextRef} type='text' placeholder='Text (LaTeX allowed)' value={nodeText}
                    onChange={e => {
                      setNodeText(e.target.value)
                      const n = fcRef.current.node(pn.id)
                      if (n) { n.text = e.target.value; redraw(); schedule() }
                    }}
                    onBlur={() => commit(false)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); commit(false) } }} />
                  <label>Shape</label>
                  <select value={pn.kind} onChange={e => setNode({ kind: e.target.value })}>
                    {Object.entries(KINDS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  <label>Colour</label>
                  <span className='kd-row'>
                    <button type='button' className='kd-btn' style={pn.fill ? { background: pn.fill } : undefined}
                      onClick={() => {
                        const inp = fillInput.current!
                        inp.value = (pn.fill || '#DEEBF7').toLowerCase()
                        inp.click()
                      }}>{pn.fill || 'Choose…'}</button>
                    <button type='button' className='kd-btn' onClick={() => setNode({ fill: '' })}>Automatic</button>
                    <input ref={fillInput} type='color' style={{ display: 'none' }}
                      onChange={e => setNode({ fill: e.target.value.toUpperCase() })} />
                  </span>
                </div>)}
              {page === 2 && pe && (
                <div className='kd-form'>
                  <label>Label</label>
                  <input ref={edgeLabelRef} type='text' placeholder='e.g. Yes / No' value={edgeLabel}
                    onChange={e => {
                      setEdgeLabel(e.target.value)
                      if (fcRef.current.edges.includes(pe)) { pe.label = e.target.value; redraw(); schedule() }
                    }}
                    onBlur={() => commit(false)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); commit(false) } }} />
                  <label>Route</label>
                  <select value={pe.route} onChange={e => setEdge({ route: e.target.value })}>
                    {ROUTES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <label>Bend</label>
                  <span className='kd-row' style={{ gap: 2 }}
                    title='How much a curved link bows: positive to the left, negative to the right (when both sides are chosen, the curve follows the sides instead)'>
                    <input type='number' min={-90} max={90} step={10} style={{ width: 70 }} value={pe.bend}
                      disabled={pe.route !== 'curve'}
                      onChange={e => setEdge({ bend: Math.max(-90, Math.min(90, Math.round(Number(e.target.value) || 0))) })} />
                    <span>°</span>
                  </span>
                  <label>Arrowheads</label>
                  <select value={pe.head} onChange={e => setEdge({ head: e.target.value })}>
                    {Object.entries(HEADS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <label>Leaves from</label>
                  <select value={pe.src_side} onChange={e => setEdge({ src_side: e.target.value })}>
                    {Object.entries(SIDES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <label>Arrives at</label>
                  <select value={pe.dst_side} onChange={e => setEdge({ dst_side: e.target.value })}>
                    {Object.entries(SIDES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <span />
                  <label className='kd-row'><input type='checkbox' checked={pe.dashed}
                    onChange={e => setEdge({ dashed: e.target.checked })} />Dashed</label>
                  <span />
                  <span><button type='button' className='kd-btn' onClick={reverseEdge}>Reverse direction</button></span>
                </div>)}
            </div>
            <div><b>Preview</b> — compiled with LaTeX</div>
            <div ref={previewRef} className='kd-preview' style={{ flex: '1.4 1 0' }}>
              {previewUrl && fc.nodes.length > 0 && <img src={previewUrl} alt='' />}
            </div>
            <div className='kd-muted' style={{ minHeight: 16 }}>{status}</div>
          </div>
        </div>

        {showCode && <pre className='kd-code'>{toTikz(fc)}</pre>}

        <div className='kd-row'>
          <button type='button' className={'kd-btn' + (showCode ? ' checked' : '')}
            onClick={() => setShowCode(s => !s)}>Show LaTeX</button>
          <span className='kd-hint kd-stretch'>
            Click a shape to add it after the selected box · drag to move · Ctrl/⌘-click a box to draw an arrow to it · Delete removes
          </span>
          <button type='button' className='kd-btn default' onClick={() => void insert()}>Insert</button>
          <button type='button' className='kd-btn' onClick={() => close(null)}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// FlowchartBuilderDialog(parent, chart).exec(): the chart, its compiled PDF
// and its TikZ on Insert, null on Cancel.
export function openFlowchartBuilder(chart: Flowchart | null = null): Promise<FlowchartResult | null> {
  return openModal<FlowchartResult>(close => <FlowchartBuilderDialog chart={chart} close={close} />)
}
