// Stand-in content for the A4 page card until the editor is ported. Its
// table, figure, equation and theorem are clickable so the contextual
// ribbon tabs can be shown, as the caret would in the real editor.
import type { MouseEvent } from 'react'
import type { ContextKind } from './ribbonModel'

export function PlaceholderPage({ onContext }: { onContext?: (k: ContextKind | null) => void }) {
  const pick = (k: ContextKind) => (e: MouseEvent) => {
    e.stopPropagation()
    onContext?.(k)
  }
  return (
    <div className='doc' onClick={() => onContext?.(null)}>
      <h1 className='doc-title'>Welcome to kTeX</h1>
      <p className='doc-subtitle'>A guided tour of the editor</p>
      <h2 className='doc-section'><span>1</span>What kTeX is</h2>
      <p className='doc-p doc-first'>
        kTeX is a WYSIWYG editor that produces real LaTeX. You type the way
        you would in Word; the preview on the right compiles to PDF every time you
        stop typing. Underneath, the document is stored as a structured model —
        section headings, paragraphs, math, tables, figures, lists — and the
        serializer turns that into clean .tex you can hand to a journal, a
        co-author, or a git diff.
      </p>
      <p className='doc-p'>
        If you have never written LaTeX directly, you will not need to. If you
        have, kTeX stays out of your way: you can import an existing .tex
        file, edit it visually, and export the result back to LaTeX with the
        structure preserved.
      </p>
      <h2 className='doc-section'><span>2</span>Objects on the page</h2>
      <p className='doc-p doc-first'>
        Click the table, the figure, the equation or the theorem below: the
        ribbon shows the tools for that kind of object, as Word does.
      </p>
      <table className='doc-table' onClick={pick('table')}>
        <caption>Table 1: Binding energies of the reference lines.</caption>
        <thead><tr><th>Line</th><th>BE (eV)</th><th>FWHM (eV)</th></tr></thead>
        <tbody>
          <tr><td>C 1s</td><td>284.8</td><td>1.1</td></tr>
          <tr><td>O 1s</td><td>531.2</td><td>1.4</td></tr>
          <tr><td>Au 4f<sub>7/2</sub></td><td>84.0</td><td>0.9</td></tr>
        </tbody>
      </table>
      <div className='doc-equation' onClick={pick('equation')}>
        <span className='doc-math'><i>E</i> = <i>mc</i><sup>2</sup></span>
        <span className='doc-eqno'>(1)</span>
      </div>
      <p className='doc-p doc-theorem' onClick={pick('theorem')}>
        <b>Theorem 2.1</b> <i>Every document compiles offline once its packages
        are in the local TeX cache.</i>
      </p>
      <figure className='doc-figure' onClick={pick('figure')}>
        <div className='doc-figure-box' />
        <figcaption>Figure 1: A figure placeholder.</figcaption>
      </figure>
    </div>
  )
}
