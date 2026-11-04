// The visual tab's page: the ProseMirror editor laid out on sheets
// (controller.ts). App passes setContext so the contextual ribbon tab
// follows the caret, as MainWindow._sync_context_tools.
import { useEffect, useRef } from 'react'
import type { ContextKind } from '../ui/ribbonModel'
import { EditorController } from './controller'
import './editor.css'
import './fonts.css'

export function EditorPane({ onContext }: { onContext: (k: ContextKind | null) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef(onContext)
  ctx.current = onContext
  useEffect(() => {
    const ctl = new EditorController(host.current!, k => ctx.current(k))
    return () => ctl.destroy()
  }, [])
  // Clicks on the page stay with the editor; the desk around it clears
  // the contextual tab.
  return <div ref={host} onClick={e => e.stopPropagation()} />
}
