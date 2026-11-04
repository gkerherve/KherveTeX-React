// The visual editor draws inline and display math through renderMath: the
// equation editor's own engine (Latin Modern Math), so an inserted equation
// looks exactly as it did in the builder — editor.py's
// _render_math_typeset. The SVG names the font by family; mathReady()
// resolves once the @font-face has loaded, after which a re-render (or the
// browser's own repaint of inline SVG) shows the real glyphs.
import * as mb from './mathbox.ts'
import { renderRow } from './mathlayout.ts'
import { MATH_FAMILY } from './fontData.ts'

export interface MathRender {
  svg: string
  width: number   // px
  height: number  // px
  baseline: number // px from the top
  // false when the formula has parts only LaTeX knows (custom macros,
  // unknown environments), drawn as grey chips. Python falls back to
  // matplotlib there.
  typeset?: boolean
}

// ------------------------------------------------------------- the font

let ready: Promise<void> | null = null

export function fontUrl(): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'
  return `${base}fonts/math/latinmodern-math.otf`
}

// The bit of the DOM used here (this module also runs headless).
interface DomLike {
  createElement(tag: 'style'): { textContent: string | null; setAttribute(k: string, v: string): void }
  head: { appendChild(el: unknown): unknown }
  fonts?: { load(font: string, text?: string): Promise<unknown> }
}
const dom = (): DomLike | undefined => (globalThis as { document?: DomLike }).document

// Installs the @font-face once and resolves when the font can draw.
export function mathReady(): Promise<void> {
  if (ready) return ready
  const doc = dom()
  if (!doc) {
    ready = Promise.resolve()
    return ready
  }
  const style = doc.createElement('style')
  style.setAttribute('data-kherve-math', '')
  style.textContent = `@font-face { font-family: "${MATH_FAMILY}"; `
    + `src: url("${fontUrl()}") format("opentype"); font-display: block; }`
  doc.head.appendChild(style)
  ready = (doc.fonts?.load(`16px "${MATH_FAMILY}"`, 'x∑') ?? Promise.resolve())
    .then(() => undefined, () => undefined)
  return ready
}

if (dom()) void mathReady()

// ------------------------------------------------- document preprocessing

const CE_ARROWS: Record<string, string> = {
  '<=>': '\\rightleftharpoons', '<->': '\\leftrightarrow',
  '->': '\\rightarrow', '<-': '\\leftarrow', '=': '=', '+': '+',
}

// One mhchem species ("2H2O", "SO4^2-", "Na+", "CuSO4.5H2O", "H2O(l)") as
// upright math: element symbols roman, counts subscripted, charge up,
// hydrate dots centred.
export function ceSpecies(tok: string): string {
  if (tok.includes('.') || tok.includes('*')) return tok.split(/[.*]/).map(ceSpecies).join('\\cdot ')
  const m = /^(\d*)(.*?)(\((?:s|l|g|aq)\))?$/s.exec(tok)!
  const coeff = m[1]!
  let body = m[2]!
  const state = m[3] ?? ''
  let charge = ''
  const cm = /\^\{?([0-9]*[+-])\}?$/.exec(body) ?? /(?<=[A-Za-z0-9)\]])([0-9]*[+-])$/.exec(body)
  if (cm && body.slice(0, cm.index)) {
    charge = cm[1]!
    body = body.slice(0, cm.index)
  }
  const out: string[] = []
  for (const part of body.match(/[A-Z][a-z]?|\d+|[a-z]+|./gu) ?? []) {
    if (/^\d+$/.test(part)) out.push(`_{${part}}`)
    else if (mb.isAlphaStr(part)) out.push(`\\mathrm{${part}}`)
    else out.push(part)
  }
  let res = out.join('')
  if (charge) res += `^{${charge}}`
  if (state) res += `\\,\\mathrm{${state}}`
  return coeff ? `${coeff}\\,${res}` : res
}

// Rewrite \ce{...} (mhchem) into plain math the typesetter draws, covering
// ordinary formulas and reactions; the LaTeX output still uses mhchem.
export function ceToMath(latex: string): string {
  return latex.replace(/\\ce\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (_m, g1: string) => {
    const body = g1.trim()
    return body.split(/\s+/).filter(Boolean).map(t => CE_ARROWS[t] ?? ceSpecies(t)).join(' ')
  })
}

export function containsRaw(row: mb.Row): boolean {
  for (const r of mb.walkRows(row)) if (r.children.some(n => n instanceof mb.Raw)) return true
  return false
}

// What the typesetter draws for a document equation: labels and
// \nonumber dropped, \ce{} turned into math.
export function prepareDocMath(latex: string): string {
  let src = latex.trim().replace(/\\(label\{[^}]*\}|nonumber|notag)/g, '')
  if (src.includes('\\ce{')) src = ceToMath(src)
  return src
}

// ------------------------------------------------------------ the API

const cache = new Map<string, MathRender>()

export function renderMath(latex: string, opts: { display: boolean; fontPx: number; pad?: number }): MathRender {
  const pad = opts.pad ?? opts.fontPx * 0.12
  const key = `${opts.display ? 'D' : 'I'}${opts.fontPx}\u0000${pad}\u0000${latex}`
  const hit = cache.get(key)
  if (hit) return hit
  const row = mb.parseLatex(prepareDocMath(latex))
  const img = renderRow(row, opts.fontPx, opts.display, pad)
  const out: MathRender = {
    svg: img.svg, width: img.width, height: img.height, baseline: img.baseline,
    typeset: !containsRaw(row),
  }
  if (cache.size > 2000) cache.clear()
  cache.set(key, out)
  return out
}
