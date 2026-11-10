// Posters in the page view as their PDFs print them.
//
// tikzposter: the title, authors and \institute in a white box across the
// page; \begin{columns} ... \column{w} ... \end{columns} as page columns,
// each \block{Title}{ ... } as tikzposter's Default box (a title bar in
// colour two with the title in white bold, a white body framed in colour
// two), the blocks after \end{columns} across the page, on the poster's
// background colour.
// a0poster: \begin{multicols}{N} as N page columns at \columnsep, the size
// it switches to (\veryHuge) as the body size, a \section redefined to a
// size as that size, and the title block (a center environment of sized
// lines) drawn across the columns.
// Either: the paper and orientation of the class options.
//
// The markers stay the RawLatex they are; one holding the caret shows its
// LaTeX. Measured from tectonic's PDFs of the gallery's posters.
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { DocMeta } from '../core/model.ts'
import type { Look } from './classLooks.ts'
import { latexToHtml } from './cvView.ts'
import { layoutKey } from './plugins.ts'

export const posterKey = new PluginKey('kt-poster')

type PosterClass = 'tikzposter' | 'a0poster'
export function posterClass(meta: DocMeta): PosterClass | null {
  const c = (meta.documentclass || '').toLowerCase()
  return c === 'tikzposter' || c === 'a0poster' ? c : null
}

const CM = 72.27 / 2.54
// Portrait paper, pt.
const PAPER: Record<string, [number, number]> = {
  a0: [2383.94, 3370.39], a1: [1683.78, 2383.94], a2: [1190.55, 1683.78],
  a3: [841.89, 1190.55], a4: [595.28, 841.89], a0b: [2594.0, 3401.6],
}

// tikzposter's Default theme and layout (independent of the paper).
const TP = {
  margin: 42.5,         // page edge to the blocks
  colsep: 53,           // between the columns
  titleTop: 43,         // the title box from the top
  border: 11.34,        // the frames' line (0.4 cm)
  pad: 28.45,           // block frame to its text (1 cm)
  gap: 42.5,            // between blocks
  head: 86,             // a block's title bar
  headSize: 42.84,      // its title
}

// a0poster's sizes at a0 (pt), as the PDF sets them.
const A0_SIZES: Record<string, number> = {
  tiny: 11.95, scriptsize: 14.34, footnotesize: 17.21, small: 20.66, normalsize: 24.79, large: 29.75,
  Large: 35.7, LARGE: 42.84, huge: 51.41, Huge: 61.69, veryHuge: 74.02, VeryHuge: 88.83, VERYHuge: 106.6,
}
const SIZE_RE = /\\(tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|veryHuge|VeryHuge|VERYHuge)\b/

// ---------- xcolor ----------

const BASE: Record<string, [number, number, number]> = {
  red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], black: [0, 0, 0], white: [1, 1, 1],
  cyan: [0, 1, 1], magenta: [1, 0, 1], yellow: [1, 1, 0], orange: [1, 0.5, 0], gray: [0.5, 0.5, 0.5],
  grey: [0.5, 0.5, 0.5], darkgray: [0.25, 0.25, 0.25], lightgray: [0.75, 0.75, 0.75], brown: [0.75, 0.5, 0.25],
  purple: [0.75, 0, 0.25], violet: [0.5, 0, 0.5], teal: [0, 0.5, 0.5], olive: [0.5, 0.5, 0], lime: [0.75, 1, 0],
  pink: [1, 0.75, 0.75],
}

// "blue!55!black", "blue!20" (the rest white), "orange": as #rrggbb.
export function xcolor(expr: string): string | null {
  const parts = expr.trim().split('!')
  let rgb = BASE[parts[0]]
  if (!rgb) return null
  for (let k = 1; k < parts.length; k += 2) {
    const pct = Number(parts[k]) / 100
    const other = BASE[parts[k + 1] ?? 'white']
    if (!Number.isFinite(pct) || !other) return null
    rgb = rgb.map((c, j) => c * pct + other[j] * (1 - pct)) as [number, number, number]
  }
  return '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
}

function tikzColors(meta: DocMeta): { two: string; background: string } {
  const x = meta.preamble_extras || ''
  const style = /\\usecolorstyle\s*\[([^\]]*)\]/.exec(x)?.[1] ?? ''
  const two = /colorTwo\s*=\s*([\w!.]+)/.exec(style)?.[1]
  const bg = /\\colorlet\s*\{backgroundcolor\}\s*\{([\w!.]+)\}/.exec(x)?.[1]
  return { two: (two && xcolor(two)) || '#ccccff', background: (bg && xcolor(bg)) || '#ffffff' }
}

export function posterBackground(meta: DocMeta): string | null {
  return posterClass(meta) === 'tikzposter' ? tikzColors(meta).background : null
}

