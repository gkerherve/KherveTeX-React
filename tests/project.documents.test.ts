// tests/test_documents_panel.py: the Documents panel — always there, lists
// a single document, and turns it into a project the moment a second
// document is added. MainWindow is tests/projectHarness.ts.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { saveKdocz } from '../src/core/kdocz.ts'
import { docMeta, document, paragraph, section, text, toJson, chapterEntry, project, projectToJson } from '../src/core/model.ts'
import type { Project } from '../src/core/model.ts'
import { readDoc } from '../src/core/projectStore.ts'
import { serializeProjectMaster } from '../src/core/serializer.ts'
import { FakeWindow, projectFs } from './projectHarness.ts'

let tmp: string
let window: FakeWindow
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docs-panel-'))
  window = new FakeWindow()
})

const visible = (dir: string) => readdirSync(dir).filter(n => !n.startsWith('.')).sort()

// Intro (this file), then Methods, then Results.
async function threeDocs(): Promise<Project> {
  window.setDocument(document([section(1, [text('Introduction')]), paragraph([text('intro words')])]))
  const path = join(tmp, 'thesis.ktex.json')
  window.currentPath = path
  await window.writeTo(path)
  for (const name of ['Methods', 'Results']) {
    window.textAnswer = name
    await window.session.onAddDocument()
  }
  return window.session.project!
}

const labels = () => window.session.project!.chapters.map(ch => ch.label || ch.path)

function includes(): string[] {
  const master = readFileSync(join(tmp, '.kherve', 'thesis-master.tex'), 'utf-8')
  return [...master.matchAll(/\\(?:include|input)\{([^}]+)\}/g)].map(m => m[1])
}

