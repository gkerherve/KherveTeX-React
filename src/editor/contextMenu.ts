// The page's right-click menu (DocumentEditor._show_context_menu): spelling
// suggestions, the equation under the mouse, Convert to equation, the
// table's row and column tools, then the standard edit actions.
import { TextSelection } from 'prosemirror-state'
import { runAction } from '../app/actions.ts'
import { DATE_FORMATS } from '../core/dateFormat.ts'
import { spellHighlighter } from '../spell/shared.ts'
import * as C from './commands.ts'
import * as M from '../core/model.ts'
import { cellDisplayText, cellPictures, displayToCellLatex, isStructuredCell } from './convert.ts'
import { columnFractions } from './views.ts'
import { dateHooks } from './plugins.ts'
import { anyNcPart, selectionHidden, setAllNcOpen } from './noCompile.ts'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorController } from './controller.ts'

interface Item { text: string; run?: () => void; disabled?: boolean; checked?: boolean }
type Entry = Item | '-'

let open: HTMLElement | null = null

function close(): void {
  open?.remove()
  open = null
  document.removeEventListener('mousedown', onDown, true)
  document.removeEventListener('keydown', onKey, true)
}

function onDown(e: MouseEvent): void {
  if (open && !open.contains(e.target as Node)) close()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

function show(entries: Entry[], x: number, y: number): void {
  close()
  const menu = document.createElement('div')
  menu.className = 'qmenu kt-context-menu'
  menu.setAttribute('role', 'menu')
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  const trimmed = entries.filter((e, i, a) => e !== '-' || (i > 0 && a[i - 1] !== '-' && i < a.length - 1))
  for (const e of trimmed) {
    if (e === '-') {
      const sep = document.createElement('div')
      sep.className = 'qmenu-sep'
      menu.appendChild(sep)
      continue
    }
    const it = document.createElement('div')
    it.className = 'qmenu-item' + (e.disabled ? ' disabled' : '')
    it.setAttribute('role', 'menuitem')
    const label = document.createElement('span')
    label.className = 'qmenu-text'
    label.textContent = (e.checked !== undefined ? (e.checked ? '✓ ' : '   ') : '') + e.text
    it.appendChild(label)
    it.addEventListener('mousedown', ev => ev.preventDefault())
    it.addEventListener('click', () => {
      if (e.disabled) return
      close()
      e.run?.()
    })
    menu.appendChild(it)
  }
  document.body.appendChild(menu)
  // Keep it on screen.
  const r = menu.getBoundingClientRect()
  if (r.right > innerWidth) menu.style.left = `${Math.max(0, innerWidth - r.width - 4)}px`
  if (r.bottom > innerHeight) menu.style.top = `${Math.max(0, innerHeight - r.height - 4)}px`
  open = menu
  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('keydown', onKey, true)
}

dateHooks.remove = () => { void runAction('show_date') }

export function showContextMenu(ed: EditorController, e: MouseEvent): boolean {
  // The date under the title: remove it, or pick its format.
  if ((e.target as Element | null)?.closest?.('.kt-date')) {
    const cur = ed.meta.date_format ?? ''
    show([
      { text: 'Remove date', run: () => { void runAction('show_date') } }, '-',
      { text: 'Class default', checked: cur === '', run: () => { void runAction('date_format', '') } },
      ...DATE_FORMATS.map(([k, example]): Item => ({ text: example, checked: cur === k,
        run: () => { void runAction('date_format', k) } })),
    ], e.clientX, e.clientY)
    return true
  }
  const view = ed.view
  const at = view.posAtCoords({ left: e.clientX, top: e.clientY })
  // A right-click outside the selection moves the caret there first.
  if (at && (at.pos < view.state.selection.from || at.pos > view.state.selection.to)) {
    const node = view.state.doc.nodeAt(at.inside >= 0 ? at.inside : at.pos)
    if (node && node.isAtom && at.inside >= 0) ed.selectNode(at.inside)
    else view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))))
  }
  const state = view.state
  const entries: Entry[] = []

  // Spelling suggestions for the word under the mouse.
  const sh = spellHighlighter()
  const word = at ? C.wordAt(state.doc.resolve(at.pos)) : null
  if (word && sh.isEnabled()) {
    const text = state.doc.textBetween(word.from, word.to)
    if (text && sh.isMisspelled(text)) {
      const sugg = sh.suggestions(text)
      if (sugg.length) {
        for (const s of sugg) {
          entries.push({ text: s, run: () => {
            const marks = state.doc.resolve(word.from + 1).marks()
            view.dispatch(view.state.tr.replaceWith(word.from, word.to, view.state.schema.text(s, marks)))
          } })
        }
      } else {
        entries.push({ text: '(no suggestions)', disabled: true })
      }
      entries.push('-', { text: `Add “${text}” to dictionary`, run: () => sh.addToDictionary(text) }, '-')
    }
  }

  const mb = C.currentMathBlock(state)
  const mi = mb ? null : C.currentMathInline(state)
  if (mb || mi) {
    entries.push({ text: 'Open in equation editor…', run: () => { void runAction('eq_edit') } })
    if (mb) {
      const on = C.currentEquationNumbered(state)
      entries.push({ text: 'Numbered equation', checked: on, run: () => ed.run(C.setEquationNumbered(!on)) })
      entries.push({ text: 'Label…', run: () => { void runAction('eq_label') } })
    }
    entries.push('-')
  } else if (!state.selection.empty && state.doc.textBetween(state.selection.from, state.selection.to).trim()) {
    entries.push({ text: 'Convert to equation…', run: () => { void convertSelection(ed) } }, '-')
  }

  entries.push(
    { text: 'Insert citation…', run: () => { void runAction('citation') } },
    { text: 'Cross-reference…', run: () => { void runAction('crossref') } }, '-',
    { text: 'Undo', run: () => { void runAction('undo') } },
    { text: 'Redo', run: () => { void runAction('redo') } }, '-',
    { text: 'Cut', run: () => { void runAction('cut') }, disabled: state.selection.empty },
    { text: 'Copy', run: () => { void runAction('copy') }, disabled: state.selection.empty },
    { text: 'Paste', run: () => { void runAction('paste') } },
    { text: 'Delete', run: () => ed.run((s, d) => { d?.(s.tr.deleteSelection()); return true }), disabled: state.selection.empty },
    '-', { text: 'Select All', run: () => { void runAction('select_all') } },
    '-', selectionHidden(state)
      ? { text: 'Compile again', run: () => { void runAction('no_compile') } }
      : { text: 'Do not compile', run: () => { void runAction('no_compile') } },
    ...(anyNcPart(state).any ? [anyNcPart(state).allOpen
      ? { text: 'Fold the parts not compiled', run: () => { ed.run(setAllNcOpen(false)) } }
      : { text: 'Show the parts not compiled', run: () => { ed.run(setAllNcOpen(true)) } }] : []),
  )

  const fig = C.currentFigure(state)
  const hasCaption = C.currentCaption(state)[0].trim() !== ''
  const captionItem: Item = { text: hasCaption ? 'Edit caption…' : 'Insert caption…', run: () => { void runAction('caption') } }
  // A right-click on a picture offers what is done to a picture first, as
  // Word does: its caption, where it sits, its size.
  if (fig) {
    const a = fig.node.attrs
    const align = a.align || 'center'
    const w = /^([\d.]+)\\textwidth$/.exec((a.width || '').trim())
    const share = w ? parseFloat(w[1]) : null
    entries.unshift(
      captionItem, '-',
      { text: 'Align left', checked: align === 'left', run: () => { void runAction('fig_left') } },
      { text: 'Center', checked: align === 'center', run: () => { void runAction('fig_center') } },
      { text: 'Align right', checked: align === 'right', run: () => { void runAction('fig_right') } }, '-',
      ...[0.25, 0.5, 0.75, 1].map((f): Item => ({
        text: `${f * 100}% width`, checked: share !== null && Math.abs(share - f) < 0.005,
        run: () => { void runAction(`fig_w${f * 100}`) },
      })), '-',
      { text: 'Delete picture', run: () => { void runAction('fig_delete') } }, '-')
  }
  // A right-click in a box: its name and colour, its type, remove or delete it.
  const kind = C.currentTheoremKind(state)
  if (M.isCallout(kind)) {
    entries.unshift(
      { text: 'Box name and colour…', run: () => { void runAction('box_style') } }, '-',
      ...Object.entries(M.CALLOUT_KINDS).filter(([k]) => k !== 'custom').map(([k, v]): Item => ({
        text: v.name, checked: k === kind, run: () => { void runAction(`box_kind_${k}`) },
      })), '-',
      { text: 'Move up', run: () => { void runAction('block_up') } },
      { text: 'Move down', run: () => { void runAction('block_down') } },
      { text: 'Text after box', run: () => { void runAction('box_para_after') } },
      { text: 'Remove box (keep text)', run: () => { void runAction('box_remove') } },
      { text: 'Delete box', run: () => { void runAction('box_delete') } }, '-')
  }
  if (C.currentTable(state)) {
    entries.push('-', captionItem, '-',
      { text: 'Insert row above', run: () => ed.run(C.tableInsertRow(false)) },
      { text: 'Insert row below', run: () => ed.run(C.tableInsertRow(true)) },
      { text: 'Insert column left', run: () => ed.run(C.tableInsertColumn(false)) },
      { text: 'Insert column right', run: () => ed.run(C.tableInsertColumn(true)) }, '-',
      { text: 'Delete row', run: () => ed.run(C.tableDeleteRow) },
      { text: 'Delete column', run: () => ed.run(C.tableDeleteColumn) },
      { text: 'Delete table', run: () => ed.run(C.tableDelete) }, '-',
      { text: 'Move table up', run: () => { void runAction('block_up') } },
      { text: 'Move table down', run: () => { void runAction('block_down') } })
    const cell = currentCell(ed)
    if (cell) {
      const pics = cellPictures(cellLatex(cell.node))
      entries.push('-', { text: 'Insert picture in cell…', run: () => { void insertCellPicture(ed) } })
      if (pics.length) entries.push({ text: pics.length > 1 ? 'Remove pictures from cell' : 'Remove picture from cell',
        run: () => setCell(ed, cell.pos, cellLatex(cell.node).replace(/\s*(?:\\par\s*)?\\includegraphics\s*(?:\[[^\]]*\])?\s*\{[^}]*\}\s*(?:\\par\b)?/g, ' ').replace(/^\s*\\par\b|\\par\s*$/g, '').trim()) })
    }
  }
  const x = e.clientX, y = e.clientY
  if (!fig) { show(entries, x, y); return true }
  // A drawing or flowchart reopens its editor; a drawing also opens in
  // KhervePaint (the sources beside the PNG decide, as editor.py checks).
  void figureEntries(fig.node.attrs.path, fig.node.attrs.source).then(extra => show([...entries, ...extra], x, y))
  return true
}

