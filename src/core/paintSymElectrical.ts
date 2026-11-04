// Electrical symbols: circuit components + building-installation markers.
// Port of khervedoc/paint/electrical.py.
//
// Like `floorplan.py`: each `build<Name>(w, h)` returns shape-spec dicts
// (the AI/example format) drawing a standard IEC/ANSI-style symbol in the
// box (0,0)-(w,h). `SIZES` (mm), `LABELS`, `CATEGORIES` drive the
// **Electrical** dropdown; `PaintScene.place_elec_element` builds native,
// editable, grouped items from the specs on click.

import type { SymbolBuilder, SymbolSpec } from './paintSymbols.ts'

export const NAME = 'electrical'

const _STK = '#222222'

const radians = (d: number): number => d * (Math.PI / 180.0)

// --------------------------------------------------------- circuit components
export function buildResistor(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.2, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'rect', x: w * 0.2, y: h * 0.32, w: w * 0.6, h: h * 0.36, stroke: _STK, width: 2, fill: 'none' },
    { shape: 'line', x1: w * 0.8, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function buildCapacitor(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.42, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.42, y1: h * 0.25, x2: w * 0.42, y2: h * 0.75, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.58, y1: h * 0.25, x2: w * 0.58, y2: h * 0.75, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.58, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function buildPolarizedCapacitor(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.4, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.4, y1: h * 0.22, x2: w * 0.4, y2: h * 0.78, stroke: _STK, width: 2 },
    {
      shape: 'halfcircle', x: w * 0.5, y: h * 0.22, w: w * 0.12, h: h * 0.56,
      stroke: _STK, fill: 'none', width: 2, rotation: 90,
    },
    { shape: 'line', x1: w * 0.56, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.24, y1: h * 0.18, x2: w * 0.34, y2: h * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.29, y1: h * 0.1, x2: w * 0.29, y2: h * 0.26, stroke: _STK, width: 1.5 },
  ]
}

export function buildInductor(w: number, h: number): SymbolSpec[] {
  const out: SymbolSpec[] = [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.2, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.8, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
  const n = 4
  const span = w * 0.6
  const bump_h = h * 0.28
  const d = span / n
  for (let i = 0; i < n; i++) {
    out.push({
      shape: 'halfcircle', x: w * 0.2 + i * d, y: h * 0.5 - bump_h, w: d, h: bump_h * 2,
      stroke: _STK, fill: 'none', width: 2, rotation: 0,
    })
  }
  return out
}

export function buildDiode(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.3, y2: h * 0.5, stroke: _STK, width: 2 },
    {
      shape: 'triangle', x: w * 0.3, y: h * 0.28, w: w * 0.32, h: h * 0.44,
      stroke: _STK, fill: _STK, width: 2, rotation: 90,
    },
    { shape: 'line', x1: w * 0.62, y1: h * 0.28, x2: w * 0.62, y2: h * 0.72, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.62, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function buildLed(w: number, h: number): SymbolSpec[] {
  const out = buildDiode(w, h)
  for (const off of [0.0, 0.16]) {
    const ax = w * 0.42 + off * w
    const ay = h * 0.24 - off * h * 0.4
    const bx = ax + w * 0.12
    const by = ay - h * 0.2
    out.push({ shape: 'line', x1: ax, y1: ay, x2: bx, y2: by, stroke: _STK, width: 1.5 })
    out.push({
      shape: 'triangle', x: bx - w * 0.045, y: by - h * 0.06, w: w * 0.09, h: h * 0.12,
      stroke: _STK, fill: _STK, width: 1.5, rotation: 45,
    })
  }
  return out
}

export function buildNpnTransistor(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.38, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.38, y1: h * 0.3, x2: w * 0.38, y2: h * 0.7, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.38, y1: h * 0.42, x2: w * 0.66, y2: h * 0.22, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.66, y1: h * 0.22, x2: w * 0.66, y2: 0, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.38, y1: h * 0.58, x2: w * 0.66, y2: h * 0.78, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.66, y1: h * 0.78, x2: w * 0.66, y2: h, stroke: _STK, width: 2 },
    {
      shape: 'triangle', x: w * 0.54, y: h * 0.62, w: w * 0.12, h: h * 0.16,
      stroke: _STK, fill: _STK, width: 1.5, rotation: 145,
    },
  ]
}

export function buildBattery(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.28, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.28, y1: h * 0.2, x2: w * 0.28, y2: h * 0.8, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.4, y1: h * 0.34, x2: w * 0.4, y2: h * 0.66, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.56, y1: h * 0.2, x2: w * 0.56, y2: h * 0.8, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.68, y1: h * 0.34, x2: w * 0.68, y2: h * 0.66, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.68, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function buildDcSource(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.18, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.82, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.32, y1: h * 0.4, x2: w * 0.42, y2: h * 0.4, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.37, y1: h * 0.32, x2: w * 0.37, y2: h * 0.48, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.58, y1: h * 0.6, x2: w * 0.68, y2: h * 0.6, stroke: _STK, width: 1.5 },
  ]
}

