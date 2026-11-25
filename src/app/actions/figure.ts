// Insert ▸ Figure and the Picture tab: alignment, width, edit and delete
// (DocumentEditor.insert_figure, set_figure_alignment, set_figure_width,
// _edit_existing_figure, delete_current_figure).
import * as M from '../../core/model.ts'
import { escapeText } from '../../core/serializer.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import { platform } from '../../platform/index.ts'
import { information } from '../../platform/MessageBox.tsx'
import { figureDialog } from '../../ui/dialogs/EditorDialogs.tsx'
import { hasAction, registerActions, type Handler } from '../actions.ts'

const run = (cmd: C.Command): boolean => editor()?.run(cmd) ?? false
const sync = () => editor()?.syncToolbar()

async function browse(): Promise<string | null> {
  try {
    const r = await platform().openFileDialog({
      title: 'Select image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'svg'] }, { name: 'All', extensions: ['*'] }],
    })
    return r?.[0] ?? null
  } catch {
    return null
  }
}

const actions: Record<string, Handler> = {
  figure: async () => {
    const pics = await import('../pictures.ts')
    const { setPictureDropTarget } = await import('../pictureDrop.ts')
    const r = await figureDialog({ browse, pictures: { register: setPictureDropTarget, read: pics.pictureFromPath } })
    if (!r || !r.path) return
    // The picture is kept in the document (its figures folder, saved inside
    // the .ktex), not linked where it was found.
    const kept = r.picture ? await pics.savePicture(r.picture).catch(() => null) : await pics.adoptPicturePath(r.path)
    if (r.picture && !kept) { await information('Insert figure', 'That picture could not be read.'); return }
    run(C.insertModelBlocks([M.figure({
      path: kept?.path ?? r.path, caption: escapeText(r.caption), label: r.label || null, width: kept?.width ?? '0.8\\textwidth',
    })], { select: 0, trailingParagraph: true }))
    sync()
  },
  fig_left: () => { run(C.setFigureAttrs({ align: 'left' })); sync() },
  fig_center: () => { run(C.setFigureAttrs({ align: 'center' })); sync() },
  fig_right: () => { run(C.setFigureAttrs({ align: 'right' })); sync() },
  fig_delete: () => { run(C.deleteFigure); sync() },
}
for (const f of [0.25, 0.5, 0.75, 1]) actions[`fig_w${f * 100}`] = () => { run(C.setFigureWidth(f)) }

registerActions(actions)

// _edit_existing_figure: drawings and flowcharts reopen their editor where
// src/drawing registers fig_edit; any other picture cannot be re-edited.
async function editFigure(): Promise<void> {
  const e = editor()
  if (!e || !C.currentFigure(e.view.state)) return
  await information('Cannot re-edit',
    'This figure was not created with the drawing tool, or its drawing data is missing.')
}

setTimeout(() => { if (!hasAction('fig_edit')) registerActions({ fig_edit: editFigure }) }, 0)
