import { describe, expect, it } from 'vitest'
import { decayTex, numberTex, propagate, roundWithUncertainty, unitTex } from '../src/core/sciMath.ts'
import { element, shells } from '../src/core/elements.ts'
import { algorithmLatex, parsePlotData } from '../src/core/science.ts'

describe('science tools', () => {
  it('numbers and units', () => {
    expect(numberTex('6.02e23')).toBe('6.02\\times10^{23}')
    expect(numberTex('96485')).toBe('96\\,485')
    expect(unitTex('m/s^2')).toBe('\\mathrm{m\\,s^{-2}}')
    expect(unitTex('kg m^2')).toBe('\\mathrm{kg\\,m^{2}}')
  })
  it('rounds a value to its uncertainty', () => {
    expect(roundWithUncertainty(9.8123, 0.0234)).toEqual({ v: '9.81', u: '0.02', exp: 0 })
    expect(roundWithUncertainty(1.23456, 0.0156)).toEqual({ v: '1.235', u: '0.016', exp: 0 })
  })
  it('propagates errors', () => {
    const s = propagate(10, 3, 5, 4, '+')
    expect(s.v).toBe(15)
    expect(s.u).toBe(5)
    const p = propagate(2, 0.02, 3, 0.03, '×')
    expect(p.v).toBe(6)
    expect(p.u).toBeCloseTo(6 * Math.hypot(0.01, 0.01))
  })
  it('elements, shells and decays', () => {
    expect(element('Fe')?.z).toBe(26)
    expect(element('oxygen')?.symbol).toBe('O')
    expect(shells(11)).toEqual([2, 8, 1])
    expect(decayTex('U', 238, 'alpha')).toContain('{}^{234}_{90}\\mathrm{Th}')
  })
  it('plot data and algorithms', () => {
    const d = parsePlotData('x, a, b\n1, 2, 3\n2, 4, 6')
    expect(d.names).toEqual(['a', 'b'])
    expect(d.ys).toEqual([[2, 4], [3, 6]])
    const a = algorithmLatex({ title: 'T', numbers: true, code: 'if x > 0 then\n  y = 1\nelse\n  y = 2\nreturn y' })
    expect(a).toContain('\\If{x > 0}')
    expect(a).toContain('\\Else')
    expect(a.indexOf('\\EndIf')).toBeGreaterThan(a.indexOf('\\Else'))
  })
})
