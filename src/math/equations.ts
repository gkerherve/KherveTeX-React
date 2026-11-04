// Templated equation snippets grouped for the equation-builder palette —
// khervedoc/equations.py. Each entry is [latex_template, preview]: the
// template is what the editor inserts at the cursor, the preview what the
// palette button's tooltip falls back to. \square is the placeholder so
// users can tab through and replace each slot.
export type TemplateGroup = [string, [string, string][]]

export const EQUATION_GROUPS: TemplateGroup[] = [
  ["Fractions & roots", [
    ["\\frac{\\square}{\\square}", "□/□"],
    ["\\tfrac{\\square}{\\square}", "small □/□"],
    ["\\dfrac{\\square}{\\square}", "display □/□"],
    ["\\sqrt{\\square}", "√□"],
    ["\\sqrt[\\square]{\\square}", "ⁿ√□"],
    ["\\binom{\\square}{\\square}", "(□ □)"],
  ]],
  ["Sums, products, limits", [
    ["\\sum_{\\square}^{\\square} \\square", "∑_□^□"],
    ["\\sum_{i=1}^{n} \\square", "∑ᵢ₌₁ⁿ"],
    ["\\prod_{\\square}^{\\square} \\square", "∏_□^□"],
    ["\\lim_{\\square \\to \\square} \\square", "lim_□→□"],
    ["\\liminf_{\\square \\to \\square} \\square", "lim inf"],
    ["\\limsup_{\\square \\to \\square} \\square", "lim sup"],
  ]],
  ["Integrals", [
    ["\\int_{\\square}^{\\square} \\square \\, d\\square", "∫_□^□"],
    ["\\int \\square \\, d\\square", "∫ □ d□"],
    ["\\iint_{\\square} \\square \\, dA", "∬ dA"],
    ["\\iiint_{\\square} \\square \\, dV", "∭ dV"],
    ["\\oint_{\\square} \\square \\, d\\square", "∮"],
    ["\\int_{-\\infty}^{\\infty} \\square \\, d\\square", "∫_-∞^∞"],
  ]],
  ["Subscripts & superscripts", [
    ["\\square^{\\square}", "x^□"],
    ["\\square_{\\square}", "x_□"],
    ["\\square_{\\square}^{\\square}", "x_□^□"],
    ["e^{\\square}", "e^□"],
    ["10^{\\square}", "10^□"],
    ["\\square^{-1}", "x⁻¹"],
  ]],
  ["Derivatives", [
    ["\\frac{d\\square}{d\\square}", "d□/d□"],
    ["\\frac{d^{2}\\square}{d\\square^{2}}", "d²□/d□²"],
    ["\\frac{\\partial \\square}{\\partial \\square}", "∂□/∂□"],
    ["\\frac{\\partial^{2} \\square}{\\partial \\square^{2}}", "∂²□/∂□²"],
    ["\\nabla \\square", "∇ □"],
    ["\\nabla^{2} \\square", "∇² □"],
  ]],
  ["Greek inline", [
    ["\\alpha", "α"],
    ["\\beta", "β"],
    ["\\gamma", "γ"],
    ["\\Delta", "Δ"],
    ["\\theta", "θ"],
    ["\\lambda", "λ"],
    ["\\mu", "μ"],
    ["\\pi", "π"],
    ["\\sigma", "σ"],
    ["\\Sigma", "Σ"],
    ["\\phi", "φ"],
    ["\\omega", "ω"],
  ]],
  ["Vectors & matrices", [
    ["\\vec{\\square}", "→x"],
    ["\\hat{\\square}", "x̂"],
    ["\\bar{\\square}", "x̄"],
    ["\\begin{pmatrix} \\square & \\square \\\\ \\square & \\square \\end{pmatrix}", "(2×2)"],
    ["\\begin{bmatrix} \\square & \\square \\\\ \\square & \\square \\end{bmatrix}", "[2×2]"],
    ["\\begin{vmatrix} \\square & \\square \\\\ \\square & \\square \\end{vmatrix}", "|2×2|"],
  ]],
  ["Brackets", [
    ["\\left( \\square \\right)", "(□)"],
    ["\\left[ \\square \\right]", "[□]"],
    ["\\left\\{ \\square \\right\\}", "{□}"],
    ["\\left| \\square \\right|", "|□|"],
    ["\\left\\| \\square \\right\\|", "‖□‖"],
    ["\\left\\langle \\square \\right\\rangle", "⟨□⟩"],
    ["\\left\\lfloor \\square \\right\\rfloor", "⌊□⌋"],
    ["\\left\\lceil \\square \\right\\rceil", "⌈□⌉"],
  ]],
  ["Relations & operators", [
    ["\\square = \\square", "□ = □"],
    ["\\square \\approx \\square", "□ ≈ □"],
    ["\\square \\neq \\square", "□ ≠ □"],
    ["\\square \\leq \\square", "□ ≤ □"],
    ["\\square \\geq \\square", "□ ≥ □"],
    ["\\square \\propto \\square", "□ ∝ □"],
    ["\\square \\cdot \\square", "□ · □"],
    ["\\square \\times \\square", "□ × □"],
  ]],
  ["Functions", [
    ["\\sin(\\square)", "sin"],
    ["\\cos(\\square)", "cos"],
    ["\\tan(\\square)", "tan"],
    ["\\exp(\\square)", "exp"],
    ["\\ln(\\square)", "ln"],
    ["\\log_{\\square}(\\square)", "log"],
    ["\\arctan(\\square)", "arctan"],
  ]],
  ["Display environments", [
    ["\\begin{equation}\\n\\square\\n\\end{equation}", "equation"],
    ["\\begin{align}\\n\\square &= \\square \\\\\\\\\\n\\square &= \\square\\n\\end{align}", "align"],
    ["\\begin{cases}\\n\\square & \\text{if } \\square \\\\\\\\\\n\\square & \\text{otherwise}\\n\\end{cases}", "cases"],
  ]],
]

export function allTemplates(): [string, string][] {
  return EQUATION_GROUPS.flatMap(([, items]) => items)
}
