// Standard flowchart node symbols (ANSI/ISO) for method & algorithm
// workflows. Port of khervedoc/paint/flowchart.py.
//
// Each `build<Name>(w, h)` returns a list of shape-spec dicts (the AI/
// example format) drawing a symbol inside the box (0,0)-(w,h). Same
// `buildSpecs`/`sizeMm`/`REFERENCE_MM` interface as floorplan/electrical.

import type { SymbolBuilder, SymbolSpec } from './paintSymbols.ts'

export const NAME = 'flowchart'

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const _OUTLINE = '#333333'
const _LIGHT = '#eef2f6'
const _DECISION = '#fdf0d5'
const _DATA = '#e6f0ff'

const _W_OUTLINE = 2.0
const _W_DETAIL = 1.2

// A centred caption naming the node, sized to fit the box.
function _label(text: string, w: number, h: number, size?: number, color = _OUTLINE): SymbolSpec {
  if (size === undefined) size = Math.max(8.0, Math.min(h * 0.22, w * 0.16))
  return {
    shape: 'text',
    text,
    x: w / 2.0,
    y: h / 2.0,
    size,
    color,
    anchor: 'center',
  }
}

// A half-disc whose FINAL bounding box is (x, y, w, h), bulging towards
// `direction` ('u','d','l','r'). The half-circle primitive bulges up in
// its own box, so for left/right we swap the box dims before the 90/270
// rotation — keeping the disc round instead of squashing it.
function _hdisc(x: number, y: number, w: number, h: number, direction: string, fill = _LIGHT, width = _W_OUTLINE): SymbolSpec {
  const cx = x + w / 2.0
  const cy = y + h / 2.0
  let bx: number, by: number, bw: number, bh: number, rot: number
  if (direction === 'u') {
    bx = x; by = y; bw = w; bh = h; rot = 0
  } else if (direction === 'd') {
    bx = x; by = y; bw = w; bh = h; rot = 180
  } else {
    // 'l' / 'r': swap dims, rotate
    bw = h; bh = w
    bx = cx - bw / 2.0; by = cy - bh / 2.0
    rot = direction === 'r' ? 90 : 270
  }
  return { shape: 'halfcircle', x: bx, y: by, w: bw, h: bh, stroke: _OUTLINE, fill, width, rotation: rot }
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------
export function buildProcess(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'rect', x: 0.0, y: 0.0, w, h, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('Process', w, h),
  ]
}

export function buildDecision(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'diamond', x: 0.0, y: 0.0, w, h, rotation: 0.0, stroke: _OUTLINE, fill: _DECISION, width: _W_OUTLINE },
    _label('Decision', w, h, Math.max(8.0, Math.min(h * 0.16, w * 0.13))),
  ]
}

export function buildTerminator(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'rounded_rect', x: 0.0, y: 0.0, w, h, radius: h / 2.0, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('Start / End', w, h, Math.max(8.0, Math.min(h * 0.2, w * 0.11))),
  ]
}

export function buildData(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'parallelogram', x: 0.0, y: 0.0, w, h, rotation: 0.0, stroke: _OUTLINE, fill: _DATA, width: _W_OUTLINE },
    _label('Data', w, h),
  ]
}

// Rectangle with a wavy bottom edge (the classic 'document' symbol).
export function buildDocument(w: number, h: number): SymbolSpec[] {
  const body_h = h * 0.82
  const amp = h * 0.1
  const specs: SymbolSpec[] = [
    // filled body (no border; edges drawn separately so the bottom waves)
    { shape: 'rect', x: 0.0, y: 0.0, w, h: body_h, stroke: 'none', fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: 0.0, y1: 0.0, x2: w, y2: 0.0, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: 0.0, y1: 0.0, x2: 0.0, y2: body_h, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: w, y1: 0.0, x2: w, y2: body_h, stroke: _OUTLINE, width: _W_OUTLINE },
  ]
  // wavy bottom edge as a sine polyline
  const n = 24
  const pts: [number, number][] = []
  for (let i = 0; i < n + 1; i++) pts.push([w * (i / n), body_h + amp * Math.sin((i / n) * 2 * Math.PI)])
  for (let i = 0; i < pts.length - 1; i++) {
    specs.push({
      shape: 'line', x1: pts[i][0], y1: pts[i][1], x2: pts[i + 1][0], y2: pts[i + 1][1],
      stroke: _OUTLINE, width: _W_OUTLINE,
    })
  }
  specs.push(_label('Document', w, h, Math.max(8.0, Math.min(h * 0.18, w * 0.12))))
  return specs
}

