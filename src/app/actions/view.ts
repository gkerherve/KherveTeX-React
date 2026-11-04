import { registerActions } from '../actions'
import { appStore, type LayoutMode } from '../store'

const layout = (mode: LayoutMode) => () => {
  const visual = mode === 'visual' || mode === 'page'
  appStore().set({ layout: mode, autoCompile: !visual })
}

registerActions({
  view_formatted: () => appStore().set({ tab: 'visual' }),
  view_latex: () => appStore().set({ tab: 'code' }),
  view_console: () => appStore().set({ tab: 'console' }),
  page_visual: () => appStore().set({ tab: 'visual' }),
  page_code: () => appStore().set({ tab: 'code' }),
  page_console: () => appStore().set({ tab: 'console' }),
  visual_only: layout('visual'),
  side_by_side: layout('side'),
  pdf_window: layout('window'),
})
