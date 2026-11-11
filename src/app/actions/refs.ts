// Insert ▸ Citation and Tools ▸ Check citations: MainWindow._insert_citation,
// _check_citations, _refresh_kherveref_bib and _stage_kherveref_bib in
// khervedoc/mainwindow.py, over core/kherveref.ts.
//
// Files go through the platform layer unless setRefsFileAccess installed
// another. KherveRef's own QSettings("kherve", "KherveRef") (recent_libraries
// / last_library) come from platform/kherverefSettings, re-read before each
// lookup as QSettings would; "Other library folder…" uses the platform's
// folder chooser.
import * as kr from '../../core/kherveref'
import type { RefFileAccess, RefreshedBib } from '../../core/kherveref'
import { citation } from '../../core/model'
import type { Citation, Document } from '../../core/model'
import { dirname } from '../../core/paths'
import { platform } from '../../platform'
import { readKherverefSettings, type SettingsValues } from '../../platform/kherverefSettings'
import { information, warning } from '../../platform/MessageBox'
import { askCitation } from '../../ui/dialogs/CitationPicker'
import { askBibliography, askInsertReference } from '../../ui/dialogs/BibliographyDialog'
import { askReferences } from '../../ui/dialogs/ReferenceManager'
import { parseTheBibliography, writeTheBibliography } from '../../core/bibliography'
import { registerActions } from '../actions'
import { setBibStager } from '../compile'
import { editorApi } from '../editorApi'
import { appStore, editDoc } from '../store'

let fsOverride: RefFileAccess | null = null
let chooseFolder: () => Promise<string | null> = async () =>
  (await platform().openFolderDialog?.('KherveRef library folder')) ?? null

// The last read of KherveRef's settings; core/kherveref reads value()
// synchronously, so it is refreshed before each use (reloadKherverefSettings).
let refSettings: SettingsValues = {}
let settingsInstalled = false

export async function reloadKherverefSettings(): Promise<void> {
  if (fsOverride) return
  refSettings = await readKherverefSettings()
  if (!settingsInstalled) {
    settingsInstalled = true
    kr.setKherverefSettings(() => ({
      value: (key, fallback) => (key in refSettings ? refSettings[key] : fallback),
    }))
  }
}

export function setRefsFileAccess(fs: RefFileAccess | null): void {
  fsOverride = fs
}

export function setRefsFolderChooser(fn: () => Promise<string | null>): void {
  chooseFolder = fn
}

function refsFs(): RefFileAccess {
  if (fsOverride) return fsOverride
  const p = platform()
  return {
    exists: p.exists,
    read: p.readFile,
    write: p.writeFile,
    listDir: async (d) => (await p.listDir(d)).map((e) => e.name),
    isFile: async (path) => (await p.stat(path))?.isFile ?? false,
  }
}

// MainWindow._bundled_bib: the kherveref.bib the open .ktex carries (set
// by whoever opens a file: kdocz.readBundledBib, or .kherve/kherveref.bib
// beside a .kdoc.json; '' for a new document).
let bundledBib = ''
// What the editor resolves citations from (DocumentEditor._extra_bib).
let extraBib = ''
const extraListeners = new Set<(bib: string) => void>()

export function getBundledBib(): string {
  return bundledBib
}

export function setBundledBib(text: string): void {
  bundledBib = text
}

export function getExtraBibliography(): string {
  return extraBib
}

// The visual editor subscribes to show citations as "[1]" / "Smith (2020)"
// (DocumentEditor.set_extra_bibliography).
export function onExtraBibliography(fn: (bib: string) => void): () => void {
  extraListeners.add(fn)
  return () => { extraListeners.delete(fn) }
}

function apply(r: RefreshedBib): void {
  bundledBib = r.bundledBib
  if (r.extraBib !== extraBib) {
    extraBib = r.extraBib
    for (const fn of extraListeners) fn(extraBib)
  }
}

// _refresh_kherveref_bib: kherveref.bib for *doc* (to bundle on save and
// stage on compile), '' for a document without a KherveRef library.
export async function refreshKherverefBib(doc: Document): Promise<string> {
  await reloadKherverefSettings()
  const r = await kr.refreshKherverefBib(doc, bundledBib, refsFs())
  apply(r)
  return r.bib
}

// _stage_kherveref_bib: write kherveref.bib into each build folder before
// a LaTeX compile.
export async function stageKherverefBib(doc: Document, ...workdirs: string[]): Promise<void> {
  const r = await kr.stageKherverefBib(doc, bundledBib, workdirs, refsFs())
  if (r) apply(r)
}

// _resolved_source_dir: the saved document's folder.
function sourceDir(): string | null {
  const path = appStore().get().path
  return path ? dirname(path) : null
}

