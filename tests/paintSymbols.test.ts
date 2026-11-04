// The Python symbol libraries' own output (scripts/make_golden_drawing_symbols.py)
// is the specification: same spec dicts, same keys in the same order, same
// strings; numbers to 1e-9 relative (V8 and libm may differ in the last
// ulp of sin/cos/atan2/hypot).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SYMBOL_MODULES, type SymbolModule } from '../src/core/paintSymbols.ts'
import { bondPath, ATOMS, RING_SIDES, isAromatic, ringPolygon, wedgePolygon } from '../src/core/paintChemistry.ts'

interface SymCase { name: string; w: number; h: number; specs: unknown[] }
interface ModGolden {
  reference_mm: number
  sizes: Record<string, [number, number]>
  labels: Record<string, string>
  categories: [string, string[]][] | null
  cases: SymCase[]
}
interface Golden {
  page_px: number
  min_px: number
  other_size: [number, number]
  symbols: Record<string, ModGolden>
  chemistry: {
    atoms: string[]
    ring_sides: Record<string, number>
    bonds: { kind: string; p1: [number, number]; p2: [number, number]; gap: number; cmds: unknown[] }[]
    wedges: { p1: [number, number]; p2: [number, number]; gap: number; poly: unknown[] }[]
    rings: { kind: string; center: [number, number]; r: number; poly: unknown[]; aromatic: boolean }[]
  }
}

const golden: Golden = JSON.parse(
  readFileSync(new URL('./golden/drawing_symbols.json', import.meta.url), 'utf-8'),
)

// The first difference between `actual` and `expected` as a path, or null.
function diff(actual: unknown, expected: unknown, path = '$'): string | null {
  if (typeof expected === 'number') {
    if (typeof actual !== 'number') return `${path}: ${JSON.stringify(actual)} is not the number ${expected}`
    const tol = 1e-9 * Math.max(1, Math.abs(expected), Math.abs(actual))
    return Math.abs(actual - expected) <= tol ? null : `${path}: ${actual} != ${expected}`
  }
  if (typeof expected === 'string' || typeof expected === 'boolean' || expected === null) {
    return actual === expected ? null : `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: not an array`
    if (actual.length !== expected.length) return `${path}: length ${actual.length} != ${expected.length}`
    for (let i = 0; i < expected.length; i++) {
      const d = diff(actual[i], expected[i], `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return `${path}: not an object`
    const ka = Object.keys(actual)
    const ke = Object.keys(expected)
    if (ka.join(',') !== ke.join(',')) return `${path}: keys [${ka}] != [${ke}]`
    for (const k of ke) {
      const d = diff((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`)
      if (d) return d
    }
    return null
  }
  return `${path}: unexpected golden value ${JSON.stringify(expected)}`
}

// PaintScene._place_symbol's size, on the authoring scene's 900 px page.
function placedSize(mod: SymbolModule, name: string): [number, number] {
  const [w_mm, h_mm] = mod.sizeMm(name)
  const scale = (golden.page_px || 1) / mod.REFERENCE_MM
  let w = w_mm * scale
  let h = h_mm * scale
  if (Math.max(w, h) > 0 && Math.max(w, h) < golden.min_px) {
    const k = golden.min_px / Math.max(w, h)
    w = w * k
    h = h * k
  }
  return [w, h]
}

const modules = SYMBOL_MODULES as Record<string, SymbolModule>

describe('symbol libraries', () => {
  it('cover the same libraries in the same order', () => {
    expect(Object.keys(modules)).toEqual(Object.keys(golden.symbols))
    for (const [lib, mod] of Object.entries(modules)) expect(mod.NAME).toBe(lib)
  })

  describe.each(Object.keys(golden.symbols))('%s', (lib) => {
    const g = golden.symbols[lib]
    const mod = modules[lib]

    it('metadata', () => {
      expect(mod.REFERENCE_MM).toBe(g.reference_mm)
      expect(diff(mod.SIZES, g.sizes)).toBeNull()
      expect(diff(mod.LABELS, g.labels)).toBeNull()
      expect(diff(mod.CATEGORIES ?? null, g.categories)).toBeNull()
    })

    it.each(g.cases.map((c, i) => [`${c.name} ${c.w}x${c.h}`, i] as const))('%s', (_label, i) => {
      const c = g.cases[i]
      const other = i % 2 === 1
      const [w, h] = other ? golden.other_size : placedSize(mod, c.name)
      expect(diff([w, h], [c.w, c.h])).toBeNull()
      expect(diff(mod.buildSpecs(c.name, c.w, c.h), c.specs)).toBeNull()
    })

    it('unknown names raise like a KeyError', () => {
      expect(() => mod.buildSpecs('no_such_symbol', 10, 10)).toThrow()
      expect(() => mod.sizeMm('no_such_symbol')).toThrow()
    })
  })
})

describe('chemistry geometry', () => {
  const ch = golden.chemistry
  const P = (p: [number, number]) => ({ x: p[0], y: p[1] })

  it('atoms and ring sides', () => {
    expect(ATOMS).toEqual(ch.atoms)
    expect(diff(RING_SIDES, ch.ring_sides)).toBeNull()
  })

  it.each(ch.bonds.map((b, i) => [`${b.kind} ${b.p1}->${b.p2} gap ${b.gap}`, i] as const))('bond %s', (_l, i) => {
    const b = ch.bonds[i]
    expect(diff(bondPath(b.kind, P(b.p1), P(b.p2), b.gap), b.cmds)).toBeNull()
  })

  it('wedges', () => {
    for (const wdg of ch.wedges) expect(diff(wedgePolygon(P(wdg.p1), P(wdg.p2), wdg.gap), wdg.poly)).toBeNull()
  })

  it('rings', () => {
    for (const r of ch.rings) {
      expect(diff(ringPolygon(r.kind, P(r.center), r.r), r.poly)).toBeNull()
      expect(isAromatic(r.kind)).toBe(r.aromatic)
    }
  })
})
