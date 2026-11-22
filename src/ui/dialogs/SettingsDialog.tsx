// Settings (the gear at the right of the ribbon, beside Help): your name,
// which comments and reviews are signed with, then how kTeX starts — the
// Welcome page and the way of working it offers.
import { useState } from 'react'
import type { LayoutMode } from '../../app/store'
import { SHORT_NAME } from '../../version'
import { MODES } from '../WelcomeDialog'
import { openDialog } from './dialogHost'

export interface AppSettings { name: string; showWelcome: boolean; layout: LayoutMode }

export function settingsDialog(current: AppSettings, nameHint = ''): Promise<AppSettings | null> {
  return openDialog<AppSettings>(close => {
    function Settings() {
      const [name, setName] = useState(current.name)
      const [welcome, setWelcome] = useState(current.showWelcome)
      const [layout, setLayout] = useState<LayoutMode>(current.layout)
      const ok = () => close({ name: name.trim(), showWelcome: welcome, layout })
      const h = (t: string) => <div style={{ fontWeight: 700, margin: '4px 0 6px' }}>{t}</div>
      return (
        <form className='dlg' role='dialog' aria-label='Settings' style={{ width: 560 }}
          onSubmit={e => { e.preventDefault(); ok() }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
          <div className='dlg-title'>Settings</div>
          <div className='dlg-body' style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              {h('Your name')}
              <input autoFocus value={name} placeholder={nameHint} style={{ width: '100%', boxSizing: 'border-box' }}
                aria-label='Your name' onChange={e => setName(e.target.value)} />
              <div style={{ color: 'var(--muted, #888)', marginTop: 4 }}>
                Shown on your comments and reviews, in the margin, the PDF and Word.
              </div>
            </div>
            <div>
              {h(`When ${SHORT_NAME} starts`)}
              <label><input type='checkbox' checked={welcome} onChange={e => setWelcome(e.target.checked)} />
                {' '}Show the Welcome page</label>
              <div style={{ margin: '10px 0 4px' }}>How you work:</div>
              {MODES.map(([m, title, text]) => (
                <label key={m} style={{ display: 'block', marginBottom: 6 }}>
                  <input type='radio' name='kt-settings-layout' checked={layout === m} onChange={() => setLayout(m)} />
                  <b> {title}</b>
                  <div style={{ paddingLeft: 24, color: 'var(--muted, #888)' }}>{text}</div>
                </label>
              ))}
            </div>
          </div>
          <div className='dlg-buttons'>
            <button type='submit'>OK</button>
            <button type='button' onClick={() => close(null)}>Cancel</button>
          </div>
        </form>
      )
    }
    return <Settings />
  })
}
