// A literal thebibliography block, read into its \bibitem entries and
// written back. The document keeps the block as RawLatex (the .ktex and
// the LaTeX are unchanged); this is what the page view shows and what the
// Bibliography dialog edits. Text the parser does not understand (a
// \small before the first item, comments) is kept as it is.

export interface BibItem {
  key: string
  // \bibitem[label]{key}: the label printed instead of the number.
  label: string
  // The entry's LaTeX, without the trailing blank line.
  text: string
}

export interface TheBibliography {
  // The {widest label} argument.
  widest: string
  // Whatever sits between the \begin line and the first \bibitem.
  before: string
  items: BibItem[]
}

const BEGIN_RE = /\\begin\{thebibliography\}\s*\{([^}]*)\}/
const END = '\\end{thebibliography}'
const ITEM_RE = /\\bibitem\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g

export function isTheBibliography(text: string): boolean {
  return BEGIN_RE.test(text)
}

export function parseTheBibliography(text: string): TheBibliography | null {
  const b = BEGIN_RE.exec(text)
  if (!b) return null
  const start = b.index + b[0].length
  let end = text.indexOf(END, start)
  if (end < 0) end = text.length
  const body = text.slice(start, end)
  const heads = [...body.matchAll(ITEM_RE)]
  const items: BibItem[] = heads.map((m, i) => {
    const from = m.index! + m[0].length
    const to = i + 1 < heads.length ? heads[i + 1].index! : body.length
    return { key: m[2].trim(), label: m[1] ?? '', text: body.slice(from, to).trim() }
  })
  const before = (heads.length ? body.slice(0, heads[0].index) : body).trim()
  return { widest: b[1], before, items }
}

export function writeTheBibliography(bib: TheBibliography): string {
  const widest = bib.widest || String(Math.max(9, bib.items.length))
  const lines = [`\\begin{thebibliography}{${widest}}`]
  if (bib.before) lines.push(bib.before)
  for (const it of bib.items) {
    const label = it.label ? `[${it.label}]` : ''
    lines.push(`\\bibitem${label}{${it.key}} ${it.text.trim()}`, '')
  }
  if (bib.items.length) lines.pop()
  lines.push(END)
  return lines.join('\n')
}

// The fields of the Add reference form.
export interface RefFields {
  authors: string
  title: string
  // Journal, book or publisher.
  source: string
  volume: string
  pages: string
  year: string
  doi: string
}

// One entry in the usual physical-sciences style:
//   A. Author and B. Author, \emph{Title}, Journal \textbf{12}, 1--9 (2020). doi
export function formatReference(f: RefFields): string {
  const parts: string[] = []
  const t = (s: string) => s.trim()
  if (t(f.authors)) parts.push(t(f.authors))
  if (t(f.title)) parts.push(`\\emph{${t(f.title)}}`)
  let src = t(f.source)
  if (t(f.volume)) src += `${src ? ' ' : ''}\\textbf{${t(f.volume)}}`
  if (t(f.pages)) src += `${src ? ', ' : ''}${t(f.pages).replace(/\s*[-–]+\s*/, '--')}`
  if (t(f.year)) src += `${src ? ' ' : ''}(${t(f.year)})`
  if (src) parts.push(src)
  let out = parts.join(', ')
  if (out) out += '.'
  if (t(f.doi)) {
    const doi = t(f.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    out += `${out ? ' ' : ''}\\url{https://doi.org/${doi}}`
  }
  return out
}

// A citation key from the first author's surname and the year
// ("smith2020"), made unique among `taken`.
export function suggestKey(f: RefFields, taken: Iterable<string>): string {
  const first = f.authors.split(/,| and /)[0] ?? ''
  const words = first.trim().split(/\s+/)
  const surname = (words[words.length - 1] ?? '').normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase()
  const base = (surname || 'ref') + (f.year.trim().replace(/\D/g, '') || '')
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let c = 97; c < 123; c++) if (!used.has(base + String.fromCharCode(c))) return base + String.fromCharCode(c)
  let n = 2
  while (used.has(`${base}_${n}`)) n++
  return `${base}_${n}`
}

// A new, empty bibliography block.
export function newTheBibliography(items: BibItem[] = []): string {
  return writeTheBibliography({ widest: '99', before: '', items })
}
