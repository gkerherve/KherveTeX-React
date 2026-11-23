// File > Share (and the Review tab's Share group): Send to Overleaf, Get
// changes from Overleaf, Download for Overleaf. MainWindow._overleaf_send,
// _overleaf_get and _export_latex_zip in khervedoc/mainwindow.py.
//
// The git calls go through the OverleafIo set with setOverleafIo (git2-rs in
// the desktop app). Until one is set, the git command-line client is run
// through the platform, so Overleaf works wherever git is installed.
import { exportLatexZip } from '../../core/kdocz'
import type { FileAccess } from '../../core/kdocz'
import { gitUrl } from '../../core/overleaf'
import * as overleaf from '../../core/overleaf'
import { overleafHost, overleafIo, setOverleafHost, setOverleafIo } from '../../core/overleafIo'
import type { OverleafHost, OverleafIo } from '../../core/overleafIo'
import { basename, dirname, join, suffix, withSuffix } from '../../core/paths'
import { platform } from '../../platform'
import { question, warning } from '../../platform/MessageBox'
import { loadSettings, setSetting, setting } from '../../platform/settings'
import { askOverleaf } from '../../ui/dialogs/OverleafDialog'
import { registerActions } from '../actions'
import { appStore, replaceDoc } from '../store'
import { toJson } from '../../core/model'
import { latexPackageExtras, refreshKherverefBib } from './refs'
import { openWindow } from './window'

// The Overleaf git token, for this run only: never written to disk.
let overleafToken = ''

function platformFs(): FileAccess {
  const p = platform()
  return { exists: p.exists, read: p.readFile, write: p.writeFile }
}

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const isWindows = () => typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)

// The host MainWindow is, over the platform layer.
function platformHost(): OverleafHost {
  const p = platform()
  return {
    fs: platformFs(),
    // Where QSettings("kherveDOC", "kherveDOC") keeps its file: the clones
    // sit beside it as in the Python app.
    settingsDir: async () => {
      const home = await p.homeDir()
      if (isMac()) return join(home, 'Library/Preferences')
      if (isWindows()) return join(home, 'AppData/Roaming/kherveDOC')
      return join(home, '.config/kherveDOC')
    },
    settingValue: (key) => {
      const v = setting<unknown>(key, null)
      return typeof v === 'string' ? v : null
    },
    setSettingValue: (key, value) => setSetting(key, value),
    saveFileDialog: (title, defaultName, filter) => p.saveFileDialog({ title, defaultName, filters: [filter] }),
    cwd: () => '.',
    kherverefBib: (doc) => refreshKherverefBib(doc),
    // _overleaf_get: hand the version to a new window through a temp file
    // (windows share no memory); that window loads and deletes it.
    openInNewWindow: async (doc, folder) => {
      const tmp = join(await p.makeTempDir('khervetex-overleaf-'), 'overleaf.ktex.json')
      await p.writeText(tmp, toJson(doc))
      await openWindow({ kind: 'overleaf', path: tmp, dir: folder })
    },
  }
}

function host(): OverleafHost {
  try {
    return overleafHost()
  } catch {
    setOverleafHost(platformHost())
    return overleafHost()
  }
}

