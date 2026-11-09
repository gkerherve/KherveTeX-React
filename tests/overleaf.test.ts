// Port of tests/test_overleaf.py: sending to and getting from Overleaf,
// against a local git repository standing in for git.overleaf.com. The
// OverleafIo here drives the git CLI (pygit2 in Python, git2-rs in the app).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as overleaf from '../src/core/overleaf.ts'
import { overleafIo, setOverleafIo } from '../src/core/overleafIo.ts'
import type { OverleafIo } from '../src/core/overleafIo.ts'
import { docMeta, document, paragraph, section, text, title } from '../src/core/model.ts'
import type { Document } from '../src/core/model.ts'
import { nodeFs } from './nodeFs.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'overleaf-'))

let hasGit = true
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' })
} catch {
  hasGit = false
}

// A fixed identity, as a configured user.name / user.email would give.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test User', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User', GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
}

function git(cwd: string | null, ...args: string[]): string {
  try {
    return execFileSync('git', cwd ? ['-C', cwd, ...args] : args,
      { encoding: 'utf-8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    throw new Error(String(err.stderr || err.message).trim())
  }
}

function walk(dir: string, root = dir): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git') continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(p, root))
    else if (ent.isFile()) out.push(relative(root, p).split('\\').join('/'))
  }
  return out
}

const cliIo: OverleafIo = {
  fs: nodeFs,
  listDir: async (dir) => readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name),
  listTree: async (dir) => walk(dir),
  removeTree: async (dir) => rmSync(dir, { recursive: true, force: true }),
  remoteUrl: async (dir) => git(dir, 'remote', 'get-url', 'origin'),
  fetch: async (dir) => { git(dir, 'fetch', 'origin') },
  checkoutRemoteBranch: async (dir, branch) => { git(dir, 'checkout', '--force', '--detach', `origin/${branch}`) },
  clone: async (url, dir, _token, branch) => {
    mkdirSync(dirname(dir), { recursive: true })
    git(null, 'clone', '--branch', branch, url, dir)
  },
  stageAll: async (dir) => { git(dir, 'add', '--all'); return git(dir, 'write-tree') },
  headTree: async (dir) => {
    try { return git(dir, 'rev-parse', '--verify', '--quiet', 'HEAD^{tree}') } catch { return null }
  },
  commit: async (dir, ref, message, tree) => {
    let head = ''
    try { head = git(dir, 'rev-parse', '--verify', '--quiet', 'HEAD') } catch { /* unborn */ }
    const sha = git(dir, 'commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message)
    // libgit2's check: the branch must still be at the first parent.
    let tip = ''
    try { tip = git(dir, 'rev-parse', '--verify', '--quiet', ref) } catch { /* new branch */ }
    if (tip && tip !== head) throw new Error('failed to create commit: current tip is not the first parent')
    git(dir, 'update-ref', ref, sha)
  },
  push: async (dir, ref) => { git(dir, 'push', 'origin', ref) },
}

