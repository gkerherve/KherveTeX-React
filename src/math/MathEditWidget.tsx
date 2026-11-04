// The WYSIWYG equation canvas: paints a mathbox tree as typeset math and
// edits it with the keyboard and mouse, Word-equation style —
// khervedoc/math_widget.py (MathEditWidget and its completer).
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import * as mb from './mathbox.ts'
import * as ml from './mathlayout.ts'
import { MATH_FAMILY } from './fontData.ts'
import { mathReady } from './render.ts'

const SEL = '#cfe0ff'
const SLOT = 'rgba(47, 111, 222, 0.0706)'
const CARET = '#1f5fd1'
const MARGIN = 28

export interface MathEditHandle {
  editor: mb.Editor
  setLatex(latex: string): void
  latex(placeholder?: string): string
  insertLatex(latex: string): void
  setDisplay(display: boolean): void
  zoom(factor: number | null): void
  fontPx(): number
  focus(): void
  hasFocus(): boolean
  rows(): Map<mb.Row, ml.RowGeom>
  // Repaint after driving the editor directly (cursor moves).
  refresh(): void
}

interface Props {
  onChange?: () => void
  ref?: Ref<MathEditHandle>
}

function activeRef(e: mb.Editor): ml.PhRef | null {
  if (!e.row.children.length) return e.row
  const ch = e.row.children
  if (e.idx < ch.length && ch[e.idx] instanceof mb.Placeholder) return ch[e.idx]!
  if (e.idx > 0 && ch[e.idx - 1] instanceof mb.Placeholder) return ch[e.idx - 1]!
  return null
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function MathEditWidget({ onChange, ref }: Props) {
  const editorRef = useRef<mb.Editor | null>(null)
  if (editorRef.current === null) editorRef.current = new mb.Editor()
  const ed = editorRef.current
  const [px, setPx] = useState(34.0)
  const [display, setDisplayState] = useState(true)
  const [, setTick] = useState(0)
  const [focused, setFocused] = useState(false)
  const [caretOn, setCaretOn] = useState(true)
  const [size, setSize] = useState({ w: 560, h: 220 })
  const [compSel, setCompSel] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const seenVersion = useRef(-1)
  const dragAnchor = useRef<[mb.Row, number] | null>(null)
  const pxRef = useRef(px)
  pxRef.current = px
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => { void mathReady().then(() => setTick(t => t + 1)) }, [])

  // ---- layout (recomputed on every render; cheap at equation sizes)
  const box = new ml.Layout(px, display).layout(ed.root)
  const needW = Math.max(200, Math.trunc(box.w + 2 * MARGIN))
  const needH = Math.max(120, Math.trunc(box.asc + box.desc + 2 * MARGIN))
  const W = Math.max(size.w, needW)
  const H = Math.max(size.h, needH)
  const ox = Math.max(MARGIN, (W - box.w) / 2)
  const oy = Math.max(MARGIN + box.asc, (H - box.asc - box.desc) / 2 + box.asc)
  const rows = ml.collectRows(box, ox, oy)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // ---- caret blink
  useEffect(() => {
    if (!focused) return
    const t = window.setInterval(() => setCaretOn(c => !c), 530)
    return () => window.clearInterval(t)
  }, [focused, ed.version])

  const afterEdit = useCallback((emit = true) => {
    setCaretOn(true)
    setCompSel(0)
    setTick(t => t + 1)
    if (emit && ed.version !== seenVersion.current) {
      seenVersion.current = ed.version
      onChangeRef.current?.()
    } else if (!emit) seenVersion.current = ed.version
  }, [ed])

  const zoom = useCallback((factor: number | null) => {
    setPx(p => (factor === null ? 34.0 : Math.max(16.0, Math.min(96.0, p * factor))))
  }, [])

  useImperativeHandle(ref, () => ({
    editor: ed,
    setLatex: (latex: string) => { ed.setLatex(latex); afterEdit(false) },
    latex: (placeholder = '{}') => ed.latex(placeholder),
    insertLatex: (latex: string) => { ed.insertLatex(latex); afterEdit() },
    setDisplay: (d: boolean) => setDisplayState(d),
    zoom,
    fontPx: () => pxRef.current,
    focus: () => inputRef.current?.focus(),
    hasFocus: () => document.activeElement === inputRef.current,
    rows: () => rowsRef.current,
    refresh: () => afterEdit(false),
  }), [ed, afterEdit, zoom])

  // ---- hit test
  const hit = (x: number, y: number): [mb.Row, number] => {
    let best: [number, ml.RowGeom] | null = null
    for (const g of rows.values()) {
      const [rx, ry, rw, rh] = g.rect()
      if (x >= rx - 2 && x <= rx + rw + 2 && y >= ry - 2 && y <= ry + rh + 2) {
        const area = (rw + 4) * (rh + 4)
        if (best === null || area < best[0]) best = [area, g]
      }
    }
    let g: ml.RowGeom
    if (best === null) {
      const dist = (q: ml.RowGeom) => {
        const [rx, ry, rw, rh] = q.rect()
        const dx = Math.max(rx - x, 0, x - (rx + rw))
        const dy = Math.max(ry - y, 0, y - (ry + rh))
        return dx * dx + dy * dy
      }
      g = [...rows.values()].reduce((a, b) => (dist(b) < dist(a) ? b : a))
    } else g = best[1]
    let idx = 0
    g.gaps.forEach((gx, k) => { if (Math.abs(gx - x) < Math.abs(g.gaps[idx]! - x)) idx = k })
    return [g.row, idx]
  }

  const local = (ev: { clientX: number; clientY: number }): [number, number] => {
    const r = hostRef.current!.getBoundingClientRect()
    return [ev.clientX - r.left, ev.clientY - r.top]
  }

  const onMouseDown = (ev: React.MouseEvent) => {
    if (ev.button !== 0) return
    ev.preventDefault()
    inputRef.current?.focus()
    const [row, idx] = hit(...local(ev))
    if (ev.detail >= 2) {
      // mouseDoubleClickEvent: select the whole row under the pointer.
      ed.setCursor(row, 0)
      ed.setSelection(row, 0, row, row.children.length)
      dragAnchor.current = null
      afterEdit()
      return
    }
    if (ev.shiftKey) {
      const a: [mb.Row, number] = ed.anchor || [ed.row, ed.idx]
      ed.setSelection(a[0], a[1], row, idx)
      dragAnchor.current = a
    } else {
      ed.setCursor(row, idx)
      dragAnchor.current = [row, idx]
    }
    afterEdit()
    const move = (e: MouseEvent) => {
      if (dragAnchor.current === null || !(e.buttons & 1)) return
      const [r2, i2] = hit(...local(e))
      const a = dragAnchor.current
      ed.setSelection(a[0], a[1], r2, i2)
      afterEdit()
    }
    const up = () => {
      dragAnchor.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---- completion
  const items = ed.cmd !== null && ed.cmd.text ? mb.completions(ed.cmd.text) : []
  const popup = focused && items.length > 0

  const acceptCompletion = (i = compSel) => {
    const name = items[i]?.[0] ?? null
    ed.commitCmd(name)
    afterEdit()
    inputRef.current?.focus()
  }

  // ---- keyboard
  const onKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const key = ev.key
    const ctrl = isMac ? ev.metaKey : ev.ctrlKey
    const shift = ev.shiftKey
    if (ev.nativeEvent.isComposing) return
    if (popup && (key === 'ArrowUp' || key === 'ArrowDown')) {
      ev.preventDefault()
      setCompSel(s => Math.max(0, Math.min(items.length - 1, s + (key === 'ArrowDown' ? 1 : -1))))
      return
    }
    if (popup && (key === 'Tab' || key === 'Enter')) {
      ev.preventDefault()
      ev.stopPropagation()
      acceptCompletion()
      return
    }
    const lower = key.length === 1 ? key.toLowerCase() : key
    let handled = true
    if (ctrl && lower === 'z' && !shift) ed.undo()
    else if (ctrl && ((lower === 'z' && shift) || lower === 'y')) ed.redo()
    else if (ctrl && (lower === 'c' || lower === 'x' || lower === 'v')) return   // clipboard events below
    else if (ctrl && lower === 'a') ed.selectAll()
    else if (ctrl && (key === '+' || key === '=')) { ev.preventDefault(); zoom(1.15); return }
    else if (ctrl && key === '-') { ev.preventDefault(); zoom(1 / 1.15); return }
    else if (ctrl && key === '0') { ev.preventDefault(); zoom(null); return }
    else if (key === 'ArrowLeft') ed.moveLeft(shift)
    else if (key === 'ArrowRight') ed.moveRight(shift)
    else if (key === 'Home') ed.home(shift)
    else if (key === 'End') ed.end(shift)
    else if (key === 'ArrowUp') ed.moveVertical(true)
    else if (key === 'ArrowDown') ed.moveVertical(false)
    else if (key === 'Tab') ed.nextSlot(!shift)
    else if (key === 'Backspace') ed.backspace()
    else if (key === 'Delete') ed.delete()
    else if (key === 'Escape') {
      if (ed.cmd !== null) ed.cancelCmd()
      else if (ed.hasSelection()) ed.clearSelection()
      else return             // let the dialog close
    } else if (key === 'Enter') {
      if (ed.cmd !== null) ed.commitCmd()
      else if (shift && ed.matrixAddCol()) { /* added a column */ }
      else if (!ed.matrixAddRow()) return   // let the dialog's Insert button fire
    } else handled = false   // printable text arrives through onInput
    if (!handled) return
    ev.preventDefault()
    ev.stopPropagation()
    afterEdit()
  }

  // Typed text (keys, IME, dictation) lands in the hidden field; take it out
  // and type it into the equation.
  const onInput = (ev: React.FormEvent<HTMLTextAreaElement>) => {
    const el = ev.currentTarget
    const text = el.value
    el.value = ''
    if (!text || [...text].some(c => /\p{Cc}/u.test(c) && c !== ' ')) return
    if (ed.row.owner instanceof mb.Text || ed.cmd !== null || text !== ' ') ed.typeText(text)
    else ed.typeChar(' ')
    afterEdit()
  }

  const onCopy = (ev: React.ClipboardEvent) => {
    const text = ed.selectionLatex() || ed.latex()
    if (text) ev.clipboardData.setData('text/plain', text)
    ev.preventDefault()
  }
  const onCut = (ev: React.ClipboardEvent) => {
    onCopy(ev)
    ed.deleteSelection()
    afterEdit()
  }
  const onPaste = (ev: React.ClipboardEvent) => {
    ev.preventDefault()
    const text = ev.clipboardData.getData('text/plain')
    if (text) {
      ed.pasteLatex(text.trim().replace(/^\$+|\$+$/g, ''))
      afterEdit()
    }
  }

  // ---- paint
  const g = rows.get(ed.row) ?? null
  const sel = ed.selection()
  const parts: string[] = []
  if (g !== null && ed.row !== ed.root && ed.row.children.length) {
    const [rx, ry, rw, rh] = g.rect()
    parts.push(`<rect x="${ml.n3(rx - 3)}" y="${ml.n3(ry - 2)}" width="${ml.n3(rw + 6)}" height="${ml.n3(rh + 4)}" rx="3" fill="${SLOT}"/>`)
  }
  if (sel !== null && g !== null) {
    const [, i, j] = sel
    const [top, bot] = g.caretSpan()
    parts.push(`<rect x="${ml.n3(g.gaps[i]!)}" y="${ml.n3(top)}" width="${ml.n3(g.gaps[j]! - g.gaps[i]!)}" height="${ml.n3(bot - top)}" fill="${SEL}"/>`)
  }
  parts.push(ml.paint(box, ox, oy, { active: focused ? activeRef(ed) : null }))
  if (!ed.root.children.length) {
    parts.push(`<text x="${ml.n3(W / 2)}" y="${ml.n3(oy + px * 0.35)}" text-anchor="middle" dominant-baseline="hanging" `
      + `font-family="${MATH_FAMILY}" font-style="italic" font-size="${Math.trunc(px * 0.42)}" fill="#a7b0bc">Type an equation here</text>`)
  }
  let caretX = 0
  let caretTop = 0
  let caretBot = 0
  if (g !== null) {
    caretX = g.gaps[Math.min(ed.idx, g.gaps.length - 1)]!
    ;[caretTop, caretBot] = g.caretSpan()
    if (focused && caretOn && sel === null) {
      parts.push(`<line x1="${ml.n3(caretX)}" y1="${ml.n3(caretTop)}" x2="${ml.n3(caretX)}" y2="${ml.n3(caretBot)}" `
        + `stroke="${CARET}" stroke-width="${ml.n3(Math.max(1.5, px / 22))}"/>`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="display:block;white-space:pre">${parts.join('')}</svg>`

  return (
    <div ref={hostRef} className="mathedit" style={{ minWidth: needW, minHeight: needH }} onMouseDown={onMouseDown}>
      <div className="mathedit-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      <textarea
        ref={inputRef}
        className="mathedit-input"
        aria-label="Equation"
        defaultValue=""
        onInput={onInput}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onFocus={() => { setFocused(true); setCaretOn(true) }}
        onBlur={() => setFocused(false)}
        style={{ left: caretX, top: caretBot }}
      />
      {popup && (
        <ul className="mathedit-completer" style={{ left: caretX, top: caretBot + 6, height: Math.min(items.length, 8) * 26 + 10 }}
          onMouseDown={e => e.preventDefault()}>
          {items.map(([name, glyph], i) => (
            <li key={name} className={i === compSel ? 'sel' : ''} onClick={() => acceptCompletion(i)}>
              <span className="mathedit-glyph">{glyph}</span>{'\\' + name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
