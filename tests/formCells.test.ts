import { describe, expect, it } from 'vitest'
import { cellDisplayText, cellLook } from '../src/editor/convert.ts'
import { columnFractions } from '../src/editor/views.ts'

// A Word form's cells (docxImport _importFormTable) as the editor shows them.
describe('form table cells in the editor', () => {
  it('shows the text, not the LaTeX of its look', () => {
    expect(cellDisplayText('\\footnotesize \\textcolor[HTML]{000080}{Name:} Gwilherm Kerherve')).toBe('Name: Gwilherm Kerherve')
    expect(cellDisplayText('\\small \\textcolor[HTML]{FFFFFF}{\\textbf{PERSON}}')).toBe('PERSON')
    expect(cellDisplayText('\\centering\\arraybackslash $\\boxtimes$')).toBe('☒')
    expect(cellDisplayText('Yes $\\square$ \\par No $\\boxtimes$')).toBe('Yes ☐\nNo ☒')
    expect(cellDisplayText('\\textbullet~\\textcolor[HTML]{000080}{Open}')).toBe('• Open')
  })
  it('gives the cell its colour, size and alignment', () => {
    const css = cellLook('\\centering\\arraybackslash \\footnotesize \\textcolor[HTML]{FFFFFF}{X}')
    expect(css).toContain('color:#FFFFFF')
    expect(css).toContain('text-align:center')
    expect(css).toContain('font-size:0.8em')
    expect(cellLook('\\footnotesize \\textcolor[HTML]{000080}{X}')).toContain('font-size:0.8em')
  })
  it('reads the form column widths', () => {
    expect(columnFractions('p{\\dimexpr0.3612\\linewidth-2\\tabcolsep\\relax}p{\\dimexpr0.6388\\linewidth-2\\tabcolsep\\relax}'))
      .toEqual([0.3612, 0.6388])
  })
})
