// Names, faces and helpers behind the equation builder's palettes —
// the module-level tables of khervedoc/equation_editor.py.
import { GREEK_LOWER, GREEK_UPPER } from './mathbox.ts'

export const TEMPLATE_NAMES: Record<string, string> = {
  "\\frac{\\square}{\\square}": "Fraction",
  "\\tfrac{\\square}{\\square}": "Small fraction",
  "\\dfrac{\\square}{\\square}": "Display fraction",
  "\\sqrt{\\square}": "Square root",
  "\\sqrt[\\square]{\\square}": "n-th root",
  "\\binom{\\square}{\\square}": "Binomial coefficient",
  "\\sum_{\\square}^{\\square} \\square": "Summation",
  "\\sum_{i=1}^{n} \\square": "Sum from i = 1 to n",
  "\\prod_{\\square}^{\\square} \\square": "Product",
  "\\lim_{\\square \\to \\square} \\square": "Limit",
  "\\liminf_{\\square \\to \\square} \\square": "Limit inferior",
  "\\limsup_{\\square \\to \\square} \\square": "Limit superior",
  "\\int_{\\square}^{\\square} \\square \\, d\\square": "Definite integral",
  "\\int \\square \\, d\\square": "Indefinite integral",
  "\\iint_{\\square} \\square \\, dA": "Double integral",
  "\\iiint_{\\square} \\square \\, dV": "Triple integral",
  "\\oint_{\\square} \\square \\, d\\square": "Contour integral",
  "\\int_{-\\infty}^{\\infty} \\square \\, d\\square": "Integral over ℝ",
  "\\square^{\\square}": "Superscript",
  "\\square_{\\square}": "Subscript",
  "\\square_{\\square}^{\\square}": "Subscript and superscript",
  "e^{\\square}": "Exponential",
  "10^{\\square}": "Power of ten",
  "\\square^{-1}": "Inverse",
  "\\frac{d\\square}{d\\square}": "Derivative",
  "\\frac{d^{2}\\square}{d\\square^{2}}": "Second derivative",
  "\\frac{\\partial \\square}{\\partial \\square}": "Partial derivative",
  "\\frac{\\partial^{2} \\square}{\\partial \\square^{2}}": "Second partial derivative",
  "\\nabla \\square": "Gradient",
  "\\nabla^{2} \\square": "Laplacian",
  "\\vec{\\square}": "Vector arrow",
  "\\hat{\\square}": "Hat",
  "\\bar{\\square}": "Bar",
  "\\left( \\square \\right)": "Parentheses",
  "\\left[ \\square \\right]": "Square brackets",
  "\\left\\{ \\square \\right\\}": "Curly braces",
  "\\left| \\square \\right|": "Absolute value",
  "\\left\\| \\square \\right\\|": "Norm",
  "\\left\\langle \\square \\right\\rangle": "Angle brackets",
  "\\left\\lfloor \\square \\right\\rfloor": "Floor",
  "\\left\\lceil \\square \\right\\rceil": "Ceiling",
  "\\square = \\square": "Equals",
  "\\square \\approx \\square": "Approximately equal",
  "\\square \\neq \\square": "Not equal",
  "\\square \\leq \\square": "Less than or equal",
  "\\square \\geq \\square": "Greater than or equal",
  "\\square \\propto \\square": "Proportional to",
  "\\square \\cdot \\square": "Dot product",
  "\\square \\times \\square": "Cross product",
  "\\log_{\\square}(\\square)": "Logarithm with base",
  "\\ln(\\square)": "Natural logarithm",
  "\\exp(\\square)": "Exponential function",
}
export const ENV_NAMES: Record<string, string> = {
  "pmatrix": "2×2 matrix (parentheses)",
  "bmatrix": "2×2 matrix (brackets)",
  "vmatrix": "2×2 determinant",
  "equation": "Single equation",
  "align": "Aligned equations",
  "cases": "Cases (piecewise)",
}

// (label under the button, sample drawn on it) per EQUATION_GROUPS entry.
export const CATEGORY_FACES: [string, string][] = [["Fraction", "\\frac{x}{y}"], ["Large op", "\\sum"], ["Integral", "\\int"], ["Script", "x^{2}"], ["Derivative", "\\frac{dy}{dx}"], ["Greek", "\\alpha\\beta"], ["Matrix", "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}"], ["Bracket", "\\{x\\}"], ["Relation", "\\leq"], ["Function", "\\sin\\theta"], ["Multi-line", "\\begin{cases}a\\\\b\\end{cases}"]]

export const SYMBOL_TABS: [string, string][] = [["Greek", "α"], ["Capitals", "Ω"], ["Operators", "±"], ["Relations", "≤"], ["Arrows", "→"], ["Calculus", "∫"], ["Sets & logic", "∀"], ["Misc", "∞"], ["Accents", "â"]]

const NICE: Record<string, string> = {
  "pm": "Plus-minus",
  "mp": "Minus-plus",
  "times": "Times",
  "div": "Divide",
  "cdot": "Centre dot",
  "leq": "Less or equal",
  "geq": "Greater or equal",
  "neq": "Not equal",
  "approx": "Approximately",
  "equiv": "Identical to",
  "propto": "Proportional to",
  "infty": "Infinity",
  "partial": "Partial",
  "nabla": "Nabla",
  "to": "Tends to",
  "Rightarrow": "Implies",
  "Leftrightarrow": "If and only if",
  "in": "Element of",
  "notin": "Not an element of",
  "forall": "For all",
  "exists": "There exists",
  "hbar": "h-bar",
  "sum": "Summation",
  "prod": "Product",
  "int": "Integral",
  "iint": "Double integral",
  "iiint": "Triple integral",
  "oint": "Contour integral",
  "sqrt": "Square root",
  "frac": "Fraction",
  "ll": "Much less than",
  "gg": "Much greater than",
  "sim": "Similar to",
  "cong": "Congruent",
  "perp": "Perpendicular",
  "parallel": "Parallel",
  "degree": "Degree",
  "emptyset": "Empty set",
  "cap": "Intersection",
  "cup": "Union",
  "subset": "Subset",
  "subseteq": "Subset or equal",
}

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

export function niceName(latex: string): string {
  const m = /^\\([A-Za-z]+)/.exec(latex)
  if (!m) return latex
  const name = m[1]!
  if (own(NICE, name)) return NICE[name]!
  if (own(GREEK_LOWER, name.toLowerCase()) || own(GREEK_UPPER, name)) {
    return (/^[A-Z]/.test(name) ? 'Capital ' : '') + name.toLowerCase()
  }
  return name[0]!.toUpperCase() + name.slice(1)
}

export function templateName(latex: string, fallback: string): string {
  if (own(TEMPLATE_NAMES, latex)) return TEMPLATE_NAMES[latex]!
  let m = /^\\begin\{(\w+)\}/.exec(latex)
  if (m && own(ENV_NAMES, m[1]!)) return ENV_NAMES[m[1]!]!
  m = /^\\([a-z]+)\(/.exec(latex)
  if (m) {
    const fn: Record<string, string> = { sin: 'Sine', cos: 'Cosine', tan: 'Tangent', arctan: 'Inverse tangent' }
    return own(fn, m[1]!) ? fn[m[1]!]! : m[1]!
  }
  if (latex.startsWith('\\') && !latex.includes('{')) return niceName(latex)
  return fallback
}

// Palette entries like \hat{a} insert an empty slot, not 'a'.
export function symbolInsertLatex(latex: string): string {
  if (latex.startsWith('\\mathbb')) return latex
  return latex.replace(/\{[a-z]\}/g, '{\\square}')
}
