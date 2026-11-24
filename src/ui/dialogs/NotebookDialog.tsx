// Science ▸ Lab Notebook ▸ Edit…: the entry as a form, not as text. The
// date and title; then sections, each a heading and blocks - a paragraph,
// a bullet list, numbered steps, tick boxes or a table - added, changed,
// moved and removed with buttons. Stored as the same section text the
// notebook draws from (core/science.ts parseNoteText), so nothing else
// changes.
import { useState } from 'react'
import { parseNoteText, type NoteBlock } from '../../core/science'
import { openDialog } from './dialogHost'
import './notebookDialog.css'

export interface NotebookForm { date: string; title: string; sections: { heading: string; text: string }[] }

type Block = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] } | { kind: 'check'; items: [boolean, string][] } | { kind: 'table'; rows: string[][] }
interface Section { heading: string; blocks: Block[] }

const BLOCKS: [Block['kind'], string][] = [['p', 'Paragraph'], ['ul', 'Bullet list'], ['ol', 'Numbered steps'], ['check', 'Tick list'], ['table', 'Table']]

function toBlocks(text: string): Block[] {
  return parseNoteText(text).map((b: NoteBlock): Block => {
    switch (b.t) {
      case 'p': return { kind: 'p', text: b.text }
      case 'ul': case 'ol': return { kind: b.t, items: [...b.items] }
      case 'check': return { kind: 'check', items: b.items.map(([on, t]) => [on, t] as [boolean, string]) }
      default: return { kind: 'table', rows: b.rows.map(r => [...r]) }
    }
  })
}

// Back to the notebook's text: one block after another, a blank line between.
function toText(blocks: Block[]): string {
  return blocks.map(b => {
    switch (b.kind) {
      case 'p': return b.text.replace(/\n+/g, ' ').trim()
      case 'ul': return b.items.filter(x => x.trim()).map(x => `- ${x.trim()}`).join('\n')
      case 'ol': return b.items.filter(x => x.trim()).map((x, i) => `${i + 1}. ${x.trim()}`).join('\n')
      case 'check': return b.items.filter(([, x]) => x.trim()).map(([on, x]) => `[${on ? 'x' : ' '}] ${x.trim()}`).join('\n')
      case 'table': {
        if (!b.rows.some(r => r.some(c => c.trim()))) return ''
        const n = Math.max(1, ...b.rows.map(r => r.length))
        return b.rows.map(r => `| ${Array.from({ length: n }, (_, i) => (r[i] ?? '').replace(/\|/g, '/').trim()).join(' | ')} |`).join('\n')
      }
    }
  }).filter(t => t.trim()).join('\n\n')
}

const fresh = (kind: Block['kind']): Block =>
  kind === 'p' ? { kind, text: '' } : kind === 'check' ? { kind, items: [[false, '']] } : kind === 'table' ? { kind, rows: [['', ''], ['', '']] } : { kind, items: [''] }

