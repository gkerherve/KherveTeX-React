// Python's f"{x:g}" (six significant digits, trailing zeros dropped,
// exponent form below 1e-4 and from 1e6), which the drawing engine writes
// every SVG coordinate with — and Qt's QColor.name() / name(HexArgb).
import { pyFixed } from './py.ts'

export function pyG(x: number, precision = 6): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0' : '0'
  const p = precision === 0 ? 1 : precision
  const exp = Number(x.toExponential(p - 1).split('e')[1])
  if (exp >= -4 && exp < p) {
    let s = pyFixed(x, p - 1 - exp)
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
    return s
  }
  let [mant, e] = x.toExponential(p - 1).split('e')
  if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '')
  const sign = e.startsWith('-') ? '-' : '+'
  const digits = e.replace(/^[+-]/, '').padStart(2, '0')
  return `${mant}e${sign}${digits}`
}

// str(int) / str(float) for a value Python holds as an int.
export function pyIntStr(x: number): string {
  return String(Math.trunc(x))
}
