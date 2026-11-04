// Dev-only page (not part of the build): http://localhost:5174/src/math/dev/
// Shows the TS typesetting of scripts/math_golden.py's DEV_SAMPLES beside
// Python's PNGs (written to ./py/ by `math_golden.py --png src/math/dev/py`,
// not committed), and opens each math dialog.
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { renderLatex } from '../mathlayout.ts'
import { mathReady } from '../render.ts'
import { execChemfigEditor, execChemistryEditor, execEquationEditor } from '../dialogs.tsx'
import { showSymbolPicker } from '../SymbolPicker.tsx'

const SAMPLES: [string, boolean][] = [
  ['x^2 + \\frac{1}{y}', true],
  ['\\sum_{i=1}^{n} \\binom{n}{k} x^k', true],
  ['\\int_{-\\infty}^{\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}', true],
  ['\\left( \\frac{\\frac{a}{b}}{c} \\right) \\left\\{ x \\right\\}', true],
  ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', true],
  ['\\begin{cases} x & \\text{if } x > 0 \\\\ -x & \\text{otherwise} \\end{cases}', true],
  ['\\hat{x}\\bar{y}\\vec{v}\\tilde{n}\\dot{a}\\ddot{b}', true],
  ['\\sqrt[3]{x^2+1} + \\mathbb{R} + \\mathcal{L}', true],
  ['\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1', false],
  ['\\frac{\\square}{\\square} + \\foo{a}', true],
]

function Page() {
  const [, setReady] = useState(0)
  const [out, setOut] = useState('')
  useEffect(() => { void mathReady().then(() => setReady(1)) }, [])
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={async () => setOut(JSON.stringify(await execEquationEditor({ showLayout: true })))}>Equation editor</button>
        <button onClick={async () => setOut(JSON.stringify(await execEquationEditor({ initialLatex: '\\frac{\\square}{\\square} + x^2' })))}>Re-edit</button>
        <button onClick={async () => setOut(JSON.stringify(await execChemistryEditor()))}>Chemistry</button>
        <button onClick={async () => setOut(JSON.stringify(await execChemfigEditor()))}>Chemfig</button>
        <button onClick={() => showSymbolPicker(l => setOut(l))}>Symbols</button>
        <code id="out">{out}</code>
      </div>
      <table style={{ background: '#fff', borderCollapse: 'collapse' }}>
        <tbody>
          {SAMPLES.map(([latex, display], i) => {
            const img = renderLatex(latex, 24, display)
            return (
              <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: 6 }} dangerouslySetInnerHTML={{ __html: img.svg }} />
                <td style={{ padding: 6 }}><img src={`./py/py_${String(i).padStart(2, '0')}.png`} alt=""
                  onLoad={e => { const im = e.currentTarget; im.width = im.naturalWidth / 2 }} /></td>
                <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{latex}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
