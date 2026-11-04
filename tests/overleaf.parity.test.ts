// The Overleaf code against what the Python app produces
// (scripts/make_golden_overleaf.py → tests/golden/overleaf.json): the git
// address for pasted links, the error explanations, the Download-for-Overleaf
// zip entry by entry and in order, the folder Send pushes, and the document
// Get reads back from it.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportLatexZip } from '../src/core/kdocz.ts'
import { fromJson, toJson } from '../src/core/model.ts'
import * as overleaf from '../src/core/overleaf.ts'
import type { OverleafIo } from '../src/core/overleafIo.ts'
import { nodeFs } from './nodeFs.ts'

interface Case {
  document_json: string
  main_name: string
  extra_files: Record<string, string> | null
  zip_entries: [string, string][]
  project_files: [string, string][]
  main: string
  main_tex: string
  received_json: string
}

const golden = JSON.parse(readFileSync(new URL('./golden/overleaf.json', import.meta.url), 'utf-8')) as {
  git_url: [string, string | null, string | null][]
  explain: [string, string][]
  cache_key: Record<string, string>
  inputs: Record<string, string>
  cases: Record<string, Case>
}

// The encoding make_golden_overleaf.py stores bytes in.
function enc(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data)
  } catch {
    return 'base64:' + Buffer.from(data).toString('base64')
  }
}

const scrub = (s: string, ...pairs: [string, string][]) =>
  pairs.reduce((acc, [real, token]) => acc.split(real).join(token), s)

function walk(dir: string, root = dir): string[] {
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(p, root))
    else out.push(relative(root, p).split('\\').join('/'))
  }
  return out
}

// An already-cloned project: the clone step only checks out what is there.
function localIo(): OverleafIo {
  return {
    fs: nodeFs,
    listDir: async (dir) => readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name),
    listTree: async (dir) => walk(dir).filter(n => !n.startsWith('.git/')),
    removeTree: async () => { throw new Error('unexpected') },
    remoteUrl: async () => '/server.git',
    fetch: async () => {},
    checkoutRemoteBranch: async () => {},
    clone: async () => { throw new Error('unexpected') },
    stageAll: async () => { throw new Error('unexpected') },
    headTree: async () => null,
    commit: async () => {},
    push: async () => {},
  }
}

// Python ran in an empty working directory, so relative figure paths only
// resolve against base_dir; vitest's cwd (the repo) has no such files either.
const tmp = mkdtempSync(join(tmpdir(), 'overleaf-parity-'))
const base = join(tmp, 'base')
mkdirSync(base)
for (const [name, b64] of Object.entries(golden.inputs)) writeFileSync(join(base, name), Buffer.from(b64, 'base64'))

describe('overleaf parity', () => {
  it.each(golden.git_url)('git_url(%j)', (link, want, error) => {
    if (error === null) expect(overleaf.gitUrl(link)).toBe(want)
    else expect(() => overleaf.gitUrl(link)).toThrow(new overleaf.OverleafError(error))
  })

  it.each(golden.explain)('_explain(%j)', (text, want) => {
    expect(overleaf.explain(new Error(text)).message).toBe(want)
  })

  it.each(Object.entries(golden.cache_key))('cache key of %j', async (link, want) => {
    expect(await overleaf.cacheKey(link)).toBe(want)
  })

  for (const [name, c] of Object.entries(golden.cases)) {
    describe(name, () => {
      const doc = () => fromJson(c.document_json)

      it('document.json round-trips', () => {
        expect(toJson(doc())).toBe(c.document_json)
      })

      it('Download for Overleaf: the same entries, in order, with the same bytes', async () => {
        const z = unzipSync(await exportLatexZip(doc(), base, nodeFs, c.main_name))
        const got = Object.entries(z).map(([n, d]) => [n, scrub(enc(d), [base, '<BASE>'])])
        expect(got.map(e => e[0])).toEqual(c.zip_entries.map(e => e[0]))
        expect(got).toEqual(c.zip_entries)
      })

      it('Send writes the same project folder; Get reads the same document back', async () => {
        const folder = join(tmp, `${name}-project`)
        mkdirSync(folder)
        const main = await overleaf.writeProject(doc(), base, folder, nodeFs, c.main_name, c.extra_files)
        expect(relative(folder, main)).toBe(c.main)
        const files = walk(folder).sort().map(n => [n, scrub(enc(readFileSync(join(folder, n))), [base, '<BASE>'])])
        expect(files).toEqual(c.project_files)
        expect(relative(folder, (await overleaf.mainTex(folder, localIo()))!)).toBe(c.main_tex)
        mkdirSync(join(folder, '.git'))
        const [back, at] = await overleaf.receive('/server.git', '', folder, localIo())
        expect(at).toBe(folder)
        expect(scrub(toJson(back), [folder, '<FOLDER>'], [base, '<BASE>'])).toBe(c.received_json)
      })
    })
  }
})
