// The optional Admin & Office, Accountants and Architect tabs
// (core/office.ts): insert commands, the Edit… window of each element and
// its tab's options.
import { OFFICE_KINDS, type OfficeKind } from '../../core/office.ts'
import { LITHOLOGIES, PFD_TYPES } from '../../core/fieldsci.ts'
import type { WidgetKind } from '../../core/widgets.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import * as W from '../../editor/widgetCommands.ts'
import { officeDialog, type GridSpec, type OfficeField } from '../../ui/dialogs/OfficeDialog.tsx'
import { registerActions, type Handler } from '../actions.ts'

const run = (cmd: C.Command): boolean => editor()?.run(cmd) ?? false
const sync = () => editor()?.syncToolbar()
const state = () => editor()?.view.state ?? null
const n = (s: string, d = 0) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : d }

type Spec = { title: string; fields: (d: any) => OfficeField[]; grids: (d: any) => GridSpec[]; apply: (d: any, v: Record<string, string>, g: string[][][]) => void }
const f = (key: string, label: string, value: unknown, more: Partial<OfficeField> = {}): OfficeField => ({ key, label, value: String(value ?? ''), ...more })
const MONEY = { number: true, width: 9 }

const SPECS: Record<OfficeKind, Spec> = {
  pfd: {
    title: 'Process flow diagram', fields: () => [],
    grids: d => [
      { label: 'Units - drawn with chemplants\' standard symbols', help: 'x and y in cm on the drawing (x to the right, y up); the tag names the unit for the streams.',
        cols: [{ name: 'Tag', width: 6 }, { name: 'Type', options: PFD_TYPES }, { name: 'x', width: 4, number: true }, { name: 'y', width: 4, number: true }, { name: 'Label', width: 14 }], rows: d.units },
      { label: 'Streams', help: 'From one unit\'s tag to another\'s; the label is the stream number shown in its box.',
        cols: [{ name: 'From', width: 6 }, { name: 'To', width: 6 }, { name: 'Kind', options: ['main', 'secondary', 'utility'] }, { name: 'Label', width: 5 }], rows: d.streams },
    ],
    apply: (d, _v, g) => { d.units = g[0]; d.streams = g[1] },
  },
  streamtable: {
    title: 'Stream table', fields: d => [f('title', 'Title', d.title), f('streams', 'Streams (column names, separated by commas, up to 6)', d.streams)],
    grids: d => [{ label: 'Properties', cols: [{ name: 'Property', width: 14 }, { name: 'Unit', width: 6 }, ...[1, 2, 3, 4, 5, 6].map(i => ({ name: `Stream ${i}`, width: 6, number: true }))], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.streams = v.streams; d.rows = g[0] },
  },
  massbalance: {
    title: 'Mass balance',
    fields: d => [f('title', 'Title', d.title), f('unit', 'Flow unit', d.unit), f('ins', 'Inlet streams (up to 3, separated by commas)', d.ins), f('outs', 'Outlet streams (up to 3, separated by commas)', d.outs)],
    grids: d => [{ label: 'Components - totals and closure are worked out', cols: [{ name: 'Component', width: 12 }, ...['In 1', 'In 2', 'In 3', 'Out 1', 'Out 2', 'Out 3'].map(name => ({ name, width: 6, number: true }))], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.unit = v.unit; d.ins = v.ins; d.outs = v.outs; d.rows = g[0] },
  },
  mccabe: {
    title: 'McCabe–Thiele diagram',
    fields: d => [f('alpha', 'Relative volatility α', d.alpha, { type: 'number' }), f('R', 'Reflux ratio R', d.R, { type: 'number' }),
      f('xF', 'Feed composition xF', d.xF, { type: 'number' }), f('xD', 'Distillate composition xD', d.xD, { type: 'number' }),
      f('xB', 'Bottoms composition xB', d.xB, { type: 'number' }), f('q', 'Feed quality q (1 = saturated liquid, 0 = saturated vapour)', d.q, { type: 'number' })],
    grids: () => [],
    apply: (d, v) => { d.alpha = n(v.alpha, 2.5); d.R = n(v.R, 1.5); d.xF = n(v.xF, 0.5); d.xD = n(v.xD, 0.95); d.xB = n(v.xB, 0.05); d.q = n(v.q, 1) },
  },
  ternary: {
    title: 'Ternary diagram', fields: d => [f('a', 'First component (bottom left)', d.a), f('b', 'Second component (top)', d.b), f('c', 'Third component (bottom right)', d.c)],
    grids: d => [{ label: 'Samples - any proportions, they are scaled to 100%', cols: [{ name: 'Sample', width: 12 }, { name: 'First', width: 5, number: true }, { name: 'Second', width: 5, number: true }, { name: 'Third', width: 5, number: true }], rows: d.rows }],
    apply: (d, v, g) => { d.a = v.a; d.b = v.b; d.c = v.c; d.rows = g[0] },
  },
  rose: {
    title: 'Rose diagram',
    fields: d => [f('values', 'Azimuths in degrees (strikes, trends, palaeocurrents), separated by commas or spaces', d.values, { type: 'textarea' }),
      f('bin', 'Class width (degrees)', String(d.bin), { type: 'select', options: ['5', '10', '15', '20', '30', '45'] }),
      f('bidirectional', 'Bidirectional (strikes, joints: each also counted at +180°)', d.bidirectional, { type: 'check' })],
    grids: () => [],
    apply: (d, v) => { d.values = v.values; d.bin = n(v.bin, 15); d.bidirectional = v.bidirectional === 'true' },
  },
  stratcol: {
    title: 'Stratigraphic column', fields: d => [f('title', 'Title', d.title)],
    grids: d => [{ label: 'Units, youngest at the top', cols: [{ name: 'Unit', width: 14 }, { name: 'Thickness (m)', width: 6, number: true }, { name: 'Lithology', options: Object.keys(LITHOLOGIES) }, { name: 'Age', width: 10 }], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.rows = g[0] },
  },
  letterhead: {
    title: 'Letterhead',
    fields: d => [f('org', 'Organisation', d.org), f('tagline', 'Tagline', d.tagline), f('address', 'Address (one line)', d.address),
      f('contact', 'Phone · email · web', d.contact), f('style', 'Style', d.style, { type: 'select', options: ['bar', 'centered', 'side'] })],
    grids: () => [], apply: (d, v) => { Object.assign(d, { org: v.org, tagline: v.tagline, address: v.address, contact: v.contact, style: v.style }) },
  },
  signature: {
    title: 'Signature block', fields: d => [f('date', 'A date line under each', d.date, { type: 'check' })],
    grids: d => [{ label: 'Signatories (up to 4, side by side)', cols: [{ name: 'Name', width: 16 }, { name: 'Role', width: 18 }], rows: d.rows }],
    apply: (d, v, g) => { d.date = v.date === 'true'; d.rows = g[0] },
  },
  formfields: {
    title: 'Fillable form', fields: d => [f('title', 'Title', d.title)],
    grids: d => [{ label: 'Fields - filled in in any PDF reader', help: 'For a Choice, list the options separated by commas.',
      cols: [{ name: 'Label', width: 16 }, { name: 'Type', options: ['Text', 'Multi-line', 'Checkbox', 'Choice'] }, { name: 'Options (Choice)', width: 20 }], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.rows = g[0] },
  },
  agenda: {
    title: 'Meeting agenda', fields: d => [f('title', 'Title', d.title), f('info', 'Date · time · place', d.info)],
    grids: d => [{ label: 'Items', cols: [{ name: 'Time', width: 6 }, { name: 'Item', width: 26 }, { name: 'Lead', width: 12 }], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.info = v.info; d.rows = g[0] },
  },
  actions: {
    title: 'Action items', fields: d => [f('title', 'Title', d.title)],
    grids: d => [{ label: 'Actions', cols: [{ name: 'Action', width: 26 }, { name: 'Owner', width: 9 }, { name: 'Due', width: 8 }, { name: 'Status', options: ['Open', 'In progress', 'Done', 'Late'] }], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.rows = g[0] },
  },
  certificate: {
    title: 'Certificate',
    fields: d => [f('title', 'Title', d.title), f('presented', 'Line above the name', d.presented), f('name', 'Name', d.name),
      f('reason', 'For', d.reason, { type: 'textarea' }), f('date', 'Date', d.date), f('signer', 'Signed by', d.signer)],
    grids: () => [], apply: (d, v) => { Object.assign(d, { title: v.title, presented: v.presented, name: v.name, reason: v.reason, date: v.date, signer: v.signer }) },
  },
  stamp: {
    title: 'Stamp', fields: d => [f('text', 'Text', d.text, { help: 'APPROVED, DRAFT, PAID, CONFIDENTIAL, RECEIVED...' }), f('sub', 'Second line (date...)', d.sub),
      f('angle', 'Tilt (degrees)', d.angle, { type: 'number' })],
    grids: () => [], apply: (d, v) => { d.text = v.text; d.sub = v.sub; d.angle = n(v.angle, -12) },
  },
  calendar: {
    title: 'Calendar',
    fields: d => [f('view', 'Show', d.view ?? 'month', { type: 'select', options: ['month', 'week', 'day'] }),
      f('year', 'Year', d.year, { type: 'number' }), f('month', 'Month', String(d.month), { type: 'select', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] }),
      f('day', 'Day (the week holding it, or the day)', d.day ?? 1, { type: 'number' }),
      f('monday', 'Weeks start on Monday', d.monday, { type: 'check' })],
    grids: d => [{ label: 'Events', help: 'Start an event with its time to place it in the week or the day: "09:30 Seminar", "14:00-15:30 Lab". Without a time it is an all-day event (a to-do in the day view).',
      cols: [{ name: 'Day', width: 4, number: true }, { name: 'Event', width: 24 }], rows: d.rows }],
    apply: (d, v, g) => {
      d.year = n(v.year, 2026); d.month = n(v.month, 1); d.monday = v.monday === 'true'; d.rows = g[0]
      d.view = (['month', 'week', 'day'] as const).find(x => x === v.view) ?? 'month'
      d.day = Math.max(1, Math.min(31, n(v.day, 1)))
    },
  },
  fintable: {
    title: 'Financial statement',
    fields: d => [f('title', 'Title', d.title), f('currency', 'Currency sign', d.currency), f('years', 'Columns (years), separated by commas', d.years),
      f('brackets', 'Negative figures in brackets', d.brackets, { type: 'check' })],
    grids: d => [{ label: 'Lines', help: 'Type a Line\'s figures; leave a Subtotal or Total empty and it adds itself up (a Subtotal: the lines since the last heading; a Total: the subtotals). Costs are negative.',
      cols: [{ name: 'Type', options: ['Line', 'Heading', 'Subtotal', 'Total'] }, { name: 'Label', width: 20 }, { name: 'Year 1', ...MONEY }, { name: 'Year 2', ...MONEY }, { name: 'Year 3', ...MONEY }], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.currency = v.currency; d.years = v.years; d.brackets = v.brackets === 'true'; d.rows = g[0] },
  },
  invoice: {
    title: 'Invoice',
    fields: d => [f('number', 'Invoice number', d.number), f('currency', 'Currency sign', d.currency), f('date', 'Date', d.date), f('due', 'Due', d.due),
      f('from', 'From (your name and address)', d.from, { type: 'textarea' }), f('to', 'Bill to', d.to, { type: 'textarea' }),
      f('vat', 'VAT / tax rate (%)', d.vat, { type: 'number' }), f('notes', 'Notes (payment terms, bank details)', d.notes, { type: 'textarea' })],
    grids: d => [{ label: 'Items - the amounts, VAT and total are worked out', cols: [{ name: 'Description', width: 26 }, { name: 'Qty', width: 5, number: true }, { name: 'Unit price', ...MONEY }], rows: d.rows }],
    apply: (d, v, g) => { Object.assign(d, { number: v.number, currency: v.currency, date: v.date, due: v.due, from: v.from, to: v.to, vat: n(v.vat), notes: v.notes }); d.rows = g[0] },
  },
  budget: {
    title: 'Budget vs actual', fields: d => [f('title', 'Title', d.title), f('currency', 'Currency sign', d.currency)],
    grids: d => [{ label: 'Categories - variance, % used and totals are worked out', cols: [{ name: 'Category', width: 18 }, { name: 'Budget', ...MONEY }, { name: 'Actual', ...MONEY }], rows: d.rows }],
    apply: (d, v, g) => { d.title = v.title; d.currency = v.currency; d.rows = g[0] },
  },
  loan: {
    title: 'Loan schedule',
    fields: d => [f('principal', 'Amount borrowed', d.principal, { type: 'number' }), f('rate', 'Interest rate (% a year)', d.rate, { type: 'number' }),
      f('years', 'Term (years)', d.years, { type: 'number' }), f('per', 'Payments', d.per, { type: 'select', options: ['monthly', 'quarterly', 'yearly'] }),
      f('currency', 'Currency sign', d.currency)],
    grids: () => [], apply: (d, v) => { d.principal = n(v.principal, 1000); d.rate = n(v.rate); d.years = Math.max(1, n(v.years, 1)); d.per = v.per; d.currency = v.currency },
  },
  kpi: {
    title: 'KPI cards', fields: () => [],
    grids: d => [{ label: 'Cards (up to 6)', help: 'A change starting with - is red, otherwise green. Start the label with ! when falling is good (churn, costs).',
      cols: [{ name: 'Label', width: 14 }, { name: 'Value', width: 9 }, { name: 'Change', width: 9 }], rows: d.rows }],
    apply: (d, _v, g) => { d.rows = g[0] },
  },
  waterfall: {
    title: 'Waterfall chart',
    fields: d => [f('start', 'Start (label: value)', d.start), f('end', 'End label', d.end), f('currency', 'Unit shown', d.currency)],
    grids: d => [{ label: 'Changes (negative = down)', cols: [{ name: 'Label', width: 18 }, { name: 'Change', ...MONEY }], rows: d.rows }],
    apply: (d, v, g) => { d.start = v.start; d.end = v.end; d.currency = v.currency; d.rows = g[0] },
  },
  floorplan: {
    title: 'Floor plan',
    fields: d => [f('dims', 'Overall dimensions', d.dims, { type: 'check' }), f('areas', 'Room areas', d.areas, { type: 'check' })],
    grids: d => [
      { label: 'Rooms, in metres (x, y = the corner nearest the bottom left)', cols: [{ name: 'Room', width: 14 }, { name: 'x', width: 5, number: true }, { name: 'y', width: 5, number: true }, { name: 'Width', width: 5, number: true }, { name: 'Depth', width: 5, number: true }], rows: d.rooms },
      { label: 'Doors and windows (on a wall: its start point, length, along x = h or y = v)', cols: [{ name: 'Type', options: ['Door', 'Window'] }, { name: 'x', width: 5, number: true }, { name: 'y', width: 5, number: true }, { name: 'Length', width: 5, number: true }, { name: 'Along', options: ['h', 'v'] }], rows: d.openings },
    ],
    apply: (d, v, g) => { d.dims = v.dims === 'true'; d.areas = v.areas === 'true'; d.rooms = g[0]; d.openings = g[1] },
  },
  titleblock: {
    title: 'Title block',
    fields: d => [f('firm', 'Practice', d.firm), f('project', 'Project', d.project), f('client', 'Client', d.client), f('title', 'Drawing title', d.title),
      f('number', 'Drawing no.', d.number), f('scale', 'Scale', d.scale), f('date', 'Date', d.date), f('drawn', 'Drawn by', d.drawn), f('checked', 'Checked by', d.checked), f('revision', 'Revision', d.revision)],
    grids: () => [], apply: (d, v) => { Object.assign(d, v) },
  },
  scalebar: {
    title: 'Scale bar and north arrow',
    fields: d => [f('scale', 'Scale', d.scale, { help: 'e.g. 1:50, 1:100, 1:200 - the bar is drawn true to it.' }), f('length', 'Bar length (m)', d.length, { type: 'number' }),
      f('north', 'North arrow', d.north, { type: 'check' }), f('angle', 'North turned by (degrees)', d.angle, { type: 'number' })],
    grids: () => [], apply: (d, v) => { d.scale = v.scale; d.length = n(v.length, 5); d.north = v.north === 'true'; d.angle = n(v.angle) },
  },
  rooms: {
    title: 'Room schedule', fields: () => [],
    grids: d => [{ label: 'Rooms - areas and the total are worked out', cols: [{ name: 'Room', width: 14 }, { name: 'Width (m)', width: 6, number: true }, { name: 'Depth (m)', width: 6, number: true }, { name: 'Floor', width: 12 }, { name: 'Notes', width: 14 }], rows: d.rows }],
    apply: (d, _v, g) => { d.rows = g[0] },
  },
  revisions: {
    title: 'Revisions', fields: () => [],
    grids: d => [{ label: 'Revisions', cols: [{ name: 'Rev', width: 4 }, { name: 'Date', width: 9 }, { name: 'Description', width: 26 }, { name: 'By', width: 5 }], rows: d.rows }],
    apply: (d, _v, g) => { d.rows = g[0] },
  },
}

// Edit… for these elements; false when the selection is not one.
export async function editOffice(): Promise<boolean> {
  const s = state()
  const w = s && W.currentWidget(s)
  if (!w || !(OFFICE_KINDS as readonly string[]).includes(w.widget.kind)) return false
  const spec = SPECS[w.widget.kind as OfficeKind]
  const d = w.widget.data
  const r = await officeDialog(spec.title, spec.fields(d), spec.grids(d))
  if (r) run(W.updateWidget(x => { spec.apply(x, r.values, r.grids) }))
  sync()
  return true
}

function toggle(kind: WidgetKind, key: string): Handler {
  return () => {
    const s = state()
    const w = s && W.currentWidget(s)
    if (!w || w.widget.kind !== kind) return
    run(W.updateWidget(d => { (d as any)[key] = !(d as any)[key] }))
    sync()
  }
}

registerActions({
  ...Object.fromEntries(OFFICE_KINDS.map(k => [`of_${k}`, () => { run(W.insertWidget(k)); sync() }])),
  of_brackets: toggle('fintable', 'brackets'),
  of_sigdate: toggle('signature', 'date'),
  of_monday: toggle('calendar', 'monday'),
  // Month, week or day: the selected calendar shown so, or a new one for
  // today's month, week or day.
  ...Object.fromEntries((['month', 'week', 'day'] as const).map(v => [`of_cal_${v}`, () => {
    const s = state()
    const w = s && W.currentWidget(s)
    if (w?.widget.kind === 'calendar') run(W.updateWidget(d => { (d as any).view = v }))
    else {
      const t = new Date()
      run(W.insertWidget('calendar'))
      run(W.updateWidget(d => { Object.assign(d as object, { view: v, year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() }) }))
    }
    sync()
  }])),
  of_dims: toggle('floorplan', 'dims'),
  of_areas: toggle('floorplan', 'areas'),
  of_north: toggle('scalebar', 'north'),
  of_bidir: toggle('rose', 'bidirectional'),
  ...Object.fromEntries((['bar', 'centered', 'side'] as const).map(st => [`of_lh_${st}`, () => {
    const s = state(); const w = s && W.currentWidget(s)
    if (w?.widget.kind === 'letterhead') { run(W.updateWidget(d => { (d as any).style = st })); sync() }
  }])),
})
