// Resolve citations and cross-references for on-screen display. A port of
// khervedoc/references.py.
//
// The visual editor shows `\cite{smith2020}` as "[1]" or "Smith (2020)"
// and `\ref{sec:intro}` as "2.1", the way the compiled PDF will, instead
// of raw keys. Everything here is read-only over the document model; the
// LaTeX output is untouched.
//
// Python dicts keep their first-insertion order even when a key is
// overwritten, and BibTeX keys can look like integers ("2020"), which a
// JavaScript object would reorder — so every key -> value table is a Map.

import { authorYearCite, type CiteMode } from './autoBibliography.ts'
import { walk } from './model.ts'
import type { Citation, Document, Figure, MathBlock, RawLatex, Section, Table } from './model.ts'
import type { FileAccess } from './kdocz.ts'
import { join, suffix } from './paths.ts'
import { pyRe, reMatch, reSearch, reSplit, reSub, strip } from './py.ts'

// The fields parse_bibtex keeps (author, year, title); a \bibitem-only
// entry is {}.
export type BibFields = Record<string, string>
export type BibEntries = Map<string, BibFields>

const _BIB_SOURCE_RE = pyRe(
  String.raw`\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}`)
const _BIBITEM_RE = pyRe(String.raw`\\bibitem(?:\[([^\]]*)\])?\{([^}]+)\}`)
const _ENTRY_START_RE = pyRe(String.raw`@(\w+)\s*[{(]\s*([^,\s]+)\s*,`)

// Yield every model node below *node*, depth first, in order.
export const _walk = walk

// str.split() with no argument: runs of whitespace, no empty pieces.
export function pySplit(s: string): string[] {
  const t = strip(s)
  return t ? reSplit(pyRe(String.raw`\s+`), t) : []
}

// Path.read_text(encoding="utf-8", errors=...): text mode turns \r\n and
// \r into \n, and Python's "utf-8" (unlike TextDecoder's default) keeps a
// leading BOM. Throws (as OSError / UnicodeDecodeError) when unreadable.
export async function readText(fs: FileAccess, path: string, errors: 'strict' | 'replace' = 'strict'): Promise<string> {
  const bytes = await fs.read(path)
  const text = new TextDecoder('utf-8', { fatal: errors === 'strict', ignoreBOM: true }).decode(bytes)
  return text.replace(/\r\n?/g, '\n')
}

const _fieldRes = new Map<string, RegExp>()
const _BARE_VALUE_RE = pyRe(String.raw`[^,}\s]*`)

// The value of `name = {..}` / `"..."` / bare in a BibTeX entry body.
export function _field_value(body: string, name: string): string {
  let re = _fieldRes.get(name)
  if (!re) {
    re = pyRe(String.raw`(?<![\w-])` + name + String.raw`\s*=\s*`, 'i')
    _fieldRes.set(name, re)
  }
  const m = reSearch(re, body)
  if (!m) return ''
  const i = m.index + m[0].length
  if (i >= body.length) return ''
  if (body[i] === '{') {
    let depth = 0
    let j = i
    while (j < body.length) {
      if (body[j] === '{') {
        depth += 1
      } else if (body[j] === '}') {
        depth -= 1
        if (depth === 0) return body.slice(i + 1, j)
      }
      j += 1
    }
    return body.slice(i + 1)
  }
  if (body[i] === '"') {
    const j = body.indexOf('"', i + 1)
    return j !== -1 ? body.slice(i + 1, j) : body.slice(i + 1)
  }
  return reMatch(_BARE_VALUE_RE, body, i)![0]
}

// s[:n] in code points.
const head = (s: string, n: number): string => Array.from(s).slice(0, n).join('')

// Parse the fields needed for display (author, year, title) out of
// BibTeX source. Tolerant: malformed entries are skipped, not fatal.
export function parseBibtex(text: string): BibEntries {
  const entries: BibEntries = new Map()
  const starts = [...text.matchAll(_ENTRY_START_RE)]
  for (let n = 0; n < starts.length; n++) {
    const m = starts[n]
    const kind = m[1].toLowerCase()
    if (kind === 'comment' || kind === 'string' || kind === 'preamble') continue
    const end = n + 1 < starts.length ? starts[n + 1].index : text.length
    const body = text.slice(m.index + m[0].length, end)
    entries.set(m[2], {
      author: _field_value(body, 'author')
        || _field_value(body, 'editor'),
      year: _field_value(body, 'year')
        || head(_field_value(body, 'date'), 4),
      title: _field_value(body, 'title'),
    })
  }
  return entries
}

