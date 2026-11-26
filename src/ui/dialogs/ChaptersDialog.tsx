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
  counts?: { paragraphs: number; figures: number; tables: number; equations: number }
}

export type ChapterView = 'all' | 'one' | 'outline'

export interface ChaptersApi {
  list(): ChapterRow[]
  // Called on every change of the document or the folds; returns the unsubscribe.
  subscribe(on: () => void): () => void
  setCompiled(index: number, on: boolean): void
  setShown(key: string, on: boolean): void
  setAll(what: 'compile' | 'show', on: boolean): void
  move(index: number, before: number | null): void
  goTo(index: number): void
  goToPos(pos: number): void
  add(): void
  addFile(): void
  view(): ChapterView
  setView(v: ChapterView): void
  chapterClass(): boolean
  useReportClass(): void
  documentTitle(): string
}

export function chaptersDialog(api: ChaptersApi): Promise<null> {
  return openDialog<null>(close => <Chapters api={api} close={close} />, { modeless: true })
}

const VIEWS: [ChapterView, string, string][] = [
  ['all', 'All', 'Every chapter shown in the editor'],
  ['one', 'One at a time', 'Only the chapter you go to is shown; the others are folded away'],
  ['outline', 'Outline', 'Every chapter with its sections'],
]

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

function Chapters({ api, close }: { api: ChaptersApi; close: Close<null> }) {
  const [rows, setRows] = useState(api.list)
  const [view, setView] = useState(api.view)
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  useEffect(() => api.subscribe(() => { setRows(api.list()); setView(api.view()) }), [api])
  const inPdf = rows.filter(r => r.compiled).length
  const shown = rows.filter(r => r.shown).length
  const total = rows.reduce((a, r) => {
    const c = r.counts
    return c ? { figures: a.figures + c.figures, tables: a.tables + c.tables, equations: a.equations + c.equations } : a
  }, { figures: 0, tables: 0, equations: 0 })
  const title = api.documentTitle()
  return (
    <div className='dlg dlg-ed dlg-chapters' role='dialog' aria-label='Chapters'
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
      <div className='dlg-title'>Chapters</div>
      <div className='chx-head'>
        <div className='chx-doc'>
          <div className='chx-doc-title'>{title || 'This document'}</div>
          <div className='chx-doc-sub'>
            {rows.length ? <>
              <b>{plural(rows.length, 'chapter')}</b> · {inPdf === rows.length ? 'all in the PDF' : `${inPdf} in the PDF`}
              {' · '}{shown === rows.length ? 'all shown' : `${shown} shown`}
              {total.figures + total.tables + total.equations > 0 && <> · {plural(total.figures, 'figure')}, {plural(total.tables, 'table')}, {plural(total.equations, 'equation')}</>}
            </> : 'One file holds every chapter: each Heading 1 starts one.'}
          </div>
        </div>
        {rows.length > 0 && (
          <div className='chx-views' role='radiogroup' aria-label='Show the chapters'>
            {VIEWS.map(([v, label, tip]) => (
              <button key={v} type='button' role='radio' aria-checked={view === v} className={view === v ? 'on' : ''} title={tip}
                onClick={() => api.setView(v)}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div className='dlg-body chx-body'>
        {rows.length === 0 ? (
          <div className='chx-empty'>
            <div className='chx-empty-icon'>📚</div>
            {api.chapterClass() ? <>
              <div className='chx-empty-title'>No chapters yet</div>
              <div>Click <b>New chapter</b>, bring in a chapter you wrote elsewhere with <b>Add a file…</b>, or turn a line into Heading 1.
                Every chapter stays inside this one .ktex file.</div>
            </> : <>
              <div className='chx-empty-title'>This document is an article</div>
              <div>In an article a Heading 1 is a section. A thesis or a book is written in chapters: switch to the report class
                (or a thesis class in Design ▸ Document type) and each Heading 1 becomes a chapter.</div>
              <button type='button' className='chx-primary' onClick={() => api.useReportClass()}>Use the report class</button>
            </>}
          </div>
        ) : (<>
          <div className='chx-bulk'>
            <span>All chapters:</span>
            <button type='button' onClick={() => api.setAll('compile', inPdf !== rows.length)}>{inPdf === rows.length ? 'Leave all out of the PDF' : 'Put all in the PDF'}</button>
            <button type='button' onClick={() => api.setAll('show', shown !== rows.length)}>{shown === rows.length ? 'Fold all away' : 'Show all'}</button>
          </div>
          <div className='chx-list'>
            {rows.map((r, i) => {
              const c = r.counts
              const secs = r.sections ?? []
              return (
                <div key={r.key}
                  className={`chx-card${r.current ? ' current' : ''}${r.compiled ? '' : ' out'}${r.shown ? '' : ' folded'}${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? ' drop-before' : ''}`}
                  draggable onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
                  onDragOver={e => { e.preventDefault(); setOver(i) }} onDragLeave={() => setOver(o => (o === i ? null : o))}
                  onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain') || drag); if (from !== i) api.move(from, i); setDrag(null); setOver(null) }}
                  onDragEnd={() => { setDrag(null); setOver(null) }}>
                  <span className='chx-grip' title='Drag to move this chapter'>⠿</span>
                  <span className='chx-num'>{i + 1}</span>
                  <div className='chx-main'>
                    <button type='button' className='chx-title' title='Go to this chapter' onClick={() => api.goTo(i)}>{r.title}</button>
                    <div className='chx-meta'>
                      {c && <>
                        <span title='Paragraphs'>¶ {c.paragraphs}</span>
                        {c.figures > 0 && <span title='Figures'>🖼 {c.figures}</span>}
                        {c.tables > 0 && <span title='Tables'>▦ {c.tables}</span>}
                        {c.equations > 0 && <span title='Equations'>∑ {c.equations}</span>}
                      </>}
                      {r.current && <span className='chx-here'>you are here</span>}
                      {!r.compiled && <span className='chx-tag out'>left out of the PDF</span>}
                      {!r.shown && <span className='chx-tag'>folded away</span>}
                    </div>
                    {secs.length > 0 && (view === 'outline'
                      ? <div className='chx-secs'>{secs.map((x, k) => (
                        <button key={k} type='button' style={{ paddingLeft: (x.level - 1) * 14 }} onClick={() => api.goToPos(x.pos)}>{x.title}</button>
                      ))}</div>
                      : <div className='chx-secline' title={secs.map(x => x.title).join('\n')}>{secs.filter(x => x.level === 1).slice(0, 4).map(x => x.title).join(' · ')}{secs.filter(x => x.level === 1).length > 4 ? ' …' : ''}</div>)}
                  </div>
                  <div className='chx-toggles'>
                    <label className={`chx-switch${r.compiled ? ' on' : ''}`} title={r.compiled ? 'In the PDF preview - click to leave it out (Export always keeps it)' : 'Left out of the PDF preview - click to put it back'}>
                      <input type='checkbox' checked={r.compiled} onChange={e => api.setCompiled(i, e.target.checked)} />
                      <span className='chx-knob' />In PDF
                    </label>
                    <button type='button' className={`chx-eye${r.shown ? ' on' : ''}`} title={r.shown ? 'Shown in the editor - click to fold it away while you write' : 'Folded away - click to show it'}
                      onClick={() => api.setShown(r.key, !r.shown)}>{r.shown ? '👁 Shown' : '◡ Folded'}</button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className='chx-tip'>Numbers stay as they are with every chapter in, even for the ones left out of the PDF. Drag ⠿ to reorder.</div>
        </>)}
      </div>
      <div className='dlg-buttons'>
        <button type='button' className='chx-primary' onClick={() => api.add()}>＋ New chapter</button>
        <button type='button' onClick={() => api.addFile()} title='Add another document (.ktex, Word, LaTeX, Markdown) at the end as a chapter: it is copied into this file'>Add a file as a chapter…</button>
        <span style={{ flex: 1 }} />
        <button type='button' onClick={() => close(null)}>Close</button>
      </div>
    </div>
  )
}
