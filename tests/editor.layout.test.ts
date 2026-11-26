/// <reference lib="dom" />
// The visual tab's page layout (editor._apply_page_layout), ported from
// test_page_layout.py and test_class_looks.py where they check the block
// formats rather than painted pixels.
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { isBroken, lookFor, LOOKS, numberLabel } from '../src/editor/classLooks.ts'
import { docToPM } from '../src/editor/convert.ts'
import { baselineskipPt } from '../src/editor/latexFonts.ts'
import { anchorOffset, anchorTargets, BASELINE_AT, layoutDocument, normalizeForMatch, pdfPageStartBlocks, PX_PER_CM, screenFontFor,
  type BlockLayout } from '../src/editor/layout.ts'
import { TEMPLATE_CHOICES } from '../src/ui/ribbonModel.ts'

const PT = 96 / 72
const lay = (blocks: M.Block[], meta: Partial<M.DocMeta> = {}) =>
  layoutDocument(docToPM(M.document(blocks, M.docMeta(meta))), M.docMeta(meta))

const simple = (meta: Partial<M.DocMeta>) => lay([
  M.section(1, [M.text('Intro')]),
  M.paragraph([M.text('First paragraph.')]),
  M.paragraph([M.text('Second paragraph.')]),
], meta)

const classDoc = (cls: string, pt = 12) => lay([
  M.title([M.text('My Title')]), M.author([M.text('An Author')]),
  M.abstract([M.text('The abstract.')]), M.keywords([M.text('one, two')]),
  M.section(1, [M.text('Intro')]), M.paragraph([M.text('First paragraph.')]),
  M.paragraph([M.text('Second paragraph.')]), M.section(2, [M.text('Part')]),
  M.paragraph([M.text('Third paragraph.')]),
], { documentclass: cls, body_font_pt: pt })

// The first baseline of block `i`, from the top of the page, in px: the
// flow with Qt's collapsed margins, a line's baseline at BASELINE_AT.
function baselines(L: ReturnType<typeof lay>): number[] {
  let y = L.geometry.topPx
  return L.blocks.map((b: BlockLayout) => {
    y += b.gap
    const lh = b.tall ? b.tall.lead : typeof b.lineHeight === 'number' ? b.lineHeight : 16
    const base = y + (b.tall ? b.tall.padTop : 0) + BASELINE_AT * lh
    y += (b.tall ? b.tall.padTop + b.tall.padBottom : 0) + lh
    return base
  })
}

describe('test_page_layout.py', () => {
  it('test_margins_follow_document_settings', () => {
    const g = simple({ margin_left_cm: 4.0, margin_top_cm: 1.0 }).geometry
    expect(g.leftPx).toBeCloseTo(4.0 * PX_PER_CM)
    expect(g.topPx).toBeCloseTo(1.0 * PX_PER_CM)
  })

  it('test_indent_skips_first_paragraph_after_heading', () => {
    const [, first, second] = simple({ paragraph_indent: true }).blocks
    expect(first.indent).toBe(0)
    expect(second.indent).toBeGreaterThan(0)
  })

  it('test_no_indent_mode_uses_paragraph_spacing', () => {
    const [, , second] = simple({ paragraph_indent: false }).blocks
    expect(second.indent).toBe(0)
    expect(second.bottom).toBeGreaterThan(0)
  })

  it('test_line_spacing_applied', () => {
    const b = simple({ line_spacing: 2.0 }).blocks[1]
    expect(b.lineHeight).toBeCloseTo(14.4 * baselineskipPt(12, 2.0) / baselineskipPt(12, 1.0) * PT)
    expect(baselineskipPt(12, 1.0)).toBeCloseTo(14.5)
    expect(baselineskipPt(12, 2.0)).toBeCloseTo(14.5 * 1.655)
  })

  it('test_explicit_visual_font_is_respected', () => {
    expect(screenFontFor(M.docMeta({ visual_font_family: 'Arial' }))).toBe("'Arial'")
  })

  it('test_default_visual_font_tracks_latex_font', () => {
    expect(screenFontFor(M.docMeta())).toMatch(/^'KTeX LMRoman12'/)
    expect(screenFontFor(M.docMeta({ body_font_family: 'times' }))).toMatch(/^'Times New Roman', 'Times'/)
  })

  it('test_headings_scale_like_latex_and_are_numbered', () => {
    const L = lay([
      M.section(1, [M.text('A')]), M.section(2, [M.text('A1')]),
      M.section(1, [M.text('Star')], false), M.section(1, [M.text('B')]),
    ])
    expect(L.blocks[0].char!.sizePx).toBeCloseTo(17.22 * PT)
    expect(L.blocks.map(b => b.number || null)).toEqual(['1', '1.1', null, '2'])
    expect(L.blocks[0].numberGap).toBeGreaterThan(0)
  })
})

