// The PDF's geometry on screen: per-block fonts, margins, line heights,
// indents, heading / theorem / equation numbers and the labels a class
// prints around blocks. A port of DocumentEditor._apply_page_layout and
// its helpers (editor.py), computed from the ProseMirror document instead
// of QTextBlock formats. Pixel values are at 100 % zoom; App scales the
// whole page.
import { formatDate } from '../core/dateFormat.ts'
import type { PdfTypography } from '../app/pageAnchors.ts'
import type { Node as PMNode } from 'prosemirror-model'
import { classSupportsChapter, THEOREM_KINDS, type DocMeta } from '../core/model.ts'
import { byCode, DPI } from '../core/pageSizes.ts'
import { lookFor, numberLabel, type LabelSpec, type Look, type StyleKey, type StyleSpec } from './classLooks.ts'
import { moderncvLook } from './cvView.ts'
import { posterLook } from './posterView.ts'
import { baselineskipPt, pdfFont, type ScreenFont } from './latexFonts.ts'

// Where Qt puts the baseline within a fixed-height line, from the line's
// top (Latin Modern's ascent over its line height).
export const BASELINE_AT = 0.79
export const PX_PER_CM = 96 / 2.54
export const PT_PX = 96 / 72
// Latin Modern's hhea ascent + descent: QFontMetricsF.height() in em.
export const FONT_HEIGHT_EM = 1.407

// ---- per-block user state encoding (editor.py) ----
export const S = {
  PARAGRAPH: 0, TITLE: 7, AUTHOR: 8, ABSTRACT: 9, KEYWORDS: 10, CHAPTER: 11,
  FRAME: 12, AFFILIATION: 13, CORRESPONDENCE: 14, THEOREM: 15,
  HEADING_STAR_BASE: 20, CHAPTER_STAR: 31, MATH_BLOCK: 99, FIGURE: 100, TABLE: 101, RAW: 102,
} as const

const TITLE_BLOCK_KEYS: Record<number, StyleKey> = {
  [-1]: 'title', [-2]: 'author', [-3]: 'abstract', [-4]: 'keywords',
  [-6]: 'frame', [-7]: 'affiliation', [-8]: 'correspondence',
}

// apply_heading's code for a text-block style, null for anything that is
// not a styled text line.
export function styleCode(state: number): number | null {
  switch (state) {
    case S.PARAGRAPH: return 0
    case S.TITLE: return -1
    case S.AUTHOR: return -2
    case S.ABSTRACT: return -3
    case S.KEYWORDS: return -4
    case S.CHAPTER: case S.CHAPTER_STAR: return -5
    case S.FRAME: return -6
    case S.AFFILIATION: return -7
    case S.CORRESPONDENCE: return -8
  }
  if (state >= 1 && state <= 5) return state
  if (state > S.HEADING_STAR_BASE && state <= S.HEADING_STAR_BASE + 5) return state - S.HEADING_STAR_BASE
  return null
}

// The look entry that draws a block in this state.
export function styleKey(state: number): StyleKey | null {
  const code = styleCode(state)
  if (code === null || code === 0) return null
  if (code === -5) return 'h1'
  return TITLE_BLOCK_KEYS[code] ?? (`h${code}` as StyleKey)
}

// The Qt user state a ProseMirror text node stands for.
export function stateOf(node: PMNode): number {
  const a = node.attrs
  switch (node.type.name) {
    case 'paragraph': case 'list_item': return S.PARAGRAPH
    case 'title': return S.TITLE
    case 'author': return S.AUTHOR
    case 'abstract': return S.ABSTRACT
    case 'keywords': return S.KEYWORDS
    case 'frame': return S.FRAME
    case 'affiliation': return S.AFFILIATION
    case 'correspondence': return S.CORRESPONDENCE
    case 'theorem': return S.THEOREM
    case 'section':
      if (a.level === 0) return a.numbered ? S.CHAPTER : S.CHAPTER_STAR
      return a.numbered ? a.level : S.HEADING_STAR_BASE + a.level
    case 'math_block': return S.MATH_BLOCK
    case 'figure': return S.FIGURE
    case 'table': return S.TABLE
    default: return S.RAW
  }
}

// The editor's screen family: the user's explicit choice, or the PDF's.
const SCREEN_FONTS_FOR_LATEX: Record<string, string[]> = {
  default: ['Latin Modern Roman', 'LM Roman 10', 'CMU Serif', 'Computer Modern', 'Times New Roman', 'Times'],
  times: ['Times New Roman', 'Times', 'TeX Gyre Termes', 'Nimbus Roman'],
  palatino: ['Palatino Linotype', 'Palatino', 'TeX Gyre Pagella', 'Book Antiqua'],
  helvetica: ['Helvetica', 'Arial', 'TeX Gyre Heros', 'Liberation Sans'],
  courier: ['Courier New', 'Courier', 'TeX Gyre Cursor'],
  charter: ['Charter', 'Bitstream Charter', 'XCharter'],
  libertine: ['Linux Libertine O', 'Linux Libertine', 'Libertinus Serif'],
}

export function screenFontFor(meta: DocMeta): string {
  const chosen = meta.visual_font_family
  if (chosen && chosen !== 'Georgia') return `'${chosen}'`
  if (meta.body_font_family === 'default') return pdfFont(moderncvLook(lookFor(meta.documentclass, meta.body_font_pt), meta).body.font).family
  const list = SCREEN_FONTS_FOR_LATEX[meta.body_font_family]
  if (list) return [...list, chosen || 'Georgia'].map(f => `'${f}'`).join(', ') + ', serif'
  return `'${chosen || 'Georgia'}'`
}

export interface CharStyle {
  family: string
  sizePx: number
  bold: boolean
  italic: boolean
  upper: boolean
  // '' = the page's own text colour.
  color: string
}

