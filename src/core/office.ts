// The optional Admin & Office, Accountants and Architect tabs' elements.
// Each is an ordinary kTeX element (widgets.ts): a "% kTeX <kind> {json}"
// line, then its LaTeX. Every one is made here as either
//   - a table (TableSpec): a booktabs tabular in the PDF, an HTML table in
//     the editor - financial statements, invoices, agendas, schedules...;
//   - a drawing (draw.ts shapes): TikZ in the PDF, SVG in the editor -
//     KPI cards, waterfall, letterhead, certificate, floor plan...;
//   - or, for the fillable form, LaTeX of its own (hyperref's form fields)
//     with a drawing to show in the editor.
// Pure: no DOM.
import { drawingTikz, type Drawing, type Shape } from './draw.ts'
import { FIELD_DEFAULTS, FIELD_KINDS, FIELD_NAMES, fieldPackages, fieldRender, type FieldData, type FieldKind } from './fieldsci.ts'

export const OFFICE_KINDS = [
  // Admin & Office
  'letterhead', 'signature', 'formfields', 'agenda', 'actions', 'certificate', 'stamp', 'calendar',
  // Accountants
  'fintable', 'invoice', 'budget', 'loan', 'kpi', 'waterfall',
  // Architect
  'floorplan', 'titleblock', 'scalebar', 'rooms', 'revisions',
  // Chemical Engineering, Earth Science (fieldsci.ts)
  ...FIELD_KINDS,
] as const
export type OfficeKind = typeof OFFICE_KINDS[number]

export const OFFICE_NAMES: Record<OfficeKind, string> = {
  letterhead: 'Letterhead', signature: 'Signature Block', formfields: 'Fillable Form', agenda: 'Meeting Agenda',
  actions: 'Action Items', certificate: 'Certificate', stamp: 'Stamp', calendar: 'Calendar',
  fintable: 'Financial Statement', invoice: 'Invoice', budget: 'Budget vs Actual', loan: 'Loan Schedule',
  kpi: 'KPI Cards', waterfall: 'Waterfall Chart',
  floorplan: 'Floor Plan', titleblock: 'Title Block', scalebar: 'Scale & North', rooms: 'Room Schedule', revisions: 'Revisions',
  ...FIELD_NAMES,
}

// ------------------------------------------------------------------ data

export interface LetterheadData { org: string; tagline: string; address: string; contact: string; style: 'bar' | 'centered' | 'side'; color: string }
export interface SignatureData { rows: string[][]; date: boolean; color: string }                    // [name, role]
export interface FormFieldsData { title: string; rows: string[][]; color: string }                     // [label, type, options]
export interface AgendaData { title: string; info: string; rows: string[][]; color: string }          // [time, item, lead]
export interface ActionsData { title: string; rows: string[][]; color: string }                       // [action, owner, due, status]
export interface CertificateData { title: string; presented: string; name: string; reason: string; date: string; signer: string; color: string }
export interface StampData { text: string; sub: string; angle: number; color: string }
// [day, event]; an event may start with its time ("09:30 Seminar",
// "14:00-15:30 Lab"). view: a month (the default), the week holding `day`,
// or the single `day` hour by hour.
export interface CalendarData {
  year: number; month: number; monday: boolean; rows: string[][]; color: string
  view?: 'month' | 'week' | 'day'; day?: number
}
export interface FinTableData { title: string; currency: string; years: string; brackets: boolean; rows: string[][]; color: string } // [type, label, v1, v2]
export interface InvoiceData { from: string; to: string; number: string; date: string; due: string; currency: string; vat: number; notes: string; rows: string[][]; color: string } // [desc, qty, price]
export interface BudgetData { title: string; currency: string; rows: string[][]; color: string }      // [category, budget, actual]
export interface LoanData { principal: number; rate: number; years: number; per: 'monthly' | 'quarterly' | 'yearly'; currency: string; color: string }
export interface KpiData { rows: string[][]; color: string }                                          // [label, value, change]
export interface WaterfallData { currency: string; start: string; end: string; rows: string[][]; color: string } // [label, value]
export interface FloorPlanData { rooms: string[][]; openings: string[][]; dims: boolean; areas: boolean; color: string } // [name, x, y, w, d] · [type, x, y, length, h|v]
export interface TitleBlockData { firm: string; project: string; client: string; title: string; number: string; scale: string; date: string; drawn: string; checked: string; revision: string; color: string }
export interface ScaleBarData { scale: string; length: number; north: boolean; angle: number; color: string }
export interface RoomsData { rows: string[][]; color: string }                                         // [room, width, depth, floor, notes]
export interface RevisionsData { rows: string[][]; color: string }                                     // [rev, date, description, by]

export interface OfficeData extends FieldData {
  letterhead: LetterheadData; signature: SignatureData; formfields: FormFieldsData; agenda: AgendaData; actions: ActionsData
  certificate: CertificateData; stamp: StampData; calendar: CalendarData
  fintable: FinTableData; invoice: InvoiceData; budget: BudgetData; loan: LoanData; kpi: KpiData; waterfall: WaterfallData
  floorplan: FloorPlanData; titleblock: TitleBlockData; scalebar: ScaleBarData; rooms: RoomsData; revisions: RevisionsData
}

