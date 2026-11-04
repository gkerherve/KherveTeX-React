// The Python app's own output (scripts/make_golden_refs.py) is the
// specification for KherveRef citations: BibTeX parsing, kherveref.bib,
// check_citations, the picker's lists and the on-screen citation text.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as kr from '../src/core/kherveref.ts'
import { fromJson } from '../src/core/model.ts'
import { ReferenceResolver, parseBibtex, shortAuthor } from '../src/core/references.ts'
import { nodeFs } from './nodeFs.ts'

const nodeRefFs: kr.RefFileAccess = {
  ...nodeFs,
  listDir: async (d) => readdirSync(d),
  isFile: async (p) => {
    try { return statSync(p).isFile() } catch { return false }
  },
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const corpus: any = JSON.parse(readFileSync(new URL('./golden/refs.json', import.meta.url), 'utf-8'))
const bibs: Record<string, string> = corpus.bibs
const pairs = (m: Map<string, unknown>) => [...m.entries()].map(([k, v]) => [k, v])

async function safe<T>(fn: () => Promise<T>): Promise<T | string> {
  try {
    return await fn()
  } catch (e) {
    const name = e instanceof Error ? /^(\w+Error)/.exec(e.message)?.[1] ?? e.name : 'Error'
    return `!ERROR ${name}`
  }
}

afterEach(() => kr.setKherverefSettings(null))

describe('BibTeX parsing matches Python', () => {
  it.each(Object.keys(bibs))('split_bib %s', (n) => {
    expect(pairs(kr.splitBib(bibs[n]))).toEqual(corpus.split_bib[n])
  })
  it.each(Object.keys(bibs))('string_definitions %s', (n) => {
    expect(kr.stringDefinitions(bibs[n])).toEqual(corpus.string_definitions[n])
  })
  it.each(Object.keys(bibs))('parse_bibtex %s', (n) => {
    expect(pairs(parseBibtex(bibs[n]))).toEqual(corpus.parse_bibtex[n])
  })
  it.each(Object.keys(bibs))('search %s', (n) => {
    const entries = parseBibtex(bibs[n])
    for (const [q, keys] of Object.entries(corpus.search[n])) {
      expect(kr.search(entries, q), q).toEqual(keys)
    }
  })
  it('short_author', () => {
    for (const [a, out] of corpus.short_author) expect(shortAuthor(a), a).toBe(out)
  })
  it('build_bib', () => {
    for (const c of corpus.build_bib) {
      const sources = c.sources.map((n: string) => kr.splitBib(bibs[n]))
      expect(kr.buildBib(c.keys, sources, c.strings)).toEqual([c.text, c.missing])
    }
  })
})

describe('ReferenceResolver matches Python', () => {
  const base = mkdtempSync(join(tmpdir(), 'refs-parity-'))
  for (const [rel, t] of Object.entries(corpus.resolver_files as Record<string, string>)) {
    mkdirSync(dirname(join(base, rel)), { recursive: true })
    writeFileSync(join(base, rel), t, 'utf-8')
  }
  const check = (r: ReferenceResolver, c: any) => {
    expect(pairs(r.entries)).toEqual(c.entries)
    expect(pairs(r.cite_numbers)).toEqual(c.cite_numbers)
    expect(pairs(r.labels)).toEqual(c.labels)
    for (const [ks, st, out] of c.cite) expect(r.citeText(ks, st), `${ks} ${st}`).toBe(out)
    for (const [lb, kind, out] of c.ref) expect(r.refText(lb, kind), `${lb} ${kind}`).toBe(out)
  }
  it.each(Object.keys(corpus.resolver))('%s', async (n) => {
    const { with_base: wb, no_base: nb } = corpus.resolver[n]
    check(await ReferenceResolver.load(fromJson(wb.document_json), base, wb.extra_bib, nodeFs), wb)
    check(new ReferenceResolver(fromJson(nb.document_json), null, nb.extra_bib), nb)
  })
})

// MainWindow._check_citations / _refresh / _stage_kherveref_bib.
async function windowResults(doc: ReturnType<typeof fromJson>, bundled: string, sourceDir: string | null, root: string) {
  const c = await kr.checkCitations(doc, bundled, sourceDir, nodeRefFs)
  const r = await kr.refreshKherverefBib(doc, bundled, nodeRefFs)
  const stageDir = join(root, '_stage')
  const s = await kr.stageKherverefBib(doc, bundled, [join(stageDir, 'a'), join(stageDir, 'b', 'print')], nodeRefFs)
  let staged: string[] | null = null
  try {
    staged = [readFileSync(join(stageDir, 'a', kr.BIB_FILE), 'utf-8'),
      readFileSync(join(stageDir, 'b', 'print', kr.BIB_FILE), 'utf-8')]
  } catch {
    staged = null
  }
  rmSync(stageDir, { recursive: true, force: true })
  return {
    check: [c.kind, c.title, c.text],
    refresh: { bib: r.bib, bundled_bib: r.bundledBib, extra_bib: r.extraBib },
    stage: staged,
    stage_bundled_bib: s ? s.bundledBib : bundled,
  }
}

// CitationPicker(current, bundled, style="citet") as the golden drives it.
async function pickerResults(current: string, bundled: string, browseTo: string | null, selections: any[]) {
  let { items, index } = await kr.pickerLibraries(current, bundled, nodeRefFs)
  let data = items[index].data
  const browsed = data === kr._BROWSE
  if (browsed) ({ items, index, data } = await kr.pickerBrowse(items, index, browseTo, nodeRefFs))
  const { entries, library } = await kr.pickerLoad(data, bundled, nodeFs)
  const rows: Record<string, string[][]> = {}
  for (const q of Object.keys(corpus.fs.library_cited.result.picker.rows)) rows[q] = kr.pickerRows(entries, q)
  const all = kr.pickerRows(entries, '')
  const keys = selections.map(([sel, manual]: [number[], string]) =>
    [sel, manual, kr.pickerKeys(all, sel.filter((r) => r < all.length), manual)])
  const none = kr.pickerKeys(all, [], '')
  return {
    items: items.map((it) => [it.label, it.data]),
    index,
    library: library ?? '',
    browsed,
    empty: entries.size ? ['', false] : [kr.PICKER_NO_LIBRARY, true],
    rows,
    keys,
    accept_empty: none.length ? [1, '', false] : [0, kr.PICKER_NOTHING_SELECTED, true],
    style: 'citet',
  }
}

describe('library files, kherveref.bib, check_citations and the picker match Python', () => {
  it.each(Object.keys(corpus.fs))('%s', async (name) => {
    const c = corpus.fs[name]
    const root = join(mkdtempSync(join(tmpdir(), 'refs-golden-')), 'root')
    mkdirSync(root, { recursive: true })
    for (const [rel, b64] of Object.entries(c.files as Record<string, string | null>)) {
      const p = join(root, rel)
      if (b64 === null) { mkdirSync(p, { recursive: true }); continue }
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, Buffer.from(b64, 'base64'))
    }
    const exp = c.result
    const sub = (s: string) => s.replaceAll('<ROOT>', root)
    const settings: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(exp.settings as Record<string, string | string[]>)) {
      settings[k] = typeof v === 'string' ? sub(v) : v.map(sub)
    }
    kr.setKherverefSettings(() => ({ value: (key: string, def?: unknown) => (key in settings ? settings[key] : def) }))
    const doc = fromJson(sub(exp.document_json))
    const actual: Record<string, unknown> = {
      document_json: exp.document_json,
      bundled: exp.bundled,
      extra_dirs: exp.extra_dirs,
      source_dir: exp.source_dir,
      settings: exp.settings,
      bibliography_for: await safe(() => kr.bibliographyFor(doc, nodeRefFs, exp.bundled,
        exp.extra_dirs.map((d: string) => join(root, d)))),
      cited_keys: kr.citedKeys(doc),
      is_library: await kr.isLibrary(doc.meta.ref_library, nodeRefFs),
      library_name: doc.meta.ref_library ? await safe(() => kr.libraryName(doc.meta.ref_library, nodeRefFs)) : null,
      load_library: doc.meta.ref_library ? pairs(await kr.loadLibrary(doc.meta.ref_library, nodeFs)) : null,
      known_libraries: await kr.knownLibraries(nodeRefFs),
      window: await safe(() => windowResults(doc, exp.bundled,
        exp.source_dir !== null ? join(root, exp.source_dir) : null, root)),
    }
    if (exp.picker_args) {
      const [current, browseTo, selections] = exp.picker_args
      actual.picker = await pickerResults(sub(current), exp.bundled, browseTo ? sub(browseTo) : browseTo, selections)
      actual.picker_args = exp.picker_args
    }
    const normalised = JSON.parse(JSON.stringify(actual).replaceAll(JSON.stringify(root).slice(1, -1), '<ROOT>'))
    expect(normalised).toEqual(exp)
    rmSync(dirname(root), { recursive: true, force: true })
  })
})
