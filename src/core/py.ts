// Python string and JSON behaviour the ported code depends on. The .ktex
// files and the generated LaTeX must be byte-identical to the Python app's,
// so anything Python formats differently from JavaScript goes through here.

// str.isspace() characters, which str.strip() / str.split() remove.
const PY_SPACE = ' \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0                　'

export function isSpace(ch: string): boolean {
  return ch.length > 0 && PY_SPACE.includes(ch)
}

export function strip(s: string, chars?: string): string {
  const set = chars ?? PY_SPACE
  let a = 0
  let b = s.length
  while (a < b && set.includes(s[a])) a++
  while (b > a && set.includes(s[b - 1])) b--
  return s.slice(a, b)
}

export function lstrip(s: string, chars?: string): string {
  const set = chars ?? PY_SPACE
  let a = 0
  while (a < s.length && set.includes(s[a])) a++
  return s.slice(a)
}

export function rstrip(s: string, chars?: string): string {
  const set = chars ?? PY_SPACE
  let b = s.length
  while (b > 0 && set.includes(s[b - 1])) b--
  return s.slice(0, b)
}

// str.capitalize(): first character upper-cased, the rest lower-cased.
export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s
}

// str.splitlines() without keepends.
export function splitlines(s: string): string[] {
  const out: string[] = []
  // Python's line boundaries include these control characters.
  // oxlint-disable-next-line no-control-regex
  const re = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/g
  let last = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out.push(s.slice(last, m.index))
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

// str(float): Python always prints a decimal point on floats ("2.0").
export function pyFloat(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1)
  const s = String(x)
  // JavaScript writes 1e+21 / 1e-7; Python writes 1e+21 / 1e-07.
  return s.replace(/e([+-])(\d)$/, 'e$10$2')
}

// Marks a number that Python stores as a float, so pyJson writes "2.0".
export class PyFloat {
  readonly value: number
  constructor(value: number) {
    this.value = value
  }
}

// json.dumps(obj, indent=2, ensure_ascii=False). Keys listed in floatKeys
// hold Python floats and are written with a decimal point.
export function pyJson(value: unknown, floatKeys: ReadonlySet<string> = new Set(), indent = 2): string {
  const pad = (n: number) => ' '.repeat(n * indent)
  const enc = (v: unknown, depth: number, isFloat: boolean): string => {
    if (v === null || v === undefined) return 'null'
    if (v instanceof PyFloat) return jsonFloat(v.value)
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return isFloat ? jsonFloat(v) : jsonInt(v)
    if (typeof v === 'string') return JSON.stringify(v)
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]'
      const items = v.map((x) => pad(depth + 1) + enc(x, depth + 1, false))
      return '[\n' + items.join(',\n') + '\n' + pad(depth) + ']'
    }
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const items = entries.map(
      ([k, x]) => pad(depth + 1) + JSON.stringify(k) + ': ' + enc(x, depth + 1, floatKeys.has(k)),
    )
    return '{\n' + items.join(',\n') + '\n' + pad(depth) + '}'
  }
  return enc(value, 0, false)
}

function jsonFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity'
  return pyFloat(x)
}

function jsonInt(x: number): string {
  return Number.isInteger(x) ? String(x) : jsonFloat(x)
}

// Python's int() on a JSON value: truncates floats, parses numeric strings.
export function pyInt(v: unknown, fallback: number): number {
  if (v === undefined) return fallback
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return Math.trunc(v)
  if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return parseInt(v, 10)
  throw new TypeError(`int() cannot convert ${JSON.stringify(v)}`)
}

export function pyFloatOf(v: unknown, fallback: number): number {
  if (v === undefined) return fallback
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v
  if (typeof v === 'string' && strip(v) !== '' && !Number.isNaN(Number(strip(v)))) return Number(strip(v))
  throw new TypeError(`float() cannot convert ${JSON.stringify(v)}`)
}

// Python truthiness of a JSON value, for bool(...).
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (v && typeof v === 'object') return Object.keys(v).length > 0
  return Boolean(v)
}

// str() of a JSON value.
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloat(v)
  return String(v)
}

// f"{n:03d}"
export function zpad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

// str.isalpha() on one code point: Unicode letters (categories L*).
export function isAlpha(ch: string): boolean {
  return /^\p{L}+$/u.test(ch)
}

// str.title(): a cased character after a cased one is lower-cased, any
// other cased character is upper-cased; digits and punctuation break words.
export function pyTitle(s: string): string {
  let out = ''
  let prevCased = false
  for (const ch of s) {
    const cased = /[\p{Lu}\p{Ll}\p{Lt}]/u.test(ch)
    if (cased) out += prevCased ? ch.toLowerCase() : ch.toUpperCase()
    else out += ch
    prevCased = cased
  }
  return out
}