// ---------- the look ----------

function rawTexts(doc: PMNode): string[] {
  const out: string[] = []
  doc.forEach(n => { if (n.type.name === 'raw_latex') out.push(n.textContent) })
  return out
}

export function posterLook(look: Look, meta: DocMeta, doc: PMNode | null): Look {
  const cls = posterClass(meta)
  if (!cls) return look
  const out = JSON.parse(JSON.stringify(look)) as Look
  const g = out.geometry
  const opts = (meta.class_options || '').split(',').map(s => s.trim())
  const paper = opts.map(o => o.replace(/paper$/, '')).find(o => o in PAPER)
  const landscape = opts.includes('landscape') ? true : opts.includes('portrait') ? false : g.page_w > g.page_h
  if (paper) {
    const [w, h] = PAPER[paper]
    g.page_w = landscape ? h : w
    g.page_h = landscape ? w : h
  }
  const raws = doc ? rawTexts(doc) : []
  if (cls === 'tikzposter') {
    g.left = g.right = TP.margin
    g.top = TP.titleTop
    g.bottom = TP.margin
    const start = raws.findIndex(t => /\\begin\{columns\}/.test(t))
    if (start >= 0) {
      let n = 0
      for (const t of raws.slice(start)) {
        n += (t.match(/\\column\b/g) ?? []).length
        if (/\\end\{columns\}/.test(t)) break
      }
      g.cols = Math.max(1, n)
      g.colsep = TP.colsep
    }
    for (const k of ['title', 'author'] as const) {
      const spec = (out as unknown as Record<string, { wide?: boolean } | undefined>)[k]
      if (spec) spec.wide = true
    }
  } else {
    const multi = raws.find(t => /\\begin\{multicols\}\{\d+\}/.test(t))
    if (multi) {
      g.cols = Number(/\\begin\{multicols\}\{(\d+)\}/.exec(multi)![1])
      const sep = /\\setlength\s*\{\\columnsep\}\s*\{([\d.]+)\s*(cm|mm|pt)\}/.exec(meta.preamble_extras || '')
      g.colsep = sep ? Number(sep[1]) * (sep[2] === 'cm' ? CM : sep[2] === 'mm' ? CM / 10 : 1) : 2 * CM
      const size = SIZE_RE.exec(multi)?.[1]
      if (size) {
        const k = A0_SIZES[size] / out.body.size
        out.body = { ...out.body, size: A0_SIZES[size], leading: out.body.leading * k }
      }
    }
    // \renewcommand\section{...\VeryHuge\bfseries}: the section titles' size.
    const sec = /\\renewcommand\s*\\section\s*\{[\s\S]*?\\(VERYHuge|VeryHuge|veryHuge|Huge|huge|LARGE|Large|large)\b/
      .exec(meta.preamble_extras || '')
    const h1 = (out as unknown as Record<string, { size: number; num_gap?: number | null } | undefined>).h1
    if (sec && h1) {
      h1.size = A0_SIZES[sec[1]]
      if (h1.num_gap) h1.num_gap = h1.size
    }
  }
  return out
}

// ---------- drawing ----------

function sourceToggle(view: () => EditorView | null, at: number): (e: MouseEvent) => void {
  return e => {
    const v = view()
    if (!v) return
    e.preventDefault()
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)))
    v.focus()
  }
}

function widget(html: string, cls: string, at: number, view: () => EditorView | null): HTMLElement {
  const el = document.createElement('div')
  el.className = cls
  el.contentEditable = 'false'
  el.innerHTML = html
  el.title = 'Click to edit its LaTeX'
  el.addEventListener('mousedown', sourceToggle(view, at))
  return el
}

