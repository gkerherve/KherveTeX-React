// Every gallery example must build the same document.json as the Python
// app (scripts/make_golden_examples.py); the planners and the calendar
// for each of a set of fixed dates.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { EXAMPLES, GALLERY, GALLERY_CATEGORIES, JOURNAL_EXAMPLES } from '../src/core/examples.ts'
import * as planning from '../src/core/exampleDocs/planning.ts'
import { PyDate, setToday } from '../src/core/exampleDocs/runtime.ts'
import { toJson } from '../src/core/model.ts'

interface Golden {
  base_date: string
  categories: string[]
  gallery: { category: string; label: string; factory: string; description: string; document_json: string }[]
  journal_examples: string[]
  dated: Record<string, Record<string, string>>
  calendar_latex_no_today: string
  a_cases: Record<string, string>
}

const golden: Golden = JSON.parse(readFileSync(new URL('./golden/examples.json', import.meta.url), 'utf-8'))

const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new PyDate(y, m, d)
}
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())

afterEach(() => setToday(null))

describe('the gallery lists what examples.py lists', () => {
  it('categories', () => {
    expect([...GALLERY_CATEGORIES]).toEqual(golden.categories)
  })
  it('entries, in order', () => {
    expect(GALLERY.map(([c, l, f, d]) => [c, l, f.name, d])).toEqual(
      golden.gallery.map(g => [g.category, g.label, camel(g.factory), g.description]))
  })
  it('EXAMPLES and JOURNAL_EXAMPLES', () => {
    expect(EXAMPLES.map(([l]) => l)).toEqual(golden.gallery.map(g => g.label))
    expect(JOURNAL_EXAMPLES.map(([l]) => l)).toEqual(golden.journal_examples)
  })
})

describe('every example builds the same document.json', () => {
  it.each(golden.gallery.map((g, i) => [g.label, i] as const))('%s', (_label, i) => {
    setToday(day(golden.base_date))
    expect(toJson(GALLERY[i][2]())).toBe(golden.gallery[i].document_json)
  })
})

describe('planners and calendar for fixed dates', () => {
  const cases = Object.entries(golden.dated).flatMap(([date, docs]) =>
    Object.keys(docs).map(name => [date, name] as const))
  it.each(cases)('%s %s', (date, name) => {
    setToday(day(date))
    const factory = (planning as unknown as Record<string, () => Parameters<typeof toJson>[0]>)[camel(name)]
    expect(toJson(factory())).toBe(golden.dated[date][name])
  })

  it('_calendar_latex without today', () => {
    expect(planning._calendarLatex(2026, 11)).toBe(golden.calendar_latex_no_today)
  })

  it('_a fills the text width', () => {
    for (const [args, want] of Object.entries(golden.a_cases)) {
      const nums = JSON.parse(args.replace(/^\(/, '[').replace(/\)$/, ']').replace(/None/g, 'null'))
      expect(planning._a(nums[0], ...nums.slice(1)), args).toBe(want)
    }
  })
})

describe('examples are fresh documents', () => {
  it('two calls do not share nodes', () => {
    const [a, b] = [GALLERY[0][2](), GALLERY[0][2]()]
    expect(a).not.toBe(b)
    expect(a.children[0]).not.toBe(b.children[0])
    expect(a.meta.packages).not.toBe(b.meta.packages)
  })
})
