// Version history and the cloud: MainWindow's git handlers in
// khervedoc/mainwindow.py — _git_snapshot (the commit every save makes),
// _commit_and_maybe_push, _start_git_worker / _on_git_done,
// _show_push_failure_dialog, _pull_from_remote, _configure_remotes,
// _reload_current, _show_history, _show_branches, and the branch shown in
// the window title (_update_title).
//
// The git calls go through platform/git.ts (git2-rs in the desktop app). A
// push or pull runs on a Rust worker thread, so the window never freezes on
// a slow or dead remote; its result is reported when it arrives, as the
// _GitNetworkWorker's finished_with signal is.
import { git } from '../../platform/git'
import { escapeHtml, information, messageBox, question, warning } from '../../platform/MessageBox'
import { platform } from '../../platform'
import { basename, dirname } from '../../core/paths'
import { openHistoryDialog } from '../../ui/dialogs/HistoryDialog'
import { openRemoteDialog } from '../../ui/dialogs/RemoteDialog'
import { openBranchesDialog } from '../../ui/dialogs/BranchesDialog'
import { promptItem, promptText } from '../../ui/dialogs/EditorDialogs'
import { registerActions } from '../actions'
import { docStem } from '../compile'
import { appStore } from '../store'
import { onAfterSave, openPath, save, setBranchSuffix } from './file'

// datetime.now().isoformat(timespec='seconds')
export function nowIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

let statusTimer: ReturnType<typeof setTimeout> | null = null
// statusBar().showMessage(msg, ms); 0 keeps it until replaced.
function showMessage(msg: string, ms: number): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = null
  if (ms > 0) {
    statusTimer = setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, ms)
  }
}

function clearMessage(): void {
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = null
  appStore().set({ status: '' })
}

const NO_GIT_CLOUD = 'Git is not available in the browser version, so cloud '
  + 'features are unavailable.\n\nUse the kTeX desktop app.'

// ---- the snapshot every save takes ----

// The message commit_now asked for; the next save uses it once.
let pendingCommitMsg: string | null = null

// _git_snapshot: commit the save (only `fileStem`'s files when given) and
// push in the background if a remote is set.
export async function gitSnapshot(folder: string, name: string, fileStem: string | null): Promise<void> {
  const commitMsg = pendingCommitMsg || `Save ${name} at ${nowIso()}`
  pendingCommitMsg = null
  const g = git()
  if (!g.isAvailable()) {
    showMessage('✔ Saved (version history needs the kTeX desktop app)', 5000)
    return
  }
  await g.initRepo(folder)
  const oid = await g.commitAll(folder, commitMsg, fileStem)
  void refreshBranch()
  if (oid) {
    if ((await g.getRemotes(folder)).length) {
      // Push in the background so a slow / dead remote can't freeze the
      // editor every time the user hits Ctrl+S. The save itself already
      // happened locally; the push status is reported by onGitDone.
      showMessage('✔ Saved and snapshot created — uploading…', 0)
      startGitWorker('push', folder, 'origin')
    } else {
      showMessage('✔ Saved and snapshot created '
        + '(use Git → Connect to GitHub to enable cloud backup)', 6000)
    }
  } else {
    showMessage('✔ Saved (nothing new to snapshot)', 4000)
  }
}

// _commit_and_maybe_push: save with a commit message the user writes.
async function commitAndMaybePush(): Promise<void> {
  const path = appStore().get().path
  if (path === null) {
    await information('Save snapshot',
      'You need to save your document first before a snapshot can be created.\n\n'
      + 'Use File → Save (Ctrl+S) to save it, then try again.')
    return
  }
  const defaultMsg = `Save ${basename(path)} at ${nowIso()}`
  const msg = await promptText('Commit message', 'Describe what you changed:', defaultMsg)
  if (msg === null) return
  pendingCommitMsg = msg.trim() || defaultMsg
  await save()
}

// ---- push / pull off the main thread ----

type GitOp = 'pull' | 'push'
// _git_worker: an operation is on its way.
let workerRunning = false

export function gitWorkerRunning(): boolean {
  return workerRunning
}

// _start_git_worker
function startGitWorker(op: GitOp, repoDir: string, remoteName: string): Promise<void> {
  // Something is happening: the message stays until onGitDone replaces it.
  if (op === 'pull') showMessage(`Downloading latest from ${remoteName}…`, 0)
  workerRunning = true
  const g = git()
  const run = op === 'pull' ? g.pull(repoDir, remoteName) : g.push(repoDir, remoteName)
  return run
    .catch((exc: unknown): [boolean, string] => [false, `${op} crashed: ${exc instanceof Error ? exc.message : String(exc)}`])
    .then(([ok, msg]) => {
      workerRunning = false
      return onGitDone(op, ok, msg)
    })
}

