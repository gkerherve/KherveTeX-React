// Document model -> LaTeX source string. A port of khervedoc/serializer.py:
// pure functions, one serializer per node type, no I/O. The output must stay
// byte-identical to the Python app's (tests/serializer.parity.test.ts).

import { designPreamble } from './design.ts'
import { inkPreamble, placeInk } from './ink.ts'
import { dateCommand } from './dateFormat.ts'
import {
  HF_FIELD_RE, HIGHLIGHT_COLORS, hfPlacement, THEOREM_KINDS, citedKeys, classSupportsChapter,
} from './model.ts'
import type {
  Block, ChapterEntry, DocMeta, Document, Figure, Inline, Keywords, List, Paragraph, Project, Table,
} from './model.ts'
import { byCode } from './pageSizes.ts'
import { capitalize, lstrip, pyFixed, pyFloat, rstrip, splitlines, strip } from './py.ts'

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '\u00a0': '~',
}

export function escapeText(s: string): string {
  let out = ''
  for (const ch of s) out += LATEX_ESCAPES[ch] ?? ch
  return out
}

// Python len(): code points, not UTF-16 units.
const pyLen = (s: string) => [...s].length

// Escape only *unbalanced* braces, leaving balanced groups intact. The author
// field carries LaTeX, so \thanks{...} keeps its braces, but a stray } would
// close \author{ early and abort the compile with "Too many }'s".
function guardStrayBraces(p: string): string {
  const out: string[] = []
  const openPositions: number[] = []
  let i = 0
  const n = p.length
  while (i < n) {
    const ch = p[i]
    if (ch === '\\' && i + 1 < n) {
      out.push(p.slice(i, i + 2))
      i += 2
      continue
    }
    if (ch === '{') {
      openPositions.push(out.length)
      out.push('{')
    } else if (ch === '}') {
      if (openPositions.length) {
        openPositions.pop()
        out.push('}')
      } else {
        out.push('\\}')
      }
    } else {
      out.push(ch)
    }
    i += 1
  }
  for (const idx of openPositions) out[idx] = '\\{'
  return out.join('')
}

