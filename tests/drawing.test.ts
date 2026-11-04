// Ported from ../KherveTeX/tests/test_drawing.py and test_drawing_dialog.py
// (same test names where the Python test is about the engine rather than
// Qt mouse events): Figure.source for drawings, the SVG round trip, the
// three output files, legacy JSON drawings, grouping / duplicating, the
// symbol and chemistry tools.
import { describe, expect, it } from 'vitest'
import { drawingSourceFor, nextDrawingPath } from '../src/core/drawingFiles.ts'
import { document, figure, fromJson, toJson } from '../src/core/model.ts'
import {
  brushFor, centerOrigin, contentRect, DIAMOND, HEXAGON, makeBox, makeLine, makeText, newScene, pen,
  polygonForKind, sceneBoundingRect, vectorItems, type Item, type Scene,
} from '../src/core/paintModel.ts'
import {
  copyDicts, explodeItems, finishAngle, groupItems, placeChemRing, placeSymbol, removeItems, spawn, specToItem,
  ungroupItems,
} from '../src/core/paintOps.ts'
import { sceneToPdf } from '../src/core/paintPdf.ts'
import { loadLegacyJson, loadSvg, saveSvg } from '../src/core/paintSvg.ts'
import { SYMBOL_MODULES } from '../src/core/paintSymbols.ts'
import { serializeBlock } from '../src/core/serializer.ts'
import { serializeBlock as typstBlock } from '../src/core/typstSerializer.ts'

describe('Figure.source for drawings', () => {
  it('test_figure_source_round_trips', () => {
    const doc = document([figure({ path: 'images/drawing_001.png', caption: 'c', source: 'drawing' })])
    expect((fromJson(toJson(doc)).children[0] as { source: string }).source).toBe('drawing')
  })
  it('test_latex_uses_pdf_for_drawings', () => {
    expect(serializeBlock(figure({ path: 'images\\drawing_001.png', source: 'drawing' }))).toContain('{images/drawing_001.pdf}')
  })
  it('test_latex_keeps_plain_figures_unchanged', () => {
    expect(serializeBlock(figure({ path: 'images/photo.png' }))).toContain('{images/photo.png}')
  })
  it('test_typst_uses_svg_for_drawings', () => {
    expect(typstBlock(figure({ path: 'images/drawing_001.png', source: 'drawing' }))).toContain('image("images/drawing_001.svg"')
  })
})

function populate(s: Scene): Item[] {
  const r = makeBox('roundrect', { x: 10, y: 20, w: 120, h: 60 }, pen(), brushFor('linear', '#ffffff', '#1a6dd8', 90))
  r.radius = 10
  const a = makeLine('arrow', 140, 50, 260, 50, pen('#d8000c', 3, 'dash'))
  a.head = 'double'
  const hex = { type: 'polygon' as const, pen: pen(), brush: null, kind: HEXAGON,
    points: polygonForKind(HEXAGON, { x: 280, y: 10, w: 90, h: 80 }), pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1 }
  const dim = makeLine('dimension', 10, 120, 130, 120)
  const t = makeText('Label')
  t.pos = { x: 30, y: 150 }
  const items: Item[] = [r, a, hex, dim, t]
  for (const it of items) { centerOrigin(it); s.items.push(it) }
  placeSymbol(s, SYMBOL_MODULES.flowchart, 'process', { x: 200, y: 200 })
  return items
}

