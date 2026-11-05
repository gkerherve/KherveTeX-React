// Projects: several documents (chapters of a book or thesis) compiled into
// one PDF. A port of the project half of khervedoc/mainwindow.py — the
// Documents sidebar's logic (_ProjectSidebar) and MainWindow's project
// methods (_new_project ... _update_chapter_page_counts) — kept free of
// React and Tauri: everything the window does (dialogs, the editor, the
// compile) comes in through ProjectHost, so Vitest drives it on real
// folders exactly as test_documents_panel.py drives MainWindow.
import * as kdocz from '../core/kdocz.ts'
import type { CompileResult } from '../core/compiler.ts'
import {
  chapterEntry, document, fromJson, project as newProject, projectToJson, section, text,
} from '../core/model.ts'
import type { ChapterEntry, Document, Project } from '../core/model.ts'
import { basename, dirname, isAbsolute, join, normalize, withSuffix } from '../core/paths.ts'
import * as projectStore from '../core/projectStore.ts'
import type { StoreFs } from '../core/projectStore.ts'
import { chapterStem, serializeChapterBody, serializeProjectMaster } from '../core/serializer.ts'
import { strFromU8, strToU8 } from 'fflate'

// Written at the top of each project document's .tex: the log then says
// how many pages were already out when the document began, which gives
// its exact page count after a compile.
export const pageMark = (i: number): string =>
  `\\typeout{KDOC:${i}:\\thepage:\\the\\ReadonlyShipoutCounter}\n`

// _roman
export function roman(n: number): string {
  if (n <= 0) return String(n)
  let result = ''
  for (const [value, numeral] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as const) {
    while (n >= value) {
      result += numeral
      n -= value
    }
  }
  return result
}

// Path(p).stem
export function pathStem(p: string): string {
  const name = basename(p)
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

// MainWindow._doc_stem: the base name without compound extensions.
export function windowDocStem(p: string): string {
  const name = basename(p)
  for (const ext of ['.ktex.json', '.kdoc.json']) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length)
  }
  return pathStem(p)
}

// MainWindow._safe_name
export function safeName(label: string): string {
  let out = ''
  for (const c of label) out += /^[\p{L}\p{N}]$/u.test(c) || ' _-'.includes(c) ? c : '_'
  return out.replace(/^ +| +$/g, '').replaceAll(' ', '_') || 'document'
}

// serializer._GRAPHICS_PATH_RE
const GRAPHICS_PATH_RE = /(\\includegraphics\*?(?:\[[^\]]*\])?\{)([^}]+)(\})/g

// os.path.relpath for two absolute, normalised paths.
function relpath(target: string, start: string): string {
  const t = normalize(target).split('/').filter(Boolean)
  const s = normalize(start).split('/').filter(Boolean)
  let k = 0
  while (k < t.length && k < s.length && t[k] === s[k]) k++
  return [...s.slice(k).map(() => '..'), ...t.slice(k)].join('/') || '.'
}

// serializer.chapter_body_tex: a chapter's body LaTeX, as written into the
// project folder next to the master. Image paths written relative to the
// chapter's own folder are re-pointed relative to the project folder,
// where the master (and so LaTeX) resolves them.
export async function chapterBodyTex(doc: Document, chapterDir: string, projectDir: string,
  fs: { exists(p: string): Promise<boolean> }): Promise<string> {
  const body = serializeChapterBody(doc)
  if (normalize(chapterDir) === normalize(projectDir)) return body
  const matches = [...body.matchAll(GRAPHICS_PATH_RE)]
  const fixed: string[] = []
  for (const m of matches) {
    const path = m[2]
    let out = m[0]
    if (!isAbsolute(path) && !(await fs.exists(join(projectDir, path)))) {
      const candidate = join(chapterDir, path)
      if (await fs.exists(candidate)) out = m[1] + relpath(candidate, projectDir) + m[3]
    }
    fixed.push(out)
  }
  let k = 0
  return body.replace(GRAPHICS_PATH_RE, () => fixed[k++])
}

const ADDABLE = ['.ktex', '.ktexz', '.ktex.json', '.kdocz', '.kdoc.json', '.tex']

// ====================================================================
// The Documents sidebar (_ProjectSidebar), minus its widgets.
// ====================================================================

export interface SidebarRow {
  text: string
  // A project row has a tick box; the single document's row does not.
  checkable: boolean
  checked: boolean
  // Unticked rows are greyed (#999).
  grey: boolean
  bold: boolean
}

export interface SidebarSignals {
  chapterDoubleClicked?(idx: number): void | Promise<void>
  chapterToggled?(idx: number, enabled: boolean): void | Promise<void>
  addChapterRequested?(): void | Promise<void>
  // Existing document files to add, from the Add menu or a drop.
  addExistingRequested?(paths: string[]): void | Promise<void>
  // New order as a list of old indices; the window applies it, so the
  // project, its open documents and the numbering all move together.
  orderRequested?(order: number[]): void | Promise<void>
  removeRequested?(idx: number): void | Promise<void>
  compileRequested?(): void | Promise<void>
  autoPageToggled?(on: boolean): void | Promise<void>
}

export const SECTION_TYPE_LABELS: [string, string][] = [
  ['frontmatter', 'Front matter (preface, dedication…)'],
  ['chapter', 'Chapter (numbered)'],
  ['appendix', 'Appendix'],
  ['backmatter', 'Back matter (bibliography, index…)'],
]

