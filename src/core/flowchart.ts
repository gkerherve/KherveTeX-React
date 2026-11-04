// Flowcharts for LaTeX — the model behind the flowchart builder.
// A port of khervedoc/flowchart.py.
//
// A Flowchart is a set of nodes (the classic flowchart shapes) on a grid
// and the arrows between them. toTikz writes it as a TikZ picture;
// standaloneDoc wraps that in a document the builder compiles for its live
// preview and for the document. There the chart is a Figure like a
// drawing: a PNG preview for the Visual tab, the vector PDF LaTeX
// includes, its source (.flow.json, reopened on double-click) and the TikZ
// itself (.tikz, to reuse in any LaTeX document), all side by side.
//
// No DOM here, so it is fully testable.

import { pyFixed, pyFloat, pyRound } from './py.ts'

// kind -> [label, TikZ shape options]
export const KINDS: Record<string, [string, string]> = {
  terminal: ['Start / end', 'rounded rectangle, minimum width=2.4cm'],
  process: ['Process', 'rectangle, minimum width=2.6cm'],
  decision: ['Decision', 'diamond, aspect=1.8, inner sep=1pt,'
    + ' minimum width=2.6cm'],
  io: ['Input / output', 'trapezium, trapezium left angle=72,'
    + ' trapezium right angle=108,'
    + ' minimum width=2.4cm'],
  document: ['Document', 'tape, tape bend top=none,'
    + ' minimum width=2.4cm'],
  database: ['Data', 'cylinder, shape border rotate=90, aspect=0.22,'
    + ' minimum width=2.2cm'],
  subprocess: ['Sub-process', 'rectangle, double, double distance=1.6pt,'
    + ' minimum width=2.6cm'],
  connector: ['Connector', 'circle, minimum size=0.8cm, inner sep=1pt'],
  note: ['Note', 'rectangle, dashed, minimum width=2.2cm'],
}

type Pair = [string, string]

// Colour schemes: kind -> [fill, text colour]; "line" is the arrows /
// outlines.
export const SCHEMES: Record<string, Record<string, Pair>> = {
  Blue: { terminal: ['#1F4E79', '#FFFFFF'], process: ['#DEEBF7', '#1A1A1A'],
    decision: ['#FCE4C4', '#1A1A1A'], io: ['#E2EFDA', '#1A1A1A'],
    line: ['#404040', ''] },
  Green: { terminal: ['#2E6B30', '#FFFFFF'], process: ['#E3EDE3', '#1A1A1A'],
    decision: ['#FFF2CC', '#1A1A1A'], io: ['#DDEBF7', '#1A1A1A'],
    line: ['#404040', ''] },
  Purple: { terminal: ['#500778', '#FFFFFF'], process: ['#EFE3F5', '#1A1A1A'],
    decision: ['#F8D7E3', '#1A1A1A'], io: ['#E0F0EF', '#1A1A1A'],
    line: ['#404040', ''] },
  Pastel: { terminal: ['#F4B6C2', '#1A1A1A'], process: ['#CDE7F0', '#1A1A1A'],
    decision: ['#FFF1B8', '#1A1A1A'], io: ['#D5F0D5', '#1A1A1A'],
    line: ['#555555', ''] },
  'Black & white': { terminal: ['#FFFFFF', '#000000'],
    process: ['#FFFFFF', '#000000'],
    decision: ['#FFFFFF', '#000000'],
    io: ['#FFFFFF', '#000000'], line: ['#000000', ''] },
}
export const SCHEME_NAMES = Object.keys(SCHEMES)
export const DEFAULT_SCHEME = 'Blue'

export interface Node {
  id: string
  kind: string
  text: string
  x: number          // grid position (columns), right is positive
  y: number          // grid position (rows), down is positive
  fill: string       // "" = from the colour scheme
}

export interface Edge {
  src: string
  dst: string
  label: string
  route: string      // auto | straight | elbow | curve
  dashed: boolean
  head: string       // arrowheads: end | start | both | none (a line)
  src_side: string   // where it leaves: auto | north | south | east | west
  dst_side: string   // where it arrives (same choices)
  bend: number       // curve: degrees, + bows to the left, - right
}

