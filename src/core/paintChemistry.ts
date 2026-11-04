// Chemistry drawing geometry: bond paths and ring polygons.
// Port of khervedoc/paint/chemistry.py.
//
// Pure geometry only (no item classes) so `canvas` can import it without a
// cycle. The scene builds native items (`PathItem`, `PolygonItem`,
// `EllipseItem`, `TextItem`) from these shapes — so every bond/ring/atom is
// a normal, editable, SVG-round-tripping item.
//
// Qt value types become plain data: a QPointF is {x, y}, a QPolygonF is
// {x, y}[], and a QPainterPath is the command list that
// document.py painterpath_to_cmds writes (['M', x, y] / ['L', x, y]).

export interface Point {
  x: number
  y: number
}

export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number]

// Common atom / group labels offered by the atom tool.
export const ATOMS = ['C', 'H', 'O', 'N', 'S', 'P', 'F', 'Cl', 'Br', 'OH', 'CH3', 'CH2', 'NH2', 'COOH', 'R']

// Ring tool kind -> number of vertices.
export const RING_SIDES: Record<string, number> = { benzene: 6, cyclohexane: 6, cyclopentane: 5 }

const pt = (x: number, y: number): Point => ({ x, y })
const add = (a: Point, b: Point): Point => pt(a.x + b.x, a.y + b.y)
const sub = (a: Point, b: Point): Point => pt(a.x - b.x, a.y - b.y)
const mul = (a: Point, k: number): Point => pt(a.x * k, a.y * k)
// QLineF(p1, p2).length()
const lineLength = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)

// qFuzzyCompare / qFuzzyIsNull for one coordinate, as QPointF == uses them.
function fuzzyEq(a: number, b: number): boolean {
  if (a === 0 || b === 0) return Math.abs(a - b) <= 1e-12
  return Math.abs(a - b) * 1e12 <= Math.min(Math.abs(a), Math.abs(b))
}

// The parts of QPainterPath's element bookkeeping that change the element
// list: an empty path has no elements; the first call seeds a moveTo(0, 0);
// a moveTo straight after a moveTo replaces it; a lineTo to the current
// point (fuzzy ==) is dropped.
class PainterPath {
  readonly cmds: PathCmd[] = []

  private ensure(): void {
    if (this.cmds.length === 0) this.cmds.push(['M', 0, 0])
  }

  private last(): PathCmd {
    return this.cmds[this.cmds.length - 1]
  }

  moveTo(p: Point): void {
    this.ensure()
    const last = this.last()
    if (last[0] === 'M') {
      last[1] = p.x
      last[2] = p.y
    } else {
      this.cmds.push(['M', p.x, p.y])
    }
  }

  lineTo(p: Point): void {
    this.ensure()
    const last = this.last()
    const lx = last[0] === 'C' ? last[5] : last[1]
    const ly = last[0] === 'C' ? last[6] : last[2]
    if (fuzzyEq(p.x, lx) && fuzzyEq(p.y, ly)) return
    this.cmds.push(['L', p.x, p.y])
  }
}

// Unit vector perpendicular to p1->p2.
function _perp(p1: Point, p2: Point): Point {
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x)
  return pt(Math.sin(ang), -Math.cos(ang))
}

// A bond as a QPainterPath: single line, double/triple parallel lines,
// or a hashed (going-back) wedge of perpendicular ticks.
export function bondPath(kind: string, p1: Point, p2: Point, gap: number): PathCmd[] {
  const path = new PainterPath()
  if (lineLength(p1, p2) < 1) return path.cmds
  const perp = _perp(p1, p2)
  if (kind === 'single') {
    path.moveTo(p1); path.lineTo(p2)
  } else if (kind === 'double') {
    for (const s of [mul(perp, gap * 0.5), mul(perp, -gap * 0.5)]) {
      path.moveTo(add(p1, s)); path.lineTo(add(p2, s))
    }
  } else if (kind === 'triple') {
    for (const s of [mul(perp, gap), pt(0, 0), mul(perp, -gap)]) {
      path.moveTo(add(p1, s)); path.lineTo(add(p2, s))
    }
  } else if (kind === 'hash') {
    const length = lineLength(p1, p2)
    const n = Math.max(3, Math.trunc(length / Math.max(gap * 1.6, 1)))
    for (let i = 1; i < n + 1; i++) {
      const t = i / (n + 1)
      const c = pt(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t)
      const w = mul(perp, gap * 0.4 + gap * 1.4 * t) // widens toward p2
      path.moveTo(sub(c, w)); path.lineTo(add(c, w))
    }
  } else if (kind === 'hbond') {
    // Hydrogen bond: a dashed line built from short segments, so the
    // dashes are geometry and survive an SVG round-trip (no pen dash).
    const length = lineLength(p1, p2)
    const unit = pt((p2.x - p1.x) / length, (p2.y - p1.y) / length)
    const dash = Math.max(gap * 1.4, 4.0)
    const space = Math.max(gap, 3.0)
    let d = 0.0
    while (d < length) {
      const a = add(p1, mul(unit, d))
      const b = add(p1, mul(unit, Math.min(d + dash, length)))
      path.moveTo(a); path.lineTo(b)
      d += dash + space
    }
  }
  return path.cmds
}

// A solid (coming-forward) stereo bond: a filled triangle, narrow at
// p1 and wide at p2.
export function wedgePolygon(p1: Point, p2: Point, gap: number): Point[] {
  const w = mul(_perp(p1, p2), gap)
  return [pt(p1.x, p1.y), add(p2, w), sub(p2, w)]
}

// Vertices of a ring (regular polygon) centred at *center*, vertex up.
export function ringPolygon(kind: string, center: Point, r: number): Point[] {
  const sides = Object.hasOwn(RING_SIDES, kind) ? RING_SIDES[kind] : 6
  const pts: Point[] = []
  for (let i = 0; i < sides; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / sides
    pts.push(pt(center.x + r * Math.cos(ang), center.y + r * Math.sin(ang)))
  }
  return pts
}

export function isAromatic(kind: string): boolean {
  return kind === 'benzene'
}
