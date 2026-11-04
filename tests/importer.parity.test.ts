import { readFileSync, existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { importBodyFragment, importMd, importTex } from '../src/core/importers.ts'
import { document, toJson } from '../src/core/model.ts'

type Case = { tex: string; imported_json?: string }
const golden = (name: string) => {
  const p = new URL(`./golden/${name}`, import.meta.url)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}

const run = (fn: () => string) => {
  try {
    return fn()
  } catch {
    return '!ERROR'
  }
}
const sameError = (got: string, want: string) => (want.startsWith('!ERROR') ? got === '!ERROR' : got === want)

describe('import_tex parity with Python (serialized documents)', () => {
  const docs = golden('documents.json') as Record<string, Case>
  const cases = Object.entries(docs).filter(([, c]) => c.imported_json !== undefined)
  it('has cases', () => expect(cases.length).toBeGreaterThan(0))
  for (const [name, c] of cases) {
    it(name, () => {
      const got = run(() => toJson(importTex(c.tex)))
      if (!sameError(got, c.imported_json!)) expect(got).toBe(c.imported_json)
    })
  }
})

describe('import_tex parity with Python (.tex sources)', () => {
  const srcs = golden('tex_sources.json') as Record<string, { source: string; imported_json: string }>
  it.skipIf(Object.keys(srcs).length > 0)('no example .tex sources in the corpus', () => {})
  for (const [name, c] of Object.entries(srcs)) {
    it(name, () => {
      const got = run(() => toJson(importTex(c.source)))
      if (!sameError(got, c.imported_json)) expect(got).toBe(c.imported_json)
    })
  }
})

// Python builds the package list from a set, whose order is randomised per
// process; compare it as a sorted list.
const sortPackages = (json: string) => {
  if (json.startsWith('!ERROR')) return json
  const d = JSON.parse(json)
  d.meta.packages.sort()
  return JSON.stringify(d)
}

describe('import_md parity with Python', () => {
  const md = golden('markdown.json') as Record<string, { source: string; imported_json: string }>
  it.skipIf(Object.keys(md).length > 0)('no example .md sources in the corpus', () => {})
  for (const [name, c] of Object.entries(md)) {
    it(name, () => {
      const got = run(() => toJson(importMd(c.source)))
      if (!sameError(got, c.imported_json)) expect(sortPackages(got)).toBe(sortPackages(c.imported_json))
    })
  }
})

type Src = { source: string; imported_json: string }
const importer = golden('importer.json') as {
  tex: Record<string, Src>; md: Record<string, Src>; fragments: Record<string, { source: string; blocks_json: string }>
}

describe('import_tex parity with Python (importer corpus)', () => {
  for (const [name, c] of Object.entries(importer.tex)) {
    it(name, () => {
      const got = run(() => toJson(importTex(c.source)))
      if (!sameError(got, c.imported_json)) expect(got).toBe(c.imported_json)
    })
  }
})

describe('import_md parity with Python (importer corpus)', () => {
  for (const [name, c] of Object.entries(importer.md)) {
    it(name, () => {
      const got = run(() => toJson(importMd(c.source)))
      if (!sameError(got, c.imported_json)) expect(sortPackages(got)).toBe(sortPackages(c.imported_json))
    })
  }
})

describe('import_body_fragment parity with Python (importer corpus)', () => {
  for (const [name, c] of Object.entries(importer.fragments)) {
    it(name, () => {
      const got = run(() => toJson(document(importBodyFragment(c.source))))
      if (!sameError(got, c.blocks_json)) expect(got).toBe(c.blocks_json)
    })
  }
})
