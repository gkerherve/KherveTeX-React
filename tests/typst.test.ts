// A port of tests/test_typst_serializer.py.
import { describe, expect, it } from 'vitest'
import {
  abstract, author, citation, comment, crossRef, docMeta, document, figure, footnote,
  highlight, inlineRaw, keywords, link, list, listItem, mathBlock, mathInline,
  paragraph, rawLatex, section, table, text, title,
} from '../src/core/model.ts'
import {
  escapeText, latexMathToTypst, latexWidthToTypst, serializeBlock, serializeDocument,
  serializeInline,
} from '../src/core/typstSerializer.ts'

const count = (s: string, sub: string) => s.split(sub).length - 1

// ---- escape_text ----

describe('escapeText', () => {
  it('handles specials', () => {
    expect(escapeText('#*_@$')).toBe('\\#\\*\\_\\@\\$')
    expect(escapeText('hello')).toBe('hello')
    expect(escapeText('a<b>c')).toBe('a\\<b\\>c')
    expect(escapeText('[x]')).toBe('\\[x\\]')
    expect(escapeText('~')).toBe('\\~')
    expect(escapeText('`code`')).toBe('\\`code\\`')
    expect(escapeText('a\\b')).toBe('a\\\\b')
  })
})

// ---- inline nodes ----

describe('inline nodes', () => {
  it('text bold', () => {
    expect(serializeInline(text('hi', ['bold']))).toBe('#strong[hi]')
  })
  it('text italic', () => {
    expect(serializeInline(text('hi', ['italic']))).toBe('#emph[hi]')
  })
  it('text marks combined', () => {
    expect(serializeInline(text('hi', ['italic', 'bold']))).toBe('#strong[#emph[hi]]')
  })
  it('text underline', () => {
    expect(serializeInline(text('hi', ['underline']))).toBe('#underline[hi]')
  })
  it('text code', () => {
    expect(serializeInline(text('x', ['code']))).toBe('`x`')
  })
  it('text smallcaps', () => {
    expect(serializeInline(text('hi', ['smallcaps']))).toBe('#smallcaps[hi]')
  })
  it('text subscript', () => {
    expect(serializeInline(text('2', ['subscript']))).toBe('#sub[2]')
  })
  it('text superscript', () => {
    expect(serializeInline(text('2', ['superscript']))).toBe('#super[2]')
  })
  it('text strikethrough', () => {
    expect(serializeInline(text('old', ['strikethrough']))).toBe('#strike[old]')
  })
  it('math inline', () => {
    expect(serializeInline(mathInline('x^2'))).toBe('$x^2$')
  })
  it('link with children', () => {
    const n = link('https://example.com', [text('click')])
    expect(serializeInline(n)).toBe('#link("https://example.com")[click]')
  })
  it('link without children', () => {
    expect(serializeInline(link('https://x.com', []))).toBe('#link("https://x.com")')
  })
  it('footnote', () => {
    expect(serializeInline(footnote([text('see page 5')]))).toBe('#footnote[see page 5]')
  })
  it('citation', () => {
    expect(serializeInline(citation(['smith2020', 'doe2019']))).toBe('\\[smith2020, doe2019\\]')
  })
  it('citation single', () => {
    expect(serializeInline(citation(['a']))).toBe('\\[a\\]')
  })
  it('crossref', () => {
    expect(serializeInline(crossRef('sec:intro'))).toBe('@sec:intro')
  })
  it('inline raw', () => {
    expect(serializeInline(inlineRaw('\\Kstroke'))).toBe('\\Kstroke')
  })
  it('highlight', () => {
    const n = highlight([text('important')], 'yellow')
    expect(serializeInline(n)).toBe('#highlight(fill: rgb("#FFFF00"))[important]')
  })
  it('comment', () => {
    const n = comment([text('text')], { note: 'fix this' })
    expect(serializeInline(n)).toBe('text /* fix this */')
  })
})

// ---- block nodes ----

