// Word's Home ▸ Font and Paragraph groups: their marks and paragraph
// formatting reach the LaTeX, and survive a save and load.
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { document, fromJson, list, listItem, paragraph, paraFormat, text, toJson } from '../src/core/model.ts'
import type { Mark } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'

const doc = () => document([
  paragraph([text('Red '), text('coloured', ['color:C00000'] as Mark[]), text(', '), text('big', ['size:16'] as Mark[]),
    text(', '), text('Helvetica', ['font:helvetica'] as Mark[]), text(', '), text('double', ['uline:double'] as Mark[]),
    text(', '), text('wave', ['bold', 'uline:wave'] as Mark[]), text('.')], 'left'),
  paraFormat(paragraph([text('Indented, spaced, shaded and boxed.')], 'justify'),
    { left_cm: 1.27, right_cm: 1, before_pt: 12, after_pt: 6, spacing: 1.5, shade: '#DCE8F7', border: 'box' }),
  list(true, [listItem([text('One')]), listItem([text('One.one')], 1), listItem([text('Two')])], 'legal'),
  list(false, [listItem([text('Square')])], 'square'),
])

describe('Word formatting', () => {
  it('writes the LaTeX', () => {
    const tex = serializeDocument(doc())
    if (process.env.KT_DUMP) writeFileSync(process.env.KT_DUMP, tex)
    expect(tex).toContain('\\textcolor[HTML]{C00000}{coloured}')
    expect(tex).toContain('{\\fontsize{16}{19.2}\\selectfont big}')
    expect(tex).toContain('{\\fontencoding{T1}\\fontfamily{phv}\\selectfont Helvetica}')
    expect(tex).toContain('\\uuline{double}')
    expect(tex).toContain('\\uwave{\\textbf{wave}}')
    expect(tex).toContain('\\usepackage[normalem]{ulem}')
    expect(tex).toContain('\\begin{kIndent}{1.27cm}{1.0cm}')
    expect(tex).toContain('\\setstretch{1.5}')
    expect(tex).toContain('\\begin{tcolorbox}')
    expect(tex).toContain('\\labelenumii}{\\arabic{enumi}.\\arabic{enumii}.}')
  })
  it('keeps it through save and load', () => {
    const d = doc()
    expect(toJson(fromJson(toJson(d)))).toBe(toJson(d))
  })
  it('leaves a plain paragraph and list as they were', () => {
    const d = JSON.parse(toJson(document([paragraph([text('x')]), list(false, [listItem([text('y')])])])))
    expect(Object.keys(d.children[0]).sort()).toEqual(['alignment', 'children', 'type'])
    expect(Object.keys(d.children[1]).sort()).toEqual(['items', 'ordered', 'type'])
    expect(Object.keys(d.children[1].items[0]).sort()).toEqual(['children', 'type'])
  })
})
