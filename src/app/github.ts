// File ▸ Share ▸ GitHub: the document's connection to GitHub, without its
// widgets (ui/dialogs/GitHubDialog.tsx).
//
// Sign in once with a personal access token; the app keeps it as a secret
// (as the Overleaf token) and git gives it to GitHub on every upload and
// download (src-tauri git.rs), so no password is asked again. Then:
// publish the document to a new GitHub repository (made here, private by
// default), or connect it to one of yours; every save uploads, as with any
// cloud connection (actions/git.gitSnapshot). Open from GitHub downloads a
// repository into a folder and opens the document in it.
import * as gh from '../core/github.ts'
import type { Fetch, GitHubRepo, GitHubUser } from '../core/github.ts'
import { basename, dirname, join } from '../core/paths.ts'

type GitResult = [boolean, string]

// The git calls the session makes (platform/git.ts GitBackend).
export interface GitHubGit {
  initRepo(repoDir: string): Promise<boolean>
  getRemotes(repoDir: string): Promise<[string, string][]>
  setRemote(repoDir: string, name: string, url: string): Promise<boolean>
  removeRemote(repoDir: string, name: string): Promise<boolean>
  commitAll(repoDir: string, message: string | null, fileStem: string | null): Promise<string | null>
  push(repoDir: string, remoteName?: string): Promise<GitResult>
  clone?(url: string, dest: string): Promise<GitResult>
}

// What the session needs from the app (injected: tests give fakes).
export interface GitHubHost {
  fetch: Fetch
  git: GitHubGit
  secretGet(key: string): Promise<string | null>
  secretSet(key: string, value: string): Promise<void>
  listDir(path: string): Promise<{ name: string; isDir?: boolean }[]>
  exists(path: string): Promise<boolean>
}

export class GitHubSession {
  token = ''
  user: GitHubUser | null = null
  repos: GitHubRepo[] = []
  readonly host: GitHubHost

  constructor(host: GitHubHost) {
    this.host = host
  }

  // The sign-in kept from an earlier session, checked with GitHub; false
  // when there is none (or GitHub no longer takes it).
  async restore(): Promise<boolean> {
    const t = await this.host.secretGet(gh.TOKEN_KEY).catch(() => null)
    if (!t) return false
    try {
      this.user = await gh.getUser(this.host.fetch, t)
      this.token = t
      return true
    } catch {
      return false
    }
  }

  // Sign in with a token: who it is, kept for next time. Throws a
  // GitHubError the dialog shows.
  async signIn(token: string): Promise<GitHubUser> {
    const t = token.trim()
    if (!t) throw new gh.GitHubError(401, 'Paste the token GitHub gave you.')
    const user = await gh.getUser(this.host.fetch, t)
    await this.host.secretSet(gh.TOKEN_KEY, t)
    this.token = t
    this.user = user
    return user
  }

  async signOut(): Promise<void> {
    await this.host.secretSet(gh.TOKEN_KEY, '')
    this.token = ''
    this.user = null
    this.repos = []
  }

  async loadRepos(): Promise<GitHubRepo[]> {
    this.repos = await gh.listRepos(this.host.fetch, this.token)
    return this.repos
  }

  // The GitHub repository (owner/name) the document's folder uploads to,
  // or null.
  async connectedRepo(folder: string): Promise<string | null> {
    const remotes = await this.host.git.getRemotes(folder).catch(() => [])
    const origin = remotes.find(([n]) => n === 'origin') ?? remotes[0]
    return origin ? gh.repoOf(origin[1]) : null
  }

  // Publish: a new repository named `name`, the folder connected to it,
  // the document committed and uploaded. [ok, message, the repository].
  async publish(docPath: string, name: string, priv: boolean): Promise<[boolean, string, GitHubRepo | null]> {
    const repo = await gh.createRepo(this.host.fetch, this.token, gh.repoName(name), priv,
      `${basename(docPath)}, written in KherveTeX`)
    const [ok, msg] = await this.connectAndUpload(docPath, repo.clone_url)
    return [ok, ok ? `Published to ${repo.html_url}` : msg, repo]
  }

  // Connect the document's folder to an existing repository and upload.
  async connect(docPath: string, repo: GitHubRepo): Promise<[boolean, string]> {
    const [ok, msg] = await this.connectAndUpload(docPath, repo.clone_url)
    return [ok, ok ? `Connected to ${repo.html_url}` : msg]
  }

  private async connectAndUpload(docPath: string, url: string): Promise<[boolean, string]> {
    const g = this.host.git
    const folder = dirname(docPath)
    await g.initRepo(folder)
    if (!(await g.setRemote(folder, 'origin', url))) return [false, 'The connection could not be saved.']
    const stem = basename(docPath).replace(/\.[^.]*$/, '')
    await g.commitAll(folder, `Publish ${basename(docPath)} to GitHub`, stem)
    return g.push(folder, 'origin')
  }

  async disconnect(docPath: string): Promise<boolean> {
    return this.host.git.removeRemote(dirname(docPath), 'origin')
  }

  // Open from GitHub: download `repo` into `parent`/<its name> (a number
  // added when that folder exists) and the documents in it, .ktex first,
  // then .tex. [ok, message, the folder, the documents].
  async download(repo: GitHubRepo, parent: string): Promise<[boolean, string, string, string[]]> {
    let dest = join(parent, repo.name)
    for (let n = 2; await this.host.exists(dest); n++) dest = join(parent, `${repo.name}-${n}`)
    if (!this.host.git.clone) return [false, 'Downloading needs the KherveTeX desktop app.', dest, []]
    const [ok, msg] = await this.host.git.clone(gh.cloneUrl(repo.full_name), dest)
    if (!ok) return [false, msg, dest, []]
    return [true, msg, dest, await this.documentsIn(dest)]
  }

  // The documents of a downloaded folder (and its folders one level down),
  // .ktex before .tex.
  async documentsIn(folder: string): Promise<string[]> {
    const found: string[] = []
    const scan = async (dir: string, depth: number) => {
      const entries = await this.host.listDir(dir).catch(() => [])
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith('.')) continue
        const p = join(dir, e.name)
        if (e.isDir) {
          if (depth < 1) await scan(p, depth + 1)
        } else if (/\.(ktex|tex)$/i.test(e.name)) {
          found.push(p)
        }
      }
    }
    await scan(folder, 0)
    return found.sort((a, b) => Number(/\.tex$/i.test(a)) - Number(/\.tex$/i.test(b)))
  }
}
