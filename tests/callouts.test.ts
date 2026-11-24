// Coloured callout boxes: Theorem paragraphs whose kind is in CALLOUT_KINDS,
// written as a titled, breakable tcolorbox.
import { describe, expect, it } from 'vitest'
import { document, text, theorem } from '../src/core/model.ts'
import type { Block } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { importTex } from '../src/core/importers.ts'

const doc = (...blocks: Block[]) => document(blocks)

describe('callout boxes', () => {
  it('serializes one box per run, with its title', () => {
    const tex = serializeDocument(doc(
      theorem('warning', 'Hot surface', [text('A.')]),
      theorem('warning', '', [text('B.')], false),
      theorem('tip', '', [text('C.')])))
    expect(tex).toContain('\\begin{kWarningBox}[{Hot surface}]\nA.\n\nB.\n\\end{kWarningBox}')
    expect(tex).toContain('\\begin{kTipBox}\nC.\n\\end{kTipBox}')
    const pre = tex.split('\\begin{document}')[0]
    expect(pre).toContain('\\usepackage{tcolorbox}')
    expect(pre).toContain('\\tcbuselibrary{breakable,skins}')
    expect(pre).toContain('\\newtcolorbox{kWarningBox}[1][Warning]')
    expect(pre).toContain('\\definecolor{kTipBoxC}{HTML}{2E7D32}')
    expect(pre).not.toContain('kNoteBox')
    expect(pre).not.toContain('\\newtheorem')
  })

  it('reads its own boxes back', () => {
    const tex = serializeDocument(doc(
      theorem('note', 'See also', [text('One.')]), theorem('note', '', [text('Two.')], false)))
    const back = importTex(tex).children.filter(b => b.type === 'Theorem')
    expect(back.map(b => b.type === 'Theorem' && [b.kind, b.title, b.start])).toEqual([
      ['note', 'See also', true], ['note', 'See also', false]])
  })
})

describe('callout round trip', () => {
  it('a reopened .tex does not define its boxes twice', () => {
    const tex = serializeDocument(doc(theorem('note', '', [text('One.')])))
    const again = serializeDocument(importTex(tex))
    expect(again.split('\\newtcolorbox{kNoteBox}').length - 1).toBe(1)
    expect(again.split('\\definecolor{kNoteBoxC}').length - 1).toBe(1)
  })
})

describe('custom callout boxes', () => {
  it('writes its own name and colour, and reads them back', () => {
    const tex = serializeDocument(doc(
      theorem('custom', 'Lab safety', [text('A.')], true, '#12AB34'),
      theorem('custom', 'Lab safety', [text('B.')], false, '#12AB34'),
      theorem('note', '', [text('C.')], true, '#ff0000')))
    expect(tex).toContain('\\begin{kCustomBox}[{Lab safety}]{kBoxC12AB34}\nA.\n\nB.\n\\end{kCustomBox}')
    expect(tex).toContain('\\begin{kCustomBox}[{Note}]{kBoxCFF0000}')
    const pre = tex.split('\\begin{document}')[0]
    expect(pre).toContain('\\definecolor{kBoxC12AB34}{HTML}{12AB34}')
    expect(pre).toContain('\\newtcolorbox{kCustomBox}[2][Box]')
    expect(pre).not.toContain('kNoteBox')
    const back = importTex(tex)
    const boxes = back.children.filter(b => b.type === 'Theorem')
    expect(boxes[0]).toMatchObject({ kind: 'custom', title: 'Lab safety', color: '#12AB34', start: true })
    const again = serializeDocument(back)
    expect(again.split('\\newtcolorbox{kCustomBox}').length - 1).toBe(1)
    expect(again.split('\\definecolor{kBoxC12AB34}').length - 1).toBe(1)
  })
})
