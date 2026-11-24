// The second set of elements (core/widgetsMore.ts): pull quote, sidebar,
// rating, gauge, steps, Gantt chart, chart (also Table ▸ Chart from Table),
// and Insert ▸ Icon - their insert commands, Edit… dialogs and tab options.
import { ICONS, type IconSize, type WidgetKind } from '../../core/widgets.ts'
import { chartFromRows, type ChartData, type ChartType, type GanttData, type GaugeData, type PullQuoteData, type RatingData,
  type SidebarData, type StepsData } from '../../core/widgetsMore.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import * as W from '../../editor/widgetCommands.ts'
import { formDialog, iconPickerDialog } from '../../ui/dialogs/EditorDialogs.tsx'
import { registerActions, type Handler } from '../actions.ts'
import { appStore } from '../store.ts'

const run = (cmd: C.Command): boolean => editor()?.run(cmd) ?? false
const sync = () => editor()?.syncToolbar()
const state = () => editor()?.view.state ?? null
const status = (s: string) => appStore().set({ status: s })
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(l => l)
const num = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : 0 }

function upd(kind: WidgetKind, fn: (d: any) => void): Handler {
  return () => {
    const s = state()
    const w = s && W.currentWidget(s)
    if (!w || w.widget.kind !== kind) return
    run(W.updateWidget(d => { fn(d) }))
    sync()
  }
}

// Edit… for the second set; false when the selection is not one of them.
export async function editMore(): Promise<boolean> {
  const s = state()
  if (!s) return false
  const sp = W.currentInlineSpecial(s)
  if (sp?.kind === 'icon') {
    const name = await iconPickerDialog(ICONS, sp.icon.name)
    if (name) { run(W.updateIcon(i => { i.name = name })); sync() }
    return true
  }
  const w = W.currentWidget(s)
  if (!w) return false
  const d = w.widget.data as any
  switch (w.widget.kind) {
    case 'pullquote': {
      const q = d as PullQuoteData
      const r = await formDialog('Edit pull quote', [
        { key: 'text', label: 'Quotation:', value: q.text, type: 'textarea', rows: 4 },
        { key: 'author', label: 'Who said it (optional):', value: q.author },
      ])
      if (r) run(W.updateWidget<'pullquote'>(x => { x.text = r.text.trim(); x.author = r.author.trim() }))
      break
    }
    case 'sidebar': {
      const b = d as SidebarData
      const r = await formDialog('Edit sidebar', [
        { key: 'title', label: 'Title (optional):', value: b.title },
        { key: 'text', label: 'Text:', value: b.text, type: 'textarea', help: 'A blank line starts a new paragraph.' },
      ])
      if (r) run(W.updateWidget<'sidebar'>(x => { x.title = r.title.trim(); x.text = r.text.trim() }))
      break
    }
    case 'rating': {
      const g = d as RatingData
      const r = await formDialog('Edit ratings', [
        { key: 'items', label: 'One per line:', type: 'textarea', help: 'Label: score, e.g. "Comfort: 4.5" (halves allowed).',
          value: g.items.map(i => `${i.label}: ${i.value}`).join('\n') },
        { key: 'max', label: 'Out of:', value: String(g.max), type: 'number' },
      ])
      if (r) run(W.updateWidget<'rating'>(x => {
        x.max = Math.max(1, Math.min(10, Math.round(num(r.max)) || 5))
        x.items = lines(r.items).map(l => { const m = /^(.*?)[:\t]\s*([\d.,]+)\s*$/.exec(l); return m ? { label: m[1].trim(), value: num(m[2]) } : { label: l, value: 0 } })
      }))
      break
    }
    case 'gauge': {
      const g = d as GaugeData
      const r = await formDialog('Edit gauges', [{ key: 'items', label: 'One per line:', type: 'textarea',
        help: 'Label: percentage, e.g. "Budget used: 64".', value: g.items.map(i => `${i.label}: ${i.value}`).join('\n') }])
      if (r) run(W.updateWidget<'gauge'>(x => {
        x.items = lines(r.items).map(l => { const m = /^(.*?)[:\t]\s*([\d.,]+)\s*%?\s*$/.exec(l); return m ? { label: m[1].trim(), value: num(m[2]) } : { label: l, value: 0 } })
      }))
      break
    }
    case 'steps': {
      const g = d as StepsData
      const r = await formDialog('Edit steps', [{ key: 'steps', label: 'One step per line:', type: 'textarea',
        help: 'Title | text, e.g. "Measure | Collect the data".', value: g.steps.map(x => `${x.title} | ${x.text}`).join('\n') }])
      if (r) run(W.updateWidget<'steps'>(x => {
        x.steps = lines(r.steps).map(l => { const [t = '', ...rest] = l.split('|').map(p => p.trim()); return { title: t, text: rest.join(' | ') } })
      }))
      break
    }
    case 'gantt': {
      const g = d as GanttData
      const r = await formDialog('Edit Gantt chart', [
        { key: 'tasks', label: 'One task per line:', type: 'textarea', rows: 10,
          help: 'Task | first period | last period, e.g. "Experiments | 3 | 8". A milestone: "* Submission | 12".',
          value: g.tasks.map(t => t.milestone ? `* ${t.name} | ${t.start}` : `${t.name} | ${t.start} | ${t.end}`).join('\n') },
        { key: 'periods', label: 'Number of periods:', value: String(g.periods), type: 'number' },
        { key: 'unit', label: 'Period name:', value: g.unit, type: 'select', options: ['Day', 'Week', 'Month', 'Quarter', 'Year'] },
      ])
      if (r) run(W.updateWidget<'gantt'>(x => {
        x.periods = Math.max(1, Math.min(60, Math.round(num(r.periods)) || 12))
        x.unit = r.unit
        x.tasks = lines(r.tasks).map(l => {
          const ms = l.startsWith('*')
          const [name = '', a = '1', b = ''] = l.replace(/^\*\s*/, '').split('|').map(p => p.trim())
          const start = Math.max(1, Math.round(num(a)) || 1)
          return { name, start, end: ms ? start : Math.max(start, Math.round(num(b)) || start), ...(ms ? { milestone: true } : {}) }
        })
      }))
      break
    }
    case 'chart': {
      const g = d as ChartData
      const csv = [['', ...g.series.map(x => x.name)].join(', '), ...g.labels.map((l, i) => [l, ...g.series.map(x => x.values[i] ?? 0)].join(', '))].join('\n')
      const r = await formDialog('Edit chart', [
        { key: 'title', label: 'Title (optional):', value: g.title },
        { key: 'data', label: 'Data:', value: csv, type: 'code', rows: 10,
          help: 'First line: the series names after a comma. Then one line per label: label, value, value… (a pie uses the first value).' },
      ])
      if (r) run(W.updateWidget<'chart'>(x => {
        const rows = lines(r.data).map(l => l.split(/[,;\t]/).map(c => c.trim()))
        const made = chartFromRows(rows, x.color)
        x.title = r.title.trim()
        if (made) { x.labels = made.labels; x.series = made.series; x.legend = x.legend || made.series.length > 1 }
      }))
      break
    }
    default: return false
  }
  sync()
  return true
}

