// Ported from KherveTeX tests/test_chemistry.py.
import { describe, expect, it } from 'vitest'
import * as chemistry from '../src/math/chemistry.ts'
import { CHEM_GROUPS, allTemplates, ceToMathtext, unwrapCe, wrapCe } from '../src/math/chemistry.ts'
import { docMeta, document, mathBlock, mathInline, paragraph } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'

// ---------------------------------------------------------------- transpiler

describe('transpiler', () => {
  it.each([
    ['H2O', '\\mathrm{H}_{2}\\mathrm{O}'],
    ['2H2', '2\\mathrm{H}_{2}'],
    ['SO4^2-', '\\mathrm{SO}_{4}^{2-}'],
    ['Na^+', '\\mathrm{Na}^{+}'],
    ['OH-', '\\mathrm{OH}^{-}'],
    ['e-', '\\mathrm{e}^{-}'],
    ['H2O(l)', '\\mathrm{H}_{2}\\mathrm{O}(\\mathrm{l})'],
  ])('test_species %s', (body, expected) => {
    expect(ceToMathtext(body)).toBe(expected)
  })

  it.each([
    ['A -> B', '\\rightarrow'],
    ['A <- B', '\\leftarrow'],
    ['A <=> B', '\\rightleftharpoons'],
    ['A <-> B', '\\leftrightarrow'],
  ])('test_arrows %s', (body, arrow) => {
    expect(ceToMathtext(body)).toContain(arrow)
  })

  it('test_full_reaction', () => {
    expect(ceToMathtext('2H2 + O2 -> 2H2O')).toBe(
      '2\\mathrm{H}_{2}\\;+\\;\\mathrm{O}_{2}\\;\\rightarrow'
      + '\\;2\\mathrm{H}_{2}\\mathrm{O}')
  })

  it('test_arrow_annotation_is_dropped', () => {
    const out = ceToMathtext('CaCO3 ->[\\Delta] CaO + CO2')
    expect(out).toContain('\\rightarrow')
    expect(out).not.toContain('Delta')
  })

  it('test_trailing_plus_is_a_charge_not_an_operator', () => {
    expect(ceToMathtext('^{227}_{90}Th+')).toBe('^{227}_{90}\\mathrm{Th}^{+}')
  })

  it('test_hydrate_dot_digits_are_a_coefficient', () => {
    expect(ceToMathtext('CuSO4.5H2O')).toBe('\\mathrm{CuSO}_{4}\\cdot 5\\mathrm{H}_{2}\\mathrm{O}')
  })

  it('test_bonds', () => {
    expect(ceToMathtext('C#N')).toBe('\\mathrm{C}\\equiv \\mathrm{N}')
  })

  it('test_precipitate_and_gas', () => {
    expect(ceToMathtext('BaSO4 v').endsWith('\\downarrow')).toBe(true)
    expect(ceToMathtext('CO2 ^').endsWith('\\uparrow')).toBe(true)
  })

  it('test_empty', () => {
    expect(ceToMathtext('')).toBe('')
    expect(ceToMathtext('   ')).toBe('')
  })
})

// ---------------------------------------------------------------- wrap_ce

describe('wrap_ce', () => {
  it('test_wrap_ce', () => {
    expect(wrapCe('H2O')).toBe('\\ce{H2O}')
    expect(wrapCe('  H2O  ')).toBe('\\ce{H2O}')
    expect(wrapCe('')).toBe('')
  })

  it('test_wrap_ce_is_idempotent', () => {
    expect(wrapCe('\\ce{H2O}')).toBe('\\ce{H2O}')
  })
})

// ---------------------------------------------------------------- templates

describe('templates', () => {
  it('test_placeholder_is_math_islanded', () => {
    // mhchem parses the \ce{} body itself and aborts on a bare \square.
    expect(chemistry.PLACEHOLDER).toBe('$\\square$')
  })

  it('test_no_template_contains_a_bare_square', () => {
    const bare = /(?<!\$)\\square(?!\$)/
    for (const [body] of allTemplates()) expect(bare.test(body), body).toBe(false)
  })

  it('test_every_template_previews', () => {
    for (const [body] of allTemplates()) expect(ceToMathtext(body).trim(), body).not.toBe('')
  })

  it('test_groups_are_wellformed', () => {
    expect(CHEM_GROUPS.length).toBe(10)
    expect(CHEM_GROUPS.map(([n]) => n)).toEqual(['Reactions', 'Arrows', 'States', 'Charges', 'Species',
      'Bonds', 'Conditions', 'Acids & bases', 'Redox', 'Nuclear'])
    for (const [name, items] of CHEM_GROUPS) {
      expect(name).toBeTruthy()
      expect(items.length).toBeGreaterThan(0)
      for (const [body, label] of items) {
        expect(typeof body).toBe('string')
        expect(typeof label).toBe('string')
      }
    }
  })
})

// ---------------------------------------------------------------- serializer

describe('serializer', () => {
  const meta = docMeta({ title: 'T', packages: ['amsmath', 'mhchem'] })

  it('test_inline_chemistry_serializes_as_math', () => {
    const tex = serializeDocument(document([paragraph([mathInline('\\ce{H2O}')])], meta))
    expect(tex).toContain('$\\ce{H2O}$')
    expect(tex).toContain('\\usepackage{mhchem}')
  })

  it('test_block_chemistry_serializes_as_equation', () => {
    const tex = serializeDocument(document([mathBlock('\\ce{2H2 + O2 -> 2H2O}')], meta))
    expect(tex).toContain('\\ce{2H2 + O2 -> 2H2O}')
    expect(tex).toContain('\\begin{equation*}')
  })

  it('test_numbered_block_chemistry_serializes_as_numbered_equation', () => {
    const tex = serializeDocument(document([mathBlock('\\ce{H2O}', true)], meta))
    expect(tex).toContain('\\begin{equation}')
  })
})

describe('unwrap_ce', () => {
  it('test_unwrap_ce', () => {
    expect(unwrapCe('\\ce{H2O}')).toBe('H2O')
    expect(unwrapCe('  \\ce{2H2 + O2 -> 2H2O}  ')).toBe('2H2 + O2 -> 2H2O')
    expect(unwrapCe('\\ce{$\\square$ -> $\\square$}')).toBe('$\\square$ -> $\\square$')
  })

  it('test_unwrap_ce_rejects_non_chemistry', () => {
    expect(unwrapCe('\\frac{x}{y}')).toBeNull()
    expect(unwrapCe('')).toBeNull()
    expect(unwrapCe('\\cerium{x}')).toBeNull()
  })

  it('test_unwrap_ce_rejects_two_separate_formulae', () => {
    expect(unwrapCe('\\ce{A} + \\ce{B}')).toBeNull()
  })

  it('test_wrap_unwrap_round_trip', () => {
    for (const body of ['H2O', '2H2 + O2 -> 2H2O', '$\\square$ + $\\square$']) {
      expect(unwrapCe(wrapCe(body))).toBe(body)
    }
  })
})