export function _clean(s: string): string {
  return strip(reSub(pyRe('[{}]'), s, ''))
}

// 'Smith, J. and Doe, A. and Roe, B.' -> 'Smith et al.'
export function shortAuthor(author: string): string {
  const people = reSplit(pyRe(String.raw`\s+and\s+`), _clean(author))
    .filter((p) => strip(p)).map((p) => strip(p))
  if (!people.length) return ''

  const surname = (p: string): string => {
    if (p.includes(',')) return strip(p.split(',')[0])
    const w = pySplit(p)
    return w[w.length - 1]
  }

  if (people.length === 1) return surname(people[0])
  if (people.length === 2) return `${surname(people[0])} and ${surname(people[1])}`
  return `${surname(people[0])} et al.`
}

// The .bib files a \bibliography{a,b} / \addbibresource{a.bib} names,
// relative to base_dir: base_dir / name, ".bib" appended when missing.
function bibPath(baseDir: string, name: string): string {
  let path = join(baseDir, strip(name)).replace(/(?<=.)[\\/]+$/, '')
  if (suffix(path) !== '.bib') path = path + '.bib'
  return path
}

// Every .bib path ReferenceResolver would read for *doc*, in order, so
// an async caller can read them ahead (ReferenceResolver.load).
export function bibliographyPaths(doc: Document, baseDir: string | null): string[] {
  const out: string[] = []
  if (baseDir === null) return out
  for (const node of _walk(doc)) {
    if (node.type !== 'RawLatex') continue
    for (const m of (node as unknown as RawLatex).text.matchAll(_BIB_SOURCE_RE)) {
      for (const name of m[1].split(',')) out.push(bibPath(baseDir, name))
    }
  }
  return out
}

// Read one .bib file for the resolver: its text, or null when unreadable
// (Python's OSError).
export type BibReader = (path: string) => string | null

// pyList[i] with Python's negative indexing; IndexError past either end.
function pyIndex(n: number, len: number): number {
  const i = n < 0 ? n + len : n
  if (i < 0 || i >= len) throw new RangeError('IndexError: list index out of range')
  return i
}

// Display text for the citations and cross-references of one document.
export class ReferenceResolver {
  entries: BibEntries = new Map()
  _bibitem_labels = new Map<string, string>()
  cite_numbers = new Map<string, number>()
  labels = new Map<string, string>()
  // How the citations print when the LaTeX writes the reference list
  // itself (core/autoBibliography): natbib author-year, or numbers in the
  // list's order (`listNumbers`). Unset: numbered by first citation.
  citeMode: CiteMode | null = null
  listNumbers: Map<string, number> | null = null

  // *readBib* stands in for Path.read_text; ReferenceResolver.load reads
  // the files first through a FileAccess.
  constructor(doc: Document, baseDir: string | null = null, extraBib = '', readBib: BibReader | null = null) {
    this._load_bibliography(doc, baseDir, readBib)
    // Citations from a KherveRef library (kherveref_link).
    for (const [key, entry] of parseBibtex(extraBib)) {
      if (!this.entries.has(key)) this.entries.set(key, entry)
    }
    this._number_citations(doc)
    this._number_labels(doc)
  }

  // The resolver with every \bibliography file read through *fs*.
  static async load(doc: Document, baseDir: string | null, extraBib: string, fs: FileAccess): Promise<ReferenceResolver> {
    const texts = new Map<string, string | null>()
    for (const p of bibliographyPaths(doc, baseDir)) {
      if (texts.has(p)) continue
      try {
        texts.set(p, await readText(fs, p, 'replace'))
      } catch {
        texts.set(p, null)
      }
    }
    return new ReferenceResolver(doc, baseDir, extraBib, (p) => texts.get(p) ?? null)
  }

