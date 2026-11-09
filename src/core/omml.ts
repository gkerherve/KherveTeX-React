// Word equations (Office Math, OMML) to LaTeX, for the .docx importer: a
// port of khervedoc/omml.py.
//
// A Word equation is an <m:oMath> tree: runs of text (<m:r>/<m:t>) and
// structures (fraction <m:f>, scripts <m:sSub>/<m:sSup>, radical <m:rad>,
// delimiters <m:d>, n-ary operators <m:nary>, functions <m:func>, accents,
// matrices...). Each structure becomes its LaTeX; text becomes LaTeX math
// with Greek letters and operators as their commands. An element this does
// not know contributes its children, so nothing typed is lost.
import { isElement, lxmlText, type XElement } from './docxPackage.ts'
import { strip } from './py.ts'
import { escapeText } from './serializer.ts'

export const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Unicode characters to their LaTeX math commands.
const SYMBOLS: Record<string, string> = {
  // Greek
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'ε': '\\epsilon', 'ϵ': '\\epsilon', 'ζ': '\\zeta', 'η': '\\eta',
  'θ': '\\theta', 'ϑ': '\\vartheta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'µ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi',
  'π': '\\pi', 'ϖ': '\\varpi', 'ρ': '\\rho', 'ϱ': '\\varrho',
  'σ': '\\sigma', 'ς': '\\varsigma', 'τ': '\\tau', 'υ': '\\upsilon',
  'φ': '\\phi', 'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda',
  'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon',
  'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  // operators and relations
  '×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '·': '\\cdot',
  '⋅': '\\cdot', '∙': '\\bullet', '•': '\\bullet', '∘': '\\circ',
  '∗': '*', '−': '-', '–': '-', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq',
  '≈': '\\approx', '≅': '\\cong', '≃': '\\simeq', '∼': '\\sim',
  '≡': '\\equiv', '∝': '\\propto', '≪': '\\ll', '≫': '\\gg',
  '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset',
  '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup',
  '∩': '\\cap', '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists',
  '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee', '⊥': '\\perp',
  '∥': '\\parallel', '∠': '\\angle', '∞': '\\infty', '∂': '\\partial',
  '∇': '\\nabla', 'ℏ': '\\hbar', 'ħ': '\\hbar', 'ℓ': '\\ell',
  'ℜ': '\\Re', 'ℑ': '\\Im', '℘': '\\wp', 'ℵ': '\\aleph', '…': '\\ldots',
  '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots', '°': '^{\\circ}',
  '′': "'", '″': "''", '‴': "'''", '√': '\\surd', '∑': '\\sum',
  '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
  '∮': '\\oint', '⟨': '\\langle', '⟩': '\\rangle', '‖': '\\|',
  '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor',
  // arrows
  '→': '\\rightarrow', '←': '\\leftarrow', '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
  '↑': '\\uparrow', '↓': '\\downarrow', '⟶': '\\longrightarrow',
  '⟵': '\\longleftarrow', '⟷': '\\longleftrightarrow', '↦': '\\mapsto',
  '⇌': '\\rightleftharpoons', '⇋': '\\leftrightharpoons',
  '⇀': '\\rightharpoonup', '↽': '\\leftharpoondown',
  // characters TeX reserves
  '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '$': '\\$',
  '&': '\\&', '_': '\\_', '\\': '\\backslash', '~': '\\sim',
  '^': '\\wedge',
}

// Dropped: function application, invisible times/separator, zero widths.
const INVISIBLE = new Set(['⁡', '⁢', '⁣', '⁤', '​', '‌', '‍', '﻿'])

// Function names LaTeX has a command for.
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'lg', 'exp', 'det', 'dim',
  'ker', 'max', 'min', 'sup', 'inf', 'lim', 'liminf', 'limsup', 'gcd',
  'deg', 'arg', 'hom', 'Pr',
])

const NARY: Record<string, string> = {
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int',
  '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup',
  '⋂': '\\bigcap', '⋁': '\\bigvee', '⋀': '\\bigwedge',
  '⨁': '\\bigoplus', '⨂': '\\bigotimes',
}

