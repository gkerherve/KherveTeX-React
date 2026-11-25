// The compact find & replace bar along the bottom of the editor area
// (mainwindow._FindBar, _do_find, _do_replace, _do_replace_all). It
// searches the view that shows: the Visual page (EditorApi) or the Code
// tab's LaTeX (CodeViewApi), as you type, with the match count.
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { editorApi } from '../../app/editorApi'
import { appStore } from '../../app/store'
import { codeViewApi } from '../../codeview/codeViewApi'
import './editorDialogs.css'

let root: Root | null = null
let host: HTMLDivElement | null = null
let setShown: ((s: { replace: boolean; serial: number } | null) => void) | null = null
let serial = 0
// What the bar shows when it first mounts.
let pending: { replace: boolean; serial: number } | null = null

function place(el: HTMLElement): void {
  // Along the bottom of the desk, as the bar sits under the editor.
  const desk = document.querySelector('.desk')
  const r = desk?.getBoundingClientRect()
  if (!r || r.width === 0) {
    Object.assign(el.style, { left: '0px', right: '0px', bottom: '24px', top: '' })
    return
  }
  Object.assign(el.style, { left: `${r.left}px`, width: `${r.width}px`, top: '', bottom: `${innerHeight - r.bottom}px` })
}

function status(msg: string): void {
  appStore().set({ status: msg })
}

// The view the bar searches: the Code tab's LaTeX when it shows, else the
// Visual page.
const inCode = () => appStore().get().tab === 'code'

// What is selected where the bar opens (a word to look for).
function selectedText(): string {
  if (inCode()) {
    const el = document.querySelector<HTMLTextAreaElement>('.cv-input')
    const t = el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
    return t.includes('\n') ? '' : t
  }
  const t = editorApi()?.selection().selectedText ?? ''
  return t.includes('\n') ? '' : t
}

function Bar() {
  const [shown, setS] = useState<{ replace: boolean; serial: number } | null>(pending)
  const [text, setText] = useState('')
  const [repl, setRepl] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [where, setWhere] = useState<{ index: number; count: number } | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  setShown = setS
  useEffect(() => {
    if (!shown) return
    const sel = selectedText()
    if (sel) setText(sel)
    field.current?.focus()
    setTimeout(() => field.current?.select(), 0)
    if (bar.current) place(bar.current)
    const onResize = () => { if (bar.current) place(bar.current) }
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [shown])
  const opts = { caseSensitive: matchCase, wholeWord }
  const go = (from: 'next' | 'previous' | 'here') => {
    if (!text) { setWhere(null); codeViewApi()?.clearFind(); return }
    if (inCode()) {
      const r = codeViewApi()?.find(text, from, opts)
      setWhere(r ?? null)
      return
    }
    const api = editorApi()
    if (!api) return
    if (from === 'here' && api.findHere) api.findHere(text, opts)
    else api.find(text, { ...opts, forward: from !== 'previous' })
    setWhere(api.findCount?.(text, opts) ?? null)
  }
  // As you type: the first match from here.
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => go('here'), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, matchCase, wholeWord, shown])
  if (!shown) return null
  const replaceOne = () => {
    if (!text) return
    if (inCode()) { setWhere(codeViewApi()?.replace(text, repl, opts) ?? null); return }
    const api = editorApi()
    if (!api) return
    if (!api.replace(text, repl, opts)) status(`"${text}" not found`)
    setWhere(api.findCount?.(text, opts) ?? null)
  }
  const replaceAll = () => {
    if (!text) return
    const n = inCode() ? (codeViewApi()?.replaceAll(text, repl, opts) ?? 0) : (editorApi()?.replaceAll(text, repl, opts) ?? 0)
    status(`Replaced ${n} occurrence${n !== 1 ? 's' : ''}`)
    setWhere({ index: -1, count: 0 })
  }
  const close = () => {
    setS(null)
    codeViewApi()?.clearFind()
    if (inCode()) document.querySelector<HTMLTextAreaElement>('.cv-input')?.focus()
    else editorApi()?.focus()
  }
  const count = !text || !where ? '' : where.count === 0 ? 'No matches' : where.index >= 0 ? `${where.index + 1} of ${where.count}` : `${where.count} found`
  return (
    <div ref={bar} className='kt-findbar' onKeyDown={e => { if (e.key === 'Escape') close() }}>
      <label>Find{inCode() ? ' in LaTeX' : ''}:</label>
      <input ref={field} type='text' value={text} placeholder='Search text...'
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? 'previous' : 'next') } }} />
      <span className={`kt-findbar-count${where && where.count === 0 && text ? ' none' : ''}`}>{count}</span>
      <button type='button' onClick={() => go('previous')} title='Previous match (Shift+Enter)'>Previous</button>
      <button type='button' onClick={() => go('next')} title='Next match (Enter)'>Next</button>
      <label><input type='checkbox' checked={matchCase} onChange={e => setMatchCase(e.target.checked)} /> Match case</label>
      <label><input type='checkbox' checked={wholeWord} onChange={e => setWholeWord(e.target.checked)} /> Whole word</label>
      <button type='button' className='kt-findbar-close' aria-label='Close' onClick={close}>x</button>
      {shown.replace && <>
        <label>Replace:</label>
        <input type='text' value={repl} placeholder='Replacement text...' onChange={e => setRepl(e.target.value)} />
        <button type='button' onClick={replaceOne}>Replace</button>
        <button type='button' onClick={replaceAll}>Replace all</button>
      </>}
    </div>
  )
}

// _show_find_bar / _show_replace_bar.
export function showFindBar(replace: boolean): void {
  if (!root) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    serial += 1
    pending = { replace, serial }
    root.render(<Bar />)
    return
  }
  serial += 1
  setShown?.({ replace, serial })
}
