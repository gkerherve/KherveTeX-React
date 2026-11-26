// A box (theorem, callout) is a run of its paragraphs, the first marked as
// its start, which carries the title bar. Deleting that first line left a
// box with no start: the page drew it without its title while the PDF (the
// serializer starts a box there anyway) printed one. After every change, a
// box paragraph with nothing of its kind before it becomes the start.
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'

export function boxStartPlugin(): Plugin {
  return new Plugin({
    appendTransaction: (trs, _old, state) => {
      if (!trs.some(t => t.docChanged)) return null
      let tr = state.tr
      let prev: PMNode | null = null
      state.doc.forEach((node, pos) => {
        if (node.type.name === 'theorem' && !node.attrs.start
          && !(prev && prev.type.name === 'theorem' && prev.attrs.kind === node.attrs.kind)) {
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, start: true })
        }
        prev = node
      })
      // In the history with the change that caused it: undo restores both.
      return tr.docChanged ? tr : null
    },
  })
}