  _load_bibliography(doc: Document, baseDir: string | null, readBib: BibReader | null): void {
    for (const node of _walk(doc)) {
      if (node.type !== 'RawLatex') continue
      const t = (node as unknown as RawLatex).text
      for (const m of t.matchAll(_BIBITEM_RE)) {
        const key = strip(m[2])
        if (!this.entries.has(key)) this.entries.set(key, {})
        if (m[1]) this._bibitem_labels.set(key, m[1])
      }
      if (baseDir === null) continue
      for (const m of t.matchAll(_BIB_SOURCE_RE)) {
        for (const name of m[1].split(',')) {
          const text = readBib ? readBib(bibPath(baseDir, name)) : null
          if (text === null) continue
          for (const [key, entry] of parseBibtex(text)) {
            if (!this.entries.has(key)) this.entries.set(key, entry)
          }
        }
      }
    }
  }

  _number_citations(doc: Document): void {
    // Order of first citation, as unsrt / most numeric styles do.
    for (const node of _walk(doc)) {
      if (node.type === 'Citation') {
        for (const key of (node as unknown as Citation).keys) {
          if (!this.cite_numbers.has(key)) this.cite_numbers.set(key, this.cite_numbers.size + 1)
        }
      }
    }
  }

  _number_labels(doc: Document): void {
    const blocks = [..._walk(doc)]
    const hasChapters = blocks.some((b) => b.type === 'Section' && (b as unknown as Section).level === 0)
    const counters = [0, 0, 0, 0, 0, 0, 0]   // index 0 = chapter, 1..5 = section levels
    let fig = 0
    let tab = 0
    let eq = 0

    const prefixed = (n: number): string => hasChapters ? `${counters[0]}.${n}` : String(n)

    for (const b of blocks) {
      if (b.type === 'Section' && (b as unknown as Section).numbered) {
        const s = b as unknown as Section
        const lvl = s.level
        counters[pyIndex(lvl, counters.length)] += 1
        for (let i = lvl + 1; i < counters.length; i++) counters[pyIndex(i, counters.length)] = 0
        if (lvl === 0) { fig = 0; tab = 0; eq = 0 }
        const start = hasChapters ? 0 : 1
        // counters[start:lvl + 1], Python slice bounds.
        let stop = lvl + 1
        if (stop < 0) stop = Math.max(0, stop + counters.length)
        const number = counters.slice(start, stop).map(String).join('.')
        if (s.label) this.labels.set(s.label, number)
      } else if (b.type === 'Figure') {
        fig += 1
        const label = (b as unknown as Figure).label
        if (label) this.labels.set(label, prefixed(fig))
      } else if (b.type === 'Table') {
        tab += 1
        const label = (b as unknown as Table).label
        if (label) this.labels.set(label, prefixed(tab))
      } else if (b.type === 'MathBlock' && (b as unknown as MathBlock).numbered) {
        eq += 1
        const label = (b as unknown as MathBlock).label
        if (label) this.labels.set(label, prefixed(eq))
      }
    }
  }

  citeText(keys: string[], style = 'cite'): string {
    if (this.citeMode?.authorYear) return authorYearCite(keys, style, k => this.entries.get(k), this.citeMode)
    if (this.listNumbers && style === 'cite') {
      return '[' + keys.map(k => String(this.listNumbers!.get(k) ?? `${k}?`)).join(', ') + ']'
    }
    if (style === 'citet' || style === 'citep') {
      const parts: string[] = []
      for (const k of keys) {
        const e = this.entries.get(k) ?? {}
        const who = shortAuthor(e.author ?? '')
        const year = _clean(e.year ?? '')
        if (!who) {
          parts.push(`${k}?`)
        } else if (style === 'citet') {
          parts.push(year ? `${who} (${year})` : who)
        } else {
          parts.push(year ? `${who}, ${year}` : who)
        }
      }
      return style === 'citet' ? parts.join('; ') : '(' + parts.join('; ') + ')'
    }
    const shown: string[] = []
    for (const k of keys) {
      if (this._bibitem_labels.has(k)) {
        shown.push(this._bibitem_labels.get(k)!)
      } else if (this.entries.size && !this.entries.has(k)) {
        shown.push(`${k}?`)
      } else {
        shown.push(String(this.cite_numbers.get(k) ?? '?'))
      }
    }
    return '[' + shown.join(', ') + ']'
  }

  refText(label: string, kind = 'ref'): string {
    if (kind === 'pageref') return 'p. ?'
    const number = this.labels.get(label) ?? '??'
    return kind === 'eqref' ? `(${number})` : number
  }
}
