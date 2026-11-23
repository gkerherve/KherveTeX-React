// Word's buttons beside Share: a new comment, the mode (Editing,
// Reviewing, Viewing) and Share. On the blue title bar's right end (macOS
// app), else at the right of the ribbon's tab row.
import { useEffect, useRef, useState } from 'react'
import { MODE_EVENT, editMode, type EditMode } from '../app/actions/share'
import { runAction } from '../app/actions'
import { Icon } from './icons'

// Word's buttons at the right of the tab row: a new comment, the mode
// (Editing, Reviewing, Viewing) and Share.
const MODES: [EditMode, string, string, string][] = [
  ['editing', 'Editing', 'Edit the document directly', 'mode_editing'],
  ['reviewing', 'Reviewing', 'Your changes become suggestions (Track Changes), and you can comment', 'mode_reviewing'],
  ['viewing', 'Viewing', 'Read the document; nothing can be changed', 'mode_viewing'],
]
const SHARES: [string, string, string][] = [
  ['share:overleaf', 'Send to Overleaf', 'Put this version in your Overleaf project (needs Git access on Overleaf)'],
  ['share:overleaf_zip', 'Download for Overleaf (.zip)…', 'A zip to upload as a new Overleaf project (free plan)'],
  ['share:email_pdf', 'Email the PDF (Mail)', 'Compile, then a new mail in Mail with the PDF attached'],
  ['share:outlook', 'Email the PDF (Outlook)', 'Compile, then a new Outlook message with the PDF attached'],
  ['share:teams', 'Send the PDF in Teams', 'Compile, then the PDF is shown ready to drag into a Teams chat'],
  ['share:whatsapp', 'Send the PDF with WhatsApp', 'Compile, then share the PDF in WhatsApp'],
  ['share:email_ktex', 'Email the document (.ktex, Mail)', 'A new mail with the kTeX file attached, to edit in kTeX'],
  ['share:outlook_ktex', 'Email the document (.ktex, Outlook)', 'A new Outlook message with the kTeX file attached'],
  ['share:reveal_pdf', 'Show the PDF in the Finder', 'To drop it into any other app'],
]

export function WordControls({ onBar = false }: { onBar?: boolean }) {
  const [open, setOpen] = useState<'mode' | 'share' | null>(null)
  const [, tick] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = () => tick(n => n + 1)
    window.addEventListener(MODE_EVENT, on)
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(null) }
    document.addEventListener('mousedown', away)
    return () => { window.removeEventListener(MODE_EVENT, on); document.removeEventListener('mousedown', away) }
  }, [])
  const mode = editMode()
  const cur = MODES.find(m => m[0] === mode)!
  const go = (id: string) => { setOpen(null); void runAction(id) }
  return (
    <div className={'rb-word' + (onBar ? ' rb-word-bar' : '')} ref={box}>
      <button type='button' className='rb-word-icon' title='New comment (⌥⌘M): a note on the selected text'
        aria-label='New comment' onClick={() => { void runAction('comment') }}>
        <Icon name='comment' size={18} />
      </button>
      <div className='rb-word-drop'>
        <button type='button' className={'rb-pill rb-mode-' + mode} aria-haspopup='menu' aria-expanded={open === 'mode'}
          title={cur[2]} onClick={() => setOpen(open === 'mode' ? null : 'mode')}>
          <Icon name={cur[3]} size={15} /> {cur[1]} <span className='rb-caret'>▾</span>
        </button>
        {open === 'mode' && (
          <div className='rb-pop' role='menu'>
            {MODES.map(([m, label, text, icon]) => (
              <button key={m} type='button' role='menuitemradio' aria-checked={m === mode} className={m === mode ? 'on' : ''}
                onClick={() => go(`mode:${m}`)}>
                <Icon name={icon} size={20} />
                <span><b>{label}</b><small>{text}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className='rb-word-drop'>
        <button type='button' className='rb-pill rb-share' aria-haspopup='menu' aria-expanded={open === 'share'}
          title='Share this document' onClick={() => setOpen(open === 'share' ? null : 'share')}>
          <Icon name='share' size={15} /> Share <span className='rb-caret'>▾</span>
        </button>
        {open === 'share' && (
          <div className='rb-pop rb-pop-share' role='menu'>
            {SHARES.map(([id, label, text]) => (
              <button key={id} type='button' role='menuitem' onClick={() => go(id)}>
                <span><b>{label}</b><small>{text}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

