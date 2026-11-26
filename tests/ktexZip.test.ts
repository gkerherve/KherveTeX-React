// A .ktex is an ordinary ZIP that says so: its READ ME, and the LaTeX and
// document beside it, readable without kTeX.
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import * as M from '../src/core/model.ts'
import { DOC_BASENAME, packKtex, README_BASENAME, TEX_BASENAME, unpackKtex, type FileAccess } from '../src/core/kdocz.ts'

const memFs: FileAccess = { exists: async () => false, read: async () => new Uint8Array(), write: async () => {} }

describe('.ktex is a ZIP', () => {
  it('holds a READ ME, the LaTeX and the document, and still opens', async () => {
    const doc = M.document([M.paragraph([M.text('Hello.')])], M.docMeta({ title: 'T' }))
    const bytes = await packKtex(doc, '/tmp', memFs)
    const files = unzipSync(bytes)
    expect(Object.keys(files)).toEqual(expect.arrayContaining([README_BASENAME, TEX_BASENAME, DOC_BASENAME]))
    expect(strFromU8(files[README_BASENAME])).toContain('ordinary ZIP archive')
    expect(strFromU8(files[TEX_BASENAME])).toContain('Hello.')
    const back = unpackKtex(bytes)
    expect(JSON.stringify(back)).toContain('Hello.')
  })
})
