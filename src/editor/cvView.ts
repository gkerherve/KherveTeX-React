// A moderncv CV in the page view as its PDF prints it (the classic style):
// the dates in a narrow hints column on the left, each entry beside them,
// a coloured rule before each section title, and the name, title and
// address at the top. The entries stay the RawLatex they are (the .ktex and
// the LaTeX do not change): an entry without the caret is drawn and its
// source hidden, the entry holding the caret shows its LaTeX to edit, and a
// click on a drawn entry puts the caret in it.
//
// Measured from moderncv's classic style in tectonic (11pt, A4, sans): the
// hints column is 0.175 of the text width and the gap 0.025; section titles
// are \Large in the style's colour, after a 4.6 pt rule across the hints
// column centred 4.25 pt above their baseline; an entry is \normalsize, its
// description \small; the name is 33.87 pt in a box 0.4 of the text width,
// the title 17.22 pt slanted grey under it, the address \small slanted grey
// set right, its last line level with the title's.
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { DocMeta } from '../core/model.ts'
import type { Look } from './classLooks.ts'
import { charCss, layoutKey } from './plugins.ts'

export const cvKey = new PluginKey('kt-cv')

const HINTS = 0.175
const SEPARATOR = 0.025
const NAME_BOX = 0.4
// The name's two lines are 25.1 pt apart at 33.87 pt.
const NAME_LEADING = 0.741

// \moderncvcolor's colour 1 (section titles, rules, bullets).
const COLORS: Record<string, string> = {
  blue: '#3873b3', orange: '#f28c26', green: '#59b34d', red: '#f23333',
  purple: '#8054cc', grey: '#8c8c8c', gray: '#8c8c8c', black: '#000000', burgundy: '#980000',
}
// Colour 2: the title, the address and the page number.
const GREY = '#737373'

export function isModerncv(meta: DocMeta): boolean {
  return (meta.documentclass || '').toLowerCase() === 'moderncv'
}

// moderncv sets its text in sans serif unless the class is given [roman].
function isSans(meta: DocMeta): boolean {
  return !/\broman\b/.test(meta.class_options || '')
}

function styleName(meta: DocMeta): string {
  return /\\moderncvstyle\s*(?:\[[^\]]*\])?\s*\{(\w+)\}/.exec(meta.preamble_extras || '')?.[1] ?? 'classic'
}

export function cvColor(meta: DocMeta): string {
  const c = /\\moderncvcolor\s*\{(\w+)\}/.exec(meta.preamble_extras || '')?.[1] ?? 'blue'
  return COLORS[c] ?? COLORS.blue
}

// The class's measured look was set in roman (the measure did not pass
// [sans]): the same sizes and spaces in Latin Modern Sans, and moderncv's
// colours on the title and the section headings.
const SANS_SIZES = [8, 10, 12, 17]
function sansFont(font: string): string {
  const m = /^LMRoman(Slant|Caps|Dunh)?(\d+)-(\w+)$/.exec(font)
  if (!m) return font
  const size = Number(m[2])
  const design = SANS_SIZES.reduce((a, b) => (Math.abs(b - size) < Math.abs(a - size) ? b : a))
  if (m[3] === 'Bold' || m[3] === 'BoldItalic') return 'LMSans10-Bold'
  const oblique = m[1] === 'Slant' || m[3] === 'Italic'
  return `LMSans${design}-${oblique ? 'Oblique' : 'Regular'}`
}

export function moderncvLook(look: Look, meta: DocMeta): Look {
  if (!isModerncv(meta)) return look
  const out = JSON.parse(JSON.stringify(look)) as Look & Record<string, unknown>
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === 'font' && typeof v === 'string' && isSans(meta)) (o as Record<string, unknown>)[k] = sansFont(v)
      else walk(v)
    }
  }
  walk(out)
  const color = cvColor(meta)
  const tint = (key: string, c: string) => {
    const spec = (out as Record<string, { color?: string } | undefined>)[key]
    if (spec && typeof spec === 'object') spec.color = c
  }
  for (const h of ['h1', 'h2']) tint(h, color)
  tint('title', GREY)
  return out
}

// ---------- the LaTeX of an entry, as HTML ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The index of the brace closing the group that opens at `open`, or -1.
function closeBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

// `n` brace arguments from `at` (spaces between them allowed): their
// texts and where they end, or null.
function args(s: string, at: number, n: number): { list: string[]; end: number } | null {
  const list: string[] = []
  let i = at
  for (let k = 0; k < n; k++) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (s[i] === '[') {   // an optional argument ([icon] of \social)
      const close = s.indexOf(']', i)
      if (close < 0) return null
      i = close + 1
      while (i < s.length && /\s/.test(s[i])) i++
    }
    if (s[i] !== '{') return null
    const close = closeBrace(s, i)
    if (close < 0) return null
    list.push(s.slice(i + 1, close))
    i = close + 1
  }
  return { list, end: i }
}

