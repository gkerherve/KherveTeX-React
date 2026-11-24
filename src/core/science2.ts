// More Science tab drawings: safety (risk matrix, safety signs), physics
// (free-body diagram, ray optics, wave, energy levels) and maths (function
// plot, number line, Venn diagram, triangle, statistics, unit circle).
// Each is a shape list (draw.ts) the PDF and the editor both draw.
// Pure: no DOM.
import { fmtNum, niceMax, type Drawing, type Shape } from './draw.ts'

const hex = (c: string) => (/^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '') : '1F6FB5').toUpperCase()
const INK = '333333', GREY = '999999', LIGHT = 'E8E8E8'
const num = (s: string) => parseFloat(String(s).replace(',', '.'))
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(l => l)

function arrow(a: [number, number], b: [number, number], C: string, lw = 1.2, head = 0.18): Shape[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L
  const bx = b[0] - ux * head, by = b[1] - uy * head
  return [{ t: 'line', pts: [a, [bx, by]], stroke: C, lw },
    { t: 'poly', pts: [b, [bx - uy * head * 0.5, by + ux * head * 0.5], [bx + uy * head * 0.5, by - ux * head * 0.5]], fill: C }]
}
const text = (x: number, y: number, s: string, o: Partial<Extract<Shape, { t: 'text' }>> = {}): Shape => ({ t: 'text', x, y, s, size: 9.5, color: INK, ...o })

export interface RiskData { risks: string; color: string }
export interface SignsData { signs: string[]; captions: boolean }
export interface ForcesData { forces: string; object: 'box' | 'ball' | 'slope'; angle: number; color: string }
export interface OpticsData { lens: 'converging' | 'diverging'; focal: number; object: number; height: number; color: string }
export interface WaveData { wavelength: number; amplitude: number; cycles: number; labels: boolean; second: boolean; color: string }
export interface LevelsData { levels: string; transitions: string; color: string }
export interface FunctionData { functions: string; xmin: number; xmax: number; ymin: string; ymax: string; grid: boolean; color: string }
export interface NumberLineData { from: number; to: number; step: number; points: string; intervals: string; color: string }
export interface VennData { sets: string; regions: string; color: string }
export interface TriangleData { a: number; b: number; c: number; labels: string; angles: boolean; color: string }
export interface StatsData { data: string; kind: 'histogram' | 'boxplot'; bins: number; xlabel: string; color: string }
export interface UnitCircleData { angles: string; projections: boolean; color: string }

export const SCIENCE2_DEFAULTS = {
  risk: { color: '000000', risks: 'Burn from hot plate: 3, 2\nHF splash: 2, 5\nCut from glass: 3, 2\nTrip on cable: 2, 1' } as RiskData,
  signs: { signs: ['goggles', 'gloves', 'coat', 'nosmoking', 'nofood', 'toxic', 'firstaid', 'eyewash', 'extinguisher'], captions: true } as SignsData,
  forces: { object: 'slope', angle: 30, color: 'C62828', forces: 'Weight W: 270, 1.6\nNormal N: 60, 1.4\nFriction F: 150, 0.8' } as ForcesData,
  optics: { lens: 'converging', focal: 4, object: 7, height: 1.5, color: '1F6FB5' } as OpticsData,
  wave: { wavelength: 4, amplitude: 1, cycles: 2, labels: true, second: false, color: '1F6FB5' } as WaveData,
  levels: { color: '1F6FB5', levels: 'n = 1: -13.6\nn = 2: -3.40\nn = 3: -1.51\nn = 4: -0.85\nn = 5: -0.54\nn = ∞: 0', transitions: '3 → 2: Hα 656 nm\n4 → 2: Hβ 486 nm\n2 → 1: Lyman α' } as LevelsData,
  function: { functions: 'sin(x)\n0.5*x^2 - 2', xmin: -4, xmax: 4, ymin: '', ymax: '', grid: true, color: '1F6FB5' } as FunctionData,
  numberline: { from: -5, to: 5, step: 1, points: '-2: closed\n3: open', intervals: '-2 to 3', color: '1F6FB5' } as NumberLineData,
  venn: { sets: 'Physics, Chemistry, Biology', regions: 'A: 12\nB: 9\nC: 15\nAB: 4\nAC: 3\nBC: 5\nABC: 2', color: '1F6FB5' } as VennData,
  triangle: { a: 5, b: 4, c: 3, labels: 'A, B, C', angles: true, color: '1F6FB5' } as TriangleData,
  stats: { kind: 'histogram', bins: 7, xlabel: 'Height (cm)', color: '1F6FB5',
    data: '152 158 160 161 163 164 165 166 166 167 168 169 170 170 171 172 172 173 174 175 175 176 177 178 180 181 183 185 188 192' } as StatsData,
  unitcircle: { angles: '30, 45, 60, 120', projections: true, color: '1F6FB5' } as UnitCircleData,
}

// ------------------------------------------------------------ risk matrix

const RISK_COLOR = (score: number) => (score >= 15 ? 'E53935' : score >= 8 ? 'FB8C00' : score >= 4 ? 'FDD835' : '43A047')

export function parseRisks(text: string): { label: string; l: number; s: number }[] {
  return lines(text).map(l => {
    const m = /^(.*?)[:|]\s*(\d)\s*[,x×]\s*(\d)\s*$/.exec(l)
    return m ? { label: m[1].trim(), l: Math.max(1, Math.min(5, Number(m[2]))), s: Math.max(1, Math.min(5, Number(m[3]))) } : null
  }).filter(Boolean) as { label: string; l: number; s: number }[]
}