describe('block nodes', () => {
  it('paragraph justify', () => {
    expect(serializeBlock(paragraph([text('hello')], 'justify'))).toBe('hello\n')
  })
  it('paragraph center', () => {
    expect(serializeBlock(paragraph([text('hello')], 'center'))).toBe('#align(center)[hello]\n')
  })
  it('paragraph left', () => {
    expect(serializeBlock(paragraph([text('hello')], 'left'))).toBe('#align(left)[hello]\n')
  })
  it('paragraph right', () => {
    expect(serializeBlock(paragraph([text('hello')], 'right'))).toBe('#align(right)[hello]\n')
  })
  it('section level1', () => {
    expect(serializeBlock(section(1, [text('Intro')]))).toBe('= Intro\n')
  })
  it('section level2', () => {
    expect(serializeBlock(section(2, [text('Sub')]))).toBe('== Sub\n')
  })
  it('section level3', () => {
    expect(serializeBlock(section(3, [text('Subsub')]))).toBe('=== Subsub\n')
  })
  it('section unnumbered', () => {
    expect(serializeBlock(section(1, [text('Appendix')], false)))
      .toContain('#heading(level: 1, numbering: none)[Appendix]')
  })
  it('section with label', () => {
    expect(serializeBlock(section(1, [text('Intro')], true, 'sec:intro'))).toBe('= Intro <sec:intro>\n')
  })
  it('math block unnumbered', () => {
    expect(serializeBlock(mathBlock('x^2 + y^2 = z^2', false))).toBe('$ x^2 + y^2 = z^2 $\n')
  })
  it('math block numbered', () => {
    const out = serializeBlock(mathBlock('E = mc^2', true))
    expect(out).toContain('#math.equation(block: true, numbering: "(1)")')
    expect(out).toContain('E = m c^2')
  })
  it('math block with label', () => {
    expect(serializeBlock(mathBlock('x=1', true, 'eq:x'))).toContain('<eq:x>')
  })
  it('math block strips latex env', () => {
    const out = serializeBlock(mathBlock('\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}', false))
    expect(out).toContain('a &= b')
    expect(out).not.toContain('\\begin{align')
  })
  it('list unordered', () => {
    const n = list(false, [listItem([text('one')]), listItem([text('two')])])
    expect(serializeBlock(n)).toBe('- one\n- two\n')
  })
  it('list ordered', () => {
    const n = list(true, [listItem([text('first')]), listItem([text('second')])])
    expect(serializeBlock(n)).toBe('+ first\n+ second\n')
  })
  it('figure', () => {
    const out = serializeBlock(figure({ path: 'images/cat.png', caption: 'A cat', width: '0.8\\textwidth' }))
    expect(out).toContain('image("images/cat.png", width: 80%)')
    expect(out).toContain('caption: [A cat]')
  })
  it('figure with label', () => {
    expect(serializeBlock(figure({ path: 'img.png', caption: 'X', label: 'fig:x' }))).toContain('<fig:x>')
  })
  it('figure backslash path', () => {
    expect(serializeBlock(figure({ path: 'images\\cat.png', caption: '' }))).toContain('images/cat.png')
  })
  it('table', () => {
    const out = serializeBlock(table({ rows: [['A', 'B'], ['1', '2']], caption: 'Data' }))
    expect(out).toContain('table(columns: 2')
    expect(out).toContain('[A]')
    expect(out).toContain('caption: [Data]')
  })
  it('table with label', () => {
    expect(serializeBlock(table({ rows: [['x']], caption: 'T', label: 'tab:t' }))).toContain('<tab:t>')
  })
  it('table no caption', () => {
    const out = serializeBlock(table({ rows: [['x', 'y']], caption: '' }))
    expect(out).not.toContain('caption')
    expect(out).toContain('#table(')
  })
  it('raw latex becomes comment', () => {
    const out = serializeBlock(rawLatex('\\usepackage{foo}'))
    expect(out).toContain('/* Raw LaTeX:')
    expect(out).toContain('\\usepackage{foo}')
    expect(out).toContain('*/')
  })
  it('title emits nothing', () => {
    expect(serializeBlock(title([text('My Doc')]))).toBe('')
  })
  it('author emits nothing', () => {
    expect(serializeBlock(author([text('Alice')]))).toBe('')
  })
  it('abstract', () => {
    const out = serializeBlock(abstract([text('This paper...')]))
    expect(out).toContain('Abstract.')
    expect(out).toContain('This paper...')
  })
  it('keywords', () => {
    const out = serializeBlock(keywords([text('AI · ML')]))
    expect(out).toContain('Keywords:')
    expect(out).toContain('AI')
  })
})

// ---- full document ----

describe('full document', () => {
  it('has set rules', () => {
    const doc = document([
      title([text('Test')]),
      author([text('Bob')]),
      paragraph([text('Hello world.')]),
    ], docMeta({ title: 'Test', author: 'Bob', page_size: 'A4', body_font_pt: 11 }))
    const out = serializeDocument(doc)
    expect(out).toContain('#set document(title: "Test", author: "Bob")')
    expect(out).toContain('#set page(paper: "a4"')
    expect(out).toContain('size: 11pt')
    expect(out).toContain('#set par(')
    expect(out).toContain('#set heading(numbering:')
    expect(out).toContain('Hello world.')
  })
  it('title and author centered', () => {
    const doc = document([
      title([text('My Title')]),
      author([text('Alice')]),
    ], docMeta({ title: 'My Title', author: 'Alice' }))
    const out = serializeDocument(doc)
    expect(out).toContain('#align(center')
    expect(out).toContain('My Title')
    expect(out).toContain('Alice')
  })
  it('font family', () => {
    const doc = document([paragraph([text('x')])], docMeta({ body_font_family: 'times' }))
    expect(serializeDocument(doc)).toContain('font: "Times New Roman"')
  })
  it('no indent', () => {
    const doc = document([paragraph([text('x')])], docMeta({ paragraph_indent: false }))
    expect(serializeDocument(doc)).not.toContain('first-line-indent')
  })
  it('columns', () => {
    const doc = document([paragraph([text('x')])], docMeta({ column_count: 2 }))
    expect(serializeDocument(doc)).toContain('columns: 2')
  })
  it('line spacing', () => {
    const doc = document([paragraph([text('x')])], docMeta({ line_spacing: 1.5 }))
    expect(serializeDocument(doc)).toContain('leading:')
  })
  it('merges abstracts', () => {
    const doc = document([
      abstract([text('Para 1')]),
      abstract([text('Para 2')]),
      paragraph([text('Body')]),
    ])
    const out = serializeDocument(doc)
    expect(out).toContain('Para 1')
    expect(out).toContain('Para 2')
    expect(count(out, 'Abstract.')).toBe(1)
  })
  it('merges keywords', () => {
    const doc = document([
      keywords([text('AI')]),
      keywords([text('ML')]),
    ])
    const out = serializeDocument(doc)
    expect(out).toContain('AI')
    expect(out).toContain('ML')
    expect(count(out, 'Keywords:')).toBe(1)
  })
})

