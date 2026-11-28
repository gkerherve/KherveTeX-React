import { describe, expect, it } from 'vitest'
import { formatName, formatSource, preloadList } from '../src/core/fastFormat.ts'

describe('Fast LaTeX format', () => {
  it('preloads only safe packages loaded without options', () => {
    const tex = '\\documentclass{article}\n\\usepackage{tikz}\n\\usepackage[margin=2cm]{geometry}\n\\usepackage{amsmath,amssymb}\n\\usepackage[version=4]{mhchem}\n\\begin{document}x\\end{document}'
    expect(preloadList(tex)).toEqual(['amsmath', 'amssymb', 'tikz'])
  })
  it('leaves out packages that load xcolor when xcolor has options', () => {
    const tex = '\\documentclass{article}\\usepackage[table]{xcolor}\\usepackage{tikz}\\usepackage{siunitx}\\begin{document}\\end{document}'
    expect(preloadList(tex)).toEqual(['siunitx'])
  })
  it('never preloads booktabs (its rule sizes depend on the class fonts)', () => {
    const tex = '\\documentclass{article}\\usepackage{amsmath}\\usepackage{booktabs}\\begin{document}\\end{document}'
    expect(preloadList(tex)).toEqual(['amsmath'])
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

import { proxyImages } from '../src/core/compiler.ts'
describe('tiny pictures while typing', () => {
  const host = { stat: async () => ({ isDir: false, isFile: true, mtime: 1, size: 10 }) }
  it('swaps sized pictures for their tiny copy and frames unsized ones', async () => {
    const t = await proxyImages('\\includegraphics[width=3cm]{/a/x.png} \\includegraphics{/a/y.jpg} \\includegraphics[width=2cm]{/a/z.pdf}',
      async p => p.replace('/a/', '/tiny/'), host, true)
    expect(t).toBe('\\includegraphics[width=3cm]{/tiny/x.png} \\includegraphics[draft]{/a/y.jpg} \\includegraphics[width=2cm]{/a/z.pdf}')
  })
  it('frames a picture whose copy is not ready yet', async () => {
    const t = await proxyImages('\\includegraphics[width=3cm]{/a/x.png}', () => new Promise(r => setTimeout(() => r('/t.jpg'), 200)), host, true)
    expect(t).toBe('\\includegraphics[draft,width=3cm]{/a/x.png}')
  })
})