// Rectangle with double vertical bars near the left/right edges.
export function buildPredefinedProcess(w: number, h: number): SymbolSpec[] {
  const bar = w * 0.12
  return [
    { shape: 'rect', x: 0.0, y: 0.0, w, h, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: bar, y1: 0.0, x2: bar, y2: h, stroke: _OUTLINE, width: _W_DETAIL },
    { shape: 'line', x1: w - bar, y1: 0.0, x2: w - bar, y2: h, stroke: _OUTLINE, width: _W_DETAIL },
    _label('Process', w, h),
  ]
}

export function buildPreparation(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'hexagon', x: 0.0, y: 0.0, w, h, rotation: 0.0, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('Prepare', w, h),
  ]
}

// Quadrilateral with a slanted top edge (trapezoid rotated 180°).
export function buildManualInput(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'trapezoid', x: 0.0, y: 0.0, w, h, rotation: 180.0, stroke: _OUTLINE, fill: _DATA, width: _W_OUTLINE },
    _label('Input', w, h),
  ]
}

// Cylinder: rect body + ellipse top rim + curved (halfcircle) bottom.
export function buildDatabase(w: number, h: number): SymbolSpec[] {
  const rim = h * 0.22
  const body_top = rim / 2.0
  const body_bot = h - rim / 2.0
  const specs: SymbolSpec[] = [
    // body fill (between the rims) + side lines
    { shape: 'rect', x: 0.0, y: body_top, w, h: body_bot - body_top, stroke: 'none', fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: 0.0, y1: body_top, x2: 0.0, y2: body_bot, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: w, y1: body_top, x2: w, y2: body_bot, stroke: _OUTLINE, width: _W_OUTLINE },
    // curved bottom (front of the cylinder, bulging down)
    _hdisc(0.0, body_bot - rim / 2.0, w, rim, 'd', _LIGHT),
    // top rim ellipse
    { shape: 'ellipse', x: 0.0, y: 0.0, w, h: rim, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
  ]
  specs.push(_label('Database', w, h, Math.max(8.0, Math.min(h * 0.16, w * 0.13))))
  return specs
}

// Rectangle with a curved left side (stored-data symbol).
export function buildStoredData(w: number, h: number): SymbolSpec[] {
  const bulge = w * 0.16
  return [
    // body fill + top/bottom/right edges
    { shape: 'rect', x: bulge, y: 0.0, w: w - bulge, h, stroke: 'none', fill: _DATA, width: _W_OUTLINE },
    { shape: 'line', x1: bulge, y1: 0.0, x2: w, y2: 0.0, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: bulge, y1: h, x2: w, y2: h, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: w, y1: 0.0, x2: w, y2: h, stroke: _OUTLINE, width: _W_OUTLINE },
    // curved left side bulging left (flat edge meets the body at x=bulge)
    _hdisc(0.0, 0.0, bulge, h, 'l', _DATA),
    _label('Data', w + bulge, h), // nudge label right of the curve
  ]
}

export function buildConnector(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'circle', x: 0.0, y: 0.0, w, h, stroke: _OUTLINE, fill: _LIGHT, width: _W_OUTLINE },
    _label('A', w, h, Math.max(8.0, Math.min(h * 0.42, w * 0.42))),
  ]
}

