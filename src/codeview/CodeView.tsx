// The Code tab — khervedoc/latex_view.py's LatexView: the document's LaTeX
// with syntax highlighting, a line-number gutter and command completion,
// editable both ways. Edits are reparsed with importTex after the typing
// pauses and replace the document, so the Visual tab and the PDF follow
// (MainWindow._on_latex_edited); a document change re-serializes it.
//
// A transparent <textarea> lies over the highlighted lines: the browser
// handles the caret, selection, IME and undo, the lines below draw the
// colours. Both wrap at the same width, as QPlainTextEdit wraps.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { serializeFor, useCompileUi } from '../app/compile'
import { editorApi } from '../app/editorApi'
import { appStore, replaceDoc, useApp } from '../app/store'
import { importTex } from '../core/importers'
import { ContextMenu, type ContextMenuState } from '../preview/ContextMenu'
import { pdfApi } from '../preview/PdfView'
import { setCommandChecked } from '../ui/commands'
import { setCodeViewApi } from './codeViewApi'
import {
  completions, cursorSnippet, findSnippet, highlightLine, STATE_NORMAL, textUnderCursor, type Span,
} from './highlight'

// QTimer intervals in latex_view.py / mainwindow.py.
const EDIT_DEBOUNCE_MS = 1500
const SUPPRESS_MS = 700
const FONT = "11pt Consolas, Menlo, 'DejaVu Sans Mono', 'Courier New', monospace"
const LINE_HEIGHT = 1.3
const VISIBLE_COMPLETIONS = 7

