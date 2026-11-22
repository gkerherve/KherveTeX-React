// LaTeX math to Word equations (Office Math, OMML), for the .docx export:
// the reverse of omml.ts. Word then shows a real equation the reader can
// edit, not the LaTeX source.
//
// The parser reads TeX math the way authors write it: groups, ^ and _,
// \frac, \sqrt, \left...\right, accents, fonts (\mathrm, \mathbf,
// \mathbb...), \text, n-ary operators with limits, functions, matrices,
// cases and aligned rows. A command it does not know is kept as its name,
// so nothing typed is lost.
import { ACCENTS, FUNCTIONS, NARY, SYMBOLS } from './omml.ts'

// ---- symbol tables --------------------------------------------------------

// \command -> its character, from the importer's table and the LaTeX names
// it does not use.
const CHAR: Record<string, string> = {}
for (const [ch, cmd] of Object.entries(SYMBOLS)) {
  if (/^\\[A-Za-z]+$/.test(cmd) && !(cmd.slice(1) in CHAR)) CHAR[cmd.slice(1)] = ch
}
Object.assign(CHAR, {
  epsilon: 'ϵ', varepsilon: 'ε', phi: 'ϕ', varphi: 'φ', theta: 'θ', vartheta: 'ϑ',
  le: '≤', ge: '≥', ne: '≠', leq: '≤', geq: '≥', neq: '≠', to: '→', gets: '←',
  implies: '⟹', iff: '⟺', lbrace: '{', rbrace: '}', vert: '|', Vert: '‖', mid: '∣',
  lvert: '|', rvert: '|', lVert: '‖', rVert: '‖', dots: '…', dotsc: '…', dotsb: '⋯',
  degree: '°', prime: '′', AA: 'Å', ohm: 'Ω', setminus: '∖', star: '⋆', ast: '∗',
  oplus: '⊕', otimes: '⊗', odot: '⊙', dagger: '†', ddagger: '‡', top: '⊤',
  bot: '⊥', models: '⊨', vdash: '⊢', leftrightharpoons: '⇋', rightleftharpoons: '⇌',
  longrightarrow: '⟶', longleftarrow: '⟵', Longrightarrow: '⟹', mapsto: '↦',
  approx: '≈', sim: '∼', simeq: '≃', cong: '≅', equiv: '≡', propto: '∝',
  times: '×', cdot: '⋅', pm: '±', mp: '∓', div: '÷', circ: '∘', bullet: '∙',
  infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', ell: 'ℓ', emptyset: '∅',
  varnothing: '∅', neg: '¬', lnot: '¬', land: '∧', lor: '∨', angle: '∠',
  triangle: '△', square: '□', checkmark: '✓', colon: ':', ldotp: '.', cdotp: '⋅',
  dag: '†', S: '§', P: '¶', textdegree: '°', micro: 'µ', perthousand: '‰',
})
// Escaped characters: \{ \} \% \$ \# \& \_ \|.
const ESCAPED: Record<string, string> = { '{': '{', '}': '}', '%': '%', '$': '$', '#': '#', '&': '&', '_': '_', '|': '‖' }
// Spacing commands.
const SPACES: Record<string, string> = { ',': ' ', ':': ' ', ';': ' ', '>': ' ', ' ': ' ', quad: ' ', qquad: '  ', enspace: ' ', thinspace: ' ', '!': '' }

