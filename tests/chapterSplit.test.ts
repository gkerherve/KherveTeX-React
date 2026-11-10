// Port of tests/test_chapter_split.py: a long document with chapters
// splits into a project with one document per chapter (or section).
import { describe, expect, it } from 'vitest'
import { chapterPlan, isAppendixMark, shouldOffer } from '../src/core/chapterSplit.ts'
import {
  chapterEntry, docMeta, document, inlineRaw, paragraph, project, section, text, title,
} from '../src/core/model.ts'
import type { Block } from '../src/core/model.ts'
import { serializeProjectMaster } from '../src/core/serializer.ts'

const para = () => paragraph([text('word '.repeat(600))])
const chapter = (name: string, level = 0, paras = 4): Block[] => [section(level, [text(name)]), ...Array.from({ length: paras }, para)]
const thesis = (cls = 'report', level = 0, paras = 10) => document([
  title([text('A Thesis')]),
  ...chapter('Introduction', level, paras), ...chapter('Methods', level, paras), ...chapter('Results', level, paras),
  paragraph([inlineRaw('\\appendix')]),
  ...chapter('Derivations', level, 1),
], docMeta({ documentclass: cls }))

describe('test_chapter_split.py', () => {
  it('test_plan_front_matter_chapters_and_appendix', () => {
    const plan = chapterPlan(thesis())
    expect(plan.map(([l, k]) => [l, k])).toEqual([['Front matter', 'frontmatter'], ['Introduction', 'chapter'],
      ['Methods', 'chapter'], ['Results', 'chapter'], ['Derivations', 'appendix']])
    expect(plan.every(([, , bs]) => bs.every(b => !isAppendixMark(b)))).toBe(true)
    expect(plan[1][2].length).toBe(11)
  })

  it('test_offered_only_for_long_documents_with_chapters', () => {
    expect(shouldOffer(thesis())).toBe(true)
    expect(shouldOffer(thesis('report', 0, 1))).toBe(false)
    expect(shouldOffer(document(chapter('Only', 0, 40), docMeta({ documentclass: 'report' })))).toBe(false)
    expect(chapterPlan({ ...thesis(), meta: docMeta({ documentclass: 'letter' }) })).toEqual([])
  })

  it('test_pdf_thesis_headings_are_gathered_into_chapters', () => {
    const h = (t: string) => section(1, [text(t)])
    const doc = document([
      h('A Study of River Deltas'), para(),
      h('Acknowledgement'), para(), h('Contents'), para(), h('List of Figures'), para(),
      h('CHAPTERI'), h('Introduction'), ...Array.from({ length: 10 }, para),
      h('CHAPTER II'), h('Sediment transport in tidal'), h('channels and estuaries'), ...Array.from({ length: 10 }, para),
      h('Chapter 3'), h('Summary'), para(),
      h('Appendix A'), para(), h('Bibliography'), para(),
    ], docMeta({ documentclass: 'article' }))
    expect(chapterPlan(doc).map(([l, k, bs]) => [l, k, bs.length])).toEqual([
      ['Front matter', 'frontmatter', 8], ['Introduction', 'chapter', 12],
      ['Sediment transport in tidal channels and estuaries', 'chapter', 13], ['Summary', 'chapter', 3],
      ['Appendix A', 'appendix', 2], ['Bibliography', 'appendix', 2]])
    expect(shouldOffer(doc)).toBe(true)
  })

  it('test_split_by_section_runs_on_in_its_chapter', () => {
    const h = (t: string, lv: number) => section(lv, [text(t)])
    const doc = document([
      title([text('A Thesis')]),
      h('Introduction', 0), para(), h('Background', 2), ...Array.from({ length: 10 }, para),
      h('Aims', 2), ...Array.from({ length: 10 }, para), h('Methods', 0), ...Array.from({ length: 10 }, para),
    ], docMeta({ documentclass: 'report' }))
    expect(chapterPlan(doc, 'section').map(([l, k]) => [l, k])).toEqual([['Front matter', 'frontmatter'],
      ['Introduction', 'chapter'], ['Background', 'section'], ['Aims', 'section'], ['Methods', 'chapter']])
    const proj = project({ meta: docMeta({ documentclass: 'report' }), chapters: [
      chapterEntry({ path: 'Front matter.ktex', chapter_type: 'frontmatter' }),
      chapterEntry({ path: '01 Introduction.ktex' }),
      chapterEntry({ path: '01.1 Background.ktex', chapter_type: 'section' }),
      chapterEntry({ path: '01.2 Aims.ktex', chapter_type: 'section' }),
      chapterEntry({ path: '02 Methods.ktex' }),
    ] })
    const master = serializeProjectMaster(proj, [])
    expect(master).toContain('\\input{01_Introduction}')
    expect(master).toContain('\\input{01_1_Background}')
    expect(master).toContain('\\input{01_2_Aims}')
    expect(master).toContain('\\include{02_Methods}')
    expect(master.split('\\setcounter{chapter}').length - 1).toBe(2)
    expect(chapterPlan(doc).length).toBe(3)
  })
})