// Display symbol: a curved (rounded) left end and a rounded right end.
export function buildDisplay(w: number, h: number): SymbolSpec[] {
  const cap = h * 0.5 // left half-disc radius worth of width
  const bump = w * 0.18 // right rounded snout
  const body_x = cap
  const body_w = w - cap - bump
  return [
    // straight body fill between the two curved ends
    { shape: 'rect', x: body_x, y: 0.0, w: body_w, h, stroke: 'none', fill: _LIGHT, width: _W_OUTLINE },
    { shape: 'line', x1: body_x, y1: 0.0, x2: body_x + body_w, y2: 0.0, stroke: _OUTLINE, width: _W_OUTLINE },
    { shape: 'line', x1: body_x, y1: h, x2: body_x + body_w, y2: h, stroke: _OUTLINE, width: _W_OUTLINE },
    // curved left end (bulging left)
    _hdisc(0.0, 0.0, cap, h, 'l', _LIGHT),
    // rounded right snout (bulging right)
    _hdisc(body_x + body_w, 0.0, bump, h, 'r', _LIGHT),
    _label('Display', w, h, Math.max(8.0, Math.min(h * 0.2, w * 0.13))),
  ]
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------
export function buildFlowArrow(w: number, h: number): SymbolSpec[] {
  return [{ shape: 'arrow', x1: 0.0, y1: h / 2.0, x2: w, y2: h / 2.0, stroke: _OUTLINE, width: _W_OUTLINE }]
}

export function buildFlowLine(w: number, h: number): SymbolSpec[] {
  return [{ shape: 'line', x1: 0.0, y1: h / 2.0, x2: w, y2: h / 2.0, stroke: _OUTLINE, width: _W_OUTLINE }]
}

// ---------------------------------------------------------------------------
// Sizes (mm), labels, categories
// ---------------------------------------------------------------------------
export const REFERENCE_MM = 1400.0

export const SIZES: Record<string, [number, number]> = {
  process: [200.0, 100.0],
  decision: [160.0, 140.0],
  terminator: [200.0, 90.0],
  data: [200.0, 100.0],
  document: [200.0, 110.0],
  predefined_process: [200.0, 100.0],
  preparation: [200.0, 110.0],
  manual_input: [200.0, 100.0],
  database: [140.0, 150.0],
  stored_data: [160.0, 110.0],
  connector: [70.0, 70.0],
  display: [200.0, 110.0],
  flow_arrow: [180.0, 30.0],
  flow_line: [180.0, 20.0],
}

export const LABELS: Record<string, string> = {
  process: 'Process',
  decision: 'Decision',
  terminator: 'Terminator (Start/End)',
  data: 'Data (I/O)',
  document: 'Document',
  predefined_process: 'Predefined process',
  preparation: 'Preparation',
  manual_input: 'Manual input',
  database: 'Database',
  stored_data: 'Stored data',
  connector: 'Connector',
  display: 'Display',
  flow_arrow: 'Flow arrow',
  flow_line: 'Flow line',
}

export const CATEGORIES: [string, string[]][] = [
  ['Nodes', ['process', 'decision', 'terminator', 'data', 'document', 'predefined_process', 'preparation', 'manual_input']],
  ['Data & storage', ['database', 'stored_data', 'connector', 'display']],
  ['Connectors', ['flow_arrow', 'flow_line']],
]

const _BUILDERS: Record<string, SymbolBuilder> = {
  process: buildProcess,
  decision: buildDecision,
  terminator: buildTerminator,
  data: buildData,
  document: buildDocument,
  predefined_process: buildPredefinedProcess,
  preparation: buildPreparation,
  manual_input: buildManualInput,
  database: buildDatabase,
  stored_data: buildStoredData,
  connector: buildConnector,
  display: buildDisplay,
  flow_arrow: buildFlowArrow,
  flow_line: buildFlowLine,
}

export function buildSpecs(name: string, w: number, h: number): SymbolSpec[] {
  const b = Object.hasOwn(_BUILDERS, name) ? _BUILDERS[name] : undefined
  if (!b) throw new Error(`KeyError: '${name}'`)
  return b(w, h)
}

export function sizeMm(name: string): [number, number] {
  if (!Object.hasOwn(SIZES, name)) throw new Error(`KeyError: '${name}'`)
  return SIZES[name]
}
