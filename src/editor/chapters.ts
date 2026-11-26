// Chapters: the parts of one document (a thesis's chapters, an article's
// sections) - each heading at the document's top level and everything up
// to the next one. Each can be left out of the compile (between the
// not-compile markers, noCompile.ts) and folded away in the editor (shown
// as one bar, its blocks not laid out: a long thesis types lighter).
// The bar over each chapter heading and the Chapters window
// (app/actions/chapters.ts) both work through these commands.
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { setCompiled, topBlocks } from './noCompile.ts'

export interface Chapter {
  index: number
  title: string
  // Stable name for the folded list (title, and which one of that title).
  key: string
  // Its heading's position; `from` takes in a not-compile marker just
  // before it; `end` is where the next chapter starts.
  heading: number
  from: number
  end: number
  level: number
  paragraphs: number
  figures: number
  tables: number
  equations: number
  compiled: boolean
}

export function chapters(doc: PMNode): Chapter[] {
  const tops = topBlocks(doc)
  let level = Infinity
  for (const t of tops) if (t.node.type.name === 'section') level = Math.min(level, t.node.attrs.level as number)
  if (level === Infinity) return []
  const out: Chapter[] = []
  const seen = new Map<string, number>()
  tops.forEach((t, i) => {
    if (t.node.type.name !== 'section' || t.node.attrs.level !== level) return
    const title = t.node.textContent.trim() || 'Untitled'
    const n = (seen.get(title) ?? 0) + 1
    seen.set(title, n)
    const prev = tops[i - 1]
    const from = prev && prev.marker === 'start' && prev.paired ? prev.pos : t.pos
    if (out.length) out[out.length - 1].end = from
    out.push({ index: out.length, title, key: n > 1 ? `${title}#${n}` : title, heading: t.pos, from, end: doc.content.size, level,
      paragraphs: 0, figures: 0, tables: 0, equations: 0, compiled: true })
  })
  // What each holds, and whether it is compiled (all of it left out = not).
  for (const c of out) {
    let content = 0, hidden = 0
    for (const t of tops) {
      if (t.pos < c.from || t.pos >= c.end || t.marker) continue
      content++
      if (t.hidden) hidden++
      const name = t.node.type.name
      if (t.pos === c.heading) continue
      if (name === 'figure') c.figures++
      else if (name === 'table') c.tables++
      else if (name === 'math_block') c.equations++
      else if (name !== 'raw_latex' && name !== 'section') c.paragraphs++
    }
    c.compiled = !(content > 0 && hidden === content)
  }
  return out
}

// Compile a chapter, or leave it out.
export function setChapterCompiled(index: number, on: boolean) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const c = chapters(state.doc)[index]
    if (!c) return false
    if (dispatch) dispatch(setCompiled(state, topBlocks(state.doc), pos => pos >= c.from && pos < c.end, on))
    return true
  }
}

// Move chapter `index` to before chapter `before` (or to the end).
export function moveChapter(index: number, before: number | null) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const list = chapters(state.doc)
    const c = list[index]
    if (!c) return false
    const target = before === null ? state.doc.content.size : list[before]?.from
    if (target === undefined || (target >= c.from && target <= c.end)) return false
    if (dispatch) {
      const slice = state.doc.slice(c.from, c.end)
      const tr = state.tr.delete(c.from, c.end)
      tr.insert(tr.mapping.map(target), slice.content)
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

// ---- folding (the editor only; not saved in the document) ----

interface FoldState { folded: ReadonlySet<string> }
export const foldKey = new PluginKey<FoldState>('kt-chapters')

export function foldedChapters(state: EditorState): ReadonlySet<string> {
  return foldKey.getState(state)?.folded ?? new Set()
}

// Fold (or show) one chapter; the caret leaves what folds.
export function setChapterFolded(key: string, on: boolean) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    const folded = new Set(foldedChapters(state))
    if (on) folded.add(key); else folded.delete(key)
    if (dispatch) {
      const tr = state.tr.setMeta(foldKey, { folded }).setMeta('addToHistory', false)
      const c = chapters(state.doc).find(x => x.key === key)
      const head = state.selection.head
      if (on && c && head > c.heading + state.doc.nodeAt(c.heading)!.nodeSize && head < c.end) {
        tr.setSelection(TextSelection.near(tr.doc.resolve(c.heading + state.doc.nodeAt(c.heading)!.nodeSize - 1)))
      }
      dispatch(tr)
    }
    return true
  }
}

export function setFoldedChapters(keys: Iterable<string>) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
    dispatch?.(state.tr.setMeta(foldKey, { folded: new Set(keys) }).setMeta('addToHistory', false))
    return true
  }
}

