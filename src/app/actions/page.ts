// The Layout tab and Document properties: margins, paper size, columns,
// document class, body font size, Document settings and Manage styles
// (MainWindow._set_margins, _set_page_size, _set_column_count,
// _on_template_changed, _on_fontsize_changed, _edit_props, _manage_styles).
import type { DocMeta } from '../../core/model.ts'
import { editor, MARGIN_PRESETS } from '../../editor/controller.ts'
import * as C from '../../editor/commands.ts'
import { platform } from '../../platform/index.ts'
import { docSettingsDialog, styleDialog, type StyleFile } from '../../ui/dialogs/EditorDialogs.tsx'
import { setCommandChecked } from '../../ui/commands.ts'
import { registerActions, type Handler } from '../actions.ts'
import { appStore, editDoc } from '../store.ts'
import type { PageFurniture, PdfTypography } from '../pageAnchors.ts'

// What projects and the compile loop tell the visual editor beyond
// EditorApi (DocumentEditor.set_first_page_number, set_heading_offset,
// PagedTextEdit.set_page_anchors): reach it as
// `editorApi() as EditorApi & PageEditing`.
export interface PageEditing {
  // Printed number of the first sheet (a project chapter continues).
  setPageNumberStart(n: number): void
  // Numbered headings already used before this document, per level
  // (index 0 = chapter); null resets.
  setHeadingOffset(counters: number[] | null): void
  // The compiled PDF's page count and [(page_no, first text), ...] of
  // every page after the first (MainWindow._on_compile_done), and each
  // page's printed header and footer, painted on its sheet.
  setPageAnchors(pageCount: number, anchors: [number, string][], furniture?: PageFurniture[],
    typography?: PdfTypography): void
}

// The document's meta as it stands (the store's: chemistry may have added
// a package since the editor last exported).
function meta(): DocMeta {
  return appStore().get().doc.meta
}

// set_meta: the editor relays out and hands the document on.
function setMeta(patch: Partial<DocMeta>): void {
  const next = { ...meta(), ...patch }
  // A setting turned back to its default is left out of the file.
  for (const k of Object.keys(patch) as (keyof DocMeta)[]) if (next[k] === undefined) delete next[k]
  const e = editor()
  if (e) e.setMeta(next)
  else editDoc({ ...appStore().get().doc, meta: next })
}

const actions: Record<string, Handler> = {
  // _set_column_count: nothing when the value is unchanged.
  // Insert > Date: the date under the title, on or off.
  show_date: () => {
    const on = meta().show_date === false
    const { show_date: _, ...rest } = meta()
    void _
    const next: DocMeta = on ? rest : { ...rest, show_date: false }
    const e = editor()
    if (e) e.setMeta(next)
    else editDoc({ ...appStore().get().doc, meta: next })
    setCommandChecked('show_date', on)
  },
  // Right-click the date > a format ('' = the class's own).
  date_format: (fmt) => {
    const { date_format: _, ...rest } = meta()
    void _
    const next: DocMeta = fmt ? { ...rest, date_format: String(fmt) } : rest
    const e = editor()
    if (e) e.setMeta(next)
    else editDoc({ ...appStore().get().doc, meta: next })
  },
  cols_1: () => { if (meta().column_count !== 1) setMeta({ column_count: 1 }) },
  cols_2: () => { if (meta().column_count !== 2) setMeta({ column_count: 2 }) },
  cols_3: () => { if (meta().column_count !== 3) setMeta({ column_count: 3 }) },
  // _on_template_changed.
  doc_class: cls => {
    if (typeof cls !== 'string' || !cls || meta().documentclass === cls) return
    setMeta({ documentclass: cls })
  },
  // set_body_font_pt: 6..72, whole points.
  // With text selected, Word's font size: that text's size; without, the
  // document's body size.
  fontsize: v => {
    const raw = parseFloat(String(v ?? '').trim().replace(/pt$/, ''))
    if (!Number.isFinite(raw)) return
    const e = editor()
    if (e && !e.view.state.selection.empty) {
      const pt = Math.max(1, Math.min(400, Math.round(raw * 2) / 2))
      const size = pt === meta().body_font_pt ? 0 : pt
      C.setValueMark('fontsize', size ? { pt } : null)(e.view.state, tr => e.view.dispatch(tr))
      // Tables take the size too: the whole table (its cells hold plain
      // text, no marks), for a selection that holds or is inside one.
      C.setTableSize(size)(e.view.state, tr => e.view.dispatch(tr))
      e.view.focus()
      return
    }
    const clamped = Math.max(6, Math.min(72, Math.trunc(raw)))
    if (clamped !== meta().body_font_pt) setMeta({ body_font_pt: clamped })
  },
  // The font: on selected text, that text's; without a selection, the
  // document's body font (Document settings).
  fontfamily: v => {
    const name = String(v ?? '')
    const e = editor()
    if (e && !e.view.state.selection.empty) {
      C.setValueMark('fontfamily', name && name !== 'default' ? { name } : null)(e.view.state, tr => e.view.dispatch(tr))
      e.view.focus()
      return
    }
    if (['default', 'times', 'palatino', 'helvetica', 'courier', 'charter'].includes(name) && meta().body_font_family !== name) {
      setMeta({ body_font_family: name })
    }
  },
  doc_props: async () => {
    const m = await docSettingsDialog(meta())
    if (m) setMeta(m)
  },
  manage_styles: () => manageStyles(),
}
for (const [name, [t, b, l, r]] of MARGIN_PRESETS) {
  actions[`margin_${name}`] = () => setMeta({ margin_top_cm: t, margin_bottom_cm: b, margin_left_cm: l, margin_right_cm: r })
}
for (const code of ['A4', 'Letter', 'Legal']) {
  actions[`pagesize_${code}`] = () => { if (meta().page_size !== code) setMeta({ page_size: code }) }
}