// A center environment of lines: brace groups that set a size and
// \bfseries ("{\VeryHuge\bfseries title\\ second line}"), each broken at
// \\, and the \\[skip] between them; a \hrule after it.
function centerHtml(text: string): string {
  const body = /\\begin\{center\}([\s\S]*?)\\end\{center\}/.exec(text)?.[1] ?? text
  const toPt = (n: string, u: string) => Number(n) * (u === 'cm' ? CM : u === 'mm' ? CM / 10 : 1)
  // Top-level groups and the text between them.
  const parts: { text: string; group: boolean; skipAfter: number }[] = []
  let i = 0
  while (i < body.length) {
    if (body[i] === '{') {
      let depth = 0
      let k = i
      for (; k < body.length; k++) {
        if (body[k] === '\\') { k++; continue }
        if (body[k] === '{') depth++
        else if (body[k] === '}' && --depth === 0) break
      }
      parts.push({ text: body.slice(i + 1, k), group: true, skipAfter: 0 })
      i = k + 1
      continue
    }
    const sep = /^\\\\(?:\[([\d.]+)\s*(cm|mm|pt)\])?/.exec(body.slice(i))
    if (sep) {
      if (parts.length) parts[parts.length - 1].skipAfter = sep[1] ? toPt(sep[1], sep[2]) : 0
      i += sep[0].length
      continue
    }
    const next = body.slice(i).search(/\{|\\\\/)
    const chunk = next < 0 ? body.slice(i) : body.slice(i, i + next)
    if (chunk.trim()) parts.push({ text: chunk, group: false, skipAfter: 0 })
    i += next < 0 ? chunk.length : next || 1
  }
  let html = ''
  for (const part of parts) {
    const size = SIZE_RE.exec(part.text)?.[1]
    const bold = /\\bfseries\b/.test(part.text)
    const inner = part.text.replace(/\\(?:[A-Za-z]*[Hh]uge|LARGE|Large|large|bfseries|normalsize|small)\b\s*/g, '')
    const lines = inner.split(/\\\\(?:\[[^\]]*\])?/).map(l => l.trim()).filter(Boolean)
    // Latin Modern has bold only at 10 and 12 pt.
    const font = bold ? "font-family:'KTeX LMRoman12','Latin Modern Roman',serif;font-weight:700;" : ''
    const style = `${size ? `font-size:${A0_SIZES[size]}pt;line-height:1.2;` : ''}${font}`
    html += `<div style="${style}${part.skipAfter ? `margin-bottom:${part.skipAfter}pt;` : ''}">`
      + lines.map(l => `<div>${latexToHtml(l, '#000')}</div>`).join('') + '</div>'
  }
  if (/\\hrule/.test(text.slice(text.indexOf('\\end{center}')))) html += '<hr class="kt-poster-rule">'
  return html
}

// A center environment holding a booktabs tabular and a caption line.
function tabularHtml(text: string): string | null {
  const m = /\\begin\{tabular\}\{([lcr|]+)\}([\s\S]*?)\\end\{tabular\}/.exec(text)
  if (!m) return null
  const aligns = m[1].replace(/\|/g, '').split('').map(c => (c === 'r' ? 'right' : c === 'c' ? 'center' : 'left'))
  const rows: string[] = []
  let rule = 'top'
  for (const raw of m[2].split(/\\\\/)) {
    let r = raw
    let cls = ''
    if (/\\toprule/.test(r)) cls += ' kt-poster-top'
    if (/\\midrule/.test(r)) { rule = 'mid'; r = r.replace(/\\midrule/, '') }
    if (/\\bottomrule/.test(r)) { rule = 'bottom'; r = r.replace(/\\bottomrule/, '') }
    r = r.replace(/\\toprule/, '').trim()
    if (!r) {
      if (rule === 'mid' && rows.length) rows[rows.length - 1] = rows[rows.length - 1].replace('<tr class="', '<tr class="kt-poster-mid ')
      if (rule === 'bottom' && rows.length) rows[rows.length - 1] = rows[rows.length - 1].replace('<tr class="', '<tr class="kt-poster-bottom ')
      rule = ''
      continue
    }
    const cells = r.split('&').map((c, j) => `<td style="text-align:${aligns[j] ?? 'left'}">${latexToHtml(c.trim(), '#000')}</td>`)
    rows.push(`<tr class="${cls.trim()}${rule === 'mid' ? '' : ''}">${cells.join('')}</tr>`)
    rule = ''
  }
  const after = text.slice(text.indexOf('\\end{tabular}') + '\\end{tabular}'.length)
    .replace(/^\\\\(\[[^\]]*\])?/, '').replace(/\\end\{center\}[\s\S]*$/, '').trim()
  return `<table class="kt-poster-table"><tbody>${rows.join('')}</tbody></table>`
    + (after ? `<div class="kt-poster-caption">${latexToHtml(after, '#000')}</div>` : '')
}

const BLOCK_RE = /^\s*\\block\s*\{([\s\S]*)\}\s*\{\s*$/
const MARK_RE = /^\s*(?:\\begin\{columns\}|\\column\s*\{[^}]*\}|\\end\{columns\}|\\begin\{multicols\}\{\d+\}|\\end\{multicols\}|\\(?:veryHuge|VeryHuge|VERYHuge|Huge|huge|LARGE|Large|large|normalsize)\b|\\raggedright\b|\\centering\b|\s)+\s*$/

