// Equations and chemistry: MainWindow's _insert_symbol,
// _insert_equation_template, _apply_equation_template, _insert_chemistry,
// _insert_chemfig, the Insert ▸ Inline math / Math block entry points
// (DocumentEditor.open_equation_editor) and the contextual Equation tab
// (edit_current_equation, set_current_equation_numbered,
// delete_current_equation).
import { registerActions } from '../actions'
import { editorApi, type EditorApi } from '../editorApi'
import { appStore } from '../store'
import { inlineRaw, mathBlock, mathInline, rawLatex } from '../../core/model'
import { isTextModeSymbol } from '../../math/symbols'
import { takeLabel } from '../../math/label'

// What the contextual Equation tab needs beyond EditorApi. The visual
// editor implements these; until it does the buttons only report it.
export interface EquationEditing {
  equationNumbered?(): boolean
  setEquationNumbered?(on: boolean): void
  deleteEquation?(): void
  equationLabel?(): string | null
  setEquationLabel?(label: string | null): void
  // The caret is on a display equation (one that can carry a label).
  equationIsBlock?(): boolean
}

const ed = (): (EditorApi & EquationEditing) | null => editorApi() as (EditorApi & EquationEditing) | null

const dialogs = () => import('../../math/dialogs')

// insert_math_block_with / insert_inline_math_with: nothing for empty LaTeX.
function insertMathBlock(latex: string, numbered = false, label: string | null = null): void {
  if (!latex.trim()) return
  ed()?.insertBlock(mathBlock(latex, numbered, numbered ? label : null))
}

function insertInlineMath(latex: string): void {
  if (!latex) return
  ed()?.insertInline(mathInline(latex))
}

// meta.packages.append(pkg) on first use, as MainWindow does for mhchem
// and chemfig.
function ensurePackage(pkg: string): void {
  const s = appStore()
  const doc = s.get().doc
  if (doc.meta.packages.includes(pkg)) return
  s.set({ doc: { ...doc, meta: { ...doc.meta, packages: [...doc.meta.packages, pkg] } }, dirty: true })
}

// Route a symbol-palette pick to math-inline or raw-inline insert: text-mode
// macros like \Kstroke would not render inside $...$.
export function dispatchSymbolPick(latex: string): void {
  if (isTextModeSymbol(latex)) {
    if (latex) ed()?.insertInline(inlineRaw(latex))
  } else insertInlineMath(latex)
}

export function applyEquationTemplate(latex: string): void {
  if (latex.includes('\\begin{')) insertMathBlock(latex)
  else insertInlineMath(latex)
}

// Toolbar entry point: build an equation in the equation editor, preset to
// inline or display (numbered) layout.
async function openEquationEditor(display: boolean): Promise<void> {
  const { execEquationEditor } = await dialogs()
  const r = await execEquationEditor({ showLayout: true, display })
  if (!r) return
  const latex = r.latex.trim()
  if (!latex) return
  if (r.display || latex.includes('\\begin{')) insertMathBlock(latex, r.numbered, r.label)
  else insertInlineMath(latex)
}

registerActions({
  symbol: async () => {
    const { showSymbolPicker } = await import('../../math/SymbolPicker')
    showSymbolPicker(dispatchSymbolPick)
  },

  equation_builder: async () => {
    const { execEquationEditor } = await dialogs()
    const r = await execEquationEditor()
    if (!r) return
    const latex = r.latex
    if (!latex) return
    // \begin{equation} (numbered) unless the template already carries its
    // own environment (align, cases, ...).
    if (r.display) insertMathBlock(latex, r.numbered, r.label)
    else applyEquationTemplate(latex)
  },

  math_inline: () => openEquationEditor(false),
  math_block: () => openEquationEditor(true),

  // Chemistry needs no model node of its own: \ce{} is a math-mode macro, so
  // it rides inside the ordinary math nodes.
  chemistry: async () => {
    const { execChemistryEditor } = await dialogs()
    const r = await execChemistryEditor()
    if (!r || !r.latex) return
    ensurePackage('mhchem')
    if (r.display) insertMathBlock(r.latex, true)
    else insertInlineMath(r.latex)
  },

  // chemfig is text-mode, so it goes in as a RawLatex block the serializer
  // emits verbatim.
  chemfig: async () => {
    const { execChemfigEditor } = await dialogs()
    const latex = await execChemfigEditor()
    if (!latex) return
    ensurePackage('chemfig')
    if (latex.trim()) ed()?.insertBlock(rawLatex(latex))
  },

  eq_edit: async () => {
    const e = ed()
    const latex = e?.selection().mathLatex ?? null
    if (e === null || latex === null) return
    const { askMath, execEquationEditor } = await dialogs()
    const { unwrapCe } = await import('../../math/chemistry')
    // A display equation: its label in the window's Label box (a \label
    // inside its LaTeX comes out into the box too), not in the formula.
    if (e.equationIsBlock?.() && e.setEquationLabel && unwrapCe(latex) === null) {
      const [body, inside] = takeLabel(latex)
      const before = e.equationLabel?.() ?? inside
      const r = await execEquationEditor({ initialLatex: body, showLayout: false, display: true,
        numbered: e.equationNumbered?.() ?? true, label: before, labelBox: true })
      if (!r) return
      if (r.latex !== latex) e.replaceMath(r.latex)
      if (r.label !== before || inside) e.setEquationLabel(r.label)
      return
    }
    const fresh = await askMath(latex)
    if (fresh === null) return
    // A \label typed into a display equation becomes its label.
    const [clean, typed] = e.setEquationLabel ? takeLabel(fresh) : [fresh, null]
    e.replaceMath(clean)
    if (typed) e.setEquationLabel?.(typed)
  },

  // Checkable: the ribbon passes no state, so it toggles.
  eq_numbered: (arg?: unknown) => {
    const e = ed()
    if (!e) return
    if (!e.setEquationNumbered) {
      appStore().set({ status: 'Numbering equations needs the visual editor.' })
      return
    }
    const on = typeof arg === 'boolean' ? arg : !(e.equationNumbered?.() ?? false)
    e.setEquationNumbered(on)
  },

  // Equation ▸ Label…: the name a cross-reference uses.
  eq_label: async () => {
    const e = ed()
    if (!e?.setEquationLabel) return
    const { promptText } = await import('../../ui/dialogs/EditorDialogs.tsx')
    const cur = e.equationLabel?.() ?? ''
    const r = await promptText('Equation label', 'Label (e.g. eq:energy); empty removes it:', cur)
    if (r === null) return
    e.setEquationLabel(r.trim().replace(/[\s{}]/g, '') || null)
  },

  eq_delete: () => {
    const e = ed()
    if (!e) return
    if (!e.deleteEquation) {
      appStore().set({ status: 'Deleting equations needs the visual editor.' })
      return
    }
    e.deleteEquation()
  },
})
