// The tools KherveTeX exposes to Claude over MCP, and their implementation
// (khervedoc/mcp_tools.py).
//
// `TOOLS` is the schema table the stdio server advertises; `ToolExecutor`
// runs one tool against the live app (through a `ToolHost`, the
// MainWindow of the Python code). Every tool returns a plain object; one
// with an "error" key is reported to the client as a failed call.
//
// The document is addressed as a flat list of top-level *blocks*
// (headings, paragraphs, equations, figures, tables, raw LaTeX...), the
// same units the model and the visual editor use, so "replace blocks 4-6"
// means the same thing to Claude as to the user looking at the page.
// Content goes in as LaTeX body source and is parsed into real, editable
// blocks — never pasted in as a raw string.
import { nextDrawingPath } from '../core/drawingFiles.ts'
import { importBodyFragment, parseInlines, splitAuthorLines } from '../core/importers.ts'
import {
  author, classSupportsChapter, figure, mathBlock, mathInline, paragraph, title, type Block, type DocMeta, type Document as KDocument,
} from '../core/model.ts'
import type { Scene } from '../core/paintModel.ts'
import { itemToDict, loadSvg } from '../core/paintSvg.ts'
import { dirname, suffix, withSuffix } from '../core/paths.ts'
import { splitlines } from '../core/py.ts'
import { ReferenceResolver } from '../core/references.ts'
import { escapeText, serializeBlock, serializeDocument } from '../core/serializer.ts'
import { wrapCe } from '../math/chemistry.ts'
import { parseLatex, Raw, Row, type Node as MathNode } from '../math/mathbox.ts'
import { vectorItems } from '../core/paintModel.ts'
import {
  addShapes, authoringScene, LIBRARIES, listSymbols, sceneToShapes, ShapeError,
} from './authoring.ts'

type Schema = Record<string, unknown>
type Args = Record<string, unknown>
export type ToolResult = Record<string, unknown>

const INT = { type: 'integer' }
const STR = { type: 'string' }
const BOOL = { type: 'boolean' }

function obj(props: Schema, required: string[] = []): Schema {
  return { type: 'object', properties: props, required, additionalProperties: false }
}

const SHAPES_DOC = 'Array of shape objects, all lengths in mm. Common optional keys: '
  + 'stroke (#rrggbb or null for none, default #1a1a1a), width (stroke '
  + 'mm, default 0.5), dash (solid|dash|dot|dashdot), fill (#rrggbb or '
  + 'null, default null), rotation (deg), opacity (0-1). '
  + 'rect / rounded_rect / ellipse: x, y (top-left), w, h, radius '
  + '(rounded_rect, default 2.5), label (text centred inside), '
  + 'font_size (pt, default 11), text_color. circle: x, y (centre), r. '
  + 'line / arrow / double_arrow: points [[x1,y1],[x2,y2]]; arrow head '
  + 'filled|open|stealth. polygon (closed, fillable) / polyline (open '
  + 'path): points [[x,y],...]. text: text, x, y, anchor '
  + '(center default | left | topleft), font_size, color, bold, italic. '
  + 'symbol: symbol "library/name" from list_drawing_symbols, x, y '
  + '(centre), optional w / h (keeps aspect if only one), label '
  + "(replaces a flowchart node's caption, else placed below). Later "
  + 'shapes draw on top. A readable figure is ~60-160 mm wide; text of '
  + '9-12 pt; leave ~10 mm between boxes for arrows.'

export interface ToolSpec { name: string; description: string; input_schema: Schema }

