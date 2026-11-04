// latex_view.LatexHighlighter, line by line: token colours (commands,
// braces, inline math, comments), then a background for the environment
// the line sits in (math, figure, table, list, abstract, bibliography,
// code) or for a heading line. Each line's result depends only on its text
// and the state the previous line left, as QSyntaxHighlighter's block state.

import { strip } from '../core/py.ts'

// ---- colour schemes ----

export const LIGHT_COLORS = {
  command: '#1a6dd8',
  brace: '#7a4c00',
  math_fg: '#1a3a8c',
  comment: '#888888',
  section_bg: '#e8f0fe',
  section_fg: '#1a3a8c',
  math_bg: '#eef3ff',
  figure_bg: '#e8f5e9',
  figure_fg: '#2e7d32',
  table_bg: '#fff3e0',
  table_fg: '#e65100',
  list_bg: '#f5f5f7',
  list_fg: '#444444',
  abstract_bg: '#fff5d6',
  abstract_fg: '#7a4c00',
  cite_bg: '#f3e5f5',
  cite_fg: '#6a1b9a',
  code_bg: '#eef2f7',
  code_fg: '#1a3a8c',
}
export type Colors = typeof LIGHT_COLORS
export const DARK_COLORS: Colors = {
  command: '#6cb4ff',
  brace: '#e5a835',
  math_fg: '#8cc4ff',
  comment: '#6a9955',
  section_bg: '#1e3a5f',
  section_fg: '#8cc4ff',
  math_bg: '#1a2a4a',
  figure_bg: '#1e3d1e',
  figure_fg: '#66bb6a',
  table_bg: '#3d2e1a',
  table_fg: '#ffab40',
  list_bg: '#2a2a2e',
  list_fg: '#b0b0b0',
  abstract_bg: '#3d3520',
  abstract_fg: '#e5c46a',
  cite_bg: '#2d1b3d',
  cite_fg: '#ce93d8',
  code_bg: '#1a2530',
  code_fg: '#8cc4ff',
}

// ---- multi-line block state ----
export const STATE_NORMAL = 0
const STATE_MATH = 1
const STATE_FIGURE = 2
const STATE_TABLE = 3
const STATE_LIST = 4
const STATE_ABSTRACT = 5
const STATE_CITE = 6
const STATE_CODE = 7

const MATH_ENVS = [
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*',
  'gather', 'gather*', 'multline', 'multline*', 'displaymath',
  'eqnarray', 'eqnarray*', 'split',
]
const LIST_ENVS = ['itemize', 'enumerate', 'description']
const ABSTRACT_ENVS = ['abstract']
const CITE_ENVS = ['thebibliography', 'references']
const CODE_ENVS = ['verbatim', 'lstlisting', 'minted', 'listing']

function envRe(envs: string[], begin: boolean): RegExp {
  const tag = begin ? 'begin' : 'end'
  return new RegExp('^\\s*\\\\' + tag + '\\{(' + envs.map(e => e.replace('*', '\\*')).join('|') + ')\\}')
}