const ACCENTS: Record<string, string> = {
  '̂': '\\hat', '̃': '\\tilde', '̄': '\\bar',
  '̅': '\\bar', '̇': '\\dot', '̈': '\\ddot',
  '⃗': '\\vec', '⃑': '\\vec', '́': '\\acute',
  '̀': '\\grave', '̌': '\\check', '̆': '\\breve',
  '^': '\\hat', '~': '\\tilde', '¯': '\\bar', '→': '\\vec',
}

const DELIMS: Record<string, string> = {
  '(': '(', ')': ')', '[': '[', ']': ']', '{': '\\{', '}': '\\}',
  '|': '|', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle',
  '〈': '\\langle', '〉': '\\rangle', '⌈': '\\lceil', '⌉': '\\rceil',
  '⌊': '\\lfloor', '⌋': '\\rfloor', '/': '/', '': '.',
}

const own = (o: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(o, k)

// A trailing "(1)" typed after a display equation: its number.
const NUMBER_RE = /(?:\\\s|\s)*\(\s*\d+[a-z]?\s*\)\s*$/
// The same typed as text beside the equation, after a tab.
export const TAG_RE = /^\s*\(\s*\d+[a-z]?\s*\)\s*$/

// The element children (lxml also yields comments, whose tag is not a
// string: they convert to nothing).
function kids(el: XElement): XElement[] {
  const out: XElement[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) if (isElement(n)) out.push(n)
  return out
}

const local = (el: XElement) => el.localName ?? ''
const ns = (el: XElement) => el.namespaceURI ?? ''

// The first m:name child of el, or null.
function m(el: XElement | null, name: string): XElement | null {
  if (el === null) return null
  for (const c of kids(el)) if (ns(c) === M_NS && local(c) === name) return c
  return null
}

function attrVal(el: XElement): string | null {
  const attrs = el.attributes
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs.item(i)!
    if ((a.namespaceURI ?? null) === M_NS && (a.localName ?? a.name) === 'val') return a.value
  }
  return null
}

// m:val of the m:name child of the properties element el.
function val(el: XElement | null, name: string, def: string | null = null): string | null {
  const c = m(el, name)
  if (c === null) return def
  const v = attrVal(c)
  return v === null ? def : v
}

// A boolean property: present without val, or val 1/on/true.
function on(el: XElement, name: string): boolean {
  const c = m(el, name)
  if (c === null) return false
  const v = attrVal(c)
  return v === null || ['1', 'on', 'true'].includes(v)
}

const textOf = (el: XElement) => lxmlText(el) ?? ''

// Text of a math run as LaTeX math.
export function mathText(s: string): string {
  const out: string[] = []
  for (let ch of s) {
    if (INVISIBLE.has(ch)) continue
    if (ch === ' ') ch = ' '
    if (!own(SYMBOLS, ch) && ch.codePointAt(0)! >= 0x1D400) {
      // Mathematical alphanumerics (𝑥, 𝛿): their plain letter.
      ch = ch.normalize('NFKC')
    }
    const cmd = own(SYMBOLS, ch) ? SYMBOLS[ch] : undefined
    if (cmd === undefined) out.push(ch)
    // A control word takes a space so a letter after it stays apart.
    else if (/\\[A-Za-z]+$/.test(cmd)) out.push(cmd + ' ')
    else out.push(cmd)
  }
  return out.join('')
}

// Text of a normal-text run, for \text{}.
function textMode(s: string): string {
  return escapeText([...s].filter((c) => !INVISIBLE.has(c)).join(''))
}