export const TOOLS: ToolSpec[] = [
  // ── reading ──────────────────────────────────────────────────
  { name: 'get_document_info',
    description: 'Title, author, file path, document class, page and '
      + 'font settings, packages, block count, word count, '
      + 'whether there are unsaved changes, and the last '
      + 'compile status. Call this first.',
    input_schema: obj({}) },
  { name: 'get_outline',
    description: 'Every top-level block with its index, type and a '
      + 'short text preview; headings show their level and '
      + 'number. Use the indices with read_blocks, '
      + 'replace_blocks, delete_blocks and insert_latex.',
    input_schema: obj({}) },
  { name: 'read_blocks',
    description: 'Full LaTeX (and the structured model) of blocks '
      + 'start..end inclusive. Read before you rewrite.',
    input_schema: obj({ start: INT, end: INT }, ['start']) },
  { name: 'get_latex',
    description: 'The complete .tex source the document compiles '
      + 'from (preamble + body), as the Code tab shows it.',
    input_schema: obj({ max_chars: INT }) },
  { name: 'search_text',
    description: 'Find text in the document (case-insensitive). '
      + 'Returns the block index and context of each match.',
    input_schema: obj({ query: STR, max_results: INT }, ['query']) },
  { name: 'list_references',
    description: 'Citation keys (from the .bib / thebibliography) '
      + 'and \\label names with the number each resolves to '
      + '— use these rather than inventing keys.',
    input_schema: obj({}) },
  { name: 'get_compile_log',
    description: 'Result of the last compile: ok flag, error summary '
      + 'and the tail of the LaTeX log.',
    input_schema: obj({ lines: INT }) },
  { name: 'render_page',
    description: 'An image of one page of the last compiled PDF '
      + '(1-based). Use it to check layout, equations, '
      + 'tables and figures the way the reader will see '
      + 'them.',
    input_schema: obj({ page: INT, dpi: INT }, ['page']) },
  // ── editing ──────────────────────────────────────────────────
  { name: 'insert_latex',
    description: 'Insert LaTeX BODY source (no preamble) as new '
      + 'blocks: after block index `after` (-1 = at the '
      + 'very start), or at the end when `after` is omitted. '
      + 'Sections, equations, lists, tables, figures, '
      + '\\cite and \\ref all become real editable content. '
      + 'One Ctrl+Z undoes it.',
    input_schema: obj({ latex: STR, after: INT }, ['latex']) },
  { name: 'replace_blocks',
    description: 'Replace blocks start..end inclusive with new LaTeX '
      + 'body source. Read them first with read_blocks and '
      + 'keep what you were not asked to change.',
    input_schema: obj({ start: INT, end: INT, latex: STR }, ['start', 'end', 'latex']) },
  { name: 'delete_blocks',
    description: 'Delete blocks start..end inclusive.',
    input_schema: obj({ start: INT, end: INT }, ['start', 'end']) },
  { name: 'replace_text',
    description: 'Find and replace plain text in the visual document, '
      + 'keeping the surrounding formatting. Replaces every '
      + 'occurrence unless all=false.',
    input_schema: obj({ find: STR, replace: STR, all: BOOL, case_sensitive: BOOL }, ['find', 'replace']) },
  { name: 'set_metadata',
    description: 'Change document settings: title, author, '
      + 'documentclass, body_font_pt (10/11/12), '
      + 'body_font_family (default, times, palatino, '
      + 'helvetica, courier, charter, libertine), '
      + 'page_size (a4, letter, ...), line_spacing, '
      + 'paragraph_indent, show_date (the date under the title), margins in cm, add_packages, '
      + 'remove_packages. Only the fields you pass change.',
    input_schema: obj({
      title: STR, author: STR, documentclass: STR,
      body_font_pt: INT, body_font_family: STR,
      page_size: STR, line_spacing: { type: 'number' },
      paragraph_indent: BOOL,
      show_date: BOOL,
      margin_top_cm: { type: 'number' },
      margin_bottom_cm: { type: 'number' },
      margin_left_cm: { type: 'number' },
      margin_right_cm: { type: 'number' },
      add_packages: { type: 'array', items: STR },
      remove_packages: { type: 'array', items: STR },
    }) },
  { name: 'compile_document',
    description: 'Compile now and wait for the result (ok, error, '
      + 'page count, log tail). The PDF panel updates too.',
    input_schema: obj({}) },
  // ── files ────────────────────────────────────────────────────
  { name: 'save_document',
    description: 'Save the document. Without `path` it saves in '
      + 'place (the document must already have a file). A '
      + 'new `path` (.ktex or .ktex.json) needs Full '
      + 'access.',
    input_schema: obj({ path: STR }) },
  { name: 'open_document',
    description: 'Open or import a file (.ktex, .ktex.json, .tex, '
      + '.md, .docx, .pdf). Refuses to discard unsaved '
      + 'changes unless discard_unsaved_changes is true — '
      + 'prefer saving first. Needs Full access.',
    input_schema: obj({ path: STR, discard_unsaved_changes: BOOL }, ['path']) },
  { name: 'new_document',
    description: 'Start a blank document. Refuses to discard unsaved '
      + 'changes unless discard_unsaved_changes is true.',
    input_schema: obj({ discard_unsaved_changes: BOOL }) },
  // ── equations, chemistry and drawings ───────────────────────
  { name: 'insert_equation',
    description: 'Insert a LaTeX math equation (the math only, no $ '
      + 'or \\[ \\]). display=true (default) makes a '
      + 'display equation block (numbered/label optional); '
      + 'display=false puts inline math in a new paragraph. '
      + 'The result says whether the editor typesets it '
      + 'natively or shows unknown commands as raw source.',
    input_schema: obj({ latex: STR, display: BOOL, numbered: BOOL, label: STR, after: INT }, ['latex']) },
  { name: 'insert_chemistry',
    description: 'Insert a chemical formula or reaction in mhchem '
      + 'syntax, e.g. "2H2 + O2 -> 2H2O" or "SO4^2-" — '
      + 'just the body, it is wrapped in \\ce{...} and the '
      + 'mhchem package is added. display=false (default) is '
      + 'inline in a new paragraph; display=true is a '
      + 'numbered equation block.',
    input_schema: obj({ formula: STR, display: BOOL, numbered: BOOL, after: INT }, ['formula']) },
  { name: 'list_drawing_symbols',
    description: 'Symbol libraries (flowchart, electrical, optics, '
      + 'maths, labware, arrows) and the symbol names usable '
      + 'as {"type": "symbol", "symbol": '
      + '"library/name"} in drawings, with default sizes '
      + 'in mm.',
    input_schema: obj({ library: STR }) },
  { name: 'insert_drawing',
    description: 'Draw a vector figure (diagram, flowchart, setup '
      + 'sketch) from JSON shapes and insert it as an '
      + 'editable drawing figure the user can re-open. '
      + 'Units are MILLIMETRES, origin top-left, y down; the '
      + 'drawing is cropped to its content. See the '
      + '`shapes` schema.',
    input_schema: obj({
      shapes: { type: 'array', items: { type: 'object' }, description: SHAPES_DOC },
      caption: STR, label: STR,
      width: { type: 'string', description: 'LaTeX width, default 0.7\\textwidth' },
      after: INT,
    }, ['shapes']) },
  { name: 'get_drawing',
    description: 'The shapes of the drawing figure at block `index`, '
      + 'in the insert_drawing schema (mm). Items the schema '
      + 'cannot express come back as type "other" with '
      + 'their bounding box; include_raw adds the full '
      + 'canvas item dicts.',
    input_schema: obj({ index: INT, include_raw: BOOL }, ['index']) },
  { name: 'update_drawing',
    description: 'Rewrite the drawing figure at block `index`: '
      + 'mode "replace" (default) redraws it from `shapes`; '
      + '"append" adds `shapes` to what is there (use '
      + 'get_drawing coordinates). Caption and label are '
      + 'kept.',
    input_schema: obj({
      index: INT,
      shapes: { type: 'array', items: { type: 'object' } },
      mode: { type: 'string', enum: ['replace', 'append'] },
    }, ['index', 'shapes']) },
  { name: 'open_in_khervepaint',
    description: 'Open the drawing figure at block `index` in the '
      + 'KhervePaint app for full editing. Its saves update '
      + 'the figure automatically.',
    input_schema: obj({ index: INT }, ['index']) },
  { name: 'export_pdf',
    description: 'Compile and write the PDF to `path`. Needs Full '
      + 'access.',
    input_schema: obj({ path: STR }, ['path']) },
]

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'get_document_info', 'get_outline', 'read_blocks', 'get_latex',
  'search_text', 'list_references', 'get_compile_log', 'render_page',
  'list_drawing_symbols', 'get_drawing',
])
// Tools that manage files, the compile or the undo stack themselves;
// wrapping them in an edit block would record an empty undo step.
export const NO_UNDO_BLOCK_TOOLS: ReadonlySet<string> = new Set([
  ...READ_ONLY_TOOLS,
  'compile_document', 'save_document', 'open_document',
  'new_document', 'export_pdf', 'set_metadata', 'open_in_khervepaint',
])
// Tools that touch a client-chosen filesystem path.
export const PATH_TOOLS: ReadonlySet<string> = new Set(['open_document', 'export_pdf'])

