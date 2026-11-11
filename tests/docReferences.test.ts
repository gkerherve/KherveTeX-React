// Ports tests/test_document_references.py: References ▸ Manage
// references, the document's own .bib, kept in the .ktex, searched,
// edited, imported into and cited from, with the cited keys it lacks
// listed as missing.
import { describe, expect, it } from 'vitest'
import * as dr from '../src/core/docReferences.ts'
import * as kr from '../src/core/kherveref.ts'
import type { RefFileAccess } from '../src/core/kherveref.ts'
import * as M from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { ReferenceManagerModel } from '../src/app/referenceManager.ts'

const BIB = `@article{smith2020decay,
  author = {Smith, John and Doe, Anne},
  title  = {Radioactive {Decay} Revisited},
  journal = {Phys. Rev.},
  year   = {2020},
  pages  = "1--10",
  keywords = {nuclear}
}

@book{roe2018,
  author = {Roe, Bob},
  title = {Isotopes},
  year = 2018,
  publisher = {Wiley}
}
`

const noFiles: RefFileAccess = {
  exists: async () => false,
  read: async () => { throw new Error('none') },
  write: async () => {},
  listDir: async () => [],
  isFile: async () => false,
}

const doc = (...keys: string[]) => M.document([M.paragraph([M.text('See '), M.citation(keys), M.text('.')])],
  M.docMeta({ ref_library: dr.DOCUMENT_LIBRARY }))

describe('test_document_references', () => {
  it('test_parse_entry_reads_every_field', () => {
    const [etype, key, fields] = dr.parseEntry(dr.entries(BIB).get('smith2020decay')!)
    expect([etype, key]).toEqual(['article', 'smith2020decay'])
    expect(fields.title).toBe('Radioactive {Decay} Revisited')
    expect(fields.pages).toBe('1--10')
    expect(fields.keywords).toBe('nuclear')
    expect(dr.parseEntry(dr.entries(BIB).get('roe2018')!)[2].year).toBe('2018')
  })
  it('test_format_entry_round_trips', () => {
    const [etype, key, fields] = dr.parseEntry(dr.entries(BIB).get('smith2020decay')!)
    expect(dr.parseEntry(dr.formatEntry(etype, key, fields))).toEqual([etype, key, fields])
  })
  it('test_suggest_key', () => {
    expect(dr.suggestKey('Müller, Jürgen', '2021', 'The Half-life of Tritium', new Set())).toBe('muller2021half')
    expect(dr.suggestKey('Smith, John', '2020', 'Decay', new Set(['smith2020decay']))).toBe('smith2020decaya')
    expect(dr.suggestKey('', '', '', new Set())).toBe('ref')
  })
  it('test_rows_show_cited_not_cited_and_missing', () => {
    const rows = dr.rows(BIB, ['roe2018', 'ghost2001'])
    expect(rows.map(r => [r.key, r.status])).toEqual([
      ['smith2020decay', dr.NOT_CITED], ['roe2018', dr.CITED], ['ghost2001', dr.MISSING]])
    expect(dr.matches(rows[0], 'decay 2020')).toBe(true)
    expect(dr.matches(rows[0], 'decay 2019')).toBe(false)
  })
  it('test_merge_set_and_remove', () => {
    let [text, added] = dr.merge('', BIB)
    expect(added).toEqual(['smith2020decay', 'roe2018'])
    ;[text, added] = dr.merge(text, BIB)
    expect(added).toEqual([])
    text = dr.setEntry(text, 'roe2018', dr.formatEntry('misc', 'roe2018b', { title: 'Notes' }))
    expect([...dr.entries(text).keys()]).toEqual(['smith2020decay', 'roe2018b'])
    text = dr.removeEntry(text, 'smith2020decay')
    expect([...dr.entries(text).keys()]).toEqual(['roe2018b'])
    expect(dr.removeEntry(text, 'roe2018b')).toBe('')
  })
  it('test_own_list_is_kept_whole', async () => {
    expect(await kr.bibliographyFor(doc('roe2018', 'ghost2001'), noFiles, BIB)).toEqual([BIB, ['ghost2001']])
    expect(await kr.bibliographyFor(doc(), noFiles, BIB)).toEqual([BIB, []])
  })
  it('test_document_with_own_list_compiles_its_bibliography', () => {
    expect(serializeDocument(doc('roe2018'))).toContain('\\bibliography{kherveref}')
  })
})

const manager = (text = BIB, cited = ['roe2018', 'ghost2001']) => new ReferenceManagerModel(text, cited)
const keys = (m: ReferenceManagerModel) => m.rows().map(r => r.key)

describe('test_document_references (the dialog)', () => {
  it('test_search_and_filter', () => {
    const m = manager()
    expect(keys(m)).toEqual(['smith2020decay', 'roe2018', 'ghost2001'])
    expect(m.summaryText).toBe('2 references · 1 cited · 1 missing')
    m.setQuery('wiley')
    expect(keys(m)).toEqual([])
    m.setQuery('isotopes')
    expect(keys(m)).toEqual(['roe2018'])
    m.setQuery('')
    m.setFilter('missing')
    expect(keys(m)).toEqual(['ghost2001'])
    m.setFilter('not cited')
    expect(keys(m)).toEqual(['smith2020decay'])
  })
  it('test_add_a_missing_reference', () => {
    const m = manager()
    m.select('ghost2001')
    expect(m.key).toBe('ghost2001')
    m.setField('author', 'Ghost, Casper')
    m.setField('title', 'Haunting')
    m.setField('year', '2001')
    m.saveEntry()
    expect(dr.entries(m.text()).has('ghost2001')).toBe(true)
    expect(m.summaryText).toBe('3 references · 2 cited')
    expect(m.changed()).toBe(true)
  })
  it('test_new_entry_gets_a_key', () => {
    const m = manager('', [])
    m.newEntry()
    m.setField('author', 'Curie, Marie')
    m.setField('title', 'Radioactive substances')
    m.setField('year', '1904')
    expect(m.saveEntry()).toBe('curie1904radioactive')
    expect(dr.parseEntry(dr.entries(m.text()).get('curie1904radioactive')!)[2].author).toBe('Curie, Marie')
  })
  it('test_edit_keeps_other_fields', () => {
    const m = manager()
    m.select('smith2020decay')
    m.setField('year', '2021')
    m.select('roe2018')
    const f = dr.parseEntry(dr.entries(m.text()).get('smith2020decay')!)[2]
    expect(f.year).toBe('2021')
    expect(f.keywords).toBe('nuclear')
    expect(keys(m)[1]).toBe('roe2018')
  })
  it('test_delete_import_and_cite', () => {
    const m = manager()
    m.select('smith2020decay')
    m.deleteSelected()
    expect([...dr.entries(m.text()).keys()]).toEqual(['roe2018'])
    expect(m.addBib(BIB)).toEqual(['smith2020decay'])
    m.select('roe2018')
    expect(m.citeSelected()).toBe(true)
    expect(m.citeSelection()).toEqual(['roe2018'])
  })
})
