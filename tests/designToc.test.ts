import { describe, expect, test } from 'vitest'
import * as M from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { designPreamble, hasDesign } from '../src/core/design.ts'
import { tocBlock, tocLatex } from '../src/editor/toc.ts'

describe('Design tab', () => {
  test('no design writes nothing', () => {
    expect(hasDesign(undefined)).toBe(false)
    expect(designPreamble({}, 'article')).toBe('')
    expect(serializeDocument(M.document([], M.docMeta()))).not.toContain('titlesec')
  })
  test('style set, colours, watermark, border and page colour reach the preamble', () => {
    const tex = serializeDocument(M.document([M.section(1, [M.text('A')])], M.docMeta({
      design: { style_set: 'shaded', colors: 'green', watermark: 'DRAFT', page_border: 'double', page_color: '#fff2cc' },
    })))
    expect(tex).toContain('\\usepackage[explicit]{titlesec}')
    expect(tex).toContain('\\definecolor{kAccent}{HTML}{38761D}')
    expect(tex).toContain('{DRAFT}')
    expect(tex).toContain('\\pagecolor[HTML]{FFF2CC}')
    expect(tex).toContain('shipout/background')
  })
  test('headings are not restyled outside the standard classes', () => {
    expect(designPreamble({ style_set: 'basic' }, 'beamer')).not.toContain('titlesec')
  })
  test('the design survives a save and load', () => {
    const m = M.docMeta({ design: { style_set: 'lines', para_space_pt: 6 } })
    const back = M.fromJson(M.toJson(M.document([], m)))
    expect(back.meta.design).toEqual({ style_set: 'lines', para_space_pt: 6 })
  })
})

describe('Tables of contents', () => {
  test('blocks are recognised with their depth', () => {
    expect(tocBlock('\\tableofcontents')).toEqual({ kind: 'tableofcontents', depth: null })
    expect(tocBlock(tocLatex('tableofcontents', 2))).toEqual({ kind: 'tableofcontents', depth: 2 })
    expect(tocBlock('\\listoffigures')?.kind).toBe('listoffigures')
    expect(tocBlock('\\listoftables')?.kind).toBe('listoftables')
    expect(tocBlock('\\section{x}')).toBeNull()
  })
})

describe('design colours always have xcolor', () => {
  test('paragraph spacing alone still loads xcolor before \\definecolor', () => {
    const pre = designPreamble({ para_space_pt: 8 }, 'article')
    expect(pre.indexOf('\\usepackage{xcolor}')).toBeGreaterThanOrEqual(0)
    expect(pre.indexOf('\\usepackage{xcolor}')).toBeLessThan(pre.indexOf('\\definecolor'))
  })
})

describe('unnumbered headings in the table of contents (as Word)', () => {
  const doc = (withToc: boolean) => M.document([
    ...(withToc ? [M.rawLatex('\\tableofcontents')] : []),
    M.section(1, [M.text('Intro')], true, null),
    M.section(1, [M.text('Acknowledgements')], false, null),
  ] as M.Block[])
  test('listed with \\addcontentsline when the document has contents', () => {
    expect(serializeDocument(doc(true))).toContain('\\section*{Acknowledgements}\n\\addcontentsline{toc}{section}{Acknowledgements}')
  })
  test('nothing added without a table of contents', () => {
    expect(serializeDocument(doc(false))).not.toContain('addcontentsline')
  })
})
