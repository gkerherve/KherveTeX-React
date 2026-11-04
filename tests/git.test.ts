// The git flow around the backend: MainWindow._git_snapshot,
// _commit_and_maybe_push, _on_git_done, _show_push_failure_dialog,
// _pull_from_remote and the branch in the title (mainwindow.py), over a
// fake git backend. git_backend.py itself is ported and tested in
// src-tauri/src/git.rs (tests/test_git_backend.py, test for test).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: {} as Record<string, (arg?: unknown) => unknown>,
  saveListeners: [] as ((folder: string, name: string, stem: string | null) => unknown)[],
  boxes: [] as { kind: string; title: string; text?: string; html?: string }[],
  questionAnswer: false,
  prompt: null as string | null,
  suffix: { path: '', suffix: '' },
  opened: [] as string[],
  storePath: '../src/app/store.ts',
}))

vi.mock('../src/app/actions.ts', () => ({
  registerActions: (m: Record<string, (arg?: unknown) => unknown>) => Object.assign(h.handlers, m),
}))
vi.mock('../src/app/actions/file.ts', () => ({
  onAfterSave: (l: (typeof h.saveListeners)[number]) => { h.saveListeners.push(l); return () => {} },
  openPath: async (p: string) => { h.opened.push(p) },
  // Save of an already-saved document: _write_to, then the snapshot.
  save: async () => {
    const { appStore } = await import(/* @vite-ignore */ h.storePath)
    const path = appStore().get().path!
    const name = path.split('/').pop()!
    for (const l of h.saveListeners) await l(path.slice(0, path.lastIndexOf('/')), name, name.replace(/\.ktex$/, ''))
  },
  setBranchSuffix: (path: string, suffix: string) => { h.suffix = { path, suffix } },
}))
vi.mock('../src/app/compile.ts', () => ({
  docStem: (p: string) => p.split('/').pop()!.replace(/\.[^.]*$/, ''),
}))
vi.mock('../src/platform/MessageBox.tsx', () => ({
  escapeHtml: (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  messageBox: async (o: { title: string; html?: string; text?: string }) => { h.boxes.push({ kind: 'box', ...o }); return 'OK' },
  information: async (title: string, text: string) => { h.boxes.push({ kind: 'information', title, text }) },
  warning: async (title: string, text: string) => { h.boxes.push({ kind: 'warning', title, text }) },
  critical: async (title: string, text: string) => { h.boxes.push({ kind: 'critical', title, text }) },
  question: async (title: string, text: string) => { h.boxes.push({ kind: 'question', title, text }); return h.questionAnswer },
}))
vi.mock('../src/ui/dialogs/EditorDialogs.tsx', () => ({
  promptText: async () => h.prompt,
  promptItem: async (_t: string, _l: string, items: string[]) => items[0],
}))
vi.mock('../src/ui/dialogs/HistoryDialog.tsx', () => ({ openHistoryDialog: async () => { h.boxes.push({ kind: 'history', title: '' }) } }))
vi.mock('../src/ui/dialogs/RemoteDialog.tsx', () => ({ openRemoteDialog: async () => { h.boxes.push({ kind: 'remote', title: '' }) } }))
vi.mock('../src/ui/dialogs/BranchesDialog.tsx', () => ({ openBranchesDialog: async () => { h.boxes.push({ kind: 'branches', title: '' }) } }))

import { document as newDocument, paragraph } from '../src/core/model.ts'

// The app modules are loaded by path at run time: the tests' tsconfig
// (nodenext) does not type-check the app's bundler-style imports.
const load = (p: string) => import(/* @vite-ignore */ p)
const { gitSnapshot, nowIso, pushFailureHtml, refreshBranch } = await load('../src/app/actions/git.ts')
const { appStore, initStore } = await load('../src/app/store.ts')
const { browserGit, setGitBackend } = await load('../src/platform/git.ts')

type GitResult = [boolean, string]
type GitBackend = Record<string, unknown>

interface Calls { commit: [string, string | null, string | null][]; push: string[]; pull: string[] }

function fakeGit(over: Partial<GitBackend> = {}, calls: Calls = { commit: [], push: [], pull: [] }): GitBackend {
  return {
    ...browserGit,
    isAvailable: () => true,
    initRepo: async () => true,
    commitAll: async (dir: string, msg: string | null, stem: string | null) => { calls.commit.push([dir, msg, stem]); return 'a'.repeat(40) },
    getRemotes: async () => [],
    currentBranch: async () => 'dev',
    push: async (dir: string): Promise<GitResult> => { calls.push.push(dir); return [true, 'Pushed to origin.'] },
    pull: async (dir: string): Promise<GitResult> => { calls.pull.push(dir); return [true, 'Already up to date.'] },
    systemGitAvailable: async () => true,
    historyDetailed: async () => [],
    ...over,
  }
}

const settle = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  initStore({
    doc: newDocument([paragraph([])]), path: '/docs/paper/My report.ktex', dirty: false,
    project: null, projectPath: null, chapterIndex: 0, tab: 'visual', layout: 'side', autoCompile: true,
    compile: { running: false, ok: null, log: '', pdf: null, serial: 0 }, status: '', docSerial: 0,
  })
  h.boxes.length = 0
  h.questionAnswer = false
  h.prompt = null
  h.opened.length = 0
})

