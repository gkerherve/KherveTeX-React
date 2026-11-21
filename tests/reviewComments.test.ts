// Comments in the PDF: numbered markers with notes in a review column
// (serializer REVIEW_PREAMBLE), read back by the importer.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { commentDate, REVIEW_PREAMBLE, serializeDocument } from '../src/core/serializer.ts'
import { importTex } from '../src/core/importers.ts'

const doc = (kids: M.Inline[]) => M.document([M.paragraph(kids)], M.docMeta({ documentclass: 'article' }))
const note = M.comment([M.text('calibrated '), M.text('C 1s', ['bold'])],
  { note: '100% wrong & vague?\nSecond line.', author: 'Anne Martin', timestamp: '2026-11-21T10:27:00.000Z' })

describe('review comments in LaTeX', () => {
  it('writes a numbered marker with the note, escaped', () => {
    const tex = serializeDocument(doc([M.text('Spectra were '), note, M.text('.')]))
    expect(tex).toContain(REVIEW_PREAMBLE)
    expect(tex).toContain('\\kcomment[2026-11-21T10:27:00.000Z]{Anne Martin}{21 Nov 2026}' +
      '{100\\% wrong \\& vague?\\par Second line.}{calibrated \\textbf{C 1s}}')
    expect(tex).not.toContain('todonotes')
  })

  it('adds nothing without comments', () => {
    expect(serializeDocument(doc([M.text('Plain.')]))).not.toContain('kcomment')
  })

  it('formats the date the same everywhere', () => {
    expect(commentDate('2026-01-05T23:59:00Z')).toBe('5 Jan 2026')
    expect(commentDate('')).toBe('')
  })

  it('reads the comment back, and drops the review column from the preamble', () => {
    const back = importTex(serializeDocument(doc([M.text('Spectra were '), note, M.text('.')])))
    const p = back.children.find((b: M.Block) => b.type === 'Paragraph') as M.Paragraph
    const c = p.children.find((n: M.Inline) => n.type === 'Comment') as M.Comment
    expect(c).toBeTruthy()
    expect(c.author).toBe('Anne Martin')
    expect(c.note).toBe('100% wrong & vague?\nSecond line.')
    expect(c.timestamp).toBe('2026-11-21T10:27:00.000Z')
    expect(back.meta.preamble_extras ?? '').not.toContain('kRevPaneW')
  })
})