// A tool failed in a way worth telling the model about.
export class ToolError extends Error {}

// The last compile as MainWindow._last_compile_result holds it.
export interface CompileOutcome {
  ok: boolean
  error: string | null
  pdfPath: string | null
  log: string
  // The PDF's bytes when it compiled.
  pdf: Uint8Array | null
}

// What the tools need from the running app: MainWindow and its editor in
// the Python code. src/mcp/appHost.ts implements it over the store, the
// visual editor and the file actions; the tests use an in-memory one.
export interface ToolHost {
  // The document as the editor holds it now (editor.get_document()).
  doc(): KDocument
  // editor.replace_body's result: the whole new block list, applied as
  // one undoable edit, caret at the start.
  setChildren(children: Block[]): void
  setMeta(meta: DocMeta): void
  // text_edit.document().isModified()
  unsaved(): boolean
  path(): string | null
  projectPath(): string | null
  // The folder relative paths resolve against (editor._doc_dir).
  docDir(): string | null
  home(): string
  lastCompile(): CompileOutcome | null
  // A forced compile, waited for (null: it never finished).
  compile(): Promise<CompileOutcome | null>
  pdfPageCount(pdf: Uint8Array): Promise<number | null>
  renderPage(pdf: Uint8Array, page: number, dpi: number): Promise<Uint8Array>
  // QTextDocument.find + insertText over the visual document.
  replaceText(find: string, repl: string, all: boolean, caseSensitive: boolean): number
  // _current_path = path; _write_to(path)
  saveAs(path: string): Promise<void>
  // _write_to(_current_path), or _save_project() with a project open.
  save(): Promise<void>
  openPath(path: string): Promise<void>
  // MainWindow._new (no prompt: the tool has checked).
  newDocument(): Promise<void>
  exists(path: string): Promise<boolean>
  isFile(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  mkdir(path: string): Promise<void>
  imagesDir(): Promise<string>
  resolveImagePath(path: string): Promise<string | null>
  // export.save_drawing: <stem>.svg, .pdf and .png beside each other;
  // false when there is nothing to save.
  saveDrawing(scene: Scene, pngPath: string): Promise<boolean>
  refreshFigureImage(pngPath: string): void
  editInKhervePaint(pngPath: string): Promise<[boolean, string]>
}

// str.split() / " ".join(...)
const words = (s: string) => s.split(/\s+/u).filter(Boolean)
const cp = (s: string) => Array.from(s)

function preview(block: Block, n = 90): string {
  let text: string
  try {
    text = serializeBlock(block)
  } catch {
    text = block.type
  }
  text = words(text).join(' ')
  const chars = cp(text)
  return chars.length <= n ? text : chars.slice(0, n - 1).join('') + '…'
}

function pyRepr(v: unknown): string {
  return typeof v === 'string' ? `'${v}'` : v === null || v === undefined ? 'None' : String(v)
}

// int(v), raising as Python does.
function pyInt(v: unknown): number {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10)
  const e = new Error(v === null || v === undefined
    ? "int() argument must be a string, a bytes-like object or a real number, not 'NoneType'"
    : `invalid literal for int() with base 10: ${pyRepr(v)}`)
  e.name = v === null || v === undefined ? 'TypeError' : 'ValueError'
  throw e
}

