// Annotation arrows, callouts and banners.
// Port of khervedoc/paint/arrows.py.
//
// Each `build<Name>(w, h)` returns a list of shape-spec dicts (the AI/
// example format) drawing a symbol inside the box (0,0)-(w,h). Same
// `buildSpecs`/`sizeMm`/`REFERENCE_MM` interface as floorplan/electrical.

import type { SymbolBuilder, SymbolSpec } from './paintSymbols.ts'

export const NAME = 'arrows'

export const OUTLINE = '#333333'
export const FILL = '#dfe7ee'
export const ACCENT = '#cfe0f5'

const radians = (d: number): number => d * (Math.PI / 180.0)
const degrees = (r: number): number => r * (180.0 / Math.PI)

// Filled triangle, apex at (cx, cy), reaching `length` in `direction`
// ('l','r','u','d'); box dims swapped before 90/270 so it isn't squashed.
function _tri(cx: number, cy: number, length: number, base: number, direction: string, fill = FILL): SymbolSpec {
  if (direction === 'u' || direction === 'd') {
    let x: number, y: number, rot: number
    if (direction === 'u') {
      x = cx - base * 0.5; y = cy; rot = 0
    } else {
      x = cx - base * 0.5; y = cy - length; rot = 180
    }
    return { shape: 'triangle', x, y, w: base, h: length, stroke: OUTLINE, fill, width: 2, rotation: rot }
  }
  let cxb: number, rot: number
  if (direction === 'r') {
    cxb = cx - length * 0.5; rot = 90
  } else {
    cxb = cx + length * 0.5; rot = 270
  }
  return {
    shape: 'triangle', x: cxb - base * 0.5, y: cy - length * 0.5,
    w: base, h: length, stroke: OUTLINE, fill, width: 2, rotation: rot,
  }
}