// ---- LaTeX → Typst math translation ----

describe('math translation', () => {
  it('frac', () => {
    expect(latexMathToTypst('\\frac{a}{b}')).toBe('frac(a, b)')
    expect(latexMathToTypst('\\tfrac{b}{a}')).toBe('frac(b, a)')
  })
  it('sqrt', () => {
    expect(latexMathToTypst('\\sqrt{x}')).toBe('sqrt(x)')
    expect(latexMathToTypst('\\sqrt[3]{x}')).toBe('root(3, x)')
  })
  it('greek', () => {
    expect(latexMathToTypst('\\alpha')).toBe('alpha')
    expect(latexMathToTypst('\\Delta')).toBe('Delta')
    expect(latexMathToTypst('\\theta')).toBe('theta')
  })
  it('operators', () => {
    expect(latexMathToTypst('\\cdot')).toBe('dot')
    expect(latexMathToTypst('\\times')).toBe('times')
    expect(latexMathToTypst('\\neq')).toBe('eq.not')
    expect(latexMathToTypst('\\leq')).toBe('lt.eq')
    expect(latexMathToTypst('\\infty')).toBe('infinity')
    expect(latexMathToTypst('\\pm')).toBe('plus.minus')
  })
  it('formatting', () => {
    expect(latexMathToTypst('\\mathbf{x}')).toBe('bold(x)')
    expect(latexMathToTypst('\\mathbb{R}')).toBe('bb(R)')
    expect(latexMathToTypst('\\mathcal{F}')).toBe('cal(F)')
    expect(latexMathToTypst('\\hat{x}')).toBe('hat(x)')
    expect(latexMathToTypst('\\vec{x}')).toBe('arrow(x)')
  })
  it('delimiters', () => {
    expect(latexMathToTypst('\\left(x\\right)')).toBe('(x)')
    expect(latexMathToTypst('\\left[x\\right]')).toBe('[x]')
  })
  it('spacing', () => {
    expect(latexMathToTypst('\\quad')).toBe('quad')
    expect(latexMathToTypst('\\qquad')).toBe('quad quad')
  })
  it('newline', () => {
    const result = latexMathToTypst('a \\\\ b')
    expect(result).toContain('\\')
    expect(result).toContain('a')
    expect(result).toContain('b')
  })
  it('nested', () => {
    expect(latexMathToTypst('\\frac{\\sqrt{x}}{y}')).toBe('frac(sqrt(x), y)')
  })
  it('integrals', () => {
    expect(latexMathToTypst('\\int')).toBe('integral')
    expect(latexMathToTypst('\\sum')).toBe('sum')
    expect(latexMathToTypst('\\prod')).toBe('prod')
  })
  it('welcome doc example', () => {
    expect(latexMathToTypst('a \\neq 0')).toContain('eq.not')
    expect(latexMathToTypst('\\Delta = b^2 - 4ac')).toBe('Delta = b^2 - 4a c')
  })
  it('math inline with latex commands', () => {
    expect(serializeInline(mathInline('\\frac{a}{b}'))).toBe('$frac(a, b)$')
  })
  it('math block with latex commands', () => {
    const out = serializeBlock(mathBlock('E = mc^2, \\quad \\alpha \\neq 0', false))
    expect(out).toContain('quad')
    expect(out).toContain('alpha')
    expect(out).toContain('eq.not')
    expect(out.replaceAll(' \\', '')).not.toContain('\\') // no leftover backslash commands
  })
  it('width conversion', () => {
    expect(latexWidthToTypst('0.8\\textwidth')).toBe('80%')
    expect(latexWidthToTypst('0.5\\textwidth')).toBe('50%')
    expect(latexWidthToTypst('1.0\\textwidth')).toBe('100%')
    expect(latexWidthToTypst('whatever')).toBe('80%')
  })
  it('page size letter', () => {
    const doc = document([paragraph([text('x')])], docMeta({ page_size: 'Letter' }))
    expect(serializeDocument(doc)).toContain('us-letter')
  })
})
