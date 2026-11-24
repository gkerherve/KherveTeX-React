// The second set of Insert ▸ Elements and Illustrations: pull quote,
// sidebar panel, rating, gauge, steps, Gantt chart and chart (also made
// from a table). Settings, LaTeX and (for the drawn ones) a shape list the
// editor draws the same way (draw.ts). Pure: no DOM.
import { clipLeft, drawingTikz, fmtNum, niceMax, starPts, type Drawing, type Shape } from './draw.ts'

export interface PullQuoteData { text: string; author: string; style: 'rules' | 'bar' | 'marks'; color: string }
export interface SidebarData { title: string; text: string; position: 'right' | 'left' | 'full'; color: string }
export interface RatingData { items: { label: string; value: number }[]; max: number; symbol: 'stars' | 'dots'; show_value: boolean; color: string }
export interface GaugeData { items: { label: string; value: number }[]; style: 'half' | 'ring'; color: string }
export interface StepsData { steps: { title: string; text: string }[]; layout: 'horizontal' | 'vertical'; color: string }
export interface GanttData { tasks: { name: string; start: number; end: number; milestone?: boolean }[]; periods: number; unit: string; grid: boolean; color: string }
export type ChartType = 'bar' | 'hbar' | 'line' | 'pie'
export interface ChartData { type: ChartType; title: string; labels: string[]; series: { name: string; values: number[] }[]; size: 'small' | 'medium' | 'large'; legend: boolean; color: string }

export const MORE_DEFAULTS = {
  pullquote: { text: 'The best way to predict the future is to invent it.', author: 'Alan Kay', style: 'rules', color: '1F6FB5' } as PullQuoteData,
  sidebar: {
    title: 'Fact file', position: 'right', color: '1F6FB5',
    text: 'Founded: 1898\nStaff: 1,200\nStudents: 18,000\n\nA sidebar sits beside the text, which flows around it in the PDF.',
  } as SidebarData,
  rating: {
    max: 5, symbol: 'stars', show_value: true, color: 'F9A825',
    items: [{ label: 'Comfort', value: 4.5 }, { label: 'Value for money', value: 4 }, { label: 'Service', value: 3 }, { label: 'Location', value: 5 }],
  } as RatingData,
  gauge: {
    style: 'half', color: '1F6FB5',
    items: [{ label: 'Budget used', value: 64 }, { label: 'Time elapsed', value: 75 }, { label: 'Scope done', value: 58 }],
  } as GaugeData,
  steps: {
    layout: 'horizontal', color: '1F6FB5',
    steps: [{ title: 'Plan', text: 'Define the question' }, { title: 'Measure', text: 'Collect the data' },
      { title: 'Analyse', text: 'Fit and test' }, { title: 'Report', text: 'Write it up' }],
  } as StepsData,
  gantt: {
    periods: 12, unit: 'Month', grid: true, color: '1F6FB5',
    tasks: [{ name: 'Literature review', start: 1, end: 3 }, { name: 'Experiments', start: 3, end: 8 },
      { name: 'Data analysis', start: 6, end: 10 }, { name: 'Writing', start: 9, end: 12 }, { name: 'Submission', start: 12, end: 12, milestone: true }],
  } as GanttData,
  chart: {
    type: 'bar', title: 'Yield by sample', size: 'medium', legend: true, color: '1F6FB5',
    labels: ['A', 'B', 'C', 'D'], series: [{ name: '2025', values: [85, 78, 91, 80] }, { name: '2026', values: [88, 84, 93, 86] }],
  } as ChartData,
}

