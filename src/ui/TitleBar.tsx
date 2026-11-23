// The window's blue title bar, as Word's on a Mac: the system title bar is
// hidden (tauri.conf.json titleBarStyle "Overlay") and the three window
// buttons sit over this bar. On it: AutoSave, New, Open, Save, Undo, Redo and Print on
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
  const btn = (id: string, icon: string, tip: string) => (
    <button type='button' className='tb-btn' title={tip} aria-label={tip} onClick={() => { void runAction(id) }}>
      <Icon name={icon} size={16} />
    </button>
  )
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
        {btn('new', 'tb_new', 'New document (⌘N)')}
        {btn('open', 'tb_open', 'Open (⌘O)')}
        {btn('save', 'tb_save', 'Save (⌘S)')}
        {btn('undo', 'tb_undo', 'Undo (⌘Z)')}
        {btn('redo', 'tb_redo', 'Redo (⇧⌘Z)')}
        {btn('print', 'tb_print', 'Print (⌘P)')}
      </div>
      <div className='tb-title' data-tauri-drag-region>{title}</div>
      <div className='tb-right' data-tauri-drag-region />
    </div>
  )
}
