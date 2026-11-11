// The ProseMirror schema: one node type per model node (src/core/model.ts),
// so a document converts losslessly both ways (convert.ts). What
// editor.py keeps in QTextBlock user states and format properties lives
// here as node attributes.
//
// Inline wrappers that hold other inlines (Link, Highlight, Comment) are
// marks with a group id, so two neighbouring links stay two links, and a
// depth, so nesting comes back in the order it went in. Text marks rank
// in the order editor._inlines_from_block reads them back.
import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model'

const inlineAtom = (attrs: Record<string, { default: unknown }>, tag: string, cls: string): NodeSpec => ({
  inline: true, group: 'inline', atom: true, selectable: true, attrs,
  toDOM: () => [tag, { class: cls }],
})

// Every block remembers the model block it was built from (convert.ts):
// while its content is unchanged, that block is given back verbatim.
const ORIG = { orig: { default: null } }

const textBlock = (tag: string, cls: string, attrs: Record<string, { default: unknown }> = {}): NodeSpec => ({
  group: 'block', content: 'inline*', attrs: { ...attrs, ...ORIG },
  toDOM: () => [tag, { class: `kt-block ${cls}` }, 0],
  parseDOM: [{ tag: `${tag}.${cls}` }],
})

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    ...textBlock('p', 'kt-paragraph', { alignment: { default: 'justify' } }),
    parseDOM: [{ tag: 'p' }],
  },
  section: textBlock('h2', 'kt-section', {
    level: { default: 1 }, numbered: { default: true }, label: { default: null },
  }),
  title: textBlock('div', 'kt-title'),
  author: textBlock('div', 'kt-author'),
  affiliation: textBlock('div', 'kt-affiliation'),
  correspondence: textBlock('div', 'kt-correspondence'),
  abstract: textBlock('div', 'kt-abstract'),
  keywords: textBlock('div', 'kt-keywords'),
  frame: textBlock('div', 'kt-frame'),
  theorem: textBlock('div', 'kt-theorem', {
    kind: { default: 'theorem' }, title: { default: '' }, start: { default: true },
  }),
  math_block: {
    group: 'block', atom: true, selectable: true, draggable: false,
    attrs: { latex: { default: '' }, numbered: { default: false }, label: { default: null }, ...ORIG },
    toDOM: () => ['div', { class: 'kt-block kt-math-block' }],
  },
  list: {
    group: 'block', content: 'list_item*', attrs: { ordered: { default: false }, ...ORIG },
    toDOM: n => [n.attrs.ordered ? 'ol' : 'ul', { class: 'kt-block kt-list' }, 0],
    parseDOM: [{ tag: 'ul', attrs: { ordered: false } }, { tag: 'ol', attrs: { ordered: true } }],
  },
  list_item: {
    content: 'inline*', defining: true,
    toDOM: () => ['li', { class: 'kt-item' }, 0],
    parseDOM: [{ tag: 'li' }],
  },
  figure: {
    group: 'block', atom: true, selectable: true, draggable: false,
    attrs: {
      path: { default: '' }, caption: { default: '' }, label: { default: null },
      width: { default: '0.8\\textwidth' }, source: { default: '' }, align: { default: 'center' }, ...ORIG,
    },
    // The attributes go with a copy, so a copied figure pastes back as a
    // figure (in this document, another one, another window); the page
    // shows it through its node view.
    toDOM: n => ['div', { class: 'kt-block kt-figure', 'data-kt-figure': JSON.stringify(n.attrs) }],
    parseDOM: [{
      tag: 'div[data-kt-figure]', priority: 60,
      getAttrs: d => {
        try {
          const a = JSON.parse((d as HTMLElement).getAttribute('data-kt-figure') || '')
          return a && typeof a === 'object' && typeof a.path === 'string' ? a : false
        } catch {
          return false
        }
      },
    }],
  },
  table: {
    group: 'block', content: 'table_row+', isolating: true, tableRole: 'table',
    attrs: {
      caption: { default: '' }, label: { default: null }, alignment: { default: '' },
      style: { default: '' }, header: { default: false }, repeat_header: { default: false }, ...ORIG,
    },
    toDOM: () => ['table', { class: 'kt-block kt-table' }, ['tbody', 0]],
  },
  table_row: {
    content: 'table_cell+', tableRole: 'row',
    toDOM: () => ['tr', 0],
  },
  table_cell: {
    // Cells hold the LaTeX of the model as `raw`; the text shown is
    // editor._cell_display_text(raw) until the user edits it.
    content: 'text*', marks: '', isolating: true, tableRole: 'cell',
    attrs: {
      colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null },
      raw: { default: null }, shade: { default: null },
    },
    toDOM: n => ['td', {
      colspan: n.attrs.colspan !== 1 ? n.attrs.colspan : null,
      rowspan: n.attrs.rowspan !== 1 ? n.attrs.rowspan : null,
    }, 0],
    // A structured cell's lines (paragraphs, list items) are newlines.
    parseDOM: [{ tag: 'td', preserveWhitespace: 'full' }, { tag: 'th', preserveWhitespace: 'full' }],
  },
  raw_latex: {
    group: 'block', content: 'text*', marks: '', code: true, defining: true, attrs: ORIG,
    toDOM: () => ['pre', { class: 'kt-block kt-raw' }, 0],
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
  },
  // figure* / table*: shown as a summary line, the LaTeX kept whole.
  raw_float: {
    group: 'block', atom: true, selectable: true, attrs: { text: { default: '' }, ...ORIG },
    toDOM: () => ['div', { class: 'kt-block kt-raw-float' }],
  },
  text: { group: 'inline' },
  // Shift+Enter: a line break inside the block, U+2028 in the model's
  // text as in the Qt editor.
  line_sep: {
    inline: true, group: 'inline', selectable: false,
    toDOM: () => ['br', { class: 'kt-line-sep' }],
    parseDOM: [{ tag: 'br' }],
  },
  math_inline: inlineAtom({ latex: { default: '' } }, 'span', 'kt-math-inline'),
  footnote: inlineAtom({ children: { default: [] } }, 'span', 'kt-footnote'),
  citation: inlineAtom({ keys: { default: [] }, style: { default: 'cite' } }, 'span', 'kt-citation'),
  crossref: inlineAtom({ label: { default: '' }, kind: { default: 'ref' } }, 'span', 'kt-crossref'),
  inline_raw: inlineAtom({ latex: { default: '' } }, 'span', 'kt-inline-raw'),
  // A model inline the marks cannot carry (an empty link, say), kept as is.
  inline_json: inlineAtom({ node: { default: null } }, 'span', 'kt-inline-json'),
}

