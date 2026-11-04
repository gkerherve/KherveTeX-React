// Placeholder until the visual editor (Phase 2) lands: the A4 page card
// with stand-in content. Replaced by the ProseMirror editor.
import type { ContextKind } from '../ui/ribbonModel'
import { PlaceholderPage } from '../ui/PlaceholderPage'

export function EditorPane({ onContext }: { onContext: (k: ContextKind | null) => void }) {
  return <PlaceholderPage onContext={onContext} />
}
