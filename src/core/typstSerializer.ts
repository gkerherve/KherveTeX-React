// Document model -> Typst source string. A port of khervedoc/typst_serializer.py.
//
// Pure functions; one serializer per node type. No I/O.

import { HIGHLIGHT_COLORS, THEOREM_KINDS } from './model.ts'
import type { Abstract, Block, Document, Figure, Inline, Keywords, Mark } from './model.ts'
import { isAlpha, pyFixed, pyFloat, pyTitle, rstrip, strip } from './py.ts'
import { figureOutputPath } from './serializer.ts'

const has = (o: object, k: string): boolean => Object.hasOwn(o, k)

// Characters that have special meaning in Typst markup and need escaping.
const TYPST_SPECIAL = new Set('#*_`@$\\<>[]~')

// Escape Typst special characters by prefixing with backslash.
export function escapeText(s: string): string {
  let out = ''
  for (const ch of s) out += TYPST_SPECIAL.has(ch) ? `\\${ch}` : ch
  return out
}

// Mark wrappers — use function-call form to avoid ambiguity when nested.
const MARK_WRAPPERS: Record<Mark, [string, string]> = {
  bold: ['#strong[', ']'],
  italic: ['#emph[', ']'],
  underline: ['#underline[', ']'],
  code: ['`', '`'],
  smallcaps: ['#smallcaps[', ']'],
  subscript: ['#sub[', ']'],
  superscript: ['#super[', ']'],
  strikethrough: ['#strike[', ']'],
}

const MARK_ORDER: Mark[] = ['bold', 'italic', 'underline', 'smallcaps',
  'subscript', 'superscript', 'strikethrough', 'code']

export function serializeInline(node: Inline): string {
  switch (node.type) {
    case 'Text': {
      let s = escapeText(node.text)
      for (const mark of [...MARK_ORDER].reverse()) {
        if (node.marks.includes(mark)) {
          const [open, close] = MARK_WRAPPERS[mark]
          s = `${open}${s}${close}`
        }
      }
      return s
    }
    case 'MathInline':
      return `$${latexMathToTypst(node.latex)}$`
    case 'Link': {
      const body = serializeInlines(node.children)
      if (body) return `#link("${node.url}")[${body}]`
      return `#link("${node.url}")`
    }
    case 'Footnote':
      return `#footnote[${serializeInlines(node.children)}]`
    case 'Citation': {
      // Typst @-citations require a loaded #bibliography(); render as
      // bracketed text so compilation never fails on a missing .bib.
      const joined = node.keys.join(', ')
      return `\\[${joined}\\]`
    }
    case 'CrossRef':
      return `@${node.label}`
    case 'InlineRaw':
      return node.latex
    case 'Highlight': {
      const body = serializeInlines(node.children)
      const hexval = has(HIGHLIGHT_COLORS, node.color) ? HIGHLIGHT_COLORS[node.color] : '#FFFF00'
      return `#highlight(fill: rgb("${hexval}"))[${body}]`
    }
    case 'Comment': {
      const body = serializeInlines(node.children)
      const note = node.note.replaceAll('*/', '* /')
      return `${body} /* ${note} */`
    }
  }
  throw new TypeError(`Unknown inline node: ${(node as { type: string }).type}`)
}

export function serializeInlines(nodes: Inline[]): string {
  return nodes.map(serializeInline).join('')
}

function maybeLabel(label: string | null): string {
  return label ? ` <${label}>` : ''
}

