// The Design tab (themes, style sets, colours, fonts, paragraph spacing,
// watermark, page colour and borders) and Insert ▸ Contents (tables of
// contents, figures and tables).
import type { DocMeta } from '../../core/model.ts'
import {
  COLOR_SETS, FONT_SETS, PAGE_BORDERS, SPACING_SETS, STYLE_SETS, THEMES, WATERMARKS, type Design, type StyleSet,
} from '../../core/design.ts'
import { editor } from '../../editor/controller.ts'
import * as C from '../../editor/commands.ts'
import { schema } from '../../editor/schema.ts'
import { tocBlock, tocLatex, type TocKind } from '../../editor/toc.ts'
import { promptText } from '../../ui/dialogs/EditorDialogs.tsx'
import { setCommandChecked } from '../../ui/commands.ts'
import { setSetting, setting } from '../../platform/settings'
import { registerActions, runAction, type Handler } from '../actions.ts'
import { appStore, editDoc } from '../store.ts'
import { pickColor } from './table.ts'

function meta(): DocMeta {
  return appStore().get().doc.meta
}

function setMeta(next: DocMeta): void {
  const e = editor()
  if (e) e.setMeta(next)
  else editDoc({ ...appStore().get().doc, meta: next })
  syncDesignChecks(next)
}

// The design with `patch` applied; empty values are dropped, so a file
// keeps no design it does not use.
function withDesign(m: DocMeta, patch: Partial<Design>): DocMeta {
  const d: Record<string, unknown> = { ...(m.design ?? {}), ...patch }
  for (const k of Object.keys(d)) if (d[k] === undefined || d[k] === '' || d[k] === null) delete d[k]
  const { design: _, ...rest } = m
  void _
  return Object.keys(d).length ? { ...rest, design: d as Design } : rest
}

function setDesign(patch: Partial<Design>, extra: Partial<DocMeta> = {}): void {
  setMeta(withDesign({ ...meta(), ...extra }, patch))
}

export function syncDesignChecks(m: DocMeta = meta()): void {
  const d = m.design ?? {}
  for (const [k] of THEMES) setCommandChecked(`theme:${k}`, (d.theme ?? 'latex') === k)
  for (const [k] of COLOR_SETS) setCommandChecked(`colors:${k}`, d.colors === k)
  for (const [k, , fam, head] of FONT_SETS) {
    setCommandChecked(`fonts:${k}`, m.body_font_family === fam && (d.heading_font ?? 'serif') === head)
  }
  for (const [k, , indent, sp, ls] of SPACING_SETS) {
    setCommandChecked(`pspacing:${k}`, m.paragraph_indent === indent && (d.para_space_pt ?? 0) === sp && m.line_spacing === ls)
  }
  for (const w of WATERMARKS) setCommandChecked(`watermark:${w}`, d.watermark === w)
  setCommandChecked('pageborder:none', !d.page_border)
  for (const [k] of PAGE_BORDERS) setCommandChecked(`pageborder:${k}`, d.page_border === k)
}

// ---------- Insert ▸ Contents ----------

function hasChapters(): boolean {
  const e = editor()
  let c = false
  e?.view.state.doc.forEach(n => { if (n.type.name === 'section' && n.attrs.level === 0) c = true })
  return c
}

// A table of `kind` at the caret, or the one already in the document
// replaced (Word keeps one table of contents).
function insertList(kind: TocKind, depth: number | null): void {
  const e = editor()
  if (!e) return
  const latex = tocLatex(kind, depth)
  const st = e.view.state
  let at = -1, size = 0
  st.doc.forEach((n, pos) => { if (at < 0 && n.type.name === 'raw_latex' && tocBlock(n.textContent)?.kind === kind) { at = pos; size = n.nodeSize } })
  if (at >= 0) {
    e.view.dispatch(st.tr.replaceWith(at, at + size, schema.nodes.raw_latex.create(null, schema.text(latex))).scrollIntoView())
  } else {
    C.insertRawBlock(latex)(st, tr => e.view.dispatch(tr))
  }
  e.view.focus()
}

