// Document model — the single source of truth. A port of khervedoc/model.py:
// same node types, same field names and the same field order, so
// document.json written here is byte-identical to the Python app's.

import type { Design } from './design.ts'
import type { InkStroke } from './ink.ts'
import { pyFloatOf, pyInt, pyJson, pyStr, strip, truthy } from './py.ts'

export type Mark = 'bold' | 'italic' | 'underline' | 'code' | 'smallcaps'
  | 'subscript' | 'superscript' | 'strikethrough'
  // Word's Font group, a mark with its value: font colour (hex), size in
  // pt, font family, underline style (double, wave, dotted, dashed).
  | `color:${string}` | `size:${string}` | `font:${string}` | `uline:${string}`
  // Track Changes: inserted / deleted text, 'ins:<author, URI-encoded>|<time>'.
  | `ins:${string}` | `del:${string}`

// ---------------- Inline nodes ----------------

export interface Text { text: string; marks: Mark[]; type: 'Text' }
export interface MathInline { latex: string; type: 'MathInline' }
export interface Link { url: string; children: Inline[]; type: 'Link' }
export interface Footnote { children: Inline[]; type: 'Footnote' }
export interface Citation { keys: string[]; style: 'cite' | 'citep' | 'citet'; type: 'Citation' }
export interface CrossRef { label: string; kind: 'ref' | 'eqref' | 'pageref'; type: 'CrossRef' }
// Verbatim LaTeX inline: unknown macros survive a round-trip this way.
export interface InlineRaw { latex: string; type: 'InlineRaw' }
export interface Highlight { children: Inline[]; color: string; type: 'Highlight' }
export interface Comment {
  children: Inline[]; note: string; author: string; timestamp: string
  resolved: boolean; type: 'Comment'
}

export type Inline = Text | MathInline | Link | Footnote | Citation | CrossRef
  | InlineRaw | Highlight | Comment

// Preset highlight colours used by the colour picker and the \definecolor
// preamble injection.
export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#FFFF00',
  green: '#90EE90',
  blue: '#ADD8E6',
  pink: '#FFB6C1',
  orange: '#FFD700',
}

// ---------------- Block nodes ----------------

export type Alignment = 'left' | 'center' | 'right' | 'justify'

