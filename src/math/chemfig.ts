// Palette templates and the preview document for the chemfig structure
// editor — khervedoc/chemfig.py.
//
// chemfig is TikZ and cannot be drawn by the math typesetter at all, so the
// live preview compiles a real standalone document with tectonic (see
// buildPreviewDoc and ChemfigDialog). The source the user builds is
// inserted verbatim as a RawLatex block, so the compiled document draws
// native, vector chemfig.
import type { TemplateGroup } from './equations.ts'

// Tab-navigable empty slot, reused from the equation editor: it compiles
// inside \chemfig{} (as an empty box) so a partial structure still renders.
export const PLACEHOLDER = '\\square'

// Each entry is [latex_fragment, label]. Some groups hold whole constructs
// (\chemfig{...}, \schemestart...\schemestop); others hold fragments meant
// to drop inside an existing \chemfig{}. Arrow labels are text mode, and
// \square is math-only, so label placeholders are wrapped in $...$.
export const CHEMFIG_GROUPS: TemplateGroup[] = [
  ["Structures", [
    ["\\chemfig{\\square}", "chemfig{}"],
    ["\\chemfig{*6(=-=-=-)}", "benzene"],
    ["\\chemfig{CH_3-CH_2-OH}", "ethanol"],
    ["\\chemfig{[:30]CH_3O-C(=[:120]O)-CH(-[:-90]CH_3)-S-C(=[:120]S)-S-[4]CH_2CH_2CH_2CH_3}", "MBTPA"],
    ["\\chemfig{CH_2=CH-C(=[:120]O)-O-CH_2CH_2-R}", "acrylate"],
    ["\\chemfig{[6]-(-[2])(-[6])-[@{op}]CH_2-CH(-[6]C(=[:-120]O)-O-R)-[@{cl}]}", "repeat unit"],
  ]],
  ["Molecules", [
    ["\\chemfig{H-[:37.5]O-[:-37.5]H}", "water"],
    ["\\chemfig{N(-[:90]H)(-[:210]H)-[:-30]H}", "ammonia"],
    ["\\chemfig{C(-[:90]H)(-[:180]H)(-[:-90]H)-H}", "methane"],
    ["\\chemfig{O=C=O}", "CO2"],
    ["\\chemfig{CH_3-OH}", "methanol"],
    ["\\chemfig{H_2C=O}", "formaldehyde"],
    ["\\chemfig{CH_3-C(=[:90]O)-OH}", "acetic acid"],
    ["\\chemfig{CH_3-C(=[:90]O)-CH_3}", "acetone"],
    ["\\chemfig{H_2N-C(=[:90]O)-NH_2}", "urea"],
    ["\\chemfig{HO-OH}", "peroxide"],
  ]],
  ["Hydrocarbons", [
    ["\\chemfig{CH_3-CH_3}", "ethane"],
    ["\\chemfig{CH_3-CH_2-CH_3}", "propane"],
    ["\\chemfig{-[:30]-[:-30]-[:30]}", "butane (skel.)"],
    ["\\chemfig{-[:30]-[:-30]-[:30]-[:-30]-[:30]}", "hexane (skel.)"],
    ["\\chemfig{CH_3-CH(-[:90]CH_3)-CH_3}", "isobutane"],
    ["\\chemfig{H_2C=CH_2}", "ethylene"],
    ["\\chemfig{HC~CH}", "acetylene"],
    ["\\chemfig{CH_2=CH-CH=CH_2}", "butadiene"],
  ]],
  ["Aromatics", [
    ["\\chemfig{*6(=-=-=-)}", "benzene"],
    ["\\chemfig{*6(=-=-=(-CH_3)-)}", "toluene"],
    ["\\chemfig{*6(=-=-=(-OH)-)}", "phenol"],
    ["\\chemfig{*6(=-=-=(-NH_2)-)}", "aniline"],
    ["\\chemfig{*6(=-=-=(-CH=CH_2)-)}", "styrene"],
    ["\\chemfig{*6(=-=-=(-CHO)-)}", "benzaldehyde"],
    ["\\chemfig{*6(=-=-=(-COOH)-)}", "benzoic acid"],
    ["\\chemfig{*6(=-=-=(-NO_2)-)}", "nitrobenzene"],
    ["\\chemfig{*6(=(-CH_3)-=-(-CH_3)=-)}", "p-xylene"],
    ["\\chemfig{*6(=-(*6(-=-=-))=-=-)}", "naphthalene"],
  ]],
  ["Heterocycles", [
    ["\\chemfig{N*6(-=-=-=)}", "pyridine"],
    ["\\chemfig{O*5(-=-=-)}", "furan"],
    ["\\chemfig{S*5(-=-=-)}", "thiophene"],
    ["\\chemfig{[:-90]HN*5(-=-=-)}", "pyrrole"],
    ["\\chemfig{N*6(-=N-=-=)}", "pyrimidine"],
    ["\\chemfig{O*6(------)}", "THP (pyran)"],
  ]],
  ["Rings", [
    ["*6(=-=-=-)", "benzene"],
    ["**6(------)", "aromatic"],
    ["*6(------)", "cyclohexane"],
    ["*5(-----)", "cyclopentane"],
    ["*4(----)", "cyclobutane"],
    ["*3(---)", "cyclopropane"],
    ["*7(-------)", "cycloheptane"],
    ["*6(=-=-=(-\\square)-)", "substituted"],
  ]],
  ["Bonds", [
    ["-", "single"],
    ["=", "double"],
    ["~", "triple"],
    ["-[:30]", "angle"],
    ["-[::30]", "rel. angle"],
    ["-[,1.5]", "long bond"],
    [">", "wedge up"],
    ["<", "wedge down"],
    [">:", "hash up"],
    ["<:", "hash down"],
    [">|", "plain wedge"],
    ["<|", "plain hash"],
  ]],
  ["Groups", [
    ["-OH", "hydroxyl"],
    ["(=[:120]O)", "carbonyl"],
    ["-CHO", "aldehyde"],
    ["-C(=[:120]O)-OH", "carboxyl"],
    ["-C(=[:120]O)-O-", "ester"],
    ["-C(=[:120]O)-NH_2", "amide"],
    ["-O-", "ether"],
    ["-NH_2", "amine"],
    ["-NO_2", "nitro"],
    ["-CH_3", "methyl"],
    ["-C~N", "nitrile"],
    ["-SH", "thiol"],
    ["-SO_3H", "sulfonic"],
    ["-O-PO_3H_2", "phosphate"],
    ["-F", "fluoro"],
    ["-Cl", "chloro"],
    ["-Br", "bromo"],
    ["-I", "iodo"],
  ]],
  ["Stereo", [
    ["\\chemfig{\\square-C(<[:110]\\square)(<:[:70]\\square)-\\square}", "chiral C"],
    ["(<[:60]\\square)", "wedge sub"],
    ["(<:[:120]\\square)", "hash sub"],
    ["\\chemfig{\\square-C(-[:90]\\square)(-[:-90]\\square)-\\square}", "Fischer"],
    ["\\chemfig{R-C(-[:135]H)=C(-[:45]H)-R}", "cis alkene"],
    ["\\chemfig{R-C(-[:135]H)=C(-[:-45]H)-R}", "trans alkene"],
  ]],
  ["Bio", [
    ["\\chemfig{H_2N-CH_2-C(=[:90]O)-OH}", "glycine"],
    ["\\chemfig{H_2N-CH(-[:-90]CH_3)-C(=[:90]O)-OH}", "alanine"],
    ["\\chemfig{H_2N-CH(-[:-90]R)-C(=[:90]O)-OH}", "amino acid"],
    ["\\chemfig{\\square-C(=[:90]O)-NH-\\square}", "peptide bond"],
    ["\\chemfig{HO-CH_2-CH(-[:90]OH)-CH_2-OH}", "glycerol"],
    ["\\chemfig{CH_3-CH(-[:90]OH)-C(=[:60]O)-[:-60]OH}", "lactic acid"],
  ]],
  ["Charges", [
    ["\\chemabove{\\square}{\\scriptstyle+}", "cation +"],
    ["\\chemabove{\\square}{\\scriptstyle-}", "anion -"],
    ["\\chemfig{H-\\chemabove{N}{\\scriptstyle+}(-[:90]H)(-[:-90]H)-H}", "ammonium"],
    ["\\chemfig{\\square-\\chemabove{C}{\\scriptstyle+}(-[:90]\\square)-\\square}", "carbocation"],
    ["\\chemfig{\\square-\\chembelow{C}{\\scriptstyle-}(-[:90]\\square)-\\square}", "carbanion"],
    ["\\chemfig{H-\\chemabove{O}{\\scriptstyle+}(-[:90]H)-H}", "hydronium"],
  ]],
  ["Scheme", [
    ["\\schemestart\n\\chemfig{\\square}\n\\arrow\n\\chemfig{\\square}\n\\schemestop", "A -> B"],
    ["\\arrow{->[$\\square$]}", "arrow +label"],
    ["\\arrow{->[$\\square$][$\\square$]}", "label +/-"],
    ["\\arrow{->[$\\Delta$]}", "heat"],
    ["\\arrow{<=>}", "reversible"],
    ["\\arrow{<->}", "resonance"],
    ["\\+", "plus"],
    ["\\schemestart\n\\chemfig{\\square} \\+ \\chemfig{\\square}\n\\arrow{->[$\\square$]}\n\\chemfig{\\square}\n\\schemestop", "A + B -> C"],
  ]],
  ["Polymer", [
    ["-[@{op}]CH_2-CH(-[6]R)-[@{cl}]", "backbone"],
    ["\\polymerdelim[height=6pt,depth=6pt]{op}{cl}", "brackets"],
    ["\\polymerdelim[height=6pt,depth=6pt,indice=$n$]{op}{cl}", "bracket_n"],
    ["\\polymerdelim[height=6pt,depth=6pt,indice=$x$]{op}{cl}", "bracket_x"],
  ]],
]

export function allTemplates(): [string, string][] {
  return CHEMFIG_GROUPS.flatMap(([, items]) => items)
}

// The extra packages a chemfig preview needs beyond chemfig itself. amssymb
// supplies \square (the placeholder); the polymer templates use it too.
const PREVIEW_PACKAGES = ['chemfig', 'amssymb']

// A minimal standalone document that draws body cropped to its bounding
// box, for the live-preview compile.
export function buildPreviewDoc(body: string): string {
  const lines = ['\\documentclass[border=4pt]{standalone}']
  for (const p of PREVIEW_PACKAGES) lines.push(`\\usepackage{${p}}`)
  lines.push('\\begin{document}', body.trim(), '\\end{document}', '')
  return lines.join('\n')
}
