// Insert ▸ Elements (checklist, progress bars, timeline, QR code, code
// listing, drop cap), Layout ▸ Margin Note, and the contextual tab each
// opens when selected: its options, Edit…, Colour, Delete and Close.
import type { DocMeta } from '../../core/model.ts'
import {
  CODE_LANGUAGES, WIDGET_COLORS, type ChecklistData, type CodeData, type ProgressData, type QrData, type TimelineData,
  type WidgetKind,
} from '../../core/widgets.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import { WIDGET_EDIT_EVENT } from '../../editor/plugins.ts'
import * as W from '../../editor/widgetCommands.ts'
import { boxStyleDialog, formDialog } from '../../ui/dialogs/EditorDialogs.tsx'
import { registerActions, type Handler } from '../actions.ts'
import { editMore } from './elements2.ts'
import { editScience } from './science.ts'
import { editGeometry, editScience2 } from './science2.ts'
import { editOffice } from './office.ts'
import { appStore, editDoc } from '../store.ts'

const run = (cmd: C.Command): boolean => editor()?.run(cmd) ?? false
const sync = () => editor()?.syncToolbar()
const state = () => editor()?.view.state ?? null
const status = (s: string) => appStore().set({ status: s })

// Change the selected element's settings (any kind, or one kind).
function upd<K extends WidgetKind>(fn: (d: any) => void, kind?: K): Handler {
  return () => {
    const s = state()
    const w = s && W.currentWidget(s)
    if (!w || (kind && w.widget.kind !== kind)) return
    run(W.updateWidget(d => { fn(d) }))
    sync()
  }
}

const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(l => l)

async function editWidget(): Promise<void> {
  if (await editMore()) return
  if (await editScience()) return
  if (await editScience2()) return
  if (await editGeometry()) return
  if (await editOffice()) return
  const s = state()
  if (!s) return
  const sp = W.currentInlineSpecial(s)
  if (sp?.kind === 'marginnote') {
    const r = await formDialog('Margin note', [{ key: 'text', label: 'Text of the note:', value: sp.note.text, type: 'textarea', rows: 5 }])
    if (r) { run(W.updateMarginNote(n => { n.text = r.text.trim() })); sync() }
    return
  }
  if (sp?.kind === 'dropcap') {
    const r = await formDialog('Drop cap', [
      { key: 'letter', label: 'Big letter:', value: sp.cap.letter },
      { key: 'rest', label: 'Rest of the word (beside it, in small capitals):', value: sp.cap.rest },
    ])
    if (r && r.letter.trim()) { run(W.updateDropCap(d => { d.letter = [...r.letter.trim()][0]; d.rest = r.rest.trim() })); sync() }
    return
  }
  const w = W.currentWidget(s)
  if (!w) return
  switch (w.widget.kind) {
    case 'checklist': {
      const d = w.widget.data as ChecklistData
      const r = await formDialog('Edit checklist', [
        { key: 'title', label: 'Title (optional):', value: d.title },
        { key: 'items', label: 'Items, one per line:', type: 'textarea', help: 'Start a line with [x] to tick it.',
          value: d.items.map(i => (i.done ? '[x] ' : '') + i.text).join('\n') },
      ])
      if (r) run(W.updateWidget<'checklist'>(x => {
        x.title = r.title.trim()
        x.items = lines(r.items).map(l => { const m = /^\[\s*[xX✓]?\s*\]\s*/.exec(l); return { done: !!m && /[xX✓]/.test(m[0]), text: m ? l.slice(m[0].length) : l } })
      }))
      break
    }
    case 'progress': {
      const d = w.widget.data as ProgressData
      const r = await formDialog('Edit progress bars', [{ key: 'items', label: 'Bars, one per line:', type: 'textarea',
        help: 'Label: percentage, e.g. "Experiments: 70".', value: d.items.map(i => `${i.label}: ${i.value}`).join('\n') }])
      if (r) run(W.updateWidget<'progress'>(x => {
        x.items = lines(r.items).map(l => { const m = /^(.*?)[:\t]\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(l); return m ? { label: m[1].trim(), value: Number(m[2]) } : { label: l, value: 0 } })
      }))
      break
    }
    case 'timeline': {
      const d = w.widget.data as TimelineData
      const r = await formDialog('Edit timeline', [{ key: 'events', label: 'Events, one per line:', type: 'textarea',
        help: 'Date | Title | Text, e.g. "2025 | First results | Prototype tested."', value: d.events.map(e => [e.date, e.title, e.text].join(' | ')).join('\n') }])
      if (r) run(W.updateWidget<'timeline'>(x => {
        x.events = lines(r.events).map(l => { const [date = '', title = '', ...rest] = l.split('|').map(p => p.trim()); return { date, title, text: rest.join(' | ') } })
      }))
      break
    }
    case 'qrcode': {
      const d = w.widget.data as QrData
      const r = await formDialog('Edit QR code', [
        { key: 'url', label: 'Link or text the code holds:', value: d.url },
        { key: 'caption', label: 'Caption under it (optional):', value: d.caption },
        { key: 'size', label: 'Size (cm):', value: String(d.size), type: 'number' },
      ])
      if (r) run(W.updateWidget<'qrcode'>(x => { x.url = r.url.trim(); x.caption = r.caption.trim(); x.size = Math.max(1, Math.min(12, Number(r.size) || 3)) }))
      break
    }
    case 'code': {
      const d = w.widget.data as CodeData
      const r = await formDialog('Edit code listing', [
        { key: 'title', label: 'Title (optional):', value: d.title },
        { key: 'language', label: 'Language:', value: d.language, type: 'select', options: CODE_LANGUAGES.map(([n]) => n) },
        { key: 'code', label: 'Code:', value: d.code, type: 'code', rows: 14 },
      ])
      if (r) run(W.updateWidget<'code'>(x => { x.title = r.title.trim(); x.language = r.language; x.code = r.code.replace(/\s+$/, '') }))
      break
    }
  }
  sync()
}

