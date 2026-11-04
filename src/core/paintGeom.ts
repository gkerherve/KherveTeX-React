// The bits of Qt geometry the drawing engine relies on, reproduced so the
// numbers (and so the SVG the engine writes) match: QTransform's row-vector
// affine maps, and QPainterPath's element lists — moveTo / lineTo / cubicTo
// with Qt's duplicate-point rules, closeSubpath, and the cubic segments
// arcTo / addEllipse / addRoundedRect emit (qt_curves_for_arc).

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Cmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number]

// [m11, m12, m21, m22, dx, dy]: x' = m11·x + m21·y + dx, y' = m12·x + m22·y + dy.
export type Mat = [number, number, number, number, number, number]
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

export function matFromParts(m: number[]): Mat {
  return [m[0], m[1], m[2], m[3], m[4] ?? 0, m[5] ?? 0]
}

// a then b (QTransform a * b).
export function matMul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ]
}

export function mapPt(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

export function matInvert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det) return [...IDENTITY]
  const i = 1 / det
  return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i,
    (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i]
}

export const matIsIdentity = (m: Mat): boolean =>
  m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0

export const rectCenter = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
export const emptyRect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 })
export const isEmptyRect = (r: Rect): boolean => r.w <= 0 || r.h <= 0

// QRectF.united (a null rect is ignored).
export function rectUnion(a: Rect, b: Rect): Rect {
  if (a.w === 0 && a.h === 0) return { ...b }
  if (b.w === 0 && b.h === 0) return { ...a }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function normRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

// QTransform.mapRect: the bounding box of the mapped corners.
export function mapRect(m: Mat, r: Rect): Rect {
  const pts = [mapPt(m, { x: r.x, y: r.y }), mapPt(m, { x: r.x + r.w, y: r.y }),
    mapPt(m, { x: r.x + r.w, y: r.y + r.h }), mapPt(m, { x: r.x, y: r.y + r.h })]
  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export const rectContains = (r: Rect, p: Pt): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

// ------------------------------------------------------- QPainterPath
const fuzzyNull = (d: number) => Math.abs(d) <= 1e-12
const samePt = (a: Pt, b: Pt) => fuzzyNull(a.x - b.x) && fuzzyNull(a.y - b.y)

function lastPt(p: Cmd[]): Pt {
  const c = p[p.length - 1]
  return c[0] === 'C' ? { x: c[5], y: c[6] } : { x: c[1], y: c[2] }
}

// A path built with these helpers keeps Qt's "require a moveTo" flag on
// the array (set by closeSubpath / addEllipse / addRect...).
type QPath = Cmd[] & { _req?: boolean }

function begin(p: QPath): QPath {
  const out = [...p] as QPath
  if (!out.length) out.push(['M', 0, 0])
  if (p._req) {
    const l = lastPt(out)
    out.push(['M', l.x, l.y])
  }
  return out
}

export function moveTo(p: QPath, x: number, y: number): QPath {
  const out = [...p] as QPath
  if (out.length && out[out.length - 1][0] === 'M') out[out.length - 1] = ['M', x, y]
  else out.push(['M', x, y])
  return out
}

export function lineTo(p: QPath, x: number, y: number): QPath {
  const out = begin(p)
  if (samePt(lastPt(out), { x, y })) return out
  out.push(['L', x, y])
  return out
}

export function cubicTo(p: QPath, c1: Pt, c2: Pt, e: Pt): QPath {
  const out = begin(p)
  const cur = lastPt(out)
  if (samePt(cur, c1) && samePt(c1, c2) && samePt(c2, e)) return out
  out.push(['C', c1.x, c1.y, c2.x, c2.y, e.x, e.y])
  return out
}

export function quadTo(p: QPath, c: Pt, e: Pt): QPath {
  const out = begin(p)
  const prev = lastPt(out)
  if (samePt(prev, c) && samePt(c, e)) return out
  const c1 = { x: (prev.x + 2 * c.x) / 3, y: (prev.y + 2 * c.y) / 3 }
  const c2 = { x: (e.x + 2 * c.x) / 3, y: (e.y + 2 * c.y) / 3 }
  return cubicTo(out, c1, c2, e)
}

export function closeSubpath(p: QPath): QPath {
  if (p.length <= 1) return p
  const out = [...p] as QPath
  let start = 0
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i][0] === 'M') { start = i; break }
  }
  const first = { x: out[start][1], y: out[start][2] }
  const last = lastPt(out)
  if (first.x !== last.x || first.y !== last.y) {
    if (fuzzyCompare(first.x, last.x) && fuzzyCompare(first.y, last.y)) {
      const c = out[out.length - 1]
      if (c[0] === 'C') out[out.length - 1] = ['C', c[1], c[2], c[3], c[4], first.x, first.y]
      else out[out.length - 1] = [c[0], first.x, first.y] as Cmd
    } else {
      out.push(['L', first.x, first.y])
    }
  }
  out._req = true
  return out
}

