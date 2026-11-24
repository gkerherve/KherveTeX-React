// Qt-style hover help: rich text (tooltips.html) after a short delay,
// placed under the pointer and kept on screen.
import { MORE_TIPS } from './tooltipsMore'
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type MouseEvent, type ReactNode,
} from 'react'
import { TIPS, WIDGET_TIPS, type Tip } from './tooltips'

export type TipContent = { rich: Tip, shortcut?: string } | { plain: string }

interface Shown { content: TipContent, x: number, y: number }

interface TipApi {
  show: (content: TipContent, x: number, y: number) => void
  hide: () => void
}

const TipContext = createContext<TipApi>({ show: () => {}, hide: () => {} })

export function lookupTip(key: string): Tip | undefined {
  return TIPS[key] ?? MORE_TIPS[key] ?? WIDGET_TIPS[key]
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number, top: number } | null>(null)

  const show = useCallback((content: TipContent, x: number, y: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setPos(null)
      setShown({ content, x, y })
    }, 700)
  }, [])
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setShown(null)
  }, [])

  useEffect(() => {
    if (!shown || !box.current) return
    const r = box.current.getBoundingClientRect()
    let left = shown.x + 2
    let top = shown.y + 20
    if (left + r.width > window.innerWidth - 4) left = window.innerWidth - r.width - 4
    if (top + r.height > window.innerHeight - 4) top = shown.y - r.height - 6
    setPos({ left: Math.max(4, left), top: Math.max(4, top) })
  }, [shown])

  return (
    <TipContext.Provider value={{ show, hide }}>
      {children}
      {shown && (
        <div ref={box} className='qtip' role='tooltip'
          style={pos ?? { left: shown.x, top: shown.y + 20, visibility: 'hidden' }}>
          {'plain' in shown.content ? shown.content.plain : <RichTip {...shown.content} />}
        </div>
      )}
    </TipContext.Provider>
  )
}

function RichTip({ rich, shortcut }: { rich: Tip, shortcut?: string }) {
  return (
    <div className='qtip-rich'>
      <p><b>{rich.title}</b>
        {shortcut && <span className='qtip-muted'>&nbsp;&nbsp;({shortcut})</span>}</p>
      <p>{rich.what}</p>
      {rich.latex && <p className='qtip-muted'>In the PDF: {rich.latex}</p>}
      {rich.from && <p className='qtip-muted'>Comes from: {rich.from}</p>}
    </div>
  )
}

// Spread onto any element that should show hover help.
export function useTipProps(content: TipContent | null) {
  const api = useContext(TipContext)
  if (!content) return {}
  return {
    onMouseEnter: (e: MouseEvent) => api.show(content, e.clientX, e.clientY),
    onMouseLeave: () => api.hide(),
    onMouseDown: () => api.hide(),
  }
}
