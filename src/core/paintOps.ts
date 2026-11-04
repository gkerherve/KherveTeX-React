// What the drawing scene does to its items (PaintScene in
// khervedoc/paint/canvas.py, shape specs in specs.py): build an item from
// a shape spec, drop a library symbol, chemistry rings and atoms, the
// protractor's measured angle, rooms, grouping, ungrouping, exploding,
// mirroring, re-stacking and duplicating. Plain functions over the Scene
// data, so the dialog and the tests share them.
import {
  addEllipse, ARC_KINDS, boundingRect, brushFor, centerOrigin, color, colorArgb, common, gridSize,
  itemToParent, makeBox, makeGroup, makeLine, makePath, makePolygon, makeText, mapCmd, mapPt, matMul,
  NO_PEN, outlinePath, polygonForKind, POLYGON_KINDS, rectCenter, sceneBoundingRect, textBounds,
  vectorItems, APP_FONT_FAMILY, IDENTITY, curvePath, isLine,
  type BrushDict, type Cmd, type GroupItem, type Item, type Mat, type PenDict, type Pt,
  type Rect, type Scene,
} from './paintModel.ts'
import { itemFromDict, itemToDict } from './paintSvg.ts'
import { bondPath, isAromatic, ringPolygon, wedgePolygon } from './paintChemistry.ts'
import type { SymbolModule, SymbolSpec } from './paintSymbols.ts'
import { pyFixed } from './py.ts'

const ALIASES: Record<string, string> = {
  rectangle: 'rect', rounded_rectangle: 'rounded_rect', block_arrow: 'arrow_right',
  half_circle: 'halfcircle', quarter_circle: 'quartercircle',
}

function specPen(spec: SymbolSpec): PenDict {
  const c = spec.stroke ?? '#1a1a1a'
  if (!c || String(c).toLowerCase() === 'none') return { ...NO_PEN }
  return { color: colorArgb(color(String(c))), width: Number(spec.width ?? 2) }
}

function specBrush(spec: SymbolSpec): BrushDict {
  const fill = spec.fill
  const grad = (spec as Record<string, unknown>).gradient ?? (fill && typeof fill === 'object' ? fill : undefined)
  if (grad && typeof grad === 'object') {
    const g = grad as Record<string, unknown>
    return brushFor(String(g.kind ?? 'linear'), String(g.c1 ?? '#ff4aa3ff'), String(g.c2 ?? '#ffffffff'), Number(g.angle ?? 90))
  }
  if (!fill || String(fill).toLowerCase() === 'none') return null
  return { color: colorArgb(color(String(fill))) }
}

// specs._spec_to_item: a shape-spec dict as a canvas item (or null).
export function specToItem(spec: SymbolSpec): Item | null {
  let shape = String(spec.shape ?? '').toLowerCase().replaceAll('-', '_')
  shape = ALIASES[shape] ?? shape
  const x = Number(spec.x ?? 0)
  const y = Number(spec.y ?? 0)
  const w = Number(spec.w ?? spec.width_px ?? 80)
  const h = Number(spec.h ?? spec.height_px ?? 60)
  const rect = { x, y, w, h }
  let it: Item
  if (shape === 'line' || shape === 'arrow') {
    it = makeLine(shape === 'arrow' ? 'arrow' : 'line', Number(spec.x1 ?? x), Number(spec.y1 ?? y),
      Number(spec.x2 ?? x + w), Number(spec.y2 ?? y), specPen(spec))
  } else if (shape === 'text') {
    const t = makeText(String(spec.text ?? 'Text'), {
      color: colorArgb(color(String(spec.color ?? spec.stroke ?? '#1a1a1a'))),
      family: APP_FONT_FAMILY, size: Math.max(1.0, Number(spec.size ?? 14)),
    })
    if (String(spec.anchor ?? '').toLowerCase() === 'center') {
      const br = textBounds(t)
      t.pos = { x: x - br.w / 2.0, y: y - br.h / 2.0 }
    } else {
      t.pos = { x, y }
    }
    centerOrigin(t)
    if (spec.rotation) t.rotation = Number(spec.rotation)
    return t
  } else if (shape === 'rect' || shape === 'circle' || shape === 'ellipse') {
    it = makeBox(shape === 'rect' ? 'rect' : 'ellipse', rect, specPen(spec), specBrush(spec))
  } else if (shape === 'rounded_rect') {
    it = makeBox('roundrect', rect, specPen(spec), specBrush(spec))
    it.radius = Number(spec.radius ?? 12)
  } else if (ARC_KINDS.includes(shape)) {
    it = makeBox('arc', rect, specPen(spec), specBrush(spec))
    it.kind = shape
  } else if (shape === 'polygon' && (spec as Record<string, unknown>).points) {
    const pts = (spec as Record<string, unknown>).points as number[][]
    it = makePolygon('polygon', pts.map(p => [Number(p[0]), Number(p[1])]), specPen(spec), specBrush(spec))
  } else if (POLYGON_KINDS.includes(shape)) {
    it = makePolygon(shape, polygonForKind(shape, rect), specPen(spec), specBrush(spec))
  } else {
    return null
  }
  const label = spec.label
  if (label && it.type !== 'line' && it.type !== 'arrow') (it as { label?: string }).label = String(label)
  centerOrigin(it)
  if (spec.rotation) it.rotation = Number(spec.rotation)
  if (spec.opacity !== undefined && spec.opacity !== null) it.opacity = Math.max(0.0, Math.min(1.0, Number(spec.opacity)))
  return it
}

