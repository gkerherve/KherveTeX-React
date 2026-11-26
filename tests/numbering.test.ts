// What a part left out of the compile would have numbered (core/numbering.ts).
import { describe, expect, it } from 'vitest'
import { applyNotCompileRanges, NOT_COMPILE_END, NOT_COMPILE_START } from '../src/core/compiler.ts'
import { skippedNumbering } from '../src/core/numbering.ts'

const counters = (lines: string[]) => lines.map(l => /refstepcounter\{(\w+)\}/.exec(l)?.[1] ?? (/\\label\{([^}]*)\}/.exec(l)?.[0]) ?? (l.includes('footnote') ? 'footnote' : ''))
  .filter(Boolean)

describe('numbering of a part left out', () => {
  it('steps the counters in order, with the labels after what they name', () => {
    const tex = ['\\chapter{Two}', 'Text\\footnote{n}.', '\\section*{Unnumbered}', '\\section{Numbered}',
      '\\begin{figure}\\caption{F}\\label{fig:a}\\end{figure}', '\\begin{table}\\caption{T}\\end{table}',
      '\\begin{align}x\\label{eq:1}\\\\y\\nonumber\\\\z\\label{eq:3}\\end{align}', '\\begin{align*}a\\\\b\\end{align*}',
      '\\begin{lemma}L\\end{lemma}', '% \\section{commented out}']
    expect(counters(skippedNumbering(tex))).toEqual(['chapter', 'footnote', 'section', 'figure', '\\label{fig:a}', 'table',
      'equation', '\\label{eq:1}', 'equation', '\\label{eq:3}', 'lemma'])
  })

  it('follows the \\iffalse of a range left out of the compile', () => {
    const tex = ['\\chapter{One}', NOT_COMPILE_START, '\\chapter{Two}', NOT_COMPILE_END, '\\chapter{Three}'].join('\n')
    const out = applyNotCompileRanges(tex).split('\n')
    const fi = out.indexOf('\\fi')
    expect(out[fi + 2]).toContain('\\refstepcounter{chapter}')
    expect(out[fi + 3]).toBe('\\chapter{Three}')
  })

  it('adds nothing when the part numbers nothing', () => {
    expect(skippedNumbering(['Just text.'])).toEqual([])
  })
})
