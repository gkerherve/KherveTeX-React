// Math ▸ Geometry: any figure, from a ready-made shape (triangle, right
// triangle, square, rectangle, parallelogram, trapezium, regular polygon,
// circle) or written as a short script of points and what joins them.
// Every ready-made shape is turned into the same script, so "Edit as
// points" gives the user the whole figure to change. Pure: no DOM.
import { fmtNum, type Drawing, type Shape } from './draw.ts'

export type GeoShape = 'triangle' | 'right' | 'square' | 'rectangle' | 'parallelogram' | 'trapezium' | 'polygon' | 'circle' | 'custom'

export interface GeometryData {
  shape: GeoShape
  // Sizes; which ones a shape uses: GEO_PARAMS.
  a: number; b: number; c: number; angle: number; n: number
  names: string
  sides: boolean; angles: boolean; ticks: boolean; fill: boolean
  script: string
  color: string
}

export const GEO_SHAPES: [GeoShape, string][] = [
  ['triangle', 'Triangle (three sides)'], ['right', 'Right triangle'], ['square', 'Square'], ['rectangle', 'Rectangle'],
  ['parallelogram', 'Parallelogram'], ['trapezium', 'Trapezium'], ['polygon', 'Regular polygon'], ['circle', 'Circle'], ['custom', 'Free (points)'],
]

// [key, label] of the sizes each shape asks for.
export const GEO_PARAMS: Record<GeoShape, [keyof GeometryData, string][]> = {
  triangle: [['a', 'Side a (BC)'], ['b', 'Side b (CA)'], ['c', 'Side c (AB)']],
  right: [['a', 'Base'], ['b', 'Height']],
  square: [['a', 'Side']],
  rectangle: [['a', 'Width'], ['b', 'Height']],
  parallelogram: [['a', 'Base'], ['b', 'Slanted side'], ['angle', 'Angle (degrees)']],
  trapezium: [['a', 'Bottom side'], ['b', 'Top side'], ['c', 'Height']],
  polygon: [['n', 'Number of sides'], ['a', 'Side']],
  circle: [['a', 'Radius'], ['angle', 'Sector angle (degrees, 0 for none)']],
  custom: [],
}

export const GEOMETRY_DEFAULT: GeometryData = {
  shape: 'triangle', a: 5, b: 4, c: 3, angle: 60, n: 6, names: 'A, B, C, D, E, F, G, H',
  sides: true, angles: true, ticks: true, fill: true, color: '1F6FB5',
  script: '',
}

const f2 = (v: number) => fmtNum(Math.round(v * 100) / 100)
const deg = (r: number) => r * 180 / Math.PI

