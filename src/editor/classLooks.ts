// What the visual tab draws for a document class: the table measured from
// real PDFs (classLooks.json, generated from khervedoc/class_looks.py by
// scripts/gen_class_looks.py), and how heading numbers come out in that
// class. A port of khervedoc/page_look.py.
import LOOKS_JSON from './classLooks.json' with { type: 'json' }

export interface LabelSpec {
  text: string; font: string; size: number; color: string
  gap?: number; gap_prev?: number; centred?: boolean
}

export interface StyleSpec {
  font: string; size: number; color?: string; align?: string; indent?: number
  upper?: boolean; prefix?: string; num_gap?: number | null; page?: number
  run_in?: boolean; above?: number | null; below?: number | null; top?: number
  wide?: boolean; inset_left?: number; inset_right?: number; first_indent?: number
  leading?: number; label_above?: LabelSpec | null; label?: LabelSpec | null
  suffix?: string; run_gap?: number | null; broken?: string
}

export interface BodySpec {
  font: string; size: number; leading: number; parindent: number
  indent_first: boolean; parskip: number; broken?: string
}

export interface Geometry {
  page_w: number; page_h: number; left: number; right: number; top: number
  bottom: number; cols: number; colsep: number; follows_margins: boolean
  follows_page: boolean
}

export interface FurnitureItem {
  text?: string; upper?: boolean; font?: string; size?: number; color?: string
  y: number; anchor?: string; x?: number; rule?: boolean; width?: number
}

export interface DateSpec {
  font: string; size: number; color: string; gap: number; page: number
  day_first: boolean; centred?: boolean
}

export interface Look {
  body: BodySpec
  geometry: Geometry
  title?: StyleSpec; author?: StyleSpec; affiliation?: StyleSpec
  correspondence?: StyleSpec; abstract?: StyleSpec; keywords?: StyleSpec
  frame?: StyleSpec
  h1?: StyleSpec; h2?: StyleSpec; h3?: StyleSpec; h4?: StyleSpec; h5?: StyleSpec
  date?: DateSpec | null
  chapter_label?: LabelSpec | null
  furniture?: Record<string, FurnitureItem[]>
  broken?: string
}

export type StyleKey = 'title' | 'author' | 'affiliation' | 'correspondence'
  | 'abstract' | 'keywords' | 'frame' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5'

export const LOOKS = LOOKS_JSON as unknown as Record<string, Record<string, Look>>

const LOWER: Record<string, string> = Object.fromEntries(
  Object.keys(LOOKS).map(k => [k.toLowerCase(), k]))

function entry(cls: string): Record<string, Look> | null {
  const name = (cls || 'article').split(',')[0].trim().toLowerCase()
  const key = LOWER[name]
  return key ? LOOKS[key] : null
}

function first(e: Record<string, Look>): Look {
  return e[Object.keys(e)[0]]
}

// Why this class has no usable PDF to copy, or "" when it has one.
export function isBroken(cls: string): string {
  const e = entry(cls)
  if (!e) return ''
  return (first(e) as unknown as { broken?: string }).broken ?? ''
}

// The measured look of `cls` at `bodyPt`. A class that cannot compile has
// nothing to match, so it is drawn as an article.
export function lookFor(cls: string, bodyPt: number): Look {
  let e = entry(cls)
  if (!e || (first(e) as unknown as { broken?: string }).broken) e = LOOKS.article
  const want = bodyPt || 12
  let best = Object.keys(e)[0]
  for (const pt of Object.keys(e)) {
    // Python's min() keeps the first of equal distances.
    if (Math.abs(Number(pt) - want) < Math.abs(Number(best) - want)) best = pt
  }
  return e[best]
}

function roman(n: number): string {
  let out = ''
  for (const [value, digits] of [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const) {
    while (n >= value) { out += digits; n -= value }
  }
  return out
}

function alpha(n: number): string {
  return String.fromCharCode(65 + (Math.max(n, 1) - 1) % 26)
}

// Heading number in the form this class printed: `prefix` is what the
// probe heading showed ("1.1.", "I.", "A.", "1)", "a)"), `dotted` the
// plain counters of this heading ("2.3"). No prefix means unnumbered.
export function numberLabel(prefix: string, dotted: string): string {
  prefix = (prefix || '').trim()
  if (!prefix || !dotted) return ''
  const parts = dotted.split('.')
  const n = Number(parts[parts.length - 1] || 0)
  const m = /^([IVX]+|[A-Z]|[a-z]|[\d.]*\d)([.)]?)$/.exec(prefix)
  if (!m) return !prefix.includes('Chapter') ? prefix : `Chapter ${n}`
  const head = m[1], tail = m[2]
  if (head === 'I') return roman(n) + tail
  // str.isupper() / islower(): cased letters, all of one case.
  if (/[A-Z]/.test(head) && head === head.toUpperCase()) return alpha(n) + tail
  if (/[a-z]/.test(head) && head === head.toLowerCase()) return alpha(n).toLowerCase() + tail
  if (tail === ')') return `${n}${tail}`
  return dotted + tail
}
