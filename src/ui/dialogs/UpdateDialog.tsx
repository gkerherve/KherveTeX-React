// updater.UpdateDialog: what changed, and whether to restart into it. A
// wrapped intro, the release notes (QTextBrowser.setMarkdown of
// changelog_markdown) and the accept button beside Later — or Close alone
// when there is nothing to accept. 480 x 320 at least, as setMinimumSize.
import { escapeHtml } from '../../platform/MessageBox'
import { openDialog } from './dialogHost'
import './dialogs.css'

export interface UpdateDialogOptions {
  title: string
  intro: string
  notesMd: string
  // '' for an information-only dialog (a Close button).
  acceptText: string
}

// The two forms changelog_markdown writes — "- text" bullets and **bold** —
// as HTML; anything else is a paragraph. Escaped first: the notes come from
// the release, not from the app.
export function notesHtml(md: string): string {
  const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  const out: string[] = []
  let inList = false
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet && !inList) { out.push('<ul>'); inList = true }
    if (!bullet && inList) { out.push('</ul>'); inList = false }
    if (bullet) out.push(`<li>${inline(bullet[1])}</li>`)
    else if (line) out.push(`<p>${inline(line)}</p>`)
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

// exec() == QDialog.Accepted.
export async function updateDialog(opts: UpdateDialogOptions): Promise<boolean> {
  const r = await openDialog<boolean>(close => (
    <div className='dlg dlg-update' role='dialog' aria-modal='true' aria-label={opts.title}
      style={{ minWidth: 480, minHeight: 320 }}>
      <div className='dlg-title'>{opts.title}</div>
      <div className='dlg-body' style={{ flex: 1 }}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{opts.intro}</div>
        {opts.notesMd && (
          <div className='dlg-update-notes' style={{
            flex: 1, minHeight: 160, overflow: 'auto', background: '#fff',
            border: '1px solid #a0a0a0', padding: '4px 8px', userSelect: 'text',
          }} dangerouslySetInnerHTML={{ __html: notesHtml(opts.notesMd) }} />
        )}
      </div>
      <div className='dlg-buttons'>
        {opts.acceptText && (
          <button type='button' autoFocus onClick={() => close(true)}>{opts.acceptText}</button>
        )}
        <button type='button' autoFocus={!opts.acceptText} onClick={() => close(false)}>
          {opts.acceptText ? 'Later' : 'Close'}
        </button>
      </div>
    </div>
  ))
  return r === true
}