export const OFFICE_DEFAULTS: OfficeData = {
  ...FIELD_DEFAULTS,
  letterhead: { org: 'Northbridge Consulting Ltd', tagline: 'Engineering · Surveys · Advice', address: '12 Harbour Street, Bristol BS1 4QA',
    contact: '0117 496 0123 · hello@northbridge.example · northbridge.example', style: 'bar', color: '1F6FB5' },
  signature: { rows: [['Jane Smith', 'Managing Director'], ['Omar Haddad', 'Finance Director']], date: true, color: '333333' },
  formfields: { title: 'Registration form', color: '1F6FB5', rows: [
    ['Full name', 'Text', ''], ['Email', 'Text', ''], ['Department', 'Choice', 'Finance, Operations, Sales, Research'],
    ['Attending the dinner', 'Checkbox', ''], ['Comments', 'Multi-line', '']] },
  agenda: { title: 'Board meeting', info: 'Thursday 4 December 2026 · 10:00 · Room 2.14', color: '1F6FB5', rows: [
    ['10:00', 'Welcome and apologies', 'Chair'], ['10:05', 'Minutes of the last meeting', 'Secretary'],
    ['10:15', 'Quarterly accounts', 'Finance Director'], ['10:45', 'New office lease', 'Operations'], ['11:15', 'Any other business', 'All']] },
  actions: { title: 'Action items', color: '1F6FB5', rows: [
    ['Circulate the revised budget', 'Omar', '8 Dec', 'Done'], ['Get three quotes for the lease', 'Priya', '15 Dec', 'In progress'],
    ['Book the auditors', 'Jane', '9 Jan', 'Open']] },
  certificate: { title: 'Certificate of Achievement', presented: 'This certificate is presented to', name: 'Alex Morgan',
    reason: 'for completing the Advanced Health and Safety course with distinction', date: '24 November 2026', signer: 'Jane Smith, Director', color: '1F6FB5' },
  stamp: { text: 'APPROVED', sub: '24 Nov 2026', angle: -12, color: 'C62828' },
  calendar: { year: 2026, month: 12, monday: true, color: '1F6FB5', rows: [['4', 'Board meeting'], ['15', 'Lease quotes'], ['24', 'Office closes']] },
  fintable: { title: 'Statement of profit or loss', currency: '£', years: '2026, 2025', brackets: true, color: '1F6FB5', rows: [
    ['Heading', 'Revenue', '', ''], ['Line', 'Sales', '482000', '431500'], ['Line', 'Other income', '12400', '9800'], ['Subtotal', 'Total revenue', '', ''],
    ['Heading', 'Expenses', '', ''], ['Line', 'Cost of sales', '-211000', '-198300'], ['Line', 'Staff costs', '-148500', '-139200'],
    ['Line', 'Rent and rates', '-36000', '-36000'], ['Line', 'Depreciation', '-14200', '-12900'], ['Subtotal', 'Total expenses', '', ''],
    ['Total', 'Profit before tax', '', '']] },
  invoice: { from: 'Northbridge Consulting Ltd\n12 Harbour Street\nBristol BS1 4QA', to: 'Harbourside Developments\n3 Quay Road\nBristol BS1 5TT',
    number: 'INV-2026-0142', date: '24 Nov 2026', due: '24 Dec 2026', currency: '£', vat: 20, color: '1F6FB5',
    notes: 'Payment by bank transfer within 30 days. Thank you for your business.', rows: [
      ['Site survey (days)', '3', '650'], ['Structural report', '1', '1800'], ['Travel', '1', '120']] },
  budget: { title: 'Department budget, Q3', currency: '£', color: '1F6FB5', rows: [
    ['Salaries', '120000', '118400'], ['Equipment', '15000', '19250'], ['Travel', '8000', '5100'], ['Training', '6000', '6600'], ['Software', '9000', '8700']] },
  loan: { principal: 250000, rate: 4.5, years: 10, per: 'monthly', currency: '£', color: '1F6FB5' },
  kpi: { color: '1F6FB5', rows: [['Revenue', '£494k', '+11.4%'], ['Gross margin', '57.3%', '+1.8 pts'], ['Customers', '1,284', '+6.2%'], ['Churn', '3.1%', '-0.4 pts']] },
  waterfall: { currency: '£k', start: 'Opening cash: 120', end: 'Closing cash', color: '1F6FB5', rows: [
    ['Sales receipts', '310'], ['Supplier payments', '-165'], ['Salaries', '-118'], ['Loan', '40'], ['Tax', '-22']] },
  floorplan: { dims: true, areas: true, color: '333333',
    rooms: [['Living room', '0', '0', '5', '4'], ['Kitchen', '5', '0', '3.5', '4'], ['Bedroom', '0', '4', '4', '3.2'], ['Bathroom', '4', '4', '2', '3.2'], ['Hall', '6', '4', '2.5', '3.2']],
    openings: [['Door', '6.5', '0', '0.9', 'h'], ['Window', '1.5', '0', '1.8', 'h'], ['Window', '8.5', '1', '1.4', 'v'], ['Door', '6', '4.8', '0.8', 'v'], ['Door', '4.5', '4', '0.8', 'h'], ['Window', '1', '7.2', '1.6', 'h']] },
  titleblock: { firm: 'Morgan & Reid Architects', project: 'Harbourside House', client: 'Harbourside Developments', title: 'Ground floor plan',
    number: 'HH-A-101', scale: '1:100 @ A3', date: 'Nov 2026', drawn: 'AM', checked: 'JR', revision: 'B', color: '333333' },
  scalebar: { scale: '1:100', length: 5, north: true, angle: 0, color: '333333' },
  rooms: { color: '1F6FB5', rows: [['Living room', '5', '4', 'Oak boards', ''], ['Kitchen', '3.5', '4', 'Porcelain tiles', 'Underfloor heating'],
    ['Bedroom', '4', '3.2', 'Carpet', ''], ['Bathroom', '2', '3.2', 'Porcelain tiles', 'Wet room'], ['Hall', '2.5', '3.2', 'Oak boards', '']] },
  revisions: { color: '1F6FB5', rows: [['A', '02 Oct 2026', 'First issue for planning', 'AM'], ['B', '24 Nov 2026', 'Kitchen window enlarged; hall door moved', 'AM']] },
}

// --------------------------------------------------------------- helpers

const hex = (c: string) => (/^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '') : '1F6FB5').toUpperCase()
const INK = '333333', GREY = '888888', GOOD = '2E7D32', BAD = 'C62828'
export const num = (s: unknown): number => {
  const v = parseFloat(String(s ?? '').replace(/[£$€¥,\s]/g, '').replace(/^\((.*)\)$/, '-$1'))
  return Number.isFinite(v) ? v : NaN
}
const has = (s: unknown) => Number.isFinite(num(s))
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(Boolean)

