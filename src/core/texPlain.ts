// BibTeX field text as a person reads it: accents (M{\"u}ller -> Müller),
// special letters (\ss, \o, \aa), simple maths (TiO$_2$ -> TiO₂), text
// commands ({\it x}, \emph{x} -> x), dashes and ties, and no braces. For
// showing and searching the reference library; the .bib keeps its LaTeX.

const ACCENTS: Record<string, string> = {
  '"': '̈', "'": '́', '`': '̀', '^': '̂', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
}
const LETTERS: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ',
  'textendash': '–', 'textemdash': '—', 'textregistered': '®', 'texttrademark': '™', 'copyright': '©',
  'textdegree': '°', 'textmu': 'µ', 'textpm': '±', 'textasciitilde': '~', 'ldots': '…', 'dots': '…',
}
const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ',
  Psi: 'Ψ', Omega: 'Ω', pm: '±', times: '×', cdot: '·', degree: '°', circ: '°', approx: '≈', leq: '≤', geq: '≥',
  rightarrow: '→', to: '→', infty: '∞', AA: 'Å',
}
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', x: 'ₓ', n: 'ₙ' }
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' }

function scripts(s: string, map: Record<string, string>): string {
  return [...s].every(c => map[c]) ? [...s].map(c => map[c]).join('') : s
}

function maths(m: string): string {
  return m
    .replace(/\\(?:mathrm|text|mathit|mathbf|rm)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (all, n: string) => GREEK[n] ?? all)
    .replace(/_\{([^{}]*)\}|_(\S)/g, (_, a, b) => scripts(a ?? b, SUB))
    .replace(/\^\{([^{}]*)\}|\^(\S)/g, (_, a, b) => scripts(a ?? b, SUP))
    .replace(/[{}]/g, '')
}

export function texToPlain(text: string): string {
  let s = text
  // Maths first: $...$.
  s = s.replace(/\$([^$]*)\$/g, (_, m: string) => maths(m))
  // Accents: \"u, \"{u}, {\"u}, \c{c}, \v s.
  s = s.replace(/\\(["'`^~=.])\s*\{?\\?([A-Za-z])\}?/g, (_, a: string, c: string) => (c + ACCENTS[a]).normalize('NFC'))
  s = s.replace(/\\([uvHckrdb])\s*\{\\?([A-Za-z])\}/g, (_, a: string, c: string) => (c + ACCENTS[a]).normalize('NFC'))
  s = s.replace(/\\([uvHckrdb]) ([A-Za-z])/g, (_, a: string, c: string) => (c + ACCENTS[a]).normalize('NFC'))
  // Letters and symbols: \ss, \o, \textendash...
  s = s.replace(/\\([A-Za-z]+)\b\s?(\{\})?/g, (all, n: string) => LETTERS[n] ?? all)
  // Text commands with an argument keep the argument; font switches go.
  s = s.replace(/\\(?:emph|textit|textbf|textsc|textrm|textsf|texttt|textup|mbox|text|url|href\{[^}]*\})\s*\{/g, '{')
  s = s.replace(/\\(?:it|bf|em|sc|rm|sf|tt|small|scriptsize|footnotesize|normalfont|itshape|bfseries|upshape|noopsort\{[^}]*\})\b\s*/g, '')
  s = s.replace(/\\([&%$#_{}])/g, '$1')
  s = s.replace(/---/g, '—').replace(/--/g, '–').replace(/~/g, ' ').replace(/``|''/g, '"')
  s = s.replace(/\\\\/g, ' ').replace(/[{}]/g, '')
  return s.replace(/\s+/g, ' ').trim()
}