async function insertCitation(): Promise<void> {
  await reloadKherverefSettings()
  const doc = appStore().get().doc
  const meta = doc.meta
  const dlg = await askCitation(meta.ref_library, bundledBib, { fs: refsFs(), chooseFolder })
  if (!dlg) return
  if (dlg.library && dlg.library !== meta.ref_library) {
    // editor.meta() is the document's own meta, changed in place.
    meta.ref_library = dlg.library
    editDoc(doc)
  }
  // DocumentEditor.insert_citation_keys
  const keys = dlg.keys.filter((k) => k)
  if (keys.length) editorApi()?.insertInline(citation(keys, dlg.style as Citation['style']))
  await refreshKherverefBib(appStore().get().doc)
}

async function checkCitations(): Promise<void> {
  await reloadKherverefSettings()
  const r = await kr.checkCitations(appStore().get().doc, bundledBib, sourceDir(), refsFs())
  if (r.kind === 'warning') await warning(r.title, r.text)
  else await information(r.title, r.text)
}

// Every LaTeX compile stages kherveref.bib first (compile.ts calls it).
setBibStager((doc, workdirs) => stageKherverefBib(doc, ...workdirs))

// References ▸ Bibliography: edit the document's thebibliography (made at
// the end of the document when there is none).
async function editBibliography(): Promise<void> {
  const api = editorApi()
  if (!api) return
  const found = api.bibliography()
  const parsed = found ? parseTheBibliography(found.text) : null
  const initial = parsed ?? { widest: '99', before: '', items: [] }
  const r = await askBibliography(initial)
  if (!r) return
  const text = writeTheBibliography(r)
  if (found && text === found.text) return
  api.setBibliography(found ? found.pos : null, text)
}

// References ▸ Insert reference: cite the document's own \bibitem
// entries, adding a new one to the reference list (made at the end of the
// document when there is none) first if asked.
async function insertReference(): Promise<void> {
  const api = editorApi()
  if (!api) return
  const found = api.bibliography()
  const parsed = (found ? parseTheBibliography(found.text) : null) ?? { widest: '99', before: '', items: [] }
  const r = await askInsertReference(parsed.items)
  if (!r) return
  if (r.library) { await insertCitation(); return }
  // Cite first: setBibliography may append at the end and move the caret.
  api.insertInline(citation(r.keys, 'cite'))
  if (r.items.length !== parsed.items.length) {
    const again = api.bibliography()
    api.setBibliography(again ? again.pos : null, writeTheBibliography({ ...parsed, items: r.items }))
  }
}

// References ▸ Manage references (MainWindow._manage_references): the
// document's own list. It starts from the list the document has (for a
// document citing from a KherveRef library, its cited entries); a changed
// list becomes the document's own (DOCUMENT_LIBRARY), bundled in its .ktex.
async function manageReferences(): Promise<void> {
  await reloadKherverefSettings()
  const doc = appStore().get().doc
  const meta = doc.meta
  const fs = refsFs()
  let start = bundledBib
  if (meta.ref_library !== kr.DOCUMENT_LIBRARY) {
    const [text] = await kr.bibliographyFor(doc, fs, bundledBib)
    start = text || bundledBib
  }
  const linked = meta.ref_library && meta.ref_library !== kr.DOCUMENT_LIBRARY
    && await kr.isLibrary(meta.ref_library, fs)
  const note = linked
    ? `This document cites from the KherveRef library “${await kr.libraryName(meta.ref_library, fs)}”. `
      + 'Changing the list here gives it a list of its own, its cited references included.'
    : ''
  const r = await askReferences(start, kr.citedKeys(doc), {
    note,
    inform: (title, text) => information(title, text),
    importBib: async () => {
      const paths = await platform().openFileDialog({
        title: 'Import a .bib file',
        filters: [{ name: 'BibTeX', extensions: ['bib'] }, { name: 'All files', extensions: [] }],
      })
      if (!paths?.length) return null
      try {
        return new TextDecoder().decode(await platform().readFile(paths[0]))
      } catch (e) {
        await warning('Import .bib', String(e))
        return null
      }
    },
    fromKherveRef: async () => {
      const lib = linked ? meta.ref_library : ''
      const dlg = await askCitation(lib, '', { fs, chooseFolder })
      if (!dlg || !dlg.library) return null
      const source = await kr.loadLibrary(dlg.library, fs)
      return dlg.keys.filter(k => source.has(k)).map(k => source.get(k)!).join('\n\n')
    },
  })
  if (!r) return
  if (r.changed || (r.text && meta.ref_library !== kr.DOCUMENT_LIBRARY)) {
    bundledBib = r.text
    // editor.meta() is the document's own meta, changed in place.
    meta.ref_library = kr.DOCUMENT_LIBRARY
    editDoc(doc)
  }
  if (r.cite.length) editorApi()?.insertInline(citation(r.cite, 'cite'))
  await refreshKherverefBib(appStore().get().doc)
}

registerActions({
  citation: insertCitation,
  manage_references: manageReferences,
  insert_reference: insertReference,
  bibliography: editBibliography,
  check_citations: checkCitations,
})
