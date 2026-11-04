// Structured math model behind the WYSIWYG equation editor — a port of
// khervedoc/mathbox.py.
//
// An equation is a tree: a Row holds a list of nodes, and every structure
// (fraction, root, scripts, matrix, ...) owns one or more Rows as its
// *slots*. The Editor keeps a cursor (row, index) — the gap before
// row.children[index] — and implements Word/MathType-style typing on top
// of the tree. toLatex and parseLatex convert to and from LaTeX; anything
// the parser does not understand becomes a Raw node so no user LaTeX is
// ever lost.
//
// No DOM here, so the model is testable headless.

export const PLACEHOLDER = '\\square'

// ------------------------------------------------------------------ tables

export const GREEK_LOWER: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  // TeX's \epsilon is the lunate form and \varepsilon the open one.
  epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
  varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
}
export const GREEK_UPPER: Record<string, string> = {
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
  Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ',
  Omega: 'Ω',
}
const BIN: Record<string, string> = {
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅',
  ast: '∗', star: '⋆', circ: '∘', bullet: '∙', oplus: '⊕',
  ominus: '⊖', otimes: '⊗', oslash: '⊘', odot: '⊙',
  dagger: '†', ddagger: '‡', cap: '∩', cup: '∪',
  setminus: '∖', land: '∧', lor: '∨', wedge: '∧', vee: '∨',
  diamond: '⋄', uplus: '⊎', sqcup: '⊔', sqcap: '⊓',
}
const REL: Record<string, string> = {
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅',
  propto: '∝', ll: '≪', gg: '≫', subset: '⊂', supset: '⊃',
  subseteq: '⊆', supseteq: '⊇', in: '∈', notin: '∉', ni: '∋',
  perp: '⊥', parallel: '∥', mid: '∣', to: '→',
  leftarrow: '←', rightarrow: '→', gets: '←', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', leftrightarrow: '↔',
  uparrow: '↑', downarrow: '↓', Uparrow: '⇑', Downarrow: '⇓',
  mapsto: '↦', hookrightarrow: '↪', longrightarrow: '⟶',
  longleftarrow: '⟵', Longrightarrow: '⟹', Longleftarrow: '⟸',
  longleftrightarrow: '⟷', Longleftrightarrow: '⟺',
  rightleftharpoons: '⇌', leftrightharpoons: '⇋', iff: '⟺',
  implies: '⟹', doteq: '≐', models: '⊨', vdash: '⊢',
  prec: '≺', succ: '≻', asymp: '≍', nearrow: '↗',
  searrow: '↘', coloneqq: '≔', lesssim: '≲', gtrsim: '≳',
  leqslant: '⩽', geqslant: '⩾', nleq: '≰', ngeq: '≱',
}
const ORD: Record<string, string> = {
  partial: '∂', nabla: '∇', infty: '∞', forall: '∀',
  exists: '∃', nexists: '∄', neg: '¬', lnot: '¬',
  emptyset: '∅', varnothing: '⌀', degree: '°', angle: '∠',
  triangle: '△', dots: '…', ldots: '…', cdots: '⋯',
  vdots: '⋮', ddots: '⋱', hbar: 'ℏ', hslash: 'ℏ', ell: 'ℓ',
  Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', wp: '℘', prime: '′',
  top: '⊤', bot: '⊥', imath: 'ı', jmath: 'ȷ', flat: '♭',
  sharp: '♯', natural: '♮', circledast: '⊛', Box: '□',
  copyright: '©', textregistered: '®', texttrademark: '™',
  backslash: '∖', checkmark: '✓', dag: '†', S: '§',
  P: '¶', surd: '√', blacksquare: '■',
}
const OPEN: Record<string, string> = {
  langle: '⟨', lfloor: '⌊', lceil: '⌈', lbrace: '{',
  lvert: '|', lVert: '‖',
}
const CLOSE: Record<string, string> = {
  rangle: '⟩', rfloor: '⌋', rceil: '⌉', rbrace: '}',
  rvert: '|', rVert: '‖',
}

// cmd (without backslash) -> [glyph, class]. A Map keeps Python's dict
// insertion order, which COMMANDS (the completion list) depends on.
export const SYMBOLS = new Map<string, [string, string]>()
for (const [tbl, cls] of [[GREEK_LOWER, 'ord'], [GREEK_UPPER, 'ord'],
  [BIN, 'bin'], [REL, 'rel'], [ORD, 'ord'], [OPEN, 'open'], [CLOSE, 'close']] as const) {
  for (const [k, v] of Object.entries(tbl)) SYMBOLS.set(k, [v, cls])
}
SYMBOLS.set('colon', [':', 'punct'])
SYMBOLS.set('vert', ['|', 'ord'])
SYMBOLS.set('Vert', ['‖', 'ord'])
SYMBOLS.set('|', ['‖', 'ord'])
SYMBOLS.set('{', ['{', 'open'])
SYMBOLS.set('}', ['}', 'close'])
SYMBOLS.set('%', ['%', 'ord'])
SYMBOLS.set('#', ['#', 'ord'])
SYMBOLS.set('&', ['&', 'ord'])
SYMBOLS.set('$', ['$', 'ord'])
SYMBOLS.set('_', ['_', 'ord'])

export const GREEK_LOWER_GLYPHS: ReadonlySet<string> = new Set(Object.values(GREEK_LOWER))

// Upright operator names; the ones LaTeX lacks go out as \operatorname.
export const FUNCS = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'det', 'dim',
  'ker', 'gcd', 'deg', 'arg', 'max', 'min', 'sup', 'inf', 'Pr', 'hom',
] as const
const LATEX_FUNCS: ReadonlySet<string> = new Set(FUNCS)
// Names recognised while typing plain letters (Word's math autocorrect).
export const AUTO_FUNCS: readonly string[] = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos',
  'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'exp',
  'det', 'max', 'min', 'lim']

// Large operators: name -> glyph ('' = drawn as an upright word).
export const BIGOPS: Record<string, string> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬',
  iiint: '∭', oint: '∮', oiint: '∯', bigcup: '⋃', bigcap: '⋂',
  bigoplus: '⨁', bigotimes: '⨂', bigodot: '⨀', bigvee: '⋁',
  bigwedge: '⋀', bigsqcup: '⨆',
  lim: '', liminf: '', limsup: '',
}
export const INTEGRALS: ReadonlySet<string> = new Set(['int', 'iint', 'iiint', 'oint', 'oiint'])

export const ACCENTS: readonly string[] = ['hat', 'widehat', 'bar', 'overline', 'vec', 'overrightarrow',
  'dot', 'ddot', 'tilde', 'widetilde', 'acute', 'grave', 'check',
  'breve', 'underline', 'mathring']
export const STYLES: readonly string[] = ['mathrm', 'mathbf', 'mathit', 'mathbb', 'mathcal', 'mathfrak',
  'mathsf', 'mathtt', 'boldsymbol', 'bm', 'mathscr']
export const FRACS: readonly string[] = ['frac', 'dfrac', 'tfrac', 'cfrac', 'binom', 'dbinom', 'tbinom']
export const MATRIX_ENVS: readonly string[] = ['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix',
  'Vmatrix', 'smallmatrix', 'cases', 'aligned', 'gathered',
  'split', 'align', 'align*', 'gather', 'gather*',
  'equation', 'equation*', 'multline', 'multline*']

export const SPACES: Record<string, number> = {
  ',': 3, ':': 4, '>': 4, ';': 5, '!': -3, quad: 18,
  qquad: 36, ' ': 6, '~': 6, enspace: 9, thinspace: 3,
}
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

// \left/\right delimiters: latex token -> glyph
export const DELIMS: Record<string, string> = {
  '(': '(', ')': ')', '[': '[', ']': ']', '\\{': '{', '\\}': '}',
  '|': '|', '\\|': '‖', '\\lvert': '|', '\\rvert': '|', '\\lVert': '‖',
  '\\rVert': '‖', '\\vert': '|', '\\Vert': '‖',
  '\\langle': '⟨', '\\rangle': '⟩', '\\lfloor': '⌊', '\\rfloor': '⌋',
  '\\lceil': '⌈', '\\rceil': '⌉', '\\lbrace': '{', '\\rbrace': '}',
  '.': '', '<': '⟨', '>': '⟩', '/': '/', '\\uparrow': '↑',
  '\\downarrow': '↓',
}
const DELIM_PAIRS: Record<string, string> = {
  '(': ')', '[': ']', '\\{': '\\}', '|': '|', '\\|': '\\|',
  '\\langle': '\\rangle', '\\lfloor': '\\rfloor', '\\lceil': '\\rceil',
}

