// References ▸ Bibliography: the document's thebibliography as a list of
// \bibitem entries — add one from a short form (authors, title, journal,
// volume, pages, year, DOI), edit an entry's key and text, reorder or
// remove entries. It returns the block's new LaTeX (core/bibliography.ts).
import { useMemo, useState } from 'react'
import {
  formatReference, suggestKey, type BibItem, type RefFields, type TheBibliography,
} from '../../core/bibliography'
import { openDialog, type Close } from './dialogHost'

const EMPTY: RefFields = { authors: '', title: '', source: '', volume: '', pages: '', year: '', doi: '' }

const FIELDS: [keyof RefFields, string, string][] = [
  ['authors', 'Authors', 'A. Smith and B. Jones'],
  ['title', 'Title', 'Thin oxide films on titanium'],
  ['source', 'Journal / book', 'Surf. Sci.'],
  ['volume', 'Volume', '12'],
  ['pages', 'Pages', '101-109'],
  ['year', 'Year', '2024'],
  ['doi', 'DOI', '10.1016/j.susc.2024.01.001'],
]

function BibliographyDialog({ initial, close }: { initial: TheBibliography; close: Close<TheBibliography> }) {
  const [items, setItems] = useState<BibItem[]>(initial.items)
  const [sel, setSel] = useState(initial.items.length ? 0 : -1)
  const [adding, setAdding] = useState(initial.items.length === 0)
  const [form, setForm] = useState<RefFields>(EMPTY)
  const keys = useMemo(() => items.map(i => i.key), [items])
  const dupes = new Set(keys.filter((k, i) => keys.indexOf(k) !== i))
  const cur = sel >= 0 ? items[sel] : null

  const edit = (patch: Partial<BibItem>) =>
    setItems(list => list.map((it, i) => (i === sel ? { ...it, ...patch } : it)))
  const move = (d: number) => {
    const j = sel + d
    if (sel < 0 || j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[sel], next[j]] = [next[j], next[sel]]
    setItems(next)
    setSel(j)
  }
  const remove = () => {
    if (sel < 0) return
    setItems(items.filter((_, i) => i !== sel))
    setSel(Math.min(sel, items.length - 2))
  }
  const addFromForm = () => {
    const text = formatReference(form)
    if (!text) return
    const item = { key: suggestKey(form, keys), label: '', text }
    setItems([...items, item])
    setSel(items.length)
    setForm(EMPTY)
    setAdding(false)
  }
  const addBlank = () => {
    setItems([...items, { key: suggestKey(EMPTY, keys), label: '', text: '' }])
    setSel(items.length)
    setAdding(false)
  }
  const preview = formatReference(form)

  return (
    <form className="dlg dlg-bib" role="dialog" aria-label="Bibliography"
      onSubmit={e => { e.preventDefault(); close({ ...initial, items: items.filter(i => i.key.trim()) }) }}>
      <div className="dlg-title">Bibliography</div>
      <div className="dlg-body dlg-bib-body">
        <div className="dlg-bib-list" role="listbox" aria-label="References">
          {items.length === 0 && <div className="dlg-muted">No references yet.</div>}
          {items.map((it, i) => (
            <div key={i} role="option" aria-selected={i === sel && !adding}
              className={'dlg-bib-row' + (i === sel && !adding ? ' on' : '')}
              onClick={() => { setSel(i); setAdding(false) }}>
              <span className="dlg-bib-num">{it.label || `[${i + 1}]`}</span>
              <span className="dlg-bib-key">{it.key || '(no key)'}</span>
              <span className="dlg-bib-text">{it.text}</span>
            </div>
          ))}
        </div>
        <div className="dlg-bib-side">
          <div className="dlg-bib-tools">
            <button type="button" onClick={() => setAdding(true)}>Add reference…</button>
            <button type="button" onClick={addBlank}>Add blank</button>
            <button type="button" disabled={sel < 0 || adding} onClick={() => move(-1)} aria-label="Move up">▲</button>
            <button type="button" disabled={sel < 0 || adding || sel >= items.length - 1} onClick={() => move(1)}
              aria-label="Move down">▼</button>
            <button type="button" disabled={sel < 0 || adding} onClick={remove}>Remove</button>
          </div>
          {adding ? (
            <div className="dlg-bib-edit">
              <div className="dlg-form">
                {FIELDS.map(([k, label, hint]) => (
                  <label key={k} style={{ display: 'contents' }}>
                    <span>{label}:</span>
                    <input value={form[k]} placeholder={hint} autoFocus={k === 'authors'}
                      onChange={e => setForm({ ...form, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <div className="dlg-muted">\bibitem{'{'}{suggestKey(form, keys)}{'}'} {preview || '…'}</div>
              <div className="dlg-bib-tools">
                <button type="button" disabled={!preview} onClick={addFromForm}>Add to the list</button>
                <button type="button" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          ) : cur ? (
            <div className="dlg-bib-edit">
              <div className="dlg-form">
                <label htmlFor="bib-key">Key:</label>
                <input id="bib-key" value={cur.key} onChange={e => edit({ key: e.target.value.replace(/[\s{},]/g, '') })} />
                <label htmlFor="bib-label">Label:</label>
                <input id="bib-label" value={cur.label} placeholder="(numbered)"
                  onChange={e => edit({ label: e.target.value })} />
              </div>
              {dupes.has(cur.key) && <div className="dlg-warn">Another reference has this key.</div>}
              <label htmlFor="bib-text">Reference (LaTeX):</label>
              <textarea id="bib-text" rows={6} value={cur.text} onChange={e => edit({ text: e.target.value })} />
              <div className="dlg-muted">Cite it with Insert ▸ Citation, or \cite{'{'}{cur.key}{'}'}.</div>
            </div>
          ) : <div className="dlg-muted">Add a reference to start the list.</div>}
        </div>
      </div>
      <div className="dlg-buttons">
        <button type="submit">OK</button>
        <button type="button" onClick={() => close(null)}>Cancel</button>
      </div>
    </form>
  )
}

export function askBibliography(initial: TheBibliography): Promise<TheBibliography | null> {
  return openDialog<TheBibliography>(close => <BibliographyDialog initial={initial} close={close} />)
}

// References ▸ Insert reference (and the page's right-click): cite entries
// of the document's own reference list, or add a new one there and cite it.
export interface ReferenceChoice {
  keys: string[]
  // The reference list after any additions.
  items: BibItem[]
  // Open the KherveRef library picker instead.
  library?: boolean
}

function InsertReferenceDialog({ initial, close }: { initial: BibItem[]; close: Close<ReferenceChoice> }) {
  const [items, setItems] = useState<BibItem[]>(initial)
  const [picked, setPicked] = useState<string[]>([])
  const [adding, setAdding] = useState(initial.length === 0)
  const [form, setForm] = useState<RefFields>(EMPTY)
  const keys = items.map(i => i.key)
  const preview = formatReference(form)
  const toggle = (k: string) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]))
  const addFromForm = () => {
    if (!preview) return
    const key = suggestKey(form, keys)
    setItems([...items, { key, label: '', text: preview }])
    setPicked(p => [...p, key])
    setForm(EMPTY)
    setAdding(false)
  }
  return (
    <form className="dlg dlg-bib" role="dialog" aria-label="Insert reference"
      onSubmit={e => { e.preventDefault(); if (picked.length) close({ keys: picked, items }) }}>
      <div className="dlg-title">Insert reference</div>
      <div className="dlg-body dlg-bib-body">
        <div className="dlg-bib-list" role="listbox" aria-label="References" aria-multiselectable>
          {items.length === 0 && <div className="dlg-muted">The document has no references yet — add one.</div>}
          {items.map((it, i) => (
            <div key={it.key + i} role="option" aria-selected={picked.includes(it.key)}
              className={'dlg-bib-row' + (picked.includes(it.key) ? ' on' : '')}
              onClick={() => toggle(it.key)}
              onDoubleClick={() => close({ keys: picked.includes(it.key) ? picked : [...picked, it.key], items })}>
              <span className="dlg-bib-num">{picked.includes(it.key) ? '✓' : (it.label || `[${i + 1}]`)}</span>
              <span className="dlg-bib-key">{it.key}</span>
              <span className="dlg-bib-text">{it.text}</span>
            </div>
          ))}
        </div>
        <div className="dlg-bib-side">
          <div className="dlg-bib-tools">
            <button type="button" onClick={() => setAdding(true)}>New reference…</button>
            <button type="button" onClick={() => close({ keys: [], items: initial, library: true })}>
              From a KherveRef library…</button>
          </div>
          {adding ? (
            <div className="dlg-bib-edit">
              <div className="dlg-form">
                {FIELDS.map(([k, label, hint]) => (
                  <label key={k} style={{ display: 'contents' }}>
                    <span>{label}:</span>
                    <input value={form[k]} placeholder={hint} autoFocus={k === 'authors'}
                      onChange={e => setForm({ ...form, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <div className="dlg-muted">\bibitem{'{'}{suggestKey(form, keys)}{'}'} {preview || '…'}</div>
              <div className="dlg-bib-tools">
                <button type="button" disabled={!preview} onClick={addFromForm}>Add and select</button>
                <button type="button" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="dlg-muted">
              Click the references to cite (several make one \cite{'{'}a,b{'}'}), then Insert.
              A new reference is added to the document's reference list.
            </div>
          )}
        </div>
      </div>
      <div className="dlg-buttons">
        <button type="submit" disabled={!picked.length}>Insert</button>
        <button type="button" onClick={() => close(null)}>Cancel</button>
      </div>
    </form>
  )
}

export function askInsertReference(items: BibItem[]): Promise<ReferenceChoice | null> {
  return openDialog<ReferenceChoice>(close => <InsertReferenceDialog initial={items} close={close} />)
}