describe('_git_snapshot', () => {
  it('commits the saved document and says how to enable cloud backup', async () => {
    const calls: Calls = { commit: [], push: [], pull: [] }
    setGitBackend(fakeGit({}, calls))
    await gitSnapshot('/docs/paper', 'My report.ktex', 'My report')
    expect(calls.commit).toHaveLength(1)
    const [dir, msg, stem] = calls.commit[0]
    expect(dir).toBe('/docs/paper')
    expect(stem).toBe('My report')
    expect(msg).toMatch(/^Save My report\.ktex at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/)
    expect(appStore().get().status).toBe(
      '\u2714 Saved and snapshot created (use Git \u2192 Connect to GitHub to enable cloud backup)')
    expect(calls.push).toEqual([])
  })

  it('says so when there is nothing new to snapshot', async () => {
    setGitBackend(fakeGit({ commitAll: async () => null }))
    await gitSnapshot('/docs/paper', 'My report.ktex', 'My report')
    expect(appStore().get().status).toBe('\u2714 Saved (nothing new to snapshot)')
  })

  it('pushes in the background when a remote is set', async () => {
    const calls: Calls = { commit: [], push: [], pull: [] }
    setGitBackend(fakeGit({ getRemotes: async () => [['origin', 'https://example.org/x.git']] }, calls))
    await gitSnapshot('/docs/paper', 'My report.ktex', 'My report')
    expect(appStore().get().status).toBe('\u2714 Saved and snapshot created \u2014 uploading\u2026')
    await settle()
    expect(calls.push).toEqual(['/docs/paper'])
    expect(appStore().get().status).toBe('\u2714 Saved, snapshot created, and uploaded to cloud')
  })

  it('shows the push error with advice when the upload fails', async () => {
    setGitBackend(fakeGit({
      getRemotes: async () => [['origin', 'https://github.com/u/r.git']],
      push: async () => [false, "fatal: Authentication failed for 'https://github.com/u/r.git/'"],
    }))
    await gitSnapshot('/docs/paper', 'My report.ktex', 'My report')
    await settle()
    await settle()
    expect(appStore().get().status).toBe('\u2714 Saved and snapshot created (\u26a0 upload failed \u2014 see dialog)')
    const box = h.boxes.find(b => b.title === 'Upload failed')!
    expect(box.html).toContain('<b>Could not upload to cloud.</b>')
    expect(box.html).toContain('Personal Access Token')
  })

  it('without git the save still reports', async () => {
    setGitBackend(browserGit)
    await gitSnapshot('/docs/paper', 'My report.ktex', 'My report')
    expect(appStore().get().status).toContain('\u2714 Saved')
  })
})

