// Written here (not ported from Python): the Math tab and the Science tab's
// Fields (Chem. Eng., Architect, Earth Science) in real documents - a Math
// toolkit tour, a calculus worksheet, a statistics report, a distillation
// design report, an architect's project sheet, a geology field report and
// an optics and circuits lab.

import * as M from '../model.ts'
import type { Document as KDocument } from '../model.ts'
import { _meta, Author, Document, Section, Text, Title } from '../exampleHelpers.ts'
import { CONSTANTS, matrixTex, quantityTex, roundedTex } from '../sciMath.ts'
import { DEFAULTS, widgetText, type WidgetData, type WidgetKind } from '../widgets.ts'

const h = (t: string, level = 1) => Section({ level, children: [Text({ text: t })] })
const w = <K extends WidgetKind>(kind: K, data: Partial<WidgetData[K]> = {}) => M.rawLatex(widgetText(kind, { ...DEFAULTS[kind], ...data } as WidgetData[K]))
const m = (latex: string) => M.mathInline(latex)
const eq = (latex: string, numbered = false, label: string | null = null) => M.mathBlock(latex, numbered, label)
const t = (s: string) => M.text(s)
const para = (...xs: (M.Inline | string)[]) => M.paragraph(xs.map(x => (typeof x === 'string' ? t(x) : x)))
const thm = (kind: string, title: string, ...xs: (M.Inline | string)[]) => M.theorem(kind, title, xs.map(x => (typeof x === 'string' ? t(x) : x)), true)
const constTex = (name: string) => CONSTANTS.find(([n]) => n === name)![1]
const table = (rows: string[][], caption: string, label: string | null = null) =>
  M.table({ rows, caption, label, header: true, style: 'booktabs' })

// ------------------------------------------------------------ Math toolkit
export function mathToolkit(): KDocument {
  return Document({
    meta: _meta({ title: 'Math toolkit', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { colors: 'blue' } }),
    children: [
      Title({ children: [Text({ text: 'The Math tab, tool by tool' })] }),
      Author({ children: [Text({ text: 'Click any equation, graph or diagram: its own tab opens to change it' })] }),
      h('Equations'),
      para('Inline maths sits in the text, as ', m('e^{i\\pi} + 1 = 0'), ' or ', m('\\sum_{k=1}^{n} k = \\tfrac{n(n+1)}{2}'), '. A displayed, numbered equation:'),
      eq('\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}', true, 'eq:gauss'),
      para('The Equation Builder writes fractions, roots, sums and limits from buttons:'),
      eq('\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n} = e \\qquad \\frac{d}{dx}\\sqrt{x^2+1} = \\frac{x}{\\sqrt{x^2+1}}'),
      para('Matrices, from the Matrix button, in any bracket:'),
      eq(`A = ${matrixTex(3, 3, 'bmatrix', 'symbols')} \\qquad I_3 = ${matrixTex(3, 3, 'pmatrix', 'identity')}`),
      h('Numbers'),
      para('Units: a mass of ', m(quantityTex('2.50', '0.01', 'kg')), ', an acceleration of ', m(quantityTex('9.81', '', 'm/s^2')),
        ' and an energy density of ', m(quantityTex('3.6e6', '', 'J/kg')), '.'),
      para('Rounded to its uncertainty, 12.3456 ± 0.0789 is reported as ', m(roundedTex(12.3456, 0.0789, 'cm')), '.'),
      para('Constants: ', m(constTex('Speed of light')), ' and ', m(constTex('Planck constant')), '.'),
      h('Theorems'),
      thm('theorem', 'Pythagoras', 'In a right-angled triangle with legs ', m('a'), ', ', m('b'), ' and hypotenuse ', m('c'), ', ', m('a^2 + b^2 = c^2'), '.'),
      thm('proof', '', 'Arrange four copies of the triangle inside a square of side ', m('a+b'), ': the square left in the middle has area ', m('c^2'),
        ', and also ', m('(a+b)^2 - 4\\cdot\\tfrac{ab}{2} = a^2+b^2'), '.'),
      thm('definition', 'Prime', 'A natural number greater than 1 whose only divisors are 1 and itself.'),
      w('algorithm', {
        title: 'Euclid\'s algorithm', numbers: true,
        code: 'function GCD(a, b)\n  while b ≠ 0\n    r = a mod b\n    a = b\n    b = r\n  return a',
      }),
      h('Graphs and data'),
      w('function', { functions: 'x^3 - 3*x\n2*cos(x)', xmin: -2.5, xmax: 2.5 }),
      w('stats', { kind: 'histogram', bins: 6, xlabel: 'Exam mark (%)', data: '42 48 51 55 57 58 60 61 62 63 64 66 67 68 69 70 71 72 74 75 77 78 81 83 86 90' }),
      w('venn', { sets: 'Even, Prime', regions: 'A: 4\nB: 3\nAB: 1' }),
      w('numberline', { from: -4, to: 6, step: 1, points: '-1: open\n4: closed', intervals: '-1 to 4' }),
      w('geometry', { shape: 'right', a: 4, b: 3, names: 'A, B, C' }),
      w('unitcircle', { angles: '30, 45, 60, 150, 225' }),
      w('triangle', { a: 7, b: 5, c: 6, labels: 'P, Q, R' }),
    ],
  })
}

