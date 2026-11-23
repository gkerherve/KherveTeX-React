import { describe, expect, test } from 'vitest'
import { importTex } from '../src/core/importers.ts'
import { adoptLibrary, texBibliography } from '../src/core/texBibliography.ts'
import { conflicts, merge, preambleDefinitions } from '../src/core/docReferences.ts'
import { texToPlain } from '../src/core/texPlain.ts'
import { serializeDocument } from '../src/core/serializer.ts'

const NATBIB = '\\documentclass{article}\n\\usepackage{natbib}\n\\begin{document}\nText \\citep{a}.\n\\bibliographystyle{abbrvnat}\n\\bibliography{refs,more.bib}\n\\end{document}\n'
const BIBLATEX = '\\documentclass{article}\n\\usepackage{biblatex}\n\\addbibresource{refs.bib}\n\\addbibresource{more.bib}\n\\begin{document}\nText \\parencite{a}.\n\\printbibliography\n\\end{document}\n'

describe('a .tex and its .bib files', () => {
  test('natbib: the files and style are found, kTeX writes the bibliography', () => {
    const doc = importTex(NATBIB)
    const found = texBibliography(doc)!
    expect(found).toEqual({ files: ['refs.bib', 'more.bib'], style: 'abbrvnat', biblatex: false })
    const adopted = adoptLibrary(doc, found)
    expect(adopted.meta.ref_library).toBe('document')
    expect(adopted.meta.bib_style).toBe('abbrvnat')
    const tex = serializeDocument(adopted)
    expect(tex).toContain('\\bibliography{kherveref}')
    expect(tex).not.toContain('refs,more')
    expect(tex.match(/\\bibliographystyle/g)).toHaveLength(1)
  })
  test('biblatex keeps biblatex, pointed at the library', () => {
    const doc = importTex(BIBLATEX)
    const found = texBibliography(doc)!
    expect(found.files).toEqual(['refs.bib', 'more.bib'])
    const tex = serializeDocument(adoptLibrary(doc, found))
    expect(tex.match(/\\addbibresource\{[^}]*\}/g)).toEqual(['\\addbibresource{kherveref.bib}'])
    expect(tex).toContain('\\printbibliography')
  })
  test('no bibliography: nothing to do', () => {
    expect(texBibliography(importTex('\\documentclass{article}\\begin{document}Hi\\end{document}'))).toBeNull()
  })
})

describe('merging .bib files', () => {
  test('@preamble is kept, a different reference under a known key is reported', () => {
    const a = '@preamble{"\\newcommand{\\noopsort}[1]{} (x)"}\n@article{k, title={One}, year={2020}}'
    const [text] = merge('', a)
    expect(preambleDefinitions(text)).toHaveLength(1)
    expect(conflicts(text, '@article{k, title={Two}, year={2021}}')).toEqual(['k'])
    expect(conflicts(text, '@article{k,  title = {One}, year = {2020}}')).toEqual([])
  })
})

describe('library text as read', () => {
  test.each([
    ['M{\\"u}ller and \\\'{E}tienne', 'Müller and Étienne'],
    ['{XPS} of {TiO$_2$}: a {\\it study}', 'XPS of TiO₂: a study'],
    ['Stra{\\ss}e, \\AA{}ngstr{\\"o}m', 'Straße, Ångström'],
    ['10--20, R\\&D', '10–20, R&D'],
    ['m$^{2}$ g$^{-1}$', 'm² g⁻¹'],
  ])('%s', (tex, plain) => expect(texToPlain(tex)).toBe(plain))
})
