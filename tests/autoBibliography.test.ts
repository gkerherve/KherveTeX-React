// The reference list the page view draws where LaTeX writes one
// (\bibliography{kherveref}), and citations in the style the PDF prints.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { authorList, autoBibliography, citeMode, texText } from '../src/core/autoBibliography.ts'
import { ReferenceResolver } from '../src/core/references.ts'

const BIB = `@article{cali2023,
  author = {Cal{\\\`\\i}, Eleonora and Saini, Shailza and Kerherve, Gwilherm and Skinner, William S. and Metcalfe, Ian S. and Payne, David J. and Kousi, Kalliopi},
  title = {Enhanced stability of iridium nanocatalysts via exsolution for the {CO2} reforming of methane},
  journal = {ACS Applied Nano Materials},
  volume = {7}, number = {16}, pages = {18398--18409}, month = dec, year = {2023},
  issn = {2574-0970}, doi = {10.1021/acsanm.3c04126}
}
@book{adams1990,
  author = {Adams, Ann},
  title = {Isotopes},
  publisher = {Wiley}, year = {1990}
}
`

const doc = (style = '', keys = ['cali2023']) => M.document(
  [M.paragraph([M.text('See '), M.citation(keys), M.text(' and '), M.citation(['adams1990'], 'citep'), M.text('.')])],
  M.docMeta({ ref_library: 'document', bib_style: style }))

describe('the reference list LaTeX writes', () => {
  it('reads TeX in .bib fields', () => {
    expect(texText('Cal{\\`\\i}')).toBe('Calì')
    expect(texText('{CO2} reforming --- \\& more')).toBe('CO2 reforming — & more')
    expect(authorList('Cal{\\`\\i}, Eleonora and Saini, Shailza and Kerherve, Gwilherm', false))
      .toBe('Eleonora Calì, Shailza Saini, and Gwilherm Kerherve')
    expect(authorList('Doe, John Paul and Roe, Ann', true)).toBe('J. P. Doe and A. Roe')
  })
  it('plainnat: sorted by author, written as the PDF has it', () => {
    const bib = autoBibliography(doc(), BIB)!
    expect(bib.items.map(i => i.key)).toEqual(['adams1990', 'cali2023'])
    expect(bib.items[0].label).toBe('')
    const text = bib.items[1].runs.map(r => r.text).join('')
    expect(text).toBe('Eleonora Calì, Shailza Saini, Gwilherm Kerherve, William S. Skinner, Ian S. Metcalfe, '
      + 'David J. Payne, and Kalliopi Kousi. Enhanced stability of iridium nanocatalysts via exsolution for the '
      + 'CO2 reforming of methane. ACS Applied Nano Materials, 7(16):18398–18409, dec 2023. ISSN 2574-0970. '
      + 'doi: 10.1021/acsanm.3c04126.')
    expect(bib.items[1].runs.find(r => r.italic)?.text).toBe('ACS Applied Nano Materials')
    expect(bib.items[0].runs.map(r => r.text).join('')).toBe('Ann Adams. Isotopes. Wiley, 1990.')
  })
  it('citations print author-year with plainnat, as natbib does', () => {
    const d = doc()
    const r = new ReferenceResolver(d, null, BIB)
    r.citeMode = citeMode(d)
    expect(r.citeText(['cali2023'], 'cite')).toBe('Calì et al. [2023]')
    expect(r.citeText(['adams1990'], 'citep')).toBe('[Adams, 1990]')
  })
  it('numeric styles number in the list order', () => {
    const d = doc('plain')
    const bib = autoBibliography(d, BIB)!
    expect(bib.items.map(i => i.label)).toEqual(['[1]', '[2]'])
    const r = new ReferenceResolver(d, null, BIB)
    r.citeMode = citeMode(d)
    r.listNumbers = bib.numbers
    // Cited first, but listed second: it is [2], as in the PDF.
    expect(r.citeText(['cali2023'])).toBe('[2]')
    expect(autoBibliography(doc('unsrt'), BIB)!.items.map(i => i.key)).toEqual(['cali2023', 'adams1990'])
  })
  it('no list when the document has its own or no references', () => {
    expect(autoBibliography(M.document(doc().children, M.docMeta()), BIB)).toBe(null)
    const own = M.document([...doc().children, M.rawLatex('\\begin{thebibliography}{9}\\end{thebibliography}')],
      M.docMeta({ ref_library: 'document' }))
    expect(autoBibliography(own, BIB)).toBe(null)
    expect(citeMode(M.document(doc().children, M.docMeta()))).toBe(null)
  })
})