export interface PaintedLabel {
  text: string
  family: string
  bold: boolean
  italic: boolean
  color: string
  sizePx: number
  // Baseline above the block's first baseline, px (negative: below).
  up: number
  centred: boolean
  // The \\maketitle date (right-click: remove it or change its format).
  date?: boolean
  // Run-in labels: x from the line start.
  left?: number
}

export interface BlockLayout {
  pos: number
  // Position of the item inside its list, for list items.
  state: number
  char: CharStyle | null
  align: 'left' | 'center' | 'right' | 'justify'
  // Qt block format margins (px), before collapsing.
  top: number
  bottom: number
  left: number
  right: number
  indent: number
  // px, 'normal' or a proportional factor.
  lineHeight: number | 'normal' | { proportional: number }
  // Painted before the first line, as HEADING_NUMBER / THEOREM_LABEL.
  number: string
  numberGap: number
  numberStyle: 'heading' | 'theorem' | 'proof' | null
  equationNumber: string
  above: PaintedLabel[]
  runIn: PaintedLabel | null
  breakBefore: boolean
  // CSS margin-top after Qt's margin collapsing.
  gap: number
  // A heading the next paragraph's first line continues on (\paragraph).
  runInHeading?: boolean
  spans?: boolean
  // A first line grown tall to set its baseline low: Qt puts the baseline
  // at BASELINE_AT of that height; CSS gets there with padding.
  tall?: { lead: number; padTop: number; padBottom: number }
  // Room under a block for a label painted below it (the \\maketitle date
  // under a title block that runs across the columns).
  padBottom?: number
  // A thebibliography block, drawn as the reference list LaTeX prints:
  // its unnumbered title (\refname / \bibname) and the entries.
  bib?: { title: string; titleChar: CharStyle; bodyChar: CharStyle }
}

export interface RunningHead {
  pos: number; isChapter: boolean; text: string; level: number; title: string; number: string
}

export interface PageGeometry {
  widthPx: number
  heightPx: number
  topPx: number
  bottomPx: number
  leftPx: number
  rightPx: number
  cols: number
  colGapPx: number
}

export interface DocLayout {
  look: Look
  geometry: PageGeometry
  blocks: BlockLayout[]
  heads: RunningHead[]
  bodyChar: CharStyle
  fields: Record<string, string>
  // The reference list LaTeX prints at the end (\bibliography): its
  // title and the title's look.
  bibTitle: { title: string; titleChar: CharStyle }
}

interface LBlock {
  node: PMNode
  pos: number
  state: number
  text: string
  isTable: boolean
  item?: { index: number; count: number }
}

// The text the Qt block holds: inline objects count as characters.
function blockText(node: PMNode): string {
  if (node.type.name === 'math_block') return node.attrs.latex
  if (node.type.name === 'raw_float') return node.attrs.text
  let s = ''
  node.descendants(n => {
    if (n.isText) s += n.text
    else if (n.isInline && n.isLeaf) s += n.type.name === 'line_sep' ? ' ' : '￼'
    return true
  })
  return s
}

function collect(doc: PMNode): LBlock[] {
  const out: LBlock[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'list') {
      node.forEach((item, o) => {
        out.push({
          node: item, pos: offset + 1 + o, state: S.PARAGRAPH, text: blockText(item), isTable: false,
          item: { index: out.length, count: node.childCount },
        })
      })
      // Fix the item numbers relative to the list.
      const first = out.length - node.childCount
      for (let i = first; i < out.length; i++) out[i].item!.index = i - first
      return
    }
    const isTable = node.type.name === 'table' || node.type.name === 'figure'
    out.push({ node, pos: offset, state: stateOf(node), text: isTable ? '' : blockText(node), isTable })
  })
  return out
}

const NUMBERABLE_ENV_RE = /\\begin\{((?:align|gather|multline|flalign|alignat|eqnarray)\*?)\}/

export function mathBlockIsNumbered(latex: string, numbered: boolean): boolean {
  const m = NUMBERABLE_ENV_RE.exec(latex)
  if (m) return !m[1].endsWith('*')
  return !!numbered
}

// Text width measurement for run-in headings and labels.
let canvas: CanvasRenderingContext2D | null | undefined
export function textWidth(text: string, c: { family: string; sizePx: number; bold: boolean; italic: boolean }): number {
  if (canvas === undefined) {
    canvas = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  }
  if (!canvas) return text.length * c.sizePx * 0.5
  canvas.font = `${c.italic ? 'italic ' : ''}${c.bold ? '700' : '400'} ${c.sizePx}px ${c.family}`
  return canvas.measureText(text).width
}

const TODAY = () => new Date()
// `pdfBreaks`: the blocks the compiled PDF starts a page with; with
// `pdfPaged` those are the title-page breaks too, in place of the ones the
// class look predicts (a short abstract shares its page with the keywords).
//
// `pdf`: the compiled PDF's body size and columns. When the PDF's body
// size differs from the class look's (the look measured the class at its
// default size; [11pt]amsart prints at 10.95 pt), every size and space of
// the look is scaled to it; its columns replace the look's.
// A \setlength{\parskip}{...} among the document's own preamble lines (an
// imported Word document with no space between its paragraphs sets 0pt):
// it comes after KherveTeX's 0.8em in the LaTeX, so it is what the PDF uses.
export function parskipFromExtras(extras: string, emPx: number, pt: number): number | null {
  const ms = [...(extras || '').matchAll(/\\setlength\s*\{\s*\\parskip\s*\}\s*\{\s*(-?[\d.]+)\s*(pt|bp|em|ex|mm|cm|in)?\s*(?:plus[^}]*)?\}/g)]
  if (!ms.length) return null
  const m = ms[ms.length - 1]
  const v = parseFloat(m[1])
  if (!Number.isFinite(v)) return null
  const per: Record<string, number> = { pt, bp: pt * 72.27 / 72, em: emPx, ex: emPx * 0.43, mm: pt * 2.845, cm: pt * 28.45, in: pt * 72.27 }
  return Math.max(0, v * (per[m[2] ?? 'pt'] ?? pt))
}