const BEGIN_MATH_RE = envRe(MATH_ENVS, true)
const END_MATH_RE = envRe(MATH_ENVS, false)
const BEGIN_FIGURE_RE = /^\s*\\begin\{figure\*?\}/
const END_FIGURE_RE = /^\s*\\end\{figure\*?\}/
const BEGIN_TABLE_RE = /^\s*\\begin\{table\*?\}/
const END_TABLE_RE = /^\s*\\end\{table\*?\}/
const BEGIN_LIST_RE = envRe(LIST_ENVS, true)
const END_LIST_RE = envRe(LIST_ENVS, false)
const BEGIN_ABSTRACT_RE = envRe(ABSTRACT_ENVS, true)
const END_ABSTRACT_RE = envRe(ABSTRACT_ENVS, false)
// Wiley-style \abstract[...]{...} command (not environment).
const ABSTRACT_CMD_RE = /^\s*\\abstract\b/
const BEGIN_CITE_RE = envRe(CITE_ENVS, true)
const END_CITE_RE = envRe(CITE_ENVS, false)
const BEGIN_CODE_RE = envRe(CODE_ENVS, true)
const END_CODE_RE = envRe(CODE_ENVS, false)
const SECTION_RE = /^\s*\\(section|subsection|subsubsection|paragraph|subparagraph|chapter|part)\*?(\{|\[)/

type BlockKey = 'math' | 'figure' | 'table' | 'list' | 'abstract' | 'cite' | 'code'

// block state → (format, end regex)
const ENV_FMT_MAP: Record<number, [BlockKey, RegExp]> = {
  [STATE_MATH]: ['math', END_MATH_RE],
  [STATE_FIGURE]: ['figure', END_FIGURE_RE],
  [STATE_TABLE]: ['table', END_TABLE_RE],
  [STATE_LIST]: ['list', END_LIST_RE],
  [STATE_ABSTRACT]: ['abstract', END_ABSTRACT_RE],
  [STATE_CITE]: ['cite', END_CITE_RE],
  [STATE_CODE]: ['code', END_CODE_RE],
}

export interface CharFormat {
  fg: string | null
  bg: string | null
  bold: boolean
  italic: boolean
}

export interface Span extends CharFormat {
  text: string
}

const PLAIN: CharFormat = { fg: null, bg: null, bold: false, italic: false }

function rules(c: Colors): [RegExp, CharFormat][] {
  return [
    [/\\[A-Za-z@]+\*?/g, { fg: c.command, bg: null, bold: true, italic: false }],
    [/[{}]/g, { fg: c.brace, bg: null, bold: false, italic: false }],
    [/\$[^$]*\$/g, { fg: c.math_fg, bg: c.math_bg, bold: false, italic: true }],
    [/%[^\n]*/g, { fg: c.comment, bg: null, bold: false, italic: true }],
  ]
}

const RULES = new Map<Colors, [RegExp, CharFormat][]>()

// Qt's setFormat positions are UTF-16 offsets, as JS string indices.
export function highlightLine(text: string, prevState: number, dark: boolean): { spans: Span[]; state: number } {
  const c = dark ? DARK_COLORS : LIGHT_COLORS
  let state = prevState < 0 ? STATE_NORMAL : prevState

  // Check for environment opens on this line.
  if (state === STATE_NORMAL) {
    if (BEGIN_MATH_RE.test(text)) state = STATE_MATH
    else if (BEGIN_FIGURE_RE.test(text)) state = STATE_FIGURE
    else if (BEGIN_TABLE_RE.test(text)) state = STATE_TABLE
    else if (BEGIN_LIST_RE.test(text)) state = STATE_LIST
    else if (BEGIN_ABSTRACT_RE.test(text)) state = STATE_ABSTRACT
    else if (BEGIN_CITE_RE.test(text)) state = STATE_CITE
    else if (BEGIN_CODE_RE.test(text)) state = STATE_CODE
  }

  let blockBg: string | null = null
  let isSection = false
  if (state in ENV_FMT_MAP) {
    const [key, endRe] = ENV_FMT_MAP[state]
    blockBg = c[`${key}_bg` as keyof Colors]
    if (endRe.test(text)) state = STATE_NORMAL
  } else if (ABSTRACT_CMD_RE.test(text)) {
    blockBg = c.abstract_bg
  } else if (SECTION_RE.test(text)) {
    blockBg = c.section_bg
    isSection = true
  }

  // Token-level highlights first; a later rule replaces an earlier one's
  // format where they overlap (setFormat).
  const fmt: CharFormat[] = Array.from({ length: text.length }, () => PLAIN)
  let rs = RULES.get(c)
  if (!rs) { rs = rules(c); RULES.set(c, rs) }
  for (const [re, f] of rs) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      for (let i = m.index; i < m.index + m[0].length; i++) fmt[i] = f
    }
  }
  // Overlay the block background on every character without touching the
  // foreground colour set by the token rules; on heading lines the plain
  // text also turns bold in the heading colour.
  if (blockBg !== null) {
    for (let i = 0; i < text.length; i++) {
      const f = { ...fmt[i], bg: blockBg }
      if (isSection && !f.bold) {
        f.fg = c.section_fg
        f.bold = true
      }
      fmt[i] = f
    }
  }

  const spans: Span[] = []
  for (let i = 0; i < text.length; i++) {
    const f = fmt[i]
    const last = spans[spans.length - 1]
    if (last && last.fg === f.fg && last.bg === f.bg && last.bold === f.bold && last.italic === f.italic) {
      last.text += text[i]
    } else {
      spans.push({ ...f, text: text[i] })
    }
  }
  return { spans, state }
}

// ---- LaTeX command dictionary for autocomplete ----

