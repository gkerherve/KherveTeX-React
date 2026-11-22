// LaTeX packages as archives: bzip2 and tar read here, zip and gzip by
// fflate; the main .tex found among the files.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gzipSync, zipSync } from 'fflate'
import { bunzip2, cleanPath, findMainTex, isArchiveName, readArchive } from '../src/core/archive.ts'

const DIR = join(__dirname, 'fixtures', 'archive')
const read = (p: string) => new Uint8Array(readFileSync(join(DIR, p)))
const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b)

// pkg/data.txt when paper.tar.bz2 was made (1.5 MB: two bzip2 blocks).
function data(): string {
  let s = ''
  for (let i = 0; i < 9000; i++) s += `line ${i} ${'x'.repeat(i % 300)}${'ab'.repeat(i % 7)}\n`
  return s
}

// A minimal ustar archive of *files*.
function tar(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const [name, body] of Object.entries(files)) {
    const h = new Uint8Array(512)
    h.set(enc.encode(name), 0)
    h.set(enc.encode('0000644\0'), 100)
    const b = enc.encode(body)
    h.set(enc.encode(b.length.toString(8).padStart(11, '0') + '\0'), 124)
    h[156] = 48
    h.set(enc.encode('ustar\x0000'), 257)
    h.fill(32, 148, 156)
    let sum = 0
    for (const x of h) sum += x
    h.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148)
    parts.push(h, b, new Uint8Array((512 - (b.length % 512)) % 512))
  }
  parts.push(new Uint8Array(1024))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

describe('bunzip2', () => {
  it('decodes a small file', () => {
    expect(text(bunzip2(read('single.tex.bz2')))).toBe(readFileSync(join(DIR, 'single.tex'), 'utf8'))
  })

  it('refuses what is not bzip2', () => {
    expect(() => bunzip2(new Uint8Array([1, 2, 3, 4]))).toThrow(/bzip2/)
  })
})

describe('readArchive', () => {
  it('reads a .tar.bz2 package with its folders', () => {
    const files = readArchive(read('paper.tar.bz2'), 'paper.tar.bz2')
    expect([...files.keys()].sort()).toEqual(['data.txt', 'figures/plot.png', 'main.tex', 'mystyle.sty',
      'sections/two.tex', 'snippet.tex'])
    expect(text(files.get('data.txt'))).toBe(data())
    expect(text(files.get('main.tex'))).toBe(readFileSync(join(DIR, 'pkg', 'main.tex'), 'utf8'))
    expect(files.get('figures/plot.png')).toEqual(read('pkg/figures/plot.png'))
  })

  it('reads zip, tar and tar.gz', () => {
    const files = { 'proj/main.tex': '\\documentclass{article}\\begin{document}x\\end{document}', 'proj/fig/a.txt': 'A' }
    const enc = new TextEncoder()
    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc.encode(v)])))
    for (const [bytes, name] of [[zip, 'p.zip'], [tar(files), 'p.tar'], [gzipSync(tar(files)), 'p.tar.gz']] as const) {
      const got = readArchive(bytes, name)
      expect(text(got.get('proj/fig/a.txt'))).toBe('A')
      expect(findMainTex(got)).toBe('proj/main.tex')
    }
  })

  it('a single compressed .tex keeps its name', () => {
    const got = readArchive(read('single.tex.bz2'), 'single.tex.bz2')
    expect([...got.keys()]).toEqual(['single.tex'])
  })

  it('skips macOS litter and paths that leave the folder', () => {
    expect(cleanPath('__MACOSX/a/._x.tex')).toBe('')
    expect(cleanPath('a/._x.tex')).toBe('')
    expect(cleanPath('../evil.tex')).toBe('')
    expect(cleanPath('./a//b.tex')).toBe('a/b.tex')
  })

  it('refuses other files', () => {
    expect(() => readArchive(new TextEncoder().encode('hello'), 'x.zip')).toThrow(/not an archive/)
  })
})

describe('findMainTex', () => {
  it('prefers the file with \\begin{document}', () => {
    const files = readArchive(read('paper.tar.bz2'), 'paper.tar.bz2')
    expect(findMainTex(files)).toBe('main.tex')
    expect(findMainTex(new Map([['a.tex', new TextEncoder().encode('\\section{x}')]]))).toBeNull()
  })

  it('knows archive names', () => {
    expect(isArchiveName('arxiv.tar.gz')).toBe(true)
    expect(isArchiveName('src.tbz2')).toBe(true)
    expect(isArchiveName('paper.tex')).toBe(false)
  })
})
