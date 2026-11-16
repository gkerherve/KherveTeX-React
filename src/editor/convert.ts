// Model ⇄ ProseMirror. editor.py's set_document / get_document, without
// their losses: links, highlights and comments keep their inner inlines,
// footnotes their content, and a paragraph its exact alignment. What
// Qt's text fragments cannot tell apart, ProseMirror cannot either:
// neighbouring text runs with the same marks merge into one, empty runs
// vanish, and marks come back in Python's reading order (normalizeDoc
// gives that form of any model document).
import type { Mark as PMMark, Node as PMNode } from 'prosemirror-model'
import { TableMap } from 'prosemirror-tables'
import * as M from '../core/model.ts'
import { escapeText } from '../core/serializer.ts'
import { schema, TEXT_MARKS } from './schema.ts'

let gidCounter = 1
export function newGid(): number {
  return gidCounter++
}

const MARK_ORDER: readonly string[] = TEXT_MARKS

// ---------- table helpers (editor.py) ----------

// A table cell as text, whatever produced it (editor._cell_text).
export function cellText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(cellText).join(' ')
  return value === null || value === undefined ? '' : String(value)
}

const GRAPHICS_RE = /\\includegraphics\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g
const STRUCTURE_RE = /\\par\b|\\begin\{(itemize|enumerate)\}|\\end\{(?:itemize|enumerate)\}|\\item\b/g

export interface CellPicture {
  // The \includegraphics command as written.
  cmd: string
  path: string
  // Its width= option ('' when none).
  width: string
}

// The pictures (\includegraphics) in a table cell's LaTeX.
export function cellPictures(raw: string): CellPicture[] {
  return [...(raw || '').matchAll(GRAPHICS_RE)].map((m) => ({
    cmd: m[0], path: m[2].trim(), width: /(?:^|,)\s*width\s*=\s*([^,]*)/.exec(m[1] ?? '')?.[1].trim() ?? '',
  }))
}

// A cell laid out as paragraphs, lists or pictures (a Word table of steps
// beside screenshots), rather than one line of text.
export function isStructuredCell(raw: string): boolean {
  return /\\includegraphics|\\par\b|\\item\b/.test(raw || '')
}

// editor._cell_display_text: the LaTeX of a cell as the page shows it.
// A structured cell shows its paragraphs on their own lines and list items
// as "• " or "1. "; its pictures are drawn above the text (TableCellView).
export function cellDisplayText(raw: string): string {
  let s = raw
  if (isStructuredCell(s)) {
    s = s.replace(GRAPHICS_RE, '')
    const lines: string[] = []
    let env: string | null = null
    let n = 0
    let cur = ''
    const push = () => { if (cur.trim()) lines.push(cur.trim()); cur = '' }
    let last = 0
    for (const m of s.matchAll(STRUCTURE_RE)) {
      cur += s.slice(last, m.index)
      last = m.index! + m[0].length
      push()
      if (m[1]) { env = m[1]; n = 0 }
      else if (m[0].startsWith('\\end')) env = null
      else if (m[0] === '\\item') { n += 1; cur = env === 'enumerate' ? `${n}. ` : '• ' }
    }
    cur += s.slice(last)
    push()
    s = lines.join('\n')
      .replace(/\\text(?:super|sub)script\{([^}]*)\}/g, '$1')
      .replace(/\\([%&_#$])/g, '$1')
  }
  return s.replace(/\\(?:textbf|textit|emph|texttt)\{([^}]*)\}/g, '$1').trim()
}

// An edited structured cell back to LaTeX: its lines as paragraphs, "• "
// and "1. " lines as itemize / enumerate, and its pictures kept where they
// stood (before the text when the cell began with one).
export function displayToCellLatex(shown: string, raw: string): string {
  const pics = cellPictures(raw).map((p) => p.cmd)
  const parts: string[] = []
  let items: string[] = []
  let env = ''
  const flush = () => {
    if (items.length) parts.push(`\\begin{${env}} ` + items.map((t) => `\\item ${t}`).join(' ') + ` \\end{${env}}`)
    items = []
  }
  for (const line of shown.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const bullet = /^[•·\-*]\s*(.*)$/.exec(t)
    const num = /^\d+[.)]\s+(.*)$/.exec(t)
    if (bullet || num) {
      const e = bullet ? 'itemize' : 'enumerate'
      if (items.length && e !== env) flush()
      env = e
      items.push(escapeText((bullet ?? num)![1]))
    } else {
      flush()
      parts.push(escapeText(t))
    }
  }
  flush()
  const first = /^\s*\\includegraphics/.test(raw || '')
  return (first ? [...pics, ...parts] : [...parts, ...pics]).join(' \\par ')
}

