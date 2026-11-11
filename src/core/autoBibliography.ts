// The reference list LaTeX prints at the end of a document whose
// citations come from its references (a KherveRef library or its own
// list): the serializer adds \bibliographystyle + \bibliography{kherveref}
// (withKherverefBibliography), so BibTeX writes the list; it is in no block
// of the document. This builds the same list for the page view, and says
// how citations print with that style: natbib's author-year styles
// (plainnat, abbrvnat, unsrtnat) print "Calì et al. [2023]", the numeric
// ones "[1]", numbered in the list's order.
import { parseEntry } from './docReferences.ts'
import { splitBib } from './kherveref.ts'
import { citedKeys } from './model.ts'
import type { Document, RawLatex } from './model.ts'

const NATBIB_STYLES = new Set(['plainnat', 'abbrvnat', 'unsrtnat'])

// The reference styles References offers: [bibliographystyle, what it
// looks like]. The first is the default (DocMeta.bib_style '').
export const BIB_STYLES: [string, string][] = [
  ['plainnat', 'Author–year, sorted by author: Calì et al. [2023]'],
  ['abbrvnat', 'Author–year, first names as initials'],
  ['unsrtnat', 'Author–year, in the order cited'],
  ['plain', 'Numbered, sorted by author: [1]'],
  ['unsrt', 'Numbered, in the order cited'],
  ['abbrv', 'Numbered, first names as initials'],
  ['ieeetr', 'IEEE: numbered in the order cited, initials'],
]
// Styles that list the references in the order they are first cited;
// the others sort them by author.
const CITE_ORDER = new Set(['unsrt', 'unsrtnat', 'ieeetr'])

// Whether the LaTeX gets \bibliography{kherveref} at its end (the same
// test as serializer.withKherverefBibliography): a document citing from
// its references that has no reference list of its own.
export function printsKherverefBibliography(doc: Document): boolean {
  const m = doc.meta
  if (!m.ref_library || !citedKeys(doc).length) return false
  return !doc.children.some(b => b.type === 'RawLatex'
    && /\\bibliography\{|\\printbibliography|\{thebibliography\}/.test((b as RawLatex).text))
}

export interface CiteMode {
  // "Calì et al. [2023]" (natbib author-year) rather than "[1]".
  authorYear: boolean
  open: string
  close: string
}

// How the document's citations print, or null for KherveTeX's usual
// numbered display.
export function citeMode(doc: Document): CiteMode | null {
  if (!printsKherverefBibliography(doc)) return null
  const m = doc.meta
  const style = (m.bib_style || 'plainnat').toLowerCase()
  const opts = `${(m.packages || []).join(' ')} ${m.preamble_extras || ''} ${m.class_options || ''}`
  const round = /\bround\b/.test(opts)
  const authorYear = NATBIB_STYLES.has(style) && !/\bnumbers\b/.test(opts)
  return { authorYear, open: round ? '(' : '[', close: round ? ')' : ']' }
}

// TeX in a .bib field as the words it prints: accents, dashes, escapes,
// braces dropped.
const ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  c: { c: 'ç', C: 'Ç' },
}

