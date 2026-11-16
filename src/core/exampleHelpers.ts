// Compact constructors shared by the example document modules — a port of
// khervedoc/example_helpers.py — and the model's dataclass constructors
// with Python's keyword arguments (Section({ level: 2, children })), which
// is how the example modules (src/core/exampleDocs/, translated from
// khervedoc/example_docs by scripts/port_examples.py) build documents.
import * as M from './model.ts'

export { DEFAULT_PACKAGES } from './model.ts'

// Keyword arguments as Python takes them: any value, checked by the model.
type Kw<T> = { [K in Exclude<keyof T, 'type'>]?: any }

export const Text = (o: Kw<M.Text> = {}) => M.text(o.text, o.marks ?? [])
export const MathInline = (o: Kw<M.MathInline> = {}) => M.mathInline(o.latex)
export const Link = (o: Kw<M.Link> = {}) => M.link(o.url, o.children ?? [])
export const Footnote = (o: Kw<M.Footnote> = {}) => M.footnote(o.children ?? [])
export const Citation = (o: Kw<M.Citation> = {}) => M.citation(o.keys ?? [], o.style ?? 'cite')
export const CrossRef = (o: Kw<M.CrossRef> = {}) => M.crossRef(o.label ?? '', o.kind ?? 'ref')
export const InlineRaw = (o: Kw<M.InlineRaw> = {}) => M.inlineRaw(o.latex ?? '')
export const Highlight = (o: Kw<M.Highlight> = {}) => M.highlight(o.children ?? [], o.color ?? 'yellow')
export const Comment = (o: Kw<M.Comment> = {}) => M.comment(o.children ?? [], o)
export const Paragraph = (o: Kw<M.Paragraph> = {}) => M.paragraph(o.children ?? [], o.alignment ?? 'justify')
export const Section = (o: Kw<M.Section> = {}) =>
  M.section(o.level ?? 1, o.children ?? [], o.numbered ?? true, o.label ?? null)
export const MathBlock = (o: Kw<M.MathBlock> = {}) => M.mathBlock(o.latex, o.numbered ?? false, o.label ?? null)
export const ListItem = (o: Kw<M.ListItem> = {}) => M.listItem(o.children ?? [])
export const ListNode = (o: Kw<M.List> = {}) => M.list(o.ordered ?? false, o.items ?? [])
export const List = ListNode
export const Figure = (o: Kw<M.Figure> = {}) => M.figure(o)
export const Table = (o: Kw<M.Table> = {}) => M.table(o)
export const RawLatex = (o: Kw<M.RawLatex> = {}) => M.rawLatex(o.text)
export const Title = (o: Kw<M.Title> = {}) => M.title(o.children ?? [])
export const Author = (o: Kw<M.Author> = {}) => M.author(o.children ?? [])
export const Affiliation = (o: Kw<M.Affiliation> = {}) => M.affiliation(o.children ?? [])
export const Correspondence = (o: Kw<M.Correspondence> = {}) => M.correspondence(o.children ?? [])
export const Abstract = (o: Kw<M.Abstract> = {}) => M.abstract(o.children ?? [])
export const Keywords = (o: Kw<M.Keywords> = {}) => M.keywords(o.children ?? [])
export const Frame = (o: Kw<M.Frame> = {}) => M.frame(o.children ?? [])
export const Box = (o: Kw<M.Box> = {}) => M.box(o.children ?? [])
export const Theorem = (o: Kw<M.Theorem> = {}) =>
  M.theorem(o.kind ?? 'theorem', o.title ?? '', o.children ?? [], o.start ?? true)
export const Document = (o: Kw<M.Document> = {}) => M.document(o.children ?? [], o.meta ?? M.docMeta())
export const DocMeta = (o: Kw<M.DocMeta> = {}) => M.docMeta(o)

// Build a DocMeta with the KherveTeX defaults and let callers tweak
// a few fields. Avoids each example repeating the same boilerplate.
export function _meta(overrides: Record<string, unknown> = {}): M.DocMeta {
  const base = M.docMeta({
    title: '', author: '',
    body_font_pt: 11,
    line_spacing: 1.15,
    paragraph_indent: false,
  })
  for (const [k, v] of Object.entries(overrides)) (base as unknown as Record<string, unknown>)[k] = v
  return base
}

// A run of _p(): plain text, (text, marks) or an inline node.
export type Run = string | [string, string[]] | M.Inline

// Compact constructor: _p('hello ', ['world', ['bold']], '.')
export function _p(...runs: any[]): M.Paragraph {
  const children: M.Inline[] = []
  for (const r of runs) {
    if (typeof r === 'string') {
      children.push(Text({ text: r }))
    } else if (Array.isArray(r) && r.length === 2 && typeof r[0] === 'string') {
      children.push(Text({ text: r[0], marks: [...r[1]] }))
    } else {
      children.push(r)
    }
  }
  return M.paragraph(children)
}

export function _items(...labels: string[]): M.List {
  return M.list(false, labels.map((s) => M.listItem([Text({ text: s })])))
}

export function _ordItems(...labels: string[]): M.List {
  return M.list(true, labels.map((s) => M.listItem([Text({ text: s })])))
}