async function figureEntries(path: string, source: string): Promise<Entry[]> {
  try {
    const { platform } = await import('../platform/index.ts')
    const { flowchartSourceFor, drawingSourceFor } = await import('../core/drawingFiles.ts')
    const { withSuffix } = await import('../core/paths.ts')
    const exists = (p: string) => platform().exists(p)
    const resolved = await resolveForMenu(path)
    if (resolved === null) return []
    if (source === 'chart' || await exists(withSuffix(resolved, '.chart.json'))) {
      return ['-', { text: 'Edit chart…', run: () => { void runAction('fig_edit') } }]
    }
    if (source === 'flowchart' || await flowchartSourceFor(resolved, exists) !== null) {
      return ['-', { text: 'Edit flowchart…', run: () => { void runAction('fig_edit') } }]
    }
    if (await drawingSourceFor(resolved, exists) !== null && await exists(withSuffix(resolved, '.svg'))) {
      return ['-', { text: 'Edit drawing…', run: () => { void runAction('fig_edit') } },
        { text: 'Edit in KhervePaint', run: () => {
          void import('../drawing/insert.ts').then(m => m.editInKhervePaint(resolved))
        } }]
    }
  } catch { /* no platform: no extra entries */ }
  return []
}

// The figure's file as _resolve_image_path finds it.
async function resolveForMenu(p: string): Promise<string | null> {
  if (!p) return null
  const { platform } = await import('../platform/index.ts')
  const { dirname, isAbsolute, join } = await import('../core/paths.ts')
  const { appStore } = await import('../app/store.ts')
  const pf = platform()
  if (isAbsolute(p) && await pf.exists(p)) return p
  const doc = appStore().get().path
  if (doc && await pf.exists(join(dirname(doc), p))) return join(dirname(doc), p)
  const { imagesDir } = await import('../drawing/host.ts')
  const c = join(await imagesDir(), p)
  return (await pf.exists(c)) ? c : null
}

