// Chapters (Home ▸ Chapters, the bar over each chapter heading): one .ktex
// holding a thesis's chapters, each compiled or left out, shown or folded
// away while writing, reordered, added, or brought in from another file.
// The folds are remembered per document in the settings (not in the file).
import { Selection, TextSelection } from 'prosemirror-state'
import * as M from '../../core/model.ts'
import { basename, dirname, join } from '../../core/paths.ts'
import { loadKdocz } from '../../core/kdocz.ts'
import { importMd } from '../../core/importers.ts'
import * as C from '../../editor/commands.ts'
import {
  chapterAt, chapterEnd, chapterHooks, chapters, foldedChapters, outlineOf, moveChapter, setChapterCompiled, setChapterFolded, setFoldedChapters,
} from '../../editor/chapters.ts'
import { editor } from '../../editor/controller.ts'
import { platform } from '../../platform/index.ts'
import { setSetting, setting } from '../../platform/settings.ts'
import { critical } from '../../platform/MessageBox.tsx'
import { chaptersDialog, type ChapterRow } from '../../ui/dialogs/ChaptersDialog.tsx'
import { registerActions } from '../actions.ts'
import { appStore } from '../store.ts'
import { fileAccess, importTexFile } from './file.ts'

const listeners = new Set<() => void>()
const changed = () => { for (const l of listeners) l() }

const foldSetting = () => {
  const path = appStore().get().path
  return path ? `chapters/folded/${path}` : null
}

chapterHooks.onFold = keys => {
  const k = foldSetting()
  if (k) setSetting(k, keys)
  queueMicrotask(changed)
}
chapterHooks.openWindow = () => { void openChapters() }
// The caret moved or the text changed: the panel's current chapter, and in
// the one-at-a-time view the chapter it went into is the one shown.
let lastCurrent = -1
chapterHooks.onUpdate = () => {
  const e = editor()
  if (!e) return
  const cur = chapterAt(chapters(e.view.state.doc), e.view.state.selection.head)
  if (cur !== lastCurrent) { lastCurrent = cur; queueMicrotask(changed) }
}

// How the Documents panel shows the chapters: all of them, one at a time
// (the others folded away), or with each one's headings (Outline).
export type ChapterView = 'all' | 'one' | 'outline'
const viewNow = (): ChapterView => setting<ChapterView>('chapters/view', 'all')
// Where the panel sits: docked on the left, or a window at the bottom right.
export type DocumentsWindow = 'dock' | 'float'

// A document opened: its chapters folded as they were left.
let lastPath: string | null = null
// Loaded before the store exists: watch it once it does.
function watchStore(): void {
  try { appStore() } catch { setTimeout(watchStore, 50); return }
  appStore().subscribe(onStore)
}
watchStore()
function onStore(): void {
  const s = appStore().get()
  if (s.path !== lastPath) {
    lastPath = s.path
    const k = foldSetting()
    const keys = k ? setting<string[]>(k, []) : []
    setTimeout(() => {
      const e = editor()
      if (e && keys.length) e.run(setFoldedChapters(keys))
    }, 0)
  }
  changed()
}

function describe(c: ReturnType<typeof chapters>[number]): string {
  const parts: string[] = []
  const n = (k: number, one: string) => { if (k) parts.push(`${k} ${one}${k > 1 ? 's' : ''}`) }
  n(c.paragraphs, 'paragraph'); n(c.figures, 'figure'); n(c.tables, 'table')
  return parts.join(', ')
}

function rows(): ChapterRow[] {
  const e = editor()
  if (!e) return []
  const st = e.view.state
  const folded = foldedChapters(st)
  const list = chapters(st.doc)
  const cur = chapterAt(list, st.selection.head)
  const outline = viewNow() === 'outline'
  return list.map(c => ({
    title: c.title, key: c.key, compiled: c.compiled, shown: !folded.has(c.key), summary: describe(c),
    current: c.index === cur, ...(outline ? { sections: outlineOf(st.doc, c) } : {}),
  }))
}

// Only chapter `i` shown, the others folded away.
function showOnly(i: number): void {
  const e = editor()
  if (!e) return
  const list = chapters(e.view.state.doc)
  e.run(setFoldedChapters(list.filter(c => c.index !== i).map(c => c.key)))
}

// The blocks of another document, its pictures copied into this one's.
async function readAsBlocks(path: string): Promise<M.Block[]> {
  const sfx = path.toLowerCase().replace(/^.*(\.[^.]+)$/, '$1')
  let doc: M.Document
  if (sfx === '.ktex' || sfx === '.kdocz') {
    const dir = await platform().makeTempDir('chapter-')
    ;[doc] = await loadKdocz(path, dir, fileAccess())
  } else if (sfx === '.tex') doc = await importTexFile(path)
  else if (sfx === '.md' || sfx === '.markdown') doc = importMd(await platform().readText(path))
  else if (sfx === '.docx' || sfx === '.pdf') {
    const wp = await import('./wordPdf.ts')
    ;[doc] = sfx === '.docx' ? await wp.importDocxFile(path) : await wp.importPdfFile(path)
  } else if (sfx === '.rtf' || sfx === '.odt') {
    const wp = await import('./wordPdf.ts')
    ;[doc] = await wp.importOfficeFile(path)
  } else throw new Error('kTeX cannot read that kind of file.')
  const pics = await import('../pictures.ts')
  const out: M.Block[] = []
  for (const b of doc.children) {
    if (b.type === 'Figure' && b.path) {
      const abs = /^(\/|[A-Za-z]:[\\/])/.test(b.path) ? b.path : join(dirname(path), b.path)
      const kept = await pics.adoptPicturePath(abs).catch(() => null)
      out.push(kept ? { ...b, path: kept.path } : b)
    } else out.push(b)
  }
  return out
}

