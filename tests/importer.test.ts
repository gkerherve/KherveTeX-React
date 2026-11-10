// Port of tests/test_importers.py, plus the importer cases of
// test_theorems.py, test_table_design.py and test_beamer.py.
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandIncludes, importBodyFragment, importMd, importTex } from '../src/core/importers.ts'
import type { ImportFs } from '../src/core/importers.ts'
import { document, fromJson, paragraph, table, text, toJson } from '../src/core/model.ts'
import type { Block, Inline, Table, Theorem } from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'

type Of<T extends string, U extends { type: string }> = Extract<U, { type: T }>
const blocksOf = <T extends Block['type']>(bs: Block[], t: T) => bs.filter((b) => b.type === t) as Of<T, Block>[]
const inlinesOf = <T extends Inline['type']>(xs: Inline[], t: T) => xs.filter((x) => x.type === t) as Of<T, Inline>[]
const texts = (xs: Inline[]) => inlinesOf(xs, 'Text').map((x) => x.text)
const childrenOf = (b: Block): Inline[] => ('children' in b ? (b.children as Inline[]) : [])
const count = (s: string, sub: string) => s.split(sub).length - 1
const roundTrip = (src: string) => importTex(src)

const nodeFs: ImportFs = {
  isFile: (p) => {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  },
  readText: (p) => {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return null
    }
  },
  resolve: (p) => resolve(p),
}

const RICH_SRC = '\\documentclass[11pt,a4paper]{article}\n'
  + '\\title{KhervePDF: A PDF Viewer\\\\with Built-In Git Version History}\n'
  + '\\author{Gwilherm Kerherve\\thanks{ORCID: 0000, \\texttt{g@x.org}}\\\\\n'
  + '\\small Department of Materials, Imperial College London}\n'
  + '\\begin{document}\\maketitle body\\end{document}'

