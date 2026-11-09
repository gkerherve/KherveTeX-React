// The document types whose visual page view does not yet follow the PDF
// page for page (the page check, scripts/page_check.mjs + src/dev/
// pageCheck.ts): a PDF page that runs onto a "(cont.)" sheet, a page the
// view ends early, pages that start with a float LaTeX moved, or media
// that are not flowing pages at all (slides, a standalone figure, a CV
// grid, a planner). They stay available; the gallery and the page view
// say "beta" so they are easy to spot and check.

// Classes whose own samples or examples differ: a document in one of
// them is beta whatever it was started from.
export const BETA_CLASSES: ReadonlySet<string> = new Set([
  'elsarticle', 'IEEEtran', 'revtex4-2', 'achemso', 'acmart', 'amsart', 'mnras', 'apa7',
  'memoir', 'scrbook', 'tufte-book', 'tufte-handout', 'elegantbook', 'mimosis', 'hepthesis',
  'beamer', 'europasscv', 'standalone',
  // Not flowing pages either: letters, a CV grid, posters.
  'letter', 'scrlttr2', 'moderncv', 'tikzposter', 'a0poster',
])

// Gallery examples (examples.GALLERY labels) that differ, including those
// on a class that is otherwise fine (article, report, book, scrartcl).
export const BETA_EXAMPLES: ReadonlySet<string> = new Set([
  'Three-column document', 'Literature review',
  'Elsevier journal preprint', 'IEEE conference paper', 'APS Physical Review (RevTeX)',
  'ACS journal article', 'ACM conference paper', 'AMS mathematics paper',
  'MNRAS astronomy paper', 'APA 7 psychology paper',
  'Thesis', 'Book chapter', 'Book (memoir)', 'Book (KOMA-Script)', 'Book (Tufte)',
  'Book (elegantbook)', 'Thesis (mimosis)', 'Thesis (hepthesis, particle physics)',
  'Lab report', 'Handout (Tufte)',
  'XPS surface-science paper', 'DFT computational study', 'Clinical trial (CONSORT)',
  'Europass CV', 'How-to guide',
  'Presentation (beamer)', 'Standalone figure (TikZ)',
  'Monthly planner', 'Meeting minutes',
])

// The right-hand note on a beta entry in the template menus.
export const BETA_DETAIL = 'page view beta'

export function isBetaExample(label: string): boolean {
  return BETA_EXAMPLES.has(label)
}

export function isBetaClass(cls: string): boolean {
  return BETA_CLASSES.has(cls)
}

// Whether the open document's page view is beta: its class, or the
// gallery example it was started from.
export function isBetaPage(documentclass: string, example: string | null): boolean {
  return isBetaClass(documentclass) || (example !== null && isBetaExample(example))
}
