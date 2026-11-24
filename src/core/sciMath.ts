// Science tab tools that make ordinary LaTeX maths (no extra package, so
// the editor typesets it at once): quantities with units, physical
// constants, physics notation, nuclides and decays, significant figures and
// error propagation, and matrices. Pure: no DOM.
import { element, ELEMENTS } from './elements.ts'

// ------------------------------------------------------------- numbers

// "6.02e23" -> 6.02\times10^{23}; "-1.5E-3" -> -1.5\times10^{-3}.
export function numberTex(s: string): string {
  const t = s.trim().replace(/\s+/g, '')
  const m = /^([-+]?[\d.,]+)(?:[eE]([-+]?\d+)|\s*[x×*]\s*10\^?\(?([-+]?\d+)\)?)?$/.exec(t)
  if (!m) return t.replace(/-/g, '-')
  const mant = m[1].replace(/^\+/, '').replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1\\,')
  const exp = m[2] ?? m[3]
  return exp !== undefined ? (mant === '1' ? `10^{${Number(exp)}}` : `${mant}\\times10^{${Number(exp)}}`) : mant
}

// "kg m/s^2" -> \mathrm{kg\,m\,s^{-2}}; "°C", "µm", "Ω", "Å" handled.
export function unitTex(s: string): string {
  const u = s.trim()
  if (!u) return ''
  if (u === '%') return '\\%'
  const out: string[] = []
  let neg = false
  for (const raw of u.split(/(\/)|[\s.·*]+/).filter(x => x !== undefined && x !== '')) {
    if (raw === '/') { neg = true; continue }
    const m = /^([^\^\d-]+)\^?(-?\d+)?$/.exec(raw)
    if (!m) { out.push(raw); continue }
    let sym = m[1].replace(/µ|μ/g, '\\mu ').replace(/Ω/g, '\\Omega').replace(/°/g, '{}^{\\circ}').replace(/Å/g, '\\text{\\AA}')
    sym = sym.startsWith('{}^') ? sym : sym
    let e = m[2] ? Number(m[2]) : 1
    if (neg) e = -e
    out.push(e === 1 ? sym : `${sym}^{${e}}`)
  }
  return `\\mathrm{${out.join('\\,')}}`
}

// A value with its uncertainty and unit: 9.81, 0.02, "m/s^2".
export function quantityTex(value: string, unc: string, unit: string): string {
  const v = numberTex(value), u = unc.trim() ? numberTex(unc) : ''
  const un = unitTex(unit)
  const body = u ? `(${v} \\pm ${u})` : v
  if (!un) return body
  return un === '\\%' ? `${body}\\,\\%` : un.startsWith('\\mathrm{{}^{\\circ}') ? `${body}\\,${un}` : `${body}\\,${un}`
}

// ------------------------------------------------- significant figures

// Rounds the uncertainty to 1 significant figure (2 if it starts with 1),
// and the value to the same decimal place.
export function roundWithUncertainty(value: number, unc: number): { v: string; u: string; exp: number } {
  if (!(unc > 0) || !Number.isFinite(value)) return { v: String(value), u: '', exp: 0 }
  const p = Math.floor(Math.log10(unc))
  const lead = unc / Math.pow(10, p)
  const digits = lead < 2 ? 2 : 1
  const place = p - digits + 1
  // Big or small: scientific notation with the value's exponent.
  const ve = Math.abs(value) > 0 ? Math.floor(Math.log10(Math.abs(value))) : 0
  const sci = ve >= 5 || ve <= -4
  const exp = sci ? ve : 0
  const scale = Math.pow(10, exp)
  const dec = Math.max(0, exp - place)
  const r = (x: number) => (Math.round(x / Math.pow(10, place)) * Math.pow(10, place) / scale).toFixed(dec)
  return { v: r(value), u: r(unc), exp }
}

export type Op = '' | '+' | '-' | '×' | '÷'

