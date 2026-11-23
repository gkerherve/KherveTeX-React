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
import { runAction } from '../actions'
import * as docRefs from '../../core/docReferences'
import type { RefFileAccess, RefreshedBib } from '../../core/kherveref'
import { citation } from '../../core/model'
import type { Citation, Document } from '../../core/model'
import { dirname, join } from '../../core/paths'
import { platform } from '../../platform'
import { readKherverefSettings, type SettingsValues } from '../../platform/kherverefSettings'
import { information, messageBox, question, warning } from '../../platform/MessageBox'
import { ZOTERO_HELP, zoteroLibrary, zoteroPick, zoteroState } from '../../core/zotero'
import { askCitation } from '../../ui/dialogs/CitationPicker'
import { askBibliography, askInsertReference } from '../../ui/dialogs/BibliographyDialog'
import { askReferences, type ImportKind } from '../../ui/dialogs/ReferenceManager'
import { parseTheBibliography, writeTheBibliography } from '../../core/bibliography'
import { registerActions } from '../actions'
import { resolvedSourceDir, setBibStager } from '../compile'
import { editorApi } from '../editorApi'
import { appStore, editDoc } from '../store'
import { editor, setEditorBibliography } from '../../editor/controller'
import { BIB_STYLES } from '../../core/autoBibliography'

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
  // The page view resolves citations and draws the reference list from
  // it (DocumentEditor.set_extra_bibliography). Nothing passed it on: the
  // page showed "[1]" and no list where the PDF had both.
  setEditorBibliography(extraBib)
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

// The files a LaTeX package export (File ▸ Export, Download for Overleaf)
// carries beside main.tex so it compiles anywhere: the references
// (kherveref.bib) and the .sty / .cls / .bst / .bib files in the
// document's folder (an imported package's own).
export async function latexPackageExtras(doc: Document): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  const p = platform()
  const dir = resolvedSourceDir()
  if (dir) {
    try {
      for (const e of await p.listDir(dir)) {
        if (e.isFile && /\.(sty|cls|bst|bib)$/i.test(e.name)) out[e.name] = await p.readFile(join(dir, e.name))
      }
    } catch { /* no folder: nothing to add */ }
  }
  const bib = await refreshKherverefBib(doc).catch(() => '')
  if (bib) out[kr.BIB_FILE] = new TextEncoder().encode(bib)
  return out
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
async function manageReferences(importNow?: 'zotero' | 'kherveref' | ImportKind): Promise<void> {
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
    start: importNow,
    style: meta.bib_style || '',
    inform: (title, text) => information(title, text),
    importFile: async (kind) => {
      if (kind === 'mendeley' || kind === 'endnote') {
        const name = kind === 'mendeley' ? 'Mendeley' : 'EndNote'
        const go = await messageBox({ title: `From ${name} (beta)`, icon: 'information',
          text: (kind === 'mendeley' ? MENDELEY_HELP : ENDNOTE_HELP) + BETA_REFS(name),
          buttons: [{ label: 'Choose file…', default: true }, { label: 'Send feedback' }, { label: 'Cancel' }] })
        if (go === 'Send feedback') { void runAction('send_feedback'); return null }
        if (go !== 'Choose file…') return null
      }
      const endnote = kind === 'endnote'
      const onlyBib = kind === 'bib'
      const bib = { name: 'BibTeX (.bib)', extensions: ['bib'] }
      const en = { name: 'EndNote (.xml, .ris, .enw)', extensions: ['xml', 'ris', 'enw', 'txt'] }
      const all = { name: 'Reference files (.bib, .ris, .enw, .xml)', extensions: ['bib', 'ris', 'enw', 'xml', 'txt'] }
      const paths = await platform().openFileDialog({
        title: endnote ? 'Import an EndNote export' : kind === 'mendeley' ? 'Import a Mendeley export'
          : onlyBib ? 'Import a BibTeX file (.bib)' : 'Import references',
        filters: onlyBib ? [bib, { name: 'All files', extensions: [] }]
          : endnote ? [en, bib, { name: 'All files', extensions: [] }]
          : [all, bib, en, { name: 'All files', extensions: [] }],
      })
      if (!paths?.length) return null
      try {
        const text = new TextDecoder().decode(await platform().readFile(paths[0]))
        return { name: paths[0], text }
      } catch (e) {
        await warning('Import references', String(e))
        return null
      }
    },
    fromZotero,
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
  // The style: the default ('') stays the default.
  const style = r.style === 'plainnat' && !meta.bib_style ? '' : r.style
  if (style !== (meta.bib_style || '')) {
    const e = editor()
    if (e) e.setMeta({ ...appStore().get().doc.meta, bib_style: style })
    else { meta.bib_style = style; editDoc(doc) }
  }
  if (r.cite.length) editorApi()?.insertInline(citation(r.cite, 'cite'))
  await refreshKherverefBib(appStore().get().doc)
}