const isSet = (v: unknown) => v !== undefined && v !== null

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Path(p).expanduser()
function expandUser(p: string, home: string): string {
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return home + p.slice(1)
  return p
}

// MainWindow._has_native_suffix
function hasNativeSuffix(path: string): boolean {
  const name = path.split(/[\\/]/).pop()!.toLowerCase()
  return name.endsWith('.ktex') || name.endsWith('.ktexz') || name.endsWith('.ktex.json')
    || name.endsWith('.kdocz') || name.endsWith('.kdoc.json')
}

export class ToolExecutor {
  private host: ToolHost
  constructor(host: ToolHost) {
    this.host = host
  }

  async execute(name: string, toolInput: Args | null | undefined): Promise<ToolResult> {
    const handler = (this as unknown as Record<string, unknown>)[`t_${name}`]
    if (typeof handler !== 'function' || !TOOLS.some(t => t.name === name)) return { error: `Unknown tool: ${name}` }
    try {
      return await (handler as (a: Args) => Promise<ToolResult> | ToolResult).call(this, toolInput || {})
    } catch (exc) {
      if (exc instanceof ToolError) return { error: exc.message }
      throw exc
    }
  }

  // plumbing ------------------------------------------------------

  private doc(): KDocument {
    return this.host.doc()
  }

  private blocks(): Block[] {
    return [...this.doc().children]
  }

  private range(args: Args, n: number): [number, number] {
    const start = pyInt(args.start ?? 0)
    const end = pyInt('end' in args ? args.end : start)
    if (n === 0) throw new ToolError('The document is empty.')
    if (!(start >= 0 && start < n) || !(start <= end && end < n)) {
      throw new ToolError(`Block range ${start}..${end} is outside 0..${n - 1}. Call get_outline again.`)
    }
    return [start, end]
  }

  // \maketitle in a fragment means "show the title here": it becomes the
  // document's Title / Author blocks (built from the metadata), not a
  // block of its own, so it is taken out before parsing.
  private static parse(latex: unknown, hasChapters: boolean): [Block[], boolean] {
    let src = typeof latex === 'string' ? latex : ''
    const maketitle = /\\maketitle\b/.test(src)
    if (maketitle) src = src.replace(/\\maketitle\b\s*/g, '')
    const blocks = importBodyFragment(src, { hasChapters })
    if (!blocks.length && !maketitle) throw new ToolError('That LaTeX produced no content.')
    return [blocks, maketitle]
  }

  // Put the title and author on the page as Title / Author blocks at the
  // top, so the Visual view shows them and not only the PDF. `force`
  // rebuilds them from the metadata even when blocks already exist (the
  // blocks win over the metadata in the LaTeX, so a stale block would
  // otherwise hide a new title).
  private syncTitleBlocks(force: { title: boolean, author: boolean }): void {
    const kids = this.doc().children
    const meta = this.doc().meta
    const oldT = kids.filter(b => b.type === 'Title')
    const oldA = kids.filter(b => b.type === 'Author')
    const newT = meta.title ? [title(parseInlines(meta.title))] : []
    const newA = meta.author
      ? splitAuthorLines(meta.author).map(l => author(parseInlines(l))).filter(b => b.children.length)
      : []
    const T = force.title || !oldT.length ? newT : oldT
    const A = force.author || !oldA.length ? newA : oldA
    let others = kids.filter(b => b.type !== 'Title' && b.type !== 'Author')
    // A blank document starts with one empty paragraph; drop it when the
    // title goes above real content.
    const blank = (b: Block | undefined) => b !== undefined && b.type === 'Paragraph'
      && !b.children.some(c => (('text' in c ? (c as { text: string }).text : 'x').trim()))
    if ((T.length || A.length) && blank(others[0]) && others.length > 1) others = others.slice(1)
    this.host.setChildren([...T, ...A, ...others])
  }

