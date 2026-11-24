// How Insert ▸ Elements look on the page, drawn from their settings as
// the PDF draws them (core/widgets.ts): checklist, progress bars,
// timeline, QR code and code listing; and the inline margin notes and
// drop caps. The block's LaTeX is hidden under the drawing, as a table of
// contents' is (toc.ts); a click selects it, × removes it.
import qrcode from 'qrcode-generator'
import {
  CODE_THEMES, PROGRESS_CM, WIDGET_NAMES, type ChecklistData, type CodeData, type ProgressData, type QrData,
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

export function widgetElement(w: Widget, opts: { select: () => void; remove: () => void; edit: () => void }): HTMLElement {
  const box = el('div', `kt-widget kt-widget-${w.kind}`)
  box.contentEditable = 'false'
  box.title = `${WIDGET_NAMES[w.kind]}: click to select (its tab opens), double-click to edit`
  const body = el('div', 'kt-widget-body')
  switch (w.kind) {
    case 'checklist': checklist(body, w.data as ChecklistData); break
    case 'progress': progress(body, w.data as ProgressData); break
    case 'timeline': timeline(body, w.data as TimelineData); break
    case 'qrcode': qr(body, w.data as QrData); break
    case 'code': code(body, w.data as CodeData); break
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

function checklist(body: HTMLElement, d: ChecklistData) {
  const C = '#' + d.color
  if (d.title.trim()) {
    const t = el('div', 'kt-w-title', d.title)
    t.style.color = C
    body.appendChild(t)
  }
  const list = el('div', 'kt-w-checks')
  list.style.columnCount = String(Math.max(1, Math.min(3, d.columns || 1)))
  for (const it of d.items) {
    const row = el('div', 'kt-w-check')
    const circle = d.style === 'circle'
    const shape = circle ? `<circle cx="7" cy="7" r="5.6"` : `<rect x="1.4" y="1.4" width="11.2" height="11.2" rx="1.5"`
    const mark = svg(14, 14, `${shape} fill="${it.done ? C + '20' : 'none'}" stroke="${C}" stroke-width="1.1"/>`
      + (it.done ? `<path d="M3.6 7.2 L6.1 9.6 L10.6 4.4" fill="none" stroke="${C}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''))
    const txt = el('span', '', it.text)
    if (it.done && d.grey_done) txt.style.color = '#888'
    row.append(mark, txt)
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