// Word's paragraph formatting, each stored only when set (so a plain
// paragraph's JSON stays the Python app's): left and right indent (cm),
// space before and after (pt), line spacing (1.15, 1.5...), shading
// colour, borders.
export type ParaBorder = 'box' | 'top' | 'bottom' | 'topbottom'
export interface Paragraph {
  children: Inline[]; alignment: Alignment; type: 'Paragraph'
  left_cm?: number; right_cm?: number; before_pt?: number; after_pt?: number
  spacing?: number; shade?: string; border?: ParaBorder
}
export interface Section {
  level: number; children: Inline[]; numbered: boolean; label: string | null; type: 'Section'
}
export interface MathBlock { latex: string; numbered: boolean; label: string | null; type: 'MathBlock' }
// A list item's depth (0 = top; stored only when nested).
export interface ListItem { children: Inline[]; type: 'ListItem'; level?: number }
// style: a bullet ('disc', 'circle', 'square', 'dash', 'arrow', 'check')
// or a numbering ('arabic', 'paren', 'alpha', 'Alpha', 'roman', 'Roman',
// 'legal' = 1. 1.1. 1.1.1.); absent = LaTeX's default.
export interface List { ordered: boolean; items: ListItem[]; type: 'List'; style?: string }
// More pictures shown beside a figure's main one, in one row, under one
// caption and label. Each is sized by `height` (3.4cm) or, without one,
// by `width` (0.3\textwidth).
export interface FigureImage { path: string; height?: string; width?: string }
export interface Figure {
  path: string; caption: string; label: string | null; width: string
  // Height of the main picture in a row (replaces `width`); left out when
  // the figure has one picture sized by `width`. Both fields are only
  // present when set, so ordinary figures keep their JSON.
  height?: string
  extra?: FigureImage[]
  // "drawing": `path` is the PNG preview beside .svg and .pdf siblings.
  // "flowchart": `path` is the PNG preview beside .pdf, .flow.json, .tikz.
  // "chart": `path` is the PNG preview beside .pdf and .chart.json.
  source: string
  align: string
  type: 'Figure'
}
export interface Table {
  rows: string[][]; caption: string; label: string | null
  alignment: string  // e.g. "lcr"; empty = auto
  // "" (\hline), "booktabs", "grid", "plain" or "striped".
  style: string
  // [row, col, rowspan, colspan] of each merged block's top-left cell.
  merges: number[][]
  header: boolean; repeat_header: boolean
  shading: Record<string, string>  // "row,col" -> "#rrggbb"
  // The table's text size in points (Font size on a selection holding the
  // table); absent = the body size.
  font_size?: number
  type: 'Table'
}
export interface RawLatex { text: string; type: 'RawLatex' }
export interface Title { children: Inline[]; type: 'Title' }
export interface Author { children: Inline[]; type: 'Author' }
export interface Affiliation { children: Inline[]; type: 'Affiliation' }
export interface Correspondence { children: Inline[]; type: 'Correspondence' }
export interface Abstract { children: Inline[]; type: 'Abstract' }
export interface Keywords { children: Inline[]; type: 'Keywords' }
export interface Frame { children: Inline[]; type: 'Frame' }
// A framed paragraph: \fbox{\parbox{0.95\linewidth}{...}} in the PDF, a bordered
// paragraph in Word. It holds one paragraph of inlines.
export interface Box { children: Inline[]; type: 'Box' }
// One paragraph of a theorem-like environment; start=false continues the
// previous one of the same kind.
export interface Theorem { kind: string; title: string; children: Inline[]; start: boolean; type: 'Theorem' }

export type Block = Paragraph | Section | MathBlock | List | Figure | Table | RawLatex
  | Title | Author | Affiliation | Correspondence | Abstract | Keywords | Frame | Theorem | Box

export const THEOREM_KINDS: Record<string, string> = {
  theorem: 'Theorem', lemma: 'Lemma', proposition: 'Proposition',
  corollary: 'Corollary', definition: 'Definition',
  example: 'Example', remark: 'Remark', proof: 'Proof',
}

// Coloured callout boxes (a titled tcolorbox), stored as Theorem paragraphs
// so they share its grouping: kind is the key here, title replaces the
// box's default heading. env is the LaTeX environment the PDF uses.
export const CALLOUT_KINDS: Record<string, { name: string; color: string; env: string }> = {
  note: { name: 'Note', color: '1F6FB5', env: 'kNoteBox' },
  tip: { name: 'Tip', color: '2E7D32', env: 'kTipBox' },
  info: { name: 'Information', color: '00838F', env: 'kInfoBox' },
  important: { name: 'Important', color: '6A1B9A', env: 'kImportantBox' },
  warning: { name: 'Warning', color: 'E65100', env: 'kWarningBox' },
  danger: { name: 'Danger', color: 'C62828', env: 'kDangerBox' },
  summary: { name: 'Key points', color: '37474F', env: 'kSummaryBox' },
}
export const isCallout = (kind: string): boolean => Object.prototype.hasOwnProperty.call(CALLOUT_KINDS, kind)

// ---------------- Constructors (dataclass defaults, field order) ----------------

export const text = (t: string, marks: Mark[] = []): Text => ({ text: t, marks: [...marks], type: 'Text' })
export const mathInline = (latex: string): MathInline => ({ latex, type: 'MathInline' })
export const link = (url: string, children: Inline[] = []): Link => ({ url, children, type: 'Link' })
export const footnote = (children: Inline[] = []): Footnote => ({ children, type: 'Footnote' })
export const citation = (keys: string[] = [], style: Citation['style'] = 'cite'): Citation =>
  ({ keys, style, type: 'Citation' })
