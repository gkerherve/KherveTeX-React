// File ▸ Share ▸ GitHub (core/github.ts, app/github.ts) over a fake GitHub
// and a fake git: sign in, publish, connect, open from GitHub.
import { describe, expect, it } from 'vitest'
import * as gh from '../src/core/github.ts'
import { GitHubSession, type GitHubGit, type GitHubHost } from '../src/app/github.ts'

const TOKEN = 'ghp_good'
const user = { login: 'gkerherve', name: 'G. K.', html_url: 'https://github.com/gkerherve' }
const repo = (name: string, priv = true): gh.GitHubRepo => ({
  full_name: `gkerherve/${name}`, name, private: priv, html_url: `https://github.com/gkerherve/${name}`,
  clone_url: `https://github.com/gkerherve/${name}.git`, description: null, pushed_at: null,
})

function fakeGitHub(existing: gh.GitHubRepo[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetch: gh.Fetch = async (url, init) => {
    calls.push({ url, init })
    const auth = (init?.headers as Record<string, string>)?.Authorization
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
    if (auth !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' })
    if (url.endsWith('/user')) return json(200, user)
    if (url.includes('/user/repos?')) return json(200, existing)
    if (url.endsWith('/user/repos') && init?.method === 'POST') {
      const { name } = JSON.parse(String(init.body))
      if (existing.some(r => r.name === name)) {
        return json(422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] })
      }
      const r = repo(name)
      existing.push(r)
      return json(201, r)
    }
    return json(404, { message: 'Not Found' })
  }
  return { fetch, calls }
}

function fakeHost(existing: gh.GitHubRepo[], secrets = new Map<string, string>()) {
  const remotes = new Map<string, [string, string][]>()
  const log: string[] = []
  const files: Record<string, { name: string; isDir?: boolean }[]> = {
    '/Docs/thesis': [{ name: 'notes.tex' }, { name: 'thesis.ktex' }, { name: '.git', isDir: true }, { name: 'ch', isDir: true }],
    '/Docs/thesis/ch': [{ name: 'intro.ktex' }],
  }
  const git = {
    isAvailable: () => true,
    initRepo: async (d: string) => { log.push(`init ${d}`); return true },
    setRemote: async (d: string, n: string, u: string) => { remotes.set(d, [[n, u]]); log.push(`remote ${n} ${u}`); return true },
    removeRemote: async (d: string) => { remotes.delete(d); return true },
    getRemotes: async (d: string) => remotes.get(d) ?? [],
    commitAll: async (_d: string, m: string, stem: string | null) => { log.push(`commit ${stem}: ${m}`); return 'abc' },
    push: async (_d: string, r = 'origin') => { log.push(`push ${r}`); return [true, `Pushed to ${r}.`] as [boolean, string] },
    clone: async (u: string, d: string) => { log.push(`clone ${u} ${d}`); return [true, 'ok'] as [boolean, string] },
  } as unknown as GitHubGit
  const { fetch, calls } = fakeGitHub(existing)
  const host: GitHubHost = {
    fetch, git,
    secretGet: async k => secrets.get(k) ?? null,
    secretSet: async (k, v) => { if (v) secrets.set(k, v); else secrets.delete(k) },
    listDir: async d => files[d] ?? [],
    exists: async p => p === '/Docs/paper',
  }
  return { host, log, calls, secrets }
}

describe('github', () => {
  it('reads GitHub remote URLs', () => {
    expect(gh.repoOf('https://github.com/me/paper.git')).toBe('me/paper')
    expect(gh.repoOf('git@github.com:me/paper.git')).toBe('me/paper')
    expect(gh.repoOf('https://github.com/me/paper')).toBe('me/paper')
    expect(gh.repoOf('https://gitlab.com/me/paper.git')).toBe(null)
  })
  it('makes a repository name GitHub takes', () => {
    expect(gh.repoName('My thesis (v2)')).toBe('My-thesis-v2')
    expect(gh.repoName('Étude')).toBe('Etude')
    expect(gh.repoName('***')).toBe('document')
  })
  it('signs in, keeps the sign-in and signs out', async () => {
    const { host, secrets } = fakeHost([])
    const s = new GitHubSession(host)
    await expect(s.signIn('ghp_bad')).rejects.toThrow(/did not accept the token/)
    expect(secrets.size).toBe(0)
    expect((await s.signIn(` ${TOKEN} `)).login).toBe('gkerherve')
    expect(secrets.get(gh.TOKEN_KEY)).toBe(TOKEN)
    const again = new GitHubSession(host)
    expect(await again.restore()).toBe(true)
    expect(again.user?.login).toBe('gkerherve')
    await again.signOut()
    expect(secrets.size).toBe(0)
    expect(await new GitHubSession(host).restore()).toBe(false)
  })
  it('publishes a document to a new private repository and uploads it', async () => {
    const existing = [repo('paper')]
    const { host, log, calls } = fakeHost(existing)
    const s = new GitHubSession(host)
    await s.signIn(TOKEN)
    const [ok, msg, r] = await s.publish('/Docs/My thesis/My thesis.ktex', 'My thesis', true)
    expect(ok).toBe(true)
    expect(msg).toBe('Published to https://github.com/gkerherve/My-thesis')
    expect(r?.full_name).toBe('gkerherve/My-thesis')
    const post = calls.find(c => c.init?.method === 'POST')!
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ name: 'My-thesis', private: true })
    expect(log).toEqual([
      'init /Docs/My thesis', 'remote origin https://github.com/gkerherve/My-thesis.git',
      'commit My thesis: Publish My thesis.ktex to GitHub', 'push origin'])
    expect(await s.connectedRepo('/Docs/My thesis')).toBe('gkerherve/My-thesis')
    await expect(s.publish('/Docs/x/paper.ktex', 'paper', true)).rejects.toThrow(/already have a repository/)
  })
  it('connects to an existing repository and disconnects', async () => {
    const { host } = fakeHost([repo('paper')])
    const s = new GitHubSession(host)
    await s.signIn(TOKEN)
    expect((await s.loadRepos()).map(r => r.name)).toEqual(['paper'])
    expect(await s.connect('/Docs/p/paper.ktex', s.repos[0])).toEqual([true, 'Connected to https://github.com/gkerherve/paper'])
    expect(await s.connectedRepo('/Docs/p')).toBe('gkerherve/paper')
    await s.disconnect('/Docs/p/paper.ktex')
    expect(await s.connectedRepo('/Docs/p')).toBe(null)
  })
  it('opens from GitHub: downloads into a new folder and finds the documents', async () => {
    const { host, log } = fakeHost([])
    const s = new GitHubSession(host)
    const [ok, , dest, docs] = await s.download(repo('thesis'), '/Docs')
    expect(ok).toBe(true)
    expect(dest).toBe('/Docs/thesis')
    expect(log).toEqual(['clone https://github.com/gkerherve/thesis.git /Docs/thesis'])
    expect(docs).toEqual(['/Docs/thesis/ch/intro.ktex', '/Docs/thesis/thesis.ktex', '/Docs/thesis/notes.tex'])
    // A folder already there is left alone.
    expect((await s.download(repo('paper'), '/Docs'))[2]).toBe('/Docs/paper-2')
  })
})
