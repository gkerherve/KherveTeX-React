// Port of tests/test_theorems.py (serializer and model parts).
import { describe, expect, it } from 'vitest'
import { lectureNotes } from '../src/core/examples.ts'
import { document, section, text, theorem } from '../src/core/model.ts'
import type { Block } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { serializeDocument as typst } from '../src/core/typstSerializer.ts'

const doc = (...blocks: Block[]) => document([section(1, [text('S')]), ...blocks])
const count = (s: string, sub: string) => s.split(sub).length - 1

describe('test_theorems.py', () => {
  it('test_paragraphs_of_one_environment_serialize_together', () => {
    const tex = serializeDocument(doc(
      theorem('lemma', 'Key', [text('A.')]),
      theorem('proof', '', [text('B.')]),
      theorem('proof', '', [text('C.')], false)))
    expect(tex).toContain('\\begin{lemma}[Key]\nA.\n\\end{lemma}')
    expect(tex).toContain('\\begin{proof}\nB.\n\nC.\n\\end{proof}')
    expect(count(tex, '\\begin{proof}')).toBe(1)
  })

  it('test_preamble_defines_only_missing_environments', () => {
    const tex = serializeDocument(doc(theorem('definition', '', [text('x')])))
    expect(tex).toContain('\\@ifundefined{theorem}{\\newtheorem{theorem}{Theorem}[section]}')
    expect(tex).toContain('\\@ifundefined{definition}{\\@ifundefined{theoremstyle}{}'
      + '{\\theoremstyle{definition}}\\newtheorem{definition}[theorem]')
    expect(tex.split('\\begin{document}')[0]).not.toContain('lemma')
    expect(serializeDocument(doc())).not.toContain('\\newtheorem')
  })

  it.skip('test_import_round_trip_and_json — needs importers (import_body_fragment), not ported yet', () => {})

  it('test_typst_labels', () => {
    const out = typst(document([theorem('example', '', [text('e')])]))
    expect(out).toContain('*Example.* e')
  })

  it('test_lecture_notes_example_has_no_raw_theorems', () => {
    const doc = lectureNotes()
    expect(doc.children.some(b => b.type === 'Theorem')).toBe(true)
    expect(doc.children.some(b => b.type === 'RawLatex'
      && /^\s*\\begin\{(theorem|lemma|definition|proof|example)\}/.test(b.text))).toBe(false)
  })

  // test_editor_round_trip_enter_and_kind drives the editor:
  // tests/editor.commands.test.ts runs it.
})
