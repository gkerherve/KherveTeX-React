// The optional Admin & Office, Accountants and Architect tabs: hidden until
// switched on in Settings ▸ Ribbon & Toolbar. Each element they insert has
// its own contextual tab (Edit…, its options, Move, Delete, Close) that
// opens whenever it is selected, whether or not its main tab is shown.
import { OFFICE_NAMES, type OfficeKind } from '../core/office.ts'
import type { Command, RibbonTab } from './ribbonModel.ts'
import type { Tip } from './tooltips.ts'

// The tabs hidden unless the user turns them on.
export const OPTIONAL_TABS = ['Admin & Office', 'Accountants', 'Architect']

const T = (title: string, what: string, latex = ''): Tip => ({ title, what, latex })
const ELEMENT = ' Click it on the page to select it: its own tab opens, Edit… (or a double-click) changes it, Move up / Move down or the grip moves it, Delete or its × removes it, and Close puts the caret after it.'

// [kind, short tip, long help, what it becomes in the PDF]
const ABOUT: [OfficeKind, string, string, string][] = [
  ['letterhead', 'Your organisation\'s name, tagline, address and contact line across the top', 'A letterhead for letters, quotes and reports: the organisation\'s name and tagline on a coloured band, or centred with a rule, or beside a side bar, with the address and contact details. Edit… changes the text, the Letterhead tab the style and colour.', 'A TikZ drawing the full width of the text.'],
  ['signature', 'Signature lines with names and roles, side by side', 'One to four signature lines side by side, each with the name and role under it, and an optional dated line - for contracts, approvals and minutes.', 'A TikZ drawing.'],
  ['formfields', 'A form that is filled in in any PDF reader', 'A fillable PDF form: text boxes, multi-line boxes, tick boxes and drop-down choices, each with its label. In the PDF they are real form fields: type in them in Acrobat, Preview or a browser, then save or print.', 'hyperref\'s Form environment with \\TextField, \\CheckBox and \\ChoiceMenu.'],
  ['agenda', 'A numbered meeting agenda with times and leads', 'A meeting agenda: title, date, time and place, then the numbered items with their start time and who leads each.', 'A booktabs table.'],
  ['actions', 'Who does what by when, with a coloured status', 'Action items from a meeting: the action, its owner, the due date and its status - Open (red), In progress (orange), Done (green) or Late.', 'A booktabs table with coloured status.'],
  ['certificate', 'A framed certificate with name, reason, date and signature', 'A certificate of achievement, attendance or thanks: a double frame in the accent colour, the title, the person\'s name, what it is for, the date and the signature line, with a seal.', 'A TikZ drawing, landscape in shape.'],
  ['stamp', 'A tilted rubber stamp: APPROVED, PAID, DRAFT...', 'A rubber stamp, tilted, with a word (APPROVED, PAID, RECEIVED, DRAFT, CONFIDENTIAL...) and a second line such as the date.', 'A TikZ drawing.'],
  ['calendar', 'A month calendar with your events', 'A month calendar: choose the year and month, whether weeks start on Monday, and add events on their days; weekends are shaded.', 'A TikZ drawing.'],
  ['fintable', 'Profit and loss, balance sheet or cash flow, adding itself up', 'A financial statement: headings, lines, subtotals and totals for one to three years. Leave a subtotal or total empty and it adds itself up; figures get thousands separators and the currency sign, negatives go in brackets, the total is double-ruled.', 'A booktabs table with numbers right-aligned.'],
  ['invoice', 'An invoice: items, VAT and total worked out', 'An invoice: who it is from and to, its number, date and due date, the items with quantity and unit price; the amounts, the subtotal, the VAT or tax and the total due are worked out. Payment terms go in the notes.', 'Two address blocks and a booktabs table.'],
  ['budget', 'Budget against actual, with variance and % used', 'Budget against actual for each category: the variance (green under budget, red over), the percentage used and the totals are worked out.', 'A booktabs table.'],
  ['loan', 'A loan or mortgage repayment schedule', 'A loan or mortgage: the amount, the yearly rate, the term and how often it is paid. Shows the payment, the total interest and, year by year, what is paid, the interest, the capital repaid and the balance left.', 'A booktabs table.'],
  ['kpi', 'Key figures as cards with their change', 'Key performance indicators as cards: a label, the figure and its change, green when up and red when down (start a label with ! when down is good, as for churn or costs).', 'A TikZ drawing.'],
  ['waterfall', 'How a starting figure becomes the final one', 'A waterfall (bridge) chart: a starting figure, the rises in green and falls in red, and the end figure - cash flow, profit bridge, headcount...', 'A TikZ drawing.'],
  ['floorplan', 'A floor plan from rooms in metres, with doors and windows', 'A floor plan drawn from its rooms (name, position, width and depth in metres): thick walls, door swings, windows, the room names and areas, and the overall dimensions. Fitted to the page width.', 'A TikZ drawing.'],
  ['titleblock', 'The drawing\'s title block: project, number, scale, revision', 'An architect\'s title block: the practice, project, client, drawing title, drawing number, scale, date, drawn and checked by, and the revision.', 'A TikZ drawing.'],
  ['scalebar', 'A scale bar true to 1:50, 1:100... and a north arrow', 'A scale bar drawn true to the scale (1:50, 1:100, 1:200...) in metres, and a north arrow that can be turned.', 'A TikZ drawing.'],
  ['rooms', 'Rooms with their sizes, areas and total floor area', 'A room schedule: each room\'s width and depth, its area worked out, the floor finish and notes, and the total floor area.', 'A booktabs table.'],
  ['revisions', 'The drawing\'s revision history', 'A revision table: revision letter, date, what changed and who made it.', 'A booktabs table.'],
]