export function layoutDocument(doc: PMNode, meta: DocMeta, headingOffset: number[] = [0, 0, 0, 0, 0, 0],
  pdfBreaks: ReadonlySet<number> = new Set(), pdfPaged = false, pdf: PdfTypography | null = null): DocLayout {
  // moderncv's own fonts and colours on its measured sizes (cvView.ts).
  const measured = posterLook(moderncvLook(lookFor(meta.documentclass, meta.body_font_pt), meta), meta, doc)
  const k = pdf ? pdf.bodyPt / measured.body.size : 1
  const scaled = pdf && Math.abs(k - 1) > 0.04 && k > 0.6 && k < 1.6 ? scaleLook(measured, k) : measured
  // Date switched off (Insert > Date): the page shows none, as \\date{}.
  const look = meta.show_date === false ? { ...scaled, date: undefined } : scaled
  const g = look.geometry
  const pt = PT_PX
  const page = byCode(meta.page_size)
  // A class with a fixed paper size prints on its own page.
  const followsPage = g.follows_page !== false
  const widthPx = followsPage ? Math.round(page.width_in * DPI) : Math.round(g.page_w * pt)
  const heightPx = followsPage ? Math.round(page.height_in * DPI) : Math.round(g.page_h * pt)
  // A class that ignores the document's margins prints with its own.
  const side = (key: 'top' | 'bottom' | 'left' | 'right', cm: number) => {
    const own = g[key]
    return g.follows_margins !== false || own === undefined || own === null ? cm * PX_PER_CM : own * pt
  }
  const topPx = side('top', meta.margin_top_cm)
  const geometry: PageGeometry = {
    widthPx, heightPx, topPx, bottomPx: side('bottom', meta.margin_bottom_cm),
    leftPx: side('left', meta.margin_left_cm), rightPx: side('right', meta.margin_right_cm),
    cols: g.follows_margins !== false ? Math.max(1, Math.trunc(meta.column_count || 1)) : Math.max(1, Math.trunc(g.cols || 1)),
    colGapPx: (g.colsep || 10) * pt,
  }
  if (pdf && pdf.cols !== geometry.cols) {
    geometry.cols = pdf.cols
    if (pdf.colGapPt) geometry.colGapPx = pdf.colGapPt * pt
  }

  const visual = screenFontFor(meta)
  const replaced = (meta.visual_font_family !== '' && meta.visual_font_family !== 'Georgia')
    || meta.body_font_family !== 'default'
  // Family, bold, italic for a PDF font; a roman font the user replaced
  // (Format > font) follows that choice, as the LaTeX does.
  const screenFont = (pdfName: string): ScreenFont => {
    const f = pdfFont(pdfName)
    if (replaced && !pdfName.includes('Sans')) return { ...f, family: visual }
    return f
  }
  const styleChar = (key: string, scale = 1): CharStyle => {
    const spec = ((look as unknown as Record<string, StyleSpec | undefined>)[key]) ?? look.body
    const f = screenFont(spec.font)
    const color = (spec as StyleSpec).color ?? '#000000'
    return {
      family: f.family, bold: f.bold, italic: f.italic, sizePx: spec.size * scale * pt,
      upper: !!(spec as StyleSpec).upper, color: color !== '#000000' ? color : '',
    }
  }
  const bodyChar: CharStyle = {
    family: visual, sizePx: look.body.size * pt, bold: false, italic: false, upper: false, color: '',
  }
  const classChapters = classSupportsChapter(meta.documentclass)
  const headingChar = (level: number): CharStyle =>
    level >= 1 ? styleChar(`h${level}`) : styleChar('h1', classChapters ? 1.0 : 1.44)
  const frameChar = (): CharStyle => look.frame ? styleChar('frame')
    : { family: 'system-ui, sans-serif', sizePx: 18 * pt, bold: true, italic: false, upper: false, color: '#1565C0' }
  const charFor = (state: number): CharStyle | null => {
    const code = styleCode(state)
    if (state === S.THEOREM) return bodyChar
    if (code === null) return null
    if (code === 0) return bodyChar
    if (code === -5) return headingChar(0)
    if (code === -6) return frameChar()
    if (code < 0) return styleChar(TITLE_BLOCK_KEYS[code])
    return headingChar(code)
  }

  const blocks = collect(doc)
  const labelEntry = (spec: LabelSpec | StyleSpec, text: string, upPx: number, centred: boolean): PaintedLabel => {
    const f = screenFont(spec.font)
    const color = spec.color ?? '#000000'
    return {
      text, family: f.family, bold: f.bold, italic: f.italic,
      color: color === '#000000' ? '' : color, sizePx: spec.size * pt, up: upPx, centred: !!centred,
    }
  }

  const body = look.body
  const emPx = body.size * pt
  const extrasParskip = meta.paragraph_indent ? null : parskipFromExtras(meta.preamble_extras, emPx, pt)
  const spacing = Math.max(0.5, Number(meta.line_spacing || 1.0))
  const stretch = baselineskipPt(meta.body_font_pt, spacing) / baselineskipPt(meta.body_font_pt, 1.0)
  const bodyLinePx = body.leading * stretch * pt

  // ---- _title_page_breaks ----
  const titleBreaks = new Set<number>()
  if (!pdfPaged && !(meta.class_options || '').includes('notitlepage')) {
    let pg: number | null = null
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.isTable || !b.text) continue
      const code = styleCode(b.state)
      const key = code !== null ? TITLE_BLOCK_KEYS[code] : undefined
      const spec = (k: string) => (look as unknown as Record<string, StyleSpec | undefined>)[k]
      if (key && key !== 'frame' && pg === null && key !== 'title') pg = spec(key)?.page ?? 0
      else if (key === 'title' && pg === null) pg = spec('title')?.page ?? 0
      if (pg === null) break
      let want: number
      if (key && key !== 'frame') {
        want = spec(key)?.page ?? pg
      } else {
        want = spec('h1')?.page ?? pg
        if (want > pg) titleBreaks.add(i)
        break
      }
      if (want > pg) { titleBreaks.add(i); pg = want }
    }
  }

  // ---- _date_blocks ----
  let dateLine = -1, afterDate = -1
  if (look.date) {
    let last = -1
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.isTable || !b.text) continue
      const code = styleCode(b.state)
      if (code === -1 || code === -2 || code === -7 || code === -8) last = i
      else { afterDate = last >= 0 ? i : -1; break }
    }
    dateLine = last
  }

  const hasChapterBlocks = blocks.some(b => b.state === S.CHAPTER)
  const offset = [...headingOffset]
  const hasChapters = hasChapterBlocks || offset[0] > 0 || classChapters
  const heads: RunningHead[] = []
  let spanning = true
  const counters = [...offset]
  let eq = 0, thm = 0
  let prevState: number | null = null
  let prevLead = body.leading
  const out: BlockLayout[] = []

  const styleLead = (key: StyleKey): number => {
    const spec = look[key] ?? body
    let lead = spec.size * 1.2
    if (key === 'abstract' || key === 'keywords') {
      const measured = (spec as StyleSpec).leading || 0
      if (spec.size < measured && measured < spec.size * 2) lead = measured
    }
    return lead
  }

  const runInPull = (headingLead: number) => -((1 - BASELINE_AT) * headingLead + BASELINE_AT * body.leading)

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const L: BlockLayout = {
      pos: b.pos, state: b.state, char: charFor(b.state), align: 'left', top: 0, bottom: 0, left: 0, right: 0,
      indent: 0, lineHeight: 'normal', number: '', numberGap: 0, numberStyle: null, equationNumber: '',
      above: [], runIn: null, breakBefore: false, gap: 0,
    }
    out.push(L)
    if (b.isTable) {
      // Table / figure frames: QTextTableFormat.setMargin (8 / 10 px).
      L.top = L.bottom = b.node.type.name === 'figure' ? 10 : 8
      continue
    }
    const state = b.state
    const node = b.node
    const text = b.text
    // Base block formats, as _render_block / _make_theorem_block set them.
    if (node.type.name === 'paragraph') L.align = node.attrs.alignment
    else if (state === S.THEOREM) {
      L.align = 'justify'
      L.top = node.attrs.start ? 6 : 0
      L.bottom = 6
    } else if (state === S.MATH_BLOCK) L.align = 'center'
    else if (state === S.TITLE || state === S.AUTHOR || state === S.AFFILIATION || state === S.CORRESPONDENCE) L.align = 'center'
    else if (state === S.RAW) { L.top = 6; L.bottom = 6 }

    // Start a new sheet exactly where the compiled PDF does; with columns
    // a forced break would only start a new column, so paging is left to
    // the layout there.
    let startsSheet = titleBreaks.has(i) || (geometry.cols <= 1 && pdfBreaks.has(b.pos))
    if (state === S.RAW && BIB_ENV_RE.test(text)) {
      L.bib = { title: classChapters ? 'Bibliography' : 'References', titleChar: styleChar('h1'), bodyChar }
      // \bibname is a \chapter*: a new page, unless the PDF says otherwise.
      if (classChapters && i !== 0 && !pdfPaged) startsSheet = true
    }
    L.breakBefore = startsSheet
    let number = ''
    let level: number | null = state === S.CHAPTER ? 0 : (state >= 1 && state <= 5 ? state : null)
    // report / book serialise Heading 1 as \chapter.
    if (classChapters && level) level -= 1
    if (level === 0 && text.trim() && i !== 0) {
      L.breakBefore = true
      startsSheet = true
    }
    if (level !== null) {
      if (level === 0) eq = 0
      counters[level] += 1
      for (let k = level + 1; k < counters.length; k++) counters[k] = 0
      const start = hasChapters ? 0 : 1
      number = counters.slice(start, level + 1).join('.')
      const chapterNumber = number
      const key = styleKey(state)!
      const spec = look[key] ?? ({} as StyleSpec)
      const aboveChapter = level === 0 && !!look.chapter_label
      if (!aboveChapter) number = numberLabel(spec.prefix ?? '', number)
      if ((level <= 1 || state <= 2) && text.trim()) {
        heads.push({
          pos: b.pos, isChapter: level === 0,
          text: (level === 0 ? `Chapter ${chapterNumber}. ` : number ? `${number} ` : '') + text.trim(),
          level: Math.max(1, state >= 1 && state <= 5 ? state : 1),
          title: text.trim(), number: level !== 0 ? number.replace(/\.+$/, '') : chapterNumber,
        })
      }
      if (aboveChapter) number = `Chapter ${chapterNumber}`
    }
    if (state === S.MATH_BLOCK && mathBlockIsNumbered(node.attrs.latex, node.attrs.numbered)) {
      eq += 1
      L.equationNumber = hasChapters ? `(${counters[0]}.${eq})` : `(${eq})`
    }
    if (state === S.MATH_BLOCK) {
      // \abovedisplayskip / \belowdisplayskip: 12pt at 12pt.
      L.top = 0.8 * emPx
      L.bottom = 0.8 * emPx
    }
    const key = styleKey(state)
    const nextIsBody = (() => {
      const n = blocks[i + 1]
      return !!n && !n.isTable && n.state === S.PARAGRAPH && !n.item
    })()
    const runInNext = !!(key && key.startsWith('h') && look[key]?.run_in && nextIsBody)
    let labels: PaintedLabel[] = []
    if (key) {
      labels = layOutStyled(L, key, startsSheet, prevState, state, i === afterDate, number, prevLead, i === 0,
        runInNext)
      const spans: boolean = spanning && geometry.cols > 1 && spansColumns(key)
      spanning = spans
      // \maketitle runs across the columns of the first sheet.
      L.spans = spans
    } else {
      spanning = false
    }
    if (i === dateLine && look.date) {
      const d = look.date
      const now = TODAY()
      const t = formatDate(meta.date_format ?? '', now, !!d.day_first)
      labels.push({ ...labelEntry(d as unknown as LabelSpec, t, -d.gap * pt, d.centred ?? true), date: true })
      // Across the columns the date must sit inside the title block: the
      // gap before the first body block would push down only its column.
      if (L.spans) L.padBottom = d.gap * pt
    }
    L.above = labels
    const onOwnLine = key === 'h1' && !!look.chapter_label && number.startsWith('Chapter ')
    if (!onOwnLine && number) {
      L.number = number
      L.numberStyle = 'heading'
      const gap = look[key ?? 'h1']?.num_gap
      const c = L.char ?? bodyChar
      // What the class leaves between number and title.
      L.numberGap = gap !== null && gap !== undefined ? gap * pt : c.sizePx * FONT_HEIGHT_EM * 0.8
    }
    applyRunInLabel(L, key, prevState, state)
    if (level !== null && level <= (hasChapters ? 0 : 1)) thm = 0  // \newtheorem{theorem}{...}[section]
    if (state === S.THEOREM && node.attrs.start) {
      const kind: string = node.attrs.kind || 'theorem'
      let name = THEOREM_KINDS[kind] ?? (kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase())
      if (kind !== 'proof') {
        thm += 1
        const start = hasChapters ? 0 : 1
        const sec = counters.slice(start, 2).join('.')
        name += sec.replace(/^[0.]+|[0.]+$/g, '') ? ` ${sec}.${thm}` : ` ${thm}`
      }
      const title: string = node.attrs.title || ''
      const label = title ? `${name} (${title}).` : `${name}.`
      L.number = label
      L.numberStyle = label.startsWith('Proof') ? 'proof' : 'theorem'
      L.numberGap = bodyChar.sizePx * FONT_HEIGHT_EM * 0.4
    }
    if (state === S.PARAGRAPH) L.lineHeight = bodyLinePx
    else if (key) { /* set with the style's own leading */ }
    else if (Math.abs(spacing - 1.0) > 0.01) L.lineHeight = { proportional: spacing }
    else L.lineHeight = 'normal'
    if (b.item) {
      // LaTeX's list spacing: \topsep around the list and \itemsep
      // between items (10pt and 5pt at 12pt).
      const size = body.size
      L.top = (b.item.index === 0 ? 0.83 : 0.42) * size * pt
      L.bottom = b.item.index === b.item.count - 1 ? 0.83 * size * pt : 0
      // A list item's block format is Qt's default: flush left.
      L.align = 'left'
    }
    if (state === S.PARAGRAPH && !b.item) {
      // LaTeX never indents the first paragraph after a heading, title
      // or display block.
      const followsPara = prevState === S.PARAGRAPH
      if (meta.paragraph_indent) {
        const indents = followsPara || body.indent_first
        L.indent = indents ? (body.parindent || 0) * pt : 0
        L.bottom = 0
        L.top = i === afterDate && look.date ? (out[dateLine]?.spans ? 0 : look.date.gap * pt) : followsPara ? (body.parskip || 0) * pt : 0
      } else {
        L.indent = 0
        L.bottom = extrasParskip ?? 0.8 * emPx
      }
      const prevB = blocks[i - 1]
      const prevL = out[i - 1]
      if (prevB && !prevB.isTable && prevL && prevL.runInHeading) {
        layOutRunInParagraph(L, prevB, prevL)
      }
    }
    if (key && runInNext) L.runInHeading = true
    if (text.trim() || state !== S.PARAGRAPH) {
      prevState = state
      prevLead = key && typeof L.lineHeight === 'number' ? L.lineHeight / pt : body.leading * stretch
    }
  }

  // ---- Qt's flow: a block's top margin and the previous block's bottom
  // margin collapse to the larger; the first block's top margin is
  // ignored.
  for (let i = 0; i < out.length; i++) {
    out[i].gap = i === 0 ? 0 : Math.max(out[i].top, out[i - 1].bottom)
  }

  const fields: Record<string, string> = {}
  for (const b of blocks) {
    const f = b.state === S.TITLE ? 'title' : b.state === S.AUTHOR ? 'author' : b.state === S.AFFILIATION ? 'affil' : ''
    if (f && !(f in fields) && b.text.trim()) fields[f] = b.text.trim()
  }
  return {
    look, geometry, blocks: out, heads, bodyChar, fields,
    bibTitle: { title: classChapters ? 'Bibliography' : 'References', titleChar: styleChar('h1') },
  }

  // ---------- helpers that close over the layout state ----------

  function spansColumns(key: StyleKey): boolean {
    if (g.follows_margins !== false) return ['title', 'author', 'affiliation', 'correspondence'].includes(key)
    return !!look[key]?.wide
  }

  // _lay_out_styled_block: a title-block or heading line exactly where the
  // class sets it: alignment, insets and baseline distances, all measured.
  function layOutStyled(L: BlockLayout, key: StyleKey, startsSheet: boolean, prev: number | null, state: number,
    underTitle: boolean, number: string, prevLeadPt: number, firstBlock: boolean,
    runInNext: boolean): PaintedLabel[] {
    const spec = look[key]
    if (!spec) return []
    L.align = spec.align === 'center' ? 'center' : 'left'
    if (key === 'abstract' || key === 'keywords') L.align = 'justify'
    const lead = styleLead(key)
    L.lineHeight = lead * pt
    const bodyLead = body.leading
    const labels: PaintedLabel[] = []
    const sameAsPrevious = state === prev && key === 'abstract'
    L.bottom = 0
    let above = spec.above ?? null
    if (key === 'correspondence') above = lead  // printed as a footnote; keep the lines together
    if (key === 'abstract' || key === 'keywords') {
      L.left = (spec.inset_left ?? 0) * pt
      L.right = (spec.inset_right ?? 0) * pt
    } else if (spec.align !== 'center') {
      L.left = (spec.indent ?? 0) * pt
      L.right = 0
    } else {
      L.left = 0
      L.right = 0
    }
    if (sameAsPrevious) {
      L.top = 0
      L.bottom = 0
      return []
    }
    let up = 0
    if (key === 'abstract' && spec.label_above) {
      const lab = spec.label_above
      up = lab.gap ?? 0
      labels.push(labelEntry(lab, lab.text, up * pt, !!lab.centred))
      above = up + (lab.gap_prev ?? 0)
    }
    if (key === 'h1' && look.chapter_label) {
      const lab = look.chapter_label
      up = lab.gap ?? 0
      const parts = number.split(/\s+/)
      const t = number ? `${lab.text} ${parts[parts.length - 1]}`.trim() : ''
      if (t) labels.push(labelEntry(lab, t, up * pt, !!lab.centred))
    }
    if (underTitle && above !== null && look.date) above += look.date.gap
    if (startsSheet || firstBlock || above === null) {
      // Top of a sheet: measured down from the top of the text block.
      // Only the title page and a chapter's opening page set their first
      // line low; any other heading starting a page sits at the top.
      const opensLow = key === 'title' || key === 'author' || (key === 'h1' && classChapters)
      const drop = opensLow && spec.top ? spec.top - topPx / pt : BASELINE_AT * lead
      if (firstBlock) {
        // Qt ignores the first block's top margin. One line can take the
        // drop as line height, which sets its baseline just as low.
        L.top = 0
        if (drop > BASELINE_AT * lead && blockLines(L) === 1) {
          const tall = drop / BASELINE_AT
          L.lineHeight = tall * pt
          L.tall = {
            lead: lead * pt, padTop: BASELINE_AT * (tall - lead) * pt, padBottom: (1 - BASELINE_AT) * (tall - lead) * pt,
          }
          // Pull back what that leaves under the baseline.
          L.bottom = -(1 - BASELINE_AT) * tall * pt
        }
        return labels
      }
      L.top = Math.max(0, drop - BASELINE_AT * lead) * pt
    } else {
      // May be negative under a first line grown tall (see above).
      L.top = (above - (1 - BASELINE_AT) * prevLeadPt - BASELINE_AT * lead) * pt
    }
    const below = spec.below
    if (key.startsWith('h') && below !== null && below !== undefined && !spec.run_in) {
      L.bottom = Math.max(0, below - (1 - BASELINE_AT) * lead - BASELINE_AT * bodyLead) * pt
    } else if (key.startsWith('h') && runInNext) {
      // Up by just enough that the next line shares this baseline.
      L.bottom = runInPull(lead) * pt
    } else {
      L.bottom = 0
    }
    return labels
  }

  // A one-line title takes its drop as line height. Lines are counted
  // from the text at the style's size against the text width.
  function blockLines(L: BlockLayout): number {
    const b = blocks[out.indexOf(L)]
    const c = L.char ?? bodyChar
    const width = geometry.widthPx - geometry.leftPx - geometry.rightPx - L.left - L.right
    const text = c.upper ? b.text.toUpperCase() : b.text
    return Math.max(1, Math.ceil(textWidth(text, c) / Math.max(1, width)))
  }

  // "Abstract." or "Keywords:" set in front of the block's first line.
  function applyRunInLabel(L: BlockLayout, key: StyleKey | null, prev: number | null, state: number) {
    const spec = key === 'abstract' || key === 'keywords' ? (look[key] ?? null) : null
    let label: LabelSpec | null | undefined = spec?.label
    if (key === 'keywords' && !label) {
      label = { text: 'Keywords:', font: body.font.replace('Regular', 'Bold'), size: body.size, color: '#000000' }
    }
    const firstOf = state !== prev
    if (label && firstOf) {
      const entry = labelEntry(label, label.text, 0, false)
      const indent = (spec?.first_indent ?? 0) * pt
      entry.left = indent
      L.runIn = entry
      L.indent = indent + textWidth(label.text + ' ', {
        family: entry.family, sizePx: entry.sizePx, bold: entry.bold, italic: entry.italic,
      })
      return
    }
    L.runIn = null
    if (key === 'abstract') L.indent = (firstOf ? spec?.first_indent ?? 0 : 0) * pt
    else if (key === 'keywords') L.indent = 0
  }

  // This paragraph's first line continues on the heading's line, after
  // its text, punctuation and the gap the class leaves.
  function layOutRunInParagraph(L: BlockLayout, heading: LBlock, HL: BlockLayout) {
    const key = styleKey(heading.state)!
    const spec = look[key]!
    const c = HL.char ?? bodyChar
    let width = HL.left + HL.indent + textWidth(heading.text, c)
    if (HL.number) width += textWidth(HL.number, c) + HL.numberGap
    const column = geometry.widthPx - geometry.leftPx - geometry.rightPx
    if (column > 0 && width > column) width %= column  // the heading wrapped: its last line counts
    const suffix = spec.suffix ?? ''
    const gap = spec.run_gap
    const gapPx = gap !== null && gap !== undefined ? gap * pt : body.size * pt * 0.5
    if (suffix) {
      const entry = labelEntry(spec, suffix, 0, false)
      entry.left = width
      L.runIn = entry
      width += textWidth(suffix, c)
    }
    L.indent = width + gapPx
    L.top = runInPull(spec.size * 1.2) * pt
    L.bottom = 0
  }
}


