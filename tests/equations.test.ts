// Ported from KherveTeX tests/test_equation_editor.py and the layout and
// dialog-logic parts of tests/test_mathbox_ui.py. What needs a real window
// (key clicks, the clipboard) is checked in the app; here the same
// behaviour is driven through the model and the field helpers.
import { describe, expect, it } from 'vitest'
import * as mb from '../src/math/mathbox.ts'
import * as ml from '../src/math/mathlayout.ts'
import { autoCloseBegin, placeholderHint, placeholderJump, placeholderSpans, slotHint } from '../src/math/fieldLogic.ts'
import { PLACEHOLDER as CHEM_PH } from '../src/math/chemistry.ts'
import { niceName, symbolInsertLatex, templateName } from '../src/math/editorData.ts'
import { renderMath } from '../src/math/render.ts'
import { allTemplates } from '../src/math/equations.ts'

const SQ = '\\square'
const lay = (latex: string, display = true) => new ml.Layout(32, display).layout(mb.parseLatex(latex))

// The span that contains (or ends at) pos, as _select_placeholder_at.
const spanAt = (text: string, ph: string, pos: number) =>
  placeholderSpans(text, ph).find(([s, e]) => s <= pos && pos <= e) ?? null

describe('placeholders', () => {
  it('test_placeholder_spans', () => {
    const text = '\\frac{\\square}{\\square} + x'
    const spans = placeholderSpans(text, SQ)
    expect(spans.length).toBe(2)
    for (const [s, e] of spans) expect(text.slice(s, e)).toBe(SQ)
  })

  it('test_click_position_selects_whole_placeholder', () => {
    const text = 'x + \\square'
    for (const pos of [4, 7, 11]) {
      const hit = spanAt(text, SQ, pos)
      expect(hit && text.slice(...hit)).toBe(SQ)
    }
    expect(spanAt(text, SQ, 1)).toBeNull()
  })

  it('test_placeholders_are_highlighted', () => {
    expect(placeholderSpans('\\sqrt{\\square}', SQ)).toEqual([[6, 13]])
  })

  it('tab jumps forward and back, wrapping', () => {
    const text = '\\square = \\square'
    expect(placeholderJump(text, SQ, 0, true)).toBe(0)
    expect(placeholderJump(text, SQ, 7, true)).toBe(10)
    expect(placeholderJump(text, SQ, 17, true)).toBe(0)
    expect(placeholderJump(text, SQ, 9, false)).toBe(0)
    expect(placeholderJump(text, SQ, 0, false)).toBe(10)
    expect(placeholderJump('x', SQ, 0, true)).toBeNull()
  })

  it('closing brace of \\begin{env} closes the environment', () => {
    expect(autoCloseBegin('\\begin{cases', SQ)).toBe('}\n\\square\n\\end{cases}')
    expect(autoCloseBegin('\\begin{align*', SQ)).toBe('}\n\\square\n\\end{align*}')
    expect(autoCloseBegin('\\frac{a', SQ)).toBeNull()
  })

  it('test_chemistry_placeholder_click_selects_math_islanded_token', () => {
    const text = '$\\square$ -> $\\square$'
    const hit = spanAt(text, CHEM_PH, 3)
    expect(hit && text.slice(...hit)).toBe('$\\square$')
  })

  it('test_slot_hint_counts_placeholders', () => {
    expect(slotHint(mb.countEmpty(mb.parseLatex('\\frac{\\square}{\\square}'))).startsWith('2 empty slots')).toBe(true)
    expect(slotHint(mb.countEmpty(mb.parseLatex('x + y')))).toBe('')
    expect(slotHint(1)).toBe('1 empty slot — press Tab to jump between them')
    expect(placeholderHint(2)).toBe('2 empty slots — click one (or press Tab) to select it, then type to fill it in.')
  })
})

describe('palette names', () => {
  it('names every template', () => {
    expect(templateName('\\frac{\\square}{\\square}', '')).toBe('Fraction')
    expect(templateName('\\begin{cases}\\n\\square', 'x')).toBe('Cases (piecewise)')
    expect(templateName('\\sin(\\square)', 'x')).toBe('Sine')
    expect(templateName('\\exp(\\square)', 'x')).toBe('Exponential function')
    expect(templateName('\\alpha', 'x')).toBe('alpha')
    expect(templateName('\\Delta', 'x')).toBe('Capital delta')
    expect(niceName('\\leq')).toBe('Less or equal')
    expect(niceName('\\mathbb{R}')).toBe('Mathbb')
    expect(symbolInsertLatex('\\hat{a}')).toBe('\\hat{\\square}')
    expect(symbolInsertLatex('\\mathbb{R}')).toBe('\\mathbb{R}')
    for (const [latex, preview] of allTemplates()) expect(templateName(latex, preview)).toBeTruthy()
  })
})