export const OFFICE_COMMANDS: Command[] = [
  ...ABOUT.map(([k, tip]): Command => ({ id: `of_${k}`, text: OFFICE_NAMES[k], icon: 'office', iconArg: k, tooltip: tip })),
  { id: 'of_brackets', text: 'Negatives in brackets', checkable: true, checkbox: true },
  { id: 'of_sigdate', text: 'Date lines', checkable: true, checkbox: true },
  { id: 'of_monday', text: 'Weeks start Monday', checkable: true, checkbox: true },
  { id: 'of_dims', text: 'Dimensions', checkable: true, checkbox: true },
  { id: 'of_areas', text: 'Room areas', checkable: true, checkbox: true },
  { id: 'of_north', text: 'North arrow', checkable: true, checkbox: true },
  { id: 'of_lh_bar', text: 'Band', checkable: true },
  { id: 'of_lh_centered', text: 'Centred', checkable: true },
  { id: 'of_lh_side', text: 'Side bar', checkable: true },
]

export const OFFICE_TIPS: Record<string, Tip> = {
  ...Object.fromEntries(ABOUT.map(([k, , what, latex]) => [`act_of_${k}`, T(OFFICE_NAMES[k], what + ELEMENT, latex)])),
  act_of_brackets: T('Negatives in brackets', 'Shows negative figures as (1,234) as accountants do, instead of -1,234.'),
  act_of_sigdate: T('Date lines', 'A dated line under each signature.'),
  act_of_monday: T('Weeks start Monday', 'Weeks start on Monday (ticked) or Sunday.'),
  act_of_dims: T('Dimensions', 'The overall width and depth, in metres, along the top and the left.'),
  act_of_areas: T('Room areas', 'Each room\'s area in m² under its name.'),
  act_of_north: T('North arrow', 'A north arrow beside the scale bar; Edit… turns it.'),
  act_of_lh_bar: T('Band', 'The name on a coloured band across the top.'),
  act_of_lh_centered: T('Centred', 'The name centred over a thin rule.'),
  act_of_lh_side: T('Side bar', 'The name beside a coloured bar, the address on the right.'),
}

const g = (label: string, ids: string[]) => ({ label, large: ids.map(k => `of_${k}`) })

export const OFFICE_MAIN_TABS: RibbonTab[] = [
  { name: 'Admin & Office', groups: [g('Letters', ['letterhead', 'signature', 'stamp']), g('Meetings', ['agenda', 'actions', 'calendar']), g('Forms', ['formfields', 'certificate'])] },
  { name: 'Accountants', groups: [g('Statements', ['fintable', 'budget']), g('Billing', ['invoice', 'loan']), g('Charts', ['kpi', 'waterfall'])] },
  { name: 'Architect', groups: [g('Drawings', ['floorplan', 'scalebar', 'titleblock']), g('Schedules', ['rooms', 'revisions'])] },
]

// Each element's own tab: Edit…, its options, colour, Move, Delete / Close.
const OPTIONS: Partial<Record<OfficeKind, string[][]>> = {
  fintable: [['of_brackets']], signature: [['of_sigdate']], calendar: [['of_monday']],
  floorplan: [['of_dims'], ['of_areas']], scalebar: [['of_north']], letterhead: [['of_lh_bar'], ['of_lh_centered'], ['of_lh_side']],
}

export const OFFICE_CONTEXT_TABS: RibbonTab[] = ABOUT.map(([k]) => ({
  name: OFFICE_NAMES[k], context: k, groups: [
    { label: OFFICE_NAMES[k], large: ['w_edit'], ...(OPTIONS[k] ? { rows: OPTIONS[k], text: true } : {}) },
    { label: 'Style', large: ['w_color'] },
    { label: 'Move', large: ['block_up', 'block_down'] },
    { label: OFFICE_NAMES[k], large: ['w_delete', 'w_close'] },
  ],
}))

export const OFFICE_AUTO_TABS = Object.fromEntries(ABOUT.map(([k]) => [k, OFFICE_NAMES[k]])) as Record<OfficeKind, string>

// Ticks on the element tabs for the selected element's settings.
export function officeChecks(kind: string, d: Record<string, unknown>, check: (id: string, on: boolean) => void) {
  switch (kind) {
    case 'fintable': check('of_brackets', !!d.brackets); break
    case 'signature': check('of_sigdate', !!d.date); break
    case 'calendar': check('of_monday', !!d.monday); break
    case 'floorplan': check('of_dims', !!d.dims); check('of_areas', !!d.areas); break
    case 'scalebar': check('of_north', !!d.north); break
    case 'letterhead': check(`of_lh_${d.style}`, true); break
  }
}
