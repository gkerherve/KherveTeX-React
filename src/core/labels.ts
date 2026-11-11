// Every label the document defines, in order, with what it names and the
// number a \ref prints (ReferenceResolver's numbering): the list the
// Cross-reference dialog offers. Labels inside raw LaTeX blocks (figure*,
// table*, a line of an align) are listed too, without a number.
import type { Block, Document, Inline } from './model.ts'
import { ReferenceResolver, _walk } from './references.ts'

export type LabelKind = 'section' | 'figure' | 'table' | 'equation' | 'other'

export interface LabelEntry {
  label: string
  kind: LabelKind
  // What \ref prints: "2", "3.1"; '' when only LaTeX knows.
  number: string
  // A short description: the heading, caption or equation.
  text: string
}

function plain(nodes: Inline[] | undefined): string {
  return (nodes ?? []).map(n => n.type === 'Text' ? n.text : n.type === 'MathInline' ? n.latex
    : 'children' in n ? plain(n.children) : '').join('')
}

const short = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const RAW_LABEL_RE = /\\label\{([^}]+)\}/g

export function documentLabels(doc: Document): LabelEntry[] {
  const numbers = new ReferenceResolver(doc).labels
  const out: LabelEntry[] = []
  const seen = new Set<string>()
  const add = (label: string | null | undefined, kind: LabelKind, text: string) => {
    if (!label || seen.has(label)) return
    seen.add(label)
    out.push({ label, kind, number: numbers.get(label) ?? '', text: short(text) })
  }
  for (const node of _walk(doc)) {
    const b = node as unknown as Block & { label?: string | null; caption?: Inline[] | string }
    const caption = typeof b.caption === 'string' ? b.caption : plain(b.caption as Inline[] | undefined)
    switch (b.type) {
      case 'Section': add(b.label, 'section', plain(b.children)); break
      case 'Figure': add(b.label, 'figure', caption); break
      case 'Table': add(b.label, 'table', caption); break
      case 'MathBlock': add(b.label, 'equation', b.latex); break
      case 'RawLatex': {
        const kind: LabelKind = /\\begin\{figure/.test(b.text) ? 'figure' : /\\begin\{table/.test(b.text) ? 'table'
          : /\\begin\{(equation|align|gather|multline)/.test(b.text) ? 'equation' : 'other'
        for (const m of b.text.matchAll(RAW_LABEL_RE)) add(m[1], kind, b.text)
      }
    }
  }
  return out
}

// The \ref command that suits a label: \eqref for equations.
export function refKindFor(kind: LabelKind): 'ref' | 'eqref' {
  return kind === 'equation' ? 'eqref' : 'ref'
}

// ---- what can be referred to (the Cross-reference list, Captions & labels) ----

// A figure, table, numbered equation or numbered heading of the document,
// labelled or not: `index` is its place among the document's blocks.
export interface Referable {
  index: number
  kind: LabelKind
  // The number it prints ("2", "3.1").
  number: string
  text: string
  label: string | null
  // A figure's or table's caption (LaTeX), null for what has none.
  caption: string | null
}

const TMP = '__kt_ref_'

// Every figure, table, numbered equation and numbered heading, in order,
// with the number it prints whether it has a label or not (numbered as
// ReferenceResolver numbers labels, each unlabelled one given a stand-in).
export function referables(doc: Document): Referable[] {
  const clone = structuredClone(doc)
  const picked: { index: number; kind: LabelKind }[] = []
  clone.children.forEach((b, index) => {
    let kind: LabelKind | null = null
    if (b.type === 'Figure') kind = 'figure'
    else if (b.type === 'Table') kind = 'table'
    else if (b.type === 'MathBlock' && b.numbered) kind = 'equation'
    else if (b.type === 'Section' && b.numbered && plain(b.children).trim()) kind = 'section'
    if (!kind) return
    const lb = b as Block & { label?: string | null }
    if (!lb.label) lb.label = `${TMP}${index}`
    picked.push({ index, kind })
  })
  const numbers = new ReferenceResolver(clone).labels
  return picked.map(({ index, kind }) => {
    const b = doc.children[index] as Block & { label?: string | null; caption?: string }
    const own = b.label || null
    const tmp = (clone.children[index] as Block & { label?: string | null }).label!
    const text = b.type === 'Section' ? plain(b.children) : b.type === 'MathBlock' ? b.latex
      : (b.caption ?? '')
    return {
      index, kind, number: numbers.get(tmp) ?? '', text: short(text), label: own,
      caption: b.type === 'Figure' || b.type === 'Table' ? (b.caption ?? '') : null,
    }
  })
}

const PREFIX: Record<LabelKind, string> = { figure: 'fig', table: 'tab', equation: 'eq', section: 'sec', other: 'ref' }

// A label for an item that has none, as LaTeX authors write them: the
// kind and a few words of its caption or heading ("fig:decay-curve"), a
// number added when that is taken.
export function makeLabel(kind: LabelKind, text: string, taken: Set<string>): string {
  const words = text.replace(/\\[a-zA-Z]+|[{}$^_]/g, ' ').normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
    .toLowerCase().match(/[a-z0-9]+/g) ?? []
  const stop = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'and', 'for', 'to', 'with'])
  const slug = words.filter(w => !stop.has(w)).slice(0, 3).join('-')
  const base = `${PREFIX[kind]}:${slug || (kind === 'equation' ? 'eq' : kind)}`
  let label = base
  for (let n = 2; taken.has(label); n++) label = `${base}-${n}`
  return label
}

// Every label the document uses (to keep new ones unique).
export function takenLabels(doc: Document): Set<string> {
  return new Set(documentLabels(doc).map(l => l.label))
}
