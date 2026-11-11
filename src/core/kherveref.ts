// Citations from KherveRef libraries. A port of khervedoc/kherveref_link.py,
// plus the logic of MainWindow's KherveRef methods (_refresh_kherveref_bib,
// _stage_kherveref_bib, _check_citations) and of citation_picker.py, so
// the React dialog and actions stay thin.
//
// KherveRef (the sibling reference manager) keeps each library as a folder
// whose `library.bib` it regenerates in classic BibTeX after every change.
// KherveTeX reads that file directly, so KherveRef need not be running.
//
// A document that cites from a library records the library's folder in
// `DocMeta.ref_library`. Its cited entries are written to `kherveref.bib`
// — staged next to every compile and bundled inside the .ktex — so the
// document still compiles on a machine without the library, from the
// copy it carries.

import { citedKeys as modelCitedKeys } from './model.ts'
import type { Document } from './model.ts'
import type { FileAccess } from './kdocz.ts'
import { basename, join } from './paths.ts'
import { pyRe, pyStr, strip, truthy } from './py.ts'
import { BIB_NAME } from './serializer.ts'
import { parseBibtex, pySplit, readText, shortAuthor } from './references.ts'
import type { BibEntries } from './references.ts'

export { BIB_NAME }                           // \bibliography{kherveref}
export const BIB_FILE = `${BIB_NAME}.bib`
// DocMeta.ref_library of a document that keeps its own list of references
// (docReferences.ts): its kherveref.bib holds every entry, cited or not.
export const DOCUMENT_LIBRARY = 'document'
export const LIBRARY_BIB = 'library.bib'

// Every style the bundled TeX cache is warmed for (compiler.py's
// download_tectonic_bundle), so each compiles offline. The natbib ones
// make the serializer load natbib.
export const BIB_STYLES = ['plainnat', 'unsrtnat', 'abbrvnat', 'plain', 'unsrt']

const _ENTRY_START_RE = pyRe(String.raw`@(\w+)\s*[{(]\s*([^,\s]+)\s*,`)

// What library discovery needs beyond FileAccess: a folder listing (the
// names in it; [] when it is missing — Path.glob) and Path.is_file.
export interface RefFileAccess extends FileAccess {
  listDir(dir: string): Promise<string[]>
  isFile(path: string): Promise<boolean>
}

// KherveRef's QSettings("kherve", "KherveRef"): only value() is read.
export interface RefSettings {
  value(key: string, defaultValue?: unknown): unknown
}

// The app installs the real KherveRef settings reader (the platform
// layer); tests install a fake, as the Python tests monkeypatch
// _settings — nothing here ever touches the user's real settings.
let settingsFactory: (() => RefSettings) | null = null

export function setKherverefSettings(factory: (() => RefSettings) | null): void {
  settingsFactory = factory
}

function _settings(): RefSettings {
  if (!settingsFactory) throw new Error('KherveRef settings are not available')
  return settingsFactory()
}

// str(Path(p)) on POSIX: repeated and trailing separators dropped, "."
// segments removed, "" -> ".", exactly two leading slashes kept.
export function pyPath(p: string): string {
  if (!p) return '.'
  const lead = p.startsWith('//') && !p.startsWith('///') ? '//' : p.startsWith('/') ? '/' : ''
  const parts = p.split('/').filter((s) => s && s !== '.')
  const out = lead + parts.join('/')
  return out || '.'
}

// Path(p).name
export function pathName(p: string): string {
  const q = pyPath(p)
  return q === '.' ? '' : basename(q)
}

// Code-point order, as Python compares str (sorted(), Path ordering).
export function pyCompare(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i].codePointAt(0)! - y[i].codePointAt(0)!
  }
  return x.length - y.length
}

// sorted(Path(d).glob("*" + ext)): case-sensitive, hidden files included.
async function globSuffix(fs: RefFileAccess, dir: string, ext: string): Promise<string[]> {
  let names: string[]
  try {
    names = await fs.listDir(dir)
  } catch {
    return []
  }
  return names.filter((n) => n.endsWith(ext)).sort(pyCompare).map((n) => join(dir, n))
}

export async function isLibrary(path: string, fs: RefFileAccess): Promise<boolean> {
  if (!path) return false
  try {
    return await fs.isFile(join(path, LIBRARY_BIB))
  } catch {
    return false
  }
}

