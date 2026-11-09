// What the visual editor offers the rest of the app (math dialogs,
// citation picker, drawing, find bar, MCP tools). The editor installs its
// implementation with setEditorApi() when it mounts; callers use
// editorApi() and get null while no editor is mounted. This is
// DocumentEditor's public surface in editor.py.
import type { Block, Inline } from '../core/model'

export interface EditorSelectionInfo {
  // The object the caret is in, which picks the contextual ribbon tab.
  context: 'table' | 'figure' | 'theorem' | 'equation' | null
  // LaTeX of the equation under the caret (for Equation ▸ Edit).
  mathLatex: string | null
  // Selected plain text, '' when collapsed.
  selectedText: string
}

export interface EditorApi {
  insertInline(node: Inline): void
  insertBlock(node: Block): void
  // Replace the equation under the caret (inline or display).
  replaceMath(latex: string): void
  selection(): EditorSelectionInfo
  // Find/replace; return false when nothing (more) was found.
  find(text: string, opts: { forward: boolean; caseSensitive: boolean; wholeWord: boolean }): boolean
  replace(find: string, repl: string, opts: { caseSensitive: boolean; wholeWord: boolean }): boolean
  replaceAll(find: string, repl: string, opts: { caseSensitive: boolean; wholeWord: boolean }): number
  // Scroll to the block holding this plain-text snippet (PDF → Visual sync).
  revealText(snippet: string): boolean
  focus(): void
  // The document's thebibliography block (the first), or null.
  bibliography(): { pos: number; text: string } | null
  // Replace that block's LaTeX, or (pos null) add one at the end.
  setBibliography(pos: number | null, text: string): void
}

let current: EditorApi | null = null

export function setEditorApi(api: EditorApi | null): void {
  current = api
}

export function editorApi(): EditorApi | null {
  return current
}
