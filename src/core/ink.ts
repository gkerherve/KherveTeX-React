// Draw tab (Word's ink): strokes drawn with a pen on a page, kept in
// DocMeta.ink and printed at the same place on the same PDF page (a
// shipout hook draws each page's strokes with TikZ over the text).
// Coordinates are millimetres from the page's top-left corner.

export interface InkStroke {
  page: number        // 1-based sheet / PDF page
  color: string       // #RRGGBB
  width: number       // pt
  alpha?: number      // < 1 for a highlighter
  pts: number[]       // x0, y0, x1, y1, ... in mm
}

export interface Pen { color: string; width: number; alpha?: number; kind: 'pen' | 'pencil' | 'highlighter' }

// Word's default pens, in its order.
export const DEFAULT_PENS: Pen[] = [
  { color: '#000000', width: 1, kind: 'pen' },
  { color: '#E81123', width: 1, kind: 'pen' },
  { color: '#FFFF00', width: 6, alpha: 0.4, kind: 'highlighter' },
  { color: '#FFFFFF', width: 1, kind: 'pen' },
  { color: '#7A7A7A', width: 0.75, kind: 'pencil' },
  { color: '#5DC800', width: 1, kind: 'pen' },
  { color: '#FF40FF', width: 6, alpha: 0.4, kind: 'highlighter' },
  { color: '#0063B1', width: 1, kind: 'pen' },
  { color: '#00FF00', width: 6, alpha: 0.4, kind: 'highlighter' },
  { color: '#9A0089', width: 1, kind: 'pen' },
  { color: '#FFF100', width: 1, kind: 'pen' },
  { color: '#F7630C', width: 1, kind: 'pen' },
  { color: '#00A2E8', width: 1, kind: 'pen' },
]

export const PEN_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.5, 3.5, 6, 9, 12]

const num = (v: number) => String(Math.round(v * 10) / 10)
const hex = (c: string) => c.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6)

// The preamble lines that print the strokes, '' with none.
export function inkPreamble(ink: InkStroke[] | undefined): string {
  const strokes = (ink ?? []).filter(s => s.pts.length >= 4)
  if (!strokes.length) return ''
  const pages = [...new Set(strokes.map(s => s.page))].sort((a, b) => a - b)
  const body = pages.map(p => {
    const draws = strokes.filter(s => s.page === p).map(s => {
      const pts: string[] = []
      for (let i = 0; i + 1 < s.pts.length; i += 2) pts.push(`(${num(s.pts[i])}mm,-${num(s.pts[i + 1])}mm)`)
      const opts = `line width=${num(s.width)}pt,line cap=round,line join=round,color={rgb,255:red,${parseInt(hex(s.color).slice(0, 2), 16)};green,${parseInt(hex(s.color).slice(2, 4), 16)};blue,${parseInt(hex(s.color).slice(4, 6), 16)}}`
        + (s.alpha !== undefined && s.alpha < 1 ? `,opacity=${num(s.alpha)}` : '')
      return `\\draw[${opts}] ${pts.join('--')};`
    })
    return `\\ifnum\\value{kInkPage}=${p}\\relax ${draws.join('')}\\fi`
  })
  return ['\\usepackage{tikz}', '\\newcounter{kInkPage}',
    `\\AddToHook{shipout/foreground}{\\stepcounter{kInkPage}\\put(0,0){\\begin{tikzpicture}[overlay]${body.join('')}\\end{tikzpicture}}}`].join('\n')
}

// A stroke's points thinned to about every `step` mm.
export function thin(pts: number[], step = 0.6): number[] {
  if (pts.length <= 4) return pts
  const out = [pts[0], pts[1]]
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const dx = pts[i] - out[out.length - 2], dy = pts[i + 1] - out[out.length - 1]
    if (dx * dx + dy * dy >= step * step || i + 2 >= pts.length) out.push(Math.round(pts[i] * 10) / 10, Math.round(pts[i + 1] * 10) / 10)
  }
  return out
}
