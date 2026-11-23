// GitHub: the account a document is published from, and its repositories.
// The user signs in once with a personal access token (kept by the app as
// a secret, as the Overleaf token is); the token creates and lists
// repositories through GitHub's REST API, and git (src-tauri/git.rs) gives
// it to GitHub when it uploads, downloads or clones over https. The fetch
// is injected, so this runs in Vitest.

export const API = 'https://api.github.com'
export const TOKEN_KEY = 'github_token'
// Where a token is made: a classic token with the "repo" scope, named.
export const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=kTeX'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface GitHubUser {
  login: string
  name: string | null
  html_url: string
}

export interface GitHubRepo {
  full_name: string
  name: string
  private: boolean
  html_url: string
  clone_url: string
  description: string | null
  pushed_at: string | null
}

export class GitHubError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(fetch: Fetch, token: string, path: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(API + path, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.trim()}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new GitHubError(0, 'GitHub could not be reached. Check the internet connection.')
  }
  if (r.ok) return (r.status === 204 ? null : await r.json()) as T
  let detail = ''
  try {
    const body = await r.json() as { message?: string; errors?: { message?: string }[] }
    detail = body.errors?.map(e => e.message).filter(Boolean).join('; ') || body.message || ''
  } catch {
    // not JSON
  }
  throw new GitHubError(r.status, explain(r.status, detail))
}

// What a GitHub error means for the user.
export function explain(status: number, detail: string): string {
  if (status === 401) return 'GitHub did not accept the token. It may be mistyped, expired or revoked: make a new one.'
  if (status === 403) return 'The token may not do this. Make one with the "repo" scope.'
    + (detail ? ` (${detail})` : '')
  if (status === 422 && /already exists/i.test(detail)) return 'You already have a repository with that name on GitHub. Choose another name, or connect to it.'
  return detail ? `GitHub: ${detail}` : `GitHub answered ${status}.`
}

// Who the token signs in as.
export function getUser(fetch: Fetch, token: string): Promise<GitHubUser> {
  return call<GitHubUser>(fetch, token, '/user')
}

// The repositories the user can push to, most recently pushed first.
export async function listRepos(fetch: Fetch, token: string): Promise<GitHubRepo[]> {
  const out: GitHubRepo[] = []
  for (let page = 1; page <= 10; page++) {
    const batch = await call<GitHubRepo[]>(fetch, token,
      `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`)
    out.push(...batch)
    if (batch.length < 100) break
  }
  return out
}

// A new repository (private unless asked otherwise), empty: the first
// upload fills it.
export function createRepo(fetch: Fetch, token: string, name: string, priv: boolean,
  description = ''): Promise<GitHubRepo> {
  return call<GitHubRepo>(fetch, token, '/user/repos', {
    method: 'POST',
    body: JSON.stringify({ name, private: priv, description, auto_init: false }),
  })
}

// A repository name GitHub takes: letters, digits, '-', '_' and '.', from
// the document's name ("My thesis (v2)" -> "My-thesis-v2").
export function repoName(stem: string): string {
  return stem.normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100) || 'document'
}

// owner/name of a GitHub remote URL (https or ssh), or null for another
// host.
export function repoOf(url: string): string | null {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i
    .exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

export function webUrl(fullName: string): string {
  return `https://github.com/${fullName}`
}

export function cloneUrl(fullName: string): string {
  return `https://github.com/${fullName}.git`
}

// The search box over the user's repositories: every word in the name or
// description.
export function matchRepo(r: GitHubRepo, query: string): boolean {
  const hay = `${r.full_name} ${r.description ?? ''}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}