describe('test_documents_panel', () => {
  it('test_single_document_is_listed', async () => {
    expect(window.dock).toBe(false)      // hidden by default
    expect(window.names()).toHaveLength(1)
    const path = join(tmp, 'thesis.ktex.json')
    window.currentPath = path
    await window.writeTo(path)
    window.updateTitle()
    expect(window.names()[0]).toContain('thesis')
  })

  it('test_adding_a_document_shows_both', async () => {
    window.setDocument(document([section(1, [text('Introduction')]), paragraph([text('Original words.')])],
      docMeta({ title: 'My thesis' })))
    const path = join(tmp, 'thesis.ktex.json')
    window.currentPath = path
    await window.writeTo(path)
    window.textAnswer = 'Methods'
    await window.session.onAddDocument()
    const proj = window.session.project
    expect(proj?.chapters).toHaveLength(2)
    expect(window.names()).toHaveLength(2)
    expect(window.text()).toContain('Methods')
    await window.session.switchChapter(0)
    expect(window.text()).toContain('Original words.')
    // The folder shows only the documents; working files are hidden.
    expect(visible(tmp)).toEqual(['methods.ktex', 'thesis.ktex'])
    const work = join(tmp, '.kherve')
    const master = readFileSync(join(work, 'thesis-master.tex'), 'utf-8')
    expect(master).toContain('\\begin{document}')           // not a chapter body
    expect(master).toContain('\\input{thesis}')
    expect(master).toContain('\\input{methods}')
    expect(readFileSync(join(work, 'thesis.tex'), 'utf-8')).toContain('Original words.')
  })

  it('test_section_numbers_continue_across_documents', async () => {
    window.setDocument(document([section(1, [text('Introduction')]), section(2, [text('Background')]),
      paragraph([text('x')])]))
    const path = join(tmp, 'thesis.ktex.json')
    window.currentPath = path
    await window.writeTo(path)
    window.textAnswer = 'Methods'
    await window.session.onAddDocument()
    expect(window.firstNumber()).toBe('2')          // continues after "1 Introduction"
    await window.session.switchChapter(0)
    expect(window.firstNumber()).toBe('1')
    await window.session.sidebar.setChecked(0, false)
    await window.session.switchChapter(1)
    // Left out of the PDF, Introduction still counts: Methods stays 2.
    expect(window.firstNumber()).toBe('2')
  })

  // A document from outside the project (an example, an import) opened
  // over it: the project is left and the list shows only that document.
  it('leaving the project empties the Documents list', async () => {
    await threeDocs()
    expect(window.names().length).toBe(3)
    await window.session.leaveProject()
    expect(window.session.project).toBeNull()
    expect(window.names().length).toBe(1)
    expect(window.session.sidebar.projectControlsVisible).toBe(false)
  })

  // ---------------------------------------------------------- order / remove

  it('test_move_down_reorders_project_and_master', async () => {
    await threeDocs()
    await window.session.saveProject()
    const before = includes()
    expect(before).toHaveLength(3)
    window.session.sidebar.setCurrentRow(0)
    await window.session.sidebar.moveDown()
    expect(includes()).toEqual([before[1], before[0], before[2]])
    expect(labels()[0]).toContain('Methods')
  })

  it('test_reordering_keeps_each_document_with_its_text', async () => {
    await threeDocs()
    await window.session.reorderChapters([2, 0, 1])
    await window.session.switchChapter(1)
    expect(window.text()).toContain('intro words')
    await window.session.switchChapter(0)
    expect(window.text()).toContain('Results')
  })

  it('test_open_document_is_renumbered_when_moved', async () => {
    await threeDocs()
    await window.session.switchChapter(2)           // Results: section 3
    expect(window.firstNumber()).toBe('3')
    window.session.sidebar.setCurrentRow(2)
    await window.session.sidebar.moveUp()
    await window.session.sidebar.moveUp()           // now first
    expect(window.session.chapterIdx).toBe(0)
    expect(window.firstNumber()).toBe('1')
    expect(window.text()).toContain('Results')
  })

  it('test_other_document_renumbers_when_open_one_moves', async () => {
    await threeDocs()
    await window.session.switchChapter(0)           // Introduction: 1
    await window.session.reorderChapters([1, 0, 2]) // Methods goes first
    expect(window.session.chapterIdx).toBe(1)
    expect(window.firstNumber()).toBe('2')
  })

  it('test_drag_and_drop_reorders', async () => {
    await threeDocs()
    // Row 2 dragged to the top: the rows now hold old indices 2, 0, 1.
    await window.session.sidebar.rowsMoved([2, 0, 1])
    expect(labels()[0]).toContain('Results')
    expect(window.session.project!.chapters).toHaveLength(3)
  })

  it('test_remove_button_takes_document_out', async () => {
    await threeDocs()
    window.questionAnswer = true
    await window.session.switchChapter(2)
    window.session.sidebar.setCurrentRow(1)
    await window.session.sidebar.removeCurrent()
    expect(window.session.project!.chapters).toHaveLength(2)
    expect(labels().some(x => x.includes('Methods'))).toBe(false)
    expect(includes()).toHaveLength(2)
    expect(window.session.chapterIdx).toBe(1)       // Results, moved up
    expect(window.text()).toContain('Results')
    expect(window.firstNumber()).toBe('2')
    expect(existsSync(join(tmp, 'methods.ktex')) || readdirSync(tmp).some(n => n.startsWith('methods'))).toBe(true)
  })

  it('test_removing_the_open_document_opens_a_neighbour', async () => {
    await threeDocs()
    window.questionAnswer = true
    await window.session.switchChapter(0)
    await window.session.removeChapter(0)
    expect(window.session.chapterIdx).toBe(0)
    expect(window.text()).toContain('Methods')
  })

  it('test_remove_cancelled_keeps_document', async () => {
    await threeDocs()
    window.questionAnswer = false
    await window.session.removeChapter(1)
    expect(window.session.project!.chapters).toHaveLength(3)
  })

  it('test_remove_button_only_shown_for_projects', async () => {
    const sb = window.session.sidebar
    expect(sb.projectControlsVisible).toBe(false)
    await threeDocs()
    expect(sb.projectControlsVisible).toBe(true)
  })

  it('test_page_ranges_follow_new_order', async () => {
    const proj = await threeDocs()
    proj.auto_page_numbers = true
    proj.chapters.forEach((ch, i) => { ch.last_known_pages = [10, 4, 6][i] })
    window.session.sidebar.recomputeAutoPages()
    expect(proj.chapters.map(c => c.start_page)).toEqual([1, 11, 15])
    window.session.sidebar.setCurrentRow(0)
    await window.session.sidebar.moveDown()
    expect(proj.chapters.map(c => c.last_known_pages)).toEqual([4, 10, 6])
    expect(proj.chapters.map(c => c.start_page)).toEqual([1, 5, 15])
  })

  // ---------------------------------------------------------- add existing

  it('test_add_existing_files_from_elsewhere', async () => {
    const proj = await threeDocs()
    const other = join(tmp, 'elsewhere')
    mkdirSync(other)
    const a = join(other, 'appendix.kdoc.json')
    writeFileSync(a, toJson(document([paragraph([text('appendix words')])])))
    const b = join(other, 'notes.ktexz')
    await saveKdocz(document([paragraph([text('bundle words')])]), b, projectFs)

    await window.session.addExistingDocuments([a, b])
    expect(proj.chapters.slice(-2).map(ch => ch.label)).toEqual(['appendix', 'notes'])
    expect(proj.chapters.slice(-2).map(ch => ch.path)).toEqual(['appendix.ktex', 'notes.ktex'])
    const texts = await Promise.all(proj.chapters.slice(-2).map(async ch => toJson(await readDoc(join(tmp, ch.path), projectFs))))
    expect(texts[0]).toContain('appendix words')
    expect(texts[1]).toContain('bundle words')
    // Adding the same file again does not duplicate it.
    const added = join(tmp, proj.chapters[proj.chapters.length - 2].path)
    await window.session.addExistingDocuments([added])
    expect(proj.chapters).toHaveLength(5)
    // A .ktex from elsewhere is copied in unchanged.
    const c = join(other, 'extra.ktex')
    await saveKdocz(document([]), c, projectFs)
    await window.session.addExistingDocuments([c])
    expect(readFileSync(join(tmp, 'extra.ktex'))).toEqual(readFileSync(c))
  })

  it('test_legacy_json_project_converts_to_ktex_files', async () => {
    for (const [name, words] of [['Paper-1', 'main words'], ['test2', 'second']]) {
      writeFileSync(join(tmp, `${name}.kdoc.json`), toJson(document([paragraph([text(words)])])))
      writeFileSync(join(tmp, `${name}.tex`), 'old')
    }
    writeFileSync(join(tmp, 'Paper.ktex'), 'older copy')
    const proj = project({ chapters: [chapterEntry({ path: 'Paper-1.kdoc.json', label: 'Paper' }),
      chapterEntry({ path: 'test2.kdoc.json', label: 'test2' })] })
    const pp = join(tmp, 'Paper.kdocproj.json')
    writeFileSync(pp, projectToJson(proj))
    await window.session.openProjectFromPath(pp)
    await window.session.saveProject()
    expect(visible(tmp)).toEqual(['Paper.ktex', 'test2.ktex'])
    const legacy = new Set(readdirSync(join(tmp, '.kherve', 'legacy')))
    for (const n of ['Paper-1.kdoc.json', 'Paper.kdocproj.json', 'Paper.ktex']) expect(legacy.has(n)).toBe(true)
    // Opening the main .ktex reopens the whole project.
    await window.openPath(join(tmp, 'Paper.ktex'))
    expect(window.session.project!.chapters.map(c => c.path)).toEqual(['Paper.ktex', 'test2.ktex'])
    expect(window.text()).toContain('main words')
  })

  it('test_dropping_files_on_the_list_adds_them', async () => {
    const got: string[][] = []
    // Only the signal is under test here, not the window's handler.
    window.session.sidebar.signals.addExistingRequested = (p) => { got.push(p) }
    const f = join(tmp, 'x.kdoc.json')
    writeFileSync(f, toJson(document([])))
    expect(await window.session.sidebar.dropFiles([f, join(tmp, 'pic.png')])).toBe(true)
    expect(got).toEqual([[f]])
    expect(await window.session.sidebar.dropFiles([join(tmp, 'pic.png')])).toBe(false)
  })

  it('test_master_lets_latex_continue_page_numbers', async () => {
    const proj = await threeDocs()
    proj.auto_page_numbers = true
    for (const ch of proj.chapters) ch.start_page = 5   // a stale guess must not reach LaTeX
    expect(serializeProjectMaster(proj, [])).not.toContain('\\setcounter{page}')
    proj.auto_page_numbers = false
    expect(serializeProjectMaster(proj, [])).toContain('\\setcounter{page}{5}')
  })

  it('test_page_counts_come_from_the_compile_log', async () => {
    const proj = await threeDocs()
    proj.auto_page_numbers = true
    const pdf = join(tmp, 'out.pdf')
    writeFileSync(pdf, '%PDF')
    window.pdfs.set(pdf, Array(10).fill(''))
    writeFileSync(join(tmp, 'out.log'),
      'KDOC:0:1:0\nKDOC:1:5:4\nKDOC:2:8:7\n'        // first pass
      + 'KDOC:0:1:0\nKDOC:1:6:5\nKDOC:2:9:8\n')     // final pass wins
    expect(await window.session.pageCountsFromLog({ pdfPath: pdf, log: '' })).toBe(true)
    expect(proj.chapters.map(c => c.last_known_pages)).toEqual([5, 3, 2])
    expect(proj.chapters.map(c => c.start_page)).toEqual([1, 6, 9])
  })

  it('test_saving_a_project_clears_modified', async () => {
    await threeDocs()
    window.modified = true
    await window.session.saveProject()
    expect(window.modified).toBe(false)
  })

  it('test_opening_another_file_never_overwrites_a_project_document', async () => {
    // Regression: with a project document open, opening a single file (or
    // File > New) and saving wrote that text over the document.
    const proj = await threeDocs()
    await window.session.switchChapter(2)
    const results = join(tmp, proj.chapters[2].path)
    const before = toJson(await readDoc(results, projectFs))
    const other = join(tmp, 'elsewhere.kdoc.json')
    writeFileSync(other, toJson(document([paragraph([text('unrelated text')])])))
    await window.openPath(other)
    expect(window.session.project).toBeNull()
    await window.save()
    expect(toJson(await readDoc(results, projectFs))).toBe(before)
    await window.openPath(join(tmp, 'thesis.ktex'))       // back into the project
    await window.session.switchChapter(2)
    await window.newDoc()
    window.saveAsImpl = async () => {}
    await window.save()
    expect(toJson(await readDoc(results, projectFs))).toBe(before)
  })

  it('test_converted_kdoc_json_moves_out_of_the_folder', async () => {
    await threeDocs()
    const src = join(tmp, 'old.kdoc.json')
    writeFileSync(src, toJson(document([])))
    await window.session.addExistingDocuments([src])
    expect(existsSync(src)).toBe(false)
    expect(existsSync(join(tmp, 'old.ktex'))).toBe(true)
    expect(existsSync(join(tmp, '.kherve', 'legacy', 'old.kdoc.json'))).toBe(true)
  })

  it('test_drop_on_panel_adds_and_keeps_the_open_document', async () => {
    const proj = await threeDocs()
    await window.session.switchChapter(1)
    const openText = window.text()
    const extra = join(tmp, 'outside', 'extra.kdoc.json')
    mkdirSync(join(tmp, 'outside'))
    writeFileSync(extra, toJson(document([paragraph([text('extra words')])])))
    // Anywhere on the panel, not only on the list rows.
    expect(await window.session.sidebar.dropFiles([extra])).toBe(true)
    expect(proj.chapters[proj.chapters.length - 1].path).toBe('extra.ktex')
    expect(window.session.project).toBe(proj)
    expect(window.session.chapterIdx).toBe(1)
    expect(window.text()).toBe(openText)
  })

  it('test_drop_on_the_page_opens_only_that_file', async () => {
    await threeDocs()
    const solo = join(tmp, 'outside.kdoc.json')
    writeFileSync(solo, toJson(document([paragraph([text('solo words')])])))
    await window.openPath(solo)
    expect(window.session.project).toBeNull()
    expect(window.text()).toContain('solo words')
  })

  it('test_visual_page_number_continues_from_earlier_documents', async () => {
    const proj = await threeDocs()
    proj.auto_page_numbers = true
    proj.chapters.forEach((ch, i) => { ch.last_known_pages = [2, 1, 1][i] })
    window.session.sidebar.recomputeAutoPages()
    await window.session.switchChapter(2)
    expect(window.sheetLabels(2)).toEqual(['4', '5'])
    await window.session.switchChapter(0)
    expect(window.sheetLabels(1)).toEqual(['1'])
    await window.newDoc()                       // a lone document starts at 1
    expect(window.sheetLabels(1)).toEqual(['1'])
  })
})

