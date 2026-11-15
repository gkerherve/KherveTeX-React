import { describe, expect, it } from 'vitest'
import { inlineRawLook, lengthEm } from '../src/editor/inlineRawLook.ts'

describe('inlineRawLook: raw inline LaTeX as the PDF shows it', () => {
  it('a \\\\ is a line break and \\noindent prints nothing', () => {
    expect(inlineRawLook('\\\\')).toEqual({ kind: 'break' })
    expect(inlineRawLook('\\noindent')).toEqual({ kind: 'none' })
    expect(inlineRawLook('\\medskip\\noindent')).toEqual({ kind: 'none' })
  })
  it('a picture keeps its width', () => {
    const l = inlineRawLook('\\includegraphics[width=0.5\\linewidth]{/a b/frames/0012.png}')
    expect(l).toMatchObject({ kind: 'image', path: '/a b/frames/0012.png', width: '0.5\\linewidth', raiseEm: 0 })
  })
  it('a raised icon keeps its height and shift', () => {
    const l = inlineRawLook('\\raisebox{-0.35em}{\\includegraphics[height=1.4em]{icons/x.png}}')
    expect(l).toMatchObject({ kind: 'image', path: 'icons/x.png', height: '1.4em', raiseEm: -0.35 })
  })
  it('spaces and symbols', () => {
    expect(inlineRawLook('\\quad')).toEqual({ kind: 'space', em: 1 })
    expect(inlineRawLook('\\hspace{2em}')).toEqual({ kind: 'space', em: 2 })
    expect(inlineRawLook('\\LaTeX{}')).toEqual({ kind: 'text', text: 'LaTeX' })
  })
  it('anything else stays source', () => {
    expect(inlineRawLook('\\foo{bar}')).toEqual({ kind: 'source' })
    expect(inlineRawLook('\\includegraphics{a.png} more')).toEqual({ kind: 'source' })
  })
  it('lengths as em', () => {
    expect(lengthEm('1.4em')).toBe(1.4)
    expect(lengthEm('10pt')).toBe(1)
    expect(lengthEm('\\linewidth')).toBeNull()
  })
})
