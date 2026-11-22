// Insert ▸ SmartArt: Word's diagram layouts (list, process, cycle,
// hierarchy, relationship, pyramid, matrix) drawn as a drawing's shapes,
// from text typed one item per line (Word's text pane; a tab or two
// spaces before a line puts it one level down).
import { makeBox, makeLine, makePolygon, makeText, newScene, pen, type Item, type Scene } from './paintModel.ts'
import { CHART_COLORS } from './chart.ts'

export type SmartArtKind = 'list' | 'process' | 'cycle' | 'hierarchy' | 'venn' | 'pyramid' | 'matrix'

export interface SmartNode { text: string; level: number }

export function parseSmartText(text: string): SmartNode[] {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const lead = /^[\t ]*/.exec(l)![0]
    const level = (lead.match(/\t/g)?.length ?? 0) + Math.floor(lead.replace(/\t/g, '').length / 2)
    return { text: l.trim().replace(/^[-•*]\s*/, ''), level }
  })
}

const colorOf = (k: number) => CHART_COLORS[k % 6]
const fill = (hex: string) => ({ color: `#ff${hex.slice(1).toLowerCase()}` })
const noPen = () => pen('#00000000', 0)

// A label centred on (x, y), wrapped to `w` px.
function label(s: string, x: number, y: number, w: number, size = 14, color = '#ffffffff', bold = false): Item[] {
  const per = Math.max(4, Math.floor(w / (size * 0.55)))
  const words = s.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const wd of words) {
    if ((cur + ' ' + wd).trim().length > per && cur) { lines.push(cur); cur = wd } else cur = (cur + ' ' + wd).trim()
  }
  if (cur) lines.push(cur)
  const lh = size * 1.25
  return lines.map((t, i) => makeText(t, {
    pos: { x: x - (t.length * size * 0.55) / 2, y: y - (lines.length * lh) / 2 + i * lh }, size, color, bold,
  }))
}

function box(x: number, y: number, w: number, h: number, k: number, round = true): Item {
  const it = makeBox(round ? 'roundrect' : 'rect', { x, y, w, h }, noPen(), fill(colorOf(k)))
  if (round) (it as { radius?: number }).radius = 10
  return it
}

function arrowRight(x: number, y: number, w = 26, h = 26): Item {
  return makePolygon('polygon', [[x, y - h / 4], [x + w * 0.55, y - h / 4], [x + w * 0.55, y - h / 2], [x + w, y],
    [x + w * 0.55, y + h / 2], [x + w * 0.55, y + h / 4], [x, y + h / 4]], noPen(), fill('#BFBFBF'))
}