export function serializeBlock(node: Block): string {
  switch (node.type) {
    case 'Paragraph': {
      const body = serializeInlines(node.children)
      if (node.alignment === 'left' || node.alignment === 'center' || node.alignment === 'right') {
        return `#align(${node.alignment})[${body}]\n`
      }
      return body + '\n'
    }

    case 'Section': {
      const marker = '='.repeat(Math.max(1, node.level))
      const body = serializeInlines(node.children)
      if (!node.numbered) {
        return `#heading(level: ${node.level}, `
          + `numbering: none)[${body}]${maybeLabel(node.label)}\n`
      }
      return `${marker} ${body}${maybeLabel(node.label)}\n`
    }

    case 'MathBlock': {
      const latex = strip(node.latex)
      // Strip LaTeX environment wrappers — Typst uses bare $ ... $
      const stripped = stripMathEnv(latex)
      const converted = latexMathToTypst(stripped)
      const lab = maybeLabel(node.label)
      if (node.numbered) {
        return `#math.equation(block: true, numbering: "(1)")[\n$ ${converted} $\n]${lab}\n`
      }
      return `$ ${converted} $${lab}\n`
    }

    case 'List': {
      const marker = node.ordered ? '+' : '-'
      return node.items.map((it) => `${marker} ${serializeInlines(it.children)}\n`).join('')
    }

    case 'Theorem': {
      const body = serializeInlines(node.children)
      if (!node.start) return body + '\n'
      const fallback = pyTitle(node.kind)
      const name = has(THEOREM_KINDS, node.kind) ? THEOREM_KINDS[node.kind] : fallback
      const head = node.title ? `${name} (${node.title})` : name
      const style = node.kind === 'proof' ? '_' : '*'
      return `${style}${head}.${style} ${body}\n`
    }

    case 'Figure':
      return serializeFigure(node)

    case 'Table': {
      if (node.rows.length === 0) return ''
      const cols = Math.max(...node.rows.map((r) => r.length))
      const anchors = new Map<string, [number, number]>()
      for (const m of node.merges) {
        if (m.length !== 4) {
          throw new Error(`ValueError: expected 4 values to unpack (got ${m.length})`)
        }
        const [r, c, rs, cs] = m
        anchors.set(`${r},${c}`, [rs, cs])
      }
      const covered = new Set<string>()
      for (const [key, [rs, cs]] of anchors) {
        const [r, c] = key.split(',').map(Number)
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr || dc) covered.add(`${r + dr},${c + dc}`)
          }
        }
      }
      let cells: string[] = []
      node.rows.forEach((r, ri) => {
        const padded = [...r, ...Array<string>(Math.max(0, cols - r.length)).fill('')]
        padded.forEach((c, ci) => {
          if (covered.has(`${ri},${ci}`)) return
          let body = escapeText(c)
          if (node.header && ri === 0 && body) body = `*${body}*`
          const opts: string[] = []
          const [rs, cs] = anchors.get(`${ri},${ci}`) ?? [1, 1]
          if (rs > 1) opts.push(`rowspan: ${rs}`)
          if (cs > 1) opts.push(`colspan: ${cs}`)
          const key = `${ri},${ci}`
          const color = has(node.shading, key) ? node.shading[key] : undefined
          if (color) opts.push(`fill: rgb("${color}")`)
          cells.push(opts.length ? `table.cell(${opts.join(', ')})[${body}]` : `[${body}]`)
        })
      })
      if (node.header && cells.length) {
        let first = 0
        for (let ci = 0; ci < cols; ci++) if (!covered.has(`0,${ci}`)) first++
        cells = node.repeat_header
          ? [`table.header(${cells.slice(0, first).join(', ')})`, ...cells.slice(first)]
          : cells
      }
      const cellsStr = cells.join(', ')
      const cap = escapeText(node.caption)
      const lab = maybeLabel(node.label)
      const inner = `table(columns: ${cols}, ${cellsStr})`
      if (cap) return `#figure(\n  ${inner},\n  caption: [${cap}]\n)${lab}\n`
      return `#${inner}${lab}\n`
    }

    case 'RawLatex': {
      let text = node.text
      if (!text.endsWith('\n')) text += '\n'
      const safe = text.replaceAll('*/', '* /')
      return `/* Raw LaTeX:\n${safe}*/\n`
    }

    case 'Title':
      return ''

    case 'Author':
    case 'Affiliation':
    case 'Correspondence':
      return ''

    case 'Abstract': {
      const body = serializeInlines(node.children)
      return '#block(width: 100%, inset: (x: 2em))[\n'
        + `  #text(size: 0.9em)[#emph[Abstract.] ${body}]\n]\n`
    }

    case 'Keywords': {
      const body = serializeInlines(node.children)
      return `#strong[Keywords:] ${body}\n`
    }

    case 'Frame': {
      const body = serializeInlines(node.children)
      return `#pagebreak()\n= ${body}\n`
    }
  }
  throw new TypeError(`Unknown block node: ${(node as { type: string }).type}`)
}

function serializeFigure(node: Figure): string {
  const path = figureOutputPath(node, '.svg')
  const widthPct = latexWidthToTypst(node.width)
  const cap = escapeText(node.caption)
  const lab = maybeLabel(node.label)
  const parts = [`#figure(\n  image("${path}", width: ${widthPct})`]
  if (cap) parts.push(`,\n  caption: [${cap}]`)
  parts.push(`\n)${lab}\n`)
  let out = parts.join('')
  if (node.align === 'left' || node.align === 'right') {
    out = `#align(${node.align})[${rstrip(out)}]\n`
  }
  return out
}

