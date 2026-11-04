// Ported from KherveTeX tests/test_mathbox.py: typing behaviour, editing
// operations and the LaTeX parser/serializer round trip.
import { describe, expect, it } from 'vitest'
import * as mb from '../src/math/mathbox.ts'
import { EQUATION_GROUPS } from '../src/math/equations.ts'
import {
  Atom, BigOp, Delim, Editor, Frac, Func, Matrix, PLACEHOLDER, Raw, Row,
  Scripts, Sqrt, Symbol as Sym, parseLatex, toLatex,
} from '../src/math/mathbox.ts'

function typed(text: string): Editor {
  const e = new Editor()
  e.typeText(text)
  return e
}

function norm(s: string): string {
  s = mb.normalizeTemplate(s)
  s = s.replaceAll('\\{', 'LBR').replaceAll('\\}', 'RBR')
  s = s.replace(/\\(left|right)(?![A-Za-z])/g, '')
  s = s.replace(/\s+/gu, '')
  return s.replaceAll('{', '').replaceAll('}', '')
}

function raws(row: Row): Raw[] {
  const out: Raw[] = []
  for (const r of mb.walkRows(row)) for (const n of r.children) if (n instanceof Raw) out.push(n)
  return out
}

const kinds = (r: Row) => r.children.map(n => n.constructor)

// ------------------------------------------------------------- typing

describe('typing', () => {
  it('test_typing_script_then_fraction', () => {
    const e = typed('x^2')
    e.moveRight()            // leave the superscript
    e.typeText('+1/y')
    expect(e.latex()).toBe('x^2 + \\frac{1}{y}')
  })

  it('test_slash_wraps_preceding_operand', () => {
    expect(typed('2x/3').latex()).toBe('\\frac{2x}{3}')
    // a bracketed numerator loses its now-redundant parentheses
    const e = typed('(a+b')
    e.typeChar(')')
    e.typeText('/c')
    expect(e.latex()).toBe('\\frac{a + b}{c}')
  })

  it('test_slash_with_nothing_before_starts_empty_fraction', () => {
    const e = typed('/')
    const f = e.root.children[0]
    expect(f).toBeInstanceOf(Frac)
    expect(e.row).toBe((f as Frac).num)
  })

  it('test_backslash_command_becomes_symbol_or_structure', () => {
    let e = typed('\\alpha ')
    expect(e.root.children[0]).toBeInstanceOf(Sym)
    e = typed('\\sqrt x')
    expect(e.latex()).toBe('\\sqrt{x}')
    e = typed('\\frac ')
    expect(e.root.children[0]).toBeInstanceOf(Frac)
  })

  it('test_command_completion_choice', () => {
    const e = typed('\\alp')
    expect(mb.completions('alp')[0]![0]).toBe('alpha')
    e.commitCmd('alpha')
    expect(e.latex()).toBe('\\alpha')
  })

  it('test_function_names_are_recognised', () => {
    let e = typed('sinx')
    expect(e.root.children[0]).toBeInstanceOf(Func)
    expect(e.latex()).toBe('\\sin x')
    e = typed('sinh')
    expect(kinds(e.root)).toEqual([Func])
    expect((e.root.children[0] as Func).name).toBe('sinh')
    expect(typed('arccos').latex()).toBe('\\arccos')
  })

  it('test_lim_becomes_limit_with_lower_slot', () => {
    const e = typed('lim')
    const op = e.root.children[0] as BigOp
    expect(op).toBeInstanceOf(BigOp)
    expect(e.row).toBe(op.lower)
    e.typeText('x->0')
    e.moveRight()
    e.typeText('f')
    expect(e.latex()).toBe('\\lim_{x \\to 0} f')
  })

  it('test_autocorrect_pairs', () => {
    expect(typed('a<=b').latex()).toBe('a \\leq b')
    expect(typed('a!=b').latex()).toBe('a \\neq b')
    expect(typed('x+-1').latex()).toBe('x \\pm 1')
  })

  it('test_brackets_and_closing', () => {
    const e = typed('f(x')
    e.typeChar(')')
    e.typeText('=1')
    expect(e.latex()).toBe('f(x) = 1')
    expect(e.root.children[1]).toBeInstanceOf(Delim)
  })

  it('test_tall_brackets_use_left_right', () => {
    const e = typed('(')
    e.typeText('1/2')
    expect(e.latex()).toBe('\\left( \\frac{1}{2} \\right)')
  })

  it('test_subscript_and_superscript_share_a_node', () => {
    const e = typed('x_i')
    e.moveRight()
    e.typeChar('^')
    e.typeChar('2')
    expect(e.latex()).toBe('x_i^2')
    expect(e.root.children.filter(n => n instanceof Scripts).length).toBe(1)
  })

  it('test_text_inside_text_keeps_spaces', () => {
    const e = typed('\\text ')
    e.typeText('if x')
    expect(e.latex()).toBe('\\text{if x}')
  })
})