function fuzzyCompare(a: number, b: number): boolean {
  return Math.abs(a - b) * 1000000000000 <= Math.min(Math.abs(a), Math.abs(b))
}

export const QT_PATH_KAPPA = 0.5522847498

function tForArcAngle(angle: number): number {
  if (fuzzyNull(angle)) return 0
  if (fuzzyCompare(angle, 90)) return 1
  const radians = angle * Math.PI / 180
  const cosAngle = Math.cos(radians)
  const sinAngle = Math.sin(radians)
  const K = QT_PATH_KAPPA
  let tc = angle / 90
  tc -= ((((2 - 3 * K) * tc + 3 * (K - 1)) * tc) * tc + 1 - cosAngle) / (((6 - 9 * K) * tc + 6 * (K - 1)) * tc)
  tc -= ((((2 - 3 * K) * tc + 3 * (K - 1)) * tc) * tc + 1 - cosAngle) / (((6 - 9 * K) * tc + 6 * (K - 1)) * tc)
  let ts = tc
  ts -= ((((3 * K - 2) * ts - 6 * K + 3) * ts + 3 * K) * ts - sinAngle) / (((9 * K - 6) * ts + 12 * K - 6) * ts + 3 * K)
  ts -= ((((3 * K - 2) * ts - 6 * K + 3) * ts + 3 * K) * ts - sinAngle) / (((9 * K - 6) * ts + 12 * K - 6) * ts + 3 * K)
  return 0.5 * (tc + ts)
}

function coefficients(t: number): [number, number, number, number] {
  const mt = 1 - t
  let b = mt * mt
  let c = t * t
  const d = c * t
  const a = b * mt
  b *= 3 * t
  c *= 3 * mt
  return [a, b, c, d]
}

function findEllipseCoords(r: Rect, angle: number): Pt {
  const w2 = r.w / 2
  const h2 = r.h / 2
  const theta = angle - 360 * Math.floor(angle / 360)
  let t = theta / 90
  const quadrant = Math.trunc(t)
  t -= quadrant
  t = tForArcAngle(90 * t)
  if (quadrant & 1) t = 1 - t
  const [a, b, c, d] = coefficients(t)
  let px = a + b + c * QT_PATH_KAPPA
  let py = d + c + b * QT_PATH_KAPPA
  if (quadrant === 1 || quadrant === 2) px = -px
  if (quadrant === 0 || quadrant === 1) py = -py
  return { x: r.x + r.w / 2 + w2 * px, y: r.y + r.h / 2 + h2 * py }
}

type Bez = [Pt, Pt, Pt, Pt]

function bezierOnInterval(b: Bez, t0: number, t1: number): Bez {
  // QBezier::bezierOnInterval via parameter splitting
  const split = (bz: Bez, t: number): [Bez, Bez] => {
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    const p01 = lerp(bz[0], bz[1])
    const p12 = lerp(bz[1], bz[2])
    const p23 = lerp(bz[2], bz[3])
    const p012 = lerp(p01, p12)
    const p123 = lerp(p12, p23)
    const p0123 = lerp(p012, p123)
    return [[bz[0], p01, p012, p0123], [p0123, p123, p23, bz[3]]]
  }
  if (t0 === 0 && t1 === 1) return b
  let r = b
  if (t0 !== 0) r = split(r, t0)[1]
  if (t1 !== 1) r = split(r, (t1 - t0) / (1 - t0))[0]
  return r
}

