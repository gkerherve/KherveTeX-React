// Ports tests/test_hidden_documents_keep_numbers.py: a document unticked
// in the Documents panel is left out of the PDF, but the others keep their
// numbers: Chapter 3 stays Chapter 3, Appendix B stays B, section 1.3
// stays 1.3.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { serializeProjectMaster } from '../src/core/serializer.ts'

function doc(...heads: [number, string][]): M.Document {
  const blocks: M.Block[] = []
  for (const [level, text] of heads) {
    blocks.push(M.section(level, [M.text(text)]))
    blocks.push(M.paragraph([M.text('Words.')]))
  }
  return M.document(blocks)
}

function project(cls: string, entries: [string, string, boolean][]): M.Project {
  const proj = M.project({ meta: M.docMeta({ title: 'Thesis', documentclass: cls }) })
  proj.chapters = entries.map(([name, ctype, on]) =>
    M.chapterEntry({ path: `${name}.ktex`, label: name, enabled: on, chapter_type: ctype }))
  return proj
}

const between = (master: string, a: string, b: string) => master.split(`{${a}}`)[1].split(`{${b}}`)[0]

describe('test_hidden_documents_keep_numbers', () => {
  it('test_chapter_after_a_hidden_one_keeps_its_number', () => {
    const proj = project('report', [['one', 'chapter', true], ['two', 'chapter', false], ['three', 'chapter', true]])
    const master = serializeProjectMaster(proj, [doc([1, 'One']), doc([1, 'Two']), doc([1, 'Three'])])
    expect(master).not.toContain('\\include{two}')
    expect(between(master, 'one', 'three')).toContain('\\setcounter{chapter}{2}')
  })
  it('test_appendix_after_a_hidden_one_keeps_its_letter', () => {
    const proj = project('report', [['one', 'chapter', true], ['a', 'appendix', false], ['b', 'appendix', true]])
    const master = serializeProjectMaster(proj, [doc([1, 'One']), doc([1, 'Data']), doc([1, 'Code'])])
    expect(between(master, 'one', 'b')).toContain('\\appendix')
    expect(between(master, 'one', 'b')).toContain('\\setcounter{chapter}{1}')
  })
  it('test_section_document_after_a_hidden_one_keeps_its_number', () => {
    const proj = project('report', [['ch1', 'chapter', true], ['s1', 'section', true],
      ['s2', 'section', false], ['s3', 'section', true]])
    const master = serializeProjectMaster(proj, [doc([1, 'Intro']), doc([2, 'Aims']), doc([2, 'Scope']), doc([2, 'Plan'])])
    expect(between(master, 's1', 's3')).toContain('\\setcounter{section}{2}')
  })
  it('test_article_part_after_a_hidden_one_keeps_its_sections', () => {
    const proj = project('article', [['p1', 'chapter', true], ['p2', 'chapter', false], ['p3', 'chapter', true]])
    const master = serializeProjectMaster(proj, [doc([1, 'A'], [2, 'A.1']), doc([1, 'B'], [1, 'C']), doc([1, 'D'])])
    expect(between(master, 'p1', 'p3')).toContain('\\setcounter{section}{3}')
    expect(between(master, 'p1', 'p3')).toContain('\\setcounter{subsection}{0}')
  })
  it('test_nothing_set_when_every_document_is_in', () => {
    const proj = project('article', [['p1', 'chapter', true], ['p2', 'chapter', true]])
    expect(serializeProjectMaster(proj, [doc([1, 'A']), doc([1, 'B'])])).not.toContain('\\setcounter{section}')
  })
})
