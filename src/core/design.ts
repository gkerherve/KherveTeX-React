// The Design tab, as Word's: a theme (colours + fonts + a style set), the
// Document Formatting gallery of heading looks, Colours, Fonts, Paragraph
// Spacing, and the page background (Watermark, Page Colour, Page Borders).
// Kept in DocMeta.design, written only when set; the LaTeX comes from
// designPreamble (titlesec for headings, a shipout hook for the page).

export type StyleSet = 'default' | 'basic' | 'elegant' | 'shaded' | 'lines' | 'lines_accent' | 'centered' | 'casual'
export type ChapterStyle = 'default' | 'bignumber' | 'band' | 'ruled' | 'boxed' | 'bar' | 'centered'
export const CHAPTER_STYLES: [ChapterStyle, string, string][] = [
  ['default', 'As the class', 'The document class\'s own chapter titles'],
  ['bignumber', 'Big number', 'A large number in the accent colour, the title under it, on the right'],
  ['band', 'Coloured band', 'The number and title in white on a band of the accent colour'],
  ['ruled', 'Ruled', '"Chapter 2" in small capitals, the title, a rule in the accent colour'],
  ['boxed', 'Boxed number', 'The number in a coloured square beside the title'],
  ['bar', 'Side bar', 'A thick coloured bar before the number and title'],
  ['centered', 'Centred', 'Centred, the chapter line in the accent colour and a short rule under'],
]
export type PageBorder = 'box' | 'double' | 'thick' | 'shadow' | 'art'

export interface Design {
  theme?: string
  style_set?: StyleSet
  colors?: string           // a COLOR_SETS key
  heading_font?: 'sans' | 'serif'
  para_space_pt?: number
  watermark?: string
  page_color?: string       // #RRGGBB
  page_border?: PageBorder
  // Design ▸ Chapter Titles: how a chapter (a section, without chapters) opens.
  chapter_style?: ChapterStyle
}

// Colours: the accent (headings, shaded bands) and a second colour.
export const COLOR_SETS: [string, string, string, string][] = [
  // key, name, accent, second
  ['office', 'Office', '#2F5496', '#ED7D31'],
  ['blue', 'Blue', '#1F4E79', '#5B9BD5'],
  ['blue_green', 'Blue Green', '#1E5C6B', '#4BACC6'],
  ['green', 'Green', '#38761D', '#8FBC5A'],
  ['yellow', 'Yellow Orange', '#B45F06', '#F1C232'],
  ['orange', 'Orange', '#C55A11', '#F4B183'],
  ['red', 'Red', '#A61C1C', '#E06666'],
  ['violet', 'Violet', '#5B2C83', '#A983D8'],
  ['grayscale', 'Grayscale', '#404040', '#A5A5A5'],
]

export const STYLE_SETS: [StyleSet, string][] = [
  ['default', 'Default (LaTeX)'], ['basic', 'Basic (Simple)'], ['elegant', 'Basic (Elegant)'],
  ['shaded', 'Shaded'], ['lines', 'Lines (Simple)'], ['lines_accent', 'Lines (Stylish)'],
  ['centered', 'Centered'], ['casual', 'Casual'],
]

// Fonts: the body family (DocMeta.body_font_family) and the headings'.
export const FONT_SETS: [string, string, string, 'sans' | 'serif'][] = [
  ['latex', 'Latin Modern', 'default', 'serif'],
  ['office', 'Helvetica / Times', 'times', 'sans'],
  ['times', 'Times', 'times', 'serif'],
  ['palatino', 'Palatino', 'palatino', 'serif'],
  ['palatino_sans', 'Helvetica / Palatino', 'palatino', 'sans'],
  ['charter', 'Charter', 'charter', 'serif'],
  ['helvetica', 'Helvetica', 'helvetica', 'sans'],
  ['libertine', 'Libertine', 'libertine', 'serif'],
]

// Paragraph Spacing: indent between paragraphs or a space, and the line spacing.
export const SPACING_SETS: [string, string, boolean, number, number][] = [
  // key, name, paragraph indent, space between paragraphs (pt), line spacing
  ['none', 'No Paragraph Space', true, 0, 1.0],
  ['compact', 'Compact', false, 4, 1.0],
  ['tight', 'Tight', false, 6, 1.0],
  ['open', 'Open', false, 10, 1.15],
  ['relaxed', 'Relaxed', false, 6, 1.15],
  ['double', 'Double', false, 8, 2.0],
]

