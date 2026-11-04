// Hand a drawing to the KhervePaint app and pick up its saves. A port of
// khervedoc/khervepaint_link.py.
//
// KhervePaint is a separate application, so it runs as its own detached
// process with the drawing's SVG on the command line. KherveTeX watches
// that SVG: whenever KhervePaint saves it, the PDF (what LaTeX includes)
// and the PNG (what the page shows) are regenerated from it and the figure
// is redrawn. The platform has no file watcher, so the SVG's mtime is
// polled.
import { dirname, join, suffix, withSuffix } from '../core/paths'
import { contentRect, MARGIN } from '../core/paintModel'
import { sceneToPdf } from '../core/paintPdf'
import { sceneToSvg } from '../core/paintRender'
import { loadSvg } from '../core/paintSvg'
import { platform } from '../platform'
import { setSetting, setting } from '../platform/settings'
import { messageBox, warning } from '../platform/MessageBox'
import { announceFigureUpdated, canvasToPng } from './host'

export const SETTINGS_KEY = 'khervepaint/path'

export const NOT_FOUND_MESSAGE = 'KhervePaint could not be found. Install it, or point kherveDOC at '
  + 'it with "Locate KhervePaint…" (an installed KhervePaint app / '
  + 'executable, or KhervePaint.py from a source checkout).'

const isMac = () => typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
const isWin = () => typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

// The argv prefix that runs KhervePaint at `path`, or null.
async function commandFor(path: string): Promise<string[] | null> {
  const p = platform()
  if (!(await p.exists(path))) return null
  if (suffix(path) === '.app') {
    const exe = join(join(join(path, 'Contents'), 'MacOS'), 'KhervePaint')
    return (await p.exists(exe)) ? [exe] : null
  }
  if (suffix(path) === '.py') {
    const root = dirname(path)
    for (const venv of ['.venv', 'venv']) {
      for (const rel of ['bin/python', 'Scripts/python.exe']) {
        const cand = join(join(root, venv), rel)
        if (await p.exists(cand)) return [cand, path]
      }
    }
    return null
  }
  return [path]
}

export async function candidatePaths(): Promise<string[]> {
  const out: string[] = []
  const custom = setting<string>(SETTINGS_KEY, '')
  if (custom) out.push(custom)
  const home = await platform().homeDir()
  if (isMac()) out.push('/Applications/KhervePaint.app', join(home, 'Applications/KhervePaint.app'))
  else if (isWin()) {
    out.push('C:\\Program Files\\KhervePaint\\KhervePaint.exe', 'C:\\Program Files (x86)\\KhervePaint\\KhervePaint.exe',
      join(home, 'AppData\\Local\\Programs\\KhervePaint\\KhervePaint.exe'))
  } else {
    out.push('/usr/bin/khervepaint', '/usr/local/bin/khervepaint', join(home, '.local/bin/khervepaint'))
  }
  return out
}

export async function findKhervePaint(): Promise<string[] | null> {
  for (const path of await candidatePaths()) {
    const cmd = await commandFor(path)
    if (cmd) return cmd
  }
  return null
}

// Remember a user-chosen KhervePaint; false if it cannot be run.
export async function setCustomPath(path: string): Promise<boolean> {
  if ((await commandFor(path)) === null) return false
  setSetting(SETTINGS_KEY, path)
  return true
}

// QProcess.startDetached through the platform's runner: a shell that
// backgrounds the program and returns at once.
async function startDetached(cmd: string[]): Promise<boolean> {
  const p = platform()
  const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
  const r = isWin()
    ? await p.run('cmd', ['/c', 'start', '""', ...cmd], { timeoutSecs: 20 })
    : await p.run('/bin/sh', ['-c', `nohup ${cmd.map(q).join(' ')} >/dev/null 2>&1 &`], { timeoutSecs: 20 })
  return r.error === null && r.code === 0
}

