// The flowchart model and the builder's editor geometry against what the
// Python app writes (scripts/make_golden_drawing.py): the same .flow.json,
// TikZ and standalone document byte for byte, the same Tidy-up layout,
// and the same box rectangles, arrow points and box-text HTML.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  autoLayout, colours, Flowchart, KINDS, makeNode, SCHEMES, setNum, standaloneDoc, swapAxes,
  TEMPLATES, toTikz, type Edge, type Node,
} from '../src/core/flowchart.ts'
import { boxGeom, edgePoints, prettyInlineHtml } from '../src/drawing/flowGeometry.ts'
import { naturalWidthFromPdf } from '../src/core/drawingFiles.ts'

type Op = unknown[]
interface Chart { ops: Op[]; json: string; tikz: string; standalone: string; tidy: string; colours: Record<string, [string, string]> }
interface Golden {
  charts: Record<string, Chart>
  geometry: Record<string, { nodes: Record<string, { pos: [number, number]; rect: [number, number, number, number] }>; edges: ([number, number][] | null)[] }>
  html: Record<string, string>
  natural_width: Record<string, string>
  kinds: Record<string, [string, string]>
  schemes: Record<string, Record<string, [string, string]>>
}

const golden: Golden = JSON.parse(readFileSync(new URL('./golden/flowchart.json', import.meta.url), 'utf-8'))

// [value, is_float] as the script writes a Python number.
const isNum = (v: unknown): v is [number, boolean] =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'boolean'

function setField(obj: object, key: string, v: unknown): void {
  if (isNum(v)) setNum(obj as Record<string, number>, key, v[0], v[1])
  else (obj as Record<string, unknown>)[key] = v
}

function runOps(ops: Op[]): Flowchart {
  let fc = new Flowchart()
  for (const op of ops) {
    const [kind, ...args] = op as [string, ...unknown[]]
    switch (kind) {
      case 'new': {
        fc = new Flowchart()
        for (const [k, v] of Object.entries(args[0] as Record<string, unknown>)) setField(fc, k, v)
        break
      }
      case 'template': fc = TEMPLATES[args[0] as string](); break
      case 'add': fc.add(args[0] as string, args[1] as string, args[2] as string | null, args[3] as string); break
      case 'node': {
        const [id, k, text, x, y, fill] = args as [string, string, string, [number, boolean], [number, boolean], string]
        fc.nodes.push(makeNode(id, k, text, x[0], y[0], fill, { x: x[1], y: y[1] }))
        break
      }
      case 'connect': fc.connect(args[0] as string, args[1] as string, args[2] as string); break
      case 'remove': fc.remove(args[0] as string); break
      case 'edge': setField(fc.edges[args[0] as number] as Edge, args[1] as string, args[2]); break
      case 'nodefield': setField(fc.node(args[0] as string) as Node, args[1] as string, args[2]); break
      case 'chart': setField(fc, args[0] as string, args[1]); break
      case 'layout': autoLayout(fc); break
      case 'swap': swapAxes(fc); break
      case 'load': fc = Flowchart.fromJson(args[0] as string); break
      case 'roundtrip': fc = Flowchart.fromJson(fc.toJson()); break
      default: throw new Error(kind)
    }
  }
  return fc
}

describe('flowchart model parity', () => {
  it('has the same shapes and schemes', () => {
    expect(KINDS).toEqual(golden.kinds)
    expect(SCHEMES).toEqual(golden.schemes)
  })
  for (const [name, c] of Object.entries(golden.charts)) {
    it(name, () => {
      const fc = runOps(c.ops)
      expect(fc.toJson()).toBe(c.json)
      expect(toTikz(fc)).toBe(c.tikz)
      expect(standaloneDoc(fc)).toBe(c.standalone)
      expect(colours(fc)).toEqual(c.colours)
      const tidy = Flowchart.fromJson(fc.toJson())
      autoLayout(tidy)
      expect(tidy.toJson()).toBe(c.tidy)
    })
  }
})

describe('flowchart builder geometry parity', () => {
  for (const [name, g] of Object.entries(golden.geometry)) {
    it(name, () => {
      const fc = Flowchart.fromJson(golden.charts[name].json)
      const boxes = new Map(fc.nodes.map(n => [n.id, boxGeom(n)]))
      for (const n of fc.nodes) {
        const b = boxes.get(n.id)!
        const want = g.nodes[n.id]
        expect([b.pos.x, b.pos.y]).toEqual(want.pos)
        expect([b.rect.x, b.rect.y, b.rect.w, b.rect.h]).toEqual(want.rect)
      }
      fc.edges.forEach((e, i) => {
        const a = boxes.get(e.src)
        const b = boxes.get(e.dst)
        const want = g.edges[i]
        if (!a || !b) { expect(want).toBeNull(); return }
        const pts = edgePoints(e, a, b, fc.direction)
        expect(pts.length).toBe(want!.length)
        pts.forEach((p, j) => {
          expect(p.x).toBeCloseTo(want![j][0], 9)
          expect(p.y).toBeCloseTo(want![j][1], 9)
        })
      })
    })
  }
})

describe('flowchart box text and files parity', () => {
  it('renders box text as the Python editor does', () => {
    for (const [src, html] of Object.entries(golden.html)) expect(prettyInlineHtml(src)).toBe(html)
  })
  it('picks the natural width of a compiled chart', () => {
    for (const [w, want] of Object.entries(golden.natural_width)) {
      const pdf = new TextEncoder().encode(`%PDF-1.7\n1 0 obj\n<< /Type /Page /MediaBox [0 0 ${w} 200] >>\nendobj\n`)
      expect(naturalWidthFromPdf(pdf)).toBe(want)
    }
  })
})
