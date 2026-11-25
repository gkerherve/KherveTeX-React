// Import .tex and .md files into the KherveTeX document model. A port of
// the .tex and Markdown halves of khervedoc/importers.py.
//
// The .tex parser handles the common subset that the rest of KherveTeX also
// emits (sections, lists, math, links, citations, cross-refs, figures, plus
// the formatting marks). Anything it doesn't recognise is preserved as
// RawLatex so the document round-trips without data loss.

import * as M from './model.ts'
import type { Block, Document, Inline, Mark, Table, Text } from './model.ts'
import { DEFAULT_PACKAGES } from './model.ts'
import { REVIEW_PREAMBLE } from './serializer.ts'
import {
  capitalize, isAlpha, lstrip, pyFloatParse, pyIntParse, pyRe, pyRound, reEscape, reFindall,
  reFullmatch, reMatch, reSearch, reSplit, reSub, rstrip, splitlines, strip,
} from './py.ts'

// Everything that touches files goes through this, so the core runs in the
// browser and in Vitest. Without one, every file looks missing, which is
// what Python does when the files aren't there.
export interface ImportFs {
  isFile(path: string): boolean
  // Text-mode read (errors="replace"); null when it can't be read.
  readText(path: string): string | null
  // Path.resolve(); defaults to lexical normalisation.
  resolve?(path: string): string
}

export const NO_FS: ImportFs = { isFile: () => false, readText: () => null }

// A regex hit, a balanced-brace section scan or a bracket-macro scan, all in
// the shape _dispatch reads (re.Match / _SectionMatch / _StubMatch).
interface Hit { start: number; end: number; g: (string | undefined)[] }

const hit = (m: RegExpExecArray): Hit => ({ start: m.index, end: m.index + m[0].length, g: [...m] })

// ============================================================
//                       .tex importer
// ============================================================

// Matches the section command prefix only — the braced argument is extracted
// separately via _consume_braced so nested commands like \textbf{...} inside
// the heading survive.
const SECTION_PREFIX_RE = pyRe(String.raw`\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?=\{)`)

const FRONTMATTER_BLOCK_RE = pyRe(String.raw`\\begin\{frontmatter\}(.*?)\\end\{frontmatter\}`, 's')

const WS = ' \t\n'

// Remove every occurrence of `\command[opt]{arg}` from `src`, handling
// balanced braces inside the argument so a nested macro doesn't terminate
// the match early.
function stripBalancedCommand(src: string, command: string): string {
  const pattern = pyRe('\\\\' + reEscape(command) + '\\b')
  const out: string[] = []
  let pos = 0
  for (;;) {
    const m = reSearch(pattern, src, pos)
    if (!m) {
      out.push(src.slice(pos))
      return out.join('')
    }
    out.push(src.slice(pos, m.index))
    let p = m.index + m[0].length
    // Skip whitespace + optional brackets, tolerating spaces.
    while (p < src.length && WS.includes(src[p])) p++
    while (p < src.length && src[p] === '[') {
      let depth = 1
      let j = p + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '[') depth++
        else if (src[j] === ']') depth--
        j++
      }
      p = j
      while (p < src.length && WS.includes(src[p])) p++
    }
    // Skip balanced { ... } argument if present.
    if (p < src.length && src[p] === '{') p = consumeBraced(src, p)[1]
    pos = p
  }
}

// Capture everything between \documentclass and \begin{document} that the
// model doesn't already represent.
//
// Removed (already modelled): \documentclass[opts]{class},
// \usepackage[opts]{name}, \title{...}, \author{...}, \journal{...} (only
// when stripAuthor is true — journal classes need these preserved), line
// comments.
//
// Kept (so they survive the round-trip and the PDF retains its styling):
// \lstset, \definecolor, \hypersetup, \newcommand, \renewcommand,
// \setlength, \theoremstyle, \newtheorem, \DeclareMathOperator, any other
// customisation the user wrote before \begin{document}.
function extractPreambleExtras(src: string, stripAuthor = true): string {
  const docM = reSearch(pyRe(String.raw`\\documentclass\b`), src)
  const bodyM = reSearch(pyRe(String.raw`\\begin\{document\}`), src)
  if (!docM || !bodyM) return ''
  let preamble = src.slice(docM.index, bodyM.index)
  // Drop comments first so they don't interfere with the strip patterns.
  preamble = stripTexComments(preamble)
  // Strip the patterns we already represent in the model.
  preamble = reSub(pyRe(String.raw`\\documentclass(?:\[[^\]]*\])?\{[^}]+\}`), preamble, '')
  // Strip option-less \usepackage{name} — the model stores these.
  // Packages WITH options (\usepackage[utf8]{inputenc}) stay in
  // preamble_extras so the options survive the round-trip.
  preamble = reSub(pyRe(String.raw`\\usepackage\{[^}]+\}`), preamble, '')
  // Also strip packages-with-options that the model handles itself.
  preamble = reSub(pyRe(String.raw`\\usepackage\[[^\]]*\]\{(?:geometry|setspace)\}`), preamble, '')
  if (stripAuthor) {
    preamble = stripBalancedCommand(preamble, 'title')
    preamble = stripBalancedCommand(preamble, 'author')
    preamble = stripBalancedCommand(preamble, 'journal')
  }
  // Strip \Kstroke definitions — the serializer always emits its own.
  preamble = reSub(pyRe(String.raw`\\(?:provide|renew|new)command\{?\\Kstroke\}?.*`), preamble, '')
  // Collapse runs of blank lines.
  preamble = reSub(pyRe(String.raw`\n\s*\n+`), preamble, '\n')
  return strip(preamble)
}

// Commands that journal classes (Wiley, etc.) place inside the body
// between \begin{document} and \maketitle. These are metadata, not
// document content — we extract them and store in frontmatter_extras
// so the round-trip re-emits them correctly.
const BODY_FRONTMATTER_CMDS = [
  'author', 'address', 'authormark', 'titlemark', 'cortext',
  'fntext', 'ead', 'journal', 'abstract', 'keywords',
  'corres', 'presentaddress', 'email',
]

// A journal class kTeX does not know (IUCr, ...) whose front matter sits
// after \begin{document}, with commands the Wiley handling below does not
// cover (\shorttitle, \cauthor, \aff, a two-argument \author{Given}{Surname}):
// kept verbatim and in place, \maketitle included, so it compiles as the
// author wrote it. Returns [front matter, rest of the body], or null.
// The classes kTeX supports (ui/classInfo.ts): their front matter is
// mapped as before.
const CLASSES_KTEX_KNOWS = new Set(['article', 'report', 'book', 'letter', 'beamer', 'memoir', 'scrartcl', 'scrreprt',
  'scrbook', 'scrlttr2', 'elsarticle', 'ieeetran', 'revtex4-2', 'revtex4-1', 'achemso', 'amsart', 'llncs', 'acmart', 'sn-jnl',
  'mnras', 'tufte-handout', 'tufte-book', 'mimosis', 'hepthesis', 'suftesi', 'toptesi', 'disser', 'amsbook', 'elegantbook',
  'apa7', 'moderncv', 'europasscv', 'tikzposter', 'a0poster', 'exam', 'standalone'])
const FRONTMATTER_KNOWN = new Set([...BODY_FRONTMATTER_CMDS, 'title', 'date', 'maketitle', 'and', 'thanks'])

function topLevelCommands(s: string): { name: string; at: number }[] {
  const out: { name: string; at: number }[] = []
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    else if (c === '\\') {
      const m = /^[A-Za-z@]+/.exec(s.slice(i + 1))
      if (m) { if (depth === 0) out.push({ name: m[0], at: i }); i += m[0].length } else i++
    }
  }
  return out
}

export function verbatimFrontMatter(body: string): [string, string] | null {
  const mt = /\\maketitle\b/.exec(body)
  if (!mt) return null
  const end = mt.index + mt[0].length
  const prefix = body.slice(0, end)
  const cmds = topLevelCommands(prefix)
  if (!cmds.some(c => c.name === 'title')) return null
  // A section before \maketitle: not a front-matter block.
  if (cmds.some(c => /^(?:section|chapter|part)$/.test(c.name))) return null
  const twoArgAuthor = /\\author\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}\s*\{/.test(prefix)
  if (!twoArgAuthor && cmds.every(c => FRONTMATTER_KNOWN.has(c.name))) return null
  return [prefix.replace(/^\s+|\s+$/g, ''), body.slice(end)]
}

// Extract body-level frontmatter commands from Wiley-style templates.
// These classes put \author[1]{...}, \address[1]{...}, \authormark{...},
// \titlemark{...} etc. AFTER \begin{document} rather than in the preamble
// or inside a \begin{frontmatter} block.
// Returns [frontmatter_commands, cleaned_body].
function extractBodyFrontmatter(body: string): [string, string] {
  // Find the boundary: \maketitle or the first \section-like command.
  const boundary = reSearch(pyRe(String.raw`\\(?:maketitle|section|chapter)\b`), body)
  if (!boundary) return ['', body]
  const prefix = body.slice(0, boundary.index)
  // Also capture \title{...} from the body prefix (the model already
  // extracts one via _extract_braced, but we need to remove it from
  // the body so it doesn't appear as InlineRaw).
  const cmdsToExtract = [...BODY_FRONTMATTER_CMDS, 'title']
  const collected: string[] = []
  let cleaned = prefix
  for (const cmd of cmdsToExtract) {
    const pat = pyRe('\\\\' + reEscape(cmd) + '\\b')
    for (;;) {
      const m = reSearch(pat, cleaned)
      if (!m) break
      // Walk past optional [...] and required {...} arguments,
      // tolerating whitespace between ] and { (common in .tex).
      const start = m.index
      let p = m.index + m[0].length
      while (p < cleaned.length && WS.includes(cleaned[p])) p++
      while (p < cleaned.length && cleaned[p] === '[') {
        let depth = 1
        let j = p + 1
        while (j < cleaned.length && depth > 0) {
          if (cleaned[j] === '[') depth++
          else if (cleaned[j] === ']') depth--
          j++
        }
        p = j
        while (p < cleaned.length && WS.includes(cleaned[p])) p++
      }
      if (p < cleaned.length && cleaned[p] === '{') p = consumeBraced(cleaned, p)[1]
      const fragment = cleaned.slice(start, p)
      if (cmd !== 'title') collected.push(fragment)  // title already in model
      cleaned = cleaned.slice(0, start) + cleaned.slice(p)
    }
  }
  // Remove \maketitle from the body — the serializer re-emits it.
  let rest = body.slice(boundary.index)
  rest = reSub(pyRe(String.raw`\\maketitle\b\s*`), rest, '', 1)
  const cleanedBody = strip(cleaned) + '\n' + rest
  const frontmatter = collected.join('\n')
  return [frontmatter, cleanedBody]
}

