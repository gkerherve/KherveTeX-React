// The logic of References ▸ Manage references (khervedoc/
// reference_manager.py, ReferenceManager without its widgets): the
// document's own list of references.
//
// A small KherveRef dedicated to one document: its .bib, kept inside the
// .ktex (core/docReferences.ts). A search bar and a filter find any
// reference, and what is missing: keys the document cites that the list
// does not have, listed in red at the end. Selecting one fills the form;
// New, Delete, Import .bib… and From KherveRef… change the list; Cite
// inserts the selected references at the caret. Nothing is saved until
// Done; Cancel leaves the list as it was.
import * as dr from '../core/docReferences.ts'
import type { RefRow } from '../core/docReferences.ts'

// The list's filter.
export const FILTERS: [string, string][] = [
  ['all', 'All references'], ['cited', 'Cited in the document'],
  ['not cited', 'Not cited'], ['missing', 'Missing (cited, not in the list)'],
]

// The form's fields and their labels.
export const LABELS: Record<string, string> = {
  author: 'Authors', title: 'Title', journal: 'Journal', booktitle: 'Book / proceedings',
  year: 'Year', volume: 'Volume', number: 'Number', pages: 'Pages', publisher: 'Publisher',
  school: 'School', institution: 'Institution', doi: 'DOI', url: 'URL', note: 'Note',
}

export function summary(rows: RefRow[]): string {
  const n = rows.filter(r => r.status !== dr.MISSING).length
  const cited = rows.filter(r => r.status === dr.CITED).length
  const missing = rows.filter(r => r.status === dr.MISSING).length
  let text = `${n} reference${n !== 1 ? 's' : ''} · ${cited} cited`
  if (missing) text += ` · ${missing} missing`
  return text
}

const emptyForm = (): Record<string, string> => Object.fromEntries(dr.FIELDS.map(f => [f, '']))

export class ReferenceManagerModel {
  private textNow: string
  private readonly original: string
  readonly cited: string[]
  query = ''
  filter = 'all'
  shown: RefRow[] = []
  summaryText = ''
  selected: string[] = []
  // The form: the entry's type, key and fields; the key it has in the
  // list (null for a new one or a missing key); whether it was changed.
  type = 'article'
  key = ''
  fields: Record<string, string> = emptyForm()
  private extra: Record<string, string> = {}
  private editing: string | null = null
  formDirty = false
  private citeKeys: string[] = []
  private serial = 0
  private listeners = new Set<() => void>()

  constructor(bibText: string, cited: string[]) {
    this.textNow = bibText
    this.original = bibText
    this.cited = [...cited]
    this.fill()
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }

  version = (): number => this.serial

  private changedNow(): void {
    this.serial += 1
    for (const l of this.listeners) l()
  }

  // The list as it is now (.bib source).
  text(): string { return this.textNow }
  changed(): boolean { return this.textNow !== this.original }
  citeSelection(): string[] { return [...this.citeKeys] }
  rows(): RefRow[] { return [...this.shown] }

  private fill(): void {
    const all = dr.rows(this.textNow, this.cited)
    this.shown = all.filter(r => (this.filter === 'all' || r.status === this.filter) && dr.matches(r, this.query))
    const keys = new Set(this.shown.map(r => r.key))
    this.selected = this.selected.filter(k => keys.has(k))
    this.summaryText = summary(all)
  }

  setQuery(q: string): void { this.query = q; this.fill(); this.changedNow() }
  setFilter(f: string): void { this.filter = f; this.fill(); this.changedNow() }

  // Select rows (a click: one key; Ctrl/Shift: several). Moving on keeps
  // the entry left in the form.
  setSelection(keys: string[]): void {
    if (this.formDirty) {
      this.saveEntry(false)
      this.fill()
    }
    this.selected = keys
    if (keys.length !== 1) {
      this.clearForm()
    } else {
      const key = keys[0]
      const src = dr.entries(this.textNow).get(key)
      if (src === undefined) {
        // A missing key: a new entry with that key.
        this.clearForm()
        this.key = key
      } else {
        const [etype, , fields] = dr.parseEntry(src)
        this.editing = key
        this.type = etype
        this.key = key
        this.fields = Object.fromEntries(dr.FIELDS.map(f => [f, fields[f] ?? '']))
        this.extra = Object.fromEntries(Object.entries(fields).filter(([f]) => !dr.FIELDS.includes(f)))
        this.formDirty = false
      }
    }
    this.changedNow()
  }

  select(key: string): void { this.setSelection([key]) }

  private clearForm(): void {
    this.editing = null
    this.extra = {}
    this.type = 'article'
    this.key = ''
    this.fields = emptyForm()
    this.formDirty = false
  }

  // Type into a field of the form (as the user does).
  setField(name: string, value: string): void {
    if (name === 'key') this.key = value
    else if (name === 'type') this.type = value
    else this.fields = { ...this.fields, [name]: value }
    this.formDirty = true
    this.changedNow()
  }

  newEntry(): void {
    if (this.formDirty) this.saveEntry(false)
    this.selected = []
    this.clearForm()
    this.fill()
    this.changedNow()
  }

  // Put the form's entry in the list; its key (made from the author, year
  // and title when left empty), null when the form is empty.
  saveEntry(refill = true): string | null {
    const fields: Record<string, string> = Object.fromEntries(dr.FIELDS.map(f => [f, (this.fields[f] ?? '').trim()]))
    if (!Object.values(fields).some(v => v) && !this.key.trim()) {
      this.formDirty = false
      return null
    }
    Object.assign(fields, this.extra)
    const taken = new Set(dr.entries(this.textNow).keys())
    if (this.editing !== null) taken.delete(this.editing)
    let key = this.key.trim().replace(/ /g, '')
    if (!key) key = dr.suggestKey(fields.author, fields.year, fields.title, taken)
    const etype = this.type.trim().toLowerCase() || 'misc'
    this.textNow = dr.setEntry(this.textNow, this.editing, dr.formatEntry(etype, key, fields))
    this.editing = key
    this.key = key
    this.formDirty = false
    if (refill) {
      this.selected = [key]
      this.fill()
      this.changedNow()
    }
    return key
  }

  deleteSelected(): void {
    const have = dr.entries(this.textNow)
    for (const k of this.selected.filter(k => have.has(k))) this.textNow = dr.removeEntry(this.textNow, k)
    this.selected = []
    this.clearForm()
    this.fill()
    this.changedNow()
  }

  // Add the entries of a .bib the list lacks; the keys added.
  addBib(other: string): string[] {
    const [text, added] = dr.merge(this.textNow, other)
    this.textNow = text
    this.fill()
    this.changedNow()
    return added
  }

  // Cite: the selected keys (a missing key is cited already; citing it
  // again is harmless). False when nothing is selected.
  citeSelected(): boolean {
    if (this.formDirty) this.saveEntry()
    if (!this.selected.length) return false
    this.citeKeys = [...this.selected]
    return true
  }

  // Done: the form's entry is kept.
  done(): void {
    if (this.formDirty) this.saveEntry(false)
  }
}