describe('test_class_looks.py', () => {
  it('test_every_document_type_is_measured', () => {
    for (const cls of TEMPLATE_CHOICES) expect(LOOKS).toHaveProperty(cls)
  })

  it('test_an_unlisted_class_is_drawn_as_an_article', () => {
    expect(lookFor('svjour3', 12)).toBe(lookFor('article', 12))
    expect(isBroken('article')).toBe('')
  })

  it.each(TEMPLATE_CHOICES)('test_every_type_prints_its_measured_sizes[%s]', (cls) => {
    const L = classDoc(cls)
    const look = lookFor(cls, 12)
    const keys: [number, 'title' | 'author' | 'h1' | 'h2'][] = [[0, 'title'], [1, 'author'], [4, 'h1'], [7, 'h2']]
    for (const [i, key] of keys) {
      const spec = look[key]
      // report / book draw Heading 1 as \chapter: still the h1 entry.
      if (spec) expect(L.blocks[i].char!.sizePx).toBeCloseTo(spec.size * PT, 2)
    }
    expect(L.blocks[5].char!.sizePx).toBeCloseTo(look.body.size * PT, 2)
  })

  it('test_article_title_block_is_upright_and_plain_black', () => {
    const L = classDoc('article')
    expect(L.blocks[0].char!.bold).toBe(false)
    expect(L.blocks[1].char!.italic).toBe(false)
    expect(L.blocks[1].char!.color).toBe('')
    expect(L.blocks[0].align).toBe('center')
  })

  it('test_abstract_has_no_screen_only_tint_and_gets_its_heading', () => {
    const L = classDoc('article')
    expect(L.blocks[2].above.map(l => l.text)).toContain('Abstract')
  })

  it('test_article_prints_todays_date_under_the_title_block', () => {
    const L = classDoc('article')
    const year = String(new Date().getFullYear())
    expect(L.blocks[1].above.some(l => l.text.includes(year))).toBe(true)
  })

  it.each(['article', 'scrartcl', 'report', 'elsarticle'])('test_author_sits_where_the_pdf_sets_it[%s]', (cls) => {
    const L = classDoc(cls)
    const b = baselines(L)
    const look = lookFor(cls, 12)
    expect((b[1] - b[0]) / PT).toBeCloseTo(look.author!.above!, -0.5)
  })

  it('test_first_title_drops_to_the_measured_height', () => {
    const L = classDoc('report')
    const y = baselines(L)[0] / PT
    expect(Math.abs(y - lookFor('report', 12).title!.top!)).toBeLessThan(4)
  })

  it.each([
    ['1', '2', '2'], ['1.1', '2.3', '2.3'], ['1.1.', '2.3', '2.3.'],
    ['I.', '4', 'IV.'], ['A.', '1.2', 'B.'], ['1)', '1.1.3', '3)'],
    ['a)', '1.1.1.2', 'b)'], ['Chapter 1', '3', 'Chapter 3'], ['', '3', ''],
  ])('test_number_label[%s-%s]', (prefix, dotted, want) => {
    expect(numberLabel(prefix, dotted)).toBe(want)
  })

  it('test_list_items_are_spaced_as_latex_spaces_them', () => {
    const L = lay([M.paragraph([M.text('Before.')]),
      M.list(true, [0, 1, 2].map(n => M.listItem([M.text(`i${n}`)]))), M.paragraph([M.text('After.')])])
    const [first, middle, last] = L.blocks.slice(1, 4)
    expect(first.top).toBeGreaterThan(middle.top)
    expect(middle.top).toBeGreaterThan(0)
    expect(last.bottom).toBeGreaterThan(0)
    expect(middle.bottom).toBe(0)
  })

  it('a chapter opens a new sheet and is numbered under report', () => {
    const L = lay([M.paragraph([M.text('x')]), M.section(1, [M.text('C')]), M.section(2, [M.text('S')])],
      { documentclass: 'report' })
    expect(L.blocks[1].breakBefore).toBe(true)
    expect(L.blocks[1].above.map(l => l.text)).toContain('Chapter 1')
    expect(L.blocks[2].number).toBe('1.1')
  })

  it('theorems are numbered within sections; proofs are not', () => {
    const L = lay([M.section(1, [M.text('S')]), M.theorem('lemma', 'Zorn', [M.text('t')]),
      M.theorem('proof', '', [M.text('p')]), M.theorem('theorem', '', [M.text('u')])])
    expect(L.blocks.slice(1).map(b => b.number)).toEqual(['Lemma 1.1 (Zorn).', 'Proof.', 'Theorem 1.2.'])
  })

  it('numbered equations count through the document', () => {
    const L = lay([M.mathBlock('a', true), M.mathBlock('b'), M.mathBlock('\\begin{align}c\\end{align}')])
    expect(L.blocks.map(b => b.equationNumber)).toEqual(['(1)', '', '(2)'])
  })
})