describe('layout', () => {
  it('test_fraction_is_taller_than_a_letter', () => {
    const x = lay('x')
    const f = lay('\\frac{x}{y}')
    expect(f.asc).toBeGreaterThan(x.asc * 1.5)
    expect(f.desc).toBeGreaterThan(x.desc + 5)
  })

  it('test_scripts_are_smaller_and_raised', () => {
    const b = lay('x^2')
    const base = b.kids[0]![2]
    const scripts = b.kids[1]![2]
    const [, supDy, sup] = scripts.kids[0]!
    expect(supDy).toBeLessThan(0)
    expect(sup.em).toBeCloseTo(base.em * 0.7)
  })

  it('test_display_limits_go_above_and_below', () => {
    const disp = lay('\\sum_{i=1}^{n} i', true)
    const inline = lay('\\sum_{i=1}^{n} i', false)
    expect(disp.asc + disp.desc).toBeGreaterThan(inline.asc + inline.desc)
  })

  it('test_delimiters_grow_with_content', () => {
    const small = lay('\\left( x \\right)')
    const tall = lay('\\left( \\frac{\\frac{a}{b}}{c} \\right)')
    expect(tall.asc + tall.desc).toBeGreaterThan((small.asc + small.desc) * 1.8)
  })

  it('test_matrix_grid_is_wider_than_one_cell', () => {
    const m = lay('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')
    expect(m.w).toBeGreaterThan(lay('ab').w)
    expect(m.asc + m.desc).toBeGreaterThan(lay('a').asc * 2.5)
  })

  it('test_row_geometry_has_a_gap_per_caret_position', () => {
    const row = mb.parseLatex('a+b')
    const g = ml.collectRows(new ml.Layout(32).layout(row)).get(row)!
    expect(g.gaps.length).toBe(4)
    expect(g.gaps).toEqual([...g.gaps].sort((a, b) => a - b))
  })

  it('test_render_image_is_not_blank', () => {
    const img = ml.renderRow(mb.parseLatex('\\sqrt{x^2+1}'), 24)
    expect(img.width).toBeGreaterThan(20)
    expect(img.height).toBeGreaterThan(20)
    expect((img.svg.match(/<(text|path|rect)\b/g) ?? []).length).toBeGreaterThan(3)
  })

  it('test_widget_click_places_caret_in_denominator', () => {
    // MathEditWidget.hit picks the smallest row rect under the pointer.
    const e = new mb.Editor()
    e.setLatex('\\frac{a}{b}')
    const box = new ml.Layout(34).layout(e.root)
    const rows = ml.collectRows(box, 28, 28 + box.asc)
    const frac = e.root.children[0] as mb.Frac
    const g = rows.get(frac.den)!
    const x = g.gaps[g.gaps.length - 1]!
    const under = [...rows.values()].filter(r => {
      const [rx, ry, rw, rh] = r.rect()
      return x >= rx - 2 && x <= rx + rw + 2 && g.y >= ry - 2 && g.y <= ry + rh + 2
    }).sort((p, q) => p.rect()[2] * p.rect()[3] - q.rect()[2] * q.rect()[3])
    expect(under[0]!.row).toBe(frac.den)
  })
})

describe('dialog logic', () => {
  it('test_widget_typing_builds_structure', () => {
    const e = new mb.Editor()
    e.typeText('x^2')
    e.moveRight()
    e.typeText('+1/y')
    expect(e.latex()).toBe('x^2 + \\frac{1}{y}')
  })

  it('test_widget_tab_and_backspace', () => {
    const e = new mb.Editor()
    e.insertLatex('\\frac{\\square}{\\square}')
    e.typeText('a')
    e.nextSlot(true)
    e.typeText('b')
    expect(e.latex()).toBe('\\frac{a}{b}')
    e.backspace()
    e.backspace()           // unwrap at slot start
    expect(e.latex()).toBe('a')
  })

  it('test_widget_completion_popup', () => {
    const e = new mb.Editor()
    e.typeText('\\alph')
    expect(mb.completions(e.cmd!.text).length).toBeGreaterThan(0)
    e.commitCmd(mb.completions(e.cmd!.text)[0]![0])
    expect(e.latex()).toBe('\\alpha')
    expect(e.cmd).toBeNull()
  })

  it('test_widget_copy_paste_as_latex', () => {
    const e = new mb.Editor()
    e.typeText('a/b')
    e.selectAll()
    const copied = e.selectionLatex() || e.latex()
    expect(copied).toBe('\\frac{a}{b}')
    e.moveRight()
    e.typeText('=')
    e.pasteLatex(copied)
    expect(e.latex()).toBe('\\frac{a}{b} = \\frac{a}{b}')
  })

  it('test_dialog_insert_multiline_environment', () => {
    const e = new mb.Editor()
    e.insertLatex(mb.normalizeTemplate('\\begin{cases}\\n\\square & \\text{if } \\square \\\\\\\\\\n'
      + '\\square & \\text{otherwise}\\n\\end{cases}'))
    const m = e.root.children[0] as mb.Matrix
    expect(m).toBeInstanceOf(mb.Matrix)
    expect(m.env).toBe('cases')
    expect(m.rows.length).toBe(2)
  })

  it('test_dialog_source_edit_updates_tree', () => {
    const e = new mb.Editor()
    e.setLatex('\\sqrt{\\square} + 1')
    expect(e.root.children[0]).toBeInstanceOf(mb.Sqrt)
    expect(slotHint(mb.countEmpty(e.root)).startsWith('1 empty slot')).toBe(true)
    e.typeText('y')
    expect(e.latex(mb.PLACEHOLDER)).toBe('\\sqrt{\\square} + 1y')
    expect(e.latex()).toBe('\\sqrt{} + 1y')
  })
})

describe('renderMath', () => {
  it('typesets document equations with their baseline', () => {
    const r = renderMath('\\frac{a + b}{c^2}', { display: true, fontPx: 50 })
    expect(r.svg.startsWith('<svg')).toBe(true)
    expect(r.height).toBeGreaterThan(1.6 * 50)
    expect(r.baseline).toBeGreaterThan(0)
    expect(r.baseline).toBeLessThan(r.height)
    expect(r.typeset).toBe(true)
  })

  it('draws \\ce{} and drops labels, as _render_math_typeset', () => {
    expect(renderMath('\\ce{2H2 + O2 -> 2H2O}', { display: false, fontPx: 20 }).typeset).toBe(true)
    expect(renderMath('E = mc^2 \\label{eq:e}', { display: true, fontPx: 20 }).typeset).toBe(true)
    expect(renderMath('\\foo{x}', { display: false, fontPx: 20 }).typeset).toBe(false)
  })
})