const wrapper = (extra: Record<string, { default: unknown }>, toDOM: MarkSpec['toDOM']): MarkSpec => ({
  attrs: { gid: { default: 0 }, depth: { default: 0 }, ...extra },
  inclusive: false, excludes: '', toDOM,
})

const simple = (tag: string, style?: string): MarkSpec => ({
  toDOM: () => style ? [tag, { style }, 0] : [tag, 0],
})

const marks: Record<string, MarkSpec> = {
  link: wrapper({ url: { default: '' } }, m => ['a', { class: 'kt-link', title: m.attrs.url }, 0]),
  highlight: wrapper({ color: { default: 'yellow' } }, m => ['span', { class: 'kt-highlight', 'data-color': m.attrs.color }, 0]),
  comment: wrapper({
    note: { default: '' }, author: { default: '' }, timestamp: { default: '' }, resolved: { default: false },
  }, m => ['span', {
    class: 'kt-comment',
    title: m.attrs.author ? `${m.attrs.author}: ${m.attrs.note}` : m.attrs.note,
  }, 0]),
  bold: { ...simple('strong'), parseDOM: [{ tag: 'strong' }, { tag: 'b' }] },
  italic: { ...simple('em'), parseDOM: [{ tag: 'em' }, { tag: 'i' }] },
  underline: { ...simple('u'), parseDOM: [{ tag: 'u' }] },
  strikethrough: { ...simple('s'), parseDOM: [{ tag: 's' }] },
  smallcaps: simple('span', 'font-variant: small-caps'),
  code: { toDOM: () => ['code', { class: 'kt-code' }, 0], parseDOM: [{ tag: 'code' }] },
  subscript: { ...simple('sub'), parseDOM: [{ tag: 'sub' }] },
  superscript: { ...simple('sup'), parseDOM: [{ tag: 'sup' }] },
}

export const schema = new Schema({ nodes, marks })

// Model mark names in the order Python reads them back from a fragment.
export const TEXT_MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'smallcaps', 'code',
  'subscript', 'superscript'] as const
export const WRAPPER_MARKS = ['link', 'highlight', 'comment'] as const

// Block node types that hold text with a paragraph style.
export const STYLED_TEXT = new Set(['paragraph', 'section', 'title', 'author', 'affiliation',
  'correspondence', 'abstract', 'keywords', 'frame', 'theorem'])
