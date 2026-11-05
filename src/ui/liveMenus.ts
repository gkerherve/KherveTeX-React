// The menus MainWindow rebuilds at run time (QMenu.clear() + addAction):
// File ▸ Open Recent (_refresh_recent_menu), My templates
// (_refresh_custom_templates_menu, also the Examples tab's "My templates"
// gallery), the Window menu (_refresh_window_menu, on aboutToShow) and the
// Download offline bundle label (_update_bundle_action_label). The action
// modules fill them in; MenuBar and Menu read them.
import { useSyncExternalStore } from 'react'
import { COMMANDS, type MenuEntry, type MenuItem } from './ribbonModel'

// A menu entry that runs a closure, as a QAction connected to a lambda.
export interface LiveItem extends MenuItem {
  onTrigger?: () => void
  items?: (LiveItem | string)[]
}

export interface LiveMenus {
  recent: LiveItem[]
  templates: LiveItem[]
  windows: (LiveItem | string)[]
  // null: the static text of COMMANDS.download_bundle.
  bundleText: string | null
}

const placeholder = (text: string): LiveItem => ({ text, disabled: true })

let state: LiveMenus = {
  recent: [placeholder('(no recent files)')],
  templates: [placeholder('(no saved templates)')],
  windows: [],
  bundleText: null,
}
const listeners = new Set<() => void>()

export function liveMenus(): LiveMenus {
  return state
}

export function setLiveMenus(patch: Partial<LiveMenus>): void {
  state = { ...state, ...patch }
  // The Examples tab's gallery opens COMMANDS.gallery_mine.menu.
  if (patch.templates && COMMANDS.gallery_mine) COMMANDS.gallery_mine.menu = patch.templates
  for (const l of listeners) l()
}

export function useLiveMenus(): LiveMenus {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state)
}

// QMenu.aboutToShow, by the menu bar entry's text ("&Window", "&Tools").
const showHooks = new Map<string, Set<() => void>>()
export function onAboutToShow(menu: string, fn: () => void): void {
  let s = showHooks.get(menu)
  if (!s) showHooks.set(menu, (s = new Set()))
  s.add(fn)
}

export function aboutToShow(menu: string): void {
  for (const fn of showHooks.get(menu) ?? []) fn()
}

// The menu bar's entries with the live parts put in.
export function withLiveMenus(text: string, items: MenuEntry[], live: LiveMenus): MenuEntry[] {
  if (text === '&Window') return live.windows.length ? live.windows : items
  const swap = (es: MenuEntry[]): MenuEntry[] => es.map(e => {
    if (e === 'download_bundle' && live.bundleText !== null) {
      return { text: live.bundleText, command: 'download_bundle' }
    }
    if (typeof e === 'string' || !e.items) return e
    if (e.text === 'Open &Recent') return { ...e, items: live.recent }
    if (e.text === '&My templates') return { ...e, items: live.templates }
    return { ...e, items: swap(e.items) }
  })
  return swap(items)
}