// ---------------------------------------------------------------------------
// LaTeX → Typst math translation
// ---------------------------------------------------------------------------
// Covers common LaTeX math commands. Not exhaustive — exotic packages
// (e.g. tikz-cd, mhchem \ch{}) will pass through as-is and cause Typst
// errors, but the vast majority of everyday math renders correctly.

// Commands that take one braced argument: \cmd{arg} → cmd(arg)
const LATEX_ONE_ARG: Record<string, string> = {
  frac: 'frac', tfrac: 'frac', dfrac: 'frac',
  sqrt: 'sqrt',
  mathbf: 'bold', boldsymbol: 'bold', bm: 'bold',
  mathrm: 'upright', textrm: 'upright', text: 'upright',
  mathit: 'italic',
  mathbb: 'bb', mathcal: 'cal', mathscr: 'cal',
  mathfrak: 'frak',
  hat: 'hat', widehat: 'hat',
  tilde: 'tilde', widetilde: 'tilde',
  bar: 'overline', overline: 'overline',
  underline: 'underline',
  dot: 'dot', ddot: 'dot.double',
  vec: 'arrow',
  acute: 'acute', grave: 'grave',
  breve: 'breve', check: 'caron',
  operatorname: 'op',
  cancel: 'cancel',
}

// Commands whose argument is literal text, not math variables.
const LATEX_TEXT_CMDS = new Set(['text', 'textrm', 'mathrm', 'operatorname'])

// Commands that take two braced arguments: \cmd{a}{b} → cmd(a, b)
const LATEX_TWO_ARG: Record<string, string> = {
  frac: 'frac', tfrac: 'frac', dfrac: 'frac',
  binom: 'binom',
  overset: 'attach',
}

// Simple symbol replacements: \cmd → typst
const LATEX_SYMBOLS: Record<string, string> = {}
// Greek letters (lowercase)
for (const g of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta',
  'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi',
  'omega', 'varepsilon', 'vartheta', 'varpi', 'varrho',
  'varsigma', 'varphi']) {
  LATEX_SYMBOLS[g] = g
}
// Greek letters (uppercase)
for (const g of ['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma',
  'Upsilon', 'Phi', 'Psi', 'Omega']) {
  LATEX_SYMBOLS[g] = g
}
// Operators and relations
Object.assign(LATEX_SYMBOLS, {
  cdot: 'dot', cdots: 'dots.h', ldots: 'dots',
  vdots: 'dots.v', ddots: 'dots.down',
  times: 'times', div: 'div',
  pm: 'plus.minus', mp: 'minus.plus',
  neq: 'eq.not', ne: 'eq.not',
  leq: 'lt.eq', le: 'lt.eq',
  geq: 'gt.eq', ge: 'gt.eq',
  ll: 'lt.double', gg: 'gt.double',
  approx: 'approx', sim: 'tilde',
  simeq: 'tilde.eq', cong: 'tilde.equiv',
  equiv: 'equiv', propto: 'prop',
  subset: 'subset', supset: 'supset',
  subseteq: 'subset.eq', supseteq: 'supset.eq',
  in: 'in', notin: 'in.not', ni: 'in.rev',
  cup: 'union', cap: 'sect',
  setminus: 'without', emptyset: 'nothing',
  forall: 'forall', exists: 'exists',
  neg: 'not', land: 'and', lor: 'or',
  infty: 'infinity',
  partial: 'diff', nabla: 'nabla',
  to: 'arrow.r', rightarrow: 'arrow.r',
  leftarrow: 'arrow.l', leftrightarrow: 'arrow.l.r',
  Rightarrow: 'arrow.r.double',
  Leftarrow: 'arrow.l.double',
  Leftrightarrow: 'arrow.l.r.double',
  mapsto: 'arrow.r.bar',
  iff: 'arrow.l.r.double',
  implies: 'arrow.r.double',
  sum: 'sum', prod: 'prod',
  int: 'integral', iint: 'integral.double',
  iiint: 'integral.triple', oint: 'integral.cont',
  lim: 'lim', limsup: 'limsup', liminf: 'liminf',
  min: 'min', max: 'max',
  sup: 'sup', inf: 'inf',
  sin: 'sin', cos: 'cos', tan: 'tan',
  sec: 'sec', csc: 'csc', cot: 'cot',
  arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  log: 'log', ln: 'ln', exp: 'exp',
  det: 'det', dim: 'dim', ker: 'ker',
  hom: 'hom', deg: 'deg', arg: 'arg',
  gcd: 'gcd',
  quad: 'quad', qquad: 'quad quad',
  ',': 'thin', ';': 'med', '!': 'negthin',
  hspace: '', vspace: '',
  ast: 'ast', star: 'star',
  dagger: 'dagger', ddagger: 'dagger.double',
  ell: 'ell', hbar: 'planck.reduce',
  Re: 'Re', Im: 'Im',
  prime: 'prime',
  angle: 'angle',
  perp: 'perp', parallel: 'parallel',
  circ: 'compose',
  otimes: 'times.circle', oplus: 'plus.circle',
  top: 'top', bot: 'bot',
  langle: 'angle.l', rangle: 'angle.r',
  lceil: 'ceil.l', rceil: 'ceil.r',
  lfloor: 'floor.l', rfloor: 'floor.r',
})