export class SidebarModel {
  signals: SidebarSignals = {}
  project: Project | null = null
  activeIndex = -1
  currentRow = -1
  rows: SidebarRow[] = []
  titleText = 'PROJECT'
  summaryText = ''
  autoPage = true
  // The dock already says "Documents"; the project title heading is only
  // worth its space once there is a project.
  projectControlsVisible = false
  private listeners = new Set<() => void>()
  private revision = 0

  constructor() {
    this.setSingle('Untitled')
  }

  get chapters(): ChapterEntry[] {
    return this.project?.chapters ?? []
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }

  version = (): number => this.revision

  private changed(): void {
    this.revision++
    for (const l of this.listeners) l()
  }

  // Show the one open document, so the list is always there and a second
  // document appears in it as soon as it's added.
  setSingle(name: string): void {
    this.project = null
    this.activeIndex = 0
    this.projectControlsVisible = false
    this.rows = [{ text: `\u{1F4C4}  ${name}`, checkable: false, checked: false, grey: false, bold: true }]
    this.currentRow = -1
    this.changed()
  }

  setProject(proj: Project): void {
    this.projectControlsVisible = true
    this.project = proj
    this.titleText = proj.meta.title || 'Untitled Project'
    this.autoPage = proj.auto_page_numbers
    // Page ranges follow list position, so a reorder or removal must
    // renumber now rather than wait for the next compile.
    if (proj.auto_page_numbers) this.recomputeAutoPages()
    else this.rebuildList()
  }

  setActiveIndex(idx: number): void {
    this.activeIndex = idx
    this.rows = this.rows.map((r, i) => ({ ...r, bold: i === idx }))
    this.changed()
  }

  setCurrentRow(idx: number): void {
    this.currentRow = idx
    this.changed()
  }

  static addable(path: string): boolean {
    const low = path.toLowerCase()
    return ADDABLE.some(e => low.endsWith(e)) && !low.endsWith('.kdocproj.json')
  }

  // A file drop anywhere on the panel: the addable files, or none (the
  // drop is then not the panel's).
  droppedFiles(paths: string[]): string[] {
    return paths.filter(p => SidebarModel.addable(p))
  }

  async dropFiles(paths: string[]): Promise<boolean> {
    const files = this.droppedFiles(paths)
    if (!files.length) return false
    await this.signals.addExistingRequested?.(files)
    return true
  }

  // Recompute start_page for every chapter from cumulative page counts.
  // Called after compilation updates last_known_pages.
  recomputeAutoPages(): void {
    if (this.project === null || !this.project.auto_page_numbers) return
    let running = 0
    let prevNumbering: string | null = null
    for (const ch of this.chapters) {
      if (ch.numbering !== prevNumbering) {
        // Numbering system change resets the counter
        ch.start_page = 1
        running = 0
        prevNumbering = ch.numbering
      } else {
        ch.start_page = running + 1
      }
      running += ch.last_known_pages > 0 ? ch.last_known_pages : 1
    }
    this.rebuildList()
  }

  async onAutoPageToggled(checked: boolean): Promise<void> {
    if (this.project !== null) this.project.auto_page_numbers = checked
    this.autoPage = checked
    if (checked) this.recomputeAutoPages()
    else this.changed()
    await this.signals.autoPageToggled?.(checked)
  }

  rebuildList(): void {
    const rows: SidebarRow[] = []
    let totalPages = 0
    let compilingPages = 0
    let chCounter = 0           // running chapter number
    let appCounter = 0          // running appendix letter
    this.chapters.forEach((ch, i) => {
      let pageRange = ''
      if (ch.last_known_pages > 0) {
        if (ch.start_page !== null) {
          const start = ch.start_page
          const end = start + ch.last_known_pages - 1
          const fmt = ch.numbering === 'roman' ? roman(start) + '–' + roman(end) : `${start}–${end}`
          pageRange = `  pp. ${fmt}  (${ch.last_known_pages}p)`
        } else {
          pageRange = `  (${ch.last_known_pages}p)`
        }
      }
      totalPages += ch.last_known_pages
      if (ch.enabled) compilingPages += ch.last_known_pages
      const label = ch.label || pathStem(ch.path)
      const ctype = ch.chapter_type ?? 'chapter'
      // Build a prefix showing the chapter/appendix number
      let prefix = ''
      if (ctype === 'chapter') {
        chCounter += 1
        const num = ch.chapter_number !== null ? ch.chapter_number : chCounter
        prefix = `Ch. ${num} — `
      } else if (ctype === 'appendix') {
        appCounter += 1
        const num = ch.chapter_number !== null ? ch.chapter_number : appCounter
        prefix = `App. ${String.fromCharCode(64 + num)} — `
      } else if (ctype === 'frontmatter') {
        prefix = '◇ '   // diamond
      } else if (ctype === 'backmatter') {
        prefix = '○ '   // circle
      }
      rows.push({
        text: `${prefix}${label}${pageRange}`, checkable: true, checked: ch.enabled,
        grey: !ch.enabled, bold: i === this.activeIndex,
      })
    })
    this.rows = rows
    // QListWidget.clear() drops the current row.
    this.currentRow = -1
    let summary = `Total: ~${totalPages}p`
    if (compilingPages !== totalPages) summary += `  ·  Compiling: ~${compilingPages}p`
    this.summaryText = summary
    this.changed()
  }