describe('the compiled PDF and projects (paged_edit.py)', () => {
  it('test_sheets_start_where_the_pdf_pages_start', () => {
    const long = 'word '.repeat(60)
    const blocks = [M.section(1, [M.text('Intro')]), M.paragraph([M.text('Lists are mentioned here. ' + long)]),
      M.section(1, [M.text('Lists')]), M.paragraph([M.text(long)])]
    const pm = docToPM(M.document(blocks))
    // The PDF put the "Lists" heading at the top of page 2; the earlier
    // paragraph that merely mentions the word must not take the break.
    const breaks = pdfPageStartBlocks(pm, [[2, 'Lists']])
    const L = layoutDocument(pm, M.docMeta(), undefined, breaks)
    expect(L.blocks.map(b => b.breakBefore)).toEqual([false, false, true, false])
  })

  it('a page starting with a chapter-numbered figure starts at the figure, not the paragraph after it', () => {
    const long = 'word '.repeat(60)
    const blocks = [M.paragraph([M.text('Before the figure. ' + long)]),
      M.figure({ path: 'a.png', caption: 'LEED pattern of the clean crystal', label: 'fig:1' }),
      M.paragraph([M.text('The amount of metal deposited was calculated. ' + long)])]
    const pm = docToPM(M.document(blocks))
    const anchors: [number, string][] = [[2, 'Figure 2.1: LEED pattern\nThe amount of metal depo']]
    const figPos = anchorTargets(pm, anchors)[0].pos
    expect(pm.nodeAt(figPos)!.type.name).toBe('figure')
    // The figure starts the page (paginate forces it); the paragraph under
    // it stays with it.
    expect([...pdfPageStartBlocks(pm, anchors)]).toEqual([figPos])
    const L = layoutDocument(pm, M.docMeta(), undefined, pdfPageStartBlocks(pm, anchors))
    expect(L.blocks.map(b => b.breakBefore)).toEqual([false, false, false])
  })

  it('a page start is not matched pages beyond the last one (a phrase that recurs later)', () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => M.paragraph([M.text(`Filler paragraph ${i}. ` + 'text '.repeat(400))]))
    const blocks = [M.paragraph([M.text('Page one starts here and goes on for a while.')]),
      ...filler(12),
      M.paragraph([M.text('Much later the spectra were taken at a photon energy of 120 eV.')])]
    const pm = docToPM(M.document(blocks))
    // Page 2's only line is a caption's second line, nowhere in the body:
    // the recurring phrase twelve pages on must not take page 2's start.
    const t = anchorTargets(pm, [[1, 'Page one starts here and'], [2, 'taken at a photon energy']])
    expect(t.map(x => x.page)).toEqual([1])
  })

  it("a \\maketitle redefined as one line (the planners' header) lays the title and author out on one row", () => {
    const extras = '\\makeatletter\n\\renewcommand{\\maketitle}{\\par\\noindent{\\LARGE\\bfseries\\@title}\\hfill{\\large\\@author}\\par\\vspace{3pt}\\hrule\\vspace{4pt}}\n\\makeatother'
    const L = lay([M.title([M.text('November 2026')]), M.author([M.text('Monthly planner')]), M.paragraph([M.text('Body.')])],
      { body_font_pt: 10, preamble_extras: extras })
    const [t, a] = L.blocks
    expect(t.align).toBe('left')
    expect(a.align).toBe('right')
    // The author's line overlaps the title's (a negative gap), a rule under it, no date.
    expect(a.gap).toBeLessThan(0)
    expect(a.ruleBelow).toBeGreaterThan(0)
    expect(L.look.date).toBeUndefined()
    // Without it, the class's centred title block and its date.
    const plain = lay([M.title([M.text('November 2026')]), M.author([M.text('Monthly planner')])], { body_font_pt: 10 })
    expect(plain.blocks[0].align).toBe('center')
  })

  it('a page starting with an element whose first words are in no setting starts at the element', () => {
    // A Gantt chart prints "Month" over its rows; its settings hold the
    // task names the page goes on with.
    const gantt = M.rawLatex('% kTeX gantt {"tasks":[["Literature review",1,3],["Experiments",2,5]]}\n\\begin{tikzpicture}\\end{tikzpicture}')
    const blocks = [M.paragraph([M.text('First page text that goes on for a while here.')]), gantt, M.paragraph([]),
      M.paragraph([M.text('Paragraph after the chart on the same page.')])]
    const pm = docToPM(M.document(blocks))
    const t = anchorTargets(pm, [[2, 'Month\nLiterature review\nExperiments\nParagraph after the char']])
    expect(t.map(x => x.pos)).toEqual([pm.child(0).nodeSize])
  })

  it('a page is not started a few words after the last page start, in the same paragraph', () => {
    const long = 'cleaned in ultra-high vacuum by repeated cycles. ' + 'more words here '.repeat(10) + 'cleaned in ultra-high vacuum again.'
    const pm = docToPM(M.document([M.paragraph([M.text('Opening words of page one here.')]), M.paragraph([M.text('Paragraph 5: ' + long)])]))
    const t = anchorTargets(pm, [[2, 'Paragraph 5: cleaned in'], [3, 'cleaned in ultra-high va']])
    expect(t.map(x => x.page)).toEqual([2])
  })

  it('anchor_offset: short keys must be the whole line, long ones may start mid-block', () => {
    expect(normalizeForMatch('  Ünïcode   TEXT ')).toBe('unicode text')
    expect(anchorOffset('Lists', 'lists')).toBe(0)
    expect(anchorOffset('Lists are here', 'lists')).toBe(-1)
    const key = normalizeForMatch('the second page starts here')
    expect(anchorOffset('Some words before; the second page starts here and on', key)).toBe(19)
  })

  // Inline maths, citations and cross-references print as text in the PDF
  // but are one object character in the editor.
  it('a page starting on a line with an inline object is found', () => {
    expect(anchorOffset('With \ufffc fixed at the measured value', normalizeForMatch('With km fixed at the mea'))).toBe(0)
    expect(anchorOffset('As shown in \ufffc, the gain is small', normalizeForMatch('As shown in [1, 2], the'))).toBe(0)
    // An object cannot stand in for the whole line.
    expect(anchorOffset('Heat removal is shown \ufffc here', normalizeForMatch('Materials and methods'))).toBe(-1)
    expect(anchorOffset('\ufffc', normalizeForMatch('Anything at all here'))).toBe(-1)
  })

  it('a \\tableofcontents block is the page its title starts', () => {
    expect(anchorOffset('\\tableofcontents', 'contents')).toBe(0)
    expect(anchorOffset('\\tableofcontents', normalizeForMatch('Inhaltsverzeichnis'))).toBe(0)
    expect(anchorOffset('\\listoffigures', 'list of figures')).toBe(0)
    expect(anchorOffset('\\tableofcontents', 'introduction')).toBe(-1)
    expect(anchorOffset('\\begin{thebibliography}{9}\n\\bibitem{a} A.', 'bibliography')).toBe(0)
    expect(anchorOffset('\\printbibliography', 'references')).toBe(0)
  })

  it('heading counters continue from the earlier documents of a project', () => {
    const L = layoutDocument(docToPM(M.document([M.section(1, [M.text('A')]), M.section(2, [M.text('B')])])),
      M.docMeta(), [0, 3, 0, 0, 0, 0])
    expect(L.blocks.map(b => b.number)).toEqual(['4', '4.1'])
  })
})
