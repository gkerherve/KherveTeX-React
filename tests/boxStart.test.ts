// A box whose first line was deleted keeps its title (editor/boxStart.ts).
import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import * as M from '../src/core/model.ts'
import { docToPM } from '../src/editor/convert.ts'
import { boxStartPlugin } from '../src/editor/boxStart.ts'

describe('box start', () => {
  it('the line after a deleted first line starts the box', () => {
    const doc = docToPM(M.document([M.paragraph([M.text('Before')]),
      M.theorem('warning', '', [M.text('first')], true), M.theorem('warning', '', [M.text('second')], false)]))
    let s = EditorState.create({ doc, plugins: [boxStartPlugin()] })
    let at = 0
    s.doc.forEach((n, p) => { if (n.textContent === 'first') at = p })
    const n = s.doc.nodeAt(at)!
    s = s.applyTransaction(s.tr.delete(at, at + n.nodeSize)).state
    const box: boolean[] = []
    s.doc.forEach(nd => { if (nd.type.name === 'theorem') box.push(nd.attrs.start) })
    expect(box).toEqual([true])
  })
})