export const crossRef = (label = '', kind: CrossRef['kind'] = 'ref'): CrossRef => ({ label, kind, type: 'CrossRef' })
export const inlineRaw = (latex = ''): InlineRaw => ({ latex, type: 'InlineRaw' })
export const highlight = (children: Inline[] = [], color = 'yellow'): Highlight =>
  ({ children, color, type: 'Highlight' })
export const comment = (children: Inline[] = [], o: Partial<Omit<Comment, 'children' | 'type'>> = {}): Comment => ({
  children, note: o.note ?? '', author: o.author ?? '', timestamp: o.timestamp ?? '',
  resolved: o.resolved ?? false, type: 'Comment',
})

export const paragraph = (children: Inline[] = [], alignment: Alignment = 'justify'): Paragraph =>
  ({ children, alignment, type: 'Paragraph' })
export const section = (level = 1, children: Inline[] = [], numbered = true, label: string | null = null): Section =>
  ({ level, children, numbered, label, type: 'Section' })
export const mathBlock = (latex: string, numbered = false, label: string | null = null): MathBlock =>
  ({ latex, numbered, label, type: 'MathBlock' })
export const listItem = (children: Inline[] = [], level = 0): ListItem =>
  (level > 0 ? { children, type: 'ListItem', level } : { children, type: 'ListItem' })
export const list = (ordered = false, items: ListItem[] = [], style = ''): List =>
  (style ? { ordered, items, type: 'List', style } : { ordered, items, type: 'List' })

// A paragraph with Word's formatting; the fields left out when unset.
export interface ParaFormat {
  left_cm?: number | null; right_cm?: number | null; before_pt?: number | null; after_pt?: number | null
  spacing?: number | null; shade?: string | null; border?: ParaBorder | null
}
export function paraFormat(p: Paragraph, f: ParaFormat): Paragraph {
  const out: Paragraph = { children: p.children, alignment: p.alignment, type: 'Paragraph' }
  for (const k of ['left_cm', 'right_cm', 'before_pt', 'after_pt'] as const) {
    const v = f[k]
    if (typeof v === 'number' && Math.abs(v) > 0.001) out[k] = Math.round(v * 100) / 100
  }
  if (f.spacing && Math.abs(f.spacing - 1) > 0.001) out.spacing = f.spacing
  if (f.shade) out.shade = f.shade
  if (f.border) out.border = f.border
  return out
}
export const figure = (o: Partial<Omit<Figure, 'type'>> = {}): Figure => ({
  path: o.path ?? '', caption: o.caption ?? '', label: o.label ?? null,
  width: o.width ?? '0.8\\textwidth', source: o.source ?? '', align: o.align ?? 'center',
  ...(o.height ? { height: o.height } : {}),
  ...(o.extra && o.extra.length ? { extra: o.extra } : {}),
  type: 'Figure',
})
export const table = (o: Partial<Omit<Table, 'type'>> = {}): Table => ({
  rows: o.rows ?? [], caption: o.caption ?? '', label: o.label ?? null,
  alignment: o.alignment ?? '', style: o.style ?? '', merges: o.merges ?? [],
  header: o.header ?? false, repeat_header: o.repeat_header ?? false,
  shading: o.shading ?? {},
  ...(o.font_size ? { font_size: o.font_size } : {}),
  type: 'Table',
})
export const rawLatex = (t: string): RawLatex => ({ text: t, type: 'RawLatex' })
export const title = (children: Inline[] = []): Title => ({ children, type: 'Title' })
export const author = (children: Inline[] = []): Author => ({ children, type: 'Author' })
export const affiliation = (children: Inline[] = []): Affiliation => ({ children, type: 'Affiliation' })
export const correspondence = (children: Inline[] = []): Correspondence => ({ children, type: 'Correspondence' })
export const abstract = (children: Inline[] = []): Abstract => ({ children, type: 'Abstract' })
export const keywords = (children: Inline[] = []): Keywords => ({ children, type: 'Keywords' })
export const frame = (children: Inline[] = []): Frame => ({ children, type: 'Frame' })
export const box = (children: Inline[] = []): Box => ({ children, type: 'Box' })
export const theorem = (kind = 'theorem', t = '', children: Inline[] = [], start = true): Theorem =>
  ({ kind, title: t, children, start, type: 'Theorem' })

