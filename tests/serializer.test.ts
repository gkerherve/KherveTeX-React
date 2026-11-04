// Port of tests/test_serializer.py.
import { describe, expect, it } from 'vitest'
import {
  abstract, author, citation, classSupportsChapter, crossRef, docMeta, document, figure,
  footnote, inlineRaw, keywords, link, list, listItem, mathBlock, mathInline, paragraph,
  rawLatex, section, table, text, theorem, title,
} from '../src/core/model.ts'
import type { DocMeta } from '../src/core/model.ts'
import {
  escapeAuthor, escapeText, serializeBlock, serializeDocument, serializeInline,
} from '../src/core/serializer.ts'

const count = (s: string, sub: string) => s.split(sub).length - 1
// Python's str.rfind(sub, 0, end).
const rfind = (s: string, sub: string, end: number) => {
  const i = s.lastIndexOf(sub, end - sub.length)
  return i >= 0 && i + sub.length <= end ? i : -1
}
const firstLine = (s: string) => s.split('\n')[0]
const bodyAndPreamble = (meta: Partial<DocMeta> = {}) =>
  serializeDocument(document([paragraph([text('x')])], docMeta({ title: '', ...meta })))

describe('test_serializer.py', () => {
  it('test_escape_text_handles_specials', () => {
    expect(escapeText('100% & $5')).toBe('100\\% \\& \\$5')
    expect(escapeText('a_b^c')).toBe('a\\_b\\textasciicircum{}c')
    expect(escapeText('{x}')).toBe('\\{x\\}')
  })

  it('test_escape_author_treats_newline_as_line_break', () => {
    expect(escapeAuthor('Jane Doe\nDept, University')).toBe('Jane Doe \\\\\nDept, University')
  })

  it('test_escape_author_treats_latex_backslash_as_line_break', () => {
    expect(escapeAuthor('Jane Doe \\\\ Dept, University')).toBe('Jane Doe \\\\\nDept, University')
  })

  it('test_escape_author_passes_latex_macros_through', () => {
    const src = 'Jane Doe\\thanks{ORCID: 1234, \\texttt{j@x.org}}\n\\small Dept, University'
    expect(escapeAuthor(src)).toBe(
      'Jane Doe\\thanks{ORCID: 1234, \\texttt{j@x.org}} \\\\\n\\small Dept, University')
  })

  it('test_escape_author_guards_bare_specials_without_double_escaping', () => {
    expect(escapeAuthor('Smith & Co, 50%')).toBe('Smith \\& Co, 50\\%')
    expect(escapeAuthor('Smith \\& Co')).toBe('Smith \\& Co')
  })

  it('test_escape_author_neutralises_stray_braces', () => {
    expect(escapeAuthor('Gwilherm Kerherve}')).toBe('Gwilherm Kerherve\\}')
    expect(escapeAuthor('{Gwilherm Kerherve')).toBe('\\{Gwilherm Kerherve')
    expect(escapeAuthor('Jane\\thanks{ORCID, \\texttt{j@x.org}}'))
      .toBe('Jane\\thanks{ORCID, \\texttt{j@x.org}}')
  })

  it('test_document_author_with_thanks_is_not_parboxed', () => {
    const doc = document([title([text('T')])], docMeta({
      title: 'T',
      author: 'Jane Doe\\thanks{ORCID: 0000, \\texttt{j@x.org}}\n'
        + '\\small Department of Physics, Some University, City, Country',
    }))
    const out = serializeDocument(doc)
    expect(out).toContain('\\thanks{ORCID: 0000, \\texttt{j@x.org}}')
    expect(out).toContain('\\small Department of Physics')
    expect(out).not.toContain('parbox')
    expect(out).not.toContain('textbackslash')
  })

  it('test_document_author_renders_on_two_lines', () => {
    const doc = document([title([text('T')])], docMeta({
      title: 'T', author: 'Jane Doe\nDepartment of Physics, Some University, City, Country',
    }))
    const out = serializeDocument(doc)
    expect(out).toContain('Jane Doe \\\\\n')
    expect(out).not.toContain('textbackslash')
  })

  it('test_text_with_marks_nests_in_stable_order', () => {
    expect(serializeInline(text('hi', ['italic', 'bold']))).toBe('\\textbf{\\textit{hi}}')
  })

  it('test_math_inline_is_not_escaped', () => {
    expect(serializeInline(mathInline('a_1 + b^2'))).toBe('$a_1 + b^2$')
  })

  it('test_link_serializes_with_href', () => {
    const n = link('https://example.com', [text('click here')])
    expect(serializeInline(n)).toBe('\\href{https://example.com}{click here}')
  })

  it('test_link_without_children_uses_bare_url', () => {
    expect(serializeInline(link('https://x.com', []))).toBe('\\url{https://x.com}')
    expect(serializeInline(link('https://x.com', [text('https://x.com')]))).toBe('\\url{https://x.com}')
  })

  it('test_document_with_url_loads_xurl', () => {
    const doc = document([
      title([text('T')]),
      paragraph([link('https://example.com/very/long', [])]),
    ], docMeta({ title: 'T' }))
    const out = serializeDocument(doc)
    expect(out).toContain('\\usepackage{xurl}')
    expect(out).toContain('\\url{https://example.com/very/long}')
  })

  it('test_footnote_serializes', () => {
    expect(serializeInline(footnote([text('see page 5')]))).toBe('\\footnote{see page 5}')
  })

  it('test_citation_default_style_is_cite', () => {
    expect(serializeInline(citation(['smith2020', 'doe2019']))).toBe('\\cite{smith2020,doe2019}')
  })

  it('test_citation_alternative_styles', () => {
    expect(serializeInline(citation(['a'], 'citep'))).toBe('\\citep{a}')
    expect(serializeInline(citation(['a'], 'citet'))).toBe('\\citet{a}')
  })

  it('test_crossref_serializes', () => {
    expect(serializeInline(crossRef('sec:intro', 'ref'))).toBe('\\ref{sec:intro}')
    expect(serializeInline(crossRef('eq:1', 'eqref'))).toBe('\\eqref{eq:1}')
  })

  it('test_paragraph_left_uses_flushleft_env', () => {
    const out = serializeBlock(paragraph([text('hello')], 'left'))
    expect(out).toContain('\\begin{flushleft}')
    expect(out).toContain('\\end{flushleft}')
  })

  it('test_paragraph_justify_is_unwrapped', () => {
    expect(serializeBlock(paragraph([text('hello')], 'justify'))).not.toContain('\\begin')
  })

  it('test_paragraph_center_uses_center_env', () => {
    const out = serializeBlock(paragraph([text('hi')], 'center'))
    expect(out).toContain('\\begin{center}')
    expect(out).toContain('\\end{center}')
  })

  it('test_paragraph_right_uses_flushright_env', () => {
    const out = serializeBlock(paragraph([text('hi')], 'right'))
    expect(out).toContain('\\begin{flushright}')
    expect(out).toContain('\\end{flushright}')
  })

  it('test_section_numbered_vs_starred', () => {
    expect(serializeBlock(section(1, [text('X')])).startsWith('\\section{X}')).toBe(true)
    expect(serializeBlock(section(2, [text('X')], false)).startsWith('\\subsection*{X}')).toBe(true)
  })

  it('test_math_block_envs', () => {
    const outNum = serializeBlock(mathBlock('x=1', true, 'eq:one'))
    expect(outNum).toContain('\\begin{equation}')
    expect(outNum).toContain('\\label{eq:one}')
    expect(serializeBlock(mathBlock('x=1', false))).toContain('\\begin{equation*}')
  })

  it('test_multi_item_list_serializes_every_item', () => {
    const out = serializeBlock(list(false, [
      listItem([text('alpha')]), listItem([text('beta')]), listItem([text('gamma')]),
    ]))
    for (const word of ['alpha', 'beta', 'gamma']) expect(out).toContain(`\\item ${word}`)
  })

  it('test_list_unordered_uses_itemize', () => {
    const out = serializeBlock(list(false, [listItem([text('one')]), listItem([text('two')])]))
    expect(out).toContain('\\begin{itemize}')
    expect(out).toContain('\\item one')
    expect(out).toContain('\\item two')
    expect(out).toContain('\\end{itemize}')
  })

  it('test_list_ordered_uses_enumerate', () => {
    expect(serializeBlock(list(true, [listItem([text('x')])]))).toContain('\\begin{enumerate}')
  })

  it('test_figure_serializes_with_includegraphics_and_caption', () => {
    const out = serializeBlock(figure({
      path: 'img/foo.png', caption: 'Hello', label: 'fig:foo', width: '0.5\\textwidth',
    }))
    expect(out).toContain('\\begin{figure}')
    expect(out).toContain('\\includegraphics[width=0.5\\textwidth]{img/foo.png}')
    expect(out).toContain('\\caption{Hello}')
    expect(out).toContain('\\label{fig:foo}')
  })

  it('test_figure_normalises_backslashes_in_path', () => {
    expect(serializeBlock(figure({ path: 'img\\foo.png', caption: '', label: null }))).toContain('img/foo.png')
  })

  it('test_table_serializes_tabular_with_alignment', () => {
    const out = serializeBlock(table({ rows: [['a', 'b'], ['c', 'd']], caption: 'Cap', alignment: 'lr' }))
    expect(out).toContain('\\begin{tabular}{lr}')
    expect(out).toContain('a & b \\\\')
    expect(out).toContain('\\caption{Cap}')
  })

  it('test_table_auto_alignment_is_all_left', () => {
    expect(serializeBlock(table({ rows: [['a', 'b', 'c']] }))).toContain('\\begin{tabular}{lll}')
  })

  it('test_raw_latex_passes_through_verbatim', () => {
    expect(serializeBlock(rawLatex('\\includegraphics{foo.png}')).trim()).toBe('\\includegraphics{foo.png}')
  })

  it('test_empty_title_and_author_omits_maketitle', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta({ title: '', author: '' })))
    expect(out).not.toContain('\\title')
    expect(out).not.toContain('\\maketitle')
  })

  it('test_title_block_drives_title_and_maketitle', () => {
    const out = serializeDocument(document([
      title([text('My Document')]),
      paragraph([text('body')]),
    ], docMeta({ title: '', author: '' })))
    expect(out).toContain('\\title{My Document}')
    expect(out).toContain('\\maketitle')
    const bodyStart = out.indexOf('\\begin{document}')
    expect(bodyStart).toBeGreaterThanOrEqual(0)
    expect(out.indexOf('\\maketitle', bodyStart)).toBeGreaterThan(bodyStart)
  })

  it('test_title_block_with_inline_marks', () => {
    const out = serializeDocument(document([title([text('Bold '), text('title', ['italic'])])]))
    expect(out).toContain('\\title{Bold \\textit{title}}')
  })

  it('test_author_block_drives_author_in_preamble', () => {
    const out = serializeDocument(document([
      title([text('T')]),
      author([text('Jane Doe')]),
      paragraph([text('body')]),
    ], docMeta({ title: '', author: '' })))
    expect(out).toContain('\\author{Jane Doe}')
    const body = out.slice(out.indexOf('\\begin{document}'))
    expect(body).not.toContain('Jane Doe')
  })

  it('test_author_block_overrides_meta_author', () => {
    const doc = document([author([text('New Author')])], docMeta({ title: '', author: 'Old Author' }))
    expect(serializeDocument(doc)).toContain('\\author{New Author}')
  })

  it('test_meta_title_fallback_when_no_title_block', () => {
    const out = serializeDocument(document([paragraph([text('body')])], docMeta({ title: 'From meta', author: 'x' })))
    expect(out).toContain('\\title{From meta}')
    expect(out).toContain('\\maketitle')
  })

  it('test_consecutive_abstract_blocks_merge_into_one_env', () => {
    const out = serializeDocument(document([
      abstract([text('First paragraph.')]),
      abstract([text('Second paragraph.')]),
      paragraph([text('body')]),
    ], docMeta()))
    expect(count(out, '\\begin{abstract}')).toBe(1)
    expect(count(out, '\\end{abstract}')).toBe(1)
    expect(out).toContain('First paragraph.')
    expect(out).toContain('Second paragraph.')
  })

  it('test_keywords_blocks_join_with_sep', () => {
    const out = serializeDocument(document([
      keywords([text('XPS')]), keywords([text('PHI')]), keywords([text('Python')]),
    ], docMeta()))
    expect(count(out, '\\begin{keyword}')).toBe(1)
    expect(out).toContain('XPS \\sep PHI \\sep Python')
  })

  it('test_single_keywords_block_with_bullet_separator_splits_back_to_sep', () => {
    const out = serializeDocument(document([keywords([text('XPS · PHI · Python')])], docMeta()))
    expect(out).toContain('XPS \\sep PHI \\sep Python')
  })

  it('test_elsarticle_wraps_metadata_in_frontmatter', () => {
    const out = serializeDocument(document([
      title([text('My title')]),
      author([text('Jane Doe')]),
      abstract([text('Short summary.')]),
      keywords([text('alpha · beta')]),
      section(1, [text('Intro')]),
    ], docMeta({ documentclass: 'elsarticle', title: '', author: '' })))
    const fmStart = out.indexOf('\\begin{frontmatter}')
    const fmEnd = out.indexOf('\\end{frontmatter}')
    expect(fmStart).toBeGreaterThanOrEqual(0)
    expect(fmEnd).toBeGreaterThanOrEqual(0)
    const front = out.slice(fmStart, fmEnd)
    expect(front).toContain('\\title{My title}')
    expect(front).toContain('\\author{Jane Doe}')
    expect(front).toContain('\\begin{abstract}')
    expect(front).toContain('\\end{abstract}')
    expect(front).toContain('\\begin{keyword}')
    expect(front).toContain('\\end{keyword}')
    expect(front).toContain('alpha \\sep beta')
    expect(out.indexOf('\\section{Intro}')).toBeGreaterThan(fmEnd)
    expect(out).not.toContain('\\maketitle')
  })

  it('test_elsarticle_frontmatter_extras_emitted', () => {
    const out = serializeDocument(document([
      title([text('My title')]),
      abstract([text('Body.')]),
    ], docMeta({
      documentclass: 'elsarticle', title: '', author: '',
      frontmatter_extras: '\\author[ic]{Gwilherm Kerherve\\corref{cor1}}\n'
        + '\\ead{g.kerherve@imperial.ac.uk}\n'
        + '\\cortext[cor1]{Corresponding author}\n'
        + '\\affiliation[ic]{organization={Imperial College London}}',
    })))
    const fmStart = out.indexOf('\\begin{frontmatter}')
    const fmEnd = out.indexOf('\\end{frontmatter}')
    expect(fmStart).toBeGreaterThanOrEqual(0)
    expect(fmEnd).toBeGreaterThanOrEqual(0)
    const front = out.slice(fmStart, fmEnd)
    expect(front).toContain('\\author[ic]{Gwilherm Kerherve\\corref{cor1}}')
    expect(front).toContain('\\ead{g.kerherve@imperial.ac.uk}')
    expect(front).toContain('\\cortext[cor1]{Corresponding author}')
    expect(front).toContain('\\affiliation[ic]')
    expect(count(front, '\\title{My title}')).toBe(1)
    expect(count(front, '\\author{')).toBe(0)
  })

  it('test_article_class_still_uses_preamble_title_and_maketitle', () => {
    const out = serializeDocument(document([
      title([text('T')]),
      abstract([text('Body')]),
    ], docMeta({ documentclass: 'article' })))
    expect(out).toContain('\\title{T}')
    expect(out).not.toContain('\\begin{frontmatter}')
  })

  it('test_geometry_package_emitted_for_a4_by_default', () => {
    const out = serializeDocument(document([paragraph([text('x')])], docMeta()))
    expect(out).toContain('\\usepackage[a4paper,top=2.5cm,bottom=2.5cm,left=2.5cm,right=2.5cm]{geometry}')
  })

  it('test_geometry_package_changes_with_page_size', () => {
    const out = serializeDocument(document([paragraph([text('x')])], docMeta({ page_size: 'Letter' })))
    expect(out).toContain('\\usepackage[letterpaper,')
    expect(out).toContain('top=2.5cm')
  })

  it('test_geometry_package_for_legal', () => {
    const out = serializeDocument(document([paragraph([text('x')])], docMeta({ page_size: 'Legal' })))
    expect(out).toContain('\\usepackage[legalpaper,')
  })

  it('test_custom_margins_flow_into_geometry', () => {
    const out = serializeDocument(document([paragraph([text('x')])], docMeta({
      margin_top_cm: 1.0, margin_bottom_cm: 1.5, margin_left_cm: 3.0, margin_right_cm: 2.0,
    })))
    expect(out).toContain('top=1.0cm')
    expect(out).toContain('bottom=1.5cm')
    expect(out).toContain('left=3.0cm')
    expect(out).toContain('right=2.0cm')
  })

  it('test_body_font_pt_becomes_documentclass_option', () => {
    expect(serializeDocument(document([], docMeta({ body_font_pt: 11 })))).toContain('\\documentclass[11pt]{article}')
  })

  it('test_line_spacing_one_half_uses_onehalfspacing', () => {
    const out = serializeDocument(document([paragraph([text('x')])], docMeta({ line_spacing: 1.5 })))
    expect(out).toContain('\\onehalfspacing')
  })

  it('test_double_spacing_uses_doublespacing', () => {
    const out = serializeDocument(document([paragraph([text('x')])], docMeta({ line_spacing: 2.0 })))
    expect(out).toContain('\\doublespacing')
  })

  it('test_font_family_helvetica_loads_helvet_package', () => {
    const out = serializeDocument(document([paragraph([text('x')])], docMeta({ body_font_family: 'helvetica' })))
    expect(out).toContain('\\usepackage{helvet}')
  })

  it('test_set_title_emits_maketitle', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta({ title: 'X', author: '' })))
    expect(out).toContain('\\title{X}')
    expect(out).toContain('\\maketitle')
  })

  it('test_two_column_adds_twocolumn_class_option', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta({ column_count: 2 })))
    expect(firstLine(out)).toContain('twocolumn')
    expect(firstLine(out)).toContain('\\documentclass[')
  })

  it('test_two_column_default_off', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta()))
    expect(firstLine(out)).not.toContain('twocolumn')
  })

  it('test_two_column_works_with_elsarticle', () => {
    const out = serializeDocument(document([paragraph([text('hi')])],
      docMeta({ documentclass: 'elsarticle', column_count: 2 })))
    expect(firstLine(out)).toContain('twocolumn')
    expect(firstLine(out)).toContain('{elsarticle}')
  })

  it('test_three_columns_wraps_body_in_multicols', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta({ column_count: 3 })))
    expect(firstLine(out)).not.toContain('twocolumn')
    expect(out).toContain('\\begin{multicols}{3}')
    expect(out).toContain('\\end{multicols}')
  })

  it('test_one_column_no_wrap_no_class_option', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta({ column_count: 1 })))
    expect(firstLine(out)).not.toContain('twocolumn')
    expect(out).not.toContain('\\begin{multicols}')
  })

  it('test_kstroke_macro_provided_in_preamble', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta()))
    expect(out).toContain('\\providecommand{\\Kstroke}')
  })

  it('test_math_block_with_prewrapped_env_not_double_wrapped', () => {
    const out = serializeBlock(mathBlock('\\begin{align*}\nx &= 1\n\\end{align*}', false))
    expect(out).not.toContain('\\begin{equation*}')
    expect(out).toContain('\\begin{align*}')
    expect(out).toContain('\\end{align*}')
  })

  it('test_math_block_plain_body_still_gets_equation_wrap', () => {
    expect(serializeBlock(mathBlock('x + y = z', false))).toContain('\\begin{equation*}')
    expect(serializeBlock(mathBlock('a = b', true))).toContain('\\begin{equation}')
  })

  it('test_inline_raw_serializes_verbatim', () => {
    expect(serializeInline(inlineRaw('\\Kstroke'))).toBe('\\Kstroke')
    expect(serializeInline(inlineRaw('\\textcolor{red}{x}'))).toBe('\\textcolor{red}{x}')
  })

  it('test_section_level_0_serialises_to_chapter', () => {
    expect(serializeBlock(section(0, [text('Introduction')]))).toContain('\\chapter{Introduction}')
    const out1 = serializeBlock(section(1, [text('Background')]))
    expect(out1).toContain('\\section{Background}')
    expect(out1).not.toContain('\\chapter')
  })

  it('test_kstroke_uses_providecommand_not_newcommand', () => {
    const out = serializeDocument(document([paragraph([text('hi')])], docMeta()))
    expect(out).not.toContain('\\newcommand{\\Kstroke}')
  })

  it('test_booktabs_table_serializes_rules_and_package', () => {
    const out = serializeDocument(document([
      table({ rows: [['A', 'B'], ['1', '2']], caption: 'c', style: 'booktabs' }),
    ]))
    expect(out).toContain('\\toprule')
    expect(out).toContain('\\midrule')
    expect(out).toContain('\\bottomrule')
    expect(out).not.toContain('\\hline')
    expect(out).toContain('\\usepackage{booktabs}')
  })

  it('test_plain_table_keeps_hline_and_no_booktabs', () => {
    const out = serializeDocument(document([table({ rows: [['A'], ['1']] })]))
    expect(out).toContain('\\hline')
    expect(out).not.toContain('booktabs')
  })

  it('test_empty_document_still_gives_a_page', () => {
    const tex = serializeDocument(document([paragraph([])], docMeta({ title: '' })))
    const body = tex.split('\\begin{document}')[1].split('\\end{document}')[0]
    expect(body.trim()).toBe('\\null')
  })

  it('test_table_without_caption_prints_no_table_number', () => {
    const body = (caption: string) => serializeDocument(document([
      table({ rows: [['a', 'b'], ['1', '2']], caption }),
    ], docMeta({ title: '' }))).split('\\begin{document}')[1]
    expect(body('')).not.toContain('\\caption')
    expect(body('Data')).toContain('\\caption{Data}')
  })

  it('test_memoir_line_spacing_uses_memoirs_own_commands', () => {
    let tex = bodyAndPreamble({ documentclass: 'memoir', line_spacing: 1.15 })
    expect(tex).toContain('\\setSpacing{1.15}')
    expect(tex).not.toContain('setspace')
    expect(tex).not.toContain('\\setstretch')
    tex = bodyAndPreamble({ documentclass: 'memoir', line_spacing: 1.5 })
    expect(tex).toContain('\\OnehalfSpacing')
    expect(bodyAndPreamble({ line_spacing: 1.15 })).toContain('\\setstretch{1.15}')
  })

  it('test_elsarticle_journal_page_options_skip_geometry', () => {
    expect(bodyAndPreamble({ documentclass: 'elsarticle', class_options: '5p,twocolumn' })).not.toContain('{geometry}')
    expect(bodyAndPreamble({ documentclass: 'elsarticle' })).toContain('{geometry}')
  })

  it('test_percent_in_a_table_cell_or_caption_is_a_percentage', () => {
    const tex = serializeDocument(document([
      table({ rows: [['Share', 'Change'], ['40%', '\\%5']], caption: 'Up 3%' }),
    ], docMeta({ title: '' })))
    expect(tex).toContain('40\\%')
    expect(tex).toContain('\\%5')
    expect(tex).toContain('Up 3\\%')
    expect(tex).not.toContain('\\\\%')
  })

  it('test_keyword_separator_leaves_no_space_before_the_comma', () => {
    expect(bodyAndPreamble()).toContain('\\def\\sep{\\unskip, }')
  })

  it('test_definitions_are_upright_theorems_italic', () => {
    const tex = serializeDocument(document([
      theorem('definition', '', [text('D')]),
      theorem('lemma', '', [text('L')]),
    ], docMeta({ title: '' })))
    const definition = tex.indexOf('\\newtheorem{definition}')
    expect(definition).toBeGreaterThanOrEqual(0)
    expect(rfind(tex, '\\theoremstyle{definition}', definition)).not.toBe(-1)
    const plain = tex.indexOf('\\theoremstyle{plain}', definition)
    expect(plain).toBeGreaterThanOrEqual(0)
    const lemma = tex.indexOf('\\newtheorem{lemma}')
    expect(lemma).toBeGreaterThanOrEqual(0)
    expect(lemma < rfind(tex, '\\theoremstyle{definition}', definition) || lemma > plain).toBe(true)
  })

  it('test_tufte_book_has_chapters', () => {
    expect(classSupportsChapter('tufte-book')).toBe(true)
  })
})