// ---------- model → ProseMirror ----------

function inlineNodes(nodes: M.Inline[], wrappers: PMMark[]): PMNode[] {
  const out: PMNode[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'Text': {
        if (!n.text) break
        const marks = [...wrappers]
        for (const m of n.marks) {
          const t = schema.marks[m]
          if (t && !marks.some(x => x.type === t)) marks.push(t.create())
        }
        const parts = n.text.split(' ')
        parts.forEach((p, i) => {
          if (i > 0) out.push(schema.nodes.line_sep.create(null, null, marks))
          if (p) out.push(schema.text(p, marks))
        })
        break
      }
      case 'MathInline':
        out.push(schema.nodes.math_inline.create({ latex: n.latex }, null, wrappers))
        break
      case 'Footnote':
        out.push(schema.nodes.footnote.create({ children: structuredClone(n.children) }, null, wrappers))
        break
      case 'Citation':
        out.push(schema.nodes.citation.create({ keys: [...n.keys], style: n.style }, null, wrappers))
        break
      case 'CrossRef':
        out.push(schema.nodes.crossref.create({ label: n.label, kind: n.kind }, null, wrappers))
        break
      case 'InlineRaw':
        out.push(schema.nodes.inline_raw.create({ latex: n.latex }, null, wrappers))
        break
      case 'Link':
      case 'Highlight':
      case 'Comment': {
        if (!hasContent(n.children)) {
          out.push(schema.nodes.inline_json.create({ node: structuredClone(n) }, null, wrappers))
          break
        }
        const depth = wrappers.length
        const gid = newGid()
        const mark = n.type === 'Link'
          ? schema.marks.link.create({ gid, depth, url: n.url })
          : n.type === 'Highlight'
            ? schema.marks.highlight.create({ gid, depth, color: n.color })
            : schema.marks.comment.create({
              gid, depth, note: n.note, author: n.author, timestamp: n.timestamp, resolved: n.resolved,
            })
        out.push(...inlineNodes(n.children, [...wrappers, mark]))
        break
      }
    }
  }
  return out
}

// Would these inlines leave anything in ProseMirror?
function hasContent(nodes: M.Inline[]): boolean {
  return nodes.some(n => n.type !== 'Text' || n.text !== '')
}

function textNode(type: string, attrs: Record<string, unknown> | null, children: M.Inline[]): PMNode {
  return schema.nodes[type].create(attrs, inlineNodes(children, []))
}

function tableNode(t: M.Table): PMNode {
  const nrows = t.rows.length || 1
  const ncols = Math.max(1, t.rows.length ? Math.max(0, ...t.rows.map(r => r.length)) : 1)
  const raw: string[][] = []
  for (let r = 0; r < nrows; r++) {
    const row = t.rows[r] ?? []
    raw.push(Array.from({ length: ncols }, (_, c) => c < row.length ? cellText(row[c]) : ''))
  }
  const shade: (string | null)[][] = raw.map(row => row.map(() => null))
  for (const [key, color] of Object.entries(t.shading ?? {})) {
    const [r, c] = key.split(',').map(v => parseInt(v, 10))
    if (r < nrows && c < ncols && r >= 0 && c >= 0) shade[r][c] = color
  }
  // Which grid positions a merged block covers, and each block's spans.
  const span: ([number, number] | null)[][] = raw.map(row => row.map(() => [1, 1] as [number, number]))
  for (const m of t.merges ?? []) {
    const [r, c] = m
    if (!(r < nrows && c < ncols)) continue
    const rs = Math.min(m[2], nrows - r), cs = Math.min(m[3], ncols - c)
    if (!(rs > 1 || cs > 1)) continue
    let free = true
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
      const s = span[r + dr][c + dc]
      if (!s || s[0] !== 1 || s[1] !== 1) free = false
    }
    if (!free) continue
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) span[r + dr][c + dc] = null
    span[r][c] = [rs, cs]
  }
  const rows: PMNode[] = []
  for (let r = 0; r < nrows; r++) {
    const cells: PMNode[] = []
    for (let c = 0; c < ncols; c++) {
      const s = span[r][c]
      if (!s) continue
      const shown = cellDisplayText(raw[r][c])
      cells.push(schema.nodes.table_cell.create(
        { rowspan: s[0], colspan: s[1], raw: raw[r][c], shade: shade[r][c] },
        shown ? schema.text(shown) : null))
    }
    // A row whose cells are all covered by merges above: ProseMirror
    // needs at least one cell, so it keeps an empty one.
    rows.push(schema.nodes.table_row.create(null, cells.length ? cells
      : [schema.nodes.table_cell.create({ raw: '' })]))
  }
  return schema.nodes.table.create({
    caption: t.caption ?? '', label: t.label ?? null, alignment: t.alignment ?? '',
    style: t.style ?? '', header: !!t.header, repeat_header: !!t.repeat_header,
  }, rows)
}

