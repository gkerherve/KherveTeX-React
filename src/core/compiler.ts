// LaTeX/Typst compilation — a port of khervedoc/compiler.py.
//
// `compileTex` runs tectonic, `compileTypst` runs typst. Everything that
// touches the machine (files, the engine binaries, processes) goes through
// an injected CompilerHost, so the logic runs in Vitest with a fake engine,
// as the Python tests monkeypatch `_run_tracked`. Page rendering
// (render_pdf_pages) is pdf.js in src/preview/.

import {
  abstract, affiliation, author, docMeta, document, keywords, list, listItem,
  mathBlock, mathInline, paragraph, section, table, text, title,
} from './model.ts'
import { standaloneDoc, templateAlgorithm } from './flowchart.ts'
import type { Document } from './model.ts'
import { basename, isAbsolute, join, normalize, suffix } from './paths.ts'
import { strip } from './py.ts'
import { serializeDocument } from './serializer.ts'

// What compile needs from the machine (pathlib, shutil, subprocess).
export interface HostStat { isDir: boolean; isFile: boolean; mtime: number }
export interface HostEntry extends HostStat { name: string; path: string }
export interface HostRun { code: number | null; stdout: string; stderr: string; timedOut: boolean; error: string | null }

export interface CompilerHost {
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<HostStat | null>
  listDir(path: string): Promise<HostEntry[]>
  mkdir(path: string): Promise<void>
  // shutil.copy2 (a file) / shutil.copytree (a folder).
  copy(src: string, dest: string): Promise<void>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  remove(path: string): Promise<void>
  findTectonic(): Promise<string | null>
  findTypst(): Promise<string | null>
  run(program: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutSecs: number }): Promise<HostRun>
  cancelRunning(): Promise<void>
  // style_manager.all_style_dirs()
  styleDirs(): Promise<string[]>
  // ";" on Windows, ":" elsewhere (os.pathsep).
  pathListSep: string
}

// \includegraphics[opts]{path} — capture the opts (optional, balanced
// brackets at depth 1) and the path (no nested braces). Tectonic resolves
// the path relative to the .tex file's directory, not via TEXINPUTS or
// cwd, so we rewrite relative paths to absolute against source_dir before
// writing the .tex into the temp build dir.
export const INCLUDEGRAPHICS_RE = /\\includegraphics(\*?)(\[[^\]]*\])?\{([^}]+)\}/g

// The absolute path an \includegraphics target resolves to, or null when
// it cannot resolve (relative with no source dir).
function graphicTarget(path: string, sourceDir: string | null): string | null {
  if (isAbsolute(path)) return path
  if (sourceDir === null) return null
  return normalize(join(sourceDir, path))
}

// Every file whose existence rewriteIncludegraphics asks about, so a caller
// with an asynchronous file system can look them up first.
export function includegraphicsTargets(texSource: string, sourceDir: string | null): string[] {
  const out = new Set<string>()
  for (const m of texSource.matchAll(INCLUDEGRAPHICS_RE)) {
    const t = graphicTarget(m[3], sourceDir)
    if (t !== null) out.add(t)
  }
  return [...out]
}

// Resolve every `\includegraphics{path}` so the .tex compiles from a temp
// build dir. Three cases:
//
// - absolute existing path:   left untouched (works as-is)
// - relative path that exists under `sourceDir`: rewritten to the
//   absolute resolved path (forward slashes for LaTeX)
// - path that doesn't exist:  replaced with a framed placeholder box so
//   the compile keeps going and the PDF shows the user where the missing
//   image WOULD have been. Without this, tectonic's xdvipdfmx stage halts
//   with "Image inclusion failed" — `-Z continue-on-errors` only catches
//   TeX-level errors.
export function rewriteIncludegraphics(texSource: string, sourceDir: string | null,
  exists: (path: string) => boolean): string {
  // \fbox of a small note. Wrap in \texttt so it's clearly a diagnostic
  // message rather than typeset content. Escape LaTeX special chars in the
  // path so it renders.
  const placeholder = (path: string) => {
    const safe = path.replaceAll('\\', '/').replaceAll('_', '\\_').replaceAll('#', '\\#')
      .replaceAll('%', '\\%').replaceAll('&', '\\&')
    return '\\fbox{\\texttt{\\small [missing image: ' + safe + ']}}'
  }
  return texSource.replace(INCLUDEGRAPHICS_RE, (whole, star: string, opts: string | undefined, path: string) => {
    if (isAbsolute(path)) return exists(path) ? whole : placeholder(path)
    if (sourceDir === null) return placeholder(path)
    const resolved = normalize(join(sourceDir, path))
    if (!exists(resolved)) return placeholder(path)
    return `\\includegraphics${star}${opts ?? ''}{${resolved.replaceAll('\\', '/')}}`
  })
}

