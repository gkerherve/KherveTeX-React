// Document model -> LaTeX source string. A port of khervedoc/serializer.py:
// pure functions, one serializer per node type, no I/O. The output must stay
// byte-identical to the Python app's (tests/serializer.parity.test.ts).

import { dateCommand } from './dateFormat.ts'
import {
  HIGHLIGHT_COLORS, THEOREM_KINDS, citedKeys, classSupportsChapter,
} from './model.ts'
import type {
  Block, ChapterEntry, DocMeta, Document, Figure, Inline, Keywords, Project, Table,
} from './model.ts'
import { byCode } from './pageSizes.ts'
import { capitalize, lstrip, pyFloat, rstrip, splitlines, strip } from './py.ts'

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
function autoTableAlignment(rows: string[][], cols: number): string {
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
      return s
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
      const body = serializeInlines(node.children)
      const note = node.note.replaceAll('{', '\\{').replaceAll('}', '\\}')
      const authorOpt = node.author ? `, author={${node.author}}` : ''
      return `${body}\\todo[color=blue!20${authorOpt}]{${note}}`
    }
  }
  throw new TypeError(`Unknown inline node: ${(node as { type: string }).type}`)
}

export function serializeInlines(nodes: Inline[]): string {
  return nodes.map(serializeInline).join('')
}

const SECTION_COMMANDS: Record<number, string> = {
  0: 'chapter',  // only valid in report / book / memoir classes
  1: 'section', 2: 'subsection', 3: 'subsubsection',
  4: 'paragraph', 5: 'subparagraph',
}

// Vector siblings each figure source keeps beside its PNG preview. A
// flowchart has no SVG, so Typst gets its PNG.
const VECTOR_SIBLINGS: Record<string, string[]> = { drawing: ['.pdf', '.svg'], flowchart: ['.pdf'] }

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
      if (node.alignment in ALIGN_ENVS) {
        const env = ALIGN_ENVS[node.alignment]
        return `\\begin{${env}}\n${body}\n\\end{${env}}\n`
      }
      return body + '\n'
    }
    case 'Section': {
      // For chapter classes, the editor's "Heading 1" is \chapter.
      const effective = hasChapters ? node.level - 1 : node.level
      const cmd = SECTION_COMMANDS[Math.max(0, Math.min(5, effective))] ?? 'section'
      const star = node.numbered ? '' : '*'
      return `\\${cmd}${star}{${serializeInlines(node.children)}}\n${maybeLabel(node.label)}`
    }
    case 'MathBlock': {
      // The importer stores align*, gather, ... as a complete
      // \begin{env}...\end{env}; re-wrapping it in equation* would nest
      // illegally, so a pre-wrapped body is emitted verbatim.
      if (lstrip(node.latex).startsWith('\\begin{')) return `${node.latex}\n`
      const env = node.numbered ? 'equation' : 'equation*'
      const lab = node.numbered ? maybeLabel(node.label) : ''
      return `\\begin{${env}}\n${lab}${node.latex}\n\\end{${env}}\n`
    }
    case 'List': {
      const env = node.ordered ? 'enumerate' : 'itemize'
      const items = node.items.map((it) => `  \\item ${serializeInlines(it.children)}\n`).join('')
      return `\\begin{${env}}\n${items}\\end{${env}}\n`
    }
    case 'Figure': {
      const path = figureOutputPath(node, '.pdf')
      // The caption is raw LaTeX: emitted verbatim, not re-escaped.
      const lab = node.label ? maybeLabel(node.label) : ''
      const placement = floatH ? 'H' : 'htbp'
      return `\\begin{figure}[${placement}]\n`
        + `  ${FIGURE_ALIGN[node.align] ?? '\\centering'}\n`
        + `  \\includegraphics[width=${node.width}]{${path}}\n`
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

const spanAlign = (grid: boolean, c: number) => (grid ? (c === 0 ? '|c|' : 'c|') : 'c')

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
        out.push(cs > 1 ? `\\multicolumn{${cs}}{${spanAlign(grid, c)}}{${t}}` : t)
        c += cs
        continue
      }
      let t = cellLatex(node, i, c, cells[c])
      const [rs, cs] = anchors.get(key(i, c)) ?? [1, 1]
      if (rs > 1) t = `\\multirow{${rs}}{*}{${t}}`
      if (cs > 1) t = `\\multicolumn{${cs}}{${spanAlign(grid, c)}}{${t}}`
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
  if (node.repeat_header && bodyRows.length > 1) {
    // longtable repeats everything before \endhead on each page.
    const head = [topRule, bodyRows[0]].filter((x) => x).join('\n')
    const capLine = cap ? `\\caption{${cap}}${strip(lab)}\\\\\n` : ''
    const rest = bodyRows.slice(1).join('\n')
    return `\\begin{longtable}{${align}}\n${capLine}${head}\n`
      + `\\endhead\n${rest}\n`
      + (bottomRule ? `${bottomRule}\n` : '')
      + '\\end{longtable}\n'
  }
  if (tableHasPictures(node)) {
    // Pictures in the cells (a manual's steps beside their screenshots)
    // make a table taller than a page: a longtable breaks between rows,
    // where a floating tabular would run off the page.
    const capLine = cap ? `\\caption{${cap}}${strip(lab)}\\\\\n` : ''
    return `\\begin{longtable}{${align}}\n${capLine}`
      + (topRule ? `${topRule}\n` : '')
      + bodyRows.join('\n') + '\n'
      + (bottomRule ? `${bottomRule}\n` : '')
      + '\\end{longtable}\n'
  }
  const body = bodyRows.join('\n    ')
  const placement = floatH ? 'H' : 'htbp'
  const rule = (x: string) => (x ? `    ${x}\n` : '')
  return `\\begin{table}[${placement}]\n`
    + '  \\centering\n'
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
    if (/[mb]\{/.test(b.alignment || '') && !need.includes('array')) need.push('array')
  }
  return need
}

