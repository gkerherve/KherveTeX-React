// QMenu look-alike: popup lists with icons, check marks, a right-hand
// shortcut column and hover-opened submenus.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CommandState } from './commands'
import { Icon } from './icons'
import type { LiveItem } from './liveMenus'
import { COMMANDS, type MenuEntry } from './ribbonModel'

interface Resolved {
  text: string
  detail?: string
  icon?: string
  iconArg?: string
  command?: string
  checkable?: boolean
  checked?: boolean
  disabled?: boolean
  items?: MenuEntry[]
  onTrigger?: () => void
}

function resolve(e: MenuEntry, cmd: CommandState): Resolved | null {
  if (e === '-') return null
  if (typeof e === 'string') {
    const c = COMMANDS[e]
    if (!c) return { text: e }
    return { text: c.text, detail: c.shortcut, icon: c.icon, iconArg: c.iconArg,
      command: c.id, checkable: c.checkable, checked: cmd.isChecked(c.id) }
  }
  const c = e.command ? COMMANDS[e.command] : undefined
  return { ...(e as LiveItem), checked: c?.checkable ? cmd.isChecked(c.id) : e.checked,
    checkable: e.checkable ?? c?.checkable }
}

// Qt mnemonics: "&File" underlines F, "&&" is a literal ampersand.
export function Mnemonic({ text, show = true }: { text: string, show?: boolean }) {
  const out: ReactNode[] = []
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '&' && text[i + 1] === '&') { buf += '&'; i++; continue }
    if (ch === '&' && i + 1 < text.length) {
      out.push(buf); buf = ''
      const m = text[++i]
      out.push(show ? <u key={i}>{m}</u> : m)
      continue
    }
    buf += ch
  }
  out.push(buf)
  return <>{out}</>
}

export interface PopupProps {
  entries: MenuEntry[]
  anchor: DOMRect
  placement?: 'below' | 'right'
  cmd: CommandState
  onClose: () => void
  iconSize?: number
}

export function Popup({ entries, anchor, placement = 'below', cmd, onClose,
  iconSize = 16 }: PopupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number, top: number } | null>(null)
  const [sub, setSub] = useState<{ index: number, rect: DOMRect } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = placement === 'below' ? anchor.left : anchor.right - 2
    let top = placement === 'below' ? anchor.bottom : anchor.top - 3
    if (left + r.width > window.innerWidth - 2) {
      left = placement === 'below' ? window.innerWidth - r.width - 2 : anchor.left - r.width + 2
    }
    if (top + r.height > window.innerHeight - 2) {
      top = Math.max(2, window.innerHeight - r.height - 2)
    }
    setPos({ left: Math.max(2, left), top })
  }, [anchor, placement])

  useEffect(() => {
    if (placement !== 'below') return
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('.qmenu, [data-menu-owner]')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [placement, onClose])

  const items = entries.map(e => resolve(e, cmd))
  const hasIcons = items.some(it => it?.icon || it?.checkable)
  const hasDetail = items.some(it => it?.detail)

  return (
    <div ref={ref} className='qmenu' role='menu'
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom,
        visibility: pos ? 'visible' : 'hidden',
        ['--menu-icon' as string]: `${iconSize}px` }}>
      {items.map((it, i) => it === null
        ? <div key={i} className='qmenu-sep' />
        : (
          <div key={i} role='menuitem'
            className={'qmenu-item' + (sub?.index === i ? ' open' : '')
              + (it.disabled ? ' disabled' : '')}
            onMouseEnter={ev => setSub(it.items
              ? { index: i, rect: ev.currentTarget.getBoundingClientRect() } : null)}
            onClick={() => {
              if (it.items || it.disabled) return
              if (it.onTrigger) it.onTrigger()
              else if (it.command) cmd.trigger(it.command)
              else console.log(`menu:${it.text.replace(/&/g, '')}`)
              onClose()
            }}>
            {hasIcons && (
              <span className={'qmenu-icon' + (it.checked && it.icon ? ' on' : '')}>
                {it.icon
                  ? <Icon name={it.icon} arg={it.iconArg} size={iconSize} />
                  : it.checked ? <CheckMark /> : null}
              </span>
            )}
            {/* Big pictures (Margins): the details under the name, as Word's. */}
            {iconSize >= 32 && it.detail
              ? <span className='qmenu-text qmenu-two'><Mnemonic text={it.text} /><span className='qmenu-sub'>{it.detail}</span></span>
              : <span className='qmenu-text'><Mnemonic text={it.text} /></span>}
            {hasDetail && !(iconSize >= 32 && it.detail) && <span className='qmenu-detail'>{it.detail ?? ''}</span>}
            {it.items && <span className='qmenu-arrow'>
              <svg width='6' height='9' viewBox='0 0 6 9' aria-hidden='true'>
                <path d='M1 0.5 L5.5 4.5 L1 8.5 Z' fill='currentColor' /></svg></span>}
          </div>
        ))}
      {sub && items[sub.index]?.items && (
        <Popup entries={items[sub.index]!.items!} anchor={sub.rect} placement='right'
          cmd={cmd} onClose={onClose} />
      )}
    </div>
  )
}

function CheckMark() {
  return (
    <svg width='12' height='12' viewBox='0 0 12 12' aria-hidden='true'>
      <path d='M2 6.5 L5 9.5 L10.5 2.5' stroke='currentColor' strokeWidth='1.6'
        fill='none' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  )
}
