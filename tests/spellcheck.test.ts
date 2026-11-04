// Ports tests/test_spellcheck.py and checks suggestions and flagged
// ranges against the Python SpellHighlighter (tests/golden/spell.json).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SpellChecker } from '../src/spell/spellchecker'
import { isCheckable, SpellHighlighter } from '../src/spell/spellcheck'

const sc = SpellChecker.fromGzipJson(new Uint8Array(readFileSync('public/dict/en.json.gz')))
const golden = JSON.parse(readFileSync('tests/golden/spell.json', 'utf8')) as {
  suggestions: Record<string, string[]>
  misspelled: Record<string, boolean>
  ranges: Record<string, [number, number][]>
}
const highlighter = () => new SpellHighlighter(sc)

describe('test_spellcheck', () => {
  it('test_is_checkable_filters_obvious_non_words', () => {
    expect(isCheckable('hello')).toBe(true)
    expect(isCheckable("don't")).toBe(true)
    expect(isCheckable('a')).toBe(false)
    expect(isCheckable('ok')).toBe(false)
    expect(isCheckable('h2o')).toBe(false)
  })
  it('test_known_words_are_recognised', () => {
    expect(sc.unknown(['hello']).has('hello')).toBe(false)
    expect(sc.unknown(['machine']).has('machine')).toBe(false)
  })
  it('test_misspelled_words_are_flagged', () => {
    const bad = sc.unknown(['wrold', 'helo', 'machne'])
    for (const w of ['wrold', 'helo', 'machne']) expect(bad.has(w)).toBe(true)
  })
  it('test_is_misspelled_true_for_obvious_typo', () => {
    const h = highlighter()
    expect(h.isMisspelled('wrold')).toBe(true)
    expect(h.isMisspelled('helo')).toBe(true)
  })
  it('test_is_misspelled_false_for_known_word', () => {
    const h = highlighter()
    expect(h.isMisspelled('hello')).toBe(false)
    expect(h.isMisspelled('editor')).toBe(false)
  })
  it('test_is_misspelled_false_for_too_short_word', () => {
    expect(highlighter().isMisspelled('ok')).toBe(false)
  })
  it('test_suggestions_for_typo_include_correct_word', () => {
    const sugs = highlighter().suggestions('wrold')
    expect(sugs).toContain('world')
    expect(sugs.length).toBeLessThanOrEqual(7)
  })
  it('test_suggestions_preserve_capitalisation', () => {
    const h = highlighter()
    expect(h.suggestions('Wrold')[0]).toBe('World')
    expect(h.suggestions('WROLD')[0]).toBe('WORLD')
  })
  it('test_add_to_dictionary_stops_flagging', () => {
    const h = highlighter()
    h.addToDictionary('kherveDOC')
    expect(h.isMisspelled('kherveDOC')).toBe(false)
    expect(h.isMisspelled('KHERVEDOC')).toBe(false)
  })
})

describe('spell check parity with pyspellchecker', () => {
  const h = highlighter()
  for (const [w, sugs] of Object.entries(golden.suggestions)) {
    it(`suggestions ${w}`, () => expect(h.suggestions(w)).toEqual(sugs))
  }
  it('is_misspelled', () => {
    for (const [w, bad] of Object.entries(golden.misspelled)) expect([w, h.isMisspelled(w)]).toEqual([w, bad])
  })
  it('flagged ranges', () => {
    for (const [t, r] of Object.entries(golden.ranges)) expect(h.misspelledRanges(t)).toEqual(r)
  })
})