// A cell holds a picture (\includegraphics).
export function tableHasPictures(node: Table): boolean {
  return node.rows.some((row) => row.some((c) => c.includes('\\includegraphics')))
}

// url refuses to break a link mid-token, so a long address overflows the
// right margin; xurl lets it wrap anywhere. Added only when a URL is present.
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

// (highlight colours used, has comments). List blocks have no `children`
// field, so — as in the Python — highlights inside list items are not seen.
function collectReviewUsage(doc: Document): [Set<string>, boolean] {
  const colors = new Set<string>()
  let hasComments = false
  const walkInlines = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === 'Highlight') {
        colors.add(node.color)
        walkInlines(node.children)
      } else if (node.type === 'Comment') {
        hasComments = true
        walkInlines(node.children)
      } else if (node.type === 'Link' || node.type === 'Footnote') {
        walkInlines(node.children)
      }
    }
  }
  for (const block of doc.children) {
    if ('children' in block) walkInlines(block.children)
  }
  return [colors, hasComments]
}

function reviewPreamble(colorsUsed: Set<string>, hasComments: boolean): string {
  const lines: string[] = []
  if (colorsUsed.size) {
    lines.push('\\usepackage{xcolor}')
    for (const [name, hex] of Object.entries(HIGHLIGHT_COLORS)) {
      if (colorsUsed.has(name)) lines.push(`\\definecolor{hl${capitalize(name)}}{HTML}{${lstrip(hex, '#')}}`)
    }
  }
  if (hasComments) lines.push('\\usepackage[colorinlistoftodos]{todonotes}')
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
const wrapMulticols = (body: string, n: number) => `\\begin{multicols}{${n}}\n${body}\\end{multicols}\n`

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
  return [body, NATBIB_STYLES.has(style)]
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
  return `\\usepackage[${page.geometry_option},`
    + `top=${pyFloat(m.margin_top_cm)}cm,bottom=${pyFloat(m.margin_bottom_cm)}cm,`
    + `left=${pyFloat(m.margin_left_cm)}cm,right=${pyFloat(m.margin_right_cm)}cm]{geometry}`
}

