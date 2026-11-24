// Insert ▸ Illustrations' drawn elements: checklist, progress bars,
// timeline, QR code and code listing. Each is an ordinary RawLatex block
// whose first line is "% kTeX <kind> {settings as JSON}", then the LaTeX
// made from those settings. The .ktex format is unchanged (the Python app
// sees raw LaTeX), the editor draws the element from the settings, and its
// contextual tab rewrites the block when an option changes.
//
// Pure: no DOM. The packages each element needs come from widgetPreamble.

export type WidgetKind = 'checklist' | 'progress' | 'timeline' | 'qrcode' | 'code'

export const WIDGET_NAMES: Record<WidgetKind, string> = {
  checklist: 'Checklist', progress: 'Progress Bars', timeline: 'Timeline', qrcode: 'QR Code', code: 'Code Listing',
}

export interface ChecklistData { title: string; items: { text: string; done: boolean }[]; style: 'box' | 'circle'; columns: number; grey_done: boolean; color: string }
export interface ProgressData { items: { label: string; value: number }[]; style: 'rounded' | 'square' | 'thin'; length: 'short' | 'medium' | 'long'; percent: boolean; color: string }
export interface TimelineData { events: { date: string; title: string; text: string }[]; layout: 'vertical' | 'horizontal'; color: string }
export interface QrData { url: string; size: number; align: 'left' | 'center' | 'right'; caption: string; color: string }
export interface CodeData { code: string; language: string; theme: 'light' | 'dark' | 'plain'; numbers: boolean; frame: boolean; title: string }

export type WidgetData = {
  checklist: ChecklistData; progress: ProgressData; timeline: TimelineData; qrcode: QrData; code: CodeData
}

export interface Widget<K extends WidgetKind = WidgetKind> { kind: K; data: WidgetData[K] }

export const WIDGET_COLORS: [string, string][] = [
  ['1F6FB5', 'Blue'], ['2E7D32', 'Green'], ['00838F', 'Teal'], ['6A1B9A', 'Purple'],
  ['E65100', 'Orange'], ['C62828', 'Red'], ['37474F', 'Slate'], ['000000', 'Black'],
]

// Code listing languages: [shown name, listings' name ('' = none)].
export const CODE_LANGUAGES: [string, string][] = [
  ['Python', 'Python'], ['C', 'C'], ['C++', 'C++'], ['Java', 'Java'], ['JavaScript', 'JavaScript'],
  ['MATLAB', 'Matlab'], ['R', 'R'], ['Bash', 'bash'], ['SQL', 'SQL'], ['HTML', 'HTML'],
  ['LaTeX', '[LaTeX]TeX'], ['Fortran', 'Fortran'], ['Plain text', ''],
]

export const DEFAULTS: WidgetData = {
  checklist: {
    title: 'Before you submit', style: 'box', columns: 1, grey_done: true, color: '1F6FB5',
    items: [{ text: 'Title page and abstract', done: true }, { text: 'Figures numbered and captioned', done: true },
      { text: 'References checked', done: false }, { text: 'Spelling checked', done: false }],
  },
  progress: {
    style: 'rounded', length: 'medium', percent: true, color: '1F6FB5',
    items: [{ label: 'Literature review', value: 100 }, { label: 'Experiments', value: 70 },
      { label: 'Data analysis', value: 40 }, { label: 'Writing', value: 15 }],
  },
  timeline: {
    layout: 'vertical', color: '1F6FB5',
    events: [{ date: '2024', title: 'Project starts', text: 'Funding secured and team recruited.' },
      { date: '2025', title: 'First results', text: 'Prototype tested in the laboratory.' },
      { date: '2026', title: 'Publication', text: 'Results published and presented.' }],
  },
  qrcode: { url: 'https://www.latex-project.org', size: 3, align: 'center', caption: 'Scan for more', color: '000000' },
  code: {
    language: 'Python', theme: 'light', numbers: true, frame: true, title: '',
    code: 'def mean(values):\n    """The average of a list of numbers."""\n    return sum(values) / len(values)\n\nprint(mean([2, 4, 9]))  # 5.0',
  },
}

const MARK_RE = /^%\s*kTeX\s+(checklist|progress|timeline|qrcode|code)\s+(\{.*\})\s*$/

