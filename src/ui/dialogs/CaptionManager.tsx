// References ▸ Captions & labels: every figure, table, numbered equation
// and numbered heading of the document with its number, its caption and
// its label, to change them in one place or go to one. Equations and
// headings have no caption in LaTeX: their text is shown, their label can
// be changed. A caption left without a label gets one, so it can be
// cross-referenced. The changes: app/captions.ts.
import { useMemo, useState } from 'react'
import type { Referable } from '../../core/labels'
import { openDialog, type Close } from './dialogHost'
import './dialogs.css'

export interface CaptionEdit { index: number; caption: string | null; label: string }
export interface CaptionResult { edits: CaptionEdit[]; goTo: number | null }

const KIND_NAME = { section: 'Section', figure: 'Figure', table: 'Table', equation: 'Equation', other: 'Item' }

function Manager({ items, close }: { items: Referable[]; close: Close<CaptionResult> }) {
  const [captions, setCaptions] = useState(() => items.map(r => r.caption))
  const [labels, setLabels] = useState(() => items.map(r => r.label ?? ''))
  const [show, setShow] = useState<'all' | 'figure' | 'table' | 'equation' | 'section'>('all')
  const [error, setError] = useState('')

  const dupes = useMemo(() => {
    const seen = new Map<string, number>()
    for (const l of labels) if (l.trim()) seen.set(l.trim(), (seen.get(l.trim()) ?? 0) + 1)
    return new Set([...seen].filter(([, n]) => n > 1).map(([l]) => l))
  }, [labels])

  const edits = (): CaptionEdit[] => items.flatMap((r, i) => {
    const cap = captions[i]
    const lab = labels[i].trim().replace(/\s+/g, '-')
    return cap !== r.caption || lab !== (r.label ?? '') ? [{ index: r.index, caption: cap, label: lab }] : []
  })
  const finish = (goTo: number | null) => {
    if (dupes.size) { setError(`Two items have the label “${[...dupes][0]}”: labels must differ.`); return }
    close({ edits: edits(), goTo })
  }

  return (
    <form className='dlg dlg-captions' role='dialog' aria-label='Captions and labels'
      onSubmit={e => { e.preventDefault(); finish(null) }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
      <div className='dlg-title'>Captions &amp; labels</div>
      <div className='dlg-body'>
        <div className='cap-top'>
          <span>Every numbered item of the document. Change a caption or a label here; references to a
            renamed label follow it.</span>
          <select value={show} aria-label='Show' onChange={e => setShow(e.target.value as typeof show)}>
            <option value='all'>All</option>
            <option value='figure'>Figures</option>
            <option value='table'>Tables</option>
            <option value='equation'>Equations</option>
            <option value='section'>Headings</option>
          </select>
        </div>
        <div className='cap-table'>
          <table>
            <thead><tr><th>Item</th><th className='cap-wide'>Caption</th><th>Label</th><th /></tr></thead>
            <tbody>
              {items.map((r, i) => (show === 'all' || r.kind === show) && (
                <tr key={r.index}>
                  <td className='cap-kind'>{KIND_NAME[r.kind]} {r.number}</td>
                  <td className='cap-wide'>
                    {captions[i] !== null
                      ? <input value={captions[i] ?? ''} placeholder='No caption: type one'
                        aria-label={`Caption of ${KIND_NAME[r.kind]} ${r.number}`}
                        onChange={e => setCaptions(c => c.map((x, k) => (k === i ? e.target.value : x)))} />
                      : <span className={'cap-text' + (r.kind === 'equation' ? ' cap-math' : '')} title={r.text}>{r.text}</span>}
                  </td>
                  <td className='cap-label'>
                    <input className={dupes.has(labels[i].trim()) ? 'cap-dupe' : ''} value={labels[i]}
                      placeholder={r.caption !== null ? 'made from the caption' : 'none'}
                      aria-label={`Label of ${KIND_NAME[r.kind]} ${r.number}`} spellCheck={false}
                      onChange={e => setLabels(l => l.map((x, k) => (k === i ? e.target.value : x)))} />
                  </td>
                  <td><button type='button' title='Keep the changes and show this item'
                    onClick={() => finish(r.index)}>Go to</button></td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={4} className='cap-empty'>
                The document has no figure, table, numbered equation or heading yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className='cap-error'>{error}</div>}
      </div>
      <div className='dlg-buttons'>
        <button type='submit'>OK</button>
        <button type='button' onClick={() => close(null)}>Cancel</button>
      </div>
    </form>
  )
}

export function askCaptions(items: Referable[]): Promise<CaptionResult | null> {
  return openDialog<CaptionResult>(close => <Manager items={items} close={close} />)
}