// regenerate_from_svg: rewrite the .pdf and .png beside `svg` from its
// content (the SVG itself is KhervePaint's file). The PNG, or null when the
// SVG cannot be read or is empty.
export async function regenerateFromSvg(svg: string): Promise<string | null> {
  let scene
  try {
    scene = loadSvg(await platform().readText(svg))
  } catch {
    return null       // half-written by the other app; the next change retries
  }
  let rect = contentRect(scene)
  if (rect.w <= 0 || rect.h <= 0) return null
  rect = { x: rect.x - MARGIN, y: rect.y - MARGIN, w: rect.w + 2 * MARGIN, h: rect.h + 2 * MARGIN }
  const png = withSuffix(svg, '.png')
  await platform().writeFile(withSuffix(svg, '.pdf'), sceneToPdf(scene, rect))
  const w = Math.max(1, Math.round(rect.w * 2))
  const h = Math.max(1, Math.round(rect.h * 2))
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sceneToSvg(scene, rect, w, h))
  try { await img.decode() } catch { return null }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const bytes = await canvasToPng(canvas)
  if (!bytes) return null
  await platform().writeFile(png, bytes)
  return png
}

// KhervePaintLink: launches KhervePaint on drawings and keeps their PDF/PNG
// in step with the SVG it saves.
const mtimes = new Map<string, number>()
let timer: number | null = null
const POLL_MS = 1000

async function poll(): Promise<void> {
  for (const [svg, last] of mtimes) {
    const st = await platform().stat(svg)
    if (!st) continue                 // replaced while saving; next poll
    if (st.mtime === last) continue
    mtimes.set(svg, st.mtime)
    const png = await regenerateFromSvg(svg)
    if (png !== null) announceFigureUpdated(png)
  }
}

export async function watch(svg: string): Promise<void> {
  const st = await platform().stat(svg)
  mtimes.set(svg, st ? st.mtime : -1)
  if (timer === null) timer = window.setInterval(() => { void poll() }, POLL_MS)
}

export function watched(): string[] {
  return [...mtimes.keys()]
}

// KhervePaintLink.open: [ok, message].
export async function openLink(pngPath: string): Promise<[boolean, string]> {
  const svg = withSuffix(pngPath, '.svg')
  if (!(await platform().exists(svg))) {
    return [false, 'This figure has no editable drawing source (.svg) to open in KhervePaint.']
  }
  const cmd = await findKhervePaint()
  if (cmd === null) return [false, NOT_FOUND_MESSAGE]
  await watch(svg)
  if (!(await startDetached([...cmd, svg]))) return [false, `KhervePaint could not be started (${cmd[0]}).`]
  return [true, `Opened ${svg.replace(/^.*[\\/]/, '')} in KhervePaint.`]
}

// DocumentEditor.edit_in_khervepaint: interactively, a missing KhervePaint
// offers to locate it.
export async function openInKhervePaint(pngPath: string, interactive = true): Promise<[boolean, string]> {
  const [ok, msg] = await openLink(pngPath)
  if (ok || !interactive) return [ok, msg]
  if (msg !== NOT_FOUND_MESSAGE) {
    await warning('KhervePaint', msg)
    return [ok, msg]
  }
  const clicked = await messageBox({ title: 'KhervePaint', text: msg, icon: 'information',
    buttons: [{ label: 'Locate KhervePaint…', default: true }, { label: 'Cancel' }] })
  if (clicked !== 'Locate KhervePaint…') return [ok, msg]
  const picked = await platform().openFileDialog({ title: 'Locate KhervePaint',
    filters: [{ name: 'KhervePaint', extensions: ['app', 'exe', 'py'] }, { name: 'All files', extensions: ['*'] }] })
  if (!picked || !picked.length) return [ok, msg]
  if (!(await setCustomPath(picked[0]))) {
    await warning('KhervePaint', `${picked[0]} cannot be run as KhervePaint.`)
    return [ok, msg]
  }
  return openLink(pngPath)
}
