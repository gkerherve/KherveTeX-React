import { useSyncExternalStore } from 'react'
import { spellHighlighter } from '../../spell/shared'
import { setCommandChecked } from '../../ui/commands'
import { registerActions } from '../actions'
import { editorApi } from '../editorApi'
import { SpellingPanelModel } from '../spellingPanel'

// ---- the Spelling dock (QDockWidget "Spelling", Review > Spelling list) ----

let dockVisible = false
const dockListeners = new Set<() => void>()

// The panel's logic, over the visual editor.
export const spellingPanel = new SpellingPanelModel(() => {
  const api = editorApi()
  return api?.misspellings && api.selectRange && api.replaceRange
    ? { misspellings: () => api.misspellings!(), selectRange: (a, b) => api.selectRange!(a, b),
        replaceRange: (a, b, w, t) => api.replaceRange!(a, b, w, t) }
    : null
}, spellHighlighter)

export function setSpellingDock(on: boolean): void {
  if (dockVisible !== on) {
    dockVisible = on
    for (const l of dockListeners) l()
    // Opening the panel checks the document.
    if (on) spellingPanel.refresh()
  }
  setCommandChecked('spelling_list', on)
}

export function useSpellingDock(): boolean {
  return useSyncExternalStore(l => {
    dockListeners.add(l)
    return () => { dockListeners.delete(l) }
  }, () => dockVisible)
}

registerActions({
  // View ▸ Check spelling, as MainWindow._toggle_spell_check.
  spell_check: on => spellHighlighter().setEnabled(on !== false),
  spelling_list: on => setSpellingDock(on === undefined ? !dockVisible : Boolean(on)),
})