// Return whatever lives inside \begin{frontmatter} that the model doesn't
// already represent (so it can be re-emitted verbatim for Elsevier-style
// document classes).
// Strips the body \title{...} (model carries this), abstract envs (Abstract
// blocks) and keyword envs (Keywords blocks). Keeps the full
// \author[opts]{...\corref{...}} expression, \ead, \cortext, \affiliation,
// \fntext, anything else.
function extractFrontmatterExtras(src: string): string {
  const fm = reSearch(FRONTMATTER_BLOCK_RE, src)
  if (!fm) return ''
  let body = fm[1]
  body = stripBalancedCommand(body, 'title')
  body = reSub(pyRe(String.raw`\\begin\{abstract\}.*?\\end\{abstract\}`, 's'), body, '')
  body = reSub(pyRe(String.raw`\\begin\{keyword(?:s)?\}.*?\\end\{keyword(?:s)?\}`, 's'), body, '')
  // Collapse runs of blank lines that the strip leaves behind.
  body = reSub(pyRe(String.raw`\n\s*\n+`), body, '\n')
  return strip(body)
}

const COMMENT_RE = pyRe(String.raw`(?<!\\)%[^\n]*`)

// Drop LaTeX comments: `%` through end-of-line, except for `\%` and
// KHERVETEX marker comments (compile range / not-compile).
function stripTexComments(src: string): string {
  return reSub(COMMENT_RE, src, (m) => (m[0].includes('KHERVETEX') ? m[0] : ''))
}

// Find `\command[opts]?{...}` in src and return the balanced argument.
// Replaces the previous regex `\\title\{([^}]*)\}` which couldn't see past
// the first `}` and so truncated author lines containing nested macros
// (Elsevier's `\author[ic]{Name\corref{cor1}}` was a casualty).
function extractBraced(src: string, command: string): string | null {
  const m = reSearch(pyRe('\\\\' + reEscape(command) + '\\b'), src)
  if (!m) return null
  let pos = m.index + m[0].length
  // Skip whitespace + optional bracket arguments.
  while (pos < src.length && WS.includes(src[pos])) pos++
  while (pos < src.length && src[pos] === '[') {
    let depth = 1
    let j = pos + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '[') depth++
      else if (src[j] === ']') depth--
      j++
    }
    pos = j
    while (pos < src.length && WS.includes(src[pos])) pos++
  }
  if (pos >= src.length || src[pos] !== '{') return null
  return consumeBraced(src, pos)[0]
}

// Split an \author argument on top-level `\\` line breaks.
// "Name\thanks{...} \\ \small Affiliation" becomes two display lines.
// Breaks inside brace groups (a `\\` within \thanks{...}) don't split,
// and escaped braces don't disturb the depth count.
export function splitAuthorLines(author: string): string[] {
  const parts: string[] = []
  let buf: string[] = []
  let depth = 0
  let i = 0
  const n = author.length
  while (i < n) {
    const c = author[i]
    if (c === '\\' && i + 1 < n) {
      const nxt = author[i + 1]
      if (nxt === '\\' && depth === 0) {
        parts.push(buf.join(''))
        buf = []
        i += 2
        continue
      }
      if ('{}\\'.includes(nxt)) {
        buf.push(c, nxt)
        i += 2
        continue
      }
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
    }
    buf.push(c)
    i++
  }
  parts.push(buf.join(''))
  return parts.filter((p) => strip(p)).map((p) => strip(p))
}

const SECTION_LEVEL: Record<string, number> = {
  chapter: 0,
  section: 1, subsection: 2, subsubsection: 3,
  paragraph: 4, subparagraph: 5,
}

const DOCCLASS_RE = pyRe(String.raw`\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}`)
// Pulls the bracketed options out separately so we can read e.g.
// `twocolumn`, `10pt`, `a4paper` into the model — the bare DOCCLASS_RE
// only captures the class name. Without this, every LaTeX-tab edit
// round-trips with column_count reset to 1 and body_font_pt reset to
// the DocMeta default, so the user's twocolumn / font choice vanishes.
const DOCCLASS_OPTS_RE = pyRe(String.raw`\\documentclass\[([^\]]*)\]\{[^}]+\}`)
// Matches only option-less \usepackage{name} — packages with [opts]
// are kept in preamble_extras so the options survive round-trip.
const PACKAGE_BARE_RE = pyRe(String.raw`\\usepackage\{([^}]+)\}`)
const GEOMETRY_RE = pyRe(String.raw`\\usepackage\[([^\]]*)\]\{geometry\}`)

const BODY_RE = pyRe(String.raw`\\begin\{document\}(.*?)\\end\{document\}`, 's')

// Math environments we recognise as a single MathBlock. The names in the
// group are matched against the closing \end{...} via the backreference.
const MATH_ENVS = [
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*',
  'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*',
  'displaymath', 'split',
]
const MATH_ENV_RE = pyRe(
  String.raw`\\begin\{(` + MATH_ENVS.map(reEscape).join('|') + String.raw`)\}(.*?)\\end\{\1\}`, 's')

// Matches the start of a top-level structure we care about, captured for
// routing. Order matters — math/figure/table envs first so they take
// precedence over generic environments.
const BLOCK_DISPATCH: [string, RegExp][] = [
  // KHERVETEX compile markers — must win before anything else so they
  // survive import as RawLatex blocks instead of becoming paragraph text.
  ['khervetex_marker', pyRe('% ===== KHERVETEX [A-Z ]+ =====')],
  // Math envs win first.
  ['math_block_env', MATH_ENV_RE],
  ['math_block_dd', pyRe(String.raw`\$\$(.*?)\$\$`, 's')],
  ['math_block_bs', pyRe(String.raw`\\\[(.*?)\\\]`, 's')],
  // Lists
  ['itemize', pyRe(String.raw`\\begin\{itemize\}(.*?)\\end\{itemize\}`, 's')],
  ['enumerate', pyRe(String.raw`\\begin\{enumerate\}(.*?)\\end\{enumerate\}`, 's')],
  // Floats and tables
  ['figure', pyRe(String.raw`\\begin\{figure\}(?:\[[^\]]*\])?(.*?)\\end\{figure\}`, 's')],
  ['figure_star', pyRe(String.raw`\\begin\{figure\*\}(?:\[[^\]]*\])?(.*?)\\end\{figure\*\}`, 's')],
  ['table', pyRe(String.raw`\\begin\{table\}(?:\[[^\]]*\])?(.*?)\\end\{table\}`, 's')],
  ['table_star', pyRe(String.raw`\\begin\{table\*\}(?:\[[^\]]*\])?(.*?)\\end\{table\*\}`, 's')],
  ['standalone_tabular', pyRe(String.raw`\\begin\{tabular\}(\{.*?)\\end\{tabular\}`, 's')],
  // Verbatim-style code blocks: preserved as RawLatex so the source survives.
  ['verbatim', pyRe(String.raw`\\begin\{verbatim\}(.*?)\\end\{verbatim\}`, 's')],
  ['lstlisting', pyRe(String.raw`\\begin\{lstlisting\}(?:\[[^\]]*\])?(.*?)\\end\{lstlisting\}`, 's')],
  // Elsevier-style metadata blocks.
  ['abstract', pyRe(String.raw`\\begin\{abstract\}(.*?)\\end\{abstract\}`, 's')],
  ['keyword', pyRe(String.raw`\\begin\{keyword(?:s)?\}(.*?)\\end\{keyword(?:s)?\}`, 's')],
  // Bibliography preserved verbatim so the references round-trip intact.
  ['bibliography', pyRe(String.raw`\\begin\{thebibliography\}\{[^}]*\}(.*?)\\end\{thebibliography\}`, 's')],
  // Alignment envs — emitted by our own serializer for left/center/right
  // paragraphs, so the round-trip path needs to recognise them or it
  // would wrap them in RawLatex via the unknown-env fallback.
  ['flushleft', pyRe(String.raw`\\begin\{flushleft\}(.*?)\\end\{flushleft\}`, 's')],
  ['flushright', pyRe(String.raw`\\begin\{flushright\}(.*?)\\end\{flushright\}`, 's')],
  ['center', pyRe(String.raw`\\begin\{center\}(.*?)\\end\{center\}`, 's')],
  // Beamer frames.
  ['frame', pyRe(String.raw`\\begin\{frame\}(?:\{([^}]*)\})?(.*?)\\end\{frame\}`, 's')],
  // Sections are handled by scanSection (balanced braces) — see parseBlocks.
  ['maketitle', pyRe(String.raw`\\maketitle\b`)],
  ['longtable', pyRe(String.raw`\\begin\{longtable\}\{((?:[^{}]|\{[^{}]*\})*)\}(.*?)\\end\{longtable\}`, 's')],
  // Theorem-like environments (amsthm): editable Theorem paragraphs.
  // A box with its own name and colour: \begin{kCustomBox}[{title}]{kBoxCRRGGBB}.
  ['callout_custom', pyRe(String.raw`\\begin\{kCustomBox\}(?:\[\{?(.*?)\}?\])?\{kBoxC([0-9A-Fa-f]{6})\}(.*?)\\end\{kCustomBox\}`, 's')],
  // Callout boxes this app writes (\newtcolorbox kNoteBox...): back to callouts.
  ['callout_env', pyRe(String.raw`\\begin\{k(Note|Tip|Info|Important|Warning|Danger|Summary)Box\}(?:\[\{?(.*?)\}?\])?(.*?)\\end\{k\1Box\}`, 's')],
  ['theorem_env', pyRe(String.raw`\\begin\{(theorem|lemma|proposition|corollary|definition|example|remark|proof)\}(?:\[([^\]]*)\])?(.*?)\\end\{\1\}`, 's')],
  // Last-resort: any other \begin{...}...\end{...} we don't understand
  // gets wrapped in a RawLatex block instead of leaking its body as
  // plain text. Must remain LAST so the specific handlers above win.
  // `@` is part of internal LaTeX names (e.g. \begin{@twocolumnfalse}
  // used by twocolumn[...] to hold a wide title). Accept it in the
  // env name so the round-trip preserves these blocks verbatim.
  ['unknown_env', pyRe(String.raw`\\begin\{([A-Za-z@]+\*?)\}(?:\[[^\]]*\])?(?:\{[^}]*\})?(.*?)\\end\{\1\}`, 's')],
]