// _on_git_done
async function onGitDone(op: GitOp, ok: boolean, msg: string): Promise<void> {
  if (op === 'pull') {
    if (ok) {
      if (msg.toLowerCase().includes('up to date')) {
        showMessage('✔ Already up to date — you have the latest version', 5000)
      } else {
        showMessage(`✔ ${msg}`, 6000)
        await reloadCurrent()
      }
    } else {
      clearMessage()
      await warning('Download failed',
        `${msg}\n\n`
        + 'What you can try:\n'
        + '  • Check your internet connection\n'
        + '  • Make sure the cloud URL is correct (Git → Connect to GitHub)\n'
        + '  • If the problem says "diverged", ask a colleague for help or use the git command line')
    }
  } else if (ok) {
    showMessage('✔ Saved, snapshot created, and uploaded to cloud', 5000)
  } else {
    // The brief status, and a dialog with the actual git error so the user
    // can act on it (most common: "Authentication failed").
    showMessage('✔ Saved and snapshot created (⚠ upload failed — see dialog)', 8000)
    await showPushFailureDialog(msg)
  }
}

// The advice _show_push_failure_dialog gives for a push error, as HTML.
export function pushFailureHtml(errorMsg: string, systemGit: boolean): string {
  const hints: string[] = []
  if (errorMsg.includes('Authentication') || errorMsg.includes('authentication')) {
    hints.push(
      'GitHub no longer accepts your account password over HTTPS — you need a '
      + '<b>Personal Access Token</b>.<br>'
      + "&nbsp;&nbsp;1. Go to <a href='https://github.com/settings/tokens'>"
      + 'github.com/settings/tokens</a> → Generate new token (classic)<br>'
      + '&nbsp;&nbsp;2. Tick the <code>repo</code> scope, generate, copy the token<br>'
      + '&nbsp;&nbsp;3. Next time the editor asks for a password, paste the token instead of your password.')
  } else if (errorMsg.toLowerCase().includes('not found') || errorMsg.includes('404')) {
    hints.push(
      'GitHub says the repository does not exist. Check that the URL in '
      + '<b>Git → Connect to GitHub</b> matches the one shown on the '
      + "repo's GitHub page (Code → HTTPS).")
  } else if (errorMsg.toLowerCase().includes('rejected') || errorMsg.includes('non-fast-forward')) {
    hints.push(
      'Someone else (or another machine) pushed to this branch since you last pulled. Use '
      + '<b>Git → Download latest from cloud</b> first, then save again.')
  }
  if (!systemGit) {
    hints.push(
      '<i>Tip: install Git for Windows so the editor can use your Windows Credential '
      + 'Manager for HTTPS pushes — '
      + "<a href='https://git-scm.com/download/win'>git-scm.com/download/win</a></i>")
  }
  // QLabel rich text: the error is inserted as it is in Python; escaped
  // here so a "<" in a git message cannot inject markup into the page.
  let body = `<b>Could not upload to cloud.</b><br><br><code>${escapeHtml(errorMsg)}</code>`
  if (hints.length) body += '<br><br>' + hints.join('<br><br>')
  return body
}

// QMessageBox opens rich-text links in the browser; in the web view a link
// would replace the app, so links in a message box go to the OS instead.
let linksHooked = false
function hookExternalLinks(): void {
  if (linksHooked || typeof document === 'undefined') return
  linksHooked = true
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('.kmb a[href]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    void platform().openUrl(a.href)
  }, true)
}

// _show_push_failure_dialog: a real push failure with actionable advice.
// The most common cause is HTTPS authentication: GitHub stopped accepting
// passwords, so the user needs a Personal Access Token stored in the
// credential manager the system `git` CLI talks to.
export async function showPushFailureDialog(errorMsg: string): Promise<void> {
  hookExternalLinks()
  const systemGit = await git().systemGitAvailable().catch(() => false)
  await messageBox({ title: 'Upload failed', icon: 'warning', html: pushFailureHtml(errorMsg, systemGit) })
}