// ---------------------------------------------------- Python str helpers

const cps = (s: string): string[] => Array.from(s)
export const pyLen = (s: string): number => cps(s).length
export const isAlphaStr = (s: string): boolean => s.length > 0 && /^\p{L}+$/u.test(s)
export const isAsciiAlpha = (s: string): boolean => /^[A-Za-z]+$/.test(s)
const isAlnumStr = (s: string): boolean => s.length > 0 && /^[\p{L}\p{Nd}\p{Nl}\p{No}]+$/u.test(s)
export const isSpaceStr = (s: string): boolean => s.length > 0 && /^\s+$/u.test(s)

// ------------------------------------------------------------------ nodes

export class Row {
  children: Node[]
  owner: Node | null = null
  constructor(children?: Node[]) {
    this.children = [...(children ?? [])]
  }
  get length(): number { return this.children.length }
  isEmpty(): boolean { return this.children.length === 0 }
}

export abstract class Node {
  parent: Row | null = null
  get cls(): string { return 'ord' }
  slots(): Row[] { return [] }
}

// A single typed character. kind is its TeX math class; 'text' marks
// characters inside \text{}.
export class Atom extends Node {
  char: string
  kind: string
  constructor(char: string, kind?: string | null) {
    super()
    this.char = char
    this.kind = kind || classifyChar(char)
  }
  override get cls(): string { return this.kind === 'text' ? 'ord' : this.kind }
}

export class Symbol extends Node {
  cmd: string
  constructor(cmd: string) {
    super()
    this.cmd = cmd.replace(/^\\+/, '')
  }
  get glyph(): string { return (SYMBOLS.get(this.cmd) ?? [this.cmd, 'ord'])[0] }
  override get cls(): string { return (SYMBOLS.get(this.cmd) ?? ['', 'ord'])[1] }
}

export class Func extends Node {
  name: string
  operatorname: boolean
  constructor(name: string, operatorname = false) {
    super()
    this.name = name
    this.operatorname = operatorname || !LATEX_FUNCS.has(name)
  }
  override get cls(): string { return 'op' }
}

// An empty slot sitting inside a non-empty row (e.g. □ = □).
export class Placeholder extends Node {}

// LaTeX the model does not understand, kept verbatim.
export class Raw extends Node {
  latex: string
  constructor(latex: string) { super(); this.latex = latex }
}

export class Space extends Node {
  cmd: string
  constructor(cmd: string) { super(); this.cmd = cmd }
  override get cls(): string { return 'space' }
  get mu(): number { return has(SPACES, this.cmd) ? SPACES[this.cmd]! : 3 }
}

// The half-typed \name while the user is entering a command.
export class CmdInput extends Node {
  text: string
  constructor(text = '') { super(); this.text = text }
}

export class Frac extends Node {
  num: Row
  den: Row
  cmd: string
  constructor(num?: Row | null, den?: Row | null, cmd = 'frac') {
    super()
    this.num = num || new Row()
    this.den = den || new Row()
    this.cmd = cmd
  }
  override get cls(): string { return 'inner' }
  override slots(): Row[] { return [this.num, this.den] }
}

export class Sqrt extends Node {
  body: Row
  index: Row | null
  constructor(body?: Row | null, index: Row | null = null) {
    super()
    this.body = body || new Row()
    this.index = index
  }
  override slots(): Row[] { return this.index !== null ? [this.index, this.body] : [this.body] }
}

// Sub/superscript attached to whatever node precedes it.
export class Scripts extends Node {
  sub: Row | null
  sup: Row | null
  constructor(sub: Row | null = null, sup: Row | null = null) {
    super()
    this.sub = sub
    this.sup = sup
  }
  override slots(): Row[] { return [this.sub, this.sup].filter((r): r is Row => r !== null) }
}

export class BigOp extends Node {
  op: string
  lower: Row | null
  upper: Row | null
  constructor(op: string, lower: Row | null = null, upper: Row | null = null) {
    super()
    this.op = op
    this.lower = lower
    this.upper = upper
  }
  override get cls(): string { return 'op' }
  override slots(): Row[] { return [this.lower, this.upper].filter((r): r is Row => r !== null) }
}

export class Delim extends Node {
  left: string
  right: string
  body: Row
  // true: came from \left..\right; null: auto (sized when tall).
  sized: boolean | null
  constructor(left = '(', right = ')', body?: Row | null, sized: boolean | null = null) {
    super()
    this.left = left
    this.right = right
    this.body = body || new Row()
    this.sized = sized
  }
  override get cls(): string { return 'inner' }
  override slots(): Row[] { return [this.body] }
}

export class Matrix extends Node {
  env: string
  rows: Row[][]
  constructor(env = 'pmatrix', rows?: Row[][] | null) {
    super()
    this.env = env
    this.rows = rows && rows.length ? rows : [[new Row(), new Row()], [new Row(), new Row()]]
  }
  override get cls(): string { return 'inner' }
  override slots(): Row[] { return this.rows.flat() }
  ncols(): number { return Math.max(0, ...this.rows.map(r => r.length)) }
}

export class Accent extends Node {
  cmd: string
  body: Row
  constructor(cmd = 'hat', body?: Row | null) {
    super()
    this.cmd = cmd
    this.body = body || new Row()
  }
  override slots(): Row[] { return [this.body] }
}

// \mathbb{R}, \mathrm{d}, \mathbf{v}, ...
export class Styled extends Node {
  cmd: string
  body: Row
  constructor(cmd = 'mathrm', body?: Row | null) {
    super()
    this.cmd = cmd
    this.body = body || new Row()
  }
  override slots(): Row[] { return [this.body] }
}

// \text{...}: its row holds Atom(kind='text') characters.
export class Text extends Node {
  body: Row
  constructor(body?: Row | null) { super(); this.body = body || new Row() }
  override slots(): Row[] { return [this.body] }
}

// A braced group that must stay grouped, e.g. {a+b}^2.
export class Group extends Node {
  body: Row
  constructor(body?: Row | null) { super(); this.body = body || new Row() }
  override slots(): Row[] { return [this.body] }
}

export function classifyChar(ch: string): string {
  if ('+-*'.includes(ch)) return 'bin'
  if ('=<>:'.includes(ch)) return 'rel'
  if (',;'.includes(ch)) return 'punct'
  if ('(['.includes(ch)) return 'open'
  if (')]'.includes(ch)) return 'close'
  return 'ord'
}

// (Re)set parent/owner pointers below row.
export function link(row: Row, owner: Node | null = null): Row {
  row.owner = owner
  for (const n of row.children) {
    n.parent = row
    for (const s of n.slots()) link(s, n)
  }
  return row
}

// Every row in document order (depth first, slot order).
export function* walkRows(row: Row): Generator<Row> {
  yield row
  for (const n of row.children) {
    for (const s of n.slots()) yield* walkRows(s)
  }
}

function indexOf<T>(seq: readonly T[], item: T): number {
  const i = seq.indexOf(item)
  if (i < 0) throw new Error('not found')
  return i
}

// copy.deepcopy of a tree (parent/owner pointers are re-linked after).
export function cloneRow(row: Row): Row {
  return new Row(row.children.map(cloneNode))
}
const cloneOpt = (r: Row | null): Row | null => (r === null ? null : cloneRow(r))

export function cloneNode(n: Node): Node {
  if (n instanceof Atom) return new Atom(n.char, n.kind)
  if (n instanceof Symbol) return new Symbol(n.cmd)
  if (n instanceof Func) { const f = new Func(n.name); f.operatorname = n.operatorname; return f }
  if (n instanceof Placeholder) return new Placeholder()
  if (n instanceof Raw) return new Raw(n.latex)
  if (n instanceof Space) return new Space(n.cmd)
  if (n instanceof CmdInput) return new CmdInput(n.text)
  if (n instanceof Frac) return new Frac(cloneRow(n.num), cloneRow(n.den), n.cmd)
  if (n instanceof Sqrt) return new Sqrt(cloneRow(n.body), cloneOpt(n.index))
  if (n instanceof Scripts) return new Scripts(cloneOpt(n.sub), cloneOpt(n.sup))
  if (n instanceof BigOp) return new BigOp(n.op, cloneOpt(n.lower), cloneOpt(n.upper))
  if (n instanceof Delim) return new Delim(n.left, n.right, cloneRow(n.body), n.sized)
  if (n instanceof Matrix) return new Matrix(n.env, n.rows.map(r => r.map(cloneRow)))
  if (n instanceof Accent) return new Accent(n.cmd, cloneRow(n.body))
  if (n instanceof Styled) return new Styled(n.cmd, cloneRow(n.body))
  if (n instanceof Text) return new Text(cloneRow(n.body))
  if (n instanceof Group) return new Group(cloneRow(n.body))
  throw new TypeError('unknown node')
}

