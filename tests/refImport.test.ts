// References from Zotero and EndNote exports (RIS, .enw, EndNote XML) as
// BibTeX the document's reference list takes.
import { describe, expect, it } from 'vitest'
import { parseEntry, merge } from '../src/core/docReferences.ts'
import { splitBib } from '../src/core/kherveref.ts'
import {
  detectFormat, importToBibtex, parseEndnoteXml, parseEnw, parseRis, toBibtex,
} from '../src/core/refImport.ts'

const RIS = `TY  - JOUR
AU  - Smith, John
AU  - Doe, Jane A.
TI  - Decay of the muon & other particles
T2  - Physical Review Letters
PY  - 2020/05/01/
VL  - 12
IS  - 3
SP  - 100
EP  - 110
DO  - https://doi.org/10.1103/PhysRevLett.12.100
UR  - https://example.org/a_b
KW  - muons
KW  - decay
ER  -

TY  - BOOK
AU  - Knuth, Donald E.
TI  - The TeXbook
PB  - Addison-Wesley
CY  - Reading, MA
PY  - 1984
SN  - 0-201-13447-0
ER  -
`

const ENW = `%0 Journal Article
%A Smith, John
%A Doe, Jane
%T Decay of the muon
%J Physical Review Letters
%D 2020
%V 12
%N 3
%P 100-110
%R 10.1103/PhysRevLett.12.100

%0 Book Section
%A Brown, Alice
%E Green, Bob
%T A chapter
%B Collected works
%I Springer
%D 2018
%P 1-20
`

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<xml><records>
<record>
  <ref-type name="Journal Article">17</ref-type>
  <contributors><authors>
    <author><style face="normal" font="default" size="100%">Smith, John</style></author>
    <author><style face="normal" font="default" size="100%">Doe, Jane</style></author>
  </authors></contributors>
  <titles>
    <title><style face="normal" font="default" size="100%">Decay of the muon &amp; tau</style></title>
    <secondary-title><style face="normal" font="default" size="100%">Physical Review Letters</style></secondary-title>
  </titles>
  <pages><style face="normal" font="default" size="100%">100-110</style></pages>
  <volume><style face="normal" font="default" size="100%">12</style></volume>
  <number>3</number>
  <dates><year><style face="normal" font="default" size="100%">2020</style></year></dates>
  <electronic-resource-num><style face="normal" font="default" size="100%">10.1103/PhysRevLett.12.100</style></electronic-resource-num>
  <urls><related-urls><url><style face="normal" font="default" size="100%">https://example.org/x</style></url></related-urls></urls>
</record>
<record>
  <ref-type>32</ref-type>
  <contributors><authors><author>Martin, Paul</author></authors></contributors>
  <titles><title>A thesis</title></titles>
  <publisher>University of Leeds</publisher>
  <dates><year>2015</year></dates>
</record>
</records></xml>`

describe('detectFormat', () => {
  it('knows each export', () => {
    expect(detectFormat(RIS)).toBe('ris')
    expect(detectFormat(ENW)).toBe('enw')
    expect(detectFormat(XML)).toBe('endnote-xml')
    expect(detectFormat('@article{a, title={x}}')).toBe('bibtex')
    expect(detectFormat('hello', 'notes.doc')).toBe('unknown')
  })
})

describe('parseRis', () => {
  it('reads authors, fields and types', () => {
    const [a, b] = parseRis(RIS)
    expect(a.type).toBe('article')
    expect(a.authors).toEqual(['Smith, John', 'Doe, Jane A.'])
    expect(a.fields.journal).toBe('Physical Review Letters')
    expect(a.fields.year).toBe('2020')
    expect(a.fields.pages).toBe('100--110')
    expect(a.fields.doi).toBe('10.1103/PhysRevLett.12.100')
    expect(a.fields.keywords).toBe('muons, decay')
    expect(b.type).toBe('book')
    expect(b.fields.publisher).toBe('Addison-Wesley')
    expect(b.fields.address).toBe('Reading, MA')
    expect(b.fields.isbn).toBe('0-201-13447-0')
  })

  it('handles Windows line ends and a missing final ER', () => {
    const refs = parseRis('TY  - JOUR\r\nAU  - Lee, K\r\nTI  - Open ended\r\n')
    expect(refs).toHaveLength(1)
    expect(refs[0].fields.title).toBe('Open ended')
  })
})

describe('parseEnw', () => {
  it('reads references separated by blank lines', () => {
    const [a, b] = parseEnw(ENW)
    expect(a.type).toBe('article')
    expect(a.authors).toEqual(['Smith, John', 'Doe, Jane'])
    expect(a.fields.pages).toBe('100--110')
    expect(a.fields.doi).toBe('10.1103/PhysRevLett.12.100')
    expect(b.type).toBe('incollection')
    expect(b.fields.booktitle).toBe('Collected works')
    expect(b.editors).toEqual(['Green, Bob'])
    expect(b.fields.publisher).toBe('Springer')
  })
})

describe('parseEndnoteXml', () => {
  it('reads records through EndNote style runs and entities', () => {
    const [a, b] = parseEndnoteXml(XML)
    expect(a.type).toBe('article')
    expect(a.authors).toEqual(['Smith, John', 'Doe, Jane'])
    expect(a.fields.title).toBe('Decay of the muon & tau')
    expect(a.fields.journal).toBe('Physical Review Letters')
    expect(a.fields.number).toBe('3')
    expect(a.fields.url).toBe('https://example.org/x')
    expect(b.type).toBe('phdthesis')
    expect(b.fields.school).toBe('University of Leeds')
  })
})

describe('toBibtex', () => {
  it('writes entries with KherveRef keys and escaped text', () => {
    const bib = toBibtex(parseRis(RIS))
    const items = splitBib(bib)
    expect([...items.keys()]).toEqual(['smith2020decay', 'knuth1984texbook'])
    const [type, key, f] = parseEntry(items.get('smith2020decay')!)
    expect(type).toBe('article')
    expect(key).toBe('smith2020decay')
    expect(f.author).toBe('Smith, John and Doe, Jane A.')
    expect(f.title).toBe('Decay of the muon \\& other particles')
    expect(f.url).toBe('https://example.org/a_b')
  })

  it('turns "First Last" into "Last, First" and avoids taken keys', () => {
    const bib = toBibtex([{ type: 'misc', authors: ['Ada Lovelace'], editors: [], fields: { title: 'Notes', year: '1843' } }],
      ['lovelace1843notes'])
    const [, key, f] = parseEntry(bib)
    expect(key).toBe('lovelace1843notesa')
    expect(f.author).toBe('Lovelace, Ada')
  })

  it('the three exports give the same reference', () => {
    const key = (t: string) => [...splitBib(importToBibtex(t)).keys()][0]
    expect(key(RIS)).toBe('smith2020decay')
    expect(key(ENW)).toBe('smith2020decay')
    expect(key(XML)).toBe('smith2020decay')
  })

  it('merges into the document list', () => {
    const [text, added] = merge('', importToBibtex(ENW))
    expect(added).toEqual(['smith2020decay', 'brown2018chapter'])
    expect(text).toContain('editor')
  })
})

describe('importToBibtex', () => {
  it('passes a .bib through and refuses other text', () => {
    const bib = '@article{k, title={T}}'
    expect(importToBibtex(bib, 'x.bib')).toBe(bib)
    expect(() => importToBibtex('just words', 'x.doc')).toThrow(/BibTeX/)
  })
})
