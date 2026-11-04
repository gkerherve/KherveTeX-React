// The drawing engine against the Python one (scripts/make_golden_drawing.py):
// scenes built from the same .kpaint item dicts save to the same SVG bytes,
// load back to the same items, and have the same bounding boxes; the
// parametric shapes and Qt's arc / ellipse / rounded-rect paths match.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addEllipse, addRoundedRect, arcMoveTo, arcPath, arcTo, contentRect, newScene, polygonForKind,
  sceneBoundingRect, vectorItems, type Cmd,
} from '../src/core/paintModel.ts'
import { itemFromDict, itemToDict, loadSvg, saveSvg } from '../src/core/paintSvg.ts'

interface SceneCase {
  items: Record<string, unknown>[]
  grid: [number, boolean, boolean, boolean]
  svg: string
  reloaded: Record<string, unknown>[]
  reloaded_svg: string
  content_rect: number[] | null
  bounds: (number[] | null)[]
}
interface Golden {
  scenes: Record<string, SceneCase>
  geometry: { polygons: Record<string, number[][]>; arcs: Record<string, Cmd[]>; paths: Record<string, Cmd[]> }
}
const golden: Golden = JSON.parse(readFileSync(new URL('./golden/drawing.json', import.meta.url), 'utf-8'))

function close(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number')
    const tol = 1e-9 * Math.max(1, Math.abs(expected))
    if (Math.abs((actual as number) - expected) > tol) expect(actual, path).toBe(expected)
    return
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true)
    expect((actual as unknown[]).length, path).toBe(expected.length)
    expected.forEach((e, i) => close((actual as unknown[])[i], e, `${path}[${i}]`))
    return
  }
  if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object), path).toEqual(Object.keys(expected))
    for (const [k, v] of Object.entries(expected)) close((actual as Record<string, unknown>)[k], v, `${path}.${k}`)
    return
  }
  expect(actual, path).toEqual(expected)
}

// Qt sizes a stroked polygon / path by its QPainterPathStroker outline,
// whose round joins and offset curves stick out a fraction of a pixel past
// the pen's half width; the port adds the half width. That moves a
// labelled polygon's label by < 0.2 px and a path's box by < 2.5 px.
const STROKER_SLACK: Record<string, number> = { polygon: 0.2, path: 2.5 }
const LOOSE_SVG: Record<string, number> = { labels: 0.2 }

// The same SVG text, numbers within `tol`.
function svgClose(a: string, b: string, tol: number): void {
  const num = /-?\d+(?:\.\d+)?(?:e[-+]\d+)?/g
  expect(a.replace(num, '#')).toBe(b.replace(num, '#'))
  const na = a.match(num) ?? []
  const nb = b.match(num) ?? []
  na.forEach((x, i) => expect(Math.abs(Number(x) - Number(nb[i]))).toBeLessThanOrEqual(tol))
}

function build(c: SceneCase) {
  const s = newScene(900, 600)
  ;[s.gridMm, s.showGrid, s.snap, s.infinite] = c.grid
  for (const d of c.items) s.items.push(itemFromDict(structuredClone(d)))
  return s
}

describe('drawing SVG parity', () => {
  for (const [name, c] of Object.entries(golden.scenes)) {
    const loose = LOOSE_SVG[name.split(' ')[0]]
    it(`${name} saves the same SVG`, () => {
      if (loose) svgClose(saveSvg(build(c)), c.svg, loose)
      else expect(saveSvg(build(c))).toBe(c.svg)
    })
    it(`${name} loads back to the same items`, () => {
      const back = loadSvg(c.svg)
      close(vectorItems(back).map(itemToDict), c.reloaded)
      if (loose) svgClose(saveSvg(back), c.reloaded_svg, loose)
      else expect(saveSvg(back)).toBe(c.reloaded_svg)
    })
    it(`${name} has the same bounds`, () => {
      const s = build(c)
      vectorItems(s).forEach((it, i) => {
        const want = c.bounds[i]
        if (want === null) return
        const r = sceneBoundingRect(it)
        const slack = STROKER_SLACK[it.type]
        if (slack) [r.x, r.y, r.w, r.h].forEach((v, k) => expect(Math.abs(v - want[k])).toBeLessThanOrEqual(slack))
        else close([r.x, r.y, r.w, r.h], want)
      })
      if (c.content_rect) {
        const r = contentRect(s)
        const slack = Math.max(0, ...vectorItems(s).map(it => STROKER_SLACK[it.type] ?? 0))
        const want = c.content_rect
        if (slack) [r.x, r.y, r.w, r.h].forEach((v, k) => expect(Math.abs(v - want[k])).toBeLessThanOrEqual(slack))
        else close([r.x, r.y, r.w, r.h], want)
      }
    })
  }
})

describe('drawing geometry parity', () => {
  it('inscribes the parametric polygons as Qt does', () => {
    for (const [key, pts] of Object.entries(golden.geometry.polygons)) {
      const [kind, ...rest] = key.split(' ')
      const r = JSON.parse(rest.join(' ').replace('(', '[').replace(')', ']')) as number[]
      close(polygonForKind(kind, { x: r[0], y: r[1], w: r[2], h: r[3] }), pts, key)
    }
  })
  it('draws half and quarter discs with Qt arcs', () => {
    for (const [key, cmds] of Object.entries(golden.geometry.arcs)) {
      const m = /^(\w+) \(([^)]*)\) (True|False) (True|False)$/.exec(key)!
      const r = m[2].split(',').map(Number)
      close(arcPath(m[1], { x: r[0], y: r[1], w: r[2], h: r[3] }, m[3] === 'True', m[4] === 'True'), cmds, key)
    }
  })
  it('builds ellipses, rounded rects and arcs as QPainterPath does', () => {
    for (const [key, cmds] of Object.entries(golden.geometry.paths)) {
      let got: Cmd[]
      const m = /^(\w+) (?:\(([^)]*)\))?\s*(.*)$/.exec(key)!
      if (m[1] === 'ellipse') {
        const r = m[2].split(',').map(Number)
        got = addEllipse([], { x: r[0], y: r[1], w: r[2], h: r[3] })
      } else if (m[1] === 'roundrect') {
        const r = m[2].split(',').map(Number)
        const rad = Math.min(Number(m[3]), r[2] / 2, r[3] / 2)
        got = addRoundedRect([], { x: r[0], y: r[1], w: r[2], h: r[3] }, rad, rad)
      } else {
        const [sa, sw] = key.split(' ').slice(1).map(Number)
        const rect = { x: 5, y: 5, w: 14, h: 14 }
        got = arcTo(arcMoveTo([], rect, sa), rect, sa, sw)
      }
      close(got, cmds, key)
    }
  })
})
