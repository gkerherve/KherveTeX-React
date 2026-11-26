// The numbering of LaTeX left out of a compile (a chapter unticked, a
// project document switched off, a part marked Do not compile).

const NUMBERED_EQ_RE = /^(?:equation|align|gather|multline|flalign|alignat|eqnarray)$/
const THEOREM_ENVS = new Set(['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'example', 'remark'])
const step = (c: string) => `\\ifcsname c@${c}\\endcsname\\refstepcounter{${c}}\\fi`

// What a part left out of the compile would have numbered (chapters,
// sections, figures, tables, equations, theorems, footnotes), in order,
// with its labels: the counters step as if it were there, so a thesis
// with a chapter unticked keeps every later number, and a reference into
// the chapter left out still prints its number.
export function skippedNumbering(hidden: string[]): string[] {
  const text = hidden.map(l => l.replace(/(^|[^\\])%.*$/, '$1')).join('\n')
  const out: string[] = []
  const re = /\\(part|chapter|section|subsection|subsubsection)(\*?)\s*[[{]|\\begin\{([A-Za-z]+)(\*?)\}|\\end\{([A-Za-z]+)\*?\}|\\caption(?:of\{(figure|table)\})?\s*[[{]|\\footnote\s*[[{]|\\label\{([^}]*)\}|\\\\|\\(?:nonumber|notag)\b/g
  let float = ''
  // The equation environment open (none numbered when starred), whether
  // its current row is numbered, and the labels waiting for that row.
  let eq = ''
  let eqStar = false
  let rowNumbered = true
  let rowLabels: string[] = []
  const endRow = () => {
    if (eq && !eqStar && rowNumbered) out.push(step('equation'))
    out.push(...rowLabels)
    rowLabels = []
    rowNumbered = true
  }
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const tok = m[0]
    if (m[1]) { if (!m[2]) out.push(step(m[1])) }
    else if (m[3]) {
      const env = m[3]
      if (env === 'figure' || env === 'table') float = env
      else if (NUMBERED_EQ_RE.test(env)) { eq = env; eqStar = !!m[4]; rowNumbered = true }
      else if (THEOREM_ENVS.has(env) && !m[4]) out.push(`\\ifcsname c@${env}\\endcsname\\refstepcounter{${env}}\\else${step('theorem')}\\fi`)
    } else if (m[5]) {
      const env = m[5]
      if (env === float) float = ''
      else if (env === eq) { endRow(); eq = '' }
    } else if (tok.startsWith('\\caption')) { const f = m[6] || float; if (f) out.push(step(f)) }
    else if (tok.startsWith('\\footnote')) out.push('\\stepcounter{footnote}')
    else if (m[7] !== undefined) (eq ? rowLabels : out).push(`\\label{${m[7]}}`)
    // multline numbers once, at its end.
    else if (tok === '\\\\') { if (eq && eq !== 'multline') endRow() }
    else if (eq) rowNumbered = false
  }
  return out.length ? ['% kTeX: the numbering of the part left out', ...out] : []
}