// 1234567.5 -> "1,234,567.50"; negatives as (1,234) or -1,234.
export function money(n: number, cur = '', dp = 0, brackets = true): string {
  if (!Number.isFinite(n)) return ''
  const a = Math.abs(n).toFixed(dp).split('.')
  const s = a[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (a[1] ? '.' + a[1] : '')
  if (n < 0 && Math.abs(n) >= 0.5 * 10 ** -dp) return brackets ? `(${cur}${s})` : `-${cur}${s}`
  return cur + s
}

// LaTeX special characters in plain text.
export function tex(s: string): string {
  return String(s).replace(/[\\{}$&#^_%~]/g, c => c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\^{}' : c === '~' ? '\\~{}' : '\\' + c)
}

const text = (x: number, y: number, s: string, o: Partial<Extract<Shape, { t: 'text' }>> = {}): Shape => ({ t: 'text', x, y, s, size: 9.5, color: INK, ...o })

// ---------------------------------------------------------------- tables

export type RowStyle = 'normal' | 'heading' | 'subtotal' | 'total' | 'muted'
export interface TableRow { cells: string[]; style?: RowStyle; colors?: (string | undefined)[] }
export interface TableSpec {
  title?: string
  // Lines above the table: [left, right] blocks; the first line of each bold.
  info?: [string[], string[]]
  cols: { align: 'l' | 'r' | 'c'; width?: number }[]   // width in cm: a wrapping column
  header?: string[]
  rows: TableRow[]
  note?: string
  color: string
}

export function tableLatex(t: TableSpec): string {
  const C = hex(t.color)
  const n = t.cols.length
  const spec = t.cols.map(c => c.width ? `>{\\raggedright\\arraybackslash}p{${c.width}cm}` : c.align).join('')
  // In a minipage: the title, the details and the table stay on one page.
  const out = [`\\begingroup\\definecolor{kO}{HTML}{${C}}\\par\\medskip\\noindent\\begin{minipage}{\\linewidth}`]
  if (t.title) out.push(`{\\large\\bfseries\\color{kO}${tex(t.title)}}\\par\\smallskip\\noindent`)
  if (t.info) {
    const block = (ls: string[], align: string) => ls.length
      ? `\\begin{minipage}[t]{0.48\\linewidth}${align}${ls.map((l, i) => (i === 0 ? `\\textbf{${tex(l)}}` : tex(l))).join('\\\\')}\\end{minipage}` : `\\begin{minipage}[t]{0.48\\linewidth}\\mbox{}\\end{minipage}`
    out.push(`${block(t.info[0], '\\raggedright ')}\\hfill${block(t.info[1], '\\raggedleft ')}\\par\\medskip\\noindent`)
  }
  out.push(`{\\small\\setlength{\\tabcolsep}{5pt}\\renewcommand{\\arraystretch}{1.15}\\begin{tabular}{${spec}}`, '\\toprule')
  if (t.header) out.push(`\\rowcolor{kO!12}${t.header.map(h => `\\textbf{${tex(h)}}`).join(' & ')} \\\\`, '\\midrule')
  for (const r of t.rows) {
    const cell = (s: string, i: number) => {
      let v = tex(s)
      const col = r.colors?.[i]
      if (col) v = `\\textcolor[HTML]{${hex(col)}}{${v}}`
      if (r.style === 'subtotal' || r.style === 'total' || r.style === 'heading') v = `\\textbf{${v}}`
      if (r.style === 'muted') v = `\\textcolor{gray}{${v}}`
      return v
    }
    if (r.style === 'heading') {
      out.push(`\\multicolumn{${n}}{l}{\\textbf{\\color{kO}${tex(r.cells[0] ?? '')}}} \\\\`)
      continue
    }
    if (r.style === 'subtotal') out.push(`\\cmidrule(l){2-${n}}`)
    if (r.style === 'total') out.push('\\midrule')
    out.push(`${r.cells.map(cell).join(' & ')} \\\\`)
    if (r.style === 'total') out.push('\\midrule[0.8pt]')
  }
  out.push('\\bottomrule', '\\end{tabular}}\\par')
  if (t.note) out.push(`\\smallskip\\noindent{\\footnotesize\\color{gray}${tex(t.note)}}\\par`)
  out.push('\\end{minipage}\\par\\medskip\\endgroup')
  return out.join('\n')
}

// -------------------------------------------------------- the elements

const STATUS_COLOR: Record<string, string> = { done: GOOD, 'in progress': 'E65100', open: BAD, late: BAD }

function finTable(d: FinTableData): TableSpec {
  const years = d.years.split(',').map(y => y.trim()).filter(Boolean).slice(0, 4)
  const nY = Math.max(1, years.length)
  const cur = d.currency
  const fmt = (v: number) => money(v, cur, 0, d.brackets)
  let section = Array(nY).fill(0), subs = Array(nY).fill(0), anySub = false, lineSum = Array(nY).fill(0)
  const rows: TableRow[] = []
  for (const r of d.rows) {
    const type = (r[0] || 'Line').toLowerCase()
    const vals = Array.from({ length: nY }, (_, i) => r[2 + i] ?? '')
    if (type === 'heading') { rows.push({ cells: [r[1] ?? ''], style: 'heading' }); section = Array(nY).fill(0); continue }
    if (type === 'subtotal') {
      const v = vals.map((s, i) => (has(s) ? num(s) : section[i]))
      v.forEach((x, i) => { subs[i] += x }); anySub = true
      rows.push({ cells: [r[1] ?? '', ...v.map(fmt)], style: 'subtotal' }); section = Array(nY).fill(0); continue
    }
    if (type === 'total') {
      const base = anySub ? subs : lineSum
      const v = vals.map((s, i) => (has(s) ? num(s) : base[i] + (anySub ? section[i] : 0)))
      rows.push({ cells: [r[1] ?? '', ...v.map(fmt)], style: 'total' })
      subs = Array(nY).fill(0); lineSum = Array(nY).fill(0); section = Array(nY).fill(0); anySub = false; continue
    }
    const v = vals.map(num)
    v.forEach((x, i) => { if (Number.isFinite(x)) { section[i] += x; lineSum[i] += x } })
    rows.push({ cells: [r[1] ?? '', ...v.map(x => (Number.isFinite(x) ? fmt(x) : ''))] })
  }
  return { title: d.title, cols: [{ align: 'l', width: 7 }, ...years.map(() => ({ align: 'r' as const }))], header: ['', ...years], rows, color: d.color,
    note: d.brackets ? 'Figures in brackets are negative.' : undefined }
}

export function invoiceTotals(d: InvoiceData) {
  const items = d.rows.map(r => ({ desc: r[0] ?? '', qty: num(r[1]), price: num(r[2]) }))
  const net = items.reduce((s, i) => s + (Number.isFinite(i.qty * i.price) ? i.qty * i.price : 0), 0)
  const vat = net * (Number(d.vat) || 0) / 100
  return { items, net, vat, total: net + vat }
}

function invoiceTable(d: InvoiceData): TableSpec {
  const { items, net, vat, total } = invoiceTotals(d)
  const m = (v: number) => money(v, d.currency, 2, false)
  const rows: TableRow[] = items.map(i => ({ cells: [i.desc, Number.isFinite(i.qty) ? String(i.qty) : '', m(i.price), m(i.qty * i.price)] }))
  rows.push({ cells: ['', '', 'Subtotal', m(net)], style: 'subtotal' })
  rows.push({ cells: ['', '', `VAT ${Number(d.vat) || 0}%`, m(vat)], style: 'muted' })
  rows.push({ cells: ['', '', 'Total due', m(total)], style: 'total' })
  return {
    title: `Invoice ${d.number}`,
    info: [lines(d.to).length ? ['Bill to', ...lines(d.to)] : [], [...lines(d.from), `Date: ${d.date}`, `Due: ${d.due}`]],
    cols: [{ align: 'l', width: 7.5 }, { align: 'r' }, { align: 'r' }, { align: 'r' }],
    header: ['Description', 'Qty', 'Unit price', 'Amount'], rows, note: d.notes || undefined, color: d.color,
  }
}

function budgetTable(d: BudgetData): TableSpec {
  const m = (v: number) => money(v, d.currency, 0, true)
  let tb = 0, ta = 0
  const rows: TableRow[] = d.rows.map(r => {
    const b = num(r[1]), a = num(r[2]), v = b - a
    if (Number.isFinite(b)) tb += b
    if (Number.isFinite(a)) ta += a
    const pc = b ? `${((a / b) * 100).toFixed(0)}%` : ''
    return { cells: [r[0] ?? '', m(b), m(a), m(v), pc], colors: [undefined, undefined, undefined, v < 0 ? BAD : GOOD] }
  })
  rows.push({ cells: ['Total', m(tb), m(ta), m(tb - ta), tb ? `${((ta / tb) * 100).toFixed(0)}%` : ''], style: 'total', colors: [undefined, undefined, undefined, tb - ta < 0 ? BAD : GOOD] })
  return { title: d.title, cols: [{ align: 'l', width: 5 }, { align: 'r' }, { align: 'r' }, { align: 'r' }, { align: 'r' }],
    header: ['', 'Budget', 'Actual', 'Variance', 'Used'], rows, note: 'Variance = budget - actual: green under budget, red over.', color: d.color }
}

export function loanSchedule(d: LoanData) {
  const k = d.per === 'monthly' ? 12 : d.per === 'quarterly' ? 4 : 1
  const n = Math.max(1, Math.round((Number(d.years) || 1) * k)), r = (Number(d.rate) || 0) / 100 / k, P = Number(d.principal) || 0
  const pay = r ? (P * r) / (1 - (1 + r) ** -n) : P / n
  const years: { year: number; paid: number; interest: number; principal: number; balance: number }[] = []
  let bal = P
  for (let i = 1; i <= n; i++) {
    const int = bal * r, pr = pay - int
    bal = Math.max(0, bal - pr)
    const y = Math.ceil(i / k)
    if (!years[y - 1]) years[y - 1] = { year: y, paid: 0, interest: 0, principal: 0, balance: 0 }
    const Y = years[y - 1]
    Y.paid += pay; Y.interest += int; Y.principal += pr; Y.balance = bal
  }
  return { pay, n, years, totalInterest: pay * n - P }
}

function loanTable(d: LoanData): TableSpec {
  const s = loanSchedule(d)
  const m = (v: number) => money(v, d.currency, 2, false)
  const rows: TableRow[] = s.years.map(y => ({ cells: [String(y.year), m(y.paid), m(y.interest), m(y.principal), m(y.balance)] }))
  rows.push({ cells: ['Total', m(s.pay * s.n), m(s.totalInterest), m(d.principal), ''], style: 'total' })
  return {
    title: `Loan of ${money(d.principal, d.currency, 0)} at ${d.rate}% over ${d.years} years`,
    info: [[`${d.per[0].toUpperCase() + d.per.slice(1)} payment: ${m(s.pay)}`, `${s.n} payments`], ['Total interest', m(s.totalInterest)]],
    cols: [{ align: 'c' }, { align: 'r' }, { align: 'r' }, { align: 'r' }, { align: 'r' }],
    header: ['Year', 'Paid', 'Interest', 'Principal', 'Balance'], rows, color: d.color,
  }
}

function agendaTable(d: AgendaData): TableSpec {
  return { title: d.title, info: d.info.trim() ? [[d.info], []] : undefined, cols: [{ align: 'r' }, { align: 'l' }, { align: 'l', width: 7.5 }, { align: 'l' }],
    header: ['', 'Time', 'Item', 'Lead'], rows: d.rows.map((r, i) => ({ cells: [`${i + 1}.`, r[0] ?? '', r[1] ?? '', r[2] ?? ''] })), color: d.color }
}

function actionsTable(d: ActionsData): TableSpec {
  return { title: d.title, cols: [{ align: 'l', width: 7.5 }, { align: 'l' }, { align: 'l' }, { align: 'l' }], header: ['Action', 'Owner', 'Due', 'Status'],
    rows: d.rows.map(r => ({ cells: [r[0] ?? '', r[1] ?? '', r[2] ?? '', r[3] ?? ''], colors: [undefined, undefined, undefined, STATUS_COLOR[(r[3] ?? '').toLowerCase()]] })), color: d.color }
}

export const roomArea = (r: string[]) => { const a = num(r[1]) * num(r[2]); return Number.isFinite(a) ? a : 0 }

function roomsTable(d: RoomsData): TableSpec {
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '')
  const total = d.rows.reduce((s, r) => s + roomArea(r), 0)
  const rows: TableRow[] = d.rows.map(r => ({ cells: [r[0] ?? '', f(num(r[1])), f(num(r[2])), f(roomArea(r)), r[3] ?? '', r[4] ?? ''] }))
  rows.push({ cells: ['Total floor area', '', '', f(total), '', ''], style: 'total' })
  return { title: 'Room schedule', cols: [{ align: 'l' }, { align: 'r' }, { align: 'r' }, { align: 'r' }, { align: 'l' }, { align: 'l', width: 3.5 }],
    header: ['Room', 'Width (m)', 'Depth (m)', 'Area (m²)', 'Floor', 'Notes'], rows, color: d.color }
}

function revisionsTable(d: RevisionsData): TableSpec {
  return { title: 'Revisions', cols: [{ align: 'c' }, { align: 'l' }, { align: 'l', width: 8 }, { align: 'c' }], header: ['Rev', 'Date', 'Description', 'By'],
    rows: d.rows.map(r => ({ cells: [r[0] ?? '', r[1] ?? '', r[2] ?? '', r[3] ?? ''] })), color: d.color }
}

// -------------------------------------------------------------- drawings

function kpiDrawing(d: KpiData): Drawing {
  const C = hex(d.color), n = Math.max(1, Math.min(6, d.rows.length)), gap = 0.3, W = 16, w = (W - gap * (n - 1)) / n, h = 2.4
  const shapes: Shape[] = []
  d.rows.slice(0, n).forEach((r, i) => {
    const x = i * (w + gap)
    const ch = (r[2] ?? '').trim(), up = !ch.startsWith('-') && !ch.startsWith('−')
    // "Churn" falling is good: a leading ! in the label flips the colour.
    const flip = (r[0] ?? '').startsWith('!')
    const good = flip ? !up : up
    shapes.push({ t: 'rect', x, y: 0, w, h, fill: 'FFFFFF', stroke: 'D0D0D0', lw: 0.6, r: 0.15 },
      { t: 'rect', x, y: h - 0.12, w, h: 0.12, fill: C },
      text(x + 0.3, h - 0.5, (r[0] ?? '').replace(/^!/, ''), { anchor: 'west', size: 8.5, color: GREY }),
      text(x + 0.3, h - 1.25, r[1] ?? '', { anchor: 'west', size: 16, bold: true, color: INK }))
    if (ch) {
      const col = good ? GOOD : BAD, ax = x + 0.45, ay = 0.45
      shapes.push({ t: 'poly', pts: up ? [[ax - 0.15, ay - 0.1], [ax + 0.15, ay - 0.1], [ax, ay + 0.15]] : [[ax - 0.15, ay + 0.12], [ax + 0.15, ay + 0.12], [ax, ay - 0.13]], fill: col },
        text(ax + 0.3, ay, ch, { anchor: 'west', size: 8.5, color: col, bold: true }))
    }
  })
  return { w: W, h, shapes }
}

function waterfallDrawing(d: WaterfallData): Drawing {
  const C = hex(d.color)
  const sm = /^(.*?):\s*(-?[\d.,]+)\s*$/.exec(d.start)
  const startLabel = sm ? sm[1] : d.start, start = sm ? num(sm[2]) : 0
  const steps = d.rows.map(r => ({ label: r[0] ?? '', v: num(r[1]) })).filter(s => Number.isFinite(s.v))
  const bars: { label: string; a: number; b: number; kind: 'total' | 'up' | 'down' }[] = [{ label: startLabel, a: 0, b: start, kind: 'total' }]
  let run = start
  for (const s of steps) { bars.push({ label: s.label, a: run, b: run + s.v, kind: s.v >= 0 ? 'up' : 'down' }); run += s.v }
  bars.push({ label: d.end || 'End', a: 0, b: run, kind: 'total' })
  const lo = Math.min(0, ...bars.map(b => Math.min(b.a, b.b))), hi = Math.max(...bars.map(b => Math.max(b.a, b.b)), 1)
  const H = 6, W = 16, bw = W / bars.length, y = (v: number) => 1.2 + ((v - lo) / (hi - lo)) * (H - 1.8)
  const shapes: Shape[] = [{ t: 'line', pts: [[0, y(0)], [W, y(0)]], stroke: GREY, lw: 0.5 }]
  bars.forEach((b, i) => {
    const x = i * bw + bw * 0.15, w = bw * 0.7
    const fill = b.kind === 'total' ? C : b.kind === 'up' ? '43A047' : 'E53935'
    shapes.push({ t: 'rect', x, y: y(Math.min(b.a, b.b)), w, h: Math.max(0.02, Math.abs(y(b.b) - y(b.a))), fill })
    const v = b.kind === 'total' ? b.b : b.b - b.a
    shapes.push(text(x + w / 2, y(Math.max(b.a, b.b)) + 0.25, `${v > 0 && b.kind !== 'total' ? '+' : ''}${money(v, '', 0, false)}`, { size: 8, bold: true }))
    shapes.push(text(x + w / 2, 0.55, b.label, { size: 7.5, color: INK }))
    if (i < bars.length - 1) shapes.push({ t: 'line', pts: [[x + w, y(b.b)], [x + bw, y(b.b)]], stroke: GREY, lw: 0.4, dash: true })
  })
  if (d.currency) shapes.push(text(0, H + 0.1, d.currency, { anchor: 'west', size: 8, color: GREY }))
  return { w: W, h: H + 0.4, shapes }
}

function letterheadDrawing(d: LetterheadData): Drawing {
  const C = hex(d.color), W = 16
  const s: Shape[] = []
  if (d.style === 'centered') {
    s.push(text(W / 2, 2.3, d.org, { size: 16, bold: true, color: C }), text(W / 2, 1.7, d.tagline, { size: 8.5, color: GREY }),
      { t: 'line', pts: [[2, 1.25], [W - 2, 1.25]], stroke: C, lw: 1 }, text(W / 2, 0.85, d.address, { size: 8 }), text(W / 2, 0.4, d.contact, { size: 8, color: GREY }))
    return { w: W, h: 2.8, shapes: s }
  }
  if (d.style === 'side') {
    s.push({ t: 'rect', x: 0, y: 0, w: 0.25, h: 2.4, fill: C }, text(0.6, 1.9, d.org, { anchor: 'west', size: 16, bold: true, color: INK }),
      text(0.6, 1.3, d.tagline, { anchor: 'west', size: 8.5, color: C }),
      text(W, 1.9, d.address, { anchor: 'east', size: 8 }), text(W, 1.4, d.contact, { anchor: 'east', size: 8, color: GREY }),
      { t: 'line', pts: [[0.6, 0.6], [W, 0.6]], stroke: 'CCCCCC', lw: 0.5 })
    return { w: W, h: 2.4, shapes: s }
  }
  s.push({ t: 'rect', x: 0, y: 1.2, w: W, h: 1.5, fill: C }, text(0.4, 2.15, d.org, { anchor: 'west', size: 16, bold: true, color: 'FFFFFF' }),
    text(0.4, 1.55, d.tagline, { anchor: 'west', size: 8.5, color: 'FFFFFF' }),
    text(0, 0.8, d.address, { anchor: 'west', size: 8 }), text(W, 0.8, d.contact, { anchor: 'east', size: 8, color: GREY }))
  return { w: W, h: 2.7, shapes: s }
}

function signatureDrawing(d: SignatureData): Drawing {
  const n = Math.max(1, Math.min(4, d.rows.length)), W = 16, gap = 1, w = (W - gap * (n - 1)) / n, top = d.date ? 2.6 : 2
  const s: Shape[] = []
  d.rows.slice(0, n).forEach((r, i) => {
    const x = i * (w + gap)
    s.push({ t: 'line', pts: [[x, top - 0.9], [x + w, top - 0.9]], stroke: INK, lw: 0.6 },
      text(x, top - 1.25, r[0] ?? '', { anchor: 'west', bold: true }), text(x, top - 1.7, r[1] ?? '', { anchor: 'west', size: 8.5, color: GREY }))
    if (d.date) s.push(text(x, 0.2, 'Date:', { anchor: 'west', size: 8.5 }), { t: 'line', pts: [[x + 1, 0.1], [x + w, 0.1]], stroke: GREY, lw: 0.4, dash: true })
  })
  return { w: W, h: top, shapes: s }
}

function formDrawing(d: FormFieldsData): Drawing {
  const C = hex(d.color), W = 16, rowH = 0.9
  const rows = d.rows.filter(r => (r[0] ?? '').trim())
  const hgt = (r: string[]) => ((r[1] ?? '').toLowerCase().startsWith('multi') ? rowH * 2.2 : rowH)
  const H = rows.reduce((s, r) => s + hgt(r), 0) + (d.title ? 0.9 : 0.1)
  const s: Shape[] = []
  let y = H
  if (d.title) { s.push(text(0, y - 0.35, d.title, { anchor: 'west', size: 13, bold: true, color: C })); y -= 0.9 }
  for (const r of rows) {
    const h = hgt(r), type = (r[1] ?? 'Text').toLowerCase()
    s.push(text(0, y - 0.38, r[0], { anchor: 'west', size: 9.5 }))
    if (type === 'checkbox') s.push({ t: 'rect', x: 5, y: y - 0.62, w: 0.45, h: 0.45, fill: 'FFFFFF', stroke: C, lw: 0.7 })
    else {
      const bh = h - 0.3
      s.push({ t: 'rect', x: 5, y: y - h + 0.1, w: W - 5, h: bh, fill: 'F4F8FC', stroke: C, lw: 0.5 })
      if (type === 'choice') s.push({ t: 'poly', pts: [[W - 0.55, y - 0.32], [W - 0.2, y - 0.32], [W - 0.375, y - 0.55]], fill: C },
        text(5.2, y - 0.38, (r[2] ?? '').split(',')[0]?.trim() ?? '', { anchor: 'west', size: 8.5, color: GREY }))
    }
    y -= h
  }
  return { w: W, h: H, shapes: s }
}

// hyperref's form fields, in a Form environment: filled in in any PDF reader.
function formLatex(d: FormFieldsData): string {
  const C = hex(d.color)
  const out = [`\\begingroup\\definecolor{kO}{HTML}{${C}}\\par\\medskip\\noindent`]
  if (d.title) out.push(`{\\large\\bfseries\\color{kO}${tex(d.title)}}\\par\\medskip`)
  out.push('\\begin{Form}', '\\renewcommand{\\LayoutTextField}[2]{\\makebox[4.8cm][l]{#1}#2}', '\\renewcommand{\\LayoutChoiceField}[2]{\\makebox[4.8cm][l]{#1}#2}',
    '\\renewcommand{\\LayoutCheckField}[2]{\\makebox[4.8cm][l]{#1}#2}', '\\noindent\\begin{tabular}{@{}l@{}}')
  d.rows.filter(r => (r[0] ?? '').trim()).forEach((r, i) => {
    const type = (r[1] ?? 'Text').toLowerCase(), label = tex(r[0]), name = `f${i}`
    const style = 'bordercolor={0 0.3 0.6},backgroundcolor={0.95 0.97 0.99}'
    if (type === 'checkbox') out.push(`\\CheckBox[name=${name},width=1.1em,height=1.1em,${style}]{${label}} \\\\[4pt]`)
    else if (type === 'choice') {
      const opts = (r[2] ?? '').split(',').map(x => tex(x.trim())).filter(Boolean)
      out.push(`\\ChoiceMenu[combo,name=${name},width=10cm,height=1.4em,${style}]{${label}}{${opts.join(',')}} \\\\[4pt]`)
    } else if (type.startsWith('multi')) out.push(`\\TextField[name=${name},multiline=true,width=10cm,height=3.2em,${style}]{${label}} \\\\[4pt]`)
    else out.push(`\\TextField[name=${name},width=10cm,height=1.4em,${style}]{${label}} \\\\[4pt]`)
  })
  out.push('\\end{tabular}', '\\end{Form}\\par\\medskip\\endgroup')
  return out.join('\n')
}

function certificateDrawing(d: CertificateData): Drawing {
  const C = hex(d.color), W = 16, H = 11
  const s: Shape[] = [
    { t: 'rect', x: 0, y: 0, w: W, h: H, fill: 'FFFFFF', stroke: C, lw: 3 },
    { t: 'rect', x: 0.35, y: 0.35, w: W - 0.7, h: H - 0.7, stroke: C, lw: 0.8 },
    ...[[0.35, 0.35], [W - 0.35, 0.35], [0.35, H - 0.35], [W - 0.35, H - 0.35]].map(([x, y]): Shape => ({ t: 'circle', x, y, r: 0.22, fill: C })),
    text(W / 2, H - 2, d.title, { size: 20, bold: true, color: C }),
    { t: 'line', pts: [[W / 2 - 3, H - 2.7], [W / 2 + 3, H - 2.7]], stroke: C, lw: 0.6 },
    text(W / 2, H - 3.7, d.presented, { size: 10, color: GREY }),
    text(W / 2, H - 4.9, d.name, { size: 20, bold: true, color: INK }),
  ]
  // The reason, wrapped to about 70 characters a line.
  const words = d.reason.split(/\s+/), rl: string[] = []
  for (const w of words) { if (rl.length && (rl[rl.length - 1] + ' ' + w).length <= 70) rl[rl.length - 1] += ' ' + w; else rl.push(w) }
  rl.slice(0, 3).forEach((l, i) => s.push(text(W / 2, H - 6.1 - i * 0.55, l, { size: 10 })))
  s.push({ t: 'line', pts: [[1.8, 2.1], [6.3, 2.1]], stroke: INK, lw: 0.5 }, text(4.05, 1.65, d.date, { size: 9 }), text(4.05, 1.15, 'Date', { size: 8, color: GREY }),
    { t: 'line', pts: [[W - 6.3, 2.1], [W - 1.8, 2.1]], stroke: INK, lw: 0.5 }, text(W - 4.05, 1.65, d.signer, { size: 9 }), text(W - 4.05, 1.15, 'Signature', { size: 8, color: GREY }),
    { t: 'circle', x: W / 2, y: 2, r: 1, fill: C }, { t: 'circle', x: W / 2, y: 2, r: 0.8, stroke: 'FFFFFF', lw: 0.8 },
    { t: 'poly', pts: [[W / 2 - 0.6, 1.2], [W / 2 - 0.9, 0.2], [W / 2 - 0.3, 0.5], [W / 2, 1.1]], fill: C },
    { t: 'poly', pts: [[W / 2 + 0.6, 1.2], [W / 2 + 0.9, 0.2], [W / 2 + 0.3, 0.5], [W / 2, 1.1]], fill: C })
  return { w: W, h: H, shapes: s }
}

function stampDrawing(d: StampData): Drawing {
  const C = hex(d.color), a = (Number(d.angle) || 0) * Math.PI / 180
  const w = Math.max(3, d.text.length * 0.55 + 1.2), h = d.sub ? 1.9 : 1.3, cx = 3.5, cy = 1.6
  const rot = (x: number, y: number): [number, number] => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]
  const box = (pw: number, ph: number) => [rot(-pw / 2, -ph / 2), rot(pw / 2, -ph / 2), rot(pw / 2, ph / 2), rot(-pw / 2, ph / 2), rot(-pw / 2, -ph / 2)]
  const deg = Number(d.angle) || 0
  const s: Shape[] = [{ t: 'line', pts: box(w, h), stroke: C, lw: 2.4 }, { t: 'line', pts: box(w - 0.25, h - 0.25), stroke: C, lw: 0.7 }]
  const [tx, ty] = rot(0, d.sub ? 0.22 : 0)
  s.push({ t: 'text', x: tx, y: ty, s: d.text, size: 20, bold: true, color: C, rotate: deg })
  if (d.sub) { const [sx, sy] = rot(0, -0.55); s.push({ t: 'text', x: sx, y: sy, s: d.sub, size: 9, color: C, rotate: deg }) }
  return { w: 7, h: 3.2, shapes: s }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// An event's time ("09:30", "14:00-15:30") in hours, and its text.
function timed(e: string): { from: number | null; to: number | null; text: string } {
  const m = /^\s*(\d{1,2})[:.h](\d{2})(?:\s*[-–]\s*(\d{1,2})[:.h](\d{2}))?\s+(.*)$/.exec(e)
  if (!m) return { from: null, to: null, text: e.trim() }
  const from = Number(m[1]) + Number(m[2]) / 60
  const to = m[3] ? Number(m[3]) + Number(m[4]) / 60 : from + 1
  return { from, to: Math.max(to, from + 0.25), text: m[5].trim() }
}

// The events of each day of the month.
function eventsByDay(d: CalendarData, days: number): Map<number, string[]> {
  const ev = new Map<number, string[]>()
  for (const r of d.rows) { const k = Math.round(num(r[0])); if (k >= 1 && k <= days && (r[1] ?? '').trim()) ev.set(k, [...(ev.get(k) ?? []), r[1].trim()]) }
  return ev
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:00`

function calendarDrawing(d: CalendarData): Drawing {
  if (d.view === 'week') return weekDrawing(d)
  if (d.view === 'day') return dayDrawing(d)
  return monthDrawing(d)
}

// A week, Monday (or Sunday) to Sunday, hour by hour from 8:00 to 19:00;
// events without a time across the top.
function weekDrawing(d: CalendarData): Drawing {
  const C = hex(d.color), y0 = Number(d.year) || 2026, m0 = Math.max(1, Math.min(12, Number(d.month) || 1)) - 1
  const days = new Date(Date.UTC(y0, m0 + 1, 0)).getUTCDate()
  const pick = Math.max(1, Math.min(days, Math.round(Number(d.day) || 1)))
  const at = new Date(Date.UTC(y0, m0, pick))
  const back = d.monday ? (at.getUTCDay() + 6) % 7 : at.getUTCDay()
  const start = new Date(at.getTime() - back * 864e5)
  const dates = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 864e5))
  const ev = eventsByDay(d, days)
  const H0 = 8, H1 = 19, rh = 0.62, lw = 1.1, cw = (16 - lw) / 7, allDay = 0.9
  const grid = (H1 - H0) * rh, head = 0.75
  const H = grid + allDay + head + 0.9
  const top = grid + allDay + head
  // ISO week number.
  const t = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)
  const last = dates[6]
  const span = `${dates[0].getUTCDate()} ${MONTHS[dates[0].getUTCMonth()]}${dates[0].getUTCFullYear() !== last.getUTCFullYear() ? ' ' + dates[0].getUTCFullYear() : ''} – ${last.getUTCDate()} ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`
  const s: Shape[] = [text(0, H - 0.35, `Week ${week}`, { anchor: 'west', size: 14, bold: true, color: C }), text(16, H - 0.35, span, { anchor: 'east', size: 9.5, color: GREY })]
  dates.forEach((dt, i) => {
    const x = lw + i * cw
    const wd = dt.getUTCDay(), weekend = wd === 0 || wd === 6
    s.push({ t: 'rect', x, y: top - head, w: cw, h: head, fill: C, stroke: 'FFFFFF', lw: 0.5 },
      text(x + cw / 2, top - head / 2, `${WEEKDAYS[wd].slice(0, 3)} ${dt.getUTCDate()}`, { size: 8.5, bold: true, color: 'FFFFFF' }))
    s.push({ t: 'rect', x, y: grid, w: cw, h: allDay, fill: weekend ? 'F3F3F3' : 'FAFAFA', stroke: 'CCCCCC', lw: 0.4 })
    s.push({ t: 'rect', x, y: 0, w: cw, h: grid, fill: weekend ? 'F7F7F7' : 'FFFFFF', stroke: 'CCCCCC', lw: 0.4 })
    if (dt.getUTCMonth() !== m0) return
    const list = (ev.get(dt.getUTCDate()) ?? []).map(timed)
    list.filter(e => e.from === null).slice(0, 2).forEach((e, j) => {
      s.push({ t: 'rect', x: x + 0.05, y: grid + allDay - 0.42 - j * 0.42, w: cw - 0.1, h: 0.36, fill: C, r: 0.05 },
        text(x + 0.1, grid + allDay - 0.24 - j * 0.42, clip(e.text, 14), { anchor: 'west', size: 6, color: 'FFFFFF' }))
    })
    for (const e of list) {
      if (e.from === null) continue
      const a = Math.max(H0, Math.min(H1, e.from)), b = Math.max(a + 0.25, Math.min(H1, e.to!))
      if (a >= H1) continue
      const yTop = grid - (a - H0) * rh, yBot = grid - (b - H0) * rh
      s.push({ t: 'rect', x: x + 0.06, y: yBot + 0.03, w: cw - 0.12, h: yTop - yBot - 0.06, fill: 'E3ECF8', stroke: C, lw: 0.6, r: 0.06 },
        text(x + 0.12, yTop - 0.2, clip(e.text, 14), { anchor: 'west', size: 6, color: INK, bold: true }))
    }
  })
  s.push(text(lw / 2, grid + allDay / 2, 'All day', { size: 6, color: GREY }))
  for (let h = H0; h < H1; h++) {
    const y = grid - (h - H0) * rh
    s.push(text(lw - 0.1, y - 0.18, hh(h), { anchor: 'east', size: 6, color: GREY }), { t: 'line', pts: [[lw, y], [16, y]], stroke: 'E0E0E0', lw: 0.3 })
  }
  return { w: 16, h: H, shapes: s }
}

// One day hour by hour (7:00 to 20:00) beside its to-do list and notes:
// events with a time go in the schedule, the others are the to-dos.
function dayDrawing(d: CalendarData): Drawing {
  const C = hex(d.color), y0 = Number(d.year) || 2026, m0 = Math.max(1, Math.min(12, Number(d.month) || 1)) - 1
  const days = new Date(Date.UTC(y0, m0 + 1, 0)).getUTCDate()
  const day = Math.max(1, Math.min(days, Math.round(Number(d.day) || 1)))
  const dt = new Date(Date.UTC(y0, m0, day))
  const list = (eventsByDay(d, days).get(day) ?? []).map(timed)
  const H0 = 7, H1 = 20, rh = 0.72, lw = 1.2, sw = 9.4, gap = 0.5, px = lw + sw + gap, pw = 16 - px
  const grid = (H1 - H0) * rh, H = grid + 1.3
  const s: Shape[] = [
    text(0, H - 0.4, `${WEEKDAYS[dt.getUTCDay()]} ${day} ${MONTHS[m0]} ${y0}`, { anchor: 'west', size: 14, bold: true, color: C }),
    { t: 'rect', x: lw, y: 0, w: sw, h: grid, fill: 'FFFFFF', stroke: 'CCCCCC', lw: 0.4 },
  ]
  for (let h = H0; h <= H1; h++) {
    const y = grid - (h - H0) * rh
    if (h < H1) s.push(text(lw - 0.1, y - 0.2, hh(h), { anchor: 'east', size: 7, color: GREY }))
    s.push({ t: 'line', pts: [[lw, y], [lw + sw, y]], stroke: 'D6D6D6', lw: 0.4 })
    if (h < H1) s.push({ t: 'line', pts: [[lw, y - rh / 2], [lw + sw, y - rh / 2]], stroke: 'EEEEEE', lw: 0.3 })
  }
  for (const e of list) {
    if (e.from === null) continue
    const a = Math.max(H0, Math.min(H1, e.from)), b = Math.max(a + 0.25, Math.min(H1, e.to!))
    if (a >= H1) continue
    const yTop = grid - (a - H0) * rh, yBot = grid - (b - H0) * rh
    s.push({ t: 'rect', x: lw + 0.08, y: yBot + 0.04, w: sw - 0.16, h: yTop - yBot - 0.08, fill: 'E3ECF8', stroke: C, lw: 0.7, r: 0.08 },
      text(lw + 0.2, yTop - 0.25, clip(e.text, 52), { anchor: 'west', size: 7.5, color: INK, bold: true }))
  }
  // To do (the events without a time), then lines for notes.
  const todoH = grid * 0.5
  s.push({ t: 'rect', x: px, y: grid - 0.6, w: pw, h: 0.6, fill: C, stroke: C, lw: 0.4 }, text(px + 0.2, grid - 0.3, 'To do', { anchor: 'west', size: 9, bold: true, color: 'FFFFFF' }),
    { t: 'rect', x: px, y: grid - todoH, w: pw, h: todoH - 0.6, fill: 'FFFFFF', stroke: 'CCCCCC', lw: 0.4 })
  const todos = list.filter(e => e.from === null)
  const rows = Math.floor((todoH - 0.8) / 0.6)
  for (let i = 0; i < rows; i++) {
    const y = grid - 0.6 - 0.45 - i * 0.6
    s.push({ t: 'rect', x: px + 0.2, y: y - 0.12, w: 0.26, h: 0.26, fill: 'FFFFFF', stroke: C, lw: 0.6 }, { t: 'line', pts: [[px + 0.6, y - 0.16], [px + pw - 0.2, y - 0.16]], stroke: 'E3E3E3', lw: 0.3 })
    if (todos[i]) s.push(text(px + 0.6, y, clip(todos[i].text, 34), { anchor: 'west', size: 7.5, color: INK }))
  }
  const notesTop = grid - todoH - 0.4
  s.push({ t: 'rect', x: px, y: notesTop - 0.6, w: pw, h: 0.6, fill: C, stroke: C, lw: 0.4 }, text(px + 0.2, notesTop - 0.3, 'Notes', { anchor: 'west', size: 9, bold: true, color: 'FFFFFF' }),
    { t: 'rect', x: px, y: 0, w: pw, h: notesTop - 0.6, fill: 'FFFFFF', stroke: 'CCCCCC', lw: 0.4 })
  for (let y = notesTop - 1.2; y > 0.2; y -= 0.6) s.push({ t: 'line', pts: [[px + 0.2, y], [px + pw - 0.2, y]], stroke: 'E3E3E3', lw: 0.3 })
  return { w: 16, h: H, shapes: s }
}

function monthDrawing(d: CalendarData): Drawing {
  const C = hex(d.color), y0 = Number(d.year) || 2026, m0 = Math.max(1, Math.min(12, Number(d.month) || 1)) - 1
  const days = new Date(Date.UTC(y0, m0 + 1, 0)).getUTCDate()
  let first = new Date(Date.UTC(y0, m0, 1)).getUTCDay()   // 0 = Sunday
  if (d.monday) first = (first + 6) % 7
  const names = d.monday ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weeks = Math.ceil((first + days) / 7), cw = 16 / 7, ch = 1.6, H = weeks * ch + 1.4
  const ev = new Map<number, string[]>()
  for (const r of d.rows) { const k = Math.round(num(r[0])); if (k >= 1 && k <= days && (r[1] ?? '').trim()) ev.set(k, [...(ev.get(k) ?? []), r[1].trim()]) }
  const s: Shape[] = [text(0, H - 0.35, `${MONTHS[m0]} ${y0}`, { anchor: 'west', size: 14, bold: true, color: C })]
  names.forEach((n, i) => { s.push({ t: 'rect', x: i * cw, y: weeks * ch, w: cw, h: 0.6, fill: C, stroke: 'FFFFFF', lw: 0.5 }, text(i * cw + cw / 2, weeks * ch + 0.3, n, { size: 8.5, bold: true, color: 'FFFFFF' })) })
  for (let k = 0; k < weeks * 7; k++) {
    const col = k % 7, row = Math.floor(k / 7), day = k - first + 1, x = col * cw, y = (weeks - 1 - row) * ch
    const weekend = d.monday ? col >= 5 : col === 0 || col === 6
    s.push({ t: 'rect', x, y, w: cw, h: ch, fill: day < 1 || day > days ? 'F5F5F5' : weekend ? 'FAFAFA' : 'FFFFFF', stroke: 'CCCCCC', lw: 0.4 })
    if (day >= 1 && day <= days) {
      s.push(text(x + 0.15, y + ch - 0.25, String(day), { anchor: 'west', size: 8.5, bold: true, color: ev.has(day) ? C : INK }))
      ;(ev.get(day) ?? []).slice(0, 2).forEach((e, j) => {
        s.push({ t: 'rect', x: x + 0.08, y: y + ch - 0.85 - j * 0.45, w: cw - 0.16, h: 0.38, fill: C, r: 0.06 },
          text(x + 0.15, y + ch - 0.66 - j * 0.45, e.length > 16 ? e.slice(0, 15) + '…' : e, { anchor: 'west', size: 6, color: 'FFFFFF' }))
      })
    }
  }
  return { w: 16, h: H, shapes: s }
}

// A floor plan from rooms in metres: walls, door swings, windows, names,
// areas and overall dimensions, fitted to 15 cm.
function floorPlanDrawing(d: FloorPlanData): Drawing {
  const C = hex(d.color)
  const rooms = d.rooms.map(r => ({ name: r[0] ?? '', x: num(r[1]), y: num(r[2]), w: num(r[3]), d: num(r[4]) })).filter(r => [r.x, r.y, r.w, r.d].every(Number.isFinite) && r.w > 0 && r.d > 0)
  if (!rooms.length) return { w: 6, h: 1, shapes: [text(3, 0.5, 'No rooms yet: Edit… to add them.', { color: GREY })] }
  const X0 = Math.min(...rooms.map(r => r.x)), Y0 = Math.min(...rooms.map(r => r.y))
  const X1 = Math.max(...rooms.map(r => r.x + r.w)), Y1 = Math.max(...rooms.map(r => r.y + r.d))
  const k = Math.min(15 / (X1 - X0), 12 / (Y1 - Y0)), ox = d.dims ? 1 : 0.2, oy = 0.2
  const P = (x: number, y: number): [number, number] => [ox + (x - X0) * k, oy + (y - Y0) * k]
  const s: Shape[] = []
  for (const r of rooms) {
    const [x, y] = P(r.x, r.y)
    s.push({ t: 'rect', x, y, w: r.w * k, h: r.d * k, fill: 'FFFFFF', stroke: C, lw: 3 })
  }
  for (const r of rooms) {
    const [cx, cy] = P(r.x + r.w / 2, r.y + r.d / 2)
    s.push(text(cx, cy + (d.areas ? 0.2 : 0), r.name, { size: 8.5, bold: true }))
    if (d.areas) s.push(text(cx, cy - 0.25, `${(r.w * r.d).toFixed(1)} m²`, { size: 7.5, color: GREY }))
  }
  for (const o of d.openings) {
    const type = (o[0] ?? '').toLowerCase(), x = num(o[1]), y = num(o[2]), L = num(o[3]), vert = (o[4] ?? 'h').toLowerCase().startsWith('v')
    if (![x, y, L].every(Number.isFinite)) continue
    const [ax, ay] = P(x, y), Lk = L * k, t = 0.16
    const gap: Shape = vert ? { t: 'rect', x: ax - t, y: ay, w: 2 * t, h: Lk, fill: 'FFFFFF' } : { t: 'rect', x: ax, y: ay - t, w: Lk, h: 2 * t, fill: 'FFFFFF' }
    s.push(gap)
    if (type.startsWith('door')) {
      if (vert) s.push({ t: 'line', pts: [[ax, ay], [ax + Lk, ay]], stroke: C, lw: 0.6 }, { t: 'arc', x: ax, y: ay, r: Lk, a0: 0, a1: 90, stroke: C, lw: 0.4 })
      else s.push({ t: 'line', pts: [[ax, ay], [ax, ay + Lk]], stroke: C, lw: 0.6 }, { t: 'arc', x: ax, y: ay, r: Lk, a0: 0, a1: 90, stroke: C, lw: 0.4 })
    } else {
      if (vert) s.push({ t: 'line', pts: [[ax - t, ay], [ax - t, ay + Lk]], stroke: C, lw: 0.5 }, { t: 'line', pts: [[ax, ay], [ax, ay + Lk]], stroke: C, lw: 0.5 }, { t: 'line', pts: [[ax + t, ay], [ax + t, ay + Lk]], stroke: C, lw: 0.5 })
      else s.push({ t: 'line', pts: [[ax, ay - t], [ax + Lk, ay - t]], stroke: C, lw: 0.5 }, { t: 'line', pts: [[ax, ay], [ax + Lk, ay]], stroke: C, lw: 0.5 }, { t: 'line', pts: [[ax, ay + t], [ax + Lk, ay + t]], stroke: C, lw: 0.5 })
    }
  }
  const [px0, py0] = P(X0, Y0), [px1, py1] = P(X1, Y1)
  if (d.dims) {
    const dy = py1 + 0.6, dx = px0 - 0.6
    s.push({ t: 'line', pts: [[px0, dy], [px1, dy]], stroke: GREY, lw: 0.4 }, { t: 'line', pts: [[px0, dy - 0.15], [px0, dy + 0.15]], stroke: GREY, lw: 0.4 },
      { t: 'line', pts: [[px1, dy - 0.15], [px1, dy + 0.15]], stroke: GREY, lw: 0.4 }, text((px0 + px1) / 2, dy + 0.25, `${(X1 - X0).toFixed(2)} m`, { size: 8 }),
      { t: 'line', pts: [[dx, py0], [dx, py1]], stroke: GREY, lw: 0.4 }, { t: 'line', pts: [[dx - 0.15, py0], [dx + 0.15, py0]], stroke: GREY, lw: 0.4 },
      { t: 'line', pts: [[dx - 0.15, py1], [dx + 0.15, py1]], stroke: GREY, lw: 0.4 }, text(dx - 0.3, (py0 + py1) / 2, `${(Y1 - Y0).toFixed(2)} m`, { size: 8, rotate: 90 }))
  }
  return { w: px1 + 0.3, h: py1 + (d.dims ? 1.1 : 0.3), shapes: s }
}

function titleBlockDrawing(d: TitleBlockData): Drawing {
  const C = hex(d.color), W = 16, H = 3.6
  const s: Shape[] = [{ t: 'rect', x: 0, y: 0, w: W, h: H, fill: 'FFFFFF', stroke: C, lw: 1.2 }]
  const cell = (x: number, y: number, w: number, h: number, label: string, value: string, big = false) => {
    s.push({ t: 'rect', x, y, w, h, stroke: C, lw: 0.4 }, text(x + 0.12, y + h - 0.22, label.toUpperCase(), { anchor: 'west', size: 6, color: GREY }),
      text(x + 0.12, y + (big ? h * 0.4 : h * 0.35), value, { anchor: 'west', size: big ? 11 : 8.5, bold: big }))
  }
  s.push({ t: 'rect', x: 0, y: 0, w: 4.4, h: H, fill: C })
  // The practice's name, wrapped to fit the panel (about 20 characters a line).
  const fl: string[] = []
  for (const w of d.firm.split(/\s+/)) { if (fl.length && (fl[fl.length - 1] + ' ' + w).length <= 20) fl[fl.length - 1] += ' ' + w; else fl.push(w) }
  fl.slice(0, 3).forEach((l, i, a) => s.push(text(2.2, H / 2 + (a.length - 1) * 0.25 - i * 0.5, l, { size: 8.5, bold: true, color: 'FFFFFF' })))
  cell(4.4, 2.4, 5.8, 1.2, 'Project', d.project, true); cell(10.2, 2.4, 5.8, 1.2, 'Client', d.client)
  cell(4.4, 1.2, 11.6, 1.2, 'Drawing title', d.title, true)
  const w = 11.6 / 6
  ;[['Drawing no.', d.number], ['Scale', d.scale], ['Date', d.date], ['Drawn', d.drawn], ['Checked', d.checked], ['Rev', d.revision]]
    .forEach(([l, v], i) => cell(4.4 + i * w, 0, w, 1.2, l, v))
  return { w: W, h: H, shapes: s }
}

function scaleBarDrawing(d: ScaleBarData): Drawing {
  const C = hex(d.color)
  const ratio = num((/1\s*:\s*([\d.]+)/.exec(d.scale) ?? [])[1]) || 100
  const L = Math.max(1, Number(d.length) || 5)
  // Metres to centimetres on paper at this scale.
  const k = 100 / ratio
  const segs = L <= 10 ? Math.round(L) : 5, segM = L / segs, segCm = segM * k
  const s: Shape[] = []
  for (let i = 0; i < segs; i++) s.push({ t: 'rect', x: i * segCm, y: 0.8, w: segCm, h: 0.25, fill: i % 2 ? 'FFFFFF' : C, stroke: C, lw: 0.5 })
  for (let i = 0; i <= segs; i++) s.push(text(i * segCm, 0.45, `${+(i * segM).toFixed(2)}`, { size: 7 }))
  s.push(text(segs * segCm + 0.25, 0.45, 'm', { anchor: 'west', size: 7 }), text(0, 1.45, `Scale ${d.scale}`, { anchor: 'west', size: 8, bold: true }))
  let W = segs * segCm + 0.8
  if (d.north) {
    const cx = W + 1.2, cy = 1, a = (Number(d.angle) || 0) * Math.PI / 180
    const r = (x: number, y: number): [number, number] => [cx + x * Math.cos(a) + y * Math.sin(a), cy - x * Math.sin(a) + y * Math.cos(a)]
    s.push({ t: 'circle', x: cx, y: cy, r: 0.75, stroke: C, lw: 0.5 },
      { t: 'poly', pts: [r(0, 0.7), r(-0.3, -0.5), r(0, -0.25)], fill: C }, { t: 'poly', pts: [r(0, 0.7), r(0.3, -0.5), r(0, -0.25)], fill: 'FFFFFF', stroke: C, lw: 0.5 })
    const [nx, ny] = r(0, 1.05)
    s.push(text(nx, ny, 'N', { size: 9, bold: true, color: C }))
    W = cx + 1.2
  }
  return { w: W, h: 2.2, shapes: s }
}

// ------------------------------------------------------------ dispatcher

export interface OfficeOut { table?: TableSpec; drawing?: Drawing; latex?: string }

export function officeRender(kind: OfficeKind, data: unknown): OfficeOut {
  const d = data as never
  if ((FIELD_KINDS as readonly string[]).includes(kind)) return fieldRender(kind as FieldKind, data)
  switch (kind) {
    case 'fintable': return { table: finTable(d) }
    case 'invoice': return { table: invoiceTable(d) }
    case 'budget': return { table: budgetTable(d) }
    case 'loan': return { table: loanTable(d) }
    case 'agenda': return { table: agendaTable(d) }
    case 'actions': return { table: actionsTable(d) }
    case 'rooms': return { table: roomsTable(d) }
    case 'revisions': return { table: revisionsTable(d) }
    case 'kpi': return { drawing: kpiDrawing(d) }
    case 'waterfall': return { drawing: waterfallDrawing(d) }
    case 'letterhead': return { drawing: letterheadDrawing(d) }
    case 'signature': return { drawing: signatureDrawing(d) }
    case 'formfields': return { drawing: formDrawing(d), latex: formLatex(d) }
    case 'certificate': return { drawing: certificateDrawing(d) }
    case 'stamp': return { drawing: stampDrawing(d) }
    case 'calendar': return { drawing: calendarDrawing(d) }
    case 'floorplan': return { drawing: floorPlanDrawing(d) }
    case 'titleblock': return { drawing: titleBlockDrawing(d) }
    case 'scalebar': return { drawing: scaleBarDrawing(d) }
  }
  return {}
}

export function officeLatex(kind: OfficeKind, data: unknown): string {
  const o = officeRender(kind, data)
  if (o.latex) return o.latex
  if (o.table) return tableLatex(o.table)
  return `\\par\\medskip\\noindent\\begin{center}\n${drawingTikz(o.drawing!)}\n\\end{center}`
}

// Packages the elements need: tables, drawings, forms.
// The \\usetikzlibrary / pgfplots lines they need.
export function officeDefs(kinds: Set<string>): string[] {
  return fieldPackages(kinds).defs
}

export function officePackages(kinds: Set<string>): string[] {
  const pk: string[] = []
  const used = OFFICE_KINDS.filter(k => kinds.has(k))
  if (!used.length) return pk
  pk.push('xcolor')
  if (used.some(k => officeRender(k, OFFICE_DEFAULTS[k]).table)) pk.push('booktabs', 'array', 'colortbl')
  if (used.some(k => { const o = officeRender(k, OFFICE_DEFAULTS[k]); return o.drawing && !o.latex })) pk.push('tikz')
  if (kinds.has('formfields')) pk.push('hyperref')
  pk.push(...fieldPackages(kinds).pkgs)
  return pk
}