describe('the Documents list', () => {
  it('numbers chapters and appendices, marks front and back matter, and greys unticked rows', async () => {
    const proj = await threeDocs()
    const sb = window.session.sidebar
    sb.setSectionType(0, 'frontmatter')
    sb.setSectionType(2, 'appendix')
    proj.chapters.forEach((ch, i) => { ch.last_known_pages = [3, 10, 2][i] })
    sb.recomputeAutoPages()
    expect(window.names()).toEqual([
      '◇ thesis  pp. i–iii  (3p)',
      'Ch. 1 — Methods  pp. 1–10  (10p)',
      'App. A — Results  pp. 11–12  (2p)',
    ])
    await sb.setChecked(1, false)
    expect(sb.rows[1].grey).toBe(true)
    expect(sb.summaryText).toBe('Total: ~15p  ·  Compiling: ~5p')
    sb.setChapterNumber(1, 7)
    expect(window.names()[1].startsWith('Ch. 7 — ')).toBe(true)
    sb.rename(1, '  Methods and data ')
    expect(proj.chapters[1].label).toBe('Methods and data')
    sb.rename(1, '   ')
    expect(proj.chapters[1].label).toBe('Methods and data')
  })

  it('the remove button refuses to empty a project', async () => {
    const proj = await threeDocs()
    window.questionAnswer = true
    await window.session.removeChapter(0)
    await window.session.removeChapter(0)
    await window.session.removeChapter(0)
    expect(proj.chapters).toHaveLength(1)
    expect(window.boxes.at(-1)).toEqual(['information', 'Remove document', 'A project needs at least one document.'])
  })
})
