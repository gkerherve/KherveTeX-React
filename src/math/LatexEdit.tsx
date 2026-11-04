// LaTeX input field whose placeholder slots are first-class — the
// _EquationLatexEdit of khervedoc/equation_editor.py. Tab / Shift+Tab jump
// between slots instead of inserting a tab, every slot is highlighted, and a
// single click on one selects the whole token so typing replaces it. Typing
// the "}" of \begin{env} closes the environment.
//
// The slot token is configurable because mhchem chokes on a bare \square
// (see chemistry.PLACEHOLDER).
import { useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react'
import { autoCloseBegin, placeholderJump, placeholderSpans } from './fieldLogic.ts'

export interface LatexEditHandle {
  text(): string
  // setPlainText: replaces everything and fires onChange.
  setText(text: string): void
  // QTextCursor.insertText at the caret (replacing the selection).
  insertText(text: string): void
  jumpPlaceholder(forward: boolean): void
  selectPlaceholderAt(pos: number): boolean
  placeholderSpans(): [number, number][]
  selectedText(): string
  focus(): void
}

interface Props {
  placeholder?: string
  hint?: string
  className?: string
  style?: CSSProperties
  onChange?: (text: string) => void
  ref?: Ref<LatexEditHandle>
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function LatexEdit({ placeholder = '\\square', hint = '', className, style, onChange, ref }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const [text, setTextState] = useState('')
  const ph = placeholder

  const changed = (t: string) => {
    setTextState(t)
    onChange?.(t)
  }

  const select = (start: number, end: number) => {
    const el = ta.current!
    el.setSelectionRange(start, end)
  }

  const jump = (forward: boolean) => {
    const el = ta.current!
    const idx = placeholderJump(el.value, ph, el.selectionEnd, forward)
    if (idx === null) return
    select(idx, idx + ph.length)
  }

  const selectAt = (pos: number): boolean => {
    for (const [start, end] of placeholderSpans(ta.current!.value, ph)) {
      if (start <= pos && pos <= end) {
        select(start, end)
        return true
      }
    }
    return false
  }

  const insert = (t: string) => {
    const el = ta.current!
    el.setRangeText(t, el.selectionStart, el.selectionEnd, 'end')
    changed(el.value)
  }

  useImperativeHandle(ref, () => ({
    text: () => ta.current?.value ?? '',
    setText: (t: string) => {
      const el = ta.current!
      el.value = t
      el.setSelectionRange(t.length, t.length)
      changed(t)
    },
    insertText: insert,
    jumpPlaceholder: jump,
    selectPlaceholderAt: selectAt,
    placeholderSpans: () => placeholderSpans(ta.current?.value ?? '', ph),
    selectedText: () => {
      const el = ta.current
      return el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
    },
    focus: () => ta.current?.focus(),
  }))

  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === 'Tab') {
      ev.preventDefault()
      jump(!ev.shiftKey)
      return
    }
    if (ev.key === '}' && !ev.ctrlKey && !ev.metaKey) {
      const el = ta.current!
      const ins = autoCloseBegin(el.value.slice(0, el.selectionStart), ph)
      if (ins !== null) {
        ev.preventDefault()
        insert(ins)
      }
    }
  }

  // Only promote a plain click to a placeholder selection; keep
  // drag-selections exactly as the user made them.
  const onMouseUp = () => {
    const el = ta.current!
    if (el.selectionStart === el.selectionEnd) selectAt(el.selectionStart)
  }

  const onDoubleClick = (ev: React.MouseEvent) => {
    const el = ta.current!
    if (selectAt(el.selectionStart)) ev.preventDefault()
  }

  // The highlight layer under the (transparent-text) textarea.
  let html = ''
  let last = 0
  for (const [s, e] of placeholderSpans(text, ph)) {
    html += escHtml(text.slice(last, s)) + '<mark>' + escHtml(text.slice(s, e)) + '</mark>'
    last = e
  }
  html += escHtml(text.slice(last)) + '\n'

  return (
    <div className={'latexedit ' + (className ?? '')} style={style}>
      <div ref={back} className="latexedit-back" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={ta}
        className="latexedit-text"
        spellCheck={false}
        placeholder={hint}
        onInput={e => changed((e.target as HTMLTextAreaElement).value)}
        onKeyDown={onKeyDown}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClick}
        onScroll={e => {
          if (back.current) {
            back.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop
            back.current.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft
          }
        }}
      />
    </div>
  )
}
