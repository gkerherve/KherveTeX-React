// The project workflows of scripts/make_golden_project.py, through
// src/app/project.ts: after every step the folder must hold the same files
// as the Python app's, with the same bytes (chapter bodies, the master,
// project.json and document.json inside each .ktex), and the Documents list
// the same rows.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  chapterEntry, docMeta, document, paragraph, project, projectToJson, section, text, toJson,
} from '../src/core/model.ts'
import { FakeWindow } from './projectHarness.ts'

interface Snapshot {
  label: string
  listing: string[]
  files: Record<string, string>
  rows: string[]
  summary: string
  title: string
  chapter_idx: number
  project_path: string | null
  project: string | null
}

const golden = JSON.parse(readFileSync(new URL('./golden/project_flow.json', import.meta.url), 'utf-8')) as
  Record<string, Snapshot[]>
const DIR = '<DIR>'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    out.push(p)
    if (statSync(p).isDirectory()) out.push(...walk(p))
  }
  return out
}

// sorted(root.rglob("*")): paths compare part by part.
function partsCompare(a: string, b: string): number {
  const pa = a.split('/')
  const pb = b.split('/')
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return pa.length - pb.length
}

function snapshot(w: FakeWindow, root: string, label: string): Snapshot {
  const files: Record<string, string> = {}
  const listing: string[] = []
  const rels = walk(root).map(p => relative(root, p).replaceAll('\\', '/')).sort(partsCompare)
  for (const rel of rels) {
    const p = join(root, rel)
    if (rel.startsWith('.git') || rel.startsWith('.kherve/files') || statSync(p).isDirectory()) continue
    listing.push(rel)
    if (rel.endsWith('.tex') || rel.endsWith('.json')) {
      files[rel] = readFileSync(p, 'utf-8').replaceAll(root, DIR)
    } else if (rel.endsWith('.ktex')) {
      const z = unzipSync(readFileSync(p))
      for (const name of ['project.json', 'document.json']) {
        if (name in z) files[`${rel}!${name}`] = strFromU8(z[name]).replaceAll(root, DIR)
      }
    }
  }
  const s = w.session
  return {
    label, listing, files,
    rows: s.sidebar.rows.map(r => r.text),
    summary: s.sidebar.summaryText,
    title: `<b>${s.sidebar.titleText}</b>`,
    chapter_idx: s.chapterIdx,
    project_path: s.projectPath ? s.projectPath.replaceAll(root, DIR) : null,
    project: s.project ? projectToJson(s.project) : null,
  }
}

function freshRoot(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'proj-parity-')), 'proj')
  mkdirSync(root)
  return root
}

async function flowConvert(root: string): Promise<Snapshot[]> {
  const w = new FakeWindow()
  const steps: Snapshot[] = []
  w.setDocument(document([
    section(1, [text('Introduction')]),
    section(2, [text('Background')]),
    paragraph([text('Original words with 50% & '), text('bold', ['bold']), text('.')]),
  ], docMeta({ title: 'My thesis' })))
  const path = join(root, 'thesis.ktex.json')
  w.currentPath = path
  await w.writeTo(path)
  w.updateTitle()
  steps.push(snapshot(w, root, 'single'))
  w.textAnswer = 'Methods'
  await w.session.onAddDocument()
  steps.push(snapshot(w, root, 'convert'))
  w.textAnswer = 'Results & Discussion'
  await w.session.onAddDocument()
  await w.session.saveProject()
  steps.push(snapshot(w, root, 'add_second'))
  await w.session.reorderChapters([2, 0, 1])
  steps.push(snapshot(w, root, 'reorder'))
  await w.session.sidebar.setChecked(1, false)
  await w.session.saveProject()
  steps.push(snapshot(w, root, 'untick'))
  const other = `${root}-elsewhere`
  mkdirSync(other)
  writeFileSync(join(other, 'appendix.kdoc.json'), toJson(document([
    section(1, [text('Appendix A')]), paragraph([text('appendix words')])])))
  writeFileSync(join(other, 'extra.tex'), '\\documentclass{article}\n\\begin{document}\n\\section{Extra}\n'
    + 'Some \\textbf{bold} text.\n\\end{document}\n')
  writeFileSync(join(root, 'old.kdoc.json'), toJson(document([paragraph([text('old words')])])))
  await w.session.addExistingDocuments([join(other, 'appendix.kdoc.json'), join(other, 'extra.tex'),
    join(root, 'old.kdoc.json'), join(root, 'thesis.ktex')])
  steps.push(snapshot(w, root, 'add_existing'))
  const proj = w.session.project!
  proj.chapters[3].chapter_type = 'appendix'
  proj.chapters[3].numbering = 'roman'
  w.session.sidebar.setProject(proj)
  await w.session.saveProject()
  steps.push(snapshot(w, root, 'appendix'))
  w.questionAnswer = true
  await w.session.switchChapter(1)
  await w.session.removeChapter(2)
  steps.push(snapshot(w, root, 'remove'))
  await w.session.removeChapter(1)
  steps.push(snapshot(w, root, 'remove_open'))
  return steps
}

