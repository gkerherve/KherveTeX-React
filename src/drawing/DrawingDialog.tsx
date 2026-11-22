// Vector drawing dialog (Insert ▸ Drawing). A port of
// khervedoc/drawing_dialog.py on the engine in src/core/paint*.ts: tool
// palette on the left, stroke/fill/text options on top, a properties panel
// on the right and the canvas in the middle.
//
// On OK the drawing is written as three siblings in the document's figures
// folder: drawing_NNN.svg (editable source, re-opened on double-click),
// drawing_NNN.pdf (vector, cropped to the content, what LaTeX includes) and
// drawing_NNN.png (preview shown in the visual editor, and the path the
// Figure stores). Drawings made by the old dialog (PNG + JSON sidecar) are
// converted on re-open.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { drawingSourceFor, nextDrawingPath } from '../core/drawingFiles'
import { suffix, withSuffix } from '../core/paths'
import {
  ARC_KINDS, ARROW, boundingRect, brushFor, CHEM_ATOM, CHEM_BENZENE, CHEM_BOND_TOOLS, CHEM_CHAIN,
  CHEM_CYCLOHEXANE, CHEM_CYCLOPENTANE, CHEM_DOUBLE, CHEM_HASH, CHEM_HBOND, CHEM_PLACE_TOOLS, CHEM_SINGLE,
  CHEM_TRIPLE, CHEM_WEDGE, centerOrigin, CIRCLE, color, colorArgb, colorName, contentRect, DIMENSION, ELLIPSE,
  ERASER, FLOW_PLACE, gridSize, HALFCIRCLE, isLine, itemToParent, leaves, LINE, MARGIN, makeBox, makeLine,
  makePath, makePolygon, makeText, mapPt, matInvert, matMul, newScene, PENCIL, PICKER, POINTER, POLYGON_KINDS,
  PROTRACTOR, QUARTERCIRCLE, RECT, RECT_TOOLS, rectCenter, ROUNDRECT, sceneBoundingRect, SHAPE_TOOLS,
  setTextMetrics, snap as snapScene, TEXT, textBounds, TWO_POINT_TOOLS, vectorItems, BUCKET, ELEC_PLACE,
  OPTICS_PLACE, MATH_PLACE, LABWARE_PLACE, ARROW_PLACE, CHEM_TOOLS, PLACE_TOOLS, DEFAULT_FONT_FAMILY,
  TRIANGLE, RIGHT_TRIANGLE, DIAMOND, PARALLELOGRAM, TRAPEZOID, PENTAGON, HEXAGON, HEPTAGON, OCTAGON, STAR,
  STAR6, PLUS, CHEVRON, ARROW_RIGHT, LIGHTNING, HOUSE, flatten, curvePath, outlinePath,
  type BrushDict, type Cmd, type Dash, type GroupItem, type Item, type LineItem, type Mat, type PenDict, type Pt,
  type Rect, type Scene, type TextItem,
} from '../core/paintModel'
import {
  applyRect, chemBond, chemConstrain, copyDicts, explodeItems, finishAngle, fitToContent, groupItems,
  mirrorItem, placeChemAtom, placeChemRing, placeSymbol, removeItems, reorder, shapeRect, spawn, ungroupItems,
} from '../core/paintOps'
import { sceneToPdf } from '../core/paintPdf'
import { itemPrims, primsToSvg, sceneToSvg } from '../core/paintRender'
import { dictToScene, loadLegacyJson, loadSvg, saveSvg, sceneToDict } from '../core/paintSvg'
import { ATOMS } from '../core/paintChemistry'
import { SYMBOL_MODULES, type SymbolModule } from '../core/paintSymbols'
import { platform } from '../platform'
import { exists, readText, writeBytes, writeText } from './host'
import { openModal, type Close } from './modal'
import { PaintIcon, PenPreview, Swatch } from './paintIcons'
import { showMenu, type MenuEntry } from './PopupMenu'
import './drawing.css'

// ------------------------------------------------------------ text metrics
// QFontMetrics from the browser's own layout, so text items and labels
// size as they draw.
let measureCtx: CanvasRenderingContext2D | null = null
function useBrowserMetrics(): void {
  if (measureCtx || typeof document === 'undefined') return
  measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return
  const css = (f: { family: string; px: number; bold: boolean; italic: boolean }) =>
    `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.px}px "${f.family}", Helvetica, Arial, sans-serif`
  setTextMetrics({
    width: (t, f) => { measureCtx!.font = css(f); return measureCtx!.measureText(t).width },
    ascent: f => { measureCtx!.font = css(f); const m = measureCtx!.measureText('Hg'); return m.fontBoundingBoxAscent ?? f.px * 0.77 },
    lineHeight: f => {
      measureCtx!.font = css(f)
      const m = measureCtx!.measureText('Hg')
      return (m.fontBoundingBoxAscent ?? f.px * 0.77) + (m.fontBoundingBoxDescent ?? f.px * 0.23) + 1
    },
  })
}

// ------------------------------------------------------------ tool tables
export const PALETTE = ['#000000', '#ffffff', '#7a7a7a', '#1a6dd8', '#d8000c',
  '#0a8f3c', '#d96b00', '#8e44ad', '#f2c500', '#17a2b8']
