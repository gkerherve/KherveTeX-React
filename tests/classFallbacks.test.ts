// Port of tests/test_class_fallbacks.py: the parts that check generated
// LaTeX. Compiling with tectonic and TEMPLATE_CHOICES (Qt editor) are skipped.
import { describe, expect, it } from 'vitest'
import {
  abstract, affiliation, author, correspondence, docMeta, document, keywords, list,
  listItem, mathBlock, mathInline, paragraph, project, section, table, text, title,
} from '../src/core/model.ts'
import type { Block, DocMeta, Document } from '../src/core/model.ts'
import { serializeDocument, serializeProjectMaster } from '../src/core/serializer.ts'

// Test fixture: a copy of khervedoc/compiler.py template_sample_document,
// which is not ported (compiler).
const templateSampleDocument = (documentclass: string): Document => document([
  title([text('A test title')]),
  author([text('Jane Doe')]),
  affiliation([text('Imperial College London')]),
  abstract([text('This is the abstract.')]),
  keywords([text('one, two')]),
  section(1, [text('Introduction')]),
  paragraph([text('Body text with '), mathInline('E=mc^2'), text('.')]),
  section(2, [text('Method')]),
  mathBlock('\\int_0^1 x\\,dx = \\tfrac12', true),
  list(false, [listItem([text('a')]), listItem([text('b')])]),
  table({ rows: [['a', 'b'], ['1', '2']], caption: 'A table' }),
  section(3, [text('Detail')]),
  paragraph([text('End.')]),
], docMeta({ documentclass }))

const tex = (cls: string) => serializeDocument(templateSampleDocument(cls))

// A correspondence line and all five heading levels.
function frontMatterDoc(cls: string, meta: Partial<DocMeta> = {}): Document {
  const blocks: Block[] = [
    title([text('T')]),
    author([text('Ann Lee')]),
    affiliation([text('Imperial')]),
    author([text('Bo Ng')]),
    correspondence([text('ann@example.org')]),
  ]
  for (let level = 1; level < 6; level++) {
    blocks.push(section(level, [text(`Head${level}`)]), paragraph([text('Words.')]))
  }
  return document(blocks, docMeta({ documentclass: cls, ...meta }))
}

const preamble = (s: string) => s.split('\\begin{document}')[0]

describe('test_class_fallbacks.py', () => {
  it('test_keyword_and_abstract_fallbacks_everywhere', () => {
    const out = tex('article')
    expect(out).toContain('\\@ifundefined{keyword}{\\newenvironment{keyword}')
    expect(out).toContain('\\@ifundefined{abstract}')
  })

  it('test_tufte_gets_names_only_and_no_subsubsection', () => {
    const out = tex('tufte-book')
    expect(out).toContain('\\author{Jane Doe}')
    expect(out).toContain('\\let\\subsubsection\\paragraph')
    expect(out).toContain('\\renewcommand{\\allcapsspacing}[1]{#1}')
  })

  it('test_revtex_front_matter_in_body_and_no_multicol', () => {
    const parts = tex('revtex4-2').split('\\begin{document}')
    expect(parts).toHaveLength(2)
    const [pre, body] = parts
    expect(pre).not.toContain('{multicol}')
    expect(body).toContain('\\affiliation{Imperial College London}')
    const abs = body.indexOf('\\begin{abstract}')
    const mk = body.indexOf('\\maketitle')
    expect(abs).toBeGreaterThanOrEqual(0)
    expect(mk).toBeGreaterThanOrEqual(0)
    expect(abs).toBeLessThan(mk)
  })

  it('test_beamer_has_no_geometry', () => {
    expect(tex('beamer')).not.toContain('{geometry}')
  })

  it('test_moderncv_uses_name', () => {
    const out = tex('moderncv')
    expect(out).toContain('\\name{Jane}{Doe}')
    expect(out).not.toContain('\\author{')
  })

  it('test_tikzposter_body_in_block', () => {
    expect(tex('tikzposter')).toContain('\\block{}{')
  })

  it('test_elegantbook_uses_bibtex_backend', () => {
    expect(tex('elegantbook')).toContain('\\documentclass[bibtex]{elegantbook}')
  })

  it.skip('test_classes_without_a_redistributable_file_are_not_offered — TEMPLATE_CHOICES lives in the Qt editor', () => {})

  it('test_acmart_gets_authornote_and_one_author_per_person', () => {
    const pre = preamble(serializeDocument(frontMatterDoc('acmart')))
    expect(pre).not.toContain('\\thanks')
    expect(pre).toContain('\\author{Ann Lee}\n\\authornote{ann@example.org}\n'
      + '\\affiliation[obeypunctuation=true]{\\institution{Imperial}\\country{}}\n\\author{Bo Ng}')
  })

  it('test_acmart_moves_thanks_out_of_the_author_field', () => {
    const doc = document([title([text('T')])], docMeta({ documentclass: 'acmart', author: 'Ann\\thanks{Note}' }))
    expect(serializeDocument(doc)).toContain('\\author{Ann}\n\\authornote{Note}')
  })

  it('test_llncs_has_institute_and_a_real_subparagraph', () => {
    const pre = preamble(serializeDocument(frontMatterDoc('llncs')))
    expect(pre).toContain('\\let\\subparagraph\\paragraph')
    expect(pre).toContain('\\author{Ann Lee\\thanks{ann@example.org} \\and Bo Ng}\n\\institute{Imperial}')
  })

  it.each([
    ['acmart', '\\authornote{ann@example.org}'],
    ['llncs', '\\let\\subparagraph\\paragraph'],
  ])('test_project_master_shares_the_class_fixes[%s]', (cls, expected) => {
    const proj = project({ meta: docMeta({ documentclass: cls }) })
    expect(serializeProjectMaster(proj, [frontMatterDoc(cls)])).toContain(expected)
  })

  it.skip('test_correspondence_and_five_levels_compile[acmart, llncs] — runs tectonic', () => {})
  it.skip('test_missing_class_is_a_failure_with_no_pdf — runs tectonic', () => {})
  it.skip('test_every_class_compiles_without_errors[TEMPLATE_CHOICES] — runs tectonic', () => {})
})
