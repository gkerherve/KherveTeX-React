// Written here (not ported from Python): the Science tab's tools in use -
// a toolkit tour and four everyday science documents.

import * as M from '../model.ts'
import type { Document as KDocument } from '../model.ts'
import { _meta, _p, Author, Document, Section, Text, Title } from '../exampleHelpers.ts'
import { CONSTANTS, decayTex, matrixTex, nuclideTex, PHYSICS, quantityTex, roundedTex } from '../sciMath.ts'
import { DEFAULTS, widgetText, type WidgetData, type WidgetKind } from '../widgets.ts'

const h = (t: string, level = 1) => Section({ level, children: [Text({ text: t })] })
const w = <K extends WidgetKind>(kind: K, data: Partial<WidgetData[K]> = {}) => M.rawLatex(widgetText(kind, { ...DEFAULTS[kind], ...data } as WidgetData[K]))
const m = (latex: string) => M.mathInline(latex)
const eq = (latex: string) => M.mathBlock(latex, false, null)
const t = (s: string) => M.text(s)
const para = (...xs: M.Inline[]) => M.paragraph(xs)
const box = (kind: string, title: string, text: string) => M.theorem(kind, title, [M.text(text)], true)
const constTex = (name: string) => CONSTANTS.find(([n]) => n === name)![1]
const phys = (name: string) => PHYSICS.find(([n]) => n.startsWith(name))![1]

// ----------------------------------------------------------- the toolkit
export function scienceToolkit(): KDocument {
  return Document({
    meta: _meta({ title: 'Science toolkit', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { colors: 'blue' } }),
    children: [
      Title({ children: [Text({ text: 'The Science tab, tool by tool' })] }),
      Author({ children: [Text({ text: 'Every element can be clicked: its own tab opens, with Edit…, its options, Move, Delete and Close' })] }),
      h('Numbers and units'),
      para(t('Units: the speed of the cart was '), m(quantityTex('1.25', '0.03', 'm/s')), t(', the sample held '), m(quantityTex('6.02e23', '', 'mol^-1')),
        t(' and the furnace ran at '), m(quantityTex('450', '', '°C')), t('.')),
      para(t('Significant figures: 9.8123 ± 0.0234 '), m('\\mathrm{m\\,s^{-2}}'), t(' is reported as '), m(roundedTex(9.8123, 0.0234, 'm/s^2')),
        t('; the product of 2.00 ± 0.02 and 3.00 ± 0.03 is '), m(roundedTex(6, 6 * Math.hypot(0.01, 0.01), '')), t('.')),
      para(t('Constants: '), m(constTex('Planck constant')), t(', '), m(constTex('Boltzmann constant')), t(' and '), m(constTex('Avogadro constant')), t('.')),
      para(t('Nuclides: '), m(nuclideTex('U', 235, 92)), t(' and '), m(nuclideTex('C', 14, 6)), t('; an alpha decay:')),
      eq(decayTex('U', 238, 'alpha')),
      h('Equations'),
      para(t('Physics notation: '), m(phys('Bra-ket')), t(', '), m(phys('Commutator')), t(', '), m(phys('Partial')), t(' and '), m(phys('Norm')), t('.')),
      para(t('Matrices, from the Matrix button:')),
      eq(matrixTex(3, 3, 'bmatrix', 'symbols') + ' \\qquad ' + matrixTex(3, 3, 'pmatrix', 'identity')),
      h('Data and physics'),
      w('plot'),
      w('circuit'),
      w('feynman'),
      h('Chemistry'),
      w('scheme'),
      w('mo'),
      w('bohr', { element: 'Cl' }),
      w('element'),
      w('hazard'),
      h('More physics'),
      w('forces'), w('optics'), w('wave'), w('levels'),
      h('Maths'),
      w('function'), w('numberline'), w('venn'), w('triangle'), w('stats'), w('unitcircle'),
      h('Safety'),
      w('risk'), w('signs'),
      h('Computing and the lab'),
      w('algorithm'),
      w('notebook'),
    ],
  })
}