// ------------------------------------------------------------ editing

describe('editing', () => {
  it('test_backspace_at_slot_start_unwraps_structure', () => {
    const e = typed('a/b')
    e.moveLeft()             // to start of denominator
    expect(e.row).toBe((e.root.children[0] as Frac).den)
    expect(e.idx).toBe(0)
    e.backspace()
    expect(e.latex()).toBe('ab')
    expect(e.row).toBe(e.root)
    expect(e.idx).toBe(1)
  })

  it('test_backspace_enters_structure_then_deletes', () => {
    const e = typed('\\sqrt x')
    e.moveRight()            // out of the root
    e.backspace()            // steps inside
    expect(e.row).toBe((e.root.children[0] as Sqrt).body)
    e.backspace()
    e.backspace()            // empty root dissolves
    expect(e.latex()).toBe('')
  })

  it('test_undo_redo', () => {
    const e = typed('ab')
    e.undo()
    expect(e.latex()).toBe('a')
    e.redo()
    expect(e.latex()).toBe('ab')
  })

  it('test_template_wraps_selection', () => {
    let e = typed('x+1')
    e.selectAll()
    e.insertLatex('\\sqrt{\\square}')
    expect(e.latex()).toBe('\\sqrt{x + 1}')
    e = typed('y')
    e.selectAll()
    e.insertLatex('\\frac{\\square}{\\square}')
    expect(e.latex()).toBe('\\frac{y}{}')
    expect(e.row).toBe((e.root.children[0] as Frac).den)
  })

  it('test_template_caret_goes_to_first_slot_and_tab_cycles', () => {
    const e = new Editor()
    e.insertLatex('\\int_{\\square}^{\\square} \\square \\, d\\square')
    const op = e.root.children[0] as BigOp
    expect(e.row).toBe(op.lower)
    e.typeChar('0')
    e.nextSlot()
    expect(e.row).toBe(op.upper)
    e.typeChar('1')
    e.nextSlot()
    e.typeChar('f')
    e.nextSlot()
    e.typeChar('x')
    expect(e.latex()).toBe('\\int_0^1 f\\, dx')
    expect(mb.countEmpty(e.root)).toBe(0)
  })

  it('test_typing_replaces_placeholder', () => {
    const e = new Editor()
    e.insertLatex('\\square = \\square')
    e.typeChar('a')
    expect(e.latex(PLACEHOLDER)).toBe('a = \\square')
  })

  it('test_selection_lifts_to_common_row', () => {
    const e = typed('a+b/c')
    const frac = e.root.children[e.root.children.length - 1] as Frac
    e.setSelection(e.root, 0, frac.den, 1)
    expect(e.row).toBe(e.root)
    expect(e.selection()).toEqual([e.root, 0, 3])
    expect(e.selectionLatex()).toBe('a + \\frac{b}{c}')
  })

  it('test_vertical_movement_in_fraction', () => {
    const e = typed('a/b')
    const f = e.root.children[0] as Frac
    e.moveVertical(true)
    expect(e.row).toBe(f.num)
    e.moveVertical(false)
    expect(e.row).toBe(f.den)
  })

  it('test_matrix_add_row', () => {
    const e = new Editor()
    e.insertLatex('\\begin{pmatrix}\\square&\\square\\\\\\square&\\square\\end{pmatrix}')
    const m = e.root.children[0] as Matrix
    expect(e.matrixAddRow()).toBe(true)
    expect(m.rows.length).toBe(3)
    expect(e.row).toBe(m.rows[1]![0])
  })

  it('test_paste_latex', () => {
    const e = typed('y=')
    e.pasteLatex('\\frac{1}{2}')
    expect(e.latex()).toBe('y = \\frac{1}{2}')
  })
})

// ------------------------------------------------------- parse/serialise