// ---- Python int / float ----
// The model's numbers print the way Python stores them: a grid position is
// a float ("x": 1.0, \fontsize{11.0} if a chart says so) unless it came
// from an int (a hand-written .flow.json, a chart from KherveSlide). The
// fields whose Python type differs from the dataclass default's are
// recorded here, per object.
const FLOAT_FIELDS = new Set(['x', 'y', 'col_cm', 'row_cm'])
const flipped = new WeakMap<object, Set<string>>()

function isFloat(obj: object, key: string): boolean {
  return FLOAT_FIELDS.has(key) !== (flipped.get(obj)?.has(key) ?? false)
}

function setKind(obj: object, key: string, float: boolean): void {
  let s = flipped.get(obj)
  if (float === FLOAT_FIELDS.has(key)) {
    s?.delete(key)
    return
  }
  if (!s) { s = new Set(); flipped.set(obj, s) }
  s.add(key)
}

// Assign a number keeping Python's type rules: `float` true for a float.
export function setNum<T extends object>(obj: T, key: keyof T & string, value: number, float: boolean): void {
  (obj as Record<string, unknown>)[key] = value
  setKind(obj, key, float)
}

export function numIsFloat(obj: object, key: string): boolean {
  return isFloat(obj, key)
}

// str() of a model number.
function numStr(obj: object, key: string, v: number): string {
  return isFloat(obj, key) ? pyFloat(v) : String(v)
}

export function makeNode(id: string, kind = 'process', text = '', x = 0, y = 0, fill = '',
  floats: { x?: boolean; y?: boolean } = {}): Node {
  const n: Node = { id, kind, text, x, y, fill }
  if (floats.x === false) setKind(n, 'x', false)
  if (floats.y === false) setKind(n, 'y', false)
  return n
}

export function makeEdge(src: string, dst: string, label = '', o: Partial<Edge> = {}): Edge {
  return { src, dst, label, route: 'auto', dashed: false, head: 'end', src_side: 'auto',
    dst_side: 'auto', bend: 30, ...o }
}

// Arrowhead choices: key -> [label, TikZ arrow spec].
export const HEADS: Record<string, [string, string]> = {
  end: ['→  Arrow', '->'], start: ['←  Reversed arrow', '<-'],
  both: ['↔  Both ends', '<->'], none: ['—  Line, no arrow', '-'],
}
// Sides of a box an arrow can leave from / arrive at.
export const SIDES: Record<string, string> = {
  auto: 'Automatic', north: 'Top', south: 'Bottom',
  east: 'Right', west: 'Left',
}
const _STUB: Record<string, string> = {
  north: '(0,0.35)', south: '(0,-0.35)', east: '(0.35,0)',
  west: '(-0.35,0)',
}

export class Flowchart {
  nodes: Node[] = []
  edges: Edge[] = []
  direction = 'TB'   // TB (top to bottom) | LR (left to right)
  scheme = DEFAULT_SCHEME
  font_pt = 11
  col_cm = 3.6       // grid spacing
  row_cm = 1.7

  constructor(o: Partial<Pick<Flowchart, 'direction' | 'scheme' | 'font_pt' | 'col_cm' | 'row_cm'>> = {}) {
    Object.assign(this, o)
  }

  // ---- editing helpers ----
  node(nid: string): Node | null {
    return this.nodes.find(n => n.id === nid) ?? null
  }

  newId(): string {
    const used = new Set(this.nodes.map(n => n.id))
    let i = 1
    while (used.has(`n${i}`)) i += 1
    return `n${i}`
  }

  // Add a node; `after` places it one step on from that node (down or
  // right, on a free spot) and connects the two.
  add(kind: string, text = '', after: string | null = null, label = ''): Node {
    let x = 0
    let y = 0
    let xf = true
    let yf = true
    const prev = after ? this.node(after) : null
    if (prev !== null) {
      const [dx, dy] = this.direction === 'TB' ? [0, 1] : [1, 0]
      x = prev.x + dx
      y = prev.y + dy
      xf = isFloat(prev, 'x')
      yf = isFloat(prev, 'y')
      while (this.nodes.some(n => Math.abs(n.x - x) < 0.5 && Math.abs(n.y - y) < 0.5)) {
        x = x + dy                       // sidestep
        y = y + dx
      }
    } else if (this.nodes.length) {
      const last = this.nodes[this.nodes.length - 1]
      xf = isFloat(last, 'x')
      yf = isFloat(last, 'y')
      if (this.direction === 'TB') { x = last.x; y = last.y + 1 } else { x = last.x + 1; y = last.y }
    }
    const n = makeNode(this.newId(), kind, text || KINDS[kind][0], x, y, '', { x: xf, y: yf })
    this.nodes.push(n)
    if (prev !== null) this.connect(prev.id, n.id, label)
    return n
  }

