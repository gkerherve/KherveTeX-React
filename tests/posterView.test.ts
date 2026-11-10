// Posters in the page view (src/editor/posterView.ts): paper, columns,
// sizes and colours as their PDFs print them.
import { describe, expect, it } from 'vitest'
import { docMeta, document, paragraph, rawLatex, text } from '../src/core/model.ts'
import { docToPM } from '../src/editor/convert.ts'
import { lookFor } from '../src/editor/classLooks.ts'
import { posterBackground, posterLook, xcolor } from '../src/editor/posterView.ts'
import { latexToHtml } from '../src/editor/cvView.ts'

describe('poster page view', () => {
  it('mixes xcolor expressions', () => {
    expect(xcolor('blue!20')).toBe('#ccccff')
    expect(xcolor('blue!4')).toBe('#f5f5ff')
    expect(xcolor('blue!55!black')).toBe('#00008c')
    expect(xcolor('nosuchcolour')).toBeNull()
  })

  it('lays a tikzposter out on its paper in its columns', () => {
    const meta = docMeta({ documentclass: 'tikzposter', class_options: 'a1paper,portrait,25pt',
      preamble_extras: '\\usecolorstyle[colorTwo=blue!20]{Default}\n\\colorlet{backgroundcolor}{blue!4}' })
    const doc = docToPM(document([rawLatex('\\begin{columns}\n\\column{0.5}'), paragraph([text('a')]),
      rawLatex('\\column{0.5}'), paragraph([text('b')]), rawLatex('\\end{columns}')], meta))
    const g = posterLook(lookFor('tikzposter', 12), meta, doc).geometry
    expect([g.page_w, g.page_h, g.cols, g.left]).toEqual([1683.78, 2383.94, 2, 42.5])
    expect(posterBackground(meta)).toBe('#f5f5ff')
  })

  it('sets an a0poster in multicols at the size it switches to', () => {
    const meta = docMeta({ documentclass: 'a0poster', class_options: 'a0,portrait',
      preamble_extras: '\\setlength{\\columnsep}{2cm}\n\\renewcommand\\section{\\@startsection{section}{1}{0pt}{-1ex}{0.6ex}{\\normalfont\\VeryHuge\\bfseries}}' })
    const doc = docToPM(document([rawLatex('\\begin{multicols}{2}\n\\veryHuge\\raggedright'), paragraph([text('a')]),
      rawLatex('\\end{multicols}')], meta))
    const look = posterLook(lookFor('a0poster', 12), meta, doc)
    expect([look.geometry.page_w, look.geometry.page_h, look.geometry.cols]).toEqual([2383.94, 3370.39, 2])
    expect(look.geometry.colsep).toBeCloseTo(56.9, 1)
    expect(look.body.size).toBe(74.02)
    expect((look as unknown as { h1: { size: number } }).h1.size).toBe(88.83)
  })

  it('draws simple inline maths', () => {
    expect(latexToHtml('TiO$_2$ and $T$ ($^\\circ$C)', '#000')).toBe('TiO<sub>2</sub> and <i>T</i> (<sup>°</sup>C)')
  })
})