describe('parse and serialise', () => {
  it('test_parse_structures', () => {
    const r = parseLatex('\\frac{a}{b} + \\sqrt[3]{x} + x_1^2')
    expect(kinds(r)).toEqual([Frac, Atom, Sqrt, Atom, Atom, Scripts])
    expect((r.children[2] as Sqrt).index).not.toBeNull()
  })

  it('test_empty_slots_serialise_as_braces_for_the_document', () => {
    const r = parseLatex('\\frac{\\square}{\\square}')
    expect(toLatex(r)).toBe('\\frac{}{}')
    expect(toLatex(r, PLACEHOLDER)).toBe('\\frac{\\square}{\\square}')
  })

  it('test_bigop_limits_attach', () => {
    const r = parseLatex('\\sum_{i=1}^{n} i')
    const op = r.children[0] as BigOp
    expect(op).toBeInstanceOf(BigOp)
    expect(toLatex(op.lower!)).toBe('i = 1')
    expect(toLatex(r)).toBe('\\sum_{i=1}^n i')
  })

  it('test_environments_parse_to_matrix', () => {
    const r = parseLatex('\\begin{cases} x & y \\\\ z & w \\end{cases}')
    const m = r.children[0] as Matrix
    expect(m).toBeInstanceOf(Matrix)
    expect(m.env).toBe('cases')
    expect(m.rows.length).toBe(2)
    expect(m.rows[0]!.length).toBe(2)
  })

  it('test_unknown_constructs_are_kept_verbatim', () => {
    const src = '\\ce{2H2 + O2 -> 2H2O} + \\foo[1]{a}{b}'
    const r = parseLatex(src)
    expect(raws(r).map(n => n.latex)).toEqual(['\\ce{2H2 + O2 -> 2H2O}', '\\foo[1]{a}{b}'])
    expect(toLatex(r)).toBe(src)
  })

  it('test_parser_never_raises_on_garbage', () => {
    for (const s of ['}{', '\\frac{', '\\left(', 'x^', '\\begin{pmatrix} a',
      '\\sqrt[', '&&', '\\\\', 'a_b_c', '(((', ']]']) toLatex(parseLatex(s))
  })

  it.each(EQUATION_GROUPS.flatMap(([, items]) => items.map(([t]) => t)))('test_every_template_round_trips %s', (tpl) => {
    const row = parseLatex(tpl)
    expect(raws(row)).toEqual([])
    const once = toLatex(row, PLACEHOLDER)
    expect(toLatex(parseLatex(once), PLACEHOLDER)).toBe(once)
    expect(norm(once)).toBe(norm(tpl))
  })
})

const CORPUS = [
  'E = mc^2',
  'F = G\\frac{m_1 m_2}{r^2}',
  '\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}',
  '\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J} + \\mu_0\\varepsilon_0'
  + ' \\frac{\\partial \\mathbf{E}}{\\partial t}',
  'i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi',
  '\\Delta G = \\Delta H - T\\Delta S',
  'K_{eq} = \\frac{[\\mathrm{C}]^c[\\mathrm{D}]^d}'
  + '{[\\mathrm{A}]^a[\\mathrm{B}]^b}',
  'pH = -\\log_{10}[\\mathrm{H}^+]',
  'k = A e^{-E_a/RT}',
  '\\langle x \\rangle = \\int_{-\\infty}^{\\infty} x |\\psi(x)|^2 \\, dx',
  'e^{i\\pi} + 1 = 0',
  '\\sum_{k=0}^{n} \\binom{n}{k} x^k y^{n-k}',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
  '\\sqrt[n]{a} \\cdot \\overline{z}',
  '\\left\\{ x \\in \\mathbb{R} : x > 0 \\right\\}',
  "f'(x) = \\lim_{h\\to 0}\\frac{f(x+h)-f(x)}{h}",
  '\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}',
  '\\begin{aligned} a &= b + c \\\\ &= d \\end{aligned}',
  'PV = nRT',
  '\\text{rate} = k[\\mathrm{A}]^m[\\mathrm{B}]^n',
  '\\frac{d[\\mathrm{A}]}{dt} = -k[\\mathrm{A}]',
  'S = k_B \\ln \\Omega',
  '\\oint_C \\mathbf{F} \\cdot d\\mathbf{r}',
  '\\hat{a}\\,\\vec{v}\\,\\dot{x}\\,\\ddot{y}\\,\\tilde{n}',
  '\\operatorname{Tr}(A) = \\sum_i A_{ii}',
  'x_{i,j}^{(n)}',
  '\\left| \\frac{a}{b} \\right| \\leq 1',
  '\\frac{1}{2}mv^2 + \\frac{1}{2}kx^2 = E',
  '\\sigma = \\sqrt{\\frac{1}{N}\\sum_{i=1}^{N}(x_i - \\mu)^2}',
  '\\mathrm{d}U = T\\,\\mathrm{d}S - p\\,\\mathrm{d}V',
]

describe('corpus', () => {
  it.each(CORPUS)('test_corpus_round_trips %s', (src) => {
    const row = parseLatex(src)
    expect(raws(row)).toEqual([])
    const once = toLatex(row)
    expect(toLatex(parseLatex(once))).toBe(once)
    expect(norm(once)).toBe(norm(src))
  })
})
