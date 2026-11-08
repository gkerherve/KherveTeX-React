// Page check, part 2 (dev only; nothing in the app imports this): does the
// page view show each document as its PDF does? Run scripts/page_check.mjs
// first, then in the app at http://localhost:5174:
//
//   const { pageCheck } = await import('/src/dev/pageCheck.ts')
//   await pageCheck()            // or pageCheck('ex-thesis')
//
// For each compiled document it opens the document as the gallery does,
// lets the page view lay it out, hands it the PDF's page anchors as a
// compile does, and compares sheet by sheet:
//
//   sheets      the page view's sheet count with no PDF yet, and with it
//   cont        sheets the page view needed beyond the PDF's pages
//               ("N (cont.)": a page that ran out of room before the PDF's)
//   overflow    PDF pages whose last line the page view put on a later sheet
//   unresolved  PDF pages whose first line the page view could not find
//   fill        how full each sheet is against its PDF page (body height %)
//   furniture   header and footer text that differs from the PDF's
import { EXAMPLES } from '../core/examples.ts'
import { templateSampleDocument } from '../core/compiler.ts'
import type { Document } from '../core/model.ts'
import { openPdfSource, type PdfTextDict } from '../core/pdfText.ts'
import { firstTextSnippet, pageAnchors } from '../app/pageAnchors.ts'
import { replaceDoc } from '../app/store.ts'
import { anchorTargets, type PageGeometry } from '../editor/layout.ts'
import type { EditorView } from 'prosemirror-view'

interface IndexEntry { id: string; kind: 'example' | 'class'; label: string; cls: string; pdf: string | null }

interface Ctl {
  view: EditorView
  layout: { geometry: PageGeometry }
  sheets: number
  flowEl: HTMLElement
  overlayEl: HTMLElement
  setPageAnchors(anchors: [number, string][], furniture?: unknown): void
  heldAnchors(): [number, string][]
}

export interface PageReport {
  id: string
  cls: string
  pdfPages: number
  sheetsNatural: number
  sheets: number
  cont: number
  overflow: number[]
  unresolved: number[]
  // The candidate first lines of each unresolved page.
  missing: string[]
  fill: { page: number; pdf: number; view: number }[]
  furniture: { page: number; where: 'header' | 'footer'; pdf: string; view: string }[]
  ok: boolean
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function ctl(): Ctl {
  const el = document.querySelector('.kt-pages') as (HTMLElement & { __ktCtl?: Ctl }) | null
  if (!el?.__ktCtl) throw new Error('No page view (open the Visual tab)')
  return el.__ktCtl
}

// Until the sheet count and the spacers stop changing.
async function settle(maxMs = 10000): Promise<void> {
  let last = ''
  let same = 0
  const t0 = performance.now()
  while (performance.now() - t0 < maxMs) {
    await sleep(120)
    const c = ctl()
    const key = `${c.sheets}|${c.flowEl.querySelectorAll('.kt-page-gap').length}|${c.overlayEl.innerHTML.length}`
    if (key === last) { if (++same >= 5) return } else { same = 0; last = key }
  }
}

const norm = (s: string) => s.normalize('NFKD').replace(/\p{Mn}/gu, '').replace(/[\s ]+/g, ' ').trim().toLowerCase()

interface PLine { text: string; y0: number; y1: number; size: number }

function pdfLines(page: PdfTextDict): PLine[] {
  const out: PLine[] = []
  for (const b of page.blocks) {
    if (b.type !== 0) continue
    for (const l of b.lines) {
      const text = l.spans.map(s => s.text).join('')
      if (!text.trim()) continue
      out.push({ text, y0: l.bbox[1], y1: l.bbox[3], size: Math.max(...l.spans.map(s => s.size)) })
    }
  }
  return out.sort((a, b) => a.y0 - b.y0)
}

function docFor(e: IndexEntry): Document {
  if (e.kind === 'class') return templateSampleDocument(e.cls)
  const f = EXAMPLES.find(([label]) => label === e.label)
  if (!f) throw new Error(`no example ${e.label}`)
  return f[1]()
}

// Furniture painted on each sheet, as [header, footer] text.
function viewFurniture(c: Ctl, sheets: number): [string, string][] {
  const g = c.layout.geometry
  const out: [string[], string[]][] = Array.from({ length: sheets }, () => [[], []])
  for (const el of c.overlayEl.querySelectorAll<HTMLElement>('.kt-fur')) {
    const top = parseFloat(el.style.top)
    const k = Math.floor(top / g.heightPx)
    if (!out[k]) continue
    const inSheet = top - k * g.heightPx
    const t = el.textContent ?? ''
    if (!t.trim()) continue
    ;(inSheet < g.heightPx / 2 ? out[k][0] : out[k][1]).push(t)
  }
  return out.map(([h, f]) => [norm(h.join(' ')), norm(f.join(' '))])
}

// Bottom of the last line of flow text on each sheet, as a fraction of the
// body height.
function viewFill(c: Ctl, sheets: number): number[] {
  const g = c.layout.geometry
  const H = g.heightPx
  const origin = c.flowEl.getBoundingClientRect().top
  const z = (() => { const r = c.flowEl.getBoundingClientRect(); return c.flowEl.offsetWidth ? r.width / c.flowEl.offsetWidth : 1 })()
  const range = document.createRange()
  const rects: DOMRect[] = []
  // Text only: a range over elements would add their boxes (the spacers).
  const walk = document.createTreeWalker(c.view.dom, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent?.trim()) continue
    range.selectNodeContents(n)
    rects.push(...range.getClientRects())
  }
  const fill = Array.from({ length: sheets }, () => 0)
  for (const r of rects) {
    if (r.height <= 0 || r.width <= 0) continue
    const top = (r.top - origin) / z
    const bottom = (r.bottom - origin) / z
    const k = Math.floor(top / H)
    if (k < 0 || k >= sheets) continue
    const f = (bottom - (k * H + g.topPx)) / (H - g.topPx - g.bottomPx)
    fill[k] = Math.max(fill[k], f)
  }
  return fill
}

