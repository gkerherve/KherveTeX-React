import { describe, expect, it } from 'vitest'
import { documentLabels } from '../src/core/labels.ts'
import { document as newDocument, figure, mathBlock, paragraph, rawLatex, table, text } from '../src/core/model.ts'
import { takeLabel } from '../src/math/label.ts'

describe('document labels', () => {
  it('lists figures, tables, equations and raw labels with their numbers', () => {
    const doc = newDocument([
      paragraph([text('x')]),
      figure({ path: 'a.png', caption: 'An XRD pattern', label: 'fig:xrd' }),
      table({ rows: [['a']], caption: 'Sizes', label: 'tab:sizes' }),
      mathBlock('E = mc^2', true, 'eq:e'),
      rawLatex('\\begin{figure*}\\caption{Wide}\\label{fig:wide}\\end{figure*}'),
    ])
    expect(documentLabels(doc).map(l => [l.label, l.kind, l.number])).toEqual([
      ['fig:xrd', 'figure', '1'], ['tab:sizes', 'table', '1'], ['eq:e', 'equation', '1'], ['fig:wide', 'figure', ''],
    ])
  })

  it('takes a typed \\label out of an equation', () => {
    expect(takeLabel('D = \\frac{a}{b} \\label{eq:s}')).toEqual(['D = \\frac{a}{b}', 'eq:s'])
    expect(takeLabel('\\begin{align} a \\label{x} \\end{align}')[1]).toBeNull()
  })
})
