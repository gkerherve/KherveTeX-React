// Placeholder until the math layout engine (Phase 3) lands. The visual
// editor draws inline and display math through this one function.
export interface MathRender {
  svg: string
  width: number   // px
  height: number  // px
  baseline: number // px from the top
}

export function renderMath(latex: string, opts: { display: boolean; fontPx: number }): MathRender {
  const esc = latex.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const w = Math.max(8, latex.length * opts.fontPx * 0.5)
  const h = opts.fontPx * 1.3
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="0" y="${opts.fontPx}" font-style="italic" font-size="${opts.fontPx}">${esc}</text></svg>`,
    width: w, height: h, baseline: opts.fontPx,
  }
}
