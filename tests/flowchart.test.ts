// Ported from ../KherveTeX/tests/test_flowchart.py (same test names): the
// flowchart model and its TikZ, Figure.source == "flowchart" in the
// serializers, the builder's box text and the figure files.
import { describe, expect, it } from 'vitest'
import {
  colours, DEFAULT_SCHEME, Flowchart, makeNode, SCHEME_NAMES, standaloneDoc, templateSimple, TEMPLATES,
  TIKZ_LIBRARIES, toTikz, autoLayout,
} from '../src/core/flowchart.ts'
import { figure, document, fromJson, toJson } from '../src/core/model.ts'
import { serializeBlock } from '../src/core/serializer.ts'
import { serializeBlock as typstBlock } from '../src/core/typstSerializer.ts'
import { prettyInlineHtml } from '../src/drawing/flowGeometry.ts'
import {
  flowchartSourceFor, naturalWidthFromPoints, nextFlowchartPath, flowchartSiblings,
} from '../src/core/drawingFiles.ts'

describe('the model', () => {
  it('test_add_chains_and_connects', () => {
    const fc = new Flowchart()
    const a = fc.add('terminal', 'Start')
    const b = fc.add('process', '', a.id)
    const c = fc.add('decision', 'OK?', b.id, '')
    expect([b.x, b.y]).toEqual([0, 1])
    expect([c.x, c.y]).toEqual([0, 2])
    expect(fc.edges.map(e => [e.src, e.dst])).toEqual([[a.id, b.id], [b.id, c.id]])
    expect(b.text).toBe('Process')                 // the shape's name by default
    const d = fc.add('process', 'side', b.id)      // spot taken: sidesteps
    expect([d.x, d.y]).toEqual([1, 2])
    expect(fc.connect(a.id, a.id)).toBeNull()      // no self-loops
    expect(fc.connect(a.id, b.id)).toBe(fc.edges[0])   // no duplicates
    fc.remove(b.id)
    expect(fc.node(b.id)).toBeNull()
    expect(fc.edges.every(e => e.src !== b.id && e.dst !== b.id)).toBe(true)
  })

  it('test_left_to_right_and_json_round_trip', () => {
    const fc = new Flowchart({ direction: 'LR' })
    const a = fc.add('database', 'Data')
    const b = fc.add('process', 'Clean', a.id)
    expect([b.x, b.y]).toEqual([1, 0])
    fc.edges[0].label = 'raw'
    fc.nodes[0].fill = '#FF0000'
    const back = Flowchart.fromJson(fc.toJson())
    expect(back.toJson()).toBe(fc.toJson())
    expect(back.nodes).toEqual(fc.nodes)
    expect(back.edges).toEqual(fc.edges)
  })

  it('test_tikz_shapes_routes_and_colours', () => {
    const fc = TEMPLATES['Algorithm (sum to n)']()
    expect(new Set(fc.nodes.map(n => n.id)).size).toBe(fc.nodes.length)   // unique ids
    const tikz = toTikz(fc)
    expect(tikz.split('\\node[').length - 1).toBe(fc.nodes.length)
    expect(tikz.split('\\draw[').length - 1).toBe(fc.edges.length)
    expect(tikz).toContain('diamond')
    expect(tikz).toContain('trapezium')
    expect(tikz).toContain('rounded rectangle')
    expect(tikz).toContain('{HTML}{1F4E79}')     // the default (Blue) scheme
    expect(tikz).toContain('node[pos=0.25')
    expect(tikz).toContain('{Yes}')
    // the loop back to the decision goes round the left side
    expect(tikz).toContain('.west) -- ++(-1.9,0)')
    const doc = standaloneDoc(fc)
    for (const lib of TIKZ_LIBRARIES) expect(doc).toContain(lib)
    expect(doc.startsWith('\\documentclass[border=4pt]{standalone}')).toBe(true)
    for (const [name, make] of Object.entries(TEMPLATES)) expect(make().nodes.length, name).toBeGreaterThan(0)
  })

  it('test_default_scheme_and_kherveslide_charts', () => {
    // No presentation in KherveTeX: the schemes are the fixed ones, and a
    // chart made in KherveSlide with "Presentation colours" still draws.
    expect(SCHEME_NAMES).not.toContain('Presentation colours')
    expect(new Flowchart().scheme).toBe(DEFAULT_SCHEME)
    expect(DEFAULT_SCHEME).toBe(SCHEME_NAMES[0])
    const slide = new Flowchart({ scheme: 'Presentation colours' })
    expect(colours(slide)).toEqual(colours(new Flowchart()))
    expect(colours(new Flowchart({ scheme: 'Green' })).terminal[0]).toBe('#2E6B30')
  })

  it('test_arrowheads_lines_and_chosen_sides', () => {
    const fc = new Flowchart()
    const a = fc.add('process', 'A')
    const b = fc.add('process', 'B', a.id)
    const e = fc.edges[0]
    expect([e.head, e.src_side, e.dst_side]).toEqual(['end', 'auto', 'auto'])
    expect(toTikz(fc)).toContain('\\draw[line, ->]')
    e.head = 'both'
    expect(toTikz(fc)).toContain('\\draw[line, <->]')
    e.head = 'none'                            // a plain line
    e.dashed = true
    expect(toTikz(fc)).toContain('\\draw[line, -, dashed]')
    e.head = 'start'
    e.dashed = false
    expect(toTikz(fc)).toContain('\\draw[line, <-]')
    // leave from the right, come back into the right: stub then |-
    e.src_side = e.dst_side = 'east'
    expect(toTikz(fc)).toContain(`(${a.id}.east) -- ++(0.35,0) |- (${b.id}.east);`)
    e.dst_side = 'north'                       // into the top: -|
    expect(toTikz(fc)).toContain(`(${a.id}.east) -- ++(0.35,0) -| (${b.id}.north);`)
    e.route = 'straight'
    expect(toTikz(fc)).toContain(`(${a.id}.east) -- ++(0.35,0) -- (${b.id}.north);`)
    const back = Flowchart.fromJson(fc.toJson())
    expect(back.toJson()).toBe(fc.toJson())
    expect(back.edges[0].head).toBe('start')
    // charts saved before these options still load
    const d = JSON.parse(fc.toJson())
    for (const k of ['head', 'src_side', 'dst_side']) delete d.edges[0][k]
    const old = Flowchart.fromJson(JSON.stringify(d))
    expect([old.edges[0].head, old.edges[0].src_side]).toEqual(['end', 'auto'])
  })

  it('test_curved_links', () => {
    const fc = new Flowchart()
    const a = fc.add('process', 'A')
    const b = fc.add('process', 'B', a.id)
    const e = fc.edges[0]
    e.route = 'curve'
    expect(toTikz(fc)).toContain(`(${a.id}) to[bend left=30] (${b.id});`)
    e.bend = -45
    expect(toTikz(fc)).toContain(`(${a.id}) to[bend right=45] (${b.id});`)
    e.bend = 0                                 // no bow: a straight line
    expect(toTikz(fc)).toContain(`(${a.id}) -- (${b.id});`)
    e.src_side = 'east'
    e.dst_side = 'north'                       // follows both sides
    expect(toTikz(fc)).toContain(`(${a.id}.east) to[out=0, in=90] (${b.id}.north);`)
    e.label = 'loop'
    expect(toTikz(fc)).toContain('to[out=0, in=90] node[pos=0.25')
    expect(Flowchart.fromJson(fc.toJson()).edges[0].bend).toBe(0)
  })

  it('test_auto_layout_ranks_by_path', () => {
    const fc = new Flowchart()
    for (const nid of ['a', 'b', 'c', 'd']) fc.nodes.push(makeNode(nid, 'process', nid, 5, 5, '', { x: false, y: false }))
    fc.connect('a', 'b'); fc.connect('a', 'c'); fc.connect('b', 'd')
    fc.connect('c', 'd'); fc.connect('d', 'a')          // a loop back
    autoLayout(fc)
    expect(Object.fromEntries(fc.nodes.map(n => [n.id, n.y]))).toEqual({ a: 0, b: 1, c: 1, d: 2 })
    const xs = fc.nodes.filter(n => 'bc'.includes(n.id)).map(n => n.x).sort((p, q) => p - q)
    expect(xs).toEqual([-0.5, 0.5])                    // spread around 0
  })
})

