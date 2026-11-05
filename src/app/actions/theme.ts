// View ▸ Theme and the status bar's Light / Dark switch: themes.py's two
// presets and MainWindow._apply_named_theme. The palette itself is the
// CSS of index.css (`:root` and `:root[data-theme='dark']`); choosing one
// persists it (theme_name, theme_dark) and every other window follows.
import { useSyncExternalStore } from 'react'
import { isTauri } from '../../platform'
import { setSetting, setting } from '../../platform/settings'
import { setCommandChecked } from '../../ui/commands'
import { registerActions } from '../actions'

export type ThemeName = 'Light' | 'Dark'
export const THEME_NAMES: ThemeName[] = ['Light', 'Dark']
export const DEFAULT_THEME: ThemeName = 'Light'

const EVENT = 'theme-changed'

let current: ThemeName = DEFAULT_THEME
const listeners = new Set<() => void>()

// themes.saved_theme: Light or Dark as last chosen. A preset from before
// there were only these two becomes whichever of them it was closer to.
export function savedTheme(get: <T>(key: string, fallback: T) => T = setting): ThemeName {
  const name = get<unknown>('theme_name', '')
  if (name === 'Light' || name === 'Dark') return name
  return get<unknown>('theme_dark', false) === true || get<unknown>('theme_dark', false) === 'true'
    ? 'Dark' : DEFAULT_THEME
}

export function isDark(name: string): boolean {
  return name === 'Dark'
}

export function themeName(): ThemeName {
  return current
}

export function useThemeName(): ThemeName {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l) } },
    () => current)
}

function show(name: ThemeName): void {
  current = name
  document.documentElement.dataset.theme = isDark(name) ? 'dark' : 'light'
  setCommandChecked(name === 'Dark' ? 'theme_dark' : 'theme_light', true)
  for (const l of listeners) l()
}

// _apply_named_theme(name, startup)
export function applyNamedTheme(name: ThemeName, startup = false): void {
  show(name)
  setSetting('theme_name', name)
  setSetting('theme_dark', isDark(name))
  if (!startup && isTauri()) {
    // The switch and the View menu show the same choice in every window.
    void import('@tauri-apps/api/event').then(({ emit }) => emit(EVENT, name)).catch(() => {})
  }
}

let started = false

// At start-up (after loadSettings): the persisted theme, and follow the
// other windows' choice.
export function startThemeService(): void {
  if (started) return
  started = true
  applyNamedTheme(savedTheme(), true)
  if (isTauri()) {
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>(EVENT, ev => {
        const n = ev.payload
        if ((n === 'Light' || n === 'Dark') && n !== current) show(n)
      })).catch(() => {})
  }
}

registerActions({
  theme_light: () => applyNamedTheme('Light'),
  theme_dark: () => applyNamedTheme('Dark'),
})
