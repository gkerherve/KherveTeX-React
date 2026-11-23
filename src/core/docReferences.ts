// Port of khervedoc/doc_references.py: the document's own references, a
// .bib that lives inside the .ktex.
//
// KherveRef keeps a library of references shared between documents; a
// document may also keep its own list, edited in References ▸ Manage
// references (ui/dialogs/ReferenceManager.tsx). The list is the document's
// kherveref.bib, bundled in the .ktex as the cited entries of a KherveRef
// library are, and `DocMeta.ref_library` is DOCUMENT_LIBRARY. Unlike a
// library's copy it holds every entry, cited or not; BibTeX prints only
// the cited ones. A KherveTeX that predates the list reads it as the
// bundled copy of a library it cannot find, so the document still
// compiles.
//
// The list is kept as BibTeX source, entry by entry (key -> the entry's
// text, as kherveref.splitBib gives it), so entries imported from
// elsewhere keep every field and comment they had; an entry edited in the
// form is written again from its fields.
import { splitBib, stringDefinitions } from './kherveref.ts'
import { parseBibtex } from './references.ts'

export { DOCUMENT_LIBRARY } from './kherveref.ts'

export const HEADER = '% The references of this document, kept by KherveTeX.\n\n'

// The entry types offered, and the fields the form shows, in the order
// they are written.
export const ENTRY_TYPES = ['article', 'book', 'inproceedings', 'incollection',
  'phdthesis', 'mastersthesis', 'techreport', 'misc', 'online']
export const FIELDS = ['author', 'title', 'journal', 'booktitle', 'year', 'volume',
  'number', 'pages', 'publisher', 'school', 'institution', 'doi', 'url', 'note']

const HEAD_RE = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/

export type Fields = Record<string, string>

// [type, key, fields] of one entry's source; field names lower-case,
// values without their outer braces or quotes, in source order.
export function parseEntry(text: string): [string, string, Fields] {
  const m = HEAD_RE.exec(text)
  if (!m) return ['misc', '', {}]
  const etype = m[1].toLowerCase()
  const key = m[2]
  let body = text.slice(m.index + m[0].length).trimEnd()
  if (body.endsWith('}') || body.endsWith(')')) body = body.slice(0, -1)
  const fields: Fields = {}
  const n = body.length
  let i = 0
  const nameRe = /\s*,?\s*([\w-]+)\s*=\s*/y
  while (i < n) {
    nameRe.lastIndex = i
    const fm = nameRe.exec(body)
    if (!fm) break
    const name = fm[1].toLowerCase()
    i = nameRe.lastIndex
    let value: string
    if (i < n && body[i] === '{') {
      let depth = 0
      let j = i
      while (j < n) {
        if (body[j] === '\\') { j += 2; continue }
        if (body[j] === '{') depth += 1
        else if (body[j] === '}') {
          depth -= 1
          if (depth === 0) break
        }
        j += 1
      }
      value = body.slice(i + 1, j)
      i = j + 1
    } else if (i < n && body[i] === '"') {
      let j = body.indexOf('"', i + 1)
      if (j < 0) j = n
      value = body.slice(i + 1, j)
      i = j + 1
    } else {
      const bare = /[^,]*/y
      bare.lastIndex = i
      const bm = bare.exec(body)!
      value = bm[0].trim()
      i = bare.lastIndex
    }
    if (!(name in fields)) fields[name] = value.trim()
  }
  return [etype, key, fields]
}

// BibTeX source for an entry: the known fields in the form's order, then
// any others; empty fields left out.
export function formatEntry(etype: string, key: string, fields: Fields): string {
  const names = FIELDS.filter(f => (fields[f] ?? '').trim())
    .concat(Object.keys(fields).filter(f => !FIELDS.includes(f) && fields[f].trim()))
  const width = Math.max(0, ...names.map(f => f.length))
  const lines = names.map(f => `  ${f.padEnd(width)} = {${fields[f].trim()}}`)
  return `@${etype}{${key},\n` + lines.join(',\n') + '\n}'
}