// The element a raw block holds, or null.
export function parseWidget(text: string): Widget | null {
  const nl = text.indexOf('\n')
  const m = MARK_RE.exec(nl < 0 ? text : text.slice(0, nl))
  if (!m) return null
  try {
    const kind = m[1] as WidgetKind
    return { kind, data: { ...DEFAULTS[kind], ...JSON.parse(m[2]) } } as Widget
  } catch {
    return null
  }
}

// The block's whole text: the settings line, then the LaTeX.
export function widgetText<K extends WidgetKind>(kind: K, data: WidgetData[K]): string {
  return `% kTeX ${kind} ${JSON.stringify(data)}\n` + widgetLatex(kind, data)
}

export function defaultWidgetText(kind: WidgetKind): string {
  return widgetText(kind, structuredClone(DEFAULTS[kind]))
}

// LaTeX special characters in plain text.
export function tex(s: string): string {
  return s.replace(/[\\{}$&#^_%~]/g, c => c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\^{}' : c === '~' ? '\\~{}' : '\\' + c)
}

const hex = (c: string) => (/^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '') : '1F6FB5').toUpperCase()
const pct = (v: number) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))

export function widgetLatex<K extends WidgetKind>(kind: K, data: WidgetData[K]): string {
  switch (kind) {
    case 'checklist': return checklistLatex(data as ChecklistData)
    case 'progress': return progressLatex(data as ProgressData)
    case 'timeline': return timelineLatex(data as TimelineData)
    case 'qrcode': return qrLatex(data as QrData)
    default: return codeLatex(data as CodeData)
  }
}

function checklistLatex(d: ChecklistData): string {
  const shape = d.style === 'circle' ? '(0.8ex,0) circle (0.8ex)' : '(0,-0.8ex) rectangle (1.6ex,0.8ex)'
  const corners = d.style === 'circle' ? '' : ',rounded corners=1pt'
  const off = `\\tikz[baseline=-0.55ex]\\draw[kW,line width=0.7pt${corners}] ${shape};`
  const on = `\\tikz[baseline=-0.55ex]{\\draw[kW,line width=0.7pt${corners},fill=kW!12] ${shape};`
    + '\\draw[kW,line width=1.1pt,line cap=round,line join=round] (0.3ex,0) -- (0.7ex,-0.4ex) -- (1.35ex,0.5ex);}'
  const cols = Math.max(1, Math.min(3, Math.round(d.columns) || 1))
  const out = [`\\begingroup\\definecolor{kW}{HTML}{${hex(d.color)}}`]
  if (d.title.trim()) out.push(`\\par\\noindent{\\bfseries\\color{kW}${tex(d.title.trim())}}\\par`)
  if (cols > 1) out.push(`\\begin{multicols}{${cols}}`)
  out.push('\\begin{list}{}{\\setlength{\\leftmargin}{1.9em}\\setlength{\\labelwidth}{1.4em}\\setlength{\\labelsep}{0.5em}'
    + '\\setlength{\\itemsep}{2pt}\\setlength{\\topsep}{3pt}\\setlength{\\parsep}{0pt}}')
  for (const it of d.items.length ? d.items : [{ text: '', done: false }]) {
    const txt = tex(it.text)
    out.push(`\\item[{${it.done ? on : off}}] ${it.done && d.grey_done ? `{\\color{gray}${txt}}` : txt}`)
  }
  out.push('\\end{list}')
  if (cols > 1) out.push('\\end{multicols}')
  out.push('\\endgroup')
  return out.join('\n') + '\n'
}

export const PROGRESS_CM: Record<ProgressData['length'], number> = { short: 4, medium: 7, long: 10 }

