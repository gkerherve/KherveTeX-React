// Port of tests/test_imported_front_matter.py: a Word or PDF import keeps
// its title page: the \date{} it sets (no date to print) is not taken for a
// Wiley author block.
import { describe, expect, it } from 'vitest'
import { abstract, author, docMeta, document, paragraph, text, title } from '../src/core/model.ts'
import { TAG_RE } from '../src/core/omml.ts'
import { serializeDocument } from '../src/core/serializer.ts'

const imported = (frontmatter = '\\date{}') => document([
  title([text('Damped Oscillations')]),
  author([text('A. Morgan')]),
  abstract([text('We measure the decay.')]),
  paragraph([text('Body text.')]),
], docMeta({ documentclass: 'article', title: 'Damped Oscillations', author: 'A. Morgan', frontmatter_extras: frontmatter }))

describe('test_imported_front_matter.py', () => {
  it('test_abstract_follows_maketitle_as_an_environment', () => {
    const body = serializeDocument(imported()).split('\\begin{document}')[1]
    expect(body).not.toContain('\\abstract{')
    expect(body.indexOf('\\date{}')).toBeLessThan(body.indexOf('\\maketitle'))
    expect(body.indexOf('\\maketitle')).toBeLessThan(body.indexOf('\\begin{abstract}'))
    expect(body).toContain('\\begin{abstract}\nWe measure the decay.\n\\end{abstract}')
  })

  it('test_wiley_front_matter_still_goes_before_maketitle', () => {
    const body = serializeDocument(imported('\\author[1]{A. Morgan}\n\\date{}')).split('\\begin{document}')[1]
    expect(body.indexOf('\\abstract{We measure the decay.}')).toBeLessThan(body.indexOf('\\maketitle'))
  })
})

describe('a Word equation numbered by chapter', () => {
  it('"(3.1)" and "(A.2)" typed beside it number it', () => {
    for (const t of ['(3)', '(3a)', '(3.1)', '(2-4)', '(A.2)', ' ( 3.1 ) ']) expect(TAG_RE.test(t), t).toBe(true)
    for (const t of ['(x)', '3.1', '(3.)', '(see 3.1)']) expect(TAG_RE.test(t), t).toBe(false)
  })
})