export function texText(s: string): string {
  return s
    .replace(/\\([`'^"~])\s*\{?\\?([A-Za-z])\}?/g, (_m, acc: string, ch: string) => ACCENTS[acc]?.[ch] ?? ch)
    .replace(/\\c\s*\{([A-Za-z])\}/g, (_m, ch: string) => ACCENTS.c[ch] ?? ch)
    .replace(/\\(?:ss)\b\s*/g, 'ß').replace(/\\o\b\s*/g, 'ø').replace(/\\aa\b\s*/g, 'å')
    .replace(/\\([&%$#_])/g, '$1')
    .replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ')
    .replace(/\\(?:emph|textit|textbf|textrm|textsc|mathrm|url|text)\s*\{/g, '{')
    .replace(/\\[A-Za-z]+\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ').trim()
}

interface Person { first: string; last: string }

function people(author: string): Person[] {
  return author.split(/\s+and\s+/i).map(p => texText(p)).filter(Boolean).map(p => {
    if (p.includes(',')) {
      const [last, first] = p.split(',', 2).map(x => x.trim())
      return { first, last }
    }
    const words = p.split(' ')
    return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] }
  })
}

function initials(first: string): string {
  return first.split(/([\s-]+)/).map(w => (/^[\s-]+$/.test(w) ? (w.includes('-') ? '-' : ' ') : w ? `${w[0]}.` : ''))
    .join('').replace(/\s+/g, ' ').trim()
}

// "First Last, First Last, and First Last", as plain and plainnat write
// the authors (abbrv styles: initials).
export function authorList(author: string, abbreviate: boolean): string {
  const names = people(author).map(p => [abbreviate ? initials(p.first) : p.first, p.last].filter(Boolean).join(' '))
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// "Calì et al.", "Smith and Doe", "Smith": a citation's author part.
export function citeAuthors(author: string): string {
  const ps = people(author)
  if (!ps.length) return ''
  if (ps.length === 1) return ps[0].last
  if (ps.length === 2) return `${ps[0].last} and ${ps[1].last}`
  return `${ps[0].last} et al.`
}

// A piece of an entry: plain or italic text.
export type Run = { text: string; italic?: boolean }

export interface BibItem {
  key: string
  // "[1]" for a numeric style, '' for an author-year one.
  label: string
  runs: Run[]
}

export interface AutoBibliography {
  items: BibItem[]
  // key -> its number in the list (numeric styles number in list order).
  numbers: Map<string, number>
}

function entryRuns(etype: string, f: Record<string, string>, abbreviate: boolean): Run[] {
  const t = (k: string) => texText(f[k] ?? '')
  const runs: Run[] = []
  const add = (text: string, italic = false) => { if (text) runs.push({ text, italic }) }
  const authors = authorList(f.author || f.editor || '', abbreviate)
  if (authors) add(`${authors}. `)
  const year = [t('month'), t('year')].filter(Boolean).join(' ')
  const pages = t('pages')
  const tail = (parts: string[]) => { const s = parts.filter(Boolean).join(', '); if (s) add(`${s}. `) }
  if (etype === 'book') {
    if (t('title')) { add(t('title'), true); add('. ') }
    tail([t('publisher'), year])
  } else if (etype === 'phdthesis' || etype === 'mastersthesis') {
    if (t('title')) { add(t('title'), true); add('. ') }
    tail([etype === 'phdthesis' ? 'PhD thesis' : "Master's thesis", t('school'), year])
  } else if (etype === 'inproceedings' || etype === 'incollection' || etype === 'conference') {
    if (t('title')) add(`${t('title')}. `)
    if (t('booktitle')) { add('In '); add(t('booktitle'), true) }
    tail([pages ? `pages ${pages}` : '', year])
  } else if (etype === 'article') {
    if (t('title')) add(`${t('title')}. `)
    if (t('journal')) add(t('journal'), true)
    let vol = t('volume')
    if (vol && t('number')) vol += `(${t('number')})`
    if (vol && pages) vol += `:${pages}`
    else if (!vol && pages) vol = pages
    tail([vol, year])
  } else {
    if (t('title')) add(`${t('title')}. `)
    tail([t('howpublished'), t('publisher') || t('institution'), year])
  }
  if (t('note')) add(`${t('note')}. `)
  if (t('issn')) add(`ISSN ${t('issn')}. `)
  if (t('doi')) add(`doi: ${t('doi')}. `)
  // Commas after the italic journal or book title: "Journal, 7(16):…".
  const out: Run[] = []
  for (const r of runs) {
    const prev = out[out.length - 1]
    if (prev?.italic && !r.italic && /^[^.]/.test(r.text) && !r.text.startsWith(', ') && !r.text.startsWith('. ')) {
      out.push({ text: `, ${r.text}` })
    } else out.push(r)
  }
  const last = out[out.length - 1]
  if (last && !last.italic) last.text = last.text.trimEnd()
  return out
}

// The list BibTeX writes for the document's citations, from the .bib
// text it carries; null when the LaTeX prints none of its own.
export function autoBibliography(doc: Document, bibText: string): AutoBibliography | null {
  if (!printsKherverefBibliography(doc)) return null
  const style = (doc.meta.bib_style || 'plainnat').toLowerCase()
  const source = splitBib(bibText)
  const keys = citedKeys(doc).filter(k => source.has(k))
  const entries = keys.map(key => {
    const [etype, , fields] = parseEntry(source.get(key)!)
    return { key, etype, fields }
  })
  if (!CITE_ORDER.has(style)) {
    const sortKey = (e: { fields: Record<string, string> }) => {
      const p = people(e.fields.author || e.fields.editor || '')[0]
      return `${p?.last ?? ''} ${p?.first ?? ''} ${e.fields.year ?? ''} ${texText(e.fields.title ?? '')}`.toLowerCase()
    }
    entries.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  }
  const mode = citeMode(doc)
  const abbreviate = style.startsWith('abbrv') || style === 'ieeetr'
  const numbers = new Map<string, number>()
  const items = entries.map((e, i) => {
    numbers.set(e.key, i + 1)
    return {
      key: e.key, label: mode?.authorYear ? '' : `[${i + 1}]`,
      runs: entryRuns(e.etype, e.fields, abbreviate),
    }
  })
  return { items, numbers }
}

// A citation as the PDF prints it with natbib's author-year styles:
// \cite and \citet "Calì et al. [2023]", \citep "[Calì et al., 2023]".
export function authorYearCite(keys: string[], style: string, entry: (k: string) => { author?: string; year?: string } | undefined,
  mode: CiteMode): string {
  const parts = keys.map(k => {
    const e = entry(k)
    const who = citeAuthors(e?.author ?? '')
    const year = texText(e?.year ?? '')
    return { k, who, year }
  })
  if (style === 'citep') {
    return mode.open + parts.map(p => (p.who ? (p.year ? `${p.who}, ${p.year}` : p.who) : `${p.k}?`)).join('; ') + mode.close
  }
  return parts.map(p => (p.who ? (p.year ? `${p.who} ${mode.open}${p.year}${mode.close}` : p.who) : `${p.k}?`)).join(', ')
}
