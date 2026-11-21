// References from other reference managers, as BibTeX the document's
// reference list (docReferences.ts) takes as it is: EndNote and Zotero
// exports in RIS (.ris), EndNote tagged (.enw) and EndNote XML (.xml).
// A .bib (Zotero, Better BibTeX, Mendeley...) needs no conversion.
//
// Pure text in, text out: no DOM (the EndNote XML is read with regular
// expressions), so it runs in Vitest and in the app.

import { formatEntry, suggestKey, type Fields } from './docReferences.ts'

// One reference read from an export, before it becomes BibTeX.
export interface ImportedRef {
  type: string                // BibTeX entry type
  authors: string[]           // "Surname, First" each
  editors: string[]
  fields: Fields              // title, journal, year... (not author/editor)
  key?: string                // a key the export gives (RIS ID is not one)
}

export type RefFormat = 'bibtex' | 'ris' | 'enw' | 'endnote-xml' | 'unknown'

// What kind of export *text* is; *name* (the file name) breaks ties.
export function detectFormat(text: string, name = ''): RefFormat {
  const t = text.replace(/^﻿/, '').trimStart()
  const ext = (name.match(/\.([^.\\/]+)$/)?.[1] ?? '').toLowerCase()
  if (t.startsWith('<') && /<records?\b|<xml\b/i.test(t.slice(0, 2000))) return 'endnote-xml'
  if (/^TY {2}- /m.test(t)) return 'ris'
  if (/^%[0A-Z] /m.test(t)) return 'enw'
  if (/@\w+\s*[{(]/.test(t)) return 'bibtex'
  if (ext === 'bib' || ext === 'bibtex') return 'bibtex'
  if (ext === 'ris') return 'ris'
  if (ext === 'enw' || ext === 'txt') return 'enw'
  if (ext === 'xml') return 'endnote-xml'
  return 'unknown'
}

// ---- RIS ---------------------------------------------------------------

const RIS_TYPES: Record<string, string> = {
  JOUR: 'article', JFULL: 'article', MGZN: 'article', NEWS: 'article', EJOUR: 'article',
  BOOK: 'book', EBOOK: 'book', EDBOOK: 'book', CHAP: 'incollection', ECHAP: 'incollection',
  CONF: 'inproceedings', CPAPER: 'inproceedings', THES: 'phdthesis', RPRT: 'techreport',
  ELEC: 'online', WEB: 'online', BLOG: 'online', GEN: 'misc', UNPB: 'unpublished',
}

// RIS (Zotero, EndNote, Mendeley, journals' "Export citation"): "TY  - JOUR"
// ... "ER  - " per reference.
export function parseRis(text: string): ImportedRef[] {
  const refs: ImportedRef[] = []
  let cur: Record<string, string[]> | null = null
  let last = ''
  for (const raw of text.replace(/^﻿/, '').split(/\r\n?|\n/)) {
    const m = /^([A-Z][A-Z0-9])  -(?: (.*))?$/.exec(raw)
    if (!m) {
      // A continuation line (some exports wrap long abstracts).
      if (cur && last && raw.trim()) {
        const vs = cur[last]
        vs[vs.length - 1] += ' ' + raw.trim()
      }
      continue
    }
    const [, tag, value = ''] = m
    if (tag === 'TY') { cur = {}; last = '' }
    if (!cur) continue
    if (tag === 'ER') {
      refs.push(risRef(cur))
      cur = null
      continue
    }
    ;(cur[tag] ??= []).push(value.trim())
    last = tag
  }
  if (cur && Object.keys(cur).length > 1) refs.push(risRef(cur))
  return refs
}

function risRef(t: Record<string, string[]>): ImportedRef {
  const first = (...tags: string[]) => {
    for (const tag of tags) { const v = t[tag]?.find(x => x); if (v) return v }
    return ''
  }
  const ty = first('TY').toUpperCase()
  const type = RIS_TYPES[ty] ?? 'misc'
  const fields: Fields = {}
  fields.title = first('TI', 'T1', 'CT')
  const container = first('T2', 'JO', 'JF', 'JA', 'J2', 'BT')
  if (type === 'article') fields.journal = container
  else if (type === 'inproceedings' || type === 'incollection') fields.booktitle = container
  else if (type === 'book' && container && !fields.title) fields.title = container
  fields.year = yearOf(first('PY', 'Y1', 'DA', 'Y2'))
  fields.volume = first('VL')
  fields.number = first('IS', 'CP')
  const sp = first('SP'), ep = first('EP')
  fields.pages = sp && ep && sp !== ep ? `${sp}--${ep}` : (sp.replace(/\s*[-–]+\s*/, '--'))
  fields.publisher = first('PB')
  if (type === 'phdthesis') { fields.school = fields.publisher; delete fields.publisher }
  if (type === 'techreport') { fields.institution = fields.publisher; delete fields.publisher }
  fields.address = first('CY', 'PP')
  fields.doi = cleanDoi(first('DO', 'M3'))
  fields.url = first('UR', 'L2')
  fields.isbn = ty === 'JOUR' ? '' : first('SN')
  fields.issn = ty === 'JOUR' ? first('SN') : ''
  fields.abstract = first('AB', 'N2')
  fields.keywords = (t.KW ?? []).filter(Boolean).join(', ')
  const authors = [...(t.AU ?? []), ...(t.A1 ?? [])].filter(Boolean)
  const editors = [...(t.ED ?? []), ...(t.A2 ?? []), ...(t.A3 ?? [])].filter(Boolean)
  return { type, authors, editors: type === 'article' ? [] : editors, fields }
}

// ---- EndNote tagged (.enw) ---------------------------------------------

const ENW_TYPES: Record<string, string> = {
  'journal article': 'article', 'magazine article': 'article', 'newspaper article': 'article',
  'electronic article': 'article', book: 'book', 'edited book': 'book', 'electronic book': 'book',
  'book section': 'incollection', 'conference proceedings': 'inproceedings',
  'conference paper': 'inproceedings', thesis: 'phdthesis', report: 'techreport',
  'web page': 'online', 'electronic source': 'online', generic: 'misc', patent: 'misc',
}

// EndNote's tagged export (.enw, Google Scholar's "EndNote"): "%0 Journal
// Article" opens a reference, blank lines separate them.
export function parseEnw(text: string): ImportedRef[] {
  const refs: ImportedRef[] = []
  let cur: Record<string, string[]> | null = null
  let last = ''
  const flush = () => { if (cur && Object.keys(cur).length) refs.push(enwRef(cur)); cur = null }
  for (const raw of text.replace(/^﻿/, '').split(/\r\n?|\n/)) {
    const m = /^%(\S) ?(.*)$/.exec(raw)
    if (!m) {
      if (!raw.trim()) { last = ''; continue }
      if (cur && last) { const vs = cur[last]; vs[vs.length - 1] += ' ' + raw.trim() }
      continue
    }
    const [, tag, value] = m
    if (tag === '0' || !cur) { flush(); cur = {} }
    ;(cur[tag] ??= []).push(value.trim())
    last = tag
  }
  flush()
  return refs
}

function enwRef(t: Record<string, string[]>): ImportedRef {
  const first = (...tags: string[]) => {
    for (const tag of tags) { const v = t[tag]?.find(x => x); if (v) return v }
    return ''
  }
  const type = ENW_TYPES[first('0').toLowerCase()] ?? (t.J ? 'article' : 'misc')
  const fields: Fields = {}
  fields.title = first('T')
  const container = first('J', 'B')
  if (type === 'article') fields.journal = container
  else if (type === 'inproceedings' || type === 'incollection') fields.booktitle = container
  fields.year = yearOf(first('D', '8'))
  fields.volume = first('V')
  fields.number = first('N')
  fields.pages = first('P').replace(/\s*[-–]+\s*/, '--')
  fields.publisher = first('I')
  if (type === 'phdthesis') { fields.school = fields.publisher; delete fields.publisher }
  if (type === 'techreport') { fields.institution = fields.publisher; delete fields.publisher }
  fields.address = first('C')
  fields.doi = cleanDoi(first('R'))
  fields.url = first('U')
  fields.abstract = first('X')
  fields.keywords = (t.K ?? []).join(', ')
  const isbn = first('@')
  if (type === 'article') fields.issn = isbn
  else fields.isbn = isbn
  return { type, authors: t.A ?? [], editors: type === 'article' ? [] : (t.E ?? []), fields }
}

// ---- EndNote XML ---------------------------------------------------------

const XML_TYPES: Record<string, string> = {
  ...ENW_TYPES,
}
// EndNote's numeric ref-type codes, for files without the name attribute.
const XML_TYPE_CODES: Record<string, string> = {
  '17': 'article', '6': 'book', '28': 'book', '5': 'incollection', '10': 'inproceedings',
  '47': 'inproceedings', '32': 'phdthesis', '27': 'techreport', '12': 'online', '13': 'misc',
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// The text inside an element: its tags dropped (EndNote wraps text in
// <style> runs), entities decoded.
function innerText(xml: string): string {
  return decodeXml(xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c.replace(/</g, '&lt;'))
    .replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function elements(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  return [...xml.matchAll(re)].map(m => m[1])
}

function element(xml: string, tag: string): string {
  const e = elements(xml, tag)
  return e.length ? innerText(e[0]) : ''
}

// EndNote XML (File ▸ Export ▸ XML; Zotero's "EndNote XML"): <record>s.
export function parseEndnoteXml(text: string): ImportedRef[] {
  return elements(text, 'record').map((rec) => {
    const rt = /<ref-type(?:\s+name="([^"]*)")?[^>]*>([^<]*)<\/ref-type>/.exec(rec)
    const type = (rt && (XML_TYPES[decodeXml(rt[1] ?? '').toLowerCase()] ?? XML_TYPE_CODES[rt[2].trim()]))
      || 'misc'
    const people = (group: string) => elements(rec, group).flatMap(g => elements(g, 'author').map(innerText))
      .filter(Boolean)
    const titles = elements(rec, 'titles')[0] ?? ''
    const fields: Fields = {}
    fields.title = element(titles, 'title')
    const container = element(titles, 'secondary-title')
      || element(elements(rec, 'periodical')[0] ?? '', 'full-title')
    if (type === 'article') fields.journal = container
    else if (type === 'inproceedings' || type === 'incollection') fields.booktitle = container
    const dates = elements(rec, 'dates')[0] ?? ''
    fields.year = yearOf(element(dates, 'year') || element(dates, 'date'))
    fields.volume = element(rec, 'volume')
    fields.number = element(rec, 'number')
    fields.pages = element(rec, 'pages').replace(/\s*[-–]+\s*/, '--')
    fields.publisher = element(rec, 'publisher')
    if (type === 'phdthesis') { fields.school = fields.publisher; delete fields.publisher }
    if (type === 'techreport') { fields.institution = fields.publisher; delete fields.publisher }
    fields.address = element(rec, 'pub-location')
    fields.doi = cleanDoi(element(rec, 'electronic-resource-num'))
    fields.url = elements(elements(rec, 'urls')[0] ?? '', 'url').map(innerText).find(Boolean) ?? ''
    const isbn = element(rec, 'isbn')
    if (type === 'article') fields.issn = isbn
    else fields.isbn = isbn
    fields.abstract = element(rec, 'abstract')
    fields.keywords = elements(elements(rec, 'keywords')[0] ?? '', 'keyword').map(innerText).join(', ')
    const editors = type === 'article' ? [] : people('secondary-authors')
    return { type, authors: people('authors'), editors, fields }
  })
}

// ---- To BibTeX -------------------------------------------------------------

function yearOf(s: string): string {
  return /\b(1[5-9]\d\d|2\d\d\d)\b/.exec(s)?.[1] ?? ''
}

function cleanDoi(s: string): string {
  const m = /10\.\d{4,9}\/\S+/.exec(s)
  return m ? m[0].replace(/[.,;]+$/, '') : ''
}

// "Smith, John" stays; "John Smith" becomes "Smith, John".
function personName(s: string): string {
  const n = s.replace(/\s+/g, ' ').trim().replace(/,\s*$/, '')
  if (!n || n.includes(',')) return n
  const parts = n.split(' ')
  if (parts.length === 1) return n
  return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`
}

// Characters that are special in LaTeX, in a value that is text (not a
// URL or DOI).
function texText(s: string): string {
  return s.replace(/(?<!\\)([&%$#_])/g, '\\$1')
}

const VERBATIM = new Set(['url', 'doi'])

// BibTeX source for *refs*, with keys made as KherveRef makes them
// (smith2020decay), none of them in *taken*.
export function toBibtex(refs: ImportedRef[], taken: Iterable<string> = []): string {
  const used = new Set(taken)
  const out: string[] = []
  for (const r of refs) {
    const author = r.authors.map(personName).filter(Boolean).join(' and ')
    const editor = r.editors.map(personName).filter(Boolean).join(' and ')
    const fields: Fields = {}
    if (author) fields.author = texText(author)
    for (const [k, v] of Object.entries(r.fields)) {
      if (v && v.trim()) fields[k] = VERBATIM.has(k) ? v.trim() : texText(v.trim())
    }
    if (editor) fields.editor = texText(editor)
    if (!fields.title && !author) continue
    const key = r.key && !used.has(r.key)
      ? r.key
      : suggestKey(author || editor, r.fields.year ?? '', r.fields.title ?? '', used)
    used.add(key)
    out.push(formatEntry(r.type, key, fields))
  }
  return out.join('\n\n')
}

// An export's text as BibTeX: unchanged for a .bib, converted for RIS,
// EndNote tagged and EndNote XML. Throws an Error a person can read when
// the text is none of these.
export function importToBibtex(text: string, name = '', taken: Iterable<string> = []): string {
  switch (detectFormat(text, name)) {
    case 'bibtex': return text
    case 'ris': return toBibtex(parseRis(text), taken)
    case 'enw': return toBibtex(parseEnw(text), taken)
    case 'endnote-xml': return toBibtex(parseEndnoteXml(text), taken)
    default:
      throw new Error('This file is not a reference export kTeX can read. '
        + 'Export as BibTeX (.bib), RIS (.ris), EndNote (.enw) or EndNote XML (.xml).')
  }
}
