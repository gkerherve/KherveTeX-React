// References ▸ Manage references: the document's own list of references
// (khervedoc/reference_manager.py). Its logic is ReferenceManagerModel in
// src/app/referenceManager.ts; this is only the widgets.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BIB_STYLES } from '../../core/autoBibliography'
import type { MouseEvent } from 'react'
import { ENTRY_TYPES, FIELDS, MISSING, CITED } from '../../core/docReferences'
import { shortAuthor } from '../../core/references'
import { FILTERS, LABELS, ReferenceManagerModel } from '../../app/referenceManager'
import { importToBibtex } from '../../core/refImport'
import { splitBib } from '../../core/kherveref'
import { conflicts } from '../../core/docReferences'
import { texToPlain } from '../../core/texPlain'
import { openDialog, type Close } from './dialogHost'

export interface ReferenceChoice {
  text: string
  changed: boolean
  cite: string[]
  // The bibliography style chosen (DocMeta.bib_style).
  style: string
}

export type ImportKind = 'file' | 'endnote' | 'mendeley'

export interface ReferenceEnv {
  // Import file…: a reference export's name and text (a .bib, RIS,
  // EndNote .enw or EndNote XML; *kind* says which program it comes
  // from, for the file dialog's filters and help), or null.
  importFile: (kind: ImportKind) => Promise<{ name: string; text: string } | null>
  // From Zotero…: the .bib source of references taken from Zotero, or null.
  fromZotero: () => Promise<string | null>
  // From KherveRef…: the .bib source of references picked in a library.
  fromKherveRef: () => Promise<string | null>
  // A note shown above the list (a document citing from a library).
  note: string
  // A message box.
  inform: (title: string, text: string) => Promise<void>
  // The document's bibliography style ('' for the default).
  style: string
  // An import to start as the dialog opens (the ribbon's Import buttons).
  start?: 'zotero' | 'kherveref' | ImportKind
}