const hex = (c: string) => (/^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '') : '1F6FB5').toUpperCase()
const tex = (s: string) => s.replace(/[\\{}$&#^_%~]/g, c => c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\^{}' : c === '~' ? '\\~{}' : '\\' + c)
const paras = (s: string) => s.split(/\n\s*\n/).map(p => p.split('\n').map(tex).join('\\\\\n')).join('\n\n')
const textW = (s: string, pt = 10) => s.length * 0.019 * pt
// A tint of the colour (pct of it, the rest white).
export function tintHex(c: string, pct: number): string {
  const h = hex(c)
  return [0, 2, 4].map(i => Math.round(255 - (255 - parseInt(h.slice(i, i + 2), 16)) * pct / 100).toString(16).padStart(2, '0')).join('').toUpperCase()
}
const GREY = 'BDBDBD', LIGHT = 'EEEEEE', INK = '333333'

// ------------------------------------------------------------------ LaTeX

export function pullQuoteLatex(d: PullQuoteData): string {
  const C = hex(d.color)
  const author = d.author.trim() ? `\\par\\smallskip{\\normalsize\\upshape\\color{black}--- ${tex(d.author.trim())}}` : ''
  const common = 'enhanced,breakable,frame hidden,boxrule=0pt,before skip=10pt,after skip=10pt,top=6pt,bottom=6pt'
  const opts = d.style === 'bar'
    ? `${common},colback=white,borderline west={4pt}{0pt}{kW},left=12pt,halign=left,fontupper=\\large\\itshape\\color{kW}`
    : d.style === 'marks'
      ? `${common},colback=kW!6,arc=2pt,left=1.2cm,right=1.2cm,halign=center,fontupper=\\Large\\itshape\\color{kW},`
        + 'overlay={\\node[anchor=north west,text=kW!45,font=\\fontsize{48}{48}\\selectfont] at ([xshift=4pt,yshift=6pt]frame.north west) {\\textquotedblleft};}'
      : `${common},colback=white,borderline north={1pt}{0pt}{kW},borderline south={1pt}{0pt}{kW},left=1cm,right=1cm,halign=center,fontupper=\\Large\\itshape\\color{kW}`
  return `\\begingroup\\definecolor{kW}{HTML}{${C}}\n\\begin{tcolorbox}[${opts}]\n${paras(d.text)}${author}\n\\end{tcolorbox}\n\\endgroup\n`
}

export function sidebarLatex(d: SidebarData): string {
  const C = hex(d.color)
  const box = `\\begin{tcolorbox}[enhanced,breakable,colback=kW!8,frame hidden,boxrule=0pt,arc=0pt,borderline north={2pt}{0pt}{kW},`
    + `left=6pt,right=6pt,top=4pt,bottom=4pt,fontupper=\\small${d.title.trim() ? `,title={${tex(d.title.trim())}},coltitle=kW,colbacktitle=kW!8,fonttitle=\\bfseries,titlerule=0pt` : ''}]\n`
    + `${paras(d.text)}\n\\end{tcolorbox}`
  if (d.position === 'full') return `\\begingroup\\definecolor{kW}{HTML}{${C}}\n${box}\n\\endgroup\n`
  // Beside the next paragraph, which flows around it.
  return `\\definecolor{kW}{HTML}{${C}}\n\\begin{wrapfigure}{${d.position === 'left' ? 'l' : 'r'}}{0.38\\linewidth}\n\\vspace{-\\baselineskip}\n${box.replace('breakable,', '')}\n\\vspace{-\\baselineskip}\n\\end{wrapfigure}\n`
}

export function stepsLatex(d: StepsData): string {
  const C = hex(d.color)
  const n = Math.max(1, d.steps.length)
  const out = [`\\begingroup\\definecolor{kW}{HTML}{${C}}`, '\\begin{center}']
  if (d.layout === 'horizontal') {
    const unit = (0.98 / n).toFixed(4)
    out.push(`\\begin{tikzpicture}[x={${unit}\\linewidth}]`)
    d.steps.forEach((s, i) => {
      const x = i + 0.5
      out.push(`\\node[circle,fill=kW,text=white,font=\\bfseries,minimum size=8mm,inner sep=0pt] (s${i}) at (${x},0) {${i + 1}};`)
      out.push(`\\node[below=3pt of s${i}.south,anchor=north,text width=${(0.88 * 0.98 / n).toFixed(4)}\\linewidth,align=center,font=\\small]`
        + ` {${s.title.trim() ? `\\textbf{${tex(s.title)}}` : ''}${s.title.trim() && s.text.trim() ? '\\\\' : ''}${tex(s.text)}};`)
      if (i > 0) out.push(`\\draw[kW!60,line width=1.2pt,-{Latex[length=2.2mm]}] (s${i - 1}.east) ++(2pt,0) -- ([xshift=-2pt]s${i}.west);`)
    })
    out.push('\\end{tikzpicture}')
  } else {
    out.push('\\begin{tabular}{@{}c@{\\hspace{0.8em}}p{0.75\\linewidth}@{}}')
    d.steps.forEach((s, i) => {
      out.push(`\\tikz[baseline=-0.7ex]\\node[circle,fill=kW,text=white,font=\\bfseries,minimum size=7mm,inner sep=0pt] {${i + 1}}; & `
        + `${s.title.trim() ? `\\textbf{${tex(s.title)}}` : ''}${s.title.trim() && s.text.trim() ? '\\newline ' : ''}${tex(s.text)} \\\\[6pt]`)
    })
    out.push('\\end{tabular}')
  }
  out.push('\\end{center}', '\\endgroup')
  return out.join('\n') + '\n'
}

export const drawnLatex = (d: Drawing) => `\\begin{center}\n${drawingTikz(d)}\n\\end{center}\n`

// ------------------------------------------------------------- drawings

export function ratingDrawing(d: RatingData): Drawing {
  const C = hex(d.color)
  const max = Math.max(1, Math.min(10, Math.round(d.max) || 5))
  const labelW = Math.min(6, Math.max(1, ...d.items.map(i => textW(i.label))) + 0.4)
  const rowH = 0.6, r = 0.21, gap = 0.52
  const W = labelW + max * gap + (d.show_value ? 1 : 0)
  const H = d.items.length * rowH + 0.1
  const shapes: Shape[] = []
  d.items.forEach((it, k) => {
    const y = H - (k + 0.5) * rowH
    shapes.push({ t: 'text', x: 0, y, s: it.label, anchor: 'west', size: 10, color: INK })
    const v = Math.max(0, Math.min(max, it.value))
    for (let i = 0; i < max; i++) {
      const cx = labelW + i * gap + r
      const full = v >= i + 1, half = !full && v >= i + 0.5
      if (d.symbol === 'dots') {
        shapes.push({ t: 'circle', x: cx, y, r: r * 0.75, fill: full ? C : 'FFFFFF', stroke: C, lw: 0.8 })
        if (half) shapes.push({ t: 'poly', pts: clipLeft(Array.from({ length: 24 }, (_, j) => [cx + r * 0.75 * Math.cos(j * Math.PI / 12), y + r * 0.75 * Math.sin(j * Math.PI / 12)] as [number, number]), cx), fill: C })
      } else {
        const pts = starPts(cx, y, r)
        shapes.push({ t: 'poly', pts, fill: full ? C : 'FFFFFF', stroke: C, lw: 0.7 })
        if (half) shapes.push({ t: 'poly', pts: clipLeft(pts, cx), fill: C })
      }
    }
    if (d.show_value) shapes.push({ t: 'text', x: labelW + max * gap + 0.15, y, s: fmtNum(v), anchor: 'west', size: 9, color: '777777' })
  })
  return { w: W, h: H, shapes }
}

export function gaugeDrawing(d: GaugeData): Drawing {
  const C = hex(d.color)
  const n = Math.max(1, d.items.length)
  const cellW = 3.6, ring = d.style === 'ring'
  const H = ring ? 3.1 : 2.4
  const shapes: Shape[] = []
  d.items.forEach((it, i) => {
    const v = Math.max(0, Math.min(100, it.value))
    const cx = i * cellW + cellW / 2
    if (ring) {
      const cy = 1.75, r = 0.95
      shapes.push({ t: 'arc', x: cx, y: cy, r, a0: 90, a1: -270, stroke: tintHex(C, 18), lw: 7 })
      if (v > 0) shapes.push({ t: 'arc', x: cx, y: cy, r, a0: 90, a1: 90 - 3.6 * v, stroke: C, lw: 7 })
      shapes.push({ t: 'text', x: cx, y: cy, s: `${fmtNum(v)}%`, size: 13, bold: true, color: C })
      shapes.push({ t: 'text', x: cx, y: 0.3, s: it.label, size: 9.5, color: INK })
    } else {
      const cy = 0.85, r = 1.15
      shapes.push({ t: 'arc', x: cx, y: cy, r, a0: 180, a1: 0, stroke: tintHex(C, 18), lw: 8 })
      if (v > 0) shapes.push({ t: 'arc', x: cx, y: cy, r, a0: 180, a1: 180 - 1.8 * v, stroke: C, lw: 8 })
      shapes.push({ t: 'text', x: cx, y: cy + 0.3, s: `${fmtNum(v)}%`, size: 13, bold: true, color: C })
      shapes.push({ t: 'text', x: cx, y: 0.3, s: it.label, size: 9.5, color: INK })
    }
  })
  return { w: n * cellW, h: H, shapes }
}

export function ganttDrawing(d: GanttData): Drawing {
  const C = hex(d.color)
  const P = Math.max(1, Math.min(60, Math.round(d.periods) || 12))
  const nameW = Math.min(5, Math.max(2.5, ...d.tasks.map(t => textW(t.name, 9.5) + 0.4)))
  const W = 15, colW = (W - nameW) / P, rowH = 0.62, headH = 0.6
  const n = d.tasks.length
  const H = headH + n * rowH + 0.1
  const shapes: Shape[] = []
  const top = H - headH
  // Rows: every other one shaded.
  d.tasks.forEach((_, k) => { if (k % 2 === 0) shapes.push({ t: 'rect', x: 0, y: top - (k + 1) * rowH, w: W, h: rowH, fill: 'F6F7F9' }) })
  if (d.grid) for (let i = 0; i <= P; i++) shapes.push({ t: 'line', pts: [[nameW + i * colW, top - n * rowH], [nameW + i * colW, top]], stroke: 'DDDDDD', lw: 0.4 })
  shapes.push({ t: 'text', x: 0.1, y: top + headH / 2, s: d.unit, anchor: 'west', size: 8.5, bold: true, color: '777777' })
  const every = colW < 0.45 ? Math.ceil(0.45 / colW) : 1
  for (let i = 0; i < P; i++) if (i % every === 0) shapes.push({ t: 'text', x: nameW + (i + 0.5) * colW, y: top + headH / 2, s: String(i + 1), size: 8.5, color: '777777' })
  shapes.push({ t: 'line', pts: [[0, top], [W, top]], stroke: GREY, lw: 0.6 })
  d.tasks.forEach((t, k) => {
    const y = top - (k + 0.5) * rowH
    shapes.push({ t: 'text', x: 0.1, y, s: t.name, anchor: 'west', size: 9.5, color: INK, bold: !!t.milestone })
    const s = Math.max(1, Math.min(P, t.start)), e = Math.max(s, Math.min(P, t.end))
    if (t.milestone) {
      const x = nameW + (s - 0.5) * colW, r = 0.2
      shapes.push({ t: 'poly', pts: [[x, y + r], [x + r, y], [x, y - r], [x - r, y]], fill: C })
    } else {
      shapes.push({ t: 'rect', x: nameW + (s - 1) * colW + 0.04, y: y - 0.18, w: (e - s + 1) * colW - 0.08, h: 0.36, fill: C, r: 0.07 })
    }
  })
  shapes.push({ t: 'line', pts: [[0, top - n * rowH], [W, top - n * rowH]], stroke: GREY, lw: 0.6 })
  return { w: W, h: H, shapes }
}

export const CHART_PALETTE = ['1F6FB5', 'E65100', '2E7D32', '6A1B9A', 'C62828', '00838F', 'F9A825', '5D4037']
const CHART_W = { small: 8, medium: 11, large: 14 }

export function chartColors(d: ChartData, n: number): string[] {
  const base = hex(d.color)
  return [base, ...CHART_PALETTE.filter(c => c !== base)].slice(0, Math.max(n, 1)).concat(CHART_PALETTE).slice(0, Math.max(n, 1))
}

export function chartDrawing(d: ChartData): Drawing {
  const W = CHART_W[d.size] ?? 11
  const H = Math.round(W * 0.56 * 100) / 100
  const shapes: Shape[] = []
  const series = d.series.length ? d.series : [{ name: '', values: [] }]
  const n = d.labels.length
  const pal = d.type === 'pie' ? chartColors(d, n) : chartColors(d, series.length)
  const T = d.title.trim() ? 0.75 : 0.3
  if (d.title.trim()) shapes.push({ t: 'text', x: W / 2, y: H - 0.35, s: d.title, size: 11, bold: true, color: INK })
  if (d.type === 'pie') {
    const vals = d.labels.map((_, i) => Math.max(0, series[0].values[i] ?? 0))
    const total = vals.reduce((a, b) => a + b, 0) || 1
    const r = Math.min((H - T - 0.4) / 2, W * 0.22)
    const cx = r + 0.6, cy = (H - T) / 2 + 0.1
    let a = 90
    vals.forEach((v, i) => {
      const sweep = (v / total) * 360
      if (sweep > 0) shapes.push({ t: 'wedge', x: cx, y: cy, r, a0: a, a1: a - sweep, fill: pal[i % pal.length] })
      a -= sweep
    })
    const lx = cx + r + 0.9, rowH = Math.min(0.55, (H - T - 0.3) / Math.max(1, n))
    d.labels.forEach((lab, i) => {
      const y = H - T - 0.3 - i * rowH
      shapes.push({ t: 'rect', x: lx, y: y - 0.13, w: 0.26, h: 0.26, fill: pal[i % pal.length], r: 0.04 })
      shapes.push({ t: 'text', x: lx + 0.4, y, s: `${lab}  ${Math.round(vals[i] / total * 100)}%`, anchor: 'west', size: 9.5, color: INK })
    })
    return { w: W, h: H, shapes }
  }
  const legend = d.legend && series.length > 1
  const max = Math.max(0, ...series.flatMap(s => s.values.filter(v => Number.isFinite(v))))
  const { top, step } = niceMax(max)
  const B = (d.type === 'hbar' ? 0.7 : 0.9) + (legend ? 0.5 : 0)
  if (legend) {
    let x = 0.3
    series.forEach((s, j) => {
      shapes.push({ t: 'rect', x, y: 0.17, w: 0.26, h: 0.26, fill: pal[j % pal.length], r: 0.04 })
      shapes.push({ t: 'text', x: x + 0.36, y: 0.3, s: s.name, anchor: 'west', size: 9, color: INK })
      x += 0.36 + Math.max(0.8, s.name.length * 0.17) + 0.5
    })
  }
  if (d.type === 'hbar') {
    const L = Math.min(4, Math.max(0.8, ...d.labels.map(l => textW(l, 9))) + 0.3)
    const x0 = L, y0 = B, pw = W - L - 0.4, ph = H - B - T
    for (let v = 0; v <= top + 1e-9; v += step) {
      const x = x0 + (v / top) * pw
      shapes.push({ t: 'line', pts: [[x, y0], [x, y0 + ph]], stroke: LIGHT, lw: 0.5 })
      shapes.push({ t: 'text', x, y: y0 - 0.12, s: fmtNum(v), anchor: 'north', size: 8, color: '777777' })
    }
    const gh = ph / Math.max(1, n), bh = gh * 0.72 / series.length
    d.labels.forEach((lab, i) => {
      const gy = y0 + ph - (i + 1) * gh
      shapes.push({ t: 'text', x: x0 - 0.12, y: gy + gh / 2, s: lab, anchor: 'east', size: 9, color: INK })
      series.forEach((s, j) => {
        const v = Math.max(0, s.values[i] ?? 0)
        shapes.push({ t: 'rect', x: x0, y: gy + gh * 0.14 + (series.length - 1 - j) * bh, w: (v / top) * pw, h: bh * 0.92, fill: pal[j % pal.length] })
      })
    })
    shapes.push({ t: 'line', pts: [[x0, y0], [x0, y0 + ph]], stroke: '999999', lw: 0.6 })
    return { w: W, h: H, shapes }
  }
  const L = Math.max(0.9, fmtNum(top).length * 0.17 + 0.35)
  const x0 = L, y0 = B, pw = W - L - 0.3, ph = H - B - T
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = y0 + (v / top) * ph
    shapes.push({ t: 'line', pts: [[x0, y], [x0 + pw, y]], stroke: LIGHT, lw: 0.5 })
    shapes.push({ t: 'text', x: x0 - 0.12, y, s: fmtNum(v), anchor: 'east', size: 8, color: '777777' })
  }
  const gw = pw / Math.max(1, n)
  d.labels.forEach((lab, i) => shapes.push({ t: 'text', x: x0 + (i + 0.5) * gw, y: y0 - 0.12, s: lab, anchor: 'north', size: 9, color: INK }))
  if (d.type === 'line') {
    series.forEach((s, j) => {
      const pts = d.labels.map((_, i) => [x0 + (i + 0.5) * gw, y0 + (Math.max(0, s.values[i] ?? 0) / top) * ph] as [number, number])
      if (pts.length > 1) shapes.push({ t: 'line', pts, stroke: pal[j % pal.length], lw: 1.6 })
      for (const [x, y] of pts) shapes.push({ t: 'circle', x, y, r: 0.075, fill: pal[j % pal.length] })
    })
  } else {
    const bw = gw * 0.72 / series.length
    d.labels.forEach((_, i) => series.forEach((s, j) => {
      const v = Math.max(0, s.values[i] ?? 0)
      shapes.push({ t: 'rect', x: x0 + i * gw + gw * 0.14 + j * bw, y: y0, w: bw * 0.92, h: (v / top) * ph, fill: pal[j % pal.length] })
    }))
  }
  shapes.push({ t: 'line', pts: [[x0, y0], [x0 + pw, y0]], stroke: '999999', lw: 0.6 })
  return { w: W, h: H, shapes }
}

// A chart from a table's cells: the first row names the series, the first
// column the labels; cells that are not numbers count as 0.
export function chartFromRows(rows: string[][], color = '1F6FB5'): ChartData | null {
  const num = (s: string) => {
    const t = s.replace(/\\%|%|\\,|\s|€|\$|£/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')
    const v = parseFloat(t)
    return Number.isFinite(v) ? v : NaN
  }
  if (rows.length < 2 || (rows[0]?.length ?? 0) < 2) return null
  const head = rows[0], body = rows.slice(1)
  const cols = head.map((_, c) => c).slice(1).filter(c => body.some(r => Number.isFinite(num(r[c] ?? ''))))
  if (!cols.length) return null
  const clean = (s: string) => s.replace(/\\textbf\{([^}]*)\}/g, '$1').replace(/\\([%&#_$])/g, '$1').replace(/[{}]/g, '').trim()
  return {
    type: 'bar', title: '', size: 'medium', legend: cols.length > 1, color,
    labels: body.map(r => clean(r[0] ?? '')),
    series: cols.map(c => ({ name: clean(head[c] ?? ''), values: body.map(r => { const v = num(r[c] ?? ''); return Number.isFinite(v) ? v : 0 }) })),
  }
}