// \left and \right delimiter mapping
const DELIM_MAP: Record<string, string> = {
  '(': '(', ')': ')',
  '[': '[', ']': ']',
  '\\{': '{', '\\}': '}',
  '|': '|', '\\|': '||',
  '.': '', // \left. or \right. = invisible delimiter
  '\\langle': 'angle.l', '\\rangle': 'angle.r',
  '\\lceil': 'ceil.l', '\\rceil': 'ceil.r',
  '\\lfloor': 'floor.l', '\\rfloor': 'floor.r',
}

// The translator indexes by code point, as Python's str does, so `s` is a
// code-point array rather than a UTF-16 string.

// Extract a braced argument starting at pos (which should be '{').
// Returns [content, newPosAfterClosingBrace].
function eatBraceArg(s: string[], pos: number): [string, number] {
  if (pos >= s.length || s[pos] !== '{') return ['', pos]
  let depth = 1
  const start = pos + 1
  let i = start
  while (i < s.length && depth > 0) {
    if (s[i] === '{') depth += 1
    else if (s[i] === '}') depth -= 1
    i += 1
  }
  return [s.slice(start, i - 1).join(''), i]
}

// Best-effort translation of LaTeX math markup to Typst math markup.
//
// Handles: Greek letters, \frac, \sqrt, \mathbf and friends,
// \left/\right delimiters, \\, &, common symbols and operators.
// Unrecognised \commands pass through (Typst will error on them but
// the user sees what needs manual fixing).
export function latexMathToTypst(source: string): string {
  const latex = Array.from(source)
  const out: string[] = []

  // Append `s` to `out`, inserting a space when two letter-runs would
  // merge into a multi-letter Typst identifier. In LaTeX math each letter
  // is a separate variable; Typst treats consecutive letters as one
  // identifier (`SE` → unknown variable).
  const emit = (s: string): void => {
    if (s && out.length && isAlpha(Array.from(s)[0]) && isAlpha(Array.from(out[out.length - 1]).at(-1) ?? '')) {
      out.push(' ')
    }
    out.push(s)
  }

  let i = 0
  const n = latex.length
  while (i < n) {
    const ch = latex[i]

    // Newline in align: \\ → \
    if (ch === '\\' && i + 1 < n && latex[i + 1] === '\\') {
      emit(' \\')
      i += 2
      continue
    }

    // Backslash command
    if (ch === '\\') {
      // Read the command name
      let j = i + 1
      if (j < n && !isAlpha(latex[j])) {
        // Single-char commands: \, \; \! \{ \} \| etc.
        const cmdChar = latex[j]
        if (has(LATEX_SYMBOLS, cmdChar)) emit(LATEX_SYMBOLS[cmdChar])
        else if (cmdChar === '{') emit('{')
        else if (cmdChar === '}') emit('}')
        else if (cmdChar === '|') emit('||')
        else if (cmdChar === ' ') emit(' ')
        else emit(cmdChar)
        i = j + 1
        continue
      }
      // Multi-char command
      while (j < n && isAlpha(latex[j])) j += 1
      const cmd = latex.slice(i + 1, j).join('')
      i = j

      // \left / \right — drop the command, keep the delimiter
      if (cmd === 'left' || cmd === 'right') {
        // Read the delimiter that follows
        if (i < n) {
          if (latex[i] === '\\') {
            // e.g. \left\{ or \left\langle
            let k = i + 1
            while (k < n && isAlpha(latex[k])) k += 1
            let delimKey = latex.slice(i, k).join('')
            if (delimKey === '\\') {
              // \left\{ or \left\}
              if (k < n && '{}|'.includes(latex[k])) {
                delimKey = '\\' + latex[k]
                k += 1
              }
            }
            const mapped = has(DELIM_MAP, delimKey) ? DELIM_MAP[delimKey] : delimKey.replace(/^\\+/, '')
            emit(mapped)
            i = k
          } else {
            const delimKey = latex[i]
            const mapped = has(DELIM_MAP, delimKey) ? DELIM_MAP[delimKey] : delimKey
            emit(mapped)
            i += 1
          }
        }
        continue
      }

      // Two-argument commands (must check before one-arg)
      if (has(LATEX_TWO_ARG, cmd) && i < n && latex[i] === '{') {
        const typstFn = LATEX_TWO_ARG[cmd]
        let arg1: string
        let arg2: string
        ;[arg1, i] = eatBraceArg(latex, i)
        ;[arg2, i] = eatBraceArg(latex, i)
        arg1 = latexMathToTypst(arg1)
        arg2 = latexMathToTypst(arg2)
        emit(`${typstFn}(${arg1}, ${arg2})`)
        continue
      }

      // \sqrt[n]{x} → root(n, x)
      if (cmd === 'sqrt' && i < n && latex[i] === '[') {
        const endBracket = latex.indexOf(']', i)
        if (endBracket < 0) throw new Error('ValueError: substring not found')
        let rootN = latex.slice(i + 1, endBracket).join('')
        i = endBracket + 1
        let arg: string
        ;[arg, i] = eatBraceArg(latex, i)
        arg = latexMathToTypst(arg)
        rootN = latexMathToTypst(rootN)
        emit(`root(${rootN}, ${arg})`)
        continue
      }

      // One-argument commands
      if (has(LATEX_ONE_ARG, cmd) && i < n && latex[i] === '{') {
        const typstFn = LATEX_ONE_ARG[cmd]
        let arg: string
        ;[arg, i] = eatBraceArg(latex, i)
        // Text-like commands: quote the argument so Typst
        // renders it as literal text, not as math variables.
        if (LATEX_TEXT_CMDS.has(cmd)) {
          emit(`${typstFn}("${arg}")`)
        } else {
          arg = latexMathToTypst(arg)
          emit(`${typstFn}(${arg})`)
        }
        continue
      }

      // Simple symbol replacement
      if (has(LATEX_SYMBOLS, cmd)) {
        const repl = LATEX_SYMBOLS[cmd]
        // drop empty replacements (\hspace etc.)
        if (repl) emit(repl)
        continue
      }

      // Unknown command — pass through without backslash
      // (many LaTeX command names happen to be valid Typst identifiers)
      emit(cmd)
      continue
    }

    // & alignment marker — Typst uses & too
    if (ch === '&') {
      emit('&')
      i += 1
      continue
    }

    // Everything else passes through
    emit(ch)
    i += 1
  }

  return out.join('')
}