// ------------------------------------------------------------ serializer

const CTRL_WORD_END = /\\[A-Za-z]+$/
const TEXT_ESC: Record<string, string> = {
  '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '\\&',
  $: '\\$', _: '\\_', '\\': '\\textbackslash{}',
  '^': '\\^{}', '~': '\\~{}',
}
const ATOM_TEX: Record<string, string> = {
  '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '\\&',
  $: '\\$', _: '\\_', '−': '-', '′': "'",
}
const isTall = (n: Node): boolean =>
  n instanceof Frac || n instanceof BigOp || n instanceof Matrix || n instanceof Sqrt
const isAtomOrSymbol = (n: Node | null): n is Atom | Symbol => n instanceof Atom || n instanceof Symbol
const firstIsAlpha = (s: string): boolean => isAlphaStr(cps(s)[0] ?? '')
const rstripWs = (s: string): string => s.replace(/\s+$/u, '')
const stripWs = (s: string): string => s.replace(/^\s+|\s+$/gu, '')

// Serialise row. Empty slots become placeholder: {} for the document,
// PLACEHOLDER for the editable source view.
export function toLatex(row: Row, placeholder = '{}'): string {
  return stripWs(rowTex(row, placeholder))
}

function rowTex(row: Row, ph: string, slot = false, compact = false): string {
  if (!row.children.length) return slot ? ph : ''
  let out = ''
  let prev: Node | null = null
  for (const n of row.children) {
    const tok = nodeTex(n, ph, prev)
    if ((prev instanceof BigOp || prev instanceof Space) && !(n instanceof Scripts)) out += ' '
    if (compact && !(n instanceof Symbol && (n.cls === 'bin' || n.cls === 'rel') && prev !== null)) {
      if (out && CTRL_WORD_END.test(out) && firstIsAlpha(tok)) out += ' '
      out += tok
      prev = n
      continue
    }
    if ((n.cls === 'bin' || n.cls === 'rel') && isAtomOrSymbol(n) && prev !== null && !(prev instanceof Space)) {
      const unary = n.cls === 'bin' && ['bin', 'rel', 'open', 'punct', 'op'].includes(prev.cls)
      if (!unary) {
        out = rstripWs(out) + ' ' + tok + ' '
        prev = n
        continue
      }
    }
    if (prev === null && n.cls === 'rel' && isAtomOrSymbol(n)) {
      out = tok + ' '
      prev = n
      continue
    }
    if (isAtomOrSymbol(prev) && prev.cls === 'punct') out = rstripWs(out) + ' '
    if (out && CTRL_WORD_END.test(out) && firstIsAlpha(tok)) out += ' '
    out += tok
    prev = n
  }
  return out
}

function argTex(row: Row | null, ph: string, compact = false): string {
  if (row === null || !row.children.length) return ph === '{}' ? '{}' : '{' + ph + '}'
  return '{' + stripWs(rowTex(row, ph, true, compact)) + '}'
}

function scriptArg(row: Row, ph: string): string {
  if (row.children.length === 1) {
    const n = row.children[0]
    if (n instanceof Atom && isAlnumStr(n.char) && n.kind !== 'text') return n.char
  }
  return argTex(row, ph, true)
}

const PLAIN_DELIMS: ReadonlySet<string> = new Set(['(', ')', '[', ']', '\\{', '\\}', '|', '\\|'])
const DISPLAY_ENVS: ReadonlySet<string> = new Set(['align', 'align*', 'gather', 'gather*',
  'equation', 'equation*', 'multline', 'multline*'])
const ALIGN_ENVS: ReadonlySet<string> = new Set(['align', 'align*', 'aligned', 'split'])

function nodeTex(n: Node, ph: string, prev: Node | null): string {
  if (n instanceof Atom) {
    if (n.kind === 'text') return has(TEXT_ESC, n.char) ? TEXT_ESC[n.char]! : n.char
    return has(ATOM_TEX, n.char) ? ATOM_TEX[n.char]! : n.char
  }
  if (n instanceof Symbol) return '\\' + n.cmd
  if (n instanceof Func) return n.operatorname ? `\\operatorname{${n.name}}` : '\\' + n.name
  if (n instanceof Placeholder) return ph
  if (n instanceof Raw) return n.latex
  if (n instanceof Space) return n.cmd === '~' ? '~' : '\\' + n.cmd
  if (n instanceof CmdInput) return '\\' + n.text
  if (n instanceof Frac) return '\\' + n.cmd + argTex(n.num, ph) + argTex(n.den, ph)
  if (n instanceof Sqrt) {
    let idx = ''
    if (n.index !== null) {
      idx = '[' + (ph === '{}' && !n.index.children.length ? '' : stripWs(rowTex(n.index, ph, true))) + ']'
    }
    return '\\sqrt' + idx + argTex(n.body, ph)
  }
  if (n instanceof Scripts) {
    let base = ''
    if (prev === null || prev instanceof Scripts || prev instanceof Space
      || (isAtomOrSymbol(prev) && ['bin', 'rel', 'punct'].includes(prev.cls))) base = '{}'
    let s = base
    if (n.sub !== null) s += '_' + scriptArg(n.sub, ph)
    if (n.sup !== null) s += '^' + scriptArg(n.sup, ph)
    return s
  }
  if (n instanceof BigOp) {
    let s = '\\' + n.op
    for (const [mark, r] of [['_', n.lower], ['^', n.upper]] as const) {
      if (r === null || (r.isEmpty() && ph === '{}')) continue
      s += mark + scriptArg(r, ph)
    }
    return s
  }
  if (n instanceof Delim) {
    let body = stripWs(rowTex(n.body, ph, false))
    if (!n.body.children.length && ph !== '{}') body = ph
    const tall = n.body.children.some(isTall)
    const plainOk = PLAIN_DELIMS.has(n.left) && PLAIN_DELIMS.has(n.right)
    if (n.sized || (n.sized === null && tall) || !plainOk) {
      return `\\left${n.left || '.'} ${body} \\right${n.right || '.'}`
    }
    let left = n.left || ''
    const right = n.right || ''
    if (CTRL_WORD_END.test(left) && firstIsAlpha(body)) left += ' '
    return left + body + right
  }
  if (n instanceof Matrix) {
    const sep = DISPLAY_ENVS.has(n.env) ? ' \\\\\n' : ' \\\\ '
    const rows: string[] = []
    for (const r of n.rows) {
      const cells = r.map(c => stripWs(rowTex(c, ph, true)))
      if (ALIGN_ENVS.has(n.env)) rows.push(cells.length > 1 ? cells.join(' &') : cells[0]!)
      else rows.push(cells.join(' & '))
    }
    const nl = DISPLAY_ENVS.has(n.env) ? '\n' : ' '
    return `\\begin{${n.env}}` + nl + rows.join(sep) + nl + `\\end{${n.env}}`
  }
  if (n instanceof Accent) return '\\' + n.cmd + argTex(n.body, ph)
  if (n instanceof Styled) return '\\' + n.cmd + argTex(n.body, ph)
  if (n instanceof Text) return '\\text{' + n.body.children.map(c => nodeTex(c, ph, null)).join('') + '}'
  if (n instanceof Group) return argTex(n.body, ph)
  throw new TypeError(String(n))
}

// ----------------------------------------------------------------- parser

interface Tok { kind: 'cmd' | 'sym' | 'ws' | 'ch'; val: string; start: number; end: number }

const TOKEN = /\\([A-Za-z]+)\*?|\\([\s\S])|(\s+)|([\s\S])/gu

function tokenize(s: string): Tok[] {
  const toks: Tok[] = []
  for (const m of s.matchAll(TOKEN)) {
    const start = m.index!
    const end = start + m[0].length
    if (m[1] !== undefined) toks.push({ kind: 'cmd', val: m[0].slice(1), start, end })
    else if (m[2] !== undefined) toks.push({ kind: 'sym', val: m[2], start, end })
    else if (m[3] !== undefined) toks.push({ kind: 'ws', val: m[3], start, end })
    else toks.push({ kind: 'ch', val: m[4]!, start, end })
  }
  return toks
}

// Templates in equations store line breaks as the two characters \n;
// turn them into real newlines.
export function normalizeTemplate(s: string): string {
  s = s.replace(/\\n(?![A-Za-z])/g, '\n')
  return s.replace(/(\\\\\s*){2,}/gu, '\\\\ ')
}

