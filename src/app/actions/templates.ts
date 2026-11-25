// File ▸ Save as Template and the My templates menus (File ▸ New from
// Template ▸ My templates, the Examples tab's gallery): MainWindow's
// _templates_dir, _refresh_custom_templates_menu, _save_as_template,
// _open_custom_template and _delete_template. Templates are the document
// JSON in the folder the Python app uses, so both apps share them.
import { fromJson, toJson, type Document as KDocument } from '../../core/model'
import { basename, join } from '../../core/paths'
import { platform } from '../../platform'
import { question, warning } from '../../platform/MessageBox'
import { promptText } from '../../ui/dialogs/EditorDialogs'
import { setLiveMenus, type LiveItem } from '../../ui/liveMenus'
import { registerActions } from '../actions'
import { appStore } from '../store'
import { openUnsaved } from './file'
import { openWindow, windowRequest } from './window'

export type Os = 'mac' | 'windows' | 'linux'

export function currentOs(): Os {
  const p = typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent) : ''
  if (/Mac|iPhone|iPad/i.test(p)) return 'mac'
  if (/Win/i.test(p)) return 'windows'
  return 'linux'
}

// Path(QSettings("kherveDOC", "kherveDOC").fileName()).parent / "templates":
// beside the settings plist on macOS (~/Library/Preferences), in the
// settings folder on Linux (~/.config/kherveDOC). On Windows fileName() is
// the registry key "\HKEY_CURRENT_USER\Software\kherveDOC\kherveDOC",
// which Python roots on the current drive.
export function templatesDirFor(os: Os, home: string): string {
  if (os === 'mac') return join(home, 'Library/Preferences/templates')
  if (os === 'windows') {
    const drive = /^[A-Za-z]:/.exec(home)?.[0] ?? 'C:'
    return `${drive}\\HKEY_CURRENT_USER\\Software\\kherveDOC\\templates`
  }
  return join(home, '.config/kherveDOC/templates')
}

export async function templatesDir(): Promise<string> {
  const d = templatesDirFor(currentOs(), await platform().homeDir())
  await platform().mkdir(d)
  return d
}

// json.dumps(json.loads(to_json(doc)), indent=2): Python's default
// ensure_ascii writes everything past "~" (DEL and every non-ASCII UTF-16
// unit) as \uXXXX.
export function templateJson(doc: KDocument): string {
  return toJson(doc).replace(/[\x7f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

// sorted(tpl_dir.glob("*.json")), by full path as Path sorts.
export async function listTemplates(): Promise<string[]> {
  const d = await templatesDir()
  const names = (await platform().listDir(d)).filter(e => e.isFile && e.name.endsWith('.json')).map(e => e.path)
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

const stem = (path: string) => basename(path).replace(/\.json$/, '')

let statusTimer: ReturnType<typeof setTimeout> | null = null
function showMessage(msg: string, ms: number): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, ms)
}

export async function refreshCustomTemplatesMenu(): Promise<void> {
  let templates: string[] = []
  try {
    templates = await listTemplates()
  } catch { /* no templates folder here */ }
  if (!templates.length) {
    setLiveMenus({ templates: [{ text: '(no saved templates)', disabled: true }] })
    return
  }
  setLiveMenus({ templates: templates.map((path): LiveItem => {
    const name = stem(path)
    return { text: name.replace(/&/g, '&&'), items: [
      { text: 'Open in new window', onTrigger: () => { void openCustomTemplate(path) } },
      { text: 'Delete template', onTrigger: () => { void deleteTemplate(path, name) } },
    ] }
  }) })
}

async function saveAsTemplate(): Promise<void> {
  const doc = appStore().get().doc
  const raw = await promptText('Save as template', 'Template name:', doc.meta.title || 'My template')
  if (raw === null || !raw.trim()) return
  const name = raw.trim()
  const path = join(await templatesDir(), `${name}.json`)
  if (await platform().exists(path)) {
    if (!(await question('Overwrite?', `A template named "${name}" already exists. Overwrite it?`))) return
  }
  await platform().writeText(path, templateJson(appStore().get().doc))
  await refreshCustomTemplatesMenu()
  showMessage(`Template saved: ${name}`, 4000)
}

// _open_custom_template: a user-saved template in a new window.
export async function openCustomTemplate(path: string): Promise<void> {
  // Read here first, so a broken template warns in this window.
  try {
    fromJson(await platform().readText(path))
  } catch (exc) {
    await warning('Template error', `Could not load template:\n${exc instanceof Error ? exc.message : String(exc)}`)
    return
  }
  await openWindow({ kind: 'template', path })
}

// In the new window: load the template as an unsaved document, with the
// user's defaults on top (openUnsaved).
export async function loadTemplateHere(path: string): Promise<void> {
  let doc: KDocument
  try {
    doc = fromJson(await platform().readText(path))
  } catch (exc) {
    await warning('Template error', `Could not load template:\n${exc instanceof Error ? exc.message : String(exc)}`)
    return
  }
  // The compile loop compiles it once it starts (startCompileService).
  await openUnsaved(doc)
}

async function deleteTemplate(path: string, name: string): Promise<void> {
  if (!(await question('Delete template?', `Permanently delete the template "${name}"?`))) return
  await platform().remove(path).catch(() => {})
  await refreshCustomTemplatesMenu()
  showMessage(`Template deleted: ${name}`, 4000)
}

let started = false

export async function startTemplatesService(): Promise<boolean> {
  if (started) return false
  started = true
  void refreshCustomTemplatesMenu()
  const req = windowRequest()
  if (req?.kind === 'template' && req.path) {
    await loadTemplateHere(req.path)
    return true
  }
  return false
}

registerActions({
  save_as_template: () => saveAsTemplate(),
})
