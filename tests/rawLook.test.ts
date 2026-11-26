// LaTeX drawn as printed (editor/rawLook.ts): exam questions parsed.
import { describe, expect, it } from 'vitest'
import { argOf, parseQuestions } from '../src/editor/rawLook.ts'

describe('raw LaTeX drawn as printed', () => {
  it('reads an exam\'s questions, parts, points and solutions', () => {
    const q = parseQuestions('\\begin{questions}\n\\question A ball.\n\\begin{parts}\n\\part[2] How high?\n\\begin{solution}7 m\\end{solution}\n\\part[4] How long?\n\\end{parts}\n\\question[5] Explain.\n\\makeemptybox{5em}\n\\end{questions}')!
    expect(q.map(x => [x.points, x.parts.map(p => p.points)])).toEqual([[0, [2, 4]], [5, []]])
    expect(q[0].parts[0].solution).toBe('7 m')
    expect(q[1].box).toBe('5em')
  })
  it('leaves what it cannot read as code', () => {
    expect(parseQuestions('\\begin{questions}\\question A \\unknownenv\\end{questions}')).not.toBeNull()
    expect(parseQuestions('no questions')).toBeNull()
  })
  it('finds a command\'s argument with nested braces', () => {
    expect(argOf('\\signature{Dr A\\\\\\textit{x}}', 'signature')).toBe('Dr A\\\\\\textit{x}')
  })
})