export const LINE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12]
export const DASHES: [Dash, string][] = [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted'], ['dashdot', 'Dash-dot']]
export const HEADS: [string, string][] = [['filled', 'Filled'], ['open', 'Open'], ['stealth', 'Stealth'], ['double', 'Double-ended']]
export const FILL_STYLES: [string, string][] = [['solid', 'Solid'], ['linear', 'Linear gradient'],
  ['radial', 'Radial gradient'], ['sun', 'Sphere highlight']]

// Single-button tools: [tool id, icon name, label, shortcut].
export const DIRECT_TOOLS: [string, string, string, string | null][] = [
  [POINTER, 'pointer', 'Select / move / resize (double-click: rotate)', 'V'],
  [PENCIL, 'pencil', 'Pencil (freehand)', 'P'],
  [ERASER, 'eraser', 'Eraser (removes shapes)', 'X'],
  [BUCKET, 'bucket', 'Bucket fill', 'B'],
  [PICKER, 'picker', 'Colour picker (Shift+click: fill colour)', 'K'],
  [TEXT, 'text', 'Text', 'T'],
  [LINE, 'line', 'Line', 'L'],
  [ARROW, 'arrow', 'Arrow', 'A'],
  [DIMENSION, 'dimension', 'Dimension line (length in mm)', 'M'],
  [PROTRACTOR, 'protractor', 'Protractor (three clicks)', null],
  [RECT, 'rect', 'Rectangle', 'R'],
  [ROUNDRECT, 'roundrect', 'Rounded rectangle', null],
  [CIRCLE, 'circle', 'Circle', 'C'],
  [ELLIPSE, 'ellipse', 'Ellipse', 'E'],
  [HALFCIRCLE, 'halfcircle', 'Half circle', null],
  [QUARTERCIRCLE, 'quartercircle', 'Quarter circle', null],
]

// Dropdown shape groups: [title, [tool, label][]].
export const SHAPE_GROUPS: [string, [string, string][]][] = [
  ['Polygons', [[TRIANGLE, 'Triangle'], [RIGHT_TRIANGLE, 'Right triangle'], [DIAMOND, 'Diamond'],
    [PARALLELOGRAM, 'Parallelogram'], [TRAPEZOID, 'Trapezoid'], [PENTAGON, 'Pentagon'], [HEXAGON, 'Hexagon'],
    [HEPTAGON, 'Heptagon'], [OCTAGON, 'Octagon']]],
  ['Stars & symbols', [[STAR, 'Star (5-point)'], [STAR6, 'Star (6-point)'], [PLUS, 'Cross / plus'],
    [CHEVRON, 'Chevron'], [ARROW_RIGHT, 'Block arrow'], [LIGHTNING, 'Lightning bolt'], [HOUSE, 'House']]],
]

// Symbol libraries: [icon, tooltip, module key, placement tool].
export const SYMBOL_LIBRARIES: [string, string, keyof typeof SYMBOL_MODULES, string][] = [
  ['flowchart', 'Flowchart symbols', 'flowchart', FLOW_PLACE],
  ['electrical', 'Electrical / circuit symbols', 'electrical', ELEC_PLACE],
  ['optics', 'Optics (lasers, lenses, mirrors)', 'optics', OPTICS_PLACE],
  ['maths', 'Maths (axes, graphs, vectors)', 'maths', MATH_PLACE],
  ['labware', 'Lab glassware', 'labware', LABWARE_PLACE],
  ['arrows', 'Annotation arrows & callouts', 'arrows', ARROW_PLACE],
]

export const CHEM_BONDS: [string, string][] = [[CHEM_SINGLE, 'Single bond'], [CHEM_CHAIN, 'Chain'],
  [CHEM_DOUBLE, 'Double bond'], [CHEM_TRIPLE, 'Triple bond'], [CHEM_WEDGE, 'Wedge (up)'],
  [CHEM_HASH, 'Hash (down)'], [CHEM_HBOND, 'Hydrogen bond']]
export const CHEM_RINGS: [string, string][] = [[CHEM_BENZENE, 'Benzene'], [CHEM_CYCLOHEXANE, 'Cyclohexane'],
  [CHEM_CYCLOPENTANE, 'Cyclopentane']]

const TYPE_NAMES: Record<string, string> = {
  dimension: 'Dimension', arrow: 'Arrow', line: 'Line', roundrect: 'Rounded rectangle', rect: 'Rectangle',
  ellipse: 'Ellipse', polygon: 'Polygon', arc: 'Arc', path: 'Path', image: 'Image', group: 'Group', text: 'Text',
}

const FONT_FAMILIES = ['Helvetica', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana',
  'Trebuchet MS', 'Palatino', 'Garamond', 'Futura', 'Menlo', 'Segoe UI']

export interface DrawingResult { path: string; handoff: boolean }

// ------------------------------------------------------------ the scene state
interface Style {
  pen: PenDict
  arrowHead: string
  fillEnabled: boolean
  fillColor: string
  fillColor2: string
  fillStyle: string
  fillAngle: number
  family: string
  size: number
  bold: boolean
  italic: boolean
}

const currentBrush = (st: Style): BrushDict =>
  st.fillEnabled ? brushFor(st.fillStyle, st.fillColor, st.fillColor2, st.fillAngle) : null

// ------------------------------------------------------------ handles
type HandleKind = 'line' | 'polygon' | 'box' | 'scale' | 'gbox' | 'rotate'
interface Handle { role: string; p: Pt; round?: boolean }
const BOX_ROLES = ['nw', 'ne', 'se', 'sw', 'n', 's', 'e', 'w']

function handleKind(it: Item, rotate: boolean): HandleKind {
  if (rotate) return 'rotate'
  if (it.type === 'group' || it.type === 'image') return 'gbox'
  if (isLine(it)) return 'line'
  if (it.type === 'polygon') return 'polygon'
  if (it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc') return 'box'
  return 'scale'
}

function boxAnchor(r: Rect, role: string): Pt {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return ({ nw: { x: r.x, y: r.y }, ne: { x: r.x + r.w, y: r.y }, se: { x: r.x + r.w, y: r.y + r.h },
    sw: { x: r.x, y: r.y + r.h }, n: { x: cx, y: r.y }, s: { x: cx, y: r.y + r.h }, e: { x: r.x + r.w, y: cy },
    w: { x: r.x, y: cy } } as Record<string, Pt>)[role]
}

function handlesFor(it: Item, kind: HandleKind): Handle[] {
  const m = itemToParent(it)
  const to = (p: Pt) => mapPt(m, p)
  if (kind === 'rotate') {
    const br = boundingRect(it)
    const c = rectCenter(br)
    return [{ role: 'rotate', p: to({ x: c.x, y: br.y - 22 }), round: true }, { role: 'centre', p: to(c) }]
  }
  if (kind === 'line') {
    const li = it as LineItem
    const out: Handle[] = [{ role: 'p1', p: to({ x: li.x1, y: li.y1 }) }, { role: 'p2', p: to({ x: li.x2, y: li.y2 }) }]
    if (li.type !== 'dimension') {
      const mid = { x: (li.x1 + li.x2) / 2, y: (li.y1 + li.y2) / 2 }
      const p = li.bend ? { x: (mid.x + li.bend[0]) / 2, y: (mid.y + li.bend[1]) / 2 } : mid
      out.push({ role: 'mid', p: to(p), round: true })
    }
    return out
  }
  if (kind === 'polygon') {
    return (it as { points: [number, number][] }).points.map((q, i) => ({ role: String(i), p: to({ x: q[0], y: q[1] }) }))
  }
  const r = kind === 'box' ? { x: (it as { x: number }).x, y: (it as { y: number }).y, w: (it as { w: number }).w, h: (it as { h: number }).h }
    : boundingRect(it)
  const roles = kind === 'scale' ? ['nw', 'ne', 'se', 'sw'] : BOX_ROLES
  return roles.map(role => ({ role, p: to(boxAnchor(r, role)) }))
}

// ------------------------------------------------------------ the dialog
// Insert ▸ Shapes opens on its shape's tool; Insert ▸ Chart on a chart
// already drawn (a scene), to adjust before inserting.
export interface DrawingStart { tool?: string; scene?: Scene }
interface Props { imagesDir: string; existing: string | null; close: Close<DrawingResult>; start?: DrawingStart }

function DrawingDialog({ imagesDir, existing, close, start }: Props) {
  useBrowserMetrics()
  const sceneRef = useRef<Scene>(start?.scene ?? newScene(900, 600))
  const scene = sceneRef.current
  const [, setTick] = useState(0)
  const redraw = () => setTick(t => t + 1)
  const [sel, setSelState] = useState<Item[]>([])
  const selRef = useRef<Item[]>([])
  const setSel = (s: Item[]) => { selRef.current = s; setSelState(s) }
  const [tool, setToolState] = useState(start?.tool ?? (start?.scene ? POINTER : PENCIL))
  const [groupPick, setGroupPick] = useState<Record<string, string>>({})
  const [rotateTarget, setRotateTarget] = useState<Item | null>(null)
  const [zoom, setZoom] = useState(1)
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<TextItem | null>(null)
  const [style, setStyleState] = useState<Style>({
    pen: { color: '#ff1a1a1a', width: 2 }, arrowHead: 'filled', fillEnabled: false, fillColor: '#4aa3ff',
    fillColor2: '#ffffff', fillStyle: 'solid', fillAngle: 90, family: DEFAULT_FONT_FAMILY, size: 14, bold: false,
    italic: false,
  })
  const styleRef = useRef(style)
  const setStyle = (patch: Partial<Style>) => {
    styleRef.current = { ...styleRef.current, ...patch }
    setStyleState(styleRef.current)
  }
  const [symbolPick, setSymbolPick] = useState<Record<string, string>>({ flowchart: 'process', electrical: 'resistor',
    optics: 'laser', maths: 'axes_2d', labware: 'beaker', arrows: 'arrow_right' })
  const symbolRef = useRef(symbolPick)
  symbolRef.current = symbolPick
  const chemAtom = useRef('C')
  const history = useRef<string[]>([])
  const histI = useRef(0)
  const viewRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const colorInput = useRef<HTMLInputElement>(null)
  const colorTarget = useRef<(c: string) => void>(() => {})
  const [ui, setUi] = useState({ showGrid: true, snap: false, gridMm: 5, rulers: false })
  const [loaded, setLoaded] = useState(existing === null)

  // ---- history (one snapshot per change, as _capture_change) ----
  const snapshot = () => JSON.stringify(sceneToDict(sceneRef.current))
  const capture = () => {
    const after = snapshot()
    if (after === history.current[histI.current]) return
    history.current.splice(histI.current + 1)
    history.current.push(after)
    histI.current = history.current.length - 1
    redraw()
  }
  const restore = (i: number) => {
    if (i < 0 || i >= history.current.length) return
    histI.current = i
    const s = dictToScene(JSON.parse(history.current[i]))
    Object.assign(s, { showGrid: ui.showGrid, snap: ui.snap, gridMm: ui.gridMm, infinite: true })
    sceneRef.current = s
    setSel([])
    setRotateTarget(null)
    redraw()
  }
  const undo = () => restore(histI.current - 1)
  const redo = () => restore(histI.current + 1)

  // ---- load ----
  useEffect(() => {
    let alive = true
    void (async () => {
      if (existing !== null) {
        const src = await drawingSourceFor(existing, exists)
        if (src !== null) {
          try {
            const text = await readText(src)
            if (suffix(src) === '.svg') {
              const s = loadSvg(text)
              // The editor always uses its own grid defaults.
              Object.assign(s, { showGrid: true, snap: false, gridMm: 5, infinite: true })
              sceneRef.current = s
            } else {
              const s = newScene(900, 600)
              Object.assign(s, { showGrid: true, snap: false, gridMm: 5, infinite: true })
              loadLegacyJson(s, JSON.parse(text))
              sceneRef.current = s
            }
          } catch (e) {
            setStatus(`Could not load drawing: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
      } else {
        Object.assign(sceneRef.current, { showGrid: true, snap: false, gridMm: 5, infinite: true })
      }
      if (!alive) return
      history.current = [snapshot()]
      histI.current = 0
      setToolState(start?.tool ?? (existing === null && !start?.scene ? PENCIL : POINTER))
      setLoaded(true)
      // A chart (start.scene) shown whole, as a drawing opened again.
      setTimeout(() => (existing !== null || start?.scene ? zoomToContent() : centerOn({ x: 450, y: 300 }, 1)), 0)
    })()
    return () => { alive = false }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the view: the paper around the content, zoom and scroll ----
  const content = contentRect(scene)
  const area: Rect = (() => {
    const pad = 1500
    const x0 = Math.min(0, content.w > 0 ? content.x : 0) - pad
    const y0 = Math.min(0, content.h > 0 ? content.y : 0) - pad
    const x1 = Math.max(scene.width, content.w > 0 ? content.x + content.w : 0) + pad
    const y1 = Math.max(scene.height, content.h > 0 ? content.y + content.h : 0) + pad
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  })()
  const areaRef = useRef(area)
  areaRef.current = area
  const pendingCenter = useRef<{ p: Pt; z: number } | null>(null)
  const centerOn = (p: Pt, z = zoom) => { pendingCenter.current = { p, z }; redraw() }
  useLayoutEffect(() => {
    const c = pendingCenter.current
    const v = viewRef.current
    if (!c || !v) return
    pendingCenter.current = null
    const a = areaRef.current
    v.scrollLeft = (c.p.x - a.x) * c.z - v.clientWidth / 2
    v.scrollTop = (c.p.y - a.y) * c.z - v.clientHeight / 2
  })
  const viewCenter = (): Pt => {
    const v = viewRef.current!
    const a = areaRef.current
    return { x: a.x + (v.scrollLeft + v.clientWidth / 2) / zoom, y: a.y + (v.scrollTop + v.clientHeight / 2) / zoom }
  }
  const zoomBy = (f: number) => {
    const c = viewCenter()
    const z = Math.max(0.05, Math.min(40, zoom * f))
    setZoom(z)
    centerOn(c, z)
  }
  const zoomReset = () => { const c = viewCenter(); setZoom(1); centerOn(c, 1) }
  const zoomToContent = () => {
    let r = contentRect(sceneRef.current)
    if (r.w <= 0 || r.h <= 0) r = { x: 0, y: 0, w: sceneRef.current.width, h: sceneRef.current.height }
    const v = viewRef.current
    if (!v) return
    const rr = { x: r.x - 30, y: r.y - 30, w: r.w + 60, h: r.h + 60 }
    let z = Math.min(v.clientWidth / rr.w, v.clientHeight / rr.h)
    // Never blow a small sketch up past 200 %.
    if (z > 2.0) z = 2.0
    setZoom(z)
    centerOn(rectCenter(r), z)
  }
  const toScene = (ev: { clientX: number; clientY: number }): Pt => {
    const m = svgRef.current!.getScreenCTM()!.inverse()
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m)
    return { x: p.x, y: p.y }
  }

  // ---- tools ----
  const isPlaceTool = (t: string) => PLACE_TOOLS.includes(t)
  const toolPos = (p: Pt): Pt => (sceneRef.current.snap && (SHAPE_TOOLS.includes(tool) || tool === TEXT
    || isPlaceTool(tool) || CHEM_TOOLS.includes(tool)) ? snapScene(sceneRef.current, p) : p)

  const chain = useRef<Pt[] | null>(null)
  const angle = useRef<Pt[] | null>(null)
  const [preview, setPreview] = useState<Item[]>([])

  const setTool = (t: string) => {
    chain.current = null
    angle.current = null
    setPreview([])
    setToolState(t)
    if (t !== POINTER) setRotateTarget(null)
  }

  // ---- selection helpers ----
  const topAt = (p: Pt): Item | null => {
    const items = vectorItems(sceneRef.current)
    for (let i = items.length - 1; i >= 0; i--) if (hitItem(items[i], p, 4 / zoom)) return items[i]
    return null
  }

  // ---- press / move / release ----
  type Gesture =
    | { k: 'move'; start: Pt; orig: Map<Item, Pt>; moved: boolean }
    | { k: 'band'; start: Pt; rect: Rect; add: boolean }
    | { k: 'handle'; role: string; item: Item; kind: HandleKind; base: Record<string, unknown> }
    | { k: 'draw'; item: Item; start: Pt }
    | { k: 'pencil'; item: Item; last: Pt }
    | { k: 'erase' }
  const gesture = useRef<Gesture | null>(null)
  const [band, setBand] = useState<Rect | null>(null)

  const finishTextEdit = () => {
    const t = editing
    if (!t) return
    setEditing(null)
    if (!t.text.trim()) removeItems(sceneRef.current, [t])
    capture()
  }

  const onMouseDown = (ev: React.MouseEvent) => {
    if (!loaded) return
    if (editing) finishTextEdit()
    viewRef.current?.focus()
    const s = sceneRef.current
    const raw = toScene(ev)
    const st = styleRef.current
    if (tool === CHEM_CHAIN) {
      if (ev.button !== 0) { chain.current = null; setPreview([]); return }
      if (!chain.current) {
        const p = toolPos(raw)
        chain.current = [p]
        return
      }
      const last = chain.current[chain.current.length - 1]
      if (Math.hypot(raw.x - last.x, raw.y - last.y) < Math.max(gridSize(s), 6)) {
        chain.current = null
        setPreview([])
        return
      }
      const p = chemConstrain(s, last, raw)
      const bond = makeLine('line', last.x, last.y, p.x, p.y, { ...st.pen })
      s.items.push(bond)
      centerOrigin(bond)
      chain.current.push(p)
      capture()
      return
    }
    if (tool === PROTRACTOR) {
      if (ev.button !== 0) { angle.current = null; setPreview([]); return }
      if (!angle.current) { angle.current = [raw]; return }
      if (angle.current.length === 1) { angle.current.push(raw); return }
      const [v, a] = angle.current
      angle.current = null
      setPreview([])
      const g = finishAngle(s, v, a, raw, { ...st.pen })
      if (g) { setSel([g]); capture() }
      return
    }
    if (ev.button !== 0) return
    if (tool === POINTER) {
      // a handle of the single selection?
      updateHover(raw)
      if (sel.length === 1 && hoverHandle.current) {
        const h = hoverHandle.current
        const item = sel[0]
        const kind = handleKind(item, rotateTarget === item)
        gesture.current = { k: 'handle', role: h.role, item, kind, base: beginHandle(item, kind, h.role, raw) }
        return
      }
      const it = topAt(raw)
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        // Shift/Ctrl+click multi-select: toggle on press.
        if (it) setSel(sel.includes(it) ? sel.filter(x => x !== it) : [...sel, it])
        return
      }
      if (it) {
        const next = sel.includes(it) ? sel : [it]
        if (next !== sel) { setSel(next); if (rotateTarget !== it) setRotateTarget(null) }
        gesture.current = { k: 'move', start: raw, orig: new Map(next.map(x => [x, { ...x.pos }])), moved: false }
      } else {
        setSel([])
        setRotateTarget(null)
        gesture.current = { k: 'band', start: raw, rect: { x: raw.x, y: raw.y, w: 0, h: 0 }, add: false }
      }
      return
    }
    if (tool === BUCKET) { void bucketFill(raw); return }
    if (tool === PICKER) { void pickColor(raw, ev.shiftKey); return }
    const pos = toolPos(raw)
    if (tool === ERASER) {
      gesture.current = { k: 'erase' }
      erase(raw)
      return
    }
    if (tool === PENCIL) {
      const path = makePath([['M', raw.x, raw.y]], { ...st.pen }, null)
      path._origin = { x: 0, y: 0 }
      s.items.push(path)
      gesture.current = { k: 'pencil', item: path, last: raw }
      redraw()
      return
    }
    if (TWO_POINT_TOOLS.includes(tool)) {
      const li = makeLine(tool as 'line', pos.x, pos.y, pos.x, pos.y, { ...st.pen })
      if (tool === ARROW) li.head = st.arrowHead
      li._origin = { x: 0, y: 0 }
      s.items.push(li)
      gesture.current = { k: 'draw', item: li, start: pos }
      redraw()
      return
    }
    if (RECT_TOOLS.includes(tool)) {
      let it: Item
      if (tool === RECT) it = makeBox('rect', { x: pos.x, y: pos.y, w: 0, h: 0 }, { ...st.pen }, currentBrush(st))
      else if (tool === ROUNDRECT) it = makeBox('roundrect', { x: pos.x, y: pos.y, w: 0, h: 0 }, { ...st.pen }, currentBrush(st))
      else if (POLYGON_KINDS.includes(tool)) it = makePolygon(tool, [], { ...st.pen }, currentBrush(st))
      else if (ARC_KINDS.includes(tool)) { it = makeBox('arc', { x: pos.x, y: pos.y, w: 0, h: 0 }, { ...st.pen }, currentBrush(st)); it.kind = tool }
      else it = makeBox('ellipse', { x: pos.x, y: pos.y, w: 0, h: 0 }, { ...st.pen }, currentBrush(st))
      it._origin = { x: 0, y: 0 }
      s.items.push(it)
      gesture.current = { k: 'draw', item: it, start: pos }
      redraw()
      return
    }
    if (tool === TEXT) {
      const t = makeText('Text', { family: st.family, size: st.size, bold: st.bold, italic: st.italic, color: st.pen.color })
      t.pos = pos
      t._origin = { x: 0, y: 0 }
      s.items.push(t)
      setEditing(t)
      capture()
      return
    }
    if (CHEM_BOND_TOOLS.includes(tool)) {
      const kind = tool.split('_')[1]
      const it = chemBond(kind, pos, pos, st.pen)
      it._origin = { x: 0, y: 0 }
      s.items.push(it)
      gesture.current = { k: 'draw', item: it, start: pos }
      return
    }
    if (CHEM_PLACE_TOOLS.includes(tool)) {
      const it = tool === CHEM_ATOM ? placeChemAtom(s, chemAtom.current, pos, st.pen)
        : placeChemRing(s, tool.split('_')[1], pos, { ...st.pen }, currentBrush(st))
      setSel([it])
      capture()
      return
    }
    const lib = SYMBOL_LIBRARIES.find(l => l[3] === tool)
    if (lib) {
      const mod = SYMBOL_MODULES[lib[2]] as SymbolModule
      const it = placeSymbol(s, mod, symbolRef.current[lib[2]], pos)
      if (it) { setSel([it]); capture() }
    }
  }

  const onMouseMove = (ev: React.MouseEvent) => {
    const raw = toScene(ev)
    const s = sceneRef.current
    const k = 25.4 / Math.max(s.dpi, 1)
    setStatus(`x ${(raw.x * k).toFixed(1)} mm   y ${(raw.y * k).toFixed(1)} mm`)
    const st = styleRef.current
    if (tool === CHEM_CHAIN && chain.current) {
      const last = chain.current[chain.current.length - 1]
      const p = chemConstrain(s, last, raw)
      setPreview([makeLine('line', last.x, last.y, p.x, p.y, { ...st.pen })])
      return
    }
    if (tool === PROTRACTOR && angle.current) {
      const pts = angle.current
      const arms = [makeLine('line', pts[0].x, pts[0].y, (pts[1] ?? raw).x, (pts[1] ?? raw).y, { ...st.pen })]
      if (pts.length === 2) arms.push(makeLine('line', pts[0].x, pts[0].y, raw.x, raw.y, { ...st.pen }))
      setPreview(arms)
      return
    }
    if (tool === POINTER && !gesture.current) updateHover(raw)
    const g = gesture.current
    if (!g) return
    if (g.k === 'erase') { erase(raw); return }
    if (g.k === 'pencil') {
      if (Math.abs(raw.x - g.last.x) + Math.abs(raw.y - g.last.y) >= 2) {
        const path = g.item as { cmds: Cmd[] }
        path.cmds = [...path.cmds, ['L', raw.x, raw.y]]
        g.last = raw
        redraw()
      }
      return
    }
    if (g.k === 'draw') {
      const pos = toolPos(raw)
      const it = g.item
      if (isLine(it)) {
        Object.assign(it, { x2: pos.x, y2: pos.y })
      } else if (CHEM_BOND_TOOLS.includes(tool)) {
        const end = chemConstrain(s, g.start, raw)
        const fresh = chemBond(tool.split('_')[1], g.start, end, st.pen)
        Object.assign(it, fresh, { _origin: { x: 0, y: 0 } })
      } else {
        applyRect(it, shapeRect(g.start, pos, tool === CIRCLE))
      }
      redraw()
      return
    }
    if (g.k === 'move') {
      const dx = raw.x - g.start.x
      const dy = raw.y - g.start.y
      if (!g.moved && Math.hypot(dx, dy) * zoom < 2) return
      g.moved = true
      for (const [it, o] of g.orig) {
        let p = { x: o.x + dx, y: o.y + dy }
        if (s.snap) p = snapScene(s, p)
        it.pos = p
      }
      redraw()
      return
    }
    if (g.k === 'band') {
      g.rect = { x: Math.min(g.start.x, raw.x), y: Math.min(g.start.y, raw.y), w: Math.abs(raw.x - g.start.x), h: Math.abs(raw.y - g.start.y) }
      setBand(g.rect)
      setSel(vectorItems(s).filter(it => rectsMeet(sceneBoundingRect(it), g.rect)))
      return
    }
    if (g.k === 'handle') {
      dragHandle(g, s.snap ? snapScene(s, raw) : raw, raw)
      redraw()
    }
  }

  const onMouseUp = () => {
    const g = gesture.current
    gesture.current = null
    const s = sceneRef.current
    if (!g) return
    if (g.k === 'band') { setBand(null); return }
    if (g.k === 'move') { if (g.moved) capture(); return }
    if (g.k === 'handle') { capture(); return }
    if (g.k === 'erase') { capture(); return }
    if (g.k === 'pencil') {
      const path = g.item as { cmds: Cmd[] }
      if (path.cmds.length <= 1) removeItems(s, [g.item])   // a click with no drag
      else { centerOrigin(g.item); capture() }
      redraw()
      return
    }
    if (g.k === 'draw') {
      const it = g.item
      let degenerate: boolean
      if (isLine(it)) degenerate = Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 1
      else {
        const br = boundingRect(it)
        const strokeW = (it as { pen?: PenDict }).pen?.width ?? 0
        degenerate = br.w - strokeW < 1 && br.h - strokeW < 1
      }
      if (degenerate) removeItems(s, [it])
      else { centerOrigin(it); capture() }
      redraw()
    }
  }

  const onDoubleClick = (ev: React.MouseEvent) => {
    if (tool !== POINTER) return
    const it = topAt(toScene(ev))
    if (!it) return
    if (it.type === 'text') { setEditing(it); return }
    // rotate mode
    centerOrigin(it)
    setSel([it])
    setRotateTarget(it)
  }

  // ---- handles ----
  const hoverHandle = useRef<Handle | null>(null)
  const [cursor, setCursor] = useState('default')
  const updateHover = (p: Pt) => {
    hoverHandle.current = null
    if (selRef.current.length === 1) {
      const it = selRef.current[0]
      for (const h of handlesFor(it, handleKind(it, rotateTarget === it))) {
        if (h.role === 'centre') continue
        if (Math.abs(h.p.x - p.x) * zoom <= 6 && Math.abs(h.p.y - p.y) * zoom <= 6) { hoverHandle.current = h; break }
      }
    }
    setCursor(hoverHandle.current ? 'crosshair' : topAt(p) ? 'move' : 'default')
  }

  function beginHandle(it: Item, kind: HandleKind, role: string, p: Pt): Record<string, unknown> {
    if (kind === 'rotate') {
      centerOrigin(it)
      return { center: mapPt(itemToParent(it), it._origin!) }
    }
    if (kind === 'scale') {
      centerOrigin(it)
      const br = boundingRect(it)
      const opposite: Record<string, string> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }
      const anchorLocal = boxAnchor(br, opposite[role] ?? 'nw')
      const anchorScene = mapPt(itemToParent(it), anchorLocal)
      return { anchorLocal, anchorScene, base: it.scale || 1, dist: Math.max(Math.hypot(p.x - anchorScene.x, p.y - anchorScene.y), 1) }
    }
    if (kind === 'gbox') {
      return { inv0: matInvert(itemToParent(it)), tf0: (it.matrix ?? [1, 0, 0, 1, 0, 0]).slice(), br: boundingRect(it) }
    }
    return {}
  }

  function dragHandle(g: Extract<Gesture, { k: 'handle' }>, snapped: Pt, raw: Pt): void {
    const it = g.item
    const local = mapPt(matInvert(itemToParent(it)), snapped)
    if (g.kind === 'rotate') {
      const c = g.base.center as Pt
      let a = Math.atan2(raw.y - c.y, raw.x - c.x) * 180 / Math.PI + 90
      if (sceneRef.current.snap) a = Math.round(a / 15) * 15
      it.rotation = a
    } else if (g.kind === 'scale') {
      const b = g.base as { anchorLocal: Pt; anchorScene: Pt; base: number; dist: number }
      const sNew = Math.max(b.base * Math.hypot(snapped.x - b.anchorScene.x, snapped.y - b.anchorScene.y) / b.dist, 0.05)
      it.scale = sNew
      const o = it._origin ?? { x: 0, y: 0 }
      const r = it.rotation * Math.PI / 180
      const vx = (b.anchorLocal.x - o.x) * sNew
      const vy = (b.anchorLocal.y - o.y) * sNew
      const rx = vx * Math.cos(r) - vy * Math.sin(r)
      const ry = vx * Math.sin(r) + vy * Math.cos(r)
      it.pos = { x: b.anchorScene.x - o.x - rx, y: b.anchorScene.y - o.y - ry }
    } else if (g.kind === 'line') {
      const li = it as LineItem
      if (g.role === 'mid') {
        const mid = { x: (li.x1 + li.x2) / 2, y: (li.y1 + li.y2) / 2 }
        const len = Math.hypot(li.x2 - li.x1, li.y2 - li.y1)
        const off = len > 1e-6 ? Math.abs((li.x2 - li.x1) * (local.y - li.y1) - (li.y2 - li.y1) * (local.x - li.x1)) / len
          : Math.hypot(local.x - mid.x, local.y - mid.y)
        if (off < 2.0) delete li.bend
        else li.bend = [local.x * 2 - mid.x, local.y * 2 - mid.y]
      } else if (g.role === 'p1') Object.assign(li, { x1: local.x, y1: local.y })
      else Object.assign(li, { x2: local.x, y2: local.y })
    } else if (g.kind === 'polygon') {
      const pg = it as { points: [number, number][] }
      pg.points = pg.points.map((q, i) => (String(i) === g.role ? [local.x, local.y] : q))
      if (it.rotation === 0) centerOrigin(it)
    } else if (g.kind === 'box') {
      const b = it as { x: number; y: number; w: number; h: number }
      let l = b.x
      let t = b.y
      let r = b.x + b.w
      let bt = b.y + b.h
      if (g.role.includes('n')) t = local.y
      if (g.role.includes('s')) bt = local.y
      if (g.role.includes('w')) l = local.x
      if (g.role.includes('e')) r = local.x
      const nr = { x: Math.min(l, r), y: Math.min(t, bt), w: Math.max(1, Math.abs(r - l)), h: Math.max(1, Math.abs(bt - t)) }
      Object.assign(b, nr)
      if (it.rotation === 0) centerOrigin(it)
    } else if (g.kind === 'gbox') {
      const b = g.base as { inv0: Mat; tf0: number[]; br: Rect }
      const opposite: Record<string, string> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' }
      const anchor = boxAnchor(b.br, opposite[g.role])
      const moving = boxAnchor(b.br, g.role)
      const cur = mapPt(b.inv0, snapped)
      let sx = 1
      let sy = 1
      if (g.role.includes('e') || g.role.includes('w')) {
        const d = moving.x - anchor.x
        if (Math.abs(d) > 1e-6) sx = (cur.x - anchor.x) / d
      }
      if (g.role.includes('n') || g.role.includes('s')) {
        const d = moving.y - anchor.y
        if (Math.abs(d) > 1e-6) sy = (cur.y - anchor.y) / d
      }
      sx = sx >= 0 ? Math.max(sx, 0.05) : Math.min(sx, -0.05)
      sy = sy >= 0 ? Math.max(sy, 0.05) : Math.min(sy, -0.05)
      const scale: Mat = [sx, 0, 0, sy, anchor.x - sx * anchor.x, anchor.y - sy * anchor.y]
      const m = matMul(scale, b.tf0 as Mat)
      it.matrix = [...m]
    }
  }

  // ---- eraser / bucket / picker ----
  const erase = (p: Pt) => {
    const it = topAt(p)
    if (it && it.type !== 'image') {
      removeItems(sceneRef.current, [it])
      setSel(selRef.current.filter(x => x !== it))
      redraw()
    }
  }

  const renderImage = async (s: Scene): Promise<ImageData | null> => {
    const w = Math.trunc(s.width)
    const h = Math.trunc(s.height)
    const canvas = await svgToCanvas(sceneToSvg(s, { x: 0, y: 0, w, h }, w, h), w, h)
    return canvas?.getContext('2d')?.getImageData(0, 0, w, h) ?? null
  }

  async function bucketFill(p: Pt) {
    const s = sceneRef.current
    const img = await renderImage(s)
    if (!img) return
    const x = Math.trunc(p.x)
    const y = Math.trunc(p.y)
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
    const runs = floodRuns(img, x, y, 40)
    if (!runs.length) return
    const cmds: Cmd[] = []
    for (const [ry, xl, xr] of mergeRuns(runs)) {
      cmds.push(['M', xl, ry[0]], ['L', xr + 1, ry[0]], ['L', xr + 1, ry[1] + 1], ['L', xl, ry[1] + 1], ['L', xl, ry[0]])
    }
    const it = makePath(cmds, { color: '#ff000000', width: 1, none: true }, { color: colorArgb(color(styleRef.current.fillColor)) })
    const zs = vectorItems(s).map(i => i.z)
    it.z = zs.length ? Math.min(...zs) - 1 : 0        // behind the bounding shapes
    it._origin = { x: 0, y: 0 }
    s.items.push(it)
    capture()
  }

  async function pickColor(p: Pt, fill: boolean) {
    const s = sceneRef.current
    const canvas = await svgToCanvas(sceneToSvg(s, { x: p.x, y: p.y, w: 1, h: 1 }, 1, 1), 1, 1)
    const d = canvas?.getContext('2d')?.getImageData(0, 0, 1, 1).data
    if (!d) return
    const name = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')
    if (fill) setStyle({ fillColor: name, fillEnabled: true })
    else setStyle({ pen: { ...styleRef.current.pen, color: colorArgb(color(name)) } })
  }

  // ---- style -> selection (one undo step each) ----
  const styleSelection = (fn: (it: Item) => void) => {
    const items = leaves(selRef.current)
    if (!items.length) return
    items.forEach(fn)
    capture()
  }
  const withPen = (it: Item, change: (p: PenDict) => void) => {
    const p = (it as { pen?: PenDict }).pen
    if (!p || p.none || it.type === 'image') return
    const np = { ...p }
    change(np)
    ;(it as { pen: PenDict }).pen = np
  }
  const fillable = (it: Item) => !isLine(it) && 'brush' in it
  const applyBrush = (st: Style) => styleSelection(it => { if (fillable(it)) (it as { brush: BrushDict }).brush = currentBrush(st) })

  const setStrokeColor = (c: string) => {
    const argb = colorArgb(color(c))
    setStyle({ pen: { ...styleRef.current.pen, color: argb } })
    styleSelection(it => {
      if (it.type === 'text') it.color = argb
      else withPen(it, p => { p.color = argb })
    })
  }
  const setWidth = (w: number) => {
    setStyle({ pen: { ...styleRef.current.pen, width: w } })
    styleSelection(it => withPen(it, p => { p.width = w }))
  }
  const setDash = (d: Dash) => {
    const pen = { ...styleRef.current.pen }
    if (d === 'solid') delete pen.dash
    else pen.dash = d
    setStyle({ pen })
    styleSelection(it => withPen(it, p => { if (d === 'solid') delete p.dash; else p.dash = d }))
  }
  const setHead = (h: string) => {
    setStyle({ arrowHead: h })
    styleSelection(it => { if (it.type === 'arrow') it.head = h })
  }
  const setFillEnabled = (on: boolean) => {
    setStyle({ fillEnabled: on })
    applyBrush(styleRef.current)
  }
  const setFillColor = (c: string) => {
    setStyle({ fillColor: c, fillEnabled: true })
    applyBrush(styleRef.current)
  }
  const setFillColor2 = (c: string) => { setStyle({ fillColor2: c }); applyBrush(styleRef.current) }
  const setFillStyle = (f: string) => {
    setStyle({ fillStyle: f })
    if (styleRef.current.fillEnabled) applyBrush(styleRef.current)
  }
  const setFont = (patch: Partial<Style>) => {
    setStyle(patch)
    const st = styleRef.current
    styleSelection(it => {
      if (it.type === 'text') Object.assign(it, { family: st.family, size: st.size, bold: st.bold, italic: st.italic })
      else if ('label' in it || ['rect', 'ellipse', 'roundrect', 'arc', 'polygon'].includes(it.type)) {
        Object.assign(it, { labelFamily: st.family, labelSize: st.size, labelBold: st.bold, labelItalic: st.italic })
      }
    })
  }
  const pickColor2 = (initial: string, apply: (c: string) => void) => {
    colorTarget.current = apply
    const inp = colorInput.current!
    inp.value = colorName(color(initial))
    inp.click()
  }

  // _pull_style_from: the option bar shows a single selected item's style.
  useEffect(() => {
    const it = sel.length === 1 ? sel[0] : null
    if (!it || it.type === 'group' || it.type === 'image') return
    if (it.type === 'text') {
      setStyle({ pen: { ...styleRef.current.pen, color: it.color }, family: it.family, size: Math.max(4, Math.round(it.size)),
        bold: it.bold, italic: it.italic })
      return
    }
    const p = (it as { pen: PenDict }).pen
    const patch: Partial<Style> = {}
    if (!p.none) {
      const w = LINE_WIDTHS.reduce((a, b) => (Math.abs(b - p.width) < Math.abs(a - p.width) ? b : a))
      patch.pen = { color: p.color, width: w, ...(p.dash ? { dash: p.dash } : {}) }
    }
    if (it.type === 'arrow') patch.arrowHead = it.head ?? 'filled'
    if (!isLine(it)) {
      const b = (it as { brush: BrushDict }).brush
      patch.fillEnabled = b !== null
      if (b && 'gradient' in b) {
        patch.fillColor = colorName(color(b.gradient.c1))
        patch.fillColor2 = colorName(color(b.gradient.c2))
        patch.fillStyle = b.gradient.kind
      } else if (b) {
        patch.fillColor = colorName(color(b.color))
        patch.fillStyle = 'solid'
      }
    }
    setStyle(patch)
  }, [sel])  // eslint-disable-line react-hooks/exhaustive-deps

  // ---- edit ops ----
  const selectAll = () => { setTool(POINTER); setSel(vectorItems(sceneRef.current)) }
  const deleteSelection = () => {
    if (!sel.length) return
    removeItems(sceneRef.current, sel)
    setSel([])
    capture()
  }
  const clipboard = useRef<Record<string, unknown>[] | null>(null)
  const copySelection = () => {
    if (!sel.length) return
    clipboard.current = copyDicts(sel)
    try { void navigator.clipboard?.writeText(JSON.stringify({ 'application/x-khervedoc-drawing-items': clipboard.current })) } catch { /* no clipboard */ }
  }
  const cutSelection = () => { copySelection(); deleteSelection() }
  const paste = () => {
    if (!clipboard.current) return
    setTool(POINTER)
    setSel(spawn(sceneRef.current, clipboard.current, 20))
    capture()
  }
  const duplicate = () => {
    if (!sel.length) return
    setTool(POINTER)
    setSel(spawn(sceneRef.current, copyDicts(sel), 20))
    capture()
  }
  const group = () => {
    const g = groupItems(sceneRef.current, sel)
    if (g) { setSel([g]); capture() }
  }
  const ungroup = () => {
    const groups = sel.filter((it): it is GroupItem => it.type === 'group')
    if (!groups.length) return
    setSel(ungroupItems(sceneRef.current, groups))
    capture()
  }
  const explode = () => {
    const created = explodeItems(sceneRef.current, sel)
    if (created.length) { setSel(created); capture() }
  }
  const mirror = (h: boolean) => { if (sel.length) { sel.forEach(it => mirrorItem(it, h)); capture() } }
  const doReorder = (where: string) => { if (sel.length === 1 && reorder(sceneRef.current, sel[0], where)) capture() }
  const rotateMode = () => {
    if (sel.length !== 1) return
    setTool(POINTER)
    centerOrigin(sel[0])
    setRotateTarget(sel[0])
  }

  const insertImage = () => fileInput.current?.click()
  const onImageFile = async (file: File) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    await img.decode().catch(() => null)
    URL.revokeObjectURL(url)
    if (!img.naturalWidth) return
    let w = img.naturalWidth
    let h = img.naturalHeight
    const maxSide = 400
    if (Math.max(w, h) > maxSide) {
      const k = maxSide / Math.max(w, h)
      w = Math.round(w * k)
      h = Math.round(h * k)
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const b64 = canvas.toDataURL('image/png').split(',')[1]
    const c = viewCenter()
    const it: Item = { type: 'image', image: b64, _w: w, _h: h, pos: { x: c.x - w / 2, y: c.y - h / 2 }, opacity: 1,
      rotation: 0, z: 0, scale: 1, _origin: { x: 0, y: 0 } }
    sceneRef.current.items.push(it)
    setTool(POINTER)
    setSel([it])
    capture()
  }

  // ---- properties edits ----
  const single = sel.length === 1 ? sel[0] : null
  const applyPosition = (x: number | null, y: number | null) => {
    if (!single) return
    const br = sceneBoundingRect(single)
    single.pos = { x: single.pos.x + (x === null ? 0 : x - br.x), y: single.pos.y + (y === null ? 0 : y - br.y) }
    capture()
  }
  const applyRotation = (r: number) => {
    if (!single) return
    centerOrigin(single)
    single.rotation = r
    capture()
  }
  const applyOpacity = (o: number) => { if (single) { single.opacity = o / 100; capture() } }
  const applyLabel = (text: string) => {
    if (!single || !['rect', 'ellipse', 'roundrect', 'arc', 'polygon'].includes(single.type)) return
    const it = single as { label?: string }
    if ((it.label ?? '') === text) return
    it.label = text
    capture()
  }

  // ---- save ----
  const save = async (): Promise<string | null> => {
    if (editing) finishTextEdit()
    const s = sceneRef.current
    const target = existing !== null ? withSuffix(existing, '.png') : await nextDrawingPath(imagesDir, exists)
    let rect = contentRect(s)
    if (rect.w <= 0 || rect.h <= 0) return null
    rect = { x: rect.x - MARGIN, y: rect.y - MARGIN, w: rect.w + 2 * MARGIN, h: rect.h + 2 * MARGIN }
    try {
      await writeText(withSuffix(target, '.svg'), saveSvg(s))
      await writeBytes(withSuffix(target, '.pdf'), sceneToPdf(s, rect))
      const pw = Math.max(1, Math.round(rect.w * 2))
      const ph = Math.max(1, Math.round(rect.h * 2))
      const canvas = await svgToCanvas(sceneToSvg(s, rect, pw, ph), pw, ph)
      const png = canvas ? await new Promise<Uint8Array | null>(res => canvas.toBlob(async b => res(b ? new Uint8Array(await b.arrayBuffer()) : null), 'image/png')) : null
      if (png) await writeBytes(target, png)
    } catch (e) {
      setStatus(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
      return 'error'
    }
    return target
  }
  const accept = async () => {
    const p = await save()
    if (p === 'error') return
    if (p === null) { close(null); return }
    close({ path: p, handoff: false })
  }
  const openInKhervePaint = async () => {
    if (!vectorItems(sceneRef.current).length && existing === null) {
      setStatus('Draw something first: KhervePaint opens the saved drawing.')
      return
    }
    const p = await save()
    if (p && p !== 'error') close({ path: p, handoff: true })
  }

  // ---- keyboard ----
  const onKeyDown = (ev: React.KeyboardEvent) => {
    const tag = (ev.target as HTMLElement).tagName
    const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
    const mod = ev.ctrlKey || ev.metaKey
    if (ev.key === 'Escape') {
      ev.stopPropagation()
      // Esc must not throw the drawing away: it ends the current gesture
      // and drops back to the pointer instead.
      if (editing) { finishTextEdit(); return }
      if (sel.length) setSel([])
      else setTool(POINTER)
      return
    }
    if (typing) return
    const key = ev.key.toLowerCase()
    const done = () => ev.preventDefault()
    if (mod && key === 'z' && !ev.shiftKey) { done(); undo(); return }
    if (mod && (key === 'y' || (key === 'z' && ev.shiftKey))) { done(); redo(); return }
    if (mod && key === 'c') { done(); copySelection(); return }
    if (mod && key === 'x') { done(); cutSelection(); return }
    if (mod && key === 'v') { done(); paste(); return }
    if (mod && key === 'd') { done(); duplicate(); return }
    if (mod && key === 'a') { done(); selectAll(); return }
    if (mod && key === 'g') { done(); if (ev.shiftKey) ungroup(); else group(); return }
    if (mod && (ev.key === ']' || ev.key === '}')) { done(); doReorder(ev.shiftKey ? 'front' : 'forward'); return }
    if (mod && (ev.key === '[' || ev.key === '{')) { done(); doReorder(ev.shiftKey ? 'back' : 'backward'); return }
    if (mod && (ev.key === '=' || ev.key === '+')) { done(); zoomBy(1.25); return }
    if (mod && ev.key === '-') { done(); zoomBy(1 / 1.25); return }
    if (mod && ev.key === '0') { done(); zoomToContent(); return }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { done(); deleteSelection(); return }
    if (ev.key === 'Enter') { done(); return }
    if (!mod && !ev.altKey) {
      const t = DIRECT_TOOLS.find(d => d[3] === ev.key.toUpperCase())
      if (t) { done(); setTool(t[0]) }
    }
  }

  // ---- context menu ----
  const onContextMenu = (ev: React.MouseEvent) => {
    ev.preventDefault()
    if (tool === CHEM_CHAIN) { chain.current = null; setPreview([]); return }
    if (tool === PROTRACTOR) { angle.current = null; setPreview([]); return }
    const it = topAt(toScene(ev))
    if (!it) return
    if (!sel.includes(it)) setSel([it])
    const ic = (n: string) => <PaintIcon name={n} size={18} />
    const entries: MenuEntry[] = []
    if (it.type === 'text') entries.push({ label: 'Edit text', action: () => setEditing(it) })
    entries.push({ label: 'Rotate', icon: ic('rotate'), action: () => { setSel([it]); setRotateTarget(it); centerOrigin(it) } },
      { label: 'Duplicate', icon: ic('duplicate'), action: duplicate },
      { label: 'Copy', icon: ic('copy'), action: copySelection },
      { label: 'Delete', icon: ic('delete'), action: deleteSelection }, '-')
    for (const [name, label] of [['front', 'Bring to front'], ['forward', 'Bring forward'], ['backward', 'Send backward'], ['back', 'Send to back']]) {
      entries.push({ label, icon: ic(name), action: () => doReorder(name) })
    }
    entries.push('-', { label: 'Flip horizontal', icon: ic('flip_h'), action: () => mirror(true) },
      { label: 'Flip vertical', icon: ic('flip_v'), action: () => mirror(false) })
    if (it.type === 'group') entries.push({ label: 'Ungroup', icon: ic('ungroup'), action: ungroup })
    else entries.push({ label: 'Group selection', icon: ic('group'), action: group },
      { label: 'Break into edges', icon: ic('explode'), action: explode })
    void showMenu(entries, ev.clientX, ev.clientY)
  }

  // ---- palette menus ----
  const pickGrouped = (title: string, t: string) => {
    setGroupPick(g => ({ ...g, [title]: t }))
    setTool(t)
  }
  const groupMenu = (ev: React.MouseEvent, title: string, items: [string, string][]) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    void showMenu(items.map(([t, label]) => ({ label, icon: <PaintIcon name={t} size={18} />, action: () => pickGrouped(title, t) })),
      r.right, r.top)
  }
  const chemMenu = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    void showMenu([{ section: 'Bonds' }, ...CHEM_BONDS.map(([t, label]) => ({ label, action: () => pickGrouped('chemistry', t) })),
      { section: 'Rings' }, ...CHEM_RINGS.map(([t, label]) => ({ label, action: () => pickGrouped('chemistry', t) })),
      { label: 'Atom / group label', sub: ATOMS.map(a => ({ label: a, action: () => { chemAtom.current = a; pickGrouped('chemistry', CHEM_ATOM) } })) }],
    r.right, r.top)
  }
  const libraryMenu = (ev: React.MouseEvent, key: keyof typeof SYMBOL_MODULES, t: string, icon: string) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    const mod = SYMBOL_MODULES[key] as SymbolModule
    const cats = mod.CATEGORIES ?? [['', Object.keys(mod.SIZES)]]
    const entries: MenuEntry[] = []
    for (const [cat, names] of cats) {
      if (cat) entries.push({ section: cat })
      for (const name of names) {
        entries.push({ label: mod.LABELS[name] ?? name.replaceAll('_', ' '), action: () => {
          setSymbolPick(p => ({ ...p, [key]: name }))
          pickGrouped(icon, t)
          setStatus('Click on the canvas to place the symbol.')
        } })
      }
    }
    void showMenu(entries, r.right, r.top)
  }

  // ---- render ----
  const items = vectorItems(scene)
  const g = gridSize(scene)
  const gridLines: ReactNode[] = []
  if (scene.showGrid && g * zoom >= 4) {
    for (let x = Math.ceil(area.x / g) * g; x <= area.x + area.w; x += g) gridLines.push(<line key={`x${x}`} x1={x} y1={area.y} x2={x} y2={area.y + area.h} />)
    for (let y = Math.ceil(area.y / g) * g; y <= area.y + area.h; y += g) gridLines.push(<line key={`y${y}`} x1={area.x} y1={y} x2={area.x + area.w} y2={y} />)
  }
  const selBoxes = sel.map(it => sceneBoundingRect(it))
  const handles = single ? handlesFor(single, handleKind(single, rotateTarget === single)) : []
  const toolChecked = (t: string) => tool === t
  const groupChecked = (title: string, members: string[]) => members.includes(tool) && (groupPick[title] ?? members[0]) === tool
  const btn = (key: string, icon: string, tip: string, checked: boolean, onClick: (ev: React.MouseEvent) => void, popup = false) => (
    <button key={key} type='button' className={'kd-tb' + (checked ? ' checked' : '')} title={tip}
      style={{ width: 38, height: 38, position: 'relative' }} onClick={onClick}>
      <PaintIcon name={icon} size={24} />
      {popup && <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 8, color: '#555' }}>▼</span>}
    </button>
  )
  const section = (title: string) => <div key={`s-${title}`} style={{ gridColumn: '1 / 3', textAlign: 'center', color: '#808080', fontSize: 10 }}>{title}</div>

  const palette: ReactNode[] = []
  DIRECT_TOOLS.forEach(([t, icon, label, sc], i) => {
    if (i === 0) palette.push(section('Tools'))
    if (t === LINE) palette.push(section('Lines'))
    if (t === RECT) palette.push(section('Shapes'))
    palette.push(btn(t, icon, sc ? `${label} (${sc})` : label, toolChecked(t), () => setTool(t)))
  })
  for (const [title, members] of SHAPE_GROUPS) {
    const shown = groupPick[title] ?? members[0][0]
    palette.push(btn(title, shown, title, groupChecked(title, members.map(m => m[0])), ev => groupMenu(ev, title, members), true))
  }
  palette.push(section('Symbols'))
  palette.push(btn('chemistry', 'chemistry', 'Chemistry: bonds, rings, atoms', CHEM_TOOLS.includes(tool), chemMenu, true))
  for (const [icon, tip, key, t] of SYMBOL_LIBRARIES) {
    palette.push(btn(icon, icon, tip, tool === t, ev => libraryMenu(ev, key, t, icon), true))
  }
  palette.push(section('Insert'))
  palette.push(btn('image', 'image', 'Insert image…', false, insertImage))

  const pr = single ? sceneBoundingRect(single) : null
  const mmK = 25.4 / Math.max(scene.dpi, 1)
  let sizeText = ''
  if (sel.length > 1) {
    const r = selBoxes.reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }))
    sizeText = `${(r.w * mmK).toFixed(1)} × ${(r.h * mmK).toFixed(1)} mm`
  } else if (single && pr) {
    sizeText = isLine(single) ? `length ${(Math.hypot(single.x2 - single.x1, single.y2 - single.y1) * mmK).toFixed(1)} mm`
      : `${(pr.w * mmK).toFixed(1)} × ${(pr.h * mmK).toFixed(1)} mm`
  }
  const labelled = single && ['rect', 'ellipse', 'roundrect', 'arc', 'polygon'].includes(single.type)
  const arrowRowOn = tool === ARROW || leaves(sel).some(it => it.type === 'arrow')
  const fillName = colorName(color(style.fillColor))
  const arrange: [string, string, () => void][] = [
    ['front', 'Bring to front (Ctrl+Shift+])', () => doReorder('front')],
    ['forward', 'Bring forward (Ctrl+])', () => doReorder('forward')],
    ['backward', 'Send backward (Ctrl+[)', () => doReorder('backward')],
    ['back', 'Send to back (Ctrl+Shift+[)', () => doReorder('back')],
    ['group', 'Group (Ctrl+G)', group], ['ungroup', 'Ungroup (Ctrl+Shift+G)', ungroup],
    ['flip_h', 'Flip horizontal', () => mirror(true)], ['flip_v', 'Flip vertical', () => mirror(false)],
    ['rotate', 'Rotate (drag the round handle)', rotateMode], ['explode', 'Break shape into its edges', explode],
    ['duplicate', 'Duplicate (Ctrl+D)', duplicate], ['delete', 'Delete (Del)', deleteSelection],
  ]
  const fillMenu = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    void showMenu([
      { label: 'No Fill', icon: <Swatch color='#ffffff' none />, action: () => setFillEnabled(false) },
      ...PALETTE.map(c => ({ label: c, icon: <Swatch color={c} />, action: () => setFillColor(c) })),
      '-', { label: 'More Colours…', action: () => pickColor2(style.fillColor, setFillColor) },
    ], r.left, r.bottom)
  }

  return (
    <div className='kd-dialog' style={{ width: 1280, height: 820 }} onKeyDown={onKeyDown}>
      <div className='kd-titlebar'>{existing ? 'Edit Drawing' : 'Drawing'}</div>
      <div className='kd-body' style={{ padding: '6px 8px 8px' }}>
        {/* options bar */}
        <div className='kd-row' style={{ background: '#fff', border: '1px solid #b4b4b4', borderRadius: 6, padding: '3px 6px', gap: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
          <button type='button' className='kd-tb' title='Undo (Ctrl+Z)' disabled={histI.current <= 0} onClick={undo}>↶</button>
          <button type='button' className='kd-tb' title='Redo (Ctrl+Shift+Z)' disabled={histI.current >= history.current.length - 1} onClick={redo}>↷</button>
          <span className='kd-vsep' style={{ width: 1, height: 22, background: '#c8c8c8' }} />
          <span>Stroke</span>
          <button type='button' className='kd-tb' title='Stroke colour' onClick={() => pickColor2(style.pen.color, setStrokeColor)}>
            <Swatch color={colorName(color(style.pen.color))} size={20} /></button>
          <select title='Line width (px)' value={style.pen.width} onChange={e => setWidth(Number(e.target.value))}>
            {LINE_WIDTHS.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <span title='Line style' className='kd-row' style={{ gap: 0 }}>
            <PenPreview dash={style.pen.dash ?? 'solid'} />
            <select value={style.pen.dash ?? 'solid'} onChange={e => setDash(e.target.value as Dash)} style={{ minWidth: 30, width: 30 }}>
              {DASHES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </span>
          <span title='Arrowhead' className='kd-row' style={{ gap: 0, opacity: arrowRowOn ? 1 : 0.4 }}>
            <PenPreview head={style.arrowHead} />
            <select disabled={!arrowRowOn} value={style.arrowHead} onChange={e => setHead(e.target.value)} style={{ minWidth: 30, width: 30 }}>
              {HEADS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </span>
          <span style={{ width: 1, height: 22, background: '#c8c8c8' }} />
          <label className='kd-row' title='Fill new shapes' style={{ gap: 3 }}>
            <input type='checkbox' checked={style.fillEnabled} onChange={e => setFillEnabled(e.target.checked)} />Fill</label>
          <button type='button' className='kd-tb' title='Fill colour' onClick={() => pickColor2(style.fillColor, setFillColor)}>
            <Swatch color={fillName} size={20} /></button>
          <select title='Fill style' value={style.fillStyle} onChange={e => setFillStyle(e.target.value)}>
            {FILL_STYLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button type='button' className='kd-tb' title='Gradient end colour' disabled={style.fillStyle === 'solid'}
            onClick={() => pickColor2(style.fillColor2, setFillColor2)}><Swatch color={style.fillColor2} size={20} /></button>
          <span style={{ width: 1, height: 22, background: '#c8c8c8' }} />
          <select title='Text font' style={{ maxWidth: 150 }} value={style.family} onChange={e => setFont({ family: e.target.value })}>
            {(FONT_FAMILIES.includes(style.family) ? FONT_FAMILIES : [style.family, ...FONT_FAMILIES]).map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className='kd-row' style={{ gap: 2 }} title='Text size'>
            <input type='number' min={4} max={144} style={{ width: 52 }} value={style.size}
              onChange={e => setFont({ size: Math.max(4, Math.min(144, Math.round(Number(e.target.value) || 4))) })} />pt</span>
          <button type='button' className={'kd-tb' + (style.bold ? ' checked' : '')} title='Bold text' onClick={() => setFont({ bold: !style.bold })}><b>B</b></button>
          <button type='button' className={'kd-tb' + (style.italic ? ' checked' : '')} title='Italic text' onClick={() => setFont({ italic: !style.italic })}><i>I</i></button>
          <span style={{ width: 1, height: 22, background: '#c8c8c8' }} />
          {PALETTE.map(c => (
            <button key={c} type='button' className='kd-tb' title={`${c} — click: stroke, right-click: fill`}
              onClick={() => setStrokeColor(c)} onContextMenu={e => { e.preventDefault(); setFillColor(c) }}>
              <Swatch color={c} size={16} /></button>
          ))}
          <span className='kd-stretch' />
          <button type='button' className='kd-tb' title='Zoom out' onClick={() => zoomBy(1 / 1.25)}>−</button>
          <button type='button' className='kd-tb' title='Reset zoom to 100%' style={{ minWidth: 48 }} onClick={zoomReset}>{Math.round(zoom * 100)}%</button>
          <button type='button' className='kd-tb' title='Zoom in' onClick={() => zoomBy(1.25)}>+</button>
          <button type='button' className='kd-tb' title='Zoom to drawing' onClick={zoomToContent}><PaintIcon name='fit' size={20} /></button>
        </div>

        <div className='kd-row' style={{ flex: 1, minHeight: 0, alignItems: 'stretch', gap: 6 }}>
          {/* tool palette */}
          <div style={{ width: 88, background: '#fff', border: '1px solid #b4b4b4', borderRadius: 6, padding: '6px 4px', overflowY: 'auto',
            display: 'grid', gridTemplateColumns: '38px 38px', gap: 2, alignContent: 'start', justifyContent: 'center' }}>
            {palette}
          </div>
          {/* canvas */}
          <div ref={viewRef} className='kd-view' tabIndex={0} style={{ flex: 1, minWidth: 420, background: '#ffffff', cursor: tool === POINTER ? cursor : 'crosshair' }}
            onWheel={ev => { if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15) } }}>
            <svg ref={svgRef} width={area.w * zoom} height={area.h * zoom} viewBox={`${area.x} ${area.y} ${area.w} ${area.h}`}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
              onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
              <rect x={area.x} y={area.y} width={area.w} height={area.h} fill='#ffffff' />
              {scene.raster && <image x={0} y={0} width={scene.rasterW ?? scene.width} height={scene.rasterH ?? scene.height}
                href={`data:image/png;base64,${scene.raster}`} />}
              <g stroke='rgba(26,109,216,0.16)' strokeWidth={1 / zoom}>{gridLines}</g>
              {items.map((it, i) => (
                <g key={i} style={{ display: editing === it ? 'none' : undefined }}
                  dangerouslySetInnerHTML={{ __html: primsToSvg([itemPrims(it, scene.dpi)], `i${i}`) }} />
              ))}
              {preview.map((it, i) => <g key={`p${i}`} dangerouslySetInnerHTML={{ __html: primsToSvg([itemPrims(it, scene.dpi)], `p${i}`) }} />)}
              {selBoxes.map((r, i) => <rect key={`s${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill='none'
                stroke='#2176c7' strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />)}
              {handles.length > 0 && handles[0].role === 'rotate' && (
                <line x1={handles[1].p.x} y1={handles[1].p.y} x2={handles[0].p.x} y2={handles[0].p.y} stroke='#2e9e5b'
                  strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${2 / zoom}`} />)}
              {handles.filter(h => h.role !== 'centre').map(h => (h.round
                ? <circle key={h.role} cx={h.p.x} cy={h.p.y} r={(h.role === 'rotate' ? 5.5 : 4.5) / zoom}
                  fill={h.role === 'rotate' ? '#2e9e5b' : '#ffffff'} stroke={h.role === 'rotate' ? '#2e9e5b' : '#2176c7'} strokeWidth={1 / zoom} />
                : <rect key={h.role} x={h.p.x - 4.5 / zoom} y={h.p.y - 4.5 / zoom} width={9 / zoom} height={9 / zoom}
                  fill='#ffffff' stroke='#2176c7' strokeWidth={1 / zoom} />))}
              {band && <rect x={band.x} y={band.y} width={band.w} height={band.h} fill='rgba(33,118,199,0.12)' stroke='#2176c7' strokeWidth={1 / zoom} />}
              {editing && (() => {
                const m = itemToParent(editing)
                const tb = textBounds(editing)
                return (
                  <foreignObject x={0} y={0} width={Math.max(tb.w + 60, 120)} height={tb.h + 20}
                    transform={`matrix(${m.join(',')})`}>
                    <textarea autoFocus defaultValue={editing.text} spellCheck={false}
                      ref={el => { if (el && document.activeElement !== el) { el.focus(); el.select() } }}
                      onChange={e => { editing.text = e.target.value; redraw() }}
                      onBlur={finishTextEdit}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') finishTextEdit() }}
                      style={{ width: '100%', height: '100%', border: '1px dashed #2176c7', padding: 3, margin: 0, resize: 'none',
                        background: 'rgba(255,255,255,0.9)', boxSizing: 'border-box', overflow: 'hidden',
                        font: `${editing.italic ? 'italic ' : ''}${editing.bold ? 'bold ' : ''}${editing.size}px "${editing.family}", Helvetica, sans-serif`,
                        color: colorName(color(editing.color)), lineHeight: 'normal' }} />
                  </foreignObject>
                )
              })()}
            </svg>
          </div>
          {/* properties */}
          <div style={{ width: 236, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <fieldset style={{ border: '1px solid #c8c8c8', borderRadius: 4, padding: '6px 8px 8px' }}>
              <legend>Selection</legend>
              <div className='kd-form'>
                <label>Type</label><span>{!sel.length ? '—' : single ? TYPE_NAMES[single.type] : `${sel.length} items`}</span>
                <label>X</label>
                <input type='number' step={1} disabled={!single} value={pr ? pr.x.toFixed(1) : '0.0'}
                  onChange={e => applyPosition(Number(e.target.value), null)} />
                <label>Y</label>
                <input type='number' step={1} disabled={!single} value={pr ? pr.y.toFixed(1) : '0.0'}
                  onChange={e => applyPosition(null, Number(e.target.value))} />
                <label>Size</label><span>{sizeText}</span>
                <label>Rotation</label>
                <input type='number' step={5} min={-360} max={360} disabled={!single} value={single ? single.rotation.toFixed(1) : '0.0'}
                  onChange={e => applyRotation(Number(e.target.value))} />
                <label>Opacity</label>
                <input type='number' min={0} max={100} disabled={!single} value={single ? Math.round(single.opacity * 100) : 100}
                  onChange={e => applyOpacity(Number(e.target.value))} />
                <label>Label</label>
                <input type='text' placeholder='Text inside the shape' disabled={!labelled}
                  key={single ? items.indexOf(single) : -1} defaultValue={labelled ? ((single as { label?: string }).label ?? '') : ''}
                  onBlur={e => applyLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyLabel((e.target as HTMLInputElement).value) }} />
              </div>
            </fieldset>
            <fieldset style={{ border: '1px solid #c8c8c8', borderRadius: 4, padding: '6px 8px 8px' }}>
              <legend>Shape Fill</legend>
              <button type='button' className='kd-btn' style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6 }}
                title='Fill the selected shapes and new ones with a colour, or leave them unfilled (No Fill)' onClick={fillMenu}>
                {style.fillEnabled ? <Swatch color={fillName} /> : <Swatch color='#ffffff' none />}
                <span className='kd-stretch' style={{ textAlign: 'left' }}>{style.fillEnabled ? `Fill: ${fillName}` : 'No Fill'}</span>▾
              </button>
            </fieldset>
            <fieldset style={{ border: '1px solid #c8c8c8', borderRadius: 4, padding: 6 }}>
              <legend>Arrange</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
                {arrange.map(([name, tip, fn]) => (
                  <button key={name} type='button' className='kd-tb' title={tip} disabled={!sel.length} onClick={fn}>
                    <PaintIcon name={name} size={22} /></button>
                ))}
              </div>
            </fieldset>
            <fieldset style={{ border: '1px solid #c8c8c8', borderRadius: 4, padding: '6px 8px 8px' }}>
              <legend>Canvas</legend>
              <div className='kd-form'>
                <span /><label className='kd-row'><input type='checkbox' checked={ui.showGrid}
                  onChange={e => { setUi({ ...ui, showGrid: e.target.checked }); scene.showGrid = e.target.checked }} />Show grid</label>
                <span /><label className='kd-row'><input type='checkbox' checked={ui.snap}
                  onChange={e => { setUi({ ...ui, snap: e.target.checked }); scene.snap = e.target.checked }} />Snap to grid</label>
                <label>Grid</label>
                <span className='kd-row' style={{ gap: 2 }}><input type='number' min={0.5} max={50} step={0.5} style={{ width: 70 }} value={ui.gridMm}
                  onChange={e => { const v = Math.max(0.5, Math.min(50, Number(e.target.value) || 0.5)); setUi({ ...ui, gridMm: v }); scene.gridMm = v }} />mm</span>
                <span /><label className='kd-row'><input type='checkbox' checked={ui.rulers}
                  onChange={e => setUi({ ...ui, rulers: e.target.checked })} />Rulers</label>
                <label>Width</label>
                <span className='kd-row' style={{ gap: 2 }}><input type='number' min={50} max={20000} style={{ width: 80 }} value={Math.trunc(scene.width)}
                  onChange={e => { scene.width = Math.max(50, Math.min(20000, Math.trunc(Number(e.target.value) || 50))); capture() }} />px</span>
                <label>Height</label>
                <span className='kd-row' style={{ gap: 2 }}><input type='number' min={50} max={20000} style={{ width: 80 }} value={Math.trunc(scene.height)}
                  onChange={e => { scene.height = Math.max(50, Math.min(20000, Math.trunc(Number(e.target.value) || 50))); capture() }} />px</span>
                <span />
                <button type='button' className='kd-tb' style={{ flexDirection: 'row', justifyContent: 'flex-start' }}
                  title="Shrink the page to the drawing's bounding box. The exported figure is always cropped to the content."
                  onClick={() => { fitToContent(scene, null, 10); capture() }}>
                  <PaintIcon name='fit' size={18} /> Crop page to drawing</button>
              </div>
            </fieldset>
            <div style={{ color: '#808080', fontSize: 11 }}>
              Double-click a shape to rotate it, a text to edit it. Right-click for more. Shift/Ctrl+click adds to the selection.
            </div>
          </div>
        </div>

        <div className='kd-row'>
          <span className='kd-stretch kd-muted'>{status}</span>
          <button type='button' className='kd-btn default' onClick={() => void accept()}>OK</button>
          <button type='button' className='kd-btn' title='Save this drawing and continue editing it in the full KhervePaint app. Its saves update the figure.'
            onClick={() => void openInKhervePaint()}>Open in KhervePaint…</button>
          <button type='button' className='kd-btn' onClick={() => close(null)}>Cancel</button>
        </div>
      </div>
      <input ref={fileInput} type='file' accept='.png,.jpg,.jpeg,.bmp,.gif,.tif,.tiff,.webp,image/*' style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void onImageFile(f); e.target.value = '' }} />
      <input ref={colorInput} type='color' style={{ display: 'none' }} onChange={e => colorTarget.current(e.target.value)} />
    </div>
  )
}

// ------------------------------------------------------------ helpers
const rectsMeet = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const l2 = vx * vx + vy * vy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy)
}

function insidePolys(polys: Pt[][], p: Pt): boolean {
  let inside = false
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]
      const b = poly[j]
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
  }
  return inside
}

// The item's shape under the pointer: an outline for hollow shapes (a
// filled or labelled one keeps its clickable interior), the pen's ribbon
// at least 8 px wide for lines.
function hitItem(it: Item, scenePt: Pt, tol: number): boolean {
  const p = mapPt(matInvert(itemToParent(it)), scenePt)
  if (it.type === 'group') return it.children.some(c => hitItem(c, p, tol))
  if (it.type === 'text' || it.type === 'image') {
    const r = boundingRect(it)
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
  }
  if (isLine(it)) {
    const half = Math.max(it.pen.width, 8) / 2 + tol
    return flatten(curvePath(it)).some(line => line.some((q, i) => i > 0 && segDist(p, line[i - 1], q) <= half))
  }
  const path = outlinePath(it) ?? []
  const polys = flatten(path)
  const half = Math.max((it as { pen: PenDict }).pen.width, 8) / 2 + tol
  if (polys.some(line => line.some((q, i) => i > 0 && segDist(p, line[i - 1], q) <= half))) return true
  const hollow = (it as { brush: BrushDict }).brush === null && !(it as { label?: string }).label
  return !hollow && insidePolys(polys, p)
}

async function svgToCanvas(svg: string, w: number, h: number): Promise<HTMLCanvasElement | null> {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  try { await img.decode() } catch { return null }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas
}

// fill.flood_runs: a scanline flood of similar colour from (sx, sy).
function floodRuns(img: ImageData, sx: number, sy: number, tol: number): [number, number, number][] {
  const { width: w, height: h, data } = img
  const base = (sy * w + sx) * 4
  const [tr, tg, tb] = [data[base], data[base + 1], data[base + 2]]
  const match = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return Math.abs(data[i] - tr) <= tol && Math.abs(data[i + 1] - tg) <= tol && Math.abs(data[i + 2] - tb) <= tol
  }
  const visited = new Uint8Array(w * h)
  const runs: [number, number, number][] = []
  const stack: [number, number][] = [[sx, sy]]
  while (stack.length) {
    const [x, y] = stack.pop()!
    const row = y * w
    if (visited[row + x] || !match(x, y)) continue
    let xl = x
    while (xl > 0 && !visited[row + xl - 1] && match(xl - 1, y)) xl--
    let xr = x
    while (xr < w - 1 && !visited[row + xr + 1] && match(xr + 1, y)) xr++
    for (let xx = xl; xx <= xr; xx++) visited[row + xx] = 1
    runs.push([y, xl, xr])
    for (let xx = xl; xx <= xr; xx++) {
      if (y > 0 && !visited[row - w + xx] && match(xx, y - 1)) stack.push([xx, y - 1])
      if (y < h - 1 && !visited[row + w + xx] && match(xx, y + 1)) stack.push([xx, y + 1])
    }
  }
  return runs
}

// Runs stacked with the same span merge into one rectangle.
function mergeRuns(runs: [number, number, number][]): [[number, number], number, number][] {
  const sorted = [...runs].sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
  const out: [[number, number], number, number][] = []
  for (const [y, xl, xr] of sorted) {
    const last = out[out.length - 1]
    if (last && last[1] === xl && last[2] === xr && last[0][1] === y - 1) last[0][1] = y
    else out.push([[y, y], xl, xr])
  }
  return out
}

// DrawingDialog(images_dir, parent, existing_path).exec(): the PNG path of
// the saved drawing (siblings .svg and .pdf written next to it) and
// whether "Open in KhervePaint" closed it; null on Cancel / nothing drawn.
export function openDrawingDialog(imagesDir: string, existing: string | null, start?: DrawingStart): Promise<DrawingResult | null> {
  void platform
  return openModal<DrawingResult>(close => <DrawingDialog imagesDir={imagesDir} existing={existing} close={close} start={start} />)
}