export function isRawFloat(text: string): boolean {
  return text.includes('\\begin{figure*}') || text.includes('\\begin{table*}')
}

function buildBlock(b: M.Block): PMNode {
  switch (b.type) {
    case 'Paragraph': return textNode('paragraph', { alignment: b.alignment }, b.children)
    case 'Section': return textNode('section', { level: b.level, numbered: b.numbered, label: b.label }, b.children)
    case 'Title': return textNode('title', null, b.children)
    case 'Author': return textNode('author', null, b.children)
    case 'Affiliation': return textNode('affiliation', null, b.children)
    case 'Correspondence': return textNode('correspondence', null, b.children)
    case 'Abstract': return textNode('abstract', null, b.children)
    case 'Keywords': return textNode('keywords', null, b.children)
    case 'Frame': return textNode('frame', null, b.children)
    case 'Box': return textNode('box', null, b.children)
    case 'Theorem': return textNode('theorem', { kind: b.kind, title: b.title, start: b.start }, b.children)
    case 'MathBlock': return schema.nodes.math_block.create({ latex: b.latex, numbered: b.numbered, label: b.label })
    case 'List': return schema.nodes.list.create({ ordered: b.ordered },
      b.items.map(it => schema.nodes.list_item.create(null, inlineNodes(it.children, []))))
    case 'Figure': return schema.nodes.figure.create({
      path: b.path, caption: b.caption, label: b.label, width: b.width, source: b.source, align: b.align,
      height: b.height ?? '', extra: b.extra ?? [],
    })
    case 'Table': return tableNode(b)
    case 'RawLatex':
      if (isRawFloat(b.text)) return schema.nodes.raw_float.create({ text: b.text })
      return schema.nodes.raw_latex.create(null, b.text ? schema.text(b.text) : null)
  }
}

// The node for model block `b`, remembering `b` itself next to the form
// the editor would give back for it: as long as the node still gives that
// form, `b` comes back unchanged (mark order, split runs, empty runs and
// the odd table survive). An edited block comes back the way the Qt
// editor rebuilds it.
function remember(node: PMNode, block: M.Block | null): PMNode {
  const sig = JSON.stringify(canonicalBlock(node))
  return node.type.create({ ...node.attrs, orig: { block, sig } }, node.content, node.marks)
}

export function blockToPM(b: M.Block): PMNode {
  return remember(buildBlock(b), structuredClone(b))
}

export function docToPM(doc: M.Document): PMNode {
  const blocks = doc.children.map(blockToPM)
  // The Qt document always has a block; so does ProseMirror's. Left
  // empty, it is still no block of the model's.
  if (!blocks.length) blocks.push(remember(schema.nodes.paragraph.create({ alignment: 'justify' }), null))
  return schema.nodes.doc.create(null, blocks)
}

// ---------- ProseMirror → model ----------

type Container = { gid: number; children: M.Inline[] }

function textMarks(marks: readonly PMMark[]): M.Mark[] {
  return marks.map(m => m.type.name).filter(n => MARK_ORDER.includes(n))
    .sort((a, b) => MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b)) as M.Mark[]
}

function wrapperChain(marks: readonly PMMark[]): PMMark[] {
  return marks.filter(m => m.type.name === 'link' || m.type.name === 'highlight' || m.type.name === 'comment')
    .slice().sort((a, b) => a.attrs.depth - b.attrs.depth || a.attrs.gid - b.attrs.gid)
}

function wrapperNode(m: PMMark): M.Inline {
  if (m.type.name === 'link') return M.link(m.attrs.url, [])
  if (m.type.name === 'highlight') return M.highlight([], m.attrs.color)
  return M.comment([], {
    note: m.attrs.note, author: m.attrs.author, timestamp: m.attrs.timestamp, resolved: m.attrs.resolved,
  })
}

function sameMarks(a: M.Mark[], b: M.Mark[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i])
}