// A op B with their uncertainties (independent errors): sums add in
// quadrature, products and quotients by their relative errors.
export function propagate(a: number, da: number, b: number, db: number, op: Op): { v: number; u: number } {
  switch (op) {
    case '+': return { v: a + b, u: Math.hypot(da, db) }
    case '-': return { v: a - b, u: Math.hypot(da, db) }
    case '×': { const v = a * b; return { v, u: Math.abs(v) * Math.hypot(da / a, db / b) } }
    case '÷': { const v = a / b; return { v, u: Math.abs(v) * Math.hypot(da / a, db / b) } }
    default: return { v: a, u: da }
  }
}

export function roundedTex(value: number, unc: number, unit: string): string {
  const r = roundWithUncertainty(value, unc)
  const un = unitTex(unit)
  const body = r.u ? `(${r.v} \\pm ${r.u})` : r.v
  const withExp = r.exp ? `${body}\\times10^{${r.exp}}` : body
  return un ? `${withExp}\\,${un}` : withExp
}

// ------------------------------------------------------------ constants

// [name, LaTeX symbol = value with unit] (CODATA 2018).
export const CONSTANTS: [string, string][] = [
  ['Speed of light', 'c = 2.998\\times10^{8}\\,\\mathrm{m\\,s^{-1}}'],
  ['Planck constant', 'h = 6.626\\times10^{-34}\\,\\mathrm{J\\,s}'],
  ['Reduced Planck constant', '\\hbar = 1.055\\times10^{-34}\\,\\mathrm{J\\,s}'],
  ['Elementary charge', 'e = 1.602\\times10^{-19}\\,\\mathrm{C}'],
  ['Boltzmann constant', 'k_\\mathrm{B} = 1.381\\times10^{-23}\\,\\mathrm{J\\,K^{-1}}'],
  ['Avogadro constant', 'N_\\mathrm{A} = 6.022\\times10^{23}\\,\\mathrm{mol^{-1}}'],
  ['Gas constant', 'R = 8.314\\,\\mathrm{J\\,mol^{-1}\\,K^{-1}}'],
  ['Faraday constant', 'F = 96\\,485\\,\\mathrm{C\\,mol^{-1}}'],
  ['Vacuum permittivity', '\\varepsilon_0 = 8.854\\times10^{-12}\\,\\mathrm{F\\,m^{-1}}'],
  ['Vacuum permeability', '\\mu_0 = 1.257\\times10^{-6}\\,\\mathrm{N\\,A^{-2}}'],
  ['Gravitational constant', 'G = 6.674\\times10^{-11}\\,\\mathrm{N\\,m^{2}\\,kg^{-2}}'],
  ['Standard gravity', 'g = 9.807\\,\\mathrm{m\\,s^{-2}}'],
  ['Electron mass', 'm_\\mathrm{e} = 9.109\\times10^{-31}\\,\\mathrm{kg}'],
  ['Proton mass', 'm_\\mathrm{p} = 1.673\\times10^{-27}\\,\\mathrm{kg}'],
  ['Atomic mass unit', 'u = 1.661\\times10^{-27}\\,\\mathrm{kg}'],
  ['Electronvolt', '1\\,\\mathrm{eV} = 1.602\\times10^{-19}\\,\\mathrm{J}'],
  ['Stefan–Boltzmann constant', '\\sigma = 5.670\\times10^{-8}\\,\\mathrm{W\\,m^{-2}\\,K^{-4}}'],
  ['Rydberg constant', 'R_\\infty = 1.097\\times10^{7}\\,\\mathrm{m^{-1}}'],
  ['Bohr radius', 'a_0 = 5.292\\times10^{-11}\\,\\mathrm{m}'],
]

// ------------------------------------------------------ physics notation