// Add BibTeX to the document's own reference list (the MCP tools'
// add_references): a document citing from a KherveRef library gets a list
// of its own, its cited references included, as the library dialog does.
// The keys added.
export async function addDocumentReferences(bibtex: string): Promise<string[]> {
  await reloadKherverefSettings()
  const doc = appStore().get().doc
  const meta = doc.meta
  let start = bundledBib
  if (meta.ref_library && meta.ref_library !== kr.DOCUMENT_LIBRARY) {
    const [text] = await kr.bibliographyFor(doc, refsFs(), bundledBib)
    start = text || bundledBib
  }
  const [merged, added] = docRefs.merge(start, bibtex)
  bundledBib = merged
  if (meta.ref_library !== kr.DOCUMENT_LIBRARY) {
    meta.ref_library = kr.DOCUMENT_LIBRARY
  }
  editDoc(doc)
  await refreshKherverefBib(appStore().get().doc)
  return added
}

// Mendeley has no connection on the computer that other programs can use
// (Mendeley Cite talks to its web service), so its references come in as
// an export file.
const ENDNOTE_HELP = 'In EndNote, select the references, then File ▸ Export… and choose XML, RIS or '
  + 'EndNote tagged (.enw) as the output style.\n\nThen choose that file here.'
// Mendeley and EndNote imports are written from their file formats, not
// yet tried on users' own exports.
const BETA_REFS = (name: string) => `\n\nThis import is in BETA: it has not yet been tested with real ${name} `
  + `libraries. If a reference comes in wrong or incomplete, please send feedback (with the exported file if you can) so it can be fixed.`

const MENDELEY_HELP = 'In Mendeley Reference Manager, select the references (or press Ctrl/Cmd+A '
  + 'for all), then File ▸ Export… and choose BibTeX (.bib), RIS (.ris) or EndNote XML (.xml). '
  + 'In the older Mendeley Desktop: File ▸ Export…, or Tools ▸ Options ▸ BibTeX, which keeps '
  + 'a .bib file up to date.\n\nThen choose that file here.'

// References ▸ From Zotero (in the reference list): the references picked
// in Zotero with Better BibTeX, else (after asking) the whole library via
// Zotero 7's local API; null with an explanation when neither answers.
async function fromZotero(): Promise<string | null> {
  const get = platform().localhostGet
  const state = await zoteroState(get)
  try {
    if (state === 'better-bibtex') {
      const bib = await zoteroPick(get)
      return bib || null
    }
    if (state === 'local-api') {
      const ok = await question('From Zotero',
        'Zotero is running without the Better BibTeX add-on, so kTeX cannot show Zotero\'s picker.\n\n'
        + 'Add every reference of your Zotero library to this document\'s list?')
      return ok ? (await zoteroLibrary(get)) || null : null
    }
  } catch (e) {
    await warning('From Zotero', String(e instanceof Error ? e.message : e))
    return null
  }
  await information('From Zotero', (state === 'not-running'
    ? 'Zotero is not running. Start Zotero, then try again.\n\n'
    : 'Zotero is running but does not share its references yet.\n\n') + ZOTERO_HELP)
  return null
}

// A hand-written reference list (\bibitem entries in a thebibliography
// block), the document's own references kept that way; null when there is
// none, or when the document keeps a .bib list.
function handWrittenList(): { pos: number; text: string } | null {
  if (appStore().get().doc.meta.ref_library === kr.DOCUMENT_LIBRARY) return null
  const found = editorApi()?.bibliography() ?? null
  return found && parseTheBibliography(found.text) ? found : null
}

// References ▸ Cite: one button for either kind of list. A document with
// a hand-written list cites from it (adding to it if asked); any other
// cites from its .bib references or a KherveRef library.
async function cite(): Promise<void> {
  if (handWrittenList()) await insertReference()
  else await insertCitation()
}

// References ▸ References: the document's list, whichever kind it keeps:
// the hand-written \bibitem list, else its .bib references.
async function references(): Promise<void> {
  if (handWrittenList()) await editBibliography()
  else await manageReferences()
}

// References ▸ Import (From Zotero, From EndNote, Import file): the
// reference library, the import started in it. A document with a
// hand-written \bibitem list keeps that list; it is said so instead.
async function importReferences(start: 'zotero' | 'kherveref' | ImportKind): Promise<void> {
  if (handWrittenList()) {
    await information('Import references',
      'This document keeps a hand-written reference list (\\bibitem entries), which kTeX does not fill '
      + 'from other programs. Add references to it with Reference library…, or start a new document '
      + 'and import there.')
    return
  }
  await manageReferences(start)
}

// References ▸ Style: the bibliography style, from the ribbon.
function setBibStyle(code: string): void {
  const meta = appStore().get().doc.meta
  if ((meta.bib_style || 'plainnat') === code) return
  const e = editor()
  if (e) e.setMeta({ ...meta, bib_style: code })
  else { meta.bib_style = code; editDoc(appStore().get().doc) }
}

for (const [code] of BIB_STYLES) registerActions({ [`bib_style_${code}`]: () => setBibStyle(code) })

registerActions({
  citation: cite,
  manage_references: references,
  refs_zotero: () => importReferences('zotero'),
  refs_endnote: () => importReferences('endnote'),
  refs_mendeley: () => importReferences('mendeley'),
  refs_import: () => importReferences('file'),
  refs_bib: () => importReferences('bib'),
  refs_kherveref: () => importReferences('kherveref'),
  insert_reference: insertReference,
  bibliography: editBibliography,
  check_citations: checkCitations,
})
