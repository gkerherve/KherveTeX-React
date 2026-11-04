// The Home, Insert and Review commands that edit text in the Visual tab:
// MainWindow's QActions wired to DocumentEditor (editor.py) — clipboard,
// find, character formats, alignment, paragraph styles, lists, links,
// footnotes, cross-references, raw LaTeX blocks, theorems, highlights and
// comments.
import { NodeSelection } from 'prosemirror-state'
import { redo, undo } from 'prosemirror-history'
import * as M from '../../core/model.ts'
import { COMPILE_END, COMPILE_START, NOT_COMPILE_END, NOT_COMPILE_START } from '../../core/compiler.ts'
import { importBodyFragment } from '../../core/importers.ts'
import { dirname } from '../../core/paths.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import { showFindBar } from '../../ui/dialogs/FindBar.tsx'
import { promptItem, promptText } from '../../ui/dialogs/EditorDialogs.tsx'
import { setCommandChecked } from '../../ui/commands.ts'
import { hasAction, registerActions, type Handler } from '../actions.ts'
import { appStore } from '../store.ts'

const ed = () => editor()

function run(cmd: C.Command): boolean {
  return ed()?.run(cmd) ?? false
}

function status(msg: string): void {
  appStore().set({ status: msg })
}

// A checkable command whose state follows the caret, not the click.
function sync(): void {
  ed()?.syncToolbar()
}

const mark = (m: string): Handler => () => { run(C.toggleMark(m)); sync() }

async function clipboard(kind: 'cut' | 'copy'): Promise<void> {
  const e = ed()
  if (!e) return
  e.view.focus()
  document.execCommand(kind)
}

async function paste(): Promise<void> {
  const e = ed()
  if (!e) return
  e.view.focus()
  // Browsers only paste through a user gesture; the clipboard API reads it.
  try {
    const text = await navigator.clipboard.readText()
    if (text) e.view.pasteText(text)
  } catch {
    if (!document.execCommand('paste')) status('Use Ctrl+V to paste here.')
  }
}

// paste_options / paste_special.
async function pasteSpecial(): Promise<void> {
  const e = ed()
  if (!e) return
  let text = ''
  try { text = await navigator.clipboard.readText() } catch { /* no permission */ }
  const opts = text ? ['Keep Source Formatting', 'Keep Text Only', 'LaTeX (as document content)'] : []
  if (!opts.length) { status('The clipboard holds nothing to paste.'); return }
  const how = await promptItem('Paste Special', 'Paste as:', opts)
  if (how === null) return
  if (how === 'LaTeX (as document content)') {
    const blocks = importBodyFragment(text)
    if (blocks.length) run(C.insertModelBlocks(blocks))
  } else if (how === 'Keep Text Only') {
    run((s, d) => { d?.(s.tr.insertText(text)); return true })
  } else {
    e.view.pasteText(text)
  }
}

// insert_link via MainWindow._insert_link_with_hyperref: hyperref is
// added to the packages on first use.
async function insertLink(): Promise<void> {
  const e = ed()
  if (!e) return
  const url = await promptText('Insert link', 'URL:')
  if (!url) return
  const s = e.view.state
  const selected = s.doc.textBetween(s.selection.from, s.selection.to)
  const text = await promptText('Link text', 'Display text:', selected || url)
  if (text === null) return
  const meta = appStore().get().doc.meta
  if (!meta.packages.includes('hyperref')) {
    e.setMeta({ ...meta, packages: [...meta.packages, 'hyperref'] })
  }
  run(C.insertInlines([M.link(url, [M.text(text || url)])]))
}

async function insertFootnote(): Promise<void> {
  const note = await promptText('Insert footnote', 'Note text:', '', { multiline: true })
  if (note && note.trim()) run(C.insertInlines([M.footnote([M.text(note)])]))
}

// Double-click on a footnote: its text again.
async function editFootnote(): Promise<void> {
  const e = ed()
  const sel = e?.view.state.selection
  if (!e || !(sel instanceof NodeSelection) || sel.node.type.name !== 'footnote') return
  const plain = (n: M.Inline[]): string => n.map(x => x.type === 'Text' ? x.text : 'children' in x ? plain(x.children) : '').join('')
  const note = await promptText('Edit footnote', 'Note text:', plain(sel.node.attrs.children), { multiline: true })
  if (note === null) return
  const pos = sel.from
  run((s, d) => {
    d?.(s.tr.setNodeMarkup(pos, null, { children: [M.text(note)] }))
    return true
  })
}

