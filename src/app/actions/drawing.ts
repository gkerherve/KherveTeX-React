// Insert ▸ Drawing…, Insert ▸ Flowchart builder… and Picture ▸ Edit
// drawing (DocumentEditor.insert_drawing, insert_flowchart,
// edit_current_figure → _edit_existing_figure). The dialogs and the files
// they write live in src/drawing/.
import * as C from '../../editor/commands'
import { editor } from '../../editor/controller'
import { registerActions } from '../actions'
import * as P from '../../core/paintModel'

registerActions({
  drawing: async () => {
    const { insertDrawing } = await import('../../drawing/insert')
    await insertDrawing()
  },
  chart: async () => {
    const { insertChart } = await import('../../drawing/insert')
    await insertChart()
  },
  screenshot: async () => {
    const { insertScreenshot } = await import('../../drawing/insert')
    await insertScreenshot()
  },
  shapes: () => {},
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

// Insert ▸ Shapes: the drawing opens on that shape's tool.
const SHAPE_TOOLS: Record<string, string> = {
  line: P.LINE, arrow: P.ARROW, rect: P.RECT, roundrect: P.ROUNDRECT, ellipse: P.ELLIPSE, circle: P.CIRCLE,
  triangle: P.TRIANGLE, right_triangle: P.RIGHT_TRIANGLE, diamond: P.DIAMOND, parallelogram: P.PARALLELOGRAM,
  trapezoid: P.TRAPEZOID, pentagon: P.PENTAGON, hexagon: P.HEXAGON, octagon: P.OCTAGON, halfcircle: P.HALFCIRCLE,
  block_arrow: P.ARROW_RIGHT, chevron: P.CHEVRON, star: P.STAR, star6: P.STAR6, plus: P.PLUS, lightning: P.LIGHTNING,
  house: P.HOUSE, text: P.TEXT,
}
const shapeActions: Record<string, () => Promise<void>> = {}
for (const [k, tool] of Object.entries(SHAPE_TOOLS)) {
  shapeActions[`shape:${k}`] = async () => {
    const { insertDrawing } = await import('../../drawing/insert')
    await insertDrawing({ tool }, 'Shape')
  }
}
registerActions(shapeActions)