// An m:r: its text, upright (\mathrm) when styled plain, as text (\text)
// when marked normal text.
function run(r: XElement, eqArr: boolean): string {
  const text = kids(r).filter((t) => local(t) === 't' && [M_NS, W_NS].includes(ns(t))).map(textOf).join('')
  if (!text) return ''
  const rpr = m(r, 'rPr')
  if (rpr !== null && on(rpr, 'nor')) return `\\text{${textMode(text)}}`
  let body = mathText(text)
  if (eqArr) body = body.replaceAll('\\&', '&')
  const sty = rpr !== null ? val(rpr, 'sty') : null
  if ((sty === 'p' || sty === 'b') && /[A-Za-z]/.test(text)) {
    const cmd = sty === 'p' ? '\\mathrm' : '\\mathbf'
    // Keep spaces and operators outside: \mathrm{SrO} + ...
    const mm = /^(\s*)([\s\S]*?)(\s*)$/.exec(body)!
    const [lead, core, tail] = [mm[1], mm[2], mm[3]]
    return strip(core) ? `${lead}${cmd}{${strip(core)}}${tail}` : body
  }
  return body
}

// The LaTeX of a container (m:e, m:num, m:sub...): its children.
function arg(el: XElement | null, eqArr = false): string {
  if (el === null) return ''
  return strip(kids(el).map((c) => node(c, eqArr)).join(''))
}

// s as one TeX argument for a script base.
function group(s: string): string {
  return /^(?:[A-Za-z0-9]|\\[A-Za-z]+\s*)$/.test(s) ? s : `{${s}}`
}

const plainName = (s: string) => s.replace(/\\mathrm\{([A-Za-z]+)\}/g, '$1')

