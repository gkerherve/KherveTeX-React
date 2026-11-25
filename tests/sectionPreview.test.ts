import { describe, expect, it } from 'vitest'
import { CARET_MARK, numberedEquations, sectionOnly } from '../src/core/sectionPreview.ts'

const filler = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i}.`).join('\n')

function doc(body: string): string {
  return `\\documentclass{report}\n\\begin{document}\n${body}\n\\end{document}\n`
}

describe('sectionOnly', () => {
  it('keeps the section holding the caret, with the counters where it starts', () => {
    const tex = doc([
      '\\newcommand{\\foo}{bar}',
      '\\chapter{One}', filler(12),
      '\\section{A}', '\\begin{figure}x\\end{figure}', '\\begin{table}x\\end{table}', filler(5),
      '\\begin{align}a\\\\b\\nonumber\\\\c\\end{align}', 'x\\footnote{n}',
      '\\section{B}', CARET_MARK, 'Writing here.',
      '\\section{C}', filler(12),
    ].join('\n'))
    const out = sectionOnly(tex)!
    expect(out).toContain('\\section{B}')
    expect(out).toContain('Writing here.')
    expect(out).not.toContain('\\section{A}')
    expect(out).not.toContain('\\section{C}')
    expect(out).not.toContain(CARET_MARK)
    expect(out).toContain('\\newcommand{\\foo}{bar}')
    expect(out).toContain('\\setcounter{chapter}{1}')
    expect(out).toContain('\\setcounter{section}{1}')
    expect(out).toContain('\\setcounter{figure}{1}')
    expect(out).toContain('\\setcounter{table}{1}')
    expect(out).toContain('\\setcounter{equation}{2}')
    expect(out).toContain('\\setcounter{footnote}{1}')
    expect(out.trimEnd().endsWith('\\end{document}')).toBe(true)
  })

  it('restarts the chapters after \\appendix', () => {
    const tex = doc(['\\chapter{One}', filler(15), '\\chapter{Two}', filler(15), '\\appendix', '\\chapter{Data}', CARET_MARK, 'x'].join('\n'))
    const out = sectionOnly(tex)!
    expect(out).toContain('\\appendix')
    expect(out).toContain('\\setcounter{chapter}{0}')
  })

  it('compiles everything when the caret is before any heading or little is left out', () => {
    expect(sectionOnly(doc([CARET_MARK, '\\chapter{One}', filler(30)].join('\n')))).toBeNull()
    expect(sectionOnly(doc(['\\section{A}', CARET_MARK, 'x', '\\section{B}', 'y'].join('\n')))).toBeNull()
    expect(sectionOnly(doc(filler(30)))).toBeNull()
  })
})

describe('numberedEquations', () => {
  it('counts each numbered line', () => {
    expect(numberedEquations('\\begin{equation}a\\end{equation}\\begin{equation*}b\\end{equation*}')).toBe(1)
    expect(numberedEquations('\\begin{align}a\\\\b\\notag\\\\c\\\\\n\\end{align}')).toBe(2)
    expect(numberedEquations('\\begin{gather}a\\\\b\\end{gather}\\begin{multline}x\\\\y\\end{multline}')).toBe(3)
  })
})
