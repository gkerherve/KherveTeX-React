// A thebibliography block shown as the reference list LaTeX prints,
// while staying the RawLatex text it is (the .ktex and the LaTeX do not
// change): decorations hide the markup (\begin / \end, \bibitem{key},
// \emph{ … }) and style what it wraps, a widget draws the title and each
// entry's "[n]" label hanging in the margin. The entry holding the caret
// shows its LaTeX, so it is edited in place; the Bibliography dialog
// (References ▸ Bibliography, or a double-click) edits the list as a whole.
// The text stays line by line in the page, so a long list breaks across
// sheets as any paragraph does.
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { CharStyle } from './layout.ts'
import { charCss, layoutKey } from './plugins.ts'

export const bibKey = new PluginKey('kt-bib')

const BEGIN_RE = /\\begin\{thebibliography\}\s*\{[^}]*\}[^\S\n]*\n?/
const END_RE = /\s*\\end\{thebibliography\}[\s\S]*$/
const ITEM_RE = /\\bibitem\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}[^\S\n]*/g
// Commands whose argument is shown, styled; their name and braces hidden.
const STYLED: Record<string, string> = {
  emph: 'font-style:italic', textit: 'font-style:italic', textsl: 'font-style:italic',
  textbf: 'font-weight:700', textsc: 'font-variant:small-caps', textrm: '', textup: 'font-style:normal',
  url: 'word-break:break-all', mbox: '', text: '', textsuperscript: 'vertical-align:super;font-size:0.75em',
}
const CMD_RE = /\\([A-Za-z]+)\s*\{/g
const HIDDEN_CMD_RE = /\\newblock\b\s*|\\(?:small|footnotesize|normalsize|sloppy|raggedright)\b\s*/g

// The index after the brace group opening at `open`, or -1.
function closeBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue }
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

interface BlockDecos {
  decos: Decoration[]
}

function titleEl(title: string, c: CharStyle | null, pos: number, view: () => EditorView | null): HTMLElement {
  const el = document.createElement('div')
  el.className = 'kt-bib-title'
  el.contentEditable = 'false'
  el.textContent = title
  if (c) el.setAttribute('style', charCss(c))
  el.title = 'Double-click to edit the bibliography'
  el.addEventListener('dblclick', e => {
    e.preventDefault()
    const v = view()
    if (v) v.dom.dispatchEvent(new CustomEvent('kt-bibliography', { bubbles: true, detail: { pos } }))
  })
  return el
}

function labelEl(text: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'kt-bib-label'
  el.contentEditable = 'false'
  el.textContent = text
  return el
}