// The sheet size the visual tab draws for `meta`: the document's paper,
// or the class's own when it fixes one (a poster, a slide).
export function pagePx(meta: DocMeta): { width: number; height: number } {
  const g = lookFor(meta.documentclass, meta.body_font_pt).geometry
  if (g.follows_page !== false) {
    const p = byCode(meta.page_size)
    return { width: Math.round(p.width_in * DPI), height: Math.round(p.height_in * DPI) }
  }
  return { width: Math.round(g.page_w * PT_PX), height: Math.round(g.page_h * PT_PX) }
}

// A class look with every type size and vertical or indent space scaled by
// k (positions on the page and the paper stay).
const SCALED_KEYS = new Set(['size', 'leading', 'above', 'below', 'parindent', 'first_indent', 'indent',
  'num_gap', 'gap', 'gap_prev'])
function scaleLook(look: Look, k: number): Look {
  const scale = (v: unknown, key: string): unknown => {
    if (typeof v === 'number') return SCALED_KEYS.has(key) ? v * k : v
    if (Array.isArray(v)) return v.map(x => scale(x, key))
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, kk === 'geometry' || kk === 'furniture' ? x : scale(x, kk)]))
    }
    return v
  }
  return scale(look, '') as Look
}

// ---------- the compiled PDF's page starts (paged_edit.py) ----------