export function riskDrawing(d: RiskData): Drawing {
  const cell = 1.1, x0 = 2.4, y0 = 1.1
  const shapes: Shape[] = []
  const risks = parseRisks(d.risks)
  for (let l = 1; l <= 5; l++) for (let s = 1; s <= 5; s++) {
    const x = x0 + (s - 1) * cell, y = y0 + (l - 1) * cell
    shapes.push({ t: 'rect', x, y, w: cell, h: cell, fill: RISK_COLOR(l * s), stroke: 'FFFFFF', lw: 1.5 })
    shapes.push(text(x + cell - 0.12, y + cell - 0.12, String(l * s), { anchor: 'north east', size: 7, color: '00000080'.slice(0, 6) }))
  }
  const L = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'], S = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe']
  L.forEach((t, i) => shapes.push(text(x0 - 0.1, y0 + (i + 0.5) * cell, t, { anchor: 'east', size: 7.5 })))
  S.forEach((t, i) => shapes.push(text(x0 + (i + 0.5) * cell, y0 - 0.1, t, { anchor: 'north', size: 7.5 })))
  shapes.push(text(x0 + 2.5 * cell, 0.15, 'Severity', { bold: true, size: 9 }))
  shapes.push(text(0.2, y0 + 2.5 * cell, 'Likelihood', { bold: true, size: 9, rotate: 90 }))
  // Each risk: a numbered dot in its cell, the key on the right.
  const kx = x0 + 5 * cell + 0.5
  const counts = new Map<string, number>()
  risks.forEach((r, i) => {
    const k = `${r.l},${r.s}`, n = counts.get(k) ?? 0
    counts.set(k, n + 1)
    const cx = x0 + (r.s - 1) * cell + 0.32 + (n % 3) * 0.3, cy = y0 + (r.l - 1) * cell + 0.32 + Math.floor(n / 3) * 0.3
    shapes.push({ t: 'circle', x: cx, y: cy, r: 0.13, fill: 'FFFFFF', stroke: '000000', lw: 0.6 })
    shapes.push(text(cx, cy, String(i + 1), { size: 6.5, bold: true, color: '000000' }))
    const ky = y0 + 5 * cell - 0.3 - i * 0.5
    shapes.push({ t: 'circle', x: kx, y: ky, r: 0.13, fill: RISK_COLOR(r.l * r.s), stroke: '000000', lw: 0.5 })
    shapes.push(text(kx, ky, String(i + 1), { size: 6.5, bold: true, color: '000000' }))
    shapes.push(text(kx + 0.25, ky, `${r.label} (${r.l} × ${r.s} = ${r.l * r.s})`, { anchor: 'west', size: 8.5 }))
  })
  const keyW = Math.max(3, ...risks.map(r => (r.label.length + 16) * 0.155))
  return { w: kx + 0.35 + keyW, h: y0 + 5 * cell + 0.1, shapes }
}

// ----------------------------------------------------------- safety signs

// [key, caption, family, fontawesome icon, editor character]
export const SIGNS: [string, string, 'mandatory' | 'prohibition' | 'warning' | 'emergency' | 'fire', string, string][] = [
  ['goggles', 'Wear eye protection', 'mandatory', 'glasses', '👓'], ['gloves', 'Wear gloves', 'mandatory', 'mitten', '🧤'],
  ['coat', 'Wear a lab coat', 'mandatory', 'tshirt', '🥼'], ['mask', 'Wear a mask', 'mandatory', 'head-side-mask', '😷'],
  ['helmet', 'Wear a hard hat', 'mandatory', 'hard-hat', '⛑'], ['ears', 'Wear ear protection', 'mandatory', 'deaf', '🎧'],
  ['nosmoking', 'No smoking', 'prohibition', 'smoking', '🚬'], ['nofood', 'No eating or drinking', 'prohibition', 'utensils', '🍴'],
  ['nophone', 'No mobile phones', 'prohibition', 'mobile-alt', '📱'], ['notouch', 'Do not touch', 'prohibition', 'hand-paper', '✋'],
  ['toxic', 'Toxic', 'warning', 'skull-crossbones', '☠'], ['radiation', 'Radiation', 'warning', 'radiation', '☢'],
  ['electric', 'Electricity', 'warning', 'bolt', '⚡'], ['biohazard', 'Biological hazard', 'warning', 'biohazard', '☣'],
  ['magnet', 'Magnetic field', 'warning', 'magnet', '🧲'], ['hot', 'Hot surface', 'warning', 'temperature-high', '🌡'],
  ['general', 'General warning', 'warning', 'exclamation-triangle', '⚠'],
  ['firstaid', 'First aid', 'emergency', 'first-aid', '✚'], ['eyewash', 'Eye wash', 'emergency', 'eye', '👁'],
  ['shower', 'Safety shower', 'emergency', 'shower', '🚿'], ['exit', 'Emergency exit', 'emergency', 'running', '🏃'],
  ['extinguisher', 'Fire extinguisher', 'fire', 'fire-extinguisher', '🧯'],
]

export function signsDrawing(d: SignsData): Drawing {
  const S = 1.6, gap = 0.5
  const shapes: Shape[] = []
  const list = d.signs.map(k => SIGNS.find(s => s[0] === k)).filter(Boolean) as typeof SIGNS
  list.forEach(([, cap, fam, fa, ch], i) => {
    const cx = i * (S + gap) + S / 2 + 0.2, cy = S / 2 + (d.captions ? 0.75 : 0.1)
    const icon = (color: string) => shapes.push({ t: 'text', x: cx, y: cy, s: ch, tex: `\\faIcon{${fa}}`, size: 99, color })
    switch (fam) {
      case 'mandatory': shapes.push({ t: 'circle', x: cx, y: cy, r: S / 2, fill: '005EB8' }); icon('FFFFFF'); break
      case 'prohibition':
        shapes.push({ t: 'circle', x: cx, y: cy, r: S / 2 - 0.08, fill: 'FFFFFF', stroke: 'D50000', lw: 5 }); icon('000000')
        shapes.push({ t: 'line', pts: [[cx - S * 0.33, cy + S * 0.33], [cx + S * 0.33, cy - S * 0.33]], stroke: 'D50000', lw: 5 })
        break
      case 'warning': {
        const r = S * 0.6
        shapes.push({ t: 'poly', pts: [[cx, cy + r], [cx + r * 0.95, cy - r * 0.6], [cx - r * 0.95, cy - r * 0.6]], fill: 'FFD600', stroke: '000000', lw: 2 })
        shapes.push({ t: 'text', x: cx, y: cy - 0.12, s: ch, tex: `{\\footnotesize\\faIcon{${fa}}}`, size: 99, color: '000000' })
        break
      }
      case 'emergency': shapes.push({ t: 'rect', x: cx - S / 2, y: cy - S / 2, w: S, h: S, fill: '00843D', r: 0.08 }); icon('FFFFFF'); break
      case 'fire': shapes.push({ t: 'rect', x: cx - S / 2, y: cy - S / 2, w: S, h: S, fill: 'D50000', r: 0.08 }); icon('FFFFFF'); break
    }
    if (d.captions) {
      const words = cap.split(' '), half = Math.ceil(words.length / 2)
      const l1 = words.length > 2 ? words.slice(0, half).join(' ') : cap, l2 = words.length > 2 ? words.slice(half).join(' ') : ''
      shapes.push(text(cx, l2 ? 0.45 : 0.3, l1, { size: 7.5 }))
      if (l2) shapes.push(text(cx, 0.15, l2, { size: 7.5 }))
    }
  })
  return { w: Math.max(S, list.length * (S + gap) - gap + 0.4), h: S + (d.captions ? 0.85 : 0.2), shapes }
}

