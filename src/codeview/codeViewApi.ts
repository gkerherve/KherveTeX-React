// What the Code tab offers the other views ("Show in Code" from the PDF or
// the Visual tab): LatexView.scroll_to_snippet and cursor_snippet.
export interface FindOpts { caseSensitive: boolean; wholeWord: boolean }

export interface CodeViewApi {
  scrollToSnippet(snippet: string): boolean
  cursorSnippet(): string
  // Find & Replace in the LaTeX (the Find bar while the Code tab shows).
  // `from`: 'next' / 'previous' from the current match, or 'here' (as you
  // type: the first match from where the last one started).
  find(text: string, from: 'next' | 'previous' | 'here', o: FindOpts): { index: number; count: number }
  replace(text: string, repl: string, o: FindOpts): { index: number; count: number }
  replaceAll(text: string, repl: string, o: FindOpts): number
  clearFind(): void
}

// Every match of `text` in `s`: [start, end] pairs.
export function matchesOf(s: string, text: string, o: FindOpts): [number, number][] {
  if (!text) return []
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(o.wholeWord ? `(?<![\\w])${esc}(?![\\w])` : esc, o.caseSensitive ? 'g' : 'gi')
  const out: [number, number][] = []
  for (const m of s.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
  return out
}

let current: CodeViewApi | null = null

export function setCodeViewApi(api: CodeViewApi | null): void {
  current = api
}

export function codeViewApi(): CodeViewApi | null {
  return current
}
