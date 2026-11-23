// The "Spelling" dock (QDockWidget holding SpellingPanel in
// khervedoc/spelling_panel.py), on the right of the window: every spelling
// mistake of the document, the suggestions for the one selected, and the
// buttons that fix or skip it. Its logic is SpellingPanelModel in
// src/app/spellingPanel.ts; this is only the widgets.
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { setSpellingDock, spellingPanel, useSpellingDock } from '../app/actions/spell'
import { useApp } from '../app/store'
import './SpellingPanel.css'

export function SpellingPanel() {
  const visible = useSpellingDock()
  const m = spellingPanel
  useSyncExternalStore(m.subscribe, m.version)
  const doc = useApp(s => s.doc)
  const [width, setWidth] = useState(300)
  const list = useRef<HTMLDivElement>(null)

  // The list follows the text while the panel is open: checked again a
  // moment after each edit (MainWindow._on_doc_changed).
  useEffect(() => {
    if (!visible) return
    const t = window.setTimeout(() => m.refresh(), 400)
    return () => window.clearTimeout(t)
  }, [doc, visible, m])

  // Keep the selected row in view.
  useEffect(() => {
    list.current?.querySelector('.sp-row.current')?.scrollIntoView({ block: 'nearest' })
  }, [m.current, m.items])

  if (!visible) return null

  const dragSplitter = (e: PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const start = width
    const move = (ev: globalThis.PointerEvent) => setWidth(Math.min(700, Math.max(200, start - (ev.clientX - startX))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const has = m.current >= 0 && m.current < m.items.length
  const canChange = has && m.chosen() !== null
  const onKey = (e: React.KeyboardEvent) => {
    if (!m.items.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); m.select(Math.min(m.current + 1, m.items.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); m.select(Math.max(m.current - 1, 0)) }
    if (e.key === 'Enter' && canChange) { e.preventDefault(); m.change() }
  }

  return (
    <div className='spelling-dock' style={{ width }}>
      <div className='sp-splitter' onPointerDown={dragSplitter} />
      <div className='dock-title'>
        <span>Spelling</span>
        <button type='button' className='dock-close' title='Close' onClick={() => setSpellingDock(false)}>
          {'✕'}
        </button>
      </div>
      <div className='sp-body'>
        <div className='sp-top'>
          <span className='sp-summary'>{m.summaryText}</span>
          <button type='button' className='sp-recheck' title='Check the whole document again'
            onClick={() => m.refresh()}>Check again</button>
        </div>
        <div className='sp-head'><span>Word</span><span>In the text</span></div>
        <div ref={list} className='sp-list' role='listbox' tabIndex={0} aria-label='Spelling mistakes'
          title='Click a mistake to go to it in the document' onKeyDown={onKey}>
          {m.items.map((it, i) => (
            <div key={`${it.start}-${i}`} role='option' aria-selected={m.current === i}
              className={'sp-row' + (m.current === i ? ' current' : '')}
              title={it.before + it.word + it.after}
              onClick={() => m.select(i)}>
              <span className='sp-word'>{it.word}</span>
              <span className='sp-context'>
                {/* The spaces beside the word as margins: a flex row drops
                    them at the edges of its items. */}
                <span className={'sp-before' + (/\s$/.test(it.before) ? ' gap' : '')}>
                  <bdi dir='ltr'>{it.before.trimEnd()}</bdi>
                </span>
                <b className='sp-mistake'>{it.word}</b>
                <span className={'sp-after' + (/^\s/.test(it.after) ? ' gap' : '')}>{it.after.trimStart()}</span>
              </span>
            </div>
          ))}
        </div>
        <div className='sp-label'>Suggestions:</div>
        <div className='sp-suggestions' role='listbox' aria-label='Suggestions'
          title='Double-click a suggestion to change the word to it'>
          {has && !m.suggestions.length && <div className='sp-sugg none'>(no suggestions)</div>}
          {m.suggestions.map((s, i) => (
            <div key={s} role='option' aria-selected={m.chosenIndex === i}
              className={'sp-sugg' + (m.chosenIndex === i ? ' current' : '')}
              onClick={() => m.choose(i)} onDoubleClick={() => { m.choose(i); m.change() }}>{s}</div>
          ))}
        </div>
        <div className='sp-buttons'>
          <button type='button' disabled={!canChange} title='Change this mistake to the selected suggestion'
            onClick={() => m.change()}>Change</button>
          <button type='button' disabled={!canChange}
            title='Change every place this word is spelled so to the selected suggestion'
            onClick={() => m.changeAll()}>Change all</button>
          <button type='button' disabled={!has} title='Leave this one as it is'
            onClick={() => m.ignore()}>Ignore</button>
          <button type='button' disabled={!has} title='Leave this word everywhere, until kTeX closes'
            onClick={() => m.ignoreAll()}>Ignore all</button>
          <button type='button' className='sp-wide' disabled={!has} title='Never flag this word again'
            onClick={() => m.addToDictionary()}>Add to dictionary</button>
        </div>
      </div>
    </div>
  )
}
