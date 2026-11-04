// Port of tests/test_examples.py: each factory in examples must produce a
// Document that the serializer turns into LaTeX without raising and that
// the JSON round-trip preserves.
import { describe, expect, it } from 'vitest'
import { blank, EXAMPLES, GALLERY, GALLERY_CATEGORIES, threeColumnDocument, twoColumnArticle, welcome } from '../src/core/examples.ts'
import { fromJson, toJson } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { TEMPLATE_CHOICES } from '../src/ui/ribbonModel.ts'

describe('test_examples.py', () => {
  it.each(EXAMPLES)('test_example_serializes_to_latex[%s]', (_label, factory) => {
    const doc = factory()
    expect(doc.type).toBe('Document')
    const out = serializeDocument(doc)
    // Every example should produce a self-contained document.
    expect(out).toContain('\\documentclass')
    expect(out).toContain('\\begin{document}')
    expect(out).toContain('\\end{document}')
  })

  it.each(EXAMPLES)('test_example_json_round_trip[%s]', (_label, factory) => {
    const doc = factory()
    // Round-tripping through JSON is what kdocz does on save/load;
    // if it loses data, the user opens an empty document next session.
    expect(fromJson(toJson(doc))).toEqual(doc)
  })

  // The welcome doc should be substantial enough to feel like more
  // than a stub. Counting top-level blocks as a rough proxy for length.
  it('test_welcome_is_long_enough_to_span_multiple_pages', () => {
    expect(welcome().children.length).toBeGreaterThanOrEqual(15)
  })

  it('test_two_column_example_has_column_count_2', () => {
    expect(twoColumnArticle().meta.column_count).toBe(2)
  })

  it('test_three_column_example_has_column_count_3', () => {
    expect(threeColumnDocument().meta.column_count).toBe(3)
  })

  // The app opens on it, so like Word it is just somewhere to type:
  // one empty paragraph, no title, author or placeholder to delete.
  it('test_blank_example_is_an_empty_page', () => {
    const doc = blank()
    expect(doc.children.length).toBe(1)
    expect(doc.children[0].type).toBe('Paragraph')
    expect((doc.children[0] as { children: unknown[] }).children).toEqual([])
    expect(serializeDocument(doc)).not.toContain('\\maketitle')
  })

  it('test_every_offered_document_type_has_an_example', () => {
    const used = new Set(EXAMPLES.map(([, factory]) => factory().meta.documentclass))
    for (const cls of TEMPLATE_CHOICES) expect(used, cls).toContain(cls)
  })

  it('test_gallery_categories_are_all_in_use', () => {
    expect(new Set(GALLERY.map(([c]) => c))).toEqual(new Set(GALLERY_CATEGORIES))
  })
})