// Themes: colours, fonts and a style set together.
export const THEMES: [string, string, string, string, StyleSet][] = [
  // key, name, colours, fonts, style set
  ['latex', 'LaTeX (no theme)', '', 'latex', 'default'],
  ['office', 'Office', 'office', 'office', 'basic'],
  ['academic', 'Academic', 'grayscale', 'times', 'lines'],
  ['facet', 'Facet', 'green', 'helvetica', 'lines_accent'],
  ['ion', 'Ion', 'blue_green', 'helvetica', 'shaded'],
  ['retrospect', 'Retrospect', 'orange', 'palatino', 'elegant'],
  ['slice', 'Slice', 'violet', 'palatino_sans', 'centered'],
  ['vapor', 'Vapor Trail', 'red', 'charter', 'casual'],
]

export const WATERMARKS = ['CONFIDENTIAL', 'DO NOT COPY', 'DRAFT', 'SAMPLE', 'URGENT', 'ASAP']

export const PAGE_BORDERS: [PageBorder, string][] = [
  ['box', 'Box'], ['shadow', 'Shadow'], ['double', 'Double'], ['thick', 'Thick'], ['art', 'Thick and thin'],
]

export function accentOf(d: Design | undefined): string {
  return COLOR_SETS.find(c => c[0] === d?.colors)?.[2] ?? (d?.style_set && d.style_set !== 'default' ? '#2F5496' : '#000000')
}
export function secondOf(d: Design | undefined): string {
  return COLOR_SETS.find(c => c[0] === d?.colors)?.[3] ?? '#ED7D31'
}

const hex = (c: string) => c.replace('#', '').toUpperCase()

// Anything the design sets that LaTeX must know.
export function hasDesign(d: Design | undefined): boolean {
  return !!d && Object.values(d).some(v => v !== undefined && v !== '' && v !== 'default')
}

// Classes with chapters (Heading 1 is \\chapter), and those that print
// "Chapter 2" on a line of its own over the title.
const CHAPTER_CLASSES = ['report', 'book', 'extreport', 'extbook', 'memoir', 'scrreprt', 'scrbook', 'mimosis',
  'hepthesis', 'suftesi', 'toptesi', 'disser', 'amsbook', 'elegantbook', 'tufte-book']
const CHAPTER_LINE = ['report', 'book', 'extreport', 'extbook', 'memoir', 'amsbook', 'hepthesis', 'disser']
// Classes whose headings titlesec cannot take over (they fail to compile
// with it): their headings keep the class's look; letters, CVs and posters
// have none to restyle.
const NO_TITLESEC = ['apa7', 'llncs', 'disser', 'moderncv', 'europasscv', 'letter', 'scrlttr2', 'tikzposter', 'a0poster', 'beamer']
function headingsByTitlesec(cls: string): boolean {
  return !NO_TITLESEC.includes(cls)
}

// How much of a style set the PDF can show in a class: all of it
// (titlesec), the headings' colour and font only, or nothing (letters,
// CVs, posters: no such headings). The page shows the same.
export function designReach(cls: string): 'all' | 'color' | 'none' {
  const c = (cls || '').toLowerCase()
  if (headingsByTitlesec(c)) return 'all'
  if (['apa7', 'llncs', 'disser', 'beamer', 'moderncv'].includes(c)) return 'color'
  return 'none'
}

