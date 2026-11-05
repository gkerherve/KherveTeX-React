// The QAction shortcuts of the main window (COMMANDS[].shortcut): a key
// the focused widget did not use triggers its command, as Qt's
// WindowShortcut context does. Qt maps "Ctrl" to ⌘ on macOS, so the same
// strings mean Cmd there.
import { useEffect, useRef } from 'react'
import type { CommandState } from './commands'
import { COMMANDS } from './ribbonModel'

export interface KeySpec {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

export const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

// "Ctrl+Shift+P" -> { ctrl, shift, key: 'P' }
export function parseShortcut(s: string): KeySpec | null {
  const parts = s.split('+')
  // "Ctrl++" style keys do not occur; a trailing "" would be the "+" key.
  let key = parts.pop() ?? ''
  if (key === '' && s.endsWith('+')) key = '+'
  if (!key) return null
  const mods = new Set(parts.map(p => p.toLowerCase()))
  return { ctrl: mods.has('ctrl'), shift: mods.has('shift'), alt: mods.has('alt'), key }
}

const CODE_FOR: Record<string, string> = { '[': 'BracketLeft', ']': 'BracketRight' }

interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function matches(spec: KeySpec, e: KeyLike, mac = IS_MAC): boolean {
  const ctrl = mac ? e.metaKey : e.ctrlKey
  // On macOS the physical Control key is Qt's Meta, which no shortcut uses.
  const other = mac ? e.ctrlKey : e.metaKey
  if (ctrl !== spec.ctrl || other || e.altKey !== spec.alt) return false
  const k = spec.key
  // A symbol typed with Shift ("*" is Shift+8) matches whatever Shift says.
  if (k === '*' || k === '+') return e.key === k
  if (e.shiftKey !== spec.shift) return false
  if (/^[A-Za-z]$/.test(k)) return e.code === `Key${k.toUpperCase()}`
  if (/^[0-9]$/.test(k)) return e.code === `Digit${k}` || e.code === `Numpad${k}`
  if (CODE_FOR[k]) return e.code === CODE_FOR[k]
  return e.key.toLowerCase() === k.toLowerCase()
}

const TABLE: [KeySpec, string][] = Object.values(COMMANDS)
  .filter(c => c.shortcut)
  .map(c => [parseShortcut(c.shortcut!), c.id] as [KeySpec | null, string])
  .filter((x): x is [KeySpec, string] => x[0] !== null)

export function commandForKey(e: KeyLike, mac = IS_MAC): string | null {
  for (const [spec, id] of TABLE) if (matches(spec, e, mac)) return id
  return null
}

// Text editing keys belong to whatever field has the focus: a QLineEdit or
// the text edit takes them through ShortcutOverride before the action sees
// them.
const FIELD_KEYS = new Set(['cut', 'copy', 'paste', 'select_all', 'undo', 'redo'])

function inField(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null
  if (!el) return false
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

// A modal dialog is open: the main window's shortcuts wait, as under exec().
function modalOpen(): boolean {
  return !!document.querySelector('.dlg-backdrop, .kmb-veil, .kd-veil, [aria-modal="true"]')
}

export function useGlobalShortcuts(cmd: CommandState): void {
  const ref = useRef(cmd)
  ref.current = cmd
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const id = commandForKey(e)
      if (!id || modalOpen()) return
      if (FIELD_KEYS.has(id) && inField(e.target)) return
      e.preventDefault()
      ref.current.trigger(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