  // Replace the body in one undo step, keeping Title / Author.
  private setBody(blocks: Block[]): void {
    let body = blocks.filter(b => b.type !== 'Title' && b.type !== 'Author')
    const empty = (b: Block) => b.type === 'Paragraph'
      && !b.children.some(c => (('text' in c ? (c as { text: string }).text : 'x').trim()))
    const framed = (b: Block | undefined) => b !== undefined && (b.type === 'Figure' || b.type === 'Table')
    // A figure/table is a frame in the editor, and Qt always puts a block
    // on each side of a frame; those read back as empty paragraphs, so
    // without this every call would add two more.
    body = body.filter((b, i) => !(empty(b) && (framed(body[i - 1]) || framed(body[i + 1]))))
    const preserved = this.doc().children.filter(b => b.type === 'Title' || b.type === 'Author')
    this.host.setChildren([...preserved, ...body])
  }

  private unsaved(): boolean {
    return this.host.unsaved()
  }

  // reading -------------------------------------------------------

  t_get_document_info(): ToolResult {
    const doc = this.doc()
    const m = doc.meta
    const n = words(doc.children.map(b => preview(b, 10 ** 9)).join(' ')).length
    const last = this.host.lastCompile()
    const path = this.host.path()
    return {
      path, title: m.title, author: m.author,
      documentclass: m.documentclass,
      page_size: m.page_size, body_font_pt: m.body_font_pt,
      body_font_family: m.body_font_family,
      line_spacing: m.line_spacing,
      margins_cm: [m.margin_top_cm, m.margin_right_cm, m.margin_bottom_cm, m.margin_left_cm],
      packages: [...m.packages],
      blocks: doc.children.length, approx_words: n,
      unsaved_changes: this.unsaved(),
      project_open: this.host.projectPath() !== null,
      last_compile: last === null ? null : { ok: last.ok, error: last.error },
      latex_chars: cp(serializeDocument(doc)).length,
    }
  }

  t_get_outline(): ToolResult {
    const doc = this.doc()
    const resolver = new ReferenceResolver(doc)
    const out: ToolResult[] = []
    const counters = [0, 0, 0, 0, 0, 0]
    const hasCh = doc.children.some(b => b.type === 'Section' && b.level === 0)
    doc.children.forEach((b, i) => {
      const item: ToolResult = { index: i, type: b.type, preview: preview(b) }
      if (b.type === 'Section') {
        item.level = b.level
        if (b.numbered) {
          counters[b.level] += 1
          for (let k = b.level + 1; k < 6; k++) counters[k] = 0
          item.number = counters.slice(hasCh ? 0 : 1, b.level + 1).join('.')
        }
      }
      const label = (b as { label?: string | null }).label
      if (label) {
        item.label = label
        item.ref = resolver.refText(label)
      }
      out.push(item)
    })
    return { blocks: out }
  }

  t_read_blocks(args: Args): ToolResult {
    const blocks = this.blocks()
    const [start, end] = this.range(args, blocks.length)
    return {
      blocks: blocks.slice(start, end + 1).map((b, k) => ({
        index: start + k, type: b.type, latex: serializeBlock(b), model: structuredClone(b),
      })),
    }
  }

  t_get_latex(args: Args): ToolResult {
    const src = cp(serializeDocument(this.doc()))
    const limit = args.max_chars ? pyInt(args.max_chars) : 200_000
    return { latex: src.slice(0, Math.max(0, limit < 0 ? src.length + limit : limit)).join(''),
      truncated: src.length > limit, total_chars: src.length }
  }

  t_search_text(args: Args): ToolResult {
    const q = cp(String(args.query || '').toLowerCase())
    if (!q.length) throw new ToolError('query is empty.')
    const cap = args.max_results ? pyInt(args.max_results) : 50
    const hits: ToolResult[] = []
    this.blocks().forEach((b, i) => {
      const text = cp(serializeBlock(b))
      const low = cp(text.join('').toLowerCase())
      const find = (from: number) => {
        for (let p = from; p + q.length <= low.length; p++) {
          if (q.every((ch, j) => low[p + j] === ch)) return p
        }
        return -1
      }
      let pos = find(0)
      while (pos !== -1 && hits.length < cap) {
        const a = Math.max(0, pos - 40)
        const z = pos + q.length + 40
        hits.push({ block: i, context: words(text.slice(a, z).join('')).join(' ') })
        pos = find(pos + 1)
      }
    })
    return { matches: hits, count: hits.length }
  }

  async t_list_references(): Promise<ToolResult> {
    const fs = { exists: this.host.exists, read: this.host.readFile, write: this.host.writeFile }
    const r = await ReferenceResolver.load(this.doc(), this.host.docDir(), '', fs)
    const cites = [...r.entries].map(([k, e]) => ({
      key: k, author: e.author ?? '', year: e.year ?? '', title: e.title ?? '',
    }))
    return { citations: cites, labels: Object.fromEntries(r.labels) }
  }

