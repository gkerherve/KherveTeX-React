// A \\label{…} typed into an equation's LaTeX becomes the equation's own
// label (the model's MathBlock.label, which the serializer writes and the
// cross-references resolve). A label inside a multi-line environment
// (align, gather…) belongs to one of its lines and stays where it is.
const LABEL_RE = /\s*\\label\{([^}]*)\}\s*/

export function takeLabel(latex: string): [string, string | null] {
  if (/\\begin\{/.test(latex)) return [latex, null]
  const m = LABEL_RE.exec(latex)
  if (!m) return [latex, null]
  return [(latex.slice(0, m.index) + ' ' + latex.slice(m.index + m[0].length)).trim(), m[1].trim() || null]
}
