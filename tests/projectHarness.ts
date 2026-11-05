// MainWindow, as far as the project code sees it, on real folders: the
// editor is a document variable plus the heading offset and first page it
// was given, dialogs answer from fields the test sets (as the Python tests
// monkeypatch QInputDialog / QMessageBox), and the single-document file
// actions (_write_to, _open_path, _save, _new) are the few lines of
// mainwindow.py they need.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8 } from 'fflate'
import { importTex } from '../src/core/importers.ts'
import { isKdoczPath, loadKdocz, readProjectJson, saveKdocz } from '../src/core/kdocz.ts'
import { document, fromJson, paragraph, toJson } from '../src/core/model.ts'
import type { Document } from '../src/core/model.ts'
import { dirname, normalize } from '../src/core/paths.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { ProjectSession, windowDocStem, type ProjectFs, type ProjectHost } from '../src/app/project.ts'
import { nodeFs } from './nodeFs.ts'

export const projectFs: ProjectFs = {
  ...nodeFs,
  mkdir: async (p) => { await mkdir(p, { recursive: true }) },
  copy: async (src, dest) => { await copyFile(src, dest) },
  move: async (src, dest) => { await rename(src, dest) },
  makeTempDir: (prefix) => mkdtemp(join(tmpdir(), prefix)),
}

export class FakeWindow {
  doc: Document = document([paragraph([])])
  currentPath: string | null = null
  headingOffset: number[] | null = null
  firstPage = 1
  modified = false
  dock = false
  // QInputDialog.getText / getExistingDirectory / QMessageBox.question
  textAnswer: string | null = null
  folderAnswer: string | null = null
  questionAnswer = true
  messages: string[] = []
  boxes: [string, string, string][] = []
  console: string[] = []
  // The compiled PDF's pages (pymupdf), by path.
  pdfs = new Map<string, string[]>()
  saveAsImpl: () => Promise<void> = async () => {}
  readonly session: ProjectSession

  constructor() {
    this.session = new ProjectSession(this.makeHost())
  }

  private makeHost(): ProjectHost {
    return {
      fs: projectFs,
      getDocument: () => this.doc,
      setDocument: (doc) => { this.doc = doc; this.modified = false },
      setHeadingOffset: (c) => { this.headingOffset = c },
      setFirstPageNumber: (n) => { this.firstPage = n },
      clearModified: () => { this.modified = false },
      setImportSourceDir: () => {},
      currentPath: () => this.currentPath,
      setCurrentPath: (p) => { this.currentPath = p },
      saveAs: () => this.saveAsImpl(),
      newDocument: () => this.newDoc(),
      importTex: async (path) => importTex(readFileSync(path, 'utf-8').replace(/\r\n?/g, '\n'), dirname(path), {
        isFile: (f) => existsSync(f) && statSync(f).isFile(),
        readText: (f) => { try { return readFileSync(f, 'utf-8') } catch { return null } },
        resolve: normalize,
      }),
      publish: () => {},
      updateTitle: () => {},
      showDock: () => { this.dock = true },
      getText: async () => this.textAnswer,
      getFolder: async () => this.folderAnswer,
      getOpenProject: async () => null,
      question: async (title, text) => { this.boxes.push(['question', title, text]); return this.questionAnswer },
      information: async (title, text) => { this.boxes.push(['information', title, text]) },
      warning: async (title, text) => { this.boxes.push(['warning', title, text]) },
      critical: async (title, text) => { this.boxes.push(['critical', title, text]) },
      showMessage: (msg) => { this.messages.push(msg) },
      consoleAppend: (msg) => { this.console.push(msg) },
      gitSnapshot: async () => {},
      autoCompile: () => false,
      kickCompile: () => {},
      engine: () => 'latex',
      buildDir: () => projectFs.makeTempDir('khervedoc-'),
      compileMaster: async () => null,
      pdfPages: async (p) => {
        const pages = this.pdfs.get(p)
        if (!pages) throw new Error('no such PDF')
        return pages
      },
    }
  }

  setDocument(doc: Document): void {
    this.doc = doc
  }

  // _update_title
  updateTitle(): void {
    this.session.updateTitle()
  }

  // _write_to, for the single document.
  async writeTo(path: string): Promise<void> {
    if (isKdoczPath(path)) await saveKdocz(this.doc, path, projectFs)
    else await projectFs.write(path, strToU8(toJson(this.doc)))
    await projectFs.write(join(dirname(path), '.kherve', `${windowDocStem(path)}.tex`), strToU8(serializeDocument(this.doc)))
    this.modified = false
  }

  // _open_path
  async openPath(path: string): Promise<void> {
    if (path.toLowerCase().endsWith('.kdocproj.json')
      || (isKdoczPath(path) && (await readProjectJson(path, projectFs)) !== null)) {
      await this.session.openProjectFromPath(path)
      return
    }
    await this.session.leaveProject()
    const doc = isKdoczPath(path)
      ? (await loadKdocz(path, await projectFs.makeTempDir('kdocz-'), projectFs))[0]
      : fromJson(readFileSync(path, 'utf-8'))
    this.currentPath = path
    this.doc = doc
    this.updateTitle()
  }

  // _save
  async save(): Promise<void> {
    if (this.session.project !== null) {
      await this.session.saveProject()
      return
    }
    if (this.currentPath === null) await this.saveAsImpl()
    else await this.writeTo(this.currentPath)
  }

  // _new
  async newDoc(): Promise<void> {
    await this.session.leaveProject()
    this.currentPath = null
    this.doc = document([paragraph([])])
    this.updateTitle()
  }

  // The Documents list's rows.
  names(): string[] {
    return this.session.sidebar.rows.map(r => r.text)
  }

  // toPlainText(), near enough: the document's JSON.
  text(): string {
    return toJson(this.doc)
  }

  // The number the editor paints on the first heading (_P_HEADING_NUMBER).
  firstNumber(): string | null {
    const b = this.doc.children[0]
    if (b?.type !== 'Section' || !b.numbered) return null
    return String((this.headingOffset?.[b.level] ?? 0) + 1)
  }

  // _sheet_labels(n): each sheet's printed page number.
  sheetLabels(n: number): string[] {
    return Array.from({ length: n }, (_, i) => String(this.firstPage + i))
  }
}
