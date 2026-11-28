// How Insert ▸ Elements look on the page, drawn from their settings as
// the PDF draws them (core/widgets.ts): checklist, progress bars,
// timeline, QR code and code listing; and the inline margin notes and
// drop caps. The block's LaTeX is hidden under the drawing, as a table of
// contents' is (toc.ts); a click selects it, × removes it.
import qrcode from 'qrcode-generator'
import { type Drawing } from '../core/draw.ts'
import {
  bohrDrawing, circuitDrawing, elementTilesDrawing, feynmanDrawing, hazardDrawing, hazardLines, moDrawing, plotDrawing,
  type AlgorithmData, type BohrData, type CircuitData, type ElementTileData, type FeynmanData, type HazardData, type MoData,
  type NotebookData, type PlotData, type SchemeData, algorithmRows, notebookSections, parseNoteText,
} from '../core/science.ts'
import {
  riskDrawing, signsDrawing, forcesDrawing, opticsDrawing, waveDrawing, levelsDrawing, functionDrawing, numberLineDrawing, vennDrawing, triangleDrawing, statsDrawing, unitCircleDrawing,
} from '../core/science2.ts'
import { geometryDrawing } from '../core/geometry.ts'
import { isOfficeKind, officeView } from './officeView.ts'
import {
  chartDrawing, ganttDrawing, gaugeDrawing, ratingDrawing, type ChartData, type GanttData, type GaugeData,
  type PullQuoteData, type RatingData, type SidebarData, type StepsData,
} from '../core/widgetsMore.ts'
import {
  CODE_THEMES, ICONS, PROGRESS_CM, WIDGET_NAMES, type ChecklistData, type CodeData, type ProgressData, type QrData,
  type TimelineData, type Widget,
} from '../core/widgets.ts'

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

const SVG = 'http://www.w3.org/2000/svg'
function svg(w: number, h: number, inner: string): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg')
  s.setAttribute('width', String(w))
  s.setAttribute('height', String(h))
  s.setAttribute('viewBox', `0 0 ${w} ${h}`)
  s.innerHTML = inner
  return s
}