describe('the drawing engine', () => {
  it('test_svg_round_trip_preserves_items', () => {
    const s = newScene(900, 600)
    populate(s)
    const before = vectorItems(s)
    const after = vectorItems(loadSvg(saveSvg(s)))
    expect(after.map(i => i.type)).toEqual(before.map(i => i.type))
    before.forEach((x, i) => {
      if (x.type === 'text' || x.type === 'group') return     // font-metric boxes
      const bx = sceneBoundingRect(x)
      const by = sceneBoundingRect(after[i])
      for (const [u, v] of [[bx.x, by.x], [bx.y, by.y], [bx.w, by.w], [bx.h, by.h]]) expect(Math.abs(u - v)).toBeLessThan(1.5)
    })
    const arrow = after[1] as { head: string; pen: { dash?: string } }
    expect(arrow.head).toBe('double')
    expect(arrow.pen.dash).toBe('dash')
    expect('gradient' in ((after[0] as { brush: object }).brush)).toBe(true)
    expect((after[4] as { text: string }).text).toBe('Label')
  })

  it('test_save_drawing_writes_svg_pdf_png', () => {
    const s = newScene(900, 600)
    populate(s)
    const rect = contentRect(s)
    expect(rect.w).toBeGreaterThan(0)
    const pdf = sceneToPdf(s, rect)
    expect(new TextDecoder('latin1').decode(pdf.slice(0, 5))).toBe('%PDF-')
    // The blank raster page is not embedded in the editable SVG.
    expect(saveSvg(s)).not.toContain('<image')
  })

  it('test_empty_drawing_saves_nothing', () => {
    const r = contentRect(newScene())
    expect(r.w <= 0 || r.h <= 0).toBe(true)
  })

  it('test_legacy_json_drawing_loads', async () => {
    const files = new Set(['/x/drawing_001.png', '/x/drawing_001.json'])
    expect(await drawingSourceFor('/x/drawing_001.png', async p => files.has(p))).toBe('/x/drawing_001.json')
    const legacy = { version: 1, items: [
      { type: 'rect', x: 10, y: 10, w: 50, h: 40, color: '#000000', width: 2 },
      { type: 'ellipse', x: 70, y: 10, w: 50, h: 40, color: '#1a6dd8', width: 2 },
      { type: 'line', x1: 0, y1: 0, x2: 30, y2: 30, color: '#000000', width: 2 },
      { type: 'text', x: 5, y: 60, text: 'hi', color: '#000000', font_size: 12 },
      { type: 'arrow', color: '#000000', width: 2, elements: [
        { t: 'M', x: 0, y: 100 }, { t: 'L', x: 80, y: 100 }, { t: 'M', x: 80, y: 100 }, { t: 'L', x: 72, y: 96 }] },
      { type: 'path', color: '#000000', width: 2, elements: [{ t: 'M', x: 0, y: 0 }, { t: 'L', x: 5, y: 8 }] },
    ] }
    const s = newScene(900, 600)
    loadLegacyJson(s, legacy)
    expect(vectorItems(s).map(i => i.type)).toEqual(['rect', 'ellipse', 'line', 'text', 'arrow', 'path'])
    // once saved, the SVG is the source
    files.add('/x/drawing_001.svg')
    expect(await drawingSourceFor('/x/drawing_001.png', async p => files.has(p))).toBe('/x/drawing_001.svg')
    expect(await nextDrawingPath('/x', async p => files.has(p))).toBe('/x/drawing_002.png')
  })

  it('test_group_copy_paste_delete', () => {
    const s = newScene(900, 600)
    s.items.push(makeBox('rect', { x: 50, y: 50, w: 100, h: 100 }), makeBox('ellipse', { x: 200, y: 50, w: 100, h: 100 }))
    const g = groupItems(s, vectorItems(s))!
    expect(vectorItems(s).map(i => i.type)).toEqual(['group'])
    const copies = spawn(s, copyDicts([g]), 20)
    expect(vectorItems(s).length).toBe(2)
    removeItems(s, copies)
    expect(vectorItems(s).length).toBe(1)
    const freed = ungroupItems(s, [g])
    expect(freed.map(i => i.type)).toEqual(['rect', 'ellipse'])
    expect(sceneBoundingRect(freed[0]).x).toBe(49)
  })

  it('test_symbol_and_text_tools', () => {
    const s = newScene(900, 600)
    placeSymbol(s, SYMBOL_MODULES.flowchart, 'decision', { x: 300, y: 300 })
    placeSymbol(s, SYMBOL_MODULES.electrical, 'resistor', { x: 100, y: 300 })
    s.items.push(makeText('Text'))
    const kinds = vectorItems(s).map(i => i.type)
    expect(kinds.filter(k => k === 'group').length).toBe(2)
    expect(kinds).toContain('text')
    expect(vectorItems(s)[0].symbol).toBe('flowchart:decision')
  })

  it('test_bucket_eraser_protractor', () => {
    const s = newScene(900, 600)
    const g = finishAngle(s, { x: 400, y: 300 }, { x: 500, y: 300 }, { x: 400, y: 200 }, pen())
    expect(g?.type).toBe('group')
    const label = (g as { children: Item[] }).children.find(c => c.type === 'text') as { text: string }
    expect(label.text).toBe('90.0°')
    placeChemRing(s, 'benzene', { x: 100, y: 100 }, pen(), null)
    expect(vectorItems(s)[1].type).toBe('group')
  })

  it('explodes a shape into its edges', () => {
    const s = newScene(900, 600)
    s.items.push({ type: 'polygon', pen: pen(), brush: null, kind: DIAMOND, points: polygonForKind(DIAMOND, { x: 0, y: 0, w: 40, h: 40 }),
      pos: { x: 0, y: 0 }, opacity: 1, rotation: 0, z: 0, scale: 1 })
    const segs = explodeItems(s, vectorItems(s))
    expect(segs.map(i => i.type)).toEqual(['line', 'line', 'line', 'line'])
  })

  it('builds items from shape specs', () => {
    expect(specToItem({ shape: 'rounded_rectangle', x: 1, y: 2, w: 3, h: 4, radius: 1 })?.type).toBe('roundrect')
    expect(specToItem({ shape: 'half-circle', x: 1, y: 2, w: 3, h: 4 })?.type).toBe('arc')
    expect(specToItem({ shape: 'unknown' })).toBeNull()
  })
})
