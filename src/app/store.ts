// The app's state: the open document (the single source of truth, as
// MainWindow's self._doc), where it lives on disk, and the last compile.
// A tiny external store read with useSyncExternalStore; every area of the
// app (editor, code view, PDF panel, actions) reads and writes through it.
import { useSyncExternalStore } from 'react'
import type { Document as KDocument, Project } from '../core/model'

export type LayoutMode = 'side' | 'window' | 'visual' | 'page'
export type MainTab = 'visual' | 'code' | 'console'

export interface CompileState {
  running: boolean
  ok: boolean | null
  log: string
  pdf: Uint8Array | null
  // Bumped on every finished compile so viewers can re-render.
  serial: number
}

export interface AppState {
  doc: KDocument
  // Absolute path of the open .ktex / .tex file, or null for Untitled.
  path: string | null
  dirty: boolean
  project: Project | null
  projectPath: string | null
  chapterIndex: number
  tab: MainTab
  layout: LayoutMode
  autoCompile: boolean
  compile: CompileState
  status: string
  // Bumped when the document is replaced wholesale (open, new, import,
  // Code-tab edit) so the visual editor reloads rather than diffing.
  docSerial: number
}

type Listener = () => void

export class Store<S> {
  private state: S
  private listeners = new Set<Listener>()
  constructor(initial: S) { this.state = initial }
  get = (): S => this.state
  set = (patch: Partial<S> | ((s: S) => Partial<S>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch
    this.state = { ...this.state, ...p }
    for (const l of this.listeners) l()
  }
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }
}

let store: Store<AppState> | null = null

export function initStore(initial: AppState): Store<AppState> {
  store = new Store(initial)
  return store
}

export function appStore(): Store<AppState> {
  if (!store) throw new Error('store not initialised')
  return store
}

export function useApp<T>(select: (s: AppState) => T): T {
  const s = appStore()
  return useSyncExternalStore(s.subscribe, () => select(s.get()))
}

// Replace the whole document (open/new/import/code edit).
export function replaceDoc(doc: KDocument, extra: Partial<AppState> = {}): void {
  appStore().set(s => ({ doc, docSerial: s.docSerial + 1, ...extra }))
}

// The visual editor reports an edit: same document identity, now dirty.
export function editDoc(doc: KDocument): void {
  appStore().set({ doc, dirty: true })
}
