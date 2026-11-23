// A .tex opened in kTeX keeps its references in .bib files: \bibliography{a,b}
// (BibTeX, natbib) or \addbibresource{refs.bib} (biblatex). Their entries go
// into the document's reference library (References ▸ Reference library),
// so they are kept in the .ktex, shown, searched and cited like any other.
//
// BibTeX documents then let kTeX write the bibliography (their
// \bibliographystyle becomes the References ▸ Style); biblatex documents
// keep biblatex, its resource pointed at the library's file.
import type { Block, Document } from './model.ts'
import { DOCUMENT_LIBRARY } from './kherveref.ts'

const LIB = 'kherveref'
const BIBLIOGRAPHY_RE = /\\bibliography\{([^}]*)\}/g
const STYLE_RE = /\\bibliographystyle\{([^}]*)\}/
const RESOURCE_RE = /\\(?:addbibresource|bibliography)(?:\[[^\]]*\])?\{([^}]*)\}/g

export interface TexBibliography {
  // The .bib files named, as written (relative to the .tex, ".bib" added).
  files: string[]
  style: string | null
  biblatex: boolean
}

const withBib = (n: string) => (/\.bib$/i.test(n) ? n : n + '.bib')

type Kid = { type: string; latex?: string; children?: Kid[] }

// The raw LaTeX of the document: raw blocks, and raw pieces inside text
// (the importer keeps a \bibliography line at the end of a paragraph so).
function rawTexts(doc: Document): string[] {
  const out: string[] = []
  const walk = (kids: Kid[] | undefined) => {
    for (const k of kids ?? []) {
      if (k.type === 'InlineRaw' && k.latex) out.push(k.latex)
      if (Array.isArray(k.children)) walk(k.children)
    }
  }
  for (const b of doc.children) {
    if (b.type === 'RawLatex') out.push(b.text)
    else walk((b as { children?: Kid[] }).children)
  }
  return out
}

const NAMES_BIB = (t: string) => /\\bibliography\{/.test(t) || /\\bibliographystyle\{/.test(t)

// Inline children without the \bibliography / \bibliographystyle pieces.
function dropInline(kids: Kid[]): Kid[] {
  return kids.filter(k => !(k.type === 'InlineRaw' && k.latex && NAMES_BIB(k.latex)))
    .map(k => (Array.isArray(k.children) ? { ...k, children: dropInline(k.children) } : k))
}

export function texBibliography(doc: Document): TexBibliography | null {
  const pre = doc.meta.preamble_extras ?? ''
  const biblatex = /\\usepackage(?:\[[^\]]*\])?\{biblatex\}/.test(pre) || /\\addbibresource\b/.test(pre)
  const files: string[] = []
  const add = (list: string) => {
    for (const n of list.split(',').map(x => x.trim()).filter(Boolean)) {
      if (n === LIB) continue
      const f = withBib(n)
      if (!files.includes(f)) files.push(f)
    }
  }
  if (biblatex) for (const m of pre.matchAll(RESOURCE_RE)) add(m[1])
  for (const t of [pre, ...rawTexts(doc)]) for (const m of t.matchAll(BIBLIOGRAPHY_RE)) add(m[1])
  if (!files.length) return null
  let style: string | null = null
  for (const t of [pre, ...rawTexts(doc)]) { const m = STYLE_RE.exec(t); if (m) { style = m[1].trim(); break } }
  return { files, style, biblatex }
}

// The document once its .bib files are in its library: the reference
// library is the document's own, and the LaTeX that named the files is
// taken out (BibTeX) or pointed at the library (biblatex).
export function adoptLibrary(doc: Document, bib: TexBibliography): Document {
  const strip = (t: string) => t.replace(BIBLIOGRAPHY_RE, '').replace(new RegExp(STYLE_RE.source, 'g'), '')
  let pre = doc.meta.preamble_extras ?? ''
  let children = doc.children
  if (bib.biblatex) {
    let first = true
    pre = pre.replace(/\\addbibresource(\[[^\]]*\])?\{[^}]*\}[ \t]*\n?/g, () => {
      if (!first) return ''
      first = false
      return `\\addbibresource{${LIB}.bib}\n`
    })
  } else {
    pre = strip(pre)
    children = children.flatMap(b => {
      if (b.type === 'RawLatex') {
        if (!NAMES_BIB(b.text)) return [b]
        const rest = strip(b.text).replace(/\n{3,}/g, '\n\n').trim()
        return rest ? [{ ...b, text: rest }] : []
      }
      const kids = (b as { children?: Kid[] }).children
      if (!Array.isArray(kids)) return [b]
      const left = dropInline(kids)
      // A paragraph left with only spaces goes.
      if (b.type === 'Paragraph' && left.every(k => k.type === 'Text' && !String((k as { text?: string }).text ?? '').trim())) return []
      return [{ ...b, children: left } as Block]
    })
  }
  const meta = { ...doc.meta, preamble_extras: pre.replace(/\n{3,}/g, '\n\n'), ref_library: DOCUMENT_LIBRARY }
  if (bib.style && !bib.biblatex) meta.bib_style = bib.style === 'plainnat' ? '' : bib.style
  return { ...doc, meta, children }
}
