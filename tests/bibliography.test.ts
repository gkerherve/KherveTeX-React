import { describe, expect, it } from 'vitest'
import { formatReference, parseTheBibliography, suggestKey, writeTheBibliography } from '../src/core/bibliography.ts'

const SRC = String.raw`\begin{thebibliography}{9}
\small
\bibitem{knuth} D. E. Knuth, \emph{The \TeX book} (Addison-Wesley, 1984).

\bibitem[LL]{lamport}
L. Lamport, \emph{LaTeX}, 2nd ed. (1994).
\end{thebibliography}`

describe('thebibliography', () => {
  it('reads the items, labels and preamble', () => {
    const b = parseTheBibliography(SRC)!
    expect(b.widest).toBe('9')
    expect(b.before).toBe('\\small')
    expect(b.items).toEqual([
      { key: 'knuth', label: '', text: 'D. E. Knuth, \\emph{The \\TeX book} (Addison-Wesley, 1984).' },
      { key: 'lamport', label: 'LL', text: 'L. Lamport, \\emph{LaTeX}, 2nd ed. (1994).' },
    ])
  })

  it('writes back what it read', () => {
    const b = parseTheBibliography(SRC)!
    expect(parseTheBibliography(writeTheBibliography(b))).toEqual(b)
  })

  it('formats a reference from the form', () => {
    const f = { authors: 'A. Smith and B. Jones', title: 'Thin films', source: 'Surf. Sci.',
      volume: '12', pages: '1-9', year: '2020', doi: 'https://doi.org/10.1000/x' }
    expect(formatReference(f)).toBe(
      'A. Smith and B. Jones, \\emph{Thin films}, Surf. Sci. \\textbf{12}, 1--9 (2020). \\url{https://doi.org/10.1000/x}')
    expect(suggestKey(f, ['smith2020'])).toBe('smith2020a')
  })
})
