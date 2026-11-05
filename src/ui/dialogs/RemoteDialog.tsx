// Connect the document to a cloud git service (GitHub, GitLab, ...) so it
// is backed up online and can be shared: a port of khervedoc/remote_dialog.py.
//
// The dialog walks the user through the setup in plain words instead of
// git jargon; several remotes and SSH URLs still work, just not
// front-and-centre.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { platform } from '../../platform'
import { git } from '../../platform/git'
import { critical, information, question, warning } from '../../platform/MessageBox'
import { promptText } from './EditorDialogs'
import { openDialog, type Close } from './dialogHost'
import './gitDialogs.css'

function Intro({ connected }: { connected: boolean }) {
  // The intro adapts to whether a remote already exists.
  if (connected) return <div className='rem-intro'><b>Your document is connected to:</b></div>
  return (
    <div className='rem-intro'>
      <b>Connect your document to a cloud service</b><br /><br />
      This lets you:<br />
      &nbsp;&nbsp;{'•'} <b>Back up</b> your work online automatically<br />
      &nbsp;&nbsp;{'•'} <b>Share</b> your document with collaborators<br />
      &nbsp;&nbsp;{'•'} <b>Download</b> changes others have made<br /><br />
      <b>How to get started:</b><br />
      &nbsp;&nbsp;1. Create a repository on <a href='https://github.com/new'>GitHub</a>,{' '}
      <a href='https://gitlab.com/projects/new'>GitLab</a>, or similar<br />
      &nbsp;&nbsp;2. Copy the repository URL (it looks like <code>https://github.com/you/my-paper.git</code>)<br />
      &nbsp;&nbsp;3. Click <b>"Add connection"</b> below and paste the URL
    </div>
  )
}

function RemoteDialog({ repoDir, connected, close }: { repoDir: string; connected: boolean; close: Close<void> }) {
  const g = git()
  const rootRef = useRef<HTMLDivElement>(null)
  const [remotes, setRemotes] = useState<[string, string][]>([])
  const [row, setRow] = useState(-1)

  // _refresh
  const refresh = useCallback(async () => {
    const r = await g.getRemotes(repoDir)
    setRemotes(r)
    setRow(r.length ? 0 : -1)
  }, [g, repoDir])

  useEffect(() => { void refresh() }, [refresh])

  // setOpenExternalLinks(True): links open in the browser, not the app.
  const openLink = (e: MouseEvent) => {
    const a = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    void platform().openUrl(a.href)
  }

  const add = async () => {
    const existing = new Set((await g.getRemotes(repoDir)).map(([n]) => n))
    const defaultName = existing.has('origin') ? '' : 'origin'
    const typed = await promptText('Add connection', 'Connection name (most people use "origin"):', defaultName)
    const name = (typed ?? '').trim()
    if (typed === null || !name) return
    if (existing.has(name)) {
      await warning('Already exists',
        `A connection called "${name}" already exists.\n\nUse "Edit URL" to change where it points.`)
      return
    }
    const typedUrl = await promptText('Add connection',
      'Paste the repository URL here:\n\n'
      + 'Examples:\n'
      + '  https://github.com/username/my-paper.git\n'
      + '  git@github.com:username/my-paper.git')
    const url = (typedUrl ?? '').trim()
    if (typedUrl === null || !url) return
    if (!(await g.setRemote(repoDir, name, url))) {
      await critical('Could not add connection', 'Something went wrong. Make sure the URL is valid and try again.')
      return
    }
    await refresh()
    await information('Connected!',
      `Your document is now linked to:\n\n  ${url}\n\n`
      + 'From now on, every time you save your document it will automatically be uploaded there.\n\n'
      + 'You can also use Git → Download latest to get changes from collaborators.')
  }

  const edit = async () => {
    const cur = remotes[row]
    if (!cur) {
      await information('Edit URL', 'Select a connection in the list first.')
      return
    }
    const [name, oldUrl] = cur
    const typed = await promptText(`Edit "${name}"`, `New URL for "${name}":`, oldUrl)
    const newUrl = (typed ?? '').trim()
    if (typed === null || !newUrl || newUrl === oldUrl) return
    if (!(await g.setRemote(repoDir, name, newUrl))) {
      await critical('Could not update', 'Failed to update the URL. Make sure it is valid.')
      return
    }
    await refresh()
  }

  const remove = async () => {
    const cur = remotes[row]
    if (!cur) {
      await information('Remove connection', 'Select a connection in the list first.')
      return
    }
    const [name] = cur
    const confirm = await question('Remove connection',
      `Remove the connection "${name}"?\n\n`
      + 'This only removes the link from this computer — nothing is deleted on the server. '
      + 'You can always re-add it later.')
    if (!confirm) return
    if (!(await g.removeRemote(repoDir, name))) {
      await critical('Could not remove', `Failed to remove "${name}". Try again or restart the app.`)
      return
    }
    await refresh()
  }

  return (
    <div ref={rootRef} className='dlg dlg-remote' role='dialog' aria-label='Connect to cloud'>
      <div className='dlg-title'>Connect to cloud</div>
      <div className='dlg-body rem-body' onClick={openLink}>
        <Intro connected={connected} />
        <div className='rem-table'>
          <table>
            <thead><tr><th className='rem-name'>Name</th><th>URL</th></tr></thead>
            <tbody>
              {remotes.map(([n, u], i) => (
                <tr key={n} className={i === row ? 'selected' : ''} onMouseDown={() => setRow(i)}>
                  <td className='rem-name' title={n}>{n}</td>
                  <td title={u}>{u}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className='rem-buttons'>
          <button type='button' accessKey='a' title="Add a new cloud link (you'll need the repository URL)"
            onClick={() => void add()}>{'➕'} <u>A</u>dd connection</button>
          <button type='button' accessKey='e' title='Change the URL of the selected connection'
            onClick={() => void edit()}>{'✏'} <u>E</u>dit URL</button>
          <button type='button' accessKey='r' title='Remove this connection (does NOT delete anything on the server)'
            onClick={() => void remove()}>{'✖'} <u>R</u>emove</button>
        </div>
        <div className='rem-help'>
          <b>Where do I find the URL?</b> On GitHub, go to your repository page and click the green{' '}
          <b>"Code"</b> button {'—'} copy the HTTPS link. It looks like:{' '}
          <code>https://github.com/username/repo.git</code>
        </div>
      </div>
      <div className='dlg-buttons'>
        <button type='button' autoFocus onClick={() => close(null)}>Close</button>
      </div>
    </div>
  )
}

// RemoteDialog(repo_dir, parent).exec()
export async function openRemoteDialog(repoDir: string): Promise<void> {
  const connected = (await git().getRemotes(repoDir)).length > 0
  await openDialog<void>(close => <RemoteDialog repoDir={repoDir} connected={connected} close={close} />)
}