function useDark(): boolean {
  const get = () => document.documentElement.dataset.theme === 'dark'
  const [dark, setDark] = useState(get)
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(get()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

const Line = memo(function Line({ n, spans }: { n: number; spans: Span[] }) {
  return (
    <div className='cv-line'>
      <span className='cv-num'>{n}</span>
      <span className='cv-text'>
        {spans.length === 0 ? '​' : spans.map((s, i) => (
          <span key={i} style={{
            color: s.fg ?? undefined, background: s.bg ?? undefined,
            fontWeight: s.bold ? 700 : undefined, fontStyle: s.italic ? 'italic' : undefined,
          }}>{s.text}</span>
        ))}
      </span>
    </div>
  )
})

// Highlighted lines, re-using a line's spans while its text and the state
// it starts in are unchanged.
function useHighlighted(text: string, dark: boolean): Span[][] {
  const cache = useRef(new Map<string, { spans: Span[]; state: number }>())
  return useMemo(() => {
    const out: Span[][] = []
    const next = new Map<string, { spans: Span[]; state: number }>()
    let state = STATE_NORMAL
    for (const line of text.split('\n')) {
      const key = `${dark ? 1 : 0}|${state}|${line}`
      let r = cache.current.get(key) ?? next.get(key)
      if (!r) r = highlightLine(line, state, dark)
      next.set(key, r)
      out.push(r.spans)
      state = r.state
    }
    cache.current = next
    return out
  }, [text, dark])
}

interface Popup { items: string[]; index: number; prefix: string; top: number; left: number }

export function CodeView() {
  const doc = useApp(s => s.doc)
  const engine = useCompileUi(u => u.engine)
  const readOnly = engine === 'typst'
  const dark = useDark()
  const [text, setText] = useState(() => serializeFor(doc, engine))
  const lines = useHighlighted(text, dark)
  const area = useRef<HTMLTextAreaElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const [popup, setPopup] = useState<Popup | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppress = useRef(false)
  const pendingCaret = useRef<number | null>(null)

  // set_source: replace the visible source without counting as an edit,
  // keeping the caret where it was.
  useEffect(() => {
    if (suppress.current) return
    const src = serializeFor(doc, engine)
    setText(prev => {
      if (prev === src) return prev
      pendingCaret.current = Math.min(area.current?.selectionStart ?? 0, src.length)
      return src
    })
  }, [doc, engine])

  useLayoutEffect(() => {
    const el = area.current
    if (el && pendingCaret.current !== null && document.activeElement === el) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current)
    }
    pendingCaret.current = null
  }, [text])

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current) }, [])

  // MainWindow._on_latex_edited: the source may be temporarily invalid
  // while the user types, so a bad parse only reports in the status bar.
  const emitEdited = useCallback((src: string) => {
    if (engine === 'typst') return
    let parsed
    try {
      parsed = importTex(src)
    } catch (exc) {
      flashStatus(`LaTeX parse error: ${exc instanceof Error ? exc.message : exc}`)
      return
    }
    suppress.current = true
    try {
      replaceDoc(parsed, { dirty: true })
    } catch (exc) {
      flashStatus(`Could not apply LaTeX changes: ${exc instanceof Error ? exc.message : exc}`)
    } finally {
      // The editor reports its reload on a debounce; release the flag
      // after that window so the round-trip doesn't overwrite the LaTeX.
      setTimeout(() => { suppress.current = false }, SUPPRESS_MS)
    }
  }, [engine])

  // Caret position inside the scrolled content, from a mirror of the text.
  const caretXY = useCallback((pos: number): { top: number; left: number; height: number } => {
    const el = area.current
    const m = mirror.current
    if (!el || !m) return { top: 0, left: 0, height: 16 }
    m.style.width = `${el.clientWidth}px`
    m.textContent = el.value.slice(0, pos)
    const mark = document.createElement('span')
    mark.textContent = '​'
    m.appendChild(mark)
    return { top: el.offsetTop + mark.offsetTop, left: el.offsetLeft + mark.offsetLeft, height: mark.offsetHeight }
  }, [])

  const updateCompleter = useCallback(() => {
    const el = area.current
    if (!el) return
    const pos = el.selectionStart
    const lineStart = el.value.lastIndexOf('\n', pos - 1) + 1
    const prefix = textUnderCursor(el.value.slice(lineStart, pos))
    // At least \ + one letter.
    const items = prefix.length >= 2 ? completions(prefix) : []
    if (!items.length) { setPopup(null); return }
    const c = caretXY(pos)
    setPopup({ items, index: 0, prefix, top: c.top + c.height, left: c.left })
  }, [caretXY])

  const onChange = (value: string) => {
    setText(value)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { debounce.current = null; emitEdited(value) }, EDIT_DEBOUNCE_MS)
    updateCompleter()
  }

  const insertCompletion = (completion: string) => {
    const el = area.current
    if (!el || !popup) return
    el.focus()
    // Remove the prefix already typed, then insert the full completion;
    // insertText keeps the browser's undo history.
    el.setSelectionRange(el.selectionStart - popup.prefix.length, el.selectionStart)
    if (!document.execCommand('insertText', false, completion)) {
      el.setRangeText(completion, el.selectionStart, el.selectionEnd, 'end')
      onChange(el.value)
    }
    setPopup(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!popup) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      setPopup({ ...popup, index: (popup.index + d + popup.items.length) % popup.items.length })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertCompletion(popup.items[popup.index])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setPopup(null)
    }
  }

  // Keep the selected completion in view.
  const popupRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    popupRef.current?.children[popup?.index ?? 0]?.scrollIntoView({ block: 'nearest' })
  }, [popup])

  const snippet = useCallback((): string => {
    const el = area.current
    if (!el) return ''
    const pos = el.selectionStart
    const start = el.value.lastIndexOf('\n', pos - 1) + 1
    let end = el.value.indexOf('\n', pos)
    if (end < 0) end = el.value.length
    return cursorSnippet(el.value.slice(start, end), pos - start)
  }, [])

  // LatexView.scroll_to_snippet: caret on the match, centred.
  const scrollToSnippet = useCallback((s: string): boolean => {
    const el = area.current
    const sc = scroller.current
    if (!el || !sc) return false
    const idx = findSnippet(el.value, s)
    if (idx < 0) return false
    el.focus()
    el.setSelectionRange(idx, idx)
    const c = caretXY(idx)
    sc.scrollTop = Math.max(0, c.top - sc.clientHeight / 2)
    return true
  }, [caretXY])

  useEffect(() => {
    const api = { scrollToSnippet, cursorSnippet: snippet }
    setCodeViewApi(api)
    return () => setCodeViewApi(null)
  }, [scrollToSnippet, snippet])

  // MainWindow._nav_latex_to_formatted / _nav_latex_to_pdf.
  const showInVisual = () => {
    const s = snippet()
    if (s && editorApi()?.revealText(s)) appStore().set({ tab: 'visual' })
  }
  const showInPdf = () => {
    const s = snippet()
    if (!s) return
    const st = appStore().get()
    // _show_side_tab: bring the side panel back if the PDF is hidden.
    if (st.layout !== 'side' && st.layout !== 'window') {
      appStore().set({ layout: 'side', autoCompile: true })
      setCommandChecked('side_by_side', true)
    }
    setTimeout(() => void pdfApi()?.findText(s), 50)
  }

  const exec = (cmd: string) => () => {
    area.current?.focus()
    document.execCommand(cmd)
  }
  const paste = async () => {
    const el = area.current
    if (!el || readOnly) return
    try {
      const t = await navigator.clipboard.readText()
      el.focus()
      if (!document.execCommand('insertText', false, t)) {
        el.setRangeText(t, el.selectionStart, el.selectionEnd, 'end')
        onChange(el.value)
      }
    } catch { /* clipboard access refused */ }
  }

  const digits = Math.max(1, String(lines.length).length)
  // _NumberedPlainTextEdit.line_number_area_width: 8 px + (digits + 1) digits.
  const gutter = `calc(8px + ${digits + 1}ch)`

  return (
    <div ref={scroller} className='cv-scroll' style={{
      position: 'relative', height: '100%', overflow: 'auto', background: 'var(--base)', color: 'var(--text)',
      font: FONT, lineHeight: LINE_HEIGHT,
    }}>
      <style>{CSS}</style>
      <div style={{ position: 'relative', minHeight: '100%', ['--cv-gutter' as string]: gutter }}>
        <div aria-hidden='true'>
          {lines.map((spans, i) => <Line key={i} n={i + 1} spans={spans} />)}
        </div>
        <div className='cv-gutter-bg' />
        <textarea ref={area} className='cv-input' value={text} readOnly={readOnly} spellCheck={false}
          autoCapitalize='off' autoComplete='off' autoCorrect='off' wrap='soft'
          onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown}
          onBlur={() => setPopup(null)}
          onContextMenu={e => {
            e.preventDefault()
            setMenu({
              x: e.clientX, y: e.clientY, items: [
                { label: 'Undo', run: exec('undo'), disabled: readOnly },
                { label: 'Redo', run: exec('redo'), disabled: readOnly },
                '-',
                { label: 'Cut', run: exec('cut'), disabled: readOnly },
                { label: 'Copy', run: exec('copy') },
                { label: 'Paste', run: () => void paste(), disabled: readOnly },
                { label: 'Delete', run: exec('delete'), disabled: readOnly },
                '-',
                { label: 'Select All', run: exec('selectAll') },
                '-',
                { label: 'Show in Visual', run: showInVisual },
                { label: 'Show in PDF', run: showInPdf },
              ],
            })
          }} />
        <div ref={mirror} className='cv-mirror' aria-hidden='true' />
        {popup && (
          <div ref={popupRef} className='cv-popup' style={{ top: popup.top, left: popup.left }}
            onMouseDown={e => e.preventDefault()}>
            {popup.items.map((it, i) => (
              <div key={it} className={'cv-item' + (i === popup.index ? ' on' : '')}
                onClick={() => insertCompletion(it)}>{it}</div>
            ))}
          </div>
        )}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