  connect(src: string, dst: string, label = ''): Edge | null {
    if (src === dst || this.node(src) === null || this.node(dst) === null) return null
    for (const e of this.edges) {
      if (e.src === src && e.dst === dst) return e
    }
    const e = makeEdge(src, dst, label)
    this.edges.push(e)
    return e
  }

  remove(nid: string): void {
    this.nodes = this.nodes.filter(n => n.id !== nid)
    this.edges = this.edges.filter(e => e.src !== nid && e.dst !== nid)
  }

  // ---- persistence ----
  // json.dumps(asdict(self), indent=2, ensure_ascii=False)
  toJson(): string {
    const lines: string[] = []
    const num = (obj: object, key: string, v: number) =>
      isFloat(obj, key) ? jsonFloat(v) : jsonNumber(v)
    const str = (s: string) => JSON.stringify(s)
    lines.push('{')
    if (this.nodes.length === 0) {
      lines.push('  "nodes": [],')
    } else {
      lines.push('  "nodes": [')
      this.nodes.forEach((n, i) => {
        lines.push('    {')
        lines.push(`      "id": ${str(n.id)},`)
        lines.push(`      "kind": ${str(n.kind)},`)
        lines.push(`      "text": ${str(n.text)},`)
        lines.push(`      "x": ${num(n, 'x', n.x)},`)
        lines.push(`      "y": ${num(n, 'y', n.y)},`)
        lines.push(`      "fill": ${str(n.fill)}`)
        lines.push('    }' + (i < this.nodes.length - 1 ? ',' : ''))
      })
      lines.push('  ],')
    }
    if (this.edges.length === 0) {
      lines.push('  "edges": [],')
    } else {
      lines.push('  "edges": [')
      this.edges.forEach((e, i) => {
        lines.push('    {')
        lines.push(`      "src": ${str(e.src)},`)
        lines.push(`      "dst": ${str(e.dst)},`)
        lines.push(`      "label": ${str(e.label)},`)
        lines.push(`      "route": ${str(e.route)},`)
        lines.push(`      "dashed": ${e.dashed ? 'true' : 'false'},`)
        lines.push(`      "head": ${str(e.head)},`)
        lines.push(`      "src_side": ${str(e.src_side)},`)
        lines.push(`      "dst_side": ${str(e.dst_side)},`)
        lines.push(`      "bend": ${num(e, 'bend', e.bend)}`)
        lines.push('    }' + (i < this.edges.length - 1 ? ',' : ''))
      })
      lines.push('  ],')
    }
    lines.push(`  "direction": ${str(this.direction)},`)
    lines.push(`  "scheme": ${str(this.scheme)},`)
    lines.push(`  "font_pt": ${num(this, 'font_pt', this.font_pt)},`)
    lines.push(`  "col_cm": ${num(this, 'col_cm', this.col_cm)},`)
    lines.push(`  "row_cm": ${num(this, 'row_cm', this.row_cm)}`)
    lines.push('}')
    return lines.join('\n')
  }

  static fromJson(text: string): Flowchart {
    const d = parsePyJson(text)
    if (d === null || typeof d !== 'object' || Array.isArray(d)) {
      throw new TypeError('not a flowchart')
    }
    const fc = new Flowchart()
    const rec = d as Record<string, unknown>
    for (const k of ['direction', 'scheme', 'font_pt', 'col_cm', 'row_cm'] as const) {
      if (k in rec) assignField(fc, k, rec[k])
    }
    const nodes = (rec.nodes ?? []) as unknown[]
    const edges = (rec.edges ?? []) as unknown[]
    fc.nodes = nodes.map(raw => {
      const r = raw as Record<string, unknown>
      if (!('id' in r)) throw new TypeError("Node() missing required argument: 'id'")
      const n = makeNode('')
      for (const [k, v] of Object.entries(r)) {
        if (!(k in n)) throw new TypeError(`Node() got an unexpected keyword argument '${k}'`)
        assignField(n, k, v)
      }
      return n
    })
    fc.edges = edges.map(raw => {
      const r = raw as Record<string, unknown>
      if (!('src' in r) || !('dst' in r)) throw new TypeError('Edge() missing required arguments')
      const e = makeEdge('', '')
      for (const [k, v] of Object.entries(r)) {
        if (!(k in e)) throw new TypeError(`Edge() got an unexpected keyword argument '${k}'`)
        assignField(e, k, v)
      }
      return e
    })
    return fc
  }