const moveBy = (it: Item, dx: number, dy: number) => { it.pos = { x: it.pos.x + dx, y: it.pos.y + dy } }

// The next z on top of everything (a new item added to a QGraphicsScene
// keeps z 0, and stacks by insertion order; ours keeps that order too).
function add(s: Scene, it: Item): void {
  s.items.push(it)
}

// _drop_items: place items (positioned within a w × h box) centred on
// `center`, grouping them if there is more than one; the top-level item.
export function dropItems(s: Scene, items: Item[], center: Pt, w: number, h: number): Item {
  const dx = center.x - w / 2
  const dy = center.y - h / 2
  if (items.length === 1) {
    const top = items[0]
    moveBy(top, dx, dy)
    add(s, top)
    centerOrigin(top)
    return top
  }
  const top = makeGroup()
  top._origin = { x: 0, y: 0 }
  items.forEach((it, z) => {
    moveBy(it, dx, dy)
    it.z = z
    top.children.push(it)
  })
  add(s, top)
  centerOrigin(top)
  return top
}

// _place_symbol: symbols are sized as a fraction of the page (the page
// width represents the module's REFERENCE_MM), never below `minPx`.
export function placeSymbol(s: Scene, mod: SymbolModule, name: string, center: Pt,
  pagePx = 900, minPx = 90): Item | null {
  const [wMm, hMm] = mod.sizeMm(name)
  const scale = (pagePx || 1) / mod.REFERENCE_MM
  let w = wMm * scale
  let h = hMm * scale
  if (max(w, h) > 0 && max(w, h) < minPx) {
    const k = minPx / max(w, h)
    w *= k
    h *= k
  }
  const items = mod.buildSpecs(name, w, h).map(specToItem).filter((x): x is Item => x !== null)
  if (!items.length) return null
  const top = dropItems(s, items, center, w, h)
  top.symbol = `${mod.NAME}:${name}`
  return top
}
const max = Math.max

// ------------------------------------------------------------ chemistry
export function chemGap(pen: PenDict): number {
  return Math.max(3.0, pen.width * 2.0 + 2.0)
}

// _chem_constrain: the bond end at the fixed bond length, snapped to 30°.
export function chemConstrain(s: Scene, start: Pt, p: Pt, bondMm = 6.0): Pt {
  const dx = p.x - start.x
  const dy = p.y - start.y
  if (dx === 0 && dy === 0) return { ...start }
  const step = 30 * Math.PI / 180
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  const length = bondMm / 25.4 * s.dpi
  return { x: start.x + length * Math.cos(ang), y: start.y + length * Math.sin(ang) }
}

export function chemBond(kind: string, p1: Pt, p2: Pt, pen: PenDict): Item {
  if (kind === 'wedge') {
    const it = makePolygon('polygon', wedgePolygon(p1, p2, chemGap(pen)).map(q => [q.x, q.y]),
      { color: pen.color, width: 1 }, { color: pen.color })
    return it
  }
  return makePath(bondPath(kind, p1, p2, chemGap(pen)) as Cmd[], { ...pen }, null)
}