// The ready-made shape as a script.
export function presetScript(d: GeometryData): string {
  const nm = d.names.split(/[,\s]+/).filter(Boolean)
  const N = (i: number) => nm[i] ?? String.fromCharCode(65 + i)
  const pts: [number, number][] = []
  const extra: string[] = []
  const a = Math.max(0.1, d.a), b = Math.max(0.1, d.b), c = Math.max(0.1, d.c)
  switch (d.shape) {
    case 'triangle': {
      if (!(a + b > c && a + c > b && b + c > a)) return '# These three sides cannot make a triangle.'
      const A = Math.acos((b * b + c * c - a * a) / (2 * b * c))
      pts.push([0, 0], [c, 0], [b * Math.cos(A), b * Math.sin(A)])
      break
    }
    case 'right': pts.push([0, 0], [a, 0], [0, b]); break
    case 'square': pts.push([0, 0], [a, 0], [a, a], [0, a]); break
    case 'rectangle': pts.push([0, 0], [a, 0], [a, b], [0, b]); break
    case 'parallelogram': { const t = d.angle * Math.PI / 180; pts.push([0, 0], [a, 0], [a + b * Math.cos(t), b * Math.sin(t)], [b * Math.cos(t), b * Math.sin(t)]); break }
    case 'trapezium': pts.push([0, 0], [a, 0], [(a + b) / 2, c], [(a - b) / 2, c]); break
    case 'polygon': {
      const n = Math.max(3, Math.min(12, Math.round(d.n))), R = a / (2 * Math.sin(Math.PI / n))
      for (let i = 0; i < n; i++) { const t = -Math.PI / 2 - Math.PI / n + i * 2 * Math.PI / n; pts.push([R * Math.cos(t), R * Math.sin(t)]) }
      break
    }
    case 'circle': {
      const lines = [`O = (0, 0)`, `circle O ${f2(a)}${d.fill ? ' fill' : ''}`, `P = (${f2(a)}, 0)`, `segment O P`]
      if (d.sides) lines.push(`length O P r = ${f2(a)}`)
      if (d.angle > 0 && d.angle < 360) {
        const t = d.angle * Math.PI / 180
        lines.push(`Q = (${f2(a * Math.cos(t))}, ${f2(a * Math.sin(t))})`, 'segment O Q')
        if (d.angles) lines.push('angle P O Q')
      }
      lines.push('dot O', 'text O "O" below')
      return lines.join('\n')
    }
    default: return d.script
  }
  const names = pts.map((_, i) => N(i))
  const lines = pts.map(([x, y], i) => `${names[i]} = (${f2(x)}, ${f2(y)})`)
  lines.push(`polygon ${names.join(' ')}${d.fill ? ' fill' : ''}`)
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = names[i], q = names[(i + 1) % n]
    if (d.sides) lines.push(`length ${p} ${q}`)
  }
  // Equal sides: the same number of ticks on each.
  if (d.ticks) {
    const lens = pts.map((p, i) => Math.hypot(pts[(i + 1) % n][0] - p[0], pts[(i + 1) % n][1] - p[1]))
    const groups: number[] = []
    lens.forEach((L, i) => {
      if (lens.filter(M => Math.abs(M - L) < 1e-6).length < 2) return
      let g = groups.findIndex(G => Math.abs(lens[G] - L) < 1e-6)
      if (g < 0) { groups.push(i); g = groups.length - 1 }
      lines.push(`tick ${names[i]} ${names[(i + 1) % n]} ${g + 1}`)
    })
  }
  if (d.angles) for (let i = 0; i < n; i++) {
    const p = names[(i + n - 1) % n], q = names[i], r = names[(i + 1) % n]
    const u = [pts[(i + n - 1) % n][0] - pts[i][0], pts[(i + n - 1) % n][1] - pts[i][1]], v = [pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]]
    const ang = deg(Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]))))
    lines.push(`${Math.abs(ang - 90) < 0.05 ? 'right' : 'angle'} ${p} ${q} ${r}`)
  }
  return [...lines, ...extra].join('\n')
}

export const scriptOf = (d: GeometryData) => (d.shape === 'custom' ? d.script : presetScript(d))

// ------------------------------------------------------------- drawing

type Cmd =
  | { k: 'polygon' | 'polyline'; pts: string[]; fill: boolean; dashed: boolean }
  | { k: 'segment' | 'arrow'; p: string; q: string; dashed: boolean }
  | { k: 'circle'; o: string; r: number; fill: boolean; dashed: boolean }
  | { k: 'angle' | 'right'; p: string; q: string; r: string; label?: string }
  | { k: 'length'; p: string; q: string; label?: string }
  | { k: 'tick'; p: string; q: string; n: number }
  | { k: 'dot'; p: string }
  | { k: 'text'; p: string; s: string; where: string }

export const GEO_HELP = 'One instruction per line (# starts a comment):\n'
  + 'A = (0, 0)  a point · polygon A B C [fill] [dashed] · polyline A B C · segment A B [dashed] · arrow A B\n'
  + 'circle O 2 [fill] [dashed]  centre and radius · angle A B C [label]  the angle at B · right A B C  a right-angle mark at B\n'
  + 'length A B [label]  the length (or your label) beside AB · tick A B 2  equal-side marks · dot A · text A "words" [above|below|left|right]'

