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