  // A deep copy (the undo history keeps JSON snapshots, so this is the
  // same as Flowchart.from_json(fc.to_json())).
  clone(): Flowchart {
    return Flowchart.fromJson(this.toJson())
  }
}

function assignField(obj: object, key: string, v: unknown): void {
  const o = obj as Record<string, unknown>
  if (v instanceof JsonNum) {
    o[key] = v.value
    setKind(obj, key, v.float)
  } else {
    o[key] = v
  }
}

function jsonFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity'
  return pyFloat(x)
}

function jsonNumber(x: number): string {
  return Number.isInteger(x) ? String(x) : jsonFloat(x)
}

// A JSON number that remembers whether Python reads it as a float.
class JsonNum {
  readonly value: number
  readonly float: boolean
  constructor(value: number, float: boolean) {
    this.value = value
    this.float = float
  }
}

// json.loads keeping int / float apart (a number with "." or an exponent
// is a float), so a chart prints back as Python would print it.
export function parsePyJson(text: string): unknown {
  let i = 0
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++ }
  const fail = (): never => { throw new SyntaxError(`invalid JSON at ${i}`) }
  const value = (): unknown => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const out: Record<string, unknown> = {}
      ws()
      if (text[i] === '}') { i++; return out }
      for (;;) {
        ws()
        if (text[i] !== '"') fail()
        const k = str()
        ws()
        if (text[i] !== ':') fail()
        i++
        out[k] = value()
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return out }
        fail()
      }
    }
    if (c === '[') {
      i++
      const out: unknown[] = []
      ws()
      if (text[i] === ']') { i++; return out }
      for (;;) {
        out.push(value())
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return out }
        fail()
      }
    }
    if (c === '"') return str()
    if (text.startsWith('true', i)) { i += 4; return true }
    if (text.startsWith('false', i)) { i += 5; return false }
    if (text.startsWith('null', i)) { i += 4; return null }
    if (text.startsWith('NaN', i)) { i += 3; return new JsonNum(NaN, true) }
    if (text.startsWith('Infinity', i)) { i += 8; return new JsonNum(Infinity, true) }
    if (text.startsWith('-Infinity', i)) { i += 9; return new JsonNum(-Infinity, true) }
    const m = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
    if (!m) return fail()
    i += m[0].length
    return new JsonNum(Number(m[0]), m[1] !== undefined || m[2] !== undefined)
  }
  const str = (): string => {
    const start = i
    i++
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i++
      i++
    }
    if (i >= text.length) fail()
    i++
    return JSON.parse(text.slice(start, i)) as string
  }
  const v = value()
  ws()
  if (i !== text.length) fail()
  return v
}

