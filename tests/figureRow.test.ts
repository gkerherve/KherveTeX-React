import { describe, expect, it } from 'vitest'
import { importBodyFragment } from '../src/core/importers.ts'
import { serializeBlock } from '../src/core/serializer.ts'
import { serializeBlock as typstBlock } from '../src/core/typstSerializer.ts'
import { fromJson, toJson, document as makeDoc, figure } from '../src/core/model.ts'
import { canonicalBlock, docFromPM, docToPM } from '../src/editor/convert.ts'

const SRC = `\\begin{figure}[H]
  \\centering
  \\includegraphics[height=3.6cm]{fig/a.png}\\hspace{0.4cm}\\includegraphics[height=2cm]{fig/b.png}
  \\caption{Two pictures.}
  \\label{fig:two}
\\end{figure}`

describe('figure with several pictures', () => {
  it('imports a row under one caption and label', () => {
    const [b] = importBodyFragment(SRC)
    expect(b.type).toBe('Figure')
    if (b.type !== 'Figure') return
    expect(b.path).toBe('fig/a.png')
    expect(b.height).toBe('3.6cm')
    expect(b.extra).toEqual([{ path: 'fig/b.png', height: '2cm' }])
    expect(b.caption).toBe('Two pictures.')
    expect(b.label).toBe('fig:two')
  })

  it('writes LaTeX that reads back the same', () => {
    const [b] = importBodyFragment(SRC)
    const tex = serializeBlock(b)
    expect(tex).toContain('\\includegraphics[height=3.6cm]{fig/a.png}\\hspace{0.4cm}\\includegraphics[height=2cm]{fig/b.png}')
    expect(tex).toContain('\\caption{Two pictures.}')
    expect(tex).toContain('\\label{fig:two}')
    expect(importBodyFragment(tex)[0]).toEqual(b)
  })

  it('keeps a single-picture figure exactly as before', () => {
    const f = figure({ path: 'x.png', caption: 'c' })
    expect('extra' in f).toBe(false)
    expect('height' in f).toBe(false)
    expect(serializeBlock(f)).toContain('\\includegraphics[width=0.8\\textwidth]{x.png}')
  })

  it('survives JSON and the editor', () => {
    const [b] = importBodyFragment(SRC)
    const doc = makeDoc([b])
    expect(fromJson(toJson(doc)).children[0]).toEqual(b)
    const back = docFromPM(docToPM(doc), doc.meta)
    expect(back.children[0]).toEqual(b)
    expect(canonicalBlock).toBeDefined()
  })

  it('writes a Typst grid', () => {
    const [b] = importBodyFragment(SRC)
    expect(typstBlock(b)).toContain('grid(columns: 2')
  })
})