export function parseGeometry(script: string): { pts: Map<string, [number, number]>; cmds: Cmd[]; errors: string[] } {
  const pts = new Map<string, [number, number]>()
  const cmds: Cmd[] = []
  const errors: string[] = []
  script.split('\n').forEach((raw, li) => {
    const l = raw.replace(/#.*$/, '').trim()
    if (!l) return
    let m
    if ((m = /^([A-Za-z][\w']*)\s*=\s*\(\s*(-?[\d.]+)\s*[,;]\s*(-?[\d.]+)\s*\)$/.exec(l))) { pts.set(m[1], [Number(m[2]), Number(m[3])]); return }
    const words = l.match(/"[^"]*"|\S+/g) ?? []
    const [k, ...rest] = words
    const flags = new Set(rest.filter(w => ['fill', 'dashed', 'above', 'below', 'left', 'right'].includes(w)))
    const args = rest.filter(w => !flags.has(w))
    const known = (p: string) => { if (!pts.has(p)) errors.push(`Line ${li + 1}: no point ${p}.`); return pts.has(p) }
    switch (k?.toLowerCase()) {
      case 'polygon': case 'polyline': if (args.every(known) && args.length >= 2) cmds.push({ k: k.toLowerCase() as 'polygon', pts: args, fill: flags.has('fill'), dashed: flags.has('dashed') }); break
      case 'segment': case 'line': case 'arrow': if (args.length >= 2 && known(args[0]) && known(args[1])) cmds.push({ k: k.toLowerCase() === 'arrow' ? 'arrow' : 'segment', p: args[0], q: args[1], dashed: flags.has('dashed') }); break
      case 'circle': if (args.length >= 2 && known(args[0])) cmds.push({ k: 'circle', o: args[0], r: Number(args[1]) || 1, fill: flags.has('fill'), dashed: flags.has('dashed') }); break
      case 'angle': case 'right': if (args.length >= 3 && args.slice(0, 3).every(known)) cmds.push({ k: k.toLowerCase() as 'angle', p: args[0], q: args[1], r: args[2], label: args.slice(3).join(' ').replace(/"/g, '') || undefined }); break
      case 'length': if (args.length >= 2 && known(args[0]) && known(args[1])) cmds.push({ k: 'length', p: args[0], q: args[1], label: args.slice(2).join(' ').replace(/"/g, '') || undefined }); break
      case 'tick': if (args.length >= 2 && known(args[0]) && known(args[1])) cmds.push({ k: 'tick', p: args[0], q: args[1], n: Math.max(1, Math.min(3, Number(args[2]) || 1)) }); break
      case 'dot': for (const p of args) if (known(p)) cmds.push({ k: 'dot', p }); break
      case 'text': if (args.length >= 2 && known(args[0])) cmds.push({ k: 'text', p: args[0], s: args.slice(1).join(' ').replace(/^"|"$/g, ''), where: [...flags].find(w => ['above', 'below', 'left', 'right'].includes(w)) ?? 'above' }); break
      default: errors.push(`Line ${li + 1}: "${l}" is not understood.`)
    }
  })
  return { pts, cmds, errors }
}

const hex = (c: string) => (/^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '') : '1F6FB5').toUpperCase()

export function geometryDrawing(d: GeometryData): Drawing {
  const C = hex(d.color)
  const { pts, cmds, errors } = parseGeometry(scriptOf(d))
  const shapes: Shape[] = []
  if (!pts.size) return { w: 8, h: 1, shapes: [{ t: 'text', x: 4, y: 0.5, s: errors[0] ?? 'Nothing to draw yet: add points and shapes with Edit…', size: 9, color: 'C62828' }] }
  // Fit: the points and circles into about 7 × 5.5 cm.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (x: number, y: number, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r) }
  for (const [x, y] of pts.values()) grow(x, y)
  for (const c of cmds) if (c.k === 'circle') { const [x, y] = pts.get(c.o)!; grow(x, y, c.r) }
  const s = Math.min(7 / Math.max(x1 - x0, 1e-6), 5.5 / Math.max(y1 - y0, 1e-6), 3)
  const M = 0.9
  const P = (name: string): [number, number] => { const [x, y] = pts.get(name)!; return [M + (x - x0) * s, M + (y - y0) * s] }
  const cx = M + (x1 - x0) * s / 2, cy = M + (y1 - y0) * s / 2
  const ink = '333333'
  const fillC = 'EEF3FA'
  // Fills first, then lines, marks and labels.
  for (const c of cmds) {
    if (c.k === 'polygon' && c.fill) shapes.push({ t: 'poly', pts: c.pts.map(P), fill: fillC })
    if (c.k === 'circle' && c.fill) { const [x, y] = P(c.o); shapes.push({ t: 'circle', x, y, r: c.r * s, fill: fillC }) }
  }
  const dashLine = (a: [number, number], b: [number, number], dashed: boolean, lw = 1.3) => shapes.push({ t: 'line', pts: [a, b], stroke: C, lw, dash: dashed })
  for (const c of cmds) {
    switch (c.k) {
      case 'polygon': case 'polyline': {
        const ps = c.pts.map(P)
        shapes.push({ t: 'line', pts: c.k === 'polygon' ? [...ps, ps[0]] : ps, stroke: C, lw: 1.4, dash: c.dashed })
        break
      }
      case 'segment': dashLine(P(c.p), P(c.q), c.dashed); break
      case 'arrow': {
        const a = P(c.p), b = P(c.q), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, h = 0.2
        dashLine(a, [b[0] - ux * h, b[1] - uy * h], c.dashed)
        shapes.push({ t: 'poly', pts: [b, [b[0] - ux * h - uy * h * 0.5, b[1] - uy * h + ux * h * 0.5], [b[0] - ux * h + uy * h * 0.5, b[1] - uy * h - ux * h * 0.5]], fill: C })
        break
      }
      case 'circle': { const [x, y] = P(c.o); shapes.push({ t: 'circle', x, y, r: c.r * s, stroke: C, lw: 1.4 }); break }
      case 'angle': case 'right': {
        const q = P(c.q), p = P(c.p), r = P(c.r)
        const u = [p[0] - q[0], p[1] - q[1]], v = [r[0] - q[0], r[1] - q[1]]
        const lu = Math.hypot(u[0], u[1]) || 1, lv = Math.hypot(v[0], v[1]) || 1
        if (c.k === 'right') {
          const k = 0.3
          shapes.push({ t: 'line', pts: [[q[0] + u[0] / lu * k, q[1] + u[1] / lu * k], [q[0] + u[0] / lu * k + v[0] / lv * k, q[1] + u[1] / lu * k + v[1] / lv * k], [q[0] + v[0] / lv * k, q[1] + v[1] / lv * k]], stroke: ink, lw: 0.7 })
          break
        }
        let a0 = Math.atan2(u[1], u[0]), a1 = Math.atan2(v[1], v[0])
        let sweep = a1 - a0
        while (sweep <= -Math.PI) sweep += 2 * Math.PI
        while (sweep > Math.PI) sweep -= 2 * Math.PI
        const R = 0.45
        shapes.push({ t: 'arc', x: q[0], y: q[1], r: R, a0: deg(a0), a1: deg(a0 + sweep), stroke: ink, lw: 0.7 })
        const mid = a0 + sweep / 2
        const value = Math.abs(deg(sweep))
        shapes.push({ t: 'text', x: q[0] + (R + 0.32) * Math.cos(mid), y: q[1] + (R + 0.32) * Math.sin(mid), s: c.label ?? `${fmtNum(Math.round(value * 10) / 10)}°`, size: 8, color: ink,
          tex: c.label ? undefined : `$${fmtNum(Math.round(value * 10) / 10)}^\\circ$` })
        break
      }
      case 'length': {
        const a = P(c.p), b = P(c.q)
        const [ax, ay] = pts.get(c.p)!, [bx, by] = pts.get(c.q)!
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        // Outside the figure: away from its centre.
        let nx = -(b[1] - a[1]), ny = b[0] - a[0]
        const L = Math.hypot(nx, ny) || 1
        nx /= L; ny /= L
        if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny }
        shapes.push({ t: 'text', x: mx + nx * 0.3, y: my + ny * 0.3, s: c.label ?? f2(Math.hypot(bx - ax, by - ay)), size: 8.5, color: ink })
        break
      }
      case 'tick': {
        const a = P(c.p), b = P(c.q), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L
        for (let i = 0; i < c.n; i++) {
          const o = (i - (c.n - 1) / 2) * 0.1
          shapes.push({ t: 'line', pts: [[mx + ux * o - uy * 0.12, my + uy * o + ux * 0.12], [mx + ux * o + uy * 0.12, my + uy * o - ux * 0.12]], stroke: C, lw: 1 })
        }
        break
      }
      case 'dot': { const [x, y] = P(c.p); shapes.push({ t: 'circle', x, y, r: 0.05, fill: ink }); break }
      case 'text': {
        const [x, y] = P(c.p)
        const off = { above: [0, 0.22, 'south'], below: [0, -0.22, 'north'], left: [-0.22, 0, 'east'], right: [0.22, 0, 'west'] }[c.where] as [number, number, 'south']
        shapes.push({ t: 'text', x: x + off[0], y: y + off[1], s: c.s, anchor: off[2], size: 9.5, color: ink })
        break
      }
    }
  }
  // Each polygon's corners named, outside it.
  const named = new Set<string>()
  for (const c of cmds) if (c.k === 'polygon' || c.k === 'polyline') for (const p of c.pts) {
    if (named.has(p)) continue
    named.add(p)
    const [x, y] = P(p), dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1
    shapes.push({ t: 'text', x: x + dx / L * 0.32, y: y + dy / L * 0.32, s: p, size: 10.5, bold: true, color: C })
  }
  if (errors.length) shapes.push({ t: 'text', x: M, y: 0.25, s: errors[0], anchor: 'west', size: 7.5, color: 'C62828' })
  return { w: (x1 - x0) * s + 2 * M, h: (y1 - y0) * s + 2 * M, shapes }
}
