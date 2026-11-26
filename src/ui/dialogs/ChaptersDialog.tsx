// The Chapters window: every chapter of the document with a Compile and a
// Show tick, dragged into order, a click to go to one, and New chapter /
// Add a file as a chapter. It stays open while you write (modeless) and
// follows the document. The work is done by app/actions/chapters.ts.
import { useEffect, useState } from 'react'
import { openDialog, type Close } from './dialogHost'
import './editorDialogs.css'

export interface ChapterRow {
  title: string; key: string; compiled: boolean; shown: boolean; summary: string
  // The caret is in it; its headings (the Documents panel's Outline view).
  current?: boolean
  sections?: { title: string; level: number; pos: number }[]
}

export interface ChaptersApi {
  list(): ChapterRow[]
  // Called on every change of the document or the folds; returns the unsubscribe.
  subscribe(on: () => void): () => void
  setCompiled(index: number, on: boolean): void
  setShown(key: string, on: boolean): void
  setAll(what: 'compile' | 'show', on: boolean): void
  move(index: number, before: number | null): void
  goTo(index: number): void
  add(): void
  addFile(): void
}

export function chaptersDialog(api: ChaptersApi): Promise<null> {
  return openDialog<null>(close => <Chapters api={api} close={close} />, { modeless: true })
}

function Chapters({ api, close }: { api: ChaptersApi; close: Close<null> }) {
  const [rows, setRows] = useState(api.list)
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  useEffect(() => api.subscribe(() => setRows(api.list())), [api])
  const allCompiled = rows.every(r => r.compiled)
  const allShown = rows.every(r => r.shown)
  return (
    <div className='dlg dlg-ed dlg-chapters' role='dialog' aria-label='Chapters'
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
      <div className='dlg-title'>Chapters</div>
      <div className='dlg-body'>
        {rows.length === 0 ? (
          <div className='ch-empty'>This document has no chapters yet. A chapter starts at each top-level heading:
            click <b>New chapter</b>, or turn a line into Heading 1.</div>
        ) : (<>
          <div className='ch-head'>
            <span />
            <label title='Compile every chapter, or none'><input type='checkbox' checked={allCompiled} onChange={e => api.setAll('compile', e.target.checked)} /> Compile</label>
            <label title='Show every chapter in the editor, or fold them all'><input type='checkbox' checked={allShown} onChange={e => api.setAll('show', e.target.checked)} /> Show</label>
            <span>Chapter</span>
          </div>
          <div className='ch-list'>
            {rows.map((r, i) => (
              <div key={r.key} className={`ch-row${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? ' drop-before' : ''}${r.compiled ? '' : ' off'}`}
                draggable onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
                onDragOver={e => { e.preventDefault(); setOver(i) }} onDragLeave={() => setOver(o => (o === i ? null : o))}
                onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain') || drag); if (from !== i) api.move(from, i); setDrag(null); setOver(null) }}
                onDragEnd={() => { setDrag(null); setOver(null) }}>
                <span className='ch-grip' title='Drag to move this chapter'>⋮⋮</span>
                <input type='checkbox' checked={r.compiled} title='In the PDF preview' onChange={e => api.setCompiled(i, e.target.checked)} />
                <input type='checkbox' checked={r.shown} title='Shown in the editor (unticked: folded away)' onChange={e => api.setShown(r.key, e.target.checked)} />
                <button type='button' className='ch-title' title='Go to this chapter' onClick={() => api.goTo(i)}>
                  <span className='ch-num'>{i + 1}</span>{r.title}<span className='ch-sum'>{r.summary}</span>
                </button>
              </div>
            ))}
          </div>
          <div className='ch-tip'>Untick <b>Compile</b> to leave a chapter out of the PDF preview (Export always keeps it), and <b>Show</b> to fold it away while you write. Drag ⋮⋮ to reorder.</div>
        </>)}
      </div>
      <div className='dlg-buttons'>
        <button type='button' onClick={() => api.add()}>New chapter</button>
        <button type='button' onClick={() => api.addFile()} title='Add another document (.ktex, Word, LaTeX, Markdown) at the end as a chapter: it is copied into this file'>Add a file as a chapter…</button>
        <span style={{ flex: 1 }} />
        <button type='button' onClick={() => close(null)}>Close</button>
      </div>
    </div>
  )
}