// ------------------------------------------------------- free-body diagram

export function forcesDrawing(d: ForcesData): Drawing {
  const C = hex(d.color)
  const shapes: Shape[] = []
  const cx = 4, cy = 3
  const tilt = d.object === 'slope' ? Math.max(0, Math.min(60, d.angle)) : 0
  const tr = tilt * Math.PI / 180
  if (d.object === 'slope') {
    const base = 7, h = Math.tan(tr) * base
    const ox = cx - Math.cos(tr) * 3.2 - 0.1, oy = cy - Math.sin(tr) * 3.2 - 0.5
    shapes.push({ t: 'poly', pts: [[ox, oy], [ox + base, oy], [ox + base, oy + h]], fill: 'EEEEEE', stroke: GREY, lw: 0.8 })
    shapes.push(text(ox + 1.1, oy + 0.18, `${fmtNum(tilt)}°`, { size: 8.5 }))
  } else if (d.object === 'box') {
    shapes.push({ t: 'line', pts: [[cx - 2.5, cy - 0.5], [cx + 2.5, cy - 0.5]], stroke: GREY, lw: 1 })
  }
  // The object, turned with the slope.
  const corner = (u: number, v: number): [number, number] => [cx + u * Math.cos(tr) - v * Math.sin(tr), cy + u * Math.sin(tr) + v * Math.cos(tr)]
  if (d.object === 'ball') shapes.push({ t: 'circle', x: cx, y: cy, r: 0.5, fill: 'DDE7F3', stroke: INK, lw: 0.8 })
  else shapes.push({ t: 'poly', pts: [corner(-0.6, -0.5), corner(0.6, -0.5), corner(0.6, 0.5), corner(-0.6, 0.5)], fill: 'DDE7F3', stroke: INK, lw: 0.8 })
  shapes.push({ t: 'circle', x: cx, y: cy, r: 0.05, fill: INK })
  for (const l of lines(d.forces)) {
    const m = /^(.*?):\s*(-?[\d.]+)\s*[,;]\s*([\d.]+)\s*$/.exec(l)
    if (!m) continue
    const a = num(m[2]) * Math.PI / 180, len = Math.max(0.3, Math.min(3, num(m[3])))
    const tip: [number, number] = [cx + len * Math.cos(a), cy + len * Math.sin(a)]
    shapes.push(...arrow([cx, cy], tip, C, 1.4, 0.22))
    const lx = tip[0] + 0.25 * Math.cos(a), ly = tip[1] + 0.25 * Math.sin(a)
    shapes.push(text(lx, ly, m[1].trim(), { anchor: Math.cos(a) > 0.3 ? 'west' : Math.cos(a) < -0.3 ? 'east' : Math.sin(a) > 0 ? 'south' : 'north', bold: true, color: C, size: 9.5 }))
  }
  return { w: 8, h: 6, shapes }
}

// ----------------------------------------------------------- ray optics

export function opticsDrawing(d: OpticsData): Drawing {
  const C = hex(d.color)
  const f = Math.max(0.5, Math.abs(d.focal)) * (d.lens === 'diverging' ? -1 : 1)
  const u = Math.max(0.5, d.object), h = Math.max(0.3, d.height)
  // Thin lens: 1/v = 1/f - 1/u (real-is-positive), magnification -v/u.
  const v = 1 / (1 / f - 1 / u)
  const mag = -v / u
  const span = Math.max(u, Math.abs(v), Math.abs(f) * 1.5, 3) + 1
  const W = 2 * span, H = Math.max(4.5, Math.abs(mag * h) * 2 + 2, h * 2 + 2)
  const x0 = span, y0 = H / 2
  const X = (x: number) => x0 + x, Y = (y: number) => y0 + y
  const shapes: Shape[] = []
  shapes.push({ t: 'line', pts: [[0.1, y0], [W - 0.1, y0]], stroke: GREY, lw: 0.6 })
  // The lens.
  shapes.push(...arrow([X(0), Y(-H / 2 + 0.4)], [X(0), Y(H / 2 - 0.4)], INK, 1.2, d.lens === 'converging' ? 0.25 : 0.001))
  shapes.push(...arrow([X(0), Y(H / 2 - 0.4)], [X(0), Y(-H / 2 + 0.4)], INK, 1.2, d.lens === 'converging' ? 0.25 : 0.001))
  if (d.lens === 'diverging') for (const s of [1, -1]) shapes.push({ t: 'line', pts: [[X(-0.2), Y(s * (H / 2 - 0.65))], [X(0), Y(s * (H / 2 - 0.4))], [X(0.2), Y(s * (H / 2 - 0.65))]], stroke: INK, lw: 1.2 })
  for (const s of [1, -1]) {
    shapes.push({ t: 'circle', x: X(s * Math.abs(f)), y: y0, r: 0.06, fill: INK })
    shapes.push(text(X(s * Math.abs(f)), y0 - 0.15, 'F', { anchor: 'north', size: 8.5 }))
  }
  // Object and image arrows.
  shapes.push(...arrow([X(-u), y0], [X(-u), Y(h)], '000000', 1.6))
  shapes.push(text(X(-u), Y(h) + 0.12, 'object', { anchor: 'south', size: 8 }))
  const ih = mag * h, ix = X(v)
  const virtual = v < 0
  if (Number.isFinite(v) && Math.abs(v) < 60) {
    shapes.push({ t: 'line', pts: [[ix, y0], [ix, Y(ih)]], stroke: '7B1FA2', lw: 1.6, dash: virtual })
    shapes.push({ t: 'poly', pts: [[ix, Y(ih)], [ix - 0.1, Y(ih - Math.sign(ih) * 0.2)], [ix + 0.1, Y(ih - Math.sign(ih) * 0.2)]], fill: '7B1FA2' })
    shapes.push(text(ix, Y(ih) + (ih > 0 ? 0.12 : -0.12), virtual ? 'virtual image' : 'image', { anchor: ih > 0 ? 'south' : 'north', size: 8, color: '7B1FA2' }))
  }
  // Rays: parallel then through the focus; through the centre.
  const top: [number, number] = [X(-u), Y(h)]
  const far = (from: [number, number], to: [number, number]) => {
    const dx = to[0] - from[0], dy = to[1] - from[1], k = (W - 0.1 - from[0]) / (dx || 1e-9)
    return [from[0] + dx * k, from[1] + dy * k] as [number, number]
  }
  const atLens: [number, number] = [X(0), Y(h)]
  shapes.push({ t: 'line', pts: [top, atLens], stroke: C, lw: 1 })
  if (f > 0) shapes.push({ t: 'line', pts: [atLens, far(atLens, [X(f), y0])], stroke: C, lw: 1 })
  else {
    const away = far(atLens, [atLens[0] + (atLens[0] - X(f)), atLens[1] + (atLens[1] - y0)])
    shapes.push({ t: 'line', pts: [atLens, away], stroke: C, lw: 1 }, { t: 'line', pts: [[X(f), y0], atLens], stroke: C, lw: 0.7, dash: true })
  }
  shapes.push({ t: 'line', pts: [top, far(top, [X(0), y0])], stroke: C, lw: 1 })
  if (virtual && Number.isFinite(v)) shapes.push({ t: 'line', pts: [[ix, Y(ih)], top], stroke: C, lw: 0.7, dash: true })
  shapes.push(text(0.2, 0.2, `f = ${fmtNum(f)}, u = ${fmtNum(u)}, v = ${Number.isFinite(v) ? fmtNum(Math.round(v * 100) / 100) : '∞'}, m = ${Number.isFinite(mag) ? fmtNum(Math.round(mag * 100) / 100) : '∞'}`, { anchor: 'west', size: 8, color: '666666' }))
  return { w: W, h: H, shapes }
}