// f"{x:.{digits}f}": the exact binary value rounded half-to-even, which
// Number.toFixed (round half up, exponent form past 1e21) does not do.
export function pyFixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  const neg = x < 0 || Object.is(x, -0)
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, Math.abs(x))
  const bits = view.getBigUint64(0)
  const expBits = Number((bits >> 52n) & 0x7ffn)
  const frac = bits & ((1n << 52n) - 1n)
  const mant = expBits === 0 ? frac : frac | (1n << 52n)
  const exp = (expBits === 0 ? 1 : expBits) - 1075
  const scale = 10n ** BigInt(digits)
  let q: bigint
  if (exp >= 0) {
    q = (mant << BigInt(exp)) * scale
  } else {
    const num = mant * scale
    const den = 1n << BigInt(-exp)
    q = num / den
    const r2 = (num % den) * 2n
    if (r2 > den || (r2 === den && q % 2n === 1n)) q += 1n
  }
  let s = q.toString().padStart(digits + 1, '0')
  if (digits > 0) s = s.slice(0, -digits) + '.' + s.slice(-digits)
  return (neg ? '-' : '') + s
}

// ---------------- Python `re` on top of JavaScript RegExp ----------------

const RE_SPACE_CLASS = [...PY_SPACE].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('')
// Python's str \w: letters, numbers and the underscore (not combining marks).
const RE_WORD_CLASS = '\\p{L}\\p{N}_'
const RE_SYNTAX = '^$\\.*+?()[]{}|/'

// Translate a Python regular expression into JavaScript `u`-mode syntax with
// Python's meaning: \s \w \d \b are Unicode-aware the way Python's are, `.`
// excludes only \n, ^ and $ use Python's line rules (MULTILINE breaks only
// at \n; a bare $ also matches before one trailing \n), and \A \Z (?P<n>)
// carry over. `pyFlags` holds Python flags: s = DOTALL, m = MULTILINE,
// i = IGNORECASE.
export function pyRe(pattern: string, pyFlags = ''): RegExp {
  const dotAll = pyFlags.includes('s')
  const multi = pyFlags.includes('m')
  let out = ''
  let inClass = false
  let i = 0
  const n = pattern.length
  while (i < n) {
    const c = pattern[i]
    if (c === '\\' && i + 1 < n) {
      const x = pattern[i + 1]
      i += 2
      if (inClass) {
        if (x === 's') out += RE_SPACE_CLASS
        else if (x === 'w') out += RE_WORD_CLASS
        else if (x === 'd') out += '\\p{Nd}'
        else if ('SWD'.includes(x)) throw new Error(`pyRe: \\${x} inside a class is not supported`)
        else if (x === '-' || RE_SYNTAX.includes(x) || 'ntrfvxu'.includes(x)) out += '\\' + x
        else if (/[0-9A-Za-z]/.test(x)) throw new Error(`pyRe: unsupported escape \\${x}`)
        else out += x
        continue
      }
      if (x === 's') out += `[${RE_SPACE_CLASS}]`
      else if (x === 'S') out += `[^${RE_SPACE_CLASS}]`
      else if (x === 'w') out += `[${RE_WORD_CLASS}]`
      else if (x === 'W') out += `[^${RE_WORD_CLASS}]`
      else if (x === 'd') out += '\\p{Nd}'
      else if (x === 'D') out += '\\P{Nd}'
      else if (x === 'b') {
        const w = `[${RE_WORD_CLASS}]`
        out += `(?:(?<=${w})(?!${w})|(?<!${w})(?=${w}))`
      } else if (x === 'B') {
        const w = `[${RE_WORD_CLASS}]`
        out += `(?:(?<=${w})(?=${w})|(?<!${w})(?!${w}))`
      } else if (x === 'A') out += '(?<![\\s\\S])'
      else if (x === 'Z') out += '(?![\\s\\S])'
      else if (/[1-9]/.test(x) || RE_SYNTAX.includes(x) || 'ntrfvxu'.includes(x)) out += '\\' + x
      else if (/[0-9A-Za-z]/.test(x)) throw new Error(`pyRe: unsupported escape \\${x}`)
      else out += x
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      out += c
      i++
      continue
    }
    if (c === '[') {
      inClass = true
      out += '['
      i++
      if (pattern[i] === '^') { out += '^'; i++ }
      // Python reads a ']' right after '[' (or '[^') as a literal.
      if (pattern[i] === ']') { out += '\\]'; i++ }
      continue
    }
    if (c === '(' && pattern.startsWith('(?P<', i)) { out += '(?<'; i += 4; continue }
    if (c === '(' && pattern.startsWith('(?P=', i)) {
      const close = pattern.indexOf(')', i)
      out += `\\k<${pattern.slice(i + 4, close)}>`
      i = close + 1
      continue
    }
    if (c === '.') { out += dotAll ? '[\\s\\S]' : '[^\\n]'; i++; continue }
    if (c === '^') { out += multi ? '(?<![^\\n])' : '(?<![\\s\\S])'; i++; continue }
    if (c === '$') { out += multi ? '(?![^\\n])' : '(?=\\n?(?![\\s\\S]))'; i++; continue }
    if (c === '{') {
      const q = /^\{(\d*)(,?)(\d*)\}/.exec(pattern.slice(i))
      if (q && (q[1] || q[3])) {
        out += `{${q[1] || (q[2] ? '0' : '')}${q[2]}${q[3]}}`
        i += q[0].length
      } else {
        out += '\\{'
        i++
      }
      continue
    }
    if (c === '}') { out += '\\}'; i++; continue }
    out += c
    i++
  }
  return new RegExp(out, 'gu' + (pyFlags.includes('i') ? 'i' : ''))
}

