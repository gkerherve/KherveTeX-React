// Ported from KherveTeX tests/test_chemfig.py (palette data, preview-doc
// builder, RawLatex round-trip). The dialog and tectonic-compile tests need
// a window and a TeX engine; the dialog is checked in the app.
import { describe, expect, it } from 'vitest'
import { CHEMFIG_GROUPS, PLACEHOLDER, buildPreviewDoc } from '../src/math/chemfig.ts'
import { docMeta, document, fromJson, rawLatex, toJson } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'

const group = (name: string) => CHEMFIG_GROUPS.find(([n]) => n === name)![1]
const count = (s: string, c: string) => s.split(c).length - 1

describe('palette data', () => {
  it('test_groups_are_wellformed', () => {
    expect(CHEMFIG_GROUPS.length).toBe(13)
    expect(CHEMFIG_GROUPS.map(([n]) => n)).toEqual(['Structures', 'Molecules', 'Hydrocarbons', 'Aromatics',
      'Heterocycles', 'Rings', 'Bonds', 'Groups', 'Stereo', 'Bio', 'Charges', 'Scheme', 'Polymer'])
    for (const [, items] of CHEMFIG_GROUPS) {
      expect(items.length).toBeGreaterThan(0)
      for (const [frag, label] of items) {
        expect(frag).toBeTruthy()
        expect(label).toBeTruthy()
      }
    }
  })

  it('test_templates_have_balanced_delimiters', () => {
    for (const [, items] of CHEMFIG_GROUPS) {
      for (const [frag, label] of items) {
        for (const [op, cl] of [['{', '}'], ['(', ')'], ['[', ']']]) {
          expect(count(frag, op!), `${label} ${frag}`).toBe(count(frag, cl!))
        }
      }
    }
  })

  it('test_molecule_groups_hold_complete_chemfig_macros', () => {
    for (const g of ['Molecules', 'Hydrocarbons', 'Aromatics', 'Heterocycles', 'Bio']) {
      for (const [frag, label] of group(g)) expect(frag.startsWith('\\chemfig{'), `${g} ${label}`).toBe(true)
    }
  })

  it('test_arrow_label_placeholders_are_math_wrapped', () => {
    for (const [frag, label] of group('Scheme')) {
      if (frag.includes(PLACEHOLDER) && frag.includes('->[')) expect(frag, label).toContain(`[$${PLACEHOLDER}$]`)
    }
  })

  it('test_placeholder_compiles_inside_chemfig', () => {
    expect(PLACEHOLDER).toBe('\\square')
  })

  it('test_structures_group_holds_complete_chemfig_macros', () => {
    expect(CHEMFIG_GROUPS[0]![1].every(([frag]) => frag.startsWith('\\chemfig{'))).toBe(true)
  })

  it('test_scheme_group_has_a_full_reaction_template', () => {
    expect(group('Scheme').some(([frag]) => frag.includes('schemestart') && frag.includes('schemestop'))).toBe(true)
  })
})

describe('preview-doc builder', () => {
  it('test_build_preview_doc_is_standalone_with_chemfig', () => {
    const doc = buildPreviewDoc('\\chemfig{*6(======)}')
    expect(doc).toContain('\\documentclass[border=4pt]{standalone}')
    expect(doc).toContain('\\usepackage{chemfig}')
    expect(doc).toContain('\\usepackage{amssymb}')
    expect(doc).toContain('\\begin{document}')
    expect(doc).toContain('\\end{document}')
    expect(doc).toContain('\\chemfig{*6(======)}')
  })

  it('test_build_preview_doc_strips_body', () => {
    expect(buildPreviewDoc('   \\chemfig{X}   ')).toContain('\n\\chemfig{X}\n')
  })
})

describe('RawLatex model', () => {
  it('test_chemfig_round_trips_as_rawlatex', () => {
    const body = "\\schemestart\n\\chemfig{S=C(-S-R)-S-R'}\n"
      + '\\arrow{->[\\text{Thermal RAFT}]}\n\\chemfig{X}\n\\schemestop'
    const doc = document([rawLatex(body)], docMeta({ title: 'T', packages: ['chemfig'] }))
    expect((fromJson(toJson(doc)).children[0] as { text: string }).text).toBe(body)
    const tex = serializeDocument(doc)
    expect(tex).toContain(body)
    expect(tex).toContain('\\usepackage{chemfig}')
  })
})