// ---------------- Project (multi-chapter) ----------------

export const CHAPTER_TYPES = ['frontmatter', 'chapter', 'appendix', 'backmatter', 'section']

export interface ChapterEntry {
  path: string
  label: string
  enabled: boolean
  start_page: number | null       // null = continue from previous
  last_known_pages: number
  numbering: 'arabic' | 'roman'
  chapter_type: string            // one of CHAPTER_TYPES
  chapter_number: number | null   // null = auto from position
}

export const chapterEntry = (o: Partial<ChapterEntry> = {}): ChapterEntry => ({
  path: o.path ?? '', label: o.label ?? '', enabled: o.enabled ?? true,
  start_page: o.start_page ?? null, last_known_pages: o.last_known_pages ?? 0,
  numbering: o.numbering ?? 'arabic', chapter_type: o.chapter_type ?? 'chapter',
  chapter_number: o.chapter_number ?? null,
})

export interface Project {
  meta: DocMeta
  chapters: ChapterEntry[]
  bibliography: string
  bib_style: string
  auto_page_numbers: boolean
  type: 'Project'
}

export const project = (o: Partial<Omit<Project, 'type'>> = {}): Project => ({
  meta: o.meta ?? docMeta({ documentclass: 'book' }),
  chapters: o.chapters ?? [], bibliography: o.bibliography ?? '',
  bib_style: o.bib_style ?? '', auto_page_numbers: o.auto_page_numbers ?? true,
  type: 'Project',
})

// ---------------- Metadata + document ----------------

// amssymb provides \square, the equation builder's placeholder slot.
export const DEFAULT_PACKAGES = ['amsmath', 'amssymb', 'graphicx', 'multicol', 'float']

// Layout / Insert ▸ Header & Footer, as Word's: each text is up to three
// parts split by a tab (left, centre, right, Word's tab stops) with fields
// {PAGE}, {NUMPAGES}, {DATE}, {TITLE}, {AUTHOR} and {PICTURE:path}.
export interface HeaderFooter {
  header?: string
  footer?: string
  // Different First Page: the first page's own (empty = none there).
  different_first?: boolean
  first_header?: string
  first_footer?: string
  // Different Odd & Even Pages: the even pages' own.
  odd_even?: boolean
  even_header?: string
  even_footer?: string
  // Header from Top / Footer from Bottom (cm, from the paper's edge).
  header_cm?: number
  footer_cm?: number
}
// Where the header and footer stand (cm from the paper's edges): Header
// from Top / Footer from Bottom, moved towards the edge when the margin is
// too small to hold them clear of the text (Narrow: 1.27 cm), so they never
// run into it. The header's line is 14 pt high and kept 0.25 cm above the
// text; the footer's baseline 0.55 cm below it.
export function hfPlacement(m: Pick<DocMeta, 'margin_top_cm' | 'margin_bottom_cm' | 'header_footer'>): { header_cm: number; footer_cm: number } {
  const hf = m.header_footer ?? {}
  const head = 14 / 72 * 2.54
  const clamp = (v: number) => Math.max(0.3, Math.round(v * 1000) / 1000)
  return {
    header_cm: clamp(Math.min(hf.header_cm ?? 1.25, m.margin_top_cm - head - 0.25)),
    footer_cm: clamp(Math.min(hf.footer_cm ?? 1.25, m.margin_bottom_cm - 0.55)),
  }
}

