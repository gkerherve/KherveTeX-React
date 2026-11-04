// The page's right-click menu (DocumentEditor._show_context_menu): spelling
// suggestions, the equation under the mouse, Convert to equation, the
// table's row and column tools, then the standard edit actions.
import { TextSelection } from 'prosemirror-state'
import { runAction } from '../app/actions.ts'
import { spellHighlighter } from '../spell/shared.ts'
import * as C from './commands.ts'
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

export function showContextMenu(ed: EditorController, e: MouseEvent): boolean {
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
    }
    entries.push('-')
  } else if (!state.selection.empty && state.doc.textBetween(state.selection.from, state.selection.to).trim()) {
    entries.push({ text: 'Convert to equation…', run: () => { void convertSelection(ed) } }, '-')
  }

  entries.push(
    { text: 'Undo', run: () => { void runAction('undo') } },
    { text: 'Redo', run: () => { void runAction('redo') } }, '-',
    { text: 'Cut', run: () => { void runAction('cut') }, disabled: state.selection.empty },
    { text: 'Copy', run: () => { void runAction('copy') }, disabled: state.selection.empty },
    { text: 'Paste', run: () => { void runAction('paste') } },
    { text: 'Delete', run: () => ed.run((s, d) => { d?.(s.tr.deleteSelection()); return true }), disabled: state.selection.empty },
    '-', { text: 'Select All', run: () => { void runAction('select_all') } },
  )

  const fig = C.currentFigure(state)
  if (C.currentTable(state)) {
    entries.push('-',
      { text: 'Insert row above', run: () => ed.run(C.tableInsertRow(false)) },
      { text: 'Insert row below', run: () => ed.run(C.tableInsertRow(true)) },
      { text: 'Insert column left', run: () => ed.run(C.tableInsertColumn(false)) },
      { text: 'Insert column right', run: () => ed.run(C.tableInsertColumn(true)) }, '-',
      { text: 'Delete row', run: () => ed.run(C.tableDeleteRow) },
      { text: 'Delete column', run: () => ed.run(C.tableDeleteColumn) },
      { text: 'Delete table', run: () => ed.run(C.tableDelete) })
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