// [label, LaTeX, what to type it with]: standard LaTeX, no package.
export const PHYSICS: [string, string][] = [
  ['Ket |ψ⟩', '\\left|\\psi\\right\\rangle'], ['Bra ⟨ψ|', '\\left\\langle\\psi\\right|'], ['Bra-ket ⟨φ|ψ⟩', '\\left\\langle\\phi\\middle|\\psi\\right\\rangle'],
  ['Matrix element ⟨φ|H|ψ⟩', '\\left\\langle\\phi\\middle|\\hat{H}\\middle|\\psi\\right\\rangle'], ['Expectation value ⟨A⟩', '\\left\\langle\\hat{A}\\right\\rangle'],
  ['Operator Â', '\\hat{A}'], ['Commutator [A, B]', '\\left[\\hat{A},\\hat{B}\\right]'],
  ['Derivative df/dx', '\\frac{\\mathrm{d}f}{\\mathrm{d}x}'], ['Second derivative', '\\frac{\\mathrm{d}^2f}{\\mathrm{d}x^2}'],
  ['Partial ∂f/∂x', '\\frac{\\partial f}{\\partial x}'], ['Mixed partial', '\\frac{\\partial^2 f}{\\partial x\\,\\partial y}'],
  ['Gradient ∇f', '\\nabla f'], ['Divergence ∇·F', '\\nabla\\cdot\\mathbf{F}'], ['Curl ∇×F', '\\nabla\\times\\mathbf{F}'], ['Laplacian ∇²f', '\\nabla^2 f'],
  ['Vector v (bold)', '\\mathbf{v}'], ['Unit vector x̂', '\\hat{\\mathbf{x}}'], ['Absolute value |x|', '\\left|x\\right|'], ['Norm ‖v‖', '\\left\\|\\mathbf{v}\\right\\|'],
  ['Integral dx', '\\int_{a}^{b} f(x)\\,\\mathrm{d}x'], ['Order of magnitude O(x)', '\\mathcal{O}(x)'],
  ['Schrödinger equation', '\\hat{H}\\left|\\psi\\right\\rangle = E\\left|\\psi\\right\\rangle'],
]

// --------------------------------------------------------------- nuclides

export function nuclideTex(sym: string, a: number, z: number): string {
  return `{}^{${a}}_{${z}}\\mathrm{${sym}}`
}

export type Decay = '' | 'alpha' | 'beta-' | 'beta+' | 'gamma'

// The decay equation of A/Z X, with the daughter worked out.
export function decayTex(sym: string, a: number, decay: Decay): string {
  const el = element(sym)
  const z = el?.z ?? 0
  const parent = nuclideTex(el?.symbol ?? sym, a, z)
  const d = (dz: number) => ELEMENTS[z + dz - 1]?.symbol ?? '?'
  switch (decay) {
    case 'alpha': return `${parent} \\rightarrow ${nuclideTex(d(-2), a - 4, z - 2)} + {}^{4}_{2}\\mathrm{He}`
    case 'beta-': return `${parent} \\rightarrow ${nuclideTex(d(1), a, z + 1)} + {}^{\\;\\,0}_{-1}\\mathrm{e} + \\bar{\\nu}_\\mathrm{e}`
    case 'beta+': return `${parent} \\rightarrow ${nuclideTex(d(-1), a, z - 1)} + {}^{0}_{+1}\\mathrm{e} + \\nu_\\mathrm{e}`
    case 'gamma': return `${parent}^{*} \\rightarrow ${parent} + \\gamma`
    default: return parent
  }
}

// ---------------------------------------------------------------- matrices

export type Bracket = 'pmatrix' | 'bmatrix' | 'Bmatrix' | 'vmatrix' | 'Vmatrix' | 'matrix'
export type MatrixFill = 'symbols' | 'zeros' | 'identity' | 'general'

export function matrixTex(rows: number, cols: number, bracket: Bracket, fillWith: MatrixFill, name = 'a'): string {
  const r = Math.max(1, Math.min(10, rows)), c = Math.max(1, Math.min(10, cols))
  let body: string[][]
  if (fillWith === 'general') {
    body = [[`${name}_{11}`, `${name}_{12}`, '\\cdots', `${name}_{1n}`], [`${name}_{21}`, `${name}_{22}`, '\\cdots', `${name}_{2n}`],
      ['\\vdots', '\\vdots', '\\ddots', '\\vdots'], [`${name}_{m1}`, `${name}_{m2}`, '\\cdots', `${name}_{mn}`]]
  } else {
    body = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) =>
      fillWith === 'zeros' ? '0' : fillWith === 'identity' ? (i === j ? '1' : '0') : `${name}_{${i + 1}${j + 1}}`))
  }
  return `\\begin{${bracket}}\n${body.map(row => row.join(' & ')).join(' \\\\\n')}\n\\end{${bracket}}`
}