// Collapse whitespace, strip accents and lowercase, so PDF-extracted text
// can match the editor's (_normalize_for_match).
export function normalizeForMatch(s: string): string {
  return s.normalize('NFKD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

// Where a PDF page's first line (normalised) starts in a block's text, or
// -1. A match at the block's start always counts; one inside the block
// (a page starting mid-paragraph) only when the key is long enough to be
// unambiguous (anchor_offset).
//
// An inline object (equation, citation, cross-reference, footnote mark) is
// U+FFFC in the editor's text but printed text in the PDF ("With $k_m$
// fixed" reads "With km fixed"): each one matches any short run of the
// PDF's characters, so a page starting on such a line is still found.
export function anchorOffset(blockText: string, keyNorm: string): number {
  const list = LIST_PAGE_RE.exec(blockText)
  if (list) return LIST_TITLES[list[1]].includes(keyNorm) ? 0 : -1
  if (BIB_BLOCK_RE.test(blockText) && LIST_TITLES.bibliography.includes(keyNorm)) return 0
  if (blockText.includes(OBJ)) return wildAnchorOffset(blockText, keyNorm)
  const norm = normalizeForMatch(blockText)
  if (!norm) return -1
  if (keyNorm.length < 16) {
    if (norm === keyNorm) return 0
  } else if (norm.startsWith(keyNorm) || (norm.length >= 3 && keyNorm.startsWith(norm))) {
    return 0
  }
  if (keyNorm.length >= 12) {
    const idx = norm.indexOf(keyNorm)
    if (idx > 0) return Math.min(blockText.length, idx)
  }
  return -1
}

// A raw \tableofcontents (\listoffigures, \listoftables) is one line in
// the editor and a page or more in the PDF, which starts with its title in
// the document's language.
const LIST_PAGE_RE = /^\s*\\(tableofcontents|listoffigures|listoftables)\s*$/
const LIST_TITLES: Record<string, string[]> = {
  tableofcontents: ['contents', 'table of contents', 'inhaltsverzeichnis', 'indice', 'sommario',
    'table des matieres', 'sommaire', 'содержание', 'оглавление', 'indice general', 'inhoudsopgave',
    'spis tresci', 'innehall', 'indholdsfortegnelse', 'sisallys', 'obsah'],
  listoffigures: ['list of figures', 'elenco delle figure', 'abbildungsverzeichnis', 'table des figures',
    'liste des figures', 'список иллюстрации', 'список рисунков', 'indice de figuras', 'lijst van figuren',
    'spis rysunkow', 'figurer'],
  // The reference list of a raw thebibliography / \bibliography /
  // \printbibliography block, whose title the PDF prints above it.
  bibliography: ['bibliography', 'references', 'bibliografia', 'literaturverzeichnis', 'literatur',
    'bibliographie', 'references bibliographiques', 'список литературы', 'литература',
    'riferimenti bibliografici', 'referencias', 'bibliografie', 'referenties', 'litteratur', 'kirjallisuus'],
  listoftables: ['list of tables', 'elenco delle tabelle', 'tabellenverzeichnis', 'liste des tableaux',
    'список таблиц', 'indice de tablas', 'indice de cuadros', 'lijst van tabellen', 'spis tabel', 'tabeller'],
}

const BIB_ENV_RE = /\\begin\{thebibliography\}/
const BIB_BLOCK_RE = /^\s*\\(?:begin\{thebibliography\}|bibliography\{|printbibliography\b)/

const OBJ = '\ufffc'
// How many printed characters one inline object may stand for.
const OBJ_SPAN = 40

// Where `key` matches `norm` from i, an object matching 0..OBJ_SPAN of the
// key's characters: the index in `norm` after the match, or -1. The key
// may end inside an object's text. At least half the key (and 6
// characters) must match literally, so an object cannot stand for it all.
function wildMatch(norm: string, i: number, key: string): number {
  const need = Math.min(key.length, Math.max(6, Math.ceil(key.length / 2)))
  const go = (i: number, j: number, lit: number): number => {
    for (;;) {
      if (j >= key.length) return lit >= need ? i : -1
      if (i >= norm.length) return -1
      if (norm[i] === OBJ) {
        for (let n = Math.min(OBJ_SPAN, key.length - j); n >= 0; n--) {
          const end = go(i + 1, j + n, lit)
          if (end >= 0) return end
        }
        return -1
      }
      if (norm[i] !== key[j]) return -1
      i++
      j++
      lit++
    }
  }
  return go(i, 0, 0)
}

function wildAnchorOffset(blockText: string, keyNorm: string): number {
  const norm = normalizeForMatch(blockText)
  if (!norm.replace(new RegExp(OBJ, 'g'), '').trim()) return -1
  const end = wildMatch(norm, 0, keyNorm)
  // A short key must be the whole line; a long one may be the line's start.
  if (end >= 0 && (keyNorm.length >= 16 || end === norm.length)) return 0
  if (keyNorm.length >= 12) {
    for (let i = 1; i < norm.length; i++) {
      if (norm[i - 1] !== ' ' && norm[i - 1] !== OBJ) continue
      if (wildMatch(norm, i, keyNorm) >= 0) return Math.min(blockText.length, i)
    }
  }
  return -1
}

export type PageAnchor = [number, string]

// The text blocks (by position) the last compiled PDF starts a page with
// (_pdf_page_start_blocks). Only pages that begin at a block's start are
// forced; anchors match in order, each search after the previous hit.
export function pdfPageStartBlocks(doc: PMNode, anchors: readonly PageAnchor[]): Set<number> {
  // The blocks anchorTargets starts a page with (a page starting inside a
  // paragraph breaks there, not before the block). One matcher for both:
  // this one skipped figures, so a page the PDF starts with a figure broke
  // at the paragraph after it, the figure left alone on a sheet.
  return new Set(anchorTargets(doc, anchors).filter(t => t.offset === 0).map(t => t.pos))
}

// Each anchor's block and the offset of its text in it, for finding the
// line a PDF page starts on (page_anchor_positions).
// A caption's LaTeX as the words it prints.
// The most text one PDF page holds (a small-type A4 page runs to about
// 6000 characters): the reach of a page-start search past the last start.
const MAX_PAGE_CHARS = 9000

function captionText(latex: string): string {
  return latex.replace(/\\[A-Za-z]+\*?/g, ' ').replace(/\\(.)/g, '$1').replace(/[{}$]/g, '').replace(/\s+/g, ' ').trim()
}

export function anchorTargets(doc: PMNode, anchors: readonly PageAnchor[]): { page: number; pos: number; offset: number }[] {
  const out: { page: number; pos: number; offset: number }[] = []
  const blocks = collect(doc)
  const texts = blocks.map(b => b.node.type.name === 'figure' ? captionText(b.node.attrs.caption || '') : b.text)
  // Where each block's text starts in the document's running text: a
  // PDF page holds a few thousand characters, so a match far beyond the
  // last page start is a phrase that recurs later, not this page's start
  // (a thesis's "taken at a photon energy" in a caption's second line
  // matched a paragraph twenty pages on, and every page in between lost
  // its start).
  const startOf: number[] = []
  let run = 0
  for (const t of texts) { startOf.push(run); run += t.length + 1 }
  let at = 0
  let atChar = 0
  let atPage = 0
  for (const [page, snippet] of anchors) {
    const reach = MAX_PAGE_CHARS * Math.max(1, page - atPage)
    const tooFar = (i: number, offset: number) => atPage > 0 && startOf[i] + offset - atChar > reach
    const hit = (i: number, offset: number) => {
      out.push({ page, pos: blocks[i].pos, offset })
      at = i; atChar = startOf[i] + offset; atPage = page
    }
    const keys = (snippet || '').split('\n').map(s => normalizeForMatch(s.trim().slice(0, 24))).filter(k => k.length >= 3)
    // The words the page goes on with, to confirm a match inside a
    // paragraph: a phrase such as "secondary electron cut-o" can recur,
    // and an earlier paragraph holding it made a page start far too soon.
    const confirms = (i: number, offset: number, k: number): boolean => {
      const next = keys.slice(k + 1).find(x => x.length >= 8)
      if (!next) return true
      const ahead = normalizeForMatch(texts[i].slice(offset) + ' ' + texts.slice(i + 1, i + 4).join(' ')).slice(0, 1500)
      return ahead.includes(next.slice(0, 12))
    }
    search: for (const [k, keyNorm] of keys.entries()) {
      // A figure's caption prints after its label ("Figure 1: ...", and
      // in a report or thesis "Figure 2.9: ...", "Figure A.1: ...").
      const capKey = keyNorm.replace(/^(?:figure|fig\.?|table)\s*(?:[a-z]\.)?\d+(?:[.-]\d+)*[a-z]?\s*[.:|]?\s*/, '')
      for (let i = at; i < blocks.length; i++) {
        if (tooFar(i, 0)) break
        // A figure by its caption: a page the PDF starts with a figure
        // (one that floated to its top) starts with the caption's text.
        if (blocks[i].node.type.name === 'figure') {
          const cap = normalizeForMatch(texts[i])
          if (cap && capKey.length >= 8 && (cap.startsWith(capKey) || capKey.startsWith(cap))) {
            hit(i, 0); break search
          }
          continue
        }
        if (blocks[i].isTable) continue
        const idx = anchorOffset(blocks[i].text, keyNorm)
        if (idx > 0 && !confirms(i, idx, k)) continue
        if (idx >= 0 && !tooFar(i, idx)) { hit(i, idx); break search }
      }
    }
  }
  return out
}
