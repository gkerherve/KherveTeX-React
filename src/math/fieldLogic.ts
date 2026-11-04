// The text logic of the editors' source fields and hints
// (_EquationLatexEdit and the slot-count labels of equation_editor.py),
// kept free of React so it is testable headless.

const BEGIN_RE = /\\begin\{(\w+\*?)\}$/

export function placeholderSpans(text: string, ph: string): [number, number][] {
  const spans: [number, number][] = []
  let idx = text.indexOf(ph)
  while (idx >= 0) {
    spans.push([idx, idx + ph.length])
    idx = text.indexOf(ph, idx + ph.length)
  }
  return spans
}

// Where Tab lands: the next slot at or after pos (wrapping), or the last
// one before pos (wrapping). null when there is none.
export function placeholderJump(text: string, ph: string, pos: number, forward: boolean): number | null {
  let idx: number
  if (forward) {
    idx = text.indexOf(ph, pos)
    if (idx < 0) idx = text.indexOf(ph)          // wrap around
  } else {
    // rfind(ph, 0, pos): the slot must end at or before pos.
    idx = pos >= ph.length ? text.lastIndexOf(ph, pos - ph.length) : -1
    if (idx < 0) idx = text.lastIndexOf(ph)      // wrap around
  }
  return idx < 0 ? null : idx
}

// The \begin{env} auto-close: what typing "}" inserts after `before`, or null.
export function autoCloseBegin(before: string, ph: string): string | null {
  const m = BEGIN_RE.exec(before + '}')
  if (!m) return null
  return `}\n${ph}\n\\end{${m[1]}}`
}

// EquationEditorDialog._update_slot_hint
export function slotHint(n: number): string {
  return n ? `${n} empty slot${n !== 1 ? 's' : ''} — press Tab to jump between them` : ''
}

// _TemplatePaletteDialog._update_placeholder_hint
export function placeholderHint(n: number): string {
  return n ? `${n} empty slot${n !== 1 ? 's' : ''} — click one (or press Tab) to select it, then type to fill it in.` : ''
}
