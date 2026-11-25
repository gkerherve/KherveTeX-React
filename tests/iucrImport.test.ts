// An IUCr manuscript (iucr.cls, a class kTeX does not know): its front
// matter, maths, citations and figures survive the import and come back
// out as the author wrote them (report from a user, Nov 2026).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importTex } from '../src/core/importers.ts'
import { serializeDocument } from '../src/core/serializer.ts'
import { pdftexCompat } from '../src/core/compiler.ts'
import { relativeTo } from '../src/core/paths.ts'

const src = readFileSync(new URL('./fixtures/iucr-test.tex', import.meta.url), 'utf8')
const tex = serializeDocument(importTex(src))
const body = tex.slice(tex.indexOf('\\begin{document}'))

describe('IUCr import', () => {
  it('keeps the front matter as written, after \\begin{document}, \\maketitle last', () => {
    expect(tex.slice(0, tex.indexOf('\\begin{document}'))).not.toMatch(/\\title|\\author/)
    const front = body.slice(0, body.indexOf('\\maketitle'))
    for (const s of ['\\title{A minimal IUCr manuscript', '\\shorttitle{kTeX import test}', '\\author[a]{Jane}{Doe}',
      '\\cauthor[a]{John}{Roe}{john.roe@example.org}{}', '\\aff[a]{Example Institute', '\\shortauthor{Doe \\emph{et al.}}', '\\keyword{three}']) {
      expect(front).toContain(s)
    }
    expect(body.match(/\\maketitle/g)?.length).toBe(1)
  })

  it('keeps the abstract environment after \\maketitle', () => {
    expect(body.indexOf('\\begin{abstract}')).toBeGreaterThan(body.indexOf('\\maketitle'))
    expect(body).not.toContain('\\abstract{')
  })

  it('reads \\( \\) as inline maths', () => {
    expect(body).toContain('$I/\\sigma^{\\rm asymptotic}$')
    expect(body).not.toContain('\\textbackslash{}(I')
  })

  it('keeps \\citeasnoun', () => {
    expect(body).toContain('\\citeasnoun{Doe2020}')
  })

  it('keeps a figure without a picture as written, and the width of a \\resizebox', () => {
    expect(body).toContain('\\fbox{\\parbox[c][3cm][c]{0.9\\columnwidth}')
    expect(body).not.toMatch(/\\includegraphics\[[^\]]*\]\{\}/)
    expect(body).toContain('\\includegraphics[width=0.6\\columnwidth]{figures/example.png}')
    expect(tex).toMatch(/\\usepackage\{graphicx\}/)
  })

  it('writes no float placement for iucr (its figure takes another argument)', () => {
    expect(body).not.toContain('\\begin{figure}[htbp]')
  })
})

describe('pdfTeX classes under XeTeX', () => {
  it('defines \\pdfshellescape and swaps a pdftex graphics driver', () => {
    const out = pdftexCompat('\\documentclass{iucr}\n\\begin{document}\\end{document}')
    expect(out.startsWith('\\ifdefined\\pdfshellescape')).toBe(true)
    expect(out).toContain('xetex.def')
    expect(pdftexCompat(out)).toBe(out)
  })
})

describe('relativeTo', () => {
  it('gives a picture path from the .tex folder', () => {
    expect(relativeTo('/Users/me/paper/figures/a.png', '/Users/me/paper')).toBe('figures/a.png')
    expect(relativeTo('/Users/me/data/a.png', '/Users/me/paper')).toBe('../data/a.png')
    expect(relativeTo('figures/a.png', '/Users/me/paper')).toBe('figures/a.png')
  })
})