// Layout ▸ Breaks: a page break, a column break (the next column; with one
// column, the next page), a section starting on the next page or the next
// odd page.
const breakBlock = (latex: string) => () => {
  const e = editor()
  if (e) C.insertRawBlock(latex)(e.view.state, tr => e.view.dispatch(tr))
}
actions.brk_page = breakBlock('\\newpage')
actions.brk_column = () => breakBlock((meta().column_count ?? 1) >= 3 ? '\\columnbreak' : '\\newpage')()
actions.brk_next = breakBlock('\\clearpage')
actions.brk_odd = breakBlock('\\cleardoublepage')
// Layout ▸ Line Numbers and Hyphenation.
for (const k of ['none', 'continuous', 'page', 'section'] as const) {
  actions[`ln_${k}`] = () => {
    const v = k === 'none' ? undefined : k
    if (meta().line_numbers !== v) setMeta({ line_numbers: v })
  }
}
actions.hyph_auto = () => { if (meta().hyphenation === false) setMeta({ hyphenation: undefined }) }
actions.hyph_none = () => { if (meta().hyphenation !== false) setMeta({ hyphenation: false }) }
actions.orient_portrait = () => { if (meta().landscape) setMeta({ landscape: undefined }) }
actions.orient_landscape = () => { if (!meta().landscape) setMeta({ landscape: true }) }

registerActions(actions)

const STYLE_EXT = ['.cls', '.sty', '.bst']

// style_manager over the platform: the user folder first, then the
// bundled styles (all_style_dirs).
async function manageStyles(): Promise<void> {
  const p = platform()
  const dirs = await p.styleDirs().catch(() => [] as string[])
  const user = dirs[0] ?? null
  await styleDialog({
    list: async () => {
      const out: StyleFile[] = []
      for (const [i, d] of dirs.entries()) {
        for (const f of await p.listDir(d).catch(() => [])) {
          const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
          if (f.isFile && STYLE_EXT.includes(ext)) {
            out.push({ name: f.name, ext, location: i === 0 && dirs.length > 1 ? 'User' : 'Bundled', path: f.path })
          }
        }
      }
      return out
    },
    importFile: async () => {
      if (!user) return
      const picked = await p.openFileDialog({
        title: 'Import LaTeX style file',
        filters: [{ name: 'LaTeX styles', extensions: ['cls', 'sty', 'bst'] }],
        multiple: true,
      })
      for (const src of picked ?? []) {
        const name = src.split(/[\\/]/).pop()!
        await p.copy(src, `${user}/${name}`)
      }
    },
    remove: async f => { await p.remove(f.path) },
    openFolder: async () => { if (user) await p.openPath(user) },
  })
}