// Strip LaTeX math environment wrappers (\begin{equation}...\end{...})
// and return the inner content for Typst's $ ... $ delimiters.
export function stripMathEnv(latex: string): string {
  const m = /^\\begin\{[^}]+\}(.*?)\\end\{[^}]+\}/s.exec(latex)
  if (m) return strip(m[1])
  return latex
}

// Convert LaTeX width spec (e.g. '0.8\textwidth') to Typst percentage.
export function latexWidthToTypst(width: string): string {
  const m = /^([\d.]+)\\textwidth/.exec(width)
  if (m) {
    const num = Number(m[1])
    if (Number.isNaN(num)) throw new Error(`ValueError: could not convert string to float: '${m[1]}'`)
    const pct = num * 100
    if (!Number.isFinite(pct)) throw new Error('OverflowError: cannot convert float infinity to integer')
    if (pct === Math.trunc(pct)) return `${BigInt(pct)}%`
    return `${pyFloat(pct)}%`
  }
  return '80%'
}

const FONT_FAMILY_MAP: Record<string, string> = {
  default: '',
  times: 'Times New Roman',
  palatino: 'Palatino Linotype',
  helvetica: 'Helvetica',
  courier: 'Courier New',
  charter: 'Charter',
  libertine: 'Linux Libertine',
}

const PAGE_SIZE_MAP: Record<string, string> = {
  A4: '"a4"',
  A5: '"a5"',
  Letter: '"us-letter"',
  Legal: '"us-legal"',
  B5: '"iso-b5"',
}