type Stops = ReadonlySet<string>
const NO_STOPS: Stops = new Set()
const plus = (s: Stops, v: string): Stops => new Set([...s, v])

class Parser {
  src: string
  toks: Tok[]
  i = 0
  constructor(src: string) {
    this.src = src
    this.toks = tokenize(src)
  }

  peek(skipWs = true): Tok | null {
    let j = this.i
    while (skipWs && j < this.toks.length && this.toks[j]!.kind === 'ws') j++
    return j < this.toks.length ? this.toks[j]! : null
  }

  next(skipWs = true): Tok | null {
    while (skipWs && this.i < this.toks.length && this.toks[this.i]!.kind === 'ws') this.i++
    if (this.i >= this.toks.length) return null
    return this.toks[this.i++]!
  }

  static is(t: Tok | null, kind: Tok['kind'], val?: string): boolean {
    return t !== null && t.kind === kind && (val === undefined || t.val === val)
  }

  parseRow(stops: Stops = NO_STOPS): Row {
    const nodes: Node[] = []
    for (;;) {
      const t = this.peek()
      if (t === null || this.isStop(t, stops)) break
      this.parseItem(nodes, stops)
    }
    return tidy(new Row(nodes))
  }

  isStop(t: Tok, stops: Stops): boolean {
    if (t.kind === 'ch' && t.val === '}') return true
    if (t.kind === 'ch' && stops.has(t.val)) return true
    if (t.kind === 'ch' && t.val === '&' && stops.has('&')) return true
    if (t.kind === 'sym' && t.val === '\\' && stops.has('\\\\')) return true
    if (t.kind === 'sym' && t.val === '}' && stops.has('\\}')) return true
    if (t.kind === 'cmd' && (t.val === 'end' || t.val === 'right') && stops.has(t.val)) return true
    return false
  }

  // A macro argument: {...} or a single token.
  groupOrToken(): Row {
    const t = this.peek()
    if (t === null) return new Row()
    if (Parser.is(t, 'ch', '{')) {
      this.next()
      const r = this.parseRow()
      if (Parser.is(this.peek(), 'ch', '}')) this.next()
      return r
    }
    const nodes: Node[] = []
    this.parseItem(nodes, NO_STOPS, true)
    return tidy(new Row(nodes))
  }

  // Verbatim text of the next {...} group (without braces).
  bracedRaw(): string | null {
    const t = this.peek()
    if (!Parser.is(t, 'ch', '{')) return null
    this.next()
    const start = t!.end
    let depth = 1
    while (this.i < this.toks.length) {
      const u = this.toks[this.i++]!
      if (u.kind === 'ch' && u.val === '{') depth++
      else if (u.kind === 'ch' && u.val === '}') {
        depth--
        if (depth === 0) return this.src.slice(start, u.start)
      }
    }
    return this.src.slice(start)
  }

  parseItem(nodes: Node[], stops: Stops, single = false): void {
    const t = this.next()!
    if (t.kind === 'ch') {
      const c = t.val
      if (c === '{') {
        const r = this.parseRow()
        if (Parser.is(this.peek(), 'ch', '}')) this.next()
        const nxt = this.peek()
        const script = Parser.is(nxt, 'ch', '^') || Parser.is(nxt, 'ch', '_')
        if (!r.children.length && script) return          // "{}^2": scripts with no base
        if (r.children.length > 1 && script) nodes.push(new Group(r))
        else if (single && r.children.length !== 1) nodes.push(new Group(r))
        else nodes.push(...r.children)
        return
      }
      if (c === '^' || c === '_') {
        const arg = this.groupOrToken()
        attachScript(nodes, c, arg)
        return
      }
      if ((c === '(' || c === '[') && !single) {
        const close = c === '(' ? ')' : ']'
        const save = this.i
        const body = this.parseRow(plus(stops, close))
        if (Parser.is(this.peek(), 'ch', close)) {
          this.next()
          nodes.push(new Delim(c, close, body, false))
          return
        }
        this.i = save
        nodes.push(new Atom(c))
        return
      }
      if (c === '~') { nodes.push(new Space('~')); return }
      if (c === "'") { nodes.push(new Atom('′', 'ord')); return }
      if (c === '&' || c === '}') { nodes.push(new Raw(c)); return }
      nodes.push(new Atom(c))
      return
    }
    if (t.kind === 'sym') {
      const v = t.val
      if (has(SPACES, v)) nodes.push(new Space(v))
      else if (v === '{' && !single) {
        const save = this.i
        const body = this.parseRow(plus(stops, '\\}'))
        if (Parser.is(this.peek(), 'sym', '}')) {
          this.next()
          nodes.push(new Delim('\\{', '\\}', body, false))
          return
        }
        this.i = save
        nodes.push(new Symbol('{'))
      } else if (SYMBOLS.has(v)) nodes.push(new Symbol(v))
      else if (v === '\\') nodes.push(new Raw('\\\\'))
      else nodes.push(new Raw('\\' + v))
      return
    }
    if (t.kind === 'ws') return
    this.parseCommand(t, nodes)
  }

