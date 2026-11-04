// QSettings("kherveDOC", "kherveDOC"): one JSON object, read once at start
// and written back on every change. Keys are the Python app's
// ("recent_files", "layout_mode", "show_welcome", "default/page_size"...).
import { platform } from './index'

let values: Record<string, unknown> = {}
let loaded: Promise<void> | null = null
let writing: Promise<void> = Promise.resolve()

export function loadSettings(): Promise<void> {
  if (!loaded) {
    loaded = platform().readSettings().then(text => {
      try {
        const v = JSON.parse(text)
        values = v && typeof v === 'object' ? v : {}
      } catch {
        values = {}
      }
    }).catch(() => { values = {} })
  }
  return loaded
}

// Synchronous after loadSettings(), as QSettings.value().
export function setting<T>(key: string, fallback: T): T {
  return key in values ? (values[key] as T) : fallback
}

export function setSetting(key: string, value: unknown): void {
  values[key] = value
  const text = JSON.stringify(values, null, 1)
  // Writes queue in order, so the last value always wins on disk.
  writing = writing.then(() => platform().writeSettings(text)).catch(() => {})
}