function progressLatex(d: ProgressData): string {
  const L = PROGRESS_CM[d.length] ?? 7
  const h = d.style === 'thin' ? 0.35 : 0.9
  const rc = d.style === 'square' ? '' : `,rounded corners=${h}ex`
  const out = [`\\begingroup\\definecolor{kW}{HTML}{${hex(d.color)}}\\renewcommand{\\arraystretch}{1.5}`,
    `\\par\\noindent\\begin{tabular}{@{}l@{\\hspace{1em}}l${d.percent ? '@{\\hspace{0.6em}}r' : ''}@{}}`]
  for (const it of d.items) {
    const v = pct(it.value)
    const w = Math.round(L * v) / 100
    const bar = `\\tikz[baseline=-0.6ex]{\\fill[kW!18${rc}] (0,-${h}ex) rectangle (${L}cm,${h}ex);`
      + (v > 0 ? `\\fill[kW${rc}] (0,-${h}ex) rectangle (${w}cm,${h}ex);` : '') + '}'
    out.push(`${tex(it.label)} & ${bar}${d.percent ? ` & ${v}\\%` : ''} \\\\`)
  }
  out.push('\\end{tabular}\\par', '\\endgroup')
  return out.join('\n') + '\n'
}

function timelineLatex(d: TimelineData): string {
  const ev = d.events.length ? d.events : [{ date: '', title: '', text: '' }]
  const out = [`\\begingroup\\definecolor{kW}{HTML}{${hex(d.color)}}`, '\\begin{center}']
  const body = (e: TimelineData['events'][number], sep: string) =>
    (e.title.trim() ? `\\textbf{${tex(e.title)}}` : '') + (e.title.trim() && e.text.trim() ? sep : '')
    + (e.text.trim() ? `{\\small ${tex(e.text).replace(/\n/g, ' ')}}` : '')
  if (d.layout === 'horizontal') {
    const n = ev.length
    const unit = (0.98 / n).toFixed(4)
    out.push(`\\begin{tikzpicture}[x={${unit}\\linewidth}]`)
    out.push(`\\draw[kW!40,line width=1.2pt] (0,0) -- (${n},0);`)
    ev.forEach((e, i) => {
      const x = i + 0.5
      out.push(`\\fill[kW] (${x},0) circle (3pt);`)
      out.push(`\\node[above=5pt,font=\\bfseries\\small,text=kW] at (${x},0) {${tex(e.date)}};`)
      out.push(`\\node[below=7pt,text width=${(0.9 * 0.98 / n).toFixed(4)}\\linewidth,align=center] at (${x},0) {${body(e, '\\\\')}};`)
    })
  } else {
    out.push('\\begin{tikzpicture}[ev/.style={text width=0.6\\linewidth,anchor=north west,inner sep=0pt,align=left}]')
    ev.forEach((e, i) => {
      const at = i === 0 ? '(0,0)' : `([yshift=-5mm]e${i}.south west)`
      out.push(`\\node[ev] (e${i + 1}) at ${at} {${body(e, '\\\\[1pt]') || '~'}};`)
    })
    const dot = (i: number) => `([xshift=-4mm,yshift=-1.1ex]e${i}.north west)`
    if (ev.length > 1) out.push(`\\draw[kW!40,line width=1.2pt] ${dot(1)} -- ${dot(ev.length)};`)
    ev.forEach((e, i) => {
      out.push(`\\fill[kW] ${dot(i + 1)} circle (3pt);`)
      out.push(`\\node[anchor=north east,inner sep=0pt,font=\\bfseries,text=kW] at ([xshift=-8mm]e${i + 1}.north west) {${tex(e.date)}};`)
    })
  }
  out.push('\\end{tikzpicture}', '\\end{center}', '\\endgroup')
  return out.join('\n') + '\n'
}

