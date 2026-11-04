// The platform the app runs on, picked once at start-up: the Tauri shell
// when the page is inside it, the in-memory browser fallback otherwise.
import { browserPlatform } from './browser'
import { tauriPlatform } from './tauri'
import type { Platform } from './types'

export type { DirEntry, Engine, FileFilter, FileStat, Platform, RunOptions, RunResult } from './types'

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let current: Platform | null = null

export function platform(): Platform {
  if (!current) current = isTauri() ? tauriPlatform : browserPlatform
  return current
}

// Tests and the browser preview may swap it.
export function setPlatform(p: Platform): void {
  current = p
}
