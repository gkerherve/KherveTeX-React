// Chemical-equation snippets and the preview transpiler for the chemistry
// editor — khervedoc/chemistry.py.
//
// Documents carry chemistry as ordinary MathInline / MathBlock nodes whose
// latex is \ce{...} (the mhchem package); nothing new is added to the
// model. The live preview is the awkward part: the typesetter has no idea
// what \ce means, so ceToMathtext hand-translates the mhchem body into
// plain math. It is deliberately approximate: it shows the user roughly
// what they are typing; real output always goes through LaTeX.
import type { TemplateGroup } from './equations.ts'

// The tab-navigable empty slot. It must be $\square$, not the bare \square
// the equation builder uses: mhchem parses the \ce{} body itself and aborts
// with "Unexpected input character" on a raw control sequence. Wrapping it
// in $...$ hands it to mhchem as an opaque math island, so a template with
// unfilled slots still compiles.
export const PLACEHOLDER = '$\\square$'

// Each entry is [ce_body_fragment, preview_label]. The fragment is what gets
// inserted into the editor field, which holds the *body* of \ce{...}.
export const CHEM_GROUPS: TemplateGroup[] = [
  ["Reactions", [
    ["$\\square$ -> $\\square$", "A → B"],
    ["$\\square$ + $\\square$ -> $\\square$", "A + B → C"],
    ["$\\square$ + $\\square$ -> $\\square$ + $\\square$", "A + B → C + D"],
    ["$\\square$ + $\\square$ <=> $\\square$ + $\\square$", "A + B ⇌ C + D"],
    ["2H2 + O2 -> 2H2O", "2H₂ + O₂ → 2H₂O"],
    ["CH4 + 2O2 -> CO2 + 2H2O", "combustion"],
  ]],
  ["Arrows", [
    [" -> ", "→"],
    [" <- ", "←"],
    [" <=> ", "⇌"],
    [" <-> ", "↔"],
    [" ->[$\\square$] ", "→ over"],
    [" ->[$\\square$][$\\square$] ", "→ over/under"],
  ]],
  ["States", [
    ["(aq)", "(aq)"],
    ["(s)", "(s)"],
    ["(l)", "(l)"],
    ["(g)", "(g)"],
    [" v", "↓ precip."],
    [" ^", "↑ gas"],
  ]],
  ["Charges", [
    ["^+", "x⁺"],
    ["^-", "x⁻"],
    ["^2+", "x²⁺"],
    ["^2-", "x²⁻"],
    ["^3+", "x³⁺"],
    ["e-", "e⁻"],
  ]],
  ["Species", [
    ["H2O", "H₂O"],
    ["CO2", "CO₂"],
    ["H2SO4", "H₂SO₄"],
    ["NH3", "NH₃"],
    ["OH-", "OH⁻"],
    ["SO4^2-", "SO₄²⁻"],
  ]],
  ["Bonds", [
    ["$\\square$-$\\square$", "A–B"],
    ["$\\square$=$\\square$", "A=B"],
    ["$\\square$#$\\square$", "A≡B"],
    ["CuSO4.5H2O", "hydrate"],
    ["^{227}_{90}Th+", "nuclide"],
    ["^{13}C", "isotope"],
  ]],
  ["Conditions", [
    [" ->[$\\Delta$] ", "heat Δ"],
    [" ->[$h\\nu$] ", "light hν"],
    [" ->[\\text{cat.}] ", "catalyst"],
    [" ->[\\text{Pt}] ", "Pt catalyst"],
    [" ->[H+] ", "acid"],
    [" ->[$\\square$][$\\square$] ", "above/below"],
  ]],
  ["Acids & bases", [
    ["HCl + NaOH -> NaCl + H2O", "neutralisation"],
    ["2H2O <=> H3O+ + OH-", "autoionisation"],
    ["NH3 + H2O <=> NH4+ + OH-", "weak base"],
    ["CH3COOH <=> CH3COO- + H+", "weak acid"],
    ["H3O+", "hydronium"],
    ["NH4+", "ammonium"],
  ]],
  ["Redox", [
    ["Zn -> Zn^2+ + 2e-", "oxidation"],
    ["Cu^2+ + 2e- -> Cu", "reduction"],
    ["Fe^2+ -> Fe^3+ + e-", "Fe(II)→Fe(III)"],
    ["2H+ + 2e- -> H2", "H+ reduction"],
    ["O2 + 4H+ + 4e- -> 2H2O", "O2 reduction"],
    ["MnO4- + 8H+ + 5e- -> Mn^2+ + 4H2O", "permanganate"],
  ]],
  ["Nuclear", [
    ["^{238}_{92}U -> ^{234}_{90}Th + ^{4}_{2}He", "α decay"],
    ["^{14}_{6}C -> ^{14}_{7}N + e-", "β decay"],
    ["^{1}_{0}n", "neutron"],
    ["^{1}_{1}p", "proton"],
    ["^{4}_{2}He", "α particle"],
    ["^{2}_{1}H", "deuterium"],
  ]],
]

export function allTemplates(): [string, string][] {
  return CHEM_GROUPS.flatMap(([, items]) => items)
}

// ---------------------------------------------------------------- transpiler

// Longest first — "<=>" must win over "<-" and "->".
const ARROWS: [string, string][] = [
  ['<=>>', '\\rightleftharpoons'],
  ['<<=>', '\\rightleftharpoons'],
  ['<=>', '\\rightleftharpoons'],
  ['<->', '\\leftrightarrow'],
  ['->', '\\rightarrow'],
  ['<-', '\\leftarrow'],
]

const BOND: Record<string, string> = { '=': '=', '#': '\\equiv ', '~': '-', '-': '-' }