// A bare repository on branch master holding a main.tex, as Overleaf
// creates every project.
function overleafProject(tmpPath: string): string {
  const bare = join(tmpPath, 'server.git')
  git(null, 'init', '--bare', '--initial-branch=master', bare)
  const seed = join(tmpPath, 'seed')
  git(null, 'clone', bare, seed)
  writeFileSync(join(seed, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n')
  git(seed, 'checkout', '-B', 'master')
  git(seed, 'add', '--all')
  git(seed, 'commit', '-m', 'Initial')
  git(seed, 'push', 'origin', 'refs/heads/master')
  return bare
}

function makeDoc(t: string): Document {
  return document([
    title([text('Shared')]),
    section(1, [text('Intro')]),
    paragraph([text(t)]),
  ] as Document['children'], docMeta({ title: 'Shared' }))
}

afterEach(() => setOverleafIo(null))

describe('overleaf', () => {
  it.each([
    ['https://www.overleaf.com/project/0123456789abcdef01234567',
      'https://git.overleaf.com/0123456789abcdef01234567'],
    ['https://git.overleaf.com/0123456789abcdef01234567',
      'https://git.overleaf.com/0123456789abcdef01234567'],
    ['0123456789abcdef01234567',
      'https://git.overleaf.com/0123456789abcdef01234567'],
  ])('test_any_overleaf_link_becomes_its_git_address[%s]', (link, want) => {
    expect(overleaf.gitUrl(link)).toBe(want)
  })

  it.each(['', 'my project'])('test_unusable_link_is_explained[%s]', (link) => {
    expect(() => overleaf.gitUrl(link)).toThrow(overleaf.OverleafError)
  })

  it.skipIf(!hasGit)('test_send_writes_the_document_into_the_projects_main_file', async () => {
    const tmpPath = tmp()
    const server = overleafProject(tmpPath)
    setOverleafIo(cliIo)
    const msg = await overleaf.send(makeDoc('Our first draft.'), tmpPath, server, '',
      join(tmpPath, 'cache'), { 'kherveref.bib': '@misc{k,title={T}}\n' })
    expect(msg).toContain('main.tex')
    const check = join(tmpPath, 'check')
    git(null, 'clone', server, check)
    const tex = readFileSync(join(check, 'main.tex'), 'utf-8')
    expect(tex).toContain('Our first draft.')
    expect(tex).toContain('\\section{Intro}')
    expect(existsSync(join(check, 'kherveref.bib'))).toBe(true)
    // Nothing new to send the second time.
    const again = await overleaf.send(makeDoc('Our first draft.'), tmpPath, server, '', join(tmpPath, 'cache'))
    expect(again).toContain('already')
  }, 20_000)

  it.skipIf(!hasGit)('test_receive_reads_a_collaborators_change', async () => {
    const tmpPath = tmp()
    const server = overleafProject(tmpPath)
    setOverleafIo(cliIo)
    await overleaf.send(makeDoc('Our first draft.'), tmpPath, server, '', join(tmpPath, 'cache'))
    // A collaborator edits the .tex on Overleaf.
    const other = join(tmpPath, 'coauthor')
    git(null, 'clone', server, other)
    const main = join(other, 'main.tex')
    writeFileSync(main, readFileSync(main, 'utf-8').replace('Our first draft.', 'Their better sentence.'))
    git(other, 'add', '--all')
    git(other, 'commit', '-m', 'Edit on Overleaf')
    git(other, 'push', 'origin', 'refs/heads/master')

    const [doc, folder] = await overleaf.receive(server, '', join(tmpPath, 'cache'))
    const all = doc.children.flatMap(b => ('children' in b && Array.isArray(b.children) ? b.children : [])
      .map(c => (c as { text?: unknown }).text)).filter(t => typeof t === 'string').join(' ')
    expect(all).toContain('Their better sentence.')
    expect(folder).toBe(join(tmpPath, 'cache'))
  })

  // Beyond test_overleaf.py: the rest of overleaf.py and MainWindow's keys.

  // Pins a Python behaviour (pygit2 raises GitError, not OverleafError): the
  // fetched collaborators' commit is HEAD, the cached master is behind it.
  it.skipIf(!hasGit)('sending again after a collaborator pushed fails as in Python', async () => {
    const tmpPath = tmp()
    const server = overleafProject(tmpPath)
    setOverleafIo(cliIo)
    await overleaf.send(makeDoc('one'), tmpPath, server, '', join(tmpPath, 'cache'))
    const other = join(tmpPath, 'coauthor')
    git(null, 'clone', server, other)
    writeFileSync(join(other, 'main.tex'), readFileSync(join(other, 'main.tex'), 'utf-8').replace('one', 'two'))
    git(other, 'commit', '-am', 'Edit on Overleaf')
    git(other, 'push', 'origin', 'refs/heads/master')
    const err = await overleaf.send(makeDoc('three'), tmpPath, server, '', join(tmpPath, 'cache')).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(overleaf.OverleafError)
    expect(err.message).toBe('failed to create commit: current tip is not the first parent')
  })

  it('explains token, missing-project and other git failures', () => {
    expect(overleaf.explain(new Error('unexpected http status code: 401')).message).toMatch(/did not accept the token/)
    expect(overleaf.explain(new Error('Repository NOT FOUND')).message).toMatch(/could not find that project/)
    expect(overleaf.explain('boom').message).toBe('Overleaf: boom')
    // What the git command line says when Overleaf refuses the token.
    expect(overleaf.explain(new Error("fatal: could not read Username for 'https://git.overleaf.com': " +
      'terminal prompts disabled')).message).toMatch(/did not accept the token/)
  })

  it('a git failure while cloning reaches the user as an OverleafError', async () => {
    const io = { ...cliIo, clone: async () => { throw new Error('HTTP 403') } }
    await expect(overleaf.send(makeDoc('x'), tmp(), '0123456789abcdef01234567', 't', join(tmp(), 'c'),
      null, undefined, io)).rejects.toThrow(/did not accept the token/)
    await expect(overleaf.receive('0123456789abcdef01234567', 't', join(tmp(), 'c'), io))
      .rejects.toBeInstanceOf(overleaf.OverleafError)
  })

  it('main_tex prefers main.tex, else the first .tex that starts a document', async () => {
    const dir = tmp()
    expect(await overleaf.mainTex(dir, cliIo)).toBeNull()
    writeFileSync(join(dir, 'a.tex'), '\\section{x}\n')
    writeFileSync(join(dir, 'c.tex'), '\\documentclass{article}\n')
    writeFileSync(join(dir, 'b.tex'), '\\documentclass{report}\n')
    expect(await overleaf.mainTex(dir, cliIo)).toBe(join(dir, 'b.tex'))
    writeFileSync(join(dir, 'main.tex'), '')
    expect(await overleaf.mainTex(dir, cliIo)).toBe(join(dir, 'main.tex'))
  })

  it('a project without a main file is explained', async () => {
    const dir = tmp()
    mkdirSync(join(dir, '.git'))
    const io = { ...cliIo, remoteUrl: async () => '/srv/x.git', fetch: async () => {}, checkoutRemoteBranch: async () => {} }
    await expect(overleaf.receive('/srv/x.git', '', dir, io)).rejects.toThrow('The Overleaf project has no main .tex file yet.')
  })

  it('a cache of another project is replaced by a fresh clone', async () => {
    const dir = tmp()
    mkdirSync(join(dir, '.git'))
    const calls: string[] = []
    const io: OverleafIo = {
      ...cliIo,
      remoteUrl: async () => 'https://git.overleaf.com/ffffffffffffffffffffffff',
      removeTree: async (d) => { calls.push(`rm ${d}`) },
      clone: async (url, d, token, branch) => { calls.push(`clone ${url} ${d} ${token} ${branch}`) },
      fetch: async () => { calls.push('fetch') },
    }
    await expect(overleaf.receive('0123456789abcdef01234567', 'tok', dir, io)).rejects.toThrow(/no main/)
    expect(calls).toEqual([`rm ${dir}`, `clone https://git.overleaf.com/0123456789abcdef01234567 ${dir} tok master`])
  })

  it('remembers the link per document and caches by sha1 of the link', async () => {
    expect(overleaf.linkKey('/a/b.ktex', '/a/p.ktex')).toBe('overleaf//a/b.ktex')
    expect(overleaf.linkKey(null, '/a/p.ktex')).toBe('overleaf//a/p.ktex')
    expect(overleaf.linkKey(null, null)).toBe('overleaf/untitled')
    const link = 'https://www.overleaf.com/project/0123456789abcdef01234567'
    expect(await overleaf.cacheKey(link)).toBe(createHash('sha1').update(link).digest('hex').slice(0, 12))
  })

  it('uses the injected io by default', async () => {
    expect(() => overleafIo()).toThrow(/not available/)
    setOverleafIo(cliIo)
    expect(overleafIo()).toBe(cliIo)
  })
})

describe('sharing links', () => {
  it('refuses an Overleaf sharing link', async () => {
    const { gitUrl } = await import('../src/core/overleaf.ts')
    expect(() => gitUrl('https://www.overleaf.com/1234567890abcdefgh')).toThrow(/sharing link/)
    expect(gitUrl('https://www.overleaf.com/project/6af0ef740e2efc1538978a42'))
      .toBe('https://git.overleaf.com/6af0ef740e2efc1538978a42')
  })
})
