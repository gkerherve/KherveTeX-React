// The Draw tab (Word's): pick a pen and draw on the page, the eraser takes
// strokes away; pens can be added (pen, pencil, highlighter) and their
// thickness changed. The pens are kept in the settings, as Word keeps its.
import { DEFAULT_PENS, type Pen } from '../../core/ink.ts'
import { editor } from '../../editor/controller.ts'
import { inkTool, setInkTool } from '../../editor/ink.ts'
import { setSetting, setting } from '../../platform/settings'
import { setCommandChecked } from '../../ui/commands.ts'
import { registerActions, type Handler } from '../actions.ts'
import { appStore, editDoc } from '../store.ts'
import { pickColor } from './table.ts'

export const PENS_EVENT = 'kt-pens-changed'

export function pens(): Pen[] {
  const p = setting<Pen[] | null>('draw/pens', null)
  return Array.isArray(p) && p.length ? p : DEFAULT_PENS
}
export function penIndex(): number {
  return Math.min(pens().length - 1, Math.max(0, Number(setting('draw/pen', 0)) || 0))
}
function savePens(list: Pen[], index = penIndex()): void {
  setSetting('draw/pens', list)
  setSetting('draw/pen', index)
  window.dispatchEvent(new CustomEvent(PENS_EVENT))
}

function syncChecks(): void {
  const t = inkTool()
  setCommandChecked('draw_tool', t?.kind === 'pen')
  setCommandChecked('eraser_tool', t?.kind === 'eraser')
  window.dispatchEvent(new CustomEvent(PENS_EVENT))
}

// Choose pen `i` and draw with it.
export function usePen(i: number): void {
  const list = pens()
  setSetting('draw/pen', i)
  setInkTool({ kind: 'pen', pen: list[i] })
  syncChecks()
}

export function setPen(i: number, pen: Pen): void {
  const list = [...pens()]
  list[i] = pen
  savePens(list, i)
  if (inkTool()?.kind === 'pen') setInkTool({ kind: 'pen', pen })
}

// Eraser ▸ Erase All Ink.
function clearInk(): void {
  const e = editor()
  const meta = appStore().get().doc.meta
  if (!meta.ink?.length) return
  const { ink: _i, ...rest } = meta
  void _i
  if (e) e.setMeta(rest)
  else editDoc({ ...appStore().get().doc, meta: rest })
}

async function addPen(kind: Pen['kind']): Promise<void> {
  const c = await pickColor(kind === 'highlighter' ? '#FFFF00' : '#000000')
  if (!c) return
  const pen: Pen = kind === 'highlighter' ? { color: c, width: 6, alpha: 0.4, kind }
    : kind === 'pencil' ? { color: c, width: 0.75, kind } : { color: c, width: 1, kind }
  const list = [...pens(), pen]
  savePens(list, list.length - 1)
  usePen(list.length - 1)
}

const actions: Record<string, Handler> = {
  draw_tool: () => {
    if (inkTool()?.kind === 'pen') setInkTool(null)
    else setInkTool({ kind: 'pen', pen: pens()[penIndex()] })
    syncChecks()
  },
  eraser_tool: () => {
    setInkTool(inkTool()?.kind === 'eraser' ? null : { kind: 'eraser' })
    syncChecks()
  },
  'eraser:stroke': () => { setInkTool({ kind: 'eraser' }); syncChecks() },
  'eraser:all': () => clearInk(),
  add_pen: () => addPen('pen'),
  'add_pen:pen': () => addPen('pen'),
  'add_pen:pencil': () => addPen('pencil'),
  'add_pen:highlighter': () => addPen('highlighter'),
  'pens:reset': () => { savePens(DEFAULT_PENS, 0); if (inkTool()?.kind === 'pen') usePen(0) },
  // Escape-like: back to typing.
  stop_drawing: () => { setInkTool(null); syncChecks() },
}
registerActions(actions)

// Esc puts the pen down, as in Word.
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && inkTool()) { setInkTool(null); syncChecks() }
  })
}
