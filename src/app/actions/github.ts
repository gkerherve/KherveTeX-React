// File ▸ Share ▸ GitHub (the dialog: ui/dialogs/GitHubDialog.tsx, its
// logic: app/github.ts) and File ▸ Open from GitHub.
import { platform } from '../../platform'
import { git } from '../../platform/git'
import { warning } from '../../platform/MessageBox'
import { promptItem } from '../../ui/dialogs/EditorDialogs'
import { showGitHub } from '../../ui/dialogs/GitHubDialog'
import { runAction, registerActions } from '../actions'
import { GitHubSession } from '../github'
import { appStore } from '../store'
import { offerSaveBefore, openPath, save } from './file'

let session: GitHubSession | null = null

function githubSession(): GitHubSession {
  if (!session) {
    const pf = platform()
    session = new GitHubSession({
      fetch: (url, init) => fetch(url, init),
      git: git(),
      secretGet: k => pf.secretGet(k),
      secretSet: (k, v) => pf.secretSet(k, v),
      listDir: async d => (await pf.listDir(d)).map(e => ({ name: e.name, isDir: e.isDir })),
      exists: p => pf.exists(p),
    })
  }
  return session
}

async function openGitHub(): Promise<void> {
  if (!git().isAvailable()) {
    await warning('GitHub', 'GitHub needs the kTeX desktop app (git is not available in the browser version).')
    return
  }
  const pf = platform()
  await showGitHub({
    session: githubSession(),
    docPath: () => appStore().get().path,
    save: () => save(),
    upload: () => save(),
    download: () => runAction('pull'),
    openUrl: url => { void pf.openUrl(url) },
    chooseFolder: async () => (await pf.openFolderDialog?.('Where to put the downloaded folder')) ?? null,
    openDocument: async (path, all) => {
      let pick: string | null = path
      if (all.length > 1) {
        const dir = path.replace(/[\\/][^\\/]*$/, '')
        const names = all.map(p => p.startsWith(dir) ? p.slice(dir.length + 1) : p)
        const chosen = await promptItem('Open from GitHub', 'The repository holds several documents. Open:', names)
        pick = chosen === null ? null : all[names.indexOf(chosen)]
      }
      if (pick && await offerSaveBefore(`opening ${pick.replace(/^.*[\\/]/, '')}`)) await openPath(pick)
    },
  })
}

registerActions({
  github: () => openGitHub(),
})