export const LATEX_COMMANDS = [
  '\\section{}', '\\subsection{}', '\\subsubsection{}',
  '\\paragraph{}', '\\subparagraph{}', '\\chapter{}',
  '\\begin{}', '\\end{}',
  '\\begin{equation}', '\\end{equation}',
  '\\begin{align}', '\\end{align}',
  '\\begin{figure}', '\\end{figure}',
  '\\begin{table}', '\\end{table}',
  '\\begin{itemize}', '\\end{itemize}',
  '\\begin{enumerate}', '\\end{enumerate}',
  '\\begin{tabular}{}', '\\end{tabular}',
  '\\begin{center}', '\\end{center}',
  '\\begin{flushleft}', '\\end{flushleft}',
  '\\begin{flushright}', '\\end{flushright}',
  '\\begin{abstract}', '\\end{abstract}',
  '\\begin{multicols}{}', '\\end{multicols}',
  '\\begin{lstlisting}', '\\end{lstlisting}',
  '\\begin{verbatim}', '\\end{verbatim}',
  '\\begin{thebibliography}{}', '\\end{thebibliography}',
  '\\textbf{}', '\\textit{}', '\\texttt{}', '\\underline{}',
  '\\emph{}', '\\textsc{}', '\\textrm{}', '\\textsf{}',
  '\\includegraphics{}', '\\includegraphics[width=]{}',
  '\\caption{}', '\\label{}', '\\ref{}', '\\eqref{}', '\\pageref{}',
  '\\cite{}', '\\citep{}', '\\citet{}',
  '\\footnote{}', '\\href{}{}', '\\url{}',
  '\\frac{}{}', '\\sqrt{}', '\\sum', '\\prod', '\\int',
  '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon',
  '\\theta', '\\lambda', '\\mu', '\\sigma', '\\omega',
  '\\pi', '\\phi', '\\psi', '\\chi', '\\rho', '\\tau',
  '\\partial', '\\nabla', '\\infty', '\\forall', '\\exists',
  '\\mathbb{}', '\\mathcal{}', '\\mathfrak{}',
  '\\left', '\\right', '\\bigl', '\\bigr',
  '\\hspace{}', '\\vspace{}', '\\quad', '\\qquad',
  '\\newpage', '\\clearpage', '\\newline',
  '\\title{}', '\\author{}', '\\date{}', '\\maketitle',
  '\\tableofcontents', '\\listoffigures', '\\listoftables',
  '\\usepackage{}', '\\documentclass{}',
  '\\newcommand{}{}', '\\renewcommand{}{}',
  '\\providecommand{}{}',
  '\\setlength{}{}', '\\addtolength{}{}',
  '\\hrulefill', '\\dotfill',
  '\\centering', '\\raggedright', '\\raggedleft',
  '\\item', '\\bibitem{}',
  '\\Kstroke',
]

// QCompleter (case-sensitive, MatchStartsWith) over the dictionary.
export function completions(prefix: string): string[] {
  return LATEX_COMMANDS.filter(c => c.startsWith(prefix))
}

// The word being typed, from the last backslash of the line to the caret.
export function textUnderCursor(lineToCursor: string): string {
  const idx = lineToCursor.lastIndexOf('\\')
  return idx < 0 ? '' : lineToCursor.slice(idx)
}

// LatexView.cursor_snippet: a short plain-text snippet of the caret's line
// for cross-tab navigation, LaTeX commands stripped.
export function cursorSnippet(line: string, posInLine: number, maxChars = 40): string {
  let t = strip(line)
  t = t.replace(/\\[a-zA-Z]+\*?\{?/g, ' ')
  t = t.replace(/[{}\\&%$]/g, '')
  t = strip(t.split(/\s+/).filter(Boolean).join(' '))
  if ([...t].length > maxChars) {
    const start = Math.max(0, posInLine - Math.floor(maxChars / 2))
    t = [...t].slice(start, start + maxChars).join('')
  }
  return strip(t)
}

// LatexView.scroll_to_snippet's search: the snippet itself, else its first
// three words with LaTeX noise allowed between them. -1 when not found.
export function findSnippet(src: string, snippet: string): number {
  if (!snippet) return -1
  let idx = src.indexOf(snippet)
  if (idx < 0) {
    const words = snippet.split(/\s+/).filter(Boolean).slice(0, 3)
    if (words.length) {
      const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\\\{}]*'))
      const m = re.exec(src)
      if (m) idx = m.index
    }
  }
  return idx
}