export const HF_FIELDS = ['PAGE', 'NUMPAGES', 'DATE', 'TITLE', 'AUTHOR'] as const
// {PAGE}, {PICTURE:images/logo.png}...
export const HF_FIELD_RE = /\{(PAGE|NUMPAGES|DATE|TITLE|AUTHOR|PICTURE:[^{}]+)\}/g

export interface DocMeta {
  title: string
  author: string
  documentclass: string
  // Verbatim \documentclass[...] options; empty = built from the fields.
  class_options: string
  packages: string[]
  page_size: string
  margin_top_cm: number
  margin_bottom_cm: number
  margin_left_cm: number
  margin_right_cm: number
  body_font_pt: number
  body_font_family: string
  // Visual-editor display font only; does not reach the LaTeX.
  visual_font_family: string
  line_spacing: number
  paragraph_indent: boolean
  // 1, 2 (twocolumn class option) or 3+ (body wrapped in multicols).
  column_count: number
  frontmatter_extras: string
  preamble_extras: string
  // KherveRef library this document cites from (its folder).
  ref_library: string
  bib_style: string
  // \\maketitle prints the date (\\today); off writes \\date{}.
  // Stored only when off, so files stay the Python app's byte for byte.
  show_date?: boolean
  // dateFormat.ts key; absent = the class's \\today.
  date_format?: string
  // Review ▸ Track Changes on, and the markup shown (absent = All Markup);
  // stored only when set.
  track_changes?: boolean
  markup?: 'simple' | 'none' | 'original'
  // Pages turned sideways (geometry's landscape). Stored only when on.
  landscape?: boolean
  // Layout ▸ Margins ▸ Mirrored: left / right are the inside / outside
  // margins, alternating on facing pages. Stored only when on.
  mirror_margins?: boolean
  // Layout ▸ Line Numbers (lineno): numbers in the margin, counted through
  // the document, from 1 on each page or from 1 at each section. Stored
  // only when on.
  line_numbers?: 'continuous' | 'page' | 'section'
  // The headers and footers set in the page (Header & Footer tab); absent =
  // the class's own (a page number).
  header_footer?: HeaderFooter
  // Layout ▸ Hyphenation ▸ None: words are not broken at line ends.
  // Stored only when off.
  hyphenation?: false
  // The Design tab (design.ts); stored only when set.
  design?: Design
  // Draw tab: pen strokes on the pages (ink.ts); stored only when any.
  ink?: InkStroke[]
}

// Python stores these as floats: JSON and f-strings print "2.0", not "2".
export const FLOAT_FIELDS: ReadonlySet<string> = new Set([
  'margin_top_cm', 'margin_bottom_cm', 'margin_left_cm', 'margin_right_cm', 'line_spacing',
])

export const docMeta = (o: Partial<DocMeta> = {}): DocMeta => ({
  title: o.title ?? 'Untitled',
  author: o.author ?? '',
  documentclass: o.documentclass ?? 'article',
  class_options: o.class_options ?? '',
  packages: o.packages ?? [...DEFAULT_PACKAGES],
  page_size: o.page_size ?? 'A4',
  margin_top_cm: o.margin_top_cm ?? 2.5,
  margin_bottom_cm: o.margin_bottom_cm ?? 2.5,
  margin_left_cm: o.margin_left_cm ?? 2.5,
  margin_right_cm: o.margin_right_cm ?? 2.5,
  body_font_pt: o.body_font_pt ?? 12,
  body_font_family: o.body_font_family ?? 'default',
  visual_font_family: o.visual_font_family ?? 'Georgia',
  line_spacing: o.line_spacing ?? 1.0,
  paragraph_indent: o.paragraph_indent ?? true,
  column_count: o.column_count ?? 1,
  frontmatter_extras: o.frontmatter_extras ?? '',
  preamble_extras: o.preamble_extras ?? '',
  ref_library: o.ref_library ?? '',
  bib_style: o.bib_style ?? 'plainnat',
  ...(o.show_date === false ? { show_date: false } : {}),
  ...(o.landscape ? { landscape: true } : {}),
  ...(o.mirror_margins ? { mirror_margins: true } : {}),
  ...(o.line_numbers ? { line_numbers: o.line_numbers } : {}),
  ...(o.hyphenation === false ? { hyphenation: false } : {}),
  ...(o.header_footer ? { header_footer: { ...o.header_footer } } : {}),
  ...(o.design && Object.keys(o.design).length ? { design: { ...o.design } } : {}),
  ...(o.ink && o.ink.length ? { ink: o.ink.map(s => ({ ...s, pts: [...s.pts] })) } : {}),
  ...(o.track_changes ? { track_changes: true } : {}),
  ...(o.markup ? { markup: o.markup } : {}),
  ...(o.date_format ? { date_format: o.date_format } : {}),
})

