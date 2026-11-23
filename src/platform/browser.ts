// The browser fallback: an in-memory file system. Opening a file copies the
// picked file into it under /browser/; saving into /downloads/ hands the
// file to the browser as a download. Compiling runs SwiftLaTeX in the
// browser (swiftlatex.ts), loaded on the first compile only.
import type { DirEntry, FileFilter, Platform, RunOptions, RunResult } from './types'

interface MemFile { data: Uint8Array; mtime: number }

const files = new Map<string, MemFile>()
const dirs = new Set<string>(['/'])
let tempCounter = 0

const browserSecrets = new Map<string, string>()

export const DOWNLOADS = '/downloads'
export const COMPILE_UNAVAILABLE =
  'Compiling needs the kTeX desktop app — the browser version cannot run tectonic.'

// What findTectonic reports online: compileTex runs it like tectonic, and
// run() hands it to SwiftLaTeX.
export const ONLINE_ENGINE = 'swiftlatex'

const norm = (p: string) => '/' + p.replaceAll('\\', '/').split('/').filter(Boolean).join('/')
const parentOf = (p: string) => norm(p).replace(/\/[^/]*$/, '') || '/'
const nameOf = (p: string) => norm(p).split('/').pop() ?? ''

function addDirs(p: string): void {
  let d = norm(p)
  while (!dirs.has(d)) {
    dirs.add(d)
    d = parentOf(d)
  }
}

function put(path: string, data: Uint8Array): void {
  const p = norm(path)
  addDirs(parentOf(p))
  files.set(p, { data, mtime: Date.now() })
  // Only files saved straight into /downloads are downloaded; the working
  // files the app writes beside them (.kherve/…) stay in memory.
  if (parentOf(p) === DOWNLOADS) download(nameOf(p), data)
}

function download(name: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function pick(filters: FileFilter[], multiple: boolean): Promise<File[] | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    const exts = filters.flatMap(f => f.extensions).filter(Boolean)
    if (exts.length) input.accept = exts.map(e => '.' + e.split('.').pop()).join(',')
    input.onchange = () => resolve(input.files && input.files.length ? [...input.files] : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

const SETTINGS_KEY = 'khervetex-settings'

export const browserPlatform: Platform = {
  kind: 'browser',
  pathListSep: ':',

  exists: async (path) => files.has(norm(path)) || dirs.has(norm(path)),
  stat: async (path) => {
    const p = norm(path)
    const f = files.get(p)
    if (f) return { isDir: false, isFile: true, size: f.data.length, mtime: f.mtime }
    if (dirs.has(p)) return { isDir: true, isFile: false, size: 0, mtime: 0 }
    return null
  },
  readFile: async (path) => {
    const f = files.get(norm(path))
    if (!f) throw new Error(`${path}: no such file`)
    return f.data
  },
  writeFile: async (path, data) => put(path, data),
  readText: async (path) => new TextDecoder().decode(await browserPlatform.readFile(path)),
  writeText: async (path, text) => put(path, new TextEncoder().encode(text)),
  listDir: async (path) => {
    const p = norm(path)
    const out: DirEntry[] = []
    for (const d of dirs) {
      if (d !== p && parentOf(d) === p) out.push({ name: nameOf(d), path: d, isDir: true, isFile: false, size: 0, mtime: 0 })
    }
    for (const [f, v] of files) {
      if (parentOf(f) === p) out.push({ name: nameOf(f), path: f, isDir: false, isFile: true, size: v.data.length, mtime: v.mtime })
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  },
  mkdir: async (path) => addDirs(path),
  copy: async (src, dest) => {
    const s = norm(src)
    const f = files.get(s)
    if (f) { put(dest, f.data); return }
    for (const [p, v] of Array.from(files)) {
      if (p.startsWith(s + '/')) put(norm(dest) + p.slice(s.length), v.data)
    }
    addDirs(dest)
  },
  remove: async (path) => {
    const p = norm(path)
    files.delete(p)
    dirs.delete(p)
    for (const k of Array.from(files.keys())) if (k.startsWith(p + '/')) files.delete(k)
    for (const k of Array.from(dirs)) if (k.startsWith(p + '/')) dirs.delete(k)
  },
  makeTempDir: async (prefix) => {
    const d = `/tmp/${prefix}${++tempCounter}`
    addDirs(d)
    return d
  },
  homeDir: async () => '/',

  openFileDialog: async ({ filters, multiple }) => {
    const picked = await pick(filters, !!multiple)
    if (!picked) return null
    const out: string[] = []
    for (const f of picked) {
      const p = `/browser/${f.name}`
      files.set(p, { data: new Uint8Array(await f.arrayBuffer()), mtime: f.lastModified })
      addDirs('/browser')
      out.push(p)
    }
    return out
  },
  saveFileDialog: async ({ defaultName }) => `${DOWNLOADS}/${defaultName.split('/').pop()}`,

  run: (program, args, opts) => program === ONLINE_ENGINE ? runOnline(args, opts)
    : Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: false, error: COMPILE_UNAVAILABLE }),
  cancelRunning: async () => { (await import('./swiftlatex')).cancelOnline() },
  findTectonic: async () => ({ path: ONLINE_ENGINE, bundled: true }),
  findTypst: async () => null,
  defaultTectonicCacheDir: async () => '',
  queryTectonicCacheDir: async () => null,
  treeSize: async () => 0,
  styleDirs: async () => [],

  reveal: async () => { throw new Error('Show in file explorer needs the desktop app') },
  openPath: async () => { throw new Error('Opening folders needs the desktop app') },
  openUrl: async (url) => { window.open(url, '_blank', 'noopener') },
  localhostGet: async (url, timeoutSecs) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutSecs * 1000) })
    return { status: r.status, body: await r.text() }
  },
  setTitle: async (title) => { document.title = title },
  launchArgs: async () => [],
  // The browser build keeps secrets for the session only.
  secretGet: async (key) => browserSecrets.get(key) ?? null,
  secretSet: async (key, value) => { if (value) browserSecrets.set(key, value); else browserSecrets.delete(key) },

  readSettings: async () => {
    try {
      return localStorage.getItem(SETTINGS_KEY) ?? '{}'
    } catch {
      return '{}'
    }
  },
  writeSettings: async (text) => {
    try {
      localStorage.setItem(SETTINGS_KEY, text)
    } catch { /* private window: settings last for this session */ }
  },
}

