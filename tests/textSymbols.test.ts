// Port of tests/test_text_symbols.py: text-symbol commands (\AA, \ss, \o,
// \textdegree...) import as the characters they print, not as raw LaTeX.
import { describe, expect, it } from 'vitest'
import { importBodyFragment } from '../src/core/importers.ts'
import type { Inline, Paragraph, Text } from '../src/core/model.ts'

const para = (latex: string) => importBodyFragment(latex)[0] as Paragraph
const text = (latex: string) => {
  const kids: Inline[] = para(latex).children
  expect(kids.filter((c) => c.type === 'InlineRaw')).toEqual([])
  return kids.filter((c): c is Text => c.type === 'Text').map((c) => c.text).join('')
}

describe('test_text_symbols.py', () => {
  it('test_angstrom_with_empty_group', () => {
    expect(text('close to 5 \\AA{} thickness')).toBe('close to 5 Å thickness')
  })

  it('test_space_after_command_word_is_swallowed', () => {
    expect(text('Stra\\ss e')).toBe('Straße')
    expect(text('10 \\textdegree C')).toBe('10 °C')
  })

  it('test_symbol_before_punctuation', () => {
    expect(text('Bj\\o rn, \\O re and \\ae{}ther\\ldots.')).toBe('Bjørn, Øre and æther….')
  })

  it('test_symbol_inside_bold_keeps_the_mark', () => {
    expect(para('\\textbf{1 \\AA{}}').children.map((c) => [(c as Text).text, (c as Text).marks]))
      .toEqual([['1 Å', ['bold']]])
  })

  it('test_accent_on_dotless_i', () => {
    expect(text('na\\"{\\i}ve')).toBe('naïve')
  })

  it('test_unknown_command_still_raw', () => {
    expect(para('\\Kstroke{} here').children[0].type).toBe('InlineRaw')
  })
})