export function placeChemRing(s: Scene, kind: string, center: Pt, pen: PenDict, brush: BrushDict): Item {
  const r = 6.0 / 25.4 * s.dpi
  const poly = ringPolygon(kind, center, r)
  const ring = makePolygon(kind === 'cyclopentane' ? 'pentagon' : 'hexagon', poly.map(q => [q.x, q.y]), { ...pen }, brush)
  if (isAromatic(kind)) {
    const ir = r * 0.55
    const circle = makeBox('ellipse', { x: center.x - ir, y: center.y - ir, w: 2 * ir, h: 2 * ir }, { ...pen }, null)
    const grp = makeGroup([ring, circle])
    ring.z = 0
    circle.z = 1
    add(s, grp)
    centerOrigin(grp)
    return grp
  }
  add(s, ring)
  centerOrigin(ring)
  return ring
}

// The nearest bond end to `p` within `tol`, so an atom label snaps onto it.
function nearestBondEnd(s: Scene, p: Pt, tol: number): Pt | null {
  let best: Pt | null = null
  let bestD = tol
  for (const it of vectorItems(s)) {
    let pts: Pt[] = []
    const m = itemToParent(it)
    if (isLine(it)) pts = [mapPt(m, { x: it.x1, y: it.y1 }), mapPt(m, { x: it.x2, y: it.y2 })]
    else if (it.type === 'path') {
      pts = it.cmds.flatMap(c => (c[0] === 'C' ? [{ x: c[1], y: c[2] }, { x: c[3], y: c[4] }, { x: c[5], y: c[6] }]
        : [{ x: c[1], y: c[2] }])).map(q => mapPt(m, q))
    }
    for (const q of pts) {
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < bestD) { best = q; bestD = d }
    }
  }
  return best
}

export function placeChemAtom(s: Scene, text: string, center: Pt, pen: PenDict, bondMm = 6.0): Item {
  const tol = bondMm / 25.4 * s.dpi * 0.4
  const anchor = nearestBondEnd(s, center, tol)
  if (anchor) center = anchor
  const it = makeText(text || 'C', { color: pen.color })
  const c = rectCenter(textBounds(it))
  it.pos = { x: center.x - c.x, y: center.y - c.y }
  add(s, it)
  centerOrigin(it)
  return it
}

// ------------------------------------------------------------ protractor
// _finish_angle: the two arms, an arc through the smaller sweep and a
// degree label, grouped.
export function finishAngle(s: Scene, v: Pt, a: Pt, b: Pt, pen: PenDict): Item | null {
  const aa = Math.atan2(a.y - v.y, a.x - v.x)
  const ab = Math.atan2(b.y - v.y, b.x - v.x)
  const la = Math.hypot(a.x - v.x, a.y - v.y)
  const lb = Math.hypot(b.x - v.x, b.y - v.y)
  if (la < 1 || lb < 1) return null
  let delta = ab - aa
  while (delta <= -Math.PI) delta += 2 * Math.PI
  while (delta > Math.PI) delta -= 2 * Math.PI
  const deg = Math.abs(delta * 180 / Math.PI)
  let r = Math.min(la, lb) * 0.4
  r = Math.max(Math.min(r, 60.0), 12.0)
  const items: Item[] = [a, b].map(end => makeLine('line', v.x, v.y, end.x, end.y, { ...pen }))
  const steps = Math.max(Math.trunc(Math.abs(delta) / (Math.PI / 36)) + 1, 2)
  const arc: Cmd[] = []
  for (let i = 0; i <= steps; i++) {
    const ang = aa + delta * i / steps
    arc.push([i === 0 ? 'M' : 'L', v.x + r * Math.cos(ang), v.y + r * Math.sin(ang)])
  }
  items.push(makePath(arc, { ...pen }, null))
  const mid = aa + delta / 2.0
  const lp = { x: v.x + (r + 14) * Math.cos(mid), y: v.y + (r + 14) * Math.sin(mid) }
  const label = makeText(`${pyFixed(deg, 1)}°`, { color: pen.color })
  const lb2 = textBounds(label)
  label.pos = { x: lp.x - lb2.w / 2.0, y: lp.y - lb2.h / 2.0 }
  items.push(label)
  const grp = makeGroup()
  items.forEach((it, z) => { it.z = z; it._origin = { x: 0, y: 0 }; grp.children.push(it) })
  add(s, grp)
  centerOrigin(grp)
  return grp
}