// Reverse the serializer's escape_text on plain runs.
function unescapeText(s: string): string {
  return s
    .replaceAll('\\textbackslash{}', '\\')
    .replaceAll('\\textasciitilde{}', '~')
    .replaceAll('\\textasciicircum{}', '^')
    .replaceAll('\\{', '{').replaceAll('\\}', '}')
    .replaceAll('\\&', '&').replaceAll('\\%', '%')
    .replaceAll('\\$', '$').replaceAll('\\#', '#')
    .replaceAll('\\_', '_')
    .replaceAll('~', '\u00a0')
}

const sortedMarks = (marks: Mark[]) => [...marks].sort().join('\u0000')

// Tokenise inline LaTeX into Text/MathInline/Link/Footnote/Citation/CrossRef.
// Walks the string left-to-right consuming one of: a recognised macro, an
// inline math span, or a plain text run up to the next macro or math span.
export function parseInlines(s: string): Inline[] {
  let out: Inline[] = []
  let i = 0
  const n = s.length
  while (i < n) {
    const ch = s[i]
    if (ch === '$') {
      let j = s.indexOf('$', i + 1)
      if (j < 0) j = n
      out.push(M.mathInline(s.slice(i + 1, j)))
      i = j + 1
      continue
    }
    // \( ... \): inline maths, as $ ... $.
    if (ch === '\\' && s[i + 1] === '(') {
      const j = s.indexOf('\\)', i + 2)
      if (j >= 0) {
        out.push(M.mathInline(s.slice(i + 2, j)))
        i = j + 2
        continue
      }
    }
    if (ch === '\\') {
      if (s.slice(i + 1, i + 2) === '\\') {
        // LaTeX line break \\ — keep it verbatim so titles and
        // paragraphs that force a break round-trip and compile,
        // instead of the second backslash starting a bogus macro
        // (e.g. `\\with` was parsed as the control word \with).
        out.push(M.inlineRaw('\\\\'))
        i += 2
        continue
      }
      const m = matchMacro(s, i)
      if (m !== null) {
        const [node, end] = m
        // Mark macros that wrap multiple children flatten into a
        // list here. Extend the inline stream so the downstream
        // serializer never sees a list-as-inline-node.
        if (Array.isArray(node)) out.push(...node)
        else out.push(node)
        i = end
        continue
      }
    }
    // Plain text run up to the next $ or recognised macro.
    const nxtMath = s.indexOf('$', i)
    const nxtBs = s.indexOf('\\', i)
    const candidates = [nxtMath, nxtBs].filter((c) => c >= 0)
    const end = candidates.length ? Math.min(...candidates) : n
    if (end === i) {
      // Unrecognised macro — treat as a one-char advance to avoid loops.
      out.push(M.text(unescapeText(s.slice(i, i + 1))))
      i += 1
    } else {
      out.push(M.text(unescapeText(s.slice(i, end))))
      i = end
    }
  }
  // Drop empty text fragments left over from unknown-macro consumption.
  out = out.filter((x) => !(x.type === 'Text' && x.text === ''))
  // Merge adjacent text runs with the same marks so a sequence like
  // `\texttt{extract\_all}` produces one `\texttt{extract\_all}` on
  // re-serialisation, not five back-to-back `\texttt{}` groups.
  const merged: Inline[] = []
  for (const x of out) {
    const prev = merged[merged.length - 1]
    if (x.type === 'Text' && prev && prev.type === 'Text' && sortedMarks(prev.marks) === sortedMarks(x.marks)) {
      merged[merged.length - 1] = M.text(prev.text + x.text, x.marks)
    } else {
      merged.push(x)
    }
  }
  return merged
}

// Macros that wrap a single brace argument and translate to a Text mark.
const MARK_MACROS: Record<string, Mark> = {
  textbf: 'bold', textit: 'italic', emph: 'italic',
  underline: 'underline', texttt: 'code', textsc: 'smallcaps',
  textsubscript: 'subscript', textsuperscript: 'superscript',
  sout: 'strikethrough',
}

const ESCAPED_SPECIAL = new Set(['%', '&', '$', '#', '_', '{', '}'])

// Single-character accent macros → combining marks. \'e (Kerhervé), \"o
// (Schrödinger) etc. decode to the composed Unicode letter; leaving the
// backslash in the Text run made escape_text() re-emit it as
// \textbackslash{}'e, corrupting every accented author/title on import.
const ACCENT_COMBINING: Record<string, string> = {
  "'": '\u0301', '`': '\u0300', '^': '\u0302', '"': '\u0308',
  '~': '\u0303', '=': '\u0304', '.': '\u0307',
}

const MACRO_NAME_RE = pyRe(String.raw`\\([A-Za-z@]+)\*?`)

// One Python character (code point) of s at UTF-16 index j.
const charAt = (s: string, j: number): string => String.fromCodePoint(s.codePointAt(j)!)

// Try to consume a recognised macro at position i. Returns [node, end]
// where end is the index past the macro, or null if not recognised.
// Text-symbol commands -> the character they print. Left as raw LaTeX
// they showed in the editor as code chips (5~\AA{} thick); the character
// serializes as itself, which XeLaTeX prints. Like LaTeX, the {} or the
// spaces after the command word are part of it.
const TEXT_SYMBOLS: Record<string, string> = {
  AA: '\u00c5',
  aa: '\u00e5',
  AE: '\u00c6',
  ae: '\u00e6',
  OE: '\u0152',
  oe: '\u0153',
  O: '\u00d8',
  o: '\u00f8',
  ss: '\u00df',
  L: '\u0141',
  l: '\u0142',
  i: '\u0131',
  textdegree: '\u00b0',
  textmu: '\u00b5',
  textperthousand: '\u2030',
  textcopyright: '\u00a9',
  copyright: '\u00a9',
  textregistered: '\u00ae',
  texttrademark: '\u2122',
  pounds: '\u00a3',
  textsterling: '\u00a3',
  S: '\u00a7',
  P: '\u00b6',
  dag: '\u2020',
  ddag: '\u2021',
  textbullet: '\u2022',
  textendash: '\u2013',
  textemdash: '\u2014',
  ldots: '\u2026',
  dots: '\u2026',
  textellipsis: '\u2026',
  textquoteleft: '\u2018',
  textquoteright: '\u2019',
  textquotedblleft: '\u201c',
  textquotedblright: '\u201d',
  guillemotleft: '\u00ab',
  guillemotright: '\u00bb',
  textless: '\u003c',
  textgreater: '\u003e',
  textbar: '\u007c',
  textunderscore: '\u005f',
}

function matchMacro(s: string, i: number): [Inline | Inline[], number] | null {
  // Escaped specials (\%, \&, \$, \#, \_, \{, \}) — emit as literal text.
  if (i + 1 < s.length && ESCAPED_SPECIAL.has(s[i + 1])) return [M.text(s[i + 1]), i + 2]
  // Accent macros: \'e and \'{e} both compose to é.
  if (i + 1 < s.length && Object.hasOwn(ACCENT_COMBINING, s[i + 1])) {
    const mark = ACCENT_COMBINING[s[i + 1]]
    const j = i + 2
    let base: string | null = null
    let end = j
    if (j < s.length && s[j] === '{') {
      const [arg, after] = consumeBraced(s, j)
      if (arg !== null && [...arg].length === 1 && isAlpha(arg)) {
        base = arg
        end = after
      } else if (arg !== null && (strip(arg) === '\\i' || strip(arg) === '\\j')) {
        // na\"{\i}ve: the dotless i under an accent is the letter.
        base = strip(arg)[1]
        end = after
      }
    } else if (j < s.length && isAlpha(charAt(s, j))) {
      base = charAt(s, j)
      end = j + base.length
    }
    if (base !== null) return [M.text((base + mark).normalize('NFC')), end]
  }
  const m = reMatch(MACRO_NAME_RE, s, i)
  if (!m) return null
  const name = m[1]
  const after = i + m[0].length
  if (name === '\\') return [M.text('\n'), after]
  if (Object.hasOwn(MARK_MACROS, name)) {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    const children = parseInlines(arg)
    // Apply this mark on top of any Text children.
    const mark = MARK_MACROS[name]
    for (const c of children) {
      if (c.type === 'Text' && !c.marks.includes(mark)) c.marks.push(mark)
    }
    return [flattenSingle(children), end]
  }
  if (name === 'kcomment') {
    // \kcomment[timestamp]{author}{date}{note}{text} (serializer.ts).
    let j = after, ts = ''
    if (s[j] === '[') {
      const close = s.indexOf(']', j)
      if (close < 0) return null
      ts = s.slice(j + 1, close)
      j = close + 1
    }
    const args: string[] = []
    for (let k = 0; k < 4; k++) {
      const [arg, end] = consumeBraced(s, j)
      if (arg === null) return null
      args.push(arg)
      j = end
    }
    const plain = (t: string) => t.split('\\par ').map((line) => parseInlines(line)
      .map((n) => (n.type === 'Text' ? n.text : '')).join('')).join('\n')
    return [M.comment(parseInlines(args[3]), { author: plain(args[0]), note: plain(args[2]), timestamp: ts }), j]
  }
  if (name === 'href') {
    const [url, end] = consumeBraced(s, after)
    if (url === null) return null
    const [txt, end2] = consumeBraced(s, end)
    if (txt === null) return null
    return [M.link(url, parseInlines(txt)), end2]
  }
  if (name === 'footnote') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [M.footnote(parseInlines(arg)), end]
  }
  if (name === 'cite' || name === 'citep' || name === 'citet' || name === 'citeasnoun') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [M.citation(arg.split(',').filter((k) => strip(k)).map((k) => strip(k)), name), end]
  }
  if (name === 'ref' || name === 'eqref' || name === 'pageref') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [M.crossRef(arg, name), end]
  }
  if (name === 'label') {
    // Strip — section/figure handlers attach labels themselves.
    const [, end] = consumeBraced(s, after)
    return [M.text(''), end > after ? end : after]
  }
  if (name === 'url') {
    const [arg, end] = consumeBraced(s, after)
    if (arg === null) return null
    return [M.link(arg, [M.text(arg)]), end]
  }
  if (name === 'sep') {
    // Elsevier keyword separator — render as a middle dot.
    return [M.text(' · '), after]
  }
  if (Object.hasOwn(TEXT_SYMBOLS, name) && s[after - 1] !== '*') {
    let end = after
    if (s.startsWith('{}', end)) end += 2
    else while (end < s.length && ' \t\n'.includes(s[end])) end++
    return [M.text(TEXT_SYMBOLS[name]), end]
  }
  if (name === 'verb') {
    // \verb<delim>...<delim> — inline verbatim, render as code mark.
    if (after >= s.length) return null
    const delim = s[after]
    const close = s.indexOf(delim, after + 1)
    if (close < 0) return null
    return [M.text(s.slice(after + 1, close), ['code']), close + 1]
  }

  // Unknown command — consume the macro plus any [...] options and
  // {...} arguments so the outer loop makes progress, and preserve
  // the original source as an InlineRaw node. This is what keeps
  // user-defined commands like \Kstroke surviving a .tex import
  // instead of being silently dropped.
  let pos = after
  while (pos < s.length && s[pos] === '[') {
    let depth = 1
    let j = pos + 1
    while (j < s.length && depth > 0) {
      if (s[j] === '[') depth++
      else if (s[j] === ']') depth--
      j++
    }
    pos = j
  }
  while (pos < s.length && s[pos] === '{') {
    const newPos = consumeBraced(s, pos)[1]
    if (newPos === pos) break  // unbalanced brace — stop to avoid infinite loop
    pos = newPos
  }
  return [M.inlineRaw(s.slice(i, pos)), pos]
}