function chapterLevel(): number {
  const e = editor()
  return (e && chapters(e.view.state.doc)[0]?.level) ?? 1
}

// Blocks put at the end of the document (before its back matter), the
// caret on the first.
function appendBlocks(blocks: M.Block[]): void {
  const e = editor()
  if (!e) return
  const s = e.view.state
  const at = chapterEnd(s.doc)
  if (at === null) {
    e.view.dispatch(s.tr.setSelection(Selection.atEnd(s.doc)))
    e.run(C.insertModelBlocks(blocks, { select: 0, trailingParagraph: true }))
    return
  }
  const tr = s.tr.insert(at, blocks.map(C.fresh))
  e.view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(at + 1))).scrollIntoView())
  e.view.focus()
}

// Also the Documents panel's list for a single document (ui/ProjectSidebar.tsx).
export const api = {
  list: rows,
  subscribe(on: () => void) { listeners.add(on); return () => { listeners.delete(on) } },
  setCompiled(i: number, on: boolean) { editor()?.run(setChapterCompiled(i, on)) },
  setShown(key: string, on: boolean) { editor()?.run(setChapterFolded(key, !on)) },
  setAll(what: 'compile' | 'show', on: boolean) {
    const e = editor()
    if (!e) return
    const list = chapters(e.view.state.doc)
    if (what === 'show') { e.run(setFoldedChapters(on ? [] : list.map(c => c.key))); return }
    // From the last, so the earlier chapters' positions stay put.
    for (let i = list.length - 1; i >= 0; i--) if (list[i].compiled !== on) e.run(setChapterCompiled(i, on))
  },
  move(i: number, before: number | null) { editor()?.run(moveChapter(i, before)) },
  toggleShown(i: number) {
    const r = rows()[i]
    if (r) api.setShown(r.key, !r.shown)
  },
  view: viewNow,
  setView(v: ChapterView) {
    setSetting('chapters/view', v)
    const e = editor()
    if (e && v === 'one') showOnly(Math.max(0, chapterAt(chapters(e.view.state.doc), e.view.state.selection.head)))
    else if (e && v === 'all') e.run(setFoldedChapters([]))
    changed()
  },
  window: (): DocumentsWindow => setting<DocumentsWindow>('documents/window', 'dock'),
  setWindow(w: DocumentsWindow) { setSetting('documents/window', w); changed() },
  // A heading inside a chapter (Outline view).
  goToPos(pos: number) {
    const e = editor()
    if (!e) return
    const list = chapters(e.view.state.doc)
    const i = chapterAt(list, pos)
    if (i >= 0) {
      if (viewNow() === 'one') showOnly(i)
      else if (foldedChapters(e.view.state).has(list[i].key)) e.run(setChapterFolded(list[i].key, false))
    }
    const s = e.view.state
    e.view.dispatch(s.tr.setSelection(TextSelection.near(s.doc.resolve(Math.min(pos + 1, s.doc.content.size)))).scrollIntoView())
    e.view.focus()
  },
  goTo(i: number) {
    const e = editor()
    const c = e && chapters(e.view.state.doc)[i]
    if (!e || !c) return
    if (viewNow() === 'one') showOnly(i)
    else if (foldedChapters(e.view.state).has(c.key)) e.run(setChapterFolded(c.key, false))
    const s = e.view.state
    e.view.dispatch(s.tr.setSelection(TextSelection.near(s.doc.resolve(c.heading + 1))).scrollIntoView())
    e.view.focus()
  },
  add(name = 'New chapter') {
    appendBlocks([M.section(chapterLevel(), [M.text(name)]), M.paragraph([])])
  },
  // Another file as a chapter (copied in); without `given`, one picked.
  async addFile(given?: string) {
    const path = given ?? (await platform().openFileDialog({
      title: 'Add a file as a chapter',
      filters: [{ name: 'Documents', extensions: ['ktex', 'docx', 'tex', 'md', 'pdf', 'odt', 'rtf'] }, { name: 'All', extensions: ['*'] }],
    }))?.[0]
    if (!path) return
    let blocks: M.Block[]
    try {
      blocks = await readAsBlocks(path)
    } catch (e) {
      await critical('Add a file as a chapter', e instanceof Error ? e.message : String(e))
      return
    }
    const level = chapterLevel()
    // Starting with its own chapter heading, it keeps it; otherwise it gets
    // one named after the file.
    const first = blocks.find(b => b.type === 'Section') as M.Section | undefined
    const top = Math.min(...blocks.filter((b): b is M.Section => b.type === 'Section').map(b => b.level))
    const shift = first ? level - top : 0
    const moved = blocks.map(b => (b.type === 'Section' ? { ...b, level: Math.max(0, b.level + shift) } : b))
    const head = moved[0]?.type === 'Section' && (moved[0] as M.Section).level === level ? [] : [M.section(level, [M.text(basename(path).replace(/\.[^.]+$/, ''))])]
    appendBlocks([...head, ...moved])
    appStore().set({ status: `Added "${basename(path)}" as a chapter` })
  },
}

async function openChapters(): Promise<void> {
  if (open) return
  open = true
  try { await chaptersDialog(api) } finally { open = false }
}
let open = false

registerActions({ chapters: () => openChapters() })
