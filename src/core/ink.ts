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
  // The word the stroke was drawn on: paragraph `block` (index in the
  // document's blocks), `offset` characters of text into it; x, y the
  // word's baseline point (mm on `page`) when drawn. An anchored stroke
  // follows its word, in the editor and in the PDF.
  anchor?: InkAnchor
}

export interface InkAnchor { block: number; offset: number; x: number; y: number }

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

function drawCmd(s: InkStroke, ox = 0, oy = 0): string {
  const pts: string[] = []
  for (let i = 0; i + 1 < s.pts.length; i += 2) pts.push(`(${num(s.pts[i] - ox)}mm,${num(-(s.pts[i + 1] - oy))}mm)`)
  const opts = `line width=${num(s.width)}pt,line cap=round,line join=round,color={rgb,255:red,${parseInt(hex(s.color).slice(0, 2), 16)};green,${parseInt(hex(s.color).slice(2, 4), 16)};blue,${parseInt(hex(s.color).slice(4, 6), 16)}}`
    + (s.alpha !== undefined && s.alpha < 1 ? `,opacity=${num(s.alpha)}` : '')
  return `\\draw[${opts}] ${pts.join('--')};`
}

// The preamble lines that print the strokes, '' with none. The strokes
// in `placed` (indices into `ink`) are anchored in the text: \kInk{i} at
// their word draws them from there; the others go on their page.
export function inkPreamble(ink: InkStroke[] | undefined, placed: Set<number> = new Set()): string {
  const all = ink ?? []
  const strokes = all.filter((s, i) => s.pts.length >= 4 && !placed.has(i))
  const anchored = [...placed].filter(i => all[i] && all[i].pts.length >= 4 && all[i].anchor)
  if (!strokes.length && !anchored.length) return ''
  const out = ['\\usepackage{tikz}']
  if (strokes.length) {
    const pages = [...new Set(strokes.map(s => s.page))].sort((a, b) => a - b)
    const body = pages.map(p => `\\ifnum\\value{kInkPage}=${p}\\relax ${strokes.filter(s => s.page === p).map(s => drawCmd(s)).join('')}\\fi`)
    out.push('\\newcounter{kInkPage}',
      `\\AddToHook{shipout/foreground}{\\stepcounter{kInkPage}\\put(0,0){\\begin{tikzpicture}[overlay]${body.join('')}\\end{tikzpicture}}}`)
  }
  if (anchored.length) {
    // Each anchored stroke: a picture of no size at its word's baseline.
    out.push('\\newcommand{\\kInk}[1]{\\csname kInkStroke#1\\endcsname}')
    for (const i of anchored) {
      const s = all[i], a = s.anchor!
      out.push(`\\expandafter\\def\\csname kInkStroke${i}\\endcsname{\\begin{tikzpicture}[overlay]${drawCmd(s, a.x, a.y)}\\end{tikzpicture}}`)
    }
  }
  return out.join('\n')
}

// The blocks with \kInk{i} put at each anchored stroke's word; `placed`
// the strokes so anchored (a paragraph and an offset that still exist).
export function placeInk<B extends { type: string }>(blocks: B[], ink: InkStroke[] | undefined): { blocks: B[]; placed: Set<number> } {
  const placed = new Set<number>()
  if (!ink?.some(s => s.anchor)) return { blocks, placed }
  const out = blocks.slice()
  ink.forEach((s, i) => {
    const a = s.anchor
    if (!a || s.pts.length < 4) return
    const b = out[a.block] as unknown as { type: string; children?: InlineLike[] }
    if (!b || b.type !== 'Paragraph' || !b.children) return
    const kids = insertRaw(b.children, a.offset, `\\kInk{${i}}`)
    if (!kids) return
    out[a.block] = { ...b, children: kids } as unknown as B
    placed.add(i)
  })
  return { blocks: out, placed }
}

interface InlineLike { type: string; text?: string; children?: InlineLike[]; marks?: string[] }

// The text characters an inline counts (as in the editor: footnotes and
// math are one object with no text).
function textLen(n: InlineLike): number {
  if (n.type === 'Text') return (n.text ?? '').length
  if (n.type === 'Link' || n.type === 'Highlight' || n.type === 'Comment') return (n.children ?? []).reduce((t, c) => t + textLen(c), 0)
  return 0
}

function insertRaw(nodes: InlineLike[], off: number, latex: string): InlineLike[] | null {
  const raw: InlineLike = { latex, type: 'InlineRaw' } as InlineLike
  let left = off
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k]
    const len = textLen(n)
    if (n.type === 'Text' && left <= len) {
      const t = n.text ?? ''
      const parts: InlineLike[] = []
      if (left > 0) parts.push({ ...n, text: t.slice(0, left) })
      parts.push(raw)
      if (left < t.length) parts.push({ ...n, text: t.slice(left) })
      return [...nodes.slice(0, k), ...parts, ...nodes.slice(k + 1)]
    }
    if (n.children && left < len) {
      const inner = insertRaw(n.children, left, latex)
      if (inner) return [...nodes.slice(0, k), { ...n, children: inner }, ...nodes.slice(k + 1)]
    }
    if (left === 0) return [...nodes.slice(0, k), raw, ...nodes.slice(k)]
    left -= len
  }
  return left === 0 ? [...nodes, raw] : null
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