// Read a balanced {...} starting at s[i]. Returns [content, end_index].
function consumeBraced(s: string, i: number): [string | null, number] {
  if (i >= s.length || s[i] !== '{') return [null, i]
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++
    else if (s[j] === '}') {
      depth--
      if (depth === 0) return [s.slice(i + 1, j), j + 1]
    }
  }
  return [null, i]
}

// Inline-macro helper: when a mark macro wraps a single child it's cleaner
// to surface that child directly rather than a one-element list; several
// children come back as the list for the caller to splice in.
function flattenSingle(nodes: Inline[]): Inline | Inline[] {
  if (!nodes.length) return M.text('')
  return nodes.length === 1 ? nodes[0] : nodes
}

// Find the next section command at or after `start` and extract its
// argument using balanced-brace matching so nested commands like
// \textbf{...} inside the heading survive.
function scanSection(body: string, start: number): Hit | null {
  const m = reSearch(SECTION_PREFIX_RE, body, start)
  if (!m) return null
  const cmd = m[1]
  const star = m[2]
  let bracePos = m.index + m[0].length
  // Skip whitespace between prefix and opening brace.
  while (bracePos < body.length && WS.includes(body[bracePos])) bracePos++
  if (bracePos >= body.length || body[bracePos] !== '{') return null
  const [content, endPos] = consumeBraced(body, bracePos)
  if (content === null) return null
  return { start: m.index, end: endPos, g: [undefined, cmd, star, content] }
}

const BRACKET_ARG_MACROS = ['twocolumn', 'onecolumn']
const BRACKET_ARG_RES = BRACKET_ARG_MACROS.map((name) => pyRe('\\\\' + reEscape(name) + String.raw`(?![A-Za-z])\s*\[`))

// Find the next occurrence at or after `start` of any \twocolumn[...] /
// \onecolumn[...] (etc.) and return [match_start, match_end] covering both
// the macro and its bracketed body, with depth-tracked '[' / ']' balancing.
//
// These macros sit at block level and contain free-form LaTeX
// (\begin{@twocolumnfalse}\maketitle\tableofcontents...). Without treating
// the whole macro+arg as one opaque RawLatex block, the regex-based block
// parser dives into the bracket content and breaks the structure
// (\maketitle gets pulled out, the closing \end{@twocolumnfalse} ends up
// dangling, etc.).
function scanBracketArgMacro(body: string, start: number): [number, number] | null {
  let best: [number, number] | null = null
  for (const pat of BRACKET_ARG_RES) {
    const m = reSearch(pat, body, start)
    if (!m) continue
    // Walk forward from the opening '[' to the matching ']'.
    let j = m.index + m[0].length  // one past the opening '['
    let depth = 1
    const n = body.length
    while (j < n && depth > 0) {
      if (body[j] === '[') depth++
      else if (body[j] === ']') depth--
      j++
    }
    // Unbalanced — bail out, don't pretend to consume.
    if (depth !== 0) continue
    if (best === null || m.index < best[0]) best = [m.index, j]
  }
  return best
}

