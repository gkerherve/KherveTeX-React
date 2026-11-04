// The slice of Python's builtins, datetime and calendar the example
// documents use, with Python's meaning: what scripts/port_examples.py
// translates their code into.

export function range(a: number, b?: number, step = 1): number[] {
  const [lo, hi] = b === undefined ? [0, a] : [a, b]
  const out: number[] = []
  if (step > 0) for (let i = lo; i < hi; i += step) out.push(i)
  else for (let i = lo; i > hi; i += step) out.push(i)
  return out
}

export function enumerate<T>(xs: Iterable<T>): [number, T][] {
  return [...xs].map((x, i) => [i, x])
}

// len(): a string counts code points.
export function pyLen(x: string | ArrayLike<unknown>): number {
  return typeof x === 'string' ? [...x].length : x.length
}

export function pySum(xs: Iterable<number>): number {
  let total = 0
  for (const x of xs) total += x
  return total
}

// `a + b` where the operands may be lists (concatenation) or numbers/strings.
export function pyAdd(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
  return a + b
}

// `[x] * n`
export function pyRepeat<T>(xs: T[], n: number): T[] {
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(...xs)
  return out
}

// `x in container`: substring, list membership or dict key.
export function pyIn(x: unknown, c: unknown): boolean {
  if (typeof c === 'string') return c.includes(x as string)
  if (Array.isArray(c)) return c.includes(x)
  return typeof c === 'object' && c !== null && (x as string) in c
}

// str.split(sep, maxsplit)
export function pySplit(s: string, sep: string, maxsplit: number): string[] {
  const parts = s.split(sep)
  if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts
  return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(sep)]
}

export function pySetdefault(o: Record<string, unknown>, k: string, v: unknown): unknown {
  if (!(k in o)) o[k] = v
  return o[k]
}

// f"{x:g}": six significant digits, trailing zeros dropped, exponent form
// outside 1e-4 <= |x| < 1e6.
export function pyFormatG(x: number): string {
  if (x === 0) return Object.is(x, -0) ? '-0' : '0'
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf'
  const [mant, expStr] = x.toExponential(5).split('e')
  const exp = Number(expStr)
  if (exp >= -4 && exp < 6) {
    let s = x.toFixed(5 - exp)
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
    return s
  }
  let m = mant.includes('.') ? mant.replace(/0+$/, '').replace(/\.$/, '') : mant
  if (m === '') m = '0'
  return `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
}

// ---------------- datetime.date and calendar ----------------

export const DAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const MONTH_NAME = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
export const MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
  'Nov', 'Dec']

const DAY_MS = 86_400_000
// date(1970, 1, 1).toordinal()
const EPOCH_ORDINAL = 719_163

let fixedToday: PyDate | null = null

export class PyDate {
  readonly year: number
  readonly month: number
  readonly day: number

  constructor(year: number, month: number, day: number) {
    this.year = year
    this.month = month
    this.day = day
  }

  // date.today(): the local date, or the one setToday() fixed (tests).
  static today(): PyDate {
    if (fixedToday) return fixedToday
    const now = new Date()
    return new PyDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
  }

  static fromOrdinal(n: number): PyDate {
    const d = new Date((n - EPOCH_ORDINAL) * DAY_MS)
    return new PyDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }

  static max(a: PyDate, b: PyDate): PyDate { return a.compare(b) >= 0 ? a : b }
  static min(a: PyDate, b: PyDate): PyDate { return a.compare(b) <= 0 ? a : b }

  toordinal(): number {
    const d = new Date(0)
    d.setUTCFullYear(this.year, this.month - 1, this.day)
    return Math.round(d.getTime() / DAY_MS) + EPOCH_ORDINAL
  }

  // date + timedelta(days=n)
  addDays(n: number): PyDate {
    return PyDate.fromOrdinal(this.toordinal() + n)
  }

  // Monday is 0.
  weekday(): number {
    return (this.toordinal() + 6) % 7
  }

  // timetuple().tm_yday
  yday(): number {
    return this.toordinal() - new PyDate(this.year, 1, 1).toordinal() + 1
  }

  // (ISO year, ISO week, ISO weekday), as datetime.date.isocalendar.
  isocalendar(): [number, number, number] {
    let year = this.year
    let week1 = isoWeek1Monday(year)
    const today = this.toordinal()
    let week = Math.floor((today - week1) / 7)
    let day = (today - week1) - week * 7
    if (week < 0) {
      year -= 1
      week1 = isoWeek1Monday(year)
      week = Math.floor((today - week1) / 7)
      day = (today - week1) - week * 7
    } else if (week >= 52 && today >= isoWeek1Monday(year + 1)) {
      year += 1
      week = 0
    }
    return [year, week + 1, day + 1]
  }

  compare(o: PyDate): number {
    return this.toordinal() - o.toordinal()
  }

  equals(o: PyDate | null): boolean {
    return o !== null && this.compare(o) === 0
  }
}

function isoWeek1Monday(year: number): number {
  const first = new PyDate(year, 1, 1).toordinal()
  const firstWeekday = (first + 6) % 7
  let monday = first - firstWeekday
  if (firstWeekday > 3) monday += 7
  return monday
}

// Tests fix the date the planners are built for; null goes back to the clock.
export function setToday(d: PyDate | null): void {
  fixedToday = d
}

// calendar.monthrange(y, m)[1]
export function monthDays(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// calendar.Calendar(0).monthdatescalendar(y, m): whole Monday-to-Sunday
// weeks covering the month.
export function monthDatesCalendar(year: number, month: number): PyDate[][] {
  const first = new PyDate(year, month, 1)
  let d = first.addDays(-first.weekday())
  const last = new PyDate(year, month, monthDays(year, month)).toordinal()
  const weeks: PyDate[][] = []
  while (d.toordinal() <= last) {
    const week: PyDate[] = []
    for (let i = 0; i < 7; i++) { week.push(d); d = d.addDays(1) }
    weeks.push(week)
  }
  return weeks
}
