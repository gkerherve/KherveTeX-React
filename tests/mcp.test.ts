// Ported from ../KherveTeX/tests/test_mcp.py and test_mcp_drawing.py (same
// test names): the document tools, the bridge's access rules and busy
// guard, and the drawing tools — against an in-memory stand-in for the
// window. The stdio protocol and the socket are tested in Rust
// (src-tauri/src/mcp_server.rs, mcp.rs).
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importTex } from '../src/core/importers.ts'
import type { Block, DocMeta, Document as KDocument, Figure, MathBlock, Paragraph } from '../src/core/model.ts'
import { addShapes, authoringScene, drawingFiles, sceneToShapes } from '../src/mcp/authoring.ts'
import { McpBridge, toolAllowed, type BridgeShell } from '../src/mcp/bridge.ts'
import { TOOLS, ToolExecutor, type CompileOutcome, type ToolHost, type ToolResult } from '../src/mcp/tools.ts'

const FLOW = [
  { type: 'rect', x: 0, y: 0, w: 40, h: 14, label: 'Start', fill: '#eef2f6' },
  { type: 'rounded_rect', x: 0, y: 30, w: 40, h: 14, label: 'Measure' },
  { type: 'arrow', points: [[20, 14], [20, 30]] },
  { type: 'text', x: 60, y: 7, text: 'note' },
  { type: 'symbol', symbol: 'electrical/resistor', x: 70, y: 37 },
]

// The window: a document, a dirty flag, a figures folder on disk.
class FakeWindow implements ToolHost {
  docValue: KDocument
  dirty = false
  current: string | null = null
  project: string | null = null
  images: string
  last: CompileOutcome | null = null
  refreshed: string[] = []
  launched: string[] = []
  khervePaint: string | null = '/kp'

  constructor(body = '') {
    this.images = join(mkdtempSync(join(tmpdir(), 'kt-mcp-')), 'imgs')
    this.docValue = this.load(body)
  }

  load(body: string): KDocument {
    this.docValue = importTex('\\documentclass{article}\\begin{document}\n' + body + '\n\\end{document}')
    this.dirty = false
    return this.docValue
  }

  doc = () => this.docValue
  setChildren = (children: Block[]) => { this.docValue = { ...this.docValue, children }; this.dirty = true }
  setMeta = (meta: DocMeta) => { this.docValue = { ...this.docValue, meta }; this.dirty = true }
  unsaved = () => this.dirty
  path = () => this.current
  projectPath = () => this.project
  docDir = () => null
  home = () => '/home/u'
  lastCompile = () => this.last
  compile = async () => this.last
  pdfPageCount = async () => 1
  renderPage = async () => new Uint8Array([137, 80, 78, 71])
  replaceText = (find: string, repl: string, all: boolean, cs: boolean) => {
    let n = 0
    const flags = cs ? 'g' : 'gi'
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    const children = this.docValue.children.map(b => {
      if (b.type !== 'Paragraph') return b
      return { ...b, children: b.children.map(c => {
        if (c.type !== 'Text' || (!all && n)) return c
        return { ...c, text: c.text.replace(re, () => (!all && n ? find : (n++, repl))) }
      }) }
    })
    this.setChildren(children)
    return n
  }
  saveAs = async (p: string) => { this.current = p; this.dirty = false }
  save = async () => { this.dirty = false }
  openPath = async () => { this.load('Opened.') }
  newDocument = async () => { this.load(''); this.docValue = { ...this.docValue, children: [] } }
  exists = async (p: string) => existsSync(p)
  isFile = async (p: string) => existsSync(p) && statSync(p).isFile()
  readText = (p: string) => readFile(p, 'utf8')
  readFile = async (p: string) => new Uint8Array(await readFile(p))
  writeFile = async (p: string, d: Uint8Array) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, d) }
  mkdir = async (p: string) => { await mkdir(p, { recursive: true }) }
  imagesDir = async () => this.images
  resolveImagePath = async (p: string) => (existsSync(p) ? p : existsSync(join(this.images, p)) ? join(this.images, p) : null)
  saveDrawing = async (scene: Parameters<ToolHost['saveDrawing']>[0], png: string) => {
    const files = drawingFiles(scene)
    if (!files) return false
    await mkdir(dirname(png), { recursive: true })
    await writeFile(png.replace(/\.png$/, '.svg'), files.svg)
    await writeFile(png.replace(/\.png$/, '.pdf'), files.pdf)
    await writeFile(png, files.previewSvg)
    return true
  }
  refreshFigureImage = (p: string) => { this.refreshed.push(p) }
  editInKhervePaint = async (png: string): Promise<[boolean, string]> => {
    if (this.khervePaint === null) {
      return [false, 'KhervePaint could not be found. Install it, or point kherveDOC at it with Locate KhervePaint.']
    }
    this.launched.push(png.replace(/\.png$/, '.svg'))
    return [true, `Opened ${basename(png)} in KhervePaint.`]
  }
}