  // _on_item_changed: a tick box clicked.
  async setChecked(idx: number, enabled: boolean): Promise<void> {
    if (idx < this.chapters.length) {
      this.chapters[idx].enabled = enabled
      await this.signals.chapterToggled?.(idx, enabled)
      this.rebuildList()
    }
  }

  async doubleClick(idx: number): Promise<void> {
    await this.signals.chapterDoubleClicked?.(idx)
  }

  // _on_rows_moved: the list has been reordered by a drag; `order` is the
  // original index of each row as it now stands.
  async rowsMoved(order: number[]): Promise<void> {
    const n = this.chapters.length
    const sorted = [...order].sort((a, b) => a - b)
    if (sorted.every((v, i) => v === i) && sorted.length === n && order.some((v, i) => v !== i)) {
      await this.signals.orderRequested?.(order)
    }
  }

  async move(idx: number, delta: number): Promise<void> {
    const dest = idx + delta
    const n = this.chapters.length
    if (!(idx >= 0 && idx < n && dest >= 0 && dest < n)) return
    const order = [...Array(n).keys()]
    ;[order[idx], order[dest]] = [order[dest], order[idx]]
    await this.signals.orderRequested?.(order)
    this.setCurrentRow(dest)
  }

  moveUp(): Promise<void> {
    return this.move(this.currentRow, -1)
  }

  moveDown(): Promise<void> {
    return this.move(this.currentRow, +1)
  }

  async removeCurrent(): Promise<void> {
    const idx = this.currentRow
    if (idx >= 0 && idx < this.chapters.length) await this.signals.removeRequested?.(idx)
  }

  // ---- the context menu's edits (_on_context_menu) ----

  rename(idx: number, newLabel: string | null): void {
    if (newLabel !== null && newLabel.trim()) {
      this.chapters[idx].label = newLabel.trim()
      this.rebuildList()
    }
  }

  setChapterNumber(idx: number, val: number): void {
    this.chapters[idx].chapter_number = val > 0 ? val : null
    this.rebuildList()
  }

  setStartPage(idx: number, val: number): void {
    this.chapters[idx].start_page = val > 0 ? val : null
    this.rebuildList()
  }

  setNumbering(idx: number, numbering: 'arabic' | 'roman'): void {
    this.chapters[idx].numbering = numbering
    this.rebuildList()
  }

  setSectionType(idx: number, key: string): void {
    const ch = this.chapters[idx]
    ch.chapter_type = key
    if (key === 'frontmatter' || key === 'backmatter') ch.numbering = 'roman'
    this.rebuildList()
  }
}

// ====================================================================
// MainWindow's project methods.
// ====================================================================

export interface ProjectFs extends StoreFs {
  mkdir(path: string): Promise<void>
  // shutil.copy2
  copy(src: string, dest: string): Promise<void>
  // shutil.move
  move(src: string, dest: string): Promise<void>
  makeTempDir(prefix: string): Promise<string>
}

