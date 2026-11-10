// Port of tests/test_report_import.py: a report/book .tex keeps its
// heading levels through import, and an equation whose body opens with
// split/array keeps its equation.
import { describe, expect, it } from 'vitest'
import { importBodyFragment, importTex } from '../src/core/importers.ts'
import type { Document, Section, Text } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'

const REPORT = String.raw`\documentclass{report}
\begin{document}
\chapter{Intro}
\section{Methods}
\subsection{Samples}
\subsubsection{Cleaning}
\paragraph{Annealing.} Text.
\end{document}
`

const levels = (doc: Document) => doc.children
  .filter((b): b is Section => b.type === 'Section')
  .map((b) => [b.level, (b.children[0] as Text).text])
const body = (src: string) => serializeDocument(importTex(src)).split('\\begin{document}')[1]

describe('test_report_import.py', () => {
  it('test_report_sections_sit_one_level_below_chapter', () => {
    expect(levels(importTex(REPORT))).toEqual([
      [0, 'Intro'], [2, 'Methods'], [3, 'Samples'], [4, 'Cleaning'], [5, 'Annealing.']])
  })

  it('test_report_headings_round_trip', () => {
    const out = serializeDocument(importTex(REPORT))
    for (const cmd of ['\\chapter{Intro}', '\\section{Methods}', '\\subsection{Samples}',
      '\\subsubsection{Cleaning}', '\\paragraph{Annealing.}']) expect(out).toContain(cmd)
    expect(out.split('\\begin{document}')[1].split('\\chapter').length - 1).toBe(1)
  })

  it('test_article_levels_unchanged', () => {
    expect(levels(importTex(REPORT.replace('{report}', '{article}'))).slice(1)).toEqual([
      [1, 'Methods'], [2, 'Samples'], [3, 'Cleaning'], [4, 'Annealing.']])
  })

  it('test_fragment_into_report_shifts_sections', () => {
    const blocks = importBodyFragment('\\section{A}\n\\subsection{B}', { hasChapters: true })
    expect(blocks.map((b) => (b as Section).level)).toEqual([2, 3])
    expect(importBodyFragment('\\section{A}').map((b) => (b as Section).level)).toEqual([1])
  })

  it('test_equation_with_split_keeps_its_equation', () => {
    const b = body('\\documentclass{article}\\begin{document}\n'
      + '\\begin{equation}\\begin{split} a &= b \\\\ &= c \\end{split}'
      + '\\label{eq:x}\\end{equation}\n\\end{document}')
    expect(b.indexOf('\\begin{equation}')).toBeGreaterThanOrEqual(0)
    expect(b.indexOf('\\begin{equation}')).toBeLessThan(b.indexOf('\\begin{split}'))
    expect(b).toContain('\\label{eq:x}')
  })

  it('test_display_array_keeps_its_math_delimiters', () => {
    const b = body('\\documentclass{article}\\begin{document}\n'
      + '\\[ \\begin{array}{l} x \\\\ y \\end{array} \\]\n\\end{document}')
    expect(b).toContain('\\begin{equation*}')
    expect(b.indexOf('\\begin{equation*}')).toBeLessThan(b.indexOf('\\begin{array}'))
  })

  it('test_align_still_emitted_verbatim', () => {
    const b = body('\\documentclass{article}\\begin{document}\n'
      + '\\begin{align} a &= b \\end{align}\n\\end{document}')
    expect(b).toContain('\\begin{align}')
    expect(b).not.toContain('equation')
  })
})