function ascii(s: string): string {
  return s.replace(/\\.|[{}]/g, '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
}

const STOP = ['a', 'an', 'the', 'on', 'of', 'in', 'and']

// A citation key as KherveRef makes one: the first author's surname, the
// year and the first word of the title (smith2020decay), with a letter
// added when the key is taken.
export function suggestKey(author: string, year: string, title: string, taken: Set<string>): string {
  const first = author.trim() ? author.trim().split(/\s+and\s+/)[0] : ''
  const surname = first.includes(',') ? first.split(',')[0] : (first.split(/\s+/).filter(Boolean).pop() ?? '')
  const words = (ascii(title).match(/[A-Za-z]+/g) ?? []).filter(w => !STOP.includes(w.toLowerCase()))
  const base = (ascii(surname).toLowerCase().replace(/[^a-z]/g, '')
    + year.replace(/\D/g, '').slice(0, 4)
    + (words.length ? words[0].toLowerCase() : '')) || 'ref'
  let key = base
  let n = 0
  while (taken.has(key)) {
    key = base + String.fromCharCode(97 + n)
    n += 1
  }
  return key
}

// key -> entry source, in the list's order.
export function entries(text: string): Map<string, string> {
  return splitBib(text)
}

// The list as a .bib: @string definitions first, then the entries; '' for
// an empty list.
export function write(items: Map<string, string>, strings: string[] = []): string {
  if (!items.size) return ''
  const parts = [...new Set(strings), ...items.values()]
  return HEADER + parts.join('\n\n') + '\n'
}

// Add the entries of *other* (a .bib) whose keys the list lacks; [new
// text, keys added]. An entry already in the list stays as it is.
export function merge(text: string, other: string): [string, string[]] {
  const items = entries(text)
  const added: string[] = []
  for (const [key, src] of entries(other)) {
    if (!items.has(key)) {
      items.set(key, src)
      added.push(key)
    }
  }
  return [write(items, [...stringDefinitions(text), ...stringDefinitions(other),
    ...preambleDefinitions(text), ...preambleDefinitions(other)]), added]
}

// The @preamble{...} blocks of a .bib (macros its entries use, such as
// \noopsort), kept with the list as its @string definitions are.
export function preambleDefinitions(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/@preamble\s*([{(])/gi)) {
    const paren = m[1] === '('
    let depth = 0
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      const ch = text[i]
      if (ch === '\\') { i++; continue }
      if (ch === '{' || (paren && ch === '(')) depth++
      else if (ch === '}' || (paren && ch === ')')) {
        depth--
        if (depth === 0) { out.push(text.slice(m.index, i + 1)); break }
      }
    }
  }
  return out
}

// The keys of *other* the list already has for a different reference
// (not the same entry imported again): kept as they were, and said so.
export function conflicts(text: string, other: string): string[] {
  const mine = entries(text)
  const norm = (src: string) => {
    const [t, , f] = parseEntry(src)
    return t.toLowerCase() + '|' + (f.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + (f.year ?? '')
  }
  const out: string[] = []
  for (const [key, src] of entries(other)) {
    const have = mine.get(key)
    if (have !== undefined && have !== src && norm(have) !== norm(src)) out.push(key)
  }
  return out
}

// The list with *source* in place of the entry *oldKey* (at its place),
// or added at the end when oldKey is null or not there.
export function setEntry(text: string, oldKey: string | null, source: string): string {
  const items = entries(text)
  const key = parseEntry(source)[1]
  const out = new Map<string, string>()
  let placed = false
  for (const [k, v] of items) {
    if (k === oldKey) {
      out.set(key, source)
      placed = true
    } else if (k !== key) {
      out.set(k, v)
    }
  }
  if (!placed) out.set(key, source)
  return write(out, stringDefinitions(text))
}

export function removeEntry(text: string, key: string): string {
  const items = entries(text)
  items.delete(key)
  return write(items, stringDefinitions(text))
}

// What a row of the manager's list is.
export const CITED = 'cited'
export const NOT_CITED = 'not cited'
export const MISSING = 'missing'

export interface RefRow {
  key: string
  author: string
  year: string
  title: string
  status: string
}

// The manager's list: every entry (cited or not), then every cited key the
// list lacks (missing), each with its key, author, year, title and status.
export function rows(text: string, cited: string[]): RefRow[] {
  const shown = parseBibtex(text)
  const out: RefRow[] = []
  for (const key of entries(text).keys()) {
    const e = shown.get(key)
    out.push({ key, author: e?.author ?? '', year: e?.year ?? '', title: e?.title ?? '',
      status: cited.includes(key) ? CITED : NOT_CITED })
  }
  const have = new Set(out.map(r => r.key))
  for (const key of cited) {
    if (!have.has(key)) out.push({ key, author: '', year: '', title: '', status: MISSING })
  }
  return out
}

// The search bar: every word in the key, author, year or title.
export function matches(row: RefRow, query: string): boolean {
  const hay = [row.key, row.author, row.year, row.title].join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}
