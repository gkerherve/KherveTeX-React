// What an inline piece of raw LaTeX looks like in the PDF, so the visual
// editor can show that instead of the source. Pure: no DOM, so it is
// tested in Vitest. Anything not understood stays shown as source.

export type InlineRawLook =
  | { kind: 'break' }
  // Commands that print nothing (\noindent, \medskip, ...).
  | { kind: 'none' }
  | { kind: 'space'; em: number }
  // \includegraphics, maybe inside \raisebox{<shift>}{...}.
  | { kind: 'image'; path: string; width: string | null; height: string | null; scale: number | null; raiseEm: number }
  | { kind: 'text'; text: string }
  | { kind: 'source' }

const SILENT = new Set([
  'noindent', 'indent', 'par', 'medskip', 'smallskip', 'bigskip', 'centering',
  'raggedright', 'raggedleft', 'nobreak', 'allowbreak', 'relax', 'leavevmode',
  'clearpage', 'newpage', 'pagebreak', 'linebreak', 'nopagebreak', 'protect',
  'normalsize', 'small', 'footnotesize', 'large', 'Large', 'selectfont',
])

const SPACES: Record<string, number> = { quad: 1, qquad: 2, enspace: 0.5, thinspace: 0.17, hfill: 1, hfil: 1, ',': 0.17, ' ': 0.3, '~': 0.3 }

// The {...} group starting at s[i] === '{': [content, index after it].
function group(s: string, i: number, open = '{', close = '}'): [string, number] | null {
  if (s[i] !== open) return null
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++
    else if (s[j] === close && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return null
}

const skipWs = (s: string, i: number) => { while (i < s.length && /\s/.test(s[i])) i++; return i }

// A length as em (1em = body size): em, ex, pt and the like; null if unknown.
export function lengthEm(spec: string, bodyPt = 10): number | null {
  const m = /^\s*(-?[\d.]+)\s*(em|ex|pt|bp|mm|cm|in)\s*$/.exec(spec)
  if (!m) return null
  const v = parseFloat(m[1])
  const pt: Record<string, number> = { pt: 1, bp: 72.27 / 72, mm: 72.27 / 25.4, cm: 72.27 / 2.54, in: 72.27 }
  if (m[2] === 'em') return v
  if (m[2] === 'ex') return v * 0.43
  return (v * pt[m[2]]) / bodyPt
}

function parseImage(s: string, i: number): [InlineRawLook, number] | null {
  if (!s.startsWith('\\includegraphics', i)) return null
  i = skipWs(s, i + '\\includegraphics'.length)
  let opts = ''
  const o = group(s, i, '[', ']')
  if (o) { opts = o[0]; i = skipWs(s, o[1]) }
  const p = group(s, i)
  if (!p) return null
  const kv: Record<string, string> = {}
  for (const part of opts.split(',')) {
    const [k, ...v] = part.split('=')
    if (k.trim()) kv[k.trim()] = v.join('=').trim()
  }
  const scale = kv.scale ? parseFloat(kv.scale) : NaN
  return [{
    kind: 'image', path: p[0].trim(), width: kv.width || null, height: kv.height || null,
    scale: Number.isFinite(scale) ? scale : null, raiseEm: 0,
  }, p[1]]
}

export function inlineRawLook(latex: string): InlineRawLook {
  const s = latex.trim()
  if (s === '\\\\' || s === '\\newline' || /^\\\\\[[^\]]*\]$/.test(s) || s === '\\\\*') return { kind: 'break' }
  if (s === '') return { kind: 'none' }
  // \raisebox{shift}{\includegraphics...}
  if (s.startsWith('\\raisebox')) {
    let i = skipWs(s, '\\raisebox'.length)
    const shift = group(s, i)
    if (!shift) return { kind: 'source' }
    i = skipWs(s, shift[1])
    // Optional [height][depth].
    for (let k = 0; k < 2; k++) { const g = group(s, i, '[', ']'); if (g) i = skipWs(s, g[1]) }
    const body = group(s, i)
    if (!body || skipWs(s, body[1]) !== s.length) return { kind: 'source' }
    const inner = inlineRawLook(body[0])
    if (inner.kind === 'image') return { ...inner, raiseEm: lengthEm(shift[0]) ?? 0 }
    return inner
  }
  const img = parseImage(s, 0)
  if (img) return skipWs(s, img[1]) === s.length ? img[0] : { kind: 'source' }
  // \hspace{..} / \hspace*{..}
  const hs = /^\\hspace\*?\s*\{([^{}]*)\}$/.exec(s)
  if (hs) { const em = lengthEm(hs[1]); return em === null ? { kind: 'source' } : { kind: 'space', em: Math.max(0, em) } }
  if (/^\\vspace\*?\s*\{[^{}]*\}$/.test(s)) return { kind: 'none' }
  // A run of silent / spacing control words, e.g. "\noindent" or "\medskip\noindent".
  const words = s.match(/\\([a-zA-Z]+|[, ~])\s*/g)
  if (words && words.join('').replace(/\s/g, '') === s.replace(/\s/g, '')) {
    let em = 0
    for (const w of words) {
      const name = w.trim().slice(1) || w.slice(1, 2)
      if (name in SPACES) em += SPACES[name]
      else if (!SILENT.has(name)) return { kind: 'source' }
    }
    return em > 0 ? { kind: 'space', em } : { kind: 'none' }
  }
  const sym: Record<string, string> = {
    '\\LaTeX': 'LaTeX', '\\TeX': 'TeX', '\\ldots': '…', '\\dots': '…', '\\textbullet': '•',
    '\\textdegree': '°', '\\texttimes': '×', '\\S': '§', '\\P': '¶', '\\copyright': '©',
    '\\textregistered': '®', '\\texttrademark': '™', '\\euro': '€', '\\pounds': '£',
    '\\textendash': '–', '\\textemdash': '—', '\\checkmark': '✓', '\\today': new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  }
  const bare = s.replace(/\{\}$/, '')
  if (bare in sym) return { kind: 'text', text: sym[bare] }
  return { kind: 'source' }
}
