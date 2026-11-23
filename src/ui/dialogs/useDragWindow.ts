// A dialog moved by its title bar, as a window: drag the bar (not its
// buttons and fields) and the dialog follows, kept on screen; a
// double-click on the bar puts it back in the middle.
import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

const NOT_A_HANDLE = 'button, input, select, textarea, a, [role="switch"], [contenteditable="true"]'

export function useDragWindow(box: RefObject<HTMLElement | null>): {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onDoubleClick: (e: ReactPointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => void
} {
  const off = useRef({ x: 0, y: 0 })
  const place = (x: number, y: number) => {
    const el = box.current
    if (!el) return
    off.current = { x, y }
    el.style.transform = x || y ? `translate(${x}px, ${y}px)` : ''
  }
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(NOT_A_HANDLE)) return
    const el = box.current
    if (!el) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }, from = { ...off.current }
    const r = el.getBoundingClientRect()
    // Keep at least 80 px of the bar on screen.
    const minX = from.x - r.left - r.width + 80, maxX = from.x + window.innerWidth - r.left - 80
    const minY = from.y - r.top, maxY = from.y + window.innerHeight - r.top - 40
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      place(Math.min(maxX, Math.max(minX, from.x + ev.clientX - start.x)),
        Math.min(maxY, Math.max(minY, from.y + ev.clientY - start.y)))
    }
    const up = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [box])
  const onDoubleClick = useCallback((e: { target: EventTarget }) => {
    if ((e.target as HTMLElement).closest(NOT_A_HANDLE)) return
    place(0, 0)
  }, [box])
  return { onPointerDown, onDoubleClick }
}
