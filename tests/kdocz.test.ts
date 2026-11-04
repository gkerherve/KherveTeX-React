// Port of tests/test_kdocz.py, plus interchange with the Python app itself.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  DOC_BASENAME, MANIFEST_BASENAME, exportLatexZip, isKdoczPath, isLegacyBundle, loadKdocz,
  readProjectJson, saveKdocz, writeProjectJson,
} from '../src/core/kdocz.ts'
import {
  docMeta, document, figure, mathBlock, paragraph, section, text, title, toJson,
} from '../src/core/model.ts'
import type { Document, Figure } from '../src/core/model.ts'
import { nodeFs } from './nodeFs.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'ktex-'))
const names = (path: string) => Object.keys(unzipSync(readFileSync(path)))

function makeDoc(imagePath = ''): Document {
  const children = [
    title([text('My doc')]),
    section(1, [text('Intro')]),
    paragraph([text('hello')]),
  ] as Document['children']
  if (imagePath) children.push(figure({ path: imagePath, caption: 'Fig', label: 'fig:1' }))
  return document(children, docMeta({ title: 'My doc' }))
}

describe('kdocz', () => {
  it('test_is_kdocz_path', () => {
    expect(isKdoczPath('/x/foo.kdocz')).toBe(true)
    expect(isKdoczPath('foo.KDOCZ')).toBe(true)
    expect(isKdoczPath('foo.ktexz')).toBe(true)
    expect(isKdoczPath('foo.KTEXZ')).toBe(true)
    expect(isKdoczPath('foo.kdoc.json')).toBe(false)
    expect(isKdoczPath('foo.ktex.json')).toBe(false)
    expect(isKdoczPath('foo.tex')).toBe(false)
  })

  it('test_roundtrip_without_images', async () => {
    const dir = tmp()
    const doc = makeDoc()
    const out = join(dir, 'doc.kdocz')
    await saveKdocz(doc, out, nodeFs)
    expect(existsSync(out)).toBe(true)
    expect(names(out)).toEqual(expect.arrayContaining([MANIFEST_BASENAME, DOC_BASENAME]))
    const [loaded] = await loadKdocz(out, join(dir, 'extracted'), nodeFs)
    expect(loaded).toEqual(doc)
  })

  it('test_roundtrip_bundles_referenced_image', async () => {
    const dir = tmp()
    const img = join(dir, 'photo.png')
    writeFileSync(img, Buffer.from('\x89PNG\r\n\x1a\nFAKE', 'latin1'))
    const out = join(dir, 'with-image.kdocz')
    await saveKdocz(makeDoc(img), out, nodeFs)
    const imageEntries = names(out).filter((n) => n.startsWith('figures/'))
    expect(imageEntries).toHaveLength(1)
    expect(imageEntries[0].endsWith('.png')).toBe(true)
    const [loaded] = await loadKdocz(out, join(dir, 'extracted'), nodeFs)
    const figs = loaded.children.filter((c): c is Figure => c.type === 'Figure')
    expect(figs).toHaveLength(1)
    expect(existsSync(figs[0].path)).toBe(true)
    expect(readFileSync(figs[0].path).subarray(0, 4).toString('latin1')).toBe('\x89PNG')
  })

  it('test_missing_image_keeps_original_path', async () => {
    const dir = tmp()
    const out = join(dir, 'missing.kdocz')
    await saveKdocz(makeDoc('not-on-disk.png'), out, nodeFs)
    expect(names(out).some((n) => n.startsWith('figures/'))).toBe(false)
    const [loaded] = await loadKdocz(out, join(dir, 'extract2'), nodeFs)
    expect((loaded.children.find((c) => c.type === 'Figure') as Figure).path).toBe('not-on-disk.png')
  })

  it('test_duplicate_image_paths_bundled_once', async () => {
    const dir = tmp()
    const img = join(dir, 'shared.jpg')
    writeFileSync(img, 'JPEG_FAKE')
    const doc = document([figure({ path: img, caption: 'A' }), figure({ path: img, caption: 'B' })])
    const out = join(dir, 'dedupe.kdocz')
    await saveKdocz(doc, out, nodeFs)
    expect(names(out).filter((n) => n.startsWith('figures/'))).toHaveLength(1)
  })

  it('test_schema_version_too_new_rejected', async () => {
    const dir = tmp()
    const out = join(dir, 'future.kdocz')
    writeFileSync(out, zipSync({
      [MANIFEST_BASENAME]: strToU8('{"format":"kdocz","schema_version":99,"app":"kherveDOC"}'),
      [DOC_BASENAME]: strToU8('{"type":"Document","meta":{},"children":[]}'),
    }))
    await expect(loadKdocz(out, join(dir, 'extract3'), nodeFs)).rejects.toThrow(/newer KherveTeX/)
  })

  it('test_ktex_is_a_bundle_and_old_names_are_legacy', () => {
    expect(isKdoczPath('paper.ktex')).toBe(true)
    expect(isKdoczPath('paper.ktex.json')).toBe(false)
    expect(isLegacyBundle('paper.ktexz')).toBe(true)
    expect(isLegacyBundle('paper.ktex')).toBe(false)
  })

  it('test_ktex_holds_json_tex_and_figures', async () => {
    const dir = tmp()
    const img = join(dir, 'plot.png')
    writeFileSync(img, Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))
    const doc = document([paragraph([text('hello')]), figure({ path: img, caption: 'A plot' })])
    const out = join(dir, 'paper.ktex')
    await saveKdocz(doc, out, nodeFs)
    const z = unzipSync(readFileSync(out))
    for (const n of ['manifest.json', 'document.json', 'document.tex', 'figures/figure_001.png']) {
      expect(Object.keys(z)).toContain(n)
    }
    const tex = new TextDecoder().decode(z['document.tex'])
    expect(tex).toContain('figures/figure_001.png')
    expect(tex).toContain('hello')
    const [loaded] = await loadKdocz(out, join(dir, 'x'), nodeFs)
    expect((loaded.children[1] as Figure).path.endsWith('figures/figure_001.png')).toBe(true)
  })

  it('test_latex_zip_export_has_main_figures_and_equations', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'plot.png'), Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))
    const doc = document([
      figure({ path: 'plot.png', caption: 'A plot' }),
      mathBlock('E = mc^2', true, 'eq:e'),
      mathBlock('a^2+b^2=c^2'),
    ])
    const z = unzipSync(await exportLatexZip(doc, dir, nodeFs, 'paper'))
    expect(new Set(Object.keys(z))).toEqual(new Set(['paper.tex', 'figures/figure_001.png',
      'equations/eq_001.tex', 'equations/eq_002.tex']))
    const dec = (n: string) => new TextDecoder().decode(z[n])
    expect(dec('equations/eq_001.tex')).toContain('\\begin{equation}')
    expect(dec('equations/eq_001.tex')).toContain('\\label{eq:e}')
    expect(dec('equations/eq_002.tex')).toContain('\\begin{equation*}')
    expect(dec('paper.tex')).toContain('figures/figure_001.png')
  })

  it('test_old_archive_with_images_dir_still_loads', async () => {
    const dir = tmp()
    const old = join(dir, 'old.ktexz')
    writeFileSync(old, zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'kdocz', schema_version: 1 })),
      'document.json': strToU8(toJson(document([figure({ path: 'images/figure_001.png' })]))),
      'images/figure_001.png': strToU8('\x89PNG'),
    }))
    const [doc] = await loadKdocz(old, join(dir, 'x'), nodeFs)
    expect((doc.children[0] as Figure).path.endsWith('images/figure_001.png')).toBe(true)
  })

  it('keeps project.json when the main document is saved again', async () => {
    const dir = tmp()
    const out = join(dir, 'main.ktex')
    await saveKdocz(makeDoc(), out, nodeFs)
    await writeProjectJson(out, '{"type": "Project"}', nodeFs)
    await saveKdocz(makeDoc(), out, nodeFs)
    expect(await readProjectJson(out, nodeFs)).toBe('{"type": "Project"}')
  })
})