// Told when the folded chapters change (the app keeps them per document).
export const chapterHooks = { onFold: (_keys: string[]) => {}, openWindow: () => {} }

function describe(c: Chapter): string {
  const parts: string[] = []
  const n = (k: number, one: string) => { if (k) parts.push(`${k} ${one}${k > 1 ? 's' : ''}`) }
  n(c.paragraphs, 'paragraph'); n(c.figures, 'figure'); n(c.tables, 'table'); n(c.equations, 'equation')
  return parts.join(', ') || 'empty'
}

function bar(view: EditorView, c: Chapter, folded: boolean): HTMLElement {
  const el = document.createElement('span')
  el.className = 'kt-ch-bar' + (folded ? ' folded' : '')
  el.contentEditable = 'false'
  const button = (text: string, title: string, run: () => void, cls = '') => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'kt-ch-btn ' + cls
    b.textContent = text
    b.title = title
    b.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); run(); view.focus() })
    el.appendChild(b)
  }
  if (folded) {
    const note = document.createElement('span')
    note.className = 'kt-ch-note'
    note.textContent = `Hidden: ${describe(c)}`
    el.appendChild(note)
  }
  button(folded ? 'Show' : 'Hide', folded ? 'Show this chapter in the editor again' : 'Fold this chapter away in the editor (it still compiles unless you untick Compile)',
    () => setChapterFolded(c.key, !folded)(view.state, view.dispatch))
  button(c.compiled ? '✓ Compile' : '✗ Not compiled', c.compiled ? 'Click to leave this chapter out of the PDF preview (Export keeps it)' : 'Click to compile this chapter again',
    () => setChapterCompiled(c.index, !c.compiled)(view.state, view.dispatch), c.compiled ? 'on' : 'off')
  button('Chapters…', 'All the chapters: compile, show, add, import, reorder', () => chapterHooks.openWindow())
  return el
}

function decorations(state: EditorState): DecorationSet {
  const list = chapters(state.doc)
  if (!list.length) return DecorationSet.empty
  const folded = foldedChapters(state)
  const decos: Decoration[] = []
  for (const c of list) {
    const isFolded = folded.has(c.key)
    const h = state.doc.nodeAt(c.heading)!
    decos.push(Decoration.node(c.heading, c.heading + h.nodeSize, { class: 'kt-chapter' + (isFolded ? ' kt-chapter-folded' : '') }))
    decos.push(Decoration.widget(c.heading + 1, view => bar(view, c, isFolded),
      { side: -1, ignoreSelection: true, key: `ch:${c.key}:${isFolded}:${c.compiled}:${describe(c)}:${c.index}` }))
    if (!isFolded) continue
    state.doc.forEach((node, pos) => {
      if (pos >= c.from && pos < c.end && pos !== c.heading) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-folded' }))
    })
  }
  return DecorationSet.create(state.doc, decos)
}

export function chaptersPlugin(): Plugin {
  return new Plugin<FoldState>({
    key: foldKey,
    state: {
      init: () => ({ folded: new Set() }),
      apply: (tr, prev) => {
        const m = tr.getMeta(foldKey) as FoldState | undefined
        if (m) { chapterHooks.onFold([...m.folded]); return m }
        return prev
      },
    },
    props: { decorations },
    // The caret never rests inside a folded chapter: it goes past it (moving
    // down) or to its heading (moving up).
    appendTransaction: (trs, old, state) => {
      if (!trs.some(t => t.selectionSet)) return null
      const folded = foldedChapters(state)
      if (!folded.size) return null
      const head = state.selection.head
      for (const c of chapters(state.doc)) {
        if (!folded.has(c.key)) continue
        const hEnd = c.heading + state.doc.nodeAt(c.heading)!.nodeSize
        if (head <= hEnd || head >= c.end) continue
        const down = head > old.selection.head
        const at = down ? Math.min(c.end, state.doc.content.size) : hEnd - 1
        return state.tr.setSelection(TextSelection.near(state.doc.resolve(at), down ? 1 : -1))
      }
      return null
    },
  })
}

// Back matter that stays last: the bibliography, the index.
const BACK_MATTER_RE = /^\s*\\(?:begin\{thebibliography\}|bibliography\{|bibliographystyle\{|printbibliography\b|printindex\b)/

// Where a new chapter goes: the end of the document, before any back
// matter (and the empty lines around it) that ends it.
export function chapterEnd(doc: PMNode): number | null {
  let at: number | null = null
  for (let i = doc.childCount - 1, pos = doc.content.size; i >= 0; i--) {
    const n = doc.child(i)
    pos -= n.nodeSize
    if (n.type.name === 'raw_latex' && BACK_MATTER_RE.test(n.textContent)) at = pos
    else if (!(n.type.name === 'paragraph' && !n.content.size)) break
  }
  return at
}