// ------------------------------------------------------------------ layout
// Tidy up: rank nodes by their longest path from a start node (back edges
// ignored), then spread each rank around the centre line.
export function autoLayout(fc: Flowchart): void {
  const ids = fc.nodes.map(n => n.id)
  if (!ids.length) return
  const out = new Map<string, string[]>(ids.map(i => [i, []]))
  const indeg = new Map<string, number>(ids.map(i => [i, 0]))
  for (const e of fc.edges) {
    if (out.has(e.src) && out.has(e.dst)) {
      out.get(e.src)!.push(e.dst)
      indeg.set(e.dst, indeg.get(e.dst)! + 1)
    }
  }
  let starts = ids.filter(i => indeg.get(i) === 0)
  if (!starts.length) starts = [ids[0]]
  const rank = new Map<string, number>(starts.map(i => [i, 0]))
  const order = [...starts]
  const seenEdges = new Set<string>()
  let k = 0
  while (k < order.length) {
    const u = order[k]
    k += 1
    for (const v of out.get(u)!) {
      const key = JSON.stringify([u, v])
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      if (!rank.has(v)) {
        rank.set(v, rank.get(u)! + 1)
        order.push(v)
      } else if (rank.get(v)! <= rank.get(u)! && !_ancestors(u, out).has(v)) {
        rank.set(v, rank.get(u)! + 1)
        order.push(v)
      }
    }
  }
  for (const i of ids) if (!rank.has(i)) rank.set(i, 0)
  const levels = new Map<number, string[]>()
  for (const i of ids) {
    const r = rank.get(i)!
    if (!levels.has(r)) levels.set(r, [])
    levels.get(r)!.push(i)
  }
  for (const [r, members] of levels) {
    members.forEach((nid, j) => {
      const off = j - (members.length - 1) / 2
      const n = fc.node(nid)!
      if (fc.direction === 'TB') {
        setNum(n, 'x', off, true)
        setNum(n, 'y', r, true)
      } else {
        setNum(n, 'x', r, true)
        setNum(n, 'y', off, true)
      }
    })
  }
}

// Nodes that can reach `u` (so an edge back to them is a loop).
function _ancestors(u: string, out: Map<string, string[]>): Set<string> {
  const rev = new Map<string, string[]>()
  for (const [a, bs] of out) {
    for (const b of bs) {
      if (!rev.has(b)) rev.set(b, [])
      rev.get(b)!.push(a)
    }
  }
  const seen = new Set<string>()
  const stack = [u]
  while (stack.length) {
    const x = stack.pop()!
    for (const p of rev.get(x) ?? []) {
      if (!seen.has(p)) {
        seen.add(p)
        stack.push(p)
      }
    }
  }
  return seen
}

// Swap the chart round (Direction: top to bottom <-> left to right).
export function swapAxes(fc: Flowchart): void {
  for (const n of fc.nodes) {
    const [x, y] = [n.x, n.y]
    const [xf, yf] = [isFloat(n, 'x'), isFloat(n, 'y')]
    setNum(n, 'x', y, yf)
    setNum(n, 'y', x, xf)
  }
}

