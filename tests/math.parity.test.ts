// mathlayout.py is the specification for src/math/mathlayout.ts.
// scripts/math_golden.py lays out ~1300 formulas (every equation template,
// symbol, chemistry preview, the mathbox corpus and every equation in the
// document corpus) and dumps the box trees.
//
// "exact": Python measured glyphs with the font's design metrics (what
// fontData.ts holds), so the whole tree — sizes, child offsets, glyph runs
// and font sizes, rules, path control boxes, caret gaps — must match to
// TOL px (the golden is rounded to 4 decimals).
// "qt": the overall size Python gets from real Qt (macOS CoreText) metrics.
// At 1000 px those are nearly the design metrics: 95% of formulas agree to
// 0.1% of the em, the worst (a few glyph ink boxes CoreText pads, e.g. ∧)
// to 2%. At 20 px CoreText pads every glyph's ink box by up to ~0.8 px, which
// no other platform does: 95% agree to 1 px, and a handful differ by up to
// 7.5 px where the padding flips a threshold (a delimiter drawn as the
// glyph instead of the drawn tall form).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as mb from '../src/math/mathbox.ts'
import { Box, Layout } from '../src/math/mathlayout.ts'

const TOL = 2e-3
const QT_P95_1000 = 0.001   // relative to the em
const QT_MAX_1000 = 0.02
const QT_P95_20 = 1.0       // px
const QT_MAX_20 = 7.5

interface Golden {
  exact: { latex: string; display: boolean; px: number; tex: string; texph: string; box: Dump }[]
  qt: ({ latex: string; display: boolean } & Record<string, [number, number, number]>)[]
}
interface Dump {
  w: number; a: number; d: number; em?: number; it?: 1; ch?: 1; ir?: number
  g?: number[]; o?: unknown[][]; k?: [number, number, Dump][]
}

const golden: Golden = JSON.parse(readFileSync(new URL('./golden/math.json', import.meta.url), 'utf-8'))

function dump(box: Box): Dump {
  const d: Dump = { w: box.w, a: box.asc, d: box.desc }
  if (box.em) d.em = box.em
  if (box.italic) d.it = 1
  if (box.charlike) d.ch = 1
  if (box.inkR !== null) d.ir = box.inkR
  if (box.row !== null) d.g = box.gaps
  const ops: unknown[][] = []
  for (const op of box.ops) {
    if (op.k === 't') ops.push(['t', op.dx, op.dy, op.px, op.text])
    else if (op.k === 'rule') ops.push(['rule', op.dx, op.dy, op.w, op.h])
    else if (op.k === 'stroke' || op.k === 'fill') ops.push([op.k, ...op.path.controlPointRect(), op.width, op.path.elementCount()])
    else if (op.k === 'ph') ops.push(['ph', op.dx, op.dy, op.w, op.h])
    else if (op.k === 'chip') ops.push(['chip', op.dx, op.dy, op.w, op.h, op.text, op.px, op.kind])
  }
  if (ops.length) d.o = ops
  if (box.kids.length) d.k = box.kids.map(([dx, dy, b]) => [dx, dy, dump(b)])
  return d
}

// First difference between two dumps, or null.
function diff(a: unknown, b: unknown, path: string): string | null {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= TOL ? null : `${path}: ${a} != ${b}`
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const r = diff(a[i], b[i], `${path}[${i}]`)
      if (r) return r
    }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      const r = diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
      if (r) return r
    }
    return null
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
}

describe('box trees match mathlayout.py (design metrics)', () => {
  it.each(golden.exact.map((e, i) => [i, e.display ? 'D' : 'I', e.latex] as const))('#%i %s %s', (i) => {
    const e = golden.exact[i]!
    const box = new Layout(e.px, e.display).layout(mb.parseLatex(e.latex))
    expect(diff(dump(box), e.box, 'box')).toBeNull()
  })
})

describe('parse + serialise match mathbox.py', () => {
  it.each(golden.exact.filter(e => e.display).map(e => e.latex))('%s', (latex) => {
    const e = golden.exact.find(x => x.latex === latex)!
    const row = mb.parseLatex(latex)
    expect(mb.toLatex(row)).toBe(e.tex)
    expect(mb.toLatex(row, mb.PLACEHOLDER)).toBe(e.texph)
  })
})

describe('overall size matches mathlayout.py with real Qt metrics', () => {
  it('stays within the stated tolerance', () => {
    const dev1000: number[] = []
    const dev20: number[] = []
    for (const e of golden.qt) {
      const row = mb.parseLatex(e.latex)
      for (const px of [1000, 20]) {
        const b = new Layout(px, e.display).layout(row)
        const [w, a, d] = e[String(px)]!
        const dev = Math.max(Math.abs(b.w - w), Math.abs(b.asc - a), Math.abs(b.desc - d))
        if (px === 1000) dev1000.push(dev / 1000)
        else dev20.push(dev)
      }
    }
    const p95 = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)]!
    expect(p95(dev1000)).toBeLessThanOrEqual(QT_P95_1000)
    expect(Math.max(...dev1000)).toBeLessThanOrEqual(QT_MAX_1000)
    expect(p95(dev20)).toBeLessThanOrEqual(QT_P95_20)
    expect(Math.max(...dev20)).toBeLessThanOrEqual(QT_MAX_20)
  })
})
