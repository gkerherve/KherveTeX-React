// tests/test_project.py: the multi-chapter project model and serializer.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  author, chapterEntry, docMeta, document, figure, paragraph, project, projectFromJson, projectToJson,
  section, text, title,
} from '../src/core/model.ts'
import type { Project } from '../src/core/model.ts'
import { chapterStem, serializeChapterBody, serializeProjectMaster } from '../src/core/serializer.ts'
import { chapterBodyTex, roman, safeName } from '../src/app/project.ts'
import { nodeFs } from './nodeFs.ts'

function sampleProject(): Project {
  const proj = project()
  proj.meta = docMeta({ title: 'My Thesis', author: 'J. Doe', documentclass: 'book' })
  proj.chapters = [
    chapterEntry({ path: 'frontmatter.kdoc.json', label: 'Front Matter', enabled: true, start_page: 1,
      last_known_pages: 4, numbering: 'roman' }),
    chapterEntry({ path: 'ch1_intro.kdoc.json', label: '1 — Introduction', enabled: true, start_page: 1,
      last_known_pages: 20, numbering: 'arabic' }),
    chapterEntry({ path: 'ch2_theory.kdoc.json', label: '2 — Theory', enabled: false,
      last_known_pages: 30, numbering: 'arabic' }),
    chapterEntry({ path: 'ch3_results.kdoc.json', label: '3 — Results', enabled: true,
      last_known_pages: 25, numbering: 'arabic' }),
  ]
  proj.bibliography = 'refs.bib'
  proj.bib_style = 'plain'
  return proj
}