// Decorations for one bibliography block at `pos` (its text starts at
// pos + 1). `caret` is the selection head, or -1.
function blockDecos(node: PMNode, pos: number, caret: number, title: string, titleChar: CharStyle | null,
  bodyChar: CharStyle | null, view: () => EditorView | null): BlockDecos {
  const text = node.textContent
  const base = pos + 1
  const decos: Decoration[] = []
  const hide = (from: number, to: number) => {
    if (to > from) decos.push(Decoration.inline(base + from, base + to, { class: 'kt-bib-hide' }))
  }
  const b = BEGIN_RE.exec(text)
  if (!b) return { decos }
  const items = [...text.matchAll(ITEM_RE)].filter(m => m.index! >= b.index + b[0].length)
  const endM = END_RE.exec(text)
  const end = endM ? endM.index : text.length
  const widest = items.reduce((w, m, i) => Math.max(w, (m[1] || `[${i + 1}]`).length), 3)
  const labelW = `${widest * 0.62 + 0.8}em`
  decos.push(Decoration.node(pos, pos + node.nodeSize, {
    class: 'kt-bib-view',
    style: (bodyChar ? charCss(bodyChar) : '') + `--kt-bib-label:${labelW};`,
  }))
  // The \begin line (and anything before the first item) gives way to
  // the title.
  const firstItem = items.length ? items[0].index! : end
  decos.push(Decoration.widget(base + b.index, () => titleEl(title, titleChar, pos, view),
    { key: `bib-title:${pos}:${title}:${JSON.stringify(titleChar)}`, side: -1, ignoreSelection: true }))
  hide(0, firstItem)
  items.forEach((m, i) => {
    const start = m.index!
    const next = i + 1 < items.length ? items[i + 1].index! : end
    // The entry's text runs to its last non-space character; what follows
    // (blank lines) collapses to the one line break.
    const body = text.slice(start, next)
    const contentEnd = start + body.trimEnd().length
    const editing = caret >= base + start && caret <= base + next
    const label = m[1] || `[${i + 1}]`
    if (editing) {
      decos.push(Decoration.inline(base + start, base + contentEnd, { class: 'kt-bib-source' }))
    } else {
      decos.push(Decoration.widget(base + start, () => labelEl(label), { key: `bib-label:${label}`, side: -1 }))
      hide(start, start + m[0].length)
      const inner = text.slice(start + m[0].length, contentEnd)
      const off = start + m[0].length
      for (const h of inner.matchAll(HIDDEN_CMD_RE)) hide(off + h.index!, off + h.index! + h[0].length)
      for (const c of inner.matchAll(CMD_RE)) {
        const style = STYLED[c[1]]
        if (style === undefined) continue
        const open = c.index! + c[0].length - 1
        const close = closeBrace(inner, open)
        if (close < 0) continue
        hide(off + c.index!, off + open + 1)
        if (style && close > open + 1) {
          decos.push(Decoration.inline(base + off + open + 1, base + off + close, { style }))
        }
        hide(off + close, off + close + 1)
      }
      // TeX's own brace groups ({\"o}, {DNA}) print without their
      // braces; \& \% \_ \# \$ without the backslash, and the logos
      // (\TeX, \LaTeX) as their names.
      for (let k = 0; k < inner.length; k++) {
        const ch = inner[k]
        if (ch === '\\') {
          const logo = /^\\(?:La)?TeX\b|^\\[&%_#$]/.exec(inner.slice(k))
          if (logo) hide(off + k, off + k + 1)
          k++
          continue
        }
        if (ch === '{' || ch === '}') hide(off + k, off + k + 1)
      }
    }
    // Keep one line break after the entry, hide the rest of the gap.
    const gap = text.slice(contentEnd, next)
    const nl = gap.indexOf('\n')
    if (i + 1 < items.length) hide(contentEnd + (nl >= 0 ? nl + 1 : gap.length), next)
  })
  hide(items.length ? start0(items, text, end) : end, text.length)
  return { decos }
}

// Where the hidden \end{thebibliography} tail starts: after the last
// entry's text.
function start0(items: RegExpMatchArray[], text: string, end: number): number {
  const last = items[items.length - 1].index!
  return last + text.slice(last, end).trimEnd().length
}

export function bibliographyPlugin(): Plugin {
  let viewRef: EditorView | null = null
  const decorate = (state: EditorState): DecorationSet => {
    const layout = layoutKey.getState(state)?.layout
    const caret = state.selection.empty ? state.selection.head : -1
    const decos: Decoration[] = []
    state.doc.forEach((node, offset) => {
      if (node.type.name !== 'raw_latex' || !node.textContent.includes('\\begin{thebibliography}')) return
      const L = layout?.blocks.find(b => b.pos === offset)
      const bib = L?.bib
      decos.push(...blockDecos(node, offset, caret, bib?.title ?? 'References', bib?.titleChar ?? null,
        bib?.bodyChar ?? null, () => viewRef).decos)
    })
    return DecorationSet.create(state.doc, decos)
  }
  return new Plugin({
    key: bibKey,
    view(v) {
      viewRef = v
      return { destroy() { viewRef = null } }
    },
    props: {
      decorations: decorate,
    },
  })
}
