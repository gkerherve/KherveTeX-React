// A small list of shapes (cm, y up) that both the PDF (TikZ) and the
// editor (SVG) draw, so charts, Gantt charts, gauges and ratings look the
// same in both. Pure: no DOM.

export type Anchor = 'west' | 'east' | 'center' | 'north' | 'south' | 'north west' | 'north east' | 'south west' | 'south east'
export type Shape =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; lw?: number; r?: number }
  | { t: 'line'; pts: [number, number][]; stroke: string; lw?: number; dash?: boolean; arrow?: boolean }
  | { t: 'poly'; pts: [number, number][]; fill: string; stroke?: string; lw?: number }
  | { t: 'circle'; x: number; y: number; r: number; fill?: string; stroke?: string; lw?: number }
  | { t: 'text'; x: number; y: number; s: string; anchor?: Anchor; size?: number; bold?: boolean; color?: string; rotate?: number }
  | { t: 'wedge'; x: number; y: number; r: number; a0: number; a1: number; fill: string }
  | { t: 'arc'; x: number; y: number; r: number; a0: number; a1: number; stroke: string; lw: number }

export interface Drawing { w: number; h: number; shapes: Shape[] }

const f = (n: number) => String(Math.round(n * 1000) / 1000)
const hex = (c: string) => c.replace('#', '').toUpperCase()

// LaTeX special characters in a label.
export function texText(s: string): string {
  return s.replace(/[\\{}$&#^_%~]/g, c => c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\^{}' : c === '~' ? '\\~{}' : '\\' + c)
}

// Font size (pt) of a text shape: 10 unless set.
const FONT: [number, string][] = [[6, '\\tiny'], [7.5, '\\scriptsize'], [8.5, '\\footnotesize'], [9.5, '\\small'], [11, '\\normalsize'], [13, '\\large'], [99, '\\Large']]
const fontCmd = (pt = 10) => FONT.find(([p]) => pt <= p)![1]

// The drawing as a tikzpicture, scaled down to the line width if wider.
export function drawingTikz(d: Drawing): string {
  const colors = new Set<string>()
  const col = (c?: string) => { if (!c) return ''; const h = hex(c); colors.add(h); return `kD${h}` }
  const body: string[] = []
  for (const s of d.shapes) {
    switch (s.t) {
      case 'rect': {
        const opts = [s.fill ? `fill=${col(s.fill)}` : '', s.stroke ? `draw=${col(s.stroke)}` : '', s.lw ? `line width=${f(s.lw)}pt` : '', s.r ? `rounded corners=${f(s.r)}cm` : ''].filter(Boolean)
        body.push(`\\path[${opts.join(',')}] (${f(s.x)},${f(s.y)}) rectangle (${f(s.x + s.w)},${f(s.y + s.h)});`)
        break
      }
      case 'line':
        body.push(`\\draw[${col(s.stroke)},line width=${f(s.lw ?? 0.6)}pt${s.dash ? ',dashed' : ''}${s.arrow ? ',-{Latex[length=2mm]}' : ''},line cap=round,line join=round] ${s.pts.map(([x, y]) => `(${f(x)},${f(y)})`).join(' -- ')};`)
        break
      case 'poly':
        body.push(`\\path[fill=${col(s.fill)}${s.stroke ? `,draw=${col(s.stroke)},line width=${f(s.lw ?? 0.5)}pt` : ''}] ${s.pts.map(([x, y]) => `(${f(x)},${f(y)})`).join(' -- ')} -- cycle;`)
        break
      case 'circle':
        body.push(`\\path[${[s.fill ? `fill=${col(s.fill)}` : '', s.stroke ? `draw=${col(s.stroke)},line width=${f(s.lw ?? 0.6)}pt` : ''].filter(Boolean).join(',')}] (${f(s.x)},${f(s.y)}) circle (${f(s.r)});`)
        break
      case 'text':
        body.push(`\\node[anchor=${s.anchor ?? 'center'},inner sep=1pt,font=${fontCmd(s.size)}${s.bold ? '\\bfseries' : ''}${s.color ? `,text=${col(s.color)}` : ''}${s.rotate ? `,rotate=${s.rotate}` : ''}] at (${f(s.x)},${f(s.y)}) {${texText(s.s)}};`)
        break
      case 'wedge':
        body.push(`\\fill[${col(s.fill)},draw=white,line width=0.8pt] (${f(s.x)},${f(s.y)}) -- ++(${f(s.a0)}:${f(s.r)}) arc[start angle=${f(s.a0)},end angle=${f(s.a1)},radius=${f(s.r)}] -- cycle;`)
        break
      case 'arc':
        body.push(`\\draw[${col(s.stroke)},line width=${f(s.lw)}pt] (${f(s.x)},${f(s.y)}) ++(${f(s.a0)}:${f(s.r)}) arc[start angle=${f(s.a0)},end angle=${f(s.a1)},radius=${f(s.r)}];`)
        break
    }
  }
  const defs = [...colors].map(c => `\\definecolor{kD${c}}{HTML}{${c}}`).join('')
  const pic = `\\begin{tikzpicture}[x=1cm,y=1cm,baseline=(current bounding box.center)]\n\\useasboundingbox (0,0) rectangle (${f(d.w)},${f(d.h)});\n${body.join('\n')}\n\\end{tikzpicture}`
  return `{${defs}\\sbox0{${pic}}\\ifdim\\wd0>\\linewidth\\resizebox{\\linewidth}{!}{\\usebox0}\\else\\usebox0\\fi}`
}

// Nice axis steps: the maximum rounded up to 1, 2 or 5 times a power of 10.
export function niceMax(max: number, ticks = 5): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.2 }
  const raw = max / ticks
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw)!
  return { top: Math.ceil(max / step - 1e-9) * step, step }
}

export const fmtNum = (v: number) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : String(Math.round(v * 100) / 100))

// A five-pointed star centred at (cx, cy).
export function starPts(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5
    const rr = i % 2 ? r * 0.42 : r
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return pts
}

// The part of a polygon left of x = xc (Sutherland-Hodgman, one edge).
export function clipLeft(pts: [number, number][], xc: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const ain = a[0] <= xc, bin = b[0] <= xc
    if (ain) out.push(a)
    if (ain !== bin) {
      const t = (xc - a[0]) / (b[0] - a[0])
      out.push([xc, a[1] + t * (b[1] - a[1])])
    }
  }
  return out
}