// _finish_room: four solid wall bars with hollow corner squares.
export function finishRoom(s: Scene, rect: Rect): Item | null {
  if (rect.w < 2 || rect.h < 2) return null
  const { x, y, w, h } = rect
  const t = Math.max(Math.min(w, h) * 0.02, 2.0)
  const parts: Item[] = []
  for (const r of [{ x: x + t, y, w: w - 2 * t, h: t }, { x: x + t, y: y + h - t, w: w - 2 * t, h: t },
    { x, y: y + t, w: t, h: h - 2 * t }, { x: x + w - t, y: y + t, w: t, h: h - 2 * t }]) {
    parts.push(makeBox('rect', r, { color: '#ff222222', width: 1 }, { color: '#ff222222' }))
  }
  for (const r of [{ x, y, w: t, h: t }, { x: x + w - t, y, w: t, h: t }, { x, y: y + h - t, w: t, h: t },
    { x: x + w - t, y: y + h - t, w: t, h: t }]) {
    parts.push(makeBox('rect', r, { color: '#ff333333', width: 2 }, null))
  }
  const grp = makeGroup()
  parts.forEach((it, z) => { it.z = z; it._origin = { x: 0, y: 0 }; grp.children.push(it) })
  add(s, grp)
  centerOrigin(grp)
  return grp
}

// ------------------------------------------------------------ editing
export function removeItems(s: Scene, items: Item[]): void {
  s.items = s.items.filter(it => !items.includes(it))
}

// group_selection: children keep their stacking order and get sequential z.
export function groupItems(s: Scene, selected: Item[]): GroupItem | null {
  if (selected.length < 2) return null
  const ordered = vectorItems(s).filter(it => selected.includes(it))
  const grp = makeGroup()
  grp._origin = { x: 0, y: 0 }
  ordered.forEach((it, z) => { it.z = z; grp.children.push(it) })
  const at = Math.min(...ordered.map(it => s.items.indexOf(it)))
  removeItems(s, ordered)
  s.items.splice(at, 0, grp)
  return grp
}

// ungroup_selection: the children back at the top level, where they were.
export function ungroupItems(s: Scene, groups: GroupItem[]): Item[] {
  const freed: Item[] = []
  for (const g of groups) {
    const gm = itemToParent(g)
    const at = s.items.indexOf(g)
    if (at < 0) continue
    const kids = g.children.map(c => {
      const pure = gm[0] === 1 && gm[1] === 0 && gm[2] === 0 && gm[3] === 1
      if (pure) {
        c.pos = { x: c.pos.x + gm[4], y: c.pos.y + gm[5] }
      } else {
        // bake the group's rotation / scale into the child's transform
        const full: Mat = matMul(itemToParent(c), gm)
        c.matrix = [full[0], full[1], full[2], full[3], full[4], full[5]]
        c.pos = { x: 0, y: 0 }
        c.rotation = 0
        c.scale = 1
        c._origin = { x: 0, y: 0 }
      }
      c.z = g.z
      return c
    })
    s.items.splice(at, 1, ...kids)
    freed.push(...kids)
  }
  return freed
}

// _explode_item: a shape's outline as separate edge segments, in scene
// coordinates (lines for straight edges, paths for curved ones).
export function explodeItem(it: Item): Item[] | null {
  const local = it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc'
    || it.type === 'polygon' || it.type === 'path' ? outlinePath(it) : null
  if (!local || local.length < 2) return null
  const m = itemToParent(it)
  const path = local.map(c => mapCmd(c, m))
  const pen = { ...(it as { pen: PenDict }).pen }
  const segs: Item[] = []
  let cur: Pt | null = null
  for (const c of path) {
    if (c[0] === 'M') cur = { x: c[1], y: c[2] }
    else if (c[0] === 'L') {
      if (cur) segs.push(Object.assign(makeLine('line', cur.x, cur.y, c[1], c[2], { ...pen }), { _origin: { x: 0, y: 0 } }))
      cur = { x: c[1], y: c[2] }
    } else {
      segs.push(Object.assign(makePath([['M', cur!.x, cur!.y], c], { ...pen }, null), { _origin: { x: 0, y: 0 } }))
      cur = { x: c[5], y: c[6] }
    }
  }
  return segs
}

export function explodeItems(s: Scene, items: Item[]): Item[] {
  const created: Item[] = []
  for (const it of items) {
    const segs = explodeItem(it)
    if (!segs) continue
    removeItems(s, [it])
    created.push(...segs)
  }
  s.items.push(...created)
  return created
}

function flipMat(c: Pt, horizontal: boolean): Mat {
  const sx = horizontal ? -1 : 1
  const sy = horizontal ? 1 : -1
  return [sx, 0, 0, sy, c.x - sx * c.x, c.y - sy * c.y]
}