// ------------------------------------------------------- XPS lab report
export function xpsLabReport(): KDocument {
  const spectrum = 'BE, Measured, Fit\n' + Array.from({ length: 81 }, (_, i) => {
    const x = 536 - i * 0.125
    const g = (c: number, s: number, a: number) => a * Math.exp(-((x - c) ** 2) / (2 * s * s))
    const fit = 200 + g(530.0, 0.55, 2400) + g(531.6, 0.7, 520) + g(532.8, 0.8, 180)
    const noise = Math.round(60 * Math.sin(i * 12.9898) * Math.cos(i * 78.233))
    return `${x.toFixed(3)}, ${Math.round(fit + noise)}, ${Math.round(fit)}`
  }).join('\n')
  return Document({
    meta: _meta({ title: 'XPS lab report', author: '', documentclass: 'article', body_font_pt: 11, design: { chapter_style: 'ruled', colors: 'blue_green' } }),
    children: [
      Title({ children: [Text({ text: 'O 1s of anatase ' }), M.mathInline('\\mathrm{TiO_2}'), Text({ text: ' after annealing' })] }),
      Author({ children: [Text({ text: 'Surface Analysis Lab, report 12' })] }),
      h('Sample'),
      w('element', { elements: 'Ti, O, C', show_mass: true }),
      para(t('The film was 50 nm of anatase on silicon, annealed in air at '), m(quantityTex('450', '5', '°C')), t(' for 2 h. Spectra were taken with Al Kα ('),
        m(quantityTex('1486.6', '', 'eV')), t(') at a pass energy of '), m(quantityTex('20', '', 'eV')), t('.')),
      w('hazard', { pictograms: ['acid', 'skull'], signal: 'Danger', statements: 'H300\nH310\nH314\nP280\nP310' }),
      box('warning', 'Before cleaning the substrates', 'The HF dip above needs the HF kit, calcium gluconate gel at hand and a second person in the lab.'),
      h('The O 1s region'),
      w('plot', { title: 'O 1s', data: spectrum, peaks: '530.0: Ti–O\n531.6: Ti–OH\n532.8: C–O', color: '1E5C6B' }),
      para(t('The lattice oxygen sits at '), m(roundedTex(530.012, 0.0512, 'eV')), t('; the hydroxide shoulder at '), m(roundedTex(531.64, 0.08, 'eV')),
        t(' is '), m(roundedTex(17.4, 1.3, '%')), t(' of the O 1s area.')),
      h('Notebook'),
      w('notebook', { date: '24 Nov 2026', title: 'Sample 12: annealed 2 h at 450 °C', color: '1E5C6B' }),
    ],
  })
}

// --------------------------------------------------- physics problem sheet
export function physicsSheet(): KDocument {
  return Document({
    meta: _meta({ title: 'Physics problem sheet', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { chapter_style: 'boxed', colors: 'violet' } }),
    children: [
      Title({ children: [Text({ text: 'Problem sheet 4: circuits, quanta and nuclei' })] }),
      Author({ children: [Text({ text: 'Year 1 physics - hand in by Friday' })] }),
      h('Useful constants'),
      para(m(constTex('Elementary charge')), t(',  '), m(constTex('Planck constant')), t(',  '), m(constTex('Speed of light')), t(',  '), m(constTex('Electron mass')), t('.')),
      h('A series circuit'),
      w('circuit', { components: 'battery 12 V\nswitch S\nresistor R1 = 220 Ω\nlamp L\nammeter', layout: 'series' }),
      _p('(a) The lamp has a resistance of 60 Ω. Find the current when the switch is closed. (b) What does a voltmeter across R1 read?'),
      h('Two lamps in parallel'),
      w('circuit', { components: 'battery 6 V\nlamp L1\nlamp L2\nvoltmeter', layout: 'parallel' }),
      _p('Each lamp takes 0.5 A. What does the battery supply, and what would happen if L1 failed?'),
      h('A particle in a box'),
      para(t('The energy levels are '), m('E_n = \\frac{n^2 h^2}{8 m L^2}'), t('. Show that '), m(phys('Schrödinger')),
        t(' is satisfied, and evaluate '), m('E_1'), t(' for an electron in a box of '), m(quantityTex('1', '', 'nm')), t('.')),
      h('Radioactive decay'),
      para(t('Complete the decays and name the daughter nuclei:')),
      eq(decayTex('U', 238, 'alpha')),
      eq(decayTex('C', 14, 'beta-')),
      h('Electron-positron annihilation'),
      w('feynman', { process: 'annihilation' }),
      _p('Draw the diagram for e⁻e⁻ scattering instead, and say which particle is exchanged.'),
      h('Rotations'),
      para(t('Show that the rotation matrix below is orthogonal:')),
      eq('R(\\theta) = \\begin{pmatrix}\\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta\\end{pmatrix}'),
    ],
  })
}

