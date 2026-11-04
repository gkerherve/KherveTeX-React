// The structured WYSIWYG equation editor — EquationEditorDialog of
// khervedoc/equation_editor.py. The equation is edited as typeset math
// (fractions, scripts, roots, matrices ...) in MathEditWidget; the LaTeX is
// generated from the tree and only shown on request.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as mb from './mathbox.ts'
import { EQUATION_GROUPS } from './equations.ts'
import { SYMBOL_GROUPS, isTextModeSymbol } from './symbols.ts'
import { CATEGORY_FACES, SYMBOL_TABS, niceName, symbolInsertLatex, templateName } from './editorData.ts'
import { MathEditWidget, type MathEditHandle } from './MathEditWidget.tsx'
import { LatexEdit, type LatexEditHandle } from './LatexEdit.tsx'
import { renderPixmap, svgFit } from './icons.ts'
import { slotHint } from './fieldLogic.ts'
import { MATH_FAMILY } from './fontData.ts'
import './math.css'

export interface EquationResult {
  latex: string
  display: boolean
  numbered: boolean
}

export interface EquationEditorProps {
  initialLatex?: string
  // null: shown for a new equation, hidden when re-editing one (whose
  // inline/display layout is already decided).
  showLayout?: boolean | null
  display?: boolean
  numbered?: boolean
  close: (r: EquationResult | null) => void
}

const CANVAS_HINT = 'Type to build the equation  ·  /  fraction  ·  ^  superscript'
  + '  ·  _  subscript  ·  \\  commands (e.g. \\alpha)  ·  '
  + 'Tab  next slot  ·  Ctrl + / −  zoom'

const pyLen = (s: string): number => Array.from(s).length