// A paragraph that is one frame: [\medskip][\noindent]\fbox{\parbox[pos]{width}{BODY}}
// and nothing else. Anything else in the paragraph leaves it as it was.
const BOX_HEAD = /^(?:\\(?:noindent|medskip|smallskip|bigskip|par)(?![a-zA-Z])\s*)*\\fbox\s*\{\s*\\parbox\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}\s*(?=\{)/

function parseBoxParagraph(para: string): Block | null {
  const m = BOX_HEAD.exec(para)
  if (!m) return null
  const [body, end] = consumeBraced(para, m[0].length)
  if (body === null || para.slice(end).trim() !== '}') return null
  const children = parseInlines(strip(body))
  return children.length ? M.box(children) : null
}

// Walk the document body and produce a list of Block nodes.
function parseBlocks(body: string): Block[] {
  const blocks: Block[] = []
  let i = 0
  const n = body.length
  while (i < n) {
    // Find the earliest start of any recognised block.
    let bestKind: string | null = null
    let bestMatch: Hit | null = null
    let bestStart = n
    // Bracket-argument block-level macros (\twocolumn[...]) win
    // first so the dispatch regexes don't dive into their bodies.
    const ba = scanBracketArgMacro(body, i)
    if (ba !== null && ba[0] < bestStart) {
      const [baStart, baEnd] = ba
      bestKind = 'bracket_arg_macro'
      bestMatch = { start: baStart, end: baEnd, g: [body.slice(baStart, baEnd)] }
      bestStart = baStart
    }
    // Section commands use balanced-brace extraction so nested
    // macros like \textbf{...} inside headings don't break.
    const sec = scanSection(body, i)
    if (sec !== null && sec.start < bestStart) {
      bestKind = 'section'
      bestMatch = sec
      bestStart = sec.start
    }
    for (const [kind, regex] of BLOCK_DISPATCH) {
      const m = reSearch(regex, body, i)
      if (m && m.index < bestStart) {
        bestKind = kind
        bestMatch = hit(m)
        bestStart = m.index
      }
    }
    // Anything before that is paragraph text.
    if (bestStart > i) {
      const chunk = body.slice(i, bestStart)
      for (const para of splitParagraphs(chunk)) {
        const framed = parseBoxParagraph(para)
        if (framed) { blocks.push(framed); continue }
        const children = parseInlines(para)
        if (children.length) blocks.push(M.paragraph(children))
      }
    }
    if (bestMatch === null) break
    const node = dispatch(bestKind!, bestMatch)
    if (Array.isArray(node)) blocks.push(...node)
    else if (node !== null) blocks.push(node)
    i = bestMatch.end
  }
  return blocks
}

const PARA_SPLIT_RE = pyRe(String.raw`\n\s*\n`)

function splitParagraphs(chunk: string): string[] {
  return reSplit(PARA_SPLIT_RE, chunk).filter((p) => strip(p)).map((p) => strip(p))
}

const ALIGN_ENVS: Record<string, M.Alignment> = { flushleft: 'left', flushright: 'right', center: 'center' }

function dispatch(kind: string, m: Hit): Block | Block[] | null {
  const g = m.g
  if (kind === 'khervetex_marker') return M.rawLatex(g[0]!)
  if (kind === 'bracket_arg_macro') {
    // \twocolumn[ ... ]: preserved verbatim. The captured text
    // already includes the macro name and the balanced brackets.
    return M.rawLatex(g[0]!)
  }
  if (kind === 'math_block_env') {
    const envName = g[1]!
    const body = strip(g[2]!)
    // `align`, `gather`, `multline`, `eqnarray`, `split` etc. are still
    // legal LaTeX math; preserve them verbatim inside the MathBlock
    // so re-serialization keeps the same environment instead of
    // downgrading to a plain equation. Numbered status follows the *
    // convention.
    let bodyForModel = body
    if (envName !== 'equation' && envName !== 'equation*') {
      bodyForModel = `\\begin{${envName}}\n${body}\n\\end{${envName}}`
    }
    return M.mathBlock(bodyForModel, !envName.endsWith('*'))
  }
  if (kind === 'math_block_dd') return M.mathBlock(strip(g[1]!), false)
  if (kind === 'math_block_bs') return M.mathBlock(strip(g[1]!), false)
  if (kind === 'section') {
    const cmd = g[1]!
    const star = g[2]!
    const body = g[3]!
    const level = Object.hasOwn(SECTION_LEVEL, cmd) ? SECTION_LEVEL[cmd] : 1
    return M.section(level, parseInlines(body), star === '')
  }
  if (kind === 'itemize') return parseList(g[1]!, false)
  if (kind === 'enumerate') return parseList(g[1]!, true)
  // A figure with no picture (a framed placeholder, a drawing in code):
  // kept as written rather than turned into an empty \includegraphics.
  if (kind === 'figure') return /\\includegraphics\b/.test(g[1]!) ? parseFigure(g[1]!) : M.rawLatex(`\\begin{figure}\n${g[1]!.replace(/^\s*\n/, '').replace(/\s+$/, '')}\n\\end{figure}`)
  if (kind === 'figure_star') {
    // Two-column figures (figure*) often contain tikzpicture or
    // complex layouts the Figure model can't represent — preserve
    // the entire environment verbatim so it round-trips correctly.
    return M.rawLatex(g[0]!)
  }
  if (kind === 'table') return parseTableEnv(g[1]!)
  if (kind === 'table_star') return M.rawLatex(g[0]!)
  if (kind === 'standalone_tabular') {
    // group(1) = everything from the opening { of the alignment spec
    // to \end{tabular}. Use balanced-brace extraction to split
    // the alignment spec (may contain p{0.55\columnwidth}) from body.
    const raw = g[1]!
    const [alignSpec, endPos] = consumeBraced(raw, 0)
    const tabBody = raw.slice(endPos)
    return parseTabular(alignSpec || '', tabBody)
  }
  if (kind === 'verbatim') return M.rawLatex(`\\begin{verbatim}${g[1]}\\end{verbatim}`)
  if (kind === 'lstlisting') {
    // Preserve the full matched env (including any [caption=...]).
    return M.rawLatex(g[0]!)
  }
  if (kind === 'longtable') {
    let body = g[2]!
    let caption = ''
    let label: string | null = null
    const cap = reSearch(pyRe(String.raw`\\caption\{`), body)
    if (cap) {
      const [txt, end] = consumeBraced(body, cap.index + cap[0].length - 1)
      caption = strip(txt || '')
      body = body.slice(0, cap.index) + body.slice(end)
    }
    const lab = reSearch(pyRe(String.raw`\\label\{([^}]*)\}`), body)
    if (lab) {
      label = lab[1]
      body = body.slice(0, lab.index) + body.slice(lab.index + lab[0].length)
    }
    const at = body.indexOf('\\endhead')
    if (at >= 0) body = body.slice(0, at) + '\\\\' + body.slice(at + '\\endhead'.length)
    body = reSub(pyRe(String.raw`\\end(first)?head|\\end(last)?foot`), body, '')
    body = reSub(pyRe(String.raw`^\s*\\\\`), strip(body), '')
    const tbl = parseTabular(g[1]!, body)
    tbl.caption = caption
    tbl.label = label
    tbl.repeat_header = true
    return tbl
  }
  if (kind === 'callout_custom') {
    const paras = splitParagraphs(g[3]!)
    if (!paras.length) paras.push('')
    return paras.map((p, i) => M.theorem('custom', strip(g[1] || ''), parseInlines(p), i === 0, `#${g[2]!.toUpperCase()}`))
  }
  if (kind === 'callout_env') {
    const paras = splitParagraphs(g[3]!)
    if (!paras.length) paras.push('')
    return paras.map((p, i) => M.theorem(g[1]!.toLowerCase(), strip(g[2] || ''), parseInlines(p), i === 0))
  }
  if (kind === 'theorem_env') {
    const paras = splitParagraphs(g[3]!)
    if (!paras.length) paras.push('')
    return paras.map((p, i) => M.theorem(g[1]!, strip(g[2] || ''), parseInlines(p), i === 0))
  }
  if (kind === 'abstract') {
    // Split the abstract body into paragraphs (blank-line separated)
    // and emit one Abstract block per paragraph. Consecutive Abstract
    // blocks are merged back into a single env on re-serialisation.
    return splitParagraphs(g[1]!).map((para) => M.abstract(parseInlines(para)))
  }
  if (kind === 'keyword') {
    // \sep separates terms in the source. Render them in the editor
    // as a single Keywords block whose children are the terms joined
    // by a visible ' · ' separator — the previous per-term layout
    // produced one italic paragraph per keyword, which the user
    // rightly disliked. The serializer splits on the same visible
    // separator to reconstruct the \sep-separated form.
    const parts = reSplit(pyRe(String.raw`\\sep\b\s*`), g[1]!).filter((p) => strip(p)).map((p) => strip(p))
    if (!parts.length) return []
    const inlines: Inline[] = []
    parts.forEach((part, i) => {
      if (i > 0) inlines.push(M.text(' · '))
      inlines.push(...parseInlines(part))
    })
    return [M.keywords(inlines)]
  }
  if (kind === 'bibliography') return M.rawLatex(g[0]!)
  if (Object.hasOwn(ALIGN_ENVS, kind)) {
    // Treat the env body as paragraphs that all share the alignment
    // the env enforces. Parse the inside recursively in case it
    // contains lists, math, etc.
    const alignName = ALIGN_ENVS[kind]
    const subBlocks = parseBlocks(g[1]!)
    for (const sub of subBlocks) {
      if (sub.type === 'Paragraph') sub.alignment = alignName
    }
    return subBlocks
  }
  if (kind === 'unknown_env') {
    const envName = g[1]!
    // Some envs are pure wrappers we want to strip entirely
    // (frontmatter brackets the real content).
    if (envName === 'frontmatter') return parseBlocks(g[2]!)
    return M.rawLatex(g[0]!)
  }
  if (kind === 'frame') {
    const ttl = strip(g[1] || '')
    const body = strip(g[2] || '')
    const out: Block[] = []
    if (body.includes('\\titlepage')) {
      out.push(M.title(ttl ? [M.text(ttl)] : []))
    } else {
      out.push(M.frame(ttl ? parseInlines(ttl) : []))
      out.push(...parseBlocks(body))
    }
    return out
  }
  return null
}

const ITEM_SPLIT_RE = pyRe(String.raw`\\item\b`)

function parseList(body: string, ordered: boolean): M.List {
  const items: M.ListItem[] = []
  const rawItems = reSplit(ITEM_SPLIT_RE, body)
  for (const it of rawItems.slice(1)) {  // discard preamble before first \item
    const txt = strip(it)
    if (txt) items.push(M.listItem(parseInlines(txt)))
  }
  return M.list(ordered, items)
}

const CAPTION_RE = pyRe(String.raw`\\caption\{`)
const LABEL_RE = pyRe(String.raw`\\label\{([^}]*)\}`)

function parseFigure(body: string): M.Figure {
  const inc = reSearch(pyRe(String.raw`\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}`), body)
  // Caption may contain other macros; use the balanced consumer to grab
  // its full content even when it includes nested braces.
  const capMatch = reSearch(CAPTION_RE, body)
  let caption = ''
  if (capMatch) {
    const [txt] = consumeBraced(body, capMatch.index + capMatch[0].length - 1)
    caption = strip(txt || '')
  }
  const lab = reSearch(LABEL_RE, body)
  let width = '0.8\\textwidth'
  // Several pictures in one figure: a row under one caption.
  const incs = [...body.matchAll(/\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/g)]
  const sizeOf = (opts: string | undefined, key: string) => {
    const m = new RegExp(`${key}\\s*=\\s*([^,\\]]+)`).exec(opts || '')
    return m ? m[1].trim() : ''
  }
  if (incs.length > 1) {
    const [first, ...rest] = incs
    const fh = sizeOf(first[1], 'height')
    return M.figure({
      path: first[2], caption, label: lab ? lab[1] : null,
      width: sizeOf(first[1], 'width') || '0.8\\textwidth',
      height: fh,
      extra: rest.map((m) => {
        const h = sizeOf(m[1], 'height')
        return h ? { path: m[2], height: h } : { path: m[2], width: sizeOf(m[1], 'width') || '0.3\\textwidth' }
      }),
    })
  }
  // \resizebox{W}{!}{\includegraphics{...}}: the picture W wide.
  const rb = /\\resizebox\s*\{([^{}]+)\}\s*\{\s*!\s*\}\s*\{\s*\\includegraphics/.exec(body)
  if (inc) {
    const opts = inc[1] || ''
    const wm = reSearch(pyRe(String.raw`width\s*=\s*([^,\]]+)`), opts)
    if (wm) {
      width = strip(wm[1])
    } else if (rb) {
      width = strip(rb[1])
    } else if (!strip(opts)) {
      // Original had no width — use \columnwidth so figures fit
      // in single-column or two-column layouts alike.
      width = '\\columnwidth'
    }
  }
  return M.figure({
    path: inc ? inc[2] : '',
    caption,
    label: lab ? lab[1] : null,
    width,
  })
}

// Parse a \begin{table}...\end{table} float. If it wraps a tabular,
// return a Table; otherwise fall back to a RawLatex block so nothing
// is lost.
function parseTableEnv(body: string): Block {
  const tabStart = reSearch(pyRe(String.raw`\\begin\{tabular\}\{`), body)
  const tabEndM = reSearch(pyRe(String.raw`\\end\{tabular\}`), body)
  let tab = false
  let tabAlign: string | null = ''
  let tabBody = ''
  if (tabStart && tabEndM) {
    const bracePos = tabStart.index + tabStart[0].length - 1  // position of the opening {
    let after: number
    ;[tabAlign, after] = consumeBraced(body, bracePos)
    tabBody = body.slice(after, tabEndM.index)
    tab = true
  }
  const capMatch = reSearch(CAPTION_RE, body)
  let caption = ''
  if (capMatch) {
    const [txt] = consumeBraced(body, capMatch.index + capMatch[0].length - 1)
    caption = strip(txt || '')
  }
  const lab = reSearch(LABEL_RE, body)
  const label = lab ? lab[1] : null
  if (!tab) return M.rawLatex(`\\begin{table}${body}\\end{table}`)
  const tbl = parseTabular(tabAlign || '', tabBody)
  tbl.caption = caption
  tbl.label = label
  return tbl
}

// If `txt` starts with \command{a1}...{an}{X}, return [[a1..an], X]; else null.
function unwrap(txt: string, command: string, nArgs: number): [string[], string] | null {
  const t = strip(txt)
  if (!t.startsWith(command + '{')) return null
  let i = command.length
  const args: string[] = []
  for (let k = 0; k < nArgs + 1; k++) {
    while (i < t.length && ' \t'.includes(t[i])) i++
    const [val, next] = consumeBraced(t, i)
    i = next
    if (val === null) return null
    args.push(val)
  }
  if (strip(t.slice(i))) return null
  return [args.slice(0, -1), args[args.length - 1]]
}

const CELLCOLOR_RE = pyRe(String.raw`\\cellcolor\[HTML\]\{([0-9A-Fa-f]{6})\}\s*`)

// (text, rowspan, colspan, colour) of one tabular cell.
function tableCellFeatures(raw: string): [string, number, number, string | null] {
  let txt = strip(raw)
  let rs = 1
  let cs = 1
  let color: string | null = null
  let got = unwrap(txt, '\\multicolumn', 2)
  if (got) {
    cs = got[0][0] ? pyIntParse(got[0][0]) : 1
    txt = strip(got[1])
  }
  got = unwrap(txt, '\\multirow', 2)
  if (got) {
    rs = got[0][0] ? pyIntParse(got[0][0]) : 1
    txt = strip(got[1])
  }
  const m = reMatch(CELLCOLOR_RE, txt)
  if (m) {
    color = '#' + m[1].toLowerCase()
    txt = txt.slice(m[0].length)
  }
  return [txt, rs, cs, color]
}

const TEXTBF_CELL_RE = pyRe(String.raw`\\textbf\{.*\}`, 's')
const GRID_ALIGN_RE = pyRe(String.raw`\|(?:(?:[lcr]|[pmb]\{[^}]*\})\|)+`)

// Turn a tabular body into a Table model node. Cells are stored as plain
// text strings (matching the model); embedded LaTeX inside a cell is
// preserved verbatim because the existing serializer escapes only
// plain-text cell content. Merged cells (\multicolumn / \multirow),
// \cellcolor shading, a bold header row and the grid / striped styles the
// serializer writes are read back into the model.
function parseTabular(alignSpec: string, body: string): Table {
  const striped = reSearch(pyRe(String.raw`\\rowcolor\[HTML\]\{EEF3FA\}`, 'i'), body) !== null
  body = reSub(pyRe(String.raw`\\rowcolor(\[[^\]]*\])?\{[^}]*\}`), body, '')
  const nHline = [...body.matchAll(pyRe(String.raw`\\hline\b`))].length
  let style = reSearch(pyRe(String.raw`\\(toprule|midrule|bottomrule)\b`), body) ? 'booktabs' : ''
  if (striped && style === 'booktabs') style = 'striped'
  // Drop common line-rule commands so they don't survive into cell text.
  body = reSub(pyRe(String.raw`\\hline\b`), body, '')
  body = reSub(pyRe(String.raw`\\toprule|\\midrule|\\bottomrule|\\cline\{[^}]*\}`), body, '')
  // Strip extra LaTeX comments and whitespace.
  const rowsRaw = reSplit(pyRe(String.raw`\\\\\s*`), body)
  const rows: string[][] = []
  for (const raw of rowsRaw) {
    const line = strip(raw)
    if (!line) continue
    rows.push(line.split('&').map((c) => strip(c)))
  }
  const merges: number[][] = []
  const shading: Record<string, string> = {}
  const outRows: string[][] = []
  rows.forEach((cells, r) => {
    const out: string[] = []
    for (const raw of cells) {
      const [txt, rs, cs, color] = tableCellFeatures(raw)
      const c = out.length
      if (rs > 1 || cs > 1) {
        if (txt || rs > 1) merges.push([r, c, rs, cs])
      }
      if (color) shading[`${r},${c}`] = color
      out.push(txt)
      for (let k = 0; k < cs - 1; k++) out.push('')
    }
    outRows.push(out)
  })
  const header = outRows.length > 1
    && outRows[0].filter((c) => c).every((c) => reFullmatch(TEXTBF_CELL_RE, c) !== null)
    && outRows[0].some((c) => c)
  if (header) outRows[0] = outRows[0].map((c) => (c ? c.slice('\\textbf{'.length, -1) : c))
  // Preserve the raw alignment spec — p{0.55\columnwidth} and the
  // vertical-rule pipes both round-trip, and the editor draws the rules.
  const alignment = strip(alignSpec)
  if (!style && nHline >= 3 && reFullmatch(GRID_ALIGN_RE, alignment)) {
    style = 'grid'
  } else if (!style && nHline === 0 && outRows.length) {
    style = 'plain'
  }
  return M.table({ rows: outRows, alignment: alignment || '', style, merges, header, shading })
}

const INCLUDE_RE = pyRe(
  String.raw`\\(input|include|subfile)\s*\{([^}]+)\}`
  + String.raw`|\\(?:sub)?import\*?\s*\{([^}]*)\}\s*\{([^}]+)\}`)
const DOC_BODY_RE = pyRe(String.raw`\\begin\{document\}(.*?)\\end\{document\}`, 's')

// pathlib on '/'-separated paths: Path(a) / b / c, with Path's collapsing
// of empty and '.' components.
function joinPath(...parts: string[]): string {
  let out = ''
  for (const p of parts) {
    if (p.startsWith('/')) out = p
    else if (p) out = out ? (out.endsWith('/') ? out + p : out + '/' + p) : p
  }
  const abs = out.startsWith('/')
  const segs = out.split('/').filter((s) => s && s !== '.')
  return (abs ? '/' : '') + segs.join('/') || '.'
}

// Path.resolve() without a filesystem: '..' collapses lexically.
function normalizePath(p: string): string {
  const abs = p.startsWith('/')
  const segs: string[] = []
  for (const s of p.split('/')) {
    if (!s || s === '.') continue
    if (s === '..') {
      if (segs.length && segs[segs.length - 1] !== '..') segs.pop()
      else if (!abs) segs.push('..')
    } else segs.push(s)
  }
  return (abs ? '/' : '') + segs.join('/') || (abs ? '/' : '.')
}

const pathName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const pathParent = (p: string) => {
  const k = p.lastIndexOf('/')
  return k < 0 ? '.' : k === 0 ? '/' : p.slice(0, k)
}
// Path.suffix: the final component's extension, '' for dot-files.
const pathSuffix = (p: string) => {
  const name = pathName(p)
  const k = name.lastIndexOf('.')
  return k > 0 && k < name.length - 1 ? name.slice(k) : ''
}

// Inline `\input`, `\include`, `\subfile` and `\import` targets found under
// baseDir, recursively, so a multi-file project imports as one document
// instead of a stray `\input{ch1}` line. A standalone subfile contributes
// only its document body. Missing files are left as the original command
// (still preserved as raw LaTeX).
export function expandIncludes(
  texSource: string, baseDir: string, fs: ImportFs = NO_FS,
  seen: ReadonlySet<string> = new Set(), depth = 0,
): string {
  texSource = stripTexComments(texSource)
  if (depth > 20) return texSource
  const resolve = fs.resolve ?? normalizePath

  return reSub(INCLUDE_RE, texSource, (m) => {
    let kind: string
    let relDir: string
    let name: string
    if (m[1]) {
      kind = m[1]
      relDir = ''
      name = strip(m[2])
    } else {
      kind = 'import'
      relDir = strip(m[3])
      name = strip(m[4])
    }
    let path = joinPath(baseDir, relDir, name)
    if (!fs.isFile(path) && pathSuffix(path) !== '.tex') {
      path = joinPath(pathParent(path), pathName(path) + '.tex')
    }
    try {
      path = resolve(path)
    } catch {
      return m[0]
    }
    if (!fs.isFile(path) || seen.has(path)) return m[0]
    let child = fs.readText(path)
    if (child === null) return m[0]
    // Python reads in text mode: universal newlines.
    child = child.replace(/\r\n?/g, '\n')
    const bodyM = reSearch(DOC_BODY_RE, child)
    if (bodyM) child = bodyM[1]
    // \import changes the base for the file's own relative paths.
    const childBase = kind === 'import' ? pathParent(path) : baseDir
    return '\n' + expandIncludes(child, childBase, fs, new Set([...seen, path]), depth + 1) + '\n'
  })
}

const STANDARD_CLASSES = new Set([
  'article', 'report', 'book', 'letter', 'memoir', 'beamer',
  'scrartcl', 'scrreprt', 'scrbook',
])

// Parse a LaTeX source string into a Document. Unknown commands and
// environments are preserved as RawLatex blocks so nothing is silently
// lost from the source. With baseDir, files pulled in by `\input` and
// friends are inlined first (see expandIncludes).
export function importTex(texSource: string, baseDir: string | null = null, fs: ImportFs = NO_FS): Document {
  // The review column is written back by the serializer while there are
  // comments: never kept as the document's own preamble.
  texSource = texSource.replace(REVIEW_PREAMBLE, '')
  // Callout boxes' definitions: the serializer writes them again for the boxes in use.
  texSource = texSource.replace(/^\\(?:definecolor\{k(?:[A-Z][a-z]+Box|Box)C[0-9A-F]*\}|newtcolorbox\{k[A-Z][a-z]+Box\}).*\n?/gm, '')
  // Strip line comments first — Elsevier templates use `%%` ruled
  // banners between sections, and without this every banner would
  // appear as a stray paragraph in the imported document.
  texSource = stripTexComments(texSource)
  if (baseDir !== null && baseDir !== undefined) texSource = expandIncludes(texSource, baseDir, fs)
  // \addcontentsline{toc}{section}{T} right after \section*{T} is how the
  // serializer lists an unnumbered heading in the table of contents: it is
  // written again on export, so it is not a block of its own.
  texSource = texSource.replace(
    /(\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}[ \t]*\n?(?:\\label\{[^}]*\}[ \t]*\n?)?)[ \t]*\\addcontentsline\{toc\}\{\2\}\{\3\}[ \t]*\n?/g,
    '$1')

  const docclassM = reSearch(DOCCLASS_RE, texSource)
  // Use balanced-brace extraction for title/author so Elsevier-style
  // `\author[ic]{Name\corref{cor1}}` arguments aren't truncated at the
  // first inner `}`.
  const titleText = extractBraced(texSource, 'title')
  const authorText = extractBraced(texSource, 'author')
  const geomM = reSearch(GEOMETRY_RE, texSource)
  // Only collect option-less packages into the model — packages with
  // options (\usepackage[utf8]{inputenc}) are kept in preamble_extras.
  const packages = reFindall(PACKAGE_BARE_RE, texSource).filter((p) => p !== 'geometry' && p !== 'setspace')

  let pageSize = 'A4'
  const margins: Record<string, number> = { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 }
  if (geomM) {
    const optsLower = geomM[1].toLowerCase()
    if (optsLower.includes('letterpaper')) pageSize = 'Letter'
    else if (optsLower.includes('legalpaper')) pageSize = 'Legal'
    else if (optsLower.includes('a4paper')) pageSize = 'A4'
    for (const side of Object.keys(margins)) {
      const dimM = reSearch(pyRe(side + String.raw`\s*=\s*([\d.]+)\s*(in|cm|mm|pt)`), optsLower)
      if (dimM) {
        let val = pyFloatParse(dimM[1])
        const unit = dimM[2]
        if (unit === 'in') val *= 2.54
        else if (unit === 'mm') val /= 10
        else if (unit === 'pt') val *= 0.03528
        margins[side] = pyRound(val, 2)
      }
    }
  }

  // Strip nested macros from the author line — \corref{} etc. clutter
  // the visible author name. The cleaned author can still live in
  // meta.author; the full original is in the source if needed.
  const authorClean = authorText
    ? strip(reSub(pyRe(String.raw`\\[A-Za-z@]+\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?`), authorText, ''))
    : ''
  // A standard-class title block often carries LaTeX the flat name can't
  // hold: \thanks{...} footnotes, \\ breaks, \small affiliations. Flattening
  // those away broke the round-trip (and produced garbled `Name}\\` authors).
  // Keep such an author verbatim so it re-serialises and compiles unchanged;
  // journal/Elsevier classes keep their raw author in frontmatter_extras and
  // still want the cleaned display name here.
  const authorIsRich = !!authorText && reSearch(pyRe(String.raw`\\[A-Za-z@]+|\\\\`), authorText) !== null
  const docClass = docclassM ? docclassM[1] : 'article'
  const isStandard = STANDARD_CLASSES.has(docClass.toLowerCase())

  // Parse the \documentclass[...] options so we don't drop column
  // count / body font size on every LaTeX-tab edit. Without this,
  // editing the LaTeX view round-trips `[10pt,twocolumn]` into
  // `[12pt]{article}` because the model defaults take over.
  const classOptsM = reSearch(DOCCLASS_OPTS_RE, texSource)
  const rawClassOpts = classOptsM ? strip(classOptsM[1]) : ''
  const docClassOpts = rawClassOpts ? rawClassOpts.split(',').map((o) => strip(o)) : []
  const PT_RE = pyRe(String.raw`(\d+)pt$`)
  let bodyFontPt = 12
  for (const opt of docClassOpts) {
    const mPt = reMatch(PT_RE, opt)
    if (mPt) {
      bodyFontPt = pyIntParse(mPt[1])
      break
    }
  }
  let columnCount = 1
  if (docClassOpts.includes('twocolumn')) columnCount = 2
  // `onecolumn` is the default; leave column_count at 1.

  // For non-standard classes (journal templates) preserve the raw
  // options string so "VANCOUVER,LATO2COL" etc. survive round-trip.
  // For standard classes, preserve extra options (a4paper, draft,
  // landscape, etc.) that the serializer doesn't reconstruct itself.
  let classOptions: string
  if (isStandard) {
    const reconstructed = new Set(['twocolumn', 'onecolumn'])
    const extra = docClassOpts.filter((o) => o && !reMatch(PT_RE, o) && !reconstructed.has(o))
    classOptions = extra.length ? extra.join(',') : ''
  } else {
    classOptions = rawClassOpts
  }

  // For Elsevier classes we keep \author[opts]{...\corref{...}},
  // \ead, \cortext, \affiliation etc. as raw LaTeX in frontmatter_extras
  // so the round-trip reproduces the journal's title-block layout
  // (author superscript, affiliation line, "Corresponding author"
  // footnote) instead of dropping these as unknown macros.
  const isElsarticle = docClass.toLowerCase().startsWith('elsarticle')
  let frontmatterExtras = isElsarticle ? extractFrontmatterExtras(texSource) : ''
  // Preserve every other preamble customisation (\lstset for listings
  // styling, \definecolor, \hypersetup, custom \newcommand etc.) so
  // the PDF re-compiled from KherveTeX retains the framed line-numbered
  // syntax-coloured code blocks the user authored upstream.
  const preambleExtras = extractPreambleExtras(texSource, isStandard)
  const keepRawAuthor = isStandard && !isElsarticle && authorIsRich
  const meta = M.docMeta({
    title: strip(titleText || ''),
    author: keepRawAuthor ? strip(authorText!) : authorClean,
    documentclass: docClass,
    class_options: classOptions,
    packages: packages.length ? packages : ['amsmath', 'graphicx'],
    page_size: pageSize,
    margin_top_cm: margins.top,
    margin_bottom_cm: margins.bottom,
    margin_left_cm: margins.left,
    margin_right_cm: margins.right,
    body_font_pt: bodyFontPt,
    column_count: columnCount,
    frontmatter_extras: frontmatterExtras,
    preamble_extras: preambleExtras,
  })

  const bodyM = reSearch(BODY_RE, texSource)
  let body = bodyM ? bodyM[1] : texSource

  // Non-elsarticle journal classes (Wiley, etc.) place author/address
  // commands in the body rather than the preamble or a frontmatter env.
  // Extract them before parsing blocks so they don't become InlineRaw.
  let bodyAbstractText = ''
  let bodyKeywordsText = ''
  // An unknown journal class's own front matter: kept as written.
  const verbatim = !isStandard && !isElsarticle && !CLASSES_KTEX_KNOWS.has(docClass.toLowerCase()) ? verbatimFrontMatter(body) : null
  if (verbatim) {
    body = verbatim[1]
    meta.title = ''
    meta.author = ''
  } else if (!isStandard && !isElsarticle) {
    let bodyFm: string
    ;[bodyFm, body] = extractBodyFrontmatter(body)
    if (bodyFm) {
      // Pull abstract and keywords out of body_fm so they become
      // proper model nodes (highlighted in the editor) instead of
      // opaque raw LaTeX in frontmatter_extras.
      const absContent = extractBraced(bodyFm, 'abstract')
      if (absContent !== null) {
        bodyAbstractText = absContent
        bodyFm = stripBalancedCommand(bodyFm, 'abstract')
      }
      const kwContent = extractBraced(bodyFm, 'keywords')
      if (kwContent !== null) {
        bodyKeywordsText = kwContent
        bodyFm = stripBalancedCommand(bodyFm, 'keywords')
      }
      frontmatterExtras = strip(bodyFm)
      meta.frontmatter_extras = frontmatterExtras
    }
  }

  const children = parseBlocks(body)
  if (verbatim) children.unshift(M.rawLatex(verbatim[0]))
  // Pictures are written \includegraphics[width=...]: graphicx, though the
  // source loaded only graphics (or its class did).
  const hasFigure = children.some((b) => b.type === 'Figure')
  if (hasFigure && !(meta.packages || []).includes('graphicx') && !/\{graphicx\}/.test(meta.preamble_extras || '')) {
    meta.packages = [...(meta.packages || []), 'graphicx']
  }
  if (M.classSupportsChapter(meta.documentclass || '')) shiftSectionsForChapters(children)
  const isA = (b: Block, ...types: Block['type'][]) => types.includes(b.type)

  // If the source had \title{...} but no Title block was reconstructed,
  // prepend one. Parse the title text as inlines so any nested macros
  // (\textbf, \emph, \texttt etc.) decode into proper marks instead of
  // surviving as literal LaTeX in the Text fragment.
  if (titleText && !verbatim && !children.some((b) => b.type === 'Title')) {
    const titleInlines = orText(parseInlines(titleText), titleText)
    children.unshift(M.title(titleInlines))
    meta.title = ''
  }

  // Surface the author in the editor. \maketitle vanishes during block
  // parsing, so without this the name / \thanks / affiliation lived only
  // in meta.author and the Visual view showed no author line at all.
  // One Author block per \\-separated line ("Name \\ \small Address")
  // mirrors how \maketitle stacks them; the serializer re-joins Author
  // blocks with \\, so the rich author still round-trips verbatim.
  if (authorText && !verbatim && !children.some((b) => b.type === 'Author')) {
    let insertAt = children.findIndex((b) => b.type === 'Title') + 1
    for (const line of splitAuthorLines(authorText)) {
      const lineInlines = parseInlines(line)
      if (lineInlines.length) {
        children.splice(insertAt, 0, M.author(lineInlines))
        insertAt++
      }
    }
  }

  // Insert Abstract / Keywords from body frontmatter (Wiley-style) as
  // proper model nodes so the editor highlights them.
  if (bodyAbstractText && !children.some((b) => b.type === 'Abstract')) {
    const absInlines = orText(parseInlines(bodyAbstractText), bodyAbstractText)
    // Insert after Title + Author if present.
    let insertPos = 0
    children.forEach((b, idx) => { if (isA(b, 'Title', 'Author')) insertPos = idx + 1 })
    children.splice(insertPos, 0, M.abstract(absInlines))
  }
  if (bodyKeywordsText && !children.some((b) => b.type === 'Keywords')) {
    const kwInlines = orText(parseInlines(bodyKeywordsText), bodyKeywordsText)
    let insertPos = 0
    children.forEach((b, idx) => { if (isA(b, 'Title', 'Author', 'Abstract')) insertPos = idx + 1 })
    children.splice(insertPos, 0, M.keywords(kwInlines))
  }

  return M.document(children, meta)
}

