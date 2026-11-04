import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromJson } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/typstSerializer.ts'

interface GoldenCase { document_json: string; typst: string }

const cases = JSON.parse(
  readFileSync(new URL('./golden/documents.json', import.meta.url), 'utf-8'),
) as Record<string, GoldenCase>

describe('Typst serializer matches the Python output', () => {
  it('has cases', () => {
    expect(Object.keys(cases).length).toBeGreaterThan(0)
  })
  for (const [name, c] of Object.entries(cases)) {
    it(name, () => {
      const doc = fromJson(c.document_json)
      if (c.typst.startsWith('!ERROR')) {
        expect(() => serializeDocument(doc)).toThrow()
      } else {
        expect(serializeDocument(doc)).toBe(c.typst)
      }
    })
  }
})
