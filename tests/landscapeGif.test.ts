// Landscape pages and GIF pictures from Word.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { _gifPng } from '../src/core/docxImport.ts'
import { document, docMeta } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'

describe('landscape and gif', () => {
  it('writes geometry landscape', () => {
    const tex = serializeDocument(document([], docMeta({ landscape: true })))
    expect(tex).toMatch(/\\usepackage\[a4paper,landscape,/)
  })
  it('decodes a gif to png', () => {
    const png = _gifPng(new Uint8Array(readFileSync(new URL('./fixtures/tiny.gif', import.meta.url))))
    expect(png).not.toBeNull()
    expect([...png!.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG')
    expect(new DataView(png!.buffer, png!.byteOffset).getUint32(16)).toBe(93)
  })
})