export function buildAcSource(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.18, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.82, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    {
      shape: 'halfcircle', x: w * 0.33, y: h * 0.42, w: w * 0.17, h: h * 0.16,
      stroke: _STK, fill: 'none', width: 1.5, rotation: 0,
    },
    {
      shape: 'halfcircle', x: w * 0.5, y: h * 0.42, w: w * 0.17, h: h * 0.16,
      stroke: _STK, fill: 'none', width: 1.5, rotation: 180,
    },
  ]
}

export function buildGround(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: w * 0.5, y1: 0, x2: w * 0.5, y2: h * 0.45, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.2, y1: h * 0.45, x2: w * 0.8, y2: h * 0.45, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.3, y1: h * 0.65, x2: w * 0.7, y2: h * 0.65, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.4, y1: h * 0.85, x2: w * 0.6, y2: h * 0.85, stroke: _STK, width: 2 },
  ]
}

export function buildSwitch(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.25, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.22, y: h * 0.46, w: w * 0.06, h: w * 0.06, stroke: _STK, fill: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.25, y1: h * 0.5, x2: w * 0.7, y2: h * 0.22, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.72, y: h * 0.46, w: w * 0.06, h: w * 0.06, stroke: _STK, fill: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.75, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function buildLamp(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.18, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.18, y: h * 0.1, w: w * 0.64, h: h * 0.8, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.82, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'line', x1: w * 0.32, y1: h * 0.27, x2: w * 0.68, y2: h * 0.73, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.68, y1: h * 0.27, x2: w * 0.32, y2: h * 0.73, stroke: _STK, width: 1.5 },
  ]
}

export function buildFuse(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w * 0.2, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'rect', x: w * 0.2, y: h * 0.34, w: w * 0.6, h: h * 0.32, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: w * 0.2, y1: h * 0.5, x2: w * 0.8, y2: h * 0.5, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: w * 0.8, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
  ]
}

export function buildJunction(w: number, h: number): SymbolSpec[] {
  return [
    { shape: 'line', x1: w * 0.5, y1: 0, x2: w * 0.5, y2: h, stroke: _STK, width: 2 },
    { shape: 'line', x1: 0, y1: h * 0.5, x2: w, y2: h * 0.5, stroke: _STK, width: 2 },
    { shape: 'circle', x: w * 0.42, y: h * 0.42, w: w * 0.16, h: w * 0.16, stroke: _STK, fill: _STK, width: 1.5 },
  ]
}