describe('_commit_and_maybe_push', () => {
  it('asks for a message and commits the save with it', async () => {
    const calls: Calls = { commit: [], push: [], pull: [] }
    setGitBackend(fakeGit({}, calls))
    h.prompt = '  Rewrote the introduction  '
    await h.handlers.commit_now()
    expect(calls.commit.map((c: [string, string | null, string | null]) => c[1])).toEqual(['Rewrote the introduction'])
    // The message is used once; the next save is a plain "Save ... at ...".
    await (await load('../src/app/actions/file.ts')).save()
    expect(calls.commit[1][1]).toMatch(/^Save My report\.ktex at /)
  })

  it('cancelling the message does not save', async () => {
    const calls: Calls = { commit: [], push: [], pull: [] }
    setGitBackend(fakeGit({}, calls))
    h.prompt = null
    await h.handlers.commit_now()
    expect(calls.commit).toEqual([])
  })

  it('needs a saved document', async () => {
    setGitBackend(fakeGit())
    appStore().set({ path: null })
    await h.handlers.commit_now()
    expect(h.boxes[0]).toMatchObject({ kind: 'information', title: 'Save snapshot' })
  })
})

describe('_pull_from_remote', () => {
  it('offers to connect when there is no remote', async () => {
    setGitBackend(fakeGit())
    h.questionAnswer = true
    await h.handlers.pull()
    expect(h.boxes.map(b => b.kind)).toEqual(['question', 'remote'])
  })

  it('reports up to date without reloading', async () => {
    setGitBackend(fakeGit({ getRemotes: async () => [['origin', 'x']] }))
    await h.handlers.pull()
    expect(appStore().get().status).toBe('\u2714 Already up to date \u2014 you have the latest version')
    expect(h.opened).toEqual([])
  })

  it('reloads the document after pulling commits', async () => {
    setGitBackend(fakeGit({
      getRemotes: async () => [['origin', 'x']],
      pull: async () => [true, 'Pulled 2 commits from origin/dev.'],
    }))
    const { setPlatform, platform } = await load('../src/platform/index.ts')
    setPlatform({ ...platform(), exists: async () => true })
    await h.handlers.pull()
    expect(appStore().get().status).toBe('\u2714 Pulled 2 commits from origin/dev.')
    expect(h.opened).toEqual(['/docs/paper/My report.ktex'])
  })

  it('shows what to try when the download fails', async () => {
    setGitBackend(fakeGit({ getRemotes: async () => [['origin', 'x']], pull: async () => [false, 'Fetch failed: boom'] }))
    await h.handlers.pull()
    const box = h.boxes.find(b => b.title === 'Download failed')!
    expect(box.text).toContain('Fetch failed: boom\n\nWhat you can try:')
  })
})

describe('_show_history', () => {
  it('says there are no snapshots yet', async () => {
    setGitBackend(fakeGit())
    await h.handlers.history()
    expect(h.boxes[0].text).toContain('No snapshots yet.')
  })

  it('opens the history dialog once there is a commit', async () => {
    setGitBackend(fakeGit({
      historyDetailed: async () => [{ oid: 'a'.repeat(40), short_oid: 'aaaaaaaa', timestamp: '', epoch: 0, author: '', subject: '', body: '' }],
    }))
    await h.handlers.history()
    expect(h.boxes.map(b => b.kind)).toEqual(['history'])
  })
})

describe('_update_title', () => {
  it('puts the branch after the file name', async () => {
    setGitBackend(fakeGit({ currentBranch: async () => 'draft' }))
    await refreshBranch()
    expect(h.suffix).toEqual({ path: '/docs/paper/My report.ktex', suffix: ' [draft]' })
    setGitBackend(fakeGit({ currentBranch: async () => null }))
    await refreshBranch()
    expect(h.suffix.suffix).toBe('')
  })
})

describe('_show_push_failure_dialog hints', () => {
  it('explains a missing repository', () => {
    expect(pushFailureHtml('remote: Repository not found.', true)).toContain('GitHub says the repository does not exist.')
  })
  it('explains a rejected push', () => {
    expect(pushFailureHtml('! [rejected] dev -> dev (non-fast-forward)', true)).toContain('Download latest from cloud')
  })
  it('suggests installing git when the CLI is missing', () => {
    expect(pushFailureHtml('boom', false)).toContain('git-scm.com/download/win')
    expect(pushFailureHtml('boom', true)).not.toContain('git-scm.com')
  })
  it('escapes the error text', () => {
    expect(pushFailureHtml('<script>', true)).toContain('<code>&lt;script&gt;</code>')
  })
})

it('nowIso is datetime.now().isoformat(timespec="seconds")', () => {
  expect(nowIso(new Date(2026, 0, 5, 7, 8, 9))).toBe('2026-01-05T07:08:09')
})
