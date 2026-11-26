// The Home, Insert and Review commands that edit text in the Visual tab:
// MainWindow's QActions wired to DocumentEditor (editor.py) — clipboard,
// find, character formats, alignment, paragraph styles, lists, links,
// footnotes, cross-references, raw LaTeX blocks, theorems, highlights and
// comments.
import './letter.ts'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { information } from '../../platform/MessageBox'
import { redo, undo } from 'prosemirror-history'
import * as M from '../../core/model.ts'
import { COMPILE_END, COMPILE_START, NOT_COMPILE_END, NOT_COMPILE_START } from '../../core/compiler.ts'
import { importBodyFragment } from '../../core/importers.ts'
import { dirname } from '../../core/paths.ts'
import * as C from '../../editor/commands.ts'
import { toggleNoCompile } from '../../editor/noCompile.ts'
import * as T from '../../editor/track.ts'
import { editor } from '../../editor/controller.ts'
import { showFindBar } from '../../ui/dialogs/FindBar.tsx'
import { askCrossRef, boxStyleDialog, promptItem, promptText, type CrossRefEntry } from '../../ui/dialogs/EditorDialogs.tsx'
import { documentLabels } from '../../core/labels.ts'
import { setCommandChecked } from '../../ui/commands.ts'
import { CALLOUT_MENU } from '../../ui/ribbonModel.ts'
import { hasAction, registerActions, type Handler } from '../actions.ts'
import { appStore } from '../store.ts'
import { setSetting, setting } from '../../platform/settings'
import { pickColor, SHADES } from './table.ts'
const PARA_SHADES = SHADES.map(([c]) => c)

const ed = () => editor()

// Accept / Reject a tracked change (this one or all), else the comment
// there; what was settled goes into the review log.
function decide(accept: boolean, all: boolean): boolean {
  const e = editor()
  if (!e) return false
  const state = e.view.state
  const by = userName() || 'Author'
  const at = new Date().toISOString()
  const decision = accept ? 'accepted' : 'rejected'
  const changes = T.changesToSettle(state, all)
  let entries: M.ReviewEntry[] = changes.map(c => ({
    decision, kind: c.kind === 'ins' ? 'insertion' : 'deletion', text: c.text, author: c.author, ...(c.time ? { made: c.time } : {}), by, at,
  }))
  let ok = run(all ? (accept ? T.acceptAllChanges : T.rejectAllChanges) : (accept ? T.acceptChange : T.rejectChange))
  if (!ok && !all) {
    const c = C.commentToSettle(state)
    ok = run(accept ? C.acceptComment : C.rejectComment)
    entries = ok && c ? [{ decision, kind: 'comment', text: c.text, ...(c.note ? { note: c.note } : {}), author: c.author, ...(c.time ? { made: c.time } : {}), by, at }] : []
  }
  if (ok && entries.length) {
    const ed = editor()
    if (ed) ed.setMeta({ ...ed.meta, review_log: [...(ed.meta.review_log ?? []), ...entries] })
  }
  return ok
}

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
  // A picture on the clipboard (a screenshot) becomes a figure.
  const { clipboardPicture, insertPictures } = await import('../pictures.ts')
  const pic = await clipboardPicture()
  if (pic) { await insertPictures([pic]); return }
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
  const { clipboardPicture, insertPictures } = await import('../pictures.ts')
  const pic = text.trim() ? null : await clipboardPicture()
  const opts = text ? ['Keep Source Formatting', 'Keep Text Only', 'LaTeX (as document content)'] : []
  if (pic) opts.push('Picture')
  if (!opts.length) { status('The clipboard holds nothing to paste.'); return }
  const how = await promptItem('Paste Special', 'Paste as:', opts)
  if (how === null) return
  if (how === 'Picture' && pic) {
    await insertPictures([pic])
  } else if (how === 'LaTeX (as document content)') {
    const blocks = importBodyFragment(text,
      { hasChapters: M.classSupportsChapter(appStore().get().doc.meta.documentclass) })
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
  const put = (c: { label: string, kind: M.CrossRef['kind'] }) => { run(C.insertInlines([M.crossRef(c.label, c.kind)])) }
  // Every figure, table, numbered equation and heading, labelled or not
  // (one without a label gets one when it is picked), then the labels
  // only raw LaTeX defines.
  const { currentReferables, ensureLabel } = await import('../captions.ts')
  const refs = currentReferables()
  const entries: CrossRefEntry[] = refs.map(r => ({
    key: `#${r.index}`, label: r.label ?? '', kind: r.kind, number: r.number, text: r.text,
  }))
  const have = new Set(entries.map(e => e.label).filter(Boolean))
  for (const l of documentLabels(appStore().get().doc)) if (!have.has(l.label)) entries.push(l)
  const resolve = (e: CrossRefEntry) => {
    const r = refs.find(x => `#${x.index}` === e.key)
    return r ? ensureLabel(r) : e.label
  }
  const r = await askCrossRef(entries, put, resolve)
  if (r) put(r)
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

// Highlight: the colour chosen last (yellow at first), straight away, as
// Word's button; the arrow beside it picks another.
let lastHighlight = 'yellow'
async function highlight(): Promise<void> {
  const e = ed()
  if (!e) return
  if (e.view.state.selection.empty) { status('Select the text to highlight first.'); return }
  run(C.addHighlight(lastHighlight))
}

// MainWindow._insert_comment: the author is the git user name.
async function comment(): Promise<void> {
  const e = ed()
  if (!e) return
  // Nothing selected: the word at the caret, as Word comments on it.
  if (e.view.state.selection.empty) {
    const st = e.view.state
    const $at = st.selection.$from
    if ($at.parent.isTextblock) {
      const text = $at.parent.textBetween(0, $at.parent.content.size, '\ufffc', '\ufffc')
      let a = $at.parentOffset, b = $at.parentOffset
      const word = /[\p{L}\p{N}'’_-]/u
      while (a > 0 && word.test(text[a - 1])) a--
      while (b < text.length && word.test(text[b])) b++
      // Between two words or at a line end: the word just before.
      if (a === b) {
        while (a > 0 && !word.test(text[a - 1])) a--
        b = a
        while (a > 0 && word.test(text[a - 1])) a--
      }
      if (a < b) {
        const start = $at.start()
        e.view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, start + a, start + b)))
      }
    }
    if (e.view.state.selection.empty) {
      await information('New comment', 'Click in a word or select the text you want to comment on, then press New comment.')
      return
    }
  }
  const note = await promptText('New comment', 'Comment:', '', { multiline: true })
  if (!note || !note.trim()) return
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  run(C.addComment(note.trim(), commentAuthor ?? await yourNameOrAsk(), ts))
}

