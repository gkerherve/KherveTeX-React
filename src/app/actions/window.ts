// More than one window, and the window itself: File ▸ New window and Open
// in new window (MainWindow._new_window_welcome, _open_in_new_window), the
// Window menu (_refresh_window_menu), Quit (act_quit closes this window,
// after the unsaved-changes prompt of its close handler) and View ▸ Fit
// page width (_toggle_fit_page_width, persisted as fit_page_width).
//
// Each window is a page of its own (a Tauri webview, or a browser tab in
// the preview). What a new window should open comes in its URL query:
//   ?win=new          the Welcome page, as a fresh window shows it
//   ?open=<path>      that document
//   ?template=<path>  a saved template (actions/templates.ts)
import { pyFixed } from '../../core/py'
import { isTauri, platform } from '../../platform'
import { setSetting, setting } from '../../platform/settings'
import { isCommandChecked, setCommandChecked } from '../../ui/commands'
import { onAboutToShow, setLiveMenus, type LiveItem } from '../../ui/liveMenus'
import { COMMANDS } from '../../ui/ribbonModel'
import { hasAction, registerActions, runAction } from '../actions'
import { recentFiles, subscribeRecent } from './file'
import type { FileFilter } from '../../platform'

const PDF_LABEL = 'pdf'

const OPEN_IN_NEW_WINDOW_FILTERS: FileFilter[] = [
  { name: 'All supported', extensions: ['ktex', 'ktexz', 'json', 'kdocz', 'tex', 'md', 'markdown'] },
  { name: 'KherveTeX', extensions: ['ktex', 'ktexz', 'kdocz'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'LaTeX', extensions: ['tex'] },
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'All files', extensions: [] },
]

export interface NewWindowRequest {
  kind: 'new' | 'open' | 'template' | 'overleaf'
  path?: string
  // 'overleaf': the folder the received version's figures resolve against.
  dir?: string
}

// Where this window was asked to start, from its URL.
export function windowRequest(search = typeof location !== 'undefined' ? location.search : ''): NewWindowRequest | null {
  const q = new URLSearchParams(search)
  if (q.has('open')) return { kind: 'open', path: q.get('open')! }
  if (q.has('template')) return { kind: 'template', path: q.get('template')! }
  if (q.has('overleaf')) return { kind: 'overleaf', path: q.get('overleaf')!, dir: q.get('dir') ?? '' }
  if (q.get('win') === 'new') return { kind: 'new' }
  return null
}

export function windowQuery(req: NewWindowRequest): string {
  const q = new URLSearchParams()
  if (req.kind === 'new') q.set('win', 'new')
  else q.set(req.kind, req.path ?? '')
  if (req.dir !== undefined) q.set('dir', req.dir)
  return '?' + q.toString()
}

// True for the first window of the app (the one a double-clicked file and
// the command line go to).
export async function isMainWindow(): Promise<boolean> {
  if (!isTauri()) return windowRequest() === null
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().label === 'main'
}

let serial = 0

// _new_window: a fresh MainWindow alongside this one.
export async function openWindow(req: NewWindowRequest): Promise<void> {
  const query = windowQuery(req)
  if (!isTauri()) {
    window.open(location.pathname + query, '_blank')
    return
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = `doc-${Date.now().toString(36)}-${serial++}`
  const win = new WebviewWindow(label, {
    url: `index.html${query}`, title: 'KherveTeX', width: 1400, height: 900,
    minWidth: 760, minHeight: 500, resizable: true, dragDropEnabled: true,
  })
  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve())
    void win.once('tauri://error', e => reject(new Error(String(e.payload))))
  })
}

// _open_in_new_window
async function openInNewWindow(): Promise<void> {
  const picked = await platform().openFileDialog({ title: 'Open document in new window',
    filters: OPEN_IN_NEW_WINDOW_FILTERS })
  if (!picked?.length) return
  await openWindow({ kind: 'open', path: picked[0] })
}

// The document name of a window title: "KherveTeX vX.Y — name [branch]".
export function windowMenuLabel(title: string, index: number): string {
  let label = title || `Window ${index + 1}`
  const marker = ' — '
  if (label.includes(marker)) label = label.slice(label.indexOf(marker) + marker.length)
  return label
}