export function notebookDialog(form: NotebookForm, focusNew = false): Promise<NotebookForm | null> {
  return openDialog<NotebookForm>(close => {
    function Dlg() {
      const [date, setDate] = useState(form.date)
      const [title, setTitle] = useState(form.title)
      const [secs, setSecs] = useState<Section[]>(() => {
        const s = form.sections.map(x => ({ heading: x.heading, blocks: toBlocks(x.text) }))
        return focusNew ? [...s, { heading: '', blocks: [fresh('p')] }] : s
      })
      const upd = (i: number, f: (s: Section) => Section) => setSecs(ss => ss.map((s, j) => (j === i ? f(s) : s)))
      const updBlock = (i: number, k: number, f: (b: Block) => Block) => upd(i, s => ({ ...s, blocks: s.blocks.map((b, j) => (j === k ? f(b) : b)) }))
      const move = <T,>(a: T[], i: number, d: number) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b }
      const ok = () => close({ date, title, sections: secs.map(s => ({ heading: s.heading.trim(), text: toText(s.blocks) })) })
      const small = (label: string, on: () => void, titleText?: string, danger = false) =>
        <button type='button' className={'nb-mini' + (danger ? ' nb-danger' : '')} title={titleText ?? label} onClick={on}>{label}</button>
      return (
        <form className='dlg nb-dlg' role='dialog' aria-label='Lab notebook entry'
          onSubmit={e => { e.preventDefault(); ok() }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
          <div className='dlg-title'>Lab notebook entry</div>
          <div className='dlg-body nb-body'>
            <div className='nb-head'>
              <label>Title <input value={title} onChange={e => setTitle(e.target.value)} placeholder='Sample 12: annealing in air' /></label>
              <label>Date <input value={date} onChange={e => setDate(e.target.value)} style={{ width: 130 }} /></label>
            </div>
            {secs.map((s, i) => (
              <section key={i} className='nb-sec'>
                <div className='nb-sec-head'>
                  <input className='nb-heading' value={s.heading} autoFocus={focusNew && i === secs.length - 1}
                    placeholder='Section heading (Aim, Method, Reagents…)' onChange={e => upd(i, x => ({ ...x, heading: e.target.value }))} />
                  {small('↑', () => setSecs(ss => move(ss, i, -1)), 'Move this section up')}
                  {small('↓', () => setSecs(ss => move(ss, i, 1)), 'Move this section down')}
                  {small('Delete section', () => setSecs(ss => ss.filter((_, j) => j !== i)), undefined, true)}
                </div>
                {s.blocks.map((b, k) => (
                  <div key={k} className='nb-block'>
                    <div className='nb-block-bar'>
                      <span className='nb-kind'>{BLOCKS.find(([x]) => x === b.kind)![1]}</span>
                      {small('↑', () => upd(i, x => ({ ...x, blocks: move(x.blocks, k, -1) })), 'Move up')}
                      {small('↓', () => upd(i, x => ({ ...x, blocks: move(x.blocks, k, 1) })), 'Move down')}
                      {small('×', () => upd(i, x => ({ ...x, blocks: x.blocks.filter((_, j) => j !== k) })), 'Remove this block', true)}
                    </div>
                    {b.kind === 'p' && <textarea rows={3} value={b.text} placeholder='Text… (**bold**, *italic*, $maths$ allowed)'
                      onChange={e => updBlock(i, k, () => ({ kind: 'p', text: e.target.value }))} />}
                    {(b.kind === 'ul' || b.kind === 'ol') && <>
                      {b.items.map((it, n) => (
                        <div key={n} className='nb-item'>
                          <span className='nb-bullet'>{b.kind === 'ul' ? '•' : `${n + 1}.`}</span>
                          <input value={it} placeholder={b.kind === 'ul' ? 'Item' : 'Step'}
                            onChange={e => updBlock(i, k, x => ({ ...x, items: (x as { items: string[] }).items.map((y, m) => (m === n ? e.target.value : y)) }) as Block)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); updBlock(i, k, x => ({ ...x, items: [...(x as { items: string[] }).items.slice(0, n + 1), '', ...(x as { items: string[] }).items.slice(n + 1)] }) as Block) } }} />
                          {small('×', () => updBlock(i, k, x => ({ ...x, items: (x as { items: string[] }).items.filter((_, m) => m !== n) }) as Block), 'Remove this item')}
                        </div>
                      ))}
                      {small('+ Add item', () => updBlock(i, k, x => ({ ...x, items: [...(x as { items: string[] }).items, ''] }) as Block))}
                    </>}
                    {b.kind === 'check' && <>
                      {b.items.map(([on, it], n) => (
                        <div key={n} className='nb-item'>
                          <input type='checkbox' checked={on} title='Ticked'
                            onChange={e => updBlock(i, k, x => ({ kind: 'check', items: (x as { items: [boolean, string][] }).items.map((y, m) => (m === n ? [e.target.checked, y[1]] : y)) as [boolean, string][] }))} />
                          <input value={it} placeholder='Check'
                            onChange={e => updBlock(i, k, x => ({ kind: 'check', items: (x as { items: [boolean, string][] }).items.map((y, m) => (m === n ? [y[0], e.target.value] : y)) as [boolean, string][] }))} />
                          {small('×', () => updBlock(i, k, x => ({ kind: 'check', items: (x as { items: [boolean, string][] }).items.filter((_, m) => m !== n) })), 'Remove this item')}
                        </div>
                      ))}
                      {small('+ Add item', () => updBlock(i, k, x => ({ kind: 'check', items: [...(x as { items: [boolean, string][] }).items, [false, '']] })))}
                    </>}
                    {b.kind === 'table' && <>
                      <table className='nb-table'><tbody>
                        {b.rows.map((r, ri) => (
                          <tr key={ri}>{r.map((c, ci) => (
                            <td key={ci}><input value={c} placeholder={ri === 0 ? 'Header' : ''} className={ri === 0 ? 'nb-th' : ''}
                              onChange={e => updBlock(i, k, x => ({ kind: 'table', rows: (x as { rows: string[][] }).rows.map((rr, a) => a === ri ? rr.map((cc, bb) => (bb === ci ? e.target.value : cc)) : rr) }))} /></td>
                          ))}</tr>
                        ))}
                      </tbody></table>
                      <div className='nb-row'>
                        {small('+ Row', () => updBlock(i, k, x => { const rows = (x as { rows: string[][] }).rows; return { kind: 'table', rows: [...rows, rows[0].map(() => '')] } }))}
                        {small('+ Column', () => updBlock(i, k, x => ({ kind: 'table', rows: (x as { rows: string[][] }).rows.map(r => [...r, '']) })))}
                        {small('− Row', () => updBlock(i, k, x => { const rows = (x as { rows: string[][] }).rows; return { kind: 'table', rows: rows.length > 1 ? rows.slice(0, -1) : rows } }))}
                        {small('− Column', () => updBlock(i, k, x => ({ kind: 'table', rows: (x as { rows: string[][] }).rows.map(r => (r.length > 1 ? r.slice(0, -1) : r)) })))}
                      </div>
                    </>}
                  </div>
                ))}
                <div className='nb-add'>
                  <span>Add:</span>
                  {BLOCKS.map(([kind, name]) => <button key={kind} type='button' className='nb-mini' onClick={() => upd(i, x => ({ ...x, blocks: [...x.blocks, fresh(kind)] }))}>{name}</button>)}
                </div>
              </section>
            ))}
            <button type='button' className='nb-add-sec' onClick={() => setSecs(ss => [...ss, { heading: '', blocks: [fresh('p')] }])}>+ Add section</button>
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