// convert_selection_to_equation: the selected text, as the equation
// editor's starting point, becomes inline math (or a display block when
// whole lines were selected).
async function convertSelection(ed: EditorController): Promise<void> {
  const s = ed.view.state
  const text = s.doc.textBetween(s.selection.from, s.selection.to, '\n')
  const { askMath } = await import('../math/dialogs.tsx')
  const latex = await askMath(text.trim())
  if (latex === null || !latex.trim()) return
  const $f = s.selection.$from, $t = s.selection.$to
  const whole = $f.parentOffset === 0 && $t.parentOffset === $t.parent.content.size
  if (whole && $f.depth === 1) {
    ed.run((st, d) => {
      const from = $f.before(1), to = $t.after(1)
      d?.(st.tr.replaceWith(from, to, C.fresh({ latex, numbered: false, label: null, type: 'MathBlock' })))
      return true
    })
  } else {
    ed.run(C.insertInlines([{ latex, type: 'MathInline' }]))
  }
}

// The table cell holding the caret: the cell node and its position.
function currentCell(ed: EditorController): { node: PMNode; pos: number; table: PMNode; col: number } | null {
  const $p = ed.view.state.selection.$from
  for (let d = $p.depth; d > 1; d--) {
    if ($p.node(d).type.name !== 'table_cell') continue
    const table = $p.node(d - 2)
    let col = 0
    $p.node(d - 1).forEach((c, _o, i) => { if (i < $p.index(d - 1)) col += c.attrs.colspan })
    return { node: $p.node(d), pos: $p.before(d), table, col }
  }
  return null
}