// The author field accepts LaTeX (\thanks, \small, \texttt...). A literal
// newline or a typed \\ becomes a real line break; only bare & % # $ are
// escaped, and stray braces are neutralised so a malformed author can't
// break the whole document.
export function escapeAuthor(s: string): string {
  const parts = strip(s).split(/\s*\\\\\s*|\n/)
  const lines: string[] = []
  for (let p of parts) {
    p = strip(p)
    if (p) {
      p = p.replace(/(?<!\\)([&%#$])/g, '\\$1')
      lines.push(guardStrayBraces(p))
    }
  }
  return lines.join(' \\\\\n')
}

const MARK_WRAPPERS: Record<string, [string, string]> = {
  bold: ['\\textbf{', '}'],
  italic: ['\\textit{', '}'],
  underline: ['\\underline{', '}'],
  code: ['\\texttt{', '}'],
  smallcaps: ['\\textsc{', '}'],
  subscript: ['\\textsubscript{', '}'],
  superscript: ['\\textsuperscript{', '}'],
  strikethrough: ['\\sout{', '}'],
}

// Word's Font group marks with a value, around a Text's LaTeX: underline
// style (ulem), font family, size, colour (outermost).
export const FONT_FAMILIES: Record<string, [string, string]> = {
  // name: [NFSS family, CSS font in the editor]
  helvetica: ['phv', 'Helvetica, Arial, sans-serif'], arial: ['phv', 'Arial, Helvetica, sans-serif'],
  times: ['ptm', '"Times New Roman", Times, serif'], palatino: ['ppl', 'Palatino, "Palatino Linotype", serif'],
  courier: ['pcr', '"Courier New", Courier, monospace'], bookman: ['pbk', '"Bookman Old Style", serif'],
  avantgarde: ['pag', '"Century Gothic", "Avant Garde", sans-serif'], charter: ['bch', 'Charter, serif'],
  sans: ['cmss', 'sans-serif'], serif: ['cmr', 'serif'], mono: ['cmtt', 'monospace'],
}
const ULINE_CMDS: Record<string, string> = { double: '\\uuline', wave: '\\uwave', dotted: '\\dotuline', dashed: '\\dashuline' }
// Track Changes as the changes package writes them; the markup the
// document shows (Review ▸ All Markup...) decides how (set per document by
// serializeDocument).
let markupMode = ''
// A document with a table of contents lists its unnumbered headings in it
// too, as Word does (\section* alone stays out of LaTeX's contents).
let tocUnnumbered = false
export function changeAuthorId(author: string): string {
  return (author.normalize('NFD').replace(/[^A-Za-z]/g, '') || 'anon').slice(0, 24)
}
function trackMarks(marks: string[], body: string): string {
  const ins = marks.find(m => m.startsWith('ins:'))
  const del = marks.find(m => m.startsWith('del:'))
  if (!ins && !del) return body
  // Original: the text as it was, the insertions not yet made.
  if (markupMode === 'original') return ins ? '' : body
  if (markupMode === 'simple' || markupMode === 'none') return del ? '' : body
  const id = (m: string) => changeAuthorId(decodeURIComponent(m.slice(4).split('|')[0] ?? ''))
  if (del) return `\\deleted[id=${id(del)}]{${body}}`
  return `\\added[id=${id(ins!)}]{${body}}`
}

function valueMarks(marks: string[], body: string): string {
  let s = body
  for (const m of marks) {
    const [k, v] = [m.slice(0, m.indexOf(':')), m.slice(m.indexOf(':') + 1)]
    if (k === 'uline' && ULINE_CMDS[v]) s = `${ULINE_CMDS[v]}{${s}}`
  }
  for (const m of marks) {
    const [k, v] = [m.slice(0, m.indexOf(':')), m.slice(m.indexOf(':') + 1)]
    // T1: XeTeX's TU encoding has no PostScript fonts (phv, ptm...).
    if (k === 'font' && FONT_FAMILIES[v]) s = `{\\fontencoding{T1}\\fontfamily{${FONT_FAMILIES[v][0]}}\\selectfont ${s}}`
  }
  for (const m of marks) {
    const [k, v] = [m.slice(0, m.indexOf(':')), m.slice(m.indexOf(':') + 1)]
    const pt = Number(v)
    if (k === 'size' && pt > 0) s = `{\\fontsize{${pt}}{${pyFloat(Math.round(pt * 12) / 10)}}\\selectfont ${s}}`
  }
  for (const m of marks) {
    const [k, v] = [m.slice(0, m.indexOf(':')), m.slice(m.indexOf(':') + 1)]
    if (k === 'color' && /^[0-9A-Fa-f]{6}$/.test(v)) s = `\\textcolor[HTML]{${v.toUpperCase()}}{${s}}`
  }
  return trackMarks(marks, s)
}

// Packages the Font group marks need (xcolor, ulem).
function fontMarkPackages(doc: Document): string[] {
  let color = false, uline = false
  const authors: string[] = []
  const walk = (ins: Inline[]): void => {
    for (const n of ins) {
      if (n.type === 'Text') {
        for (const m of n.marks as string[]) {
          if (m.startsWith('color:')) color = true
          if (m.startsWith('uline:')) uline = true
          if (m.startsWith('ins:') || m.startsWith('del:')) {
            const a = decodeURIComponent(m.slice(4).split('|')[0] ?? '')
            if (!authors.includes(a)) authors.push(a)
          }
        }
      } else if ('children' in n && Array.isArray(n.children)) walk(n.children as Inline[])
    }
  }
  for (const b of doc.children) {
    if ('children' in b && Array.isArray(b.children)) walk(b.children as Inline[])
    if (b.type === 'List') for (const it of b.items) walk(it.children)
  }
  return [...(color ? ['xcolor'] : []), ...(uline ? ['ulem'] : []), ...authors.map(a => `author:${a}`)]
}

// The changes package and its authors, as the markup shown asks.
const CHANGE_COLORS = ['blue', 'red!80!black', 'green!50!black', 'orange', 'violet', 'teal']
function changesPreamble(authors: string[], mode: string): string {
  if (!authors.length || mode === 'original') return ''
  const lines = [mode === 'simple' || mode === 'none' ? '\\usepackage[final]{changes}' : '\\usepackage[markup=underlined,authormarkup=none]{changes}']
  const seen = new Set<string>()
  authors.forEach((a, k) => {
    const id = changeAuthorId(a)
    if (seen.has(id)) return
    seen.add(id)
    lines.push(`\\definechangesauthor[name={${escapeText(a || 'Author')}}, color=${CHANGE_COLORS[k % CHANGE_COLORS.length]}]{${id}}`)
  })
  return lines.join('\n')
}

// Outermost-first; iteration reverses so the first mark here wraps last.
const MARK_ORDER = ['bold', 'italic', 'underline', 'smallcaps',
  'subscript', 'superscript', 'strikethrough', 'code']

// round(x, 2): Python rounds the exact binary value half-to-even; the only
// exact ties at two decimals are odd multiples of 1/8.
function pyRound2(x: number): number {
  const eighths = x * 8
  if (Number.isInteger(eighths) && eighths % 2 !== 0) {
    const lo = Math.floor(x * 100)
    return (lo % 2 === 0 ? lo : lo + 1) / 100
  }
  return Number(x.toFixed(2))
}

// Short tables get bare l columns; wider ones get proportional p{} columns
// so LaTeX can wrap long cell text instead of overflowing the margins.
export function autoTableAlignment(rows: string[][], cols: number): string {
  const maxLens: number[] = Array.from({ length: cols }, () => 0)
  for (const r of rows) {
    for (let j = 0; j < Math.min(r.length, cols); j++) maxLens[j] = Math.max(maxLens[j], pyLen(r[j]))
  }
  const total = maxLens.reduce((a, b) => a + b, 0) || 1
  // Plain l columns fit a standard page up to about 80 characters across.
  if (total <= 80) return 'l'.repeat(cols)
  const usable = 0.95  // leave a small margin for \tabcolsep
  return maxLens.map((ml) => {
    const frac = Math.max(pyRound2(usable * ml / total), 0.06)
    return `p{${frac.toFixed(2)}\\textwidth}`
  }).join('')
}

export function serializeInline(node: Inline): string {
  switch (node.type) {
    case 'Text': {
      let s = escapeText(node.text)
      for (const mark of [...MARK_ORDER].reverse()) {
        if ((node.marks as string[]).includes(mark)) {
          const [open, close] = MARK_WRAPPERS[mark]
          s = `${open}${s}${close}`
        }
      }
      return valueMarks(node.marks as string[], s)
    }
    case 'MathInline':
      return `$${node.latex}$`
    case 'Link': {
      const body = serializeInlines(node.children)
      // A bare URL is emitted as \url{} so a long address can wrap (with
      // xurl); \href's display text does not break.
      if (!body || body === escapeText(node.url)) return `\\url{${node.url}}`
      return `\\href{${node.url}}{${body}}`
    }
    case 'Footnote':
      return `\\footnote{${serializeInlines(node.children)}}`
    case 'Citation':
      return `\\${node.style}{${node.keys.join(',')}}`
    case 'CrossRef':
      return `\\${node.kind}{${node.label}}`
    case 'InlineRaw':
      return node.latex
    case 'Highlight':
      return `\\colorbox{hl${capitalize(node.color)}}{${serializeInlines(node.children)}}`
    case 'Comment': {
      // \kcomment[timestamp]{author}{date}{note}{text}: a numbered marker
      // after the text and the note in the review column (reviewPreamble).
      // The timestamp is for the importer only; the date is what prints.
      const body = serializeInlines(node.children)
      const ts = node.timestamp.replace(/[\]{}%\\]/g, '')
      return `\\kcomment${ts ? `[${ts}]` : ''}{${escapeText(node.author)}}{${commentDate(node.timestamp)}}` +
        `{${escapeText(node.note).replaceAll('\n', '\\par ')}}{${body}}`
    }
  }
  throw new TypeError(`Unknown inline node: ${(node as { type: string }).type}`)
}

export function serializeInlines(nodes: Inline[]): string {
  return nodes.map(serializeInline).join('')
}

// The display environments the importer keeps whole in MathBlock.latex
// (everything it recognises but equation itself; split is not one: it
// only works inside an equation).
const PREWRAPPED_MATH_RE = /^\s*\\begin\{(?:align|alignat|gather|multline|eqnarray|flalign|displaymath)\*?\}/

const SECTION_COMMANDS: Record<number, string> = {
  0: 'chapter',  // only valid in report / book / memoir classes
  1: 'section', 2: 'subsection', 3: 'subsubsection',
  4: 'paragraph', 5: 'subparagraph',
}

// Vector siblings each figure source keeps beside its PNG preview. A
// flowchart has no SVG, so Typst gets its PNG.
const VECTOR_SIBLINGS: Record<string, string[]> = { drawing: ['.pdf', '.svg'], flowchart: ['.pdf'], chart: ['.pdf'] }

const FIGURE_ALIGN: Record<string, string> = {
  left: '\\raggedright', center: '\\centering', right: '\\raggedleft',
}

// Drawings and flowcharts keep a PNG preview in `path` but the engines get
// the vector sibling instead (tectonic cannot include SVG).
export function figureOutputPath(node: Figure, vectorExt: string): string {
  let path = node.path.replaceAll('\\', '/')
  if ((VECTOR_SIBLINGS[node.source] ?? []).includes(vectorExt) && path.toLowerCase().endsWith('.png')) {
    path = path.slice(0, -4) + vectorExt
  }
  return path
}

// The \includegraphics of a figure's pictures, one row: the main one by
// `height` or `width`, the others by their own size.
export function figureIncludes(node: Figure, vectorExt: string): string {
  const one = (path: string, size: string) =>
    `\\includegraphics[${size}]{${figureOutputPath({ ...node, path } as Figure, vectorExt)}}`
  const main = one(node.path, node.height ? `height=${node.height}` : `width=${node.width}`)
  const rest = (node.extra ?? []).map((e) =>
    one(e.path, e.height ? `height=${e.height}` : `width=${e.width || '0.3\\textwidth'}`))
  return [main, ...rest].join('\\hspace{0.4cm}')
}

const maybeLabel = (label: string | null) => (label ? `\\label{${label}}\n` : '')

const ALIGN_ENVS: Record<string, string> = { left: 'flushleft', center: 'center', right: 'flushright' }

// Consecutive Theorem paragraphs gathered into one environment.
export interface TheoremEnv {
  type: '_TheoremEnv'
  kind: string
  title: string
  paragraphs: Inline[][]
}

type Grouped = Block | TheoremEnv

// Each run of Theorem paragraphs (a start=true one and the start=false ones
// after it, same kind) becomes one TheoremEnv.
export function groupTheorems(blocks: Block[]): Grouped[] {
  const out: Grouped[] = []
  for (const b of blocks) {
    if (b.type === 'Theorem') {
      const prev = out.length ? out[out.length - 1] : undefined
      if (!b.start && prev?.type === '_TheoremEnv' && prev.kind === b.kind) {
        prev.paragraphs.push(b.children)
      } else {
        out.push({ type: '_TheoremEnv', kind: b.kind, title: b.title, paragraphs: [b.children] })
      }
    } else {
      out.push(b)
    }
  }
  return out
}

function serializeTheorem(env: TheoremEnv): string {
  const opt = env.title ? `[${env.title}]` : ''
  const body = env.paragraphs.map(serializeInlines).join('\n\n')
  return `\\begin{${env.kind}}${opt}\n${body}\n\\end{${env.kind}}\n`
}

const UPRIGHT_KINDS = ['definition', 'example', 'remark', 'exercise', 'notation']

// \newtheorem for each kind used, only where neither the class nor the
// user's preamble defines it already (llncs, sn-jnl... do).
function theoremPreamble(doc: Document): string {
  const kinds = Object.keys(THEOREM_KINDS).filter((k) =>
    doc.children.some((b) => b.type === 'Theorem' && b.kind === k))
  if (!kinds.length) return ''
  const lines = ['\\makeatletter']
  const numbered = kinds.filter((k) => k !== 'proof')
  if (numbered.length) {
    lines.push('\\@ifundefined{theorem}{\\newtheorem{theorem}{Theorem}[section]}{}')
  }
  for (const k of numbered) {
    if (k !== 'theorem') {
      // amsthm's definition style: upright text, as for remarks too.
      const style = UPRIGHT_KINDS.includes(k)
        ? '\\@ifundefined{theoremstyle}{}{\\theoremstyle{definition}}' : ''
      lines.push(`\\@ifundefined{${k}}{${style}\\newtheorem{${k}}[theorem]{${THEOREM_KINDS[k]}}}{}`)
      if (style) lines.push('\\@ifundefined{theoremstyle}{}{\\theoremstyle{plain}}')
    }
  }
  if (kinds.includes('proof')) {
    lines.push('\\@ifundefined{proof}{\\newenvironment{proof}[1][Proof]{\\par\\noindent\\textit{#1.}\\ }'
      + '{\\hfill$\\square$\\par\\medskip}}{}')
  }
  lines.push('\\makeatother')
  return lines.join('\n')
}

// Word's bullet and numbering styles as LaTeX's list labels.
const BULLET_LABELS: Record<string, string> = {
  disc: '\\textbullet', circle: '$\\circ$', square: '\\raisebox{0.15ex}{\\rule{0.45em}{0.45em}}',
  dash: '--', arrow: '$\\triangleright$', check: '$\\checkmark$', diamond: '$\\diamond$',
}
const NUMBER_FORMATS: Record<string, [string, string]> = {
  arabic: ['\\arabic', '.'], paren: ['\\arabic', ')'], alpha: ['\\alph', '.'], alphaparen: ['\\alph', ')'],
  Alpha: ['\\Alph', '.'], roman: ['\\roman', '.'], Roman: ['\\Roman', '.'],
}
const ROMAN_LEVELS = ['i', 'ii', 'iii', 'iv']

function listLabelCommands(node: List): string {
  const st = node.style ?? ''
  if (!node.ordered) {
    const lab = BULLET_LABELS[st]
    return lab ? ROMAN_LEVELS.map((r) => `\\renewcommand{\\labelitem${r}}{${lab}}`).join('') : ''
  }
  if (st === 'legal') {
    // 1.  1.1.  1.1.1.
    return '\\renewcommand{\\labelenumi}{\\arabic{enumi}.}'
      + '\\renewcommand{\\theenumii}{\\arabic{enumii}}\\renewcommand{\\labelenumii}{\\arabic{enumi}.\\arabic{enumii}.}'
      + '\\renewcommand{\\theenumiii}{\\arabic{enumiii}}\\renewcommand{\\labelenumiii}{\\arabic{enumi}.\\arabic{enumii}.\\arabic{enumiii}.}'
      + '\\renewcommand{\\theenumiv}{\\arabic{enumiv}}\\renewcommand{\\labelenumiv}{\\arabic{enumi}.\\arabic{enumii}.\\arabic{enumiii}.\\arabic{enumiv}.}'
  }
  const f = NUMBER_FORMATS[st]
  return f ? `\\renewcommand{\\theenumi}{${f[0]}{enumi}}\\renewcommand{\\labelenumi}{\\theenumi${f[1]}}` : ''
}

// A paragraph's Word formatting around its LaTeX: line spacing (setspace),
// left and right indent (kIndent, a list with those margins), space
// before and after, and shading or borders
// (a breakable tcolorbox).
function paraWrap(node: Paragraph, body: string): string {
  let out = body
  // \setstretch in a group: no space added above or below, as \begin{spacing} does.
  if (node.spacing) out = `{\\setstretch{${pyFloat(node.spacing)}}\n${out.replace(/\n$/, '')}\\par}\n`
  if (node.shade || node.border) {
    const b = node.border ?? ''
    const w = (on: boolean) => (on ? '0.5pt' : '0pt')
    const opts = [
      'breakable', 'sharp corners', 'boxsep=0pt', 'left=4pt', 'right=4pt', 'top=3pt', 'bottom=3pt',
      `colback=${node.shade ? `kShade${node.shade.replace('#', '').toUpperCase()}` : 'white'}`, 'colframe=black',
      'before skip=4pt', 'after skip=4pt',
    ]
    // A box: the frame. A rule above or below only: no frame, just that line.
    if (b === 'box') opts.push('boxrule=0.5pt')
    else {
      opts.push('enhanced', 'frame hidden')
      if (b === 'top' || b === 'topbottom') opts.push('borderline north={0.5pt}{0pt}{black}')
      if (b === 'bottom' || b === 'topbottom') opts.push('borderline south={0.5pt}{0pt}{black}')
    }
    void w
    out = `\\begin{tcolorbox}[${opts.join(',')}]\n${out}\\end{tcolorbox}\n`
  }
  if (node.left_cm || node.right_cm) {
    out = `\\begin{kIndent}{${pyFloat(node.left_cm ?? 0)}cm}{${pyFloat(node.right_cm ?? 0)}cm}\n${out}\\end{kIndent}\n`
  }
  if (node.before_pt) out = `\\vspace{${pyFloat(node.before_pt)}pt}\n${out}`
  if (node.after_pt) out = `${out}\\vspace{${pyFloat(node.after_pt)}pt}\n`
  return out
}

// Packages and definitions Word's paragraph formatting needs.
function paraFormatPreamble(doc: Document): [string[], string] {
  const need: string[] = []
  const defs: string[] = []
  const shades = new Set<string>()
  let indent = false
  for (const b of doc.children) {
    if (b.type !== 'Paragraph') continue
    if (b.spacing && !need.includes('setspace')) need.push('setspace')
    if (b.shade || b.border) {
      if (!need.includes('xcolor')) need.push('xcolor')
      if (!need.includes('tcolorbox')) need.push('tcolorbox')
      if (b.shade) shades.add(b.shade.replace('#', '').toUpperCase())
    }
    if (b.left_cm || b.right_cm) indent = true
  }
  if (need.includes('tcolorbox')) defs.push('\\tcbuselibrary{breakable,skins}')
  for (const c of shades) defs.push(`\\definecolor{kShade${c}}{HTML}{${c}}`)
  if (indent) {
    defs.push('\\newenvironment{kIndent}[2]{\\list{}{\\leftmargin=#1\\rightmargin=#2\\itemindent=0pt'
      + '\\listparindent=\\parindent\\topsep=0pt\\partopsep=0pt\\parsep=\\parskip}\\item\\relax}{\\endlist}')
  }
  return [need, defs.join('\n')]
}

export function serializeBlock(node: Grouped, opts: { hasChapters?: boolean; floatH?: boolean } = {}): string {
  const hasChapters = opts.hasChapters ?? false
  const floatH = opts.floatH ?? true
  switch (node.type) {
    case '_TheoremEnv':
      return serializeTheorem(node)
    case 'Theorem':
      return serializeTheorem({ type: '_TheoremEnv', kind: node.kind, title: node.title, paragraphs: [node.children] })
    case 'Paragraph': {
      const body = serializeInlines(node.children)
      // LaTeX justifies by default, so a left/center/right paragraph needs a
      // wrapper for the PDF to look like the editor.
      let out = body + '\n'
      if (node.alignment in ALIGN_ENVS) {
        const env = ALIGN_ENVS[node.alignment]
        out = `\\begin{${env}}\n${body}\n\\end{${env}}\n`
      }
      return paraWrap(node, out)
    }
    case 'Section': {
      // For chapter classes, the editor's "Heading 1" is \chapter.
      const effective = hasChapters ? node.level - 1 : node.level
      const cmd = SECTION_COMMANDS[Math.max(0, Math.min(5, effective))] ?? 'section'
      const star = node.numbered ? '' : '*'
      const title = serializeInlines(node.children)
      const listed = !node.numbered && tocUnnumbered && title.trim() ? `\\addcontentsline{toc}{${cmd}}{${title}}\n` : ''
      return `\\${cmd}${star}{${title}}\n${listed}${maybeLabel(node.label)}`
    }
    case 'MathBlock': {
      // The importer stores align*, gather, ... as a complete
      // \begin{env}...\end{env}; re-wrapping it in equation* would nest
      // illegally, so a pre-wrapped body is emitted verbatim.
      // Only a display environment counts: an equation whose body opens
      // with \begin{split}, \begin{array} or \begin{cases} still needs
      // its equation around it, or LaTeX stops ("split won't work here",
      // "Missing $ inserted") and the equation loses its number.
      if (PREWRAPPED_MATH_RE.test(node.latex)) return `${node.latex}\n`
      const env = node.numbered ? 'equation' : 'equation*'
      const lab = node.numbered ? maybeLabel(node.label) : ''
      return `\\begin{${env}}\n${lab}${node.latex}\n\\end{${env}}\n`
    }
    case 'List': {
      const env = node.ordered ? 'enumerate' : 'itemize'
      if (!node.style && !node.items.some((it) => it.level)) {
        const items = node.items.map((it) => `  \\item ${serializeInlines(it.children)}\n`).join('')
        return `\\begin{${env}}\n${items}\\end{${env}}\n`
      }
      // Nested items (Increase Indent) open a list inside the item before;
      // a bullet or numbering style redefines the labels in a group.
      let out = ''
      let depth = -1
      for (const it of node.items) {
        const lv = Math.min(Math.max(it.level ?? 0, 0), 3, depth + 1)
        while (depth < lv) { depth++; out += `${'  '.repeat(depth)}\\begin{${env}}\n` }
        while (depth > lv) { out += `${'  '.repeat(depth)}\\end{${env}}\n`; depth-- }
        out += `${'  '.repeat(depth + 1)}\\item ${serializeInlines(it.children)}\n`
      }
      while (depth >= 0) { out += `${'  '.repeat(depth)}\\end{${env}}\n`; depth-- }
      const labels = listLabelCommands(node)
      return labels ? `{${labels}\n${out}}\n` : out
    }
    case 'Figure': {
      const path = figureOutputPath(node, '.pdf')
      // The caption is raw LaTeX: emitted verbatim, not re-escaped.
      const lab = node.label ? maybeLabel(node.label) : ''
      const placement = floatH ? 'H' : 'htbp'
      return `\\begin{figure}[${placement}]\n`
        + `  ${FIGURE_ALIGN[node.align] ?? '\\centering'}\n`
        + `  ${(node.extra && node.extra.length) || node.height ? figureIncludes(node, '.pdf') : `\\includegraphics[width=${node.width}]{${path}}`}\n`
        // No caption, no label: no "Figure N:" under the picture (an
        // imported screenshot or icon); a label needs the numbered caption.
        + (node.caption || node.label ? `  \\caption{${node.caption}}\n` : '')
        + `  ${lab}`
        + '\\end{figure}\n'
    }
    case 'Table':
      return serializeTable(node, floatH)
    case 'RawLatex':
      return node.text + (node.text.endsWith('\n') ? '' : '\n')
    case 'Title':
      // \title{...} itself is set in the preamble by serializeDocument.
      return '\\maketitle\n'
    case 'Affiliation':
    case 'Correspondence':
    case 'Author':
      // Pulled into the preamble; \maketitle prints them.
      return ''
    case 'Abstract':
      // Only a lone Abstract reaches here: serializeDocument merges runs.
      return `\\begin{abstract}\n${serializeInlines(node.children)}\n\\end{abstract}\n`
    case 'Keywords':
      return `\\begin{keyword}\n${serializeInlines(node.children)}\n\\end{keyword}\n`
    case 'Frame':
      return serializeInlines(node.children)
    case 'Box':
      // A frame a little narrower than the line, so frame and padding fit
      // inside the margins. \medskip keeps neighbouring boxes apart.
      return `\\medskip\\noindent\\fbox{\\parbox{0.95\\linewidth}{${serializeInlines(node.children)}}}\n`
  }
  throw new TypeError(`Unknown block node: ${(node as { type: string }).type}`)
}

const STRIPE = 'EEF3FA'
const COL_TOKEN_RE = /[lcr]|[pmbX]\{[^}]*\}/g

type Anchors = Map<string, [number, number]>
type Covered = Map<string, [number, number]>
const key = (r: number, c: number) => `${r},${c}`

// anchor (r, c) -> (rowspan, colspan), and covered (r, c) -> anchor.
function mergeMaps(node: Table): [Anchors, Covered] {
  const anchors: Anchors = new Map()
  const covered: Covered = new Map()
  for (const merge of node.merges) {
    // Python unpacks four values and raises on anything else.
    if (merge.length !== 4) throw new Error(`ValueError: expected 4 values to unpack, got ${merge.length}`)
    const [r, c, rs, cs] = merge
    anchors.set(key(r, c), [Math.max(1, rs), Math.max(1, cs)])
    for (let dr = 0; dr < Math.max(1, rs); dr++) {
      for (let dc = 0; dc < Math.max(1, cs); dc++) {
        if (dr || dc) covered.set(key(r + dr, c + dc), [r, c])
      }
    }
  }
  return [anchors, covered]
}

// A % in a table cell or caption is a percentage, never a LaTeX comment:
// unescaped, it swallowed the rest of the row.
const percent = (t: string) => (t || '').replace(/(?<!\\)%/g, '\\%')

function cellLatex(node: Table, r: number, c: number, raw: string): string {
  let t = percent(raw)
  const color = node.shading[key(r, c)]
  if (node.header && r === 0 && t && !t.includes('\\textbf{')) t = `\\textbf{${t}}`
  if (color) t = `\\cellcolor[HTML]{${lstrip(color, '#').toUpperCase()}}${t}`
  return t
}

// \hline under row i, or \cline pieces that skip columns where a vertically
// merged cell carries on into row i+1.
function gridRule(i: number, cols: number, covered: Covered): string {
  const openCols: number[] = []
  for (let c = 0; c < cols; c++) {
    const cov = covered.get(key(i + 1, c))
    if (!cov || cov[0] === i + 1) openCols.push(c)
  }
  if (openCols.length === cols) return '\\hline'
  const parts: string[] = []
  let start: number | null = null
  for (let c = 0; c <= cols; c++) {
    if (c < cols && openCols.includes(c)) {
      start = start === null ? c : start
    } else if (start !== null) {
      parts.push(`\\cline{${start + 1}-${c}}`)
      start = null
    }
  }
  return parts.join(' ')
}

// A span's column type: centred, or for columns of a set width (a form's
// p{\dimexpr<share>\linewidth-2\tabcolsep\relax}) a p{} as wide as the
// columns it covers, so its text still wraps.
const DIMEXPR_RE = /^[pm]\{\\dimexpr([0-9.]+)\\linewidth-2\\tabcolsep\\relax\}$/
// Word sets a form's cells flush left, not justified.
const RAGGED = '>{\\raggedright\\arraybackslash}'
const raggedForm = (align: string) =>
  align.replace(/(?<!\})([pm]\{\\dimexpr)/g, `${RAGGED}$1`)

function spanAlign(grid: boolean, c: number, cs = 1, tokens: string[] = []): string {
  const shares = tokens.slice(c, c + cs).map((t) => DIMEXPR_RE.exec(t))
  if (cs > 0 && shares.length === cs && shares.every((m) => m)) {
    const sum = shares.reduce((a, m) => a + parseFloat(m![1]), 0)
    const p = `${RAGGED}p{\\dimexpr${pyFixed(sum, 4)}\\linewidth-2\\tabcolsep\\relax}`
    return grid ? (c === 0 ? `|${p}|` : `${p}|`) : p
  }
  return grid ? (c === 0 ? '|c|' : 'c|') : 'c'
}

function serializeTable(node: Table, floatH = true): string {
  if (!node.rows.length) return ''
  const cols = Math.max(...node.rows.map((r) => r.length))
  const style = node.style
  const booktabs = style === 'booktabs' || style === 'striped'
  const grid = style === 'grid'
  let topRule: string, midRule: string, bottomRule: string
  if (style === 'plain') {
    topRule = midRule = bottomRule = ''
  } else if (booktabs) {
    [topRule, midRule, bottomRule] = ['\\toprule', '\\midrule', '\\bottomrule']
  } else {
    topRule = midRule = bottomRule = '\\hline'
  }
  let align = strip(node.alignment) || autoTableAlignment(node.rows, cols)
  if (grid && !align.includes('|')) align = '|' + (align.match(COL_TOKEN_RE) ?? []).join('|') + '|'
  const [anchors, covered] = mergeMaps(node)
  const tokens = align.match(COL_TOKEN_RE) ?? []
  const bodyRows: string[] = []
  node.rows.forEach((r, i) => {
    const cells = [...r, ...Array.from({ length: Math.max(0, cols - r.length) }, () => '')]
    const out: string[] = []
    let c = 0
    while (c < cols) {
      const cov = covered.get(key(i, c))
      if (cov) {
        const [ar, ac] = cov
        const [, cs] = anchors.get(key(ar, ac))!
        if (ar === i) {  // inside a colspan: already emitted
          c += 1
          continue
        }
        // Below a multirow: empty cells, spanning like the anchor.
        const t = cellLatex(node, i, c, '')
        out.push(cs > 1 ? `\\multicolumn{${cs}}{${spanAlign(grid, c, cs, tokens)}}{${t}}` : t)
        c += cs
        continue
      }
      let t = cellLatex(node, i, c, cells[c])
      const [rs, cs] = anchors.get(key(i, c)) ?? [1, 1]
      // In a column of set width (a Word form) the text stays at the top of
      // the merged cells and its row grows, as Word does: a \multirow
      // cannot grow and its text ran out below the table.
      if (rs > 1 && !spanAlign(false, c, cs, tokens).startsWith('p')) t = `\\multirow{${rs}}{*}{${t}}`
      if (cs > 1) t = `\\multicolumn{${cs}}{${spanAlign(grid, c, cs, tokens)}}{${t}}`
      out.push(t)
      c += cs
    }
    let rowStr = out.join(' & ') + ' \\\\'
    if (style === 'striped' && i > 0 && i % 2 === 0) rowStr = `\\rowcolor[HTML]{${STRIPE}}` + rowStr
    if (i === 0 && node.rows.length > 1 && midRule) {
      rowStr += ' ' + midRule
    } else if (grid && i < node.rows.length - 1) {
      rowStr += ' ' + gridRule(i, cols, covered)
    }
    bodyRows.push(rowStr)
  })
  const cap = percent(node.caption)
  const lab = node.label ? maybeLabel(node.label) : ''
  // The table's own text size: a size switch inside the float (or a group
  // around a longtable), as \small would be.
  const pt = node.font_size && node.font_size > 0 ? node.font_size : 0
  const sizeCmd = pt ? `\\fontsize{${pt}}{${pyFloat(Math.round(pt * 12) / 10)}}\\selectfont\n` : ''
  const sized = (s: string) => (sizeCmd ? `{${sizeCmd}${s}}\n` : s)
  if (node.repeat_header && bodyRows.length > 1) {
    // longtable repeats everything before \endhead on each page.
    const head = [topRule, bodyRows[0]].filter((x) => x).join('\n')
    const capLine = cap ? `\\caption{${cap}}${strip(lab)}\\\\\n` : ''
    const rest = bodyRows.slice(1).join('\n')
    return sized(`\\begin{longtable}{${raggedForm(align)}}\n${capLine}${head}\n`
      + `\\endhead\n${rest}\n`
      + (bottomRule ? `${bottomRule}\n` : '')
      + '\\end{longtable}\n')
  }
  if (tableHasPictures(node)) {
    // Pictures in the cells (a manual's steps beside their screenshots)
    // make a table taller than a page: a longtable breaks between rows,
    // where a floating tabular would run off the page.
    const capLine = cap ? `\\caption{${cap}}${strip(lab)}\\\\\n` : ''
    return sized(`\\begin{longtable}{${raggedForm(align)}}\n${capLine}`
      + (topRule ? `${topRule}\n` : '')
      + bodyRows.join('\n') + '\n'
      + (bottomRule ? `${bottomRule}\n` : '')
      + '\\end{longtable}\n')
  }
  const body = bodyRows.join('\n    ')
  const placement = floatH ? 'H' : 'htbp'
  const rule = (x: string) => (x ? `    ${x}\n` : '')
  return `\\begin{table}[${placement}]\n`
    + '  \\centering\n'
    + (sizeCmd ? `  ${sizeCmd}` : '')
    + `  \\begin{tabular}{${align}}\n`
    + rule(topRule)
    + `    ${body}\n`
    + rule(bottomRule)
    + '  \\end{tabular}\n'
    // No caption, no "Table 1:" printed under a table that has none.
    + (cap ? `  \\caption{${cap}}\n` : '')
    + `  ${lab}`
    + '\\end{table}\n'
}

// Packages the document's tables need beyond the defaults.
function tablePackages(doc: Document): string[] {
  const need: string[] = []
  for (const b of doc.children) {
    if (b.type !== 'Table') continue
    if (b.merges.some((m) => m[2] > 1) && !need.includes('multirow')) need.push('multirow')
    if ((Object.keys(b.shading).length || b.style === 'striped') && !need.includes('colortbl')) need.push('colortbl')
    if ((b.repeat_header || tableHasPictures(b)) && !need.includes('longtable')) need.push('longtable')
    // m{} / b{} columns (vertically centred or bottom-aligned) are array's.
    if ((/[mb]\{|\\dimexpr/.test(b.alignment || '') || b.rows.some((r) => r.some((c) => c.includes('\\arraybackslash')))) && !need.includes('array')) need.push('array')
  }
  return need
}

// A cell holds a picture (\includegraphics).
export function tableHasPictures(node: Table): boolean {
  // A form imported from Word (columns of set width): in place, breaking
  // across pages, as Word lays it out.
  if (node.alignment.includes('\\dimexpr')) return true
  return node.rows.some((row) => row.some((c) => c.includes('\\includegraphics')))
}

// url refuses to break a link mid-token, so a long address overflows the
// right margin; xurl lets it wrap anywhere. Added only when a URL is present.
// Characters Latin Modern, the PDF's font, has no glyph for (lower-case
// Greek, primes, most math symbols): typed in text they printed as nothing.
// Each becomes an active character drawing its math symbol, or for the
// Greek mu, the font's own micro sign (upright, as in "5 μm").
export const TEXT_FALLBACKS: Record<string, string> = {
  'α': '\\ensuremath{\\alpha}',
  'β': '\\ensuremath{\\beta}',
  'γ': '\\ensuremath{\\gamma}',
  'δ': '\\ensuremath{\\delta}',
  'ε': '\\ensuremath{\\varepsilon}',
  'ζ': '\\ensuremath{\\zeta}',
  'η': '\\ensuremath{\\eta}',
  'θ': '\\ensuremath{\\theta}',
  'ι': '\\ensuremath{\\iota}',
  'κ': '\\ensuremath{\\kappa}',
  'λ': '\\ensuremath{\\lambda}',
  'μ': 'µ',
  'ν': '\\ensuremath{\\nu}',
  'ξ': '\\ensuremath{\\xi}',
  'ο': 'o',
  'π': '\\ensuremath{\\pi}',
  'ρ': '\\ensuremath{\\rho}',
  'ς': '\\ensuremath{\\varsigma}',
  'σ': '\\ensuremath{\\sigma}',
  'τ': '\\ensuremath{\\tau}',
  'υ': '\\ensuremath{\\upsilon}',
  'φ': '\\ensuremath{\\varphi}',
  'χ': '\\ensuremath{\\chi}',
  'ψ': '\\ensuremath{\\psi}',
  'ω': '\\ensuremath{\\omega}',
  'ϑ': '\\ensuremath{\\vartheta}',
  'ϕ': '\\ensuremath{\\phi}',
  'ϖ': '\\ensuremath{\\varpi}',
  'ϱ': '\\ensuremath{\\varrho}',
  'ϵ': '\\ensuremath{\\epsilon}',
  '′': '\\ensuremath{^{\\prime}}',
  '″': '\\ensuremath{^{\\prime\\prime}}',
  'ℏ': '\\ensuremath{\\hbar}',
  '↔': '\\ensuremath{\\leftrightarrow}',
  '⇌': '\\ensuremath{\\rightleftharpoons}',
  '⇒': '\\ensuremath{\\Rightarrow}',
  '⇔': '\\ensuremath{\\Leftrightarrow}',
  '∀': '\\ensuremath{\\forall}',
  '∂': '\\ensuremath{\\partial}',
  '∃': '\\ensuremath{\\exists}',
  '∅': '\\ensuremath{\\emptyset}',
  '∆': '\\ensuremath{\\Delta}',
  '∇': '\\ensuremath{\\nabla}',
  '∈': '\\ensuremath{\\in}',
  '∉': '\\ensuremath{\\notin}',
  '∏': '\\ensuremath{\\prod}',
  '∑': '\\ensuremath{\\sum}',
  '∙': '\\ensuremath{\\bullet}',
  '∝': '\\ensuremath{\\propto}',
  '∠': '\\ensuremath{\\angle}',
  '∥': '\\ensuremath{\\parallel}',
  '∩': '\\ensuremath{\\cap}',
  '∪': '\\ensuremath{\\cup}',
  '∫': '\\ensuremath{\\int}',
  '∼': '\\ensuremath{\\sim}',
  '≈': '\\ensuremath{\\approx}',
  '≠': '\\ensuremath{\\neq}',
  '≡': '\\ensuremath{\\equiv}',
  '≤': '\\ensuremath{\\leq}',
  '≥': '\\ensuremath{\\geq}',
  '≪': '\\ensuremath{\\ll}',
  '≫': '\\ensuremath{\\gg}',
  '⊂': '\\ensuremath{\\subset}',
  '⊥': '\\ensuremath{\\perp}',
  '⋅': '\\ensuremath{\\cdot}',
  '✓': '\\ensuremath{\\surd}',
  '✗': '\\ensuremath{\\times}',
}

// Figures and tables stay where they are written ([H]) when the document
// loads the float package, as KherveTeX's own documents do; a journal class,
// or a document without it (one imported from Word), lets them float
// ([htbp]).
export function pinsFloats(m: DocMeta, isJournal: boolean): boolean {
  if (isJournal) return false
  return (m.packages || []).includes('float') || (m.preamble_extras || '').includes('{float}')
}

// The document's figures float in its PDF (the page view places them so).
export function figuresFloat(m: DocMeta): boolean {
  return !pinsFloats(m, !STANDARD_SERIALIZER_CLASSES.has((m.documentclass || '').toLowerCase()))
}

// Floating figures placed as the editor's page shows them: where they are
// written when they fit, else at the top of the next page, the text filling
// the rest of this one (a figure between paragraphs that does not fit here
// does not fit at the top of this page either). The fractions let a tall
// figure go to a page's top with text under it rather than onto a page of
// its own.
function withFloatPlacement(packages: string, m: DocMeta, isJournal: boolean, doc: Document): string {
  if (isJournal || pinsFloats(m, isJournal)) return packages
  if (!doc.children.some((b) => b.type === 'Figure' || b.type === 'Table')) return packages
  return packages + '\n' + [
    '\\renewcommand{\\topfraction}{0.95}',
    '\\renewcommand{\\bottomfraction}{0.8}',
    '\\renewcommand{\\textfraction}{0.05}',
    '\\renewcommand{\\floatpagefraction}{0.9}',
    '\\setcounter{topnumber}{3}',
    '\\setcounter{totalnumber}{5}',
  ].join('\n')
}

// Define each character of TEXT_FALLBACKS the document uses (and the math
// alphanumerics, 𝛿, whose letter is one) as an active character: plain TeX,
// as newunicodechar does, which tectonic's offline cache lacks. Added after
// the packages, before \title reads any text.
function withUnicodeFallbacks(packages: string, ...scanned: string[]): string {
  const found = new Map<string, string>()
  for (const ch of new Set([...scanned.join('')])) {
    const base = ch.codePointAt(0)! >= 0x1D400 ? ch.normalize('NFKC') : ch
    if (Object.prototype.hasOwnProperty.call(TEXT_FALLBACKS, base)) found.set(ch, TEXT_FALLBACKS[base])
  }
  if (!found.size) return packages
  const lines = [...found.keys()].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!)
    .map((ch) => `\\begingroup\\lccode\`\\~=\`${ch}\\lowercase{\\endgroup\\def~}{${found.get(ch)}}\\catcode\`${ch}=\\active`)
  return packages + '\n' + lines.join('\n')
}

// ulem for \sout (strikethrough), [normalem] so \emph stays italic.
// Without it a struck-out word stopped the compile.
function withStrikeout(packages: string, ...scanned: string[]): string {
  if (scanned.join('').includes('\\sout{') && !packages.includes('{ulem}')) {
    return packages + '\n\\usepackage[normalem]{ulem}'
  }
  return packages
}

function withUrlBreaking(packages: string, ...scanned: string[]): string {
  const combined = scanned.join('')
  // \href is hyperref's: a link imported from Word in a document that does
  // not load it stopped the compile on "Undefined control sequence".
  if (combined.includes('\\href') && !combined.includes('hyperref') && !packages.includes('hyperref')) {
    packages += '\n\\usepackage{hyperref}'
  }
  if ((combined.includes('\\url') || combined.includes('\\href')) && !packages.includes('xurl')) {
    return packages + '\n\\usepackage{xurl}'
  }
  return packages
}

// (highlight colours used, has comments), anywhere in the document: list
// items, quotes, boxes, footnotes and table cells too (a comment the
// preamble missed printed its \kcomment arguments as raw text).
function collectReviewUsage(doc: Document): [Set<string>, boolean] {
  const colors = new Set<string>()
  let hasComments = false
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return }
    if (!v || typeof v !== 'object') return
    const node = v as { type?: unknown; color?: unknown }
    if (node.type === 'Highlight' && typeof node.color === 'string') colors.add(node.color)
    else if (node.type === 'Comment') hasComments = true
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x)
  }
  walk(doc.children)
  return [colors, hasComments]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "21 Nov 2026" from the comment's ISO timestamp; the same in every locale,
