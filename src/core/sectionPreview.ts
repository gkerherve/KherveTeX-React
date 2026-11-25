// The preview of just the section being written: the LaTeX cut down to the
// \section (or \chapter) holding the caret, up to the next one. The
// counters are set to where that section starts, so its headings,
// figures, tables and equations carry the numbers the full PDF gives them.
// Definitions made in the body before it (\newcommand...) are kept.

// Placed in the source at the caret's block (a RawLatex line).
export const CARET_MARK = '% ===== KTEX CARET ====='

const HEAD = /^\s*\\(chapter|section)(\*?)\s*[[{]/
const KEEP_BEFORE = /^\s*\\(?:(?:re)?newcommand|providecommand|def|DeclareMathOperator|definecolor|setlength|newenvironment|renewenvironment|newcounter|makeatletter|makeatother|appendix|frontmatter|mainmatter|backmatter|pagenumbering|numberwithin|counterwithin|counterwithout)\b/

// The cut-down source, or null when the caret is not inside a section
// (the title, a chapter's opening before any heading) or there is nothing
// to leave out.
export function sectionOnly(tex: string): string | null {
  const lines = tex.split('\n')
  const begin = lines.findIndex(l => l.trimStart().startsWith('\\begin{document}'))
  let end = -1
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trimStart().startsWith('\\end{document}')) { end = i; break }
  const mark = lines.findIndex(l => l.trim() === CARET_MARK)
  if (begin < 0 || end < 0 || mark <= begin || mark >= end) return null
  let start = -1
  for (let i = mark - 1; i > begin; i--) if (HEAD.test(lines[i])) { start = i; break }
  if (start < 0) return null
  let stop = end
  for (let i = mark + 1; i < end; i++) if (HEAD.test(lines[i])) { stop = i; break }
  // Nothing much left out: the whole document is as quick.
  if (start - begin + (end - stop) < 20) return null

  // Counters as they stand where the kept part starts.
  let chapters = 0, sections = 0, figures = 0, tables = 0, footnotes = 0, from = begin + 1
  for (let i = begin + 1; i < start; i++) {
    const l = lines[i]
    const h = HEAD.exec(l)
    if (h && !h[2]) {
      if (h[1] === 'chapter') { chapters++; sections = 0; figures = 0; tables = 0; footnotes = 0; from = i } else sections++
    }
    // \appendix restarts the chapters (A, B...), or in a class without
    // chapters the sections.
    if (/^\s*\\appendix\b/.test(l)) { if (lines.slice(begin, start).some(x => /^\s*\\chapter\b/.test(x))) chapters = 0; else sections = 0 }
    if (/\\begin\{figure\*?\}/.test(l)) figures++
    if (/\\begin\{table\*?\}/.test(l)) tables++
    footnotes += (l.match(/\\footnote\s*\{/g) ?? []).length
  }
  const equations = numberedEquations(lines.slice(from, start).join('\n'))
  const first = HEAD.exec(lines[start])!
  const set: string[] = ['\\makeatletter']
  const counter = (name: string, n: number) => set.push(`\\@ifundefined{c@${name}}{}{\\setcounter{${name}}{${Math.max(0, n)}}}`)
  // The counts stop before the kept part's own heading, which steps its
  // counter itself as it prints.
  counter('chapter', chapters)
  if (first[1] === 'section') counter('section', sections)
  counter('figure', figures)
  counter('table', tables)
  counter('equation', equations)
  counter('footnote', footnotes)
  set.push('\\makeatother')
  const kept = lines.slice(begin + 1, start).filter(l => KEEP_BEFORE.test(l))
  return [
    ...lines.slice(0, begin + 1),
    ...kept,
    ...set,
    ...lines.slice(start, stop).filter(l => l.trim() !== CARET_MARK),
    ...lines.slice(end),
  ].join('\n')
}

// Numbered equations in a stretch of LaTeX: one per equation or multline,
// one per line of an align or gather, less those marked \nonumber.
export function numberedEquations(tex: string): number {
  let n = 0
  for (const m of tex.matchAll(/\\begin\{(equation|multline|gather|align|flalign|alignat)\}([\s\S]*?)\\end\{\1\}/g)) {
    const rows = m[1] === 'equation' || m[1] === 'multline' ? [m[2]] : m[2].split(/\\\\/).filter((r, i, a) => i < a.length - 1 || r.trim())
    for (const r of rows) if (!/\\nonumber|\\notag/.test(r)) n++
  }
  return n
}