// ------------------------------------------------------------------ wave

export function waveDrawing(d: WaveData): Drawing {
  const C = hex(d.color)
  const lam = Math.max(0.5, d.wavelength), A = Math.max(0.2, d.amplitude), n = Math.max(0.5, Math.min(8, d.cycles))
  const L = lam * n, sx = Math.min(1, 11 / L), sy = Math.min(1, 1.6 / A)
  const W = L * sx + 1.6, H = 2 * A * sy + 1.8
  const x0 = 0.8, y0 = H / 2
  const shapes: Shape[] = []
  shapes.push({ t: 'line', pts: [[x0 - 0.3, y0], [x0 + L * sx + 0.3, y0]], stroke: GREY, lw: 0.6 })
  const curve = (phase: number, col: string, lw: number) => shapes.push({ t: 'line', pts: Array.from({ length: 241 }, (_, i) => {
    const x = (i / 240) * L
    return [x0 + x * sx, y0 + A * sy * Math.sin(2 * Math.PI * x / lam + phase)] as [number, number]
  }), stroke: col, lw })
  if (d.second) curve(Math.PI / 2, 'E65100', 1)
  curve(0, C, 1.4)
  if (d.labels) {
    // λ between two crests, A from the axis to a crest.
    const c1 = x0 + lam / 4 * sx, c2 = c1 + lam * sx, top = y0 + A * sy
    shapes.push(...arrow([c1 + 0.05, top + 0.35], [c2 - 0.05, top + 0.35], INK, 0.7, 0.14), ...arrow([c2 - 0.05, top + 0.35], [c1 + 0.05, top + 0.35], INK, 0.7, 0.14))
    shapes.push({ t: 'line', pts: [[c1, top], [c1, top + 0.45]], stroke: GREY, lw: 0.4 }, { t: 'line', pts: [[c2, top], [c2, top + 0.45]], stroke: GREY, lw: 0.4 })
    shapes.push(text((c1 + c2) / 2, top + 0.5, `λ = ${fmtNum(lam)}`, { anchor: 'south', tex: `$\\lambda = ${fmtNum(lam)}$` }))
    shapes.push(...arrow([c1, y0], [c1, top - 0.03], INK, 0.7, 0.12))
    shapes.push(text(c1 - 0.1, y0 + A * sy / 2, `A = ${fmtNum(A)}`, { anchor: 'east', tex: `$A = ${fmtNum(A)}$` }))
  }
  return { w: W, h: H, shapes }
}

// ---------------------------------------------------------- energy levels

export function levelsDrawing(d: LevelsData): Drawing {
  const C = hex(d.color)
  const lv = lines(d.levels).map(l => { const m = /^(.*?):\s*(-?[\d.]+)\s*$/.exec(l); return m ? { name: m[1].trim(), e: num(m[2]) } : null }).filter(Boolean) as { name: string; e: number }[]
  if (!lv.length) return { w: 2, h: 1, shapes: [] }
  const emin = Math.min(...lv.map(l => l.e)), emax = Math.max(...lv.map(l => l.e))
  const H = 6, y0 = 0.4
  const Y = (e: number) => y0 + (e - emin) / ((emax - emin) || 1) * (H - 0.8)
  const x0 = 1.6, x1 = 7.6
  const shapes: Shape[] = []
  // Labels spread apart where levels crowd (the top of the hydrogen series).
  const sorted = [...lv].sort((p, q) => p.e - q.e)
  const ly = new Map<typeof lv[number], number>()
  let last = -Infinity
  for (const l of sorted) { const y = Math.max(Y(l.e), last + 0.34); ly.set(l, y); last = y }
  const over = last - (H - 0.2)
  if (over > 0) for (const l of sorted) ly.set(l, ly.get(l)! - over * (ly.get(l)! - y0) / (last - y0 || 1))
  for (const l of lv) {
    const y = ly.get(l)!
    shapes.push({ t: 'line', pts: [[x0, Y(l.e)], [x1, Y(l.e)]], stroke: INK, lw: 1 })
    if (Math.abs(y - Y(l.e)) > 0.02) shapes.push({ t: 'line', pts: [[x0 - 0.08, Y(l.e)], [x0 - 0.25, y]], stroke: GREY, lw: 0.4 }, { t: 'line', pts: [[x1 + 0.08, Y(l.e)], [x1 + 0.25, y]], stroke: GREY, lw: 0.4 })
    shapes.push(text(x0 - 0.3, y, l.name, { anchor: 'east', size: 9 }))
    shapes.push(text(x1 + 0.3, y, `${fmtNum(l.e)} eV`, { anchor: 'west', size: 8.5, color: '666666' }))
  }
  const find = (k: string) => lv.find(l => l.name.replace(/\s/g, '').toLowerCase() === `n=${k}`.toLowerCase() || l.name === k)
  lines(d.transitions).forEach((t, i) => {
    const m = /^([^\s:→]+)\s*(?:→|->|to)\s*([^\s:]+)\s*:?\s*(.*)$/.exec(t)
    if (!m) return
    const a = find(m[1]), b = find(m[2])
    if (!a || !b) return
    const x = x0 + 0.8 + i * 1.3
    shapes.push(...arrow([x, Y(a.e)], [x, Y(b.e)], C, 1.2, 0.18))
    if (m[3]) shapes.push(text(x + 0.12, (Y(a.e) + Y(b.e)) / 2, m[3], { anchor: 'west', size: 8, color: C }))
  })
  return { w: x1 + 1.8, h: H, shapes }
}

