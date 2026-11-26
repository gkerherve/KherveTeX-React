// The menu bar of khervedoc/mainwindow.py `_build_menus` (plus the
// entries `_extend_menus` adds), in order. Strings are command ids from
// COMMANDS, or '-' for a separator.
import { BETA_DETAIL, isBetaExample } from './pageBeta'
import { CHAPTER_STYLES, PAGE_EDGES, TITLE_STYLES } from '../core/design'
import { FANCY_COLORS } from '../core/fancyTable'
import { CONSTANTS, PHYSICS } from '../core/sciMath'
import { CALLOUT_MENU, GALLERY, THEOREM_KINDS, type MenuEntry, type MenuItem } from './ribbonModel'

export interface MenuBarMenu {
  text: string
  items: MenuEntry[]
}

const MATH_ENVIRONMENTS = [
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'cases', 'split', 'pmatrix', 'bmatrix',
]

const newFromTemplate: MenuEntry[] = [
  ...GALLERY.map(([cat, , items]): MenuItem => ({
    text: cat.replace('&', '&&'), items: items.map(label => ({
      text: label, command: `example:${label}`, ...(isBetaExample(label) ? { detail: BETA_DETAIL } : {}),
    })),
  })),
  '-',
  { text: '&My templates', items: [{ text: '(no saved templates)', disabled: true }] },
]