let statusTimer: ReturnType<typeof setTimeout> | null = null
// statusBar().showMessage(msg, 5000)
function flashStatus(msg: string): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, 5000)
}

// The lines and the textarea must wrap identically: same font, padding,
// width and wrapping rules.
const CSS = `
.cv-line { display: flex; }
.cv-num { flex: none; width: var(--cv-gutter); box-sizing: border-box; padding-right: 4px; text-align: right;
  color: var(--text-muted); user-select: none; position: relative; z-index: 1; }
.cv-text, .cv-input, .cv-mirror { white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal;
  tab-size: 8; padding: 0 4px; }
.cv-text { flex: 1; min-width: 0; }
.cv-gutter-bg { position: absolute; left: 0; top: 0; bottom: 0; width: var(--cv-gutter); background: var(--surface); }
.cv-input { position: absolute; top: 0; left: var(--cv-gutter); width: calc(100% - var(--cv-gutter));
  height: 100%; box-sizing: border-box; margin: 0; border: 0; outline: none; resize: none; overflow: hidden;
  background: transparent; color: transparent; caret-color: var(--text); font: inherit; line-height: inherit; }
.cv-input::selection { background: rgba(43, 120, 215, 0.35); color: transparent; }
.cv-mirror { position: absolute; top: 0; left: var(--cv-gutter); visibility: hidden; box-sizing: border-box; }
.cv-popup { position: absolute; z-index: 20; width: 280px; max-height: calc(${VISIBLE_COMPLETIONS} * 1.6em); overflow-y: auto;
  border: 1px solid var(--border); background: var(--base); box-shadow: 0 3px 10px rgba(0,0,0,0.18); font-size: 10pt; }
.cv-item { padding: 1px 6px; white-space: nowrap; cursor: default; }
.cv-item.on { background: var(--accent); color: #fff; }
`
