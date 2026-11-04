// Floating, non-modal palette of LaTeX symbols — SymbolPickerWindow of
// khervedoc/mainwindow.py. A tool window above the main window that does
// NOT block it, so the user can keep it open, drift between paragraphs and
// click glyphs to drop them in at the caret.
import { useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SYMBOL_GROUPS } from './symbols.ts'
import './math.css'

interface Props {
  onPick: (latex: string) => void
  onClose: () => void
}

export function SymbolPicker({ onPick, onClose }: Props) {
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 440 - 40) : 0,
    y: 90,
  }))
  const drag = useRef<[number, number] | null>(null)

  const startDrag = (ev: React.MouseEvent) => {
    if (ev.button !== 0) return
    drag.current = [ev.clientX - pos.x, ev.clientY - pos.y]
    const move = (e: MouseEvent) => {
      if (!drag.current) return
      setPos({ x: e.clientX - drag.current[0], y: Math.max(0, e.clientY - drag.current[1]) })
    }
    const up = () => {
      drag.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="sympick" role="dialog" aria-label="Symbols" style={{ left: pos.x, top: pos.y }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="sympick-title" onMouseDown={startDrag}>
        <span>Symbols</span>
        <button className="sympick-close" aria-label="Close" onMouseDown={e => e.stopPropagation()} onClick={onClose}>✕</button>
      </div>
      <div className="sympick-scroll">
        {SYMBOL_GROUPS.map(([groupName, items]) => (
          <div key={groupName}>
            <div className="sympick-group"><b>{groupName}</b></div>
            <div className="sympick-grid">
              {items.map(([latex, glyph]) => (
                // Keep the editor's caret: a click must not take the focus.
                <button key={latex} title={latex} onMouseDown={e => e.preventDefault()} onClick={() => onPick(latex)}>
                  {glyph}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

let host: { el: HTMLDivElement; root: Root } | null = null

// _insert_symbol: lazy-create the palette once, then re-show it.
export function showSymbolPicker(onPick: (latex: string) => void): void {
  if (!host) {
    const el = document.createElement('div')
    el.className = 'sympick-host'
    document.body.appendChild(el)
    host = { el, root: createRoot(el) }
  }
  host.el.hidden = false
  const hide = () => { if (host) host.el.hidden = true }
  host.root.render(<SymbolPicker onPick={onPick} onClose={hide} />)
}

export function hideSymbolPicker(): void {
  if (host) host.el.hidden = true
}
