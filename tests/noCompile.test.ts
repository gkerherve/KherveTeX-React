// Do not compile (editor/noCompile.ts): the selected blocks go between
// not-compile markers, and come back with the same command.
import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import * as M from '../src/core/model.ts'
import { NOT_COMPILE_END, NOT_COMPILE_START, applyNotCompileRanges } from '../src/core/compiler.ts'
import { docFromPM, docToPM } from '../src/editor/convert.ts'
import { selectionHidden, toggleNoCompile } from '../src/editor/noCompile.ts'
import { serializeDocument } from '../src/core/serializer.ts'

const p = (s: string) => M.paragraph([M.text(s)])
const names = (s: EditorState) => docFromPM(s.doc, M.docMeta()).children.map(b =>
  b.type === 'RawLatex' ? (b.text === NOT_COMPILE_START ? '[' : b.text === NOT_COMPILE_END ? ']' : 'raw')
    : (b as M.Paragraph).children.map(i => (i as M.Text).text).join(''))
const pos = (s: EditorState, n: number) => { let at = 0; s.doc.forEach((_n, o, i) => { if (i === n) at = o + 2 }); return at }
const select = (s: EditorState, a: number, b = a) => s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos(s, a), pos(s, b))))
const run = (s: EditorState) => { let out = s; toggleNoCompile(s, tr => { out = s.apply(tr) }); return out }
const start = () => EditorState.create({ doc: docToPM(M.document([p('A'), p('B'), p('C'), p('D')])) })

describe('do not compile', () => {
  it('puts the selected paragraphs between markers, and the preview leaves them out', () => {
    const s = run(select(start(), 1, 2))
    expect(names(s)).toEqual(['A', '[', 'B', 'C', ']', 'D'])
    expect(selectionHidden(select(s, 2))).toBe(true)
    expect(selectionHidden(select(s, 0))).toBe(false)
    const tex = applyNotCompileRanges(serializeDocument(docFromPM(s.doc, M.docMeta())))
    const hidden = tex.slice(tex.indexOf('\\iffalse'), tex.indexOf('\\fi', tex.indexOf('\\iffalse')))
    expect(tex).toContain('\\fi')
    const words = (w: string) => new RegExp(`(^|\\n)${w}(\\n|$)`).test(hidden)
    expect(words('B')).toBe(true)
    expect(words('C')).toBe(true)
    expect(words('A')).toBe(false)
    expect(words('D')).toBe(false)
  })

  it('brings one paragraph back, keeping the rest hidden', () => {
    let s = run(select(start(), 1, 2))
    s = run(select(s, 2))  // B
    expect(names(s)).toEqual(['A', 'B', '[', 'C', ']', 'D'])
    s = run(select(s, 3))  // C
    expect(names(s)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('joins a new hidden part to the ones next to it', () => {
    let s = run(select(start(), 1))  // B
    expect(names(s)).toEqual(['A', '[', 'B', ']', 'C', 'D'])
    s = run(select(s, 5))  // D
    expect(names(s)).toEqual(['A', '[', 'B', ']', 'C', '[', 'D', ']'])
    s = run(select(s, 4))  // C, between the two
    expect(names(s)).toEqual(['A', '[', 'B', 'C', 'D', ']'])
  })
})
