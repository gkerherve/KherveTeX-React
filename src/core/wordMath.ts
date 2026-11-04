// Turn an equation pasted from Word as plain Unicode text back into LaTeX.
// A port of khervedoc/word_math.py.
//
// Word's clipboard text flattens OMML: subscripts become ordinary letters
// ("Lₙ" arrives as "Ln"), brackets and operators arrive as Unicode glyphs
// and the equation number trails after tabs. The conversion is a best
// guess that the user then refines in the equation builder, so it favours
// readable, compilable LaTeX over cleverness.

import { pyRe, reSearch, reSub, strip } from './py.ts'

const _SYMBOLS: Record<string, string> = {
  '−': '-', '–': '-', '×': '\\times ', '·': '\\cdot ', '⋅': '\\cdot ',
  '÷': '\\div ', '±': '\\pm ', '∓': '\\mp ', '≤': '\\le ', '≥': '\\ge ',
  '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ', '∝': '\\propto ',
  '∼': '\\sim ', '∞': '\\infty ', '∂': '\\partial ', '∇': '\\nabla ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∮': '\\oint ',
  '√': '\\sqrt ', '→': '\\to ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ', '↔': '\\leftrightarrow ', '∈': '\\in ',
  '∉': '\\notin ', '⊂': '\\subset ', '∪': '\\cup ', '∩': '\\cap ',
  '∀': '\\forall ', '∃': '\\exists ', '°': '^\\circ ', '′': "'",
  '⟨': '\\langle ', '⟩': '\\rangle ', '〈': '\\langle ', '〉': '\\rangle ',
  '‖': '\\| ', '…': '\\dots ', '⋯': '\\cdots ', 'ℏ': '\\hbar ', 'ħ': '\\hbar ',
  'Å': '\\text{Å}',
}
const _GREEK: Record<string, string> = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'varepsilon',
  'ϵ': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ϑ': 'vartheta',
  'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'µ': 'mu',
  'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'varsigma',
  'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'phi', 'χ': 'chi',
  'ψ': 'psi', 'ω': 'omega', 'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta',
  'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi', 'Σ': 'Sigma', 'Φ': 'Phi',
  'Ψ': 'Psi', 'Ω': 'Omega',
}
const zipTable = (a: string, b: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const xs = [...a]
  const ys = [...b]
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) out[xs[i]] = ys[i]
  return out
}
const _SUP = zipTable('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ', '0123456789+-=()ni')
const _SUB = zipTable('₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ', '0123456789+-=()aeoxhklmnpst')
// Letter runs that are words, not a symbol with a flattened subscript.
const _FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh',
  'tanh', 'exp', 'ln', 'log', 'lim', 'max', 'min', 'sup', 'inf',
  'det', 'arg', 'mod', 'gcd', 'Pr', 'arcsin', 'arccos', 'arctan'])

const _NUMBER_RE = pyRe('[\\t ]*\\(\\s*(\\d+(?:\\.\\d+)?[a-z]?)\\s*\\)\\s*$')
const _CLOSE_SUB_RE = pyRe('([⟩〉)\\]|])([a-z]{1,4})\\b')
const _LETTERS_RE = pyRe('(?<![\\\\{A-Za-z])[A-Za-z]+(?![A-Za-z}])')
const _WIDE_GAP_RE = pyRe(',\\s{2,}')
const _BLANKS_RE = pyRe('[ \\t]+')

const has = (table: Record<string, string>, ch: string) => Object.prototype.hasOwnProperty.call(table, ch)

function _scriptRuns(text: string, table: Record<string, string>, op: string): string {
  const out: string[] = []
  let run = ''
  for (const ch of text + '\0') {
    if (has(table, ch)) {
      run += table[ch]
      continue
    }
    if (run) {
      out.push(`${op}{${run}}`)
      run = ''
    }
    if (ch !== '\0') out.push(ch)
  }
  return out.join('')
}

const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase()
const isLower = (s: string) => /[a-z]/.test(s) && s === s.toLowerCase()

function _word(word: string): string {
  if (_FUNCTIONS.has(word)) return `\\${word} `
  // Capital + short lowercase tail: Word's "Lₙ", "Eₐ", "Tₘₐₓ" flattened.
  if (word.length >= 2 && isUpper(word[0]) && isLower(word.slice(1)) && word.length <= 4) {
    const tail = word.length === 2 ? word.slice(1) : '\\text{' + word.slice(1) + '}'
    return word[0] + '_{' + tail + '}'
  }
  // Anything else ("mc", "nFE") is a product of single-letter symbols.
  return word
}

// Return [latex, equation_number] for Word-flattened equation text.
// The number is the trailing "(2)" Word puts after a tab, or null.
export function convert(text: string): [string, string | null] {
  let s = strip(text.replaceAll(' ', ' ').replaceAll(' ', ' '))
  let num: string | null = null
  const m = reSearch(_NUMBER_RE, s)
  if (m && m.index > 0) {
    num = m[1]
    s = s.slice(0, m.index)
  }
  s = _scriptRuns(s, _SUP, '^')
  s = _scriptRuns(s, _SUB, '_')
  // Text after a closing delimiter is a flattened subscript: ⟨P⟩hi.
  s = reSub(_CLOSE_SUB_RE, s, (mm) => mm[1] + '_{\\text{' + mm[2] + '}}')
  const src = s
  s = reSub(_LETTERS_RE, s, (mm) =>
    src.slice(Math.max(0, mm.index - 6), mm.index).endsWith('\\text{') ? mm[0] : _word(mm[0]))
  const out: string[] = []
  for (const ch of s) {
    if (has(_GREEK, ch)) out.push(`\\${_GREEK[ch]} `)
    else out.push(has(_SYMBOLS, ch) ? _SYMBOLS[ch] : ch)
  }
  s = out.join('')
  // Several equations on one line, separated by a comma and a wide gap.
  s = reSub(_WIDE_GAP_RE, s, ',\\qquad ')
  s = strip(reSub(_BLANKS_RE, s, ' '))
  return [s, num]
}