describe('test_importers.py', () => {
  it('test_extracts_documentclass_and_packages', () => {
    const doc = roundTrip(String.raw`\documentclass{report}
\usepackage[a4paper]{geometry}
\usepackage{amsmath}
\usepackage{hyperref}
\begin{document}
hello
\end{document}
`)
    expect(doc.meta.documentclass).toBe('report')
    expect(doc.meta.packages).toContain('amsmath')
    expect(doc.meta.packages).toContain('hyperref')
    expect(doc.meta.packages).not.toContain('geometry')  // tracked separately
    expect(doc.meta.page_size).toBe('A4')
  })

  it('test_letter_paper_detected', () => {
    const src = String.raw`\documentclass{article}
\usepackage[letterpaper]{geometry}
\begin{document}body\end{document}`
    expect(roundTrip(src).meta.page_size).toBe('Letter')
  })

  it('test_title_preamble_creates_title_block', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\title{Hello World}
\author{Me}
\begin{document}\maketitle body\end{document}`)
    const titles = blocksOf(doc.children, 'Title')
    expect(titles).toHaveLength(1)
    expect(texts(titles[0].children)).toContain('Hello World')
    // meta.title is cleared once a Title block has taken over.
    expect(doc.meta.title).toBe('')
    expect(doc.meta.author).toBe('Me')
  })

  it('test_rich_title_block_round_trips', () => {
    // A KhervePDF-style title block: \\ break in the title, plus a
    // \thanks{} footnote and a \small affiliation in the author. These
    // must survive import -> serialize instead of being flattened away.
    const out = serializeDocument(roundTrip(RICH_SRC))
    expect(out).toContain('\\thanks{ORCID: 0000, \\texttt{g@x.org}}')
    expect(out).toContain('\\small Department of Materials')
    expect(out).toContain('\\\\with Built-In')  // title line break preserved as \\
    expect(out).not.toContain('\\textbackslash{}\\with')
    expect(out).not.toContain('textbackslash')  // author not double-escaped
  })

  it('test_plain_author_still_clean', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\author{Jane Doe}
\begin{document}\maketitle body\end{document}`)
    expect(doc.meta.author).toBe('Jane Doe')
  })

  it('test_author_becomes_visible_author_blocks', () => {
    const doc = roundTrip(RICH_SRC)
    const authors = blocksOf(doc.children, 'Author')
    expect(authors).toHaveLength(2)  // name line + affiliation line
    expect(doc.children[0].type).toBe('Title')
    expect(doc.children[1]).toBe(authors[0])  // stacked right under the title
    expect(texts(authors[0].children).join('')).toContain('Gwilherm Kerherve')
    expect(texts(authors[1].children).join('')).toContain('Department of Materials, Imperial College London')
    // \thanks survives on the name line as raw LaTeX, not flattened away.
    expect(inlinesOf(authors[0].children, 'InlineRaw').some((c) => c.latex.startsWith('\\thanks{'))).toBe(true)
  })

  it('test_author_blocks_serialize_a_single_author', () => {
    expect(count(serializeDocument(roundTrip(RICH_SRC)), '\\author{')).toBe(1)
  })

  it('test_plain_author_gets_a_display_block_too', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\title{T}
\author{Jane Doe}
\begin{document}\maketitle body\end{document}`)
    expect(blocksOf(doc.children, 'Author')).toHaveLength(1)
    const out = serializeDocument(doc)
    expect(count(out, '\\author{')).toBe(1)
    expect(out).toContain('\\author{Jane Doe}')
  })

  it('test_accent_macros_decode_to_unicode', () => {
    const src = '\\documentclass{article}\n'
      + "\\title{Caf\\'{e} chemistry}\n"
      + "\\author{Gwilherm Kerherv\\'e}\n"
      + "\\begin{document}\\maketitle Schr\\\"odinger's cat\\end{document}"
    const out = serializeDocument(roundTrip(src))
    expect(out).toContain('Kerhervé')
    expect(out).toContain('Café')
    expect(out).toContain('Schrödinger')
    expect(out).not.toContain('textbackslash')
  })

  it('test_linebreak_inside_thanks_does_not_split_author', () => {
    const doc = roundTrip('\\documentclass{article}\n'
      + '\\author{Ann Author\\thanks{line one\\\\line two}}\n'
      + '\\begin{document}\\maketitle body\\end{document}')
    expect(blocksOf(doc.children, 'Author')).toHaveLength(1)
    expect(serializeDocument(doc)).toContain('\\thanks{line one\\\\line two}')
  })

  it('test_section_levels', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\section{Intro}
\subsection{Background}
\subsubsection*{Detail}
\end{document}`)
    const sections = blocksOf(doc.children, 'Section')
    expect(sections.map((s) => s.level)).toEqual([1, 2, 3])
    // The starred subsubsection should not be numbered.
    expect(sections[2].numbered).toBe(false)
  })

  it('test_marks_parsed', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
This is \textbf{bold} and \textit{italic} and \texttt{code}.
\end{document}`)
    const paras = blocksOf(doc.children, 'Paragraph')
    expect(paras.length).toBeGreaterThan(0)
    const marksSeen = new Set(inlinesOf(paras[0].children, 'Text').flatMap((c) => c.marks))
    expect(marksSeen).toContain('bold')
    expect(marksSeen).toContain('italic')
    expect(marksSeen).toContain('code')
  })

  it('test_inline_math', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}E = $mc^2$ done\end{document}`)
    expect(inlinesOf(childrenOf(doc.children[0]), 'MathInline').some((c) => c.latex === 'mc^2')).toBe(true)
  })

  it('test_display_math_block', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{equation}
x = 1
\end{equation}
\end{document}`)
    const maths = blocksOf(doc.children, 'MathBlock')
    expect(maths).toHaveLength(1)
    expect(maths[0].numbered).toBe(true)
    expect(maths[0].latex).toContain('x = 1')
  })

  it('test_itemize_becomes_unordered_list', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{itemize}
\item first
\item second
\end{itemize}
\end{document}`)
    const lists = blocksOf(doc.children, 'List')
    expect(lists).toHaveLength(1)
    expect(lists[0].ordered).toBe(false)
    expect(lists[0].items).toHaveLength(2)
  })

  it('test_link_footnote_citation_crossref', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
See \href{https://x.com}{here}\footnote{a note} and \cite{key1,key2} and \ref{sec:1}.
\end{document}`)
    const inline = childrenOf(doc.children[0])
    expect(inlinesOf(inline, 'Link').some((c) => c.url === 'https://x.com')).toBe(true)
    expect(inlinesOf(inline, 'Footnote')).not.toHaveLength(0)
    expect(inlinesOf(inline, 'Citation').some((c) => JSON.stringify(c.keys) === '["key1","key2"]')).toBe(true)
    expect(inlinesOf(inline, 'CrossRef').some((c) => c.label === 'sec:1')).toBe(true)
  })

  it('test_figure_with_includegraphics', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{figure}[h]
\centering
\includegraphics[width=0.5\textwidth]{img/foo.png}
\caption{A photo}
\label{fig:foo}
\end{figure}
\end{document}`)
    const figs = blocksOf(doc.children, 'Figure')
    expect(figs).toHaveLength(1)
    expect(figs[0].path).toBe('img/foo.png')
    expect(figs[0].caption).toBe('A photo')
    expect(figs[0].label).toBe('fig:foo')
  })

  it('test_align_environment_preserved_in_mathblock', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{align}
x &= 1 \\
y &= 2
\end{align}
\end{document}`)
    const maths = blocksOf(doc.children, 'MathBlock')
    expect(maths).toHaveLength(1)
    expect(maths[0].latex).toContain('\\begin{align}')
    expect(maths[0].latex).toContain('x &= 1')
  })

  it('test_gather_starred_is_unnumbered', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{gather*}
a + b = c
\end{gather*}
\end{document}`)
    const maths = blocksOf(doc.children, 'MathBlock')
    expect(maths[0].numbered).toBe(false)
    expect(maths[0].latex).toContain('\\begin{gather*}')
  })

  it('test_multline_environment_imported', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{multline}
\alpha + \beta \\ + \gamma = \delta
\end{multline}
\end{document}`)
    expect(blocksOf(doc.children, 'MathBlock')[0].latex).toContain('\\begin{multline}')
  })

  it('test_displaymath_brackets_form', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}\[ E = mc^2 \]\end{document}`)
    const maths = blocksOf(doc.children, 'MathBlock')
    expect(maths).toHaveLength(1)
    expect(maths[0].latex).toBe('E = mc^2')
  })

  it('test_table_environment_produces_table_node', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{table}[h]
\centering
\begin{tabular}{lcr}
\hline
A & B & C \\
1 & 2 & 3 \\
4 & 5 & 6 \\
\hline
\end{tabular}
\caption{Some data}
\label{tab:demo}
\end{table}
\end{document}`)
    const tables = blocksOf(doc.children, 'Table')
    expect(tables).toHaveLength(1)
    const t = tables[0]
    expect(t.rows).toEqual([['A', 'B', 'C'], ['1', '2', '3'], ['4', '5', '6']])
    expect(t.alignment).toBe('lcr')
    expect(t.caption).toBe('Some data')
    expect(t.label).toBe('tab:demo')
  })

  it('test_standalone_tabular_is_imported', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{tabular}{ll}
foo & bar \\
baz & qux \\
\end{tabular}
\end{document}`)
    const tables = blocksOf(doc.children, 'Table')
    expect(tables).toHaveLength(1)
    expect(tables[0].rows).toEqual([['foo', 'bar'], ['baz', 'qux']])
  })

  it('test_figure_caption_with_inline_macros_preserved', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{figure}
\centering
\includegraphics[width=0.5\textwidth]{img/plot.png}
\caption{Result for \textbf{T=300K}}
\label{fig:r}
\end{figure}
\end{document}`)
    const figs = blocksOf(doc.children, 'Figure')
    expect(figs).toHaveLength(1)
    // The full caption is preserved verbatim, including the textbf macro.
    expect(figs[0].caption).toContain('Result for')
    expect(figs[0].caption).toContain('\\textbf')
  })

  it('test_flushleft_env_produces_left_aligned_paragraphs', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{flushleft}
Hello world.
\end{flushleft}
\end{document}`)
    const paras = blocksOf(doc.children, 'Paragraph')
    expect(paras).toHaveLength(1)
    expect(paras[0].alignment).toBe('left')
  })

  it('test_center_env_produces_centered_paragraphs', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{center}
Heading-ish text.
\end{center}
\end{document}`)
    expect(blocksOf(doc.children, 'Paragraph')[0].alignment).toBe('center')
  })

  it('test_flushright_env_produces_right_aligned_paragraphs', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{flushright}
Aligned right.
\end{flushright}
\end{document}`)
    expect(blocksOf(doc.children, 'Paragraph')[0].alignment).toBe('right')
  })

  it('test_title_with_inline_textbf_is_parsed_to_marks_not_left_as_literal', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\title{Hello \emph{World}}\begin{document}body\end{document}`)
    const ttl = doc.children.find((b) => b.type === 'Title')
    expect(ttl).toBeDefined()
    const flat = texts(childrenOf(ttl!)).join('')
    expect(flat).not.toContain('\\emph')
    expect(flat).not.toContain('\\textbf')
    expect(flat).toContain('Hello')
    expect(flat).toContain('World')
  })

  it('test_strips_percent_line_comments', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
%% ============================================
\section{Intro}
%% banner
Body text here.
\end{document}`)
    const flat = blocksOf(doc.children, 'Paragraph').flatMap((b) => texts(b.children)).join(' ')
    expect(flat).not.toContain('===')
    expect(flat).not.toContain('banner')
    expect(flat).toContain('Body text here.')
  })

  it('test_url_macro_becomes_link', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}See \url{https://x.com/y} for more.\end{document}`)
    expect(inlinesOf(childrenOf(doc.children[0]), 'Link').some((c) => c.url === 'https://x.com/y')).toBe(true)
  })

  it('test_verbatim_environment_preserved_as_rawlatex', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
Example:
\begin{verbatim}
def foo(): return 1
\end{verbatim}
After.
\end{document}`)
    const raws = blocksOf(doc.children, 'RawLatex')
    expect(raws).toHaveLength(1)
    expect(raws[0].text).toContain('verbatim')
    expect(raws[0].text).toContain('def foo()')
  })

  it('test_lstlisting_with_caption_preserved', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{lstlisting}[caption={Demo}]
print("hi")
\end{lstlisting}
\end{document}`)
    const raws = blocksOf(doc.children, 'RawLatex')
    expect(raws).toHaveLength(1)
    expect(raws[0].text).toContain('\\begin{lstlisting}[caption={Demo}]')
    expect(raws[0].text).toContain('print("hi")')
  })

  it('test_thebibliography_preserved_as_rawlatex', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
body
\begin{thebibliography}{9}
\bibitem{key}
A reference.
\end{thebibliography}
\end{document}`)
    const raws = blocksOf(doc.children, 'RawLatex')
    expect(raws.some((r) => r.text.includes('thebibliography'))).toBe(true)
    expect(raws.some((r) => r.text.includes('\\bibitem{key}'))).toBe(true)
  })

  it('test_abstract_becomes_abstract_blocks', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{abstract}
Short summary of the work.

A second paragraph with more detail.
\end{abstract}
\section{Intro}
body
\end{document}`)
    const abstracts = blocksOf(doc.children, 'Abstract')
    expect(abstracts).toHaveLength(2)  // one per paragraph in the source env
    expect(texts(abstracts[0].children).join(' ')).toContain('Short summary')
    expect(texts(abstracts[1].children).join(' ')).toContain('second paragraph')
  })

  it('test_keyword_environment_becomes_one_keywords_block_with_bullet_separators', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{keyword}
XPS \sep PHI \sep Python
\end{keyword}
\end{document}`)
    const kws = blocksOf(doc.children, 'Keywords')
    // One Keywords block with three terms joined by ' · ' inlines.
    expect(kws).toHaveLength(1)
    const t = texts(kws[0].children).join('')
    expect(t).toContain('XPS')
    expect(t).toContain('PHI')
    expect(t).toContain('Python')
    expect(t).toContain(' · ')  // the visible separator
    // Round-trip via the serializer: " · " becomes " \sep " again.
    expect(serializeDocument(doc)).toContain('XPS \\sep PHI \\sep Python')
  })

  it('test_preamble_extras_captures_lstset_and_friends', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\usepackage{listings}
\usepackage{xcolor}
\lstset{
    language=Python,
    basicstyle=\ttfamily\small,
    keywordstyle=\color{blue},
    commentstyle=\color{gray},
    frame=single,
    numbers=left
}
\definecolor{mycolor}{RGB}{12,34,56}
\hypersetup{colorlinks=true}
\newcommand{\bigtitle}[1]{\Large\textbf{#1}}
\begin{document}
body
\end{document}`)
    const extras = doc.meta.preamble_extras
    expect(extras).toContain('\\lstset')
    expect(extras).toContain('frame=single')
    expect(extras).toContain('numbers=left')
    expect(extras).toContain('\\definecolor{mycolor}')
    expect(extras).toContain('\\hypersetup{colorlinks=true}')
    expect(extras).toContain('\\newcommand{\\bigtitle}')
    // \usepackage and \documentclass must NOT appear (already modelled).
    expect(extras).not.toContain('\\usepackage')
    expect(extras).not.toContain('\\documentclass')
  })

  it('test_preamble_extras_round_trips_through_serializer', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\usepackage{listings}
\lstset{language=Python, frame=single, numbers=left}
\begin{document}
body
\end{document}`)
    const out = serializeDocument(doc)
    expect(out).toContain('\\lstset{language=Python, frame=single, numbers=left}')
    // And the lstset comes BEFORE \begin{document}.
    expect(out.indexOf('\\lstset')).toBeLessThan(out.indexOf('\\begin{document}'))
  })

  it('test_elsarticle_imports_frontmatter_extras_into_meta', () => {
    const doc = roundTrip(String.raw`\documentclass{elsarticle}
\begin{document}
\begin{frontmatter}
\title{Hello}
\author[ic]{Gwilherm Kerherve\corref{cor1}}
\ead{me@example.com}
\cortext[cor1]{Corresponding author}
\affiliation[ic]{organization={Imperial}}
\begin{abstract}
Short.
\end{abstract}
\end{frontmatter}
body
\end{document}`)
    expect(doc.meta.documentclass.startsWith('elsarticle')).toBe(true)
    const extras = doc.meta.frontmatter_extras
    expect(extras).toContain('\\author[ic]{Gwilherm Kerherve\\corref{cor1}}')
    expect(extras).toContain('\\ead{me@example.com}')
    expect(extras).toContain('\\cortext[cor1]{Corresponding author}')
    expect(extras).toContain('\\affiliation[ic]')
    // Title was extracted out of extras (it lives in the Title block instead).
    expect(extras).not.toContain('\\title{')
  })

  it('test_frontmatter_wrapper_is_flattened', () => {
    const doc = roundTrip(String.raw`\documentclass{elsarticle}\begin{document}
\begin{frontmatter}
\title{Real Title}
\author[ic]{Some Author\corref{cor1}}
\begin{abstract}
Summary.
\end{abstract}
\end{frontmatter}
\section{Body}
content
\end{document}`)
    const titleSeen = doc.meta.title || blocksOf(doc.children, 'Title').flatMap((t) => texts(t.children)).join('')
    expect(titleSeen).toContain('Real Title')
    const allText = blocksOf(doc.children, 'Paragraph').flatMap((b) => texts(b.children)).join(' ')
    expect(allText).not.toContain('frontmatter')
    const abstracts = blocksOf(doc.children, 'Abstract')
    expect(abstracts.length).toBeGreaterThanOrEqual(1)
    expect(abstracts.flatMap((a) => texts(a.children)).join(' ')).toContain('Summary')
  })

  it('test_unknown_macro_with_braced_arg_does_not_leak_args', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}\journal{SoftwareX} Body.\end{document}`)
    const t = blocksOf(doc.children, 'Paragraph').flatMap((b) => texts(b.children)).join('')
    // The \journal argument must not appear as a stray paragraph.
    expect(t).not.toContain('SoftwareX')
    expect(t).toContain('Body.')
  })

  it('test_author_with_nested_corref_returns_clean_name', () => {
    const doc = roundTrip(String.raw`\documentclass{elsarticle}\author[ic]{Gwilherm Kerherve\corref{cor1}}\begin{document}body\end{document}`)
    expect(doc.meta.author).toContain('Gwilherm Kerherve')
    expect(doc.meta.author).not.toContain('corref')
    expect(doc.meta.author).not.toContain('{')
  })

  it('test_escapes_unescaped', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
100\% \& \$5 plus a\_b
\end{document}`)
    const t = texts(childrenOf(doc.children[0])).join('')
    expect(t).toContain('100% & $5')
    expect(t).toContain('a_b')
  })

  it('test_unknown_macro_preserved_as_inline_raw', () => {
    // User-defined macros like \Kstroke must survive as InlineRaw so the
    // round-trip emits them unchanged, rather than being silently dropped.
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
Visit \Kstroke herveFitting today.
\end{document}`)
    const raws = inlinesOf(childrenOf(doc.children[0]), 'InlineRaw')
    expect(raws).toHaveLength(1)
    expect(raws[0].latex).toBe('\\Kstroke')
    expect(serializeDocument(doc)).toContain('\\Kstroke')
  })

  it('test_chapter_imports_as_section_level_0_and_round_trips', () => {
    const doc = roundTrip(String.raw`\documentclass{report}\begin{document}
\chapter{Introduction}
Body text after the chapter.
\section{Background}
\end{document}`)
    const sections = blocksOf(doc.children, 'Section')
    expect(sections.length).toBeGreaterThan(0)
    const levels = sections.map((s) => s.level)
    expect(levels).toContain(0)  // the \chapter (the editor's Chapter style)
    expect(levels).toContain(2)  // the \section: Heading 2 in a report
    const out = serializeDocument(doc)
    expect(out).toContain('\\chapter{Introduction}')
    expect(out).toContain('\\section{Background}')
  })

  it('test_unknown_macro_with_arg_preserved', () => {
    const doc = roundTrip(String.raw`\documentclass{article}\begin{document}
\textcolor{red}{important} note
\end{document}`)
    const raws = inlinesOf(childrenOf(doc.children[0]), 'InlineRaw')
    expect(raws).toHaveLength(1)
    expect(raws[0].latex).toBe('\\textcolor{red}{important}')
  })

  it('test_twocolumn_bracket_arg_preserved_verbatim', () => {
    const doc = roundTrip(String.raw`\documentclass[twocolumn]{article}\begin{document}
\twocolumn[
    \begin{@twocolumnfalse}
        \maketitle
        \tableofcontents
    \end{@twocolumnfalse}
]
Body paragraph.
\end{document}`)
    const matching = blocksOf(doc.children, 'RawLatex').filter((r) => r.text.startsWith('\\twocolumn['))
    expect(matching).toHaveLength(1)
    expect(matching[0].text).toContain('@twocolumnfalse')
    const out = serializeDocument(doc)
    expect(out).toContain('\\twocolumn[')
    expect(out).toContain('\\begin{@twocolumnfalse}')
    expect(out).toContain('\\end{@twocolumnfalse}')
  })

  it('test_documentclass_twocolumn_option_preserved', () => {
    const doc = roundTrip(String.raw`\documentclass[10pt,twocolumn]{article}
\begin{document}
Hello.
\end{document}`)
    expect(doc.meta.column_count).toBe(2)
    expect(doc.meta.body_font_pt).toBe(10)
  })

  it('test_documentclass_options_default_when_absent', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\begin{document}
Hello.
\end{document}`)
    expect(doc.meta.column_count).toBe(1)
    expect(doc.meta.body_font_pt).toBe(12)
  })

  it('test_documentclass_options_with_a4paper_and_11pt', () => {
    const doc = roundTrip(String.raw`\documentclass[a4paper,11pt,twocolumn]{article}
\begin{document}
Hello.
\end{document}`)
    expect(doc.meta.column_count).toBe(2)
    expect(doc.meta.body_font_pt).toBe(11)
  })

  it('test_geometry_margins_parsed', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\usepackage[left=1in,right=1in,top=0.5in,bottom=0.5in]{geometry}
\begin{document}
Hello.
\end{document}`)
    expect(Math.abs(doc.meta.margin_left_cm - 2.54)).toBeLessThan(0.01)
    expect(Math.abs(doc.meta.margin_right_cm - 2.54)).toBeLessThan(0.01)
    expect(Math.abs(doc.meta.margin_top_cm - 1.27)).toBeLessThan(0.01)
    expect(Math.abs(doc.meta.margin_bottom_cm - 1.27)).toBeLessThan(0.01)
  })

  it('test_align_star_imports_as_math_block_then_round_trips_without_double_wrap', () => {
    const out = serializeDocument(roundTrip(String.raw`\documentclass{article}\begin{document}
\begin{align*}
x &= 1 \\
y &= 2
\end{align*}
\end{document}`))
    // The killer assertion: no equation* wrapping the align* env.
    expect(out).not.toContain('\\begin{equation*}\n\\begin{align*}')
    expect(out).toContain('\\begin{align*}')
  })

  it('test_journal_class_preserves_options_and_authors', () => {
    const doc = roundTrip(String.raw`\documentclass[VANCOUVER,LATO2COL]{WileyNJDv5}
\usepackage{tikz}
\author[1]{Alice}
\author[2]{Bob}
\address[1]{\orgname{MIT}}
\title{My paper}
\begin{document}
\maketitle
Hello world.
\end{document}`)
    expect(doc.meta.class_options).toBe('VANCOUVER,LATO2COL')
    expect(doc.meta.documentclass).toBe('WileyNJDv5')
    const out = serializeDocument(doc)
    expect(out).toContain('\\documentclass[VANCOUVER,LATO2COL]{WileyNJDv5}')
    // Multi-author blocks preserved in preamble_extras
    expect(out).toContain('\\author[1]{Alice}')
    expect(out).toContain('\\author[2]{Bob}')
    expect(out).toContain('\\address[1]')
    // No auto-generated geometry for journal classes
    expect(!out.includes('\\usepackage[') || !out.split('\\begin{document}')[0].includes('geometry')).toBe(true)
  })

  it('test_resume_class_round_trip', () => {
    const doc = roundTrip(String.raw`\documentclass{resume}
\usepackage[left=0.75in,top=0.6in,right=0.75in,bottom=0.6in]{geometry}
\usepackage{hyperref}
\name{Gwilherm Kerherve \small{PhD}}
\address{17 Great Courtlands, Langton Green}
\address{07473 132 455 \\ g.kerherve@ic.ac.uk}
\begin{document}
A highly motivated scientist.
\begin{rSection}{Key Skills}
\begin{rSubsection}{Imperial College}{2020 - Present}{Research Manager}{London}
\item Maintain the XPS
\item Train users
\end{rSubsection}
\end{rSection}
\end{document}`)
    expect(doc.meta.documentclass).toBe('resume')
    expect(doc.meta.preamble_extras).toContain('\\name{Gwilherm Kerherve')
    expect(doc.meta.preamble_extras).toContain('\\address{')
    expect(blocksOf(doc.children, 'RawLatex').some((r) => r.text.includes('rSection'))).toBe(true)
    expect(Math.abs(doc.meta.margin_left_cm - 1.91)).toBeLessThan(0.1)
    expect(Math.abs(doc.meta.margin_top_cm - 1.52)).toBeLessThan(0.1)
    const out = serializeDocument(doc)
    expect(out).toContain('rSection')
    expect(out).toContain('\\name{Gwilherm Kerherve')
    expect(out.split('\\begin{document}')[0]).not.toContain('setspace')
  })

  it('test_wiley_body_frontmatter_extraction', () => {
    const doc = roundTrip(String.raw`\documentclass[VANCOUVER,LATO2COL]{WileyNJDv5}
\usepackage{tikz}
\title{My paper}
\begin{document}
\author[1]{Alice}
\author[2]{Bob}
\address[1]{\orgname{MIT}}
\address[2]{\orgname{ETH}}
\authormark{Alice \textsc{et al.}}
\titlemark{My paper}
\abstract[Abstract]{This is the abstract text.}
\keywords[Keywords]{XPS, fitting}
\maketitle
Hello world.
\end{document}`)
    const fm = doc.meta.frontmatter_extras
    expect(fm).toContain('\\author[1]{Alice}')
    expect(fm).toContain('\\author[2]{Bob}')
    expect(fm).toContain('\\address[1]')
    expect(fm).toContain('\\address[2]')
    expect(fm).toContain('\\authormark{')
    expect(fm).toContain('\\titlemark{')
    const absBlocks = blocksOf(doc.children, 'Abstract')
    expect(absBlocks).toHaveLength(1)
    const absText = absBlocks[0].children.map((c) => ('text' in c ? c.text : '')).join('')
    expect(absText).toContain('This is the abstract text.')
    expect(blocksOf(doc.children, 'Keywords')).toHaveLength(1)
    for (const block of blocksOf(doc.children, 'Paragraph')) {
      for (const child of inlinesOf(block.children, 'InlineRaw')) expect(child.latex).not.toContain('\\author')
    }
    const body = serializeDocument(doc).split('\\begin{document}')[1]
    expect(body).toContain('\\author[1]{Alice}')
    expect(body).toContain('\\author[2]{Bob}')
    expect(body).toContain('\\abstract{')
    expect(body).toContain('\\maketitle')
    const authorPos = body.indexOf('\\author[1]{Alice}')
    const abstractPos = body.indexOf('\\abstract{')
    const maketitlePos = body.indexOf('\\maketitle')
    expect(authorPos).toBeLessThan(abstractPos)
    expect(abstractPos).toBeLessThan(maketitlePos)
  })

  it('test_journal_figure_placement_htbp', () => {
    const out = serializeDocument(roundTrip(String.raw`\documentclass[VANCOUVER]{WileyNJDv5}
\begin{document}
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.8\textwidth]{img.png}
  \caption{A figure}
\end{figure}
\end{document}`))
    expect(out).toContain('\\begin{figure}[htbp]')
    expect(out).not.toContain('\\begin{figure}[H]')
  })

  it('test_figure_star_preserved_as_raw', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\begin{document}
\begin{figure*}[tb]
  \centering
  \includegraphics[width=\textwidth]{wide.png}
  \caption{A wide figure}
  \label{fig:wide}
\end{figure*}
\end{document}`)
    expect(blocksOf(doc.children, 'RawLatex').some((r) => r.text.includes('figure*'))).toBe(true)
    const out = serializeDocument(doc)
    expect(out).toContain('\\begin{figure*}')
    expect(out).toContain('\\end{figure*}')
    expect(out).toContain('\\caption{A wide figure}')
  })

  it('test_tabular_p_column_spec', () => {
    const doc = roundTrip(String.raw`\documentclass{article}
\begin{document}
\begin{table}[H]
\begin{tabular}{p{0.55\columnwidth} p{0.45\columnwidth}}
\hline
\textbf{Method} & \textbf{Description} \\
\hline
Levenberg-Marquardt & Efficient for least-squares \\
Powell & Derivative-free \\
\hline
\end{tabular}
\caption{Optimization methods}
\label{tab:methods}
\end{table}
\end{document}`)
    const tables = blocksOf(doc.children, 'Table')
    expect(tables).toHaveLength(1)
    const t = tables[0]
    expect(t.rows).toHaveLength(3)  // header + 2 data rows
    // An all-bold first row is read as a header row (bold on output).
    expect(t.header).toBe(true)
    expect(t.rows[0][0].trim()).toBe('Method')
    expect(t.caption).toBe('Optimization methods')
  })

  it('test_tilde_cite_round_trip', () => {
    const out = serializeDocument(roundTrip(String.raw`\documentclass{article}
\begin{document}
Some text~\cite{Kwok2000} and more~\cite{Foo2021,Bar2022}.
\end{document}`))
    expect(out).toContain('~\\cite{Kwok2000}')
    expect(out).not.toContain('\\textasciitilde{}')
  })

  it('test_whitespace_between_bracket_and_brace', () => {
    const doc = roundTrip(String.raw`\documentclass[VANCOUVER]{WileyNJDv5}
\title{Paper}
\begin{document}
\author[1] {William S. J. Skinner}
\maketitle
Hello.
\end{document}`)
    expect(doc.meta.frontmatter_extras).toContain('William')
  })

  it('test_input_and_include_are_inlined', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ktex-import-'))
    mkdirSync(join(tmp, 'chapters'))
    writeFileSync(join(tmp, 'chapters', 'intro.tex'), '\\section{Intro}\nHello from intro.\n\\input{chapters/deep}\n')
    writeFileSync(join(tmp, 'chapters', 'deep.tex'), 'Deep text.\n')
    writeFileSync(join(tmp, 'methods.tex'),
      '\\documentclass{subfiles}\n\\begin{document}\n\\section{Methods}\nM text.\n\\end{document}\n')
    const main = '\\documentclass{article}\n\\begin{document}\n'
      + '\\input{chapters/intro}\n'
      + '% \\input{commented_out}\n'
      + '\\include{methods.tex}\n'
      + '\\input{missing}\n\\end{document}\n'
    const doc = importTex(main, tmp, nodeFs)
    const titles = blocksOf(doc.children, 'Section').map((c) => (c.children[0] as { text: string }).text)
    expect(titles).toEqual(['Intro', 'Methods'])
    const flat = JSON.stringify(doc)
    expect(flat).toContain('Hello from intro.')
    expect(flat).toContain('Deep text.')
    expect(flat).toContain('M text.')
    expect(flat).not.toContain('documentclass{subfiles}')
    expect(flat).toContain('missing')  // unresolved command kept, not dropped
  })

  it('test_self_including_file_does_not_loop', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ktex-import-'))
    writeFileSync(join(tmp, 'a.tex'), 'A \\input{a}')
    expect(count(expandIncludes('\\input{a}', tmp, nodeFs), 'A ')).toBe(1)
  })

  it('test_booktabs_table_style_and_pipes_are_kept', () => {
    const src = '\\documentclass{article}\\begin{document}\n'
      + '\\begin{table}\\begin{tabular}{l|c}\\toprule A & B \\\\ \\midrule'
      + ' 1 & 2 \\\\ \\bottomrule\\end{tabular}\\end{table}\n'
      + '\\end{document}'
    const t = blocksOf(importTex(src).children, 'Table')[0]
    expect(t.style).toBe('booktabs')
    expect(t.alignment).toBe('l|c')
    expect(t.rows).toEqual([['A', 'B'], ['1', '2']])
  })
})

describe('importer without a filesystem', () => {
  it('leaves every include as written when no files can be read', () => {
    const doc = importTex('\\documentclass{article}\\begin{document}\n\\input{ch1}\n\\end{document}', '/nowhere')
    expect(JSON.stringify(doc)).toContain('\\\\input{ch1}')
  })
})

describe('test_theorems.py (importer)', () => {
  it('test_import_round_trip_and_json', () => {
    const src = '\\begin{theorem}[Heine--Borel]\nA set is compact.\n'
      + '\\end{theorem}\n\n\\begin{proof}\nOne.\n\nTwo.\n\\end{proof}'
    const blocks = importBodyFragment(src) as Theorem[]
    expect(blocks.map((b) => [b.kind, b.start])).toEqual([['theorem', true], ['proof', true], ['proof', false]])
    expect(blocks[0].title).toBe('Heine--Borel')
    const doc = fromJson(toJson(document(blocks)))
    expect((doc.children[2] as Theorem).start).toBe(false)
    expect(serializeDocument(doc)).toContain('\\begin{theorem}[Heine--Borel]')
  })
})

describe('test_table_design.py (importer)', () => {
  const mk = (o: Partial<Omit<Table, 'type'>>) => table({
    rows: [['Name', 'A', 'B'], ['x', '1', ''], ['y', '2', '3'], ['', '4', '5']],
    caption: 'T', label: 'tab:t', alignment: 'lcr',
    merges: [[1, 1, 1, 2], [2, 0, 2, 1]], header: true,
    shading: { '1,1': '#ffeb3b' }, ...o,
  })
  const tex = (t: Table) => serializeDocument(document([paragraph([text('x')]), t]))
  for (const style of ['', 'grid', 'plain', 'booktabs', 'striped']) {
    for (const repeat of [false, true]) {
      it(`test_latex_round_trip[${repeat}-${style}]`, () => {
        const t = mk({ style, repeat_header: repeat, alignment: style === 'grid' ? '|l|c|r|' : 'lcr' })
        expect(blocksOf(importTex(tex(t)).children, 'Table')).toEqual([t])
      })
    }
  }
})

describe('test_beamer.py (importer)', () => {
  it('test_import_frame_with_title', () => {
    const doc = importTex('\\documentclass{beamer}\n\\begin{document}\n'
      + '\\begin{frame}{Hello}\nSome content\n\\end{frame}\n\\end{document}\n')
    const frames = blocksOf(doc.children, 'Frame')
    expect(frames).toHaveLength(1)
    expect((frames[0].children[0] as { text: string }).text).toBe('Hello')
  })

  it('test_import_titlepage_frame', () => {
    const doc = importTex('\\documentclass{beamer}\n\\title{Talk}\n\\begin{document}\n'
      + '\\begin{frame}\n\\titlepage\n\\end{frame}\n\\end{document}\n')
    expect(blocksOf(doc.children, 'Title').length).toBeGreaterThanOrEqual(1)
  })

  it('test_import_frame_without_title', () => {
    const doc = importTex('\\documentclass{beamer}\n\\begin{document}\n'
      + '\\begin{frame}\nJust content\n\\end{frame}\n\\end{document}\n')
    expect(blocksOf(doc.children, 'Frame')).toHaveLength(1)
  })
})

describe('import_md', () => {
  it('reads YAML front matter, headings, lists and code', () => {
    const doc = importMd('---\ntitle: T\nauthor: A\n---\n# H\n\n- a\n- b\n\nIntro:\n```py\nx\n```\n')
    expect(doc.meta.title).toBe('T')
    expect(doc.children.map((b) => b.type)).toEqual(['Title', 'Author', 'Section', 'List', 'Paragraph', 'RawLatex'])
    expect((doc.children[5] as { text: string }).text).toContain('[caption={Intro}, language=py]')
    expect(doc.meta.packages).toEqual(expect.arrayContaining(['listings', 'xcolor']))
  })
})