const ACCENTS: Record<string, string> = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', u: '̆', H: '̋' }
const SYMBOLS: Record<string, string> = {
  pounds: '£', euro: '€', textdegree: '°', ldots: '…', dots: '…', textendash: '–', textemdash: '—',
  copyright: '©', textregistered: '®', ss: 'ß', o: 'ø', O: 'Ø', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ',
  LaTeX: 'LaTeX', TeX: 'TeX', today: '', quad: ' ', qquad: '  ', textbar: '|',
  textbullet: '•', textasciitilde: '~', textbackslash: '\\',
}
const WRAPS: Record<string, [string, string]> = {
  emph: ['<i>', '</i>'], textit: ['<i>', '</i>'], textsl: ['<i>', '</i>'], textbf: ['<b>', '</b>'],
  textsc: ['<span style="font-variant:small-caps">', '</span>'], textup: ['<span style="font-style:normal">', '</span>'],
  textrm: ['', ''], textsf: ['', ''], texttt: ['<span style="font-family:\'KTeX LMMono10\',monospace">', '</span>'],
  mbox: ['', ''], text: ['', ''], underline: ['<u>', '</u>'], textsuperscript: ['<sup>', '</sup>'],
  small: ['', ''], footnotesize: ['', ''],
}

// The inline LaTeX of an entry as HTML: the font commands, accents,
// dashes and quotes, ties and thin spaces, links, and lists.
export function latexToHtml(src: string, bullet: string): string {
  let out = ''
  let i = 0
  const s = src
  while (i < s.length) {
    const ch = s[i]
    if (ch === '\\') {
      const rest = s.slice(i + 1)
      const env = /^(begin|end)\s*\{(itemize|enumerate|description)\}/.exec(rest)
      if (env) {
        out += env[1] === 'begin' ? (env[2] === 'enumerate' ? '<ol class="kt-cv-list">' : `<ul class="kt-cv-list" style="--kt-cv-bullet:${bullet}">`)
          : (env[2] === 'enumerate' ? '</li></ol>' : '</li></ul>')
        if (env[1] === 'begin') out += '<li hidden>'
        i += 1 + env[0].length
        continue
      }
      if (/^item\b/.test(rest)) {
        out += '</li><li>'
        i += 5
        if (s[i] === '[') { const c = s.indexOf(']', i); if (c > 0) i = c + 1 }
        while (i < s.length && /\s/.test(s[i])) i++
        continue
      }
      const cmd = /^([A-Za-z]+)\*?\s*/.exec(rest)
      if (cmd) {
        const name = cmd[1]
        const after = i + 1 + cmd[0].length
        if (name === 'href' || name === 'url') {
          const a = args(s, after, name === 'href' ? 2 : 1)
          if (a) { out += esc(name === 'href' ? stripTex(a.list[1]) : a.list[0]); i = a.end; continue }
        }
        if (name in WRAPS && s[after] === '{') {
          const close = closeBrace(s, after)
          if (close > 0) {
            const [o, c] = WRAPS[name]
            out += o + latexToHtml(s.slice(after + 1, close), bullet) + c
            i = close + 1
            continue
          }
        }
        if (name in SYMBOLS) {
          out += esc(SYMBOLS[name])
          i = i + 1 + name.length
          if (s.slice(i, i + 2) === '{}') i += 2
          else if (/[A-Za-z]/.test(name) && s[i] === ' ') i += 1
          continue
        }
        if (name.length === 1 && name in ACCENTS) {
          const a = s[after] === '{' ? args(s, after, 1) : null
          const base = a ? a.list[0] : s[after] ?? ''
          out += esc((base.replace(/^\\i$/, 'ı') + ACCENTS[name]).normalize('NFC'))
          i = a ? a.end : after + 1
          continue
        }
        if (name === 'newline' || name === 'linebreak') { out += '<br>'; i = after; continue }
        // Anything else: its arguments' text.
        i = after
        continue
      }
      const next = s[i + 1] ?? ''
      if (next in ACCENTS) {
        const a = s[i + 2] === '{' ? args(s, i + 2, 1) : null
        const base = a ? a.list[0] : s[i + 2] ?? ''
        out += esc((base.replace(/^\\i$/, 'ı') + ACCENTS[next]).normalize('NFC'))
        i = a ? a.end : i + 3
        continue
      }
      if (next === '\\') { out += '<br>'; i += 2; continue }
      if (next === ',' ) { out += ' '; i += 2; continue }
      if (next === ' ' || next === '\n') { out += ' '; i += 2; continue }
      out += esc(next)    // \& \% \_ \# \$ \{ \}
      i += 2
      continue
    }
    if (ch === '{' || ch === '}') { i++; continue }
    if (ch === '~') { out += ' '; i++; continue }
    if (s.startsWith('---', i)) { out += '—'; i += 3; continue }
    if (s.startsWith('--', i)) { out += '–'; i += 2; continue }
    if (s.startsWith('``', i)) { out += '“'; i += 2; continue }
    if (s.startsWith("''", i)) { out += '”'; i += 2; continue }
    if (ch === '`') { out += '‘'; i++; continue }
    if (ch === "'") { out += '’'; i++; continue }
    if (ch === '%') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl + 1; continue }
    if (ch === '$') { i++; continue }
    out += esc(ch)
    i++
  }
  return out.replace(/<li hidden><\/li>/g, '').replace(/<li hidden>/g, '<li>')
}

