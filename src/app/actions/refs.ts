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

registerActions({
  citation: insertCitation,
  check_citations: checkCitations,
})