// `_parse_inlines(x) or [Text(text=x)]`
const orText = (inlines: Inline[], fallback: string): Inline[] => (inlines.length ? inlines : [M.text(fallback)])

// Parse a LaTeX *body* fragment (no preamble) into a list of Block nodes,
// reusing the same block parser as importTex.
//
// Used by the AI assistant to turn a generated LaTeX snippet into real,
// editable editor content. Comments are stripped first; if the fragment
// happens to contain a full \begin{document}...\end{document} only the
// body between them is parsed, so a model that ignores the "body only"
// instruction still yields sensible blocks instead of nothing.
// In report/book/memoir the serializer writes Heading 1 (level 1) as
// \chapter and level n as the command one step up, while SECTION_LEVEL
// numbers \section 1 as in article. Without this an imported report's
// \section came back as \chapter and every level below moved up one.
// \chapter stays level 0, the editor's Chapter style, which also
// serializes as \chapter; \subparagraph shares \paragraph's level 5,
// the deepest the editor has.
function shiftSectionsForChapters(blocks: Block[]): void {
  for (const b of blocks) {
    if (b.type === 'Section' && b.level >= 1) b.level = Math.min(b.level + 1, 5)
  }
}

export function importBodyFragment(latex: string | null | undefined,
  { hasChapters = false }: { hasChapters?: boolean } = {}): Block[] {
  let src = stripTexComments(latex || '')
  const bodyM = reSearch(BODY_RE, src)
  if (bodyM) src = bodyM[1]
  const blocks = parseBlocks(src)
  // Inserted into a report/book: \section is Heading 2 there, as in importTex.
  if (hasChapters) shiftSectionsForChapters(blocks)
  return blocks
}

