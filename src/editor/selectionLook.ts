// The selection drawn over everything it covers, as Word does: the
// browser highlights only text, so a Select All left drawings, elements,
// equations, figures, tables and box title bars looking unselected.
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export function selectionLookPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { from, to, empty } = state.selection
        if (empty) return null
        const decos: Decoration[] = []
        state.doc.forEach((node, pos) => {
          const end = pos + node.nodeSize
          // Wholly inside the selection, and more than one block selected
          // (one block alone is the browser's own highlight).
          if (pos >= from - 1 && end <= to + 1 && (to - from) > node.nodeSize - 2 && !(pos <= from && end >= to)) {
            decos.push(Decoration.node(pos, end, { class: 'kt-sel-block' }))
          }
        })
        return decos.length ? DecorationSet.create(state.doc, decos) : null
      },
    },
  })
}
