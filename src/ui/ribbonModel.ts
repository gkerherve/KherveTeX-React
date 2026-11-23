// The ribbon as plain data, mirroring khervedoc/mainwindow.py: every
// QAction of _build_actions / _build_context_actions becomes a Command
// (ids are the Python attribute names without "act_"), and _build_ribbon
// becomes RIBBON_TABS. `&` marks the menu mnemonic, as in Qt.
import { BIB_STYLES } from '../core/autoBibliography.ts'
import { BETA_DETAIL, isBetaExample } from './pageBeta.ts'
import { COLOR_SETS, FONT_SETS, PAGE_BORDERS, SPACING_SETS, THEMES, WATERMARKS } from '../core/design.ts'

export interface MenuItem {
  text: string
  // A Qt "\t" column: shortcut or detail shown right-aligned.
  detail?: string
  icon?: string
  iconArg?: string
  command?: string
  checkable?: boolean
  checked?: boolean
  // Only Qt's informative placeholders, e.g. "(no recent files)".
  disabled?: boolean
  items?: MenuEntry[]
}

// A string is '-' (separator) or a command id.
export type MenuEntry = MenuItem | string

export interface Command {
  id: string
  text: string
  icon?: string
  iconArg?: string
  shortcut?: string
  // Key into TIPS / WIDGET_TIPS; defaults to "act_<id>".
  tip?: string
  // Plain tooltip when there is no long help (Qt's default: the text).
  tooltip?: string
  checkable?: boolean
  checked?: boolean
  // Exclusive QActionGroup.
  group?: string
  // Drop-down: 'split' is Qt's MenuButtonPopup (Paste ▾), 'instant' a
  // button that only opens its menu (Margins, Size, gallery pages).
  popup?: 'split' | 'instant'
  menu?: MenuEntry[]
  // The class picker opens a grid of page previews, not a list.
  menuKind?: 'classGrid' | 'tableGrid'
  // Big-button icon size when it is not 32 x 32 (page previews: 26 x 33).
  iconW?: number
  iconH?: number
  // A beta tag beside it: works, but not yet tested by users.
  beta?: boolean
}

export type Widget =
  | { widget: 'fontsize' }
  | { widget: 'fontfamily' }
  | { widget: 'styles' }
  | { widget: 'classes' }
  | { widget: 'stylesets' }
  | { widget: 'pens' }
  | { widget: 'numbered' }
  // Layout ▸ Indent / Spacing: a number box for the caret's paragraph.
  | { widget: 'parafield', field: 'left_cm' | 'right_cm' | 'before_pt' | 'after_pt' }

export type RibbonItem = string | Widget

export interface RibbonGroup {
  label: string
  large?: RibbonItem[]
  rows?: RibbonItem[][]
  // Labels beside the small icons.
  text?: boolean
}

export type ContextKind = 'table' | 'figure' | 'theorem' | 'equation'

export interface RibbonTab {
  name: string
  // Word's contextual tabs: shown only while the caret is in one.
  context?: ContextKind
  groups: RibbonGroup[]
}

export const TEMPLATE_CHOICES = [
  'article', 'report', 'book', 'letter', 'beamer', 'memoir',
  'scrartcl', 'scrreprt', 'scrbook', 'scrlttr2',
  'elsarticle', 'IEEEtran', 'revtex4-2', 'achemso', 'amsart',
  'llncs', 'acmart', 'sn-jnl', 'mnras',
  'tufte-handout', 'tufte-book', 'mimosis',
  'hepthesis', 'suftesi', 'toptesi', 'disser',
  'amsbook', 'elegantbook',
  'apa7',
  'moderncv', 'europasscv',
  'tikzposter', 'a0poster',
  'exam',
  'standalone',
]

export const THEOREM_KINDS: [string, string][] = [
  ['theorem', 'Theorem'], ['lemma', 'Lemma'], ['proposition', 'Proposition'],
  ['corollary', 'Corollary'], ['definition', 'Definition'],
  ['example', 'Example'], ['remark', 'Remark'], ['proof', 'Proof'],
]

// Word's margin presets, in cm: top, bottom, left, right.
const MARGIN_PRESETS: [string, number[]][] = [
  ['Normal', [2.54, 2.54, 2.54, 2.54]],
  ['Narrow', [1.27, 1.27, 1.27, 1.27]],
  ['Moderate', [2.54, 2.54, 1.91, 1.91]],
  ['Wide', [2.54, 2.54, 5.08, 5.08]],
]

const PAGE_SIZES: [string, number, number][] = [
  ['A4', 8.27, 11.69], ['Letter', 8.5, 11.0], ['Legal', 8.5, 14.0],
]

// examples.GALLERY by category: the class of the first example (the
// button's preview) and every example's label, in gallery order.
export const GALLERY: [string, string, string[]][] = [
  ['Start', 'article', ['Welcome tour', 'Blank document']],
  ['Articles', 'article', ['Single-column article', 'Two-column article',
    'Three-column document', 'Maths-heavy document', 'KOMA-Script article',
    'White paper', 'Literature review', 'Research proposal']],
  ['Journals', 'elsarticle', ['Elsevier journal preprint',
    'Elsevier two-column', 'IEEE conference paper',
    'APS Physical Review (RevTeX)', 'ACS journal article',
    'Springer LNCS conference paper', 'Springer Nature journal article',
    'ACM conference paper', 'AMS mathematics paper', 'MNRAS astronomy paper',
    'APA 7 psychology paper']],
  ['Theses & books', 'report', ['Thesis', 'Book chapter', 'Book (memoir)',
    'Report (KOMA-Script)', 'Book (KOMA-Script)', 'Book (Tufte)',
    'Monograph (AMS book)', 'Book (elegantbook)', 'Thesis (mimosis)',
    'Thesis (hepthesis, particle physics)', 'Thesis (suftesi, humanities)',
    'Thesis (toptesi, engineering)', 'Dissertation (disser)']],
  ['Teaching', 'article', ['Lab report', 'Exam (exam class)',
    'Homework / problem set', 'Lecture notes', 'Handout (Tufte)',
    'Quantum mechanics lecture']],
  ['Science', 'article', ['XPS surface-science paper',
    'XRD / nanomaterials paper', 'DFT computational study',
    'Battery / electrochemistry paper', 'Clinical trial (CONSORT)',
    'Ecology field study', 'Grant proposal (work packages)',
    'Response to reviewers', 'Lab SOP / risk assessment']],
  ['Letters & CV', 'letter', ['Letter', 'KOMA-Script letter', 'Academic CV',
    'Europass CV', 'Technical memo', 'How-to guide']],
  ['Slides & posters', 'beamer', ['Presentation (beamer)',
    'Poster (tikzposter)', 'Poster (a0poster)', 'Standalone figure (TikZ)']],
  ['Planning', 'article', ['Daily planner', 'Weekly planner',
    'Monthly planner', 'Calendar', 'Meeting minutes']],
]

