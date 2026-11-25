// The math dialogs as awaitable calls (QDialog.exec()), mounted through the
// app's shared dialog host, plus the editor-facing entry points of
// editor.py: _ask_math (double-click re-edit) and open_equation_editor.
import { openDialog } from '../ui/dialogs/dialogHost.tsx'
import { EquationEditor, type EquationResult } from './EquationEditor.tsx'
import { ChemfigDialog, ChemistryDialog, type ChemistryResult } from './ChemistryDialog.tsx'
import { unwrapCe } from './chemistry.ts'

export function execEquationEditor(opts: {
  initialLatex?: string; showLayout?: boolean | null; display?: boolean; numbered?: boolean
  label?: string | null; labelBox?: boolean
} = {}): Promise<EquationResult | null> {
  return openDialog<EquationResult>(close => <EquationEditor {...opts} close={close} />)
}

export function execChemistryEditor(initialLatex = ''): Promise<ChemistryResult | null> {
  return openDialog<ChemistryResult>(close => <ChemistryDialog initialLatex={initialLatex} close={close} />)
}

export function execChemfigEditor(initialLatex = ''): Promise<string | null> {
  return openDialog<string>(close => <ChemfigDialog initialLatex={initialLatex} close={close} />)
}

// Reopen the editor that built latex, seeded with it. Resolves with the
// new LaTeX, or null if cancelled or unchanged. A \ce{} formula goes back
// to the chemistry editor — the equation builder would show the user a
// wrapper they never typed.
export async function askMath(latex: string): Promise<string | null> {
  const body = unwrapCe(latex)
  let fresh: string | null
  if (body !== null) fresh = (await execChemistryEditor(body))?.latex ?? null
  else fresh = (await execEquationEditor({ initialLatex: latex }))?.latex ?? null
  return fresh && fresh !== latex ? fresh : null
}