// tectonic's command line as compileTex gives it (--outdir <dir> ... <file>.tex),
// run with SwiftLaTeX on the files of the build folder. Pictures named by
// an absolute path elsewhere in memory are copied in beside them.
async function runOnline(args: string[], _opts: RunOptions): Promise<RunResult> {
  const { compileOnline, ONLINE_ENGINE_NOTE } = await import('./swiftlatex')
  if (args.includes('--version')) return { code: 0, stdout: `SwiftLaTeX XeTeX (online)\n`, stderr: '', timedOut: false, error: null }
  const texPath = norm(args[args.length - 1])
  const o = args.indexOf('--outdir')
  const outdir = o >= 0 ? norm(args[o + 1]) : parentOf(texPath)
  const staged = []
  for (const [p, v] of files) {
    if (p.startsWith(outdir + '/') && p !== texPath && !/\.(pdf|log|xdv|synctex\.gz)$/.test(p)) {
      staged.push({ path: p.slice(outdir.length + 1), data: v.data })
    }
  }
  let tex = new TextDecoder().decode(files.get(texPath)?.data ?? new Uint8Array())
  let n = 0
  tex = tex.replace(/\{(\/[^{}]+)\}/g, (whole, path: string) => {
    const f = files.get(norm(path))
    if (!f) return whole
    const name = `ext/${++n}-${nameOf(path)}`
    staged.push({ path: name, data: f.data })
    return `{${name}}`
  })
  const main = nameOf(texPath)
  staged.push({ path: main, data: new TextEncoder().encode(tex) })
  try {
    const r = await compileOnline(main, staged)
    const log = ONLINE_ENGINE_NOTE + '\n\n' + r.log
    put(texPath.replace(/\.tex$/, '.log'), new TextEncoder().encode(log))
    if (r.pdf) put(texPath.replace(/\.tex$/, '.pdf'), r.pdf)
    return { code: r.pdf ? 0 : 1, stdout: log, stderr: '', timedOut: false, error: null }
  } catch (e) {
    return { code: null, stdout: '', stderr: '', timedOut: false, error: `SwiftLaTeX: ${(e as Error).message}` }
  }
}
