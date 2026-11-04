// LaTeX's own fonts for the visual editor, a port of khervedoc/latex_fonts.py.
// With the real Computer Modern metrics on screen, lines wrap on the same
// words as in the PDF. Every Latin Modern design size is its own family
// ("KTeX LMRoman12", fonts.css) so a 17 pt title and a 12 pt body can
// share a page, and bold and italic still work by family.
import FONT_FILES from './fontFiles.json' with { type: 'json' }

const FILES = FONT_FILES as Record<string, Record<string, boolean>>

export function designSize(bodyPt: number): number {
  return bodyPt >= 12 ? 12 : 10
}

// LaTeX's \baselineskip for the standard class sizes, in pt.
const BASELINESKIP: Record<number, number> = { 10: 12.0, 11: 13.6, 12: 14.5 }
// setspace's \onehalfspacing / \doublespacing stretch per class size.
const ONEHALF: Record<number, number> = { 10: 1.25, 11: 1.213, 12: 1.241 }
const DOUBLE: Record<number, number> = { 10: 1.667, 11: 1.618, 12: 1.655 }

function nearestSize(pt: number): number {
  let best = 10
  for (const s of [10, 11, 12]) if (Math.abs(s - pt) < Math.abs(best - pt)) best = s
  return best
}

// Distance between body lines in the PDF, as LaTeX sets it.
export function baselineskipPt(bodyPt: number, lineSpacing: number): number {
  const size = nearestSize(bodyPt)
  const skip = BASELINESKIP[size] * bodyPt / size
  let stretch: number
  if (Math.abs(lineSpacing - 1.5) < 0.01) stretch = ONEHALF[size]
  else if (Math.abs(lineSpacing - 2.0) < 0.01) stretch = DOUBLE[size]
  else stretch = lineSpacing || 1.0
  return skip * stretch
}

const DESIGN_RE = /^(LMRomanCaps|LMRomanSlant|LMRomanDunh|LMRoman|LMSans|LMMono)(\d+)-(\w+)$/
// PDF fonts without an OpenType file of their own: the same design in a
// file that exists.
const ALIASES: Record<string, string> = {
  CMR: 'LMRoman{}-Regular', CMB: 'LMRoman{}-Bold',
  CMBX: 'LMRoman{}-Bold', CMTI: 'LMRoman{}-Italic',
  CMCSC: 'LMRomanCaps{}-Regular', CMSS: 'LMSans{}-Regular',
}
const OTHER_FAMILIES: [string, string][] = [
  ['LinBiolinumO', 'Linux Biolinum O'],
  ['LinLibertineO', 'Linux Libertine O'],
  ['TeXGyreHeros', 'TeX Gyre Heros'],
  ['TeXGyreTermesX', 'TeX Gyre Termes'],
  ['NimbusRomNo9L', 'TeX Gyre Termes'],
  ['DejaVuSerif', 'DejaVu Serif'],
]
// The closest installed families when the bundle has no file.
const FALLBACKS = {
  serif: ['Latin Modern Roman', 'CMU Serif', 'Times New Roman', 'Times'],
  sans: ['Latin Modern Sans', 'Helvetica', 'Arial'],
}

// Bold and italic as a PDF font name spells them.
export function weightAndSlant(name: string): [boolean, boolean] {
  const parts = name.split('-')
  const style = name.includes('-') ? parts[parts.length - 1] : name
  const bold = style.includes('Bold') || style.includes('Medi') || name.startsWith('CMB')
    || (name.startsWith('Lin') && ['OB', 'BI'].includes(style.slice(-2)))
  const italic = ['Italic', 'Oblique', 'Ital'].some(w => style.includes(w))
    || name.startsWith('CMTI') || (name.startsWith('Lin') && style.endsWith('OI'))
  return [bold, italic]
}

export interface ScreenFont {
  // A CSS font-family list, best first.
  family: string
  bold: boolean
  italic: boolean
}

const quote = (f: string) => `'${f}'`

// The CSS family, bold and italic that draw a font named `name` in a PDF.
export function pdfFont(name: string): ScreenFont {
  const cm = /^(CM[A-Z]+?)(\d+)$/.exec(name)
  if (cm && ALIASES[cm[1]]) name = ALIASES[cm[1]].replace('{}', cm[2])
  const [bold, italic] = weightAndSlant(name)
  const kind = name.includes('Sans') || name.includes('Heros') ? 'sans' : 'serif'
  const fallback = [...FALLBACKS[kind], kind === 'sans' ? 'sans-serif' : 'serif'].map(quote).join(', ')
  const m = DESIGN_RE.exec(name)
  if (m) {
    const family = `KTeX ${m[1]}${m[2]}`
    if (FILES[family]) return { family: `${quote(family)}, ${fallback}`, bold, italic }
  } else {
    for (const [prefix, family] of OTHER_FAMILIES) {
      if (name.startsWith(prefix)) {
        if (FILES[family]) return { family: `${quote(family)}, ${fallback}`, bold, italic }
        break
      }
    }
  }
  return { family: fallback, bold, italic }
}

// The first family of a CSS list, as Qt's QFont.family() would report.
export function primaryFamily(css: string): string {
  return css.split(',')[0].trim().replace(/^'|'$/g, '')
}

// Wait until the faces a document uses are loaded, so measurements
// (pagination, run-in widths) use the real metrics.
export async function loadFonts(families: string[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const loads: Promise<unknown>[] = []
  for (const f of families) {
    for (const w of ['400', '700']) {
      for (const s of ['normal', 'italic']) loads.push(document.fonts.load(`${s} ${w} 16px ${f}`).catch(() => null))
    }
  }
  await Promise.all(loads)
}
