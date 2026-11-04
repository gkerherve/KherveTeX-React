// Shared shell for the chemistry and chemfig editors — _TemplatePaletteDialog
// of khervedoc/equation_editor.py: a rendered preview that updates as you
// type, a category toolbar with template buttons, and a source field with
// Tab-navigable placeholders. Insert closes with the source.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TemplateGroup } from './equations.ts'
import { LatexEdit, type LatexEditHandle } from './LatexEdit.tsx'
import type { RenderedImage } from './mathlayout.ts'
import { svgFit } from './icons.ts'
import { placeholderHint } from './fieldLogic.ts'
import './math.css'

export type Preview =
  | { kind: 'svg'; svg: string }
  | { kind: 'img'; url: string; w: number; h: number }
  | { kind: 'error'; text: string }

export interface PaletteSpec {
  title: string
  groups: TemplateGroup[]
  // A label per category button (no drawn icons in these palettes).
  categoryIcons: string[]
  catCols: number
  catBtnSize: [number, number]
  emptyHint: string
  editHint: string
  sourceLabel: string
  placeholder: string
  // Debounce of the live preview, ms.
  interval: number
  size: [number, number]
  previewMinHeight: number
  renderTemplate: (latex: string) => RenderedImage | null
  // Sync (typeset) or async (a tectonic compile) preview of the source.
  renderLive: (text: string) => Preview | Promise<Preview>
  // A preview started as soon as the dialog is seeded (chemfig).
  previewOnSeed?: boolean
}

interface Props {
  spec: PaletteSpec
  initialLatex?: string
  extra?: ReactNode
  onAccept: (source: string) => void
  onCancel: () => void
  onClosed?: () => void
}

export function PaletteDialog({ spec, initialLatex = '', extra, onAccept, onCancel, onClosed }: Props) {
  const edit = useRef<LatexEditHandle>(null)
  const [cat, setCat] = useState(0)
  const [hint, setHint] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [rendering, setRendering] = useState(false)
  const timer = useRef<number | null>(null)
  const running = useRef(false)
  const pending = useRef(false)
  const alive = useRef(true)

  const updatePreview = () => {
    const text = (edit.current?.text() ?? '').trim()
    if (!text) {
      setPreview(null)
      setRendering(false)
      return
    }
    if (running.current) {
      pending.current = true       // coalesce; re-kick when the current one ends
      return
    }
    const r = spec.renderLive(text)
    if (!(r instanceof Promise)) {
      setPreview(r)
      return
    }
    running.current = true
    setPreview(null)
    setRendering(true)
    void r.then(res => {
      running.current = false
      if (!alive.current) return
      if (pending.current) {
        pending.current = false
        updatePreview()
        return
      }
      setRendering(false)
      setPreview(res)
    })
  }

  const stopPreview = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    pending.current = false
  }

  const onTextChanged = (text: string) => {
    const n = edit.current ? edit.current.placeholderSpans().length : 0
    setHint(placeholderHint(n))
    void text
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { timer.current = null; updatePreview() }, spec.interval)
  }

  useEffect(() => {
    alive.current = true
    // Seed with initial LaTeX, the first empty slot pre-selected so the
    // user can start typing straight away.
    if (initialLatex) {
      edit.current!.setText(initialLatex)
      edit.current!.jumpPlaceholder(true)
      edit.current!.focus()
      if (spec.previewOnSeed) updatePreview()
    }
    return () => {
      alive.current = false
      stopPreview()
      onClosed?.()
    }
    // Mount-only, as the Qt constructor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Insert a template at the cursor, replacing the selected placeholder.
  const insertTemplate = (latex: string) => {
    edit.current!.insertText(latex)
    edit.current!.focus()
    // Jump to the first placeholder of what was just inserted.
    edit.current!.jumpPlaceholder(true)
  }

  const [groupName, items] = spec.groups[cat]!
  const [bw, bh] = spec.catBtnSize

  let body: ReactNode
  if (rendering) body = <span style={{ color: '#888' }}>Rendering…</span>
  else if (preview === null) body = <span style={{ color: '#999' }}>{spec.emptyHint}</span>
  else if (preview.kind === 'error') body = <span style={{ color: '#c00' }}>{preview.text}</span>
  else if (preview.kind === 'svg') body = <span className="pal-svg" dangerouslySetInnerHTML={{ __html: preview.svg }} />
  else body = <img src={preview.url} width={preview.w} height={preview.h} alt="" />

  return (
    <div className="dlg pal" role="dialog" aria-label={spec.title}
      style={{ width: spec.size[0], height: spec.size[1] }}
      onKeyDown={ev => {
        const t = ev.target as HTMLElement
        if (ev.key === 'Enter' && !['TEXTAREA', 'BUTTON'].includes(t.tagName)) {
          ev.preventDefault()
          onAccept(edit.current!.text())
        }
      }}>
      <div className="dlg-title">{spec.title}</div>
      <div className="pal-root">
        <div className="pal-preview" style={{ minHeight: spec.previewMinHeight }}>{body}</div>
        <div className="pal-toolbar" style={{ gridTemplateColumns: `repeat(${spec.catCols}, ${bw}px)` }}>
          {spec.groups.map(([name], idx) => (
            <button key={name} className={'pal-cat' + (cat === idx ? ' sel' : '')} title={name}
              aria-pressed={cat === idx} style={{ width: bw, height: bh }} onClick={() => setCat(idx)}>
              {spec.categoryIcons[idx] || name.slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="pal-catlabel">{groupName}</div>
        <div className="pal-stack">
          <div className="pal-grid">
            {items.map(([latex, label]) => {
              const img = spec.renderTemplate(latex)
              if (img) {
                const icon = svgFit(img, 100, 50)
                return (
                  <button key={latex} className="pal-tpl" title={`${label}\n${latex}`}
                    style={{ width: Math.min(img.width + 12, 112), height: Math.min(img.height + 8, 58) }}
                    onClick={() => insertTemplate(latex)}>
                    <span className="pal-svg" dangerouslySetInnerHTML={{ __html: icon.svg }} />
                  </button>
                )
              }
              return (
                <button key={latex} className="pal-tpl" title={`${label}\n${latex}`} style={{ width: 80, height: 40 }}
                  onClick={() => insertTemplate(latex)}>{label}</button>
              )
            })}
          </div>
        </div>
        <div className="pal-srclabel">{spec.sourceLabel}</div>
        <LatexEdit ref={edit} className="pal-latex" placeholder={spec.placeholder} hint={spec.editHint}
          onChange={onTextChanged} />
        <div className="pal-phhint">{hint}</div>
        {extra}
        <div className="dlg-buttons">
          <button onClick={() => onAccept(edit.current!.text())}>Insert</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