export function serializeDocument(doc: Document): string {
  const m = doc.meta
  const lines: string[] = []

  // Document metadata
  let titleText = ''
  let authorText = ''
  for (const block of doc.children) {
    if (block.type === 'Title' && !titleText) titleText = serializeInlines(block.children)
    else if (block.type === 'Author' && !authorText) authorText = serializeInlines(block.children)
  }
  if (!titleText) titleText = escapeText(strip(m.title || ''))
  if (!authorText) authorText = escapeText(strip(m.author || ''))

  const metaParts: string[] = []
  if (titleText) metaParts.push(`title: "${titleText}"`)
  if (authorText) metaParts.push(`author: "${authorText}"`)
  if (metaParts.length) lines.push(`#set document(${metaParts.join(', ')})`)

  // Page setup
  const paper = has(PAGE_SIZE_MAP, m.page_size) ? PAGE_SIZE_MAP[m.page_size] : '"a4"'
  const margin = `(top: ${pyFloat(m.margin_top_cm)}cm, bottom: ${pyFloat(m.margin_bottom_cm)}cm, `
    + `left: ${pyFloat(m.margin_left_cm)}cm, right: ${pyFloat(m.margin_right_cm)}cm)`
  const pageOpts = [`paper: ${paper}`, `margin: ${margin}`]
  if ((m.column_count ?? 1) >= 2) pageOpts.push(`columns: ${m.column_count}`)
  lines.push(`#set page(${pageOpts.join(', ')})`)

  // Text setup
  const textOpts = [`size: ${m.body_font_pt}pt`]
  const fontName = has(FONT_FAMILY_MAP, m.body_font_family) ? FONT_FAMILY_MAP[m.body_font_family] : ''
  if (fontName) textOpts.push(`font: "${fontName}"`)
  lines.push(`#set text(${textOpts.join(', ')})`)

  // Paragraph setup
  const parOpts: string[] = ['justify: true']
  if (Math.abs(m.line_spacing - 1.0) > 0.01) {
    const leading = 0.65 * m.line_spacing
    parOpts.push(`leading: ${pyFixed(leading, 2)}em`)
  }
  if (m.paragraph_indent) parOpts.push('first-line-indent: 1em')
  lines.push(`#set par(${parOpts.join(', ')})`)

  // Heading numbering
  lines.push('#set heading(numbering: "1.1")')

  lines.push('') // blank line before body

  // Title block
  if (titleText) lines.push(`#align(center, text(size: 17pt, weight: "bold")[${titleText}])`)
  if (authorText) lines.push(`#align(center, text(size: 12pt)[${authorText}])`)
  for (const block of doc.children) {
    if (block.type === 'Affiliation') {
      lines.push('#align(center, text(size: 10pt, style: "italic")'
        + `[${serializeInlines(block.children)}])`)
    } else if (block.type === 'Correspondence') {
      lines.push('#align(center, text(size: 9pt)'
        + `[${serializeInlines(block.children)}])`)
    }
  }
  if (titleText || authorText) lines.push('')

  // Body
  const children = doc.children
  const n = children.length
  let i = 0
  while (i < n) {
    const block = children[i]
    if (block.type === 'Title' || block.type === 'Author'
      || block.type === 'Affiliation' || block.type === 'Correspondence') {
      i += 1
      continue
    }
    // Merge consecutive Abstract blocks
    if (block.type === 'Abstract') {
      const paras: string[] = []
      while (i < n && children[i].type === 'Abstract') {
        paras.push(serializeInlines((children[i] as Abstract).children))
        i += 1
      }
      const joined = paras.filter((p) => p).join('\n\n')
      lines.push('#block(width: 100%, inset: (x: 2em))[\n'
        + `  #text(size: 0.9em)[#emph[Abstract.] ${joined}]\n]`)
      lines.push('')
      continue
    }
    // Merge consecutive Keywords blocks
    if (block.type === 'Keywords') {
      const parts: string[] = []
      while (i < n && children[i].type === 'Keywords') {
        parts.push(serializeInlines((children[i] as Keywords).children))
        i += 1
      }
      const joined = parts.filter((p) => p).join(' · ')
      lines.push(`#strong[Keywords:] ${joined}`)
      lines.push('')
      continue
    }
    const rendered = serializeBlock(block)
    lines.push(rendered)
    i += 1
  }

  return lines.join('\n') + '\n'
}

export const toTypst = serializeDocument
