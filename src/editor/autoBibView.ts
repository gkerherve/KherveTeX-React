// The reference list LaTeX prints at the end of a document citing from its
// references (core/autoBibliography): drawn after the last block, as the
// PDF has it, with the title the class gives it ("References",
// "Bibliography" in a report or book) and each entry hanging. It is in no
// block of the document, so it cannot be typed into; a double-click opens
// References ▸ Manage references.
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { autoBibliography, type AutoBibliography } from '../core/autoBibliography.ts'
import { docFromPM } from './convert.ts'
import { charCss, layoutKey } from './plugins.ts'

export const autoBibKey = new PluginKey<DecorationSet>('kt-auto-bib')
export const AUTO_BIB_REFRESH = 'kt-auto-bib-refresh'

function listEl(bib: AutoBibliography, state: EditorState, onOpen: () => void): HTMLElement {
  const layout = layoutKey.getState(state)?.layout
  const el = document.createElement('div')
  el.className = 'kt-autobib'
  el.contentEditable = 'false'
  el.title = 'Written by LaTeX from the cited references. Double-click to manage the references.'
  if (layout) el.setAttribute('style', charCss(layout.bodyChar))
  const numbered = bib.items.some(i => i.label)
  if (numbered) {
    const widest = Math.max(...bib.items.map(i => i.label.length))
    el.style.setProperty('--kt-bib-label', `${widest * 0.62 + 0.8}em`)
    el.classList.add('kt-autobib-numbered')
  }
  const title = document.createElement('div')
  title.className = 'kt-autobib-title'
  title.textContent = layout?.bibTitle.title ?? 'References'
  if (layout) title.setAttribute('style', charCss(layout.bibTitle.titleChar))
  el.appendChild(title)
  for (const item of bib.items) {
    const row = document.createElement('div')
    row.className = 'kt-autobib-item'
    if (item.label) {
      const lab = document.createElement('span')
      lab.className = 'kt-bib-label'
      lab.textContent = item.label
      row.appendChild(lab)
    }
    for (const r of item.runs) {
      const s = document.createElement(r.italic ? 'i' : 'span')
      s.textContent = r.text
      row.appendChild(s)
    }
    el.appendChild(row)
  }
  el.addEventListener('dblclick', e => { e.preventDefault(); onOpen() })
  return el
}

// `bibText`: the .bib the citations resolve against; `onOpen`: what a
// double-click on the list does.
export function autoBibliographyPlugin(bibText: () => string, onOpen: () => void): Plugin<DecorationSet> {
  const build = (state: EditorState): DecorationSet => {
    const meta = layoutKey.getState(state)?.meta
    if (!meta) return DecorationSet.empty
    const bib = autoBibliography(docFromPM(state.doc, meta), bibText())
    if (!bib || !bib.items.length) return DecorationSet.empty
    const key = `auto-bib:${JSON.stringify(bib.items)}:${JSON.stringify(layoutKey.getState(state)?.layout.bibTitle)}`
    return DecorationSet.create(state.doc, [
      Decoration.widget(state.doc.content.size, () => listEl(bib, state, onOpen), { side: 1, key, ignoreSelection: true }),
    ])
  }
  return new Plugin<DecorationSet>({
    key: autoBibKey,
    state: {
      init: (_c, state) => build(state),
      apply: (tr, prev, _old, state) => (tr.docChanged || tr.getMeta(AUTO_BIB_REFRESH) || tr.getMeta(layoutKey))
        ? build(state) : prev.map(tr.mapping, tr.doc),
    },
    props: { decorations: state => autoBibKey.getState(state) },
  })
}
