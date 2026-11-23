// File > Share > Overleaf: the project link and a token, in plain words.
// A port of khervedoc/overleaf_dialog.py.
import { useState } from 'react'
import { strip } from '../../core/py'
import { openDialog, type Close } from './dialogHost'

export interface OverleafAnswer {
  link: string
  token: string
}

function OverleafDialog({ action, link: link0, token: token0, close }: {
  action: string; link: string; token: string; close: Close<OverleafAnswer>
}) {
  const [link, setLink] = useState(link0)
  const [token, setToken] = useState(token0)
  const accept = () => close({ link: strip(link), token: strip(token) })
  return (
    <form className="dlg dlg-overleaf" role="dialog" aria-label={`${action} Overleaf`}
      onSubmit={e => { e.preventDefault(); accept() }}>
      <div className="dlg-title">{action} Overleaf</div>
      <div className="dlg-body">
        <div>
          Collaborators edit the project on <b>overleaf.com</b>; kTeX sends your version
          there and gets theirs back as a document.<br /><br />
          1. Open the project on Overleaf and copy the address from the browser.<br />
          2. In Overleaf, open <b>Account Settings › Git Integration</b> and create a token.<br /><br />
          <span className="dlg-muted">Git access needs an Overleaf plan that includes it. On a free
            plan, use <b>File › Share › Download for Overleaf</b> and upload the zip with
            Overleaf's <i>New Project › Upload Project</i>.</span>
        </div>
        <div className="dlg-form">
          <label htmlFor="overleaf-link">Project link:</label>
          <input id="overleaf-link" autoFocus value={link} onChange={e => setLink(e.target.value)}
            placeholder="https://www.overleaf.com/project/…" />
          <label htmlFor="overleaf-token">Git token:</label>
          <input id="overleaf-token" type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder="olp_…" autoComplete="off" />
        </div>
        <div className="dlg-muted">The token is saved in your system's keychain, so you only enter it once.
          Clear the field to forget it.</div>
      </div>
      <div className="dlg-buttons">
        <button type="submit">{action}</button>
        <button type="button" onClick={() => close(null)}>Cancel</button>
      </div>
    </form>
  )
}

// OverleafDialog(action, link, token).exec(): the trimmed link and token, or
// null when cancelled.
export function askOverleaf(action: string, link = '', token = ''): Promise<OverleafAnswer | null> {
  return openDialog<OverleafAnswer>(close => (
    <OverleafDialog action={action} link={link} token={token} close={close} />
  ))
}