function stripTex(s: string): string {
  const d = document.createElement('div')
  d.innerHTML = latexToHtml(s, '')
  return d.textContent ?? ''
}

// ---------- entries ----------

interface Entry { from: number; to: number; html: string }

// The entry commands of a RawLatex block, each with its source range and
// its drawing; null when the block is not (only) entries.
const ENTRY_RE = /\\(cventry|cvitemwithcomment|cvdoubleitem|cvlistdoubleitem|cvlistitem|cvitem|cvline)\b\s*(\[[^\]]*\]\s*)?/g
const ARITY: Record<string, number> = { cventry: 6, cvitem: 2, cvline: 2, cvitemwithcomment: 3, cvdoubleitem: 4, cvlistitem: 1, cvlistdoubleitem: 2 }

function entries(text: string, bullet: string): Entry[] | null {
  const out: Entry[] = []
  let last = 0
  for (const m of text.matchAll(ENTRY_RE)) {
    if (m.index! < last) continue
    if (text.slice(last, m.index!).replace(/%[^\n]*/g, '').trim()) return null
    const a = args(text, m.index! + m[0].length, ARITY[m[1]])
    if (!a) return null
    out.push({ from: m.index!, to: a.end, html: entryHtml(m[1], a.list, bullet) })
    last = a.end
  }
  if (!out.length || text.slice(last).replace(/%[^\n]*/g, '').trim()) return null
  return out
}

function row(hint: string, main: string, cls = ''): string {
  return `<div class="kt-cv-row ${cls}"><div class="kt-cv-hint">${hint}</div><div class="kt-cv-main">${main}</div></div>`
}

function entryHtml(kind: string, a: string[], bullet: string): string {
  const h = (s: string) => latexToHtml(s, bullet)
  switch (kind) {
    case 'cventry': {
      const parts = [a[1] ? `<b>${h(a[1])}</b>` : '', a[2] ? `<i>${h(a[2])}</i>` : '', h(a[3]), h(a[4])].filter(p => p.trim())
      const desc = a[5].trim() ? `<div class="kt-cv-desc">${h(a[5])}</div>` : ''
      return row(h(a[0]), parts.join(', ') + desc, 'kt-cv-entry')
    }
    case 'cvitemwithcomment':
      return row(h(a[0]), `<b>${h(a[1])}</b><span class="kt-cv-comment">${h(a[2])}</span>`)
    case 'cvdoubleitem':
      return `<div class="kt-cv-row kt-cv-double"><div class="kt-cv-hint">${h(a[0])}</div><div class="kt-cv-main">${h(a[1])}</div>`
        + `<div class="kt-cv-hint">${h(a[2])}</div><div class="kt-cv-main">${h(a[3])}</div></div>`
    case 'cvlistitem':
      return row('', `<ul class="kt-cv-list" style="--kt-cv-bullet:${bullet}"><li>${h(a[0])}</li></ul>`)
    case 'cvlistdoubleitem':
      return row('', `<ul class="kt-cv-list kt-cv-two" style="--kt-cv-bullet:${bullet}"><li>${h(a[0])}</li><li>${h(a[1])}</li></ul>`)
    default:
      return row(h(a[0]), h(a[1]))
  }
}

function entryWidget(html: string, at: number, view: () => EditorView | null): HTMLElement {
  const el = document.createElement('div')
  el.className = 'kt-cv-drawn'
  el.contentEditable = 'false'
  // Where its source starts: a page break before this entry goes there
  // (paginate.ts), not after it where a click on it would land.
  el.dataset.ktPos = String(at)
  el.innerHTML = html
  el.title = 'Click to edit this entry'
  el.addEventListener('mousedown', e => {
    const v = view()
    if (!v) return
    e.preventDefault()
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)))
    v.focus()
  })
  return el
}