// --------------------------------------------------- chemistry practical
export function chemistryPractical(): KDocument {
  return Document({
    meta: _meta({ title: 'Chemistry practical', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { chapter_style: 'bar', colors: 'green' } }),
    children: [
      Title({ children: [Text({ text: 'Practical 7: oxidising ethanol' })] }),
      Author({ children: [Text({ text: 'A-level chemistry, required practical' })] }),
      h('Safety'),
      w('hazard', { pictograms: ['flame', 'flame-O', 'health', 'aqpol'], signal: 'Danger', statements: 'H225\nH272\nH350\nH410\nP210\nP280\nP273' }),
      h('The reaction'),
      w('scheme'),
      _p('Heating under reflux with excess acidified dichromate takes ethanol all the way to ethanoic acid; distilling as it forms stops at ethanal.'),
      h('Background: bonding in oxygen'),
      w('mo', { molecule: 'O2' }),
      para(t('The two unpaired electrons in the '), m('\\pi^*'), t(' orbitals make '), m('\\mathrm{O_2}'), t(' paramagnetic: liquid oxygen sticks between the poles of a magnet.')),
      w('bohr', { element: 'O', color: 'C62828' }),
      w('element', { elements: 'H, C, O, Cr, K' }),
      h('Results'),
      w('notebook', { date: '24 Nov 2026', title: 'Reflux, 20 min', color: '38761D', aim: 'Make ethanoic acid from ethanol.',
        method: 'Reflux 2 cm³ ethanol with 10 cm³ acidified K$_2$Cr$_2$O$_7$, then distil.', observations: 'Orange to green within 5 min; a vinegar smell.', result: '1.4 cm³ of distillate, pH 3.' }),
    ],
  })
}

// ---------------------------------------------------- algorithms handout
export function algorithmsHandout(): KDocument {
  return Document({
    meta: _meta({ title: 'Algorithms handout', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { colors: 'office' } }),
    children: [
      Title({ children: [Text({ text: 'Numerical methods: three algorithms' })] }),
      Author({ children: [Text({ text: 'Computing for scientists, week 6' })] }),
      h('Root finding'),
      w('algorithm'),
      h('Sorting'),
      w('algorithm', { title: 'Insertion sort', code: 'function InsertionSort(A)\n  for i = 2 to n\n    key = A[i]\n    j = i - 1\n    while j > 0 and A[j] > key\n      A[j+1] = A[j]\n      j = j - 1\n    A[j+1] = key\n  return A' }),
      h('Linear systems'),
      para(t('Gaussian elimination solves '), m('A\\mathbf{x} = \\mathbf{b}'), t(' for a general matrix')),
      eq('A = ' + matrixTex(4, 4, 'pmatrix', 'general')),
      w('algorithm', { title: 'Gaussian elimination', code: 'function Solve(A, b)\n  for k = 1 to n - 1\n    for i = k + 1 to n\n      m = A[i][k] / A[k][k]\n      for j = k to n\n        A[i][j] = A[i][j] - m * A[k][j]\n      b[i] = b[i] - m * b[k]\n  return BackSubstitute(A, b)' }),
      _p('The cost is about 2n³/3 operations: doubling n makes it eight times slower.'),
    ],
  })
}

