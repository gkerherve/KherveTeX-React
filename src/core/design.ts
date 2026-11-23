// The Design tab, as Word's: a theme (colours + fonts + a style set), the
// Document Formatting gallery of heading looks, Colours, Fonts, Paragraph
// Spacing, and the page background (Watermark, Page Colour, Page Borders).
// Kept in DocMeta.design, written only when set; the LaTeX comes from
// designPreamble (titlesec for headings, a shipout hook for the page).

export type StyleSet = 'default' | 'basic' | 'elegant' | 'shaded' | 'lines' | 'lines_accent' | 'centered' | 'casual'
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

// The preamble lines; `cls` is the class in lower case. Headings are
// restyled (titlesec) only in the standard classes, where it is safe.
export function designPreamble(d: Design | undefined, cls: string): string {
  if (!hasDesign(d)) return ''
  const D = d!
  const out: string[] = []
  // \definecolor below always needs xcolor (loading it twice is harmless);
  // without it LaTeX prints the colour names on a page of their own.
  out.push('\\usepackage{xcolor}')
  const accent = accentOf(D), second = secondOf(D)
  out.push(`\\definecolor{kAccent}{HTML}{${hex(accent)}}`, `\\definecolor{kSecond}{HTML}{${hex(second)}}`)
  const standard = ['article', 'report', 'book', 'extarticle', 'extreport', 'extbook'].includes(cls)
  const set = D.style_set ?? 'default'
  const fam = D.heading_font === 'sans' ? '\\sffamily' : D.heading_font === 'serif' ? '\\rmfamily' : ''
  if (standard && (set !== 'default' || D.heading_font || D.colors)) {
    out.push('\\usepackage[explicit]{titlesec}')
    const color = set === 'default' && !D.colors ? '' : '\\color{kAccent}'
    const lvls: [string, string, string][] = [
      ['section', '\\Large', '\\thesection'], ['subsection', '\\large', '\\thesubsection'], ['subsubsection', '\\normalsize', '\\thesubsubsection'],
    ]
    for (const [name, size, num] of lvls) {
      const top = name === 'section'
      switch (set) {
        case 'shaded':
          out.push(...(top
            ? [`\\titleformat{\\${name}}{${fam}\\bfseries${size}}{}{0pt}{\\colorbox{kAccent}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep}{\\color{white}\\strut ${num}\\quad #1}}}`,
              `\\titleformat{name=\\${name},numberless}{${fam}\\bfseries${size}}{}{0pt}{\\colorbox{kAccent}{\\parbox{\\dimexpr\\linewidth-2\\fboxsep}{\\color{white}\\strut #1}}}`]
            : [`\\titleformat{\\${name}}{${fam}\\bfseries${size}\\color{kAccent}}{${num}}{1em}{#1}`]))
          break
        case 'lines':
          out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}${color}}{${num}}{1em}{#1}[${top ? '\\vspace{-0.6ex}\\titlerule' : ''}]`)
          break
        case 'lines_accent':
          out.push(top
            ? `\\titleformat{\\${name}}{${fam}${size}\\color{kAccent}}{${num}}{1em}{#1}[{\\color{kSecond}\\vspace{-0.4ex}\\titlerule[1.2pt]}]`
            : `\\titleformat{\\${name}}{${fam}\\bfseries${size}\\color{kAccent}}{${num}}{1em}{#1}`)
          break
        case 'elegant':
          out.push(`\\titleformat{\\${name}}{${fam}${size}${color}}{${num}}{1em}{${top ? '\\MakeUppercase{#1}' : '\\textsc{#1}'}}`)
          if (top) out.push(`\\titlespacing*{\\${name}}{0pt}{4ex plus 1ex minus .2ex}{2ex plus .2ex}`)
          break
        case 'centered':
          out.push(`\\titleformat{\\${name}}[block]{${fam}\\bfseries${size}${color}\\centering}{${num}}{1em}{#1}`)
          break
        case 'casual':
          out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}${color}}{{\\color{kSecond}${num}}}{1em}{#1}`)
          break
        case 'basic':
        default:
          out.push(`\\titleformat{\\${name}}{${fam}\\bfseries${size}${color}}{${num}}{1em}{#1}`)
      }
    }
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

// The editor's look for a style set: CSS for the headings (the page's
// .kt-design root), the watermark and border drawn on each sheet.
export function designCss(d: Design | undefined): string {
  if (!hasDesign(d)) return ''
  const D = d!
  const accent = accentOf(D), second = secondOf(D)
  const set = D.style_set ?? 'default'
  const sel = (lv: number) => `.kt-design .kt-section[data-level="${lv}"]`
  const fam = D.heading_font === 'sans' ? 'font-family: Helvetica, Arial, sans-serif !important;' : ''
  const css: string[] = []
  const color = set === 'default' && !D.colors ? '' : `color: ${accent} !important;`
  for (const lv of [1, 2, 3]) {
    const top = lv === 1
    let r = fam + color
    switch (set) {
      case 'shaded': r += top ? `background: ${accent}; color: #fff !important; padding: 2px 6px;` : ''; break
      case 'lines': if (top) r += 'border-bottom: 0.67px solid #000; padding-bottom: 2px;'; break
      case 'lines_accent': if (top) r += `border-bottom: 1.6px solid ${second}; padding-bottom: 2px; font-weight: 400 !important;`; break
      case 'elegant': r += `font-weight: 400 !important; ${top ? 'text-transform: uppercase; letter-spacing: .04em;' : 'font-variant: small-caps;'}`; break
      case 'centered': r += 'text-align: center !important;'; break
      default: break
    }
    if (r) css.push(`${sel(lv)} { ${r} }`)
    if (set === 'casual') css.push(`${sel(lv)}::before { color: ${second}; }`)
    if (set === 'shaded' && top) css.push(`${sel(lv)}::before { color: #fff !important; }`)
  }
  return css.join('\n')
}