const run = (w: FakeWindow, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
  new ToolExecutor(w).execute(name, args)

// ── protocol-side tables ───────────────────────────────────────────

describe('tool table', () => {
  it('test_every_tool_has_an_implementation', () => {
    const ex = new ToolExecutor(new FakeWindow()) as unknown as Record<string, unknown>
    for (const t of TOOLS) expect(typeof ex[`t_${t.name}`], t.name).toBe('function')
  })

  it('is the Python table, name for name', () => {
    expect(TOOLS.map(t => t.name)).toEqual([
      'get_document_info', 'get_outline', 'read_blocks', 'get_latex', 'search_text', 'list_references',
      'get_compile_log', 'render_page', 'insert_latex', 'replace_blocks', 'delete_blocks', 'replace_text',
      'set_metadata', 'compile_document', 'save_document', 'open_document', 'new_document', 'insert_equation',
      'insert_chemistry', 'list_drawing_symbols', 'insert_drawing', 'get_drawing', 'update_drawing',
      'open_in_khervepaint', 'export_pdf',
    ])
    const read = TOOLS.find(t => t.name === 'read_blocks')!
    expect(read.input_schema).toEqual({ type: 'object', properties: { start: { type: 'integer' }, end: { type: 'integer' } },
      required: ['start'], additionalProperties: false })
  })

  it('test_access_levels', () => {
    expect(toolAllowed('get_outline', 'read')).toBe(true)
    expect(toolAllowed('insert_latex', 'read')).toBe(false)
    expect(toolAllowed('insert_latex', 'edit')).toBe(true)
    expect(toolAllowed('open_document', 'edit')).toBe(false)
    expect(toolAllowed('open_document', 'full')).toBe(true)
  })

  it('test_tool_categories', () => {
    expect(toolAllowed('get_drawing', 'read')).toBe(true)
    expect(toolAllowed('list_drawing_symbols', 'read')).toBe(true)
    expect(toolAllowed('insert_drawing', 'read')).toBe(false)
    expect(toolAllowed('open_in_khervepaint', 'edit')).toBe(true)
  })
})

// ── tools on a live window ─────────────────────────────────────────

describe('document tools', () => {
  it('test_outline_read_and_insert', async () => {
    const w = new FakeWindow('\\section{Intro}\\label{sec:i}\nHello world.\n\\section{Methods}\nWe did things.')
    const outline = (await run(w, 'get_outline')).blocks as ToolResult[]
    expect(outline.slice(0, 2).map(b => b.type)).toEqual(['Section', 'Paragraph'])
    expect(outline[0].number).toBe('1')
    const r = await run(w, 'insert_latex', { latex: 'New paragraph here.', after: 1 })
    expect(r.inserted_blocks).toBe(1)
    const got = ((await run(w, 'read_blocks', { start: 2 })).blocks as ToolResult[])[0].latex
    expect(got).toContain('New paragraph here.')
  })

  it('test_replace_delete_and_search', async () => {
    const w = new FakeWindow('\\section{A}\nOne.\n\n\\section{B}\nTwo.')
    await run(w, 'replace_blocks', { start: 1, end: 1, latex: 'Uno \\cite{k1}.' })
    expect((await run(w, 'search_text', { query: 'uno' })).count).toBe(1)
    await run(w, 'delete_blocks', { start: 2, end: 3 })
    expect(((await run(w, 'get_outline')).blocks as unknown[]).length).toBe(2)
    const bad = await run(w, 'delete_blocks', { start: 7, end: 9 })
    expect(bad.error).toContain('outside')
  })

  it('test_replace_text_and_metadata', async () => {
    const w = new FakeWindow('Colour and colour.')
    expect((await run(w, 'replace_text', { find: 'colour', replace: 'color' })).replacements).toBe(2)
    await run(w, 'set_metadata', { title: 'T', add_packages: ['siunitx'] })
    const info = await run(w, 'get_document_info')
    expect(info.title).toBe('T')
    expect(info.packages).toContain('siunitx')
    expect((await run(w, 'get_latex')).latex).toContain('\\usepackage{siunitx}')
    expect((await run(w, 'set_metadata', {})).error).toBe('No recognised fields to change.')
  })

  it('test_unsaved_work_is_not_discarded', async () => {
    const w = new FakeWindow('Keep me.')
    await run(w, 'insert_latex', { latex: 'More.' })
    expect((await run(w, 'new_document')).error).toContain('unsaved')
    expect(await run(w, 'new_document', { discard_unsaved_changes: true })).toEqual({ ok: true })
  })

  it('test_save_in_place_needs_a_file', async () => {
    const w = new FakeWindow('x')
    expect((await run(w, 'save_document')).error).toContain('never been saved')
    expect((await run(w, 'save_document', { path: '~/out.pdf' })).error).toContain('.ktex')
    expect(await run(w, 'save_document', { path: '~/doc.ktex' })).toEqual({ saved: '/home/u/doc.ktex' })
  })

  it('reports the document, its words and the last compile', async () => {
    const w = new FakeWindow('\\section{A}\nOne two three.')
    const info = await run(w, 'get_document_info')
    expect(info.blocks).toBe(2)
    expect(info.approx_words).toBe(4)
    expect(info.last_compile).toBe(null)
    expect(info.unsaved_changes).toBe(false)
    expect(Object.keys(info)).toEqual(['path', 'title', 'author', 'documentclass', 'page_size', 'body_font_pt',
      'body_font_family', 'line_spacing', 'margins_cm', 'packages', 'blocks', 'approx_words', 'unsaved_changes',
      'project_open', 'last_compile', 'latex_chars'])
    expect(await run(w, 'get_compile_log')).toEqual({ compiled: false, note: 'Nothing compiled yet — call compile_document.' })
    expect((await run(w, 'render_page', { page: 1 })).error).toBe('No compiled PDF yet — call compile_document.')
    w.last = { ok: true, error: null, pdfPath: '/b/doc.pdf', log: 'a\nb\nc', pdf: new Uint8Array([1]) }
    expect(await run(w, 'get_compile_log', { lines: 2 })).toEqual({ ok: true, error: null, pdf: '/b/doc.pdf', log_tail: 'b\nc' })
    expect(await run(w, 'compile_document')).toEqual({ ok: true, error: null, pages: 1, log_tail: 'a\nb\nc' })
    expect((await run(w, 'render_page', { page: 2 })).error).toBe('Page 2 is outside 1..1.')
    expect((await run(w, 'render_page', { page: 1 })).image_png_base64).toBe('iVBORw==')
  })

  it('refuses paths that are not files, and keeps unsaved work on open', async () => {
    const w = new FakeWindow('x')
    expect((await run(w, 'open_document', { path: '/nope/x.ktex' })).error).toBe('No such file: /nope/x.ktex')
    const f = join(w.images, '..', 'a.tex')
    await writeFile(f, 'x')
    w.dirty = true
    expect((await run(w, 'open_document', { path: f })).error).toContain('unsaved changes')
    expect(await run(w, 'open_document', { path: f, discard_unsaved_changes: true })).toEqual({ opened: f, blocks: 1 })
    expect((await run(w, 'nope')).error).toBe('Unknown tool: nope')
  })
})

// ── equations & chemistry ──────────────────────────────────────────

describe('equations and chemistry', () => {
  it('test_insert_display_and_inline_equation', async () => {
    const w = new FakeWindow('Text.')
    let r = await run(w, 'insert_equation', { latex: '$E = mc^2$', label: 'eq:e' })
    expect(r.typesets_natively && r.numbered).toBe(true)
    const blk = w.doc().children[r.at_index as number] as MathBlock
    expect(blk.type).toBe('MathBlock')
    expect(blk.latex).toBe('E = mc^2')
    expect(blk.label).toBe('eq:e')
    r = await run(w, 'insert_equation', { latex: '\\alpha + 1', display: false, after: -1 })
    const first = w.doc().children[0] as Paragraph
    expect(first.type).toBe('Paragraph')
    expect(first.children[0].type).toBe('MathInline')
    const latex = (await run(w, 'get_latex')).latex as string
    expect(latex).toContain('E = mc^2')
    expect(latex).toContain('\\label{eq:e}')
    expect((await run(w, 'insert_equation', { latex: 'x', display: false, label: 'l' })).error)
      .toBe('Only a display equation can carry a label.')
  })

  it('test_equation_reports_untypeset_parts', async () => {
    const r = await run(new FakeWindow('Text.'), 'insert_equation', { latex: '\\mycustommacro{x} + y' })
    expect(r.typesets_natively).toBe(false)
    expect((r.not_typeset_in_editor as string[]).length).toBeGreaterThan(0)
  })

  it('test_insert_chemistry_adds_mhchem', async () => {
    const w = new FakeWindow('Text.')
    const r = await run(w, 'insert_chemistry', { formula: '2H2 + O2 -> 2H2O' })
    expect(r.mhchem_package_added).toBe(true)
    expect(r.latex).toBe('\\ce{2H2 + O2 -> 2H2O}')
    expect(w.doc().meta.packages).toContain('mhchem')
    const latex = (await run(w, 'get_latex')).latex as string
    expect(latex).toContain('\\usepackage{mhchem}')
    expect(latex).toContain('\\ce{2H2 + O2 -> 2H2O}')
    const r2 = await run(w, 'insert_chemistry', { formula: 'SO4^2-', display: true })
    expect(r2.mhchem_package_added).toBe(false)
    expect(w.doc().children[r2.at_index as number].type).toBe('MathBlock')
  })
})

// ── drawings ───────────────────────────────────────────────────────

describe('drawing tools', () => {
  it('test_list_drawing_symbols', async () => {
    const libs = (await run(new FakeWindow(), 'list_drawing_symbols')).libraries as Record<string, { categories: Record<string, { name: string }[]> }>
    for (const l of ['flowchart', 'electrical', 'optics']) expect(libs).toHaveProperty(l)
    const names = Object.values(libs.optics.categories).flat().map(s => s.name)
    expect(names).toContain('laser')
    expect((await run(new FakeWindow(), 'list_drawing_symbols', { library: 'nope' })).error)
      .toBe('Unknown library; use one of flowchart, electrical, optics, maths, labware, arrows.')
  })

  it('test_insert_drawing_writes_files_and_figure', async () => {
    const w = new FakeWindow('Text.')
    const r = await run(w, 'insert_drawing', { shapes: FLOW, caption: 'Flow', label: 'fig:flow' })
    expect(r.error).toBeUndefined()
    const png = (r.files as Record<string, string>).png
    expect(basename(png)).toBe('drawing_001.png')
    for (const ext of ['.png', '.svg', '.pdf']) expect(statSync(png.replace(/\.png$/, ext)).size).toBeGreaterThan(0)
    const fig = w.doc().children[r.at_index as number] as Figure
    expect(fig.type).toBe('Figure')
    expect(fig.source).toBe('drawing')
    expect(fig.width).toBe('0.7\\textwidth')
    expect(fig.label).toBe('fig:flow')
    const r2 = await run(w, 'insert_drawing', { shapes: FLOW.slice(0, 1) })
    expect(basename((r2.files as Record<string, string>).png)).toBe('drawing_002.png')
  })

  it('test_get_drawing_round_trips', async () => {
    const w = new FakeWindow('Text.')
    const at = (await run(w, 'insert_drawing', { shapes: FLOW })).at_index
    const got = await run(w, 'get_drawing', { index: at })
    const shapes = got.shapes as Record<string, unknown>[]
    expect(shapes.map(s => s.type)).toEqual(['rect', 'rounded_rect', 'arrow', 'text', 'symbol'])
    const rect = shapes[0]
    expect([rect.x, rect.y, rect.w, rect.h]).toEqual([0, 0, 40, 14])
    expect(rect.label).toBe('Start')
    expect(rect.fill).toBe('#eef2f6')
    expect(shapes[4].symbol).toBe('electrical/resistor')
    expect((await run(w, 'get_drawing', { index: 0 })).error).toBeTruthy()
    const raw = await run(w, 'get_drawing', { index: at, include_raw: true })
    expect((raw.raw_items as unknown[]).length).toBe(5)
  })

  it('test_update_drawing_replace_and_append', async () => {
    const w = new FakeWindow('Text.')
    const at = (await run(w, 'insert_drawing', { shapes: FLOW })).at_index
    let r = await run(w, 'update_drawing', { index: at, shapes: FLOW.slice(0, 2) })
    expect(r.items_total).toBe(2)
    expect(w.refreshed.length).toBe(1)
    r = await run(w, 'update_drawing', { index: at, mode: 'append', shapes: [{ type: 'circle', x: 80, y: 20, r: 5 }] })
    expect(r.items_total).toBe(3)
    const shapes = (await run(w, 'get_drawing', { index: at })).shapes as Record<string, unknown>[]
    expect(shapes[shapes.length - 1].type).toBe('circle')
    expect(shapes[shapes.length - 1].r).toBe(5)
    expect((await run(w, 'update_drawing', { index: at, shapes: FLOW, mode: 'x' })).error)
      .toBe('mode must be replace or append.')
  })

  it('test_bad_shape_is_reported', async () => {
    let r = await run(new FakeWindow('Text.'), 'insert_drawing', { shapes: [{ type: 'rect', x: 0 }] })
    expect(r.error).toContain('shapes[0]')
    r = await run(new FakeWindow('Text.'), 'insert_drawing', { shapes: [{ type: 'symbol', symbol: 'optics/nope', x: 0, y: 0 }] })
    expect(r.error).toContain('list_drawing_symbols')
    r = await run(new FakeWindow('Text.'), 'insert_drawing', { shapes: [] })
    expect(r.error).toBe('`shapes` must be a non-empty array.')
  })

  it('test_open_in_khervepaint_tool', async () => {
    const w = new FakeWindow('Text.')
    const at = (await run(w, 'insert_drawing', { shapes: FLOW })).at_index
    const r = await run(w, 'open_in_khervepaint', { index: at })
    expect(String(r.opened).endsWith('.svg')).toBe(true)
    expect(w.launched).toEqual([r.opened])
    w.khervePaint = null
    expect((await run(w, 'open_in_khervepaint', { index: at })).error).toContain('Locate')
  })

  it('test_repeated_calls_do_not_pad_figures', async () => {
    const w = new FakeWindow('Text.')
    await run(w, 'insert_drawing', { shapes: FLOW.slice(0, 1) })
    const n = w.doc().children.length
    await run(w, 'insert_equation', { latex: 'x', after: 0 })
    await run(w, 'insert_equation', { latex: 'y', after: 0 })
    expect(w.doc().children.length).toBe(n + 2)
  })
})

describe('authoring schema', () => {
  it('reads back what it wrote, in millimetres', () => {
    const s = authoringScene()
    expect(addShapes(s, [
      { type: 'line', points: [[0, 0], [10, 5]], dash: 'dash', width: 0.3 },
      { type: 'double_arrow', x1: 0, y1: 10, x2: 20, y2: 10 },
      { type: 'polygon', points: [[0, 0], [10, 0], [5, 8]], fill: 'red', stroke: null },
      { type: 'polyline', points: [[0, 0], [5, 5], [10, 0]] },
      { type: 'circle', x: 5, y: 5, r: 2, opacity: 0.5, rotation: 30 },
    ])).toBe(5)
    const shapes = sceneToShapes(s)
    expect(shapes[0]).toEqual({ type: 'line', points: [[0, 0], [10, 5]], stroke: '#1a1a1a', width: 0.3, dash: 'dash' })
    expect(shapes[1].type).toBe('double_arrow')
    expect(shapes[2]).toEqual({ type: 'polygon', points: [[0, 0], [10, 0], [5, 8]], stroke: null, fill: '#ff0000' })
    expect(shapes[3].type).toBe('polyline')
    expect(shapes[4]).toMatchObject({ type: 'circle', x: 5, y: 5, r: 2, rotation: 30, opacity: 0.5 })
  })

  it('leaves the scene untouched when a shape is bad', () => {
    const s = authoringScene()
    addShapes(s, [{ type: 'rect', x: 0, y: 0, w: 5, h: 5 }])
    expect(() => addShapes(s, [{ type: 'rect', x: 0, y: 0, w: 5, h: 5 }, { type: 'blob' }]))
      .toThrow("shapes[1]: Unknown shape type 'blob'; use one of rect, rounded_rect")
    expect(s.items.length).toBe(1)
    expect(() => addShapes(s, [{ type: 'line', points: [[0, 0], [1, 1], [2, 2]] }])).toThrow('use a polyline for bends')
    expect(() => addShapes(s, [{ type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: 'nocolour' }]))
      .toThrow("Not a colour: 'nocolour' (use #rrggbb).")
    // Appended shapes stay above a loaded drawing.
    addShapes(s, [{ type: 'text', text: 'hi', x: 3, y: 3 }])
    expect(s.items[1].z).toBe(1)
  })
})

// ── the bridge ─────────────────────────────────────────────────────

function liveBridge(w: FakeWindow): McpBridge {
  const shell: BridgeShell = {
    start: async (port) => ({ port: port || 51234, pid: 42, endpoint: '/tmp/ep.json' }),
    stop: async () => {},
    endpointPath: async () => '/tmp/ep.json',
  }
  return new McpBridge(shell, () => w, { version: '0.9', document: () => w.current })
}

describe('bridge', () => {
  it('starts, reports its status and stops', async () => {
    const b = liveBridge(new FakeWindow('x'))
    const ports: number[] = []
    b.onStarted(p => ports.push(p))
    expect(await b.start()).toBe(true)
    expect(ports).toEqual([51234])
    expect(b.port()).toBe(51234)
    expect(await b.handle('get_status', {})).toEqual({ result: {
      app: 'KherveTeX', version: '0.9', pid: 42, access: 'full', document: 'Untitled' } })
    expect(await b.handle('frobnicate', {})).toEqual({ error: "Unknown bridge method: 'frobnicate'" })
    await b.stop()
    expect(b.isRunning()).toBe(false)
  })

  it('test_one_tool_call_is_one_undo_step', async () => {
    const w = new FakeWindow('\\section{A}\nOriginal text.')
    const b = liveBridge(w)
    const reply = JSON.parse(await b.answer({ id: 1, method: 'call_tool',
      params: JSON.stringify({ name: 'replace_text', input: { find: 'Original', replace: 'Changed' } }) }))
    expect(reply.result.replacements).toBe(1)
    expect(JSON.stringify(w.doc())).toContain('Changed')
    expect(b.log.map(e => [e.tool, e.outcome])).toEqual([['replace_text', 'ok']])
  })

  it('test_read_access_refuses_edits', async () => {
    const b = liveBridge(new FakeWindow('x'))
    b.setAccess('read')
    const res = (await b.handle('call_tool', { name: 'insert_latex', input: { latex: 'x' } })) as { result: ToolResult }
    expect(String(res.result.error).startsWith('Refused')).toBe(true)
    const names = new Set(((await b.handle('list_tools', {})) as { result: { name: string }[] }).result.map(t => t.name))
    expect(names.has('insert_latex')).toBe(false)
    expect(names.has('get_outline')).toBe(true)
    expect(b.log[b.log.length - 1]).toMatchObject({ tool: 'insert_latex', outcome: 'refused' })
    expect(() => b.setAccess('root')).toThrow("Unknown access level 'root'")
  })

  it('test_edit_access_refuses_client_chosen_paths', async () => {
    const b = liveBridge(new FakeWindow('x'))
    b.setAccess('edit')
    const res = (await b.handle('call_tool', { name: 'save_document', input: { path: '/tmp/x.ktexz' } })) as { result: ToolResult }
    expect(String(res.result.error)).toContain('Full')
    expect(String(res.result.error)).toBe("Refused: save_document reads or writes a file path you chose, which needs "
      + "MCP access set to 'Full'. The user can change this in AI ▸ Connect to Claude.")
  })

  it('refuses a second call while one runs', async () => {
    const w = new FakeWindow('x')
    let release: () => void = () => {}
    w.compile = () => new Promise(r => { release = () => r(w.last) })
    const b = liveBridge(w)
    const first = b.callTool({ name: 'compile_document', input: {} })
    expect(await b.callTool({ name: 'get_outline', input: {} })).toEqual({
      error: 'KherveTeX is still running the previous tool call. Retry when it finishes.' })
    release()
    expect((await first).error).toContain('did not finish')
    expect(b.log.map(e => e.outcome)[0]).toBe('busy')
  })

  it('reports an exception as the Python bridge does', async () => {
    const w = new FakeWindow('x')
    w.compile = async () => { throw new TypeError('boom') }
    const b = liveBridge(w)
    expect(await b.callTool({ name: 'compile_document' })).toEqual({ error: 'TypeError: boom' })
    expect(await b.callTool({})).toEqual({ error: 'Missing tool name.' })
  })
})

// Keep the fixture honest: the drawing PDF is a real PDF.
it('drawing files are a PDF and an SVG', () => {
  const s = authoringScene()
  addShapes(s, FLOW)
  const f = drawingFiles(s)!
  expect(new TextDecoder().decode(f.pdf.slice(0, 5))).toBe('%PDF-')
  expect(f.svg).toContain('<svg')
})