function removeList(kind: TocKind): void {
  const e = editor()
  if (!e) return
  const st = e.view.state
  const spots: [number, number][] = []
  st.doc.forEach((n, pos) => { if (n.type.name === 'raw_latex' && tocBlock(n.textContent)?.kind === kind) spots.push([pos, pos + n.nodeSize]) })
  if (!spots.length) return
  const tr = st.tr
  for (const [a, b] of spots.reverse()) tr.delete(a, b)
  e.view.dispatch(tr)
}

const actions: Record<string, Handler> = {
  toc: () => insertList('tableofcontents', hasChapters() ? 2 : 3),
  update_toc: () => runAction('compile_now'),
  remove_toc: () => removeList('tableofcontents'),
  table_of_figures: () => insertList('listoffigures', null),
  'tof:figures': () => insertList('listoffigures', null),
  'tof:tables': () => insertList('listoftables', null),
  'remove_tof:figures': () => removeList('listoffigures'),
  'remove_tof:tables': () => removeList('listoftables'),

  // ---------- Design ----------
  'colors:none': () => setDesign({ colors: undefined }),
  watermark_custom: async () => {
    const t = await promptText('Custom Watermark', 'Text:', meta().design?.watermark ?? '')
    if (t !== null && t !== undefined) setDesign({ watermark: t.trim() || undefined })
  },
  watermark_none: () => setDesign({ watermark: undefined }),
  'pagecolor:none': () => setDesign({ page_color: undefined }),
  pagecolor_more: async () => {
    const c = await pickColor(meta().design?.page_color ?? '#FFF2CC')
    if (c) setDesign({ page_color: c })
  },
  'pageborder:none': () => setDesign({ page_border: undefined }),
  set_default: () => {
    const m = meta()
    setSetting('design_default', {
      design: m.design ?? {}, body_font_family: m.body_font_family,
      line_spacing: m.line_spacing, paragraph_indent: m.paragraph_indent,
    })
  },
}
for (const lv of [1, 2, 3]) actions[`toc:${lv}`] = () => insertList('tableofcontents', hasChapters() ? lv - 1 : lv)
for (const [k] of STYLE_SETS) actions[`styleset:${k}`] = () => setDesign({ style_set: k === 'default' ? undefined : k })
for (const [k] of COLOR_SETS) actions[`colors:${k}`] = () => setDesign({ colors: k })
for (const [k, , fam, head] of FONT_SETS) {
  actions[`fonts:${k}`] = () => setDesign({ heading_font: head === 'sans' ? 'sans' : undefined }, { body_font_family: fam })
}
for (const [k, , indent, sp, ls] of SPACING_SETS) {
  actions[`pspacing:${k}`] = () => setDesign({ para_space_pt: indent ? undefined : sp }, { paragraph_indent: indent, line_spacing: ls })
}
for (const [k, , colors, fonts, set] of THEMES) {
  actions[`theme:${k}`] = () => {
    const f = FONT_SETS.find(x => x[0] === fonts)!
    setDesign({
      theme: k === 'latex' ? undefined : k, colors: colors || undefined,
      style_set: set === 'default' ? undefined : (set as StyleSet), heading_font: f[3] === 'sans' ? 'sans' : undefined,
    }, { body_font_family: f[2] })
  }
}
for (const w of WATERMARKS) actions[`watermark:${w}`] = () => setDesign({ watermark: w })
for (const [k] of PAGE_BORDERS) actions[`pageborder:${k}`] = () => setDesign({ page_border: k })
for (const c of ['#FFF2CC', '#FBE5D6', '#E2EFDA', '#DDEBF7', '#EDE7F6', '#F2F2F2', '#FFFFE0']) {
  actions[`pagecolor:${c}`] = () => setDesign({ page_color: c })
}

// Design ▸ Set as Default: what a new document starts with.
export function defaultDesign(m: DocMeta): DocMeta {
  const d = setting<{ design?: Design; body_font_family?: string; line_spacing?: number; paragraph_indent?: boolean } | null>('design_default', null)
  if (!d) return m
  return withDesign({
    ...m, body_font_family: d.body_font_family ?? m.body_font_family,
    line_spacing: d.line_spacing ?? m.line_spacing, paragraph_indent: d.paragraph_indent ?? m.paragraph_indent,
  }, d.design ?? {})
}

registerActions(actions)
