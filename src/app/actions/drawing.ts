// Insert ▸ Drawing…, Insert ▸ Flowchart builder… and Picture ▸ Edit
// drawing (DocumentEditor.insert_drawing, insert_flowchart,
// edit_current_figure → _edit_existing_figure). The dialogs and the files
// they write live in src/drawing/.
import * as C from '../../editor/commands'
import { editor } from '../../editor/controller'
import { registerActions } from '../actions'

registerActions({
  drawing: async () => {
    const { insertDrawing } = await import('../../drawing/insert')
    await insertDrawing()
  },
  flowchart: async () => {
    const { insertFlowchart } = await import('../../drawing/insert')
    await insertFlowchart()
  },
  // The selected figure, or the one passed in ({path, source}).
  fig_edit: async (arg?: unknown) => {
    const { editFigure } = await import('../../drawing/insert')
    const given = arg as { path?: string; source?: string } | undefined
    if (given?.path) {
      await editFigure({ path: given.path, source: given.source })
      return
    }
    const e = editor()
    const f = e ? C.currentFigure(e.view.state) : null
    if (!e || !f) return
    const source = await editFigure({ path: String(f.node.attrs.path ?? ''), source: String(f.node.attrs.source ?? '') })
    // A legacy drawing now has its SVG/PDF too, so LaTeX gets vectors.
    if (source !== null && f.node.attrs.source !== source) e.run(C.setFigureAttrs({ source }))
  },
})
