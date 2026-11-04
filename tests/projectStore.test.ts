// project_store.py has no unit tests of its own in KherveTeX: it is covered
// through MainWindow in tests/test_documents_panel.py (Qt). These are the
// project_store assertions from there, on the functions directly, plus the
// Python app reading and writing the same files.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { saveKdocz, writeProjectJson } from '../src/core/kdocz.ts'
import {
  chapterEntry, document, figure, paragraph, project, projectToJson, text, toJson,
} from '../src/core/model.ts'
import type { Document, Figure } from '../src/core/model.ts'
import {
  WORK_DIR, docStem, readDoc, readProject, uniquePath, workDir, writeDoc,
} from '../src/core/projectStore.ts'
import type { StoreFs } from '../src/core/projectStore.ts'
import { nodeFs } from './nodeFs.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'pstore-'))
const fs: StoreFs = { ...nodeFs, mkdir: async (p) => { await mkdir(p, { recursive: true }) } }
const words = (t: string): Document => document([paragraph([text(t)])])

describe('project_store', () => {
  it('work_dir is the hidden .kherve folder beside the documents, created on demand', async () => {
    const dir = tmp()
    expect(WORK_DIR).toBe('.kherve')
    expect(await workDir(dir, fs)).toBe(join(dir, '.kherve'))
    expect(existsSync(join(dir, '.kherve'))).toBe(true)
    expect(await workDir(dir, fs)).toBe(join(dir, '.kherve'))  // exist_ok
    expect(await workDir('/nowhere/x')).toBe('/nowhere/x/.kherve')
  })

  it('doc_stem strips the compound extensions', () => {
    expect(docStem('/a/thesis.kdocproj.json')).toBe('thesis')
    expect(docStem('/a/notes.ktex.json')).toBe('notes')
    expect(docStem('/a/Paper-1.kdoc.json')).toBe('Paper-1')
    expect(docStem('/a/paper.ktex')).toBe('paper')
    expect(docStem('/a/archive.tar.gz')).toBe('archive.tar')
    expect(docStem('/a/.hidden')).toBe('.hidden')
    expect(docStem('plain')).toBe('plain')
  })

  it('read_doc of a .ktex unpacks its figures under .kherve/files/<stem>', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'plot.png'), Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))
    const path = join(dir, 'appendix.ktex')
    await writeDoc(document([paragraph([text('appendix words')]), figure({ path: join(dir, 'plot.png') })]), path, fs)
    const doc = await readDoc(path, fs)
    expect(toJson(doc)).toContain('appendix words')
    const fig = doc.children[1] as Figure
    expect(fig.path).toBe(join(dir, '.kherve', 'files', 'appendix', 'figures', 'figure_001.png'))
    expect(existsSync(fig.path)).toBe(true)
  })

  it('read_doc and write_doc of a legacy .kdoc.json are plain JSON', async () => {
    const dir = tmp()
    const path = join(dir, 'old.kdoc.json')
    await writeDoc(words('second'), path, fs)
    expect(readFileSync(path, 'utf-8')).toBe(toJson(words('second')))
    expect(await readDoc(path, fs)).toEqual(words('second'))
    // Text mode: a file saved with Windows line endings still opens.
    writeFileSync(path, toJson(words('crlf')).replaceAll('\n', '\r\n'))
    expect(await readDoc(path, fs)).toEqual(words('crlf'))
  })

  it('write_doc keeps a main document\'s project when its text is saved', async () => {
    const dir = tmp()
    const main = join(dir, 'thesis.ktex')
    await writeDoc(words('main words'), main, fs)
    const proj = project({ chapters: [chapterEntry({ path: 'appendix.ktex', label: 'appendix' })] })
    await writeProjectJson(main, projectToJson(proj), fs)
    await writeDoc(words('changed'), main, fs)
    expect(await readProject(main, fs)).toEqual(proj)
    expect(toJson(await readDoc(main, fs))).toContain('changed')
  })

  it('read_project: a main .ktex, a legacy .kdocproj.json, or nothing', async () => {
    const dir = tmp()
    const proj = project({ chapters: [chapterEntry({ path: 'Paper-1.kdoc.json', label: 'Paper' }),
      chapterEntry({ path: 'test2.kdoc.json', label: 'test2' })] })
    const legacy = join(dir, 'Paper.KDOCPROJ.JSON')
    writeFileSync(legacy, projectToJson(proj))
    expect(await readProject(legacy, fs)).toEqual(proj)
    const solo = join(dir, 'solo.ktex')
    await saveKdocz(words('x'), solo, fs)
    expect(await readProject(solo, fs)).toBeNull()
    expect(await readProject(join(dir, 'missing.ktex'), fs)).toBeNull()
    expect(await readProject(join(dir, 'other.tex'), fs)).toBeNull()
  })

  it('unique_path numbers a name that is taken', async () => {
    const dir = tmp()
    expect(await uniquePath(dir, 'notes', fs)).toBe(join(dir, 'notes.ktex'))
    writeFileSync(join(dir, 'notes.ktex'), '')
    expect(await uniquePath(dir, 'notes', fs)).toBe(join(dir, 'notes_1.ktex'))
    writeFileSync(join(dir, 'notes_1.ktex'), '')
    expect(await uniquePath(dir, 'notes', fs)).toBe(join(dir, 'notes_2.ktex'))
    expect(await uniquePath(dir, 'notes', fs, '.tex')).toBe(join(dir, 'notes.tex'))
  })
})