export function EquationEditor({ initialLatex = '', showLayout = null, display = true, numbered = true, close }: EquationEditorProps) {
  const initial = initialLatex.trim()
  const math = useRef<MathEditHandle>(null)
  const edit = useRef<LatexEditHandle>(null)
  const dirty = useRef(false)
  const syncing = useRef(false)
  const [tab, setTab] = useState(0)
  const [cat, setCat] = useState(0)
  const [symTab, setSymTab] = useState(0)
  const [showSource, setShowSource] = useState(false)
  const [isDisplay, setIsDisplay] = useState(display)
  const [isNumbered, setIsNumbered] = useState(numbered)
  const [hint, setHint] = useState('')
  const layoutShown = showLayout === null ? !initial : showLayout

  const updateSlotHint = () => {
    const ed = math.current?.editor
    setHint(slotHint(ed ? mb.countEmpty(ed.root) : 0))
  }

  useEffect(() => {
    const m = math.current!
    m.setDisplay(display)
    if (initial) {
      syncing.current = true
      m.setLatex(initial)
      edit.current!.setText(m.latex(mb.PLACEHOLDER))
      syncing.current = false
      const ed = m.editor
      if (mb.countEmpty(ed.root)) {
        ed.setCursor(ed.root, 0)
        ed.nextSlot()
        m.refresh()
      }
      edit.current!.jumpPlaceholder(true)
    }
    updateSlotHint()
    m.focus()
    // Mount-only: the dialog is seeded once, like the Qt constructor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onMathChanged = () => {
    dirty.current = true
    if (!syncing.current) {
      syncing.current = true
      edit.current?.setText(math.current!.latex(mb.PLACEHOLDER))
      syncing.current = false
    }
    updateSlotHint()
  }

  const onSourceChanged = (text: string) => {
    if (syncing.current) return
    dirty.current = true
    syncing.current = true
    math.current?.setLatex(text)
    syncing.current = false
    updateSlotHint()
  }

  const insertTemplate = (latex: string) => {
    math.current?.insertLatex(mb.normalizeTemplate(latex))
    math.current?.focus()
  }

  const latex = (): string => (dirty.current ? math.current!.latex().trim() : initial)
  const accept = () => close({ latex: latex(), display: isDisplay, numbered: isDisplay && isNumbered })

  const onKeyDown = (ev: React.KeyboardEvent) => {
    // The default button: Enter the canvas did not use inserts.
    const t = ev.target as HTMLElement
    if (ev.key === 'Enter' && !ev.defaultPrevented
      && (t.classList.contains('mathedit-input') || !['TEXTAREA', 'BUTTON'].includes(t.tagName))) {
      ev.preventDefault()
      accept()
    }
  }

  return (
    <div className="dlg eqed" role="dialog" aria-label="Equation editor" onKeyDown={onKeyDown}>
      <div className="dlg-title">Equation editor</div>
      <div className="eqed-ribbon">
        <div className="eqed-tabs">
          {['Structures', 'Symbols'].map((name, i) => (
            <button key={name} className={'eqed-tab' + (tab === i ? ' sel' : '')} onClick={() => setTab(i)}>{name}</button>
          ))}
        </div>
        {tab === 0 ? <Structures cat={cat} setCat={setCat} insert={insertTemplate} />
          : <Symbols tab={symTab} setTab={setSymTab} insert={insertTemplate} />}
      </div>
      <div className="eqed-body">
        <div className="eqed-canvas">
          <div className="eqed-scroll">
            <MathEditWidget ref={math} onChange={onMathChanged} />
          </div>
          <div className="eqed-hint">{CANVAS_HINT}</div>
        </div>
        <div className="eqed-source" hidden={!showSource}>
          <div className="eqed-hint eqed-hint-left">LaTeX — edit here to change the equation</div>
          <LatexEdit ref={edit} className="eqed-latex" placeholder={mb.PLACEHOLDER} onChange={onSourceChanged} />
        </div>
        <div className="eqed-bar">
          <button className={'eqed-toggle' + (showSource ? ' sel' : '')} aria-pressed={showSource}
            onClick={() => setShowSource(s => !s)}>{showSource ? 'Hide LaTeX' : 'Show LaTeX'}</button>
          {layoutShown && (
            <label title={'Checked: a display equation on its own line.\nUnchecked: inline math inside the current paragraph.'}>
              <input type="checkbox" checked={isDisplay}
                onChange={e => { setIsDisplay(e.target.checked); math.current?.setDisplay(e.target.checked) }} />
              Display on its own line
            </label>
          )}
          {layoutShown && (
            <label title="Give the display equation a number, e.g. (1)." className={isDisplay ? '' : 'disabled'}>
              <input type="checkbox" checked={isNumbered} disabled={!isDisplay}
                onChange={e => setIsNumbered(e.target.checked)} />
              Numbered
            </label>
          )}
          <span className="eqed-slothint">{hint}</span>
          <span className="eqed-stretch" />
          <button className="eqed-btn" onClick={() => close(null)}>Cancel</button>
          <button className="eqed-btn primary" onClick={accept}>Insert</button>
        </div>
      </div>
    </div>
  )
}

function Structures({ cat, setCat, insert }: { cat: number; setCat: (i: number) => void; insert: (l: string) => void }) {
  return (
    <div className="eqed-page">
      <div className="eqed-strip">
        {EQUATION_GROUPS.map(([groupName], idx) => {
          const [label, sample] = CATEGORY_FACES[idx] ?? [groupName, '']
          const icon = sample ? svgFit(renderPixmap(sample, 15), 34, 26) : null
          return (
            <button key={groupName} className={'eqed-cat' + (cat === idx ? ' sel' : '')} title={groupName}
              aria-pressed={cat === idx} onClick={() => setCat(idx)}>
              {icon && <span className="eqed-icon" dangerouslySetInnerHTML={{ __html: icon.svg }} />}
              <span>{label}</span>
            </button>
          )
        })}
      </div>
      <div className="eqed-stack eqed-stack-tpl">
        <div className="eqed-flow">
          {EQUATION_GROUPS[cat]![1].map(([latex, preview]) => <TemplateButton key={latex} latex={latex} preview={preview} insert={insert} />)}
        </div>
      </div>
    </div>
  )
}

function TemplateButton({ latex, preview, insert }: { latex: string; preview: string; insert: (l: string) => void }) {
  const icon = useMemo(() => {
    const img = renderPixmap(mb.normalizeTemplate(latex), 17, true)
    let w = img.width
    let h = img.height
    if (w > 150 || h > 84) {
      const s = Math.min(150 / w, 84 / h)
      w *= s
      h *= s
    }
    return { ...svgFit(img, Math.trunc(w), Math.trunc(h)), bw: Math.max(Math.trunc(w) + 18, 52), bh: Math.max(Math.trunc(h) + 12, 44) }
  }, [latex])
  return (
    <button className="eqed-tpl" title={templateName(latex, preview)} style={{ width: icon.bw, height: icon.bh }}
      onClick={() => insert(latex)}>
      <span className="eqed-icon" dangerouslySetInnerHTML={{ __html: icon.svg }} />
    </button>
  )
}

const SYMBOL_PALETTE = SYMBOL_GROUPS.filter(([name]) => name !== 'KherveTeX')

function Symbols({ tab, setTab, insert }: { tab: number; setTab: (i: number) => void; insert: (l: string) => void }) {
  const items = SYMBOL_PALETTE[tab]![1]
  return (
    <div className="eqed-page">
      <div className="eqed-strip">
        {SYMBOL_PALETTE.map(([gname], idx) => {
          const [label, glyph] = SYMBOL_TABS[idx] ?? [gname, '']
          return (
            <button key={gname} className={'eqed-cat eqed-symtab' + (tab === idx ? ' sel' : '')} title={gname}
              aria-pressed={tab === idx} onClick={() => setTab(idx)}>{`${glyph}  ${label}`}</button>
          )
        })}
      </div>
      <div className="eqed-stack eqed-stack-sym">
        <div className="eqed-symgrid">
          {items.map(([latex, glyphTxt]) => {
            if (isTextModeSymbol(latex)) return null
            const ins = symbolInsertLatex(latex)
            const asText = pyLen(glyphTxt) <= 2 && !latex.includes('{')
            const icon = asText ? null : svgFit(renderPixmap(ins, 15), 28, 24)
            return (
              <button key={latex} className="eqed-sym" title={niceName(latex)} style={{ fontFamily: `"${MATH_FAMILY}"` }}
                onClick={() => insert(ins)}>
                {icon ? <span className="eqed-icon" dangerouslySetInnerHTML={{ __html: icon.svg }} /> : glyphTxt}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