// The name KherveRef shows: from <Name>.kref (KherveRef 0.6+) or
// library.json (older libraries).
export async function libraryName(path: string, fs: RefFileAccess): Promise<string> {
  const rootName = pathName(path)
  const manifests = [...await globSuffix(fs, path, '.kref'), join(path, 'library.json')]
  for (const m of manifests) {
    let data: unknown
    try {
      data = JSON.parse(await readText(fs, m))
    } catch {
      continue
    }
    // json.loads(...).get: anything but an object raises AttributeError.
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TypeError(`AttributeError: '${Array.isArray(data) ? 'list' : typeof data}' object has no attribute 'get'`)
    }
    const name = (data as Record<string, unknown>).name
    return truthy(name) ? pyStr(name) : rootName
  }
  return rootName
}

// Libraries KherveRef has opened on this machine, most recent first.
export async function knownLibraries(fs: RefFileAccess): Promise<string[]> {
  let recent: unknown
  let last: unknown
  try {
    const s = _settings()
    recent = s.value('recent_libraries', []) || []
    last = s.value('last_library', '') || ''
  } catch {
    return []
  }
  if (typeof recent === 'string') recent = [recent]
  const out: string[] = []
  for (const p of [last, ...(recent as unknown[])]) {
    if (!p) continue
    const ps = String(p)
    if (await isLibrary(ps, fs) && !out.includes(pyPath(ps))) out.push(pyPath(ps))
  }
  return out
}

// key -> the entry's full source text, for every @entry in *text*
// (@string / @comment / @preamble are skipped).
export function splitBib(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of text.matchAll(_ENTRY_START_RE)) {
    if (['string', 'comment', 'preamble'].includes(m[1].toLowerCase())) continue
    const opener = text.indexOf(m[0].includes('{') ? '{' : '(', m.index)
    const closer = text[opener] === '{' ? '}' : ')'
    let depth = 0
    let i = opener
    while (i < text.length) {
      const ch = text[i]
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '{' || (closer === ')' && ch === '(')) {
        depth += 1
      } else if (ch === '}' || (closer === ')' && ch === ')')) {
        depth -= 1
        if (depth === 0) break
      }
      i += 1
    }
    if (!out.has(m[2])) out.set(m[2], strip(text.slice(m.index, i + 1)))
  }
  return out
}

const _STRING_RE = pyRe(String.raw`@string\s*[{(]`, 'i')

// Every @string{...} block in *text*: cited entries may use them.
export function stringDefinitions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(_STRING_RE)) {
    let depth = 0
    let i = m.index + m[0].length - 1
    while (i < text.length) {
      if ('{('.includes(text[i])) {
        depth += 1
      } else if ('})'.includes(text[i])) {
        depth -= 1
        if (depth === 0) {
          out.push(text.slice(m.index, i + 1))
          break
        }
      }
      i += 1
    }
  }
  return out
}

export async function loadLibrary(path: string, fs: FileAccess): Promise<Map<string, string>> {
  try {
    return splitBib(await readText(fs, join(path, LIBRARY_BIB), 'replace'))
  } catch {
    return new Map()
  }
}

// Every cited key, in order of first citation.
export function citedKeys(doc: Document): string[] {
  return modelCitedKeys(doc)
}

// (.bib text with the entries for *keys*, keys found nowhere).
// Earlier sources win: the live library before the bundled copy.
// *strings* (@string definitions) go first, so macros resolve.
export function buildBib(keys: string[], sources: Map<string, string>[],
  strings: string[] = []): [string, string[]] {
  const unique = [...new Set(strings)]
  const parts = [...unique]
  const missing: string[] = []
  for (const k of keys) {
    const src = sources.find((s) => s.has(k))
    if (src) parts.push(src.get(k)!)
    else missing.push(k)
  }
  const head = '% Cited entries, written by KherveTeX from KherveRef.\n\n'
  const found = parts.length > unique.length
  return [found ? head + parts.join('\n\n') + '\n' : '', missing]
}