  t_get_compile_log(args: Args): ToolResult {
    const last = this.host.lastCompile()
    if (last === null) return { compiled: false, note: 'Nothing compiled yet — call compile_document.' }
    const n = args.lines ? pyInt(args.lines) : 40
    return { ok: last.ok, error: last.error, pdf: last.pdfPath,
      log_tail: splitlines(last.log || '').slice(-n || 0).join('\n') }
  }

  async t_render_page(args: Args): Promise<ToolResult> {
    const last = this.host.lastCompile()
    if (last === null || last.pdf === null) throw new ToolError('No compiled PDF yet — call compile_document.')
    const pageNo = pyInt(args.page ?? 1)
    const dpi = Math.max(36, Math.min(200, args.dpi ? pyInt(args.dpi) : 110))
    const count = await this.host.pdfPageCount(last.pdf)
    if (count === null) throw new ToolError('No compiled PDF yet — call compile_document.')
    if (!(pageNo >= 1 && pageNo <= count)) throw new ToolError(`Page ${pageNo} is outside 1..${count}.`)
    const png = await this.host.renderPage(last.pdf, pageNo, dpi)
    return { page: pageNo, page_count: count, image_png_base64: base64(png) }
  }

  // editing -------------------------------------------------------

  t_insert_latex(args: Args): ToolResult {
    const [add, maketitle] = ToolExecutor.parse(args.latex ?? '', classSupportsChapter(this.doc().meta.documentclass || ''))
    const blocks = this.blocks()
    const at = isSet(args.after) ? pyInt(args.after) + 1 : blocks.length
    if (!(at >= 0 && at <= blocks.length)) throw new ToolError(`\`after\` must be -1..${blocks.length - 1}.`)
    this.setBody([...blocks.slice(0, at), ...add, ...blocks.slice(at)])
    if (maketitle) this.syncTitleBlocks({ title: false, author: false })
    return { inserted_blocks: add.length, at_index: at, total_blocks: this.blocks().length }
  }

  t_replace_blocks(args: Args): ToolResult {
    const blocks = this.blocks()
    const [start, end] = this.range(args, blocks.length)
    const [add, maketitle] = ToolExecutor.parse(args.latex ?? '', classSupportsChapter(this.doc().meta.documentclass || ''))
    this.setBody([...blocks.slice(0, start), ...add, ...blocks.slice(end + 1)])
    if (maketitle) this.syncTitleBlocks({ title: false, author: false })
    return { replaced: end - start + 1, with_blocks: add.length, total_blocks: this.blocks().length }
  }

  t_delete_blocks(args: Args): ToolResult {
    const blocks = this.blocks()
    const [start, end] = this.range(args, blocks.length)
    this.setBody([...blocks.slice(0, start), ...blocks.slice(end + 1)])
    return { deleted: end - start + 1, total_blocks: this.blocks().length }
  }

  t_replace_text(args: Args): ToolResult {
    const find = String(args.find || '')
    if (!find) throw new ToolError('`find` is empty.')
    const repl = String(args.replace ?? '')
    const all = 'all' in args ? Boolean(args.all) : true
    return { replacements: this.host.replaceText(find, repl, all, Boolean(args.case_sensitive)) }
  }

  t_set_metadata(args: Args): ToolResult {
    const meta = structuredClone(this.doc().meta) as DocMeta & Record<string, unknown>
    const changed: string[] = []
    for (const key of ['title', 'author', 'documentclass', 'body_font_pt',
      'body_font_family', 'page_size', 'line_spacing',
      'paragraph_indent', 'margin_top_cm', 'margin_bottom_cm',
      'margin_left_cm', 'margin_right_cm']) {
      if (key in args) {
        meta[key] = args[key]
        changed.push(key)
      }
    }
    for (const pkg of (args.add_packages as string[] | undefined) || []) {
      if (!meta.packages.includes(pkg)) {
        meta.packages.push(pkg)
        changed.push(`+${pkg}`)
      }
    }
    for (const pkg of (args.remove_packages as string[] | undefined) || []) {
      const i = meta.packages.indexOf(pkg)
      if (i >= 0) {
        meta.packages.splice(i, 1)
        changed.push(`-${pkg}`)
      }
    }
    if ('show_date' in args) {
      if (args.show_date === false) meta.show_date = false
      else delete meta.show_date
      changed.push('show_date')
    }
    if (!changed.length) throw new ToolError('No recognised fields to change.')
    this.host.setMeta(meta)
    if ('title' in args || 'author' in args) {
      this.syncTitleBlocks({ title: 'title' in args, author: 'author' in args })
    }
    return { changed }
  }