// What the window gives the project code.
export interface ProjectHost {
  fs: ProjectFs
  // DocumentEditor: get_document / set_document (which also clears the
  // modified flag), set_heading_offset, set_first_page_number.
  getDocument(): Document
  setDocument(doc: Document): void
  setHeadingOffset(counters: number[] | null): void
  setFirstPageNumber(n: number): void
  // text_edit.document().setModified(False)
  clearModified(): void
  // MainWindow._import_source_dir
  setImportSourceDir(dir: string | null): void
  // MainWindow._current_path, and the single-document actions.
  currentPath(): string | null
  setCurrentPath(path: string | null): void
  saveAs(): Promise<void>
  newDocument(): Promise<void>
  importTex(path: string): Promise<Document>
  // The project changed: mirror it into the app's store.
  publish(project: Project | null, projectPath: string | null, chapterIndex: number): void
  updateTitle(): void
  showDock(): void
  // Dialogs: QInputDialog.getText, QFileDialog.getExistingDirectory /
  // getOpenFileName, QMessageBox.
  getText(title: string, label: string, value: string): Promise<string | null>
  getFolder(title: string): Promise<string | null>
  getOpenProject(): Promise<string | null>
  question(title: string, text: string): Promise<boolean>
  information(title: string, text: string): Promise<void>
  warning(title: string, text: string): Promise<void>
  critical(title: string, text: string): Promise<void>
  showMessage(msg: string, ms: number): void
  consoleAppend(msg: string): void
  gitSnapshot(folder: string, name: string, stem: string | null): Promise<void>
  // MainWindow._auto_compile / _kick_compile
  autoCompile(): boolean
  kickCompile(): void | Promise<void>
  // The compile itself: the engine in use, the build dir, and a LaTeX
  // run of the master (null when tectonic is missing or a compile is
  // already running).
  engine(): 'latex' | 'typst'
  buildDir(): Promise<string>
  compileMaster(source: string, sourceDir: string): Promise<CompileResult | null>
  // The compiled PDF's page count and each page's text (pymupdf).
  pdfPages(pdfPath: string): Promise<string[]>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class ProjectSession {
  project: Project | null = null
  projectPath: string | null = null
  // which chapter is in the editor
  chapterIdx = -1
  // cached docs
  chapterDocs = new Map<number, Document>()
  lastCompileResult: CompileResult | null = null
  readonly sidebar = new SidebarModel()

  readonly host: ProjectHost

  constructor(host: ProjectHost) {
    this.host = host
    this.sidebar.signals = {
      chapterDoubleClicked: i => this.switchChapter(i),
      chapterToggled: (i, on) => this.onChapterToggled(i, on),
      addChapterRequested: () => this.onAddDocument(),
      addExistingRequested: paths => this.addExistingDocuments(paths),
      orderRequested: order => this.reorderChapters(order),
      removeRequested: i => this.removeChapter(i),
      compileRequested: () => this.compileProject(),
    }
  }

  private get fs(): ProjectFs {
    return this.host.fs
  }

  private publish(): void {
    this.host.publish(this.project, this.projectPath, this.chapterIdx)
  }

  // ---- title (the project half of _update_title) ----

  // "<project title> — <document label>", or null with no project open.
  titleText(): string | null {
    if (this.project === null || this.projectPath === null) return null
    const projTitle = this.project.meta.title || pathStem(this.projectPath)
    let chLabel = ''
    if (this.chapterIdx >= 0 && this.chapterIdx < this.project.chapters.length) {
      const ch = this.project.chapters[this.chapterIdx]
      chLabel = ` — ${ch.label || pathStem(ch.path)}`
    }
    return `${projTitle}${chLabel}`
  }

  // The single-document half of _update_title that concerns projects.
  onSingleTitle(): void {
    this.host.setHeadingOffset(null)
    this.host.setFirstPageNumber(1)
    const cur = this.host.currentPath()
    this.sidebar.setSingle(cur ? windowDocStem(cur) : 'Untitled')
  }

  updateTitle(): void {
    if (this.project === null || this.projectPath === null) this.onSingleTitle()
    this.host.updateTitle()
  }

  // ---- project operations ----

  // Create a new multi-chapter project.
  async newProject(): Promise<void> {
    const title = await this.host.getText('New Project', 'Project title:', 'My Thesis')
    if (title === null || !title.trim()) return
    const projDir = await this.host.getFolder('Choose project folder')
    if (!projDir) return
    const proj = newProject()
    proj.meta.title = title.trim()
    proj.meta.documentclass = 'book'
    // The first document is the project's main .ktex and holds the
    // project itself, so the folder is just the .ktex files.
    const main = await projectStore.uniquePath(projDir, safeName(title), this.fs)
    await projectStore.writeDoc(document([section(1, [text('Introduction')])], proj.meta), main, this.fs)
    proj.chapters.push(chapterEntry({
      path: basename(main), label: 'Introduction', enabled: true, start_page: 1, numbering: 'arabic',
    }))
    await kdocz.writeProjectJson(main, projectToJson(proj), this.fs)
    await this.openProjectFromPath(main)
  }

  async openProject(): Promise<void> {
    const path = await this.host.getOpenProject()
    if (!path) return
    await this.openProjectFromPath(path)
  }

  async openProjectFromPath(path: string): Promise<void> {
    await this.leaveProject()
    let proj: Project | null
    try {
      proj = await projectStore.readProject(path, this.fs)
      if (proj === null) throw new Error(`${basename(path)} does not hold a project`)
    } catch (exc) {
      await this.host.critical('Open project failed', errText(exc))
      return
    }
    this.project = proj
    this.projectPath = path
    this.chapterIdx = -1
    this.chapterDocs.clear()
    this.sidebar.setProject(proj)
    this.host.showDock()
    this.publish()
    this.updateTitle()
    // Open the first chapter
    if (proj.chapters.length) await this.switchChapter(0)
    this.host.showMessage(`Opened project: ${proj.meta.title} (${proj.chapters.length} chapters)`, 5000)
  }

  async saveProject(): Promise<void> {
    if (this.project === null || this.projectPath === null) {
      this.host.showMessage('No project is open', 3000)
      return
    }
    // Save current chapter doc back to disk
    await this.flushCurrentChapter()
    await this.writeProjectManifest()
    const projDir = dirname(this.projectPath)
    const chapterDocs = await this.writeChapterTexFiles(projDir)
    const masterTex = serializeProjectMaster(this.project, chapterDocs)
    await this.fs.write(await this.masterTexPath(), strToU8(masterTex))
    // Without this the open document kept reading as unsaved, and a
    // project save never reached the Git history.
    this.host.clearModified()
    await this.host.gitSnapshot(projDir, basename(this.projectPath), null)
  }

  // The project's master .tex — in .kherve/, and not named like the main
  // document's own chapter file, which it \includes.
  async masterTexPath(): Promise<string> {
    const stem = projectStore.docStem(this.projectPath!)
    return join(await projectStore.workDir(dirname(this.projectPath!), this.fs), `${stem}-master.tex`)
  }

  async writeProjectManifest(): Promise<void> {
    if (basename(this.projectPath!).toLowerCase().endsWith('.kdocproj.json')) await this.migrateLegacyProject()
    await kdocz.writeProjectJson(this.projectPath!, projectToJson(this.project!), this.fs)
  }

  // Turn a .kdocproj.json project of .kdoc.json files into .ktex files,
  // the first holding the project. The old files are moved to
  // .kherve/legacy/, not deleted.
  async migrateLegacyProject(): Promise<void> {
    const fs = this.fs
    const proj = this.project!
    const projDir = dirname(this.projectPath!)
    const legacy = join(await projectStore.workDir(projDir, fs), 'legacy')
    await fs.mkdir(legacy)
    const projStem = projectStore.docStem(this.projectPath!)

    const stash = async (p: string) => {
      if (await fs.exists(p)) await fs.move(p, join(legacy, basename(p)))
    }

    for (const [i, ch] of proj.chapters.entries()) {
      const src = join(projDir, ch.path)
      if (kdocz.isKdoczPath(src) && !kdocz.isLegacyBundle(src)) continue
      const doc = this.chapterDocs.get(i) ?? await projectStore.readDoc(src, fs)
      const stem = projectStore.docStem(src)
      await stash(join(projDir, `${chapterStem(ch)}.tex`))
      await stash(src)
      // "Paper-1" was the copy of Paper.ktex made when the project
      // began; it is the newer text, so it takes the original name.
      let dest: string
      if (i === 0 && stem === `${projStem}-1`) {
        await stash(join(projDir, `${projStem}.ktex`))
        dest = join(projDir, `${projStem}.ktex`)
      } else {
        dest = await projectStore.uniquePath(projDir, stem, fs)
      }
      await projectStore.writeDoc(doc, dest, fs)
      ch.path = basename(dest)
    }
    await stash(join(projDir, `${projStem}.tex`))
    await stash(this.projectPath!)
    this.projectPath = join(projDir, proj.chapters[0].path)
    this.publish()
    this.host.showMessage('Project converted to .ktex files; the old files are in .kherve/legacy', 8000)
  }

  async closeProject(): Promise<void> {
    await this.host.newDocument()
  }

  // Save the open project document and drop the project, before the
  // editor shows anything else. Staying in project mode made the next
  // save write the new text over whichever document was open.
  async leaveProject(): Promise<void> {
    if (this.project === null) return
    await this.flushCurrentChapter()
    this.project = null
    this.projectPath = null
    this.chapterIdx = -1
    this.chapterDocs.clear()
    this.sidebar.setActiveIndex(-1)
    this.publish()
  }

  // Save the editor's current document back to the chapter file.
  async flushCurrentChapter(): Promise<void> {
    if (this.project === null || this.projectPath === null || this.chapterIdx < 0) return
    const doc = this.host.getDocument()
    const idx = this.chapterIdx
    this.chapterDocs.set(idx, doc)
    const ch = this.project.chapters[idx]
    await projectStore.writeDoc(doc, join(dirname(this.projectPath), ch.path), this.fs)
  }

  async switchChapter(idx: number): Promise<void> {
    if (this.project === null || this.projectPath === null) return
    if (idx < 0 || idx >= this.project.chapters.length) return
    // Save current chapter first
    await this.flushCurrentChapter()
    const ch = this.project.chapters[idx]
    const chPath = join(dirname(this.projectPath), ch.path)
    let doc: Document
    const cached = this.chapterDocs.get(idx)
    if (cached !== undefined) {
      doc = cached
    } else if (await this.fs.exists(chPath)) {
      try {
        doc = await projectStore.readDoc(chPath, this.fs)
      } catch (exc) {
        await this.host.warning('Chapter load failed', `Could not load ${ch.path}:\n${errText(exc)}`)
        return
      }
    } else {
      doc = document([], this.project.meta)
    }
    this.chapterDocs.set(idx, doc)
    this.chapterIdx = idx
    this.sidebar.setActiveIndex(idx)
    this.host.setImportSourceDir(dirname(chPath))
    const offset = await this.headingOffsetBefore(idx)
    // The editor starts a replaced document at zero, so the numbering
    // follows set_document here.
    this.host.setDocument(doc)
    this.host.setHeadingOffset(offset)
    this.syncFirstPageNumber()
    this.publish()
    this.updateTitle()
  }

  // The Visual tab's footer continues from the previous documents' pages,
  // as the compiled PDF does.
  syncFirstPageNumber(): void {
    let start = 1
    if (this.project !== null && this.chapterIdx >= 0 && this.chapterIdx < this.project.chapters.length) {
      start = this.project.chapters[this.chapterIdx].start_page || 1
    }
    this.host.setFirstPageNumber(start)
  }

  // Heading counters after all enabled documents before `idx`, counted
  // the way LaTeX counts them through the \includes.
  async headingOffsetBefore(idx: number): Promise<number[]> {
    const counters = [0, 0, 0, 0, 0, 0]
    const projDir = dirname(this.projectPath!)
    for (const [i, ch] of this.project!.chapters.slice(0, Math.max(0, idx)).entries()) {
      if (!ch.enabled) continue
      let doc = this.chapterDocs.get(i)
      if (doc === undefined) {
        try {
          doc = await projectStore.readDoc(join(projDir, ch.path), this.fs)
        } catch {
          continue
        }
        this.chapterDocs.set(i, doc)
      }
      for (const block of doc.children) {
        if (block.type === 'Section' && block.numbered && block.level >= 0 && block.level <= 5) {
          counters[block.level] += 1
          for (let k = block.level + 1; k < 6; k++) counters[k] = 0
        }
      }
    }
    return counters
  }

  async onChapterToggled(idx: number, enabled: boolean): Promise<void> {
    if (this.project === null) return
    this.project.chapters[idx].enabled = enabled
    if (idx < this.chapterIdx) this.host.setHeadingOffset(await this.headingOffsetBefore(this.chapterIdx))
  }

  // Put the project's documents in `order` (old indices). LaTeX numbers
  // chapters and sections by position, so everything after the first
  // moved document is renumbered.
  async reorderChapters(order: number[]): Promise<void> {
    const proj = this.project
    if (proj === null) return
    const sorted = [...order].sort((a, b) => a - b)
    if (sorted.length !== proj.chapters.length || sorted.some((v, i) => v !== i)) return
    await this.flushCurrentChapter()
    const old = [...proj.chapters]
    proj.chapters.splice(0, proj.chapters.length, ...order.map(i => old[i]))
    this.chapterDocs = this.remap(order)
    if (this.chapterIdx >= 0) this.chapterIdx = order.indexOf(this.chapterIdx)
    await this.afterProjectChange()
  }

  // {new: docs[old]} for new, old in enumerate(order) if old in docs
  private remap(order: number[]): Map<number, Document> {
    const out = new Map<number, Document>()
    order.forEach((oldIdx, newIdx) => {
      const d = this.chapterDocs.get(oldIdx)
      if (d !== undefined) out.set(newIdx, d)
    })
    return out
  }

  // Take a document out of the project. Its files stay on disk.
  async removeChapter(idx: number): Promise<void> {
    const proj = this.project
    if (proj === null || !(idx >= 0 && idx < proj.chapters.length)) return
    if (proj.chapters.length === 1) {
      await this.host.information('Remove document', 'A project needs at least one document.')
      return
    }
    const ch = proj.chapters[idx]
    const name = ch.label || pathStem(ch.path)
    if (!(await this.host.question('Remove document',
      `Remove “${name}” from the project?\n\nIts file stays in the project folder.`))) return
    await this.flushCurrentChapter()
    const wasCurrent = idx === this.chapterIdx
    const order = [...proj.chapters.keys()].filter(i => i !== idx)
    proj.chapters.splice(idx, 1)
    this.chapterDocs = this.remap(order)
    if (wasCurrent) {
      this.chapterIdx = -1
      await this.afterProjectChange()
      await this.switchChapter(Math.min(idx, proj.chapters.length - 1))
      return
    }
    if (this.chapterIdx > idx) this.chapterIdx -= 1
    await this.afterProjectChange()
  }

  // Order or membership changed: save, redraw the list, renumber the open
  // document and recompile.
  async afterProjectChange(): Promise<void> {
    this.sidebar.setProject(this.project!)
    this.sidebar.setActiveIndex(this.chapterIdx)
    this.publish()
    if (this.chapterIdx >= 0) this.host.setHeadingOffset(await this.headingOffsetBefore(this.chapterIdx))
    if (this.projectPath !== null) await this.saveProject()
    if (this.host.autoCompile()) await this.host.kickCompile()
  }

  async onAddDocument(): Promise<void> {
    if (this.project !== null) await this.addChapterToProject()
    else await this.convertToProject()
  }

  // Turn the open document into a project holding it plus a new document,
  // so both are listed side by side from now on.
  async convertToProject(): Promise<void> {
    const label = await this.host.getText('Add document', 'Name of the new document:', 'Chapter 2')
    if (label === null || !label.trim()) return
    if (!(await this.makeProjectFromOpenDocument())) return
    await this.appendChapter(label.trim())
    await this.saveProject()
  }

  // Wrap the open document in a one-document project in its folder. False
  // if the user declined to save it first.
  async makeProjectFromOpenDocument(): Promise<boolean> {
    const fs = this.fs
    if (this.host.currentPath() === null) {
      await this.host.information('Add document',
        'Save this document first — the documents of a project are kept together in its folder.')
      await this.host.saveAs()
      if (this.host.currentPath() === null) return false
    }
    const current = this.host.currentPath()!
    // The open document itself becomes the project's main .ktex.
    let main = current
    if (!kdocz.isKdoczPath(main) || kdocz.isLegacyBundle(main)) {
      main = join(dirname(main), `${windowDocStem(main)}${kdocz.NATIVE_SUFFIX}`)
    }
    const doc = this.host.getDocument()
    await projectStore.writeDoc(doc, main, fs)
    const stem = windowDocStem(main)
    const proj = newProject({ meta: structuredClone(doc.meta) })
    proj.meta.title = doc.meta.title || stem
    proj.chapters.push(chapterEntry({
      path: basename(main), label: stem, enabled: true, start_page: 1, numbering: 'arabic',
    }))
    await kdocz.writeProjectJson(main, projectToJson(proj), fs)
    if (main !== current && await fs.exists(current)) {
      // A .ktex.json / .ktexz original is now superseded by the .ktex.
      const legacy = join(await projectStore.workDir(dirname(main), fs), 'legacy')
      await fs.mkdir(legacy)
      await fs.move(current, join(legacy, basename(current)))
    }
    this.host.setCurrentPath(null)
    await this.openProjectFromPath(main)
    return true
  }

  // Add document files to the project as they are. A file already in the
  // project folder is referenced in place; anything else is copied in as a
  // document (bundle images unpacked beside it).
  async addExistingDocuments(paths: string[]): Promise<void> {
    if (this.project === null && !(await this.makeProjectFromOpenDocument())) return
    const proj = this.project!
    const projDir = dirname(this.projectPath!)
    const have = new Set(proj.chapters.map(ch => normalize(join(projDir, ch.path))))
    let added = 0
    const failed: string[] = []
    for (const p of paths) {
      let rel: string | null
      try {
        rel = await this.chapterFileFor(p, projDir, have)
      } catch (exc) {
        failed.push(`${basename(p)}: ${errText(exc)}`)
        continue
      }
      if (rel === null) continue
      have.add(normalize(join(projDir, rel)))
      proj.chapters.push(chapterEntry({ path: rel, label: windowDocStem(p), enabled: true }))
      added += 1
    }
    if (failed.length) await this.host.warning('Add documents', 'Could not add:\n' + failed.join('\n'))
    if (added) {
      this.sidebar.setProject(proj)
      this.publish()
      await this.saveProject()
      this.host.showMessage(`Added ${added} document${added > 1 ? 's' : ''}`, 5000)
    }
  }

  // Project-relative .ktex holding `src`, or null if it is already listed.
  // A .ktex in the folder is used as it is; one elsewhere is copied in;
  // anything else is converted to .ktex.
  async chapterFileFor(src: string, projDir: string, have: Set<string>): Promise<string | null> {
    const fs = this.fs
    const low = basename(src).toLowerCase()
    if (have.has(normalize(src))) return null
    const native = kdocz.isKdoczPath(src) && !kdocz.isLegacyBundle(src)
    const inFolder = normalize(dirname(src)) === normalize(projDir)
    if (native && inFolder) return basename(src)
    const stem = windowDocStem(src)
    if (native) {
      const dest = await projectStore.uniquePath(projDir, stem, fs)
      await fs.copy(src, dest)
      return basename(dest)
    }
    let doc: Document
    if (kdocz.isKdoczPath(src)) {
      ;[doc] = await kdocz.loadKdocz(src, await fs.makeTempDir('kdocz-'), fs)
    } else if (low.endsWith('.tex')) {
      doc = await this.host.importTex(src)
    } else {
      doc = fromJson(strFromU8(await fs.read(src)).replace(/\r\n?/g, '\n'))
    }
    // Relative figure paths pointed next to the source; keep them working.
    for (const block of doc.children) {
      if (block.type === 'Figure' && block.path && !isAbsolute(block.path)) {
        block.path = normalize(join(dirname(src), block.path))
      }
    }
    const dest = await projectStore.uniquePath(projDir, stem, fs)
    await projectStore.writeDoc(doc, dest, fs)
    if (inFolder) {
      // The .ktex replaces it; keep the folder to .ktex files only.
      const legacy = join(await projectStore.workDir(projDir, fs), 'legacy')
      await fs.mkdir(legacy)
      for (const old of [src, join(dirname(src), `${stem}.tex`)]) {
        if (await fs.exists(old)) await fs.move(old, join(legacy, basename(old)))
      }
    }
    return basename(dest)
  }

  async addChapterToProject(): Promise<void> {
    if (this.project === null || this.projectPath === null) return
    const label = await this.host.getText('Add document', 'Name of the new document:', 'New Chapter')
    if (label === null || !label.trim()) return
    await this.appendChapter(label.trim())
  }

  async appendChapter(label: string): Promise<void> {
    const proj = this.project!
    const projDir = dirname(this.projectPath!)
    const chPath = await projectStore.uniquePath(projDir, safeName(label).toLowerCase(), this.fs)
    const doc = document([section(1, [text(label)])], proj.meta)
    await projectStore.writeDoc(doc, chPath, this.fs)
    proj.chapters.push(chapterEntry({ path: basename(chPath), label, enabled: true }))
    this.sidebar.setProject(proj)
    await this.switchChapter(proj.chapters.length - 1)
  }

  // Write every chapter's body .tex into the project folder under the stem
  // the master \includes, and return the chapter documents (the master
  // hoists their packages). Failures are reported, not swallowed — a
  // silent failure left a stale chapter in the PDF.
  async writeChapterTexFiles(projDir: string): Promise<Document[]> {
    const docs: Document[] = []
    const failed: string[] = []
    const work = await projectStore.workDir(projDir, this.fs)
    for (const [i, ch] of this.project!.chapters.entries()) {
      const chPath = join(projDir, ch.path)
      try {
        const doc = this.chapterDocs.get(i) ?? await projectStore.readDoc(chPath, this.fs)
        await this.fs.write(join(work, `${chapterStem(ch)}.tex`),
          strToU8(pageMark(i) + await chapterBodyTex(doc, dirname(chPath), projDir, this.fs)))
        docs.push(doc)
      } catch (exc) {
        failed.push(`${ch.label || ch.path}: ${errText(exc)}`)
      }
    }
    if (failed.length) {
      const msg = 'Could not write chapter(s): ' + failed.join('; ')
      this.host.showMessage('⚠ ' + msg, 15000)
      this.host.consoleAppend(msg)
    }
    return docs
  }

  // Compile the entire project via the master .tex.
  async compileProject(): Promise<void> {
    if (this.project === null || this.projectPath === null) return
    await this.flushCurrentChapter()
    await this.writeProjectManifest()
    const projDir = dirname(this.projectPath)
    const chapterDocs = await this.writeChapterTexFiles(projDir)
    const masterTex = serializeProjectMaster(this.project, chapterDocs)
    await this.fs.write(await this.masterTexPath(), strToU8(masterTex))
    // Copy chapter .tex files into the build dir so \include can find them
    const build = await this.host.buildDir()
    await this.fs.mkdir(build)
    const work = await projectStore.workDir(projDir, this.fs)
    for (const ch of this.project.chapters) {
      const stem = chapterStem(ch)
      const src = join(work, `${stem}.tex`)
      if (await this.fs.exists(src)) await this.fs.copy(src, join(build, `${stem}.tex`))
    }
    if (this.host.engine() === 'typst') {
      this.host.showMessage('Project compilation only supports LaTeX', 3000)
      return
    }
    const result = await this.host.compileMaster(masterTex, projDir)
    if (result !== null) await this.onProjectCompileDone(result)
  }

  // The preview and console have been updated by the compile; what is left
  // is the page counts.
  async onProjectCompileDone(result: CompileResult): Promise<void> {
    this.lastCompileResult = result
    if (result.ok && result.pdfPath !== null) {
      if (this.project !== null) {
        if (!(await this.pageCountsFromLog(result))) await this.updateChapterPageCounts(result.pdfPath)
      }
      this.host.showMessage('✔ Project compiled successfully', 5000)
    }
  }

  // Each document's real page count and first page number, from the
  // markers its .tex writes to the log. False if none were found.
  async pageCountsFromLog(result: { pdfPath: string | null; log: string }): Promise<boolean> {
    let log = result.log || ''
    const logFile = result.pdfPath !== null ? withSuffix(result.pdfPath, '.log') : null
    if (logFile !== null && await this.fs.exists(logFile)) {
      log = new TextDecoder('utf-8').decode(await this.fs.read(logFile))
    }
    const found = new Map<number, [number, string, number]>()
    // The last pass's values win: early passes may lack the ToC.
    for (const m of log.matchAll(/KDOC:(\d+):([^:\s]*):(\d+)/g)) {
      const i = parseInt(m[1], 10)
      found.set(i, [i, m[2], parseInt(m[3], 10)])
    }
    const chapters = this.project!.chapters
    const marks = [...found.values()].sort((a, b) => a[2] - b[2]).filter(m => m[0] < chapters.length)
    if (!marks.length) return false
    let total: number
    try {
      total = (await this.host.pdfPages(result.pdfPath!)).length
    } catch {
      total = marks[marks.length - 1][2] + 1
    }
    marks.forEach(([i, , shipped], k) => {
      const end = k + 1 < marks.length ? marks[k + 1][2] : total
      chapters[i].last_known_pages = Math.max(1, end - shipped)
    })
    this.sidebar.recomputeAutoPages()
    this.syncFirstPageNumber()
    this.publish()
    return true
  }

  // Read the compiled PDF and assign page counts to each enabled chapter
  // by detecting \chapter headings in the PDF text.
  async updateChapterPageCounts(pdfPath: string): Promise<void> {
    if (this.project === null) return
    try {
      const pages = await this.host.pdfPages(pdfPath)
      const totalPages = pages.length
      // Try to find chapter boundaries by looking for the chapter title
      // text on each page. Each enabled chapter's label (or its section
      // heading) should appear near the top of its first page.
      const enabled = this.project.chapters.filter(ch => ch.enabled)
      if (!enabled.length) return
      // (chapter_index_in_enabled, first_page_0based)
      const chStarts: [number, number][] = []
      enabled.forEach((ch, ci) => {
        let cleanLabel = ch.label || pathStem(ch.path)
        // Strip numbering prefix like "1 — " for matching
        for (const sep of [' — ', ' - ', ' – ']) {
          const at = cleanLabel.indexOf(sep)
          if (at >= 0) {
            cleanLabel = cleanLabel.slice(at + sep.length)
            break
          }
        }
        // Search each page for the chapter's title text
        for (let pi = 0; pi < totalPages; pi++) {
          const pageText = [...pages[pi]].slice(0, 500).join('')
          if (cleanLabel && pageText.toLowerCase().includes(cleanLabel.toLowerCase())) {
            chStarts.push([ci, pi])
            break
          }
        }
      })
      if (chStarts.length) {
        // Sort by page number and compute page counts
        chStarts.sort((a, b) => a[1] - b[1])
        chStarts.forEach(([ci, startPage], j) => {
          const pagesOf = j + 1 < chStarts.length ? chStarts[j + 1][1] - startPage : totalPages - startPage
          enabled[ci].last_known_pages = Math.max(1, pagesOf)
        })
      } else {
        // Fallback: divide evenly
        const perCh = Math.floor(totalPages / enabled.length)
        let remainder = totalPages % enabled.length
        for (const ch of enabled) {
          ch.last_known_pages = perCh + (remainder > 0 ? 1 : 0)
          remainder -= 1
        }
      }
    } catch {
      return
    }
    this.sidebar.recomputeAutoPages()
    this.syncFirstPageNumber()
    this.publish()
  }
}