export function posterPlugin(): Plugin {
  let viewRef: EditorView | null = null
  const view = () => viewRef
  const decorate = (state: EditorState): DecorationSet => {
    const ls = layoutKey.getState(state)
    const cls = ls ? posterClass(ls.meta) : null
    if (!ls || !cls) return DecorationSet.empty
    const meta = ls.meta
    const caret = state.selection.empty ? state.selection.head : -1
    const decos: Decoration[] = []
    // Its LaTeX shows once the caret was put in it: a document just opened
    // has the caret at its start, in the title, and is not focused.
    const focused = viewRef?.hasFocus() ?? false
    const holds = (pos: number, node: PMNode) => focused && caret > pos && caret < pos + node.nodeSize
    const hideRaw = (pos: number, node: PMNode, extra = '') => {
      if (holds(pos, node)) return false
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-poster-mark', style: extra }))
      return true
    }
    const colors = tikzColors(meta)
    const vars = `--kt-tp-two:${colors.two};--kt-tp-border:${TP.border}pt;--kt-tp-pad:${TP.pad}pt;`
      + `--kt-tp-gap:${TP.gap}pt;--kt-tp-head:${TP.head}pt;--kt-tp-head-size:${TP.headSize}pt;--kt-tp-margin:${TP.margin}pt;`
    let inBlock = false
    let columnsDone = false
    let breakNext = false
    let seenColumn = false
    let titleDone = false
    state.doc.forEach((node, pos) => {
      const name = node.type.name
      const text = name === 'raw_latex' ? node.textContent : ''
      const span = columnsDone ? 'column-span:all;' : ''
      const brk = breakNext ? 'break-before:column;' : ''
      if (cls === 'tikzposter') {
        if (name === 'title' || name === 'author') {
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `kt-tp-titlebox kt-tp-${name}`, style: vars }))
          if (name === 'author' && !titleDone) {
            titleDone = true
            const inst = /\\institute\s*\{([^}]*)\}/.exec(meta.preamble_extras || '')?.[1]
            decos.push(Decoration.widget(pos + node.nodeSize - 1, () => {
              const el = document.createElement('div')
              el.className = 'kt-tp-institute'
              el.contentEditable = 'false'
              el.innerHTML = inst ? latexToHtml(inst, '#000') : ''
              return el
            }, { key: `tp-inst:${inst}`, side: 1, ignoreSelection: true }))
          }
          return
        }
        if (name === 'raw_latex') {
          if (/\\end\{columns\}/.test(text)) columnsDone = true
          if (/\\column\b/.test(text)) {
            if (seenColumn) breakNext = true
            seenColumn = true
          }
          if (MARK_RE.test(text)) { hideRaw(pos, node); return }
          const head = BLOCK_RE.exec(text)
          if (head) {
            inBlock = true
            const style = vars + brk + span
            breakNext = false
            if (holds(pos, node)) {
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-tp-head-source', style }))
              return
            }
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-tp-head', style }))
            decos.push(Decoration.widget(pos + 1, () => widget(latexToHtml(head[1], '#fff'), 'kt-tp-head-title', pos + 1, view),
              { key: `tp-head:${head[1]}`, side: -1 }))
            return
          }
          if (/^\s*\}\s*$/.test(text) && inBlock) {
            inBlock = false
            decos.push(Decoration.node(pos, pos + node.nodeSize, { class: holds(pos, node) ? 'kt-tp-foot kt-tp-foot-source' : 'kt-tp-foot', style: vars + span }))
            return
          }
        }
        if (inBlock) {
          const L = ls.layout.blocks.find(b => b.pos === pos)
          decos.push(Decoration.node(pos, pos + node.nodeSize, {
            class: 'kt-tp-body', style: vars + span + `margin-top:0;padding-top:${L?.gap ?? 0}px;`,
          }))
        } else if (span || brk) {
          decos.push(Decoration.node(pos, pos + node.nodeSize, { style: span + brk }))
          breakNext = false
        }
        return
      }
      // a0poster
      if (name !== 'raw_latex') return
      if (MARK_RE.test(text)) { hideRaw(pos, node); return }
      if (/^\s*\\begin\{center\}/.test(text) && !/\\begin\{tabular\}|\\begin\{tikzpicture\}/.test(text)) {
        if (holds(pos, node)) return
        const first = !titleDone
        titleDone = true
        decos.push(Decoration.node(pos, pos + node.nodeSize, {
          class: 'kt-poster-drawn', ...(first ? { 'data-span': '1', style: 'column-span:all;' } : {}),
        }))
        decos.push(Decoration.widget(pos + 1, () => widget(centerHtml(text), 'kt-poster-center', pos + 1, view),
          { key: `a0-center:${text}`, side: -1 }))
        return
      }
      const table = /\\begin\{tabular\}/.test(text) ? tabularHtml(text) : null
      if (table && !holds(pos, node)) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-poster-drawn' }))
        decos.push(Decoration.widget(pos + 1, () => widget(table, 'kt-poster-center', pos + 1, view),
          { key: `a0-table:${text}`, side: -1 }))
      }
    })
    return DecorationSet.create(state.doc, decos)
  }
  return new Plugin({
    key: posterKey,
    view(v) {
      viewRef = v
      return { destroy() { viewRef = null } }
    },
    props: { decorations: decorate },
  })
}