function insert(kind: WidgetKind): Handler {
  return () => { run(W.insertWidget(kind)); sync() }
}

const actions: Record<string, Handler> = {
  ins_pullquote: insert('pullquote'),
  ins_sidebar: insert('sidebar'),
  ins_rating: insert('rating'),
  ins_gauge: insert('gauge'),
  ins_steps: insert('steps'),
  ins_gantt: insert('gantt'),
  ins_chart: insert('chart'),
  ins_icon: async () => {
    const name = await iconPickerDialog(ICONS)
    if (!name) return
    if (!run(W.insertIcon({ color: '1F6FB5', size: 'normalsize', name }))) status('Put the caret in the text where the icon belongs.')
    sync()
  },
  // Table ▸ Chart from Table: a bar chart of the table's numbers, after it.
  tbl_chart: () => {
    const s = state()
    const rows = s && W.currentTableRows(s)
    if (!rows) return
    const data = chartFromRows(rows)
    if (!data) { status('No numbers to chart: the first row should name the columns, the first column the labels.'); return }
    run(W.insertWidgetAfterTable('chart', data))
    sync()
  },

  pq_rules: upd('pullquote', (d: PullQuoteData) => { d.style = 'rules' }),
  pq_bar: upd('pullquote', (d: PullQuoteData) => { d.style = 'bar' }),
  pq_marks: upd('pullquote', (d: PullQuoteData) => { d.style = 'marks' }),
  sb_right: upd('sidebar', (d: SidebarData) => { d.position = 'right' }),
  sb_left: upd('sidebar', (d: SidebarData) => { d.position = 'left' }),
  sb_full: upd('sidebar', (d: SidebarData) => { d.position = 'full' }),
  rt_stars: upd('rating', (d: RatingData) => { d.symbol = 'stars' }),
  rt_dots: upd('rating', (d: RatingData) => { d.symbol = 'dots' }),
  rt_max_5: upd('rating', (d: RatingData) => { d.max = 5 }),
  rt_max_10: upd('rating', (d: RatingData) => { d.max = 10 }),
  rt_value: upd('rating', (d: RatingData) => { d.show_value = !d.show_value }),
  gg_half: upd('gauge', (d: GaugeData) => { d.style = 'half' }),
  gg_ring: upd('gauge', (d: GaugeData) => { d.style = 'ring' }),
  st_horizontal: upd('steps', (d: StepsData) => { d.layout = 'horizontal' }),
  st_vertical: upd('steps', (d: StepsData) => { d.layout = 'vertical' }),
  gt_grid: upd('gantt', (d: GanttData) => { d.grid = !d.grid }),
  ...Object.fromEntries((['bar', 'hbar', 'line', 'pie'] as ChartType[]).map(t => [`ch_${t}`, upd('chart', (d: ChartData) => { d.type = t })])),
  ...Object.fromEntries((['small', 'medium', 'large'] as const).map(z => [`ch_${z}`, upd('chart', (d: ChartData) => { d.size = z })])),
  ch_legend: upd('chart', (d: ChartData) => { d.legend = !d.legend }),
  ...Object.fromEntries((['normalsize', 'large', 'Large', 'huge'] as IconSize[]).map(z => [`ic_${z}`, () => { run(W.updateIcon(i => { i.size = z })); sync() }])),
}

registerActions(actions)