export function serializeDocument(doc: Document): string {
  const m = doc.meta
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
  for (const p of tablePackages(doc)) {
    if (p === 'colortbl' && !pkgList.includes('xcolor')) pkgList.push('xcolor')  // \cellcolor[HTML]
    if (!pkgList.includes(p) && !m.preamble_extras.includes(`{${p}}`)) pkgList.push(p)
  }
  const pkgLines = pkgList.map((p) => `\\usepackage{${p}}`).join('\n')
  let packages = geometry ? strip(geometry + '\n' + pkgLines) : pkgLines
  if (preambleExtras) packages += '\n' + preambleExtras
  // User preamble (\lstset, \definecolor, \hypersetup, \newcommand...),
  // preserved verbatim from the imported .tex.
  if (m.preamble_extras && strip(m.preamble_extras)) packages += '\n' + strip(m.preamble_extras)
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
      bodyParts.push(serializeBlock(b, { hasChapters, floatH: !isJournal }))
      if (i < bodyBlocks.length - 1) bodyParts.push('\n')
    })
    let body = bodyParts.join('')
    if ((m.column_count ?? 1) >= 3) body = wrapMulticols(body, m.column_count)

    let natbib: boolean
    [body, natbib] = withKherverefBibliography(doc, body)
    if (natbib) packages = withNatbib(packages, m)
    packages = withUrlBreaking(packages, packages, frontmatter, body)
    return `${documentclassLine(m)}\n${packages}\n\\begin{document}\n${frontmatter}${body}\\end{document}\n`
  }

  // Standard classes: title and author in the preamble, abstract and
  // keywords inline. Journal classes whose preamble_extras (or Wiley-style
  // frontmatter_extras) already carry \title / \author get no duplicates.
  const extrasSrc = m.preamble_extras || ''
  const fmExtras = strip(m.frontmatter_extras || '')
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
      const rendered = serializeBlock(block, { hasChapters, floatH: !isJournal })
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
  return `${documentclassLine(m)}\n${packages}\n${preambleMeta}\\begin{document}\n${body}\\end{document}\n`
}

// ==================== Multi-chapter project ====================

// Body-only LaTeX for an \include'd chapter file.
export function serializeChapterBody(doc: Document): string {
  const m = doc.meta
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
    parts.push(serializeBlock(block, { hasChapters, floatH: !isJournal }))
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
  let runningPageOffset = 0
  // \frontmatter / \mainmatter / \backmatter exist only in book-like classes
  // and the chapter counter only where \chapter does.
  const klass = (m.documentclass || '').toLowerCase()
  const hasMatter = ['book', 'memoir', 'scrbook', 'amsbook'].includes(klass)
  for (const ch of proj.chapters) {
    const cmds: string[] = []
    const ctype = ch.chapter_type ?? 'chapter'
    if (ctype !== prevType) {
      if (ctype === 'frontmatter' && hasMatter) {
        cmds.push('\\frontmatter')
      } else if (ctype === 'chapter' && (prevType === 'frontmatter' || prevType === null)) {
        if (hasMatter) cmds.push('\\mainmatter')
        runningChapter = 0
      } else if (ctype === 'appendix') {
        cmds.push('\\appendix')
        runningChapter = 0
      } else if (ctype === 'backmatter' && hasMatter) {
        cmds.push('\\backmatter')
      }
      prevType = ctype
    }

    const chNum = ch.chapter_number ?? null
    if (ctype === 'chapter') runningChapter = chNum !== null ? chNum : runningChapter + 1

    if (ch.numbering !== prevNumbering) {
      cmds.push(`\\pagenumbering{${ch.numbering}}`)
      prevNumbering = ch.numbering
    }

    if (!ch.enabled) {
      runningPageOffset += ch.last_known_pages || 0
      continue
    }

    // Auto numbering lets LaTeX carry the page on from the previous
    // document; start_page is then only what the Documents panel shows.
    if (ch.start_page !== null && ch.start_page !== undefined && !proj.auto_page_numbers) {
      cmds.push(`\\setcounter{page}{${ch.start_page}}`)
    } else if (runningPageOffset > 0) {
      cmds.push(`\\addtocounter{page}{${runningPageOffset}}`)
      runningPageOffset = 0
    }

    if (ctype === 'chapter' && hasChapter) cmds.push(`\\setcounter{chapter}{${runningChapter - 1}}`)

    if (cmds.length) bodyParts.push(cmds.join('\n') + '\n')
    // \include starts a new page — right for chapters, wrong for the parts
    // of an article, which should run on.
    const cmd = hasChapter ? 'include' : 'input'
    bodyParts.push(`\\${cmd}{${chapterStem(ch)}}\n`)
  }

  const body = bodyParts.join('\n')
  return `${documentclassLine(m)}\n${packages}\n${classSetup}${preambleMeta}`
    + `\\begin{document}\n${body}${bibLines}\\end{document}\n`
}
