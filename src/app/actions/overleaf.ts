// File > Share (and the Review tab's Share group): Send to Overleaf, Get
// changes from Overleaf, Download for Overleaf. MainWindow._overleaf_send,
// _overleaf_get and _export_latex_zip in khervedoc/mainwindow.py.
//
// The git calls go through the OverleafIo set with setOverleafIo (git2-rs in
// the desktop app). Until one is set, the git command-line client is run
// through the platform, so Overleaf works wherever git is installed.
import { exportLatexZip } from '../../core/kdocz'
import type { FileAccess } from '../../core/kdocz'
import * as overleaf from '../../core/overleaf'
import { overleafHost, overleafIo, setOverleafHost, setOverleafIo } from '../../core/overleafIo'
import type { OverleafHost, OverleafIo } from '../../core/overleafIo'
import { basename, dirname, join, suffix, withSuffix } from '../../core/paths'
import { platform } from '../../platform'
import { warning } from '../../platform/MessageBox'
import { loadSettings, setSetting, setting } from '../../platform/settings'
import { askOverleaf } from '../../ui/dialogs/OverleafDialog'
import { registerActions } from '../actions'
import { appStore, replaceDoc } from '../store'
import { toJson } from '../../core/model'
import { refreshKherverefBib } from './refs'
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
function platformGitIo(): OverleafIo {
  const p = platform()
  const git = async (cwd: string | null, args: string[], token = ''): Promise<string> => {
    const auth = token ? ['-c', `http.extraHeader=Authorization: Basic ${btoa(`git:${token}`)}`] : []
    const r = await p.run('git', [...auth, ...(cwd ? ['-C', cwd] : []), ...args],
      { timeoutSecs: 300, env: { GIT_TERMINAL_PROMPT: '0' } })
    if (r.error) throw new Error(r.error)
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`)
    return r.stdout.trim()
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
    checkoutRemoteBranch: async (dir, branch) => { await git(dir, ['checkout', '--force', '--detach', `origin/${branch}`]) },
    clone: async (url, dir, token, branch) => {
      await p.mkdir(dirname(dir))
      await git(null, ['clone', '--branch', branch, url, dir], token)
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
        ident = ['-c', 'user.name=KherveTeX', '-c', 'user.email=khervedoc@local']
      }
      const sha = await git(dir, [...ident, 'commit-tree', tree, ...parents, '-m', message])
      // libgit2's check: the branch must still be at the first parent.
      let tip = ''
      try { tip = await git(dir, ['rev-parse', '--verify', '--quiet', ref]) } catch { /* new branch */ }
      if (tip && tip !== head) throw new Error('failed to create commit: current tip is not the first parent')
      await git(dir, ['update-ref', ref, sha])
    },
    push: async (dir, ref, token) => { await git(dir, ['push', 'origin', ref], token) },
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
  return [answer.link, answer.token]
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

async function overleafSend(): Promise<void> {
  const ask = await askOverleafLink('Send to')
  if (ask === null) return
  const [link, token] = ask
  const h = host()
  const doc = appStore().get().doc
  const bib = h.kherverefBib ? await h.kherverefBib(doc) : ''
  appStore().set({ status: 'Sending to Overleaf…' })
  let msg: string
  try {
    const gitIo = io()
    msg = await overleaf.send(doc, sourceDir(), link, token, await overleafCache(link),
      bib ? { 'kherveref.bib': bib } : null, undefined, gitIo, gitIo.fs)
  } catch (exc) {
    if (!(exc instanceof overleaf.OverleafError)) throw exc
    appStore().set({ status: '' })
    await warning('Send to Overleaf', exc.message)
    return
  }
  appStore().set({ status: msg })
}

// Collaborators' version opens in a new window: nothing here is
// replaced, and either can be saved.
async function overleafGet(): Promise<void> {
  const ask = await askOverleafLink('Get from')
  if (ask === null) return
  const [link, token] = ask
  const h = host()
  appStore().set({ status: 'Getting from Overleaf…' })
  let doc, folder
  try {
    [doc, folder] = await overleaf.receive(link, token, await overleafCache(link), io())
  } catch (exc) {
    if (!(exc instanceof overleaf.OverleafError)) throw exc
    appStore().set({ status: '' })
    await warning('Get from Overleaf', exc.message)
    return
  }
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
// (works on a free plan).
export async function exportLatexZipAction(): Promise<void> {
  const h = host()
  const { doc, path: current } = appStore().get()
  const stem = current ? docStem(current) : 'document'
  let path = await h.saveFileDialog('Export LaTeX package', `${stem}.zip`,
    { name: 'Zip archive', extensions: ['zip'] })
  if (!path) return
  if (suffix(path).toLowerCase() !== '.zip') path = withSuffix(path, '.zip')
  await h.fs.write(path, await exportLatexZip(doc, sourceDir(), h.fs, stem))
  appStore().set({ status: `Exported ${path}` })
}

registerActions({
  overleaf_send: overleafSend,
  overleaf_get: overleafGet,
  overleaf_zip: exportLatexZipAction,
})
