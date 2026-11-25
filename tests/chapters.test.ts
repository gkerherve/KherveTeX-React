// Chapters (editor/chapters.ts): found at the top heading level, left out
// of the compile, moved, and folded.
import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import * as M from '../src/core/model.ts'
import { NOT_COMPILE_END, NOT_COMPILE_START } from '../src/core/compiler.ts'
import { docFromPM, docToPM } from '../src/editor/convert.ts'
import { chapters, chaptersPlugin, foldedChapters, moveChapter, setChapterCompiled, setChapterFolded } from '../src/editor/chapters.ts'

const p = (s: string) => M.paragraph([M.text(s)])
const h = (s: string, level = 1) => M.section(level, [M.text(s)])
const start = () => EditorState.create({
  doc: docToPM(M.document([p('Front'), h('One'), p('a1'), h('Sub', 2), p('a2'), h('Two'), p('b1'), h('Three'), p('c1')])),
  plugins: [chaptersPlugin()],
})
const run = (s: EditorState, c: (st: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean) => {
  let out = s
  c(s, tr => { out = s.apply(tr) })
  return out
}
const names = (s: EditorState) => docFromPM(s.doc, M.docMeta()).children.map(b =>
  b.type === 'RawLatex' ? (b.text === NOT_COMPILE_START ? '[' : b.text === NOT_COMPILE_END ? ']' : 'raw')
    : (b as M.Paragraph).children.map(i => (i as M.Text).text).join(''))

describe('chapters', () => {
  it('are the top-level headings, each up to the next', () => {
    const list = chapters(start().doc)
    expect(list.map(c => c.title)).toEqual(['One', 'Two', 'Three'])
    expect(list[0].paragraphs).toBe(2)  // a1, a2; the subheading is not counted
  })

  it('can be left out of the compile and put back', () => {
    let s = run(start(), setChapterCompiled(1, false))
    expect(names(s)).toEqual(['Front', 'One', 'a1', 'Sub', 'a2', '[', 'Two', 'b1', ']', 'Three', 'c1'])
    expect(chapters(s.doc).map(c => c.compiled)).toEqual([true, false, true])
    s = run(s, setChapterCompiled(1, true))
    expect(names(s)).toEqual(['Front', 'One', 'a1', 'Sub', 'a2', 'Two', 'b1', 'Three', 'c1'])
  })

  it('moves with its not-compile markers', () => {
    let s = run(start(), setChapterCompiled(1, false))
    s = run(s, moveChapter(1, 0))
    expect(names(s)).toEqual(['Front', '[', 'Two', 'b1', ']', 'One', 'a1', 'Sub', 'a2', 'Three', 'c1'])
    s = run(s, moveChapter(0, null))
    expect(chapters(s.doc).map(c => c.title)).toEqual(['One', 'Three', 'Two'])
  })

  it('fold in the editor only', () => {
    const s = run(start(), setChapterFolded('Two', true))
    expect([...foldedChapters(s)]).toEqual(['Two'])
    expect(names(s)).toEqual(names(start()))
  })
})