// _mirror_item: flip in place about the item's own centre.
export function mirrorItem(it: Item, horizontal: boolean): void {
  if (it.type === 'group') {
    const centre = rectCenter(boundingRect(it))
    for (const ch of it.children) {
      mirrorItem(ch, horizontal)
      const cc = mapPt(itemToParent(ch), rectCenter(boundingRect(ch)))
      if (horizontal) moveBy(ch, 2 * (centre.x - cc.x), 0)
      else moveBy(ch, 0, 2 * (centre.y - cc.y))
    }
    return
  }
  if (it.type === 'arc') {
    if (horizontal) it.flipH = !it.flipH
    else it.flipV = !it.flipV
    return
  }
  if (it.type === 'image') {
    const m = it.matrix ?? [1, 0, 0, 1, 0, 0]
    const w = it._w ?? 0
    const h = it._h ?? 0
    it.matrix = horizontal ? matMul([-1, 0, 0, 1, w, 0], m as Mat) : matMul([1, 0, 0, -1, 0, h], m as Mat)
    return
  }
  const t = flipMat(rectCenter(boundingRect(it)), horizontal)
  if (it.type === 'polygon') it.points = it.points.map(([x, y]) => { const q = mapPt(t, { x, y }); return [q.x, q.y] })
  else if (isLine(it)) {
    const a = mapPt(t, { x: it.x1, y: it.y1 })
    const b = mapPt(t, { x: it.x2, y: it.y2 })
    Object.assign(it, { x1: a.x, y1: a.y, x2: b.x, y2: b.y })
    if (it.bend) { const q = mapPt(t, { x: it.bend[0], y: it.bend[1] }); it.bend = [q.x, q.y] }
  } else if (it.type === 'path') it.cmds = it.cmds.map(c => mapCmd(c, t))
}

// _reorder: front / back / forward / backward for one selected item.
export function reorder(s: Scene, item: Item, where: string): boolean {
  const stack = vectorItems(s)
  if (!stack.includes(item) || stack.length < 2) return false
  stack.forEach((it, i) => { it.z = i })
  const i = stack.indexOf(item)
  const n = stack.length
  if (where === 'front') item.z = n
  else if (where === 'back') item.z = -1
  else if (where === 'forward' && i < n - 1) { item.z = i + 1; stack[i + 1].z = i }
  else if (where === 'backward' && i > 0) { item.z = i - 1; stack[i - 1].z = i }
  else return false
  return true
}

// _spawn: copies of items moved by `offset` (duplicate / paste).
export function spawn(s: Scene, dicts: Record<string, unknown>[], offset: number): Item[] {
  const created = dicts.map(d => {
    const it = itemFromDict(structuredClone(d))
    moveBy(it, offset, offset)
    return it
  })
  s.items.push(...created)
  return created
}

export const copyDicts = (items: Item[]): Record<string, unknown>[] => items.map(itemToDict)

// fit_to_content: the page shrunk to the drawing (± margin), content moved
// to sit `margin` from the top-left.
export function fitToContent(s: Scene, items: Item[] | null = null, margin = 10): void {
  const chosen = items && items.length ? items : vectorItems(s)
  let r: Rect | null = null
  for (const it of chosen) {
    const b = sceneBoundingRect(it)
    r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x),
      h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b
  }
  if (!r || r.w <= 0 || r.h <= 0) return
  const dx = Math.round(margin - r.x)
  const dy = Math.round(margin - r.y)
  for (const it of vectorItems(s)) moveBy(it, dx, dy)
  s.width = Math.ceil(r.w) + 2 * margin
  s.height = Math.ceil(r.h) + 2 * margin
}

// PaintScene._shape_rect: the drag rect; the circle tool stays square.
export function shapeRect(start: Pt, p: Pt, circle: boolean): Rect {
  let dx = p.x - start.x
  let dy = p.y - start.y
  if (circle) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    dx = dx >= 0 ? side : -side
    dy = dy >= 0 ? side : -side
  }
  return { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), w: Math.abs(dx), h: Math.abs(dy) }
}

// Apply a dragged rect to a rect-defined item (_apply_rect).
export function applyRect(it: Item, r: Rect): void {
  if (it.type === 'polygon') it.points = polygonForKind(it.kind, r)
  else if (it.type === 'rect' || it.type === 'ellipse' || it.type === 'roundrect' || it.type === 'arc') {
    Object.assign(it, { x: r.x, y: r.y, w: r.w, h: r.h })
  }
}

export function snapPt(s: Scene, p: Pt): Pt {
  const g = gridSize(s)
  return { x: Math.floor(p.x / g + 0.5) * g, y: Math.floor(p.y / g + 0.5) * g }
}

export { common, addEllipse, IDENTITY, curvePath }
