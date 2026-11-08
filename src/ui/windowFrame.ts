// Dialogs behave as Qt's top-level QDialog windows: the title bar moves
// them and (except for message boxes, which Qt keeps at a fixed size)
// their edges and corners resize them. One set of document listeners
// serves every dialog — dialogHost, the drawing modals, message boxes and
// the welcome screen — so no component carries drag code of its own.
//
// A dialog opens centred by its veil's flexbox, as Qt centres a dialog on
// its parent. The first drag or resize pins it to `position: fixed` at the
// place it stands, so a dialog that grows afterwards (a tab with more
// rows) keeps its top-left corner where the user put it, as a window does.

// The window frames, and the title bar each one is moved by (a direct child).
const WINDOW = '.dlg, .kd-dialog, .kmb, .kwin'
const TITLE = '.dlg-title, .kd-titlebar, .kmb-title, .kwin-title'
// The click-blocking veils behind modal windows.
const VEIL = '.dlg-backdrop, .kd-veil, .kmb-veil'
// Message boxes are not resizable (QMessageBox).
const FIXED = '.kmb'
// Controls inside a title bar (a close button) keep their clicks.
const CONTROL = 'button, input, select, textarea, a, [role=tab]'
// How close to the frame's edge the pointer resizes rather than clicks.
const EDGE = 5
// How much of the title bar must stay on screen so it can be grabbed again.
const KEEP = 48

type Edges = { l: boolean; r: boolean; t: boolean; b: boolean }

function edgesAt(win: HTMLElement, x: number, y: number): Edges | null {
  if (win.matches(FIXED)) return null
  const r = win.getBoundingClientRect()
  const e = { l: x - r.left < EDGE, r: r.right - x < EDGE, t: y - r.top < EDGE, b: r.bottom - y < EDGE }
  return e.l || e.r || e.t || e.b ? e : null
}

function cursorFor(e: Edges): string {
  if ((e.l && e.t) || (e.r && e.b)) return 'nwse-resize'
  if ((e.r && e.t) || (e.l && e.b)) return 'nesw-resize'
  return e.l || e.r ? 'ew-resize' : 'ns-resize'
}

// Take the window out of the veil's centring, leaving it where it stands.
function pin(win: HTMLElement): DOMRect {
  const r = win.getBoundingClientRect()
  if (win.dataset.pinned !== '1') {
    win.dataset.pinned = '1'
    Object.assign(win.style, {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, margin: '0',
    })
  }
  return r
}

function clampLeft(left: number, width: number): number {
  return Math.min(Math.max(left, KEEP - width), window.innerWidth - KEEP)
}

function clampTop(top: number): number {
  return Math.min(Math.max(top, 0), window.innerHeight - 24)
}

function startMove(win: HTMLElement, ev: PointerEvent) {
  const r = pin(win)
  const dx = ev.clientX - r.left
  const dy = ev.clientY - r.top
  track(ev, e => {
    win.style.left = `${clampLeft(e.clientX - dx, r.width)}px`
    win.style.top = `${clampTop(e.clientY - dy)}px`
  }, 'default')
}

function startResize(win: HTMLElement, ev: PointerEvent, edges: Edges) {
  const r = pin(win)
  const cs = getComputedStyle(win)
  const minW = Math.max(parseFloat(cs.minWidth) || 0, 160)
  const minH = Math.max(parseFloat(cs.minHeight) || 0, 80)
  // A resized window is as big as the user makes it: drop the viewport caps.
  win.classList.add('win-sized')
  Object.assign(win.style, { maxWidth: 'none', maxHeight: 'none', minWidth: '0', minHeight: '0' })
  track(ev, e => {
    const dx = e.clientX - ev.clientX
    const dy = e.clientY - ev.clientY
    let { left, top, width, height } = r
    if (edges.r) width = Math.max(minW, r.width + dx)
    if (edges.b) height = Math.max(minH, r.height + dy)
    if (edges.l) { width = Math.max(minW, r.width - dx); left = r.right - width }
    if (edges.t) {
      height = Math.max(minH, r.height - dy)
      top = r.bottom - height
      if (top < 0) { height += top; top = 0 }
    }
    Object.assign(win.style, {
      left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
    })
  }, cursorFor(edges))
}

// Follow the pointer until it is released. The cursor is forced on the
// whole page meanwhile so it does not flicker over whatever is beneath.
function track(ev: PointerEvent, move: (e: PointerEvent) => void, cursor: string) {
  ev.preventDefault()
  const root = document.documentElement
  const old = root.style.cursor
  root.style.cursor = cursor
  root.classList.add('win-tracking')
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    root.style.cursor = old
    root.classList.remove('win-tracking')
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

// A click on the veil, or on a bare part of a window, must not take the
// keyboard focus away from the dialog: Qt keeps it in the modal dialog,
// and the dialogs' Escape and Enter handlers only hear keys from inside.
// The frame itself takes focus (tabIndex -1) when nothing inside does.
function onMouseDown(ev: MouseEvent) {
  if (!(ev.target instanceof Element)) return
  if (ev.target.matches(VEIL)) { ev.preventDefault(); return }
  const win = ev.target.closest<HTMLElement>(WINDOW)
  if (win && win.tabIndex < 0 && !win.hasAttribute('tabindex')) win.tabIndex = -1
}

function onPointerDown(ev: PointerEvent) {
  if (ev.button !== 0 || !(ev.target instanceof Element)) return
  const win = ev.target.closest<HTMLElement>(WINDOW)
  if (!win) return
  const edges = edgesAt(win, ev.clientX, ev.clientY)
  if (edges) {
    ev.stopPropagation()
    startResize(win, ev, edges)
    return
  }
  const title = ev.target.closest<HTMLElement>(TITLE)
  if (!title || title.parentElement !== win || ev.target.closest(CONTROL)) return
  startMove(win, ev)
}

// The resize cursor over a frame's edges, as a window manager shows it.
let hovered: HTMLElement | null = null
function onPointerMove(ev: PointerEvent) {
  if (ev.buttons || !(ev.target instanceof Element)) return
  const win = ev.target.closest<HTMLElement>(WINDOW)
  if (hovered && hovered !== win) { hovered.style.cursor = ''; hovered = null }
  if (!win) return
  const edges = edgesAt(win, ev.clientX, ev.clientY)
  win.style.cursor = edges ? cursorFor(edges) : ''
  hovered = edges ? win : null
}

const CSS = `
.dlg:focus, .kd-dialog:focus, .kmb:focus, .kwin:focus { outline: none; }
.dlg-title, .kd-titlebar, .kmb-title, .kwin-title { user-select: none; }
.win-tracking, .win-tracking * { user-select: none !important; }
.win-tracking iframe, .win-tracking canvas { pointer-events: none; }
.win-sized > .dlg-body, .win-sized > .kd-body, .win-sized > .kmb-body { flex: 1 1 auto; min-height: 0; }
`

let installed = false
export function installWindowFrames() {
  if (installed) return
  installed = true
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('mousedown', onMouseDown, true)
}