// The two apps must open each other's files.
const PY_REPO = new URL('../../KherveTeX', import.meta.url).pathname
const hasPython = existsSync(join(PY_REPO, 'khervedoc', 'kdocz.py'))

describe.skipIf(!hasPython)('interchange with the Python app', () => {
  const py = (code: string, ...args: string[]) => execFileSync('python3', ['-c', code, ...args],
    { cwd: PY_REPO, encoding: 'utf-8' })

  it('Python opens a .ktex written here, with its figure', async () => {
    const dir = tmp()
    const img = join(dir, 'plot.png')
    writeFileSync(img, Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))
    const doc = makeDoc(img)
    const out = join(dir, 'ts.ktex')
    await saveKdocz(doc, out, nodeFs)
    const result = py(`
import sys
from pathlib import Path
from khervedoc.kdocz import load_kdocz
from khervedoc.model import to_json
doc, _ = load_kdocz(Path(sys.argv[1]), Path(sys.argv[2]))
fig = doc.children[-1]
print(Path(fig.path).read_bytes()[:4] == b"\\x89PNG")
fig.path = "X"
print(to_json(doc))
`, out, join(dir, 'py-extract'))
    const [ok, ...json] = result.split('\n')
    expect(ok).toBe('True')
    const expected = makeDoc('X')
    expect(json.join('\n').trimEnd()).toBe(toJson(expected))
  })

  it('a .ktex written by Python opens here, LaTeX and all', async () => {
    const dir = tmp()
    const out = join(dir, 'py.ktex')
    py(`
import sys
from pathlib import Path
from khervedoc.examples import GALLERY
from khervedoc.kdocz import save_kdocz
save_kdocz(GALLERY[2][2](), Path(sys.argv[1]))
`, out)
    const z = unzipSync(readFileSync(out))
    const [loaded] = await loadKdocz(out, join(dir, 'x'), nodeFs)
    const { serializeDocument } = await import('../src/core/serializer.ts')
    expect(serializeDocument(loaded)).toBe(new TextDecoder().decode(z['document.tex']))
    expect(toJson(loaded)).toBe(new TextDecoder().decode(z['document.json']))
  })
})