// The kherveref.bib text for *doc* and the cited keys it lacks.
//
// Sources, in order: the document's own library (when present on this
// machine), the copy bundled in the .ktex, then any .bib files in
// *extraDirs* (e.g. the document's folder).
//
// A document with its own list (DOCUMENT_LIBRARY) gets the whole list
// back, cited or not: it is the list, kept in the .ktex as it is; the keys
// it lacks are those no source has.
export async function bibliographyFor(doc: Document, fs: RefFileAccess, bundled = '',
  extraDirs: string[] = []): Promise<[string, string[]]> {
  const texts: string[] = []
  if (await isLibrary(doc.meta.ref_library, fs)) {
    try {
      texts.push(await readText(fs, join(doc.meta.ref_library, LIBRARY_BIB), 'replace'))
    } catch {
      // OSError: the library vanished between the check and the read.
    }
  }
  if (bundled) texts.push(bundled)
  for (const d of extraDirs) {
    for (const f of await globSuffix(fs, d, '.bib')) {
      if (basename(f) !== BIB_FILE) {
        try {
          texts.push(await readText(fs, f, 'replace'))
        } catch {
          // unreadable (a folder named *.bib, permissions): skipped
        }
      }
    }
  }
  const keys = citedKeys(doc)
  if (doc.meta.ref_library === DOCUMENT_LIBRARY) {
    const have = new Set(texts.flatMap((t) => [...splitBib(t).keys()]))
    return [strip(bundled) ? bundled : '', keys.filter((k) => !have.has(k))]
  }
  if (!keys.length) return ['', []]
  const strings = texts.flatMap((t) => stringDefinitions(t))
  return buildBib(keys, texts.map((t) => splitBib(t)), strings)
}

// Keys whose key / author / year / title contain every word.
export function search(entries: BibEntries, text: string): string[] {
  const words = pySplit(text.toLowerCase())
  const out: string[] = []
  for (const [key, e] of entries) {
    const hay = [key, e.author ?? '', e.year ?? '', e.title ?? ''].join(' ').toLowerCase()
    if (words.every((w) => hay.includes(w))) out.push(key)
  }
  return out
}

// ---------------- MainWindow's KherveRef methods ----------------

// What _refresh_kherveref_bib leaves behind: the text to stage (only for
// a library-managed document), the updated self._bundled_bib, and the
// text the editor resolves citations from (set_extra_bibliography).
export interface RefreshedBib {
  bib: string
  bundledBib: string
  extraBib: string
}

// kherveref.bib for *doc* (the cited entries of its KherveRef library,
// falling back to the copy its .ktex carries); also feeds the editor so
// citations display as they will compile.
export async function refreshKherverefBib(doc: Document, bundledBib: string, fs: RefFileAccess): Promise<RefreshedBib> {
  const [text] = await bibliographyFor(doc, fs, bundledBib)
  if (text) bundledBib = text
  return { bib: doc.meta.ref_library ? text : '', bundledBib, extraBib: text || bundledBib }
}

// _stage_kherveref_bib: write kherveref.bib into every build folder.
// Returns the refreshed state, or null when the document has no library.
export async function stageKherverefBib(doc: Document, bundledBib: string, workdirs: string[],
  fs: RefFileAccess): Promise<RefreshedBib | null> {
  if (!doc.meta.ref_library) return null
  const r = await refreshKherverefBib(doc, bundledBib, fs)
  for (const d of workdirs) await fs.write(join(d, BIB_FILE), new TextEncoder().encode(r.bib))
  return r
}

// The message box _check_citations shows.
export interface CitationReport {
  kind: 'information' | 'warning'
  title: string
  text: string
}

export async function checkCitations(doc: Document, bundledBib: string, sourceDir: string | null,
  fs: RefFileAccess): Promise<CitationReport> {
  const keys = citedKeys(doc)
  if (!keys.length) return { kind: 'information', title: 'Citations', text: 'The document cites nothing.' }
  const [, missing] = await bibliographyFor(doc, fs, bundledBib, sourceDir ? [sourceDir] : [])
  if (!missing.length) {
    return { kind: 'information', title: 'Citations', text: `All ${keys.length} cited keys are defined.` }
  }
  const own = doc.meta.ref_library === DOCUMENT_LIBRARY
  const where = own ? 'this document\'s references'
    : doc.meta.ref_library ? await libraryName(doc.meta.ref_library, fs) : 'any bibliography'
  return {
    kind: 'warning',
    title: 'Citations',
    text: `${missing.length} of ${keys.length} cited keys are not in ${where}:\n\n`
      + missing.join('\n')
      + (own ? '\n\nAdd them in References ▸ Manage references (they are '
        + 'listed there as missing), or fix the keys.'
        : '\n\nAdd them in KherveRef (they then appear here), in '
        + 'References ▸ Manage references, or fix the keys.'),
  }
}

// ---------------- citation_picker.py: the dialog's logic ----------------

