// The date under the title: the class's own \today, or one of these
// formats (right-click the date on the page).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

export const DATE_FORMATS: [string, string][] = [
  ['d_month_y', '9 November 2026'],
  ['month_d_y', 'November 9, 2026'],
  ['month_y', 'November 2026'],
  ['dd_mm_yyyy', '09/11/2026'],
  ['iso', '2026-11-09'],
]

const pad = (n: number) => String(n).padStart(2, '0')

// `format` '' is the class default: day first or month first.
export function formatDate(format: string, now: Date, dayFirst = false): string {
  const d = now.getDate(), m = MONTHS[now.getMonth()], y = now.getFullYear()
  switch (format) {
    case 'd_month_y': return `${d} ${m} ${y}`
    case 'month_d_y': return `${m} ${d}, ${y}`
    case 'month_y': return `${m} ${y}`
    case 'dd_mm_yyyy': return `${pad(d)}/${pad(now.getMonth() + 1)}/${y}`
    case 'iso': return `${y}-${pad(now.getMonth() + 1)}-${pad(d)}`
    default: return dayFirst ? `${d} ${m} ${y}` : `${m} ${d}, ${y}`
  }
}

// The \date{...} line for a document's meta, or '' to leave \today.
export function dateCommand(meta: { show_date?: boolean, date_format?: string }, now = new Date()): string {
  if (meta.show_date === false) return '\\date{}'
  if (meta.date_format) return `\\date{${formatDate(meta.date_format, now)}}`
  return ''
}
