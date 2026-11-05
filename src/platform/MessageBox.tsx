// QMessageBox and QProgressDialog for the web view: modal boxes the actions
// await (`await messageBox(...)` returns the clicked button, as exec()).
// They mount themselves on first use, so no component has to host them.
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

export type BoxIcon = 'information' | 'warning' | 'critical' | 'question'

export interface BoxButton {
  label: string
  // The button Enter presses (QMessageBox's default button).
  default?: boolean
  disabled?: boolean
}

export interface BoxOptions {
  title: string
  // Plain text (newlines kept), or `html` for rich text the app built
  // itself — never put unescaped user or file content in it.
  text?: string
  html?: string
  icon?: BoxIcon
  buttons?: BoxButton[]
  minWidth?: number
}

interface OpenBox extends BoxOptions {
  id: number
  // Its place in the stack of open modals (nextModalLayer).
  z?: number
  resolve: (label: string | null) => void
  // Progress boxes: the label is live and the box closes from code.
  progress?: { label: string }
}

const CSS = `
.kmb-veil { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center;
  justify-content: center; background: rgba(0,0,0,0.18); }
.kmb { min-width: 340px; max-width: min(720px, 92vw); max-height: 86vh; display: flex;
  flex-direction: column; border: 1px solid var(--border); border-radius: 6px;
  background: var(--chrome); color: var(--text); box-shadow: 0 8px 28px rgba(0,0,0,0.3);
  font: 13px var(--ui-font); }
.kmb-title { padding: 7px 12px; border-bottom: 1px solid var(--hairline); font-weight: 600; }
.kmb-body { display: flex; gap: 14px; padding: 16px 18px 10px; overflow: auto; }
.kmb-text { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; line-height: 1.4; }
.kmb-rich { white-space: normal; }
.kmb-rich td { vertical-align: top; padding: 3px 6px; }
.kmb-icon { flex: none; width: 34px; height: 34px; border-radius: 50%; display: flex;
  align-items: center; justify-content: center; color: #fff; font: bold 20px var(--ui-font); }
.kmb-icon.information, .kmb-icon.question { background: #2b78d7; }
.kmb-icon.warning { background: #d98a00; }
.kmb-icon.critical { background: #c0392b; }
.kmb-buttons { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px 12px; }
.kmb-buttons button { min-width: 82px; padding: 4px 12px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--base); color: var(--text); font: inherit; }
.kmb-buttons button.default { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.kmb-buttons button:disabled { color: var(--placeholder); }
.kmb-bar { height: 10px; margin: 4px 18px 6px; border: 1px solid var(--border); border-radius: 3px;
  overflow: hidden; background: var(--base); }
.kmb-bar div { width: 30%; height: 100%; background: var(--accent);
  animation: kmb-busy 1.2s linear infinite; }
@keyframes kmb-busy { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
`

// Every modal (message boxes, dialogHost dialogs) takes the next z-index
// when it opens, so the newest one is on top, as Qt stacks a box opened
// from inside a dialog above that dialog.
let layer = 1000
export function nextModalLayer(): number {
  return ++layer
}

let push: ((b: OpenBox) => void) | null = null
let update: ((id: number, label: string) => void) | null = null
let drop: ((id: number) => void) | null = null
let nextId = 1
const pending: OpenBox[] = []

function Host() {
  const [boxes, setBoxes] = useState<OpenBox[]>(pending.splice(0))
  useEffect(() => {
    push = b => setBoxes(bs => [...bs, b])
    update = (id, label) => setBoxes(bs => bs.map(b => (b.id === id ? { ...b, progress: { label } } : b)))
    drop = id => setBoxes(bs => bs.filter(b => b.id !== id))
    // Boxes opened between the first render and this effect.
    if (pending.length) setBoxes(bs => [...bs, ...pending.splice(0)])
  }, [])
  return <>{boxes.map(b => <Box key={b.id} box={b} close={label => { drop?.(b.id); b.resolve(label) }} />)}</>
}

const ICON_GLYPH: Record<BoxIcon, string> = { information: 'i', warning: '!', critical: '×', question: '?' }

function Box({ box, close }: { box: OpenBox; close: (label: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const buttons = box.buttons ?? [{ label: 'OK', default: true }]
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('button.default') ?? ref.current?.querySelector('button')
    el?.focus()
  }, [])
  return (
    <div className='kmb-veil' style={box.z ? { zIndex: box.z } : undefined} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null) }
    }}>
      <div ref={ref} className='kmb' role='dialog' aria-modal='true' aria-label={box.title}
        style={box.minWidth ? { minWidth: box.minWidth } : undefined}>
        <div className='kmb-title'>{box.title}</div>
        <div className='kmb-body'>
          {box.icon && <div className={`kmb-icon ${box.icon}`}>{ICON_GLYPH[box.icon]}</div>}
          {box.html !== undefined
            ? <div className='kmb-text kmb-rich' dangerouslySetInnerHTML={{ __html: box.html }} />
            : <div className='kmb-text'>{box.progress ? box.progress.label : box.text}</div>}
        </div>
        {box.progress && <div className='kmb-bar'><div /></div>}
        <div className='kmb-buttons'>
          {buttons.map(b => (
            <button key={b.label} type='button' className={b.default ? 'default' : ''}
              disabled={b.disabled} onClick={() => close(b.label)}>{b.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function mount(): void {
  if (push || document.getElementById('kmb-root')) return
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  const div = document.createElement('div')
  div.id = 'kmb-root'
  document.body.appendChild(div)
  createRoot(div).render(<Host />)
}

function open(box: OpenBox): void {
  box.z = nextModalLayer()
  mount()
  if (push) push(box)
  else pending.push(box)
}

// The clicked button's label, or null for Escape.
export function messageBox(opts: BoxOptions): Promise<string | null> {
  return new Promise(resolve => open({ ...opts, id: nextId++, resolve }))
}

export const information = (title: string, text: string) =>
  messageBox({ title, text, icon: 'information' }).then(() => undefined)
export const warning = (title: string, text: string) =>
  messageBox({ title, text, icon: 'warning' }).then(() => undefined)
export const critical = (title: string, text: string) =>
  messageBox({ title, text, icon: 'critical' }).then(() => undefined)

// QMessageBox.question with Yes / No; true for Yes.
export async function question(title: string, text: string): Promise<boolean> {
  const r = await messageBox({ title, text, icon: 'question',
    buttons: [{ label: 'Yes', default: true }, { label: 'No' }] })
  return r === 'Yes'
}

export interface ProgressBox {
  setLabel(label: string): void
  close(): void
  // Resolves when the user presses Cancel.
  cancelled: Promise<void>
}

// QProgressDialog with an indeterminate bar and a Cancel button.
export function progressBox(title: string, label: string, minWidth = 450): ProgressBox {
  const id = nextId++
  let onCancel: () => void = () => {}
  const cancelled = new Promise<void>(r => { onCancel = r })
  open({
    id, title, minWidth, progress: { label }, buttons: [{ label: 'Cancel' }],
    resolve: l => { if (l !== '__closed__') onCancel() },
  })
  return {
    setLabel: l => update?.(id, l),
    close: () => drop?.(id),
    cancelled,
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
