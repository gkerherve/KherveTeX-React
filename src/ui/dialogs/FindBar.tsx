// The compact find & replace bar along the bottom of the editor area
// (mainwindow._FindBar, _do_find, _do_replace, _do_replace_all). It
// searches the Visual tab through the EditorApi.
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { editorApi } from '../../app/editorApi'
import { appStore } from '../../app/store'
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

function Bar() {
  const [shown, setS] = useState<{ replace: boolean; serial: number } | null>(pending)
  const [text, setText] = useState('')
  const [repl, setRepl] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  setShown = setS
  useEffect(() => {
    if (!shown) return
    field.current?.focus()
    field.current?.select()
    if (bar.current) place(bar.current)
    const onResize = () => { if (bar.current) place(bar.current) }
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [shown])
  if (!shown) return null
  const opts = { caseSensitive: matchCase, wholeWord: false }
  const find = (forward: boolean) => {
    if (!text) return
    const api = editorApi()
    if (!api) return
    if (!api.find(text, { ...opts, forward })) status(`"${text}" not found`)
  }
  const replaceOne = () => {
    if (!text) return
    const api = editorApi()
    if (!api) return
    if (!api.replace(text, repl, opts)) status(`"${text}" not found`)
  }
  const replaceAll = () => {
    if (!text) return
    const n = editorApi()?.replaceAll(text, repl, opts) ?? 0
    status(`Replaced ${n} occurrence${n !== 1 ? 's' : ''}`)
  }
  const close = () => { setS(null); editorApi()?.focus() }
  return (
    <div ref={bar} className='kt-findbar' onKeyDown={e => { if (e.key === 'Escape') close() }}>
      <label>Find:</label>
      <input ref={field} type='text' value={text} placeholder='Search text...'
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); find(!e.shiftKey) } }} />
      <button type='button' onClick={() => find(false)}>Previous</button>
      <button type='button' onClick={() => find(true)}>Next</button>
      <label><input type='checkbox' checked={matchCase} onChange={e => setMatchCase(e.target.checked)} /> Match case</label>
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
