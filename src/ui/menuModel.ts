// The menu bar of khervedoc/mainwindow.py `_build_menus` (plus the
// entries `_extend_menus` adds), in order. Strings are command ids from
// COMMANDS, or '-' for a separator.
import { BETA_DETAIL, isBetaExample } from './pageBeta'
import { GALLERY, THEOREM_KINDS, type MenuEntry, type MenuItem } from './ribbonModel'

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
    'new_window', 'open', 'open_in_new_window',
    { text: 'Open &Recent', items: [{ text: '(no recent files)', disabled: true }] },
    '-',
    'close_doc', 'save', 'save_as', 'save_as_template',
    { text: '&Version History', items: ['commit_now', 'history', 'branches'] },
    '-',
    { text: 'S&hare', items: ['overleaf_send', 'overleaf_get', 'overleaf_zip', '-',
      'configure_remotes', 'pull'] },
    { text: '&Import', items: ['import_tex', 'import_docx', 'import_pdf', 'import_md'] },
    { text: '&Export', items: ['export_pdf', 'export_docx', 'export_tex', 'export_latex_zip'] },
    { text: 'Pro&ject', items: ['new_project', 'open_project', 'save_project', 'close_project'] },
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
    'show_marks', 'fit_page_width',
    { text: '&Theme', items: ['theme_light', 'theme_dark'] },
  ] },
  { text: '&Insert', items: [
    'pagebreak', 'hrule', 'multicol', '-',
    'table', 'figure', 'drawing', 'flowchart', '-',
    { text: '&Equation', items: [
      'math_inline', 'math_block', 'equation_builder', 'symbol',
      { text: 'Math &environment', items: MATH_ENVIRONMENTS.map(e => ({ text: e })) },
    ] },
    { text: 'C&hemistry', items: ['chemistry', 'chemfig'] },
    '-',
    'link', 'footnote', 'citation', 'crossref', 'comment', '-',
    'abstract', 'keywords', '-',
    { text: '&LaTeX', items: ['code_block', 'raw', '-', 'compile_start', 'compile_end',
      'not_compile_start', 'not_compile_end'] },
    { text: '&Theorem-like', icon: 'theorem',
      items: THEOREM_KINDS.map(([k]) => `thm_insert_${k}`) },
  ] },
  { text: 'F&ormat', items: [
    'bold', 'italic', 'underline', 'strike', 'code', 'smallcaps', 'sub', 'super', '-',
    'bullet', 'numbered',
    { text: '&Alignment', items: ['align_left', 'align_center', 'align_right', 'align_justify'] },
    { text: '&Style', items: ['h_body', 'heading_1', 'heading_2', 'heading_3', 'heading_4',
      'heading_5'] },
    '-',
    'manage_styles',
  ] },
  { text: '&Tools', items: [
    'spell_check', 'check_citations',
    { text: '&Comments && Highlights', items: ['comment', 'accept_comment', 'reject_comment',
      'prev_comment', 'next_comment', '-', 'highlight', 'remove_highlight'] },
    '-',
    { text: '&Compiler', items: ['compiler_latex', 'compiler_typst', '-', 'compiler_status',
      'download_bundle', 'open_cache'] },
    '-',
    'connect_claude',
  ] },
  // One entry per open window; this app has one.
  { text: '&Window', items: [{ text: 'Untitled', checkable: true, checked: true }] },
  { text: '&Help', items: [
    'welcome', 'tour', 'help_guide', 'shortcuts', '-',
    'check_updates_menu', 'update_automatically', '-',
    'about',
  ] },
]