const cmds: Command[] = [
  // File
  { id: 'new', text: '&New', icon: 'file_new', shortcut: 'Ctrl+N' },
  { id: 'new_window', text: 'New &window', shortcut: 'Ctrl+Shift+N' },
  { id: 'open', text: '&Open...', icon: 'file_open', shortcut: 'Ctrl+O' },
  { id: 'open_in_new_window', text: 'Open in new wind&ow...', shortcut: 'Ctrl+Shift+O' },
  { id: 'save', text: '&Save', icon: 'file_save', shortcut: 'Ctrl+S' },
  { id: 'save_as', text: 'Save &As...', shortcut: 'Ctrl+Shift+S' },
  { id: 'close_doc', text: '&Close document' },
  { id: 'new_project', text: 'New &project...' },
  { id: 'split_documents', text: '&Split into documents...', icon: 'split_documents',
    tip: 'Split into documents: one per chapter or per section, as a project' },
  { id: 'open_project', text: 'Open pro&ject...', icon: 'project_open' },
  { id: 'save_project', text: 'Save projec&t' },
  { id: 'close_project', text: 'Close project' },
  { id: 'import_tex', text: 'Import .&tex...' },
  { id: 'import_office', text: 'Import .&rtf / .odt (LibreOffice, OpenOffice)...',
    tooltip: 'A Rich Text file (WordPad, TextEdit) or an OpenDocument text (LibreOffice, OpenOffice)' },
  { id: 'import_gdoc', text: 'Import &Google Doc...',
    tooltip: 'Paste a Google Docs link: your browser downloads it as Word, then it is imported' },
  { id: 'import_package', text: 'Import LaTeX &package (.zip, .tar.gz, .tar.bz2)...',
    tooltip: 'A LaTeX project in an archive, with its figures folders, .sty, .cls and .bib files' },
  { id: 'import_docx', text: 'Import .&docx...' },
  { id: 'import_pdf', text: 'Import .&pdf...' },
  { id: 'import_md', text: 'Import .&md...' },
  { id: 'export_tex', text: 'Export .&tex...' },
  { id: 'export_docx', text: 'Export .&docx...', icon: 'export_docx_icon' },
  { id: 'export_latex_zip', text: 'Export &LaTeX package (.zip)...' },
  { id: 'export_pdf', text: 'Export .&pdf...', icon: 'export_pdf' },
  { id: 'print', text: '&Print…', icon: 'printer', shortcut: 'Ctrl+P' },
  { id: 'print_preview', text: 'Print pre&view…', icon: 'print_preview', shortcut: 'Ctrl+Shift+P',
    tooltip: 'See the pages exactly as they will print' },
  { id: 'show_in_explorer', text: 'Show in file e&xplorer' },
  { id: 'doc_props', text: 'Document &properties...' },
  { id: 'manage_styles', text: 'Manage &styles…' },
  { id: 'quit', text: '&Quit', shortcut: 'Ctrl+Q' },

  // Edit
  { id: 'undo', text: '&Undo', icon: 'undo', shortcut: 'Ctrl+Z' },
  { id: 'redo', text: '&Redo', icon: 'redo', shortcut: 'Ctrl+Y' },
  { id: 'cut', text: 'Cu&t', icon: 'cut', shortcut: 'Ctrl+X' },
  { id: 'copy', text: '&Copy', icon: 'copy', shortcut: 'Ctrl+C' },
  { id: 'paste', text: '&Paste', icon: 'paste', shortcut: 'Ctrl+V', popup: 'split',
    menu: [
      { text: 'Keep Source Formatting' }, { text: 'Keep Text Only' },
      { text: 'Picture' }, { text: 'LaTeX (as document content)' }, '-',
      { text: 'Paste Special…', icon: 'paste', command: 'paste_special', detail: 'Ctrl+Alt+V' },
    ] },
  { id: 'paste_special', text: 'Paste Special…', icon: 'paste', shortcut: 'Ctrl+Alt+V' },
  { id: 'select_all', text: 'Select &All', shortcut: 'Ctrl+A' },
  { id: 'clear_fmt', text: 'Clear &formatting', icon: 'clear_format' },
  { id: 'find', text: '&Find...', shortcut: 'Ctrl+F' },
  { id: 'replace', text: '&Replace...', shortcut: 'Ctrl+H' },

  // Alignment: exactly one is checked; the editor's body text is justified.
  { id: 'align_left', text: 'Align &left', icon: 'align_left', checkable: true, group: 'align' },
  { id: 'align_center', text: 'Align &center', icon: 'align_center', checkable: true, group: 'align' },
  { id: 'align_right', text: 'Align &right', icon: 'align_right', checkable: true, group: 'align' },
  { id: 'align_justify', text: '&Justify', icon: 'align_justify', checkable: true, group: 'align',
    checked: true },

  { id: 'cols_1', text: '&1 column', icon: 'one_column', checkable: true, group: 'cols', checked: true },
  { id: 'cols_2', text: '&2 columns', icon: 'two_columns', checkable: true, group: 'cols' },
  { id: 'cols_3', text: '&3 columns', icon: 'three_columns', checkable: true, group: 'cols' },

  // Format
  { id: 'bold', text: '&Bold', icon: 'bold', shortcut: 'Ctrl+B', checkable: true },
  { id: 'italic', text: '&Italic', icon: 'italic', shortcut: 'Ctrl+I', checkable: true },
  { id: 'underline', text: '&Underline', icon: 'underline', shortcut: 'Ctrl+U', checkable: true, popup: 'split',
    menu: (['single', 'double', 'wave', 'dotted', 'dashed'] as const).map((st): MenuItem => ({
      text: { single: 'Single', double: 'Double', wave: 'Wave', dotted: 'Dotted', dashed: 'Dashed' }[st],
      icon: 'underline_style', iconArg: st, command: `uline:${st}` })) },
  { id: 'grow_font', text: 'Grow Font', icon: 'grow_font', shortcut: 'Ctrl+Shift+>' },
  { id: 'shrink_font', text: 'Shrink Font', icon: 'shrink_font', shortcut: 'Ctrl+Shift+<' },
  { id: 'change_case', text: 'Change Case', icon: 'change_case', popup: 'instant',
    menu: [
      { text: 'Sentence case.', command: 'case:sentence' }, { text: 'lowercase', command: 'case:lower' },
      { text: 'UPPERCASE', command: 'case:upper' }, { text: 'Capitalize Each Word', command: 'case:capitalize' },
      { text: 'tOGGLE cASE', command: 'case:toggle' },
    ] },
  { id: 'font_color', text: 'Font Color', icon: 'font_color', iconArg: '#c00000', popup: 'split',
    menu: [
      { text: 'Automatic', command: 'fcolor:auto', icon: 'color_swatch', iconArg: '#000000' },
      ...([['000000', 'Black'], ['C00000', 'Dark red'], ['FF0000', 'Red'], ['FFC000', 'Orange'],
        ['FFFF00', 'Yellow'], ['92D050', 'Light green'], ['00B050', 'Green'], ['00B0F0', 'Light blue'], ['0070C0', 'Blue'],
        ['002060', 'Dark blue'], ['7030A0', 'Purple'], ['7F7F7F', 'Grey']] as const)
        .map(([c, name]): MenuItem => ({ text: name, icon: 'color_swatch', iconArg: `#${c}`, command: `fcolor:${c}` })),
      '-', { text: 'More Colors…', command: 'fcolor_more' },
    ] },
  { id: 'strike', text: '&Strikethrough', icon: 'strike', checkable: true },
  { id: 'code', text: '&Code (monospace)', icon: 'code', checkable: true },
  { id: 'smallcaps', text: 'Small caps', icon: 'smallcaps', checkable: true },
  { id: 'sub', text: 'Subs&cript', icon: 'subscript', checkable: true },
  { id: 'super', text: 'Su&perscript', icon: 'superscript', checkable: true },

  // Headings
  { id: 'h_body', text: 'Body text', checkable: true, group: 'heading', checked: true },
  ...[1, 2, 3, 4, 5].map((l): Command => ({
    id: `heading_${l}`, text: `Heading &${l}`, icon: 'heading', iconArg: String(l),
    checkable: true, group: 'heading',
  })),

  // Insert
  { id: 'math_inline', text: 'Inline &math', icon: 'math_inline', shortcut: 'Ctrl+M' },
  { id: 'math_block', text: 'Math &block', icon: 'math_block', shortcut: 'Ctrl+Shift+M' },
  { id: 'bullet', text: 'Bullet &list', icon: 'bullet_list', popup: 'split',
    menu: ([['disc', '•  Bullet'], ['circle', '◦  Circle'], ['square', '▪  Square'], ['dash', '–  Dash'],
      ['arrow', '▹  Arrow'], ['check', '✓  Check mark'], ['diamond', '⋄  Diamond']] as const)
      .map(([st, label]): MenuItem => ({ text: label, command: `bullet_style:${st}` })) },
  { id: 'numbered', text: '&Numbered list', icon: 'numbered_list', popup: 'split',
    menu: ([['arabic', '1.  2.  3.'], ['paren', '1)  2)  3)'], ['alpha', 'a.  b.  c.'], ['alphaparen', 'a)  b)  c)'],
      ['Alpha', 'A.  B.  C.'], ['roman', 'i.  ii.  iii.'], ['Roman', 'I.  II.  III.']] as const)
      .map(([st, label]): MenuItem => ({ text: label, command: `num_style:${st}` })) },
  { id: 'multilevel', text: 'Multilevel list', icon: 'multilevel_list', popup: 'split',
    menu: [
      { text: '1.  1.1.  1.1.1.', command: 'multilevel:legal' },
      { text: '1.  (a)  i.', command: 'multilevel:default' },
      { text: '•  –  ∗', command: 'multilevel:bullets' },
      '-', { text: 'Increase level (Increase Indent)', command: 'indent_inc' },
      { text: 'Decrease level (Decrease Indent)', command: 'indent_dec' },
    ] },
  { id: 'indent_dec', text: 'Decrease Indent', icon: 'indent_dec' },
  { id: 'indent_inc', text: 'Increase Indent', icon: 'indent_inc' },
  { id: 'sort_paras', text: 'Sort', icon: 'sort_icon', iconArg: '', popup: 'split',
    menu: [{ text: 'Sort A → Z', command: 'sort_paras' }, { text: 'Sort Z → A', command: 'sort_paras:desc' }] },
  { id: 'line_spacing', text: 'Line and Paragraph Spacing', icon: 'line_spacing', popup: 'instant',
    menu: ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'].map((v): MenuItem => ({ text: v, command: `spacing:${Number(v)}` })) },
  { id: 'para_shading', text: 'Shading', icon: 'shading_icon', iconArg: '#ffeb3b', popup: 'split',
    menu: [
      { text: 'No Color', command: 'pshade:none' },
      ...([['#ffeb3b', 'Yellow'], ['#fde2e1', 'Light red'], ['#dff0d8', 'Light green'],
        ['#dce8f7', 'Light blue'], ['#eeeeee', 'Grey'], ['#fff2cc', 'Cream']] as const)
        .map(([c, name]): MenuItem => ({ text: name, icon: 'color_swatch', iconArg: c, command: `pshade:${c}` })),
      '-', { text: 'More Colors…', command: 'pshade_more' },
    ] },
  { id: 'para_borders', text: 'Borders', icon: 'para_borders', popup: 'split',
    menu: [
      { text: 'Bottom Border', icon: 'para_borders', iconArg: 'bottom', command: 'border:bottom' },
      { text: 'Top Border', icon: 'para_borders', iconArg: 'top', command: 'border:top' },
      { text: 'Top and Bottom Borders', icon: 'para_borders', iconArg: 'topbottom', command: 'border:topbottom' },
      { text: 'Outside Borders', icon: 'para_borders', iconArg: 'box', command: 'border:box' },
      { text: 'No Border', icon: 'para_borders', iconArg: 'none', command: 'border:none' },
    ] },
  { id: 'link', text: '&Hyperlink...', icon: 'link', shortcut: 'Ctrl+K' },
  { id: 'footnote', text: '&Footnote...', icon: 'footnote' },
  { id: 'citation', text: 'Insert &citation…', icon: 'citation',
    tooltip: 'Insert citation: cite a reference at the cursor, e.g. [1] or (Smith, 2020)' },
  { id: 'manage_references', text: 'Reference &library…', icon: 'manage_references',
    tooltip: 'Reference library: add, edit, import and delete the references this document can cite (its bibliography)' },
  { id: 'refs_zotero', text: '&Zotero…', icon: 'refs_zotero',
    tooltip: 'Add references from Zotero: pick them in Zotero (with the Better BibTeX add-on), or take the library' },
  { id: 'refs_endnote', text: '&EndNote…', icon: 'refs_endnote', beta: true,
    tooltip: 'Add references from an EndNote export: EndNote XML (.xml), RIS (.ris) or EndNote tagged (.enw). BETA: not yet tested with real EndNote exports - please send feedback (Send feedback, top right) if something is missing or wrong.' },
  { id: 'refs_mendeley', text: '&Mendeley…', icon: 'refs_mendeley', beta: true,
    tooltip: 'Add references exported from Mendeley: BibTeX (.bib), RIS (.ris) or EndNote XML (.xml). BETA: not yet tested with real Mendeley exports - please send feedback (Send feedback, top right) if something is missing or wrong.' },
  { id: 'refs_kherveref', text: '&KherveRef…', icon: 'refs_kherveref',
    tooltip: 'Add references from a KherveRef (kRef) library: pick them in the library, they join this document\'s list' },
  { id: 'refs_import', text: 'Import &file…', icon: 'refs_import',
    tooltip: 'Add references from a file: BibTeX (.bib), RIS (.ris), EndNote (.enw, .xml), from any reference manager' },
  // The bibliography style: how citations and the reference list print.
  { id: 'reference_style', text: 'Style', icon: 'reference_style', popup: 'instant',
    tooltip: 'How the citations and the reference list print: author–year or numbered',
    menu: BIB_STYLES.map(([code, label]): MenuItem => ({
      text: label, command: `bib_style_${code}`, checkable: true, checked: code === 'plainnat',
    })) },
  { id: 'captions', text: 'Captions && &labels…', icon: 'captions',
    tooltip: 'Every figure, table, equation and heading: change their captions and labels, or go to one' },
  { id: 'insert_reference', text: 'Insert &reference…', icon: 'citation',
    tooltip: 'Cite a reference of the document\'s reference list, or add a new one and cite it' },
  { id: 'bibliography', text: '&Bibliography…', icon: 'bibliography',
    tooltip: 'Add and edit the \\bibitem references of the document\'s reference list' },
  { id: 'check_citations', text: 'Check c&itations',
    tooltip: 'List cited keys that no KherveRef library or bibliography file defines' },
  { id: 'crossref', text: 'Cross-&reference...', icon: 'cross_ref' },
  { id: 'figure', text: 'F&igure...', icon: 'figure' },
  { id: 'table', text: '&Table...', icon: 'table' },
  { id: 'table_menu', text: 'Table', icon: 'table', popup: 'instant', menuKind: 'tableGrid' },
  { id: 'drawing', text: '&Drawing…', icon: 'drawing' },
  { id: 'shapes', text: 'Shapes', icon: 'shapes', popup: 'instant',
    menu: [
      { text: 'Lines', items: [{ text: 'Line', command: 'shape:line' }, { text: 'Arrow', command: 'shape:arrow' }] },
      { text: 'Rectangles', items: [{ text: 'Rectangle', command: 'shape:rect' }, { text: 'Rounded rectangle', command: 'shape:roundrect' }] },
      { text: 'Basic Shapes', items: ([['ellipse', 'Oval'], ['circle', 'Circle'], ['triangle', 'Triangle'], ['right_triangle', 'Right triangle'],
        ['diamond', 'Diamond'], ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'], ['pentagon', 'Pentagon'],
        ['hexagon', 'Hexagon'], ['octagon', 'Octagon'], ['halfcircle', 'Half circle'], ['plus', 'Cross'], ['house', 'House'],
        ['lightning', 'Lightning bolt'], ['text', 'Text box']] as const).map(([k, t]): MenuItem => ({ text: t, command: `shape:${k}` })) },
      { text: 'Block Arrows', items: [{ text: 'Right arrow', command: 'shape:block_arrow' }, { text: 'Chevron', command: 'shape:chevron' }] },
      { text: 'Stars', items: [{ text: '5-point star', command: 'shape:star' }, { text: '6-point star', command: 'shape:star6' }] },
    ] },
  { id: 'smartart', text: 'SmartArt', icon: 'smartart' },
  // Draw tab (Word's): ink on the page.
  { id: 'draw_tool', text: 'Draw', icon: 'draw_tool', checkable: true,
    tooltip: 'Draw: write and draw on the page with the chosen pen; click again (or Esc) to go back to typing. The ink prints in the PDF at its word. BETA: in the PDF a stroke may often miss the word it marks (LaTeX lays out the page differently), so check its position after compiling.' },
  { id: 'eraser_tool', text: 'Eraser', icon: 'eraser_tool', checkable: true, popup: 'split',
    tooltip: 'Eraser: drag over ink to remove the strokes it touches',
    menu: [
      { text: 'Stroke Eraser', icon: 'eraser_tool', command: 'eraser:stroke' },
      '-',
      { text: 'Erase All Ink', command: 'eraser:all' },
    ] },
  { id: 'add_pen', text: 'Add', icon: 'add_pen', popup: 'split',
    tooltip: 'Add a pen to the gallery (pick its colour)',
    menu: [
      { text: 'Add Pen', icon: 'ink_pen', iconArg: 'pen|#0063B1', command: 'add_pen:pen' },
      { text: 'Add Pencil', icon: 'ink_pen', iconArg: 'pencil|#7A7A7A', command: 'add_pen:pencil' },
      { text: 'Add Highlighter', icon: 'ink_pen', iconArg: 'highlighter|#FFFF00', command: 'add_pen:highlighter' },
      '-',
      { text: 'Reset Pens', command: 'pens:reset' },
    ] },
  // Insert ▸ Contents, as Word's References ▸ Table of Contents.
  { id: 'toc', text: 'Table of Contents', icon: 'toc', popup: 'instant',
    tooltip: 'Table of Contents: an automatic table built from the headings (Heading 1–3), kept up to date at each compile',
    menu: [
      { text: 'Automatic Table (3 levels)', icon: 'toc', command: 'toc:3' },
      { text: 'Automatic Table (2 levels)', icon: 'toc', command: 'toc:2' },
      { text: 'Automatic Table (1 level)', icon: 'toc', command: 'toc:1' },
      '-',
      { text: 'Update Table', icon: 'update_toc', command: 'update_toc' },
      { text: 'Remove Table of Contents', icon: 'remove_toc', command: 'remove_toc' },
    ] },
  { id: 'table_of_figures', text: 'Table of Figures', icon: 'table_of_figures', popup: 'instant',
    tooltip: 'Table of Figures: a list of the captioned figures or tables, with their pages',
    menu: [
      { text: 'List of Figures', icon: 'table_of_figures', command: 'tof:figures' },
      { text: 'List of Tables', icon: 'table', command: 'tof:tables' },
      '-',
      { text: 'Remove List of Figures', icon: 'remove_toc', command: 'remove_tof:figures' },
      { text: 'Remove List of Tables', icon: 'remove_toc', command: 'remove_tof:tables' },
    ] },
  { id: 'update_toc', text: 'Update Table', icon: 'update_toc',
    tooltip: 'Update Table: compile, so the tables of contents, figures and tables take the new headings and pages' },
  // Design tab (design.ts).
  { id: 'design_themes', text: 'Themes', icon: 'themes', popup: 'instant',
    tooltip: 'Themes: colours, fonts and a heading style together',
    menu: THEMES.map(([k, name]): MenuItem => ({ text: name, command: `theme:${k}`, checkable: true })) },
  { id: 'design_colors', text: 'Colours', icon: 'design_colors', popup: 'instant',
    tooltip: 'Colours: the accent of the headings and shaded bands',
    menu: [
      ...COLOR_SETS.map(([k, name, a, b]): MenuItem => ({ text: name, icon: 'design_colors', iconArg: `${a}|${b}`, command: `colors:${k}`, checkable: true })),
      '-', { text: 'Black (no colour)', command: 'colors:none' },
    ] },
  { id: 'design_fonts', text: 'Fonts', icon: 'design_fonts', popup: 'instant',
    tooltip: 'Fonts: the body and heading fonts',
    menu: FONT_SETS.map(([k, name]): MenuItem => ({ text: name, command: `fonts:${k}`, checkable: true })) },
  { id: 'para_spacing', text: 'Paragraph Spacing', icon: 'para_spacing', popup: 'instant',
    tooltip: 'Paragraph Spacing: the space between paragraphs and the line spacing of the whole document',
    menu: SPACING_SETS.map(([k, name, , sp, ls]): MenuItem => ({ text: name, detail: k === 'none' ? 'indent' : `${sp} pt, ${ls}`, command: `pspacing:${k}`, checkable: true })) },
  { id: 'set_default', text: 'Set as Default', icon: 'set_default',
    tooltip: 'Set as Default: new documents start with this design' },
  { id: 'watermark', text: 'Watermark', icon: 'watermark', popup: 'instant',
    menu: [
      ...WATERMARKS.map((w): MenuItem => ({ text: w, command: `watermark:${w}`, checkable: true })),
      '-', { text: 'Custom Watermark…', command: 'watermark_custom' },
      { text: 'Remove Watermark', icon: 'remove_toc', command: 'watermark_none' },
    ] },
  { id: 'page_color', text: 'Page Colour', icon: 'page_color', popup: 'instant',
    menu: [
      { text: 'No Colour', command: 'pagecolor:none' },
      ...([['#FFF2CC', 'Cream'], ['#FBE5D6', 'Peach'], ['#E2EFDA', 'Light green'], ['#DDEBF7', 'Light blue'],
        ['#EDE7F6', 'Lavender'], ['#F2F2F2', 'Light grey'], ['#FFFFE0', 'Light yellow']] as const)
        .map(([c, name]): MenuItem => ({ text: name, icon: 'color_swatch', iconArg: c, command: `pagecolor:${c}` })),
      '-', { text: 'More Colours…', command: 'pagecolor_more' },
    ] },
  { id: 'page_borders', text: 'Page Borders', icon: 'page_borders', popup: 'instant',
    menu: [
      { text: 'None', command: 'pageborder:none', checkable: true },
      ...PAGE_BORDERS.map(([k, name]): MenuItem => ({ text: name, command: `pageborder:${k}`, checkable: true })),
    ] },
  { id: 'chart', text: 'Chart', icon: 'chart' },
  { id: 'screenshot', text: 'Screenshot', icon: 'screenshot' },
  { id: 'flowchart', text: 'Fl&owchart builder…', icon: 'flowchart_builder', shortcut: 'Ctrl+Shift+F' },
  { id: 'raw', text: 'Raw LaTeX...' },
  { id: 'compile_start', text: 'Compile start marker' },
  { id: 'compile_end', text: 'Compile end marker' },
  { id: 'not_compile_start', text: 'Not-compile start marker' },
  { id: 'not_compile_end', text: 'Not-compile end marker' },
  { id: 'code_block', text: '&Code block...' },
  { id: 'symbol', text: '&Symbol...', icon: 'symbol', shortcut: 'Ctrl+Shift+G' },
  { id: 'equation_builder', text: '&Equation builder...', icon: 'equation_builder', shortcut: 'Ctrl+Shift+E' },
  { id: 'chemistry', text: 'C&hemical reaction...', icon: 'chemistry', shortcut: 'Ctrl+Shift+R' },
  { id: 'chemfig', text: 'Chemical &structure...', icon: 'chemfig_structure', shortcut: 'Ctrl+Shift+T' },
  { id: 'abstract', text: '&Abstract paragraph' },
  { id: 'keywords', text: 'Key&words paragraph' },
  { id: 'pagebreak', text: 'Page break', icon: 'page_break' },
  { id: 'hrule', text: 'Horizontal rule', icon: 'horizontal_rule' },
  { id: 'show_date', text: 'Date', icon: 'title_date', checkable: true, checked: true },
  { id: 'multicol', text: '&Multi-column region (2)...' },
  { id: 'theorem', text: 'Theorem', icon: 'theorem', popup: 'split',
    menu: THEOREM_KINDS.map(([k, name]) => ({ text: name, command: `thm_insert_${k}` })) },

  // View
  { id: 'view_formatted', text: 'Show &Visual tab', shortcut: 'Ctrl+1' },
  { id: 'view_latex', text: 'Show &Code tab', shortcut: 'Ctrl+2' },
  { id: 'view_pdf', text: 'Show &PDF', shortcut: 'Ctrl+3' },
  { id: 'view_console', text: 'Show Co&nsole', shortcut: 'Ctrl+6' },
  { id: 'visual_only', text: '&Visual only (like Word)', checkable: true, group: 'layout',
    tooltip: 'Hide the PDF and stop compiling while you write' },
  { id: 'side_by_side', text: 'PDF &side panel', shortcut: 'Ctrl+4', checkable: true,
    group: 'layout', checked: true },
  { id: 'pdf_window', text: 'PDF in its own &window', checkable: true, group: 'layout',
    tooltip: 'Show the PDF in a separate window, e.g. on a second screen' },
  { id: 'documents_dock', text: 'Documents', icon: 'documents_panel', shortcut: 'Ctrl+5', checkable: true },
  { id: 'repaginate', text: 'Fix page layout', icon: 'repaginate',
    tooltip: 'Lay the pages and columns out again from scratch: use it if text looks cut, overlapping or on the wrong page' },
  { id: 'fit_page_width', text: '&Fit page width', icon: 'fit_width', shortcut: 'Ctrl+0',
    checkable: true, checked: true },
  { id: 'show_latex_source', text: 'Show LaTeX &source', icon: 'code', checkable: true,
    tooltip: 'Show raw LaTeX in the text as its source instead of as the PDF shows it' },
  { id: 'theme_light', text: 'Light', checkable: true, group: 'theme', checked: true },
  { id: 'theme_dark', text: 'Dark', checkable: true, group: 'theme' },
  { id: 'spell_check', text: 'Check &spelling', icon: 'spell_check', checkable: true, checked: true },
  { id: 'spelling_list', text: 'Spelling &list', icon: 'spelling_list', shortcut: 'F7', checkable: true },

  // Git
  { id: 'commit_now', text: '&Save snapshot and upload', icon: 'commit',
    tooltip: 'Save your work, create a version snapshot, and upload it to the cloud' },
  { id: 'pull', text: '&Download latest from cloud' },
  { id: 'overleaf_send', text: '&Send to Overleaf', icon: 'overleaf_send',
    tooltip: 'Send this document to its Overleaf project in one click (the project link is asked the first time only)' },
  { id: 'overleaf_get', text: '&Get changes from Overleaf', icon: 'overleaf_get',
    tooltip: "Open the Overleaf project's current version, with your collaborators' changes" },
  { id: 'overleaf_zip', text: '&Download for Overleaf (.zip)…', icon: 'overleaf_zip',
    tooltip: 'A zip to upload as a new Overleaf project (works on a free plan)' },
  { id: 'overleaf_open', text: '&Open in Overleaf',
    tooltip: 'Open the linked Overleaf project in your browser' },
  { id: 'overleaf_link', text: '&Link to Overleaf project…',
    tooltip: 'Choose which Overleaf project this document goes to, or change the Git token' },
  { id: 'save_as_template', text: 'Save as &Template…',
    tooltip: 'Keep this document as a starting point for new ones' },
  { id: 'tour', text: 'Take the guided &tour',
    tooltip: 'A multi-page document that shows what kTeX does' },
  { id: 'github', text: '&GitHub…', icon: 'github',
    tooltip: 'Sign in to GitHub, publish this document there or connect it to one of your repositories, and open a document from GitHub' },
  { id: 'configure_remotes', text: 'Other cloud connections (GitLab…)…' },
  { id: 'history', text: 'View &version history…', icon: 'history' },
  { id: 'branches', text: '&Branches…', icon: 'branch' },

  // Review
  { id: 'highlight', text: '&Highlight', icon: 'highlight', shortcut: 'Ctrl+Shift+H', popup: 'split',
    menu: [
      ...([['yellow', '#FFFF00'], ['green', '#90EE90'], ['blue', '#ADD8E6'], ['pink', '#FFB6C1'], ['orange', '#FFD700']] as const)
        .map(([n, c]): MenuItem => ({ text: n[0].toUpperCase() + n.slice(1), icon: 'color_swatch', iconArg: c, command: `hl:${n}` })),
      '-', { text: 'No Color', command: 'remove_highlight' },
    ] },
  { id: 'remove_highlight', text: 'Remove highlight' },
  { id: 'comment', text: 'New &comment', icon: 'comment', shortcut: 'Ctrl+Alt+M' },
  { id: 'your_name', text: 'Your &name…', icon: 'your_name',
    tooltip: 'Your name, shown on your comments and reviews (in the margin, the PDF and Word)' },
  { id: 'settings', text: '&Preferences…', icon: 'settings',
    tooltip: 'Settings: your name (on comments and reviews) and how kTeX starts' },
  { id: 'accept_comment', text: '&Accept', icon: 'accept_change', popup: 'split',
    menu: [{ text: 'Accept This Change', command: 'accept_comment' }, { text: 'Accept All Changes', command: 'accept_all' },
      '-', { text: 'Next change', command: 'next_change' }] },
  { id: 'reject_comment', text: '&Reject', icon: 'reject_change', popup: 'split',
    menu: [{ text: 'Reject This Change', command: 'reject_comment' }, { text: 'Reject All Changes', command: 'reject_all' },
      '-', { text: 'Next change', command: 'next_change' }] },
  { id: 'prev_change', text: 'Previous', icon: 'prev_comment' },
  { id: 'next_change', text: 'Next', icon: 'next_comment' },
  // Review ▸ Tracking, as Word's.
  { id: 'track_changes', text: 'Track Changes', icon: 'track_changes', checkable: true,
    tooltip: 'Track Changes: what you type is marked as inserted, what you delete stays struck through, with your name; Accept or Reject settles them. In the PDF: the changes package.' },
  { id: 'markup_view', text: 'All Markup', icon: 'markup_view', popup: 'instant',
    menu: [
      { text: 'Simple Markup', command: 'markup:simple', checkable: true },
      { text: 'All Markup', command: 'markup:all', checkable: true, checked: true },
      { text: 'No Markup', command: 'markup:none', checkable: true },
      { text: 'Original', command: 'markup:original', checkable: true },
    ] },
  { id: 'markup_options', text: 'Markup Options', icon: 'markup_options', popup: 'instant',
    menu: [
      { text: 'Comments', command: 'markup_comments', checkable: true, checked: true },
      { text: 'Insertions and Deletions', command: 'markup_insdel', checkable: true, checked: true },
    ] },
  ...(['all', 'simple', 'none', 'original'] as const).map((k): Command => ({ id: `markup:${k}`, text: k, checkable: true, group: 'markup', checked: k === 'all' })),
  { id: 'markup_comments', text: 'Comments', checkable: true, checked: true },
  { id: 'markup_insdel', text: 'Insertions and Deletions', checkable: true, checked: true },
  { id: 'prev_comment', text: '← &Previous comment', icon: 'prev_comment', shortcut: 'Ctrl+Shift+[' },
  { id: 'next_comment', text: '→ &Next comment', icon: 'next_comment', shortcut: 'Ctrl+Shift+]' },

  // Compile
  { id: 'compile_now', text: '&Compile PDF', icon: 'compile_pdf', shortcut: 'Ctrl+Shift+C' },
  { id: 'show_marks', text: 'Show formatting &marks', icon: 'formatting_marks', shortcut: 'Ctrl+*',
    checkable: true, tooltip: 'Show/Hide ¶: paragraph marks, page breaks and other hidden formatting symbols' },
  { id: 'auto_compile', text: 'Auto-compile', icon: 'auto_compile_on', checkable: true, checked: true },
  { id: 'skip_images', text: 'Skip images', icon: 'compile_no_images', checkable: true },
  { id: 'compile_range', text: 'Compile range', icon: 'compile_range', checkable: true, checked: true },
  { id: 'compiler_latex', text: '&LaTeX (tectonic)', checkable: true, group: 'compiler', checked: true },
  { id: 'compiler_typst', text: '&Typst', checkable: true, group: 'compiler' },
  { id: 'compiler_status', text: 'Compiler &status…' },
  { id: 'download_bundle', text: '&Download offline bundle…' },
  { id: 'open_cache', text: '&Open the package cache folder' },
  { id: 'connect_claude', text: 'Connect to &Claude or ChatGPT…' },

  // Help
  { id: 'help_guide', text: '&User guide', icon: 'help_icon', shortcut: 'F1' },
  { id: 'shortcuts', text: '&Keyboard shortcuts', icon: 'keyboard_icon' },
  { id: 'send_feedback', text: 'Send &feedback (beta)…' },
  { id: 'buy_coffee', text: 'Buy me a &coffee…', icon: 'coffee',
    tooltip: 'Support kTeX: a QR code and a link to buymeacoffee.com' },
  { id: 'about', text: '&About kTeX', icon: 'about_icon' },
  { id: 'welcome', text: '&Welcome page…', icon: 'welcome_icon' },
  { id: 'check_updates', text: 'Check for Updates', icon: 'update_icon' },
  { id: 'check_updates_menu', text: 'Check for &updates…' },
  { id: 'update_automatically', text: 'Update &automatically', checkable: true, checked: true },

  // Layout > Page Setup and Document type
  { id: 'margins', text: 'Margins', icon: 'page_margins', tip: 'margins', popup: 'instant',
    menu: [
      ...MARGIN_PRESETS.map(([name, [t, b, l, r]]): MenuItem => ({
        text: name, command: `margin_${name}`, detail: `Top ${t} cm  Bottom ${b} cm  Left ${l} cm  Right ${r} cm`,
        checkable: true, checked: name === 'Normal',
      })),
      '-', { text: 'Custom Margins…', command: 'doc_props' },
    ] },
  { id: 'size', text: 'Size', icon: 'page_size', tip: 'pagesize', popup: 'instant',
    menu: [...PAGE_SIZES.map(([code, w, h]): MenuItem => ({
      text: code, command: `pagesize_${code}`, detail: `${(w * 2.54).toFixed(1)} cm × ${(h * 2.54).toFixed(1)} cm`,
      icon: 'paper_thumb', iconArg: `${w}x${h}`, checkable: true, checked: code === 'A4',
    }))] },
  { id: 'orientation', text: 'Orientation', icon: 'orientation', popup: 'instant',
    menu: [
      { text: 'Portrait', command: 'orient_portrait', icon: 'paper_thumb', iconArg: '8.27x11.69', checkable: true, checked: true },
      { text: 'Landscape', command: 'orient_landscape', icon: 'paper_thumb', iconArg: '11.69x8.27', checkable: true },
    ] },
  { id: 'columns', text: 'Columns', icon: 'two_columns', popup: 'instant',
    menu: [
      { text: 'One', command: 'cols_1', icon: 'one_column', checkable: true, checked: true },
      { text: 'Two', command: 'cols_2', icon: 'two_columns', checkable: true },
      { text: 'Three', command: 'cols_3', icon: 'three_columns', checkable: true },
    ] },
  // Layout ▸ Breaks, Line Numbers, Hyphenation (Word's Page Setup group).
  { id: 'breaks', text: 'Breaks', icon: 'breaks', tip: 'breaks', popup: 'instant',
    menu: [
      { text: 'Page', command: 'brk_page', icon: 'page_break', detail: 'The next text starts on a new page' },
      { text: 'Column', command: 'brk_column', icon: 'column_break', detail: 'The next text starts in the next column' },
      '-',
      { text: 'Next Page', command: 'brk_next', icon: 'section_next', detail: 'Pending figures and tables, then a new page' },
      { text: 'Odd Page', command: 'brk_odd', icon: 'section_odd', detail: 'Starts on the next odd-numbered page' },
    ] },
  { id: 'line_numbers', text: 'Line Numbers', icon: 'line_numbers', tip: 'line_numbers', popup: 'instant',
    menu: [
      { text: 'None', command: 'ln_none', checkable: true, checked: true },
      { text: 'Continuous', command: 'ln_continuous', checkable: true },
      { text: 'Restart Each Page', command: 'ln_page', checkable: true },
      { text: 'Restart Each Section', command: 'ln_section', checkable: true },
    ] },
  { id: 'hyphenation', text: 'Hyphenation', icon: 'hyphenation', tip: 'hyphenation', popup: 'instant',
    menu: [
      { text: 'Automatic', command: 'hyph_auto', checkable: true, checked: true },
      { text: 'None', command: 'hyph_none', checkable: true },
    ] },
  { id: 'brk_page', text: 'Page' }, { id: 'brk_column', text: 'Column' },
  { id: 'brk_next', text: 'Next Page' }, { id: 'brk_odd', text: 'Odd Page' },
  ...(['none', 'continuous', 'page', 'section'] as const).map((k): Command => ({ id: `ln_${k}`,
    text: k, checkable: true, group: 'line_numbers', checked: k === 'none' })),
  { id: 'hyph_auto', text: 'Automatic', checkable: true, group: 'hyphenation', checked: true },
  { id: 'hyph_none', text: 'None', checkable: true, group: 'hyphenation' },
  // The Margins and Size menu entries, checked against the document.
  ...MARGIN_PRESETS.map(([name]): Command => ({ id: `margin_${name}`, text: name, checkable: true,
    group: 'margins', checked: name === 'Normal' })),
  ...PAGE_SIZES.map(([code]): Command => ({ id: `pagesize_${code}`, text: code, checkable: true,
    group: 'pagesize', checked: code === 'A4' })),
  { id: 'orient_portrait', text: 'Portrait', checkable: true, group: 'orient', checked: true },
  { id: 'orient_landscape', text: 'Landscape', checkable: true, group: 'orient' },
  { id: 'doc_class', text: 'article', icon: 'class_thumbnail', iconArg: 'article', tip: 'class',
    popup: 'instant', menuKind: 'classGrid', iconW: 26, iconH: 33 },

  // Table Design / Table Layout
  { id: 'tbl_row_above', text: 'Insert Above', icon: 'table_row_above' },
  { id: 'tbl_row_below', text: 'Insert Below', icon: 'table_row_below' },
  { id: 'tbl_col_left', text: 'Insert Left', icon: 'table_col_left' },
  { id: 'tbl_col_right', text: 'Insert Right', icon: 'table_col_right' },
  { id: 'tbl_del_row', text: 'Delete Row', icon: 'table_delete_row' },
  { id: 'tbl_del_col', text: 'Delete Column', icon: 'table_delete_col' },
  { id: 'tbl_delete', text: 'Delete Table', icon: 'table_delete' },
  { id: 'tbl_plain', text: 'Lines', icon: 'table_style_icon', iconArg: '', checkable: true,
    group: 'tblstyle', checked: true },
  { id: 'tbl_grid', text: 'Grid', icon: 'table_style_icon', iconArg: 'grid', checkable: true, group: 'tblstyle' },
  { id: 'tbl_booktabs', text: 'Journal', icon: 'table_style_icon', iconArg: 'booktabs', checkable: true,
    group: 'tblstyle' },
  { id: 'tbl_striped', text: 'Striped', icon: 'table_style_icon', iconArg: 'striped', checkable: true,
    group: 'tblstyle' },
  { id: 'tbl_nolines', text: 'No Lines', icon: 'table_style_icon', iconArg: 'plain', checkable: true,
    group: 'tblstyle' },
  { id: 'tbl_header', text: 'Header Row', icon: 'header_row', checkable: true, checked: true },
  { id: 'tbl_repeat', text: 'Repeat Header Rows', icon: 'repeat_header', checkable: true },
  { id: 'tbl_merge', text: 'Merge Cells', icon: 'table_merge' },
  { id: 'tbl_split', text: 'Split Cells', icon: 'table_split' },
  { id: 'tbl_sort_up', text: 'Sort A→Z', icon: 'sort_icon', iconArg: '' },
  { id: 'tbl_sort_down', text: 'Sort Z→A', icon: 'sort_icon', iconArg: 'desc' },
  { id: 'tbl_shading', text: 'Shading', icon: 'shading_icon', iconArg: '#ffeb3b', popup: 'split',
    menu: [
      { text: 'No Color', command: 'shade:none' },
      ...([['#ffeb3b', 'Yellow'], ['#fde2e1', 'Light red'], ['#dff0d8', 'Light green'],
        ['#dce8f7', 'Light blue'], ['#eeeeee', 'Grey'], ['#fff2cc', 'Cream']] as const)
        .map(([c, name]): MenuItem => ({ text: name, icon: 'color_swatch', iconArg: c, command: `shade:${c}` })),
      '-', { text: 'More Colors…', command: 'shade_more' },
    ] },
  { id: 'tbl_align_l', text: 'Align Left', icon: 'align_left', checkable: true, group: 'tblalign',
    checked: true },
  { id: 'tbl_align_c', text: 'Center', icon: 'align_center', checkable: true, group: 'tblalign' },
  { id: 'tbl_align_r', text: 'Align Right', icon: 'align_right', checkable: true, group: 'tblalign' },

  // Picture
  { id: 'fig_left', text: 'Left', icon: 'align_left', checkable: true, group: 'figalign' },
  { id: 'fig_center', text: 'Center', icon: 'align_center', checkable: true, group: 'figalign',
    checked: true },
  { id: 'fig_right', text: 'Right', icon: 'align_right', checkable: true, group: 'figalign' },
  ...[0.25, 0.5, 0.75, 1].map((f): Command => ({
    id: `fig_w${f * 100}`, text: `${f * 100}% width`, icon: 'picture_width', iconArg: String(f),
  })),
  { id: 'caption', text: 'Insert Caption', icon: 'caption' },
  { id: 'fig_edit', text: 'Edit drawing', icon: 'picture_edit' },
  { id: 'fig_delete', text: 'Delete Picture', icon: 'picture_delete' },

  // Equation
  { id: 'eq_edit', text: 'Edit Equation', icon: 'equation_builder' },
  { id: 'eq_numbered', text: 'Numbered', icon: 'equation_numbered', checkable: true, checked: true },
  { id: 'eq_label', text: 'Label…', icon: 'cross_ref', tooltip: 'Name this equation so a cross-reference can point to it' },
  { id: 'eq_delete', text: 'Delete Equation', icon: 'equation_delete' },

  // Theorem
  ...THEOREM_KINDS.map(([k, name]): Command => ({
    id: `thm_kind_${k}`, text: name, icon: 'theorem', checkable: true, group: 'thmkind',
    checked: k === 'theorem', tooltip: name,
  })),
  ...THEOREM_KINDS.map(([k, name]): Command => ({ id: `thm_insert_${k}`, text: name })),
  { id: 'thm_title', text: 'Name…', icon: 'picture_edit' },

  // View tab: the Visual / Code / Console pages and where the PDF lives.
  { id: 'page_visual', text: 'Visual', icon: 'page_view', checkable: true, group: 'page', checked: true },
  { id: 'page_code', text: 'Code', icon: 'code', checkable: true, group: 'page' },
  { id: 'page_console', text: 'Console', icon: 'console_view', checkable: true, group: 'page' },
  { id: 'pdf_panel', text: 'PDF', icon: 'export_pdf', checkable: true, checked: true },
  { id: 'pdf_detach', text: 'Detach PDF', icon: 'pdf_detach', checkable: true },

  // Examples tab: one drop-down of page previews per gallery category.
  ...GALLERY.filter(([cat]) => cat !== 'Start').map(([cat, cls, items]): Command => ({
    id: `gallery_${slug(cat)}`, text: cat.replace('&', '&&'), icon: 'class_thumbnail', iconArg: cls,
    popup: 'instant', iconW: 26, iconH: 33, tooltip: `${cat}: ${items.length} examples`,
    menu: items.map((label): MenuItem => ({
      text: label, icon: 'class_thumbnail', iconArg: cls, command: `example:${label}`,
      ...(isBetaExample(label) ? { detail: BETA_DETAIL } : {}) })),
  })),
  { id: 'gallery_mine', text: 'My templates', icon: 'class_thumbnail', iconArg: 'article',
    popup: 'instant', iconW: 26, iconH: 33, tooltip: 'My templates',
    menu: [{ text: '(no saved templates)', disabled: true }] },
]

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export const COMMANDS: Record<string, Command> = Object.fromEntries(
  cmds.map(c => [c.id, c]))

// Menu text without the & mnemonic or a trailing ellipsis (ribbon._short).
export function shortText(text: string): string {
  return text.split('&&').map(part => part.replace(/&/g, '')).join('&')
    .replace(/[.…]+$/, '').trim()
}

// ribbon.big_label: always two lines, as Word's big buttons. A long label
// breaks at the space nearest its middle; a short one gets a blank line
// (where a drop-down's chevron sits) so every icon stays at one height.
export function bigLabel(text: string): [string, string] {
  if (text.length <= 9 || !text.includes(' ')) return [text, '']
  const mid = text.length / 2
  let at = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i
  }
  return [text.slice(0, at), text.slice(at + 1)]
}