  async t_compile_document(): Promise<ToolResult> {
    const result = await this.host.compile()
    if (result === null) {
      throw new ToolError('The compile did not finish (is tectonic installed?). Check get_compile_log.')
    }
    let count: number | null = null
    if (result.pdf !== null) {
      try {
        count = await this.host.pdfPageCount(result.pdf)
      } catch { /* unreadable PDF: no count */ }
    }
    return { ok: result.ok, error: result.error, pages: count,
      log_tail: splitlines(result.log || '').slice(-15).join('\n') }
  }

  // files ---------------------------------------------------------

  async t_save_document(args: Args): Promise<ToolResult> {
    const path = args.path
    if (path) {
      const p = expandUser(String(path), this.host.home())
      if (!hasNativeSuffix(p)) throw new ToolError('Save as .ktex or .ktex.json; use export_pdf for PDF output.')
      await this.host.saveAs(p)
    } else if (this.host.projectPath() !== null) {
      await this.host.save()
    } else if (this.host.path() === null) {
      throw new ToolError('This document has never been saved; pass a '
        + '`path` (needs Full access) or ask the user to save it once.')
    } else {
      await this.host.save()
    }
    return { saved: String(this.host.path() ?? this.host.projectPath() ?? 'None') }
  }

  private refuseDiscard(args: Args): void {
    if (this.unsaved() && !args.discard_unsaved_changes) {
      throw new ToolError('The document has unsaved changes. Save it '
        + 'first (save_document), or pass '
        + 'discard_unsaved_changes=true only if the '
        + 'user agreed to lose them.')
    }
  }

  async t_open_document(args: Args): Promise<ToolResult> {
    const p = expandUser(String(args.path ?? ''), this.host.home()) || '.'
    if (!(await this.host.isFile(p))) throw new ToolError(`No such file: ${p}`)
    this.refuseDiscard(args)
    await this.host.openPath(p)
    return { opened: p, blocks: this.blocks().length }
  }

  async t_new_document(args: Args): Promise<ToolResult> {
    this.refuseDiscard(args)
    await this.host.newDocument()
    return { ok: true }
  }

  // equations, chemistry, drawings -------------------------------

  private insertAt(add: Block[], after: unknown): number {
    const blocks = this.blocks()
    const at = isSet(after) ? pyInt(after) + 1 : blocks.length
    if (!(at >= 0 && at <= blocks.length)) throw new ToolError(`\`after\` must be -1..${blocks.length - 1}.`)
    this.setBody([...blocks.slice(0, at), ...add, ...blocks.slice(at)])
    // The editor may pad figures with empty paragraphs, so the new block's
    // index is found rather than assumed.
    const now = this.blocks()
    for (let i = at; i < now.length; i++) if (now[i].type === add[0].type && deepEqual(now[i], add[0])) return i
    for (let i = at; i < now.length; i++) if (now[i].type === add[0].type) return i
    return at
  }

  private static mathNode(latex: string, display: boolean, numbered: boolean, label: unknown): Block {
    if (display) return mathBlock(latex, numbered, (label as string) || null)
    return paragraph([mathInline(latex)])
  }

  private static rawMath(latex: string): string[] {
    const found: string[] = []
    const walk = (node: Row | MathNode) => {
      if (node instanceof Raw) found.push(node.latex)
      if (node instanceof Row) for (const child of node.children) walk(child)
      else for (const slot of node.slots()) walk(slot)
    }
    walk(parseLatex(latex))
    return found
  }

  t_insert_equation(args: Args): ToolResult {
    let latex = String(args.latex || '').trim()
    for (const [a, b] of [['$$', '$$'], ['\\[', '\\]'], ['$', '$']]) {
      if (latex.length > a.length + b.length && latex.startsWith(a) && latex.endsWith(b)) {
        latex = latex.slice(a.length, -b.length).trim()
        break
      }
    }
    if (!latex) throw new ToolError('`latex` is empty.')
    const display = args.display !== false
    if (args.label && !display) throw new ToolError('Only a display equation can carry a label.')
    const numbered = Boolean(args.numbered) || Boolean(args.label)
    const at = this.insertAt([ToolExecutor.mathNode(latex, display, numbered, args.label)], args.after)
    const raw = ToolExecutor.rawMath(latex)
    const res: ToolResult = { at_index: at, display, numbered, latex, typesets_natively: !raw.length,
      total_blocks: this.blocks().length }
    if (raw.length) {
      res.not_typeset_in_editor = raw.slice(0, 10)
      res.note = 'The editor shows these parts as source; the '
        + 'compiled PDF is unaffected if the LaTeX is '
        + 'valid — compile_document to check.'
    }
    return res
  }

  t_insert_chemistry(args: Args): ToolResult {
    const latex = wrapCe(String(args.formula || ''))
    if (!latex) throw new ToolError('`formula` is empty.')
    const meta = this.doc().meta
    const added = !meta.packages.includes('mhchem')
    if (added) this.host.setMeta({ ...meta, packages: [...meta.packages, 'mhchem'] })
    const display = Boolean(args.display ?? false)
    const numbered = display && args.numbered !== false
    const at = this.insertAt([ToolExecutor.mathNode(latex, display, numbered, null)], args.after)
    return { at_index: at, latex, display, mhchem_package_added: added, total_blocks: this.blocks().length }
  }