function sheetOfPos(c: Ctl, pos: number): number {
  const origin = c.flowEl.getBoundingClientRect().top
  const r = c.flowEl.getBoundingClientRect()
  const z = c.flowEl.offsetWidth ? r.width / c.flowEl.offsetWidth : 1
  const y = (c.view.coordsAtPos(Math.min(pos, c.view.state.doc.content.size)).top - origin) / z
  return Math.floor(y / c.layout.geometry.heightPx)
}

export async function checkOne(e: IndexEntry): Promise<PageReport> {
  replaceDoc(docFor(e), { path: null, dirty: false })
  await sleep(300)
  await settle()
  const c0 = ctl()
  const sheetsNatural = c0.sheets
  const bytes = new Uint8Array(await (await fetch(`/.pagecheck/${e.pdf}`)).arrayBuffer())
  const [count, anchors, furn] = await pageAnchors(bytes)
  ctl().setPageAnchors(anchors, furn)
  await settle()
  const c = ctl()
  const g = c.layout.geometry
  const topF = g.topPx / g.heightPx
  const botF = g.bottomPx / g.heightPx

  // The PDF, page by page: header, footer, body lines.
  const src = await openPdfSource(bytes)
  const pages: { header: string; footer: string; first: string; last: string; fill: number }[] = []
  try {
    for (let i = 0; i < src.pageCount; i++) {
      const d = await src.textDict(i)
      const lines = pdfLines(d)
      const bodyTop = topF * d.height
      const bodyBottom = (1 - botF) * d.height
      const header = lines.filter(l => l.y1 <= bodyTop + 1)
      const footer = lines.filter(l => l.y0 >= bodyBottom - 1)
      const body = lines.filter(l => !header.includes(l) && !footer.includes(l))
      const sizes = body.map(l => Math.round(l.size * 2) / 2)
      const mode = sizes.sort((a, b) => sizes.filter(v => v === b).length - sizes.filter(v => v === a).length)[0] ?? 10
      // Footnotes (smaller type at the foot) are painted apart in the view.
      const main = body.filter(l => l.size >= mode * 0.85 || l.y0 < bodyTop + (bodyBottom - bodyTop) * 0.7)
      const lastLine = main[main.length - 1]
      const one = (l: PLine | undefined) => l ? firstTextSnippet({ width: d.width, height: d.height,
        blocks: [{ type: 0, bbox: [0, 0, 0, 0], lines: [{ bbox: [0, 0, 0, 0], spans: [{ text: l.text, size: l.size, flags: 0, font: '', bbox: [0, 0, 0, 0] }] }] }] }) : ''
      pages.push({
        header: norm(header.map(l => l.text).join(' ')),
        footer: norm(footer.map(l => l.text).join(' ')),
        first: one(main[0]), last: one(lastLine),
        fill: lastLine ? (lastLine.y1 - bodyTop) / (bodyBottom - bodyTop) : 0,
      })
    }
  } finally {
    await src.close()
  }

  // Where each PDF page's first and last lines are in the page view.
  // Page starts as the app resolves them (every candidate line), last
  // lines probed after each.
  // As the page view holds them (running heads dropped).
  const held = c.heldAnchors()
  const starts = new Map(anchorTargets(c.view.state.doc, held).map(t => [t.page, t]))
  const probes: [number, string][] = []
  pages.forEach((p, i) => {
    const a = anchors.find(([n]) => n === i + 1)
    probes.push([(i + 1) * 2, a ? a[1] : p.first])
    probes.push([(i + 1) * 2 + 1, p.last])
  })
  const found = new Map(anchorTargets(c.view.state.doc, probes).map(t => [t.page, t]))
  for (const [page, t] of starts) found.set(page * 2, t)
  const labels = [...c.overlayEl.querySelectorAll('.kt-cont')].length
  const sheetForPage: number[] = []
  const overflow: number[] = []
  const unresolved: number[] = []
  pages.forEach((p, i) => {
    const f = found.get((i + 1) * 2)
    const l = found.get((i + 1) * 2 + 1)
    if (i > 0 && held.some(([n, t]) => n === i + 1 && t) && !starts.has(i + 1)) unresolved.push(i + 1)
    const s0 = f ? sheetOfPos(c, f.pos + 1 + f.offset) : sheetForPage[i - 1] !== undefined ? sheetForPage[i - 1] + 1 : i
    sheetForPage.push(s0)
    if (l && p.last !== p.first) {
      const s1 = sheetOfPos(c, l.pos + 1 + l.offset)
      if (s1 > s0) overflow.push(i + 1)
    }
  })
  const vf = viewFill(c, c.sheets)
  const fur = viewFurniture(c, c.sheets)
  const fill: PageReport['fill'] = []
  const furniture: PageReport['furniture'] = []
  pages.forEach((p, i) => {
    const k = sheetForPage[i]
    if (k === undefined || k >= c.sheets) return
    // The fill of the PDF page's last sheet in the view (its cont. sheets
    // already counted as overflow).
    let kk = k
    while (kk + 1 < c.sheets && (i + 1 >= pages.length || sheetForPage[i + 1] > kk + 1)) kk++
    if (Math.abs(vf[k] - p.fill) > 0.08 && kk === k) fill.push({ page: i + 1, pdf: Math.round(p.fill * 100), view: Math.round(vf[k] * 100) })
    const [vh, vfo] = fur[k] ?? ['', '']
    const strip = (s: string) => s.replace(/\s/g, '')
    if (strip(vh) !== strip(p.header)) furniture.push({ page: i + 1, where: 'header', pdf: p.header, view: vh })
    if (strip(vfo) !== strip(p.footer)) furniture.push({ page: i + 1, where: 'footer', pdf: p.footer, view: vfo })
  })
  const report: PageReport = {
    id: e.id, cls: e.cls, pdfPages: count, sheetsNatural, sheets: c.sheets, cont: labels,
    overflow, unresolved, fill, furniture, ok: false,
    missing: unresolved.map(n => `${n}: ${(anchors.find(([k]) => k === n)?.[1] ?? '').replace(/\n/g, ' | ')}`),
  }
  report.ok = report.sheets === count && !labels && !overflow.length && !unresolved.length
    && !fill.length && !furniture.length
  return report
}

export async function pageCheck(filter?: string): Promise<PageReport[]> {
  const index: IndexEntry[] = await (await fetch('/.pagecheck/index.json')).json()
  const out: PageReport[] = []
  ;(window as unknown as { __pageCheck?: PageReport[] }).__pageCheck = out
  for (const e of index) {
    if (!e.pdf || (filter && !e.id.includes(filter))) continue
    try {
      out.push(await checkOne(e))
    } catch (exc) {
      console.warn(e.id, exc)
    }
  }
  ;(window as unknown as { __pageCheck?: PageReport[] }).__pageCheck = out
  return out
}