// ------------------------------------------------ Calculus worksheet
export function calculusWorksheet(): KDocument {
  return Document({
    meta: _meta({ title: 'Calculus and trigonometry worksheet', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n', design: { colors: 'green' } }),
    children: [
      Title({ children: [Text({ text: 'Calculus and trigonometry' })] }),
      Author({ children: [Text({ text: 'Year 12 worksheet 7 - stationary points, inequalities and the unit circle' })] }),
      h('1. Stationary points'),
      para('Find the stationary points of ', m('f(x) = x^3 - 6x^2 + 9x + 1'), ' and decide their nature.'),
      w('function', { functions: 'x^3 - 6*x^2 + 9*x + 1\n3*x^2 - 12*x + 9', xmin: -0.5, xmax: 4.5, ymin: '-4', ymax: '8' }),
      para('Setting the derivative to zero:'),
      eq("f'(x) = 3x^2 - 12x + 9 = 3(x-1)(x-3) = 0 \\quad\\Longrightarrow\\quad x = 1 \\text{ or } x = 3", true),
      para('Since ', m("f''(x) = 6x - 12"), ', ', m("f''(1) = -6 < 0"), ' gives a maximum at ', m('(1, 5)'), ' and ', m("f''(3) = 6 > 0"), ' a minimum at ', m('(3, 1)'), '.'),
      h('2. Inequalities'),
      para('Solve ', m('x^2 - 2x - 8 \\le 0'), ' and show the answer on a number line.'),
      eq('(x-4)(x+2) \\le 0 \\quad\\Longrightarrow\\quad -2 \\le x \\le 4'),
      w('numberline', { from: -5, to: 6, step: 1, points: '-2: closed\n4: closed', intervals: '-2 to 4' }),
      h('3. The unit circle'),
      para('Read the exact values of sine and cosine from the unit circle, and find all ', m('\\theta \\in [0, 2\\pi)'), ' with ', m('\\sin\\theta = \\tfrac12'), '.'),
      w('unitcircle', { angles: '30, 150, 210, 330', projections: true }),
      eq('\\sin\\theta = \\tfrac12 \\quad\\Longrightarrow\\quad \\theta = \\frac{\\pi}{6} \\text{ or } \\theta = \\frac{5\\pi}{6}'),
      h('4. Triangles'),
      para('In triangle PQR, ', m('p = 7'), ', ', m('q = 5'), ' and ', m('r = 6'), '. Find the largest angle.'),
      w('triangle', { a: 7, b: 5, c: 6, labels: 'P, Q, R', angles: true }),
      eq('\\cos P = \\frac{q^2 + r^2 - p^2}{2qr} = \\frac{25 + 36 - 49}{60} = \\frac{1}{5} \\quad\\Longrightarrow\\quad P \\approx 78.5^\\circ'),
      h('5. Area under a curve'),
      w('function', { functions: 'sqrt(x)\n0.5*x', xmin: 0, xmax: 5 }),
      para('The curves ', m('y = \\sqrt{x}'), ' and ', m('y = x/2'), ' meet at ', m('x = 0'), ' and ', m('x = 4'), '; the area between them is'),
      eq('\\int_0^4 \\left(\\sqrt{x} - \\frac{x}{2}\\right)dx = \\left[\\frac{2}{3}x^{3/2} - \\frac{x^2}{4}\\right]_0^4 = \\frac{16}{3} - 4 = \\frac{4}{3}', true),
    ],
  })
}

// --------------------------------------------------- Statistics report
export function statisticsReport(): KDocument {
  const sleep = '5.1 5.6 5.9 6.0 6.2 6.3 6.4 6.5 6.6 6.7 6.8 6.9 7.0 7.0 7.1 7.2 7.2 7.3 7.4 7.5 7.6 7.7 7.8 8.0 8.1 8.3 8.6 9.0'
  return Document({
    meta: _meta({ title: 'Student wellbeing survey', author: '', documentclass: 'article', body_font_pt: 11, design: { colors: 'blue_green' } }),
    children: [
      Title({ children: [Text({ text: 'Sleep and study: a student wellbeing survey' })] }),
      Author({ children: [Text({ text: 'Statistics coursework - 28 respondents, November 2026' })] }),
      h('Summary'),
      para('Twenty-eight first-year students recorded their average nightly sleep for two weeks and answered three questions on their habits. ',
        'The mean sleep was ', m(quantityTex('7.1', '0.8', 'h')), ' (mean ± standard deviation); one in four slept less than 6.5 hours.'),
      h('Distribution of sleep'),
      w('stats', { kind: 'histogram', bins: 6, xlabel: 'Average sleep per night (h)', data: sleep }),
      w('stats', { kind: 'boxplot', bins: 6, xlabel: 'Average sleep per night (h)', data: sleep }),
      table([['Statistic', 'Value'], ['Mean', '7.1 h'], ['Median', '7.05 h'], ['Standard deviation', '0.81 h'], ['Interquartile range', '6.45 - 7.65 h']], 'Summary statistics of nightly sleep', 'tab:sleep'),
      h('Habits'),
      para('Of the 28, 15 studied after 11 pm, 12 drank coffee after 4 pm and 9 did both:'),
      w('venn', { sets: 'Late study, Late coffee', regions: 'A: 6\nB: 3\nAB: 9' }),
      para('The probability that a student chosen at random does both, given that they study late, is'),
      eq('P(C \\mid L) = \\frac{P(C \\cap L)}{P(L)} = \\frac{9/28}{15/28} = 0.6', true),
      h('A model'),
      para('Sleep was roughly normal: the density of ', m('\\mathcal{N}(7.1,\\,0.81^2)'), ' is drawn below with the mean and one standard deviation either side.'),
      w('function', { functions: 'exp(-(x-7.1)^2/(2*0.81^2))/(0.81*sqrt(2*3.14159))', xmin: 4.5, xmax: 9.7 }),
      thm('remark', 'Caveat', 'Twenty-eight volunteers are not a random sample of all students: the result describes this group only.'),
    ],
  })
}

// ------------------------------------------- Chemical engineering report
export function distillationReport(): KDocument {
  return Document({
    meta: _meta({ title: 'Ethanol recovery column - design report', author: '', documentclass: 'article', body_font_pt: 11, design: { colors: 'blue', chapter_style: 'ruled' } }),
    children: [
      Title({ children: [Text({ text: 'Ethanol recovery column: preliminary design' })] }),
      Author({ children: [Text({ text: 'Process Design Group 4 - CENG 3010' })] }),
      h('Process description'),
      para('A dilute ethanol-water stream from fermentation is preheated and fed to a continuous distillation column. ',
        'The overhead vapour is condensed and part of it returned as reflux; the bottoms leave as wastewater.'),
      w('pfd', {
        units: [['T-1', 'tank', '0', '1', 'Fermenter broth'], ['P-1', 'centrifugal pump', '3', '0', 'Feed pump'], ['E-1', 'heat exchanger', '6', '0', 'Feed preheater'],
          ['C-1', 'scrubber', '9.5', '1', 'Distillation column'], ['E-2', 'condenser', '13', '3', 'Overhead condenser'], ['D-1', 'drum', '13', '-1', 'Bottoms drum']],
        streams: [['T-1', 'P-1', 'main', '1'], ['P-1', 'E-1', 'main', '2'], ['E-1', 'C-1', 'main', '3'], ['C-1', 'E-2', 'main', '4'], ['C-1', 'D-1', 'main', '5']],
      }),
      h('Stream table'),
      w('streamtable', {
        title: 'Stream conditions', streams: '1, 2, 3, 4, 5',
        rows: [['Temperature', '°C', '32', '32', '85', '78', '99'], ['Pressure', 'bar', '1.0', '3.2', '2.9', '1.0', '1.1'],
          ['Mass flow', 'kg/h', '5000', '5000', '5000', '520', '4480'], ['Ethanol', 'wt%', '10', '10', '10', '91', '0.6'], ['Water', 'wt%', '90', '90', '90', '9', '99.4']],
      }),
      h('Mass balance'),
      w('massbalance', {
        title: 'Overall balance', unit: 'kg/h', ins: 'Feed', outs: 'Distillate, Bottoms',
        rows: [['Ethanol', '500', '', '', '473', '27', ''], ['Water', '4500', '', '', '47', '4453', '']],
      }),
      para('Ethanol recovery: ', m('473/500 = 94.6\\,\\%'), '.'),
      h('Number of stages'),
      para('For a first estimate the column is treated with a constant relative volatility of 2.5, in mole fractions of ethanol after the ',
        'stripping section has concentrated the feed to ', m('x_F = 0.30'), '. With a saturated liquid feed (', m('q = 1'), ') the minimum reflux ratio is ',
        m('R_{min} = 1.53'), '; at ', m('R = 2.5'), ' the McCabe-Thiele construction steps off the stages between the operating lines and the equilibrium curve:'),
      w('mccabe', { alpha: 2.5, xF: 0.3, xD: 0.85, xB: 0.03, q: 1, R: 2.5 }),
      eq('y = \\frac{R}{R+1}x + \\frac{x_D}{R+1} = 0.714\\,x + 0.243', true),
      h('Safety'),
      w('hazard', { pictograms: ['flame', 'exclam'], signal: 'Danger', statements: 'H225\nH319\nP210\nP233\nP305+P351+P338' }),
    ],
  })
}

// ------------------------------------------------ Architect's project sheet
export function architectureSheet(): KDocument {
  return Document({
    meta: _meta({ title: 'Garden studio - planning drawings', author: '', documentclass: 'article', body_font_pt: 10, design: { colors: 'grayscale' } }),
    children: [
      Title({ children: [Text({ text: 'Garden studio, 14 Elm Road' })] }),
      Author({ children: [Text({ text: 'Planning application drawings - ground floor' })] }),
      h('Ground floor plan'),
      w('floorplan', {
        rooms: [['Studio', '0', '0', '5.5', '4'], ['Shower room', '5.5', '0', '2', '2.2'], ['Store', '5.5', '2.2', '2', '1.8'], ['Deck', '0', '4', '7.5', '1.6']],
        openings: [['Door', '2.5', '4', '1.6', 'h'], ['Window', '0.8', '0', '2.4', 'h'], ['Window', '0', '1.2', '1.6', 'v'], ['Door', '5.5', '0.6', '0.8', 'v'], ['Door', '5.5', '2.8', '0.8', 'v']],
      }),
      w('scalebar', { scale: '1:50', length: 4, north: true, angle: 20 }),
      h('Room schedule'),
      w('rooms', {
        rows: [['Studio', '5.5', '4', 'Engineered oak', 'Vaulted ceiling, roof light'], ['Shower room', '2', '2.2', 'Porcelain tiles', 'Extract fan'],
          ['Store', '2', '1.8', 'Painted concrete', ''], ['Deck', '7.5', '1.6', 'Hardwood decking', 'Covered by roof overhang']],
      }),
      para('The schedule totals 42 m² with the deck; the internal floor area is ', m('22.0 + 4.4 + 3.6 = 30.0\\,\\mathrm{m^2}'), ', within the 30 m² permitted-development limit.'),
      h('Revisions'),
      w('revisions', { rows: [['P1', '10 Oct 2026', 'First issue for comment', 'LK'], ['P2', '18 Nov 2026', 'Shower room enlarged; deck widened to 1.6 m', 'LK']] }),
      w('titleblock', {
        firm: 'Kerr Studio Architects', project: 'Garden studio', client: 'Mr and Mrs Patel', title: 'Ground floor plan and schedule',
        number: 'GS-A-100', scale: '1:50 @ A3', date: 'Nov 2026', drawn: 'LK', checked: 'DM', revision: 'P2',
      }),
    ],
  })
}

// --------------------------------------------------- Geology field report
export function geologyFieldReport(): KDocument {
  return Document({
    meta: _meta({ title: 'Field report - Kilve foreshore', author: '', documentclass: 'article', body_font_pt: 11, design: { colors: 'orange' } }),
    children: [
      Title({ children: [Text({ text: 'Lias of the Kilve foreshore, Somerset' })] }),
      Author({ children: [Text({ text: 'Second-year mapping project - field week 2' })] }),
      h('Succession'),
      para('The cliff exposes interbedded limestones and shales of the Blue Lias, resting on the red mudstones of the Mercia Mudstone Group. ',
        'Bed thicknesses were measured with a Jacob\'s staff along the line of section.'),
      w('stratcol', {
        title: 'Kilve cliff section',
        rows: [['Head deposits', '2', 'conglomerate', 'Quaternary'], ['Limestone-shale rhythms', '14', 'limestone', 'Jurassic'], ['Paper shales', '6', 'shale', 'Jurassic'],
          ['Grey siltstone', '4', 'siltstone', 'Triassic'], ['Red mudstone', '10', 'shale', 'Triassic']],
      }),
      h('Joint orientations'),
      para('Thirty-two joint strikes measured on the wave-cut platform cluster around 160°, parallel to the Watchet fault system:'),
      w('rose', { values: '150, 152, 155, 158, 158, 160, 161, 162, 163, 165, 165, 167, 168, 170, 172, 175, 60, 62, 65, 68, 70, 72, 75, 80, 110, 115, 120, 140, 145, 148, 185, 190', bin: 15, bidirectional: true }),
      h('Pebble lithologies'),
      para('Clasts from the head deposits were point-counted (100 per site) and plotted by quartz, feldspar and lithic fragments:'),
      w('ternary', {
        a: 'Q (quartz)', b: 'F (feldspar)', c: 'L (lithics)',
        rows: [['Site 1', '62', '8', '30'], ['Site 2', '55', '12', '33'], ['Site 3', '70', '5', '25'], ['Site 4', '48', '15', '37']],
      }),
      h('Fossils'),
      table([['Bed', 'Fauna', 'Abundance'], ['L4', 'Psiloceras planorbis', 'common'], ['L7', 'Gryphaea arcuata', 'abundant'], ['S2', 'crinoid ossicles', 'rare']], 'Fossils found by bed'),
      w('scalebar', { scale: '1:10 000', length: 5, north: true, angle: 0 }),
      w('hazard', { pictograms: ['exclam'], signal: 'Warning', statements: 'Rock falls from the cliff: keep 10 m from its foot\nTide: check the times, the platform floods quickly' }),
    ],
  })
}

// ------------------------------------------------------ Optics and circuits
export function opticsCircuitsLab(): KDocument {
  return Document({
    meta: _meta({ title: 'Optics and circuits practical', author: '', documentclass: 'article', body_font_pt: 11, design: { colors: 'violet' } }),
    children: [
      Title({ children: [Text({ text: 'Lenses, circuits and waves' })] }),
      Author({ children: [Text({ text: 'First-year physics practical - session 5' })] }),
      h('1. A converging lens'),
      para('An object 1.5 cm tall stands 12 cm from a lens of focal length 8 cm. The ray diagram locates the image:'),
      w('optics', { lens: 'converging', focal: 8, object: 12, height: 1.5 }),
      eq('\\frac{1}{v} = \\frac{1}{f} - \\frac{1}{u} = \\frac{1}{8} - \\frac{1}{12} \\quad\\Longrightarrow\\quad v = 24\\,\\mathrm{cm},\\qquad m = -\\frac{v}{u} = -2', true),
      h('2. Resistors in parallel'),
      w('circuit', { layout: 'parallel', components: 'battery 6 V\nresistor R1 = 20 Ω\nresistor R2 = 30 Ω\nammeter A' }),
      eq('\\frac{1}{R} = \\frac{1}{20} + \\frac{1}{30} \\quad\\Longrightarrow\\quad R = 12\\,\\Omega,\\qquad I = \\frac{6}{12} = 0.5\\,\\mathrm{A}'),
      table([['R (Ω)', 'V (V)', 'I measured (A)', 'I predicted (A)'], ['20', '6.0', '0.31', '0.30'], ['30', '6.0', '0.20', '0.20'], ['12 (both)', '6.0', '0.49', '0.50']], 'Currents through each branch'),
      h('3. Forces on a slope'),
      w('forces', { object: 'slope', angle: 25, forces: 'Weight mg: 270, 1.6\nNormal N: 65, 1.45\nFriction F: 155, 0.7' }),
      para('On a 25° slope the block starts to slide when ', m('\\tan\\theta = \\mu_s'), ', giving ', m('\\mu_s = 0.47'), '.'),
      h('4. Standing waves'),
      w('wave', { kind: 'standing', wavelength: 2, amplitude: 1, cycles: 2, labels: true, second: false }),
      para('With a 1.20 m string vibrating in its third harmonic, ', m('\\lambda = 0.80\\,\\mathrm{m}'), '; at 120 Hz the wave speed is ', m(quantityTex('96', '2', 'm/s')), '.'),
      h('5. The hydrogen spectrum'),
      w('levels', {}),
      eq('E_n = -\\frac{13.6\\,\\mathrm{eV}}{n^2}, \\qquad \\frac{1}{\\lambda} = R_\\infty\\left(\\frac{1}{2^2} - \\frac{1}{n^2}\\right)', true),
      w('feynman', { process: 'compton', labels: ['e⁻', 'γ', 'e⁻', 'γ', 'e⁻'] }),
    ],
  })
}
