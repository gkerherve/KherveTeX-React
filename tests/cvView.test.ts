// A moderncv CV in the page view (src/editor/cvView.ts): its LaTeX as the
// HTML the page draws, and its look in Latin Modern Sans.
import { describe, expect, it } from 'vitest'
import { docMeta } from '../src/core/model.ts'
import { lookFor } from '../src/editor/classLooks.ts'
import { cvColor, latexToHtml, moderncvLook } from '../src/editor/cvView.ts'

describe('moderncv page view', () => {
  it('draws the inline LaTeX of an entry', () => {
    expect(latexToHtml('Thesis: \\emph{Topological phases}. Prof.~M.~Topologist', '#000'))
      .toBe('Thesis: <i>Topological phases</i>. Prof.\u00a0M.\u00a0Topologist')
    expect(latexToHtml("``Raman signatures,'' \\textbf{21}, 4532--4539", '#000'))
      .toBe('“Raman signatures,” <b>21</b>, 4532–4539')
    expect(latexToHtml("moir\\'e, \\pounds350\\,k, Phys.\\ Rev.", '#000')).toBe('moiré, £350\u2009k, Phys. Rev.')
  })

  it('draws an itemize as a list with the style colour', () => {
    const html = latexToHtml('\\begin{itemize}\\item One.\\item Two.\\end{itemize}', '#3873b3')
    expect(html).toBe('<ul class="kt-cv-list" style="--kt-cv-bullet:#3873b3"><li>One.</li><li>Two.</li></ul>')
  })

  it('sets moderncv in sans, its titles in the style colour', () => {
    const meta = docMeta({ documentclass: 'moderncv', class_options: '11pt,a4paper,sans',
      preamble_extras: '\\moderncvstyle{classic}\n\\moderncvcolor{blue}' })
    const look = moderncvLook(lookFor('moderncv', 11), meta)
    expect(look.body.font).toBe('LMSans10-Regular')
    expect((look as unknown as Record<string, { font: string; color: string }>).h1).toMatchObject({ font: 'LMSans12-Regular', color: '#3873b3' })
    expect(cvColor({ ...meta, preamble_extras: '\\moderncvcolor{green}' })).toBe('#59b34d')
    // [roman] keeps the roman fonts; another class is left as it is.
    expect(moderncvLook(lookFor('moderncv', 11), { ...meta, class_options: 'roman' }).body.font).toBe('LMRoman10-Regular')
    expect(moderncvLook(lookFor('article', 11), docMeta({ documentclass: 'article' }))).toEqual(lookFor('article', 11))
  })
})