// _refresh_window_menu, run as the Window menu opens.
export async function refreshWindowMenu(): Promise<void> {
  const head: LiveItem[] = [
    { text: COMMANDS.new_window.text, detail: COMMANDS.new_window.shortcut, command: 'new_window' },
    { text: COMMANDS.open_in_new_window.text, detail: COMMANDS.open_in_new_window.shortcut,
      command: 'open_in_new_window' },
  ]
  const rows: (LiveItem | string)[] = ['-']
  if (isTauri()) {
    const { getAllWebviewWindows, getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const me = getCurrentWebviewWindow().label
    const wins = (await getAllWebviewWindows()).filter(w => w.label !== PDF_LABEL)
    const titles = await Promise.all(wins.map(w => w.title().catch(() => '')))
    wins.forEach((w, i) => rows.push({
      text: windowMenuLabel(titles[i], i).replace(/&/g, '&&'), checkable: true, checked: w.label === me,
      onTrigger: () => { void w.setFocus().catch(() => {}) },
    }))
  } else {
    rows.push({ text: windowMenuLabel(document.title, 0).replace(/&/g, '&&'), checkable: true, checked: true })
  }
  setLiveMenus({ windows: [...head, ...rows] })
}

async function quit(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    // close() runs the close handler: the save prompt, then the shutdown.
    await getCurrentWindow().close()
  } else {
    window.close()
  }
}

let started = false

// At start-up: the saved Fit page width, the Window menu's first contents.
export function startWindowService(): void {
  if (started) return
  started = true
  setCommandChecked('fit_page_width', setting<unknown>('fit_page_width', true) !== false)
  onAboutToShow('&Window', () => { void refreshWindowMenu() })
  void refreshWindowMenu()
  refreshRecentMenu()
  subscribeRecent(refreshRecentMenu)
  // Python refreshes the label at start-up and after a download; the menu
  // opening covers a download from Compiler status too.
  void refreshBundleLabel()
  onAboutToShow('&Tools', () => { void refreshBundleLabel() })
}

// compiler.tectonic_cache_size_mb: the cache of the tectonic found, 0
// without one.
async function cacheSizeMb(): Promise<number> {
  const p = platform()
  const eng = await p.findTectonic()
  if (!eng) return 0
  const d = await p.queryTectonicCacheDir(eng.path)
  if (!d || !(await p.stat(d))?.isDir) return 0
  return (await p.treeSize(d)) / (1024 * 1024)
}

// _update_bundle_action_label
export function bundleLabel(mb: number): string {
  return mb > 5 ? `&Download offline bundle  \u2714 (${pyFixed(mb, 0)} MB cached)` : '&Download offline bundle\u2026'
}

async function refreshBundleLabel(): Promise<void> {
  const mb = await cacheSizeMb().catch(() => 0)
  setLiveMenus({ bundleText: bundleLabel(mb) })
}

// _refresh_recent_menu: one entry per recent file, its full path.
function refreshRecentMenu(): void {
  const recent = recentFiles()
  setLiveMenus({ recent: recent.length
    ? recent.map((p): LiveItem => ({ text: p.replace(/&/g, '&&'), onTrigger: () => { void runAction('open_recent', p) } }))
    : [{ text: '(no recent files)', disabled: true }] })
}

registerActions({
  new_window: () => openWindow({ kind: 'new' }),
  open_in_new_window: () => openInNewWindow(),
  quit: () => quit(),
  // The page follows the command's checked state (App.tsx); closeEvent
  // keeps the choice for the next start.
  fit_page_width: (on) => { setSetting('fit_page_width', on ?? isCommandChecked('fit_page_width')) },
})

// Format ▸ Style ▸ Heading 1–5 apply the heading as the Styles gallery
// does, unless the editor registered them itself.
setTimeout(() => {
  for (const l of [1, 2, 3, 4, 5]) {
    const id = `heading_${l}`
    if (!hasAction(id)) registerActions({ [id]: () => runAction('style', l) })
  }
}, 0)
