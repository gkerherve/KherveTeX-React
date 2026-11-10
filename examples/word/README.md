# Word examples

Fifteen everyday Word documents, made the way Word's own templates are
(built-in Title, Subtitle, Heading, Caption and Quote styles, real bullet and
numbered lists, tables, images with captions, footnotes, headers and footers,
Word equations), and what KherveTeX makes of each:

| Folder   | What                                                         |
|----------|--------------------------------------------------------------|
| `docx/`  | the Word documents                                            |
| `ktex/`  | each opened in KherveTeX (File ▸ Open) and saved as .ktex     |
| `pdf/`   | the .ktex's LaTeX compiled with tectonic                      |
| `images/`| the charts the documents use                                  |

Letters (formal, cover), memo, meeting minutes, CV, business report (title
page, contents, header and footer, footnotes), academic article (abstract,
numbered equations, figure, table, references), lab report, thesis chapter
(equations numbered by chapter), project proposal, user manual, two-column
newsletter, invoice, maths homework and an essay.

To make them again:

    npm install --no-save docx@9
    node scripts/make_word_examples.cjs
    ../KherveTeX/.venv/bin/python scripts/import_word_examples.py

Not yet carried over by the import: lists inside lists (the sub-items join
the list above), Word's Quote and code styles (plain paragraphs), the
newsletter's two columns, and the contents field (LaTeX makes its own with
\tableofcontents).
