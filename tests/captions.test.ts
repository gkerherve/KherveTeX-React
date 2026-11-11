// What can be referred to (core/labels.ts): every figure, table, numbered
// equation and heading, labelled or not, with the number it prints; and
// the labels made for those without one.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { makeLabel, referables, takenLabels } from '../src/core/labels.ts'

const doc = () => M.document([
  M.section(1, [M.text('Introduction')]),
  M.figure({ path: 'a.png', caption: 'Decay curve of tritium', label: null }),
  M.mathBlock('E = mc^2', true, null),
  M.mathBlock('x = 1', false, null),
  M.section(1, [M.text('Results')], true, 'sec:results'),
  M.figure({ path: 'b.png', caption: 'Second', label: 'fig:second' }),
  M.table({ caption: 'Measured values', label: null, rows: [] }),
])

describe('captions and labels', () => {
  it('lists every numbered item, labelled or not, with its number', () => {
    const r = referables(doc())
    expect(r.map(x => [x.index, x.kind, x.number, x.label])).toEqual([
      [0, 'section', '1', null],
      [1, 'figure', '1', null],
      [2, 'equation', '1', null],
      [4, 'section', '2', 'sec:results'],
      [5, 'figure', '2', 'fig:second'],
      [6, 'table', '1', null],
    ])
    expect(r[1].caption).toBe('Decay curve of tritium')
    expect(r[2].caption).toBe(null)
    expect(r[0].text).toBe('Introduction')
  })
  it('makes labels as LaTeX authors write them, unique', () => {
    const taken = takenLabels(doc())
    expect(makeLabel('figure', 'Decay curve of tritium', taken)).toBe('fig:decay-curve-tritium')
    expect(makeLabel('figure', 'Second', taken)).toBe('fig:second-2')
    expect(makeLabel('equation', 'E = mc^2', taken)).toBe('eq:e-mc-2')
    expect(makeLabel('table', '', new Set())).toBe('tab:table')
    expect(makeLabel('section', 'Résumé & \\textbf{bold}', new Set())).toBe('sec:resume-bold')
  })
})
