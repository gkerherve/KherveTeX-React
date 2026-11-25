// Design tab in book and thesis classes and in projects: what the PDF needs
// for the page's chapter titles, title page and watermark to show.
import { describe, expect, it } from 'vitest'
import { designPreamble } from '../src/core/design.ts'
import { chapterEntry, document, docMeta, paragraph, project, section, text } from '../src/core/model.ts'
import { serializeProjectMaster } from '../src/core/serializer.ts'

const D = { chapter_style: 'bignumber', title_style: 'band', watermark: 'DRAFT' } as never

describe('designs in the PDF', () => {
  it('draws the title page band without remember picture (one LaTeX pass shows it)', () => {
    const p = designPreamble(D, 'report')
    expect(p).not.toContain('remember picture')
    expect(p).toContain('\\AddToHookNext{shipout/background}')
  })

  it('gives KOMA and hepthesis sections a titlesec format', () => {
    for (const cls of ['scrbook', 'scrreprt', 'hepthesis']) {
      const p = designPreamble(D, cls)
      expect(p).toMatch(/\\titleformat\{\\section\}/)
      expect(p).toMatch(/\\titleformat\{\\subsection\}/)
    }
    expect(designPreamble(D, 'book')).not.toMatch(/\\titleformat\{\\section\}/)
  })

  it('provides memoir a titlepage and amsbook its \\@secnumpunct', () => {
    expect(designPreamble(D, 'memoir')).toContain('\\@ifundefined{titlepage}')
    expect(designPreamble(D, 'amsbook')).toContain('\\providecommand{\\@secnumpunct}')
  })

  it('puts a project document\'s design in the project master', () => {
    const proj = project({ meta: docMeta({ documentclass: 'report' }), chapters: [chapterEntry({ path: 'a.ktex' })] } as never)
    const doc = document([section(1, [text('Intro')]), paragraph([text('x')])], docMeta({ documentclass: 'report', design: D }))
    const master = serializeProjectMaster(proj, [doc])
    expect(master).toContain('DRAFT')
    expect(master).toMatch(/\\titleformat\{\\chapter\}/)
  })
})