// The name comments and reviews are signed with (Settings ▸ Your name),
// kept in the settings. Asked once, on the first comment, with the git
// user name offered.
export const USER_NAME_KEY = 'user/name'

export function userName(): string {
  return String(setting(USER_NAME_KEY, '') ?? '').trim()
}

async function askYourName(first: boolean): Promise<string | null> {
  const current = userName() || await gitAuthor()
  const r = await promptText('Your name',
    first ? 'Your name, shown on your comments and reviews (you can change it later in Settings, the gear beside Help):'
      : 'Your name, shown on your comments and reviews:', current)
  if (r === null) return null
  setSetting(USER_NAME_KEY, r.trim())
  status(r.trim() ? `Comments are now signed “${r.trim()}”.` : 'Comments are now unsigned.')
  return r.trim()
}

async function yourNameOrAsk(): Promise<string> {
  const name = userName()
  if (name) return name
  return (await askYourName(true)) ?? await gitAuthor()
}

let commentAuthor: string | null = null
// The name comments are signed with, overriding git's.
export function setCommentAuthor(name: string | null): void {
  commentAuthor = name
}

// MainWindow._insert_comment: the user's git identity for the document's
// repository (the enclosing one, else its folder), "" when there is none.
export async function gitAuthor(): Promise<string> {
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

// Insert > Box > Custom: the name, then the colour, both your own.
async function insertCustomBox(): Promise<void> {
  if (!ed()) return
  const r = await boxStyleDialog('Custom box', '#455A64', '')
  if (!r) return
  run(C.insertCustomBox(r.name, r.color)); sync()
}

async function boxTitle(): Promise<void> {
  const e = ed()
  if (!e) return
  const t = await promptText('Box title', 'Text in the title bar (empty: the box\'s own, e.g. "Note"):', C.currentTheoremTitle(e.view.state))
  if (t !== null) run(C.setTheoremTitle(t.trim()))
}

async function theoremTitle(): Promise<void> {
  const e = ed()
  if (!e) return
  const t = await promptText('Theorem name', 'Name shown in brackets (optional):', C.currentTheoremTitle(e.view.state))
  if (t !== null) run(C.setTheoremTitle(t.trim()))
}

let showMarks = false
let latexSource = false
export const showLatexSource = () => latexSource
export function setShowLatexSource(on: boolean): void {
  latexSource = on
  document.body.classList.toggle('kt-latex-source', on)
  setCommandChecked('show_latex_source', on)
}

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
  // Word's Paragraph group: list styles, indent, sort, spacing, shading, borders.
  multilevel: () => { run(C.setListStyle(true, 'legal')); sync() },
  // Word's Font group.
  grow_font: () => { run(C.growFont(true, ed()?.meta.body_font_pt ?? 12)); sync() },
  shrink_font: () => { run(C.growFont(false, ed()?.meta.body_font_pt ?? 12)); sync() },
  change_case: () => {},
  font_color: () => { run(C.setValueMark('textcolor', { color: lastFontColor })); sync() },
  'fcolor:auto': () => { run(C.setValueMark('textcolor', null)); sync() },
  fcolor_more: async () => {
    const c = await pickColor('#' + lastFontColor)
    if (c) { lastFontColor = c.replace('#', '').toUpperCase(); run(C.setValueMark('textcolor', { color: lastFontColor })); sync() }
  },
  'uline:single': () => { run(C.setValueMark('ulinestyle', null)); run(C.addMarkCmd('underline')); sync() },
  indent_dec: () => { run(C.changeIndent(-1)); sync() },
  indent_inc: () => { run(C.changeIndent(1)); sync() },
  sort_paras: () => { if (!run(C.sortParagraphs(false))) status('Put the caret in a list, or select two or more paragraphs, to sort them.') },
  'sort_paras:desc': () => { if (!run(C.sortParagraphs(true))) status('Put the caret in a list, or select two or more paragraphs, to sort them.') },
  line_spacing: () => {},
  para_shading: () => { run(C.setParagraphAttrs({ shade: lastParaShade })); sync() },
  'pshade:none': () => { run(C.setParagraphAttrs({ shade: null })); sync() },
  pshade_more: async () => {
    const c = await pickColor(lastParaShade)
    if (c) { lastParaShade = c; run(C.setParagraphAttrs({ shade: c })); sync() }
  },
  para_borders: () => { run(C.setParagraphAttrs({ border: lastBorder })); sync() },

  link: insertLink,
  footnote: insertFootnote,
  footnote_edit: editFootnote,
  crossref: insertCrossref,
  // References ▸ Captions & labels.
  captions: async () => {
    const { askCaptions } = await import('../../ui/dialogs/CaptionManager.tsx')
    const { currentReferables, setCaptionAndLabel, labelForCaption, goTo } = await import('../captions.ts')
    const items = currentReferables()
    const r = await askCaptions(items)
    if (!r) return
    for (const ed of r.edits) {
      const item = items.find(x => x.index === ed.index)
      // A caption left without a label gets one, so it can be referred to.
      let label = ed.label
      if (!label && ed.caption && item && (item.kind === 'figure' || item.kind === 'table')) {
        label = labelForCaption(item.kind, ed.caption)
      }
      setCaptionAndLabel(ed.index, ed.caption, label || null)
    }
    if (r.goTo !== null) goTo(r.goTo)
  },

  raw: insertRawLatex,
  code_block: insertCodeBlock,
  compile_start: () => { run(C.insertRawBlock(COMPILE_START)) },
  compile_end: () => { run(C.insertRawBlock(COMPILE_END)) },
  not_compile_start: () => { run(C.insertRawBlock(NOT_COMPILE_START)) },
  no_compile: () => { run(toggleNoCompile) },
  not_compile_end: () => { run(C.insertRawBlock(NOT_COMPILE_END)) },
  pagebreak: () => { run(C.insertRawBlock('\\newpage')) },
  hrule: () => { run(C.insertRawBlock('\\hrulefill')) },
  multicol: () => { run(C.insertRawBlock(MULTICOL)) },

  theorem: () => { run(C.insertTheorem('theorem')); sync() },
  thm_title: theoremTitle,
  callout: () => { run(C.insertTheorem('note')); sync() },
  box_title: boxTitle,
  box_insert_custom: insertCustomBox,
  // The box's name and colour in one dialog: the Box tab, a click on its
  // title bar, its right-click menu.
  box_style: async () => {
    const e = ed()
    if (!e) return
    const st = e.view.state
    const kind = C.currentTheoremKind(st)
    if (!M.isCallout(kind)) return
    const own = C.currentTheoremTitle(st)
    const r = await boxStyleDialog('Box name and colour', C.currentCalloutColor(st) || '#455A64', own || M.CALLOUT_KINDS[kind].name)
    if (!r) return
    // The type's own name and colour stay "its own" (they follow the type).
    const name = r.name === M.CALLOUT_KINDS[kind].name ? '' : r.name
    const color = r.color.replace('#', '').toUpperCase() === M.CALLOUT_KINDS[kind].color && !C.currentCalloutOwnColor(st) ? null : r.color
    run(C.setCalloutStyle(name, color)); sync()
  },
  block_up: () => { if (!run(C.moveBlock(-1))) status('Put the cursor in a box, theorem, table or element to move it.') },
  block_down: () => { if (!run(C.moveBlock(1))) status('Put the cursor in a box, theorem, table or element to move it.') },
  box_remove: () => { run(C.removeCallout); sync() },
  box_delete: () => { run(C.deleteCallout); sync() },
  box_para_after: () => { run(C.paragraphAfterCallout); sync() },
  // The Theorem tab: the same as a box's, for a theorem, lemma, proof...
  thm_proof_after: () => { run(C.proofAfterTheorem); sync() },
  thm_text_after: () => { run(C.paragraphAfterCallout); sync() },
  thm_remove: () => { run(C.removeCallout); sync() },
  thm_delete: () => { run(C.deleteCallout); sync() },
  box_color: async () => {
    const e = ed()
    if (!e) return
    const r = await boxStyleDialog('Box colour', C.currentCalloutColor(e.view.state) || '#455A64', null)
    if (r) { run(C.setCalloutColor(r.color)); sync() }
  },

  highlight,
  remove_highlight: () => { run(C.removeHighlight) },
  comment,
  your_name: () => { void askYourName(false) },
  // Accept / Reject: the tracked change at the caret (or in the
  // selection), else the comment there, as Word's Accept does both.
  // Each decision goes into the document's Review log (Review ▸ Decisions).
  accept_comment: () => { decide(true, false) },
  reject_comment: () => { decide(false, false) },
  review_log: async () => {
    const e = editor()
    if (!e) return
    const { reviewLogDialog } = await import('../../ui/dialogs/ReviewLogDialog.tsx')
    await reviewLogDialog(e.meta.review_log ?? [], () => {
      const ed = editor()
      if (!ed) return
      const { review_log: _, ...rest } = ed.meta
      void _
      ed.setMeta(rest)
    })
  },
  accept_all: () => { if (!decide(true, true)) status('No tracked changes.') },
  reject_all: () => { if (!decide(false, true)) status('No tracked changes.') },
  next_change: () => { if (!run(T.gotoChange(true))) status('No tracked changes.') },
  prev_change: () => { if (!run(T.gotoChange(false))) status('No tracked changes.') },
  track_changes: async on => {
    const e = ed()
    if (!e) return
    const want = typeof on === 'boolean' ? on : !e.meta.track_changes
    if (want) T.setTrackAuthor(userName() || await gitAuthor())
    e.setMeta({ ...e.meta, track_changes: want || undefined })
    setCommandChecked('track_changes', want)
    status(want ? 'Track Changes is on: what you type and delete is marked.' : 'Track Changes is off.')
  },
  markup_view: () => {},
  markup_comments: on => {
    const show = on !== false
    for (const el of document.querySelectorAll('.ProseMirror')) el.classList.toggle('kt-hide-comments', !show)
    setCommandChecked('markup_comments', show)
  },
  markup_insdel: on => {
    const e = ed()
    if (!e) return
    const show = on !== false
    e.setMeta({ ...e.meta, markup: show ? undefined : 'simple' })
    setCommandChecked('markup_insdel', show)
  },
  next_comment: () => { if (!run(C.findComment(true))) status('No more comments.') },
  prev_comment: () => { if (!run(C.findComment(false))) status('No more comments.') },

  // Raw LaTeX in the text as its source, not as the PDF shows it.
  show_latex_source: on => { setShowLatexSource(typeof on === 'boolean' ? on : !showLatexSource()) },
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

for (const [k] of CALLOUT_MENU) {
  if (k !== 'custom') actions[`box_insert_${k}`] = () => { run(C.insertTheorem(k)); sync() }
  actions[`box_kind_${k}`] = () => { run(C.setTheoremKind(k)); sync() }
}

for (const [k, mode] of [['all', undefined], ['simple', 'simple'], ['none', 'none'], ['original', 'original']] as const) {
  actions[`markup:${k}`] = () => {
    const e = ed()
    if (!e) return
    e.setMeta({ ...e.meta, markup: mode })
    for (const x of ['all', 'simple', 'none', 'original']) setCommandChecked(`markup:${x}`, x === k)
    setCommandChecked('markup_insdel', k === 'all')
  }
}
let lastFontColor = 'C00000'
export const FONT_COLORS: [string, string][] = [['000000', 'Black'], ['C00000', 'Dark red'], ['FF0000', 'Red'], ['FFC000', 'Orange'],
  ['FFFF00', 'Yellow'], ['92D050', 'Light green'], ['00B050', 'Green'], ['00B0F0', 'Light blue'], ['0070C0', 'Blue'],
  ['002060', 'Dark blue'], ['7030A0', 'Purple'], ['7F7F7F', 'Grey']]
for (const [c] of FONT_COLORS) actions[`fcolor:${c}`] = () => { lastFontColor = c; run(C.setValueMark('textcolor', { color: c })); sync() }
for (const st of ['double', 'wave', 'dotted', 'dashed']) actions[`uline:${st}`] = () => { run(C.setValueMark('ulinestyle', { style: st })); sync() }
for (const k of ['sentence', 'lower', 'upper', 'capitalize', 'toggle'] as const) {
  actions[`case:${k}`] = () => { if (!run(C.changeCase(k))) status('Select the text to change first.') }
}
for (const name of Object.keys(M.HIGHLIGHT_COLORS)) {
  actions[`hl:${name}`] = () => { lastHighlight = name; if (!run(C.addHighlight(name))) status('Select the text to highlight first.') }
}
let lastParaShade = '#FFEB3B'
let lastBorder = 'bottom'
for (const st of ['disc', 'circle', 'square', 'dash', 'arrow', 'check', 'diamond']) {
  actions[`bullet_style:${st}`] = () => { run(C.setListStyle(false, st)); sync() }
}
for (const st of ['arabic', 'paren', 'alpha', 'alphaparen', 'Alpha', 'roman', 'Roman']) {
  actions[`num_style:${st}`] = () => { run(C.setListStyle(true, st === 'arabic' ? '' : st)); sync() }
}
actions['multilevel:legal'] = () => { run(C.setListStyle(true, 'legal')); sync() }
actions['multilevel:default'] = () => { run(C.setListStyle(true, '')); sync() }
actions['multilevel:bullets'] = () => { run(C.setListStyle(false, '')); sync() }
for (const v of [1.0, 1.15, 1.5, 2.0, 2.5, 3.0]) {
  actions[`spacing:${v}`] = () => { run(C.setParagraphAttrs({ spacing: v === 1 ? null : v })); sync() }
}
for (const c of PARA_SHADES) actions[`pshade:${c}`] = () => { lastParaShade = c; run(C.setParagraphAttrs({ shade: c })); sync() }
for (const b of ['bottom', 'top', 'topbottom', 'box']) {
  actions[`border:${b}`] = () => { lastBorder = b; run(C.setParagraphAttrs({ border: b })); sync() }
}
for (const f of ['left_cm', 'right_cm', 'before_pt', 'after_pt']) {
  actions[`parafield:${f}`] = v => { run(C.setParagraphAttrs({ [f]: Math.max(0, Number(v) || 0) })); sync() }
}
actions['border:none'] = () => { run(C.setParagraphAttrs({ border: null })); sync() }

T.setTrackAuthorSource(() => userName())
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