function Manager({ m, env, close }: { m: ReferenceManagerModel; env: ReferenceEnv; close: Close<ReferenceChoice> }) {
  useSyncExternalStore(m.subscribe, m.version)
  const anchor = useRef(0)
  const [style, setStyle] = useState(env.style || BIB_STYLES[0][0])
  const rows = m.rows()
  const finish = (cite: string[]) => {
    m.done()
    close({ text: m.text(), changed: m.changed(), cite, style })
  }

  // ExtendedSelection, as the citation picker's list.
  const clickRow = (i: number, e: MouseEvent) => {
    const key = rows[i].key
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
      m.setSelection(rows.slice(a, b + 1).map(r => r.key))
      return
    }
    anchor.current = i
    if (e.ctrlKey || e.metaKey) {
      m.setSelection(m.selected.includes(key) ? m.selected.filter(k => k !== key) : [...m.selected, key])
    } else {
      m.setSelection([key])
    }
  }

  const report = (title: string, added: string[], clash: string[] = []) =>
    env.inform(title, `${added.length} reference${added.length !== 1 ? 's' : ''} added.`
      + (clash.length ? `\n\nThese keys are already in the list for a different reference, so the imported ones were not added: ${clash.join(', ')}. Rename the key in the file (or in the list) to keep both.` : ''))
  const importFile = async (kind: ImportKind) => {
    const title = kind === 'endnote' ? 'From EndNote' : kind === 'mendeley' ? 'From Mendeley' : 'Import references'
    const file = await env.importFile(kind)
    if (file === null) return
    let bib: string
    try {
      bib = importToBibtex(file.text, file.name, splitBib(m.text()).keys())
    } catch (e) {
      await env.inform(title, e instanceof Error ? e.message : String(e))
      return
    }
    const clash = conflicts(m.text(), bib)
    await report(title, m.addBib(bib), clash)
  }
  const fromZotero = async () => {
    const bib = await env.fromZotero()
    if (bib) await report('From Zotero', m.addBib(bib))
  }
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !env.start) return
    started.current = true
    if (env.start === 'zotero') void fromZotero()
    else if (env.start === 'kherveref') void fromKherveRef()
    else void importFile(env.start)
  })
  const fromKherveRef = async () => {
    const text = await env.fromKherveRef()
    if (text) m.addBib(text)
  }

  return (
    <form className="dlg dlg-refs" role="dialog" aria-label="References of this document"
      onSubmit={(e) => { e.preventDefault(); finish([]) }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
      <div className="dlg-title">Reference library — the references of this document</div>
      <div className="dlg-body">
        {env.note && <div className="dlg-refs-note">{env.note}</div>}
        <div className="dlg-refs-top">
          <label htmlFor="ref-style">Style:</label>
          <select id="ref-style" value={style} title="How the citations and the reference list print"
            onChange={(e) => setStyle(e.target.value)}>
            {BIB_STYLES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            {!BIB_STYLES.some(([c]) => c === style) && <option value={style}>{style}</option>}
          </select>
        </div>
        <div className="dlg-refs-top">
          <input type="search" autoFocus value={m.query} placeholder="Search key, author, year, title"
            aria-label="Search references" onChange={(e) => m.setQuery(e.target.value)} />
          <select value={m.filter} aria-label="Show" onChange={(e) => m.setFilter(e.target.value)}>
            {FILTERS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
        <div className="dlg-refs-main">
          <div className="dlg-refs-table" role="grid" aria-multiselectable="true">
            <table>
              <thead>
                <tr><th>Key</th><th>Authors</th><th>Year</th><th className="dlg-refs-title">Title</th><th>Cited</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const missing = r.status === MISSING
                  const title = missing ? '(not in the list: select it to add it)' : texToPlain(r.title)
                  return (
                    <tr key={r.key} className={(m.selected.includes(r.key) ? 'selected' : '') + (missing ? ' missing' : '')}
                      aria-selected={m.selected.includes(r.key)}
                      onMouseDown={(e) => { e.preventDefault(); clickRow(i, e) }}>
                      <td>{r.key}</td><td>{shortAuthor(texToPlain(r.author))}</td><td>{r.year}</td>
                      <td className="dlg-refs-title" title={title}>{title}</td>
                      <td>{r.status === CITED ? '✓' : missing ? 'missing' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="dlg-refs-form">
            <label htmlFor="ref-type">Type</label>
            <input id="ref-type" list="ref-types" value={m.type} onChange={(e) => m.setField('type', e.target.value)} />
            <datalist id="ref-types">{ENTRY_TYPES.map(t => <option key={t} value={t} />)}</datalist>
            <label htmlFor="ref-key">Key</label>
            <input id="ref-key" value={m.key} placeholder="Made from the author, year and title"
              onChange={(e) => m.setField('key', e.target.value)} />
            {FIELDS.map(f => (
              <FieldRow key={f} name={f} m={m} />
            ))}
            <span />
            <button type="button" title="Keep the changes made in the form" onClick={() => m.saveEntry()}>Save entry</button>
          </div>
        </div>
        <div className="dlg-refs-tools">
          <button type="button" title="Add a reference to the list" onClick={() => m.newEntry()}>New</button>
          <button type="button" title="Take the selected references out of the list"
            onClick={() => m.deleteSelected()}>Delete</button>
          <button type="button" title="Pick references in Zotero (with the Better BibTeX add-on), or take the Zotero library"
            onClick={() => void fromZotero()}>From Zotero…</button>
          <button type="button" title="Add the references of an EndNote export: EndNote XML (.xml), RIS (.ris) or EndNote tagged (.enw)"
            onClick={() => void importFile('endnote')}>From EndNote…</button>
          <button type="button" title="Add the references exported from Mendeley (BibTeX, RIS or EndNote XML)"
            onClick={() => void importFile('mendeley')}>From Mendeley…</button>
          <button type="button" title="Add the references of a file: BibTeX (.bib), RIS (.ris), EndNote (.enw, .xml), from Zotero, Mendeley, Google Scholar, a journal..."
            onClick={() => void importFile('file')}>Import file…</button>
          <button type="button" title="Add references from a KherveRef library"
            onClick={() => void fromKherveRef()}>From KherveRef…</button>
          <span className="dlg-refs-summary">{m.summaryText}</span>
        </div>
      </div>
      <div className="dlg-buttons">
        <button type="submit">Done</button>
        <button type="button" title="Cite the selected references at the cursor"
          onClick={() => { if (m.citeSelected()) finish(m.citeSelection()) }}>Cite</button>
        <button type="button" onClick={() => close(null)}>Cancel</button>
      </div>
    </form>
  )
}

function FieldRow({ name, m }: { name: string; m: ReferenceManagerModel }) {
  return <>
    <label htmlFor={`ref-${name}`}>{LABELS[name]}</label>
    <input id={`ref-${name}`} value={m.fields[name] ?? ''}
      placeholder={name === 'author' ? 'Surname, First and Surname, First' : undefined}
      onChange={(e) => m.setField(name, e.target.value)} />
  </>
}

// ReferenceManager(bib_text, cited, library).exec(): the list, whether it
// changed and the keys to cite, or null when cancelled.
export function askReferences(bibText: string, cited: string[], env: ReferenceEnv): Promise<ReferenceChoice | null> {
  const m = new ReferenceManagerModel(bibText, cited)
  return openDialog<ReferenceChoice>((close) => <Manager m={m} env={env} close={close} />)
}