// A cell's LaTeX as it stands, edits included (as convert.ts writes it).
function cellLatex(cell: PMNode): string {
  const raw: string | null = cell.attrs.raw
  const shown = cell.textContent
  if (raw !== null && raw !== undefined && cellDisplayText(raw) === shown.trim()) return raw
  if (raw && isStructuredCell(raw)) return displayToCellLatex(shown, raw)
  return shown
}

// Give a cell new LaTeX: its raw and the text the page shows for it.
function setCell(ed: EditorController, pos: number, latex: string): void {
  ed.run((s, d) => {
    const cell = s.doc.nodeAt(pos)
    if (!cell) return false
    const shown = cellDisplayText(latex)
    const next = cell.type.create({ ...cell.attrs, raw: latex }, shown ? s.schema.text(shown) : null)
    d?.(s.tr.replaceWith(pos, pos + cell.nodeSize, next))
    return true
  })
}

// Insert ▸ picture in a table cell: \includegraphics after the cell's text,
// filling a column with a LaTeX width (m{0.4\textwidth}), else 0.3 of the
// text width.
async function insertCellPicture(ed: EditorController): Promise<void> {
  const { platform } = await import('../platform/index.ts')
  let path: string | null = null
  try {
    const r = await platform().openFileDialog({
      title: 'Select image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }, { name: 'All', extensions: ['*'] }],
    })
    path = r?.[0] ?? null
  } catch { path = null }
  if (!path) return
  const cell = currentCell(ed)
  if (!cell) return
  const fr = columnFractions(cell.table.attrs.alignment || '')[cell.col] ?? null
  const width = fr !== null ? '\\linewidth' : '0.3\\textwidth'
  const pic = `\\includegraphics[width=${width}]{${path.replaceAll('\\', '/')}}`
  const cur = cellLatex(cell.node).trim()
  setCell(ed, cell.pos, cur ? `${cur} \\par ${pic}` : pic)
}