// so the .tex does not change with the machine it is written on.
export function commentDate(ts: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ts)
  if (!m || +m[2] < 1 || +m[2] > 12) return ''
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`
}

// The review column: comments print as numbered markers after the text
// and notes beside it, in a grey column added to the right of the page.
// The page itself (text block, margins, line and page breaks) is the one
// without comments; only the paper grows by the column's width. Guarded,
// so a .tex that already carries it (an import) does not widen twice.
export const REVIEW_PREAMBLE = String.raw`\usepackage{xcolor}
\usepackage[normalem]{ulem}
\usepackage{tikz}
\ifdefined\kRevPaneW\else
\definecolor{kRevBar}{HTML}{C8650A}
\definecolor{kRevPane}{HTML}{F3F4F6}
\definecolor{kRevLine}{HTML}{F5A623}
\newcounter{kcomment}
\newif\ifkRevInline
\newlength\kRevPaneW \setlength\kRevPaneW{6.2cm}
\makeatletter
\AtBeginDocument{\@mparswitchfalse
  \addtolength\paperwidth{\kRevPaneW}%
  \ifdefined\pdfpagewidth\setlength\pdfpagewidth{\paperwidth}\fi
  \setlength\marginparsep{\dimexpr\paperwidth-\kRevPaneW-1in-\hoffset-\oddsidemargin-\textwidth+0.45cm\relax}%
  \setlength\marginparwidth{\dimexpr\kRevPaneW-0.9cm\relax}%
  \let\kRev@fn\@footnotetext\long\def\@footnotetext#1{\kRev@fn{\kRevInlinetrue#1}}}
\makeatother
\AddToHook{shipout/background}{\put(\dimexpr\paperwidth-\kRevPaneW\relax,-\paperheight){\color{kRevPane}\rule{\kRevPaneW}{\paperheight}}%
  \put(\dimexpr\paperwidth-\kRevPaneW\relax,-\paperheight){\color{black!12}\rule{0.4pt}{\paperheight}}}
\newcommand\kRevBadge{\tikz[baseline=-0.6ex]\node[circle,fill=kRevBar,text=white,inner sep=0.8pt,minimum size=1.15em,font=\sffamily\bfseries\tiny]{\thekcomment};}
\newcommand\kRevMark[1]{\bgroup\markoverwith{\textcolor{kRevLine}{\rule[-0.45ex]{2pt}{0.9pt}}}\ULon{#1}}
% In a footnote, a table, a caption or a box there is no \marginpar: the
% note is drawn in the review column all the same, level with its line.
\newcommand\kRevNote[3]{{\sffamily\footnotesize{\color{kRevBar}\vrule width 1.8pt}\hspace{6pt}%
  \parbox[t]{\dimexpr\kRevPaneW-0.9cm-9pt}{\raggedright\kRevBadge\enspace{\bfseries #1}\hfill{\scriptsize\color{black!45}#2}\par\vspace{2pt}#3}}}
\newcommand\kcomment[5][]{\refstepcounter{kcomment}\kRevMark{#5}\,\raisebox{0.6ex}{\kRevBadge}%
  \ifinner\kRevInlinetrue\fi\ifkRevInline\begin{tikzpicture}[remember picture,overlay]%
  \node[anchor=north west,inner sep=0pt] at ([xshift=-\kRevPaneW+0.45cm]current page.east |- 0,0.75em) {\kRevNote{#2}{#3}{#4}};%
  \end{tikzpicture}\else
  \marginpar{\sffamily\footnotesize{\color{kRevBar}\vrule width 1.8pt}\hspace{6pt}%
  \parbox[t]{\dimexpr\marginparwidth-9pt}{\raggedright\kRevBadge\enspace{\bfseries #2}\hfill{\scriptsize\color{black!45}#3}\par\vspace{2pt}#4}}\fi}
\fi`

function reviewPreamble(colorsUsed: Set<string>, hasComments: boolean): string {
  const lines: string[] = []
  if (colorsUsed.size) {
    lines.push('\\usepackage{xcolor}')
    for (const [name, hex] of Object.entries(HIGHLIGHT_COLORS)) {
      if (colorsUsed.has(name)) lines.push(`\\definecolor{hl${capitalize(name)}}{HTML}{${lstrip(hex, '#')}}`)
    }
  }
  if (hasComments) {
    if (colorsUsed.size) lines.splice(0, 1)  // xcolor comes with the review column
    lines.unshift(REVIEW_PREAMBLE)
  }
  return lines.join('\n')
}

const FONT_FAMILY_PACKAGES: Record<string, string> = {
  default: '',  // Computer Modern, LaTeX default
  times: '\\usepackage{times}',
  palatino: '\\usepackage{palatino}',
  helvetica: '\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}',
  courier: '\\usepackage{courier}\n\\renewcommand{\\familydefault}{\\ttdefault}',
  charter: '\\usepackage[bitstream-charter]{mathdesign}',
  libertine: '\\usepackage{libertine}',
}

// Emitted as-is: some classes accept non-standard sizes.
const bodyFontPtClassOption = (pt: number) => `${pt}pt`

const STANDARD_SERIALIZER_CLASSES = new Set([
  'article', 'report', 'book', 'letter', 'memoir', 'beamer',
  'scrartcl', 'scrreprt', 'scrbook',
  'elsarticle',
])

// elsarticle's 1p, 3p and 5p options load geometry with the journal's own
// page; loading it again is an option clash.
function classSetsPage(m: DocMeta): boolean {
  return (m.documentclass || '').toLowerCase() === 'elsarticle'
    && /\b[135]p\b/.test(m.class_options || '')
}

// (package, command) for the line spacing. memoir has its own spacing
// commands and refuses setspace's \setstretch.
function lineSpacing(m: DocMeta): [string, string] {
  const memoir = (m.documentclass || '').toLowerCase() === 'memoir'
  const pkg = memoir ? '' : '\\usepackage{setspace}'
  if (Math.abs(m.line_spacing - 1.0) <= 0.01) return [pkg, '']
  if (Math.abs(m.line_spacing - 1.5) < 0.01) return [pkg, memoir ? '\\OnehalfSpacing' : '\\onehalfspacing']
  if (Math.abs(m.line_spacing - 2.0) < 0.01) return [pkg, memoir ? '\\DoubleSpacing' : '\\doublespacing']
  const ls = pyFloat(m.line_spacing)
  return [pkg, memoir ? `\\setSpacing{${ls}}` : `\\setstretch{${ls}}`]
}

// Non-standard classes keep their raw options (they set their own layout);
// standard ones are rebuilt from the fields plus any preserved extras.
function classOptions(m: DocMeta): string {
  const raw = m.class_options ?? ''
  if (!STANDARD_SERIALIZER_CLASSES.has((m.documentclass || '').toLowerCase())) return raw
  const opts = [bodyFontPtClassOption(m.body_font_pt)]
  if ((m.column_count ?? 1) === 2) opts.push('twocolumn')
  if (raw) opts.push(...raw.split(',').map((o) => strip(o)).filter((o) => o))
  return opts.join(',')
}

// Header & Footer: fancyhdr, each text's parts at the left, centre and
// right (Word's tab stops), its fields as LaTeX's; the first page (the
// title's \\thispagestyle{plain} too) and even pages their own when set;
// Header from Top / Footer from Bottom through \\headsep and \\footskip.
export function headerFooterLatex(m: DocMeta): string[] {
  const hf = m.header_footer
  if (!hf) return []
  const used = [hf.header, hf.footer, hf.first_header, hf.first_footer, hf.even_header, hf.even_footer].join('\n')
  const text = (s: string): string => {
    let out = ''
    let last = 0
    for (const mt of s.matchAll(HF_FIELD_RE)) {
      out += escapeText(s.slice(last, mt.index))
      const f = mt[1]
      // {} ends a command word: "\\thepage{} of" keeps its space.
      out += f === 'PAGE' ? '\\thepage{}' : f === 'NUMPAGES' ? '\\pageref{LastPage}' : f === 'DATE' ? '\\today{}'
        : f === 'TITLE' ? escapeText(m.title || '') : f === 'AUTHOR' ? escapeText(m.author || '')
          : `\\raisebox{-0.3\\height}{\\includegraphics[height=0.9cm]{${f.slice(8).trim()}}}`
      last = (mt.index ?? 0) + mt[0].length
    }
    return out + escapeText(s.slice(last))
  }
  // "a" left; "a<tab>b" left and centre; "a<tab>b<tab>c" left, centre, right.
  const parts = (s = ''): [string, string, string] => {
    const p = s.split('\t')
    return [p[0] ?? '', p[1] ?? '', p.slice(2).join(' ')]
  }
  const slots = (head: string | undefined, foot: string | undefined, even?: [string | undefined, string | undefined]): string[] => {
    const out: string[] = ['\\fancyhf{}']
    for (const [cmd, odd, ev] of [['fancyhead', head, even?.[0]], ['fancyfoot', foot, even?.[1]]] as const) {
      const o = parts(odd), e = even ? parts(ev) : null
      ;(['L', 'C', 'R'] as const).forEach((side, i) => {
        const a = text(o[i]), b = e ? text(e[i]) : a
        if (!a && !b) return
        out.push(`\\${cmd}[${side}]{${a === b ? a : `\\ifodd\\value{page}${a}\\else ${b}\\fi`}}`)
      })
    }
    return out
  }
  const lines = ['\\usepackage{fancyhdr}']
  if (/\{NUMPAGES\}/.test(used)) lines.push('\\usepackage{lastpage}')
  lines.push('\\pagestyle{fancy}', '\\renewcommand{\\headrulewidth}{0pt}', '\\renewcommand{\\footrulewidth}{0pt}')
  const even = hf.odd_even ? [hf.even_header, hf.even_footer] as [string | undefined, string | undefined] : undefined
  lines.push(...slots(hf.header, hf.footer, even))
  // The first page (and \\maketitle's plain style): its own, or the same.
  const first = hf.different_first ? slots(hf.first_header, hf.first_footer) : slots(hf.header, hf.footer, even)
  lines.push(`\\fancypagestyle{plain}{${first.join('')}}`)
  // A letter's first page has a style of its own (letter: firstpage, or
  // empty with a return address; KOMA's scrlttr2: empty): the same header
  // and footer there.
  const cls = (m.documentclass || '').trim()
  if (cls === 'letter') lines.push(`\\fancypagestyle{firstpage}{${first.join('')}}`)
  if (cls === 'letter' || cls === 'scrlttr2') lines.push(`\\fancypagestyle{empty}{${first.join('')}}`)
  if (hf.different_first) lines.push('\\AtBeginDocument{\\thispagestyle{plain}}')
  const set: string[] = []
  const place = hfPlacement(m)
  // \\topmargin set again so the text stays where the margin puts it
  // (\\headheight and \\headsep changed after geometry moved it).
  if (hf.header_cm !== undefined) set.push(`\\setlength{\\headheight}{14pt}\\setlength{\\headsep}{\\dimexpr ${pyFloat(m.margin_top_cm)}cm-${pyFloat(place.header_cm)}cm-\\headheight\\relax}`
    + `\\setlength{\\topmargin}{\\dimexpr ${pyFloat(m.margin_top_cm)}cm-1in-\\headheight-\\headsep\\relax}`)
  if (hf.footer_cm !== undefined) set.push(`\\setlength{\\footskip}{\\dimexpr ${pyFloat(m.margin_bottom_cm)}cm-${pyFloat(place.footer_cm)}cm\\relax}`)
  if (set.length) lines.push(`\\AtBeginDocument{${set.join('')}}`)
  return lines
}

// Layout ▸ Line Numbers and Hyphenation, at the end of the preamble.
function withLayoutOptions(packages: string, m: DocMeta): string {
  const add: string[] = [...headerFooterLatex(m)]
  if (m.line_numbers) {
    add.push(m.line_numbers === 'page' ? '\\usepackage[pagewise]{lineno}' : '\\usepackage{lineno}', '\\linenumbers')
    if (m.line_numbers === 'section') add.push('\\AddToHook{cmd/section/before}{\\resetlinenumber}')
  }
  if (m.hyphenation === false) add.push('\\hyphenpenalty=10000', '\\exhyphenpenalty=10000', '\\sloppy')
  return add.length ? `${packages}\n${add.join('\n')}` : packages
}

function documentclassLine(m: DocMeta): string {
  const cls = (m.documentclass || '').toLowerCase()
  let opts = classOptions(m)
  // standalone crops to its content; without varwidth a paragraph or a
  // list has no line width and the compile fails.
  if (cls === 'standalone' && !opts) opts = 'varwidth'
  // ElegantBook defaults to biber, which tectonic does not ship.
  if (cls === 'elegantbook' && !opts.includes('bib')) opts = [opts, 'bibtex'].filter((o) => o).join(',')
  let line = opts ? `\\documentclass[${opts}]{${m.documentclass}}` : `\\documentclass{${m.documentclass}}`
  if (NEEDS_FONTSPEC_FIRST.has(cls)) line = '\\RequirePackage{fontspec}\n' + line
  if (cls === 'europasscv') line = EUROPASSCV_BEFORE + line + EUROPASSCV_AFTER
  return line
}

// europasscv inputs def/europasscv_<lang>.def and asks for "TeX Gyre Heros"
// by system name; tectonic's bundle is flat and has the font only as files.
// Redirect both while the class loads, then restore them.
const EUROPASSCV_BEFORE = String.raw`\RequirePackage{fontspec}
\makeatletter
\let\kt@IIFE\InputIfFileExists
\def\kt@defpath def/#1\kt@end{#1}
\def\InputIfFileExists#1{\in@{def/}{#1}\ifin@\edef\kt@f{\kt@defpath#1\kt@end}%
\else\def\kt@f{#1}\fi\expandafter\kt@IIFE\expandafter{\kt@f}}
\let\kt@setmainfont\setmainfont
\def\setmainfont#1{\kt@setmainfont{texgyreheros}[Extension=.otf,%
UprightFont=*-regular,BoldFont=*-bold,ItalicFont=*-italic,%
BoldItalicFont=*-bolditalic]}
\makeatother
`
const EUROPASSCV_AFTER = String.raw`
\makeatletter\let\InputIfFileExists\kt@IIFE
\let\setmainfont\kt@setmainfont\makeatother`

// Classes that refuse to load under XeTeX unless fontspec came first.
const NEEDS_FONTSPEC_FIRST = new Set(['suftesi'])

// Classes whose \author{} cannot hold line breaks or font switches (tufte
// upper-cases and letter-spaces it, revtex parses it as a list of names).
const NAMES_ONLY_AUTHOR = new Set(['tufte-handout', 'tufte-book', 'revtex4-2', 'hepthesis'])

// Packages a class forbids outright.
const CLASS_FORBIDDEN_PACKAGES: Record<string, string[]> = {
  'revtex4-2': ['multicol'],
  acmart: ['amssymb'],
}

// Classes that only accept the abstract before \maketitle.
const ABSTRACT_BEFORE_TITLE = new Set(['revtex4-2', 'acmart'])

const CYR_NAMES = ('a b v g d e zh z i ishrt k l m n o p r s t u f h c ch sh '
  + 'shch hrdsn ery sftsn erev yu ya').split(' ')

// disser spells its Russian captions with the T2A \cyr* macros, whose fonts
// tectonic does not ship. Under XeTeX the same letters as Unicode in a
// Cyrillic OpenType font do the job.
function cyrillicMacros(): string {
  const lines = ['\\usepackage{fontspec}',
    '\\setmainfont{DejaVuSerif.ttf}[BoldFont=DejaVuSerif-Bold.ttf,ItalicFont=DejaVuSerif-Italic.ttf]',
    '\\providecommand{\\cyr}{}', '\\providecommand{\\CYRYO}{Ё}',
    '\\providecommand{\\cyryo}{ё}']
  CYR_NAMES.forEach((name, k) => {
    const lower = String.fromCodePoint(0x430 + k)
    lines.push(`\\providecommand{\\cyr${name}}{${lower}}`)
    lines.push(`\\providecommand{\\CYR${name.toUpperCase()}}{${lower.toUpperCase()}}`)
  })
  return lines.join('\n')
}

// llncs's \subparagraph is a \verb warning that overflows TeX's save stack;
// the class's deepest real heading is \paragraph.
const LLNCS_SUBPARAGRAPH = '\\let\\subparagraph\\paragraph'

// Stand-ins for the environments KherveTeX emits that a class may not
// define, so any document compiles under any class. Deferred to
// \begin{document} so a class or package that defines them later still wins.
function classFallbacks(cls: string): string {
  const lines = [
    '\\providecommand{\\texorpdfstring}[2]{#1}',
    '\\makeatletter',
    '\\AtBeginDocument{%',
    '\\@ifundefined{keyword}{\\newenvironment{keyword}'
      + '{\\par\\medskip\\noindent\\textbf{Keywords:}\\ \\def\\sep{\\unskip, }}'
      + '{\\par\\medskip}}{}%',
    '\\@ifundefined{abstract}{\\newenvironment{abstract}'
      + '{\\par\\begin{quote}\\small\\noindent\\textbf{Abstract.}\\ }'
      + '{\\end{quote}\\par}}{}%',
    '\\@ifundefined{table}{\\newenvironment{table}[1][]'
      + '{\\par\\begin{center}\\def\\caption##1{\\par\\textit{##1}\\par}}'
      + '{\\end{center}\\par}}{}%',
    '\\@ifundefined{caption}{\\newcommand{\\caption}[2][]'
      + '{\\par{\\centering #2\\par}}}{}%',
    '}',
    // Letters and CVs have no sectioning or title page.
    '\\providecommand{\\kt@head}[2]{\\par\\medskip\\noindent{#1#2}\\par\\nobreak\\smallskip}',
    '\\providecommand{\\section}{\\@ifstar{\\kt@head\\Large}{\\kt@head\\Large}}',
    '\\providecommand{\\subsection}{\\@ifstar{\\kt@head\\large}{\\kt@head\\large}}',
    '\\providecommand{\\subsubsection}{\\@ifstar{\\kt@head\\bfseries}{\\kt@head\\bfseries}}',
    // disser adds Russian captions through babel's \addto; sn-jnl calls a
    // PostScript header hook that only exists under dvips.
    '\\providecommand{\\addto}[2]{}',
    '\\providecommand{\\chaptername}{Chapter}',
    '\\providecommand{\\tablename}{Table}',
    '\\providecommand{\\figurename}{Figure}',
    '\\providecommand{\\headerps@out}{}',
    '\\makeatother',
  ]
  if (cls.startsWith('tufte')) {
    // Tufte forbids the deeper headings; map them onto \paragraph.
    lines.push('\\let\\subsubsection\\paragraph',
      '\\let\\subparagraph\\paragraph',
      // Its soul letter-spacing breaks \maketitle on the current LaTeX
      // kernel under XeTeX.
      '\\renewcommand{\\allcapsspacing}[1]{#1}',
      '\\renewcommand{\\smallcapsspacing}[1]{#1}')
  }
  if (cls === 'llncs') lines.push(LLNCS_SUBPARAGRAPH)
  if (cls === 'letter' || cls === 'scrlttr2') {
    lines.splice(lines.length - 1, 0, '\\providecommand{\\maketitle}{\\begin{center}'
      + '{\\LARGE\\@title\\par}\\medskip{\\large\\@author\\par}\\end{center}}')
  }
  if (cls === 'hepthesis') {
    // Its \maketitle swallows the next token and breaks an empty line.
    lines.push('\\renewcommand{\\maketitle}{\\titlepage[\\today]{}}')
  }
  if (cls === 'disser') lines.push(cyrillicMacros())
  if (cls === 'tikzposter') {
    // Floats cannot live inside a poster block.
    lines.push('\\renewenvironment{table}[1][]{\\par\\begin{center}'
      + '\\def\\caption##1{\\par\\textit{##1}\\par}}{\\end{center}\\par}',
    '\\renewenvironment{figure}[1][]{\\par\\begin{center}}{\\end{center}\\par}')
  }
  return lines.join('\n')
}

// For column counts the class can't express natively (3+; twocolumn only
// does 2).
// Three columns and more (multicol): the title (\\maketitle first in the
// body) runs across the columns above them, as twocolumn's does and as the
// page shows it; inside, it took column 1 and the others began beside it.
const wrapMulticols = (body: string, n: number) => {
  const m = /^(\s*\\maketitle\n)/.exec(body)
  const head = m ? m[1] : ''
  return `${head}\\begin{multicols}{${n}}\n${body.slice(head.length)}\\end{multicols}\n`
}

// \providecommand so an imported document that defines \Kstroke itself
// survives the round-trip without "command already defined".
const KSTROKE_PROVIDE = '\\providecommand{\\Kstroke}'
  + '{K\\hspace{-0.55em}\\raisebox{-0.5ex}{\\rotatebox{40}{--}}\\hspace{-0.1em}}'

// The importer joins an env's keywords into one block separated by " · ";
// split on that bullet to re-emit the elsarticle `kw \sep kw` form.
function splitKeywordInlines(blocks: Keywords[]): string[] {
  const out: string[] = []
  for (const block of blocks) {
    const line = strip(serializeInlines(block.children))
    if (!line) continue
    for (let term of line.split(' · ')) {
      term = strip(term, ' \t\n')
      if (term) out.push(term)
    }
  }
  return out
}

const NATBIB_STYLES = new Set(['plainnat', 'abbrvnat', 'unsrtnat'])
export const BIB_NAME = 'kherveref'

// Point the document at kherveref.bib when its citations come from a
// KherveRef library. A document with its own \bibliography{...} keeps it,
// with kherveref added; biblatex or a literal thebibliography is left alone.
// Returns (body, whether natbib must be loaded).
function withKherverefBibliography(doc: Document, body: string): [string, boolean] {
  const m = doc.meta
  if (!m.ref_library || !citedKeys(doc).length) return [body, false]
  const existing = /\\bibliography\{([^}]*)\}/.exec(body)
  if (existing) {
    const names = existing[1].split(',').map((n) => strip(n))
    if (!names.includes(BIB_NAME)) {
      body = body.slice(0, existing.index) + '\\bibliography{' + [...names, BIB_NAME].join(',') + '}'
        + body.slice(existing.index + existing[0].length)
    }
    return [body, false]
  }
  if (body.includes('\\printbibliography') || body.includes('{thebibliography}')) return [body, false]
  const style = m.bib_style || 'plainnat'
  body = rstrip(body, '\n') + `\n\n\\bibliographystyle{${style}}\n\\bibliography{${BIB_NAME}}\n`
  // \citep and \citet are natbib's: with a numbered style chosen in
  // References they stopped the compile; natbib numbers with those styles.
  return [body, NATBIB_STYLES.has(style) || /\\cite[pt]\{/.test(body)]
}

function withNatbib(packages: string, m: DocMeta): string {
  if (packages.includes('{natbib}') || (m.preamble_extras || '').includes('{natbib}')
    || (m.class_options || '').includes('usenatbib')
    || (m.documentclass || '').toLowerCase().startsWith('elsarticle')) {
    return packages
  }
  return packages + '\n\\usepackage{natbib}'
}

const usesBooktabs = (doc: Document) =>
  doc.children.some((b) => b.type === 'Table' && (b.style === 'booktabs' || b.style === 'striped'))

function geometryLine(m: DocMeta): string {
  const page = byCode(m.page_size)
  return `\\usepackage[${page.geometry_option},${m.landscape ? 'landscape,' : ''}`
    + `top=${pyFloat(m.margin_top_cm)}cm,bottom=${pyFloat(m.margin_bottom_cm)}cm,`
    + (m.mirror_margins
      ? `twoside,inner=${pyFloat(m.margin_left_cm)}cm,outer=${pyFloat(m.margin_right_cm)}cm]{geometry}`
      : `left=${pyFloat(m.margin_left_cm)}cm,right=${pyFloat(m.margin_right_cm)}cm]{geometry}`)
}

const DATE_ONLY_RE = /^(?:\s*\\date\{[^{}]*\}\s*)+$/

export function serializeDocument(doc: Document): string {
  // Draw tab: strokes anchored to a word get \kInk{i} at that word.
  const inked = placeInk(doc.children, doc.meta.ink)
  if (inked.placed.size) doc = { ...doc, children: inked.blocks }
  const m = doc.meta
  markupMode = m.markup ?? ''
  tocUnnumbered = doc.children.some(b => b.type === 'RawLatex' && /\\tableofcontents\b/.test(b.text))
  const isElsarticle = (m.documentclass || '').toLowerCase().startsWith('elsarticle')
  const isBeamer = (m.documentclass || '').toLowerCase() === 'beamer'
  const hasChapters = classSupportsChapter(m.documentclass || '')
  // Non-standard classes carry their own layout: no geometry, setspace or
  // font packages that may conflict.
  const isJournal = !STANDARD_SERIALIZER_CLASSES.has((m.documentclass || '').toLowerCase())
  const clsLower = (m.documentclass || '').toLowerCase()
  const geometry = isJournal || isBeamer || classSetsPage(m) ? '' : geometryLine(m)
  const fontPkg = isJournal ? '' : (FONT_FAMILY_PACKAGES[m.body_font_family] ?? '')
  const [spacingPkg, spacingCmd] = isJournal ? ['', ''] : lineSpacing(m)
  const parindent = m.paragraph_indent || isJournal ? ''
    : '\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{0.8em}'

  const preambleExtras = [fontPkg, spacingPkg, spacingCmd, parindent].filter((p) => p).join('\n')
  const forbidden = CLASS_FORBIDDEN_PACKAGES[clsLower] ?? []
  const pkgList = m.packages.filter((p) => !forbidden.includes(p))
  if (!pkgList.includes('float') && !isJournal) pkgList.push('float')
  if (usesBooktabs(doc) && !pkgList.includes('booktabs') && !m.preamble_extras.includes('{booktabs}')) {
    pkgList.push('booktabs')
  }
  const [paraPkgs, paraDefs] = paraFormatPreamble(doc)
  for (const p of paraPkgs) if (!pkgList.includes(p) && !m.preamble_extras.includes(`{${p}}`)) pkgList.push(p)
  const fontPkgs = fontMarkPackages(doc)
  if (fontPkgs.includes('xcolor') && !pkgList.includes('xcolor')) pkgList.push('xcolor')
  for (const p of tablePackages(doc)) {
    if (p === 'colortbl' && !pkgList.includes('xcolor')) pkgList.push('xcolor')  // \cellcolor[HTML]
    if (!pkgList.includes(p) && !m.preamble_extras.includes(`{${p}}`)) pkgList.push(p)
  }
  const pkgLines = pkgList.map((p) => `\\usepackage{${p}}`).join('\n')
  let packages = geometry ? strip(geometry + '\n' + pkgLines) : pkgLines
  if (preambleExtras) packages += '\n' + preambleExtras
  if (paraDefs) packages += '\n' + paraDefs
  // ulem with normalem, so \emph stays italic.
  if (fontPkgs.includes('ulem') && !m.preamble_extras.includes('{ulem}')) packages += '\n\\usepackage[normalem]{ulem}'
  const changes = changesPreamble(fontPkgs.filter(p => p.startsWith('author:')).map(p => p.slice(7)), m.markup ?? '')
  if (changes) packages += '\n' + changes
  // User preamble (\lstset, \definecolor, \hypersetup, \newcommand...),
  // preserved verbatim from the imported .tex.
  if (m.preamble_extras && strip(m.preamble_extras)) packages += '\n' + strip(m.preamble_extras)
  // Design tab: heading styles, colours, paragraph spacing, page background.
  const design = designPreamble(m.design, clsLower)
  if (design) packages += '\n' + design
  // Draw tab: the pen strokes, over each page.
  const ink = inkPreamble(m.ink, inked.placed)
  if (ink) packages += '\n' + ink
  // After preamble_extras, so a document's own \newcommand{\Kstroke} wins
  // and ours becomes a no-op.
  packages += '\n' + KSTROKE_PROVIDE
  packages += '\n' + classFallbacks(clsLower)
  const thm = theoremPreamble(doc)
  if (thm) packages += '\n' + thm

  const [hlColors, hasComments] = collectReviewUsage(doc)
  const review = reviewPreamble(hlColors, hasComments)
  if (review) packages += '\n' + review

  const [inlineTitle, authorParts, affiliationParts, correspondenceParts] = titleBlockParts(doc.children, isElsarticle)
  const hasTitleBlock = inlineTitle !== null
  const titleText = inlineTitle !== null ? inlineTitle : escapeText(strip(m.title || ''))
  const inlineAuthor = authorParts.length ? authorParts.join(' \\\\\n') : null
  let authorText = inlineAuthor !== null ? inlineAuthor : escapeAuthor(m.author || '')
  // \maketitle puts \@author in a non-wrapping tabular{c}: a long single
  // line overflows, so reflow it in a \parbox. With its own line breaks,
  // \maketitle centres each line and a parbox would swallow \thanks{}.
  if (authorText && !authorText.includes('\\\\') && pyLen(authorText) > 80) {
    authorText = `\\parbox{\\textwidth}{\\centering ${authorText}}`
  }

  if (NAMES_ONLY_AUTHOR.has(clsLower) && authorParts.length) {
    const names = doc.children.filter((b) => b.type === 'Author').map((b) => serializeInlines(b.children))
    authorText = names.filter((n) => n).join(', ') || authorText
    if (clsLower === 'revtex4-2' && affiliationParts.length) {
      authorText += affiliationParts.map((a) => `}\n\\affiliation{${a}`).join('')
    }
  }

  authorText = classAuthors(clsLower, doc.children) || authorText
  if (clsLower === 'acmart' && !authorParts.length) {
    // The same overflow from a \thanks typed into the author field.
    const notes = [...authorText.matchAll(/\\thanks\{([^{}]*)\}/g)].map((x) => x[1])
    if (notes.length) {
      authorText = authorText.replace(/\\thanks\{[^{}]*\}/g, '')
      authorText += `}\n\\authornote{${notes.join(' ')}`
    }
  }

  const hasMetadata = Boolean(titleText || authorText)

  // Elsevier classes need title / author / abstract / keywords inside
  // \begin{frontmatter}; anything outside it is silently dropped.
  if (isElsarticle) {
    const abstractBlocks: Block[] = []
    const keywordsBlocks: Keywords[] = []
    const rawBody: Block[] = []
    for (const block of doc.children) {
      if (['Title', 'Author', 'Affiliation', 'Correspondence'].includes(block.type)) continue
      if (block.type === 'Abstract') { abstractBlocks.push(block); continue }
      if (block.type === 'Keywords') { keywordsBlocks.push(block); continue }
      rawBody.push(block)
    }
    const bodyBlocks = groupTheorems(rawBody)

    const frontParts: string[] = []
    if (titleText) frontParts.push(`\\title{${titleText}}`)
    // An imported \author[opts]{...\corref{...}} lives verbatim in
    // frontmatter_extras; don't emit a second plain \author{...}.
    const extras = strip(m.frontmatter_extras || '')
    const extrasHasAuthor = /\\author\b/.test(extras)
    if (authorText && !extrasHasAuthor) frontParts.push(`\\author{${authorText}}`)
    if (dateCommand(m) && !/\\date\b/.test(extras)) frontParts.push(dateCommand(m))
    for (const part of affiliationParts) frontParts.push(`\\address{${part}}`)
    if (correspondenceParts.length && authorParts.length) {
      frontParts.push(`\\cortext[cor1]{${correspondenceParts.join(' ')}}`)
    }
    if (extras) frontParts.push(extras)
    if (abstractBlocks.length) {
      const paras = abstractBlocks.map((b) => serializeInlines((b as { children: Inline[] }).children))
      frontParts.push(`\\begin{abstract}\n${paras.filter((p) => p).join('\n\n')}\n\\end{abstract}`)
    }
    if (keywordsBlocks.length) {
      const terms = splitKeywordInlines(keywordsBlocks)
      if (terms.length) frontParts.push(`\\begin{keyword}\n${terms.join(' \\sep ')}\n\\end{keyword}`)
    }
    const frontmatter = frontParts.length
      ? '\\begin{frontmatter}\n' + frontParts.join('\n\n') + '\n\\end{frontmatter}\n' : ''

    const bodyParts: string[] = []
    bodyBlocks.forEach((b, i) => {
      bodyParts.push(serializeBlock(b, { hasChapters, floatH: pinsFloats(m, isJournal) }))
      if (i < bodyBlocks.length - 1) bodyParts.push('\n')
    })
    let body = bodyParts.join('')
    if ((m.column_count ?? 1) >= 3) body = wrapMulticols(body, m.column_count)

    let natbib: boolean
    [body, natbib] = withKherverefBibliography(doc, body)
    if (natbib) packages = withNatbib(packages, m)
    packages = withUrlBreaking(packages, packages, frontmatter, body)
    packages = withStrikeout(packages, packages, frontmatter, body)
    packages = withUnicodeFallbacks(packages, packages, frontmatter, body)
    packages = withFloatPlacement(packages, m, isJournal, doc)
  packages = withLayoutOptions(packages, m)
    return `${documentclassLine(m)}\n${packages}\n\\begin{document}\n${frontmatter}${body}\\end{document}\n`
  }

  // Standard classes: title and author in the preamble, abstract and
  // keywords inline. Journal classes whose preamble_extras (or Wiley-style
  // frontmatter_extras) already carry \title / \author get no duplicates.
  const extrasSrc = m.preamble_extras || ''
  let fmExtras = strip(m.frontmatter_extras || '')
  const allExtras = extrasSrc + '\n' + fmExtras
  let preambleMeta = ''
  if (clsLower === 'moderncv' && !/\\name\b/.test(allExtras)) {
    // moderncv has no \author: it needs a style and \name{first}{last}.
    const firstAuthor = doc.children.find((b) => b.type === 'Author')
    const name = (firstAuthor ? serializeInlines(firstAuthor.children) : '') || '~'
    const sp = name.indexOf(' ')
    const [first, last] = sp < 0 ? [name, ''] : [name.slice(0, sp), name.slice(sp + 1)]
    if (!allExtras.includes('\\moderncvstyle')) preambleMeta += '\\moderncvstyle{classic}\n'
    preambleMeta += `\\name{${first}}{${last}}\n`
    authorText = ''
  }
  if (hasMetadata) {
    if (!/\\title\b/.test(allExtras)) preambleMeta += `\\title{${titleText || '~'}}\n`
    if (authorText && !/\\author\b/.test(allExtras)) preambleMeta += `\\author{${authorText}}\n`
    if (dateCommand(m) && !/\\date\b/.test(allExtras)) preambleMeta += dateCommand(m) + '\n'
  }

  const parts: string[] = []
  let emittedMaketitle = false
  // Front matter that is only \date{} (a Word or PDF import: no date to
  // print) is no Wiley author block: it goes first and the title, author
  // and abstract follow as usual. Taken for one, the abstract went before
  // \maketitle as \abstract{...}, which in article opens the abstract
  // environment and pushed the title onto the next page.
  if (fmExtras && !isElsarticle && DATE_ONLY_RE.test(fmExtras)) {
    parts.push(fmExtras + '\n')
    fmExtras = ''
  }
  // Wiley-style classes: body-level frontmatter commands at the top of the
  // body, then \maketitle.
  if (fmExtras && !isElsarticle) {
    parts.push(fmExtras + '\n')
    for (const blk of doc.children) {
      if (blk.type === 'Abstract') {
        parts.push(`\\abstract{${serializeInlines(blk.children)}}\n`)
      } else if (blk.type === 'Keywords') {
        parts.push(`\\keywords{${splitKeywordInlines([blk]).join(', ')}}\n`)
      }
    }
    parts.push('\\maketitle\n')
    emittedMaketitle = true
  }
  let children = groupTheorems(doc.children)
  if (ABSTRACT_BEFORE_TITLE.has(clsLower)) {
    const front = children.filter((b) => b.type === 'Abstract')
    const rest = children.filter((b) => b.type !== 'Abstract')
    const at = rest.findIndex((b) => b.type === 'Title')
    if (front.length && at >= 0) children = [...rest.slice(0, at), ...front, ...rest.slice(at)]
  }
  const n = children.length
  let i = 0
  // A RawLatex block that already holds \maketitle (e.g. inside a
  // \twocolumn[...] wrapper) means no separate one.
  const rawHasMaketitle = children.some((b) => b.type === 'RawLatex' && b.text.includes('\\maketitle'))

  if (isBeamer) {
    while (i < n) {
      const block = children[i]
      if (block.type === 'Title') {
        parts.push('\\begin{frame}\n\\titlepage\n\\end{frame}\n')
        emittedMaketitle = true
        i += 1
        if (i < n) parts.push('\n')
        continue
      }
      if (['Author', 'Affiliation', 'Correspondence', 'Abstract', 'Keywords'].includes(block.type)) {
        i += 1
        continue
      }
      if (block.type === 'Frame') {
        const frameTitle = serializeInlines(block.children)
        i += 1
        const contentParts: string[] = []
        while (i < n && !['Frame', 'Section', 'Title'].includes(children[i].type)) {
          contentParts.push(serializeBlock(children[i]))
          i += 1
        }
        const content = contentParts.filter((p) => p).join('\n')
        parts.push(frameTitle
          ? `\\begin{frame}{${frameTitle}}\n${content}\n\\end{frame}\n`
          : '\\begin{frame}\n\\titlepage\n\\end{frame}\n')
        if (i < n) parts.push('\n')
        continue
      }
      parts.push(serializeBlock(block, { hasChapters }))
      i += 1
      if (i < n) parts.push('\n')
    }
  } else {
    while (i < n) {
      const block = children[i]
      // Body frontmatter already carries the metadata and \maketitle.
      if (fmExtras && ['Title', 'Author', 'Affiliation', 'Correspondence', 'Abstract', 'Keywords'].includes(block.type)) {
        i += 1
        continue
      }
      if (rawHasMaketitle && block.type === 'Title') {
        emittedMaketitle = true
        i += 1
        continue
      }
      if (block.type === 'Abstract') {
        const paras: string[] = []
        while (i < n && children[i].type === 'Abstract') {
          paras.push(serializeInlines((children[i] as { children: Inline[] }).children))
          i += 1
        }
        parts.push(`\\begin{abstract}\n${paras.filter((p) => p).join('\n\n')}\n\\end{abstract}\n`)
        if (i < n) parts.push('\n')
        continue
      }
      if (block.type === 'Keywords') {
        const group: Keywords[] = []
        while (i < n && children[i].type === 'Keywords') {
          group.push(children[i] as Keywords)
          i += 1
        }
        parts.push(`\\begin{keyword}\n${splitKeywordInlines(group).join(' \\sep ')}\n\\end{keyword}\n`)
        if (i < n) parts.push('\n')
        continue
      }
      const rendered = serializeBlock(block, { hasChapters, floatH: pinsFloats(m, isJournal) })
      if (block.type === 'Title') {
        emittedMaketitle = true
      } else if (block.type === 'RawLatex' && block.text.includes('\\maketitle')) {
        emittedMaketitle = true
      }
      parts.push(rendered)
      i += 1
      if (i < n) parts.push('\n')
    }
  }

  if (hasMetadata && !hasTitleBlock && !emittedMaketitle) parts.unshift('\\maketitle\n')
  let body = parts.join('')
  if ((m.column_count ?? 1) >= 3) body = wrapMulticols(body, m.column_count)
  if (clsLower === 'tikzposter') {
    // A poster is a canvas: text only typesets inside a \block.
    const at = body.indexOf('\\maketitle\n')
    let head: string, sep: string, rest: string
    if (at < 0) {
      [head, sep, rest] = ['', '', body]
    } else {
      [head, sep, rest] = [body.slice(0, at), '\\maketitle\n', body.slice(at + '\\maketitle\n'.length)]
    }
    if (strip(rest)) body = `${head}${sep}\\block{}{\n${rest}}\n`
  }
  if (clsLower === 'revtex4-2') {
    // revtex reads its front matter inside the document body.
    body = preambleMeta + body
    preambleMeta = ''
  }

  let natbib: boolean
  [body, natbib] = withKherverefBibliography(doc, body)
  // An empty page, not "No pages of output": a new document is empty.
  if (!strip(body)) body = '\\null\n'
  if (natbib) packages = withNatbib(packages, m)
  packages = withUrlBreaking(packages, packages, preambleMeta, body)
  packages = withStrikeout(packages, packages, preambleMeta, body)
  packages = withUnicodeFallbacks(packages, packages, preambleMeta, body)
  packages = withFloatPlacement(packages, m, isJournal, doc)
  packages = withLayoutOptions(packages, m)
  return `${documentclassLine(m)}\n${packages}\n${preambleMeta}\\begin{document}\n${body}\\end{document}\n`
}

// ==================== Multi-chapter project ====================

// Body-only LaTeX for an \include'd chapter file.
export function serializeChapterBody(doc: Document): string {
  const m = doc.meta
  tocUnnumbered = false
  const hasChapters = classSupportsChapter(m.documentclass || '')
  const isJournal = !STANDARD_SERIALIZER_CLASSES.has((m.documentclass || '').toLowerCase())
  const parts: string[] = []
  const children = groupTheorems(doc.children)
  const n = children.length
  let i = 0
  while (i < n) {
    const block = children[i]
    if (['Title', 'Author', 'Affiliation', 'Correspondence'].includes(block.type)) {
      i += 1
      continue
    }
    if (block.type === 'Abstract') {
      const paras: string[] = []
      while (i < n && children[i].type === 'Abstract') {
        paras.push(serializeInlines((children[i] as { children: Inline[] }).children))
        i += 1
      }
      parts.push(`\\begin{abstract}\n${paras.filter((p) => p).join('\n\n')}\n\\end{abstract}\n`)
      if (i < n) parts.push('\n')
      continue
    }
    if (block.type === 'Keywords') {
      const group: Keywords[] = []
      while (i < n && children[i].type === 'Keywords') {
        group.push(children[i] as Keywords)
        i += 1
      }
      parts.push(`\\begin{keyword}\n${splitKeywordInlines(group).join(' \\sep ')}\n\\end{keyword}\n`)
      if (i < n) parts.push('\n')
      continue
    }
    parts.push(serializeBlock(block, { hasChapters, floatH: pinsFloats(m, isJournal) }))
    i += 1
    if (i < n) parts.push('\n')
  }
  return parts.join('')
}

// The \include stem for a chapter. Its folder is folded in ("partA/intro"
// -> "partA-intro") so two chapters named intro in different folders don't
// overwrite each other, and characters \include rejects are replaced.
export function chapterStem(ch: ChapterEntry): string {
  const raw = ch.path.replaceAll('\\', '/')
  const absolute = raw.startsWith('/')
  const named = raw.split('/').filter((s) => s !== '' && s !== '.')
  let name = named.length ? named[named.length - 1] : ''
  for (const ext of ['.json', '.kdoc', '.ktex', '.kdocz']) {
    if (name.endsWith(ext)) name = name.slice(0, -ext.length)
  }
  const parentParts = (absolute ? ['/'] : []).concat(named.slice(0, -1))
    .filter((q) => q !== '.' && q !== '..' && q !== '/')
  const stem = [...parentParts, name].join('-')
  return strip(stem.replace(/[^A-Za-z0-9_-]+/g, '_'), '_') || 'chapter'
}

type TitleParts = [string | null, string[], string[], string[]]

// (title, author lines, affiliations, correspondence) from a document's
// Title / Author / Affiliation / Correspondence blocks.
function titleBlockParts(children: Block[], isElsarticle = false): TitleParts {
  let inlineTitle: string | null = null
  const authorParts: string[] = []
  const affiliationParts: string[] = []
  const correspondenceParts: string[] = []
  for (const block of children) {
    if (block.type === 'Title' && inlineTitle === null) {
      inlineTitle = serializeInlines(block.children)
    } else if (block.type === 'Author') {
      const part = serializeInlines(block.children)
      if (part) authorParts.push(part)
    } else if (block.type === 'Affiliation') {
      const part = serializeInlines(block.children)
      if (part) {
        affiliationParts.push(part)
        // Elsevier classes take affiliations as their own \address{};
        // everywhere else they sit under the names.
        if (!isElsarticle) authorParts.push(`{\\small\\itshape ${part}}`)
      }
    } else if (block.type === 'Correspondence') {
      const part = serializeInlines(block.children)
      if (part) correspondenceParts.push(part)
    }
  }
  if (correspondenceParts.length) {
    const note = correspondenceParts.join(' ')
    const mark = isElsarticle ? '\\corref{cor1}' : `\\thanks{${note}}`
    if (authorParts.length) {
      authorParts[0] += mark
    } else if (!isElsarticle) {
      authorParts.push(mark)
    }
  }
  return [inlineTitle, authorParts, affiliationParts, correspondenceParts]
}

// The inside of \author{...} for acmart, closing and reopening the brace as
// the revtex branch does. acmart takes one \author per person, each followed
// by its \affiliation; \thanks in \author recurses until TeX's input stack
// overflows, so the note goes in \authornote on the first author. The class
// demands a country even when empty; obeypunctuation stops it printing a
// comma in front of that nothing.
function acmartAuthors(children: Block[]): string {
  const people: string[][] = []
  const earlyAffiliations: string[] = []
  const notes: string[] = []
  for (const block of children) {
    if (block.type !== 'Author' && block.type !== 'Affiliation' && block.type !== 'Correspondence') continue
    const part = serializeInlines(block.children)
    if (!part) continue
    if (block.type === 'Author') {
      people.push([`\\author{${part}}`])
    } else if (block.type === 'Correspondence') {
      notes.push(part)
    } else {
      const line = `\\affiliation[obeypunctuation=true]{\\institution{${part}}\\country{}}`
      ;(people.length ? people[people.length - 1] : earlyAffiliations).push(line)
    }
  }
  if (!people.length) return ''
  people[0].splice(1, 0, ...earlyAffiliations)
  if (notes.length) people[0].splice(1, 0, `\\authornote{${notes.join(' ')}}`)
  const commands = people.flat().join('\n')
  return commands.slice('\\author{'.length, -1)
}

// The inside of \author{...} for llncs: names split by \and, then its own
// \institute, without which every paper prints "No Institute Given".
function llncsAuthors(children: Block[]): string {
  const names = children.filter((b) => b.type === 'Author')
    .map((b) => serializeInlines(b.children)).filter((x) => x)
  if (!names.length) return ''
  const [, , affiliations, notes] = titleBlockParts(children)
  if (notes.length) names[0] += `\\thanks{${notes.join(' ')}}`
  return names.join(' \\and ') + '}\n\\institute{' + affiliations.join(' \\and ')
}

// Author text for the classes that lay out names and addresses in their
// own commands, or "" to use the plain form.
function classAuthors(cls: string, children: Block[]): string {
  if (cls === 'acmart') return acmartAuthors(children)
  if (cls === 'llncs') return llncsAuthors(children)
  return ''
}

// The heading counters (chapter, section, subsection, ...: the commands
// SECTION_COMMANDS names) as LaTeX has them at the start of each document
// of the project, every document counted, ticked or not: an unticked
// document keeps its place in the numbering, as the Documents panel and
// the page view show it.
function countersBefore(proj: Project, chapterDocs: Document[], hasChapter: boolean,
  hasMatter: boolean): number[][] {
  let counters = [0, 0, 0, 0, 0, 0]
  const out: number[][] = []
  let prevType: string | null = null
  proj.chapters.forEach((ch, i) => {
    const doc = chapterDocs[i]
    const ctype = ch.chapter_type ?? 'chapter'
    if (ctype !== prevType && ctype !== 'section') {
      // \appendix starts the chapters (or, in an article, the sections)
      // again, lettered.
      if (ctype === 'appendix') counters = [0, 0, 0, 0, 0, 0]
      prevType = ctype
    }
    out.push([...counters])
    // \frontmatter and \backmatter chapters are not numbered.
    const unnumbered = hasMatter && (ctype === 'frontmatter' || ctype === 'backmatter')
    for (const block of doc.children) {
      if (block.type !== 'Section' || !block.numbered) continue
      const level = Math.max(0, Math.min(5, hasChapter ? block.level - 1 : block.level))
      if (level === 0 && (unnumbered || !hasChapter)) continue
      counters[level] += 1
      for (let k = level + 1; k < 6; k++) counters[k] = 0
    }
  })
  return out
}

// The master .tex for a multi-chapter project. Enabled chapters get an
// \include{}; disabled ones are left out, with counters advanced so later
// chapters keep their numbers. Packages and preamble lines from the chapter
// documents are hoisted into the master.
export function serializeProjectMaster(proj: Project, chapterDocs: Document[] | null = null): string {
  const m = proj.meta
  const isJournal = !STANDARD_SERIALIZER_CLASSES.has((m.documentclass || '').toLowerCase())
  const geometry = isJournal || classSetsPage(m) ? '' : geometryLine(m)
  const fontPkg = isJournal ? '' : (FONT_FAMILY_PACKAGES[m.body_font_family] ?? '')
  const [spacingPkg, spacingCmd] = isJournal ? ['', ''] : lineSpacing(m)
  const parindent = m.paragraph_indent || isJournal ? ''
    : '\\setlength{\\parindent}{0pt}\n\\setlength{\\parskip}{0.8em}'

  const preambleExtras = [fontPkg, spacingPkg, spacingCmd, parindent].filter((p) => p).join('\n')
  const pkgList = [...m.packages]
  if (!pkgList.includes('float') && !isJournal) pkgList.push('float')
  // Chapters are serialized separately, so their tables can't be inspected
  // here; booktabs is cheap and always available.
  if (!pkgList.includes('booktabs') && !isJournal) pkgList.push('booktabs')
  const pkgLines = pkgList.map((p) => `\\usepackage{${p}}`).join('\n')
  let packages = geometry ? strip(geometry + '\n' + pkgLines) : pkgLines
  if (preambleExtras) packages += '\n' + preambleExtras
  if (m.preamble_extras && strip(m.preamble_extras)) packages += '\n' + strip(m.preamble_extras)
  // Chapters are body-only, so packages and macros a chapter added to its
  // own settings must be hoisted into the master or it won't build.
  for (const cdoc of chapterDocs ?? []) {
    for (const pkg of cdoc.meta.packages) {
      if (!pkgList.includes(pkg)) {
        pkgList.push(pkg)
        packages += `\n\\usepackage{${pkg}}`
      }
    }
    for (const line of splitlines(strip(cdoc.meta.preamble_extras || ''))) {
      // The master owns page geometry; a chapter's copy would clash.
      if (strip(line) && !packages.includes(strip(line)) && !line.includes('{geometry}')) {
        packages += '\n' + line
      }
    }
  }
  packages += '\n' + KSTROKE_PROVIDE

  // The title comes from the documents' own Title / Author blocks. The
  // project's name is only a fallback for books; in an article it printed
  // the file name and a date on a page of its own.
  const hasChapter = classSupportsChapter(m.documentclass || '')
  let preambleMeta = ''
  const classSetup = (m.documentclass || '').toLowerCase() === 'llncs' ? LLNCS_SUBPARAGRAPH + '\n' : ''
  let found = false
  for (const cdoc of chapterDocs ?? []) {
    const [t, authors] = titleBlockParts(cdoc.children)
    if (t !== null) {
      preambleMeta += `\\title{${t || '~'}}\n`
      const authorsText = classAuthors((m.documentclass || '').toLowerCase(), cdoc.children)
        || authors.join(' \\\\\n')
      if (authorsText) preambleMeta += `\\author{${authorsText}}\n`
      found = true
      break
    }
  }
  if (!found && hasChapter && m.title && m.title !== 'Untitled') {
    preambleMeta += `\\title{${escapeText(m.title)}}\n`
    if (m.author) preambleMeta += `\\author{${escapeAuthor(m.author)}}\n`
  }

  let bibLines = ''
  if (proj.bibliography) {
    let bibPath = proj.bibliography.replaceAll('\\', '/')
    if (bibPath.endsWith('.bib')) bibPath = bibPath.slice(0, -4)
    const style = proj.bib_style || 'plain'
    bibLines = `\n\\bibliographystyle{${style}}\n\\bibliography{${bibPath}}\n`
  }

  // Disabled chapters are omitted from the body (no \include line), with
  // \setcounter keeping numbering consistent — simpler and more reliable
  // than \includeonly, which leaves .aux files from prior runs.
  const bodyParts: string[] = []
  if (preambleMeta) bodyParts.push('\\maketitle\n')
  let prevNumbering: string | null = null
  let prevType: string | null = null
  let runningChapter = 0
  // and the appendix letter
  let runningAppendix = 0
  let runningPageOffset = 0
  // A document left out since the last one printed: the next one sets its
  // numbers so they stay what they are with every document in.
  let skipped = false
  // What a left-out document would have started with (\appendix,
  // \pagenumbering...): the next document printed starts with it.
  let carried: string[] = []
  // \frontmatter / \mainmatter / \backmatter exist only in book-like classes
  // and the chapter counter only where \chapter does.
  const klass = (m.documentclass || '').toLowerCase()
  const hasMatter = ['book', 'memoir', 'scrbook', 'amsbook'].includes(klass)
  const types = proj.chapters.map(c => c.chapter_type ?? 'chapter')
  // chapterDocs holds every document in order unless one could not be
  // read; the section numbers need them all.
  const before = chapterDocs && chapterDocs.length && chapterDocs.length === proj.chapters.length
    ? countersBefore(proj, chapterDocs, hasChapter, hasMatter) : null
  for (const [idx, ch] of proj.chapters.entries()) {
    const cmds: string[] = []
    const ctype = types[idx]
    // A section document (a chapter split section by section) runs on in
    // the chapter before it: no \mainmatter or \appendix of its own, no
    // chapter number.
    if (ctype !== prevType && ctype !== 'section') {
      if (ctype === 'frontmatter' && hasMatter) {
        cmds.push('\\frontmatter')
      } else if (ctype === 'chapter' && (prevType === 'frontmatter' || prevType === null)) {
        if (hasMatter) cmds.push('\\mainmatter')
        runningChapter = 0
      } else if (ctype === 'appendix') {
        cmds.push('\\appendix')
        runningChapter = 0
        runningAppendix = 0
      } else if (ctype === 'backmatter' && hasMatter) {
        cmds.push('\\backmatter')
      }
      prevType = ctype
    }

    const chNum = ch.chapter_number ?? null
    if (ctype === 'chapter') runningChapter = chNum !== null ? chNum : runningChapter + 1
    else if (ctype === 'appendix') runningAppendix = chNum !== null ? chNum : runningAppendix + 1

    if (ch.numbering !== prevNumbering) {
      cmds.push(`\\pagenumbering{${ch.numbering}}`)
      prevNumbering = ch.numbering
    }

    if (!ch.enabled) {
      runningPageOffset += ch.last_known_pages || 0
      skipped = true
      carried = carried.concat(cmds)
      continue
    }
    cmds.unshift(...carried)
    carried = []

    // Auto numbering lets LaTeX carry the page on from the previous
    // document; start_page is then only what the Documents panel shows.
    if (ch.start_page !== null && ch.start_page !== undefined && !proj.auto_page_numbers) {
      cmds.push(`\\setcounter{page}{${ch.start_page}}`)
    } else if (runningPageOffset > 0) {
      cmds.push(`\\addtocounter{page}{${runningPageOffset}}`)
      runningPageOffset = 0
    }

    if (ctype === 'chapter' && hasChapter) cmds.push(`\\setcounter{chapter}{${runningChapter - 1}}`)
    if (skipped) {
      // An appendix keeps its letter, and a document that goes on in a
      // chapter (a section document) or an article's part its section
      // numbers, as with every document in.
      if (ctype === 'appendix' && hasChapter) cmds.push(`\\setcounter{chapter}{${runningAppendix - 1}}`)
      if (before !== null && (ctype === 'section' || !hasChapter)) {
        const counts = before[idx]
        for (let level = 1; level < 4; level++) cmds.push(`\\setcounter{${SECTION_COMMANDS[level]}}{${counts[level]}}`)
      }
      skipped = false
    }

    if (cmds.length) bodyParts.push(cmds.join('\n') + '\n')
    // \include starts a new page — right for chapters, wrong for the parts
    // of an article, which should run on, and for a section document,
    // which continues its chapter's page. \include also ends with a
    // \clearpage: a chapter whose sections are documents of their own
    // would print its title on a page alone (\chapter starts its page).
    const sectionsFollow = idx + 1 < types.length && types[idx + 1] === 'section'
    const cmd = hasChapter && ctype !== 'section' && !sectionsFollow ? 'include' : 'input'
    bodyParts.push(`\\${cmd}{${chapterStem(ch)}}\n`)
  }

  const body = bodyParts.join('\n')
  return `${documentclassLine(m)}\n${packages}\n${classSetup}${preambleMeta}`
    + `\\begin{document}\n${body}${bibLines}\\end{document}\n`
}