// ---------- the header ----------

function preambleArgs(extras: string, cmd: string, n: number): string[] | null {
  const m = new RegExp(`\\\\${cmd}\\b`).exec(extras)
  if (!m) return null
  return args(extras, m.index + m[0].length, n)?.list ?? null
}

function headerWidget(meta: DocMeta, textPx: number): HTMLElement {
  const x = meta.preamble_extras || ''
  const el = document.createElement('div')
  el.className = 'kt-cv-head'
  el.contentEditable = 'false'
  const title = preambleArgs(x, 'title', 1)?.[0]
  const lines: string[] = []
  const address = preambleArgs(x, 'address', 3)
    ?? preambleArgs(x, 'address', 2) ?? preambleArgs(x, 'address', 1)
  if (address) lines.push(...address.filter(a => a.trim()).map(a => latexToHtml(a, '')))
  for (const [cmd, icon] of [['phone', '☏'], ['email', '✉'], ['homepage', '⌂'], ['social', ''], ['extrainfo', '']] as const) {
    for (const m of x.matchAll(new RegExp(`\\\\${cmd}\\b`, 'g'))) {
      const a = args(x, m.index! + m[0].length, 1)
      if (a && a.list[0].trim()) lines.push((icon ? `<span class="kt-cv-icon">${icon}</span>` : '') + latexToHtml(a.list[0], ''))
    }
  }
  el.innerHTML = (title ? `<div class="kt-cv-title">${latexToHtml(title, '')}</div>` : '')
    + (lines.length ? `<div class="kt-cv-address" style="left:${NAME_BOX * textPx}px;width:${(1 - NAME_BOX) * textPx}px">${lines.map(l => `<div>${l}</div>`).join('')}</div>` : '')
  return el
}

// ---------- the plugin ----------

export function moderncvPlugin(): Plugin {
  let viewRef: EditorView | null = null
  const decorate = (state: EditorState): DecorationSet => {
    const ls = layoutKey.getState(state)
    if (!ls || !isModerncv(ls.meta) || styleName(ls.meta) !== 'classic') return DecorationSet.empty
    const meta = ls.meta
    const g = ls.layout.geometry
    const textPx = g.widthPx - g.leftPx - g.rightPx
    const hint = HINTS * textPx
    const sep = SEPARATOR * textPx
    const color = cvColor(meta)
    const caret = state.selection.empty ? state.selection.head : -1
    const bodyCss = charCss(ls.layout.bodyChar)
    const decos: Decoration[] = []
    const vars = `--kt-cv-hints:${hint}px;--kt-cv-sep:${sep}px;--kt-cv-color:${color};--kt-cv-grey:${GREY};`
    let header = false
    state.doc.forEach((node: PMNode, pos: number) => {
      const name = node.type.name
      if (name === 'author' && !header) {
        header = true
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-cv-name', style: `${vars}max-width:${NAME_BOX * textPx}px;line-height:${NAME_LEADING};` }))
        decos.push(Decoration.widget(pos + node.nodeSize - 1, () => headerWidget(meta, textPx),
          { key: `cv-head:${meta.preamble_extras}:${textPx}`, side: 1, ignoreSelection: true }))
        return
      }
      if (name === 'section') {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-cv-section', style: vars }))
        return
      }
      if (name !== 'raw_latex') return
      const text = node.textContent
      const list = entries(text, color)
      if (!list) return
      const base = pos + 1
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-cv-block', style: vars + bodyCss + 'line-height:1.237;' }))
      let prev = 0
      for (const e of list) {
        // The gap before an entry (the line break between commands).
        if (e.from > prev) decos.push(Decoration.inline(base + prev, base + e.from, { class: 'kt-cv-hide' }))
        prev = e.to
        const editing = caret >= base + e.from && caret <= base + e.to
        if (editing) {
          decos.push(Decoration.inline(base + e.from, base + e.to, { class: 'kt-cv-source' }))
          continue
        }
        decos.push(Decoration.widget(base + e.from, () => entryWidget(e.html, base + e.from, () => viewRef),
          // After the position, so a page-break spacer there (side -1)
          // comes before the entry.
          { key: `cv:${e.html}`, side: 1 }))
        decos.push(Decoration.inline(base + e.from, base + e.to, { class: 'kt-cv-hide' }))
      }
      if (text.length > prev) decos.push(Decoration.inline(base + prev, base + text.length, { class: 'kt-cv-hide' }))
    })
    return DecorationSet.create(state.doc, decos)
  }
  return new Plugin({
    key: cvKey,
    view(v) {
      viewRef = v
      return { destroy() { viewRef = null } }
    },
    props: { decorations: decorate },
  })
}