const NARY_CHAR: Record<string, string> = {}
for (const [ch, cmd] of Object.entries(NARY)) NARY_CHAR[cmd.slice(1)] = ch
// The accent's combining character, by its command.
const ACCENT_CHAR: Record<string, string> = { widehat: '̂', widetilde: '̃', overrightarrow: '⃗', mathring: '̊' }
for (const [ch, cmd] of Object.entries(ACCENTS)) {
  if (ch.length === 1 && ch.charCodeAt(0) >= 0x300 && !(cmd.slice(1) in ACCENT_CHAR)) ACCENT_CHAR[cmd.slice(1)] = ch
}
// Functions whose subscript goes underneath (\lim_{x\to 0}).
const LIMIT_FUNCS = new Set(['lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'Pr', 'arg'])
// Delimiters after \left, \right, \big...
const DELIM: Record<string, string> = {
  langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}', '{': '{', '}': '}', '|': '‖',
  vert: '|', Vert: '‖', lvert: '|', rvert: '|', lVert: '‖', rVert: '‖', lceil: '⌈', rceil: '⌉',
  lfloor: '⌊', rfloor: '⌋', lbrack: '[', rbrack: ']', backslash: '\\', uparrow: '↑', downarrow: '↓',
}
const SIZES = new Set(['big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr', 'bigm', 'Bigm'])
// Font commands: the run style they give.
const FONTS: Record<string, Style> = {
  mathrm: { sty: 'p' }, mathup: { sty: 'p' }, rm: { sty: 'p' }, mathbf: { sty: 'b' }, bf: { sty: 'b' },
  mathit: { sty: 'i' }, it: { sty: 'i' }, boldsymbol: { sty: 'bi' }, bm: { sty: 'bi' },
  mathcal: { scr: 'script' }, mathscr: { scr: 'script' }, mathbb: { scr: 'double-struck' },
  mathfrak: { scr: 'fraktur' }, mathsf: { scr: 'sans-serif', sty: 'p' }, mathtt: { scr: 'monospace', sty: 'p' },
  operatorname: { sty: 'p' },
}
// What sits between the two sides of an equation: an n-ary operator's
// argument stops there.
const RELATIONS = new Set(['=', '<', '>', '≤', '≥', '≠', '≈', '≡', '∼', '≃', '≅', '∝', '→', '←', '⇒', '⇔', '⟹', '⟺', '∈', '⊂', '⊆', '≪', '≫'])
// Commands with an argument that prints nothing.
const SKIP_ARG = new Set(['label', 'tag', 'hspace', 'vspace', 'phantom', 'hphantom', 'vphantom', 'color'])
const IGNORE = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'nonumber', 'notag',
  'left.', 'right.', 'middle', 'not', 'allowbreak', 'nobreak', 'strut', 'relax'])

interface Style { sty?: 'p' | 'b' | 'i' | 'bi'; scr?: string; nor?: boolean }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const wrap = (tag: string, inner: string) => (inner ? `<m:${tag}>${inner}</m:${tag}>` : `<m:${tag}/>`)
const prop = (name: string, v: string) => `<m:${name} m:val="${esc(v)}"/>`

// One piece of a row: a run (merged with its neighbours of the same style)
// or a structure.
interface Item { xml: string; text?: string; style?: Style; rel?: boolean }

function runXml(text: string, style: Style = {}): string {
  let pr = ''
  if (style.nor) pr += '<m:nor/>'
  if (style.scr) pr += prop('scr', style.scr)
  if (style.sty) pr += prop('sty', style.sty)
  const t = /^\s|\s$/.test(text) ? `<m:t xml:space="preserve">${esc(text)}</m:t>` : `<m:t>${esc(text)}</m:t>`
  return `<m:r>${pr ? `<m:rPr>${pr}</m:rPr>` : ''}${t}</m:r>`
}

const styleKey = (s: Style = {}) => `${s.sty ?? ''}|${s.scr ?? ''}|${s.nor ? 1 : 0}`

function joinItems(items: Item[]): string {
  let out = ''
  let text: string | null = null
  let style: Style | undefined
  const flush = () => { if (text !== null) out += runXml(text, style); text = null }
  for (const it of items) {
    if (it.text !== undefined) {
      if (text !== null && styleKey(style) === styleKey(it.style)) text += it.text
      else { flush(); text = it.text; style = it.style }
    } else {
      flush()
      out += it.xml
    }
  }
  flush()
  return out
}

class Parser {
  i = 0
  style: Style = {}
  eqArr = false
  s: string
  constructor(s: string) { this.s = s }

