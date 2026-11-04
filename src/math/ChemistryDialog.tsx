// The chemistry (mhchem) and chemical-structure (chemfig) editors —
// ChemistryEditorDialog and ChemfigEditorDialog of
// khervedoc/equation_editor.py.
import { useRef, useState } from 'react'
import * as chemistry from './chemistry.ts'
import * as chemfig from './chemfig.ts'
import * as mb from './mathbox.ts'
import { renderRow } from './mathlayout.ts'
import { containsRaw } from './render.ts'
import { PaletteDialog, type PaletteSpec, type Preview } from './PaletteDialog.tsx'

// ---------------------------------------------------------------- mhchem

// Python draws these previews with matplotlib's mathtext; here the
// equation typesetter draws the same transpiled LaTeX. Unknown macros
// mean "Cannot render", as mathtext would refuse them.
function typesetCe(body: string, px: number, pad: number) {
  const tex = chemistry.ceToMathtext(body).replaceAll('\\square', '\\bullet')
  if (!tex) return null
  const row = mb.parseLatex(tex)
  if (containsRaw(row)) return null
  return renderRow(row, px, false, pad)
}

const CANNOT = 'Cannot render: check syntax'

export const CHEMISTRY_SPEC: PaletteSpec = {
  title: 'Chemistry editor',
  groups: chemistry.CHEM_GROUPS,
  categoryIcons: ['A→B', '→', '(s)', '±', 'H₂O', 'A−B', 'Δ', 'pH', 'e⁻', 'α'],
  catCols: 5,
  catBtnSize: [48, 34],
  emptyHint: 'Click a template to start building your reaction',
  editHint: 'e.g.  2H2 + O2 -> 2H2O',
  sourceLabel: 'Formula (mhchem syntax, inserted inside \\ce{…}):',
  placeholder: chemistry.PLACEHOLDER,
  interval: 300,
  size: [640, 560],
  previewMinHeight: 80,
  // 14 pt at 120 dpi, and 20 pt at 150 dpi, as the matplotlib previews.
  renderTemplate: (latex) => typesetCe(latex, 14 * 120 / 72, 2),
  renderLive: (text): Preview => {
    const img = typesetCe(text, 20 * 150 / 72, 7)
    return img ? { kind: 'svg', svg: img.svg } : { kind: 'error', text: CANNOT }
  },
}

export interface ChemistryResult {
  latex: string
  display: boolean
}

export function ChemistryDialog({ initialLatex = '', close }: { initialLatex?: string; close: (r: ChemistryResult | null) => void }) {
  const [display, setDisplay] = useState(false)
  const extra = (
    <>
      <label className="pal-check">
        <input type="checkbox" checked={display} onChange={e => setDisplay(e.target.checked)} />
        Display on its own line (numbered equation)
      </label>
      <div className="pal-note">
        For 2-D molecular structures (rings, bonds, wedges) use Insert ▸ Chemical structure… — it draws native chemfig.
      </div>
    </>
  )
  return (
    <PaletteDialog spec={CHEMISTRY_SPEC} initialLatex={initialLatex} extra={extra}
      onAccept={src => close({ latex: chemistry.wrapCe(src), display })} onCancel={() => close(null)} />
  )
}

// ---------------------------------------------------------------- chemfig

// Compiles a chemfig snippet with tectonic and renders page 1 at 200 dpi.
// chemfig is TikZ: there is no typeset shortcut, so every preview is a real
// (~1-2 s) LaTeX compile.
async function compilePreview(body: string, workdir: () => Promise<string>): Promise<Preview> {
  const fail: Preview = { kind: 'error', text: 'Cannot render — check the chemfig syntax.' }
  try {
    // preview/pdfjs configures pdf.js's worker; importing it is enough.
    const [{ compileTex }, { compilerHost }, { platform }, pdfjs] = await Promise.all([
      import('../core/compiler'), import('../app/compile'), import('../platform'),
      import('../preview/pdfjs').then(() => import('pdfjs-dist')),
    ])
    const res = await compileTex(chemfig.buildPreviewDoc(body), await workdir(), { basename: 'chemfig_preview' }, compilerHost())
    if (!res.ok || res.pdfPath === null) return fail
    const task = pdfjs.getDocument({ data: await platform().readFile(res.pdfPath) })
    const pdf = await task.promise
    if (pdf.numPages < 1) {
      void task.destroy()
      return fail
    }
    const page = await pdf.getPage(1)
    const vp = page.getViewport({ scale: 200 / 72 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
    void task.destroy()
    return { kind: 'img', url: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }
  } catch {
    return fail
  }
}

export function ChemfigDialog({ initialLatex = '', close }: { initialLatex?: string; close: (r: string | null) => void }) {
  const dir = useRef<Promise<string> | null>(null)
  const workdir = () => {
    if (!dir.current) {
      dir.current = import('../platform').then(({ platform }) => platform().makeTempDir('khervedoc-chemfig-'))
    }
    return dir.current
  }
  const spec: PaletteSpec = {
    title: 'Chemical structure editor',
    groups: chemfig.CHEMFIG_GROUPS,
    categoryIcons: ['struct', 'molec', 'hydro', 'arom', 'hetero', 'rings', 'bonds', 'groups', 'stereo', 'bio',
      'charge', 'scheme', 'poly'],
    catCols: 7,
    catBtnSize: [58, 30],
    emptyHint: 'Pick a structure or scheme template to start',
    editHint: 'e.g.  \\chemfig{*6(======)}',
    sourceLabel: 'chemfig source (inserted as-is into the document):',
    placeholder: chemfig.PLACEHOLDER,
    // tectonic is far slower than typesetting; don't compile on every keystroke
    interval: 700,
    size: [680, 620],
    previewMinHeight: 200,
    // No per-button previews: one tectonic compile per palette button would
    // be unusable. Buttons fall back to their text label.
    renderTemplate: () => null,
    renderLive: (text) => compilePreview(text, workdir),
    previewOnSeed: true,
  }
  const cleanup = () => {
    const d = dir.current
    if (d) void d.then(async p => { const { platform } = await import('../platform'); await platform().remove(p) }).catch(() => {})
  }
  return (
    <PaletteDialog spec={spec} initialLatex={initialLatex} onClosed={cleanup}
      onAccept={src => close(src.trim())} onCancel={() => close(null)} />
  )
}
