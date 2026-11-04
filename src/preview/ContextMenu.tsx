// A QMenu at the pointer, for the PDF and Code views' right-click menus
// (their "Show in …" cross-tab actions).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextItem {
  label: string
  run?: () => void
  disabled?: boolean
}

// '-' is a separator.
export type ContextEntry = ContextItem | '-'

export interface ContextMenuState {
  x: number
  y: number
  items: ContextEntry[]
}

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!menu || !ref.current) { setPos(null); return }
    const r = ref.current.getBoundingClientRect()
    // Kept inside the window, as Qt flips a menu at the screen edge.
    setPos({
      x: Math.max(0, Math.min(menu.x, window.innerWidth - r.width - 2)),
      y: Math.max(0, Math.min(menu.y, window.innerHeight - r.height - 2)),
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
    }
  }, [menu, onClose])

  if (!menu) return null
  return (
    <div ref={ref} className='qmenu' role='menu'
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={e => e.preventDefault()}>
      {menu.items.map((it, i) => it === '-'
        ? <div key={i} className='qmenu-sep' />
        : (
          <div key={i} role='menuitem' className={'qmenu-item' + (it.disabled ? ' disabled' : '')}
            onMouseDown={e => e.preventDefault()}
            onClick={() => { if (it.disabled) return; onClose(); it.run?.() }}>
            <span className='qmenu-text'>{it.label}</span>
          </div>
        ))}
    </div>
  )
}