describe('Figure.source == "flowchart"', () => {
  it('test_flowchart_figure_source_round_trips', () => {
    const doc = document([figure({ path: 'figures/flowchart_001.png', source: 'flowchart' })])
    expect((fromJson(toJson(doc)).children[0] as { source: string }).source).toBe('flowchart')
  })

  it('test_latex_uses_the_flowchart_pdf_and_typst_its_png', () => {
    const fig = figure({ path: 'figures\\flowchart_001.png', source: 'flowchart' })
    expect(serializeBlock(fig)).toContain('{figures/flowchart_001.pdf}')
    // there is no SVG of a flowchart: Typst keeps the preview
    expect(typstBlock(fig)).toContain('image("figures/flowchart_001.png"')
  })
})

describe('the builder and the editor', () => {
  it('test_box_text_renders_maths_and_escapes', () => {
    const out = prettyInlineHtml('$i \\le n$? 50\\% -- <ok>')
    expect(out).toContain('≤')
    expect(out).toContain('<i>')
    expect(out).toContain('50%')
    expect(out).toContain('–')
    expect(out).toContain('&lt;ok&gt;')
    expect(prettyInlineHtml('$x^2$')).toContain('<sup>2</sup>')
    expect(prettyInlineHtml('$a_{ij}$')).toContain('<sub>ij</sub>')
  })

  it('test_flowchart_files_and_width', async () => {
    const files = new Set<string>()
    const exists = async (p: string) => files.has(p)
    const path = await nextFlowchartPath('/tmp/x', exists)
    expect(path).toBe('/tmp/x/flowchart_001.png')
    const sib = flowchartSiblings(path)
    for (const p of [sib.png, sib.pdf, sib.json, sib.tikz]) files.add(p)
    expect(sib.json).toBe('/tmp/x/flowchart_001.flow.json')
    expect(sib.tikz).toBe('/tmp/x/flowchart_001.tikz')
    expect(await flowchartSourceFor(path, exists)).toBe(sib.json)
    expect(await flowchartSourceFor('/tmp/x/photo.png', exists)).toBeNull()
    expect(await nextFlowchartPath('/tmp/x', exists)).toBe('/tmp/x/flowchart_002.png')
    // 283 pt ≈ 10 cm of a 15 cm text block
    expect(naturalWidthFromPoints(283)).toBe('0.67\\textwidth')
    expect(naturalWidthFromPoints(2000)).toBe('1\\textwidth')
    expect(templateSimple().nodes.length).toBe(4)
  })
})