// ------------------------------------------------------- function plots

// A small, safe expression evaluator: numbers, x, + - * / ^, brackets,
// pi, e, and sin cos tan asin acos atan sinh cosh tanh exp ln log sqrt abs.
export function compileExpr(src: string): ((x: number) => number) | null {
  const s = src.replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/π/g, 'pi')
  let i = 0
  const FN: Record<string, (v: number) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh,
    tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
  }
  type N = (x: number) => number
  const peek = () => s[i]
  function expr(): N { let l = term(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); const a = l; l = op === '+' ? x => a(x) + r(x) : x => a(x) - r(x) } return l }
  // -x^2 is -(x^2), as in maths: the sign binds looser than the power.
  function term(): N {
    let l = unary()
    for (;;) {
      if (peek() === '*' || peek() === '/') { const op = s[i++]; const r = unary(); const a = l; l = op === '*' ? x => a(x) * r(x) : x => a(x) / r(x) }
      else if (peek() && /[a-z(\d.]/i.test(peek())) { const r = power(); const a = l; l = x => a(x) * r(x) }  // 2x, 3sin(x)
      else return l
    }
  }
  function unary(): N { if (peek() === '-') { i++; const u = unary(); return x => -u(x) } if (peek() === '+') { i++; return unary() } return power() }
  function power(): N { const b = atom(); if (peek() === '^') { i++; const e = unary(); return x => Math.pow(b(x), e(x)) } return b }
  function atom(): N {
    const c = peek()
    if (c === '(') { i++; const e = expr(); if (s[i++] !== ')') throw new Error(')'); return e }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i))
    if (m) { i += m[0].length; const v = Number(m[0]); return () => v }
    const w = /^[a-z]+/i.exec(s.slice(i))
    if (!w) throw new Error('?')
    const name = w[0].toLowerCase()
    i += w[0].length
    if (name === 'x') return x => x
    if (name === 'pi') return () => Math.PI
    if (name === 'e') return () => Math.E
    const f = FN[name]
    if (!f) throw new Error(name)
    const arg = atom()
    return x => f(arg(x))
  }
  try {
    const f = expr()
    if (i !== s.length) return null
    return f
  } catch { return null }
}

// "sin(x)" as LaTeX for the legend.
export function exprTex(s: string): string {
  return s.replace(/\*\*/g, '^').replace(/\*/g, '\\,').replace(/\b(sin|cos|tan|exp|ln|log|sqrt|abs|sinh|cosh|tanh)\b/g, '\\$1').replace(/\\sqrt\(([^()]*)\)/g, '\\sqrt{$1}').replace(/\\abs\(([^()]*)\)/g, '|$1|').replace(/pi/g, '\\pi').replace(/\^(\d+|\([^()]*\))/g, (_m, e: string) => `^{${e.replace(/^\(|\)$/g, '')}}`)
}

const PAL = ['1F6FB5', 'E65100', '2E7D32', '6A1B9A', 'C62828']

