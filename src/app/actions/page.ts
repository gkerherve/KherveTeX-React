// The Layout tab and Document properties: margins, paper size, columns,
// document class, body font size, Document settings and Manage styles
// (MainWindow._set_margins, _set_page_size, _set_column_count,
// _on_template_changed, _on_fontsize_changed, _edit_props, _manage_styles).
import type { DocMeta } from '../../core/model.ts'
import { editor, MARGIN_PRESETS } from '../../editor/controller.ts'
import { platform } from '../../platform/index.ts'
import { docSettingsDialog, styleDialog, type StyleFile } from '../../ui/dialogs/EditorDialogs.tsx'
import { registerActions, type Handler } from '../actions.ts'
import { appStore, editDoc } from '../store.ts'
import type { PageFurniture } from '../pageAnchors.ts'

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
  setPageAnchors(pageCount: number, anchors: [number, string][], furniture?: PageFurniture[]): void
}

// The document's meta as it stands (the store's: chemistry may have added
// a package since the editor last exported).
function meta(): DocMeta {
  return appStore().get().doc.meta
}

// set_meta: the editor relays out and hands the document on.
function setMeta(patch: Partial<DocMeta>): void {
  const next = { ...meta(), ...patch }
  const e = editor()
  if (e) e.setMeta(next)
  else editDoc({ ...appStore().get().doc, meta: next })
}

const actions: Record<string, Handler> = {
  // _set_column_count: nothing when the value is unchanged.
  cols_1: () => { if (meta().column_count !== 1) setMeta({ column_count: 1 }) },
  cols_2: () => { if (meta().column_count !== 2) setMeta({ column_count: 2 }) },
  cols_3: () => { if (meta().column_count !== 3) setMeta({ column_count: 3 }) },
  // _on_template_changed.
  doc_class: cls => {
    if (typeof cls !== 'string' || !cls || meta().documentclass === cls) return
    setMeta({ documentclass: cls })
  },
  // set_body_font_pt: 6..72, whole points.
  fontsize: v => {
    const pt = Math.trunc(parseFloat(String(v ?? '').trim().replace(/pt$/, '')))
    if (!Number.isFinite(pt)) return
    const clamped = Math.max(6, Math.min(72, pt))
    if (clamped !== meta().body_font_pt) setMeta({ body_font_pt: clamped })
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