// pygit2 over the git command line: the token travels in an HTTP header
// for that one command, never in .git/config.
export function platformGitIo(): OverleafIo {
  const p = platform()
  const git = async (cwd: string | null, args: string[], token = ''): Promise<string> => {
    const auth = token ? ['-c', `http.extraHeader=Authorization: Basic ${btoa(`git:${token}`)}`] : []
    const r = await p.run('git', [...auth, ...(cwd ? ['-C', cwd] : []), ...args],
      { timeoutSecs: 300, env: { GIT_TERMINAL_PROMPT: '0' } })
    if (r.error) throw new Error(r.error)
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`)
    return r.stdout.trim()
  }
  // The branch the Overleaf project is on: older projects use master,
  // newer ones main, and Overleaf refuses a push that would add a branch.
  const remoteBranch = async (dir: string, want: string, token = ''): Promise<string> => {
    const out = await git(dir, ['ls-remote', '--symref', 'origin', 'HEAD', `refs/heads/${want}`], token)
    if (new RegExp(`\\srefs/heads/${want}$`, 'm').test(out)) return want
    return /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(out)?.[1] ?? want
  }
  const walk = async (dir: string, prefix = ''): Promise<string[]> => {
    const out: string[] = []
    for (const e of await p.listDir(dir)) {
      if (e.name === '.git') continue
      if (e.isDir) out.push(...await walk(e.path, `${prefix}${e.name}/`))
      else if (e.isFile) out.push(prefix + e.name)
    }
    return out
  }
  return {
    fs: platformFs(),
    listDir: async (dir) => (await p.listDir(dir)).filter(e => e.isFile).map(e => e.name),
    listTree: (dir) => walk(dir),
    removeTree: (dir) => p.remove(dir),
    remoteUrl: (dir) => git(dir, ['remote', 'get-url', 'origin']),
    fetch: async (dir, token) => { await git(dir, ['fetch', 'origin'], token) },
    checkoutRemoteBranch: async (dir, branch) => {
      let remote = branch
      try {
        await git(dir, ['rev-parse', '--verify', '--quiet', `origin/${remote}`])
      } catch {
        // No such branch on Overleaf: take the one its HEAD names, as the
        // fetch just recorded it (no network, so no token needed here).
        const head = await git(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')
        const refs = (await git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/'])).split('\n')
        const any = head || (refs.find(r => r.startsWith('origin/') && r !== 'origin/HEAD') ?? '')
        remote = any.replace(/^origin\//, '') || branch
      }
      await git(dir, ['checkout', '--force', '--detach', `origin/${remote}`])
      // Overleaf is the truth: a commit it rejected earlier (a push to the
      // wrong branch, a lost connection) must not stay on the local branch,
      // or the next send fails "current tip is not the first parent".
      await git(dir, ['update-ref', `refs/heads/${branch}`, `origin/${remote}`])
    },
    clone: async (url, dir, token, branch) => {
      await p.mkdir(dirname(dir))
      try {
        await git(null, ['clone', '--branch', branch, url, dir], token)
      } catch (e) {
        // A project whose git branch is not master: take its default one.
        if (!/remote branch .* not found/i.test(String(e))) throw e
        await p.remove(dir).catch(() => {})
        await git(null, ['clone', url, dir], token)
      }
    },
    stageAll: async (dir) => { await git(dir, ['add', '--all']); return git(dir, ['write-tree']) },
    headTree: async (dir) => {
      try { return await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}']) } catch { return null }
    },
    commit: async (dir, ref, message, tree) => {
      let head = ''
      try { head = await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']) } catch { /* unborn */ }
      const parents = head ? ['-p', head] : []
      // git_backend._signature's fallback when no identity is configured.
      let ident: string[] = []
      try { await git(dir, ['var', 'GIT_COMMITTER_IDENT']) } catch {
        ident = ['-c', 'user.name=kTeX', '-c', 'user.email=khervedoc@local']
      }
      const sha = await git(dir, [...ident, 'commit-tree', tree, ...parents, '-m', message])
      // libgit2's check: the branch must still be at the first parent.
      let tip = ''
      try { tip = await git(dir, ['rev-parse', '--verify', '--quiet', ref]) } catch { /* new branch */ }
      if (tip && tip !== head) throw new Error('failed to create commit: current tip is not the first parent')
      await git(dir, ['update-ref', ref, sha])
    },
    push: async (dir, ref, token) => {
      const branch = await remoteBranch(dir, ref.replace(/^refs\/heads\//, ''), token)
      await git(dir, ['push', 'origin', `${ref}:refs/heads/${branch}`], token)
    },
  }
}

function io(): OverleafIo {
  try {
    return overleafIo()
  } catch {
    setOverleafIo(platformGitIo())
    return overleafIo()
  }
}

function overleafLinkKey(): string {
  const s = appStore().get()
  return overleaf.linkKey(s.path, s.projectPath)
}

// The Git token is one per Overleaf account: remembered in the system
// keychain, so it is typed once (the Python app kept it in memory only).
const TOKEN_KEY = 'overleaf-git-token'

async function savedToken(): Promise<string> {
  if (overleafToken) return overleafToken
  try {
    overleafToken = (await platform().secretGet(TOKEN_KEY)) ?? ''
  } catch { /* no keychain: ask each session */ }
  return overleafToken
}

async function askOverleafLink(action: string): Promise<[string, string] | null> {
  const h = host()
  await loadSettings()
  const answer = await askOverleaf(action, h.settingValue(overleafLinkKey()) ?? '', await savedToken())
  if (answer === null) return null
  h.setSettingValue(overleafLinkKey(), answer.link)
  if (answer.token !== overleafToken) {
    overleafToken = answer.token
    try {
      await platform().secretSet(TOKEN_KEY, answer.token)
    } catch (exc) {
      await warning('Overleaf', `The token could not be saved in the keychain, so it is kept until you quit:\n${exc instanceof Error ? exc.message : String(exc)}`)
    }
  }
  askAgain = false
  return [answer.link, answer.token]
}

// Set after Overleaf refused the link or the token: the next Send or Get
// shows the dialog again instead of retrying the same pair.
let askAgain = false

// The project this document is linked to, as Save knows the file it was
// opened from: once a document has a link and the token is in the
// keychain, Send and Get run at once; only the first time (or after
// Overleaf refused them) is the dialog shown, as Save As is.
async function linkedOrAsk(action: string): Promise<[string, string] | null> {
  await loadSettings()
  const link = host().settingValue(overleafLinkKey()) ?? ''
  const token = await savedToken()
  if (link && token && !askAgain) return [link, token]
  return askOverleafLink(action)
}

function refused(exc: overleaf.OverleafError): boolean {
  return /did not accept the token|could not find that project|Paste the link|sharing link|does not look like an Overleaf/i.test(exc.message)
}

async function overleafCache(link: string): Promise<string> {
  return join(join(await host().settingsDir(), 'overleaf'), await overleaf.cacheKey(link))
}

// MainWindow._resolved_source_dir() or Path.cwd(): where relative figure
// paths resolve.
function sourceDir(): string {
  const path = appStore().get().path
  return path ? dirname(path) : host().cwd()
}

// What each git step is doing, in words, shown in the status bar with a
// seconds count so a slow connection still shows the app is at work.
const STEP_TEXT: Partial<Record<keyof OverleafIo, string>> = {
  clone: 'Downloading the project from Overleaf',
  fetch: 'Connecting to Overleaf and checking for changes',
  checkoutRemoteBranch: 'Updating the local copy to Overleaf\'s version',
  stageAll: 'Preparing your files',
  commit: 'Saving this version',
  push: 'Uploading to Overleaf',
}

// "project 6af0ef74…": which Overleaf project, in the status bar.
function projectLabel(link: string): string {
  const id = /project\/([0-9a-f]+)/i.exec(link)?.[1] ?? gitUrl(link).split('/').pop() ?? ''
  return id ? `project ${id.slice(0, 8)}…` : 'project'
}

function reporting(gitIo: OverleafIo, title: string): [OverleafIo, () => void] {
  let step = title, started = Date.now()
  const show = () => {
    const secs = Math.round((Date.now() - started) / 1000)
    appStore().set({ status: `${title}: ${step}…${secs >= 2 ? ` (${secs} s)` : ''}` })
  }
  const timer = setInterval(show, 1000)
  const wrapped = { ...gitIo } as OverleafIo
  for (const [k, text] of Object.entries(STEP_TEXT) as [keyof OverleafIo, string][]) {
    const fn = gitIo[k] as unknown as (...a: unknown[]) => Promise<unknown>
    ;(wrapped as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
      step = text
      started = Date.now()
      show()
      return fn.apply(gitIo, a)
    }
  }
  show()
  return [wrapped, () => clearInterval(timer)]
}

async function overleafSend(): Promise<void> {
  const ask = await linkedOrAsk('Send to')
  if (ask === null) return
  const [link, token] = ask
  const h = host()
  const doc = appStore().get().doc
  const bib = h.kherverefBib ? await h.kherverefBib(doc) : ''
  const [gitIo, stop] = reporting(io(), `Send to Overleaf ${projectLabel(link)}`)
  let msg: string
  try {
    msg = await overleaf.send(doc, sourceDir(), link, token, await overleafCache(link),
      bib ? { 'kherveref.bib': bib } : null, undefined, gitIo, gitIo.fs)
  } catch (exc) {
    stop()
    if (!(exc instanceof overleaf.OverleafError)) throw exc
    appStore().set({ status: '' })
    if (refused(exc)) askAgain = true
    await warning('Send to Overleaf', exc.message)
    return
  }
  stop()
  appStore().set({ status: `${msg} — ${link}` })
}

// Collaborators' version opens in a new window: nothing here is
// replaced, and either can be saved.
async function overleafGet(): Promise<void> {
  const ask = await linkedOrAsk('Get from')
  if (ask === null) return
  const [link, token] = ask
  const h = host()
  const [gitIo, stop] = reporting(io(), `Get from Overleaf ${projectLabel(link)}`)
  let doc, folder
  try {
    [doc, folder] = await overleaf.receive(link, token, await overleafCache(link), gitIo)
  } catch (exc) {
    stop()
    if (!(exc instanceof overleaf.OverleafError)) throw exc
    appStore().set({ status: '' })
    if (refused(exc)) askAgain = true
    await warning('Get from Overleaf', exc.message)
    return
  }
  stop()
  const untitledKey = overleaf.linkKey(null, null)
  h.setSettingValue(untitledKey, link)
  if (h.openInNewWindow) {
    // The new window says "The Overleaf version: save it to keep it."
    appStore().set({ status: '' })
    await h.openInNewWindow(doc, folder, untitledKey)
  } else {
    replaceDoc(doc, { path: null, dirty: false, project: null, projectPath: null, chapterIndex: 0 })
    appStore().set({ status: 'The Overleaf version: save it to keep it.' })
  }
}

// MainWindow._doc_stem
function docStem(path: string): string {
  const name = basename(path)
  for (const ext of ['.ktex.json', '.kdoc.json']) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length)
  }
  const s = suffix(name)
  return s ? name.slice(0, -s.length) : name
}

// MainWindow._export_latex_zip: a zip to upload as a new Overleaf project
// (works on a free plan). It is offered beside the document, and once saved
// Overleaf can be opened at its project list to upload it.
export async function exportLatexZipAction(): Promise<void> {
  const h = host()
  const { doc, path: current } = appStore().get()
  const stem = current ? docStem(current) : 'document'
  const name = `${stem}.zip`
  let path = await h.saveFileDialog('Download for Overleaf', current ? join(dirname(current), name) : name,
    { name: 'Zip archive', extensions: ['zip'] })
  if (!path) return
  if (suffix(path).toLowerCase() !== '.zip') path = withSuffix(path, '.zip')
  await h.fs.write(path, await exportLatexZip(doc, sourceDir(), h.fs, stem, await latexPackageExtras(doc)))
  appStore().set({ status: `Saved ${path}` })
  if (await question('Download for Overleaf',
    `Saved ${basename(path)}.\n\nOpen Overleaf to upload it? On Overleaf choose New Project › Upload Project and pick this zip.`)) {
    const p = platform()
    await p.reveal(path).catch(() => {})
    await p.openUrl(OVERLEAF_PROJECTS)
  }
}

const OVERLEAF_PROJECTS = 'https://www.overleaf.com/project'

// Open the linked project on overleaf.com in the browser.
async function overleafOpen(): Promise<void> {
  await loadSettings()
  const link = host().settingValue(overleafLinkKey())
  await platform().openUrl(link || OVERLEAF_PROJECTS)
}

// Link this document to another Overleaf project (or change the token),
// as Save As picks another file.
async function overleafLink(): Promise<void> {
  const ask = await askOverleafLink('Link to')
  if (ask) appStore().set({ status: `Linked to Overleaf ${projectLabel(ask[0])}` })
}

registerActions({
  overleaf_send: overleafSend,
  overleaf_get: overleafGet,
  overleaf_zip: exportLatexZipAction,
  overleaf_open: overleafOpen,
  overleaf_link: overleafLink,
})
