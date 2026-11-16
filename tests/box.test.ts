/// <reference lib="dom" />
// A framed paragraph (\fbox{\parbox{..}{..}}) is a block of its own: it
// reads in from LaTeX, writes back out, shows as a frame in the visual
// editor and exports to Word and Typst.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { importBodyFragment, importTex } from '../src/core/importers.ts'
import { serializeBlock, serializeDocument } from '../src/core/serializer.ts'
import { serializeBlock as typstBlock } from '../src/core/typstSerializer.ts'
import { canonicalBlock, docFromPM, docToPM } from '../src/editor/convert.ts'
import { schema, STYLED_TEXT } from '../src/editor/schema.ts'

const body = (src: string) => importTex(`\\documentclass{article}\\begin{document}\n${src}\n\\end{document}\n`).children

describe('Box block', () => {
  it('serializes as an fbox around a parbox', () => {
    const tex = serializeBlock(M.box([M.text('STOP.', ['bold']), M.text(' Never abort.')]))
    expect(tex).toBe('\\medskip\\noindent\\fbox{\\parbox{0.95\\linewidth}{\\textbf{STOP.} Never abort.}}\n')
  })

  it('imports \\fbox{\\parbox{..}{..}} as a Box, with or without \\medskip\\noindent', () => {
    for (const head of ['', '\\noindent', '\\medskip\\noindent', '\\medskip ']) {
      const blocks = body(`${head}\\fbox{\\parbox{0.95\\linewidth}{\\textbf{STOP.} Read {this} first.}}`)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('Box')
      const kids = (blocks[0] as M.Box).children
      expect(kids[0]).toEqual(M.text('STOP.', ['bold']))
    }
  })

  it('reads a boxed paragraph out of a body fragment (what the MCP insert_latex sends)', () => {
    const blocks = importBodyFragment(
      'Intro.\n\n\\medskip \\fbox{\\parbox{0.95\\linewidth}{\\textbf{STOP.} Never abort.}}\n\nAfter.')
    expect(blocks.map((b) => b.type)).toEqual(['Paragraph', 'Box', 'Paragraph'])
  })

  it('leaves a paragraph with other text around the frame alone', () => {
    const blocks = body('Before \\fbox{\\parbox{3cm}{x}} after')
    expect(blocks.every((b) => b.type !== 'Box')).toBe(true)
  })

  it('round-trips through LaTeX', () => {
    const doc = M.document([M.paragraph([M.text('a')]), M.box([M.text('boxed ', ['italic']), M.text('text')])])
    const again = importTex(serializeDocument(doc))
    const boxes = again.children.filter((b) => b.type === 'Box') as M.Box[]
    expect(boxes).toHaveLength(1)
    expect(boxes[0].children).toEqual(doc.children[1] && (doc.children[1] as M.Box).children)
  })

  it('round-trips through the visual editor and is a styled text block', () => {
    expect(STYLED_TEXT.has('box')).toBe(true)
    const doc = M.document([M.box([M.text('framed')])])
    const pm = docToPM(doc)
    expect(pm.firstChild!.type).toBe(schema.nodes.box)
    expect(canonicalBlock(pm.firstChild!)).toEqual(M.box([M.text('framed')]))
    expect(M.toJson(docFromPM(pm, doc.meta))).toBe(M.toJson(doc))
  })

  it('reads back from JSON', () => {
    const doc = M.document([M.box([M.text('j')])])
    expect(M.fromJson(M.toJson(doc)).children[0]).toEqual(M.box([M.text('j')]))
  })

  it('exports to Typst with a stroke', () => {
    expect(typstBlock(M.box([M.text('t')]))).toContain('stroke: 0.5pt')
  })
})