export function inlinesFromPM(block: PMNode): M.Inline[] {
  const root: Container = { gid: -1, children: [] }
  const stack: { gid: number; mark: PMMark; node: M.Inline & { children: M.Inline[] } }[] = []
  const top = () => (stack.length ? stack[stack.length - 1].node.children : root.children)
  const pushText = (text: string, marks: M.Mark[]) => {
    const kids = top()
    const last = kids[kids.length - 1]
    if (last && last.type === 'Text' && sameMarks(last.marks, marks)) last.text += text
    else kids.push(M.text(text, marks))
  }
  block.forEach(child => {
    const chain = wrapperChain(child.marks)
    let keep = 0
    while (keep < stack.length && keep < chain.length && stack[keep].mark.eq(chain[keep])) keep++
    stack.length = keep
    for (let i = keep; i < chain.length; i++) {
      const node = wrapperNode(chain[i]) as M.Inline & { children: M.Inline[] }
      top().push(node)
      stack.push({ gid: chain[i].attrs.gid, mark: chain[i], node })
    }
    const kids = top()
    switch (child.type.name) {
      case 'text': pushText(child.text ?? '', textMarks(child.marks)); break
      case 'line_sep': pushText(' ', textMarks(child.marks)); break
      case 'math_inline': kids.push(M.mathInline(child.attrs.latex)); break
      case 'footnote': kids.push(M.footnote(structuredClone(child.attrs.children))); break
      case 'citation': kids.push(M.citation([...child.attrs.keys], child.attrs.style)); break
      case 'crossref': kids.push(M.crossRef(child.attrs.label, child.attrs.kind)); break
      case 'inline_raw': kids.push(M.inlineRaw(child.attrs.latex)); break
      case 'inline_json': if (child.attrs.node) kids.push(structuredClone(child.attrs.node)); break
    }
  })
  return root.children
}

function tableFromPM(node: PMNode): M.Table {
  const map = TableMap.get(node)
  const rows: string[][] = []
  const merges: number[][] = []
  const shading: Record<string, string> = {}
  for (let r = 0; r < map.height; r++) {
    const row: string[] = []
    for (let c = 0; c < map.width; c++) {
      const pos = map.map[r * map.width + c]
      const cell = node.nodeAt(pos)!
      const rect = map.findCell(pos)
      if (rect.top !== r || rect.left !== c) { row.push(''); continue }
      const shown = cell.textContent
      let raw: string | null = cell.attrs.raw
      if (raw !== null && raw !== undefined) raw = cellText(raw)
      // Unchanged cell: its original LaTeX, so \textbf, math and macros
      // survive; an edited cell takes the new text.
      // A structured cell (paragraphs, lists, pictures) keeps its pictures
      // and turns its lines back into LaTeX.
      if (raw !== null && raw !== undefined && cellDisplayText(raw) === shown.trim()) row.push(raw)
      else if (raw && isStructuredCell(raw)) row.push(displayToCellLatex(shown, raw))
      else row.push(shown)
      const rs = Math.min(cell.attrs.rowspan, map.height - r)
      if (rs > 1 || cell.attrs.colspan > 1) merges.push([r, c, rs, cell.attrs.colspan])
      if (cell.attrs.shade) shading[`${r},${c}`] = cell.attrs.shade
    }
    rows.push(row)
  }
  return M.table({
    rows, caption: node.attrs.caption, label: node.attrs.label || null,
    alignment: node.attrs.alignment, style: node.attrs.style, merges,
    header: !!node.attrs.header, repeat_header: !!node.attrs.repeat_header, shading,
  })
}

interface Orig { block: M.Block | null; sig: string }

// The model block for `node`; null for nothing (the empty document's
// placeholder line, a node the model has no type for).
export function blockFromPM(node: PMNode): M.Block | null {
  const canon = canonicalBlock(node)
  const orig = node.attrs.orig as Orig | null | undefined
  if (orig && JSON.stringify(canon) === orig.sig) return orig.block ? structuredClone(orig.block) : null
  return canon
}