export function functionDrawing(d: FunctionData): Drawing {
  const W = 10, H = 7
  const fs = lines(d.functions).map(t => ({ t, f: compileExpr(t) }))
  const a = Math.min(d.xmin, d.xmax - 0.1), b = Math.max(d.xmax, a + 0.1)
  const samples = fs.map(({ f }) => f ? Array.from({ length: 401 }, (_, i) => { const x = a + (b - a) * i / 400; return [x, f(x)] as [number, number] }) : [])
  const ys = samples.flat().map(p => p[1]).filter(Number.isFinite)
  let lo = d.ymin.trim() !== '' ? num(d.ymin) : Math.min(...ys, 0), hi = d.ymax.trim() !== '' ? num(d.ymax) : Math.max(...ys, 0)
  if (!(hi > lo)) { lo -= 1; hi += 1 }
  const clampSpan = (hi - lo) > 50 ? 50 : hi - lo
  if (d.ymin.trim() === '' && d.ymax.trim() === '' && clampSpan < hi - lo) { lo = Math.max(lo, -25); hi = Math.min(hi, 25) }
  const px = 0.6, py = 0.5, pw = W - 2 * px, ph = H - 2 * py - 0.4
  const X = (x: number) => px + (x - a) / (b - a) * pw, Y = (y: number) => py + 0.4 + (y - lo) / (hi - lo) * ph
  const shapes: Shape[] = []
  const xs = niceMax(Math.max(Math.abs(a), Math.abs(b)), 5).step, ysS = niceMax(Math.max(Math.abs(lo), Math.abs(hi)), 4).step
  if (d.grid) {
    for (let x = Math.ceil(a / xs) * xs; x <= b + 1e-9; x += xs) shapes.push({ t: 'line', pts: [[X(x), Y(lo)], [X(x), Y(hi)]], stroke: LIGHT, lw: 0.5 })
    for (let y = Math.ceil(lo / ysS) * ysS; y <= hi + 1e-9; y += ysS) shapes.push({ t: 'line', pts: [[X(a), Y(y)], [X(b), Y(y)]], stroke: LIGHT, lw: 0.5 })
  }
  const ax = Math.min(Math.max(0, lo), hi), ay = Math.min(Math.max(0, a), b)
  shapes.push(...arrow([X(a), Y(ax)], [X(b) + 0.25, Y(ax)], INK, 0.8, 0.15), ...arrow([X(ay), Y(lo)], [X(ay), Y(hi) + 0.25], INK, 0.8, 0.15))
  shapes.push(text(X(b) + 0.3, Y(ax), 'x', { anchor: 'west', tex: '$x$' }), text(X(ay), Y(hi) + 0.3, 'y', { anchor: 'south', tex: '$y$' }))
  for (let x = Math.ceil(a / xs) * xs; x <= b + 1e-9; x += xs) if (Math.abs(x) > 1e-9) {
    shapes.push({ t: 'line', pts: [[X(x), Y(ax) - 0.07], [X(x), Y(ax) + 0.07]], stroke: INK, lw: 0.6 })
    shapes.push(text(X(x), Y(ax) - 0.12, fmtNum(Math.round(x * 1000) / 1000), { anchor: 'north', size: 7.5 }))
  }
  for (let y = Math.ceil(lo / ysS) * ysS; y <= hi + 1e-9; y += ysS) if (Math.abs(y) > 1e-9) {
    shapes.push({ t: 'line', pts: [[X(ay) - 0.07, Y(y)], [X(ay) + 0.07, Y(y)]], stroke: INK, lw: 0.6 })
    shapes.push(text(X(ay) - 0.12, Y(y), fmtNum(Math.round(y * 1000) / 1000), { anchor: 'east', size: 7.5 }))
  }
  const base = hex(d.color), pal = [base, ...PAL.filter(c => c !== base)]
  samples.forEach((pts, j) => {
    // Split where the curve leaves the window or jumps (tan x).
    let run: [number, number][] = []
    const flush = () => { if (run.length > 1) shapes.push({ t: 'line', pts: run, stroke: pal[j % pal.length], lw: 1.4 }); run = [] }
    for (const [x, y] of pts) {
      if (!Number.isFinite(y) || y < lo || y > hi) { flush(); continue }
      run.push([X(x), Y(y)])
    }
    flush()
    const t = fs[j].t
    shapes.push({ t: 'line', pts: [[px + 0.1, 0.25 + 0.0], [px + 0.6, 0.25]], stroke: pal[j % pal.length], lw: 1.6 })
    shapes[shapes.length - 1] = { t: 'line', pts: [[px + 0.1 + j * 3, 0.2], [px + 0.6 + j * 3, 0.2]], stroke: pal[j % pal.length], lw: 1.6 }
    shapes.push(text(px + 0.7 + j * 3, 0.2, fs[j].f ? `y = ${t}` : `${t} (not understood)`, { anchor: 'west', size: 8.5, tex: fs[j].f ? `$y = ${exprTex(t)}$` : undefined }))
  })
  return { w: W, h: H, shapes }
}

// ------------------------------------------------------------ number line

export function numberLineDrawing(d: NumberLineData): Drawing {
  const C = hex(d.color)
  const a = Math.min(d.from, d.to - 1), b = Math.max(d.to, a + 1), step = d.step > 0 ? d.step : 1
  const W = 12, x0 = 0.5, pw = W - 1
  const X = (x: number) => x0 + (x - a) / (b - a) * pw
  const y = 0.9
  const shapes: Shape[] = []
  // Intervals first, as thick coloured bars above the line.
  for (const l of lines(d.intervals)) {
    const m = /^(-?[\d.]+|-∞|-inf)\s*(?:to|–|-|,)\s*(-?[\d.]+|∞|inf)$/.exec(l.replace(/\s+/g, ' ').trim())
    if (!m) continue
    const p = m[1].includes('∞') || m[1].includes('inf') ? a : num(m[1]), q = m[2].includes('∞') || m[2].includes('inf') ? b : num(m[2])
    shapes.push({ t: 'line', pts: [[X(p), y], [X(q), y]], stroke: C, lw: 4 })
  }
  shapes.push(...arrow([x0 - 0.3, y], [x0 + pw + 0.3, y], INK, 0.9, 0.18), ...arrow([x0 + pw + 0.3, y], [x0 - 0.3, y], INK, 0.9, 0.18))
  const count = Math.round((b - a) / step)
  for (let k = 0; k <= count && k <= 60; k++) {
    const v = a + k * step
    shapes.push({ t: 'line', pts: [[X(v), y - 0.12], [X(v), y + 0.12]], stroke: INK, lw: 0.7 })
    shapes.push(text(X(v), y - 0.2, fmtNum(Math.round(v * 1000) / 1000), { anchor: 'north', size: 8.5 }))
  }
  for (const l of lines(d.points)) {
    const m = /^(-?[\d.]+)\s*:?\s*(open|closed)?\s*(.*)$/i.exec(l)
    if (!m) continue
    const v = num(m[1]), open = (m[2] ?? 'closed').toLowerCase() === 'open'
    shapes.push({ t: 'circle', x: X(v), y, r: 0.12, fill: open ? 'FFFFFF' : C, stroke: C, lw: 1.4 })
    if (m[3]) shapes.push(text(X(v), y + 0.22, m[3], { anchor: 'south', size: 8.5, color: C }))
  }
  return { w: W, h: 1.6, shapes }
}

// ------------------------------------------------------------ Venn diagram

