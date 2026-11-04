import { useCallback, useState } from 'react'
import type { CommandState } from './commands'
import { Mnemonic, Popup } from './Menu'
import { MENU_BAR } from './menuModel'

export function MenuBar({ cmd }: { cmd: CommandState }) {
  const [open, setOpen] = useState<{ index: number, rect: DOMRect } | null>(null)
  const close = useCallback(() => setOpen(null), [])
  return (
    <div className='menubar' role='menubar'>
      {MENU_BAR.map((m, i) => (
        <div key={m.text} data-menu-owner role='menuitem'
          className={'menubar-item' + (open?.index === i ? ' open' : '')}
          onMouseDown={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            setOpen(o => o?.index === i ? null : { index: i, rect })
          }}
          onMouseEnter={e => {
            if (open && open.index !== i) {
              setOpen({ index: i, rect: e.currentTarget.getBoundingClientRect() })
            }
          }}>
          <Mnemonic text={m.text} />
        </div>
      ))}
      {open && (
        <Popup key={open.index} entries={MENU_BAR[open.index].items}
          anchor={open.rect} cmd={cmd} onClose={close} />
      )}
    </div>
  )
}
