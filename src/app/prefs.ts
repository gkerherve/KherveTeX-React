// kTeX ▸ Preferences (Word's Preferences window): the stored choices and
// how the open window follows a change at once, as Word's do. Values live
// in the app settings file (platform/settings); a change fires
// PREFS_EVENT so the ribbon, the editor and the window pick it up.
import { setSetting, setting } from '../platform/settings'
import { spellOptions } from '../spell/spellcheck.ts'

export const PREFS_EVENT = 'kt-prefs-changed'

export interface TrackLook {
  insert: 'underline' | 'double' | 'bold' | 'italic' | 'colour'
  delete: 'strike' | 'double' | 'hidden'
  colour: string   // 'author' or #RRGGBB
}

export const PREF_DEFAULTS = {
  // View
  'ribbon/group_titles': true,
  'ribbon/hidden_tabs': [] as string[],
  'ribbon/hidden_quick': [] as string[],
  // Edit
  'edit/picture_width': 'natural',
  // Spelling & Grammar
  'spell/ignore_upper': true,
  'spell/flag_repeated': true,
  // AutoCorrect
  'autocorrect/replace': true,
  'autocorrect/capitalise': false,
  // Save
  'save/autosave_minutes': 0,
  // Track Changes (editor look)
  'track/look': { insert: 'underline', delete: 'strike', colour: 'author' } as TrackLook,
  // User Information
  'user/initials': '',
  'user/email': '',
  'user/affiliation': '',
  'user/author_new_docs': false,
  // Accessibility
  'access/larger_controls': false,
}
export type PrefKey = keyof typeof PREF_DEFAULTS

export function pref<K extends PrefKey>(k: K): (typeof PREF_DEFAULTS)[K] {
  return setting(k, PREF_DEFAULTS[k])
}

export function setPref<K extends PrefKey>(k: K, v: (typeof PREF_DEFAULTS)[K]): void {
  setSetting(k, v)
  prefsChanged()
}

export function prefsChanged(): void {
  applyPrefs()
  window.dispatchEvent(new CustomEvent(PREFS_EVENT))
}

// What is read from module state rather than at each use; at start-up
// (after the settings load) and after each change.
export function applyPrefs(): void {
  spellOptions.ignoreUpper = pref('spell/ignore_upper')
  spellOptions.flagRepeated = pref('spell/flag_repeated')
  document.body.classList.toggle('kt-larger-controls', pref('access/larger_controls'))
  startAutosave()
}

// Save ▸ AutoSave every N minutes: a saved document with unsaved changes
// is saved (and so snapshotted) in the background.
let autosaveTimer: ReturnType<typeof setInterval> | null = null
function startAutosave(): void {
  if (autosaveTimer) clearInterval(autosaveTimer)
  autosaveTimer = null
  const min = Number(pref('save/autosave_minutes')) || 0
  if (min <= 0) return
  autosaveTimer = setInterval(() => {
    void import('./store.ts').then(({ appStore }) => {
      const s = appStore().get()
      if (s.path && s.dirty) void import('./actions.ts').then(a => a.runAction('save'))
    })
  }, min * 60_000)
}

// AutoCorrect ▸ Replace text as you type: Word's list, for what LaTeX
// prints the same (arrows, symbols, dashes, ellipsis).
export const AUTOCORRECT_LIST: [string, string][] = [
  ['-->', '→'], ['<--', '←'], ['==>', '⇒'], ['<==', '⇐'], ['<=>', '⇔'],
  ['(c)', '©'], ['(r)', '®'], ['(tm)', '™'], ['...', '…'], ['+-', '±'],
  ['--', '–'], ['---', '—'], ['!=', '≠'], ['<=', '≤'], ['>=', '≥'],
]