  t_list_drawing_symbols(args: Args): ToolResult {
    let libs = listSymbols()
    const want = args.library
    if (want) {
      if (!(String(want) in libs)) throw new ToolError(`Unknown library; use one of ${LIBRARIES.join(', ')}.`)
      libs = { [String(want)]: libs[String(want)] }
    }
    return { libraries: libs, usage: '{"type": "symbol", "symbol": "optics/laser", "x": 30, "y": 20}' }
  }

  private async drawingAt(index: unknown): Promise<[number, Extract<Block, { type: 'Figure' }>, string]> {
    const blocks = this.blocks()
    if (!isSet(index)) throw new ToolError('`index` is required.')
    const i = pyInt(index)
    if (!(i >= 0 && i < blocks.length)) throw new ToolError(`Block ${i} is outside 0..${blocks.length - 1}.`)
    const fig = blocks[i]
    if (fig.type !== 'Figure') throw new ToolError(`Block ${i} is a ${fig.type}, not a figure. Call get_outline.`)
    const png = await this.host.resolveImagePath(fig.path)
    if (png === null || !(await this.host.exists(withSuffix(png, '.svg')))) {
      throw new ToolError(`Figure ${i} is not an editable drawing (no .svg beside its image).`)
    }
    return [i, fig, png]
  }

  private static shapesInto(scene: Scene, shapes: unknown): number {
    try {
      return addShapes(scene, shapes)
    } catch (exc) {
      if (exc instanceof ShapeError) throw new ToolError(exc.message)
      throw exc
    }
  }

  private async saveScene(scene: Scene, png: string): Promise<ToolResult> {
    if (!(await this.host.saveDrawing(scene, png))) throw new ToolError('The drawing is empty.')
    return { png, svg: withSuffix(png, '.svg'), pdf: withSuffix(png, '.pdf') }
  }

  async t_insert_drawing(args: Args): Promise<ToolResult> {
    const scene = authoringScene()
    const n = ToolExecutor.shapesInto(scene, args.shapes)
    const images = await this.host.imagesDir()
    await this.host.mkdir(images)
    const png = await nextDrawingPath(images, this.host.exists)
    const files = await this.saveScene(scene, png)
    const fig = figure({
      path: png, caption: escapeText(String(args.caption || '')), label: (args.label as string) || null,
      width: (args.width as string) || '0.7\\textwidth', source: 'drawing',
    })
    const at = this.insertAt([fig], args.after)
    return { at_index: at, items: n, files, total_blocks: this.blocks().length }
  }

  private async loadDrawing(png: string): Promise<Scene> {
    return loadSvg(await this.host.readText(withSuffix(png, '.svg')))
  }

  async t_get_drawing(args: Args): Promise<ToolResult> {
    const [i, fig, png] = await this.drawingAt(args.index)
    const scene = await this.loadDrawing(png)
    const res: ToolResult = {
      index: i, caption: fig.caption, label: fig.label, width: fig.width,
      files: { png, svg: withSuffix(png, '.svg') }, shapes: sceneToShapes(scene),
    }
    if (args.include_raw) {
      res.raw_items = vectorItems(scene).map(it => {
        try {
          return itemToDict(it)
        } catch {
          return { type: it.type }
        }
      })
    }
    return res
  }

  async t_update_drawing(args: Args): Promise<ToolResult> {
    const [i, , png] = await this.drawingAt(args.index)
    const mode = (args.mode as string) || 'replace'
    if (mode !== 'replace' && mode !== 'append') throw new ToolError('mode must be replace or append.')
    let scene = authoringScene()
    if (mode === 'append') scene = await this.loadDrawing(png)
    const n = ToolExecutor.shapesInto(scene, args.shapes)
    const files = await this.saveScene(scene, png)
    this.host.refreshFigureImage(png)
    return { index: i, mode, items_added: n, items_total: vectorItems(scene).length, files }
  }

  async t_open_in_khervepaint(args: Args): Promise<ToolResult> {
    const [i, , png] = await this.drawingAt(args.index)
    const [ok, msg] = await this.host.editInKhervePaint(png)
    if (!ok) throw new ToolError(msg)
    return { index: i, opened: withSuffix(png, '.svg'), message: msg }
  }

  async t_export_pdf(args: Args): Promise<ToolResult> {
    const target = expandUser(String(args.path ?? ''), this.host.home())
    if (suffix(target).toLowerCase() !== '.pdf') throw new ToolError('`path` must end in .pdf')
    const res = await this.t_compile_document()
    const last = this.host.lastCompile()
    if (!res.ok || last === null || last.pdf === null) throw new ToolError(`Compile failed: ${res.error}`)
    await this.host.mkdir(dirname(target))
    await this.host.writeFile(target, last.pdf)
    return { exported: target, pages: res.pages }
  }
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
