import { describe, expect, it, test } from 'vitest'
import * as M from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { inkPreamble, placeInk, thin, type InkStroke } from '../src/core/ink.ts'

describe('Draw tab ink', () => {
  test('no ink writes nothing', () => {
    expect(inkPreamble(undefined)).toBe('')
    expect(serializeDocument(M.document([], M.docMeta()))).not.toContain('kInkPage')
  })
  test('strokes print on their page, in mm from the top-left corner', () => {
    const tex = serializeDocument(M.document([], M.docMeta({ ink: [
      { page: 2, color: '#E81123', width: 1, pts: [25, 30, 60, 40] },
      { page: 1, color: '#FFFF00', width: 6, alpha: 0.4, pts: [10, 10, 50, 10] },
    ] })))
    expect(tex).toContain('\\ifnum\\value{kInkPage}=2\\relax \\draw[line width=1pt')
    expect(tex).toContain('(25mm,-30mm)--(60mm,-40mm)')
    expect(tex).toContain('opacity=0.4')
  })
  test('ink survives a save and load', () => {
    const m = M.docMeta({ ink: [{ page: 1, color: '#000000', width: 1, pts: [1, 2, 3, 4] }] })
    expect(M.fromJson(M.toJson(M.document([], m))).meta.ink).toEqual(m.ink)
  })
  test('thin keeps the ends', () => {
    const t = thin([0, 0, 0.1, 0, 0.2, 0, 5, 5])
    expect(t.slice(0, 2)).toEqual([0, 0])
    expect(t.slice(-2)).toEqual([5, 5])
  })
})

describe('ink anchored to a word', () => {
  const stroke = (offset: number): InkStroke => ({ page: 1, color: '#E81123', width: 1, pts: [10, 20, 12, 22], anchor: { block: 0, offset, x: 9, y: 21 } })

  it('puts \\kInk at the word and draws relative to it', () => {
    const doc = M.document([M.paragraph([M.text('Click the '), M.text('gives', ['bold']), M.text(' word')])] as M.Block[])
    doc.meta.ink = [stroke(10)]
    const tex = serializeDocument(doc)
    expect(tex).toContain('Click the \\kInk{0}\\textbf{gives} word')
    expect(tex).toContain('\\csname kInkStroke0\\endcsname{\\begin{tikzpicture}[overlay]')
    expect(tex).toContain('(1mm,1mm)--(3mm,-1mm)')
    expect(tex).not.toContain('kInkPage')
  })

  it('falls back to the page when the paragraph is gone', () => {
    const doc = M.document([M.section(1, [M.text('Title')], true, null)] as M.Block[])
    doc.meta.ink = [stroke(2)]
    const tex = serializeDocument(doc)
    expect(tex).toContain('kInkPage')
    expect(tex).not.toContain('\\kInk{')
  })

  it('splits a text run inside a highlight', () => {
    const { blocks, placed } = placeInk([M.paragraph([M.text('ab'), M.highlight([M.text('cdef')], 'yellow')])] as M.Block[], [stroke(4)])
    expect(placed.has(0)).toBe(true)
    expect(JSON.stringify(blocks[0])).toContain('"text":"cd","marks":[],"type":"Text"},{"latex":"\\\\kInk{0}"')
  })
})
