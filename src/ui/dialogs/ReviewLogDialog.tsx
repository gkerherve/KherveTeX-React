// Review ▸ Decisions: every tracked change and comment accepted or
// rejected in this document, newest first, with who made it and who
// decided, when; shown all, accepted only or rejected only.
import { useState } from 'react'
import type { ReviewEntry } from '../../core/model'
import { openDialog, type Close } from './dialogHost'
import './editorDialogs.css'

const KIND: Record<ReviewEntry['kind'], string> = { insertion: 'Insertion', deletion: 'Deletion', comment: 'Comment' }

function when(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function reviewLogDialog(entries: ReviewEntry[], clear: () => void): Promise<null> {
  return openDialog<null>(close => <Log entries={entries} clear={clear} close={close} />, { modeless: true })
}

function Log({ entries, clear, close }: { entries: ReviewEntry[]; clear: () => void; close: Close<null> }) {
  const [show, setShow] = useState<'all' | 'accepted' | 'rejected'>('all')
  const [list, setList] = useState(entries)
  const rows = [...list].reverse().filter(e => show === 'all' || e.decision === show)
  const count = (d: ReviewEntry['decision']) => list.filter(e => e.decision === d).length
  const asText = () => rows.map(e => `${e.decision === 'accepted' ? 'Accepted' : 'Rejected'}\t${KIND[e.kind]}\t"${e.text}"${e.note ? `\t(${e.note})` : ''}\tby ${e.author || '?'}\tdecided by ${e.by}, ${when(e.at)}`).join('\n')
  return (
    <div className='dlg dlg-ed dlg-revlog' role='dialog' aria-label='Review decisions'
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
      <div className='dlg-title'>Review decisions</div>
      <div className='dlg-body'>
        <div className='rl-filter'>
          {(['all', 'accepted', 'rejected'] as const).map(k => (
            <button key={k} type='button' className={show === k ? 'on' : ''} onClick={() => setShow(k)}>
              {k === 'all' ? `All (${list.length})` : k === 'accepted' ? `Accepted (${count('accepted')})` : `Rejected (${count('rejected')})`}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className='rl-empty'>{list.length ? 'Nothing here.' : 'No change or comment has been accepted or rejected yet. Select text with tracked changes or comments and click Accept or Reject: each decision is listed here and kept in the document.'}</div>
        ) : (
          <div className='rl-list'>
            <div className='rl-row rl-head'><span>Decision</span><span>Kind</span><span>Text</span><span>Made by</span><span>Decided by</span></div>
            {rows.map((e, i) => (
              <div key={i} className={`rl-row ${e.decision}`}>
                <span className='rl-dec'>{e.decision === 'accepted' ? '✓ Accepted' : '✗ Rejected'}</span>
                <span className='rl-kind'>{KIND[e.kind]}</span>
                <span className='rl-text'>
                  <span className={e.kind === 'deletion' ? 'del' : e.kind === 'insertion' ? 'ins' : ''}>{e.text || '(empty)'}</span>
                  {e.note && <span className='rl-note'>{e.note}</span>}
                </span>
                <span className='rl-who'>{e.author || '—'}{e.made ? <small>{when(e.made)}</small> : null}</span>
                <span className='rl-who'>{e.by}<small>{when(e.at)}</small></span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className='dlg-buttons'>
        <button type='button' disabled={!rows.length} onClick={() => { void navigator.clipboard?.writeText(asText()) }}>Copy list</button>
        <button type='button' disabled={!list.length} onClick={() => { clear(); setList([]) }}>Clear list</button>
        <span style={{ flex: 1 }} />
        <button type='button' onClick={() => close(null)}>Close</button>
      </div>
    </div>
  )
}
