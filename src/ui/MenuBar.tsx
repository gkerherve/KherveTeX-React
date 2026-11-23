import { useCallback, useState } from 'react'
import type { CommandState } from './commands'
import { aboutToShow, useLiveMenus, withLiveMenus } from './liveMenus'
import { Mnemonic, Popup } from './Menu'
import { MENU_BAR } from './menuModel'
import { ToolSearch } from './Ribbon'

export function MenuBar({ cmd }: { cmd: CommandState }) {
  const [open, setOpen] = useState<{ index: number, rect: DOMRect } | null>(null)
  const live = useLiveMenus()
  const close = useCallback(() => setOpen(null), [])
  const show = (index: number, rect: DOMRect) => {
    aboutToShow(MENU_BAR[index].text)
    setOpen({ index, rect })
  }
  return (
    <div className='menubar' role='menubar'>
      {MENU_BAR.map((m, i) => (
        <div key={m.text} data-menu-owner role='menuitem'
          className={'menubar-item' + (open?.index === i ? ' open' : '')}
          onMouseDown={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            if (open?.index === i) setOpen(null)
            else show(i, rect)
          }}
          onMouseEnter={e => {
            if (open && open.index !== i) show(i, e.currentTarget.getBoundingClientRect())
          }}>
          <Mnemonic text={m.text} />
        </div>
      ))}
      <div className='menubar-fill' />
      <ToolSearch />
      {open && (
        <Popup key={open.index}
          entries={withLiveMenus(MENU_BAR[open.index].text, MENU_BAR[open.index].items, live)}
          anchor={open.rect} cmd={cmd} onClose={close} />
      )}
    </div>
  )
}
