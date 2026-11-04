// QMenu for the drawing dialogs: a popup at a point, with sections,
// separators, check marks, icons and submenus. `showMenu` resolves when
// the menu closes; a picked entry's action runs first.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './drawing.css'

export type MenuEntry =
  | { label: string; action?: () => void; checked?: boolean; icon?: ReactNode; sub?: MenuEntry[]; disabled?: boolean }
  | { section: string }
  | '-'

function MenuList({ entries, x, y, onDone }: { entries: MenuEntry[]; x: number; y: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [open, setOpen] = useState<{ i: number; x: number; y: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.max(0, Math.min(x, window.innerWidth - r.width - 2)),
      y: Math.max(0, Math.min(y, window.innerHeight - r.height - 2)) })
  }, [x, y])
  return (
    <div className='kd-menu' ref={ref} style={{ left: pos.x, top: pos.y }}
      onMouseDown={e => e.stopPropagation()}>
      {entries.map((e, i) => {
        if (e === '-') return <div key={i} className='kd-menu-sep' />
        if ('section' in e) return <div key={i} className='kd-menu-section'>{e.section}</div>
        return (
          <div key={i} className='kd-menu-item' style={e.disabled ? { color: '#a0a0a0' } : undefined}
            onMouseEnter={ev => {
              if (e.sub) {
                const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                setOpen({ i, x: r.right - 2, y: r.top - 4 })
              } else {
                setOpen(null)
              }
            }}
            onClick={() => {
              if (e.sub || e.disabled) return
              onDone()
              e.action?.()
            }}>
            {e.checked !== undefined && <span className='kd-check'>{e.checked ? '✓' : ''}</span>}
            {e.icon !== undefined && <span className='kd-icon'>{e.icon}</span>}
            <span>{e.label}</span>
            {e.sub && <span className='kd-sub'>▸</span>}
            {e.sub && open?.i === i && <MenuList entries={e.sub} x={open.x} y={open.y} onDone={onDone} />}
          </div>
        )
      })}
    </div>
  )
}

export function showMenu(entries: MenuEntry[], x: number, y: number): Promise<void> {
  return new Promise(resolve => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = () => {
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', esc, true)
      setTimeout(() => { root.unmount(); host.remove(); resolve() }, 0)
    }
    const away = (ev: MouseEvent) => {
      if (!host.contains(ev.target as globalThis.Node)) done()
    }
    const esc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); done() }
    }
    document.addEventListener('mousedown', away, true)
    document.addEventListener('keydown', esc, true)
    root.render(<MenuList entries={entries} x={x} y={y} onDone={done} />)
  })
}
