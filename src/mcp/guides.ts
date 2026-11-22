// How-to guides an assistant (Claude, ChatGPT...) reads with the how_to
// tool. The server's instructions are short and some hosts do not show
// them at all, so the full procedures live here: the assistant asks for
// the one it needs.

export const GUIDES: Record<string, { title: string; text: string }> = {
  word_to_ktex: {
    title: 'Put a Word document into kTeX (and make it right)',
    text: `Goal: the user's Word file (.docx; also .doc saved as .docx, .odt, .rtf) becomes a kTeX document whose
headings, lists, tables, equations, figures, footnotes and references are real kTeX blocks, compiling to a clean PDF.

1. Save the user's work first. get_document_info: if unsaved_changes is true, ask the user, then save_document.
2. Import: open_document with the file's full path (needs Full access). It runs kTeX's Word importer and answers with
   an import check (see step 3). A .doc (Word 97-2003) cannot be read: ask the user to open it in Word and
   File > Save As > Word Document (.docx). A Google Doc: File > Download > Microsoft Word (.docx) first.
3. Check the import against the original:
   - check_import lists what usually goes wrong: raw LaTeX blocks (pieces the importer could not convert),
     figures whose picture is missing, paragraphs that look like headings or list items, equations written as
     plain text, citations with no reference, empty paragraphs.
   - read_source_file with the same .docx path gives the original as text: style names in [brackets]
     ([Heading 1], [Title], [Caption]...), list items with • or 1., tables as | cells |, equations as $LaTeX$,
     [picture: ...], footnotes [^n] listed under "notes", comments. Compare it with get_outline / read_blocks.
4. Fix what differs, block by block (read_blocks first, then replace_blocks with LaTeX body source):
   - a heading that came in as a bold paragraph -> \\section{...} / \\subsection{...} (match the Word level);
   - "1." / "•" paragraphs -> one enumerate / itemize block;
   - an equation that came in as text or a picture -> insert_equation (or replace_blocks with
     \\begin{equation}...\\end{equation}); use the $LaTeX$ read_source_file shows;
   - a table that came in as tab-separated lines -> table + tabular;
   - a caption paragraph ("Figure 1: ...") under a figure -> the figure's \\caption, with a \\label;
   - typed references "Smith et al. (2020)" or "[3]" and a typed reference list -> keep them as text unless the
     user wants real citations: then add_references (BibTeX you write from the list) and \\cite{key};
   - "see Figure 2" -> Figure~\\ref{fig:...} once the figure has a label;
   - a missing picture: the file is in the .docx (word/media/...); kTeX extracts them when importing. If one is
     still missing, ask the user for the picture file and use insert_figure.
   - a raw LaTeX block that is really ordinary text -> replace_blocks with the text.
   Keep the author's words. Do not rewrite or summarise the content unless asked.
5. Title, authors, abstract, keywords: set_metadata (title, author) and \\begin{abstract}...\\end{abstract};
   the document class and page setup too if the user asked for a journal layout.
6. compile_document, then render_page on the pages you changed and look at them. Fix errors from
   get_compile_log (often a stray &, %, # or _ in text: escape it as \\&, \\%, \\#, \\_).
7. save_document with a .ktex path the user chose (next to the Word file is a good default), and tell the user
   what you converted and what you could not.

Working in pieces: a long document has many blocks; read and fix it section by section (read_blocks start..end).`,
  },
  latex_package: {
    title: 'Open a LaTeX project (zip, tar.gz, tar.bz2, Overleaf download, arXiv source)',
    text: `open_document with the archive path (.zip, .tar, .tar.gz, .tgz, .tar.bz2): kTeX unpacks it into a folder
beside it (figures folders, .sty, .cls, .bib included) and imports the main .tex (the one with \\begin{document}).
A single .tex: open_document with its path; its pictures are looked up in \\graphicspath folders, without an
extension (plot -> plot.pdf / plot.png), and in figures/ images/ img/ beside it.
Then check_import: raw LaTeX blocks are commands kTeX keeps as source (they still compile). compile_document and
render_page to compare with the original PDF if the user has one.`,
  },
  references: {
    title: 'References and citations',
    text: `list_references gives the keys you may cite and the labels you may \\ref.
To add references: add_references with BibTeX text, or with the path of a .bib, .ris (EndNote, Zotero, Mendeley,
Web of Science, PubMed export), .enw or EndNote .xml file. They join the document's own reference list and print
at the end of the PDF (and of a Word export) in the document's reference style. Then cite with \\cite{key}
(\\citep / \\citet for author-year). Never invent a reference: write BibTeX only from what the user or the source
document gives you.`,
  },
  figures: {
    title: 'Pictures, drawings and equations',
    text: `insert_figure puts a picture file (png, jpg, pdf, svg) in the document with a caption and label.
insert_drawing draws an editable vector figure from shapes in mm (diagrams, flowcharts, apparatus).
insert_equation takes the math alone (no $). insert_chemistry takes mhchem syntax.
After compiling, render_page shows the page as the reader will see it.`,
  },
  export: {
    title: 'Export: PDF, Word, LaTeX',
    text: `export_pdf (compiles first), export_word (.docx with real Word equations, footnotes, signed comments,
numbered citations and the reference list), export_latex (.tex, or .zip with the figures, equations, styles and
references, ready for Overleaf or a journal). All need Full access and a path the user agreed to.`,
  },
}

export const GUIDE_TOPICS = Object.keys(GUIDES)