export interface Document { children: Block[]; meta: DocMeta; type: 'Document' }

export const document = (children: Block[] = [], meta: DocMeta = docMeta()): Document =>
  ({ children, meta, type: 'Document' })

// ---------------- JSON serialisation ----------------

export function toJson(doc: Document): string {
  return pyJson(doc, FLOAT_FIELDS)
}

export function fromJson(s: string): Document {
  return buildDocument(JSON.parse(s))
}

type Json = Record<string, unknown>
const get = <T>(d: Json, k: string, fallback: T): T => (k in d ? (d[k] as T) : fallback)

function buildInline(d: Json): Inline {
  const t = d.type
  switch (t) {
    case 'Text': {
      if (!('text' in d)) throw new Error("KeyError: 'text'")
      return text(d.text as string, [...get<Mark[]>(d, 'marks', [])])
    }
    case 'MathInline': {
      if (!('latex' in d)) throw new Error("KeyError: 'latex'")
      return mathInline(d.latex as string)
    }
    case 'Link': return link(get(d, 'url', ''), buildInlines(get(d, 'children', [])))
    case 'Footnote': return footnote(buildInlines(get(d, 'children', [])))
    case 'Citation': return citation([...get<string[]>(d, 'keys', [])], get(d, 'style', 'cite'))
    case 'CrossRef': return crossRef(get(d, 'label', ''), get(d, 'kind', 'ref'))
    case 'InlineRaw': return inlineRaw(get(d, 'latex', ''))
    case 'Highlight': return highlight(buildInlines(get(d, 'children', [])), get(d, 'color', 'yellow'))
    case 'Comment': return comment(buildInlines(get(d, 'children', [])), {
      note: get(d, 'note', ''), author: get(d, 'author', ''),
      timestamp: get(d, 'timestamp', ''), resolved: get(d, 'resolved', false),
    })
  }
  throw new Error(`Unknown inline node type: ${JSON.stringify(t)}`)
}

function buildInlines(items: Json[]): Inline[] {
  return items.map(buildInline)
}

