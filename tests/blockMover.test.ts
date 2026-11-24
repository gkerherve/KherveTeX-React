// Moving boxes and tables (blockMover.ts, C.moveBlock) and leaving a box
// with Cmd/Ctrl+Enter or Shift+Enter.
import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import * as M from '../src/core/model.ts'
import * as C from '../src/editor/commands.ts'
import { docFromPM, docToPM } from '../src/editor/convert.ts'
import { keyCommands } from '../src/editor/keymap.ts'
import { blockUnits, moveBlocks } from '../src/editor/blockMover.ts'

const t = (s: string) => [M.text(s)]
const doc = () => M.document([
  M.paragraph(t('A')),
  M.theorem('note', '', t('B1')), M.theorem('note', '', t('B2'), false),
  M.paragraph(t('C')),
  M.table({ rows: [['x', 'y']] }),
  M.paragraph(t('D')),
])
const names = (s: EditorState) => docFromPM(s.doc, M.docMeta()).children.map(b =>
  b.type === 'Table' ? 'T' : 'children' in b ? (b.children as M.Inline[]).map(i => (i as M.Text).text).join('') : b.type)
// The caret at the start of the n-th top-level block.
const at = (s: EditorState, n: number) => {
  let pos = 0
  s.doc.forEach((_n, p, i) => { if (i === n) pos = p })
  return s.apply(s.tr.setSelection(TextSelection.near(s.doc.resolve(pos + 1))))
}
const run = (s: EditorState, c: C.Command) => { let out = s; c(s, tr => { out = s.apply(tr) }); return out }

describe('moving boxes and tables', () => {
  const s0 = EditorState.create({ doc: docToPM(doc()) })

  it('groups a box as one movable unit, and a table', () => {
    const u = blockUnits(s0)
    expect(u.map(x => x.movable)).toEqual([false, true, false, true, false])
  })

  it('moves a whole box down past the next block', () => {
    expect(names(run(at(s0, 1), C.moveBlock(1)))).toEqual(['A', 'C', 'B1', 'B2', 'T', 'D'])
  })

  it('moves a table up', () => {
    expect(names(run(at(s0, 4), C.moveBlock(-1)))).toEqual(['A', 'B1', 'B2', 'T', 'C', 'D'])
  })

  it('drags a box to the end of the document', () => {
    const u = blockUnits(s0)[1]
    const tr = moveBlocks(s0, u.from, u.to, s0.doc.content.size)!
    expect(names(s0.apply(tr))).toEqual(['A', 'C', 'T', 'D', 'B1', 'B2'])
  })

  it('does nothing when dropped where it is', () => {
    const u = blockUnits(s0)[1]
    expect(moveBlocks(s0, u.from, u.to, u.from)).toBeNull()
    expect(moveBlocks(s0, u.from, u.to, u.to)).toBeNull()
  })

  it('Cmd/Ctrl+Enter and Shift+Enter in a box start a paragraph after it', () => {
    const keys = keyCommands({ run: () => true })
    for (const k of ['Mod-Enter', 'Shift-Enter']) {
      const s = run(at(s0, 1), keys[k])
      const d = docFromPM(s.doc, M.docMeta()).children
      expect(d[3]).toMatchObject({ type: 'Paragraph' })
      expect(names(s)).toEqual(['A', 'B1', 'B2', '', 'C', 'T', 'D'])
      expect(s.selection.$from.parent.type.name).toBe('paragraph')
    }
  })
})