// How editor.get_document reads a node back.
export function canonicalBlock(node: PMNode): M.Block | null {
  const a = node.attrs
  switch (node.type.name) {
    case 'paragraph': return M.paragraph(inlinesFromPM(node), a.alignment)
    case 'section': return M.section(a.level, inlinesFromPM(node), a.numbered, a.label)
    case 'title': return M.title(inlinesFromPM(node))
    case 'author': return M.author(inlinesFromPM(node))
    case 'affiliation': return M.affiliation(inlinesFromPM(node))
    case 'correspondence': return M.correspondence(inlinesFromPM(node))
    case 'abstract': return M.abstract(inlinesFromPM(node))
    case 'keywords': return M.keywords(inlinesFromPM(node))
    case 'frame': return M.frame(inlinesFromPM(node))
    case 'box': return M.box(inlinesFromPM(node))
    case 'theorem': return M.theorem(a.kind, a.title, inlinesFromPM(node), a.start)
    case 'math_block': return M.mathBlock(a.latex, a.numbered, a.label)
    case 'list': {
      const items: M.ListItem[] = []
      node.forEach(it => items.push(M.listItem(inlinesFromPM(it))))
      return M.list(a.ordered, items)
    }
    case 'figure': return M.figure({
      path: a.path, caption: a.caption, label: a.label || null, width: a.width || '0.8\\textwidth',
      source: a.source, align: a.align || 'center',
      height: a.height || '', extra: a.extra && a.extra.length ? a.extra : [],
    })
    case 'table': return tableFromPM(node)
    case 'raw_latex': return M.rawLatex(node.textContent)
    case 'raw_float': return M.rawLatex(a.text)
  }
  return null
}

export function docFromPM(pm: PMNode, meta: M.DocMeta): M.Document {
  const blocks: M.Block[] = []
  pm.forEach(n => { const b = blockFromPM(n); if (b) blocks.push(b) })
  return M.document(blocks, meta)
}

// ---------- the form a round trip gives ----------

function normInlines(nodes: M.Inline[]): M.Inline[] {
  const out: M.Inline[] = []
  for (const n of nodes) {
    if (n.type === 'Text') {
      if (!n.text) continue
      const marks = [...new Set(n.marks.filter(m => MARK_ORDER.includes(m)))]
        .sort((a, b) => MARK_ORDER.indexOf(a) - MARK_ORDER.indexOf(b))
      // Python reads only one of sub- and superscript back.
      const shown = marks.includes('subscript') ? marks.filter(m => m !== 'superscript') : marks
      const last = out[out.length - 1]
      if (last && last.type === 'Text' && sameMarks(last.marks, shown)) last.text += n.text
      else out.push(M.text(n.text, shown))
    } else if (n.type === 'Link' || n.type === 'Highlight' || n.type === 'Comment') {
      out.push(hasContent(n.children) ? { ...n, children: normInlines(n.children) } : n)
    } else {
      out.push(n)
    }
  }
  return out
}

// A table as the Qt editor rebuilds it: a full grid of cell strings,
// covered cells emptied, spans clipped to the grid, shading on block
// corners only.
function normTable(t: M.Table): M.Table {
  const nrows = t.rows.length || 1
  const ncols = Math.max(1, t.rows.length ? Math.max(0, ...t.rows.map(r => r.length)) : 1)
  const rows = Array.from({ length: nrows }, (_, r) =>
    Array.from({ length: ncols }, (_, c) => cellText((t.rows[r] ?? [])[c] ?? '')))
  const covered = rows.map(row => row.map(() => 0))
  const merges: number[][] = []
  for (const m of t.merges ?? []) {
    const [r, c] = m
    if (!(r < nrows && c < ncols)) continue
    const rs = Math.min(m[2], nrows - r), cs = Math.min(m[3], ncols - c)
    if (!(rs > 1 || cs > 1)) continue
    let free = true
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (covered[r + dr][c + dc]) free = false
    if (!free) continue
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) covered[r + dr][c + dc] = dr || dc ? 2 : 1
    merges.push([r, c, rs, cs])
  }
  merges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const shading: Record<string, string> = {}
  for (let r = 0; r < nrows; r++) for (let c = 0; c < ncols; c++) {
    if (covered[r][c] === 2) { rows[r][c] = ''; continue }
    const s = t.shading?.[`${r},${c}`]
    if (s) shading[`${r},${c}`] = s
  }
  return M.table({ ...t, rows, merges, shading, label: t.label || null })
}

// What docFromPM(docToPM(doc)) returns for `doc`.
export function normalizeDoc(doc: M.Document): M.Document {
  const blocks = doc.children.map((b): M.Block => {
    if ('children' in b && b.type !== 'Theorem') return { ...b, children: normInlines(b.children) } as M.Block
    if (b.type === 'Theorem') return { ...b, children: normInlines(b.children) }
    if (b.type === 'List') return { ...b, items: b.items.map(it => ({ ...it, children: normInlines(it.children) })) }
    if (b.type === 'Table') return normTable(b)
    return b
  })
  return M.document(blocks.length ? blocks : [M.paragraph([], 'justify')], doc.meta)
}
