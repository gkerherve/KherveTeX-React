// Port of tests/test_word_math.py — equations pasted from Word as Unicode
// text, converted back to LaTeX.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { convert } from '../src/core/wordMath.ts'

describe('test_word_math.py', () => {
  it('test_users_example_with_number', () => {
    const [latex, num] = convert('Ln = −⟨P⟩hi,     Rn = −⟨P⟩lo\t\t(2)')
    expect(num).toBe('2')
    expect(latex).toBe('L_{n} = -\\langle P\\rangle _{\\text{hi}},\\qquad '
      + 'R_{n} = -\\langle P\\rangle _{\\text{lo}}')
  })

  const cases: [string, string][] = [
    ['E = mc²', 'E = mc^{2}'],
    ['ΔG = −nFE', '\\Delta G = -nFE'],
    ['sin θ ≤ 1', '\\sin \\theta \\le 1'],
    ['x₁ + x₂ = 3', 'x_{1} + x_{2} = 3'],
    ['Emax = ħω/2', 'E_{\\text{max}} = \\hbar \\omega /2'],
  ]
  for (const [t, expected] of cases) {
    it(`test_symbols_scripts_and_functions[${t}]`, () => {
      expect(convert(t)).toEqual([expected, null])
    })
  }

  it.skip('test_selection_becomes_numbered_display_equation — Qt editor', () => {})
})

// What khervedoc.word_math.convert returns, from tests/golden/docx.json.
const goldenPath = new URL('./golden/docx.json', import.meta.url)
const golden: [string, string, string | null][] = existsSync(goldenPath)
  ? JSON.parse(readFileSync(goldenPath, 'utf8')).word_math ?? []
  : []

describe('convert parity with Python', () => {
  it('has cases', () => expect(golden.length).toBeGreaterThan(0))
  for (const [input, latex, num] of golden) {
    it(JSON.stringify(input), () => expect(convert(input)).toEqual([latex, num]))
  }
})
