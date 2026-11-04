// The Code tab's highlighter against khervedoc/latex_view.py's
// LatexHighlighter: tests/fixtures/latex_highlight.json is what Qt applied
// to every character of latex_highlight.tex (foreground, background, bold,
// italic), light and dark.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  completions, cursorSnippet, findSnippet, highlightLine, STATE_NORMAL, textUnderCursor,
} from '../src/codeview/highlight.ts'

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url)
const SRC = readFileSync(fixture('latex_highlight.tex'), 'utf8')
const QT = JSON.parse(readFileSync(fixture('latex_highlight.json'), 'utf8')) as Record<string, [string | null, string | null, boolean, boolean][][]>

function perChar(dark: boolean) {
  const out: [string | null, string | null, boolean, boolean][][] = []
  let state = STATE_NORMAL
  for (const line of SRC.split('\n')) {
    const r = highlightLine(line, state, dark)
    state = r.state
    out.push(r.spans.flatMap(s => [...s.text].map(() => [s.fg, s.bg, s.bold, s.italic] as [string | null, string | null, boolean, boolean])))
  }
  return out
}

describe('LatexHighlighter parity', () => {
  for (const theme of ['light', 'dark']) {
    it(`${theme} formats match Qt`, () => {
      const ours = perChar(theme === 'dark')
      const qt = QT[theme]
      // QTextDocument has no block for the text after a final newline.
      expect(ours.slice(0, qt.length)).toEqual(qt)
    })
  }
})

describe('LatexView helpers', () => {
  it('completes from the last backslash', () => {
    expect(textUnderCursor('Some \\tex')).toBe('\\tex')
    expect(completions('\\texti')).toEqual(['\\textit{}'])
    expect(completions('\\Sec')).toEqual([])
  })

  it('cursor_snippet strips LaTeX', () => {
    expect(cursorSnippet('  \\section{Intro to $x$} ', 3)).toBe('Intro to x')
  })

  it('scroll_to_snippet falls back to the first three words', () => {
    const src = 'a\n\\textbf{Hello} big world here'
    expect(findSnippet(src, 'Hello big world')).toBe(src.indexOf('Hello'))
    expect(findSnippet(src, 'zzz')).toBe(-1)
  })
})