async function existingSet(paths: string[], host: Pick<CompilerHost, 'exists'>): Promise<Set<string>> {
  const found = await Promise.all(paths.map(p => host.exists(p)))
  return new Set(paths.filter((_, i) => found[i]))
}

// Signs in tectonic's log that the network was needed but unreachable.
export const NETWORK_ERROR_RE = new RegExp(
  'error sending request|failed to (?:fetch|connect)|dns error|'
  + 'tcp connect error|Connection refused|network is unreachable|'
  + 'timed out|failed to lookup address', 'i')
// A TeX input missing from the local cache (only-cached mode).
export const MISSING_FILE_RE = /File `([^']+)' not found/g
export const MISSING_CLASS_RE = /File `([^']+)\.cls' not found/
// BibTeX reports a .bst the cache lacks only in its .blg; tectonic's own
// log merely says BibTeX "issued errors".
export const MISSING_BST_RE = /I couldn't open style file (\S+)/g
// A font tectonic has not cached yet: continue-on-errors still writes a PDF,
// with that text blank (nullfont), so it must count as missing too — or the
// compile never goes online for it and the document silently loses glyphs.
export const MISSING_FONT_RE = new RegExp(
  'Font [^=\\s]+=\\[?([^\\]:;\\s]+)[^\\n]* not loadable: Metric \\(TFM\\) file'
  + '|Could not locate a virtual/physical font named ([^\\s.]+)'
  + '|Cannot proceed without \\.vf or "physical" font for (\\S+)', 'g')

// A file the engine could not read in time ("Operation timed out"): one a
// cloud service (OneDrive, iCloud) is still syncing. Not a network failure,
// though NETWORK_ERROR_RE's "timed out" matches it.
const SLOW_FILE_RE = /error closing out input ([^\n]+)\ncaused by: Operation timed out/

export function slowFileFromLog(log: string): string | null {
  return SLOW_FILE_RE.exec(log)?.[1] ?? null
}

export function isOfflineFailure(log: string): boolean {
  return NETWORK_ERROR_RE.test(log)
}

// The files and fonts an only-cached run could not find: from tectonic's
// log, and the .bst names from BibTeX's .blg.
export function missingFromLog(log: string, blg = ''): string[] {
  const missing = [...log.matchAll(MISSING_FILE_RE)].map(m => m[1])
  for (const m of log.replaceAll('\n', '').matchAll(MISSING_FONT_RE)) {
    missing.push(m.slice(1).find(g => g) as string)
  }
  missing.push(...[...blg.matchAll(MISSING_BST_RE)].map(m => m[1]))
  return missing
}

// Compiler processes are killed by cancelRunning(); a cancelled compile
// does not retry online.
let cancelled = false

export async function cancelRunning(host: Pick<CompilerHost, 'cancelRunning'>): Promise<void> {
  cancelled = true
  await host.cancelRunning()
}

export interface CompileResult {
  ok: boolean
  pdfPath: string | null
  log: string           // stdout + stderr combined
  error: string | null  // short human-readable error, or null on success
}

// A short document using every block the editor makes (title page,
// abstract, keywords, three heading levels, equation, list, table).
export function templateSampleDocument(documentclass: string): Document {
  return document([
    title([text('A test title')]),
    author([text('Jane Doe')]),
    affiliation([text('Imperial College London')]),
    abstract([text('This is the abstract.')]),
    keywords([text('one, two')]),
    section(1, [text('Introduction')]),
    paragraph([text('Body text with '), mathInline('E=mc^2'), text('.')]),
    section(2, [text('Method')]),
    mathBlock('\\int_0^1 x\\,dx = \\tfrac12', true),
    list(false, [listItem([text('a')]), listItem([text('b')])]),
    table({ rows: [['a', 'b'], ['1', '2']], caption: 'A table' }),
    section(3, [text('Detail')]),
    paragraph([text('End.')]),
  ], docMeta({ documentclass }))
}

// Packages every KherveTeX document may need.
const COMMON_PACKAGES = `\\usepackage{amsmath,amssymb,amsfonts,amsthm}
\\usepackage{graphicx,xcolor,colortbl,float,multicol}
\\usepackage[a4paper]{geometry}
\\usepackage{setspace,hyperref}
\\usepackage{booktabs,longtable,tabularx,multirow}
\\usepackage{caption,subcaption}
\\usepackage{listings}
\\usepackage{natbib}
\\usepackage{cleveref}
\\usepackage{pdfpages}
\\usepackage{fancyhdr,titlesec,enumitem,parskip}
\\usepackage{textcomp,fontenc}
\\usepackage{mathtools,bm,siunitx}
\\usepackage{mhchem}
\\usepackage{chemfig}
\\usepackage{tikz}
\\usepackage{algorithm,algpseudocode}
\\usepackage[normalem]{ulem}
\\usepackage[colorinlistoftodos]{todonotes}
\\usepackage{times,courier,helvet,charter,libertine}
`
const BODY = `\\begin{document}
Hello $E=mc^2$.
\\end{document}
`
const HELLO = '\\begin{document}Hello $E=mc^2$.\\end{document}\n'
const LETTER = '\\begin{document}\\begin{letter}{To}\\opening{Hi}\\closing{Bye}\\end{letter}\\end{document}\n'

// Font coverage: real documents use 11 and 12 pt, headings, footnotes,
// bold / italic / sans / typewriter and \url — each a separate font file at
// its own design size. The class documents only typeset one line at 10 pt,
// so a shipped cache without these made ordinary documents go online (and
// fail on a slow network) for a font.
const FONT_BODY = '\\begin{document}\\section{Heading}\\subsection{Sub}\\paragraph{P}'
  + 'Text \\textbf{bold} \\emph{italic} \\textit{\\textbf{bi}} \\textsc{Caps} '
  + '\\textsf{sans \\textbf{bold} \\emph{it}} \\texttt{mono \\textbf{bold}} '
  + '\\url{https://example.org} $x^2_i \\int_0^1 \\alpha\\,dx \\mathbf{v} '
  + '\\mathrm{d}\\mathcal{L}\\sum_{n}\\frac{a}{b}$\\footnote{A note.}'
  + '\\[ \\left(\\frac{\\partial f}{\\partial x}\\right)^{2} \\]'
  + '{\\tiny t}{\\scriptsize s}{\\footnotesize f}{\\small s}{\\large l}'
  + '{\\Large L}{\\LARGE L}{\\huge h}{\\Huge H}'
  + '\\begin{itemize}\\item one\\end{itemize}'
  + '\\begin{tabular}{ll}a&b\\\\\\end{tabular}\\end{document}\n'

const BIB_SAMPLE = '@article{a2020, author={Smith, Jane and M{\\"u}ller, Anna},'
  + ' title={{XPS} of {TiO2}}, journal={J. Test}, year={2020},'
  + ' volume={1}, pages={1--2}, doi={10.1/x}}\n'
  + '@book{b2019, author={Doe, John}, title={A Book},'
  + ' publisher={Pub}, year={2019}}\n'

// The documents download_tectonic_bundle compiles: one per document class
// KherveTeX offers, the font-coverage set, each bibliography style, and the
// editor's own sample under every class in `templateChoices`.
export function bundleDocuments(templateChoices: readonly string[]): [string, string][] {
  const cls = (name: string, opts = '') => `\\documentclass${opts}{${name}}\n`
  const docs: [string, string][] = [
    // Standard
    ['article', cls('article') + COMMON_PACKAGES + BODY],
    ['report', cls('report') + COMMON_PACKAGES + BODY],
    ['book', cls('book') + COMMON_PACKAGES + BODY],
    ['letter', cls('letter') + LETTER],
    ['beamer', cls('beamer') + '\\begin{document}\\begin{frame}\\frametitle{Hi}Hello\\end{frame}\\end{document}\n'],
    ['memoir', cls('memoir') + COMMON_PACKAGES + BODY],
    // KOMA-Script
    ['scrartcl', cls('scrartcl') + COMMON_PACKAGES + BODY],
    ['scrreprt', cls('scrreprt') + COMMON_PACKAGES + BODY],
    ['scrbook', cls('scrbook') + COMMON_PACKAGES + BODY],
    ['scrlttr2', cls('scrlttr2') + LETTER],
    // Journal / conference
    ['elsarticle', cls('elsarticle') + HELLO],
    ['IEEEtran', cls('IEEEtran') + HELLO],
    ['revtex4-2', cls('revtex4-2') + HELLO],
    ['achemso', cls('achemso') + '\\title{T}\\author{A}\\begin{document}Hello\\end{document}\n'],
    ['amsart', cls('amsart') + COMMON_PACKAGES + BODY],
    ['llncs', cls('llncs') + HELLO],
    ['acmart', cls('acmart') + HELLO],
    ['sn-jnl', cls('sn-jnl') + HELLO],
    ['mnras', cls('mnras', '[fleqn,usenatbib]') + HELLO],
    // Thesis / long-form
    ['tufte-handout', cls('tufte-handout') + HELLO],
    ['tufte-book', cls('tufte-book') + HELLO],
    // Book
    ['amsbook', cls('amsbook') + COMMON_PACKAGES + BODY],
    // Social-science / humanities
    ['apa7', cls('apa7') + '\\title{T}\\author{A}\\begin{document}Hello\\end{document}\n'],
    // CV / résumé
    ['moderncv', cls('moderncv') + '\\moderncvstyle{classic}\\name{A}{B}\\begin{document}\\makecvtitle\\end{document}\n'],
    ['europasscv', cls('europasscv') + '\\begin{document}Hello\\end{document}\n'],
    // Poster
    ['tikzposter', cls('tikzposter') + '\\title{T}\\author{A}\\institute{I}\\begin{document}\\maketitle'
      + '\\begin{columns}\\column{0.5}\\block{B}{Hello}\\end{columns}\\end{document}\n'],
    ['a0poster', cls('a0poster') + '\\begin{document}Hello\\end{document}\n'],
    // Exam
    ['exam', cls('exam') + '\\begin{document}\\begin{questions}\\question Why?\\end{questions}\\end{document}\n'],
    // Standalone
    ['standalone', cls('standalone') + '\\usepackage{tikz}\\begin{document}'
      + '\\begin{tikzpicture}\\draw(0,0)--(1,1);\\end{tikzpicture}\\end{document}\n'],
  ]
  // The flowchart builder's TikZ shape libraries and fonts.
  docs.push(['flowchart', standaloneDoc(templateAlgorithm())])
  for (const pt of ['10pt', '11pt', '12pt']) {
    docs.push([`fonts ${pt}`, `\\documentclass[${pt}]{article}\n`
      + '\\usepackage{amsmath,amssymb,xurl,hyperref}\n' + FONT_BODY])
    docs.push([`fonts ${pt} twocolumn`, `\\documentclass[${pt},twocolumn]{article}\n`
      + '\\usepackage[a4paper]{geometry}\\usepackage{amsmath,amssymb,graphicx,multicol,'
      + 'float,setspace,xurl}\n' + FONT_BODY])
  }
  // KherveRef citations: natbib + bibtex with each style offered, so the
  // .bst files and bibtex itself are cached for offline compiles.
  for (const style of ['plainnat', 'unsrtnat', 'abbrvnat', 'plain', 'unsrt']) {
    docs.push([`bibliography ${style}`,
      '\\documentclass{article}\\usepackage{natbib,xurl}\n'
      + '\\begin{document}\\citep{a2020} \\citet{b2019}\n'
      + `\\bibliographystyle{${style}}\\bibliography{kherveref}\n`
      + '\\end{document}\n'])
  }
  // The same title-page / abstract / table document the editor produces,
  // under every class it offers: the class fallbacks pull in extra files
  // (blx-bibtex.def, DejaVu, TeX Gyre Heros...) that must ship too.
  for (const c of templateChoices) docs.push([`template ${c}`, serializeDocument(templateSampleDocument(c))])
  return docs
}

// Copy each style dir's .cls/.sty/.bst into `workdir` unless already there.
async function copyStyles(workdir: string, host: CompilerHost): Promise<void> {
  for (const sd of await host.styleDirs()) {
    let entries: HostEntry[] = []
    try { entries = await host.listDir(sd) } catch { continue }
    for (const f of entries) {
      if (!f.isFile || !['.cls', '.sty', '.bst'].includes(suffix(f.name))) continue
      const dest = join(workdir, f.name)
      if (!(await host.exists(dest))) await host.copy(f.path, dest)
    }
  }
}

// Pre-cache TeX packages for offline compilation: compiles a series of
// small documents, one per document class KherveTeX offers, plus a
// kitchen-sink package document. Each file tectonic hasn't seen gets
// downloaded and cached locally. `onOutput` gets each status line for
// progress reporting. Returns [success, log].
export async function downloadTectonicBundle(host: CompilerHost, workdir: string,
  templateChoices: readonly string[], onOutput?: (line: string) => void): Promise<[boolean, string]> {
  const tectonic = await host.findTectonic()
  if (tectonic === null) return [false, 'tectonic is not installed']
  cancelled = false
  await host.mkdir(workdir)
  const docs = bundleDocuments(templateChoices)
  await host.writeText(join(workdir, 'kherveref.bib'), BIB_SAMPLE)
  await copyStyles(workdir, host)

  const allLog: string[] = []
  const failed: string[] = []
  const total = docs.length
  for (let idx = 0; idx < docs.length; idx++) {
    const [name, source] = docs[idx]
    onOutput?.(`[${idx + 1}/${total}] Caching packages for ${name}\u2026`)
    const texPath = join(workdir, `${name}.tex`)
    try {
      await host.writeText(texPath, source)
      const r = await host.run(tectonic,
        ['-Z', 'continue-on-errors', '--keep-logs', '--outdir', workdir, texPath],
        { timeoutSecs: 900 })
      for (const line of (r.stdout + r.stderr).split('\n')) if (line) allLog.push(line.trimEnd())
      if (r.error) throw new Error(r.error)
      if (cancelled) break
      if (r.code !== 0) failed.push(name)
    } catch (exc) {
      allLog.push(`${name}: ${exc instanceof Error ? exc.message : String(exc)}`)
      failed.push(name)
    }
  }
  await host.remove(workdir).catch(() => {})
  let log = allLog.join('\n')
  if (isOfflineFailure(log) && failed.length === total) {
    return [false, log + '\n\nNo internet connection — the offline bundle can only be downloaded while online.']
  }
  if (failed.length) {
    log += `\n\nNote: ${failed.length} classes had compile errors (packages were still cached): ${failed.join(', ')}`
  }
  return [true, log]
}

// Replace every \includegraphics with a lightweight placeholder box so
// tectonic skips image embedding entirely — much faster for drafts.
export function stripImages(texSource: string): string {
  return texSource.replace(INCLUDEGRAPHICS_RE, (_w, _s, _o, path: string) =>
    '\\fbox{\\texttt{\\footnotesize ' + path.replaceAll('\\', '/').replaceAll('_', '\\_') + '}}')
}

export const COMPILE_START = '% ===== KHERVETEX COMPILE START ====='
export const COMPILE_END = '% ===== KHERVETEX COMPILE END ====='
export const NOT_COMPILE_START = '% ===== KHERVETEX NOT COMPILE START ====='
export const NOT_COMPILE_END = '% ===== KHERVETEX NOT COMPILE END ====='

// Keep only the body between compile-range markers. Everything in the
// preamble and \begin/\end{document} is preserved. Body lines outside the
// marked range are wrapped in \iffalse...\fi so LaTeX skips them entirely.
// If no markers are found the source is returned unchanged.
export function applyCompileRange(texSource: string): string {
  const lines = texSource.split('\n')
  let beginDoc = -1
  let endDoc = -1
  let startMarker = -1
  let endMarker = -1
  lines.forEach((ln, i) => {
    const stripped = strip(ln)
    if (stripped.startsWith('\\begin{document}')) beginDoc = i
    else if (stripped.startsWith('\\end{document}')) endDoc = i
    else if (stripped === COMPILE_START) startMarker = i
    else if (stripped === COMPILE_END) endMarker = i
  })
  if (startMarker === -1 && endMarker === -1) return texSource
  if (beginDoc === -1 || endDoc === -1) return texSource

  const bodyStart = beginDoc + 1
  const bodyEnd = endDoc  // exclusive
  // Determine the kept range within the body
  const keepFrom = startMarker >= bodyStart ? startMarker + 1 : bodyStart
  const keepTo = endMarker > bodyStart ? endMarker : bodyEnd

  const result: string[] = []
  // Preamble + \begin{document}
  result.push(...lines.slice(0, bodyStart))
  // Before the kept range → hide
  const before = lines.slice(bodyStart, keepFrom)
  if (before.some(ln => strip(ln))) result.push('\\iffalse', ...before, '\\fi')
  // Kept range
  result.push(...lines.slice(keepFrom, keepTo))
  // After the kept range → hide
  const after = lines.slice(keepTo, bodyEnd)
  if (after.some(ln => strip(ln))) result.push('\\iffalse', ...after, '\\fi')
  // \end{document} and anything after
  result.push(...lines.slice(endDoc))
  return result.join('\n')
}

// Match each start with the nearest following unused end.
function markerPairs(lines: string[], start: string, end: string): [number, number][] {
  const starts: number[] = []
  const ends: number[] = []
  lines.forEach((ln, i) => {
    const stripped = strip(ln)
    if (stripped === start) starts.push(i)
    else if (stripped === end) ends.push(i)
  })
  const pairs: [number, number][] = []
  if (!starts.length || !ends.length) return pairs
  const used = new Set<number>()
  for (const s of starts) {
    for (const e of ends) {
      if (e > s && !used.has(e)) {
        pairs.push([s, e])
        used.add(e)
        break
      }
    }
  }
  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

function wrapPairs(texSource: string, start: string, end: string, open: string, close: string): string {
  const lines = texSource.split('\n')
  const pairs = markerPairs(lines, start, end)
  if (!pairs.length) return texSource
  const result: string[] = []
  let prev = 0
  for (const [s, e] of pairs) {
    result.push(...lines.slice(prev, s), open, ...lines.slice(s, e + 1), close)
    prev = e + 1
  }
  result.push(...lines.slice(prev))
  return result.join('\n')
}

// Hide content between each NOT COMPILE START/END marker pair. Multiple
// pairs are supported. Content between each pair is wrapped in
// \iffalse...\fi. Unpaired markers are ignored.
export function applyNotCompileRanges(texSource: string): string {
  return wrapPairs(texSource, NOT_COMPILE_START, NOT_COMPILE_END, '\\iffalse', '\\fi')
}

export interface CompileOptions {
  basename?: string
  sourceDir?: string | null
  skipImages?: boolean
  useCompileRange?: boolean
  // Fast LaTeX: one pass that reads the last compile's .aux/.toc (kept in
  // workdir), and the saved format of the document's packages if ready.
  fast?: boolean
  format?: string | null
}

// Write `texSource` to `workdir/basename.tex` and compile with tectonic.
//
// `workdir` is created if missing. On failure the `log` field contains
// tectonic's full output for diagnosis.
//
// `sourceDir`, when supplied, is the directory of the user's original
// document. It's added to TEXINPUTS so relative \includegraphics paths
// (e.g. `Images/foo.png` next to the .tex) resolve even though we compile
// in a temp `workdir`. We also pass `-Z continue-on-errors` so a single
// missing image doesn't halt the whole preview — tectonic still emits the
// PDF with a "?" placeholder where the image would go.
export async function compileTex(texSource: string, workdir: string, opts: CompileOptions,
  host: CompilerHost): Promise<CompileResult> {
  const base = opts.basename ?? 'document'
  const sourceDir = opts.sourceDir ?? null
  cancelled = false
  await host.mkdir(workdir)
  const srcIsDir = sourceDir !== null && !!(await host.stat(sourceDir))?.isDir
  // Copy auxiliary TeX files (.cls, .sty, .bst, .bib) from sourceDir into
  // workdir so tectonic can find them — tectonic's bundle system doesn't
  // always honour TEXINPUTS for custom class files.
  if (srcIsDir) {
    const entries = await host.listDir(sourceDir)
    for (const f of entries) {
      if (!f.isFile || !['.cls', '.sty', '.bst', '.bib'].includes(suffix(f.name))) continue
      const dest = join(workdir, f.name)
      const d = await host.stat(dest)
      // A .bib is edited between compiles; the rest never is.
      if (!d || (suffix(f.name) === '.bib' && f.name !== 'kherveref.bib' && f.mtime > d.mtime)) {
        await host.copy(f.path, dest)
      }
    }
    // Copy subdirectories (Fonts/, Images/, etc.) so relative paths inside
    // .cls files (e.g. ./Fonts/Lato/Lato-Regular) resolve. Only the ones
    // the document names, or all of them beside a custom class or style:
    // a document saved straight in ~/Documents would otherwise copy every
    // project there on each compile, and the app hangs on "Compiling".
    const ownStyle = entries.some(f => f.isFile && ['.cls', '.sty'].includes(suffix(f.name)))
    const named = (dir: string) => ownStyle || texSource.includes(`${dir}/`) || texSource.includes(`{${dir}}`)
    for (const child of entries) {
      if (child.isDir && !child.name.startsWith('.') && named(child.name)) {
        const dest = join(workdir, child.name)
        if (!(await host.exists(dest))) await host.copy(child.path, dest)
      }
    }
  }
  // Bundled and user styles (sn-jnl, mimosis, resume...) too: tectonic
  // ignores TEXINPUTS, so a class it cannot see in the workdir is "not found".
  await copyStyles(workdir, host)
  if (opts.skipImages) {
    texSource = stripImages(texSource)
  } else {
    const have = await existingSet(includegraphicsTargets(texSource, sourceDir), host)
    texSource = rewriteIncludegraphics(texSource, sourceDir, p => have.has(p))
  }
  if (opts.useCompileRange) {
    texSource = applyCompileRange(texSource)
    texSource = applyNotCompileRanges(texSource)
  }
  const texPath = join(workdir, `${base}.tex`)
  await host.writeText(texPath, texSource)

  const tectonic = await host.findTectonic()
  if (tectonic === null) {
    return {
      ok: false, pdfPath: null, log: '',
      error: 'tectonic is not installed or not on PATH. Install it from https://tectonic-typesetting.github.io/',
    }
  }

  // TEXINPUTS: sourceDir (document's folder), then user styles, then
  // bundled styles, then tectonic's defaults.
  const sep = host.pathListSep
  const parts: string[] = []
  if (srcIsDir) parts.push(sourceDir)
  parts.push(...await host.styleDirs())
  const env: Record<string, string> = {}
  if (parts.length) env.TEXINPUTS = parts.join(sep) + sep

  const run = async (onlyCached: boolean): Promise<[number | null, string, boolean]> => {
    const args: string[] = []
    if (onlyCached) args.push('--only-cached')
    if (opts.fast) args.push('-r', '0', '--keep-intermediates')
    if (opts.fast && opts.format) args.push('-f', opts.format)
    args.push('-Z', 'continue-on-errors', '--keep-logs', '--synctex', '--outdir', workdir, texPath)
    // Cache-only takes seconds; a run that may download needs room to fetch
    // the format and many packages on a slow line (a fresh install, a new
    // package) — two minutes was not enough.
    const r = await host.run(tectonic, args, { env, timeoutSecs: onlyCached ? 120 : 900 })
    return [r.code, r.stdout + r.stderr + (r.error ?? ''), r.timedOut]
  }

  const pdfPath = join(workdir, `${base}.pdf`)
  // Cache first: without --only-cached tectonic may contact its bundle
  // server on every run, which stalls or fails with no network (trains,
  // planes). Only go online when the cache is genuinely missing a file.
  const blgPath = join(workdir, `${base}.blg`)
  await host.remove(blgPath).catch(() => {})
  const timedOut = {
    ok: false, pdfPath: null, log: '',
    error: 'tectonic timed out (a package download took over 15 minutes — check the connection, '
      + 'or run Compiler \u25b8 Download offline bundle)',
  }
  let [code, log, late] = await run(true)
  if (late) return timedOut
  let blg = ''
  try { blg = await host.readText(blgPath) } catch { /* no bibliography run */ }
  const missing = missingFromLog(log, blg)
  // continue-on-errors still yields a PDF when a package is missing from
  // the cache, so a clean exit alone doesn't mean success.
  const cachedOk = code === 0 && (await host.exists(pdfPath)) && !missing.length
  if (!cachedOk && !cancelled) {
    const cachedLog = log;
    [code, log, late] = await run(false)
    if (late) return timedOut
    const slow = slowFileFromLog(cachedLog) ?? slowFileFromLog(log)
    if (slow) {
      return {
        ok: false,
        pdfPath: (await host.exists(pdfPath)) ? pdfPath : null,
        log: cachedLog + '\n\n--- online retry ---\n' + log,
        error: `${slow.split(/[\\/]/).pop()} could not be read in time: its folder is being synced `
          + '(OneDrive, iCloud…). Compile again once the sync has finished.',
      }
    }
    if (isOfflineFailure(log)) {
      const names = [...new Set(missing)].sort().join(', ') || 'some TeX files'
      return {
        ok: false,
        pdfPath: (await host.exists(pdfPath)) ? pdfPath : null,
        log: cachedLog + '\n\n--- online retry ---\n' + log,
        error: `Offline, and ${names} not in the local TeX cache yet. Connect once to compile this `
          + 'document (or run Download offline bundle).',
      }
    }
  }

  // continue-on-errors carries on without the class and exits cleanly, with
  // a PDF of raw text running off the page: that is no preview at all.
  const noClass = MISSING_CLASS_RE.exec(log)
  if (noClass) {
    return {
      ok: false, pdfPath: null, log,
      error: `Document class ${noClass[1]} is not available. Add its .cls file with File \u25b8 Manage `
        + 'styles\u2026 or choose another document type.',
    }
  }
  const havePdf = await host.exists(pdfPath)
  if (code === 0 && havePdf) return { ok: true, pdfPath, log, error: null }
  return { ok: false, pdfPath: havePdf ? pdfPath : null, log, error: `tectonic exited with code ${code ?? -9}` }
}

// ======================= Typst compiler =======================

export const TYPST_IMAGE_RE = /image\("([^"]+)"/g

const typstMissing = (path: string) => `rect(width: 100%, height: 2cm, stroke: 1pt, inset: 4pt)[missing: ${path}]`

export function typstImageTargets(typSource: string, sourceDir: string | null): string[] {
  const out = new Set<string>()
  for (const m of typSource.matchAll(TYPST_IMAGE_RE)) {
    const t = graphicTarget(m[1], sourceDir)
    if (t !== null) out.add(t)
  }
  return [...out]
}

// Resolve relative image paths in Typst source to absolute.
export function rewriteTypstImages(typSource: string, sourceDir: string | null,
  exists: (path: string) => boolean): string {
  return typSource.replace(TYPST_IMAGE_RE, (whole, path: string) => {
    if (isAbsolute(path)) return exists(path) ? whole : typstMissing(path)
    if (sourceDir === null) return typstMissing(path)
    const resolved = normalize(join(sourceDir, path))
    if (!exists(resolved)) return typstMissing(path)
    return `image("${resolved.replaceAll('\\', '/')}"`
  })
}

// Replace image() calls with placeholder rects for fast drafts.
export function stripTypstImages(typSource: string): string {
  return typSource.replace(TYPST_IMAGE_RE, (_w, path: string) =>
    `rect(width: 100%, height: 2cm, stroke: 0.5pt, inset: 4pt)[${path.replaceAll('\\', '/')}]`)
}

export const TYPST_COMPILE_START = '// ===== KHERVETEX COMPILE START ====='
export const TYPST_COMPILE_END = '// ===== KHERVETEX COMPILE END ====='
export const TYPST_NOT_COMPILE_START = '// ===== KHERVETEX NOT COMPILE START ====='
export const TYPST_NOT_COMPILE_END = '// ===== KHERVETEX NOT COMPILE END ====='

// Keep only content between compile-range markers in Typst source. Uses
// /* ... */ block comments to hide excluded content. Typst has no
// preamble/document boundary like LaTeX, so markers apply to the whole
// file — #set rules before the first marker are always kept.
export function applyTypstCompileRange(typSource: string): string {
  const lines = typSource.split('\n')
  let startMarker = -1
  let endMarker = -1
  lines.forEach((ln, i) => {
    const stripped = strip(ln)
    if (stripped === TYPST_COMPILE_START) startMarker = i
    else if (stripped === TYPST_COMPILE_END) endMarker = i
  })
  if (startMarker === -1 && endMarker === -1) return typSource

  // Find where #set rules end (preamble-equivalent)
  let preambleEnd = 0
  for (let i = 0; i < lines.length; i++) {
    const stripped = strip(lines[i])
    if (stripped.startsWith('#set ') || stripped.startsWith('#show ') || stripped === '') preambleEnd = i + 1
    else break
  }
  const keepFrom = startMarker >= preambleEnd ? startMarker + 1 : preambleEnd
  const keepTo = endMarker > preambleEnd ? endMarker : lines.length

  const result = lines.slice(0, preambleEnd)
  const before = lines.slice(preambleEnd, keepFrom)
  if (before.some(ln => strip(ln))) result.push('/*', ...before, '*/')
  result.push(...lines.slice(keepFrom, keepTo))
  const after = lines.slice(keepTo)
  if (after.some(ln => strip(ln))) result.push('/*', ...after, '*/')
  return result.join('\n')
}

// Hide content between NOT COMPILE marker pairs using /* ... */.
export function applyTypstNotCompileRanges(typSource: string): string {
  return wrapPairs(typSource, TYPST_NOT_COMPILE_START, TYPST_NOT_COMPILE_END, '/*', '*/')
}

// Write Typst source to workdir and compile with the typst CLI.
export async function compileTypst(typSource: string, workdir: string, opts: CompileOptions,
  host: CompilerHost): Promise<CompileResult> {
  const base = opts.basename ?? 'document'
  const sourceDir = opts.sourceDir ?? null
  await host.mkdir(workdir)
  if (opts.skipImages) {
    typSource = stripTypstImages(typSource)
  } else {
    const have = await existingSet(typstImageTargets(typSource, sourceDir), host)
    typSource = rewriteTypstImages(typSource, sourceDir, p => have.has(p))
  }
  if (opts.useCompileRange) {
    typSource = applyTypstCompileRange(typSource)
    typSource = applyTypstNotCompileRanges(typSource)
  }
  const typPath = join(workdir, `${base}.typ`)
  await host.writeText(typPath, typSource)

  const typst = await host.findTypst()
  if (typst === null) {
    return { ok: false, pdfPath: null, log: '', error: 'typst is not installed or not on PATH. Install it from https://typst.app/' }
  }
  const pdfPath = join(workdir, `${base}.pdf`)
  const r = await host.run(typst, ['compile', typPath, pdfPath], { timeoutSecs: 120 })
  if (r.timedOut) return { ok: false, pdfPath: null, log: '', error: 'typst timed out after 120s' }
  const log = r.stdout + r.stderr + (r.error ?? '')
  const havePdf = await host.exists(pdfPath)
  if (r.code === 0 && havePdf) return { ok: true, pdfPath, log, error: null }
  return { ok: false, pdfPath: havePdf ? pdfPath : null, log, error: `typst exited with code ${r.code ?? -9}` }
}

// ======================= log helpers =======================

export interface PageMark {
  index: number
  label: string
  // Pages shipped before this document starts.
  shipped: number
}

// MainWindow._page_counts_from_log: each project document's KDOC:<i>:
// <label>:<shipped> marker; the last pass's values win (early passes may
// lack the ToC). Sorted by where they start.
export function pageMarksFromLog(log: string): PageMark[] {
  const found = new Map<number, PageMark>()
  for (const m of log.matchAll(/KDOC:(\d+):([^:\s]*):(\d+)/g)) {
    const index = Number(m[1])
    found.set(index, { index, label: m[2], shipped: Number(m[3]) })
  }
  return [...found.values()].sort((a, b) => a.shipped - b.shipped)
}

// Each mark's page count, the last running to `total` pages.
export function pageCounts(marks: PageMark[], total: number): number[] {
  return marks.map((m, k) => Math.max(1, (k + 1 < marks.length ? marks[k + 1].shipped : total) - m.shipped))
}

// "kherveDOC-…/document.pdf" → "document"
export function stemOf(path: string): string {
  const name = basename(path)
  const s = suffix(name)
  return s ? name.slice(0, -s.length) : name
}