  parseCommand(t: Tok, nodes: Node[]): void {
    const name = t.val
    const starred = this.src.slice(t.start, t.end).endsWith('*')
    if (name === 'square') nodes.push(new Placeholder())
    else if (FRACS.includes(name)) {
      const a = this.groupOrToken()
      const b = this.groupOrToken()
      nodes.push(new Frac(a, b, name))
    } else if (name === 'sqrt') {
      let index: Row | null = null
      if (Parser.is(this.peek(), 'ch', '[')) {
        this.next()
        index = this.parseRow(new Set([']']))
        if (Parser.is(this.peek(), 'ch', ']')) this.next()
      }
      nodes.push(new Sqrt(this.groupOrToken(), index))
    } else if (has(BIGOPS, name)) nodes.push(new BigOp(name))
    else if (['limits', 'nolimits', 'displaystyle', 'textstyle',
      'scriptstyle', 'nonumber', 'notag'].includes(name)) nodes.push(new Raw('\\' + name))
    else if ((FUNCS as readonly string[]).includes(name)) nodes.push(new Func(name))
    else if (name === 'operatorname') {
      const txt = this.bracedRaw()
      if (txt === null) nodes.push(new Raw('\\operatorname'))
      else if (starred) nodes.push(new Raw(`\\operatorname*{${txt}}`))
      else nodes.push(new Func(stripWs(txt), true))
    } else if (ACCENTS.includes(name)) nodes.push(new Accent(name, this.groupOrToken()))
    else if (STYLES.includes(name)) nodes.push(new Styled(name, this.groupOrToken()))
    else if (['text', 'textrm', 'mbox', 'textnormal'].includes(name)) {
      const txt = this.bracedRaw()
      if (txt === null) nodes.push(new Raw('\\' + name))
      else if (name !== 'text' || /\\(?![{}%#&$_ ])|\$/.test(txt)) nodes.push(new Raw(`\\${name}{${txt}}`))
      else nodes.push(new Text(new Row(cps(unescapeText(txt)).map(c => new Atom(c, 'text')))))
    } else if (name === 'left') {
      const left = this.delimToken()
      const body = this.parseRow(new Set(['right']))
      let right = '.'
      if (Parser.is(this.peek(), 'cmd', 'right')) {
        this.next()
        right = this.delimToken()
      }
      nodes.push(new Delim(left === '.' ? '' : left, right === '.' ? '' : right, body, true))
    } else if (name === 'begin') this.parseEnv(nodes)
    else if (has(SPACES, name)) nodes.push(new Space(name))
    else if (SYMBOLS.has(name)) nodes.push(new Symbol(name))
    else {
      // Unknown macro: keep it and its braced/bracketed arguments
      // verbatim so re-serialising never changes its meaning.
      const start = t.start
      let end = t.end
      for (;;) {
        const p = this.peek()
        if (Parser.is(p, 'ch', '{')) {
          this.bracedRaw()
          end = this.toks[this.i - 1]!.end
        } else if (Parser.is(p, 'ch', '[') && end === p!.start) {
          let depth = 0
          while (this.i < this.toks.length) {
            const u = this.toks[this.i++]!
            if (u.kind === 'ch' && u.val === '[') depth++
            else if (u.kind === 'ch' && u.val === ']') {
              depth--
              if (depth === 0) break
            }
          }
          end = this.toks[this.i - 1]!.end
        } else break
      }
      nodes.push(new Raw(this.src.slice(start, end)))
    }
  }

  delimToken(): string {
    const t = this.next()
    if (t === null) return '.'
    if (t.kind === 'ch') return t.val
    return '\\' + t.val
  }

  parseEnv(nodes: Node[]): void {
    const startTok = this.toks[this.i - 1]!
    const env = stripWs(this.bracedRaw() || '')
    if (!MATRIX_ENVS.includes(env)) {
      // Unknown environment: capture verbatim through its \end.
      let depth = 1
      while (this.i < this.toks.length) {
        const u = this.toks[this.i++]!
        if (u.kind === 'cmd' && (u.val === 'begin' || u.val === 'end')) {
          const save = this.i
          const e = this.bracedRaw()
          if (e !== null && stripWs(e) === env) {
            depth += u.val === 'begin' ? 1 : -1
            if (depth === 0) break
          } else if (e === null) this.i = save
        }
      }
      const end = this.i ? this.toks[this.i - 1]!.end : this.src.length
      nodes.push(new Raw(this.src.slice(startTok.start, end)))
      return
    }
    let rows: Row[][] = []
    let cells: Row[] = []
    const stops: Stops = new Set(['&', '\\\\', 'end'])
    for (;;) {
      const cell = this.parseRow(stops)
      cells.push(cell)
      const t = this.peek()
      if (t === null) break
      if (Parser.is(t, 'ch', '&')) { this.next(); continue }
      if (Parser.is(t, 'sym', '\\')) {
        this.next()
        if (Parser.is(this.peek(), 'ch', '[')) {   // \\[2pt]
          this.parseRow(new Set([']']))
          this.next()
        }
        rows.push(cells)
        cells = []
        continue
      }
      if (Parser.is(t, 'cmd', 'end')) {
        this.next()
        this.bracedRaw()
        break
      }
      if (Parser.is(t, 'ch', '}')) { this.next(); continue }   // stray brace: skip it
      break
    }
    if (cells.length && !(cells.length === 1 && !cells[0]!.children.length && rows.length)) rows.push(cells)
    if (!rows.length) rows = [[new Row()]]
    const width = Math.max(...rows.map(r => r.length))
    for (const r of rows) while (r.length < width) r.push(new Row())
    nodes.push(new Matrix(env, rows))
  }
}

function unescapeText(s: string): string {
  return s.replace(/\\([{}%#&$_ ])/g, '$1')
}

function attachScript(nodes: Node[], mark: string, arg: Row): void {
  const prev = nodes.length ? nodes[nodes.length - 1]! : null
  const sub = mark === '_'
  if (prev instanceof BigOp) {
    if (sub ? prev.lower === null : prev.upper === null) {
      if (sub) prev.lower = arg
      else prev.upper = arg
      return
    }
  }
  if (prev instanceof Scripts && (sub ? prev.sub === null : prev.sup === null)) {
    if (sub) prev.sub = arg
    else prev.sup = arg
    return
  }
  const s = new Scripts()
  if (sub) s.sub = arg
  else s.sup = arg
  nodes.push(s)
}

// A slot holding just \square is simply an empty slot.
function tidy(row: Row): Row {
  if (row.children.length === 1 && row.children[0] instanceof Placeholder) row.children = []
  return row
}

// Parse LaTeX math into a tree. Never throws: anything unknown is kept
// verbatim in Raw nodes.
export function parseLatex(s: string): Row {
  const p = new Parser(normalizeTemplate(s || ''))
  const nodes: Node[] = []
  while (p.peek() !== null) {
    const row = p.parseRow()
    nodes.push(...row.children)
    const t = p.next()
    if (t !== null) nodes.push(new Raw(p.src.slice(t.start, t.end)))   // stray closer
  }
  return link(tidy(new Row(nodes)))
}

// ------------------------------------------------------------ commands

function cmdEntries(): [string, string][] {
  const out: [string, string][] = []
  for (const [k, [g]] of SYMBOLS) if (isAlphaStr(k)) out.push([k, g])
  for (const f of FUNCS) out.push([f, f])
  for (const [k, g] of Object.entries(BIGOPS)) out.push([k, g || k])
  for (const k of FRACS) out.push([k, k.includes('frac') ? 'a⁄b' : '(ⁿₖ)'])
  out.push(['sqrt', '√'], ['nthroot', 'ⁿ√'], ['text', 'abc'], ['abs', '|x|'], ['norm', '‖x‖'])
  for (const a of ACCENTS) out.push([a, 'x̂'])
  for (const s of STYLES) out.push([s, s.startsWith('math') ? s.slice(4) : s])
  for (const e of ['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'aligned']) out.push([e, '▦'])
  for (const k of ['quad', 'qquad']) out.push([k, '␣'])
  const seen = new Set<string>()
  const uniq: [string, string][] = []
  for (const [k, g] of out) {
    if (!seen.has(k)) {
      seen.add(k)
      uniq.push([k, g])
    }
  }
  return uniq
}

export const COMMANDS: readonly [string, string][] = cmdEntries()

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// Commands starting with prefix (exact match first, then the most
// common/shortest).
export function completions(prefix: string, limit = 12): [string, string][] {
  if (!prefix) return []
  const hits = COMMANDS.filter(([k]) => k.startsWith(prefix))
  hits.sort((a, b) => (Number(a[0] !== prefix) - Number(b[0] !== prefix))
    || (a[0].length - b[0].length) || cmpStr(a[0], b[0]))
  return hits.slice(0, limit)
}

// Nodes for a typed \name and the row the caret should enter (null:
// caret goes after the nodes).
export function commandNodes(name: string): [Node[], Row | null] {
  if (FRACS.includes(name)) {
    const f = new Frac(null, null, name)
    return [[f], f.num]
  }
  if (name === 'sqrt') {
    const s = new Sqrt()
    return [[s], s.body]
  }
  if (name === 'nthroot' || name === 'root') {
    const s = new Sqrt(null, new Row())
    return [[s], s.index]
  }
  if (has(BIGOPS, name)) {
    const op = new BigOp(name, new Row(), name.startsWith('lim') ? null : new Row())
    return [[op], op.lower]
  }
  if ((FUNCS as readonly string[]).includes(name)) return [[new Func(name)], null]
  if (ACCENTS.includes(name)) {
    const a = new Accent(name)
    return [[a], a.body]
  }
  if (STYLES.includes(name)) {
    const s = new Styled(name)
    return [[s], s.body]
  }
  if (name === 'text' || name === 'textrm' || name === 'mbox') {
    const t = new Text()
    return [[t], t.body]
  }
  if (name === 'abs' || name === 'norm') {
    const d = name === 'abs' ? '|' : '\\|'
    const n = new Delim(d, d)
    return [[n], n.body]
  }
  if (name === 'langle' || name === 'lfloor' || name === 'lceil') {
    const n = new Delim('\\' + name, '\\' + DELIM_PAIRS['\\' + name]!.slice(1))
    return [[n], n.body]
  }
  if (MATRIX_ENVS.includes(name)) {
    const m = new Matrix(name)
    return [[m], m.rows[0]![0]!]
  }
  if (has(SPACES, name)) return [[new Space(name)], null]
  if (name === 'square') return [[new Placeholder()], null]
  if (SYMBOLS.has(name)) return [[new Symbol(name)], null]
  return [[new Raw('\\' + name)], null]
}

// ---------------------------------------------------------------- editor

const AUTO_REPLACE: Record<string, string> = {
  '-\u0000>': 'to', '<\u0000=': 'leq', '>\u0000=': 'geq',
  '!\u0000=': 'neq', '+\u0000-': 'pm', '=\u0000>': 'Rightarrow',
  '<\u0000-': 'leftarrow', '~\u0000=': 'approx',
}
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '\\{' }

type Snapshot = [Row, [number, number][], number]

const cmpTuple = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return a.length - b.length
}

// Cursor, selection and editing operations on a math tree.
export class Editor {
  root: Row
  row: Row
  idx: number
  anchor: [Row, number] | null = null
  private undoStack: Snapshot[] = []
  private redoStack: Snapshot[] = []
  cmd: CmdInput | null = null
  version = 0

  constructor(root: Row | null = null) {
    this.root = link(root || new Row())
    this.row = this.root
    this.idx = this.root.children.length
  }

  // ---- loading / output
  setLatex(latex: string): void {
    this.cmd = null
    this.root = parseLatex(latex)
    this.row = this.root
    this.idx = this.root.children.length
    this.anchor = null
    this.changed()
  }

  latex(placeholder = '{}'): string {
    return toLatex(this.root, placeholder)
  }

  private changed(): void {
    link(this.root)
    this.version += 1
  }

  // ---- undo
  private path(row: Row): [number, number][] {
    const path: [number, number][] = []
    while (row.owner !== null) {
      const node = row.owner
      path.push([indexOf(node.parent!.children, node), indexOf(node.slots(), row)])
      row = node.parent!
    }
    return path.reverse()
  }

  private rowAt(root: Row, path: [number, number][]): Row {
    let row = root
    for (const [ni, si] of path) {
      const n = row.children[ni]
      const s = n?.slots()[si]
      if (!s) throw new RangeError('bad path')
      row = s
    }
    return row
  }

  snapshot(): Snapshot {
    this.commitCmdIfAny()
    return [cloneRow(this.root), this.path(this.row), this.idx]
  }

  private restore(snap: Snapshot): void {
    const [root, path, idx] = snap
    this.root = link(cloneRow(root))
    try {
      this.row = this.rowAt(this.root, path)
    } catch {
      this.row = this.root
    }
    this.idx = Math.min(idx, this.row.children.length)
    this.anchor = null
    this.version += 1
  }

  pushUndo(): void {
    this.undoStack.push(this.snapshot())
    if (this.undoStack.length > 200) this.undoStack.splice(0, this.undoStack.length - 200)
    this.redoStack.length = 0
  }

  undo(): boolean {
    if (!this.undoStack.length) return false
    this.redoStack.push(this.snapshot())
    this.restore(this.undoStack.pop()!)
    return true
  }

  redo(): boolean {
    if (!this.redoStack.length) return false
    this.undoStack.push(this.snapshot())
    this.restore(this.redoStack.pop()!)
    return true
  }

  // ---- selection
  hasSelection(): boolean {
    return this.anchor !== null && this.anchor[0] === this.row && this.anchor[1] !== this.idx
  }

  selection(): [Row, number, number] | null {
    if (!this.hasSelection()) return null
    const a = this.anchor![1]
    return [this.row, Math.min(a, this.idx), Math.max(a, this.idx)]
  }

  clearSelection(): void { this.anchor = null }

  selectAll(): void {
    this.row = this.root
    this.anchor = [this.root, 0]
    this.idx = this.root.children.length
  }

  // [(row, idx, inside)] from row up to the root.
  private chain(row: Row, idx: number): [Row, number, boolean][] {
    const out: [Row, number, boolean][] = [[row, idx, false]]
    while (row.owner !== null) {
      const node = row.owner
      row = node.parent!
      out.push([row, indexOf(row.children, node), true])
    }
    return out
  }

  // Select from anchor to caret, lifting both ends to their deepest
  // common row so selections always cover whole nodes.
  setSelection(aRow: Row, aIdx: number, cRow: Row, cIdx: number): void {
    const ca = this.chain(aRow, aIdx)
    const cc = this.chain(cRow, cIdx)
    for (const [r, ci0, cin] of cc) {
      for (const [ra, ai0, ain] of ca) {
        if (ra === r) {
          let ci = ci0
          let ai = ai0
          if (cin && ain && ci === ai) {
            // Both ends inside the same node: select it whole.
            this.row = r
            this.anchor = [r, ci]
            this.idx = ci + 1
            return
          }
          if (cin) ci = ci >= ai ? ci + 1 : ci
          if (ain) ai = ai >= ci ? ai + 1 : ai
          this.row = r
          this.idx = ci
          this.anchor = [r, ai]
          return
        }
      }
    }
    this.row = cRow
    this.idx = cIdx
    this.anchor = null
  }

  selectedNodes(): Node[] {
    const sel = this.selection()
    if (!sel) return []
    const [row, i, j] = sel
    return row.children.slice(i, j)
  }

  // Remove and return the selected nodes (caret at their spot).
  private takeSelection(): Node[] {
    const sel = this.selection()
    this.anchor = null
    if (!sel) return []
    const [row, i, j] = sel
    const taken = row.children.splice(i, j - i)
    this.row = row
    this.idx = i
    return taken
  }

  deleteSelection(): boolean {
    if (!this.hasSelection()) return false
    this.pushUndo()
    this.takeSelection()
    this.changed()
    return true
  }

  // ---- caret placement helpers
  setCursor(row: Row, idx: number, keepAnchor = false): void {
    this.commitCmdIfAny()
    if (!keepAnchor) this.anchor = null
    this.row = row
    this.idx = Math.max(0, Math.min(idx, row.children.length))
  }

  private enterStart(row: Row): void { this.row = row; this.idx = 0 }
  private enterEnd(row: Row): void { this.row = row; this.idx = row.children.length }
  private after(node: Node): void {
    this.row = node.parent!
    this.idx = indexOf(this.row.children, node) + 1
  }
  private before(node: Node): void {
    this.row = node.parent!
    this.idx = indexOf(this.row.children, node)
  }

  // ---- insertion
  private eatPlaceholder(): void {
    const ch = this.row.children
    if (this.idx < ch.length && ch[this.idx] instanceof Placeholder) ch.splice(this.idx, 1)
    else if (this.idx > 0 && ch[this.idx - 1] instanceof Placeholder) {
      ch.splice(this.idx - 1, 1)
      this.idx -= 1
    }
  }

  private insert(nodes: Node[]): void {
    this.eatPlaceholder()
    this.row.children.splice(this.idx, 0, ...nodes)
    this.idx += nodes.length
    link(this.root)
  }

  // Insert a structure; the selection (if any) fills its first empty
  // slot, and the caret lands in the next empty slot.
  insertNodes(nodes: Node[], wrapSelection = true): void {
    this.commitCmdIfAny()
    this.pushUndo()
    link(new Row(nodes))
    const taken = this.takeSelection()
    if (taken.length && wrapSelection) {
      const first = firstEmpty(nodes)
      if (first !== null) {
        if (first instanceof Placeholder) {
          const top = nodes.indexOf(first)
          if (top >= 0) nodes = [...nodes.slice(0, top), ...taken, ...nodes.slice(top + 1)]
          else {
            const r = first.parent!
            const k = indexOf(r.children, first as Node)
            r.children.splice(k, 1, ...taken)
          }
        } else first.children.splice(0, first.children.length, ...taken)
      } else nodes = [...taken, ...nodes]
    }
    this.insert(nodes)
    this.changed()
    const target = firstEmpty(nodes)
    if (target === null) return
    if (target instanceof Placeholder) {
      this.row = target.parent!
      this.idx = indexOf(this.row.children, target as Node)
    } else this.enterStart(target)
  }

  insertLatex(latex: string): void {
    this.insertNodes([...parseLatex(latex).children])
  }

  typeText(text: string): void {
    for (const ch of cps(text)) this.typeChar(ch)
  }

  typeChar(ch: string): void {
    if (this.cmd !== null) {
      this.cmdChar(ch)
      return
    }
    if (this.row.owner instanceof Text) {
      this.pushUndo()
      this.takeSelection()
      this.insert([new Atom(ch, 'text')])
      this.changed()
      return
    }
    if (ch === '\\') {
      this.pushUndo()
      this.takeSelection()
      this.cmd = new CmdInput()
      this.insert([this.cmd])
      this.changed()
      return
    }
    if (ch === '/') { this.makeFraction(); return }
    if (ch === '^' || ch === '_') { this.makeScript(ch); return }
    if (')]}|'.includes(ch) && this.closeDelim(ch)) return
    if ('([{|'.includes(ch)) { this.makeDelim(ch); return }
    if (isSpaceStr(ch)) return
    this.pushUndo()
    this.takeSelection()
    let node: Node
    if (ch === '{' || ch === '}') node = new Symbol(ch)
    else if (ch === "'") node = new Atom('′', 'ord')
    else node = new Atom(ch)
    const prev = this.idx ? this.row.children[this.idx - 1]! : null
    const key = prev instanceof Atom ? prev.char + '\u0000' + ch : ''
    if (prev instanceof Atom && has(AUTO_REPLACE, key)) {
      this.row.children[this.idx - 1] = new Symbol(AUTO_REPLACE[key]!)
      this.changed()
      return
    }
    if (prev instanceof Symbol && prev.cmd === 'leftarrow' && ch === '>') {
      this.row.children[this.idx - 1] = new Symbol('leftrightarrow')
      this.changed()
      return
    }
    this.insert([node])
    if (isAsciiAlpha(ch)) this.recogniseFunction()
    this.changed()
  }

  private recogniseFunction(): void {
    const ch = this.row.children
    const k = this.idx
    const prev = k >= 2 ? ch[k - 2]! : null
    const last = ch[k - 1] as Atom
    if (prev instanceof Func && AUTO_FUNCS.includes(prev.name + last.char)) {
      prev.name += last.char
      ch.splice(k - 1, 1)
      this.idx -= 1
      return
    }
    let letters = ''
    let j = k
    while (j > 0 && letters.length < 6) {
      const n = ch[j - 1]
      if (n instanceof Atom && n.kind === 'ord' && isAsciiAlpha(n.char)) {
        letters = n.char + letters
        j -= 1
      } else break
    }
    for (let L = letters.length; L > 1; L--) {
      const name = letters.slice(-L)
      if (AUTO_FUNCS.includes(name)) {
        const start = k - L
        if (name === 'lim') {
          const node = new BigOp('lim', new Row(), null)
          ch.splice(start, k - start, node)
          link(this.root)
          this.enterStart(node.lower!)
        } else {
          ch.splice(start, k - start, new Func(name))
          this.idx = start + 1
        }
        return
      }
    }
  }

  // Typing the closer at the end of a bracket's body steps out.
  private closeDelim(ch: string): boolean {
    let row = this.row
    let idx = this.idx
    for (;;) {
      if (idx !== row.children.length) return false
      const o = row.owner
      if (o === null) return false
      if (o instanceof Delim && ((ch === '|' && (o.right === '|' || o.right === '\\|'))
        || o.left === CLOSERS[ch])) {
        this.commitCmdIfAny()
        this.anchor = null
        this.after(o)
        this.version += 1
        return true
      }
      if (!(o instanceof Scripts || o instanceof Accent || o instanceof Styled
        || o instanceof Frac || o instanceof Sqrt || o instanceof Group)) return false
      row = o.parent!
      idx = indexOf(row.children, o as Node) + 1
    }
  }

  makeDelim(ch: string): void {
    const pairs: Record<string, [string, string]> = {
      '(': ['(', ')'], '[': ['[', ']'], '{': ['\\{', '\\}'], '|': ['|', '|'],
    }
    const [left, right] = pairs[ch]!
    this.insertNodes([new Delim(left, right)])
  }

  makeFraction(): void {
    this.pushUndo()
    let num = this.hasSelection() ? this.takeSelection() : this.takeOperand()
    const only = num[0]
    if (num.length === 1 && only instanceof Delim && only.left === '(' && only.body.children.length) {
      num = [...only.body.children]
    }
    const f = new Frac(new Row(num), new Row())
    this.insert([f])
    this.changed()
    this.enterStart(num.length ? f.den : f.num)
  }

  private takeOperand(): Node[] {
    const ch = this.row.children
    let j = this.idx
    while (j > 0) {
      const n = ch[j - 1]!
      if (isAtomOrSymbol(n) && n.cls === 'ord') j -= 1
      else if (n instanceof Scripts || n instanceof Frac || n instanceof Sqrt || n instanceof Delim
        || n instanceof Accent || n instanceof Styled || n instanceof Group || n instanceof Text) j -= 1
      else break
    }
    const taken = ch.splice(j, this.idx - j)
    this.idx = j
    return taken
  }

  makeScript(mark: string): void {
    const sub = mark === '_'
    this.pushUndo()
    this.takeSelection()
    const ch = this.row.children
    const nxt = this.idx < ch.length ? ch[this.idx]! : null
    const prev = this.idx ? ch[this.idx - 1]! : null
    let target: Scripts | null = null
    if (nxt instanceof Scripts) target = nxt
    else if (prev instanceof Scripts) target = prev
    else if (prev instanceof BigOp) {
      if (sub && prev.lower === null) prev.lower = new Row()
      if (!sub && prev.upper === null) prev.upper = new Row()
      this.changed()
      this.enterEnd((sub ? prev.lower : prev.upper)!)
      return
    }
    if (target === null) {
      target = new Scripts()
      this.insert([target])
    }
    if (sub && target.sub === null) target.sub = new Row()
    if (!sub && target.sup === null) target.sup = new Row()
    this.changed()
    this.enterEnd((sub ? target.sub : target.sup)!)
  }

  // ---- command buffer
  private cmdChar(ch: string): void {
    const c = this.cmd!
    if (isAsciiAlpha(ch)) {
      c.text += ch
      this.version += 1
      return
    }
    if (!c.text && '{}|,;:!% #&$_\\ '.includes(ch)) {
      this.replaceCmd(ch)
      return
    }
    this.commitCmd()
    if (!isSpaceStr(ch)) this.typeChar(ch)
  }

  cmdBackspace(): void {
    if (this.cmd === null) return
    if (this.cmd.text) {
      this.cmd.text = this.cmd.text.slice(0, -1)
      this.version += 1
    } else this.cancelCmd()
  }

  cancelCmd(): void {
    if (this.cmd === null) return
    const row = this.cmd.parent!
    const k = indexOf(row.children, this.cmd as Node)
    row.children.splice(k, 1)
    this.row = row
    this.idx = k
    this.cmd = null
    this.changed()
  }

  commitCmdIfAny(): void {
    if (this.cmd !== null) this.commitCmd()
  }

  commitCmd(name: string | null = null): void {
    const c = this.cmd
    if (c === null) return
    this.replaceCmd(name !== null ? name : c.text)
  }

  private replaceCmd(name: string): void {
    const c = this.cmd!
    this.cmd = null
    const row = c.parent!
    const k = indexOf(row.children, c as Node)
    row.children.splice(k, 1)
    this.row = row
    this.idx = k
    if (!name) {
      this.changed()
      return
    }
    let nodes: Node[]
    let enter: Row | null
    if (name === '{' || name === '}') [nodes, enter] = [[new Symbol(name)], null]
    else if (has(SPACES, name) || name === ' ') [nodes, enter] = [[new Space(name)], null]
    else if ('|%#&$_'.includes(name)) [nodes, enter] = [[new Symbol(name)], null]
    else [nodes, enter] = commandNodes(name)
    this.insert(nodes)
    this.changed()
    if (enter !== null) this.enterStart(enter)
  }

  // ---- deletion
  backspace(): void {
    if (this.cmd !== null) {
      this.cmdBackspace()
      return
    }
    if (this.deleteSelection()) return
    const row = this.row
    const i = this.idx
    if (i > 0) {
      const n = row.children[i - 1]!
      const slots = n.slots()
      if (slots.length && slots.some(s => s.children.length)) {
        this.enterEnd(slots[slots.length - 1]!)
        this.version += 1
        return
      }
      this.pushUndo()
      row.children.splice(i - 1, 1)
      this.idx -= 1
      this.changed()
      return
    }
    const owner = row.owner
    if (owner === null) return
    this.pushUndo()
    this.unwrap(owner, row)
    this.changed()
  }

  delete(): void {
    if (this.cmd !== null) this.commitCmd()
    if (this.deleteSelection()) return
    const row = this.row
    const i = this.idx
    if (i < row.children.length) {
      const n = row.children[i]!
      const slots = n.slots()
      if (slots.length && slots.some(s => s.children.length)) {
        this.enterStart(slots[0]!)
        this.version += 1
        return
      }
      this.pushUndo()
      row.children.splice(i, 1)
      this.changed()
      return
    }
    const owner = row.owner
    if (owner === null) return
    if (!owner.slots().some(s => s.children.length)) {
      this.pushUndo()
      this.before(owner)
      this.row.children.splice(this.idx, 1)
      this.changed()
    } else this.moveRight()
  }

  // Backspace at the start of a slot dissolves the structure, keeping
  // everything that was typed into it.
  private unwrap(owner: Node, row: Row): void {
    const parent = owner.parent!
    const k = indexOf(parent.children, owner)
    if (owner instanceof Matrix) {
      const cells = owner.slots()
      const ci = indexOf(cells, row)
      if (ci > 0) {
        this.enterEnd(cells[ci - 1]!)
        return
      }
      if (cells.some(c => c.children.length)) {
        this.row = parent
        this.idx = k
        return
      }
      parent.children.splice(k, 1)
      this.row = parent
      this.idx = k
      return
    }
    const slots = owner.slots()
    if (owner instanceof Scripts) {
      // Deleting one script keeps the other.
      const content = [...row.children]
      if (owner.sub === row) owner.sub = null
      else owner.sup = null
      if (owner.slots().length) {
        parent.children.splice(k + 1, 0, ...content)
        this.row = parent
        this.idx = k + 1
      } else {
        parent.children.splice(k, 1, ...content)
        this.row = parent
        this.idx = k
      }
      return
    }
    const before: Node[] = []
    for (const s of slots) {
      if (s === row) break
      before.push(...s.children)
    }
    const content: Node[] = []
    for (const s of slots) content.push(...s.children)
    parent.children.splice(k, 1, ...content)
    this.row = parent
    this.idx = k + before.length
  }

  // ---- movement
  moveLeft(select = false): void {
    this.commitCmdIfAny()
    if (select) {
      const a = this.anchor || [this.row, this.idx]
      if (this.idx > 0) this.idx -= 1
      else if (this.row.owner !== null) this.before(this.row.owner)
      this.setSelection(a[0], a[1], this.row, this.idx)
      return
    }
    if (this.hasSelection()) {
      this.idx = this.selection()![1]
      this.anchor = null
      return
    }
    this.anchor = null
    if (this.idx > 0) {
      const slots = this.row.children[this.idx - 1]!.slots()
      if (slots.length) this.enterEnd(slots[slots.length - 1]!)
      else this.idx -= 1
      return
    }
    const owner = this.row.owner
    if (owner === null) return
    const slots = owner.slots()
    const k = indexOf(slots, this.row)
    if (k > 0 && !(owner instanceof Scripts)) this.enterEnd(slots[k - 1]!)
    else this.before(owner)
  }

  moveRight(select = false): void {
    this.commitCmdIfAny()
    if (select) {
      const a = this.anchor || [this.row, this.idx]
      if (this.idx < this.row.children.length) this.idx += 1
      else if (this.row.owner !== null) this.after(this.row.owner)
      this.setSelection(a[0], a[1], this.row, this.idx)
      return
    }
    if (this.hasSelection()) {
      this.idx = this.selection()![2]
      this.anchor = null
      return
    }
    this.anchor = null
    if (this.idx < this.row.children.length) {
      const slots = this.row.children[this.idx]!.slots()
      if (slots.length) this.enterStart(slots[0]!)
      else this.idx += 1
      return
    }
    const owner = this.row.owner
    if (owner === null) return
    const slots = owner.slots()
    const k = indexOf(slots, this.row)
    if (k < slots.length - 1 && !(owner instanceof Scripts)) this.enterStart(slots[k + 1]!)
    else this.after(owner)
  }

  home(select = false): void { this.jump(0, select) }
  end(select = false): void { this.jump(this.row.children.length, select) }

  private jump(idx: number, select: boolean): void {
    this.commitCmdIfAny()
    const a = this.anchor || [this.row, this.idx]
    this.idx = idx
    if (select) this.anchor = a[0] === this.row ? a : [this.row, a[1]]
    else this.anchor = null
  }

  // Move to the slot above/below (numerator/denominator, sup/sub, limits,
  // matrix rows). Returns false when there is none.
  moveVertical(up: boolean): boolean {
    this.commitCmdIfAny()
    this.anchor = null
    let row = this.row
    let fracIdx = this.idx
    while (row.owner !== null) {
      const o = row.owner
      let target: Row | null = null
      if (o instanceof Frac) {
        if (up && row === o.den) target = o.num
        else if (!up && row === o.num) target = o.den
      } else if (o instanceof Scripts) {
        if (up && row === o.sub && o.sup !== null) target = o.sup
        else if (!up && row === o.sup && o.sub !== null) target = o.sub
      } else if (o instanceof BigOp) {
        if (up && row === o.lower && o.upper !== null) target = o.upper
        else if (!up && row === o.upper && o.lower !== null) target = o.lower
      } else if (o instanceof Matrix) {
        for (let ri = 0; ri < o.rows.length; ri++) {
          const r = o.rows[ri]!
          for (let ci = 0; ci < r.length; ci++) {
            if (r[ci] === row) {
              const rj = up ? ri - 1 : ri + 1
              if (rj >= 0 && rj < o.rows.length) target = o.rows[rj]![ci]!
            }
          }
        }
      } else if (o instanceof Sqrt && o.index !== null) {
        if (up && row === o.body) target = o.index
        else if (!up && row === o.index) target = o.body
      }
      if (target !== null) {
        this.row = target
        this.idx = Math.min(fracIdx, target.children.length)
        return true
      }
      fracIdx = indexOf(o.parent!.children, o)
      row = o.parent!
    }
    // From the base row, step into an adjacent structure's slot.
    const ch = this.row.children
    for (const n of [this.idx < ch.length ? ch[this.idx]! : null, this.idx ? ch[this.idx - 1]! : null]) {
      if (n instanceof Frac) {
        this.enterStart(up ? n.num : n.den)
        return true
      }
      if (n instanceof Scripts) {
        const r = up ? n.sup : n.sub
        if (r !== null) {
          this.enterStart(r)
          return true
        }
      }
    }
    return false
  }

  // Tab: jump to the next empty slot (wrapping); when every slot is
  // filled, step out of the current structure.
  nextSlot(forward = true): void {
    this.commitCmdIfAny()
    this.anchor = null
    const stops = emptyStops(this.root)
    if (stops.length) {
      const here = this.orderKey(this.row, this.idx)
      const keys = stops.map(([r, i]) => [this.orderKey(r, i), r, i] as const)
      keys.sort((a, b) => cmpTuple(a[0], b[0]))
      let pick
      if (forward) {
        const later = keys.filter(k => cmpTuple(k[0], here) > 0)
        pick = later.length ? later[0]! : keys[0]!
      } else {
        const earlier = keys.filter(k => cmpTuple(k[0], here) < 0)
        pick = earlier.length ? earlier[earlier.length - 1]! : keys[keys.length - 1]!
      }
      this.row = pick[1]
      this.idx = pick[2]
      return
    }
    const owner = this.row.owner
    if (owner === null) return
    const slots = owner.slots()
    const k = indexOf(slots, this.row)
    if (forward && k < slots.length - 1) this.enterStart(slots[k + 1]!)
    else if (!forward && k > 0) this.enterEnd(slots[k - 1]!)
    else if (forward) this.after(owner)
    else this.before(owner)
  }

  private orderKey(row: Row, idx: number): number[] {
    const key: [number, number][] = []
    let r = row
    while (r.owner !== null) {
      const o = r.owner
      key.push([indexOf(o.parent!.children, o), indexOf(o.slots(), r)])
      r = o.parent!
    }
    const flat: number[] = []
    for (const [ni, si] of key.reverse()) flat.push(ni, si)
    return [...flat, idx]
  }

  // ---- matrices
  private enclosingMatrixRow(): Row | null {
    let row = this.row
    while (row.owner !== null && !(row.owner instanceof Matrix)) row = row.owner.parent!
    return row.owner instanceof Matrix ? row : null
  }

  matrixAddRow(): boolean {
    const row = this.enclosingMatrixRow()
    if (row === null) return false
    const m = row.owner as Matrix
    this.pushUndo()
    const ri = m.rows.findIndex(r => r.some(c => c === row))
    const fresh = Array.from({ length: m.ncols() }, () => new Row())
    m.rows.splice(ri + 1, 0, fresh)
    this.changed()
    this.enterStart(fresh[0]!)
    return true
  }

  matrixAddCol(): boolean {
    const row = this.enclosingMatrixRow()
    if (row === null) return false
    const m = row.owner as Matrix
    this.pushUndo()
    let ci = 0
    for (const r of m.rows) r.forEach((c, j) => { if (c === row) ci = j })
    for (const r of m.rows) r.splice(ci + 1, 0, new Row())
    this.changed()
    this.enterStart(m.rows.find(r => r.some(c => c === row))![ci + 1]!)
    return true
  }

  // ---- clipboard helpers
  selectionLatex(): string {
    const nodes = this.selectedNodes()
    return nodes.length ? toLatex(new Row(nodes)) : ''
  }

  pasteLatex(latex: string): void {
    const nodes = [...parseLatex(latex).children]
    this.commitCmdIfAny()
    this.pushUndo()
    this.takeSelection()
    this.insert(nodes)
    this.changed()
  }
}

// First empty slot Row (or Placeholder) within nodes.
function firstEmpty(nodes: Node[]): Row | Placeholder | null {
  for (const n of nodes) {
    if (n instanceof Placeholder) return n
    for (const s of n.slots()) {
      if (!s.children.length) return s
      const hit = firstEmpty(s.children)
      if (hit !== null) return hit
    }
  }
  return null
}

function emptyStops(root: Row): [Row, number][] {
  const out: [Row, number][] = []
  for (const r of walkRows(root)) {
    if (r !== root && !r.children.length) out.push([r, 0])
    r.children.forEach((n, i) => { if (n instanceof Placeholder) out.push([r, i]) })
  }
  return out
}

export function countEmpty(root: Row): number {
  return emptyStops(root).length
}