function buildBlock(d: Json): Block {
  const t = d.type
  const kids = () => buildInlines(get(d, 'children', []))
  switch (t) {
    // The dataclass default is "justify" but a stored paragraph without an
    // alignment has always loaded as "left".
    case 'Paragraph': return paraFormat(paragraph(kids(), get(d, 'alignment', 'left')), {
      left_cm: get(d, 'left_cm', null), right_cm: get(d, 'right_cm', null), before_pt: get(d, 'before_pt', null),
      after_pt: get(d, 'after_pt', null), spacing: get(d, 'spacing', null), shade: get(d, 'shade', null), border: get(d, 'border', null),
    })
    case 'Section': return section(get(d, 'level', 1), kids(), get(d, 'numbered', true), get(d, 'label', null))
    case 'MathBlock': {
      if (!('latex' in d)) throw new Error("KeyError: 'latex'")
      return mathBlock(d.latex as string, get(d, 'numbered', false), get(d, 'label', null))
    }
    case 'List': return list(get(d, 'ordered', false),
      get<Json[]>(d, 'items', []).map((it) => listItem(buildInlines(get(it, 'children', [])), get(it, 'level', 0))),
      get(d, 'style', ''))
    case 'Figure': return figure({
      path: get(d, 'path', ''), caption: get(d, 'caption', ''), label: get(d, 'label', null),
      width: get(d, 'width', '0.8\\textwidth'), source: get(d, 'source', ''), align: get(d, 'align', 'center'),
      height: get(d, 'height', ''), extra: get<FigureImage[]>(d, 'extra', []),
    })
    case 'Table': return table({
      rows: get<unknown[][]>(d, 'rows', []).map((row) => row.map((c) => pyStr(c))),
      caption: get(d, 'caption', ''), label: get(d, 'label', null),
      alignment: get(d, 'alignment', ''), style: get(d, 'style', ''),
      merges: get<unknown[][]>(d, 'merges', []).map((m) => m.map((v) => pyInt(v, 0))),
      header: get(d, 'header', false), repeat_header: get(d, 'repeat_header', false),
      shading: Object.fromEntries(Object.entries(get<Json>(d, 'shading', {})).map(([k, v]) => [pyStr(k), pyStr(v)])),
      font_size: Number(get(d, 'font_size', 0)) || undefined,
    })
    case 'RawLatex': {
      if (!('text' in d)) throw new Error("KeyError: 'text'")
      return rawLatex(d.text as string)
    }
    case 'Title': return title(kids())
    case 'Author': return author(kids())
    case 'Affiliation': return affiliation(kids())
    case 'Correspondence': return correspondence(kids())
    case 'Abstract': return abstract(kids())
    case 'Keywords': return keywords(kids())
    case 'Frame': return frame(kids())
    case 'Box': return box(kids())
    case 'Theorem': return theorem(get(d, 'kind', 'theorem'), get(d, 'title', ''), kids(), get(d, 'start', true))
  }
  throw new Error(`Unknown block node type: ${JSON.stringify(t)}`)
}

// The meta fields both loaders read. visual_font_family is not among them:
// the Python loader has never restored it, so it falls back to Georgia.
function buildMeta(m: Json, defaultClass: string, withRefs: boolean): DocMeta {
  return docMeta({
    title: get(m, 'title', 'Untitled'),
    author: get(m, 'author', ''),
    documentclass: get(m, 'documentclass', defaultClass),
    class_options: pyStr(get(m, 'class_options', '')),
    packages: [...get<string[]>(m, 'packages', [...DEFAULT_PACKAGES])],
    page_size: get(m, 'page_size', 'A4'),
    margin_top_cm: pyFloatOf(m.margin_top_cm, 2.5),
    margin_bottom_cm: pyFloatOf(m.margin_bottom_cm, 2.5),
    margin_left_cm: pyFloatOf(m.margin_left_cm, 2.5),
    margin_right_cm: pyFloatOf(m.margin_right_cm, 2.5),
    body_font_pt: pyInt(m.body_font_pt, 12),
    body_font_family: pyStr(get(m, 'body_font_family', 'default')),
    line_spacing: pyFloatOf(m.line_spacing, 1.0),
    paragraph_indent: truthy(get(m, 'paragraph_indent', true)),
    // v0.17 stored a boolean `two_column`; v0.18+ stores column_count.
    column_count: pyInt(m.column_count, truthy(get(m, 'two_column', false)) ? 2 : 1),
    frontmatter_extras: pyStr(get(m, 'frontmatter_extras', '')),
    preamble_extras: pyStr(get(m, 'preamble_extras', '')),
    ...(truthy(get(m, 'show_date', true)) ? {} : { show_date: false }),
    ...(truthy(get(m, 'landscape', false)) ? { landscape: true } : {}),
    ...(truthy(get(m, 'mirror_margins', false)) ? { mirror_margins: true } : {}),
    ...(['continuous', 'page', 'section'].includes(get(m, 'line_numbers', '')) ? { line_numbers: get(m, 'line_numbers', '') as 'page' } : {}),
    ...(get<unknown>(m, 'hyphenation', true) === false ? { hyphenation: false as const } : {}),
    ...(get(m, 'header_footer', null) && typeof get(m, 'header_footer', null) === 'object' ? { header_footer: { ...get<HeaderFooter>(m, 'header_footer', {}) } } : {}),
    ...(get(m, 'design', null) && typeof get(m, 'design', null) === 'object' ? { design: { ...get<Design>(m, 'design', {}) } } : {}),
    ...(Array.isArray(get(m, 'ink', null)) && get<InkStroke[]>(m, 'ink', []).length ? { ink: get<InkStroke[]>(m, 'ink', []).map(s => ({ ...s, pts: [...s.pts] })) } : {}),
    ...(truthy(get(m, 'track_changes', false)) ? { track_changes: true } : {}),
    ...(['simple', 'none', 'original'].includes(get(m, 'markup', '')) ? { markup: get(m, 'markup', '') as 'simple' } : {}),
    ...(get(m, 'date_format', '') ? { date_format: pyStr(get(m, 'date_format', '')) } : {}),
    ...(withRefs ? {
      ref_library: pyStr(get(m, 'ref_library', '')),
      bib_style: pyStr(get(m, 'bib_style', 'plainnat')),
    } : {}),
  })
}