const gallery = (cat: string) => `gallery_${slug(cat)}`

export const CORNER_LEFT: (string | null)[] = [
  'new', 'open', 'save', 'print', null, 'undo', 'redo',
]
export const CORNER_RIGHT: (string | null)[] = [
  'compile_now', 'auto_compile', null, 'help_guide', 'settings',
]
// Corner buttons that show their name, like Word's Share button.
export const CORNER_LABELLED = new Set(['compile_now'])

const thmKinds = THEOREM_KINDS.map(([k]) => `thm_kind_${k}`)

export const RIBBON_TABS: RibbonTab[] = [
  { name: 'Home', groups: [
    { label: 'Clipboard', large: ['paste'], rows: [['cut'], ['copy'], ['paste_special']], text: true },
    { label: 'Font', rows: [
      [{ widget: 'fontfamily' }, { widget: 'fontsize' }, 'grow_font', 'shrink_font', 'change_case', 'clear_fmt'],
      ['bold', 'italic', 'underline', 'strike', 'sub', 'super', 'smallcaps', 'code', 'highlight', 'font_color']] },
    { label: 'Paragraph', rows: [
      ['bullet', 'numbered', 'multilevel', 'indent_dec', 'indent_inc', 'sort_paras', 'show_marks'],
      ['align_left', 'align_center', 'align_right', 'align_justify', 'line_spacing', 'para_shading', 'para_borders']] },
    { label: 'Styles', large: [{ widget: 'styles' }, { widget: 'numbered' }] },
  ] },
  { name: 'Insert', groups: [
    { label: 'Pages', large: ['pagebreak'], rows: [['hrule'], ['show_date']], text: true },
    { label: 'Tables', large: ['table_menu'] },
    { label: 'Illustrations', large: ['figure'], rows: [['drawing', 'shapes'], ['flowchart', 'smartart'], ['chart', 'screenshot']], text: true },
    { label: 'Contents', rows: [['toc'], ['table_of_figures'], ['update_toc']], text: true },
    { label: 'Links', rows: [['link'], ['crossref'], ['citation']], text: true },
    { label: 'Equations', large: ['math_block'],
      rows: [['math_inline'], ['equation_builder'], ['symbol']], text: true },
    { label: 'Theorems', large: ['theorem'] },
    { label: 'Chemistry', large: ['chemistry'], rows: [['chemfig']], text: true },
  ] },
  { name: 'Draw', groups: [
    { label: 'Drawing Tools', large: ['draw_tool', 'eraser_tool'] },
    { label: 'Pens', large: [{ widget: 'pens' }, 'add_pen'] },
  ] },
  { name: 'Design', groups: [
    { label: 'Document Formatting', large: ['design_themes', { widget: 'stylesets' }] },
    { label: 'Formatting', large: ['design_colors', 'design_fonts'], rows: [['para_spacing'], ['set_default']], text: true },
    { label: 'Page Background', large: ['watermark', 'page_color', 'page_borders'] },
    { label: 'Document type', large: [{ widget: 'classes' }] },
  ] },
  { name: 'Layout', groups: [
    { label: 'Page Setup', large: ['margins', 'orientation', 'size', 'columns', 'breaks'],
      rows: [['line_numbers'], ['hyphenation']], text: true },
    { label: 'Indent', rows: [[{ widget: 'parafield', field: 'left_cm' }], [{ widget: 'parafield', field: 'right_cm' }]] },
    { label: 'Spacing', rows: [[{ widget: 'parafield', field: 'before_pt' }], [{ widget: 'parafield', field: 'after_pt' }]] },
  ] },
  { name: 'View', groups: [
    { label: 'Views', large: ['page_visual', 'page_code', 'page_console'] },
    { label: 'PDF', large: ['pdf_panel', 'pdf_detach'] },
    { label: 'Zoom', large: ['fit_page_width'] },
    { label: 'Pages', large: ['repaginate'] },
    { label: 'Show', large: ['show_latex_source'] },
    // A long document as a project of smaller ones, and their list.
    { label: 'Documents', large: ['split_documents', 'documents_dock'] },
  ] },
  { name: 'References', groups: [
    { label: 'Citations', large: ['citation', 'manage_references', 'reference_style'] },
    { label: 'Import', rows: [['refs_zotero', 'refs_mendeley'], ['refs_kherveref', 'refs_endnote'], ['refs_import']], text: true },
    { label: 'Footnotes', large: ['footnote'] },
    { label: 'Captions', large: ['caption', 'crossref', 'captions'] },
  ] },
  { name: 'Review', groups: [
    { label: 'Proofing', large: ['spell_check', 'spelling_list'] },
    { label: 'Comments', large: ['comment'], rows: [['prev_change'], ['next_change']], text: true },
    { label: 'Tracking', large: ['track_changes'], rows: [['markup_view'], ['markup_options']], text: true },
    { label: 'Changes', large: ['accept_comment', 'reject_comment'] },
    { label: 'Share', large: ['overleaf_send', 'overleaf_get', 'overleaf_zip'],
      rows: [['overleaf_open'], ['overleaf_link']], text: true },
  ] },
  { name: 'History', groups: [
    { label: 'Versions', large: ['commit_now', 'history'] },
    { label: 'Cloud', large: ['github'] },
  ] },
  { name: 'Compile', groups: [
    { label: 'Compile', large: ['compile_now', 'auto_compile'] },
    { label: 'Options', large: ['compile_range', 'skip_images'] },
    { label: 'Output', large: ['export_pdf', 'print_preview'] },
  ] },
  { name: 'Examples', groups: [
    { label: 'Start', large: ['new', 'tour'] },
    { label: 'Examples & templates',
      large: GALLERY.filter(([c]) => c !== 'Start').map(([c]) => gallery(c)) },
    { label: 'Your own', large: ['gallery_mine', 'save_as_template'] },
  ] },
  { name: 'Help', groups: [
    { label: 'Help', large: ['help_guide', 'shortcuts', 'welcome'] },
    { label: 'kTeX', large: ['check_updates', 'about'] },
  ] },
  { name: 'Table Design', context: 'table', groups: [
    { label: 'Table Style Options', large: ['tbl_header', 'tbl_repeat'] },
    { label: 'Table Styles', large: ['tbl_plain', 'tbl_grid', 'tbl_booktabs', 'tbl_striped', 'tbl_nolines'] },
    { label: 'Shading', large: ['tbl_shading'] },
  ] },
  { name: 'Table Layout', context: 'table', groups: [
    { label: 'Rows & Columns', large: ['tbl_row_above', 'tbl_row_below', 'tbl_col_left', 'tbl_col_right'] },
    { label: 'Merge', large: ['tbl_merge', 'tbl_split'] },
    { label: 'Delete', large: ['tbl_del_row', 'tbl_del_col', 'tbl_delete'] },
    { label: 'Alignment', large: ['tbl_align_l', 'tbl_align_c', 'tbl_align_r'] },
    { label: 'Data', large: ['tbl_sort_up', 'tbl_sort_down'] },
    { label: 'Caption', large: ['caption'] },
  ] },
  { name: 'Picture', context: 'figure', groups: [
    { label: 'Arrange', large: ['fig_left', 'fig_center', 'fig_right'] },
    { label: 'Size', large: ['fig_w25', 'fig_w50', 'fig_w75', 'fig_w100'] },
    { label: 'Caption', large: ['caption'] },
    { label: 'Picture', large: ['fig_edit', 'fig_delete'] },
  ] },
  { name: 'Theorem', context: 'theorem', groups: [
    { label: 'Type', rows: [thmKinds.slice(0, 3), thmKinds.slice(3, 6), thmKinds.slice(6)], text: true },
    { label: 'Name', large: ['thm_title'] },
  ] },
  { name: 'Equation', context: 'equation', groups: [
    { label: 'Equation', large: ['eq_edit', 'eq_numbered', 'eq_label', 'eq_delete'] },
    { label: 'Insert', large: ['symbol', 'equation_builder'] },
  ] },
]

// The paragraph-style picker, in Word's order: (label, level).
export const PARAGRAPH_STYLES: [string, number][] = [
  ['Body text', 0], ['Title', -1], ['Author', -2], ['Affiliation', -7],
  ['Correspondence', -8], ['Abstract', -3], ['Keywords', -4],
  ['Frame (slide)', -6], ['Box (framed)', -9], ['Chapter', -5],
  ['Heading 1', 1], ['Heading 2', 2], ['Heading 3', 3], ['Heading 4', 4],
  ['Heading 5', 5],
]

// The tiles shown inline in the Styles gallery; the rest open from ▾.
export const GALLERY_INLINE = [0, -1, 1, 2, 3]

export const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24]