// qt_curves_for_arc: the start point and the cubic control points.
function curvesForArc(rect: Rect, startAngle: number, sweepLength: number): { start: Pt; curves: Pt[] } {
  const x = rect.x
  const y = rect.y
  const w = rect.w
  const w2 = rect.w / 2
  const w2k = w2 * QT_PATH_KAPPA
  const h = rect.h
  const h2 = rect.h / 2
  const h2k = h2 * QT_PATH_KAPPA
  const points: Pt[] = [
    { x: x + w, y: y + h2 },
    { x: x + w, y: y + h2 + h2k }, { x: x + w2 + w2k, y: y + h }, { x: x + w2, y: y + h },
    { x: x + w2 - w2k, y: y + h }, { x, y: y + h2 + h2k }, { x, y: y + h2 },
    { x, y: y + h2 - h2k }, { x: x + w2 - w2k, y }, { x: x + w2, y },
    { x: x + w2 + w2k, y }, { x: x + w, y: y + h2 - h2k }, { x: x + w, y: y + h2 },
  ]
  if (sweepLength > 360) sweepLength = 360
  else if (sweepLength < -360) sweepLength = -360
  if (startAngle === 0.0) {
    if (sweepLength === 360.0) {
      const curves: Pt[] = []
      for (let i = 11; i >= 0; --i) curves.push(points[i])
      return { start: points[12], curves }
    } else if (sweepLength === -360.0) {
      const curves: Pt[] = []
      for (let i = 1; i <= 12; ++i) curves.push(points[i])
      return { start: points[0], curves }
    }
  }
  let startSegment = Math.floor(startAngle / 90)
  let endSegment = Math.floor((startAngle + sweepLength) / 90)
  let startT = (startAngle - startSegment * 90) / 90
  let endT = (startAngle + sweepLength - endSegment * 90) / 90
  const delta = sweepLength > 0 ? 1 : -1
  if (delta < 0) {
    startT = 1 - startT
    endT = 1 - endT
  }
  if (fuzzyNull(startT - 1)) {
    startT = 0
    startSegment += delta
  }
  if (fuzzyNull(endT)) {
    endT = 1
    endSegment -= delta
  }
  startT = tForArcAngle(startT * 90)
  endT = tForArcAngle(endT * 90)
  const splitAtStart = !fuzzyNull(startT)
  const splitAtEnd = !fuzzyNull(endT - 1)
  const end = endSegment + delta
  if (startSegment === end) {
    const quadrant = 3 - (((startSegment % 4) + 4) % 4)
    const j = 3 * quadrant
    return { start: delta > 0 ? points[j + 3] : points[j], curves: [] }
  }
  const startPoint = findEllipseCoords(rect, startAngle)
  const endPoint = findEllipseCoords(rect, startAngle + sweepLength)
  const curves: Pt[] = []
  for (let i = startSegment; i !== end; i += delta) {
    const quadrant = 3 - (((i % 4) + 4) % 4)
    const j = 3 * quadrant
    let b: Bez = delta > 0 ? [points[j + 3], points[j + 2], points[j + 1], points[j]]
      : [points[j], points[j + 1], points[j + 2], points[j + 3]]
    if (startSegment === endSegment && fuzzyCompare(startT, endT)) return { start: startPoint, curves: [] }
    if (i === startSegment) {
      if (i === endSegment && splitAtEnd) b = bezierOnInterval(b, startT, endT)
      else if (splitAtStart) b = bezierOnInterval(b, startT, 1)
    } else if (i === endSegment && splitAtEnd) {
      b = bezierOnInterval(b, 0, endT)
    }
    curves.push(b[1], b[2], b[3])
  }
  curves[curves.length - 1] = endPoint
  return { start: startPoint, curves }
}

export function arcMoveTo(p: QPath, rect: Rect, angle: number): QPath {
  if (rect.w === 0 && rect.h === 0) return p
  const pt = findEllipseCoords(rect, angle)
  return moveTo(p, pt.x, pt.y)
}

export function arcTo(p: QPath, rect: Rect, startAngle: number, sweep: number): QPath {
  if (rect.w === 0 && rect.h === 0) return p
  const { start, curves } = curvesForArc(rect, startAngle, sweep)
  let out = lineTo(p, start.x, start.y)
  for (let i = 0; i < curves.length; i += 3) out = cubicTo(out, curves[i], curves[i + 1], curves[i + 2])
  return out
}

export function addEllipse(p: QPath, r: Rect): QPath {
  const { start, curves } = curvesForArc(r, 0, -360)
  let out = moveTo(p, start.x, start.y)
  for (let i = 0; i < 12; i += 3) out = cubicTo(out, curves[i], curves[i + 1], curves[i + 2])
  out._req = true
  return out
}

export function addRect(p: QPath, r: Rect): QPath {
  let out = moveTo(p, r.x, r.y)
  out = [...out, ['L', r.x + r.w, r.y], ['L', r.x + r.w, r.y + r.h], ['L', r.x, r.y + r.h],
    ['L', r.x, r.y]] as QPath
  out._req = true
  return out
}