  private skipSpace(): void {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
      if (this.s[this.i] === '%') {
        while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++
      } else return
    }
  }

  // The next token without taking it: "\name", "\\", "\," or one character.
  peek(): string | null {
    this.skipSpace()
    if (this.i >= this.s.length) return null
    const c = this.s[this.i]
    if (c !== '\\') return String.fromCodePoint(this.s.codePointAt(this.i)!)
    const m = /^\\([A-Za-z]+|.)/s.exec(this.s.slice(this.i))
    return m ? m[0] : '\\'
  }

  next(): string | null {
    const t = this.peek()
    if (t !== null) this.i += t.length
    return t
  }

  // The text of a {...} group as written (for \text, \ce, \label).
  rawGroup(): string {
    this.skipSpace()
    if (this.s[this.i] !== '{') {
      const t = this.next()
      return t ?? ''
    }
    let depth = 0
    const start = this.i + 1
    for (; this.i < this.s.length; this.i++) {
      const c = this.s[this.i]
      if (c === '\\') { this.i++; continue }
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) { this.i++; return this.s.slice(start, this.i - 1) }
    }
    return this.s.slice(start)
  }

  // [...] after a command, or null.
  optional(): string | null {
    this.skipSpace()
    if (this.s[this.i] !== '[') return null
    const end = this.s.indexOf(']', this.i)
    if (end < 0) return null
    const inner = this.s.slice(this.i + 1, end)
    this.i = end + 1
    return inner
  }

  // Items up to a token `stop` accepts (not taken) or the end.
  row(stop: (t: string) => boolean): Item[] {
    const items: Item[] = []
    for (;;) {
      const t = this.peek()
      if (t === null || stop(t)) return items
      items.push(...this.atom(stop))
    }
  }

  // One argument: a group, or a single token.
  arg(): string {
    const t = this.peek()
    if (t === null) return ''
    if (t === '{') {
      this.next()
      const items = this.row((x) => x === '}')
      this.next()
      return joinItems(items)
    }
    return joinItems(this.atom(() => false, true))
  }

  // The argument parsed with a font style.
  styledArg(style: Style): string {
    const saved = this.style
    this.style = { ...saved, ...style }
    try { return this.arg() } finally { this.style = saved }
  }

  private char(text: string, rel = false): Item {
    return { xml: '', text, style: Object.keys(this.style).length ? this.style : undefined, rel }
  }

  // One atom and the scripts after it. `stop` is the enclosing row's (an
  // n-ary operator's argument runs to it). `bare`: a script's one-token
  // argument, which leaves the scripts after it to the base (x_i^2).
  atom(stop: (t: string) => boolean, bare = false): Item[] {
    const t = this.next()!
    let base: Item | null = null
    let nary: string | null = null
    let func: string | null = null
    if (t === '{') {
      const items = this.row((x) => x === '}')
      this.next()
      base = { xml: joinItems(items) }
      if (bare || !this.scriptNext()) return items
    } else if (t === '^' || t === '_') {
      // A script with nothing before it: on an empty base.
      this.i -= 1
      base = { xml: '' }
    } else if (t === '}') {
      return []
    } else if (t === '&') {
      return [this.eqArr ? { xml: runXml('&') } : this.char(' ')]
    } else if (t === '\\\\') {
      return []
    } else if (t === "'") {
      base = this.char('′')
    } else if (t === '~') {
      base = this.char(' ')
    } else if (t === '-') {
      base = this.char('−')
    } else if (t.startsWith('\\')) {
      const name = t.slice(1)
      if (name in NARY_CHAR) nary = NARY_CHAR[name]
      else if (FUNCTIONS.has(name)) func = name
      else {
        const items = this.command(name, stop)
        if (items === null) return []
        if (bare || !this.scriptNext() || items.length !== 1) return items
        base = items[0]
      }
    } else {
      base = this.char(t, RELATIONS.has(t))
    }

    if (nary !== null) return [this.nary(nary, stop)]
    if (func !== null) return [this.func(this.funcName(func), func, stop)]
    return [bare ? base! : this.scripts(base!)]
  }

  scriptNext(): boolean {
    const t = this.peek()
    return t === '^' || t === '_'
  }

  // base^{...}_{...}
  scripts(base: Item): Item {
    let sub: string | null = null
    let sup: string | null = null
    while (this.scriptNext()) {
      const t = this.next()
      if (t === '^') {
        if (this.peek() === "'") { this.next(); sup = (sup ?? '') + runXml('′') } else sup = this.arg()
      } else sub = this.arg()
    }
    if (sub === null && sup === null) return base
    const e = wrap('e', base.text !== undefined ? runXml(base.text, base.style) : base.xml)
    if (sub !== null && sup !== null) return { xml: `<m:sSubSup>${e}${wrap('sub', sub)}${wrap('sup', sup)}</m:sSubSup>` }
    if (sup !== null) return { xml: `<m:sSup>${e}${wrap('sup', sup)}</m:sSup>` }
    return { xml: `<m:sSub>${e}${wrap('sub', sub!)}</m:sSub>` }
  }

  // \sum_{i=1}^{n} x_i: the operator, its limits and what it applies to,
  // up to the next relation (=) or the end of the row.
  nary(ch: string, stop: (t: string) => boolean): Item {
    let sub = '', sup = ''
    let hasSub = false, hasSup = false
    for (;;) {
      const t = this.peek()
      if (t === '\\limits' || t === '\\nolimits') { this.next(); continue }
      if (t === '_') { this.next(); sub = this.arg(); hasSub = true } else if (t === '^') { this.next(); sup = this.arg(); hasSup = true } else break
    }
    const items: Item[] = []
    for (;;) {
      const t = this.peek()
      if (t === null || stop(t) || t === '&' || t === '\\\\') break
      const save = this.i
      const got = this.atom(stop)
      if (got.length === 1 && got[0].rel) { this.i = save; break }
      items.push(...got)
    }
    let pr = prop('chr', ch)
    if (!hasSub) pr += prop('subHide', '1')
    if (!hasSup) pr += prop('supHide', '1')
    return { xml: `<m:nary><m:naryPr>${pr}</m:naryPr>${wrap('sub', sub)}${wrap('sup', sup)}${wrap('e', joinItems(items))}</m:nary>` }
  }

  funcName(name: string): string {
    return runXml(name, { sty: 'p' })
  }

  // \sin x, \lim_{x\to 0} f(x), \log_2 n: the name (with its limit or
  // scripts) and the atom it applies to.
  func(nameXml: string, name: string, stop: (t: string) => boolean): Item {
    let fname = nameXml
    if (this.peek() === '\\limits' || this.peek() === '\\nolimits') this.next()
    if (this.peek() === '_' && LIMIT_FUNCS.has(name)) {
      this.next()
      fname = `<m:limLow>${wrap('e', nameXml)}${wrap('lim', this.arg())}</m:limLow>`
    } else if (this.scriptNext()) {
      fname = this.scripts({ xml: nameXml }).xml
    }
    let e = ''
    const t = this.peek()
    if (t !== null && !stop(t) && t !== '&' && t !== '\\\\' && t !== '^' && t !== '_') {
      const save = this.i
      const got = this.atom(stop)
      if (got.length === 1 && got[0].rel) this.i = save
      else e = joinItems(got)
    }
    return { xml: `<m:func>${wrap('fName', fname)}${wrap('e', e)}</m:func>` }
  }

  // A delimiter character after \left, \right or \big.
  delim(): string {
    const t = this.next()
    if (t === null || t === '.') return ''
    if (t.startsWith('\\')) {
      const n = t.slice(1)
      return DELIM[n] ?? CHAR[n] ?? n
    }
    return t
  }

  // A control word or symbol. null: it printed nothing.
  command(name: string, stop: (t: string) => boolean): Item[] | null {
    if (name in ESCAPED) return [this.char(ESCAPED[name])]
    if (name in SPACES) return SPACES[name] ? [this.char(SPACES[name])] : null
    if (IGNORE.has(name)) return null
    if (SKIP_ARG.has(name)) { this.optional(); this.rawGroup(); return null }
    if (SIZES.has(name)) {
      const d = this.delim()
      return d ? [this.char(d)] : null
    }
    if (name in CHAR) return [this.char(CHAR[name], RELATIONS.has(CHAR[name]))]
    if (name in FONTS) {
      if (name === 'operatorname') return [this.func(runXml(this.rawGroup().replace(/\\,|\s/g, ''), { sty: 'p' }), '', stop)]
      return [{ xml: this.styledArg(FONTS[name]) }]
    }
    switch (name) {
      case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': case 'sfrac': {
        const num = this.arg(), den = this.arg()
        return [{ xml: `<m:f>${name === 'sfrac' ? `<m:fPr>${prop('type', 'skw')}</m:fPr>` : ''}${wrap('num', num)}${wrap('den', den)}</m:f>` }]
      }
      case 'binom': case 'dbinom': case 'tbinom': case 'genfrac': {
        if (name === 'genfrac') { this.rawGroup(); this.rawGroup(); this.rawGroup(); this.rawGroup() }
        const num = this.arg(), den = this.arg()
        const f = `<m:f><m:fPr>${prop('type', 'noBar')}</m:fPr>${wrap('num', num)}${wrap('den', den)}</m:f>`
        return [{ xml: name === 'genfrac' ? f : `<m:d><m:dPr>${prop('begChr', '(')}${prop('endChr', ')')}</m:dPr>${wrap('e', f)}</m:d>` }]
      }
      case 'sqrt': {
        const deg = this.optional()
        const e = this.arg()
        if (deg === null) return [{ xml: `<m:rad><m:radPr>${prop('degHide', '1')}</m:radPr><m:deg/>${wrap('e', e)}</m:rad>` }]
        return [{ xml: `<m:rad>${wrap('deg', latexToOmml(deg))}${wrap('e', e)}</m:rad>` }]
      }
      case 'left': {
        const beg = this.delim()
        const inner = this.row((x) => x === '\\right')
        this.next()
        const end = this.delim()
        return [{ xml: `<m:d><m:dPr>${prop('begChr', beg)}${prop('endChr', end)}</m:dPr>${wrap('e', joinItems(inner))}</m:d>` }]
      }
      case 'right': return null
      case 'text': case 'textrm': case 'mbox': case 'textnormal': case 'mathnormal': case 'hbox':
      case 'textit': case 'textbf': case 'textsf': case 'texttt': case 'textup': {
        const raw = this.rawGroup().replace(/\\([%$#&_{}])/g, '$1').replace(/~/g, ' ').replace(/\\[,;: ]/g, ' ')
        return raw ? [{ xml: runXml(raw, { nor: true }) }] : null
      }
      case 'ce': case 'pu': case 'si': case 'unit': {
        const raw = this.rawGroup().replace(/\\([%$#&_{}])/g, '$1')
        return [{ xml: runXml(raw, { sty: 'p' }) }]
      }
      case 'SI': case 'qty': case 'num': {
        const n = this.rawGroup()
        const u = name === 'num' ? '' : ' ' + this.rawGroup().replace(/\\([a-z]+)/g, '$1')
        return [{ xml: runXml(n + u, { sty: 'p' }) }]
      }
      case 'textcolor': case 'colorbox': { this.rawGroup(); return [{ xml: this.arg() }] }
      case 'cancel': case 'bcancel': case 'xcancel': case 'smash': case 'mathstrut': case 'ensuremath':
        return [{ xml: this.arg() }]
      case 'boxed': case 'fbox': return [{ xml: `<m:borderBox>${wrap('e', this.arg())}</m:borderBox>` }]
      case 'overline': case 'underline':
        return [{ xml: `<m:bar><m:barPr>${prop('pos', name === 'overline' ? 'top' : 'bot')}</m:barPr>${wrap('e', this.arg())}</m:bar>` }]
      case 'overbrace': case 'underbrace': {
        const top = name === 'overbrace'
        const e = this.arg()
        let xml = `<m:groupChr><m:groupChrPr>${prop('chr', top ? '⏞' : '⏟')}${prop('pos', top ? 'top' : 'bot')}${prop('vertJc', top ? 'bot' : 'top')}</m:groupChrPr>${wrap('e', e)}</m:groupChr>`
        const t = this.peek()
        if ((top && t === '^') || (!top && t === '_')) {
          this.next()
          xml = `<m:${top ? 'limUpp' : 'limLow'}>${wrap('e', xml)}${wrap('lim', this.arg())}</m:${top ? 'limUpp' : 'limLow'}>`
        }
        return [{ xml }]
      }
      case 'overset': case 'stackrel': case 'underset': {
        const lim = this.arg(), e = this.arg()
        const tag = name === 'underset' ? 'limLow' : 'limUpp'
        return [{ xml: `<m:${tag}>${wrap('e', e)}${wrap('lim', lim)}</m:${tag}>` }]
      }
      case 'xrightarrow': case 'xleftarrow': {
        const below = this.optional()
        const above = this.arg()
        let xml = runXml(name === 'xrightarrow' ? '→' : '←')
        if (above) xml = `<m:limUpp>${wrap('e', xml)}${wrap('lim', above)}</m:limUpp>`
        if (below) xml = `<m:limLow>${wrap('e', xml)}${wrap('lim', latexToOmml(below))}</m:limLow>`
        return [{ xml, rel: true }]
      }
      case 'pmod': return [{ xml: runXml('(mod ', { sty: 'p' }) + this.arg() + runXml(')', { sty: 'p' }) }]
      case 'bmod': case 'mod': return [{ xml: runXml(' mod ', { sty: 'p' }) }]
      case 'begin': return [this.environment(this.rawGroup())]
      case 'end': this.rawGroup(); return null
    }
    if (name in ACCENT_CHAR) {
      return [{ xml: `<m:acc><m:accPr>${prop('chr', ACCENT_CHAR[name])}</m:accPr>${wrap('e', this.arg())}</m:acc>` }]
    }
    if (/^[A-Za-z]+$/.test(name)) return [{ xml: runXml(`\\${name}`, { sty: 'p' }) }]
    return [this.char(name)]
  }

  // The rows of an environment, each a list of cells.
  cells(eqArr: boolean): string[][] {
    const saved = this.eqArr
    this.eqArr = eqArr
    const rows: string[][] = []
    let row: string[] = []
    const end = (t: string) => t === '&' || t === '\\\\' || t === '\\end'
    for (;;) {
      row.push(joinItems(this.row(end)))
      const t = this.next()
      if (t === '&') continue
      if (t === '\\\\') {
        this.optional()
        rows.push(row)
        row = []
        continue
      }
      if (t === '\\end') this.rawGroup()
      break
    }
    if (row.some(Boolean) || !rows.length) rows.push(row)
    this.eqArr = saved
    return rows
  }

  environment(env: string): Item {
    const name = env.replace(/\*$/, '')
    if (name === 'array' || name === 'alignat' || name === 'alignedat') this.rawGroup()
    if (['align', 'aligned', 'split', 'eqnarray', 'flalign', 'alignat', 'alignedat', 'gather', 'gathered', 'multline'].includes(name)) {
      const rows = this.cells(true)
      const join = (r: string[]) => r.join(runXml('&'))
      if (rows.length === 1) return { xml: name === 'gather' || name === 'gathered' || name === 'multline' ? rows[0].join('') : join(rows[0]) }
      return { xml: `<m:eqArr>${rows.map((r) => wrap('e', name.startsWith('gather') || name === 'multline' ? r.join('') : join(r))).join('')}</m:eqArr>` }
    }
    const rows = this.cells(false)
    const cols = Math.max(...rows.map((r) => r.length))
    const m = `<m:m><m:mPr><m:mcs><m:mc><m:mcPr>${prop('count', String(cols))}${prop('mcJc', name === 'cases' ? 'left' : 'center')}</m:mcPr></m:mc></m:mcs></m:mPr>`
      + rows.map((r) => `<m:mr>${Array.from({ length: cols }, (_, i) => wrap('e', r[i] ?? '')).join('')}</m:mr>`).join('') + '</m:m>'
    const fences: Record<string, [string, string]> = {
      pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'],
      cases: ['{', ''], dcases: ['{', ''], rcases: ['', '}'],
    }
    const f = fences[name]
    if (!f) return { xml: m }
    return { xml: `<m:d><m:dPr>${prop('begChr', f[0])}${prop('endChr', f[1])}</m:dPr>${wrap('e', m)}</m:d>` }
  }
}

// The content of an <m:oMath> for a LaTeX formula (no $ or \[ \]).
export function latexToOmml(latex: string): string {
  const p = new Parser(latex)
  // Rows split by \\ at the top: an equation array.
  const rows: string[] = []
  for (;;) {
    rows.push(joinItems(p.row((t) => t === '\\\\')))
    if (p.next() === null) break
    p.optional()
  }
  const kept = rows.filter(Boolean)
  if (kept.length > 1) return `<m:eqArr>${kept.map((r) => wrap('e', r)).join('')}</m:eqArr>`
  return kept[0] ?? ''
}

// An inline equation: <m:oMath>.
export function ommlInline(latex: string): string {
  return `<m:oMath>${latexToOmml(latex)}</m:oMath>`
}

// A display equation: <m:oMathPara>. A number goes after a "#" in an
// equation array, as Word writes a numbered equation.
export function ommlDisplay(latex: string, number: string | null = null): string {
  let body = latexToOmml(latex)
  if (number !== null) body = `<m:eqArr><m:e>${body}${runXml(`#(${number})`)}</m:e></m:eqArr>`
  return `<m:oMathPara><m:oMath>${body}</m:oMath></m:oMathPara>`
}