async function insertCrossref(): Promise<void> {
  const label = await promptText('Cross-reference', 'Label:')
  if (!label) return
  const kind = await promptItem('Reference type', 'Command:', ['ref', 'eqref', 'pageref'])
  if (!kind) return
  run(C.insertInlines([M.crossRef(label, kind as M.CrossRef['kind'])]))
}

async function insertRawLatex(): Promise<void> {
  const text = await promptText('Insert raw LaTeX', 'LaTeX (verbatim):', '', { multiline: true })
  if (text && text.trim()) run(C.insertRawBlock(text))
}

// insert_code_block: the code wrapped in lstlisting.
async function insertCodeBlock(): Promise<void> {
  const text = await promptText('Insert code block', 'Code:', '', { multiline: true })
  if (!text || !text.trim()) return
  const body = text.replace(/\n+$/, '')
  run(C.insertRawBlock(`\\begin{lstlisting}\n${body}\n\\end{lstlisting}`))
}

// insert_multicol_region: a two-column region with placeholder text.
const MULTICOL = '\\begin{multicols}{2}\n'
  + 'Replace this paragraph with the content that should flow '
  + 'across two columns. Add as many paragraphs as you like — '
  + 'everything between \\begin{multicols} and \\end{multicols} '
  + 'is balanced into the two columns automatically.\n'
  + '\\end{multicols}'

// MainWindow._show_highlight_picker: the preset colours.
async function highlight(): Promise<void> {
  const e = ed()
  if (!e) return
  if (e.view.state.selection.empty) { status('Select the text to highlight first.'); return }
  const names = Object.keys(M.HIGHLIGHT_COLORS)
  const color = await promptItem('Highlight', 'Colour:', names.map(n => n[0].toUpperCase() + n.slice(1)))
  if (color) run(C.addHighlight(color.toLowerCase()))
}

// MainWindow._insert_comment: the author is the git user name.
async function comment(): Promise<void> {
  const e = ed()
  if (!e) return
  if (e.view.state.selection.empty) { status('Select the text to comment on first.'); return }
  const note = await promptText('New comment', 'Comment:', '', { multiline: true })
  if (!note || !note.trim()) return
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  run(C.addComment(note.trim(), commentAuthor ?? await gitAuthor(), ts))
}

let commentAuthor: string | null = null
// The name comments are signed with, overriding git's.
export function setCommentAuthor(name: string | null): void {
  commentAuthor = name
}

// MainWindow._insert_comment: the user's git identity for the document's
// repository (the enclosing one, else its folder), "" when there is none.
async function gitAuthor(): Promise<string> {
  const path = appStore().get().path
  if (!path) return ''
  try {
    const { git } = await import('../../platform/git.ts')
    const g = git()
    if (!g.isAvailable()) return ''
    const folder = dirname(path)
    const repo = (await g.findEnclosingRepo(folder)) ?? folder
    return (await g.defaultSignature(repo))?.name ?? ''
  } catch {
    return ''
  }
}

async function theoremTitle(): Promise<void> {
  const e = ed()
  if (!e) return
  const t = await promptText('Theorem name', 'Name shown in brackets (optional):', C.currentTheoremTitle(e.view.state))
  if (t !== null) run(C.setTheoremTitle(t.trim()))
}

let showMarks = false

