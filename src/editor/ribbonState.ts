// The ribbon widgets that are not QActions (MainWindow's hidden combos:
// _heading_combo, _template_combo, _fontsize_combo, _numbered_cb), kept
// in step with the caret as _sync_toolbar_state does. Ribbon.tsx reads it;
// the editor writes it.
import { useSyncExternalStore } from 'react'

export interface RibbonWidgets {
  docClass: string
  fontSize: string
  styleLevel: number
  numbered: boolean
  numberedEnabled: boolean
  // Styles greyed out for this class (Chapter, Frame), with why.
  disabledStyles: Record<number, string>
  // The caret's paragraph's indents (cm) and space before / after (pt);
  // null outside a paragraph (Layout ▸ Indent / Spacing).
  para: { left_cm: number; right_cm: number; before_pt: number; after_pt: number } | null
}

let state: RibbonWidgets = {
  docClass: 'article', fontSize: '12', styleLevel: 0, numbered: true, numberedEnabled: false,
  disabledStyles: {}, para: null,
}
const listeners = new Set<() => void>()

export function ribbonWidgets(): RibbonWidgets {
  return state
}

export function setRibbonWidgets(patch: Partial<RibbonWidgets>): void {
  const next = { ...state, ...patch }
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  for (const l of listeners) l()
}

export function useRibbonWidgets(): RibbonWidgets {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)
}