// The preamble lines; `cls` is the class in lower case. Headings are
// restyled with titlesec in every class that allows it.
export function designPreamble(d: Design | undefined, cls: string): string {
  if (!hasDesign(d)) return ''
  const D = d!
  const out: string[] = []
  // \definecolor below always needs xcolor (loading it twice is harmless);
  // without it LaTeX prints the colour names on a page of their own.
  out.push('\\usepackage{xcolor}')
  const accent = accentOf(D), second = secondOf(D)
  out.push(`\\definecolor{kAccent}{HTML}{${hex(accent)}}`, `\\definecolor{kSecond}{HTML}{${hex(second)}}`)
  const set = D.style_set ?? 'default'
  const fam = D.heading_font === 'sans' ? '\\sffamily' : D.heading_font === 'serif' ? '\\rmfamily' : ''
  const styled = set !== 'default' || !!D.heading_font || !!D.colors
  // moderncv draws its own section titles in its color1: the accent.
  if (styled && cls === 'moderncv') out.push('\\colorlet{color1}{kAccent}')
  // Classes titlesec cannot take: the headings' colour and font only.
  const hcolor = set === 'default' && !D.colors ? '' : '\\color{kAccent}'
  if (styled && (cls === 'apa7' || cls === 'llncs') && (hcolor || fam)) out.push(`\\usepackage{sectsty}\\allsectionsfont{${fam}${hcolor}}`)
  if (styled && cls === 'disser' && (hcolor || fam)) {
    out.push(`\\renewcommand\\chapterfont{${fam}\\Large\\bfseries${hcolor}}\\renewcommand\\thechapterfont{${fam}\\Large${hcolor}}`,
      `\\renewcommand\\sectionfont{\\normalfont${fam}\\large\\bfseries${hcolor}}`,
      `\\renewcommand\\subsectionfont{\\normalfont${fam}\\normalsize\\bfseries${hcolor}}`,
      `\\renewcommand\\subsubsectionfont{\\normalfont${fam}\\normalsize\\bfseries${hcolor}}`)
  }
  if (styled && cls === 'beamer' && hcolor) out.push('\\setbeamercolor{structure}{fg=kAccent}')
  if (styled && headingsByTitlesec(cls)) {
    // No [explicit]: a class that loads titlesec itself (tufte, elegantbook,
    // suftesi) would clash with the option. The title goes to the last
    // command of each format (\kHeadBox, \MakeUppercase) instead of #1.
    out.push('\\usepackage{titlesec}')
    const color = set === 'default' && !D.colors ? '' : '\\color{kAccent}'
    const box = (num: string) => `{\\colorbox{kAccent}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep}{\\color{white}\\strut ${num}#1}}}`
    out.push(`\\providecommand{\\kHeadBox}[1]${box('')}`)
    // A class with chapters: the chapter is the top level, as the page shows
    // it (Heading 1). Where the class prints "Chapter 2" on a line of its
    // own (report, book, memoir...) it stays so; KOMA and the others put the
    // number before the title.
    const chapters = CHAPTER_CLASSES.includes(cls)
    if (chapters) {
      const display = CHAPTER_LINE.includes(cls)
      const label = display ? '\\chaptertitlename\\ \\thechapter' : '\\thechapter'
      let shape = `${fam}\\bfseries\\huge${color}`, lab = `{${label}}`, title = '\\Huge', after = ''
      switch (set) {
        case 'shaded': shape = `${fam}\\bfseries\\huge\\color{kAccent}`; title = display ? '\\Huge\\kHeadBox' : '\\Huge\\kChapBox'; break
        case 'lines': after = '[\\vspace{-0.6ex}\\titlerule]'; break
        case 'lines_accent': shape = `${fam}\\huge\\color{kAccent}`; after = '[{\\color{kSecond}\\vspace{-0.4ex}\\titlerule[1.2pt]}]'; break
        case 'elegant': shape = `${fam}\\huge${color}`; title = '\\Huge\\MakeUppercase'; break
        case 'centered': shape += '\\centering'; break
        case 'casual': lab = `{{\\color{kSecond}${label}}}`; break
      }
      if (set === 'shaded' && !display) {
        // The number inside the box with the title, as a section's.
        out.push(`\\providecommand{\\kChapBox}[1]${box('\\thechapter\\quad ')}`)
        out.push(`\\titleformat{\\chapter}[block]{${shape}}{}{0pt}{\\Huge\\kChapBox}`)
      } else {
        out.push(`\\titleformat{\\chapter}[${display ? 'display' : 'hang'}]{${shape}}${lab}{${display ? '20pt' : '1em'}}{${title}}${after}`)
      }
      out.push(`\\titleformat{name=\\chapter,numberless}[${display ? 'display' : 'hang'}]{${shape}}{}{0pt}{${set === 'shaded' ? '\\Huge\\kHeadBox' : title}}${after}`)
      out.push(`\\titlespacing*{\\chapter}{0pt}{${display ? '50pt' : '30pt'}}{${display ? '40pt' : '20pt'}}`)
    }
    const lvls: [string, string, string][] = [
      ['section', '\\Large', '\\thesection'], ['subsection', '\\large', '\\thesubsection'], ['subsubsection', '\\normalsize', '\\thesubsubsection'],
    ]
    for (const [name, size, num] of lvls) {
      // The top level's look (a box, a rule) goes to the chapter when there
      // is one; sections then take the lower levels' look.
      const top = name === 'section' && !chapters
      switch (set) {
        case 'shaded':
          if (top) {
            out.push(`\\providecommand{\\kSecBox}[1]${box('\\thesection\\quad ')}`)
            out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}}{}{0pt}{\\kSecBox}`,
              `\\titleformat{name=\\${name},numberless}{${fam}\\bfseries${size}}{}{0pt}{\\kHeadBox}`)
          } else out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}\\color{kAccent}}{${num}}{1em}{}`)
          break
        case 'lines':
          out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}${color}}{${num}}{1em}{}[${top ? '\\vspace{-0.6ex}\\titlerule' : ''}]`)
          break
        case 'lines_accent':
          out.push(top
            ? `\\titleformat{\\${name}}{${fam}${size}\\color{kAccent}}{${num}}{1em}{}[{\\color{kSecond}\\vspace{-0.4ex}\\titlerule[1.2pt]}]`
            : `\\titleformat{\\${name}}{${fam}\\bfseries${size}\\color{kAccent}}{${num}}{1em}{}`)
          break
        case 'elegant':
          out.push(`\\titleformat{\\${name}}{${fam}${size}${color}}{${num}}{1em}{${top ? '\\MakeUppercase' : '\\scshape'}}`)
          if (top) out.push(`\\titlespacing*{\\${name}}{0pt}{4ex plus 1ex minus .2ex}{2ex plus .2ex}`)
          break
        case 'centered':
          out.push(`\\titleformat{\\${name}}[block]{${fam}\\bfseries${size}${color}\\centering}{${num}}{1em}{}`)
          break
        case 'casual':
          out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}${color}}{{\\color{kSecond}${num}}}{1em}{}`)
          break
        case 'basic':
        default:
          out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}${color}}{${num}}{1em}{}`)
      }
    }
  }
  if (D.chapter_style && D.chapter_style !== 'default' && headingsByTitlesec(cls)) {
    if (!out.includes('\\usepackage{titlesec}')) out.push('\\usepackage{titlesec}')
    out.push(...chapterStyleLatex(D.chapter_style, CHAPTER_CLASSES.includes(cls)))
  }
  if (D.para_space_pt !== undefined) out.push(`\\setlength{\\parskip}{${D.para_space_pt}pt}`)
  if (D.page_color) out.push(`\\pagecolor[HTML]{${hex(D.page_color)}}`)
  if (D.watermark || D.page_border) {
    out.push('\\usepackage{tikz}')
    const draw: string[] = []
    if (D.page_border) {
      const r = '([shift={(1cm,-1cm)}]0,0) rectangle ([shift={(-1cm,1cm)}]\\paperwidth,-\\paperheight)'
      const r2 = '([shift={(1.12cm,-1.12cm)}]0,0) rectangle ([shift={(-1.12cm,1.12cm)}]\\paperwidth,-\\paperheight)'
      const sh = '([shift={(1.1cm,-1.1cm)}]0,0) rectangle ([shift={(-0.9cm,0.9cm)}]\\paperwidth,-\\paperheight)'
      switch (D.page_border) {
        case 'box': draw.push(`\\draw[line width=0.6pt] ${r};`); break
        case 'thick': draw.push(`\\draw[line width=2.25pt] ${r};`); break
        case 'double': draw.push(`\\draw[line width=0.5pt] ${r};`, `\\draw[line width=0.5pt] ${r2};`); break
        case 'art': draw.push(`\\draw[line width=2.25pt] ${r};`, `\\draw[line width=0.5pt] ${r2};`); break
        case 'shadow': draw.push(`\\fill[black!70] ${sh};`, `\\filldraw[fill=white,line width=0.6pt] ${r};`); break
      }
    }
    if (D.watermark) {
      const text = D.watermark.replace(/[\\{}$&#%_^~]/g, '')
      draw.push(`\\node[rotate=${'45'},scale=${Math.max(2, Math.min(9, 60 / Math.max(4, text.length)))},text=black!15,font=\\sffamily\\bfseries] at (0.5\\paperwidth,-0.5\\paperheight) {${text}};`)
    }
    out.push(`\\AddToHook{shipout/background}{\\put(0,0){\\begin{tikzpicture}[overlay]${draw.join('')}\\end{tikzpicture}}}`)
  }
  return out.join('\n')
}

// Design ▸ Chapter Titles: titlesec formats for the top heading (the
// chapter, or the section in a class without chapters), numbered and not.
// After the style set's, so they win.
function chapterStyleLatex(style: ChapterStyle, chapters: boolean): string[] {
  const cmd = chapters ? 'chapter' : 'section'
  const num = chapters ? '\\thechapter' : '\\thesection'
  const big = chapters ? '\\Huge' : '\\LARGE'
  const nPt = chapters ? 72 : 40
  const line = chapters ? `\\chaptertitlename\\ ${num}` : num
  const f = (shape: string, fmt: string, label: string, sep: string, before: string, after = '') =>
    `\\titleformat{\\${cmd}}[${shape}]{${fmt}}{${label}}{${sep}}{${before}}${after ? `[${after}]` : ''}`
  const n = (shape: string, fmt: string, before: string, after = '') =>
    `\\titleformat{name=\\${cmd},numberless}[${shape}]{${fmt}}{}{0pt}{${before}}${after ? `[${after}]` : ''}`
  const out: string[] = []
  switch (style) {
    case 'bignumber':
      out.push(f('display', '\\normalfont\\bfseries', `\\filleft\\fontsize{${nPt}}{${nPt}}\\selectfont\\color{kAccent}${num}`, '0pt', `\\filleft${big}`),
        n('display', '\\normalfont\\bfseries', `\\filleft${big}`))
      break
    case 'band':
      out.push(`\\providecommand{\\kTopBand}[1]{\\colorbox{kAccent}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep}{\\color{white}\\strut\\hspace{0.2em}${num}\\quad #1\\strut}}}`,
        '\\providecommand{\\kTopBandN}[1]{\\colorbox{kAccent}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep}{\\color{white}\\strut\\hspace{0.2em}#1\\strut}}}',
        f('block', `\\normalfont${big}\\bfseries`, '', '0pt', '\\kTopBand'), n('block', `\\normalfont${big}\\bfseries`, '\\kTopBandN'))
      break
    case 'ruled':
      out.push(chapters
        ? f('display', '\\normalfont\\Large\\scshape\\color{kAccent}', line, '6pt', `\\color{black}${big}\\bfseries\\upshape`, '{\\color{kAccent}\\titlerule[1.2pt]}')
        : f('block', `\\normalfont${big}\\bfseries`, `\\color{kAccent}${num}`, '0.8em', '', '{\\color{kAccent}\\titlerule[1.2pt]}'),
      n('block', `\\normalfont${big}\\bfseries`, '', '{\\color{kAccent}\\titlerule[1.2pt]}'))
      break
    case 'boxed':
      out.push(f('hang', `\\normalfont${big}\\bfseries`, `\\colorbox{kAccent}{\\color{white}\\makebox[1em]{${num}}}`, '0.5em', ''),
        n('hang', `\\normalfont${big}\\bfseries`, ''))
      break
    case 'bar':
      out.push(f('hang', `\\normalfont${big}\\bfseries`, `{\\color{kAccent}\\vrule width 4pt}\\hspace{0.5em}${num}`, '0.6em', ''),
        n('hang', `\\normalfont${big}\\bfseries`, '{\\color{kAccent}\\vrule width 4pt}\\hspace{0.5em}'))
      break
    case 'centered':
      out.push(f('display', '\\normalfont\\filcenter', `\\Large\\scshape\\color{kAccent}${line}`, '8pt', `${big}\\bfseries`, '{\\filcenter\\color{kAccent}\\rule{3cm}{0.8pt}}'),
        n('display', '\\normalfont\\filcenter', `${big}\\bfseries`, '{\\filcenter\\color{kAccent}\\rule{3cm}{0.8pt}}'))
      break
    default: break
  }
  if (style !== 'default') out.push(`\\titlespacing*{\\${cmd}}{0pt}{${chapters ? '40pt' : '3.5ex plus 1ex'}}{${chapters ? '30pt' : '2.3ex'}}`)
  return out
}