export function vennDrawing(d: VennData): Drawing {
  const C = hex(d.color)
  const names = d.sets.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3)
  const n = Math.max(2, names.length)
  const regions = new Map(lines(d.regions).map(l => { const m = /^([A-C]+)\s*:\s*(.*)$/i.exec(l); return m ? [m[1].toUpperCase().split('').sort().join(''), m[2]] as [string, string] : ['', ''] as [string, string] }))
  const r = 1.8
  const centres: [number, number][] = n === 2 ? [[2.6, 2.3], [4.6, 2.3]] : [[2.7, 3.2], [4.5, 3.2], [3.6, 1.65]]
  const cols = [C, 'E65100', '2E7D32']
  const shapes: Shape[] = []
  shapes.push({ t: 'rect', x: 0.1, y: 0.1, w: 7.1, h: n === 2 ? 4.4 : 5.6, stroke: GREY, lw: 0.6 })
  centres.slice(0, n).forEach(([x, y], i) => {
    shapes.push({ t: 'circle', x, y, r, stroke: cols[i], lw: 1.5 })
    const lx = n === 2 ? (i === 0 ? x - r * 0.75 : x + r * 0.75) : i === 2 ? x : i === 0 ? x - r * 0.8 : x + r * 0.8
    const ly = n === 2 ? y + r + 0.15 : i === 2 ? y - r - 0.15 : y + r * 0.95
    shapes.push(text(lx, ly, names[i] ?? String.fromCharCode(65 + i), { anchor: n === 3 && i === 2 ? 'north' : 'south', bold: true, color: cols[i], size: 10 }))
  })
  const put = (key: string, x: number, y: number) => { const v = regions.get(key); if (v) shapes.push(text(x, y, v, { size: 10 })) }
  if (n === 2) { put('A', 1.7, 2.3); put('B', 5.5, 2.3); put('AB', 3.6, 2.3) }
  else { put('A', 2.0, 3.7); put('B', 5.2, 3.7); put('C', 3.6, 0.9); put('AB', 3.6, 3.75); put('AC', 2.85, 2.35); put('BC', 4.35, 2.35); put('ABC', 3.6, 2.75) }
  const outside = regions.get('O') ?? regions.get('')
  if (outside) shapes.push(text(6.9, 0.35, outside, { anchor: 'east', size: 9 }))
  return { w: 7.3, h: n === 2 ? 4.6 : 5.8, shapes }
}

// --------------------------------------------------------------- triangle

export function triangleDrawing(d: TriangleData): Drawing {
  const C = hex(d.color)
  const a = Math.max(0.1, d.a), b = Math.max(0.1, d.b), c = Math.max(0.1, d.c)
  const ok = a + b > c && a + c > b && b + c > a
  const shapes: Shape[] = []
  if (!ok) return { w: 6, h: 1, shapes: [text(3, 0.5, 'These three sides cannot make a triangle.', { color: 'C62828' })] }
  // A at the origin, B along x (side c), C from the law of cosines.
  const A = Math.acos((b * b + c * c - a * a) / (2 * b * c))
  const pts: [number, number][] = [[0, 0], [c, 0], [b * Math.cos(A), b * Math.sin(A)]]
  const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0])), maxY = Math.max(...pts.map(p => p[1]))
  const s = 5.5 / Math.max(maxX - minX, maxY, 1)
  const P = pts.map(([x, y]) => [0.9 + (x - minX) * s, 0.8 + y * s] as [number, number])
  shapes.push({ t: 'poly', pts: P, fill: 'EEF3FA', stroke: C, lw: 1.4 })
  const names = d.labels.split(',').map(t => t.trim())
  const ang = [A, Math.acos((a * a + c * c - b * b) / (2 * a * c)), 0]
  ang[2] = Math.PI - ang[0] - ang[1]
  const cen: [number, number] = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3]
  P.forEach((p, i) => {
    const dx = p[0] - cen[0], dy = p[1] - cen[1], L = Math.hypot(dx, dy)
    shapes.push(text(p[0] + dx / L * 0.35, p[1] + dy / L * 0.35, names[i] ?? '', { bold: true, size: 10.5, color: C }))
    if (d.angles) {
      const deg = ang[i] * 180 / Math.PI
      if (Math.abs(deg - 90) < 0.05) {
        const q1 = P[(i + 1) % 3], q2 = P[(i + 2) % 3]
        const u1 = [(q1[0] - p[0]), (q1[1] - p[1])], u2 = [(q2[0] - p[0]), (q2[1] - p[1])]
        const l1 = Math.hypot(u1[0], u1[1]), l2 = Math.hypot(u2[0], u2[1]), k = 0.3
        shapes.push({ t: 'line', pts: [[p[0] + u1[0] / l1 * k, p[1] + u1[1] / l1 * k], [p[0] + u1[0] / l1 * k + u2[0] / l2 * k, p[1] + u1[1] / l1 * k + u2[1] / l2 * k], [p[0] + u2[0] / l2 * k, p[1] + u2[1] / l2 * k]], stroke: INK, lw: 0.7 })
      } else {
        shapes.push(text(p[0] - dx / L * 0.75, p[1] - dy / L * 0.75, `${fmtNum(Math.round(deg * 10) / 10)}°`, { size: 8 }))
      }
    }
  })
  // Side lengths at the middle of each side, outside.
  const side = (i: number, j: number, len: number) => {
    const mx = (P[i][0] + P[j][0]) / 2, my = (P[i][1] + P[j][1]) / 2, dx = mx - cen[0], dy = my - cen[1], L = Math.hypot(dx, dy)
    shapes.push(text(mx + dx / L * 0.3, my + dy / L * 0.3, fmtNum(len), { size: 9 }))
  }
  side(1, 2, a); side(0, 2, b); side(0, 1, c)
  return { w: 7.3, h: 0.8 + maxY * s + 0.9, shapes }
}

// -------------------------------------------------------------- statistics

export function statsSummary(xs: number[]) {
  const s = [...xs].sort((p, q) => p - q), n = s.length
  const q = (p: number) => { const i = (n - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo) }
  const mean = s.reduce((a, b) => a + b, 0) / (n || 1)
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1))
  return { n, min: s[0], max: s[n - 1], q1: q(0.25), median: q(0.5), q3: q(0.75), mean, sd }
}