export const reEscape = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, (c) => '\\' + c)

// pattern.search(s, pos)
export function reSearch(re: RegExp, s: string, pos = 0): RegExpExecArray | null {
  re.lastIndex = pos
  return re.exec(s)
}

const stickyCache = new WeakMap<RegExp, RegExp>()

// pattern.match(s, pos): anchored at pos.
export function reMatch(re: RegExp, s: string, pos = 0): RegExpExecArray | null {
  let y = stickyCache.get(re)
  if (!y) {
    y = new RegExp(re.source, re.flags.replace('g', '') + 'y')
    stickyCache.set(re, y)
  }
  y.lastIndex = pos
  return y.exec(s)
}

const fullCache = new WeakMap<RegExp, RegExp>()

// pattern.fullmatch(s)
export function reFullmatch(re: RegExp, s: string): RegExpExecArray | null {
  let f = fullCache.get(re)
  if (!f) {
    f = new RegExp(`(?:${re.source})(?![\\s\\S])`, re.flags.replace('g', '') + 'y')
    fullCache.set(re, f)
  }
  f.lastIndex = 0
  return f.exec(s)
}

// pattern.sub(repl, s, count). A string `repl` is inserted literally (no
// \1 templates), which is all the ported code needs.
export function reSub(re: RegExp, s: string, repl: string | ((m: RegExpExecArray) => string), count = 0): string {
  const fn = typeof repl === 'string' ? () => repl : repl
  let out = ''
  let prevEnd = 0
  let done = 0
  re.lastIndex = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const end = m.index + m[0].length
    const next = m[0].length === 0 ? end + ((s.codePointAt(end) ?? 0) > 0xffff ? 2 : 1) : end
    // fn may run this same regex (a recursive substitution), so restore
    // the scan position after it.
    out += s.slice(prevEnd, m.index) + fn(m)
    prevEnd = end
    re.lastIndex = next
    if (count && ++done >= count) break
  }
  return out + s.slice(prevEnd)
}

// pattern.split(s) for patterns without groups.
export function reSplit(re: RegExp, s: string): string[] {
  const out: string[] = []
  let last = 0
  re.lastIndex = 0
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m[0].length === 0) {
      re.lastIndex = m.index + 1
      if (m.index === 0 || m.index >= s.length) continue
    }
    out.push(s.slice(last, m.index))
    last = m.index + m[0].length
  }
  out.push(s.slice(last))
  return out
}

// pattern.findall(s) for a pattern with exactly one group.
export function reFindall(re: RegExp, s: string): string[] {
  return [...s.matchAll(re)].map((m) => m[1] ?? '')
}

// float(s) for a decimal string; raises like Python on garbage.
export function pyFloatParse(s: string): number {
  const t = strip(s)
  const v = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : NaN
  if (Number.isNaN(v)) throw new Error(`ValueError: could not convert string to float: '${s}'`)
  return v
}

// int(s) for a string; raises like Python on garbage.
export function pyIntParse(s: string): number {
  const t = strip(s)
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) throw new Error(`ValueError: invalid literal for int() with base 10: '${s}'`)
  return parseInt(t.replaceAll('_', ''), 10)
}

// round(x, nd): the double nearest the exact value rounded half-to-even.
export function pyRound(x: number, nd: number): number {
  if (!Number.isFinite(x)) return x
  return Number(pyFixed(x, nd))
}