// ------------------------------------------------ lab safety: risk assessment
export function riskAssessment(): KDocument {
  return Document({
    meta: _meta({ title: 'Risk assessment', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { chapter_style: 'band', colors: 'red' } }),
    children: [
      Title({ children: [Text({ text: 'Risk assessment: wet etching of silicon wafers' })] }),
      Author({ children: [Text({ text: 'Clean room 2 - reviewed 24 November 2026 - review again in 12 months' })] }),
      h('In this room'),
      w('signs', { signs: ['goggles', 'gloves', 'coat', 'nofood', 'nophone', 'toxic', 'hot', 'firstaid', 'eyewash', 'shower', 'extinguisher'], captions: true }),
      h('Chemicals'),
      w('hazard', { pictograms: ['acid', 'skull'], signal: 'Danger', statements: 'H300\nH310\nH314\nH330\nP260\nP280\nP310' }),
      box('danger', 'Hydrofluoric acid', 'HF passes through skin without pain at first and attacks bone. Never work alone; calcium gluconate gel must be on the bench before the bottle is opened.'),
      h('Risks before and after controls'),
      w('risk', { risks: 'HF splash on skin (no controls): 3, 5\nHF splash (double gloves, apron, gel): 1, 5\nBurn from hot bath: 3, 3\nInhaling acid fumes (fume cupboard): 2, 3\nDropped wafer, cut: 2, 2' }),
      h('Training record'),
      w('checklist', { title: '', style: 'box', columns: 2, grey_done: false, color: 'A61C1C',
        items: [{ text: 'HF awareness course', done: true }, { text: 'Clean-room induction', done: true }, { text: 'Spill drill this year', done: false }, { text: 'First-aid refresher', done: false }] }),
    ],
  })
}

// ------------------------------------------------------------ maths worksheet
export function mathsWorksheet(): KDocument {
  return Document({
    meta: _meta({ title: 'Maths worksheet', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { chapter_style: 'boxed', colors: 'blue' } }),
    children: [
      Title({ children: [Text({ text: 'Worksheet 9: graphs, sets, triangles and data' })] }),
      Author({ children: [Text({ text: 'Year 10 maths' })] }),
      h('Graphs'),
      para(t('Sketch '), m('y = \\sin x'), t(' and '), m('y = \\tfrac12 x^2 - 2'), t(' on the same axes. Where do they cross?')),
      w('function'),
      h('Inequalities'),
      para(t('Show '), m('-2 \\le x < 3'), t(' on a number line:')),
      w('numberline'),
      h('Sets'),
      _p('In a class, 12 study only physics, 9 only chemistry and 15 only biology. How many study at least two sciences?'),
      w('venn'),
      h('Triangles'),
      _p('A triangle has sides 6, 7 and 8 cm. Find its angles with the cosine rule, then check them against the drawing.'),
      w('triangle', { a: 6, b: 7, c: 8 }),
      w('unitcircle'),
      h('Data'),
      _p('The heights of 30 students are below. Find the mean, median and interquartile range.'),
      w('stats'),
      w('stats', { kind: 'boxplot' }),
      h('Matrices'),
      eq('\\begin{pmatrix} 2 & 1 \\\\ 1 & 3 \\end{pmatrix}\\begin{pmatrix} x \\\\ y \\end{pmatrix} = \\begin{pmatrix} 5 \\\\ 10 \\end{pmatrix}'),
    ],
  })
}

// ---------------------------------------------------------- physics revision
export function physicsRevision(): KDocument {
  return Document({
    meta: _meta({ title: 'Physics revision', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { chapter_style: 'ruled', colors: 'violet' } }),
    children: [
      Title({ children: [Text({ text: 'Physics revision: forces, light, waves and atoms' })] }),
      Author({ children: [Text({ text: 'A-level summary sheet' })] }),
      h('Forces on a slope'),
      w('forces'),
      para(t('Along the slope: '), m('F = mg\\sin\\theta'), t(' when the block is about to slide, so '), m('\\mu = \\tan\\theta'), t('.')),
      h('Lenses'),
      para(t('The lens equation: '), m('\\frac{1}{f} = \\frac{1}{u} + \\frac{1}{v}'), t(', magnification '), m('m = -v/u'), t('.')),
      w('optics'),
      w('optics', { object: 2.5 }),
      h('Waves'),
      para(m('v = f\\lambda'), t('; two waves a quarter of a cycle apart:')),
      w('wave', { second: true }),
      h('The hydrogen atom'),
      para(t('Levels '), m('E_n = -13.6\\,\\mathrm{eV}/n^2'), t('; a photon carries the difference between two levels.')),
      w('levels'),
      w('feynman', { process: 'beta', labels: ['d', 'u', 'e⁻', 'ν̄', 'W⁻'] }),
    ],
  })
}
