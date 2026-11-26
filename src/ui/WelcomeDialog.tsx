// The welcome page shown at start (khervedoc/welcome.py): what to open, and
// how to work. The layout choice is asked every time (unless switched off)
// because it depends on the task: side by side with the live PDF when the
// LaTeX output matters, or the visual editor alone — like Word — with the
// PDF, console and background compiles off.
import { AppIcon } from './icons'
import { isBetaExample } from './pageBeta'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FEEDBACK_EMAIL, SHORT_NAME, VERSION } from '../version'
import type { LayoutMode } from '../app/store'
import { basename, dirname } from '../core/paths'

export type WelcomeChoice =
  | { kind: 'continue' } | { kind: 'new' } | { kind: 'open' } | { kind: 'project' }
  | { kind: 'tour' } | { kind: 'example'; index: number } | { kind: 'recent'; path: string }

export interface WelcomeResult {
  choice: WelcomeChoice
  layout: LayoutMode
  showAtStart: boolean
}

export const MODES: [LayoutMode, string, string][] = [
  ['side', 'Visual + PDF side by side',
    'Edit on the left and watch the compiled LaTeX PDF on the right, updated as you type.'],
  ['window', 'Visual + PDF in its own window',
    'The PDF in a separate window you can put on a second screen; close it to dock it back.'],
  ['visual', 'Visual only',
    'The page with the Documents list beside it. The PDF is hidden and nothing compiles while you write.'],
  ['page', 'Page only — like Word',
    'Just the page: the Documents list is hidden too. Bring anything back from the View menu.'],
]

const START: [string, string, WelcomeChoice][] = [
  ['\u{1F4C4}  New document', 'A blank page', { kind: 'new' }],
  ['\u{1F4C2}  Open…', 'Open or import a document (.ktex, .tex, .docx, .md, .pdf)', { kind: 'open' }],
  ['\u{1F4DA}  New project (thesis, book)…', 'Several documents compiled into one PDF', { kind: 'project' }],
  ['\u{1F9ED}  Take the guided tour', 'A multi-page document that shows what kTeX does', { kind: 'tour' }],
]


function Welcome({ recent, recentExists, examples, layout, showAtStart, done }: {
  recent: string[]; recentExists: boolean[]; examples: string[]; layout: LayoutMode; showAtStart: boolean
  done: (r: WelcomeResult) => void
}) {
  // The way of working is chosen in the View menu; the page keeps it.
  const mode = layout
  const [again, setAgain] = useState(showAtStart)
  const [exSel, setExSel] = useState(-1)
  const [recSel, setRecSel] = useState(-1)
  const finish = (choice: WelcomeChoice) => done({ choice, layout: mode, showAtStart: again })
  const heading = (t: string) => <div style={{ fontWeight: 700, fontSize: '1.12em', marginBottom: 6 }}>{t}</div>
  const list: React.CSSProperties = {
    flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--border)', background: 'var(--base)',
  }
  const item = (sel: boolean, disabled = false): React.CSSProperties => ({
    padding: '3px 6px', cursor: 'default', whiteSpace: 'pre-wrap',
    background: sel ? 'var(--accent)' : undefined, color: sel ? '#fff' : disabled ? 'var(--placeholder)' : undefined,
  })

  return (
    <div className='kmb-veil' style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'transparent' }}
      onKeyDown={e => { if (e.key === 'Escape') finish({ kind: 'continue' }) }}>
      <div className='kwin' role='dialog' aria-label={`Welcome to ${SHORT_NAME}`} style={{
        width: 'min(960px, 94vw)', height: 'min(640px, 90vh)', minWidth: 600, display: 'flex', flexDirection: 'column',
        gap: 14, boxSizing: 'border-box', padding: '18px 22px 16px', border: '1px solid var(--border)', borderRadius: 6,
        background: 'var(--chrome)', color: 'var(--text)', boxShadow: '0 8px 28px rgba(0,0,0,0.3)',
      }}>
        <div className='kwin-title' style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AppIcon size={64} />
          <div>
            <div style={{ fontSize: 22 * 4 / 3, fontWeight: 700 }}>{SHORT_NAME}</div>
            <div>Write like in Word, publish in LaTeX — {VERSION}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          <div style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {heading('Start')}
            {START.map(([label, tip, choice]) => (
              <button key={label} type='button' title={tip} onClick={() => finish(choice)} style={{
                minHeight: 34, textAlign: 'left', paddingLeft: 12, border: '1px solid var(--border)', borderRadius: 4,
                background: 'var(--base)', color: 'var(--text)', font: 'inherit',
              }}>{label}</button>
            ))}
          </div>
          <div style={{ flex: 3, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {heading('Examples & templates')}
            <div style={list}>
              {examples.map((label, i) => (
                <div key={label} style={item(exSel === i)} onClick={() => setExSel(i)}
                  onDoubleClick={() => finish({ kind: 'example', index: i })}>
                  {label}{isBetaExample(label) && <span className='beta-tag' style={{ marginLeft: 6 }}
                    title='The page view of this template is in beta'>beta</span>}
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 4, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {heading('Recent')}
            <div style={list}>
              {recent.length === 0 && <div style={item(false, true)}>No recent documents yet</div>}
              {recent.map((p, i) => (
                <div key={p} title={p} style={item(recSel === i, !recentExists[i])}
                  onClick={() => recentExists[i] && setRecSel(i)}
                  onDoubleClick={() => recentExists[i] && finish({ kind: 'recent', path: p })}>
                  {`${basename(p)}\n   ${dirname(p)}`}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)' }} />
        <div className='welcome-zip' style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 10px', borderRadius: 4,
          background: '#eef5ec', border: '1px solid #cfe3c9', color: '#24452a' }}>
          <b style={{ whiteSpace: 'nowrap' }}>Your files are always yours.</b>
          <span>A <b>.ktex</b> file is an ordinary ZIP archive: rename it to <b>.zip</b> and you will find your whole
            document as LaTeX (document.tex) and every picture, usable without {SHORT_NAME}. File ▸ Extract Files from .ktex
            does it for you.</span>
        </div>
        <div style={{ color: 'var(--muted, #888)' }}>{SHORT_NAME} is in beta — some parts are still new. Please send feedback to <b>{FEEDBACK_EMAIL}</b> (Help &gt; Send feedback).</div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <label><input type='checkbox' checked={again} onChange={e => setAgain(e.target.checked)} /> Show this page when {SHORT_NAME} starts</label>
          <div style={{ flex: 1 }} />
          <button type='button' autoFocus onClick={() => finish({ kind: 'continue' })} style={{
            minWidth: 140, padding: '4px 12px', border: '1px solid var(--accent)', borderRadius: 4,
            boxShadow: 'inset 0 0 0 1px var(--accent)', background: 'var(--base)', color: 'var(--text)', font: 'inherit',
          }}>Start writing</button>
        </div>
      </div>
    </div>
  )
}

// WelcomeDialog.exec(): resolves with what the user picked.
export function showWelcomeDialog(opts: {
  recent: string[]; recentExists: boolean[]; examples: string[]; layout: LayoutMode; showAtStart: boolean
}): Promise<WelcomeResult> {
  return new Promise(resolve => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const root = createRoot(div)
    root.render(<Welcome {...opts} done={r => { root.unmount(); div.remove(); resolve(r) }} />)
  })
}