export function widgetElement(w: Widget, opts: { select: () => void; remove: () => void; edit: () => void; toggle?: (i: number) => void }): HTMLElement {
  const box = el('div', `kt-widget kt-widget-${w.kind}`)
  box.contentEditable = 'false'
  box.title = `${WIDGET_NAMES[w.kind]}: click to select (its tab opens), double-click to edit`
  const body = el('div', 'kt-widget-body')
  if (isOfficeKind(w.kind)) officeView(body, w.kind, w.data)
  else switch (w.kind) {
    case 'checklist': checklist(body, w.data as ChecklistData, opts.toggle); break
    case 'progress': progress(body, w.data as ProgressData); break
    case 'timeline': timeline(body, w.data as TimelineData); break
    case 'qrcode': qr(body, w.data as QrData); break
    case 'code': code(body, w.data as CodeData); break
    case 'pullquote': pullQuote(body, w.data as PullQuoteData); break
    case 'sidebar': sidebar(body, w.data as SidebarData); break
    case 'steps': steps(body, w.data as StepsData); break
    case 'rating': body.appendChild(drawingSvg(ratingDrawing(w.data as RatingData))); break
    case 'gauge': body.appendChild(drawingSvg(gaugeDrawing(w.data as GaugeData))); break
    case 'gantt': body.appendChild(drawingSvg(ganttDrawing(w.data as GanttData))); break
    case 'chart': body.appendChild(drawingSvg(chartDrawing(w.data as ChartData))); break
    case 'plot': body.appendChild(drawingSvg(plotDrawing(w.data as PlotData))); break
    case 'circuit': body.appendChild(drawingSvg(circuitDrawing(w.data as CircuitData))); break
    case 'feynman': body.appendChild(drawingSvg(feynmanDrawing(w.data as FeynmanData))); break
    case 'mo': body.appendChild(drawingSvg(moDrawing(w.data as MoData))); break
    case 'bohr': body.appendChild(drawingSvg(bohrDrawing(w.data as BohrData))); break
    case 'element': body.appendChild(drawingSvg(elementTilesDrawing(w.data as ElementTileData))); break
    case 'hazard': hazard(body, w.data as HazardData); break
    case 'risk': body.appendChild(drawingSvg(riskDrawing(w.data as never))); break
    case 'signs': body.appendChild(drawingSvg(signsDrawing(w.data as never))); break
    case 'forces': body.appendChild(drawingSvg(forcesDrawing(w.data as never))); break
    case 'optics': body.appendChild(drawingSvg(opticsDrawing(w.data as never))); break
    case 'wave': body.appendChild(drawingSvg(waveDrawing(w.data as never))); break
    case 'levels': body.appendChild(drawingSvg(levelsDrawing(w.data as never))); break
    case 'function': body.appendChild(drawingSvg(functionDrawing(w.data as never))); break
    case 'numberline': body.appendChild(drawingSvg(numberLineDrawing(w.data as never))); break
    case 'venn': body.appendChild(drawingSvg(vennDrawing(w.data as never))); break
    case 'triangle': body.appendChild(drawingSvg(triangleDrawing(w.data as never))); break
    case 'stats': body.appendChild(drawingSvg(statsDrawing(w.data as never))); break
    case 'unitcircle': body.appendChild(drawingSvg(unitCircleDrawing(w.data as never))); break
    case 'geometry': body.appendChild(drawingSvg(geometryDrawing(w.data as never))); break
    case 'scheme': scheme(body, w.data as SchemeData); break
    case 'algorithm': algorithm(body, w.data as AlgorithmData); break
    case 'notebook': notebook(body, w.data as NotebookData); break
  }
  const x = el('button', 'kt-widget-close', '×')
  x.type = 'button'
  x.title = `Remove the ${WIDGET_NAMES[w.kind].toLowerCase()}`
  x.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); opts.remove() })
  const tag = el('span', 'kt-widget-tag', WIDGET_NAMES[w.kind])
  box.append(tag, body, x)
  box.addEventListener('mousedown', ev => { ev.preventDefault(); opts.select() })
  box.addEventListener('dblclick', ev => { ev.preventDefault(); opts.edit() })
  return box
}