const actions: Record<string, Handler> = {
  undo: () => { const e = ed(); if (e) { undo(e.view.state, e.view.dispatch); e.view.focus() } },
  redo: () => { const e = ed(); if (e) { redo(e.view.state, e.view.dispatch); e.view.focus() } },
  cut: () => clipboard('cut'),
  copy: () => clipboard('copy'),
  paste,
  paste_special: pasteSpecial,
  select_all: () => { run((s, d) => { d?.(s.tr.setSelection(C.selectAllSelection(s))); return true }) },
  clear_fmt: () => { run(C.clearFormatting); sync() },
  find: () => showFindBar(false),
  replace: () => showFindBar(true),

  bold: mark('bold'), italic: mark('italic'), underline: mark('underline'), strike: mark('strikethrough'),
  code: mark('code'), smallcaps: mark('smallcaps'), sub: mark('subscript'), super: mark('superscript'),

  align_left: () => { run(C.applyAlignment('left')); sync() },
  align_center: () => { run(C.applyAlignment('center')); sync() },
  align_right: () => { run(C.applyAlignment('right')); sync() },
  align_justify: () => { run(C.applyAlignment('justify')); sync() },

  // The Styles gallery and the hidden heading combo (apply_heading).
  style: lv => { run(C.applyHeading(Number(lv))); sync() },
  h_body: () => { run(C.applyHeading(0)); sync() },
  abstract: () => { run(C.applyHeading(-3)); sync() },
  keywords: () => { run(C.applyHeading(-4)); sync() },
  numbered_headings: on => { run(C.toggleHeadingNumbered(on !== false)); sync() },

  bullet: () => { run(C.toggleList(false)); sync() },
  numbered: () => { run(C.toggleList(true)); sync() },

  link: insertLink,
  footnote: insertFootnote,
  footnote_edit: editFootnote,
  crossref: insertCrossref,

  raw: insertRawLatex,
  code_block: insertCodeBlock,
  compile_start: () => { run(C.insertRawBlock(COMPILE_START)) },
  compile_end: () => { run(C.insertRawBlock(COMPILE_END)) },
  not_compile_start: () => { run(C.insertRawBlock(NOT_COMPILE_START)) },
  not_compile_end: () => { run(C.insertRawBlock(NOT_COMPILE_END)) },
  pagebreak: () => { run(C.insertRawBlock('\\newpage')) },
  hrule: () => { run(C.insertRawBlock('\\hrulefill')) },
  multicol: () => { run(C.insertRawBlock(MULTICOL)) },

  theorem: () => { run(C.insertTheorem('theorem')); sync() },
  thm_title: theoremTitle,

  highlight,
  remove_highlight: () => { run(C.removeHighlight) },
  comment,
  accept_comment: () => { run(C.acceptComment) },
  reject_comment: () => { run(C.rejectComment) },
  next_comment: () => { if (!run(C.findComment(true))) status('No more comments.') },
  prev_comment: () => { if (!run(C.findComment(false))) status('No more comments.') },

  // Word's ¶: spaces, tabs and paragraph ends shown; display only.
  show_marks: on => {
    showMarks = typeof on === 'boolean' ? on : !showMarks
    document.querySelector('.kt-flow')?.classList.toggle('kt-show-marks', showMarks)
    setCommandChecked('show_marks', showMarks)
  },
}

for (const [k] of [['theorem'], ['lemma'], ['proposition'], ['corollary'], ['definition'], ['example'], ['remark'], ['proof']]) {
  actions[`thm_insert_${k}`] = () => { run(C.insertTheorem(k)); sync() }
  actions[`thm_kind_${k}`] = () => { run(C.setTheoremKind(k)); sync() }
}

registerActions(actions)

// Equation entry points belong to src/app/actions/math.ts; until it has
// registered them the editor still answers with a plain LaTeX prompt.
setTimeout(() => {
  const fallback: Record<string, Handler> = {
    eq_edit: async () => {
      const e = ed()
      const latex = e ? editorLatex() : null
      if (!e || latex === null) return
      const fresh = await promptText('Edit equation', 'LaTeX:', latex, { multiline: true })
      if (fresh !== null) run(C.replaceMath(fresh))
    },
    math_inline: async () => {
      const latex = await promptText('Insert inline math', 'LaTeX:')
      if (latex) run(C.insertInlines([M.mathInline(latex)]))
    },
    math_block: async () => {
      const latex = await promptText('Insert math block', 'LaTeX:', '', { multiline: true })
      if (latex && latex.trim()) run(C.insertMathBlock(latex, true))
    },
  }
  for (const [id, h] of Object.entries(fallback)) if (!hasAction(id)) registerActions({ [id]: h })
}, 0)

function editorLatex(): string | null {
  const e = ed()
  if (!e) return null
  const s = e.view.state
  const m = C.currentMathBlock(s) ?? C.currentMathInline(s)
  return m ? m.node.attrs.latex : null
}
