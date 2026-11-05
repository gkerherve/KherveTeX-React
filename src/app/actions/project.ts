// File ▸ Project (New / Open / Save / Close project) and View ▸ Documents:
// the window's side of src/app/project.ts. It builds the ProjectHost over
// the platform, the store, the visual editor and the compile loop, and
// hooks the session into the file actions and the compile loop as
// MainWindow's _open_path, _new, _save, _update_title, apply_layout_mode
// and _kick_compile do.
import { useSyncExternalStore } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { Document as KDocument } from '../../core/model'
import { openPdfSource, type PdfTextDict } from '../../core/pdfText'
import { editor } from '../../editor/controller'
import { isTauri, platform } from '../../platform'
import { critical, information, question, warning } from '../../platform/MessageBox'
import { setCommandChecked } from '../../ui/commands'
import { promptText } from '../../ui/dialogs/EditorDialogs'
import { registerActions } from '../actions'
import {
  buildDir, compileProjectMaster, compileUi, kickCompile, setImportSourceDir, setProjectCompiler,
} from '../compile'
import { editorApi, type EditorApi } from '../editorApi'
import { ProjectSession, type ProjectFs, type ProjectHost } from '../project'
import { appStore, replaceDoc } from '../store'
import type { PageEditing } from './page'
import {
  fileAccess, importTexFile, newBlank, saveAs, setProjectHooks, updateTitle,
} from './file'
import { gitSnapshot } from './git'

// ---- the Documents dock (QDockWidget "Documents") ----

let dockVisible = false
// "page" layout hides the list; leaving it brings the list back.
let dockBeforePage = false
const dockListeners = new Set<() => void>()

export function setDocumentsDock(on: boolean): void {
  if (dockVisible !== on) {
    dockVisible = on
    for (const l of dockListeners) l()
  }
  setCommandChecked('documents_dock', on)
}

export function useDocumentsDock(): boolean {
  return useSyncExternalStore(l => {
    dockListeners.add(l)
    return () => { dockListeners.delete(l) }
  }, () => dockVisible)
}

// apply_layout_mode: the Documents list is left as the user has it,
// except that "page" hides it and leaving "page" restores it.
function onLayoutMode(mode: string): void {
  if (mode === 'page') {
    if (dockVisible) dockBeforePage = true
    setDocumentsDock(false)
  } else if (dockBeforePage) {
    dockBeforePage = false
    setDocumentsDock(true)
  }
}

// ---- the host ----

let statusTimer: ReturnType<typeof setTimeout> | null = null
function showMessage(msg: string, ms: number): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  if (ms > 0) {
    statusTimer = setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, ms)
  }
}

function pageEditor(): (EditorApi & Partial<PageEditing>) | null {
  return editorApi() as (EditorApi & Partial<PageEditing>) | null
}

// page.get_text("text"): each line's spans, block by block.
function pageText(page: PdfTextDict): string {
  const out: string[] = []
  for (const b of page.blocks) {
    if (b.type !== 0) continue
    for (const l of b.lines) out.push(l.spans.map(s => s.text).join(''))
  }
  return out.join('\n')
}

function projectFs(): ProjectFs {
  const p = platform()
  return {
    ...fileAccess(),
    mkdir: p.mkdir,
    copy: p.copy,
    move: async (src, dest) => {
      await p.copy(src, dest)
      await p.remove(src)
    },
    makeTempDir: p.makeTempDir,
  }
}

const host: ProjectHost = {
  get fs() { return projectFs() },
  getDocument: () => {
    // The editor hands its document on after a short delay; take it now.
    editor()?.flushExport()
    return appStore().get().doc
  },
  setDocument: (doc: KDocument) => replaceDoc(doc, { path: null, dirty: false }),
  setHeadingOffset: c => pageEditor()?.setHeadingOffset?.(c),
  setFirstPageNumber: n => pageEditor()?.setPageNumberStart?.(n),
  clearModified: () => appStore().set({ dirty: false }),
  setImportSourceDir,
  currentPath: () => appStore().get().path,
  setCurrentPath: path => appStore().set({ path }),
  saveAs,
  newDocument: newBlank,
  importTex: importTexFile,
  publish: (project, projectPath, chapterIndex) => appStore().set({ project, projectPath, chapterIndex }),
  updateTitle,
  showDock: () => setDocumentsDock(true),
  getText: (title, label, value) => promptText(title, label, value),
  getFolder: async (title) => {
    if (isTauri()) {
      const r = await openDialog({ title, directory: true, multiple: false })
      return typeof r === 'string' ? r : null
    }
    // The browser's files live in memory: any folder name will do.
    const r = await promptText(title, 'Folder:', '/browser/Projects')
    return r && r.trim() ? r.trim() : null
  },
  getOpenProject: async () => {
    const picked = await platform().openFileDialog({
      title: 'Open project',
      filters: [{ name: 'KherveTeX project', extensions: ['ktex', 'json'] }, { name: 'All files', extensions: [] }],
    })
    return picked?.length ? picked[0] : null
  },
  question,
  information,
  warning,
  critical,
  showMessage,
  consoleAppend: msg => appStore().set(s => ({ compile: { ...s.compile, log: s.compile.log + msg + '\n' } })),
  gitSnapshot,
  autoCompile: () => appStore().get().autoCompile,
  kickCompile: () => { void kickCompile() },
  engine: () => compileUi().engine,
  buildDir,
  compileMaster: compileProjectMaster,
  pdfPages: async (pdfPath) => {
    const src = await openPdfSource(await platform().readFile(pdfPath))
    try {
      const out: string[] = []
      for (let i = 0; i < src.pageCount; i++) out.push(pageText(await src.textDict(i)))
      return out
    } finally {
      await src.close()
    }
  },
}

export const session = new ProjectSession(host)

setProjectHooks({
  isOpen: () => session.project !== null,
  openFromPath: path => session.openProjectFromPath(path),
  leave: () => session.leaveProject(),
  save: () => session.saveProject(),
  title: () => session.titleText(),
  onSingleTitle: () => session.onSingleTitle(),
  onLayoutMode,
  dropAt: (x, y, paths) => {
    if (!dockVisible) return false
    const el = document.elementFromPoint(x, y)
    if (!el?.closest('.documents-dock')) return false
    if (!session.sidebar.droppedFiles(paths).length) return false
    void session.sidebar.dropFiles(paths)
    return true
  },
})

setProjectCompiler(() => session.compileProject())

registerActions({
  new_project: () => session.newProject(),
  open_project: () => session.openProject(),
  save_project: () => session.saveProject(),
  close_project: () => session.closeProject(),
  // The dock's toggleViewAction: the command's new checked state.
  documents_dock: (on) => setDocumentsDock(on === undefined ? !dockVisible : Boolean(on)),
})