function checklist(body: HTMLElement, d: ChecklistData, toggle?: (i: number) => void) {
  const C = '#' + d.color
  if (d.title.trim()) {
    const t = el('div', 'kt-w-title', d.title)
    t.style.color = C
    body.appendChild(t)
  }
  const list = el('div', 'kt-w-checks')
  list.style.columnCount = String(Math.max(1, Math.min(3, d.columns || 1)))
  for (const [idx, it] of d.items.entries()) {
    const row = el('div', 'kt-w-check')
    const circle = d.style === 'circle'
    const shape = circle ? `<circle cx="7" cy="7" r="5.6"` : `<rect x="1.4" y="1.4" width="11.2" height="11.2" rx="1.5"`
    const mark = svg(14, 14, `${shape} fill="${it.done ? C + '20' : 'none'}" stroke="${C}" stroke-width="1.1"/>`
      + (it.done ? `<path d="M3.6 7.2 L6.1 9.6 L10.6 4.4" fill="none" stroke="${C}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''))
    const txt = el('span', '', it.text)
    if (it.done && d.grey_done) txt.style.color = '#888'
    row.append(mark, txt)
    // A click on the box ticks or unticks it, as on paper.
    if (toggle) {
      mark.classList.add('kt-w-check-box')
      mark.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); toggle(idx) })
    }
    list.appendChild(row)
  }
  body.appendChild(list)
}

function progress(body: HTMLElement, d: ProgressData) {
  const C = '#' + d.color
  const grid = el('div', 'kt-w-bars')
  const cm = 37.8
  const L = (PROGRESS_CM[d.length] ?? 7) * cm
  const h = d.style === 'thin' ? 4 : 10
  for (const it of d.items) {
    const v = Math.max(0, Math.min(100, Math.round(it.value)))
    const bar = el('span', 'kt-w-bar')
    bar.style.cssText = `width:${L}px;height:${h}px;background:color-mix(in srgb, ${C} 18%, white);border-radius:${d.style === 'square' ? 0 : h / 2}px`
    const fill = el('span')
    fill.style.cssText = `width:${v}%;background:${C};border-radius:inherit`
    bar.appendChild(fill)
    grid.append(el('span', 'kt-w-bar-label', it.label), bar)
    if (d.percent) grid.appendChild(el('span', 'kt-w-bar-pct', `${v}%`))
  }
  grid.style.gridTemplateColumns = d.percent ? 'auto auto auto' : 'auto auto'
  body.appendChild(grid)
}

function timeline(body: HTMLElement, d: TimelineData) {
  const C = '#' + d.color
  const wrap = el('div', d.layout === 'horizontal' ? 'kt-w-tl kt-w-tl-h' : 'kt-w-tl kt-w-tl-v')
  wrap.style.setProperty('--kt-w', C)
  for (const e of d.events) {
    const ev = el('div', 'kt-w-ev')
    const date = el('div', 'kt-w-ev-date', e.date)
    const dot = el('div', 'kt-w-ev-dot')
    const txt = el('div', 'kt-w-ev-text')
    if (e.title.trim()) txt.appendChild(el('div', 'kt-w-ev-title', e.title))
    if (e.text.trim()) txt.appendChild(el('div', 'kt-w-ev-body', e.text))
    ev.append(date, dot, txt)
    wrap.appendChild(ev)
  }
  body.appendChild(wrap)
}

// The QR code's modules as one SVG path, in the code's colour.
export function qrSvg(text: string, px: number, color: string): SVGSVGElement {
  const q = qrcode(0, 'M')
  q.addData(text || ' ', 'Byte')
  q.make()
  const n = q.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
  const s = svg(px, px, `<path d="${d}" fill="${color}" shape-rendering="crispEdges"/>`)
  s.setAttribute('viewBox', `0 0 ${n} ${n}`)
  return s
}

function qr(body: HTMLElement, d: QrData) {
  const wrap = el('div', 'kt-w-qr')
  wrap.style.textAlign = d.align
  try {
    wrap.appendChild(qrSvg(d.url.trim(), (Number(d.size) || 3) * 37.8, '#' + d.color))
  } catch {
    wrap.appendChild(el('div', 'kt-w-qr-err', 'The link is too long for a QR code.'))
  }
  if (d.caption.trim()) wrap.appendChild(el('div', 'kt-w-qr-cap', d.caption))
  body.appendChild(wrap)
}

const KEYWORDS = new Set(('def return if elif else for while in import from as class try except finally with lambda yield not and or is None True False print '
  + 'int float double char void const let var function new this null true false public private static switch case break continue struct include '
  + 'end then do fi done echo select from where insert update delete create table begin').split(' '))

function code(body: HTMLElement, d: CodeData) {
  const th = CODE_THEMES[d.theme] ?? CODE_THEMES.light
  if (d.title.trim()) body.appendChild(el('div', 'kt-w-code-title', d.title))
  const pre = el('div', 'kt-w-code')
  pre.style.cssText = `background:${d.theme === 'plain' ? 'transparent' : '#' + th.bg};color:#${th.text};`
    + (d.frame && d.theme !== 'dark' ? `border:1px solid #${th.rule};` : '')
  const hashComment = ['Python', 'R', 'Bash', 'Plain text'].includes(d.language)
  d.code.split('\n').forEach((line, i) => {
    const row = el('div', 'kt-w-code-line')
    if (d.numbers) row.appendChild(el('span', 'kt-w-code-num', String(i + 1)))
    const txt = el('span', 'kt-w-code-text')
    // A light colouring: comments, strings and keywords, as listings does.
    const re = hashComment ? /(#.*$)|("[^"]*"|'[^']*')|([A-Za-z_]\w*)/g : /(\/\/.*$|%.*$)|("[^"]*"|'[^']*')|([A-Za-z_]\w*)/g
    let last = 0
    for (const m of line.matchAll(re)) {
      if (m.index! > last) txt.appendChild(document.createTextNode(line.slice(last, m.index)))
      const s = el('span', '', m[0])
      if (m[1]) s.style.color = '#' + th.comment
      else if (m[2]) s.style.color = '#' + th.string
      else if (d.language !== 'Plain text' && KEYWORDS.has(m[3])) { s.style.color = '#' + th.kw; s.style.fontWeight = '700' }
      txt.appendChild(s)
      last = m.index! + m[0].length
    }
    if (last < line.length) txt.appendChild(document.createTextNode(line.slice(last)))
    if (!line) txt.textContent = '​'
    row.appendChild(txt)
    pre.appendChild(row)
  })
  body.appendChild(pre)
}

// ------------------------------------------------ margin notes, drop caps

export function marginNoteElement(dom: HTMLElement, n: { color: string; style: string; text: string }) {
  const C = '#' + n.color
  dom.className = 'kt-inline-raw kt-marginnote'
  dom.title = 'Margin note: click to select (its tab opens)'
  const flag = el('span', 'kt-marginnote-flag')
  flag.style.background = C
  const note = el('span', `kt-marginnote-text kt-mn-${n.style}`, n.text)
  note.style.setProperty('--kt-mn', C)
  dom.replaceChildren(flag, note)
}

export function dropCapElement(dom: HTMLElement, d: { lines: number; letter: string; rest: string; color: string; margin: boolean; smallcaps: boolean }) {
  dom.className = 'kt-inline-raw kt-dropcap'
  dom.title = 'Drop cap: click to select (its tab opens)'
  const big = el('span', 'kt-dropcap-letter', d.letter)
  big.style.setProperty('--kt-dc-lines', String(d.lines))
  big.style.color = '#' + d.color
  if (d.margin) big.classList.add('kt-dropcap-margin')
  const rest = el('span', d.smallcaps ? 'kt-dropcap-rest kt-dropcap-sc' : 'kt-dropcap-rest', d.rest)
  dom.replaceChildren(big, rest)
}


// ------------------------------------------- drawn elements (core/draw.ts)

const CM = 37.8
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The shapes as SVG, centred and no wider than the text, as \resizebox does.
export function drawingSvg(d: Drawing): HTMLElement {
  const H = d.h
  const Y = (y: number) => H - y
  const c = (h?: string) => (h ? '#' + h.replace('#', '') : 'none')
  const out: string[] = []
  const pt = (a: number, r: number, x: number, y: number) => [x + r * Math.cos(a * Math.PI / 180), Y(y + r * Math.sin(a * Math.PI / 180))]
  for (const s of d.shapes) {
    switch (s.t) {
      case 'rect':
        out.push(`<rect x="${s.x}" y="${Y(s.y + s.h)}" width="${Math.max(0, s.w)}" height="${Math.max(0, s.h)}" rx="${s.r ?? 0}" fill="${c(s.fill)}" stroke="${c(s.stroke)}" stroke-width="${(s.lw ?? 0) / 28.35}"/>`)
        break
      case 'line':
        out.push(`<polyline points="${s.pts.map(([x, y]) => `${x},${Y(y)}`).join(' ')}" fill="none" stroke="${c(s.stroke)}" stroke-width="${(s.lw ?? 0.6) / 28.35}" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="0.1 0.07"' : ''}/>`)
        break
      case 'poly':
        out.push(`<polygon points="${s.pts.map(([x, y]) => `${x},${Y(y)}`).join(' ')}" fill="${c(s.fill)}" stroke="${c(s.stroke)}" stroke-width="${(s.lw ?? 0.5) / 28.35}" stroke-linejoin="round"/>`)
        break
      case 'circle':
        out.push(`<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.r}" fill="${c(s.fill)}" stroke="${c(s.stroke)}" stroke-width="${(s.lw ?? 0.6) / 28.35}"/>`)
        break
      case 'text': {
        const a = s.anchor ?? 'center'
        const ta = a.includes('west') ? 'start' : a.includes('east') ? 'end' : 'middle'
        const db = a.startsWith('north') ? 'hanging' : a.startsWith('south') ? 'alphabetic' : 'central'
        // 99 is the PDF's \\Large (draw.ts FONT): 17 pt.
        const size = Math.min(s.size ?? 10, 17.3) / 28.35
        const rot = s.rotate ? ` transform="rotate(${-s.rotate} ${s.x} ${Y(s.y)})"` : ''
        out.push(`<text x="${s.x}" y="${Y(s.y)}" font-size="${size}" text-anchor="${ta}" dominant-baseline="${db}" fill="${c(s.color ?? '000000')}"${s.bold ? ' font-weight="700"' : ''}${rot}>${esc(s.s)}</text>`)
        break
      }
      case 'wedge': {
        const [x0, y0] = pt(s.a0, s.r, s.x, s.y), [x1, y1] = pt(s.a1, s.r, s.x, s.y)
        const large = Math.abs(s.a1 - s.a0) > 180 ? 1 : 0
        const sweep = s.a1 < s.a0 ? 1 : 0
        out.push(Math.abs(s.a1 - s.a0) >= 359.99
          ? `<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.r}" fill="${c(s.fill)}"/>`
          : `<path d="M${s.x},${Y(s.y)} L${x0},${y0} A${s.r},${s.r} 0 ${large} ${sweep} ${x1},${y1} Z" fill="${c(s.fill)}" stroke="#fff" stroke-width="0.03"/>`)
        break
      }
      case 'arc': {
        const span = Math.abs(s.a1 - s.a0)
        if (span >= 359.99) { out.push(`<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.r}" fill="none" stroke="${c(s.stroke)}" stroke-width="${s.lw / 28.35}"/>`); break }
        const [x0, y0] = pt(s.a0, s.r, s.x, s.y), [x1, y1] = pt(s.a1, s.r, s.x, s.y)
        out.push(`<path d="M${x0},${y0} A${s.r},${s.r} 0 ${span > 180 ? 1 : 0} ${s.a1 < s.a0 ? 1 : 0} ${x1},${y1}" fill="none" stroke="${c(s.stroke)}" stroke-width="${s.lw / 28.35}"/>`)
        break
      }
    }
  }
  const wrap = el('div', 'kt-w-drawing')
  const sv = svg(d.w * CM, d.h * CM, out.join(''))
  sv.setAttribute('viewBox', `0 0 ${d.w} ${d.h}`)
  sv.style.maxWidth = '100%'
  sv.style.height = 'auto'
  wrap.appendChild(sv)
  return wrap
}

function paraEls(text: string): HTMLElement[] {
  return text.split(/\n\s*\n/).map(p => {
    const e = el('div', 'kt-w-para')
    p.split('\n').forEach((line, i) => { if (i) e.appendChild(el('br')); e.appendChild(document.createTextNode(line)) })
    return e
  })
}

function pullQuote(body: HTMLElement, d: PullQuoteData) {
  const C = '#' + d.color
  const q = el('div', `kt-w-pq kt-w-pq-${d.style}`)
  q.style.setProperty('--kt-w', C)
  const t = el('div', 'kt-w-pq-text')
  t.append(...paraEls(d.text))
  q.appendChild(t)
  if (d.author.trim()) q.appendChild(el('div', 'kt-w-pq-author', `— ${d.author.trim()}`))
  body.appendChild(q)
}

function sidebar(body: HTMLElement, d: SidebarData) {
  const box = el('div', `kt-w-side kt-w-side-${d.position}`)
  box.style.setProperty('--kt-w', '#' + d.color)
  if (d.title.trim()) box.appendChild(el('div', 'kt-w-side-title', d.title))
  box.append(...paraEls(d.text))
  if (d.position !== 'full') box.appendChild(el('div', 'kt-w-side-hint', 'The next paragraph flows beside it in the PDF.'))
  body.appendChild(box)
}

function steps(body: HTMLElement, d: StepsData) {
  const wrap = el('div', d.layout === 'horizontal' ? 'kt-w-steps kt-w-steps-h' : 'kt-w-steps kt-w-steps-v')
  wrap.style.setProperty('--kt-w', '#' + d.color)
  d.steps.forEach((s, i) => {
    const st = el('div', 'kt-w-step')
    st.appendChild(el('div', 'kt-w-step-num', String(i + 1)))
    const txt = el('div', 'kt-w-step-text')
    if (s.title.trim()) txt.appendChild(el('div', 'kt-w-step-title', s.title))
    if (s.text.trim()) txt.appendChild(el('div', '', s.text))
    st.appendChild(txt)
    wrap.appendChild(st)
  })
  body.appendChild(wrap)
}

// Insert ▸ Icon: the FontAwesome icon as a character close to it.
export function iconElement(dom: HTMLElement, i: { color: string; size: string; name: string }) {
  dom.className = 'kt-inline-raw kt-icon'
  const def = ICONS.find(([n]) => n === i.name)
  dom.title = `Icon: ${def?.[1] ?? i.name} (click to select)`
  const g = el('span', `kt-icon-glyph kt-icon-${i.size}`, def?.[2] ?? '■')
  g.style.color = '#' + i.color
  dom.replaceChildren(g)
}


// ------------------------------------------------------- Science elements

function hazard(body: HTMLElement, d: HazardData) {
  body.appendChild(drawingSvg(hazardDrawing(d)))
  const list = el('div', 'kt-w-hz')
  for (const [code, text] of hazardLines(d)) {
    const row = el('div', '')
    row.append(el('b', '', code), document.createTextNode('  ' + text))
    list.appendChild(row)
  }
  body.appendChild(list)
}

// The scheme: each molecule's name and formula, joined by labelled arrows
// (the PDF draws the structures with chemfig).
function scheme(body: HTMLElement, d: SchemeData) {
  const row = el('div', 'kt-w-scheme')
  d.steps.forEach((st, i) => {
    if (i > 0) {
      const a = d.arrows[i - 1] ?? { above: '', below: '' }
      const ar = el('div', 'kt-w-scheme-arrow')
      ar.append(el('span', '', a.above), el('span', 'kt-w-scheme-line', '⟶'), el('span', '', a.below))
      row.appendChild(ar)
    }
    const m = el('div', 'kt-w-scheme-mol')
    m.append(el('div', 'kt-w-scheme-formula', st.chemfig.replace(/\\?chemfig\{|\}/g, '').replace(/_(\d)/g, (_x, n: string) => '₀₁₂₃₄₅₆₇₈₉'[Number(n)]).replace(/\[[^\]]*\]/g, '')),
      el('div', 'kt-w-scheme-name', st.name))
    row.appendChild(m)
  })
  body.appendChild(row)
  body.appendChild(el('div', 'kt-w-side-hint', 'The structures are drawn with chemfig in the PDF.'))
}

const ALG_KEYS = /^(function|procedure|if|else if|elseif|else|for|while|return)\b/i

function algorithm(body: HTMLElement, d: AlgorithmData) {
  const box = el('div', 'kt-w-alg')
  if (d.title.trim()) {
    const t = el('div', 'kt-w-alg-title')
    t.append(el('b', '', 'Algorithm '), document.createTextNode(d.title))
    box.appendChild(t)
  }
  // Line for line as the PDF prints it, the "end if" / "end while" lines
  // algpseudocode adds included (without them the element was drawn
  // shorter than it prints).
  algorithmRows(d).forEach((line, i) => {
    const row = el('div', 'kt-w-alg-line')
    if (d.numbers) row.appendChild(el('span', 'kt-w-alg-num', `${i + 1}:`))
    const txt = el('span', '')
    txt.style.paddingLeft = `${line.indent * 1.5}em`
    const t = line.text
    const m = ALG_KEYS.exec(t)
    if (line.end) txt.append(el('b', '', t))
    else if (m) { txt.append(el('b', '', m[1]), document.createTextNode(t.slice(m[1].length).replace(/\s*=\s*/, ' ← '))) }
    else txt.textContent = t.replace(/^(\w+)\s*=\s*/, '$1 ← ')
    row.appendChild(txt)
    box.appendChild(row)
  })
  body.appendChild(box)
}

// **bold**, *italic*, $maths$ (shown as typed) as DOM.
function noteInlineEl(text: string): Node[] {
  const out: Node[] = []
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
    if (/^\*\*.+\*\*$/.test(part)) out.push(el('b', '', part.slice(2, -2)))
    else if (/^\*.+\*$/.test(part)) out.push(el('i', '', part.slice(1, -1)))
    else if (part) out.push(document.createTextNode(part))
  }
  return out
}

function noteBody(text: string): HTMLElement {
  const box = el('div', 'kt-w-nb-body')
  for (const b of parseNoteText(text)) {
    if (b.t === 'p') { const p = el('div', 'kt-w-nb-p'); p.append(...noteInlineEl(b.text)); box.appendChild(p) }
    else if (b.t === 'ul' || b.t === 'ol') {
      const l = el(b.t)
      for (const it of b.items) { const li = el('li'); li.append(...noteInlineEl(it)); l.appendChild(li) }
      box.appendChild(l)
    } else if (b.t === 'check') {
      for (const [on, it] of b.items) { const r = el('div', 'kt-w-nb-check'); r.append(el('span', '', on ? '☒ ' : '☐ '), ...noteInlineEl(it)); box.appendChild(r) }
    } else if (b.t === 'table') {
      const tb = el('table', 'kt-w-nb-table')
      b.rows.forEach((r, i) => { const tr = el('tr'); for (const c of r) { const td = el(i ? 'td' : 'th'); td.append(...noteInlineEl(c)); tr.appendChild(td) } tb.appendChild(tr) })
      box.appendChild(tb)
    }
  }
  return box
}

function notebook(body: HTMLElement, d: NotebookData) {
  const box = el('div', 'kt-w-nb')
  box.style.setProperty('--kt-w', '#' + d.color)
  const head = el('div', 'kt-w-nb-head')
  head.append(el('span', '', d.title), el('span', '', d.date))
  box.appendChild(head)
  for (const s of notebookSections(d)) {
    if (!s.heading.trim() && !s.text.trim()) continue
    const blocks = parseNoteText(s.text)
    const simple = d.layout !== 'above' && blocks.length <= 1 && (blocks[0]?.t ?? 'p') === 'p'
    const row = el('div', simple ? 'kt-w-nb-row' : 'kt-w-nb-row kt-w-nb-above')
    const h = el('b', 'kt-w-nb-h', s.heading)
    if (simple) { row.append(h, document.createTextNode('  '), ...noteInlineEl(blocks[0]?.t === 'p' ? blocks[0].text : '')) }
    else row.append(h, noteBody(s.text))
    box.appendChild(row)
  }
  if (d.signature) box.appendChild(el('div', 'kt-w-nb-sign', 'Signed: ____________________      Witness: ____________________      Date: __________'))
  body.appendChild(box)
}
