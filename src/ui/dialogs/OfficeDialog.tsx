// Edit… for the Admin & Office, Accountants and Architect elements: their
// settings as fields, and their rows (lines of a statement, invoice items,
// rooms...) as a grid - add, remove and move rows with buttons, a menu
// where a column has fixed choices. No markup to learn.
import { useState } from 'react'
import { openDialog } from './dialogHost'
import './notebookDialog.css'

export interface OfficeField { key: string; label: string; value: string; type?: 'text' | 'textarea' | 'number' | 'select' | 'check'; options?: string[]; help?: string }
export interface GridCol { name: string; width?: number; options?: string[]; number?: boolean; placeholder?: string }
export interface GridSpec { label: string; cols: GridCol[]; rows: string[][]; help?: string }
export interface OfficeResult { values: Record<string, string>; grids: string[][][] }

export function officeDialog(title: string, fields: OfficeField[], grids: GridSpec[] = []): Promise<OfficeResult | null> {
  return openDialog<OfficeResult>(close => {
    function Dlg() {
      const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map(f => [f.key, f.value])))
      const [gs, setGs] = useState<string[][][]>(grids.map(g => g.rows.map(r => g.cols.map((_, i) => r[i] ?? ''))))
      const setRow = (g: number, f: (rows: string[][]) => string[][]) => setGs(a => a.map((rows, i) => (i === g ? f(rows) : rows)))
      const mini = (label: string, on: () => void, tip: string, danger = false) =>
        <button type='button' className={'nb-mini' + (danger ? ' nb-danger' : '')} title={tip} onClick={on}>{label}</button>
      return (
        <form className='dlg nb-dlg' role='dialog' aria-label={title}
          onSubmit={e => { e.preventDefault(); close({ values: v, grids: gs }) }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
          <div className='dlg-title'>{title}</div>
          <div className='dlg-body nb-body'>
            {fields.length > 0 && <div className='of-fields'>
              {fields.map(f => (
                <label key={f.key} className={'of-field' + (f.type === 'textarea' ? ' of-wide' : '')} title={f.help}>
                  {f.type === 'check'
                    ? <span><input type='checkbox' checked={v[f.key] === 'true'} onChange={e => setV(o => ({ ...o, [f.key]: String(e.target.checked) }))} /> {f.label}</span>
                    : <>
                      <span>{f.label}</span>
                      {f.type === 'textarea' ? <textarea rows={3} value={v[f.key]} onChange={e => setV(o => ({ ...o, [f.key]: e.target.value }))} />
                        : f.type === 'select' ? <select value={v[f.key]} onChange={e => setV(o => ({ ...o, [f.key]: e.target.value }))}>{f.options!.map(o => <option key={o}>{o}</option>)}</select>
                          : <input type={f.type === 'number' ? 'number' : 'text'} step='any' value={v[f.key]} onChange={e => setV(o => ({ ...o, [f.key]: e.target.value }))} />}
                    </>}
                  {f.help && f.type !== 'check' && <small>{f.help}</small>}
                </label>
              ))}
            </div>}
            {grids.map((g, gi) => (
              <section key={gi} className='nb-sec'>
                <div className='nb-kind'>{g.label}</div>
                {g.help && <small className='of-help'>{g.help}</small>}
                <table className='of-grid'>
                  <thead><tr>{g.cols.map(c => <th key={c.name}>{c.name}</th>)}<th /></tr></thead>
                  <tbody>
                    {gs[gi].map((r, ri) => (
                      <tr key={ri}>
                        {g.cols.map((c, ci) => (
                          <td key={ci}>
                            {c.options
                              ? <select value={r[ci]} onChange={e => setRow(gi, rows => rows.map((x, a) => (a === ri ? x.map((y, b) => (b === ci ? e.target.value : y)) : x)))}>
                                {[...(c.options.includes(r[ci]) || !r[ci] ? [] : [r[ci]]), ...c.options].map(o => <option key={o}>{o}</option>)}</select>
                              : <input value={r[ci]} placeholder={c.placeholder} style={{ width: `${(c.width ?? 8) * 0.62}em`, textAlign: c.number ? 'right' : 'left' }}
                                onChange={e => setRow(gi, rows => rows.map((x, a) => (a === ri ? x.map((y, b) => (b === ci ? e.target.value : y)) : x)))} />}
                          </td>
                        ))}
                        <td className='of-rowbtns'>
                          {mini('↑', () => setRow(gi, rows => { if (!ri) return rows; const n = [...rows]; [n[ri - 1], n[ri]] = [n[ri], n[ri - 1]]; return n }), 'Move up')}
                          {mini('↓', () => setRow(gi, rows => { if (ri >= rows.length - 1) return rows; const n = [...rows]; [n[ri + 1], n[ri]] = [n[ri], n[ri + 1]]; return n }), 'Move down')}
                          {mini('×', () => setRow(gi, rows => rows.filter((_, a) => a !== ri)), 'Remove this row', true)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>{mini('+ Add row', () => setRow(gi, rows => [...rows, g.cols.map(c => (c.options ? c.options[0] : ''))]), 'Add a row at the end')}</div>
              </section>
            ))}
          </div>
          <div className='dlg-buttons'>
            <button type='submit'>OK</button>
            <button type='button' onClick={() => close(null)}>Cancel</button>
          </div>
        </form>
      )
    }
    return <Dlg />
  })
}
