import { describe, expect, test } from 'vitest'
import * as M from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { inkPreamble, thin } from '../src/core/ink.ts'

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