function setColor(hex: string): void {
  const s = state()
  if (!s) return
  const c = hex.replace('#', '').toUpperCase()
  const sp = W.currentInlineSpecial(s)
  if (sp?.kind === 'marginnote') run(W.updateMarginNote(n => { n.color = c }))
  else if (sp?.kind === 'dropcap') run(W.updateDropCap(d => { d.color = c }))
  else if (sp?.kind === 'icon') run(W.updateIcon(i => { i.color = c }))
  else run(W.updateWidget(d => { if ('color' in d) (d as { color: string }).color = c }))
  sync()
}

function currentColor(): string {
  const s = state()
  if (!s) return '#1F6FB5'
  const sp = W.currentInlineSpecial(s)
  if (sp?.kind === 'marginnote') return '#' + sp.note.color
  if (sp?.kind === 'dropcap') return '#' + sp.cap.color
  if (sp?.kind === 'icon') return '#' + sp.icon.color
  const w = W.currentWidget(s)
  const c = w && (w.widget.data as { color?: string }).color
  return '#' + (c ?? '1F6FB5')
}

function meta(): DocMeta {
  return appStore().get().doc.meta
}

function insert(kind: WidgetKind): Handler {
  return () => { run(W.insertWidget(kind)); sync() }
}

const actions: Record<string, Handler> = {
  ins_checklist: insert('checklist'),
  ins_progress: insert('progress'),
  ins_timeline: insert('timeline'),
  ins_qrcode: async () => {
    const r = await formDialog('Insert QR code', [
      { key: 'url', label: 'Link or text the code holds:', value: 'https://' },
      { key: 'caption', label: 'Caption under it (optional):', value: '' },
    ], 'Insert')
    if (!r) return
    run(W.insertWidget('qrcode'))
    run(W.updateWidget<'qrcode'>(x => { x.url = r.url.trim(); x.caption = r.caption.trim() }))
    sync()
  },
  ins_code: insert('code'),
  ins_dropcap: () => {
    if (!run(W.insertDropCap())) status('Put the caret in a paragraph that starts with a word, then Insert > Drop Cap.')
    sync()
  },
  ins_marginnote: async () => {
    const r = await formDialog('Margin note', [{ key: 'text', label: 'Text of the note (shown in the right margin):', value: '', type: 'textarea', rows: 5 }], 'Insert')
    if (!r || !r.text.trim()) return
    if (!run(W.insertMarginNote({ color: '1F6FB5', style: 'box', text: r.text.trim() }))) status('Put the caret in the text where the note belongs.')
    sync()
  },

  w_edit: () => { void editWidget() },
  w_delete: () => { run(W.deleteSpecial); sync() },
  w_close: () => { run(W.leaveSpecial); editor()?.view.focus(); sync() },
  w_color: () => {},
  ...Object.fromEntries(WIDGET_COLORS.map(([c]) => [`w_color_${c}`, () => setColor(c)])),
  w_color_custom: async () => {
    const r = await boxStyleDialog('Colour', currentColor(), null)
    if (r) setColor(r.color)
  },

  // Checklist
  ck_box: upd((d: ChecklistData) => { d.style = 'box' }, 'checklist'),
  ck_circle: upd((d: ChecklistData) => { d.style = 'circle' }, 'checklist'),
  ck_cols_1: upd((d: ChecklistData) => { d.columns = 1 }, 'checklist'),
  ck_cols_2: upd((d: ChecklistData) => { d.columns = 2 }, 'checklist'),
  ck_cols_3: upd((d: ChecklistData) => { d.columns = 3 }, 'checklist'),
  ck_grey: upd((d: ChecklistData) => { d.grey_done = !d.grey_done }, 'checklist'),
  ck_tick_all: upd((d: ChecklistData) => { for (const i of d.items) i.done = true }, 'checklist'),
  ck_untick_all: upd((d: ChecklistData) => { for (const i of d.items) i.done = false }, 'checklist'),

  // Progress bars
  pg_rounded: upd((d: ProgressData) => { d.style = 'rounded' }, 'progress'),
  pg_square: upd((d: ProgressData) => { d.style = 'square' }, 'progress'),
  pg_thin: upd((d: ProgressData) => { d.style = 'thin' }, 'progress'),
  pg_short: upd((d: ProgressData) => { d.length = 'short' }, 'progress'),
  pg_medium: upd((d: ProgressData) => { d.length = 'medium' }, 'progress'),
  pg_long: upd((d: ProgressData) => { d.length = 'long' }, 'progress'),
  pg_percent: upd((d: ProgressData) => { d.percent = !d.percent }, 'progress'),

  // Timeline
  tl_vertical: upd((d: TimelineData) => { d.layout = 'vertical' }, 'timeline'),
  tl_horizontal: upd((d: TimelineData) => { d.layout = 'horizontal' }, 'timeline'),
  tl_add: () => {
    upd((d: TimelineData) => { d.events.push({ date: 'Date', title: 'New event', text: '' }) }, 'timeline')()
    void editWidget()
  },

  // QR code
  qr_small: upd((d: QrData) => { d.size = 2 }, 'qrcode'),
  qr_medium: upd((d: QrData) => { d.size = 3 }, 'qrcode'),
  qr_large: upd((d: QrData) => { d.size = 4.5 }, 'qrcode'),
  qr_left: upd((d: QrData) => { d.align = 'left' }, 'qrcode'),
  qr_center: upd((d: QrData) => { d.align = 'center' }, 'qrcode'),
  qr_right: upd((d: QrData) => { d.align = 'right' }, 'qrcode'),

  // Code listing
  cd_lang: () => {},
  ...Object.fromEntries(CODE_LANGUAGES.map(([n], i) => [`cd_lang_${i}`, upd((d: CodeData) => { d.language = n }, 'code')])),
  cd_light: upd((d: CodeData) => { d.theme = 'light' }, 'code'),
  cd_dark: upd((d: CodeData) => { d.theme = 'dark' }, 'code'),
  cd_plain: upd((d: CodeData) => { d.theme = 'plain' }, 'code'),
  cd_numbers: upd((d: CodeData) => { d.numbers = !d.numbers }, 'code'),
  cd_frame: upd((d: CodeData) => { d.frame = !d.frame }, 'code'),

  // Margin note
  mn_plain: () => { run(W.updateMarginNote(n => { n.style = 'plain' })); sync() },
  mn_line: () => { run(W.updateMarginNote(n => { n.style = 'line' })); sync() },
  mn_box: () => { run(W.updateMarginNote(n => { n.style = 'box' })); sync() },
  // A right margin wide enough for notes (the notes take its width).
  mn_room: () => {
    const m = meta()
    const wide = m.margin_right_cm < 4
    const next = { ...m, margin_right_cm: wide ? 4.5 : 2.5 }
    const e = editor()
    if (e) e.setMeta(next)
    else editDoc({ ...appStore().get().doc, meta: next })
    status(wide ? 'Right margin 4.5 cm: room for the margin notes.' : 'Right margin back to 2.5 cm.')
    sync()
  },

  // Drop cap
  ...Object.fromEntries([2, 3, 4, 5].map(n => [`dc_lines_${n}`, () => { run(W.updateDropCap(d => { d.lines = n })); sync() }])),
  dc_dropped: () => { run(W.updateDropCap(d => { d.margin = false })); sync() },
  dc_margin: () => { run(W.updateDropCap(d => { d.margin = true })); sync() },
  dc_smallcaps: () => { run(W.updateDropCap(d => { d.smallcaps = !d.smallcaps })); sync() },
}

registerActions(actions)
if (typeof window !== 'undefined') window.addEventListener(WIDGET_EDIT_EVENT, () => { void editWidget() })