// The editor's look for a style set: CSS for the headings (the page's
// .kt-design root), the watermark and border drawn on each sheet.
export function designCss(d: Design | undefined, cls = 'article'): string {
  if (!hasDesign(d)) return ''
  const reach = designReach(cls)
  const D = d!
  const accent = accentOf(D), second = secondOf(D)
  const set = D.style_set ?? 'default'
  const sel = (lv: number) => `.kt-design .kt-section[data-level="${lv}"]`
  const fam = D.heading_font === 'sans' ? 'font-family: Helvetica, Arial, sans-serif !important;' : ''
  const css: string[] = []
  const color = set === 'default' && !D.colors ? '' : `color: ${accent} !important;`
  for (const lv of [1, 2, 3]) {
    const top = lv === 1
    let r = reach === 'none' ? '' : fam + color
    if (reach === 'all') switch (set) {
      case 'shaded': r += top ? `background: ${accent}; color: #fff !important; padding: 2px 6px;` : ''; break
      case 'lines': if (top) r += 'border-bottom: 0.67px solid #000; padding-bottom: 2px;'; break
      case 'lines_accent': if (top) r += `border-bottom: 1.6px solid ${second}; padding-bottom: 2px; font-weight: 400 !important;`; break
      case 'elegant': r += `font-weight: 400 !important; ${top ? 'text-transform: uppercase; letter-spacing: .04em;' : 'font-variant: small-caps;'}`; break
      case 'centered': r += 'text-align: center !important;'; break
      default: break
    }
    if (r) css.push(`${sel(lv)} { ${r} }`)
    if (reach !== 'all') continue
    if (set === 'casual') css.push(`${sel(lv)}::before { color: ${second}; }`)
    if (set === 'shaded' && top) css.push(`${sel(lv)}::before { color: #fff !important; }`)
    // A chapter keeps its "Chapter 2" line and space above in its padding:
    // the box only behind the title, as the PDF's \\colorbox.
    if (set === 'shaded' && top) css.push(`${sel(lv)}:has(> .kt-labels) { background-clip: content-box; padding-left: 0 !important; padding-right: 0 !important; text-indent: 6px !important; }`)
    // The "Chapter 2" line over a chapter (a label above the heading, on
    // the page): in the accent, never white on the page, nor uppercased.
    if (top) {
      const lab = set === 'casual' ? second : set === 'default' && !D.colors ? 'inherit' : accent
      css.push(`${sel(lv)} .kt-label { color: ${lab} !important; text-transform: none; letter-spacing: normal; }`)
    }
  }
  // Chapter Titles, on the page's top heading.
  const top = `.kt-design .kt-section[data-level="1"]`
  if (reach === 'all') switch (D.chapter_style) {
    case 'bignumber': css.push(`${top} { text-align: right !important; } ${top}::before { display: block; font-size: 2.4em; line-height: 1.1; color: ${accent}; }`); break
    case 'band': css.push(`${top} { background: ${accent}; color: #fff !important; padding: 3px 8px !important; } ${top}::before { color: #fff !important; }`); break
    case 'ruled': css.push(`${top} { border-bottom: 2px solid ${accent}; padding-bottom: 3px; } ${top}::before { color: ${accent}; }`); break
    case 'boxed': css.push(`${top}::before { background: ${accent}; color: #fff !important; padding: 0 .2em; margin-right: .3em; }`); break
    case 'bar': css.push(`${top} { border-left: 4px solid ${accent}; padding-left: 8px !important; }`); break
    case 'centered': css.push(`${top} { text-align: center !important; border-bottom: 1px solid ${accent}; padding-bottom: 4px; } ${top}::before { color: ${accent}; }`); break
    default: break
  }
  return css.join('\n')
}