export function addRoundedRect(p: QPath, rect: Rect, xRadius: number, yRadius: number): QPath {
  const r = { x: Math.min(rect.x, rect.x + rect.w), y: Math.min(rect.y, rect.y + rect.h), w: Math.abs(rect.w), h: Math.abs(rect.h) }
  if (r.w === 0 || r.h === 0) return p
  const w2 = r.w / 2
  const h2 = r.h / 2
  const xr = w2 === 0 ? 0 : 100 * Math.min(xRadius, w2) / w2
  const yr = h2 === 0 ? 0 : 100 * Math.min(yRadius, h2) / h2
  if (xr <= 0 || yr <= 0) return addRect(p, r)
  const { x, y, w, h } = r
  const rxx2 = w * xr / 100
  const ryy2 = h * yr / 100
  let out = arcMoveTo(p, { x, y, w: rxx2, h: ryy2 }, 180)
  out = arcTo(out, { x, y, w: rxx2, h: ryy2 }, 180, -90)
  out = arcTo(out, { x: x + w - rxx2, y, w: rxx2, h: ryy2 }, 90, -90)
  out = arcTo(out, { x: x + w - rxx2, y: y + h - ryy2, w: rxx2, h: ryy2 }, 0, -90)
  out = arcTo(out, { x, y: y + h - ryy2, w: rxx2, h: ryy2 }, 270, -90)
  out = closeSubpath(out)
  return out
}

// ------------------------------------------------------- bounds
// QPainterPath.controlPointRect() (`control`) or boundingRect() (tight).
export function cmdsBounds(cmds: Cmd[], control = false): Rect {
  if (!cmds.length) return emptyRect()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  let cur: Pt = { x: 0, y: 0 }
  for (const c of cmds) {
    if (c[0] === 'C') {
      if (control) {
        add(c[1], c[2]); add(c[3], c[4]); add(c[5], c[6])
      } else {
        const b = bezierBounds(cur, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, { x: c[5], y: c[6] })
        add(b.x, b.y); add(b.x + b.w, b.y + b.h)
      }
      cur = { x: c[5], y: c[6] }
    } else {
      add(c[1], c[2])
      cur = { x: c[1], y: c[2] }
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// The tight bounding box of one cubic.
export function bezierBounds(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Rect {
  const xs = [p0.x, p3.x]
  const ys = [p0.y, p3.y]
  const roots = (a: number, b: number, c: number, d: number): number[] => {
    // derivative of the cubic: 3(-a+3b-3c+d)t² + 6(a-2b+c)t + 3(b-a)
    const A = -a + 3 * b - 3 * c + d
    const B = 2 * (a - 2 * b + c)
    const C = b - a
    const out: number[] = []
    if (Math.abs(A) < 1e-12) {
      if (Math.abs(B) > 1e-12) out.push(-C / B)
    } else {
      const disc = B * B - 4 * A * C
      if (disc >= 0) {
        const s = Math.sqrt(disc)
        out.push((-B + s) / (2 * A), (-B - s) / (2 * A))
      }
    }
    return out.filter(t => t > 0 && t < 1)
  }
  const at = (a: number, b: number, c: number, d: number, t: number) => {
    const m = 1 - t
    return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d
  }
  for (const t of roots(p0.x, p1.x, p2.x, p3.x)) xs.push(at(p0.x, p1.x, p2.x, p3.x, t))
  for (const t of roots(p0.y, p1.y, p2.y, p3.y)) ys.push(at(p0.y, p1.y, p2.y, p3.y, t))
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

// Flatten a path into polylines (hit tests, the eraser, the bucket).
export function flatten(cmds: Cmd[], steps = 16): Pt[][] {
  const out: Pt[][] = []
  let cur: Pt[] = []
  let last: Pt = { x: 0, y: 0 }
  for (const c of cmds) {
    if (c[0] === 'M') {
      if (cur.length) out.push(cur)
      last = { x: c[1], y: c[2] }
      cur = [last]
    } else if (c[0] === 'L') {
      last = { x: c[1], y: c[2] }
      cur.push(last)
    } else {
      const p0 = last
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const m = 1 - t
        cur.push({
          x: m * m * m * p0.x + 3 * m * m * t * c[1] + 3 * m * t * t * c[3] + t * t * t * c[5],
          y: m * m * m * p0.y + 3 * m * m * t * c[2] + 3 * m * t * t * c[4] + t * t * t * c[6],
        })
      }
      last = { x: c[5], y: c[6] }
    }
  }
  if (cur.length) out.push(cur)
  return out
}