export const STYLES: [string, string][] = [
  ['cite', '\\cite — numeric [1]'],
  ['citep', '\\citep — (Smith, 2020)'],
  ['citet', '\\citet — Smith (2020)'],
]

export const _BROWSE = '__browse__'
export const _BUNDLED = '__bundled__'

export const PICKER_SEARCH_PLACEHOLDER = 'Search key, author, year, title'
export const PICKER_MANUAL_PLACEHOLDER = 'Other keys, comma separated (optional)'
export const PICKER_HINT = 'Ctrl/Shift-click to cite several. Add references in '
  + 'References ▸ Manage references, or in KherveRef.'
export const PICKER_NO_LIBRARY = 'No KherveRef library found. Open or create one in KherveRef '
  + '(it remembers the libraries it has opened), choose “Other '
  + 'library folder…”, or type keys below.'
export const PICKER_NOTHING_SELECTED = 'Select at least one reference, or type a key.'

export interface PickerItem { label: string; data: string }

export async function pickerItemFor(path: string, fs: RefFileAccess): Promise<PickerItem> {
  return { label: `${await libraryName(path, fs)} — ${path}`, data: path }
}

// The Library combo's items and its initial index (CitationPicker.__init__).
export async function pickerLibraries(currentLibrary: string, bundledBib: string,
  fs: RefFileAccess): Promise<{ items: PickerItem[]; index: number }> {
  const libs = await knownLibraries(fs)
  if (currentLibrary && await isLibrary(currentLibrary, fs) && !libs.includes(pyPath(currentLibrary))) {
    libs.unshift(pyPath(currentLibrary))
  }
  const items: PickerItem[] = []
  for (const p of libs) items.push(await pickerItemFor(p, fs))
  if (bundledBib) items.push({ label: 'This document\'s references', data: _BUNDLED })
  items.push({ label: 'Other library folder…', data: _BROWSE })
  let index = 0
  if (currentLibrary) {
    const i = items.findIndex((it) => it.data === pyPath(currentLibrary))
    if (i >= 0) index = i
    else if (bundledBib) index = items.findIndex((it) => it.data === _BUNDLED)
  }
  return { items, index }
}

// _library_changed when the combo sits on "Other library folder…": a
// library folder the user chose (*chosen*; null or '' = cancelled) joins
// the list at the top; anything else falls back to the first item.
export async function pickerBrowse(items: PickerItem[], index: number, chosen: string | null,
  fs: RefFileAccess): Promise<{ items: PickerItem[]; index: number; data: string }> {
  if (items[index].data !== _BROWSE) return { items, index, data: items[index].data }
  if (chosen && await isLibrary(chosen, fs)) {
    return { items: [await pickerItemFor(chosen, fs), ...items], index: 0, data: chosen }
  }
  return { items, index: 0, data: items[0].data }
}

// _library_changed once the combo's data is settled (Browse resolved by
// the caller): the BibTeX to list and the new self.library — null keeps
// the previous value (an unresolved Browse).
export async function pickerLoad(data: string, bundledBib: string,
  fs: FileAccess): Promise<{ entries: BibEntries; library: string | null }> {
  let text = ''
  let library: string | null = null
  if (data === _BUNDLED) {
    text = bundledBib
    library = ''
  } else if (data && data !== _BROWSE) {
    try {
      text = await readText(fs, join(data, LIBRARY_BIB), 'replace')
    } catch {
      text = ''
    }
    library = data
  }
  return { entries: parseBibtex(text), library }
}

// _fill: the table rows (key, authors, year, title) for a search, sorted
// case-insensitively by key, braces dropped.
export function pickerRows(entries: BibEntries, query: string): string[][] {
  const keys = search(entries, query)
  const unbrace = (v: string) => v.replaceAll('{', '').replaceAll('}', '')
  return [...keys].sort((a, b) => pyCompare(a.toLowerCase(), b.toLowerCase())).map((key) => {
    const e = entries.get(key)!
    return [key, shortAuthor(e.author ?? ''), e.year ?? '', e.title ?? ''].map(unbrace)
  })
}

// keys(): the selected rows' keys (in table order), then the typed ones.
export function pickerKeys(rows: string[][], selected: Iterable<number>, manual: string): string[] {
  const keys = [...new Set(selected)].sort((a, b) => a - b).map((r) => rows[r][0])
  for (let k of manual.split(',')) {
    k = strip(k)
    if (k && !keys.includes(k)) keys.push(k)
  }
  return keys
}