// One OMML element as LaTeX.
function node(el: XElement, eqArr = false): string {
  const n = ns(el), name = local(el)
  if (n === W_NS) {
    if (name === 'r') return mathText(kids(el).filter((t) => local(t) === 't').map(textOf).join(''))
    return ''
  }
  if (n !== M_NS || name.endsWith('Pr')) return ''
  switch (name) {
    case 'r': return run(el, eqArr)
    case 'f': {
      const kind = val(m(el, 'fPr'), 'type', 'bar')
      const num = arg(m(el, 'num')), den = arg(m(el, 'den'))
      if (kind === 'lin' || kind === 'skw') return `${group(num)}/${group(den)}`
      if (kind === 'noBar') return `\\genfrac{}{}{0pt}{}{${num}}{${den}}`
      return `\\frac{${num}}{${den}}`
    }
    case 'sSup': return `${group(arg(m(el, 'e')))}^{${arg(m(el, 'sup'))}}`
    case 'sSub': return `${group(arg(m(el, 'e')))}_{${arg(m(el, 'sub'))}}`
    case 'sSubSup':
      return `${group(arg(m(el, 'e')))}_{${arg(m(el, 'sub'))}}^{${arg(m(el, 'sup'))}}`
    case 'sPre':
      return `{}_{${arg(m(el, 'sub'))}}^{${arg(m(el, 'sup'))}}${group(arg(m(el, 'e')))}`
    case 'rad': {
      const pr = m(el, 'radPr')
      const deg = arg(m(el, 'deg'))
      const e = arg(m(el, 'e'))
      if (deg && !(pr !== null && on(pr, 'degHide'))) return `\\sqrt[${deg}]{${e}}`
      return `\\sqrt{${e}}`
    }
    case 'd': {
      const pr = m(el, 'dPr')
      const beg = val(pr, 'begChr', '(')!
      const end = val(pr, 'endChr', ')')!
      const sep = val(pr, 'sepChr', '|')!
      const parts = kids(el).filter((c) => ns(c) === M_NS && local(c) === 'e').map((c) => arg(c))
      const sepTex = own(DELIMS, sep) ? DELIMS[sep] : strip(mathText(sep))
      const inner = sepTex !== '.' ? parts.join(` \\middle${sepTex} `) : parts.join('')
      // A bracket \left cannot take (⟦) is drawn as itself inside an
      // invisible one.
      let left = own(DELIMS, beg) ? DELIMS[beg] : null
      let right = own(DELIMS, end) ? DELIMS[end] : null
      let body = inner
      if (left === null) { body = strip(mathText(beg)) + body; left = '.' }
      if (right === null) { body = body + strip(mathText(end)); right = '.' }
      return `\\left${left}${body}\\right${right}`
    }
    case 'nary': {
      const pr = m(el, 'naryPr')
      const ch = val(pr, 'chr', '∫')!
      const op = own(NARY, ch) ? NARY[ch] : strip(mathText(ch))
      let sub = arg(m(el, 'sub')), sup = arg(m(el, 'sup'))
      if (pr !== null && on(pr, 'subHide')) sub = ''
      if (pr !== null && on(pr, 'supHide')) sup = ''
      const limits = (sub ? `_{${sub}}` : '') + (sup ? `^{${sup}}` : '')
      return `${op}${limits}{${arg(m(el, 'e'))}}`
    }
    case 'func': {
      let fname = strip(arg(m(el, 'fName')))
      const plain = plainName(fname)
      if (FUNCTIONS.has(plain)) fname = `\\${plain}`
      else if (/^[A-Za-z]+$/.test(plain)) fname = `\\operatorname{${plain}}`
      return `${fname}{${arg(m(el, 'e'))}}`
    }
    case 'acc': {
      const ch = val(m(el, 'accPr'), 'chr', '̂')!
      return `${own(ACCENTS, ch) ? ACCENTS[ch] : '\\hat'}{${arg(m(el, 'e'))}}`
    }
    case 'bar': {
      const pos = val(m(el, 'barPr'), 'pos', 'bot')
      return `${pos === 'top' ? '\\overline' : '\\underline'}{${arg(m(el, 'e'))}}`
    }
    case 'groupChr': {
      const pr = m(el, 'groupChrPr')
      const ch = val(pr, 'chr', '⏟')!
      const pos = val(pr, 'pos', 'bot')
      const e = arg(m(el, 'e'))
      if (ch === '⏟') return `\\underbrace{${e}}`
      if (ch === '⏞') return `\\overbrace{${e}}`
      if (ch === '→' || ch === '⟶') return pos === 'bot' ? `\\xrightarrow{${e}}` : `\\xrightarrow[${e}]{}`
      if (ch === '←' || ch === '⟵') return pos === 'bot' ? `\\xleftarrow{${e}}` : `\\xleftarrow[${e}]{}`
      const sym = strip(own(SYMBOLS, ch) ? SYMBOLS[ch] : mathText(ch))
      return pos === 'bot' ? `\\overset{${e}}{${sym}}` : `\\underset{${e}}{${sym}}`
    }
    case 'limLow':
    case 'limUpp': {
      const e = arg(m(el, 'e')), lim = arg(m(el, 'lim'))
      const plain = strip(plainName(e))
      if (name === 'limLow' && FUNCTIONS.has(plain)) return `\\${plain}_{${lim}}`
      return `${name === 'limLow' ? '\\underset' : '\\overset'}{${lim}}{${e}}`
    }
    case 'borderBox': return `\\boxed{${arg(m(el, 'e'))}}`
    case 'm': {
      const rows: string[] = []
      for (const mr of kids(el)) {
        if (ns(mr) === M_NS && local(mr) === 'mr') {
          rows.push(kids(mr).filter((c) => ns(c) === M_NS && local(c) === 'e').map((c) => arg(c)).join(' & '))
        }
      }
      return '\\begin{matrix}' + rows.join(' \\\\ ') + '\\end{matrix}'
    }
    case 'eqArr': {
      const rows = kids(el).filter((c) => ns(c) === M_NS && local(c) === 'e').map((c) => arg(c, true))
      return '\\begin{aligned}' + rows.join(' \\\\ ') + '\\end{aligned}'
    }
    case 't': return mathText(textOf(el))
  }
  // m:box, m:phant, m:e, m:oMath and anything unknown: the children.
  return kids(el).map((c) => node(c, eqArr)).join('')
}

// An <m:oMath> (or any OMML element) as LaTeX math.
export function ommlToLatex(omath: XElement): string {
  return strip(node(omath).replace(/[ \t\r\n]+/g, ' '))
}

// A display equation's LaTeX without the "(1)" typed after it, and whether
// it had one.
export function splitNumber(latex: string): [string, boolean] {
  const mm = NUMBER_RE.exec(latex)
  if (mm && mm.index > 0) return [latex.slice(0, mm.index).replace(/\s+$/, ''), true]
  return [latex, false]
}