export const MENU_BAR: MenuBarMenu[] = [
  { text: '&File', items: [
    'new',
    { text: 'New from &Template', items: newFromTemplate },
    'new_window', 'open', 'open_tex_as_is', 'open_in_new_window',
    { text: 'Open &Recent', items: [{ text: '(no recent files)', disabled: true }] },
    '-',
    'close_doc', 'save', 'save_as', 'save_as_template',
    { text: '&Version History', items: ['commit_now', 'history', 'branches'] },
    '-',
    { text: 'S&hare', items: ['overleaf_send', 'overleaf_get', 'overleaf_zip', 'overleaf_open', 'overleaf_link', '-',
      'github', 'configure_remotes', 'pull'] },
    { text: '&Import', items: ['import_tex', 'import_package', '-', 'import_docx', 'import_office', 'import_gdoc', '-', 'import_pdf', 'import_md'] },
    { text: '&Export', items: ['export_pdf', 'export_docx', 'export_tex', 'export_latex_zip'] },
    'extract_ktex',
    { text: 'Pro&ject', items: ['new_project', 'split_documents', 'open_project', 'save_project', 'close_project'] },
    '-',
    'print_preview', 'print',
    '-',
    'doc_props', 'show_in_explorer',
    '-',
    'quit',
  ] },
  { text: '&Edit', items: [
    'undo', 'redo', '-', 'cut', 'copy', 'paste', 'paste_special', 'select_all', '-',
    'find', 'replace', '-', 'clear_fmt',
  ] },
  { text: '&View', items: [
    'view_formatted', 'view_latex', 'view_pdf', 'view_console', '-',
    'visual_only', 'side_by_side', 'pdf_window', 'documents_dock', '-',
    'show_marks', 'show_latex_source', 'fit_page_width',
    { text: '&Theme', items: ['theme_light', 'theme_dark'] },
  ] },
  { text: '&Insert', items: [
    'pagebreak', 'hrule', 'show_date', 'multicol', '-',
    'table', 'figure', 'drawing', 'flowchart', '-',
    { text: '&Equation', items: [
      'math_inline', 'math_block', 'equation_builder', 'symbol',
      { text: 'Math &environment', items: MATH_ENVIRONMENTS.map(e => ({ text: e })) },
    ] },
    { text: 'C&hemistry', items: ['chemistry', 'chemfig', 'sci_scheme', '-', 'sci_mo', 'sci_bohr', 'sci_element', 'sci_hazard'] },
    // The Science tab.
    { text: 'Sc&ience', items: ['sci_units', 'sci_sigfig',
      { text: '&Constants', items: CONSTANTS.map((_, i) => `sci_const_${i}`) },
      { text: '&Physics notation', items: PHYSICS.map((_, i) => `sci_phys_${i}`) },
      'sci_nuclear', 'sci_matrix', '-',
      'sci_plot', 'sci_circuit', 'sci_feynman', 'sci_forces', 'sci_optics', 'sci_wave', 'sci_levels', '-',
      'sci_function', 'sci_stats', 'sci_venn', 'sci_numberline', 'sci_geometry', 'sci_unitcircle', '-',
      'sci_algorithm', 'sci_notebook', 'sci_risk', 'sci_signs'] },
    '-',
    'link', 'footnote', 'citation', 'manage_references', 'crossref', 'captions', 'comment', '-',
    'abstract', 'keywords', '-',
    { text: '&LaTeX', items: ['code_block', 'raw', '-', 'compile_start', 'compile_end',
      'not_compile_start', 'not_compile_end'] },
    { text: 'Coloured &box', icon: 'callout',
      items: CALLOUT_MENU.map(([k]) => `box_insert_${k}`) },
    { text: '&Theorem-like', icon: 'theorem',
      items: THEOREM_KINDS.map(([k]) => `thm_insert_${k}`) },
    '-',
    // Insert ▸ Elements and Illustrations on the ribbon.
    { text: 'Ele&ments', icon: 'element', iconArg: 'checklist', items: [
      'ins_checklist', 'ins_progress', 'ins_timeline', 'ins_rating', 'ins_gauge', '-',
      'ins_pullquote', 'ins_sidebar', 'ins_steps', '-', 'ins_qrcode', 'ins_code', 'ins_dropcap'] },
    { text: 'Ch&arts', icon: 'element', iconArg: 'chart', items: ['ins_chart', 'ins_gantt', 'tbl_chart'] },
    'ins_icon', 'ins_marginnote',
  ] },
  { text: 'F&ormat', items: [
    'bold', 'italic', 'underline', 'strike', 'code', 'smallcaps', 'sub', 'super', '-',
    'bullet', 'numbered',
    { text: '&Alignment', items: ['align_left', 'align_center', 'align_right', 'align_justify'] },
    { text: '&Style', items: ['h_body', 'heading_1', 'heading_2', 'heading_3', 'heading_4',
      'heading_5'] },
    '-',
    { text: '&Table style', items: ['tbl_plain', 'tbl_grid', 'tbl_booktabs', 'tbl_striped', 'tbl_nolines', '-',
      'tbl_fancy_banded', 'tbl_fancy_header', 'tbl_fancy_accent',
      { text: 'Fancy table &colour', items: [...FANCY_COLORS.map(([c]) => `tbl_fancy_c_${c}`), 'tbl_fancy_custom'] }] },
    // Design tab: the document's look.
    { text: '&Design', items: [
      { text: '&Title page', items: TITLE_STYLES.map(([k, name]): MenuItem => ({ text: name, command: `titlestyle:${k}`, checkable: true })) },
      { text: '&Chapter titles', items: CHAPTER_STYLES.map(([k, name]): MenuItem => ({ text: name, command: `chapterstyle:${k}`, checkable: true })) },
      { text: '&Header style', items: PAGE_EDGES.map(([k, name]): MenuItem => ({ text: name, command: `pageedge:${k}`, checkable: true })) },
      '-', 'mn_room'] },
    '-',
    'manage_styles',
  ] },
  { text: '&Tools', items: [
    'spell_check', 'spelling_list', 'check_citations',
    { text: '&Comments && Highlights', items: ['comment', 'accept_comment', 'reject_comment',
      'prev_comment', 'next_comment', '-', 'highlight', 'remove_highlight'] },
    '-',
    { text: '&Compiler', items: ['compiler_latex', 'compiler_typst', '-', 'compiler_status',
      'download_bundle', 'open_cache'] },
    '-',
    'connect_claude', '-', 'settings',
  ] },
  // One entry per open window; this app has one.
  { text: '&Window', items: [{ text: 'Untitled', checkable: true, checked: true }] },
  { text: '&Help', items: [
    'welcome', 'tour', 'help_guide', 'shortcuts', '-',
    'check_updates_menu', 'update_automatically', '-',
    'send_feedback', 'buy_coffee', 'about',
  ] },
]
