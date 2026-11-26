// A figure's or table's own placement ([H], [htbp], [!t]...): kept in the
// file, written after \begin{figure}, read from LaTeX written by hand.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { docFromPM, docToPM } from '../src/editor/convert.ts'
import { rawPlacement } from '../src/editor/placement.ts'

const body = (b: M.Block, meta: Partial<M.DocMeta> = {}) => serializeDocument(M.document([b], M.docMeta({ title: '', ...meta })))

describe('float placement', () => {
  it('is written after \\begin{figure} / \\begin{table}, the default without one', () => {
    expect(body(M.figure({ path: 'a.png', caption: 'A' }))).toContain('\\begin{figure}[H]')
    expect(body(M.figure({ path: 'a.png', caption: 'A', placement: '!t' }))).toContain('\\begin{figure}[!t]')
    expect(body(M.table({ rows: [['a']], caption: 'T', placement: 'htbp' }))).toContain('\\begin{table}[htbp]')
    // Only LaTeX's letters.
    expect(body(M.figure({ path: 'a.png', caption: 'A', placement: 'h]x' }))).toContain('\\begin{figure}[h]')
  })

  it('[H] in a journal class loads the float package', () => {
    const tex = body(M.figure({ path: 'a.png', caption: 'A', placement: 'H' }), { documentclass: 'elsarticle' })
    expect(tex).toContain('\\usepackage{float}')
  })

  it('goes through the editor and the file, and is left out when not set', () => {
    const doc = M.document([M.figure({ path: 'a.png', placement: 't' }), M.table({ rows: [['a']], placement: 'p' }), M.figure({ path: 'b.png' })])
    const back = docFromPM(docToPM(doc), doc.meta)
    expect((back.children[0] as M.Figure).placement).toBe('t')
    expect((back.children[1] as M.Table).placement).toBe('p')
    expect('placement' in back.children[2]).toBe(false)
    const again = M.fromJson(M.toJson(doc))
    expect((again.children[0] as M.Figure).placement).toBe('t')
  })

  it('is read from a figure written in LaTeX', () => {
    expect(rawPlacement('\\begin{figure}[htbp]\n\\centering')).toBe('htbp')
    expect(rawPlacement('\\begin{table*}\n')).toBe('')
    expect(rawPlacement('Some text')).toBeNull()
  })
})