// ----------------------------------------------------- building installation
export function buildSocketOutlet(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const cx = w / 2
  const base_y = h / 2 + m * 0.18
  const r = m * 0.32
  return [
    { shape: 'line', x1: cx - r * 1.4, y1: base_y, x2: cx + r * 1.4, y2: base_y, stroke: _STK, width: 2 },
    {
      shape: 'halfcircle', x: cx - r, y: base_y - r * 2, w: r * 2, h: r * 2,
      stroke: _STK, fill: 'none', width: 2, rotation: 0,
    },
    { shape: 'line', x1: cx, y1: base_y, x2: cx, y2: base_y + m * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx - r * 0.5, y1: base_y, x2: cx - r * 0.5, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + r * 0.5, y1: base_y, x2: cx + r * 0.5, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
  ]
}

export function buildDoubleSocket(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const cx = w / 2
  const base_y = h / 2 + m * 0.18
  const r = m * 0.32
  return [
    { shape: 'line', x1: cx - r * 1.4, y1: base_y, x2: cx + r * 1.4, y2: base_y, stroke: _STK, width: 2 },
    {
      shape: 'halfcircle', x: cx - r, y: base_y - r * 2, w: r * 2, h: r * 2,
      stroke: _STK, fill: 'none', width: 2, rotation: 0,
    },
    { shape: 'line', x1: cx - r * 0.35, y1: base_y, x2: cx - r * 0.35, y2: base_y + m * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + r * 0.35, y1: base_y, x2: cx + r * 0.35, y2: base_y + m * 0.18, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx - r * 0.85, y1: base_y, x2: cx - r * 0.85, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + r * 0.85, y1: base_y, x2: cx + r * 0.85, y2: base_y + m * 0.12, stroke: _STK, width: 1.5 },
  ]
}

export function buildLightSwitch(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  const r = m * 0.16
  const x0 = cx - m * 0.34
  const y0 = cy + m * 0.34
  return [
    { shape: 'circle', x: x0 - r, y: y0 - r, w: r * 2, h: r * 2, stroke: _STK, fill: _STK, width: 2 },
    { shape: 'line', x1: x0, y1: y0, x2: cx + m * 0.3, y2: cy - m * 0.3, stroke: _STK, width: 2 },
    { shape: 'text', text: 'S', x: cx + m * 0.1, y: cy + m * 0.1, size: Math.max(Math.trunc(m * 0.3), 6), color: _STK },
  ]
}

export function buildTwoWaySwitch(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  const r = m * 0.16
  const x0 = cx - m * 0.34
  const y0 = cy + m * 0.34
  return [
    { shape: 'circle', x: x0 - r, y: y0 - r, w: r * 2, h: r * 2, stroke: _STK, fill: _STK, width: 2 },
    { shape: 'line', x1: x0, y1: y0, x2: cx + m * 0.3, y2: cy - m * 0.3, stroke: _STK, width: 2 },
    { shape: 'line', x1: x0, y1: y0, x2: cx + m * 0.36, y2: cy - m * 0.06, stroke: _STK, width: 1.5 },
    { shape: 'text', text: '2', x: cx - m * 0.05, y: cy + m * 0.12, size: Math.max(Math.trunc(m * 0.28), 6), color: _STK },
  ]
}

export function buildCeilingLight(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const d = m * 0.66
  const x = (w - d) / 2
  const y = (h - d) / 2
  const r = d / 2
  const cx = w / 2
  const cy = h / 2
  const off = r * Math.sin(Math.PI / 4)
  return [
    { shape: 'circle', x, y, w: d, h: d, stroke: _STK, width: 2, fill: 'none' },
    { shape: 'line', x1: cx - off, y1: cy - off, x2: cx + off, y2: cy + off, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx + off, y1: cy - off, x2: cx - off, y2: cy + off, stroke: _STK, width: 1.5 },
  ]
}

export function buildWallLight(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const cx = w / 2
  const wall_y = h / 2 + m * 0.22
  const d = m * 0.5
  const r = d / 2
  const off = r * Math.sin(Math.PI / 4)
  return [
    { shape: 'line', x1: cx - m * 0.42, y1: wall_y, x2: cx + m * 0.42, y2: wall_y, stroke: _STK, width: 2 },
    {
      shape: 'halfcircle', x: cx - r, y: wall_y - d, w: d, h: d,
      stroke: _STK, fill: 'none', width: 2, rotation: 0,
    },
    { shape: 'line', x1: cx - off, y1: wall_y - off, x2: cx + off, y2: wall_y - off, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx, y1: wall_y - r * 1.05, x2: cx, y2: wall_y, stroke: _STK, width: 1.5 },
  ]
}

export function buildConsumerUnit(w: number, h: number): SymbolSpec[] {
  const bw = w * 0.74
  const bh = h * 0.42
  const x = (w - bw) / 2
  const y = (h - bh) / 2
  const specs: SymbolSpec[] = [{ shape: 'rect', x, y, w: bw, h: bh, stroke: _STK, fill: 'none', width: 2 }]
  for (let i = 1; i < 4; i++) {
    const vx = x + (bw * i) / 4
    specs.push({ shape: 'line', x1: vx, y1: y, x2: vx, y2: y + bh, stroke: _STK, width: 1.5 })
  }
  return specs
}

export function buildJunctionBox(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const d = m * 0.5
  const x = (w - d) / 2
  const y = (h - d) / 2
  const cx = w / 2
  const cy = h / 2
  const s = m * 0.16
  return [
    { shape: 'circle', x, y, w: d, h: d, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'line', x1: cx, y1: y - s, x2: cx, y2: y, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: cx, y1: y + d, x2: cx, y2: y + d + s, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: x - s, y1: cy, x2: x, y2: cy, stroke: _STK, width: 1.5 },
    { shape: 'line', x1: x + d, y1: cy, x2: x + d + s, y2: cy, stroke: _STK, width: 1.5 },
  ]
}

export function buildCeilingFan(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  const hub = m * 0.16
  const bl = m * 0.36
  const bw = m * 0.16
  const specs: SymbolSpec[] = [
    { shape: 'circle', x: cx - hub, y: cy - hub, w: hub * 2, h: hub * 2, stroke: _STK, fill: _STK, width: 2 },
  ]
  for (let k = 0; k < 4; k++) {
    const ang = radians(45 + 90 * k)
    const ex = cx + Math.cos(ang) * bl
    const ey = cy + Math.sin(ang) * bl
    specs.push({
      shape: 'ellipse', x: ex - bw, y: ey - bw * 0.4, w: bw * 2, h: bw * 0.8,
      stroke: _STK, fill: 'none', width: 1.5,
    })
    specs.push({ shape: 'line', x1: cx, y1: cy, x2: ex, y2: ey, stroke: _STK, width: 1.5 })
  }
  return specs
}

export function buildSmokeDetector(w: number, h: number): SymbolSpec[] {
  const m = Math.min(w, h)
  const d = m * 0.66
  const x = (w - d) / 2
  const y = (h - d) / 2
  const cx = w / 2
  const cy = h / 2
  const di = d * 0.55
  const xi = (w - di) / 2
  const yi = (h - di) / 2
  return [
    { shape: 'circle', x, y, w: d, h: d, stroke: _STK, fill: 'none', width: 2 },
    { shape: 'circle', x: xi, y: yi, w: di, h: di, stroke: _STK, fill: 'none', width: 1.5 },
    { shape: 'text', text: 'SD', x: cx - m * 0.14, y: cy + m * 0.1, size: Math.max(Math.trunc(m * 0.26), 6), color: _STK },
  ]
}

// The page width represents this much real space (mm); symbols are sized
// as a fraction of the page so components/installation markers fit on it.
export const REFERENCE_MM = 600.0

export const SIZES: Record<string, [number, number]> = {
  resistor: [24, 10], capacitor: [20, 14],
  polarized_capacitor: [20, 14], inductor: [28, 10], diode: [22, 12],
  led: [22, 16], npn_transistor: [18, 18], battery: [24, 14],
  dc_source: [18, 18], ac_source: [18, 18], ground: [12, 12],
  switch: [22, 12], lamp: [18, 18], fuse: [24, 10], junction: [8, 8],
  socket_outlet: [120, 120], double_socket: [140, 120],
  light_switch: [120, 120], two_way_switch: [120, 120],
  ceiling_light: [150, 150], wall_light: [140, 120],
  consumer_unit: [180, 120], junction_box: [120, 120],
  ceiling_fan: [160, 160], smoke_detector: [150, 150],
}

export const LABELS: Record<string, string> = {
  resistor: 'Resistor', capacitor: 'Capacitor',
  polarized_capacitor: 'Polarised capacitor', inductor: 'Inductor',
  diode: 'Diode', led: 'LED', npn_transistor: 'NPN transistor',
  battery: 'Battery', dc_source: 'DC source', ac_source: 'AC source',
  ground: 'Ground', switch: 'Switch', lamp: 'Lamp', fuse: 'Fuse',
  junction: 'Junction', socket_outlet: 'Socket',
  double_socket: 'Double socket', light_switch: 'Light switch',
  two_way_switch: 'Two-way switch', ceiling_light: 'Ceiling light',
  wall_light: 'Wall light', consumer_unit: 'Consumer unit',
  junction_box: 'Junction box', ceiling_fan: 'Ceiling fan',
  smoke_detector: 'Smoke detector',
}

export const CATEGORIES: [string, string[]][] = [
  ['Components',
    ['resistor', 'capacitor', 'polarized_capacitor', 'inductor', 'diode',
      'led', 'npn_transistor', 'fuse', 'switch', 'lamp']],
  ['Sources & ground',
    ['battery', 'dc_source', 'ac_source', 'ground', 'junction']],
  ['Installation (plan)',
    ['socket_outlet', 'double_socket', 'light_switch', 'two_way_switch',
      'ceiling_light', 'wall_light', 'consumer_unit', 'junction_box',
      'ceiling_fan', 'smoke_detector']],
]

const _BUILDERS: Record<string, SymbolBuilder> = {
  resistor: buildResistor,
  capacitor: buildCapacitor,
  polarized_capacitor: buildPolarizedCapacitor,
  inductor: buildInductor,
  diode: buildDiode,
  led: buildLed,
  npn_transistor: buildNpnTransistor,
  battery: buildBattery,
  dc_source: buildDcSource,
  ac_source: buildAcSource,
  ground: buildGround,
  switch: buildSwitch,
  lamp: buildLamp,
  fuse: buildFuse,
  junction: buildJunction,
  socket_outlet: buildSocketOutlet,
  double_socket: buildDoubleSocket,
  light_switch: buildLightSwitch,
  two_way_switch: buildTwoWaySwitch,
  ceiling_light: buildCeilingLight,
  wall_light: buildWallLight,
  consumer_unit: buildConsumerUnit,
  junction_box: buildJunctionBox,
  ceiling_fan: buildCeilingFan,
  smoke_detector: buildSmokeDetector,
}

export function buildSpecs(name: string, w: number, h: number): SymbolSpec[] {
  if (!Object.hasOwn(_BUILDERS, name)) throw new Error(`KeyError: '${name}'`)
  return _BUILDERS[name](w, h)
}

export function sizeMm(name: string): [number, number] {
  if (!Object.hasOwn(SIZES, name)) throw new Error(`KeyError: '${name}'`)
  return SIZES[name]
}