// ============================================================
//                      .md (Markdown) importer
// ============================================================

const MD_YAML_FENCE = pyRe(String.raw`\A---\s*\n(.*?\n)---\s*\n`, 's')

// Extract a YAML front-matter block and return [metadata, rest]. Uses a
// minimal key: value parser — no YAML dependency needed.
function parseMdYamlHeader(txt: string): [Record<string, string>, string] {
  const m = reMatch(MD_YAML_FENCE, txt)
  if (!m) return [{}, txt]
  const meta: Record<string, string> = Object.create(null)
  for (let line of splitlines(m[1])) {
    line = strip(line)
    if (!line || line.startsWith('#') || line.startsWith('-')) continue
    const k = line.indexOf(':')
    if (k >= 0) meta[strip(line.slice(0, k))] = strip(strip(line.slice(k + 1)), '\'"')
  }
  return [meta, txt.slice(m[0].length)]
}

const MD_HEADING = pyRe(String.raw`^(#{1,6})\s+(.*?)(?:\s+#+)?$`, 'm')
const MD_DISPLAY_MATH = pyRe(String.raw`\$\$(.*?)\$\$`, 's')
const MD_INLINE_MATH = pyRe(String.raw`(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)`)
const MD_IMAGE = pyRe(String.raw`!\[([^\]]*)\]\(([^)]+)\)`)
const MD_LINK = pyRe(String.raw`\[([^\]]+)\]\(([^)]+)\)`)
const MD_BOLD_STAR = pyRe(String.raw`\*\*(.+?)\*\*`)
const MD_BOLD_UNDER = pyRe(String.raw`__(.+?)__`)
const MD_ITALIC_STAR = pyRe(String.raw`(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)`)
const MD_ITALIC_UNDER = pyRe(String.raw`(?<!_)_(?!_)(.+?)(?<!_)_(?!_)`)
const MD_CODE_SPAN = pyRe('`([^`]+)`')
const MD_CITE = pyRe(String.raw`\[(@[\w:.-]+(?:;\s*@[\w:.-]+)*)\]`)

const MD_PATTERNS: [string, RegExp][] = [
  ['display_math', MD_DISPLAY_MATH],
  ['cite', MD_CITE],
  ['inline_math', MD_INLINE_MATH],
  ['image', MD_IMAGE],
  ['link', MD_LINK],
  ['code', MD_CODE_SPAN],
  ['bold_s', MD_BOLD_STAR],
  ['bold_u', MD_BOLD_UNDER],
  ['italic_s', MD_ITALIC_STAR],
  ['italic_u', MD_ITALIC_UNDER],
]