// ^2-, ^{2+}, ^+, ^- ... the charge that follows a formula.
const CHARGE_RE = /\^\{?([0-9]*[+-]?)\}?/y
// A leading stoichiometric coefficient: 2H2O, 1.5O2 — but not the 2 in H2O.
const COEFF_RE = /\d+(?:\.\d+)?(?=[A-Za-z(\\])/y
const MACRO_RE = /\\[A-Za-z]+/y

const isAlpha = (c: string): boolean => /^\p{L}$/u.test(c)
const isDigit = (c: string): boolean => /^[0-9]$/.test(c)
const isSpace = (c: string): boolean => /^\s$/u.test(c)

function matchAt(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i
  return re.exec(s)
}

function startsArrow(text: string, i: number): boolean {
  return ARROWS.some(([lit]) => text.startsWith(lit, i))
}

// Translate one formula token (2H2O, SO4^2-, (aq)).
function speciesToMathtext(tok: string): string {
  const out: string[] = []
  let i = 0
  const n = tok.length
  let m = matchAt(COEFF_RE, tok, 0)
  if (m) {
    out.push(m[0])
    i = m[0].length
  }
  while (i < n) {
    const c = tok[i]!
    if (c === '\\') {
      m = matchAt(MACRO_RE, tok, i)
      if (m) {
        out.push(m[0] + ' ')
        i += m[0].length
        continue
      }
      i += 1
    } else if (isAlpha(c)) {
      let j = i
      while (j < n && isAlpha(tok[j]!)) j++
      out.push('\\mathrm{' + tok.slice(i, j) + '}')
      i = j
    } else if (isDigit(c)) {
      let j = i
      while (j < n && isDigit(tok[j]!)) j++
      out.push('_{' + tok.slice(i, j) + '}')
      i = j
    } else if (c === '^') {
      m = matchAt(CHARGE_RE, tok, i)
      if (m && m[1]) {
        out.push('^{' + m[1] + '}')
        i += m[0].length
      } else i += 1
    } else if ((c === '+' || c === '-') && out.length) {
      // A bare +/- trailing a formula is a charge (Na+), but between two
      // atoms it is a bond (C-C).
      const nxt = i + 1 < n ? tok[i + 1]! : ''
      if (c === '-' && (isAlpha(nxt) || nxt === '\\')) out.push('-')
      else out.push('^{' + c + '}')
      i += 1
    } else if (c === '(' || c === ')') {
      out.push(c)
      i += 1
    } else if (c === '.') {
      // Hydrate dot: the digits after it are a coefficient, not a
      // subscript — CuSO4.5H2O is "five waters", not "H-sub-5".
      out.push('\\cdot ')
      i += 1
      m = matchAt(COEFF_RE, tok, i)
      if (m) {
        out.push(m[0])
        i += m[0].length
      }
    } else if (Object.prototype.hasOwnProperty.call(BOND, c)) {
      out.push(BOND[c]!)
      i += 1
    } else if (c === '_') {
      const mm = /^_\{?(\d+)\}?/.exec(tok.slice(i))
      if (mm) {
        out.push('_{' + mm[1] + '}')
        i += mm[0].length
      } else i += 1
    } else i += 1
  }
  return out.join('')
}

// Best-effort mhchem \ce{} body → plain LaTeX math. Handles coefficients,
// subscripts, charges, states, bonds, hydrates and the common arrows.
// Arrow annotations (->[cat]) are dropped.
export function ceToMathtext(body: string): string {
  body = body.trim()
  if (!body) return ''
  const parts: string[] = []
  let i = 0
  const n = body.length
  while (i < n) {
    const c = body[i]!
    if (isSpace(c)) {
      i += 1
      continue
    }
    const hit = ARROWS.find(([lit]) => body.startsWith(lit, i))
    if (hit) {
      i += hit[0].length
      while (i < n && body[i] === '[') {   // drop ->[above][below]
        let depth = 0
        while (i < n) {
          if (body[i] === '[') depth += 1
          else if (body[i] === ']') {
            depth -= 1
            if (depth === 0) {
              i += 1
              break
            }
          }
          i += 1
        }
      }
      parts.push(hit[1])
      continue
    }
    if (c === '+') {
      parts.push('+')
      i += 1
      continue
    }
    // mhchem writes precipitate/gas as a lone "v"/"^" after a formula.
    if ((c === 'v' || c === '^') && (i + 1 >= n || isSpace(body[i + 1]!))) {
      parts.push(c === 'v' ? '\\downarrow' : '\\uparrow')
      i += 1
      continue
    }
    // A "+" met inside a formula is a charge, never the plus operator:
    // mhchem requires whitespace around the operator, and whitespace
    // already ends this scan.
    let j = i
    while (j < n && !(isSpace(body[j]!) || startsArrow(body, j))) j++
    parts.push(speciesToMathtext(body.slice(i, j)))
    i = j
  }
  return parts.filter(Boolean).join('\\;')
}

// Wrap a formula body in \ce{} unless it already is one.
export function wrapCe(body: string): string {
  body = body.trim()
  if (!body) return ''
  if (body.startsWith('\\ce{') && body.endsWith('}')) return body
  return '\\ce{' + body + '}'
}

// The body of a single \ce{...}, or null if latex isn't one. Decides
// whether a double-clicked equation reopens the chemistry editor rather
// than the equation builder.
export function unwrapCe(latex: string | null | undefined): string | null {
  const s = (latex || '').trim()
  if (!(s.startsWith('\\ce{') && s.endsWith('}'))) return null
  let depth = 0
  for (let i = 3; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      // Only a single \ce{} spanning the whole string counts;
      // "\ce{A} + \ce{B}" is two of them, not one body.
      if (depth === 0) return i === s.length - 1 ? s.slice(4, i) : null
    }
  }
  return null
}