function buildDocument(d: Json): Document {
  return document(
    get<Json[]>(d, 'children', []).map(buildBlock),
    buildMeta(get(d, 'meta', {}), 'article', true),
  )
}

// ---------------- Project JSON serialisation ----------------

export function projectToJson(proj: Project): string {
  return pyJson({
    type: 'Project',
    meta: proj.meta,
    chapters: proj.chapters,
    bibliography: proj.bibliography,
    bib_style: proj.bib_style,
    auto_page_numbers: proj.auto_page_numbers,
  }, FLOAT_FIELDS)
}

export function projectFromJson(s: string): Project {
  const d = JSON.parse(s) as Json
  if (d.type !== 'Project') throw new Error('Not a project manifest')
  const chapters = get<Json[]>(d, 'chapters', []).map((c) => chapterEntry({
    path: get(c, 'path', ''),
    label: get(c, 'label', ''),
    enabled: truthy(get(c, 'enabled', true)),
    start_page: get(c, 'start_page', null),
    last_known_pages: pyInt(c.last_known_pages, 0),
    numbering: get(c, 'numbering', 'arabic'),
    chapter_type: get(c, 'chapter_type', 'chapter'),
    chapter_number: get(c, 'chapter_number', null),
  }))
  return project({
    meta: buildMeta(get(d, 'meta', {}), 'book', false),
    chapters,
    bibliography: get(d, 'bibliography', ''),
    bib_style: get(d, 'bib_style', ''),
    auto_page_numbers: truthy(get(d, 'auto_page_numbers', true)),
  })
}

// ---- chapter-capable document classes ----

export const CHAPTER_CLASSES = [
  'report', 'book', 'memoir', 'scrreprt', 'scrbook', 'mimosis',
  'hepthesis', 'suftesi', 'toptesi', 'disser', 'amsbook', 'elegantbook',
  'tufte-book',
]

export function classSupportsChapter(className: string): boolean {
  if (!className) return false
  const head = strip(className.toLowerCase().split(',')[0])
  return CHAPTER_CLASSES.some((c) => head.startsWith(c))
}

// Every node below `node`, depth first, in order (references._walk).
export function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== 'object' || !('type' in node)) return
  const n = node as Record<string, unknown>
  yield n
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && 'type' in item) yield* walk(item)
      }
    }
  }
}

// ListItem has a `type` field too, so walk() reaches inside lists.
export function citedKeys(doc: Document): string[] {
  const keys: string[] = []
  for (const n of walk(doc)) {
    if (n.type === 'Citation') {
      for (const k of (n as unknown as Citation).keys) {
        if (k && !keys.includes(k)) keys.push(k)
      }
    }
  }
  return keys
}