// The two apps must share project folders.
const PY_REPO = new URL('../../KherveTeX', import.meta.url).pathname
const VENV = join(PY_REPO, '.venv', 'bin', 'python')
const PY = existsSync(VENV) ? VENV : 'python3'
const hasPython = existsSync(join(PY_REPO, 'khervedoc', 'project_store.py'))

describe.skipIf(!hasPython)('project folders shared with the Python app', () => {
  const py = (code: string, ...args: string[]) => execFileSync(PY, ['-c', code, ...args],
    { cwd: PY_REPO, encoding: 'utf-8' })

  it('Python reads what write_doc wrote, and the reverse', async () => {
    const dir = tmp()
    mkdirSync(join(dir, 'py'))
    await writeDoc(words('from ts'), join(dir, 'ts.ktex'), fs)
    await writeDoc(words('from ts json'), join(dir, 'ts.kdoc.json'), fs)
    const out = py(`
import sys
from pathlib import Path
from khervedoc import project_store as ps
from khervedoc.model import Document, Paragraph, Text, to_json
d = Path(sys.argv[1])
print(to_json(ps.read_doc(d / "ts.ktex")).replace("\\n", " "))
print(to_json(ps.read_doc(d / "ts.kdoc.json")).replace("\\n", " "))
ps.write_doc(Document(children=[Paragraph(children=[Text("from py")])]), d / "py" / "py.ktex")
ps.write_doc(Document(children=[Paragraph(children=[Text("from py json")])]), d / "py" / "py.kdoc.json")
print(ps.unique_path(d, "ts"), ps.doc_stem(d / "x.kdocproj.json"))
`, dir)
    const [a, b, c] = out.trimEnd().split('\n')
    expect(a).toBe(toJson(words('from ts')).replaceAll('\n', ' '))
    expect(b).toBe(toJson(words('from ts json')).replaceAll('\n', ' '))
    expect(c).toBe(`${await uniquePath(dir, 'ts', fs)} ${docStem(join(dir, 'x.kdocproj.json'))}`)
    expect(await readDoc(join(dir, 'py', 'py.ktex'), fs)).toEqual(words('from py'))
    expect(readFileSync(join(dir, 'py', 'py.kdoc.json'), 'utf-8')).toBe(toJson(words('from py json')))
  })
})
