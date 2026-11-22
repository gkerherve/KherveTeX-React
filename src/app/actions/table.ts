// Insert ▸ Table and the Table Design / Table Layout tabs
// (MainWindow._build_context_actions over DocumentEditor's table tools),
// and Insert Caption for tables and pictures.
import { escapeText } from '../../core/serializer.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import { information } from '../../platform/MessageBox.tsx'
import { captionDialog, insertTableDialog } from '../../ui/dialogs/EditorDialogs.tsx'
import { registerActions, type Handler } from '../actions.ts'
import { appStore } from '../store.ts'

const run = (cmd: C.Command): boolean => editor()?.run(cmd) ?? false
const sync = () => editor()?.syncToolbar()
const act = (cmd: C.Command): Handler => () => { run(cmd); sync() }

// The colour the Shading button applies (MainWindow._last_shading).
let lastShading = '#ffeb3b'

export const SHADES: [string, string][] = [['#ffeb3b', 'Yellow'], ['#fde2e1', 'Light red'], ['#dff0d8', 'Light green'],
  ['#dce8f7', 'Light blue'], ['#eeeeee', 'Grey'], ['#fff2cc', 'Cream']]

function shade(color: string | null): void {
  if (color) lastShading = color
  run(C.setCellShading(color))
}

// QColorDialog.getColor: the browser's own colour picker.
export function pickColor(initial: string): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'color'
    input.value = initial
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    let done = false
    const finish = (v: string | null) => { if (!done) { done = true; input.remove(); resolve(v) } }
    input.addEventListener('change', () => finish(input.value))
    input.addEventListener('blur', () => setTimeout(() => finish(null), 300))
    input.click()
  })
}

const actions: Record<string, Handler> = {
  // insert_table: "cell" in every cell; the caption is escaped LaTeX.
  table: async () => {
    const r = await insertTableDialog()
    if (!r) return
    run(C.insertTable(r.rows, r.cols, escapeText(r.caption), r.label))
    sync()
  },
  table_menu: () => {},
  // Insert ▸ Table grid: "<rows>x<columns>" (the grid shows columns x rows, as Word).
  table_grid: (v?: unknown) => {
    const [r, c] = String(v ?? '').split('x').map(Number)
    if (r > 0 && c > 0) { run(C.insertGridTable(r, c)); sync() }
  },
  text_to_table: () => {
    if (!run(C.textToTable)) appStore().set({ status: 'Select the lines to turn into a table (cells separated by tabs, semicolons or commas).' })
    sync()
  },
  tbl_row_above: act(C.tableInsertRow(false)),
  tbl_row_below: act(C.tableInsertRow(true)),
  tbl_col_left: act(C.tableInsertColumn(false)),
  tbl_col_right: act(C.tableInsertColumn(true)),
  tbl_del_row: act(C.tableDeleteRow),
  tbl_del_col: act(C.tableDeleteColumn),
  tbl_delete: act(C.tableDelete),
  tbl_plain: act(C.setTableStyle('')),
  tbl_grid: act(C.setTableStyle('grid')),
  tbl_booktabs: act(C.setTableStyle('booktabs')),
  tbl_striped: act(C.setTableStyle('striped')),
  tbl_nolines: act(C.setTableStyle('plain')),
  tbl_header: on => { run(C.setTableHeader(on !== false)); sync() },
  tbl_repeat: on => { run(C.setTableRepeatHeader(on !== false)); sync() },
  // _merge_cells: a hint when fewer than two cells are selected.
  tbl_merge: () => {
    if (!run(C.tableMergeCells)) appStore().set({ status: 'Select two or more cells (drag across them) to merge.' })
  },
  tbl_split: act(C.tableSplitCell),
  tbl_sort_up: () => sortTable(false),
  tbl_sort_down: () => sortTable(true),
  tbl_shading: () => shade(lastShading),
  'shade:none': () => shade(null),
  shade_more: async () => {
    const c = await pickColor(lastShading)
    if (c) shade(c)
  },
  tbl_align_l: act(C.setColumnAlignment('l')),
  tbl_align_c: act(C.setColumnAlignment('c')),
  tbl_align_r: act(C.setColumnAlignment('r')),
  // MainWindow._insert_caption.
  caption: async () => {
    const e = editor()
    if (!e) return
    const s = e.view.state
    const kind = C.currentTable(s) ? 'Table' : C.currentFigure(s) ? 'Figure' : null
    if (!kind) return
    const [caption, label] = C.currentCaption(s)
    const r = await captionDialog(kind, caption, label)
    if (!r) return
    // A caption gets a label at once, so it can be cross-referenced.
    let lab = r[1]
    if (r[0] && !lab) {
      const { labelForCaption } = await import('../captions.ts')
      lab = labelForCaption(kind === 'Table' ? 'table' : 'figure', r[0])
    }
    run(C.setCaption(r[0], lab))
    if (label && lab && label !== lab) (await import('../captions.ts')).renameReferences(label, lab)
  },
}
for (const [c] of SHADES) actions[`shade:${c}`] = () => shade(c)

async function sortTable(descending: boolean): Promise<void> {
  const e = editor()
  if (!e) return
  const msg = C.sortTable(descending, e.view.state, tr => e.view.dispatch(tr))
  if (msg) await information('Sort', msg)
}

registerActions(actions)