async function flowNewProject(root: string): Promise<Snapshot[]> {
  const w = new FakeWindow()
  const steps: Snapshot[] = []
  w.textAnswer = 'My Thesis: Part 1'
  w.folderAnswer = root
  await w.session.newProject()
  steps.push(snapshot(w, root, 'new'))
  w.textAnswer = 'Literature Review'
  await w.session.onAddDocument()
  await w.session.onAddDocument()
  await w.session.saveProject()
  steps.push(snapshot(w, root, 'add'))
  const proj = w.session.project!
  proj.chapters[0].chapter_type = 'frontmatter'
  proj.chapters[0].numbering = 'roman'
  proj.chapters.forEach((ch, i) => { ch.last_known_pages = [3, 12, 7][i] })
  w.session.sidebar.recomputeAutoPages()
  steps.push(snapshot(w, root, 'pages'))
  const pdf = join(root, '.kherve', 'out.pdf')
  writeFileSync(pdf, '%PDF')
  w.pdfs.set(pdf, Array(14).fill(''))
  const log = join(root, '.kherve', 'out.log')
  writeFileSync(log, 'KDOC:0:i:0\nKDOC:1:1:2\nKDOC:2:5:6\n'
    + 'KDOC:0:i:0\nKDOC:1:1:3\nKDOC:2:9:9\n')
  await w.session.pageCountsFromLog({ pdfPath: pdf, log: '' })
  unlinkSync(pdf)
  unlinkSync(log)
  await w.session.saveProject()
  steps.push(snapshot(w, root, 'log'))
  proj.auto_page_numbers = false
  proj.chapters[2].start_page = 40
  w.session.sidebar.setProject(proj)
  await w.session.saveProject()
  steps.push(snapshot(w, root, 'manual_pages'))
  return steps
}

async function flowLegacy(root: string): Promise<Snapshot[]> {
  const w = new FakeWindow()
  for (const [name, words] of [['Paper-1', 'main words'], ['test2', 'second']]) {
    writeFileSync(join(root, `${name}.kdoc.json`), toJson(document([paragraph([text(words)])])))
    writeFileSync(join(root, `${name}.tex`), 'old')
  }
  writeFileSync(join(root, 'Paper.tex'), 'old master')
  const proj = project()
  proj.meta.title = 'Paper'
  proj.chapters = [chapterEntry({ path: 'Paper-1.kdoc.json', label: 'Paper' }),
    chapterEntry({ path: 'test2.kdoc.json', label: 'test2' })]
  const pp = join(root, 'Paper.kdocproj.json')
  writeFileSync(pp, projectToJson(proj))
  await w.session.openProjectFromPath(pp)
  const steps = [snapshot(w, root, 'open')]
  await w.session.saveProject()
  steps.push(snapshot(w, root, 'converted'))
  return steps
}

const FLOWS: Record<string, (root: string) => Promise<Snapshot[]>> = {
  convert: flowConvert, new_project: flowNewProject, legacy: flowLegacy,
}

describe('project workflows match the Python app', () => {
  for (const [name, flow] of Object.entries(FLOWS)) {
    it(name, async () => {
      const steps = await flow(freshRoot())
      const want = golden[name]
      expect(steps.map(s => s.label)).toEqual(want.map(s => s.label))
      for (const [k, step] of steps.entries()) {
        const exp = want[k]
        expect(step.listing, `${name}/${step.label} listing`).toEqual(exp.listing)
        for (const [file, content] of Object.entries(exp.files)) {
          expect(step.files[file], `${name}/${step.label} ${file}`).toBe(content)
        }
        expect(Object.keys(step.files).sort(), `${name}/${step.label} files`).toEqual(Object.keys(exp.files).sort())
        expect(step.rows, `${name}/${step.label} rows`).toEqual(exp.rows)
        expect(step.summary, `${name}/${step.label} summary`).toBe(exp.summary)
        expect(step.title, `${name}/${step.label} title`).toBe(exp.title)
        expect(step.chapter_idx, `${name}/${step.label} chapter`).toBe(exp.chapter_idx)
        expect(step.project_path, `${name}/${step.label} path`).toBe(exp.project_path)
        expect(step.project, `${name}/${step.label} project`).toBe(exp.project)
      }
    })
  }
})
