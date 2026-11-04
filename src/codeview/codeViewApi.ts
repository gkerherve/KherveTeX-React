// What the Code tab offers the other views ("Show in Code" from the PDF or
// the Visual tab): LatexView.scroll_to_snippet and cursor_snippet.
export interface CodeViewApi {
  scrollToSnippet(snippet: string): boolean
  cursorSnippet(): string
}

let current: CodeViewApi | null = null

export function setCodeViewApi(api: CodeViewApi | null): void {
  current = api
}

export function codeViewApi(): CodeViewApi | null {
  return current
}
