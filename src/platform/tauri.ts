// The desktop implementation: every call is a Rust command in src-tauri/src.
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { DirEntry, Engine, FileFilter, FileStat, Platform, RunResult } from './types'

interface RawStat { is_dir: boolean; is_file: boolean; size: number; mtime: number }
interface RawEntry extends RawStat { name: string; path: string }
interface RawRun { code: number | null; stdout: string; stderr: string; timed_out: boolean; error: string | null }

const stat = (r: RawStat): FileStat => ({ isDir: r.is_dir, isFile: r.is_file, size: r.size, mtime: r.mtime })

const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)

export const tauriPlatform: Platform = {
  kind: 'tauri',
  pathListSep: isWindows ? ';' : ':',

  exists: (path) => invoke<boolean>('exists', { path }),
  stat: async (path) => {
    const r = await invoke<RawStat | null>('stat', { path })
    return r ? stat(r) : null
  },
  readFile: async (path) => new Uint8Array(await invoke<ArrayBuffer>('read_file', { path })),
  writeFile: async (path, data) => {
    await invoke('write_file', data, { headers: { 'x-path': encodeURIComponent(path) } })
  },
  readText: (path) => invoke<string>('read_text', { path }),
  writeText: (path, text) => invoke('write_text', { path, text }),
  listDir: async (path) => (await invoke<RawEntry[]>('list_dir', { path }))
    .map((e): DirEntry => ({ name: e.name, path: e.path, ...stat(e) })),
  mkdir: (path) => invoke('mkdir', { path }),
  copy: (src, dest) => invoke('copy_path', { src, dest }),
  remove: (path) => invoke('remove_path', { path }),
  makeTempDir: (prefix) => invoke<string>('make_temp_dir', { prefix }),
  homeDir: () => invoke<string>('home_dir'),

  openFileDialog: async ({ title, filters, multiple }) => {
    const r = await open({ title, filters: dialogFilters(filters), multiple: !!multiple, directory: false })
    if (r === null) return null
    return Array.isArray(r) ? r : [r]
  },
  saveFileDialog: ({ title, defaultName, filters }) =>
    save({ title, defaultPath: defaultName, filters: dialogFilters(filters) }),
  openFolderDialog: async (title) => {
    const r = await open({ title, directory: true, multiple: false })
    return typeof r === 'string' ? r : null
  },

  run: async (program, args, opts) => {
    const r = await invoke<RawRun>('run_process', {
      program, args, cwd: opts.cwd ?? null, env: opts.env ?? null, timeoutSecs: opts.timeoutSecs,
    })
    return { code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: r.timed_out, error: r.error } satisfies RunResult
  },
  cancelRunning: () => invoke('cancel_running'),
  findTectonic: () => invoke<Engine | null>('find_tectonic'),
  findTypst: () => invoke<string | null>('find_typst'),
  defaultTectonicCacheDir: () => invoke<string>('default_tectonic_cache_dir'),
  queryTectonicCacheDir: (tectonic) => invoke<string | null>('query_tectonic_cache_dir', { tectonic }),
  treeSize: (path) => invoke<number>('tree_size', { path }),
  styleDirs: () => invoke<string[]>('style_dirs'),

  reveal: (path) => invoke('reveal', { path }),
  openPath: (path) => invoke('open_path', { path }),
  openUrl: (url) => invoke('open_url', { url }),
  setTitle: async (title) => {
    document.title = title
    await getCurrentWindow().setTitle(title)
  },
  launchArgs: () => invoke<string[]>('launch_args'),
  secretGet: (key) => invoke<string | null>('secret_get', { key }),
  secretSet: (key, value) => invoke<void>('secret_set', { key, value }),

  readSettings: () => invoke<string>('settings_read'),
  writeSettings: (text) => invoke('settings_write', { text }),
}

// "All files (*)" is an empty extension list in Qt; the dialog wants "*".
function dialogFilters(filters: FileFilter[]) {
  return filters.map(f => ({ name: f.name, extensions: f.extensions.length ? f.extensions : ['*'] }))
}