// \qrcode's own escapes: a backslash before each special character.
const qrEscape = (s: string) => s.replace(/[\\{}#%&$^_~]/g, c => '\\' + c)

function qrLatex(d: QrData): string {
  const env = d.align === 'left' ? 'flushleft' : d.align === 'right' ? 'flushright' : 'center'
  const size = Math.max(1, Math.min(12, Number(d.size) || 3))
  const out = [`\\begin{${env}}`,
    `{\\color[HTML]{${hex(d.color)}}\\qrcode[height=${size}cm]{${qrEscape(d.url.trim() || ' ')}}}`
      + (d.caption.trim() ? '\\\\[3pt]' : '')]
  if (d.caption.trim()) out.push(`{\\small ${tex(d.caption.trim())}}`)
  out.push(`\\end{${env}}`)
  return out.join('\n') + '\n'
}

export const CODE_THEMES: Record<CodeData['theme'], { bg: string; text: string; kw: string; comment: string; string: string; rule: string }> = {
  light: { bg: 'F6F8FA', text: '24292E', kw: '0550AE', comment: '6A737D', string: '0A7F3F', rule: 'D0D7DE' },
  dark: { bg: '263238', text: 'ECEFF1', kw: '82AAFF', comment: '8A9BA3', string: 'C3E88D', rule: '263238' },
  plain: { bg: 'FFFFFF', text: '000000', kw: '000000', comment: '555555', string: '000000', rule: '999999' },
}

function codeLatex(d: CodeData): string {
  const th = CODE_THEMES[d.theme] ?? CODE_THEMES.light
  const lang = CODE_LANGUAGES.find(([n]) => n === d.language)?.[1] ?? ''
  const opts = [
    ...(lang ? [`language=${lang}`] : []),
    `basicstyle={\\ttfamily\\small\\color[HTML]{${th.text}}}`,
    `keywordstyle={\\color[HTML]{${th.kw}}\\bfseries}`,
    `commentstyle={\\color[HTML]{${th.comment}}}`,
    `stringstyle={\\color[HTML]{${th.string}}}`,
    ...(d.theme !== 'plain' ? [`backgroundcolor={\\color[HTML]{${th.bg}}}`] : []),
    ...(d.numbers ? ['numbers=left', 'numberstyle=\\tiny\\color{gray}', 'numbersep=8pt', 'xleftmargin=1.6em', 'framexleftmargin=1.6em'] : []),
    ...(d.frame ? ['frame=single', `rulecolor={\\color[HTML]{${th.rule}}}`, ...(d.theme === 'dark' ? ['framerule=0pt'] : [])] : ['frame=none']),
    'framesep=4pt',
    'breaklines=true', 'showstringspaces=false', 'columns=fullflexible', 'keepspaces=true', 'tabsize=4',
    'aboveskip=8pt', 'belowskip=8pt',
    ...(d.title.trim() ? [`title={${tex(d.title.trim())}}`] : []),
  ]
  const code = d.code.replace(/\\end\{lstlisting\}/g, '\\end {lstlisting}')
  return `\\begin{lstlisting}[${opts.join(',')}]\n${code}\n\\end{lstlisting}\n`
}

// --------------------------------------------------- packages and preamble

// Every piece of raw LaTeX in the document: RawLatex blocks and InlineRaw
// inlines, wherever they are (paragraphs, lists, table cells, footnotes).
export function rawTexts(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) { for (const n of node) rawTexts(n, out); return out }
  if (!node || typeof node !== 'object') return out
  const o = node as Record<string, unknown>
  if (o.type === 'RawLatex' && typeof o.text === 'string') out.push(o.text)
  if (o.type === 'InlineRaw' && typeof o.latex === 'string') out.push(o.latex)
  for (const k of ['children', 'items']) if (o[k]) rawTexts(o[k], out)
  return out
}

// [packages, preamble lines] for the elements, margin notes and drop caps
// the document uses.
export function widgetPreamble(texts: string[]): [string[], string] {
  const kinds = new Set<string>()
  let margin = false, drop = false, js = false
  for (const t of texts) {
    const w = parseWidget(t)
    if (w) {
      kinds.add(w.kind)
      if (w.kind === 'code' && (w.data as CodeData).language === 'JavaScript') js = true
    }
    if (t.includes("\\kMarginNote")) margin = true
    if (/\\lettrine\b/.test(t)) drop = true
  }
  const pkgs: string[] = []
  const defs: string[] = []
  if (kinds.size || margin) pkgs.push('xcolor')
  if (kinds.has('checklist') || kinds.has('progress') || kinds.has('timeline')) pkgs.push('tikz')
  if (kinds.has('qrcode')) pkgs.push('qrcode')
  if (kinds.has('code')) pkgs.push('listings')
  if (margin) {
    defs.push(MARGIN_NOTE_DEF)
  }
  if (drop) pkgs.push('lettrine')
  if (js) {
    defs.push('\\lstdefinelanguage{JavaScript}{morekeywords={break,case,catch,class,const,continue,default,delete,do,else,'
      + 'export,extends,false,finally,for,function,if,import,in,instanceof,let,new,null,return,switch,this,throw,true,try,'
      + 'typeof,var,void,while,yield,async,await},sensitive=true,morecomment=[l]{//},morecomment=[s]{/*}{*/},'
      + 'morestring=[b]",morestring=[b]\',morestring=[b]`}')
  }
  return [pkgs, defs.join('\n')]
}

// Layout ▸ Margin Note: \kMarginNote[<colour>]{<style>}{<text>} -
// style is "plain", "line" (a coloured rule beside it) or "box"
// (a tinted box).
export const MARGIN_NOTE_DEF = '\\AtBeginDocument{\\setlength{\\marginparsep}{4mm}\\setlength{\\marginparwidth}'
  + '{\\dimexpr\\paperwidth-\\textwidth-\\oddsidemargin-1in-\\hoffset-\\marginparsep-5mm\\relax}}'
  + '\n\\providecommand{\\kMarginNote}[3][1F6FB5]{\\marginpar{\\begingroup\\definecolor{kMN}{HTML}{#1}'
  + '\\footnotesize\\raggedright\\csname kMN@#2\\endcsname{#3}\\endgroup}}'
  + '\n\\makeatletter'
  + '\n\\providecommand{\\kMN@plain}[1]{\\color{kMN}#1}'
  + '\n\\providecommand{\\kMN@line}[1]{{\\color{kMN}\\vrule width 1.5pt}\\hspace{4pt}\\parbox[t]{\\dimexpr\\marginparwidth-6pt}{#1}}'
  + '\n\\providecommand{\\kMN@box}[1]{\\fcolorbox{kMN}{kMN!8}{\\parbox[t]{\\dimexpr\\marginparwidth-2\\fboxsep-2\\fboxrule}{#1}}}'
  + '\n\\makeatother'

// Plain text back from tex().
export function untex(s: string): string {
  return s.replace(/\\textbackslash\{\}/g, '\\').replace(/\\\^\{\}/g, '^').replace(/\\~\{\}/g, '~').replace(/\\([{}$&#_%])/g, '$1')
}

// ------------------------------------------------------------ margin notes

export type MarginNoteStyle = 'plain' | 'line' | 'box'
export interface MarginNote { color: string; style: MarginNoteStyle; text: string }

export const marginNoteLatex = (n: MarginNote): string =>
  `\\kMarginNote[${hex(n.color)}]{${n.style}}{${tex(n.text).replace(/\n+/g, ' ')}}`

export function parseMarginNote(latex: string): MarginNote | null {
  const m = /^\\kMarginNote\[([0-9A-Fa-f]{6})\]\{(plain|line|box)\}\{([\s\S]*)\}$/.exec(latex.trim())
  return m ? { color: m[1].toUpperCase(), style: m[2] as MarginNoteStyle, text: untex(m[3]) } : null
}

// --------------------------------------------------------------- drop caps

export interface DropCap { lines: number; letter: string; rest: string; color: string; margin: boolean; smallcaps: boolean }

export function dropCapLatex(d: DropCap): string {
  const c = hex(d.color)
  const letter = c === '000000' ? tex(d.letter) : `\\textcolor[HTML]{${c}}{${tex(d.letter)}}`
  const lines = Math.max(2, Math.min(5, Math.round(d.lines) || 3))
  return `\\lettrine[lines=${lines}${d.margin ? ',lhang=1' : ''}]{${letter}}{${d.smallcaps ? '' : '\\normalfont '}${tex(d.rest)}}`
}

export function parseDropCap(latex: string): DropCap | null {
  const m = /^\\lettrine\[([^\]]*)\]\{(?:\\textcolor\[HTML\]\{([0-9A-Fa-f]{6})\}\{([^{}]+)\}|([^{}]+))\}\{(\\normalfont )?([^{}]*)\}$/.exec(latex.trim())
  if (!m) return null
  const opts = m[1]
  return {
    lines: Number(/lines=(\d)/.exec(opts)?.[1] ?? 3), margin: /lhang=1/.test(opts),
    color: (m[2] ?? '000000').toUpperCase(), letter: untex(m[3] ?? m[4]), smallcaps: !m[5], rest: untex(m[6]),
  }
}