export function smartArtScene(kind: SmartArtKind, nodes: SmartNode[]): Scene {
  const sc = newScene(760, 460)
  const items: Item[] = []
  const tops = nodes.filter((n) => n.level === 0)
  const n = Math.max(1, tops.length)
  // Each top item's sub-items (the lines indented under it).
  const subsOf: string[][] = []
  nodes.forEach((nd) => {
    if (nd.level === 0) subsOf.push([])
    else if (subsOf.length) subsOf[subsOf.length - 1].push(nd.text)
  })

  if (kind === 'list' || kind === 'process') {
    const gap = kind === 'process' ? 44 : 16
    const w = Math.min(200, (720 - gap * (n - 1)) / n), h = 110
    tops.forEach((t, k) => {
      const x = 20 + k * (w + gap)
      items.push(box(x, 60, w, h, k))
      items.push(...label(t.text, x + w / 2, 60 + h / 2, w - 16, 16, '#ffffffff', true))
      if (subsOf[k]?.length) {
        items.push(makeBox('rect', { x: x + 8, y: 60 + h, w: w - 16, h: 26 * subsOf[k].length + 12 }, pen('#ffbfbfbf', 1), fill('#F2F2F2')))
        subsOf[k].forEach((s, i) => items.push(...label('• ' + s, x + w / 2, 60 + h + 20 + i * 26, w - 24, 12, '#ff404040')))
      }
      if (kind === 'process' && k < n - 1) items.push(arrowRight(x + w + 8, 60 + h / 2, gap - 16, 30))
    })
  } else if (kind === 'cycle') {
    const cx = 380, cy = 230, R = 160, r = 52
    tops.forEach((t, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a)
      items.push(makeBox('ellipse', { x: x - r, y: y - r, w: 2 * r, h: 2 * r }, noPen(), fill(colorOf(k))))
      items.push(...label(t.text, x, y, 2 * r - 14, 13, '#ffffffff', true))
      // A curved arrow to the next one, as a few segments with a head.
      const a1 = a + (Math.PI / n) * 0.45, a2 = a + ((2 * Math.PI) / n) - (Math.PI / n) * 0.45
      const steps = 8
      for (let i = 0; i < steps; i++) {
        const b0 = a1 + ((a2 - a1) * i) / steps, b1 = a1 + ((a2 - a1) * (i + 1)) / steps
        const seg = makeLine(i === steps - 1 ? 'arrow' : 'line', cx + R * Math.cos(b0), cy + R * Math.sin(b0), cx + R * Math.cos(b1), cy + R * Math.sin(b1), pen('#ffa6a6a6', 3))
        items.push(seg)
      }
    })
  } else if (kind === 'hierarchy') {
    // A tree: each level a row, children under their parent.
    type T = { text: string; kids: T[] }
    const root: T = { text: '', kids: [] }
    const stack: T[] = [root]
    for (const nd of nodes) {
      const t: T = { text: nd.text, kids: [] }
      while (stack.length > nd.level + 1) stack.pop()
      stack[stack.length - 1].kids.push(t)
      stack.push(t)
    }
    const leaves = (t: T): number => (t.kids.length ? t.kids.reduce((a, c) => a + leaves(c), 0) : 1)
    const total = leaves(root)
    const W = Math.min(150, 720 / total - 12), H = 60, rowH = 110
    const place = (t: T, depth: number, x0: number): number => {
      const span = leaves(t) * (720 / total)
      const cx = x0 + span / 2
      if (depth >= 0) {
        items.push(box(cx - W / 2, 30 + depth * rowH, W, H, depth))
        items.push(...label(t.text, cx, 30 + depth * rowH + H / 2, W - 10, 13, '#ffffffff', true))
      }
      let x = x0
      for (const c of t.kids) {
        const ccx = place(c, depth + 1, x)
        if (depth >= 0) {
          const yTop = 30 + depth * rowH + H, yBot = 30 + (depth + 1) * rowH, ym = (yTop + yBot) / 2
          items.push(makeLine('line', cx, yTop, cx, ym, pen('#ff7f7f7f', 1.5)))
          items.push(makeLine('line', cx, ym, ccx, ym, pen('#ff7f7f7f', 1.5)))
          items.push(makeLine('line', ccx, ym, ccx, yBot, pen('#ff7f7f7f', 1.5)))
        }
        x += leaves(c) * (720 / total)
      }
      return cx
    }
    place(root, -1, 20)
  } else if (kind === 'venn') {
    const cx = 380, cy = 220, R = n <= 1 ? 0 : n === 2 ? 75 : 85, r = 120
    tops.forEach((t, k) => {
      const a = -Math.PI / 2 + (2 * Math.PI * k) / n
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a)
      const c = makeBox('ellipse', { x: x - r, y: y - r, w: 2 * r, h: 2 * r }, noPen(), fill(colorOf(k)))
      c.opacity = 0.55
      items.push(c)
      items.push(...label(t.text, cx + (R + 45) * Math.cos(a), cy + (R + 45) * Math.sin(a), 120, 15, '#ff262626', true))
    })
  } else if (kind === 'pyramid') {
    const top = 30, H = 380, base = 560, cx = 380
    const h = H / n
    tops.forEach((t, k) => {
      const y0 = top + k * h, y1 = y0 + h - 4
      const w0 = (base * (k * h)) / H, w1 = (base * (k * h + h - 4)) / H
      items.push(makePolygon('polygon', [[cx - w0 / 2, y0], [cx + w0 / 2, y0], [cx + w1 / 2, y1], [cx - w1 / 2, y1]], noPen(), fill(colorOf(k))))
      items.push(...label(t.text, cx, (y0 + y1) / 2 + (k === 0 ? h * 0.15 : 0), Math.max(80, (w0 + w1) / 2 - 20), 14, '#ffffffff', true))
    })
  } else {
    // Matrix: four quadrants (the first four items).
    const quads = tops.slice(0, 4)
    quads.forEach((t, k) => {
      const x = 180 + (k % 2) * 205, y = 20 + Math.floor(k / 2) * 205
      items.push(box(x, y, 195, 195, k))
      items.push(...label(t.text, x + 97, y + 97, 170, 16, '#ffffffff', true))
    })
  }
  sc.items = items
  return sc
}