export function statsDrawing(d: StatsData): Drawing {
  const C = hex(d.color)
  const xs = d.data.split(/[\s,;]+/).map(num).filter(Number.isFinite)
  const shapes: Shape[] = []
  if (xs.length < 2) return { w: 6, h: 1, shapes: [text(3, 0.5, 'Type at least two numbers.', { color: 'C62828' })] }
  const st = statsSummary(xs)
  const W = 10, x0 = 1, pw = W - 1.5
  const lo = st.min - (st.max - st.min) * 0.05, hi = st.max + (st.max - st.min) * 0.05 || st.min + 1
  const X = (v: number) => x0 + (v - lo) / (hi - lo) * pw
  const summary = `n = ${st.n}   mean = ${fmtNum(Math.round(st.mean * 100) / 100)}   median = ${fmtNum(Math.round(st.median * 100) / 100)}   s = ${fmtNum(Math.round(st.sd * 100) / 100)}`
  if (d.kind === 'boxplot') {
    const y = 1.6, h = 0.8
    shapes.push({ t: 'line', pts: [[X(st.min), y], [X(st.q1), y]], stroke: INK, lw: 0.9 }, { t: 'line', pts: [[X(st.q3), y], [X(st.max), y]], stroke: INK, lw: 0.9 })
    for (const v of [st.min, st.max]) shapes.push({ t: 'line', pts: [[X(v), y - h / 3], [X(v), y + h / 3]], stroke: INK, lw: 0.9 })
    shapes.push({ t: 'rect', x: X(st.q1), y: y - h / 2, w: X(st.q3) - X(st.q1), h, fill: 'DDE7F3', stroke: C, lw: 1.2 })
    shapes.push({ t: 'line', pts: [[X(st.median), y - h / 2], [X(st.median), y + h / 2]], stroke: C, lw: 2 })
    shapes.push({ t: 'circle', x: X(st.mean), y, r: 0.07, fill: 'E65100' })
    for (const v of [st.min, st.q1, st.median, st.q3, st.max]) shapes.push(text(X(v), y - h / 2 - 0.15, fmtNum(Math.round(v * 100) / 100), { anchor: 'north', size: 7.5 }))
    shapes.push(text(x0 + pw / 2, 0.25, d.xlabel, { size: 9 }), text(x0 + pw / 2, 2.55, summary, { size: 8, color: '666666' }))
    return { w: W, h: 2.8, shapes }
  }
  const k = Math.max(2, Math.min(30, Math.round(d.bins) || 7))
  const w = (st.max - st.min) / k || 1
  const counts = Array(k).fill(0)
  for (const v of xs) counts[Math.min(k - 1, Math.floor((v - st.min) / w))]++
  const cmax = niceMax(Math.max(...counts), 4)
  const y0 = 0.9, ph = 4.5
  const Xh = (v: number) => x0 + (v - st.min) / (st.max - st.min || 1) * pw
  for (let c = 0; c <= cmax.top + 1e-9; c += cmax.step) {
    shapes.push({ t: 'line', pts: [[x0, y0 + c / cmax.top * ph], [x0 + pw, y0 + c / cmax.top * ph]], stroke: LIGHT, lw: 0.5 })
    shapes.push(text(x0 - 0.12, y0 + c / cmax.top * ph, fmtNum(c), { anchor: 'east', size: 7.5 }))
  }
  counts.forEach((cnt, i) => shapes.push({ t: 'rect', x: Xh(st.min + i * w), y: y0, w: Xh(st.min + (i + 1) * w) - Xh(st.min + i * w), h: cnt / cmax.top * ph, fill: C, stroke: 'FFFFFF', lw: 0.8 }))
  for (let i = 0; i <= k; i++) shapes.push(text(Xh(st.min + i * w), y0 - 0.12, fmtNum(Math.round((st.min + i * w) * 10) / 10), { anchor: 'north', size: 7 }))
  shapes.push({ t: 'line', pts: [[Xh(st.mean), y0], [Xh(st.mean), y0 + ph + 0.1]], stroke: 'E65100', lw: 1.2, dash: true })
  shapes.push(text(Xh(st.mean), y0 + ph + 0.15, 'mean', { anchor: 'south', size: 7.5, color: 'E65100' }))
  shapes.push(text(x0 + pw / 2, 0.25, d.xlabel, { size: 9 }), text(x0 + pw / 2, y0 + ph + 0.65, summary, { size: 8, color: '666666' }))
  shapes.push(text(0.2, y0 + ph / 2, 'Count', { size: 8.5, rotate: 90 }))
  return { w: W, h: y0 + ph + 0.9, shapes }
}

// ------------------------------------------------------------ unit circle

export function unitCircleDrawing(d: UnitCircleData): Drawing {
  const C = hex(d.color)
  const R = 2.4, cx = 3.2, cy = 3.2
  const shapes: Shape[] = []
  shapes.push(...arrow([cx - R - 0.5, cy], [cx + R + 0.5, cy], INK, 0.8, 0.15), ...arrow([cx, cy - R - 0.5], [cx, cy + R + 0.5], INK, 0.8, 0.15))
  shapes.push({ t: 'circle', x: cx, y: cy, r: R, stroke: INK, lw: 1 })
  shapes.push(text(cx + R + 0.1, cy - 0.15, '1', { anchor: 'north west', size: 8.5 }), text(cx + 0.1, cy + R + 0.05, '1', { anchor: 'south west', size: 8.5 }))
  d.angles.split(/[,\s]+/).map(num).filter(Number.isFinite).slice(0, 8).forEach((deg, i) => {
    const a = deg * Math.PI / 180, px = cx + R * Math.cos(a), py = cy + R * Math.sin(a)
    const col = [C, 'E65100', '2E7D32', '6A1B9A', 'C62828'][i % 5]
    shapes.push({ t: 'line', pts: [[cx, cy], [px, py]], stroke: col, lw: 1.1 })
    if (d.projections) {
      shapes.push({ t: 'line', pts: [[px, py], [px, cy]], stroke: col, lw: 0.6, dash: true }, { t: 'line', pts: [[px, py], [cx, py]], stroke: col, lw: 0.6, dash: true })
    }
    shapes.push({ t: 'circle', x: px, y: py, r: 0.06, fill: col })
    const c = Math.cos(a), s = Math.sin(a)
    const f = (v: number) => fmtNum(Math.round(v * 1000) / 1000)
    shapes.push(text(px + 0.18 * Math.cos(a), py + 0.18 * Math.sin(a), `${fmtNum(deg)}° (${f(c)}, ${f(s)})`, { anchor: c >= 0 ? 'west' : 'east', size: 7.5, color: col }))
  })
  return { w: 6.4 + 1.6, h: 6.4, shapes: shapes.map(s => (s.t === 'line' || s.t === 'poly') ? { ...s, pts: s.pts.map(([x, y]) => [x + 0.8, y] as [number, number]) } : { ...s, x: s.x + 0.8 }) }
}