describe('test_project', () => {
  // ---- model round-trip ----

  it('test_project_json_round_trip', () => {
    const proj2 = projectFromJson(projectToJson(sampleProject()))
    expect(proj2.meta.title).toBe('My Thesis')
    expect(proj2.meta.documentclass).toBe('book')
    expect(proj2.chapters).toHaveLength(4)
    expect(proj2.chapters[0].label).toBe('Front Matter')
    expect(proj2.chapters[0].numbering).toBe('roman')
    expect(proj2.chapters[0].start_page).toBe(1)
    expect(proj2.chapters[1].enabled).toBe(true)
    expect(proj2.chapters[2].enabled).toBe(false)
    expect(proj2.bibliography).toBe('refs.bib')
    expect(proj2.bib_style).toBe('plain')
  })

  it('test_project_default_meta', () => {
    expect(project().meta.documentclass).toBe('book')
  })

  it('test_chapter_entry_defaults', () => {
    const ch = chapterEntry()
    expect(ch.enabled).toBe(true)
    expect(ch.start_page).toBeNull()
    expect(ch.numbering).toBe('arabic')
    expect(ch.last_known_pages).toBe(0)
  })

  // ---- serializer ----

  it('test_serialize_chapter_body_no_preamble', () => {
    const doc = document([section(1, [text('Introduction')]), paragraph([text('Hello world.')])],
      docMeta({ documentclass: 'book' }))
    const body = serializeChapterBody(doc)
    expect(body).not.toContain('\\documentclass')
    expect(body).not.toContain('\\begin{document}')
    expect(body).toContain('\\chapter{Introduction}')
    expect(body).toContain('Hello world.')
  })

  it('test_serialize_chapter_body_skips_title_author', () => {
    const doc = document([title([text('My Title')]), author([text('Me')]), paragraph([text('Body text.')])],
      docMeta({ documentclass: 'book' }))
    const body = serializeChapterBody(doc)
    expect(body).not.toContain('\\maketitle')
    expect(body).toContain('Body text.')
  })

  it('test_serialize_project_master_structure', () => {
    const master = serializeProjectMaster(sampleProject())
    expect(master).toContain('\\documentclass')
    expect(master).toContain('\\begin{document}')
    expect(master).toContain('\\end{document}')
    // Enabled chapters appear in \include; disabled ones are omitted
    expect(master).toContain('\\include{frontmatter}')
    expect(master).toContain('\\include{ch1_intro}')
    expect(master).not.toContain('\\include{ch2_theory}')
    expect(master).toContain('\\include{ch3_results}')
  })

  it('test_serialize_project_master_disabled_chapters_keep_counters', () => {
    const master = serializeProjectMaster(sampleProject())
    // ch2_theory is disabled (30 pages) — the next enabled chapter
    // (ch3_results) must compensate for the skipped pages.
    expect(master).not.toContain('\\include{ch2_theory}')
    expect(master).toContain('\\addtocounter{page}{30}')
  })

  it('test_serialize_project_master_page_numbering', () => {
    const proj = sampleProject()
    const master = serializeProjectMaster(proj)
    expect(master).toContain('\\pagenumbering{roman}')
    expect(master).toContain('\\pagenumbering{arabic}')
    // Auto numbering leaves the page counter to LaTeX...
    expect(master).not.toContain('\\setcounter{page}')
    // ...manual numbering honours each document's start page.
    proj.auto_page_numbers = false
    expect(serializeProjectMaster(proj)).toContain('\\setcounter{page}{1}')
  })

  it('test_serialize_project_master_bibliography', () => {
    const master = serializeProjectMaster(sampleProject())
    expect(master).toContain('\\bibliographystyle{plain}')
    expect(master).toContain('\\bibliography{refs}')
  })

  it('test_serialize_project_master_all_enabled_includes_all', () => {
    const proj = sampleProject()
    for (const ch of proj.chapters) ch.enabled = true
    const master = serializeProjectMaster(proj)
    for (const s of ['frontmatter', 'ch1_intro', 'ch2_theory', 'ch3_results']) {
      expect(master).toContain(`\\include{${s}}`)
    }
    expect(master).not.toContain('\\addtocounter{page}')
  })

  it('test_auto_page_numbers_default', () => {
    expect(project().auto_page_numbers).toBe(true)
  })

  it('test_auto_page_numbers_round_trip', () => {
    const proj = sampleProject()
    proj.auto_page_numbers = false
    expect(projectFromJson(projectToJson(proj)).auto_page_numbers).toBe(false)
    proj.auto_page_numbers = true
    expect(projectFromJson(projectToJson(proj)).auto_page_numbers).toBe(true)
  })

  it('test_chapter_stems_are_unique_and_include_safe', () => {
    const a = chapterStem(chapterEntry({ path: 'partA/intro.kdoc.json' }))
    const b = chapterStem(chapterEntry({ path: 'partB/intro.kdoc.json' }))
    expect(a).not.toBe(b)
    expect(chapterStem(chapterEntry({ path: 'My Chapter 1.kdoc.json' }))).toBe('My_Chapter_1')
    expect(chapterStem(chapterEntry({ path: 'intro.kdoc.json' }))).toBe('intro')
  })

  it('test_master_hoists_chapter_packages_but_not_geometry', () => {
    const proj = project({ meta: docMeta({ documentclass: 'report' }), chapters: [chapterEntry({ path: 'c1.kdoc.json' })] })
    const ch = document([], docMeta({
      packages: ['siunitx'],
      preamble_extras: '\\newcommand{\\foo}{bar}\n\\usepackage[margin=1cm]{geometry}',
    }))
    const master = serializeProjectMaster(proj, [ch])
    expect(master).toContain('\\usepackage{siunitx}')
    expect(master).toContain('\\newcommand{\\foo}{bar}')
    expect(master).not.toContain('margin=1cm')
    expect(master.indexOf('siunitx')).toBeLessThan(master.indexOf('\\begin{document}'))
  })

  it('test_chapter_image_paths_repointed_to_project', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'proj-'))
    const chDir = join(tmp, 'chapters')
    mkdirSync(join(chDir, 'img'), { recursive: true })
    writeFileSync(join(chDir, 'img', 'a.png'), '')
    const doc = document([figure({ path: 'img/a.png', caption: 'x' })])
    const out = await chapterBodyTex(doc, chDir, tmp, nodeFs)
    expect(out).toContain('{chapters/img/a.png}')
  })

  it('test_article_project_has_no_book_only_commands', () => {
    const proj = project({ meta: docMeta({ documentclass: 'article' }),
      chapters: [chapterEntry({ path: 'a.kdoc.json' }), chapterEntry({ path: 'b.kdoc.json' })] })
    const master = serializeProjectMaster(proj)
    expect(master).not.toContain('\\mainmatter')
    expect(master).not.toContain('\\setcounter{chapter}')
    // Article parts run on (\input), they don't each start a page.
    expect(master).toContain('\\input{a}')
    expect(master).toContain('\\input{b}')
    expect(master).not.toContain('\\include{')
  })

  it('test_article_project_title_comes_from_the_documents', () => {
    // Regression: an article project printed its file name and today's
    // date on a title page of its own instead of the paper's title.
    const proj = project()
    proj.meta.title = 'Paper_AutoTuning'
    proj.meta.documentclass = 'article'
    proj.chapters = [chapterEntry({ path: 'a.ktex' }), chapterEntry({ path: 'b.ktex' })]
    const main = document([title([text('Tuning offsets')]), author([text('G. Kerherve')]), paragraph([text('body')])])
    const master = serializeProjectMaster(proj, [main, document()])
    expect(master).toContain('\\title{Tuning offsets}')
    expect(master).toContain('\\author{G. Kerherve}')
    expect(master).not.toContain('Paper\\_AutoTuning')
    expect(master.split('\\maketitle').length - 1).toBe(1)
    // No Title block anywhere: an article gets no title at all.
    const untitled = serializeProjectMaster(proj, [document(), document()])
    expect(untitled).not.toContain('\\maketitle')
    expect(untitled).not.toContain('\\title')
  })
})

describe('mainwindow project helpers', () => {
  it('_safe_name keeps letters, digits, space, _ and -', () => {
    expect(safeName('My Thesis')).toBe('My_Thesis')
    expect(safeName('My Thesis: Part 1')).toBe('My_Thesis__Part_1')
    expect(safeName('  Résumé & co  ')).toBe('Résumé___co')
    expect(safeName('***')).toBe('___')
    expect(safeName('   ')).toBe('document')
    expect(safeName('')).toBe('document')
  })

  it('_roman', () => {
    expect([1, 4, 9, 14, 40, 90, 400, 1994].map(roman)).toEqual(
      ['i', 'iv', 'ix', 'xiv', 'xl', 'xc', 'cd', 'mcmxciv'])
    expect(roman(0)).toBe('0')
  })
})