export function buildArrowRight(w: number, h: number): SymbolSpec[] {
  return [{ shape: 'arrow_right', x: 0.0, y: 0.0, w, h, rotation: 0.0, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function buildArrowLeft(w: number, h: number): SymbolSpec[] {
  return [{ shape: 'arrow_right', x: 0.0, y: 0.0, w, h, rotation: 180.0, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function buildArrowUp(w: number, h: number): SymbolSpec[] {
  return [{ shape: 'arrow_right', x: 0.0, y: 0.0, w, h, rotation: 270.0, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function buildArrowDown(w: number, h: number): SymbolSpec[] {
  return [{ shape: 'arrow_right', x: 0.0, y: 0.0, w, h, rotation: 90.0, stroke: OUTLINE, fill: FILL, width: 2 }]
}

export function buildDoubleArrow(w: number, h: number): SymbolSpec[] {
  const head = w * 0.26
  const cy = h * 0.5
  const shaft_h = h * 0.42
  return [
    {
      shape: 'rect', x: head, y: cy - shaft_h * 0.5, w: w - 2 * head, h: shaft_h,
      stroke: OUTLINE, fill: FILL, width: 2,
    },
    _tri(0.0, cy, head, h, 'l'), // left head, apex at far left
    _tri(w, cy, head, h, 'r'), // right head, apex at far right
  ]
}

// Filled arrowhead, apex at (tipx, tipy), pointing along `ang` (rad).
// A square box keeps it undistorted under arbitrary rotation.
function _head(tipx: number, tipy: number, ang: number, size: number, fill = FILL): SymbolSpec {
  const cx = tipx - size * 0.5 * Math.cos(ang)
  const cy = tipy - size * 0.5 * Math.sin(ang)
  return {
    shape: 'triangle', x: cx - size * 0.5, y: cy - size * 0.5,
    w: size, h: size, rotation: degrees(ang) + 90,
    stroke: OUTLINE, fill, width: 2,
  }
}

// A smooth ~110° arc with a filled arrowhead tangent at its tip.
export function buildCurvedArrow(w: number, h: number): SymbolSpec[] {
  const cx = w * 0.18
  const cy = h * 0.82
  const rx = w * 0.66
  const ry = h * 0.66
  const a0 = radians(-100)
  const a1 = radians(8)
  const n = 24
  const pts: [number, number][] = []
  for (let i = 0; i < n + 1; i++) {
    pts.push([cx + rx * Math.cos(a0 + ((a1 - a0) * i) / n), cy + ry * Math.sin(a0 + ((a1 - a0) * i) / n)])
  }
  const specs: SymbolSpec[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    specs.push({
      shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1],
      stroke: OUTLINE, width: 2,
    })
  }
  const [ex, ey] = pts[pts.length - 1]
  const [px, py] = pts[pts.length - 2]
  specs.push(_head(ex, ey, Math.atan2(ey - py, ex - px), Math.min(w, h) * 0.28))
  return specs
}

export function buildBentArrow(w: number, h: number): SymbolSpec[] {
  const sw = Math.min(w, h) * 0.16
  const head = Math.min(w, h) * 0.3
  const vx = w - sw - head * 0.5
  return [
    { shape: 'rect', x: 0.0, y: h - sw, w: vx + sw, h: sw, stroke: OUTLINE, fill: FILL, width: 2 },
    { shape: 'rect', x: vx, y: head, w: sw, h: h - head - sw, stroke: OUTLINE, fill: FILL, width: 2 },
    {
      shape: 'triangle', x: vx + sw / 2 - head / 2, y: 0.0, w: head, h: head, rotation: 0.0,
      stroke: OUTLINE, fill: FILL, width: 2,
    },
  ]
}

// A cycle/refresh arrow: a ~300° ring drawn as a polyline + a V head.
export function buildCircularArrow(w: number, h: number): SymbolSpec[] {
  const cx = w * 0.5
  const cy = h * 0.52
  const rx = w * 0.36
  const ry = h * 0.36
  const a0 = radians(70)
  const a1 = radians(70 + 300) // gap at the top
  const n = 28
  const pts: [number, number][] = []
  for (let i = 0; i < n + 1; i++) {
    pts.push([cx + rx * Math.cos(a0 + ((a1 - a0) * i) / n), cy + ry * Math.sin(a0 + ((a1 - a0) * i) / n)])
  }
  const specs: SymbolSpec[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    specs.push({
      shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1],
      stroke: OUTLINE, width: 2,
    })
  }
  // V arrowhead at the end, along the tangent
  const end = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0])
  const hd = Math.min(w, h) * 0.18
  for (const da of [radians(150), radians(-150)]) {
    specs.push({
      shape: 'line', x1: end[0], y1: end[1],
      x2: end[0] + hd * Math.cos(ang + da),
      y2: end[1] + hd * Math.sin(ang + da),
      stroke: OUTLINE, width: 2,
    })
  }
  return specs
}

export function buildCalloutRect(w: number, h: number): SymbolSpec[] {
  const body_h = h * 0.78
  const tail_w = w * 0.18
  const tail_x = w * 0.15
  return [
    { shape: 'rect', x: 0.0, y: 0.0, w, h: body_h, stroke: OUTLINE, fill: FILL, width: 2 },
    {
      shape: 'triangle', x: tail_x, y: body_h, w: tail_w, h: h - body_h, rotation: 180.0,
      stroke: OUTLINE, fill: FILL, width: 2,
    },
  ]
}

export function buildCalloutRound(w: number, h: number): SymbolSpec[] {
  const body_h = h * 0.78
  const tail_w = w * 0.18
  const tail_x = w * 0.15
  return [
    {
      shape: 'rounded_rect', x: 0.0, y: 0.0, w, h: body_h,
      radius: Math.min(w, body_h) * 0.18, stroke: OUTLINE, fill: FILL, width: 2,
    },
    {
      shape: 'triangle', x: tail_x, y: body_h, w: tail_w, h: h - body_h, rotation: 180.0,
      stroke: OUTLINE, fill: FILL, width: 2,
    },
  ]
}

// A ribbon banner: a rectangle with a fishtail (V-notch) cut into each
// short end.
export function buildBanner(w: number, h: number): SymbolSpec[] {
  const notch = w * 0.1
  const cy = h * 0.5
  const specs: SymbolSpec[] = [
    // body fill (border drawn separately so the ends can be notched)
    { shape: 'rect', x: 0.0, y: 0.0, w, h, stroke: 'none', fill: FILL, width: 2 },
    // carve the two fishtail notches with background-coloured triangles
    // (spreading keeps the keys where _tri put them, like dict(d, k=v))
    { ..._tri(notch, cy, notch, h, 'r'), stroke: 'none', fill: '#ffffff' },
    { ..._tri(w - notch, cy, notch, h, 'l'), stroke: 'none', fill: '#ffffff' },
  ]
  // outline of the resulting banner (6 segments)
  const pts: [number, number][] = [[0.0, 0.0], [w, 0.0], [w - notch, cy], [w, h], [0.0, h], [notch, cy]]
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    specs.push({ shape: 'line', x1, y1, x2, y2, stroke: OUTLINE, width: 2 })
  }
  return specs
}

export function buildBurst(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'star', x: 0.0, y: 0.0, w, h, rotation: 0.0, stroke: OUTLINE, fill: ACCENT, width: 2 },
    { shape: 'text', text: 'NEW!', x: w * 0.5, y: h * 0.5, size: h * 0.18, color: OUTLINE, anchor: 'center' },
  ]
}

// ---------------------------------------------------------------------------
// Thin line connectors (same look as the straight arrow tool, but curved /
// bent).  Drawn as a thin polyline + a small solid arrowhead at the tip.
// ---------------------------------------------------------------------------
function _seg(x1: number, y1: number, x2: number, y2: number): SymbolSpec {
  return { shape: 'line', x1, y1, x2, y2, stroke: OUTLINE, width: 2 }
}

// Line specs through `pts` plus a solid arrowhead on the last segment.
function _polylineHead(pts: [number, number][], hsize: number): SymbolSpec[] {
  const specs: SymbolSpec[] = []
  for (let i = 0; i < pts.length - 1; i++) specs.push(_seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
  const [ex, ey] = pts[pts.length - 1]
  const [px, py] = pts[pts.length - 2]
  specs.push(_head(ex, ey, Math.atan2(ey - py, ex - px), hsize, OUTLINE))
  return specs
}

// A gently curved thin arrow (quadratic bezier) — tail bottom-left,
// head top-right.
export function buildConnectorCurve(w: number, h: number): SymbolSpec[] {
  const x0 = w * 0.05
  const y0 = h * 0.8
  const x1 = w * 0.93
  const y1 = h * 0.3
  const cxp = w * 0.45 // control point bows the curve up
  const cyp = h * 0.02
  const n = 22
  const pts: [number, number][] = []
  for (let i = 0; i < n + 1; i++) {
    const t = i / n
    const mt = 1 - t
    pts.push([mt * mt * x0 + 2 * mt * t * cxp + t * t * x1, mt * mt * y0 + 2 * mt * t * cyp + t * t * y1])
  }
  return _polylineHead(pts, Math.min(w, h) * 0.18)
}

// A right-angle (elbow) thin arrow: across, then down to the head.
export function buildConnectorElbow(w: number, h: number): SymbolSpec[] {
  const x0 = w * 0.06
  const y0 = h * 0.18
  const xc = w * 0.85
  const y1 = h * 0.92
  return _polylineHead([[x0, y0], [xc, y0], [xc, y1]], Math.min(w, h) * 0.16)
}

// A stepped (Z) thin arrow: across, down, across to the head.
export function buildConnectorZigzag(w: number, h: number): SymbolSpec[] {
  const x0 = w * 0.06
  const y0 = h * 0.22
  const xm = w * 0.52
  const x1 = w * 0.94
  const y1 = h * 0.78
  return _polylineHead([[x0, y0], [xm, y0], [xm, y1], [x1, y1]], Math.min(w, h) * 0.16)
}

// A U-turn thin arrow: up, across, back down to the head.
export function buildConnectorU(w: number, h: number): SymbolSpec[] {
  const x0 = w * 0.22
  const y0 = h * 0.94
  const yt = h * 0.1
  const x1 = w * 0.78
  return _polylineHead([[x0, y0], [x0, yt], [x1, yt], [x1, y0]], Math.min(w, h) * 0.16)
}

export const REFERENCE_MM = 1200.0

export const SIZES: Record<string, [number, number]> = {
  arrow_right: [200.0, 100.0],
  arrow_left: [200.0, 100.0],
  arrow_up: [100.0, 200.0],
  arrow_down: [100.0, 200.0],
  double_arrow: [200.0, 100.0],
  curved_arrow: [160.0, 160.0],
  bent_arrow: [160.0, 160.0],
  circular_arrow: [160.0, 160.0],
  callout_rect: [220.0, 150.0],
  callout_round: [220.0, 150.0],
  banner: [260.0, 90.0],
  burst: [160.0, 160.0],
  connector_curve: [220.0, 130.0],
  connector_elbow: [180.0, 160.0],
  connector_zigzag: [200.0, 150.0],
  connector_u: [160.0, 170.0],
}

export const LABELS: Record<string, string> = {
  arrow_right: 'Arrow right',
  arrow_left: 'Arrow left',
  arrow_up: 'Arrow up',
  arrow_down: 'Arrow down',
  double_arrow: 'Double arrow',
  curved_arrow: 'Curved arrow',
  bent_arrow: 'Bent arrow',
  circular_arrow: 'Circular arrow',
  callout_rect: 'Rectangular callout',
  callout_round: 'Rounded callout',
  banner: 'Ribbon banner',
  burst: 'Starburst badge',
  connector_curve: 'Curved connector',
  connector_elbow: 'Elbow connector',
  connector_zigzag: 'Z-bend connector',
  connector_u: 'U-turn connector',
}

export const CATEGORIES: [string, string[]][] = [
  ['Block arrows',
    ['arrow_right', 'arrow_left', 'arrow_up', 'arrow_down', 'double_arrow']],
  ['Special arrows',
    ['curved_arrow', 'bent_arrow', 'circular_arrow']],
  ['Callouts & banners',
    ['callout_rect', 'callout_round', 'banner', 'burst']],
  ['Connectors',
    ['connector_curve', 'connector_elbow', 'connector_zigzag',
      'connector_u']],
]

const _BUILDERS: Record<string, SymbolBuilder> = {
  arrow_right: buildArrowRight,
  arrow_left: buildArrowLeft,
  arrow_up: buildArrowUp,
  arrow_down: buildArrowDown,
  double_arrow: buildDoubleArrow,
  curved_arrow: buildCurvedArrow,
  bent_arrow: buildBentArrow,
  circular_arrow: buildCircularArrow,
  callout_rect: buildCalloutRect,
  callout_round: buildCalloutRound,
  banner: buildBanner,
  burst: buildBurst,
  connector_curve: buildConnectorCurve,
  connector_elbow: buildConnectorElbow,
  connector_zigzag: buildConnectorZigzag,
  connector_u: buildConnectorU,
}

export function buildSpecs(name: string, w: number, h: number): SymbolSpec[] {
  if (!Object.hasOwn(_BUILDERS, name)) throw new Error(`KeyError: '${name}'`)
  return _BUILDERS[name](w, h)
}

export function sizeMm(name: string): [number, number] {
  if (!Object.hasOwn(SIZES, name)) throw new Error(`KeyError: '${name}'`)
  return SIZES[name]
}
