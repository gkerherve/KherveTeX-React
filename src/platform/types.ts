// What the app needs from the machine it runs on: files (pathlib/shutil),
// file dialogs (QFileDialog), running the engines (subprocess), the OS
// (Show in Finder, open a URL) and persisted settings (QSettings). The
// desktop app implements it over Tauri (tauri.ts); in a plain browser
// (browser.ts) files live in memory, opening reads a picked file, saving
// downloads it, and compiling is unavailable.

export interface FileStat {
  isDir: boolean
  isFile: boolean
  size: number
  // Modification time, ms since the epoch.
  mtime: number
}

export interface DirEntry extends FileStat {
  name: string
  path: string
}

// One QFileDialog filter, e.g. { name: 'LaTeX', extensions: ['tex'] }.
export interface FileFilter {
  name: string
  extensions: string[]
}

export interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutSecs: number
}

export interface RunResult {
  // null when the process was killed (timeout, cancel) or did not start.
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  // Why it did not start.
  error: string | null
}

export interface Engine {
  path: string
  // The binary that ships inside the app.
  bundled: boolean
}

export interface Platform {
  kind: 'tauri' | 'browser'
  // Path separator for TEXINPUTS-style lists.
  pathListSep: string

  exists(path: string): Promise<boolean>
  stat(path: string): Promise<FileStat | null>
  readFile(path: string): Promise<Uint8Array>
  // Creates parent folders.
  writeFile(path: string, data: Uint8Array): Promise<void>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  // Sorted by name.
  listDir(path: string): Promise<DirEntry[]>
  mkdir(path: string): Promise<void>
  // shutil.copy2 for a file, shutil.copytree for a folder.
  copy(src: string, dest: string): Promise<void>
  remove(path: string): Promise<void>
  // tempfile.mkdtemp(prefix=...)
  makeTempDir(prefix: string): Promise<string>
  homeDir(): Promise<string>

  // null when cancelled.
  openFileDialog(opts: { title: string; filters: FileFilter[]; multiple?: boolean }): Promise<string[] | null>
  saveFileDialog(opts: { title: string; defaultName: string; filters: FileFilter[] }): Promise<string | null>

  run(program: string, args: string[], opts: RunOptions): Promise<RunResult>
  cancelRunning(): Promise<void>
  findTectonic(): Promise<Engine | null>
  findTypst(): Promise<string | null>
  defaultTectonicCacheDir(): Promise<string>
  queryTectonicCacheDir(tectonic: string): Promise<string | null>
  // Bytes of every file under `path`.
  treeSize(path: string): Promise<number>
  // style_manager.all_style_dirs()
  styleDirs(): Promise<string[]>

  reveal(path: string): Promise<void>
  openPath(path: string): Promise<void>
  openUrl(url: string): Promise<void>
  setTitle(title: string): Promise<void>
  // Files given on the command line (a double-clicked .ktex).
  launchArgs(): Promise<string[]>

  // The settings file as one JSON object (see settings.ts).
  readSettings(): Promise<string>
  writeSettings(text: string): Promise<void>
}