// Convert Markdown inline markup to model Inline nodes.
function mdParseInlines(txt: string): Inline[] {
  const parts: Inline[] = []
  let pos = 0
  while (pos < txt.length) {
    let bestM: RegExpExecArray | null = null
    let bestKind = ''
    for (const [kind, pat] of MD_PATTERNS) {
      const m = reSearch(pat, txt, pos)
      if (m && (bestM === null || m.index < bestM.index)) {
        bestM = m
        bestKind = kind
      }
    }
    if (bestM === null) {
      const remainder = txt.slice(pos)
      if (remainder) parts.push(M.text(remainder))
      break
    }
    if (bestM.index > pos) parts.push(M.text(txt.slice(pos, bestM.index)))
    if (bestKind === 'display_math' || bestKind === 'inline_math') {
      parts.push(M.mathInline(strip(bestM[1])))
    } else if (bestKind === 'cite') {
      parts.push(M.citation(bestM[1].split(';').map((k) => lstrip(strip(k), '@'))))
    } else if (bestKind === 'image') {
      // Images become separate Figure blocks later; skip inline
      parts.push(M.text(bestM[0]))
    } else if (bestKind === 'link') {
      parts.push(M.link(bestM[2], [M.text(bestM[1])]))
    } else if (bestKind === 'code') {
      parts.push(M.text(bestM[1], ['code']))
    } else if (bestKind === 'bold_s' || bestKind === 'bold_u') {
      parts.push(M.text(bestM[1], ['bold']))
    } else if (bestKind === 'italic_s' || bestKind === 'italic_u') {
      parts.push(M.text(bestM[1], ['italic']))
    }
    pos = bestM.index + bestM[0].length
  }
  return parts.length ? parts : [M.text('')]
}

const FENCE_OPEN_RE = pyRe('^```(\\w*)\\s*$')
const FENCE_CLOSE_RE = pyRe('^```\\s*$')
const FENCE_START_RE = pyRe('^```')
const UL_RE = pyRe(String.raw`^[-*+]\s`)
const UL_STRIP_RE = pyRe(String.raw`^[-*+]\s+`)
const OL_RE = pyRe(String.raw`^\d+\.\s`)
const OL_ITEM_RE = pyRe(String.raw`^\d+\.\s+(.*)`)
const QUOTE_STRIP_RE = pyRe(String.raw`^>\s?`)

// set(packages) | extra, as a list. Python's set order follows string
// hashes, which are randomised per process, so no order can match it run
// for run; keep the existing order and append the new names.
function addPackages(packages: string[], extra: string[]): string[] {
  const out = [...new Set(packages)]
  for (const p of extra) if (!out.includes(p)) out.push(p)
  return out
}

// Parse a Markdown string into a Document.
//
// Handles YAML front-matter (title, author, bibliography), ATX headings,
// display/inline math, fenced code blocks, images, links, bold, italic,
// inline code, citations (@key), ordered/unordered lists, and blockquotes.
// imageDir is accepted for parity with Python, which doesn't use it either.
export function importMd(mdSource: string, _imageDir: string | null = null): Document {
  const [yamlMeta, body] = parseMdYamlHeader(mdSource)

  const ttl = yamlMeta.title ?? ''
  const auth = yamlMeta.author ?? yamlMeta.authors ?? ''
  const bib = yamlMeta.bibliography ?? ''

  let packages = [...DEFAULT_PACKAGES]
  if (bib) packages = addPackages(packages, ['natbib'])
  const preambleLines: string[] = []
  if (bib) preambleLines.push(`\\bibliographystyle{plainnat}\n\\bibliography{${bib.replaceAll('.bib', '')}}`)

  const children: Block[] = []
  if (ttl) children.push(M.title([M.text(ttl)]))
  if (auth) children.push(M.author([M.text(auth)]))

  let hasCodeBlocks = false

  // Process body line by line, grouping into blocks.
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const fenceM = reMatch(FENCE_OPEN_RE, line)
    if (fenceM) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !reMatch(FENCE_CLOSE_RE, lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++  // skip closing ```
      hasCodeBlocks = true
      const lang = fenceM[1]
      const code = codeLines.join('\n')
      // Derive a caption from the preceding paragraph when it ends
      // with ":" — that's the typical Markdown pattern for introducing
      // a code example. Otherwise fall back to the language name.
      let caption = ''
      const prev = children[children.length - 1]
      if (prev && prev.type === 'Paragraph') {
        const prevText = strip(prev.children.filter((x): x is Text => x.type === 'Text').map((x) => x.text).join(''))
        if (prevText.endsWith(':')) {
          caption = strip(rstrip(prevText, ':'))
          // Shorten to the last sentence/clause for cleaner captions
          for (const sep of ['. ', '; ', '— ']) {
            if (caption.includes(sep)) caption = strip(caption.slice(caption.lastIndexOf(sep) + sep.length))
          }
        }
      }
      if (!caption) caption = lang ? capitalize(lang) : 'Code'
      // Escape special LaTeX chars inside the caption
      caption = caption.replaceAll('_', '\\_')
      const opts = [`caption={${caption}}`]
      if (lang) opts.push(`language=${lang}`)
      children.push(M.rawLatex(`\\begin{lstlisting}[${opts.join(', ')}]\n${code}\n\\end{lstlisting}`))
      continue
    }

    // Display math ($$...$$ spanning lines or single-line)
    const stripped = strip(line)
    if (stripped.startsWith('$$')) {
      // Single-line: $$E = mc^2$$
      if (stripped.endsWith('$$') && stripped.length > 4) {
        children.push(M.mathBlock(strip(stripped.slice(2, -2))))
        i++
        continue
      }
      // Multi-line: $$ on its own or $$ ... \n ... $$
      const mathLines = [stripped.slice(2)]  // text after opening $$
      i++
      while (i < lines.length) {
        const mline = lines[i]
        if (strip(mline).endsWith('$$')) {
          mathLines.push(strip(mline).slice(0, -2))
          i++
          break
        }
        mathLines.push(mline)
        i++
      }
      children.push(M.mathBlock(strip(mathLines.join('\n'))))
      continue
    }

    // ATX heading
    const hM = reMatch(MD_HEADING, line)
    if (hM) {
      const level = hM[1].length
      const inlines = mdParseInlines(strip(hM[2]))
      children.push(M.section(Math.min(level, 5), inlines))
      i++
      continue
    }

    // Image on its own line
    const imgM = reMatch(MD_IMAGE, strip(line))
    if (imgM) {
      children.push(M.figure({ path: imgM[2], caption: imgM[1], label: null }))
      i++
      continue
    }

    // Unordered list (with multi-line continuation)
    if (reMatch(UL_RE, line)) {
      const items: M.ListItem[] = []
      while (i < lines.length && reMatch(UL_RE, lines[i])) {
        const itemLines = [reSub(UL_STRIP_RE, lines[i], '')]
        i++
        while (i < lines.length && strip(lines[i]) && !reMatch(UL_RE, lines[i])) {
          itemLines.push(strip(lines[i]))
          i++
        }
        items.push(M.listItem(mdParseInlines(itemLines.join(' '))))
      }
      children.push(M.list(false, items))
      continue
    }

    // Ordered list (with multi-line continuation and blank-line separation)
    if (reMatch(OL_RE, line)) {
      const items: M.ListItem[] = []
      while (i < lines.length) {
        const olM = reMatch(OL_ITEM_RE, lines[i])
        if (!olM) {
          // Blank line between items is OK — skip and check next
          if (!strip(lines[i])) {
            // Peek ahead: if the next non-blank is another item, skip
            let j = i + 1
            while (j < lines.length && !strip(lines[j])) j++
            if (j < lines.length && reMatch(OL_RE, lines[j])) {
              i = j
              continue
            }
          }
          break
        }
        const itemLines = [olM[1]]
        i++
        // Collect continuation lines (not blank, not a new item)
        while (i < lines.length && strip(lines[i]) && !reMatch(OL_RE, lines[i])) {
          itemLines.push(strip(lines[i]))
          i++
        }
        items.push(M.listItem(mdParseInlines(itemLines.join(' '))))
      }
      children.push(M.list(true, items))
      continue
    }

    // Blockquote — collect consecutive > lines into an italic paragraph
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(reSub(QUOTE_STRIP_RE, lines[i], ''))
        i++
      }
      children.push(M.paragraph([M.text(quoteLines.join(' '), ['italic'])]))
      continue
    }

    // Blank line — skip
    if (!strip(line)) {
      i++
      continue
    }

    // Regular paragraph — collect lines until blank/heading/fence/list
    const paraLines = [line]
    i++
    while (i < lines.length) {
      const nxt = lines[i]
      if (!strip(nxt) || reMatch(MD_HEADING, nxt)
          || reMatch(FENCE_START_RE, nxt)
          || reMatch(UL_RE, nxt)
          || reMatch(OL_RE, nxt)
          || nxt.startsWith('>')
          || strip(nxt).startsWith('$$')) break
      paraLines.push(nxt)
      i++
    }
    children.push(M.paragraph(mdParseInlines(paraLines.join(' '))))
  }

  if (hasCodeBlocks) {
    packages = addPackages(packages, ['listings', 'xcolor'])
    preambleLines.unshift(
      '\\definecolor{codegray}{rgb}{0.5,0.5,0.5}\n'
      + '\\definecolor{codegreen}{rgb}{0,0.5,0}\n'
      + '\\definecolor{codepurple}{rgb}{0.58,0,0.82}\n'
      + '\\definecolor{backcolour}{rgb}{0.97,0.97,0.97}\n'
      + '\\lstset{\n'
      + '  backgroundcolor=\\color{backcolour},\n'
      + '  commentstyle=\\color{codegreen},\n'
      + '  keywordstyle=\\color{blue},\n'
      + '  stringstyle=\\color{codepurple},\n'
      + '  numberstyle=\\tiny\\color{codegray},\n'
      + '  basicstyle=\\ttfamily\\small,\n'
      + '  breaklines=true,\n'
      + '  frame=single,\n'
      + '  numbers=left,\n'
      + '  numbersep=5pt,\n'
      + '  tabsize=4,\n'
      + '  captionpos=t,\n'
      + '  showstringspaces=false,\n'
      + '}',
    )
  }

  const meta = M.docMeta({
    title: ttl,
    author: auth,
    documentclass: 'article',
    packages,
    preamble_extras: preambleLines.join('\n'),
  })

  return M.document(children, meta)
}
