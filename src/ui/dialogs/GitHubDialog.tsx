// File ▸ Share ▸ GitHub: sign in, publish the document to GitHub or connect
// it to one of your repositories, upload and download, and open a document
// from GitHub. Its logic is GitHubSession in src/app/github.ts; this is
// only the widgets.
import { useEffect, useState } from 'react'
import * as gh from '../../core/github'
import type { GitHubRepo } from '../../core/github'
import type { GitHubSession } from '../../app/github'
import { openDialog, type Close } from './dialogHost'
import './gitDialogs.css'

export interface GitHubEnv {
  session: GitHubSession
  // The open document's file, null while it is not saved.
  docPath: () => string | null
  save: () => Promise<void>
  upload: () => Promise<void>
  download: () => Promise<void>
  openUrl: (url: string) => void
  // Where a downloaded repository goes: a folder the user picks.
  chooseFolder: () => Promise<string | null>
  // Open a downloaded document (asks to save the open one first).
  openDocument: (path: string, all: string[]) => Promise<void>
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function GitHubDialog({ env, close }: { env: GitHubEnv; close: Close<void> }) {
  const s = env.session
  const [, setTick] = useState(0)
  const redraw = () => setTick(t => t + 1)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [docPath, setDocPath] = useState(env.docPath())
  const [connected, setConnected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [priv, setPriv] = useState(true)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  const folder = docPath ? docPath.replace(/[\\/][^\\/]*$/, '') : null
  const stem = docPath ? docPath.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') : ''

  const work = async (what: string, f: () => Promise<void>) => {
    setBusy(what)
    setMessage(null)
    try {
      await f()
    } catch (e) {
      setMessage({ ok: false, text: errText(e) })
    } finally {
      setBusy('')
      redraw()
    }
  }

  const refreshDoc = async () => {
    const p = env.docPath()
    setDocPath(p)
    setConnected(p ? await s.connectedRepo(p.replace(/[\\/][^\\/]*$/, '')) : null)
  }

  useEffect(() => {
    void work('Checking your GitHub sign-in…', async () => {
      if (!s.user) await s.restore()
      if (s.user) await s.loadRepos()
      await refreshDoc()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { setName(gh.repoName(stem)) }, [stem])

  const signIn = () => work('Signing in…', async () => {
    const u = await s.signIn(token)
    setToken('')
    await s.loadRepos()
    setMessage({ ok: true, text: `Signed in as ${u.login}.` })
  })
  const signOut = () => work('', async () => { await s.signOut(); setMessage({ ok: true, text: 'Signed out.' }) })

  const saveFirst = () => work('Saving…', async () => { await env.save(); await refreshDoc() })

  const publish = () => work('Publishing to GitHub…', async () => {
    const [ok, msg] = await s.publish(docPath!, name, priv)
    setMessage({ ok, text: msg })
    await s.loadRepos()
    await refreshDoc()
  })
  const connect = (repo: GitHubRepo) => work('Connecting…', async () => {
    const [ok, msg] = await s.connect(docPath!, repo)
    setMessage({ ok, text: msg })
    await refreshDoc()
  })
  const disconnect = () => work('', async () => {
    await s.disconnect(docPath!)
    await refreshDoc()
    setMessage({ ok: true, text: 'The document is no longer connected to GitHub. Nothing was deleted there.' })
  })
  const openFromGitHub = (repo: GitHubRepo) => work(`Downloading ${repo.full_name}…`, async () => {
    const parent = await env.chooseFolder()
    if (!parent) return
    const [ok, msg, dest, docs] = await s.download(repo, parent)
    if (!ok) { setMessage({ ok: false, text: msg }); return }
    if (!docs.length) {
      setMessage({ ok: true, text: `Downloaded to ${dest}. It holds no KherveTeX or LaTeX document.` })
      return
    }
    close()
    await env.openDocument(docs[0], docs)
  })

  const repos = s.repos.filter(r => gh.matchRepo(r, query))
  const pickedRepo = s.repos.find(r => r.full_name === picked) ?? null

  return (
    <div className='dlg dlg-github' role='dialog' aria-label='GitHub'
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
      <div className='dlg-title'>GitHub</div>
      <div className='dlg-body'>
        <section className='gh-section'>
          <h3>Your GitHub account</h3>
          {s.user ? (
            <div className='gh-row'>
              <span>Signed in as <b>{s.user.login}</b>{s.user.name ? ` (${s.user.name})` : ''}.</span>
              <button type='button' onClick={() => void signOut()}>Sign out</button>
            </div>
          ) : (
            <>
              <p>Sign in once: KherveTeX keeps the sign-in on this computer and uses it for every upload and
                download, so GitHub never asks for a password.</p>
              <div className='gh-row'>
                <span>1.</span>
                <button type='button' onClick={() => env.openUrl(gh.NEW_TOKEN_URL)}>Make a sign-in token on GitHub…</button>
                <span className='gh-muted'>GitHub opens with the right box (“repo”) ticked: press Generate token and copy it.</span>
              </div>
              <form className='gh-row' onSubmit={e => { e.preventDefault(); void signIn() }}>
                <span>2.</span>
                <input type='password' autoFocus value={token} placeholder='Paste the token here (ghp_…)'
                  aria-label='GitHub token' onChange={e => setToken(e.target.value)} />
                <button type='submit' disabled={!token.trim() || !!busy}>Sign in</button>
              </form>
            </>
          )}
        </section>

        {s.user && (
          <section className='gh-section'>
            <h3>This document</h3>
            {!docPath ? (
              <div className='gh-row'>
                <span>Save the document first; then it can go to GitHub.</span>
                <button type='button' onClick={() => void saveFirst()}>Save…</button>
              </div>
            ) : connected ? (
              <>
                <div className='gh-row'>
                  <span>On GitHub: <a href={gh.webUrl(connected)} onClick={e => { e.preventDefault(); env.openUrl(gh.webUrl(connected)) }}>{connected}</a>.
                    Every save uploads to it.</span>
                </div>
                <div className='gh-row'>
                  <button type='button' onClick={() => env.openUrl(gh.webUrl(connected))}>Open on GitHub</button>
                  <button type='button' onClick={() => void work('Uploading…', env.upload)}>Upload now</button>
                  <button type='button' onClick={() => void work('Downloading…', async () => { await env.download(); await refreshDoc() })}>
                    Download latest</button>
                  <button type='button' onClick={() => void disconnect()}>Disconnect</button>
                </div>
              </>
            ) : (
              <form className='gh-row' onSubmit={e => { e.preventDefault(); void publish() }}>
                <span>Publish to a new repository</span>
                <input value={name} aria-label='Repository name' onChange={e => setName(e.target.value)} />
                <label><input type='checkbox' checked={priv} onChange={e => setPriv(e.target.checked)} /> Private</label>
                <button type='submit' disabled={!name.trim() || !!busy}>Publish</button>
              </form>
            )}
            {folder && !connected && <div className='gh-muted'>Or connect it to one of your repositories below.</div>}
          </section>
        )}

        {s.user && (
          <section className='gh-section gh-repos'>
            <h3>Your repositories</h3>
            <input type='search' value={query} placeholder='Search your repositories' aria-label='Search repositories'
              onChange={e => setQuery(e.target.value)} />
            <div className='gh-list' role='listbox' aria-label='Repositories'>
              {repos.map(r => (
                <div key={r.full_name} role='option' aria-selected={picked === r.full_name}
                  className={'gh-repo' + (picked === r.full_name ? ' selected' : '')}
                  onClick={() => setPicked(r.full_name)}
                  onDoubleClick={() => env.openUrl(r.html_url)}>
                  <b>{r.full_name}</b>{r.private && <span className='gh-tag'>private</span>}
                  {r.description && <span className='gh-desc'>{r.description}</span>}
                </div>
              ))}
              {!repos.length && <div className='gh-muted'>{s.repos.length ? 'No repository matches.' : 'No repositories yet.'}</div>}
            </div>
            <div className='gh-row'>
              <button type='button' disabled={!pickedRepo || !docPath || !!connected || !!busy}
                title='Upload this document to the selected repository on every save'
                onClick={() => pickedRepo && void connect(pickedRepo)}>Connect this document to it</button>
              <button type='button' disabled={!pickedRepo || !!busy}
                title='Download the repository into a folder and open the document in it'
                onClick={() => pickedRepo && void openFromGitHub(pickedRepo)}>Open from GitHub…</button>
            </div>
          </section>
        )}

        {(busy || message) && (
          <div className={'gh-status' + (message && !message.ok ? ' error' : '')} role='status'>
            {busy || message?.text}
          </div>
        )}
      </div>
      <div className='dlg-buttons'>
        <button type='button' onClick={() => close()}>Close</button>
      </div>
    </div>
  )
}

export function showGitHub(env: GitHubEnv): Promise<void | null> {
  return openDialog<void>(close => <GitHubDialog env={env} close={close} />)
}