// -------------------------------------------------------------------- TikZ
function _hex(h: string): string {
  return (h || '').replace(/^#+/, '').toUpperCase()
}

// kind -> [fill, text] for the chart's scheme. An unknown scheme — e.g.
// "Presentation colours" in a chart made in KherveSlide — falls back to
// the default one.
export function colours(fc: Flowchart): Record<string, Pair> {
  const base = SCHEMES[fc.scheme] ?? SCHEMES[DEFAULT_SCHEME]
  const out: Record<string, Pair> = {}
  for (const kind of Object.keys(KINDS)) {
    const fallback: Pair = ['subprocess', 'document', 'database'].includes(kind) ? base.process
      : (kind === 'connector' ? base.terminal : ['#FFFFFF', '#555555'])
    out[kind] = base[kind] ?? fallback
  }
  out.line = base.line
  return out
}

// The TikZ path between two nodes: straight when they line up, an elbow
// otherwise, and around the side for a loop back.
function _route(fc: Flowchart, e: Edge): string {
  const a = fc.node(e.src)!
  const b = fc.node(e.dst)!
  const lbl = _label(e)
  if (e.route === 'curve') return _curvedRoute(e, lbl)
  if (e.src_side !== 'auto' || e.dst_side !== 'auto') return _sidedRoute(e, lbl)
  if (e.route === 'straight' || Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) {
    if ((fc.direction === 'TB' && b.y < a.y && Math.abs(a.x - b.x) < 0.01)
      || (fc.direction === 'LR' && b.x < a.x && Math.abs(a.y - b.y) < 0.01)) {
      // loop back along the same line: go round the side (the left /
      // bottom, away from decision branches on the right)
      const side = fc.direction === 'TB' ? 'west' : 'south'
      const step = fc.direction === 'TB' ? '++(-1.9,0)' : '++(0,-1.3)'
      const turn = fc.direction === 'TB' ? '|-' : '-|'
      return `(${e.src}.${side}) -- ${step}${lbl} ${turn} (${e.dst}.${side})`
    }
    return `(${e.src}) --${lbl} (${e.dst})`
  }
  const firstAcross = fc.direction === 'TB' ? a.x !== b.x : a.y !== b.y
  const decision = a.kind === 'decision'
  let turn: string
  if (fc.direction === 'TB') turn = decision && firstAcross ? '-|' : '|-'
  else turn = decision && firstAcross ? '|-' : '-|'
  return `(${e.src}) ${turn}${lbl} (${e.dst})`
}

// A path that leaves / arrives at the chosen sides: a short stub out of
// the start side, then an elbow that comes into the end side head on (a
// top / bottom side is reached vertically, left / right horizontally).
function _sidedRoute(e: Edge, lbl: string): string {
  let start = `(${e.src})`
  if (e.src_side in _STUB) start = `(${e.src}.${e.src_side}) -- ++${_STUB[e.src_side]}`
  const end = e.dst_side in _STUB ? `(${e.dst}.${e.dst_side})` : `(${e.dst})`
  if (e.route === 'straight') return `${start} --${lbl} ${end}`
  let turn: string
  if (e.dst_side === 'north' || e.dst_side === 'south') turn = '-|'       // finish going up / down
  else if (e.dst_side === 'east' || e.dst_side === 'west') turn = '|-'    // finish going sideways
  else turn = e.src_side === 'east' || e.src_side === 'west' ? '|-' : '-|'
  return `${start} ${turn}${lbl} ${end}`
}

export const OUT_ANGLE: Record<string, number> = { east: 0, north: 90, west: 180, south: 270 }

// A curve: bowed by `bend` degrees (left when positive), or — when both
// sides are chosen — leaving the one side and arriving into the other head
// on (TikZ's out / in angles).
function _curvedRoute(e: Edge, lbl: string): string {
  const start = e.src_side in _STUB ? `(${e.src}.${e.src_side})` : `(${e.src})`
  const end = e.dst_side in _STUB ? `(${e.dst}.${e.dst_side})` : `(${e.dst})`
  let how: string
  if (e.src_side in _STUB && e.dst_side in _STUB) {
    how = `out=${OUT_ANGLE[e.src_side]}, in=${OUT_ANGLE[e.dst_side]}`
  } else if (e.bend === 0) {
    return `${start} --${lbl} ${end}`
  } else {
    how = e.bend > 0 ? `bend left=${numStr(e, 'bend', e.bend)}`
      : `bend right=${numStr(e, 'bend', -e.bend)}`
  }
  return `${start} to[${how}]${lbl} ${end}`
}

function _label(e: Edge): string {
  if (!e.label) return ''
  return ' node[pos=0.25, auto, font=\\sffamily\\footnotesize,'
    + ' inner sep=2pt, text width=]'
    + ` {${e.label}}`
}

// The flowchart as a TikZ picture (needs the shapes.geometric, shapes.misc,
// shapes.symbols and arrows.meta libraries).
export function toTikz(fc: Flowchart): string {
  const cols = colours(fc)
  const lines = ['\\begin{tikzpicture}[',
    `  font=\\sffamily\\fontsize{${numStr(fc, 'font_pt', fc.font_pt)}}`
    + `{${pyRound(fc.font_pt * 1.2, 0)}}\\selectfont,`,
    '  >={Stealth[length=2.4mm]},',
    '  every node/.style={align=center, minimum height=0.9cm,'
    + ' inner sep=4pt, text width=2.4cm},',
    '  line/.style={draw=fc-line, thick},',
    ']']
  const defs = [`\\definecolor{fc-line}{HTML}{${_hex(cols.line[0])}}`]
  for (const kind of Object.keys(KINDS)) {
    const [fill, text] = cols[kind]
    defs.push(`\\definecolor{fc-${kind}}{HTML}{${_hex(fill)}}`)
    defs.push(`\\definecolor{fc-${kind}-text}{HTML}`
      + `{${_hex(text)}}`)
  }
  const body: string[] = []
  for (const n of fc.nodes) {
    const shape = (KINDS[n.kind] ?? KINDS.process)[1]
    const width = n.kind !== 'connector' ? '' : ', text width=0.5cm'
    let fill = `fc-${n.kind}`
    if (n.fill) {
      defs.push(`\\definecolor{fc-${n.id}}{HTML}`
        + `{${_hex(n.fill)}}`)
      fill = `fc-${n.id}`
    }
    const x = n.x * fc.col_cm
    // -0.0 prints "-0.00", as Python's float does; an int 0 negates to 0.
    const y = (isFloat(n, 'y') || n.y !== 0 ? -n.y : 0) * fc.row_cm
    body.push(`  \\node[${shape}${width}, draw=fc-line, fill=${fill},`
      + ` text=fc-${n.kind}-text] (${n.id}) at (${pyFixed(x, 2)},${pyFixed(y, 2)})`
      + ` {${n.text}};`)
  }
  for (const e of fc.edges) {
    if (fc.node(e.src) === null || fc.node(e.dst) === null) continue
    const arrow = (HEADS[e.head] ?? HEADS.end)[1]
    const style = `line, ${arrow}` + (e.dashed ? ', dashed' : '')
    body.push(`  \\draw[${style}] ${_route(fc, e)};`)
  }
  return [...defs, ...lines, ...body, '\\end{tikzpicture}'].join('\n') + '\n'
}

export const TIKZ_LIBRARIES = ['shapes.geometric', 'shapes.misc', 'shapes.symbols',
  'arrows.meta']

// A cropped standalone document drawing the chart, in sans-serif Latin
// Modern.
export function standaloneDoc(fc: Flowchart): string {
  return [
    '\\documentclass[border=4pt]{standalone}',
    '\\usepackage{lmodern}',
    '\\usepackage{tikz}',
    `\\usetikzlibrary{${TIKZ_LIBRARIES.join(',')}}`,
    '\\begin{document}',
    toTikz(fc).replace(/\s+$/, ''),
    '\\end{document}', ''].join('\n')
}

// --------------------------------------------------------------- templates
function _chain(fc: Flowchart, steps: [string, string][]): void {
  let prev: Node | null = null
  for (const [kind, text] of steps) {
    prev = fc.add(kind, text, prev ? prev.id : null)
  }
}

export function templateSimple(): Flowchart {
  const fc = new Flowchart()
  _chain(fc, [['terminal', 'Start'], ['process', 'Collect data'],
    ['process', 'Analyse'], ['terminal', 'Report']])
  return fc
}

export function templateDecision(): Flowchart {
  const fc = new Flowchart()
  const start = fc.add('terminal', 'Start')
  const run = fc.add('process', 'Run the experiment', start.id)
  const check = fc.add('decision', 'Result valid?', run.id)
  fc.add('terminal', 'Publish', check.id, 'Yes')
  const fix = makeNode(fc.newId(), 'process', 'Adjust the setup', 1.3, check.y, '',
    { y: numIsFloat(check, 'y') })
  fc.nodes.push(fix)
  fc.connect(check.id, fix.id, 'No')
  fc.connect(fix.id, run.id)
  return fc
}

export function templateAlgorithm(): Flowchart {
  const fc = new Flowchart()
  const s = fc.add('terminal', 'Start')
  const i = fc.add('io', 'Read $n$', s.id)
  const init = fc.add('process', '$i \\leftarrow 1$, $s \\leftarrow 0$', i.id)
  const test = fc.add('decision', '$i \\le n$?', init.id)
  const body = fc.add('process', '$s \\leftarrow s + i$\\\\$i \\leftarrow i+1$', test.id, 'Yes')
  fc.connect(body.id, test.id)
  const out = makeNode(fc.newId(), 'io', 'Print $s$', 1.3, test.y, '', { y: numIsFloat(test, 'y') })
  fc.nodes.push(out)
  const end = makeNode(fc.newId(), 'terminal', 'End', 1.3, test.y + 1.4)
  fc.nodes.push(end)
  fc.connect(test.id, out.id, 'No')
  fc.connect(out.id, end.id)
  return fc
}

export function templatePipeline(): Flowchart {
  const fc = new Flowchart({ direction: 'LR', row_cm: 1.8, col_cm: 3.4 })
  _chain(fc, [['database', 'Raw data'], ['process', 'Clean'],
    ['subprocess', 'Model'], ['document', 'Report']])
  return fc
}

export const TEMPLATES: Record<string, () => Flowchart> = {
  'Simple process': templateSimple,
  'Decision with a loop': templateDecision,
  'Algorithm (sum to n)': templateAlgorithm,
  'Data pipeline (left to right)': templatePipeline,
}
