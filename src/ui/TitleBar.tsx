// The window's blue title bar, as Word's on a Mac: the system title bar is
// hidden (tauri.conf.json titleBarStyle "Overlay") and the three window
// buttons sit over this bar. On it: AutoSave, Save, Export .docx and Export .pdf on
// the left, the document's name in the middle. The bar moves the window
// (data-tauri-drag-region) and a double-click on it zooms it, as the
// system's does. Shown in the macOS app only (or with ?titlebar in a
// browser, to try it).
import { useEffect, useState } from 'react'
import { PREFS_EVENT, pref, setPref } from '../app/prefs'
import { runAction } from '../app/actions'
import { appStore } from '../app/store'
import { isTauri } from '../platform'
import { Icon } from './icons'
import { lookupTip, useTipProps } from './Tooltip'
import { WordControls } from './WordControls'
import './titlebar.css'

export function titleBarShown(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).has('titlebar')) return true
  return isTauri() && /Mac/i.test(navigator.platform || navigator.userAgent) && !window.location.hash.includes('splash')
}

// AutoSave on: every minute (Preferences ▸ Save sets other intervals).
const AUTOSAVE_MINUTES = 1

export function TitleBar() {
  const [title, setTitle] = useState(document.title)
  const [, tick] = useState(0)
  useEffect(() => {
    // The title follows document.title, which updateTitle() sets.
    const el = document.querySelector('title') ?? document.head.appendChild(document.createElement('title'))
    const mo = new MutationObserver(() => setTitle(document.title))
    mo.observe(el, { childList: true, characterData: true, subtree: true })
    const on = () => tick(n => n + 1)
    window.addEventListener(PREFS_EVENT, on)
    return () => { mo.disconnect(); window.removeEventListener(PREFS_EVENT, on) }
  }, [])
  const autosave = Number(pref('save/autosave_minutes')) > 0
  const toggleAutosave = async () => {
    if (autosave) { setPref('save/autosave_minutes', 0); return }
    // AutoSave needs a file to save to: a new document is saved first.
    if (!appStore().get().path) {
      await runAction('save')
      if (!appStore().get().path) return
    }
    setPref('save/autosave_minutes', AUTOSAVE_MINUTES)
  }
  // The full tooltips (what a .ktex is; why Word export is beta).
  const saveTip = useTipProps({ rich: lookupTip('act_save')!, shortcut: '⌘S' })
  const docxTip = useTipProps({ rich: lookupTip('act_export_docx')! })
  const pdfTip = useTipProps({ rich: lookupTip('act_export_pdf')! })
  return (
    <div className='titlebar' data-tauri-drag-region>
      <div className='tb-left'>
        <button type='button' className={'tb-autosave' + (autosave ? ' on' : '')} role='switch' aria-checked={autosave}
          title={autosave ? 'AutoSave is on: your document is saved every minute. Click to turn it off.'
            : 'AutoSave is off. Turn it on to save your document every minute (a new document is saved first).'}
          onClick={() => { void toggleAutosave() }}>
          <span className='tb-autosave-label'>AutoSave</span>
          <span className='tb-switch'><i /></span>
          <span className='tb-state'>{autosave ? 'On' : 'Off'}</span>
        </button>
        <button type='button' className='tb-btn' aria-label='Save' {...saveTip} onClick={() => { void runAction('save') }}>
          <Icon name='tb_save' size={16} />
        </button>
        <button type='button' className='tb-export' aria-label='Export a Word document (.docx), beta' {...docxTip} onClick={() => { void runAction('export_docx') }}>
          <Icon name='tb_docx' size={16} /><span>.docx</span>
        </button>
        <button type='button' className='tb-export' aria-label='Export the PDF' {...pdfTip} onClick={() => { void runAction('export_pdf') }}>
          <Icon name='tb_pdf' size={16} /><span>.pdf</span>
        </button>
      </div>
      <div className='tb-title' data-tauri-drag-region>{title}</div>
      <div className='tb-right' data-tauri-drag-region><WordControls onBar /></div>
    </div>
  )
}
