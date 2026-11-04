// Insert ▸ Citation: pick references from a KherveRef library. A port of
// khervedoc/citation_picker.py; its logic (library list, search, rows,
// keys) lives in core/kherveref.ts.
//
// Lists the entries of a KherveRef library (read straight from its
// library.bib), searchable by key, author, year and title. Keys that are
// not in any library can still be typed by hand.
import { useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  PICKER_HINT, PICKER_MANUAL_PLACEHOLDER, PICKER_NO_LIBRARY, PICKER_NOTHING_SELECTED,
  PICKER_SEARCH_PLACEHOLDER, STYLES, _BROWSE, pickerBrowse, pickerKeys, pickerLibraries,
  pickerLoad, pickerRows,
} from '../../core/kherveref'
import type { PickerItem, RefFileAccess } from '../../core/kherveref'
import type { BibEntries } from '../../core/references'
import { openDialog, type Close } from './dialogHost'

export interface CitationChoice {
  keys: string[]
  style: string
  // The library the entries came from; '' for the copy the document
  // carries (dlg.library).
  library: string
}

export interface PickerEnv {
  fs: RefFileAccess
  // QFileDialog.getExistingDirectory: the chosen folder, or null.
  chooseFolder: () => Promise<string | null>
}

interface Loaded {
  items: PickerItem[]
  index: number
  entries: BibEntries
  library: string
}

// _library_changed: settle a Browse choice, then read the library.
async function libraryChanged(items: PickerItem[], index: number, library: string, bundled: string,
  env: PickerEnv): Promise<Loaded> {
  let data = items[index].data
  if (data === _BROWSE) {
    const chosen = await env.chooseFolder()
    ;({ items, index, data } = await pickerBrowse(items, index, chosen, env.fs))
  }
  const r = await pickerLoad(data, bundled, env.fs)
  return { items, index, entries: r.entries, library: r.library ?? library }
}

function CitationPicker({ start, bundled, style: style0, env, close }: {
  start: Loaded; bundled: string; style: string; env: PickerEnv; close: Close<CitationChoice>
}) {
  const [lib, setLib] = useState<Loaded>(start)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const [style, setStyle] = useState(STYLES.some(([c]) => c === style0) ? style0 : STYLES[0][0])
  const [selected, setSelected] = useState<number[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const anchor = useRef(0)
  const busy = useRef(false)

  const rows = useMemo(() => pickerRows(lib.entries, query), [lib.entries, query])
  // Qt keeps the selection by row position across a refill.
  const sel = selected.filter((r) => r < rows.length)
  const emptyText = message ?? (lib.entries.size ? '' : PICKER_NO_LIBRARY)

  const changeLibrary = async (index: number) => {
    if (busy.current) return
    busy.current = true
    try {
      setLib(await libraryChanged(lib.items, index, lib.library, bundled, env))
      setMessage(null)
    } finally {
      busy.current = false
    }
  }

  const accept = () => {
    const keys = pickerKeys(rows, sel, manual)
    if (!keys.length) {
      setMessage(PICKER_NOTHING_SELECTED)
      return
    }
    close({ keys, style, library: lib.library })
  }

  // ExtendedSelection: click selects one row, Ctrl/Cmd toggles, Shift
  // extends from the last clicked row.
  const clickRow = (r: number, e: MouseEvent) => {
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor.current, r), Math.max(anchor.current, r)]
      const range = Array.from({ length: b - a + 1 }, (_, i) => a + i)
      setSelected(e.ctrlKey || e.metaKey ? [...new Set([...sel, ...range])] : range)
      return
    }
    anchor.current = r
    if (e.ctrlKey || e.metaKey) setSelected(sel.includes(r) ? sel.filter((x) => x !== r) : [...sel, r])
    else setSelected([r])
  }

  return (
    <form className="dlg dlg-cite" role="dialog" aria-label="Insert citation"
      onSubmit={(e) => { e.preventDefault(); accept() }}>
      <div className="dlg-title">Insert citation</div>
      <div className="dlg-body">
        <div className="dlg-cite-form">
          <label htmlFor="cite-lib">Library</label>
          <select id="cite-lib" autoFocus value={lib.index} onChange={(e) => void changeLibrary(Number(e.target.value))}>
            {lib.items.map((it, i) => <option key={`${i}:${it.data}`} value={i}>{it.label}</option>)}
          </select>
          <label htmlFor="cite-find">Find</label>
          <input id="cite-find" type="search" value={query} placeholder={PICKER_SEARCH_PLACEHOLDER}
            onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="dlg-cite-table" role="grid" aria-multiselectable="true">
          <table>
            <thead>
              <tr><th>Key</th><th>Authors</th><th>Year</th><th className="dlg-cite-title">Title</th></tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={sel.includes(r) ? 'selected' : undefined} aria-selected={sel.includes(r)}
                  onMouseDown={(e) => { e.preventDefault(); clickRow(r, e) }}
                  onDoubleClick={() => accept()}>
                  <td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td>
                  <td className="dlg-cite-title" title={row[3]}>{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {emptyText && <div className="dlg-cite-empty">{emptyText}</div>}
        <div className="dlg-cite-form">
          <label htmlFor="cite-manual">Also cite</label>
          <input id="cite-manual" value={manual} placeholder={PICKER_MANUAL_PLACEHOLDER}
            onChange={(e) => setManual(e.target.value)} />
          <label htmlFor="cite-style">Style</label>
          <select id="cite-style" value={style} onChange={(e) => setStyle(e.target.value)}>
            {STYLES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
      </div>
      <div className="dlg-buttons dlg-cite-buttons">
        <span className="dlg-cite-hint">{PICKER_HINT}</span>
        <button type="submit">Insert</button>
        <button type="button" onClick={() => close(null)}>Cancel</button>
      </div>
    </form>
  )
}

// CitationPicker(current_library, bundled_bib, style).exec(): the chosen
// keys, style and library, or null when cancelled.
export async function askCitation(currentLibrary: string, bundledBib: string, env: PickerEnv,
  style = 'cite'): Promise<CitationChoice | null> {
  const { items, index } = await pickerLibraries(currentLibrary, bundledBib, env.fs)
  const start = await libraryChanged(items, index, '', bundledBib, env)
  return openDialog<CitationChoice>((close) => (
    <CitationPicker start={start} bundled={bundledBib} style={style} env={env} close={close} />
  ))
}
