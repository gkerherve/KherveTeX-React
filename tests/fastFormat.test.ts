import { describe, expect, it } from 'vitest'
import { formatName, formatSource, preloadList } from '../src/core/fastFormat.ts'

describe('Fast LaTeX format', () => {
  it('preloads only safe packages loaded without options', () => {
    const tex = '\\documentclass{article}\n\\usepackage{tikz}\n\\usepackage[margin=2cm]{geometry}\n\\usepackage{amsmath,amssymb}\n\\usepackage[version=4]{mhchem}\n\\begin{document}x\\end{document}'
    expect(preloadList(tex)).toEqual(['amsmath', 'amssymb', 'tikz'])
  })
  it('leaves out packages that load xcolor when xcolor has options', () => {
    const tex = '\\documentclass{article}\\usepackage[table]{xcolor}\\usepackage{tikz}\\usepackage{booktabs}\\begin{document}\\end{document}'
    expect(preloadList(tex)).toEqual(['booktabs'])
  })
  it('names the format by its packages and saves it with no OpenType font', () => {
    expect(formatName(['tikz'])).toBe(formatName(['tikz']))
    expect(formatName(['tikz'])).not.toBe(formatName(['amsmath']))
    expect(formatSource(['tikz'])).toContain('\\fontencoding{OT1}')
  })
})

import { draftImages } from '../src/core/compiler.ts'
describe('draft pictures while typing', () => {
  it('switches graphicx to draft after \\begin{document}', () => {
    const t = draftImages('\\documentclass{article}\\usepackage{graphicx}\\begin{document}\\includegraphics[width=3cm]{a.png}\\end{document}')
    expect(t).toContain('\\begin{document}\\makeatletter\\@ifpackageloaded{graphicx}{\\setkeys{Gin}{draft=true}}{}\\makeatother')
  })
  it('leaves a document without pictures alone', () => {
    const t = '\\documentclass{article}\\begin{document}x\\end{document}'
    expect(draftImages(t)).toBe(t)
  })
})