// _pull_from_remote
async function pullFromRemote(): Promise<void> {
  const path = appStore().get().path
  if (path === null) {
    await information('Download latest',
      'You need to save your document first.\n\nUse File → Save (Ctrl+S), then try again.')
    return
  }
  const g = git()
  if (!g.isAvailable()) {
    await warning('Download latest', NO_GIT_CLOUD)
    return
  }
  const folder = dirname(path)
  const remotes = await g.getRemotes(folder)
  if (!remotes.length) {
    const ask = await question('Download latest',
      'This document is not connected to a cloud service yet.\n\n'
      + 'To download changes from a collaborator you first need to connect to '
      + 'GitHub, GitLab or another git server.\n\n'
      + 'Would you like to set that up now?')
    if (ask) await configureRemotes()
    return
  }
  let remoteName: string
  if (remotes.length === 1) {
    remoteName = remotes[0][0]
  } else {
    const chosen = await promptItem('Download from…', 'Which cloud service?', remotes.map(([n]) => n), 0)
    if (chosen === null) return
    remoteName = chosen
  }
  // Never a second network operation while one runs: two threads racing on
  // the same repo can crash libgit2.
  if (workerRunning) {
    showMessage('A git operation is already in progress, please wait…', 4000)
    return
  }
  await startGitWorker('pull', folder, remoteName)
}

// _configure_remotes
async function configureRemotes(): Promise<void> {
  const path = appStore().get().path
  if (path === null) {
    await information('Connect to cloud',
      'You need to save your document first so kTeX knows where to create the connection.\n\n'
      + 'Use File → Save (Ctrl+S), then try again.')
    return
  }
  if (!git().isAvailable()) {
    await warning('Connect to cloud', NO_GIT_CLOUD)
    return
  }
  await openRemoteDialog(dirname(path))
}

// _reload_current: re-read the document from disk after an outside change
// (a pull, a restore, a branch switch). Quietly nothing if the file has gone.
export async function reloadCurrent(): Promise<void> {
  const path = appStore().get().path
  if (path === null || !(await platform().exists(path).catch(() => false))) return
  try {
    await openPath(path)
  } catch (exc) {
    showMessage(`Reload after pull failed: ${exc instanceof Error ? exc.message : String(exc)}`, 6000)
  }
  await refreshBranch()
}

// _show_history
async function showHistory(): Promise<void> {
  const path = appStore().get().path
  if (path === null) {
    await information('Version history',
      'You need to save your document at least once before there is any history to show.\n\n'
      + 'Use File → Save (Ctrl+S), then try again.')
    return
  }
  const g = git()
  if (!g.isAvailable()) {
    await warning('Version history',
      'Git is not available in the browser version, so version history is unavailable.\n\n'
      + 'Use the kTeX desktop app.')
    return
  }
  const folder = dirname(path)
  if (!(await g.historyDetailed(folder, 1)).length) {
    await information('Version history',
      'No snapshots yet. Every time you save, kTeX automatically creates a snapshot.\n\n'
      + 'Save your document and come back here to see its history.')
    return
  }
  await openHistoryDialog(folder, docStem(path), reloadCurrent)
  await refreshBranch()
}

// _show_branches: the history dialog (with its branch bar) for the whole
// folder, no file filter.
async function showBranches(): Promise<void> {
  const path = appStore().get().path
  if (path === null) {
    await information('Branches', 'Save your document first so the repository exists.')
    return
  }
  if (!git().isAvailable()) {
    await warning('Branches', 'Git is not available in the browser version.\n\nUse the kTeX desktop app.')
    return
  }
  await openBranchesDialog(dirname(path), reloadCurrent)
  await refreshBranch()
}

// ---- the branch in the title ----

// _update_title: " [dev]" after the file name when its folder is a repo on
// a branch.
export async function refreshBranch(): Promise<void> {
  const path = appStore().get().path
  if (path === null) return
  const g = git()
  let br: string | null = null
  if (g.isAvailable()) br = await g.currentBranch(dirname(path)).catch(() => null)
  // A document's own history repo (KherveTeX makes it on dev, with no
  // remote): its branch tells the user nothing, so no tag.
  if (br === 'dev' && !(await g.getRemotes(dirname(path)).catch(() => [])).length) br = null
  setBranchSuffix(path, br ? ` [${br}]` : '')
}

// The store exists once main.tsx has set it up, after the action modules
// load: watch the document path from then on.
function watchPath(tries = 0): void {
  let store
  try {
    store = appStore()
  } catch {
    if (tries < 50) setTimeout(() => watchPath(tries + 1), 20)
    return
  }
  let last = store.get().path
  if (last !== null) void refreshBranch()
  store.subscribe(() => {
    const path = appStore().get().path
    if (path !== last) {
      last = path
      void refreshBranch()
    }
  })
}

if (typeof window !== 'undefined') setTimeout(() => watchPath(), 0)

onAfterSave((folder, name, stem) => gitSnapshot(folder, name, stem))

registerActions({
  commit_now: () => commitAndMaybePush(),
  pull: () => pullFromRemote(),
  configure_remotes: () => configureRemotes(),
  history: () => showHistory(),
  branches: () => showBranches(),
})
