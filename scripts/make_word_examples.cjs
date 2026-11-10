// Everyday Word documents for the Word import: letters, a memo, minutes,
// a CV, reports, an article, a lab report, a thesis chapter, a proposal, a
// manual, a newsletter, an invoice, homework and an essay, each made the
// way Word's own templates are (built-in heading, title, caption and quote
// styles, real lists, tables, footnotes, headers and footers, equations).
// scripts/import_word_examples.py then opens each in KherveTeX and saves it
// as .ktex (and its LaTeX and PDF).
//
//   npm install --no-save docx@9
//   node scripts/make_word_examples.cjs     # writes examples/word/docx/
//
// docx is not one of the app's dependencies: it is only needed here.
const fs = require('fs')
const path = require('path')
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate')
const {
  AlignmentType, BorderStyle, Document, Footer, FootnoteReferenceRun, Header, HeadingLevel,
  ImageRun, LevelFormat, Math: OMath, MathFraction, MathIntegral, MathRadical, MathRun,
  MathSubScript, MathSum, MathSuperScript, Packer, PageBreak, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableOfContents, TableRow, TabStopType, TextRun, WidthType,
  ExternalHyperlink, SectionType,
} = require('docx')

const ROOT = path.join(__dirname, '..', 'examples', 'word')
const IMG = path.join(ROOT, 'images')
const OUT = path.join(ROOT, 'docx')
fs.mkdirSync(OUT, { recursive: true })

// ---------- styles and lists, as in Word's Normal template ----------

const FONT = 'Calibri'
const HEAD = 'Calibri Light'
const styles = {
  default: {
    document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 160, line: 259 } } },
    title: { run: { font: HEAD, size: 56 }, paragraph: { spacing: { before: 0, after: 120 } } },
    heading1: { run: { font: HEAD, size: 32, color: '2F5496' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 0 } },
    heading2: { run: { font: HEAD, size: 26, color: '2F5496' }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 1 } },
    heading3: { run: { font: HEAD, size: 24, color: '1F3763' }, paragraph: { spacing: { before: 160, after: 60 }, keepNext: true, outlineLevel: 2 } },
  },
  paragraphStyles: [
    { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 28, color: '5A5A5A' }, paragraph: { spacing: { after: 160 } } },
    { id: 'Author', name: 'Author', basedOn: 'Normal', next: 'Normal', run: { size: 24 }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 120 } } },
    { id: 'Abstract', name: 'Abstract', basedOn: 'Normal', next: 'Normal', run: { size: 20, italics: true }, paragraph: { indent: { left: 567, right: 567 }, spacing: { after: 200 } } },
    { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', run: { italics: true, color: '404040' }, paragraph: { indent: { left: 864, right: 864 }, alignment: AlignmentType.CENTER, spacing: { before: 200, after: 160 } } },
    { id: 'Caption', name: 'Caption', basedOn: 'Normal', next: 'Normal', run: { size: 18, italics: true, color: '44546A' }, paragraph: { spacing: { after: 200 } } },
    { id: 'Code', name: 'Code', basedOn: 'Normal', next: 'Normal', run: { font: 'Consolas', size: 19 }, paragraph: { spacing: { after: 0 }, shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' } } },
    // A display equation: its m:oMath is wrapped in m:oMathPara below.
    { id: 'DisplayEquation', name: 'Display Equation', basedOn: 'Normal', next: 'Normal', paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 120, after: 120 } } },
  ],
}

const bulletLevels = ['•', '◦', '▪'].map((text, level) => ({
  level, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
}))
const numberLevels = [[LevelFormat.DECIMAL, '%1.'], [LevelFormat.LOWER_LETTER, '%2)'], [LevelFormat.LOWER_ROMAN, '%3.']]
  .map(([format, text], level) => ({
    level, format, text, alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }))
const numbering = { config: [{ reference: 'bullets', levels: bulletLevels }, { reference: 'numbers', levels: numberLevels }] }

// ---------- helpers ----------

// Text with **bold**, *italic*, _underline_, ^super^ and ~sub~ marks.
function runs(s, base = {}) {
  const out = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|\^[^^]+\^|~[^~]+~)/g
  let at = 0
  for (const m of s.matchAll(re)) {
    if (m.index > at) out.push(new TextRun({ text: s.slice(at, m.index), ...base }))
    const t = m[0]
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, ...base }))
    else if (t.startsWith('*')) out.push(new TextRun({ text: t.slice(1, -1), italics: true, ...base }))
    else if (t.startsWith('_')) out.push(new TextRun({ text: t.slice(1, -1), underline: {}, ...base }))
    else if (t.startsWith('^')) out.push(new TextRun({ text: t.slice(1, -1), superScript: true, ...base }))
    else out.push(new TextRun({ text: t.slice(1, -1), subScript: true, ...base }))
    at = m.index + t.length
  }
  if (at < s.length) out.push(new TextRun({ text: s.slice(at), ...base }))
  return out
}
const P = (s, o = {}) => new Paragraph({ children: typeof s === 'string' ? runs(s) : s, ...o })
const H1 = s => new Paragraph({ text: s, heading: HeadingLevel.HEADING_1 })
const H2 = s => new Paragraph({ text: s, heading: HeadingLevel.HEADING_2 })
const H3 = s => new Paragraph({ text: s, heading: HeadingLevel.HEADING_3 })
const Title = s => new Paragraph({ text: s, heading: HeadingLevel.TITLE })
const Sub = s => new Paragraph({ text: s, style: 'Subtitle' })
const Cap = s => new Paragraph({ children: runs(s), style: 'Caption' })
const Quote = s => new Paragraph({ children: runs(s), style: 'Quote' })
const Code = lines => lines.map(l => new Paragraph({ children: [new TextRun(l)], style: 'Code' }))
const Bullets = (items, level = 0) => items.flatMap(it => Array.isArray(it)
  ? Bullets(it, level + 1)
  : [new Paragraph({ children: runs(it), numbering: { reference: 'bullets', level } })])
let listInstance = 0
const Numbers = (items) => {
  const instance = ++listInstance
  const walk = (xs, level) => xs.flatMap(it => Array.isArray(it) ? walk(it, level + 1)
    : [new Paragraph({ children: runs(it), numbering: { reference: 'numbers', level, instance } })])
  return walk(items, 0)
}
const Break = () => new Paragraph({ children: [new PageBreak()] })
function Figure(file, widthPx, caption) {
  const png = fs.readFileSync(path.join(IMG, file))
  // PNG width and height from its IHDR.
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [
      new ImageRun({ type: 'png', data: png, transformation: { width: widthPx, height: Math.round(widthPx * h / w) } })] }),
    Cap(caption),
  ]
}
// A table at `widths` (DXA), the first row a shaded header.
function Grid(rows, widths, { header = true, align = [] } = {}) {
  const total = widths.reduce((a, b) => a + b, 0)
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'A6A6A6' }
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: header && i === 0,
      children: r.map((c, j) => new TableCell({
        width: { size: widths[j], type: WidthType.DXA },
        borders: { top: border, bottom: border, left: border, right: border },
        shading: header && i === 0 ? { type: ShadingType.CLEAR, fill: 'D9E2F3' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: runs(String(c), header && i === 0 ? { bold: true } : {}),
          alignment: align[j] === 'r' ? AlignmentType.RIGHT : align[j] === 'c' ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { after: 0 } })],
      })),
    })),
  })
}
// Equations.
const R = s => new MathRun(s)
const sup = (b, e) => new MathSuperScript({ children: [].concat(b), superScript: [].concat(e) })
const sub = (b, s) => new MathSubScript({ children: [].concat(b), subScript: [].concat(s) })
const frac = (n, d) => new MathFraction({ numerator: [].concat(n), denominator: [].concat(d) })
const sqrt = (x, deg) => new MathRadical({ children: [].concat(x), degree: deg ? [].concat(deg) : undefined })
const sum = (x, lo, hi) => new MathSum({ children: [].concat(x), subScript: [].concat(lo), superScript: [].concat(hi) })
const integral = (x, lo, hi) => new MathIntegral({ children: [].concat(x), subScript: [].concat(lo), superScript: [].concat(hi) })
const M = (...parts) => new OMath({ children: parts.flat() })
// A display equation, numbered "(n)" when `n` is given.
const Eq = (parts, n) => new Paragraph({ style: 'DisplayEquation',
  children: [M(parts), ...(n ? [new TextRun({ text: `(${n})` })] : [])] })
const pageFooter = (left = '') => ({ default: new Footer({ children: [new Paragraph({
  tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
  children: [new TextRun({ text: left, size: 18, color: '7F7F7F' }), new TextRun({ text: '\t', size: 18 }),
    new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '7F7F7F' })] })] }) })
const pageHeader = s => ({ default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
  children: [new TextRun({ text: s, size: 18, color: '7F7F7F' })] })] }) })
const A4 = { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }
const LETTER = { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }

const docs = {}

// ---------- 1. formal letter ----------
docs['01-formal-letter'] = {
  title: 'Formal letter', sections: [{ properties: A4, children: [
    P('Department of Chemistry', { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }),
    P('Imperial College London', { alignment: AlignmentType.RIGHT, spacing: { after: 0 } }),
    P('London SW7 2AZ', { alignment: AlignmentType.RIGHT }),
    P('10 November 2026', { alignment: AlignmentType.RIGHT, spacing: { after: 360 } }),
    P('Dr Jane Smith', { spacing: { after: 0 } }), P('Head of Procurement', { spacing: { after: 0 } }),
    P('Scientific Instruments Ltd', { spacing: { after: 0 } }), P('12 Harbour Road', { spacing: { after: 0 } }), P('Bristol BS1 4QA', { spacing: { after: 360 } }),
    P('Dear Dr Smith,'),
    P('**Re: Quotation for a photoelectron spectrometer upgrade**'),
    P('Thank you for your quotation of 3 November for the upgrade of our XPS system. We have reviewed the proposal with the facility users and would like to proceed, subject to the points below.'),
    ...Bullets(['Delivery and installation before *31 March 2027*, so that the work can be funded from this financial year;', 'on-site training for up to **six** members of staff;', 'a two-year warranty covering the analyser and the X-ray source.']),
    P('Please confirm that these terms are acceptable, and send a revised quotation including the cost of the extended warranty. Should you have any questions, I can be reached at the address above.'),
    P('Yours sincerely,', { spacing: { before: 240, after: 720 } }),
    P('Prof. Alex Morgan', { spacing: { after: 0 } }), P('Facility Manager'),
  ] }],
}

// ---------- 2. cover letter ----------
docs['02-cover-letter'] = {
  title: 'Cover letter', sections: [{ properties: A4, children: [
    Title('Sam Taylor'),
    P('sam.taylor@example.com  ·  +44 7700 900123  ·  Manchester', { spacing: { after: 360 } }),
    P('14 November 2026'),
    P('Hiring Manager, Data Science Team', { spacing: { after: 0 } }), P('Northwind Analytics', { spacing: { after: 240 } }),
    P('Dear Hiring Manager,'),
    P('I am writing to apply for the position of **Data Scientist** advertised on your website. With a PhD in physical chemistry and four years of experience building models from large experimental data sets, I believe I can contribute quickly to your forecasting team.'),
    P('In my current role at the Materials Research Centre I:'),
    ...Bullets(['designed an automated pipeline that cut analysis time from days to hours;', 'trained and validated regression models on more than 2 million spectra;', 'presented results to industrial partners and wrote three peer-reviewed papers.']),
    P('I am particularly drawn to Northwind because of its open-source tooling and its emphasis on *reproducible* analysis. I would welcome the opportunity to discuss how my background fits your plans.'),
    P('Thank you for your time and consideration.'),
    P('Kind regards,', { spacing: { before: 240, after: 480 } }), P('Sam Taylor'),
  ] }],
}

// ---------- 3. memo ----------
docs['03-memo'] = {
  title: 'Memo', sections: [{ properties: A4, children: [
    Title('Memorandum'),
    Grid([['To:', 'All laboratory staff'], ['From:', 'Health and Safety Officer'], ['Date:', '10 November 2026'], ['Subject:', 'Annual fire drill and safety inspection']], [1800, 7226], { header: false }),
    P('', { spacing: { after: 120 } }),
    H1('Purpose'),
    P('This memo announces the annual fire drill and the safety inspection of all laboratories, and lists what each group must prepare.'),
    H1('Schedule'),
    Grid([['Date', 'Time', 'Activity'], ['Tue 17 Nov', '10:00', 'Fire drill (whole building)'], ['Wed 18 Nov', '09:00–12:00', 'Inspection of floors 1–2'], ['Thu 19 Nov', '09:00–12:00', 'Inspection of floors 3–4']], [2200, 2200, 4626]),
    P('', { spacing: { after: 120 } }),
    H1('Actions required'),
    ...Numbers(['Clear all corridors and fire exits.', 'Update the chemical inventory, in particular:', ['flammable solvents;', 'compressed gases;', 'oxidisers.'], 'Check that every fume cupboard has a current test sticker.']),
    P('Please contact me if your group cannot be present at the times above.'),
  ] }],
}

// ---------- 4. meeting minutes ----------
docs['04-meeting-minutes'] = {
  title: 'Meeting minutes', sections: [{ properties: A4, footers: pageFooter('Project Board — minutes'), children: [
    Title('Project Board Meeting'),
    Sub('Minutes of the meeting held on 6 November 2026, Room 401'),
    H1('Attendees'),
    ...Bullets(['A. Morgan (chair)', 'J. Lee', 'R. Patel', 'S. Taylor (minutes)']),
    P('**Apologies:** K. Novak'),
    H1('Agenda'),
    ...Numbers(['Minutes of the previous meeting', 'Progress report', 'Budget', 'Any other business']),
    H2('1. Minutes of the previous meeting'),
    P('The minutes of 9 October were approved without changes.'),
    H2('2. Progress report'),
    P('J. Lee reported that work package 2 is on schedule. The prototype passed its first tests; a short report will be circulated before the next meeting.'),
    H2('3. Budget'),
    P('R. Patel presented the spending to date: 48% of the annual budget, in line with the plan. Travel costs are lower than expected.'),
    H2('4. Any other business'),
    P('None.'),
    H1('Action items'),
    Grid([['Action', 'Owner', 'Due'], ['Circulate the prototype test report', 'J. Lee', '20 Nov'], ['Revise the travel budget', 'R. Patel', '27 Nov'], ['Book the room for December', 'S. Taylor', '13 Nov']], [5026, 2000, 2000]),
    P('', { spacing: { after: 120 } }),
    P('*Next meeting: 4 December 2026, 14:00.*'),
  ] }],
}

// ---------- 5. CV ----------
docs['05-cv'] = {
  title: 'CV', sections: [{ properties: A4, children: [
    Title('Dr Alex Morgan'),
    P('Research Scientist  ·  alex.morgan@example.com  ·  London, UK', { spacing: { after: 240 } }),
    H1('Profile'),
    P('Surface scientist with ten years of experience in photoelectron spectroscopy, thin-film growth and data analysis. Comfortable leading small teams and working with industrial partners.'),
    H1('Experience'),
    H2('Senior Research Fellow — Imperial College London (2021–present)'),
    ...Bullets(['Run the XPS facility (40 users, 12 groups).', 'Developed open-source peak-fitting software used in 15 countries.', 'Supervise four PhD students.']),
    H2('Postdoctoral Researcher — University of Manchester (2017–2021)'),
    ...Bullets(['Studied the growth of metal clusters on oxide films.', 'Published 9 papers, 3 as first author.']),
    H1('Education'),
    Grid([['Years', 'Degree', 'Institution'], ['2013–2017', 'PhD, Physical Chemistry', 'University of Bristol'], ['2009–2013', 'MChem, Chemistry (First)', 'University of Bristol']], [1800, 3613, 3613]),
    P('', { spacing: { after: 120 } }),
    H1('Skills'),
    ...Bullets(['**Techniques:** XPS, UPS, LEED, AFM, STM', '**Programming:** Python, MATLAB, LaTeX', '**Languages:** English (native), French (fluent), German (basic)']),
  ] }],
}

// ---------- 6. business report ----------
docs['06-business-report'] = {
  title: 'Business report', footnotes: {
    1: { children: [P('Figures are unaudited and may change in the annual accounts.')] },
    2: { children: [P('Customer satisfaction survey, n = 1 204, October 2026.')] },
  }, sections: [
    { properties: A4, children: [
      new Paragraph({ spacing: { before: 3000 } }),
      Title('Annual Performance Report 2026'),
      Sub('Northwind Analytics Ltd'),
      P('Prepared by the Finance and Strategy Office', { spacing: { before: 600 } }),
      P('November 2026'),
    ] },
    { properties: { ...A4, type: SectionType.NEXT_PAGE }, headers: pageHeader('Annual Performance Report 2026'), footers: pageFooter('Northwind Analytics — confidential'), children: [
      new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }),
      Break(),
      H1('Executive summary'),
      P(['Revenue grew by **18%** to £231k', new FootnoteReferenceRun(1), ', driven by the new subscription service. Operating costs rose more slowly than revenue, and the company returned to profit in the third quarter.'].flatMap(x => typeof x === 'string' ? runs(x) : [x])),
      H1('Financial results'),
      H2('Revenue'),
      P('Quarterly revenue rose steadily through the year (Figure 1).'),
      ...Figure('bars.png', 420, 'Figure 1: Quarterly revenue in 2026.'),
      H2('Costs'),
      P('Table 1 compares the main cost lines with the budget.'),
      Cap('Table 1: Costs against budget (k£).'),
      Grid([['Cost line', 'Budget', 'Actual', 'Difference'], ['Staff', '120', '116', '−4'], ['Equipment', '35', '41', '+6'], ['Travel', '12', '8', '−4'], ['**Total**', '**167**', '**165**', '**−2**']], [3026, 2000, 2000, 2000], { align: ['l', 'r', 'r', 'r'] }),
      P('', { spacing: { after: 120 } }),
      H1('Customers'),
      P(['Satisfaction reached 87%', new FootnoteReferenceRun(2), ', up from 81% last year. The three most requested improvements were:'].flatMap(x => typeof x === 'string' ? runs(x) : [x])),
      ...Numbers(['faster report generation;', 'more export formats;', 'single sign-on.']),
      H1('Outlook'),
      P('For 2027 we expect growth of 10–15%, with investment focused on the platform and on two new hires in customer support.'),
      Quote('“The best way to predict the future is to create it.”'),
    ] },
  ],
}

// ---------- 7. academic article ----------
docs['07-academic-article'] = {
  title: 'Academic article', sections: [{ properties: A4, footers: pageFooter(), children: [
    Title('Damped Oscillations in a Driven Pendulum'),
    new Paragraph({ text: 'A. Morgan, J. Lee and R. Patel', style: 'Author' }),
    new Paragraph({ text: 'Department of Physics, Example University', style: 'Author' }),
    new Paragraph({ style: 'Abstract', children: runs('**Abstract.** We measure the decay of a lightly damped pendulum and compare it with the linear model. The quality factor obtained from the envelope agrees with the value from the resonance width to within 3%. The method is simple enough for an undergraduate laboratory.') }),
    P('*Keywords:* damping; oscillations; quality factor'),
    H1('Introduction'),
    P('A damped harmonic oscillator obeys'),
    Eq([sup(R('d'), R('2')), R('x'), R('/'), R('d'), sup(R('t'), R('2')), R('+'), R('2γ'), R('dx/dt'), R('+'), sup(sub(R('ω'), R('0')), R('2')), R('x'), R('='), R('0')], 1),
    P(['whose solution for light damping (', M(R('γ'), R('<'), sub(R('ω'), R('0'))), ') is a cosine under the envelope ', M(sup(R('e'), [R('−γt')])), '.'].map(x => typeof x === 'string' ? new TextRun(x) : x)),
    H1('Method'),
    P('The pendulum was released from 10° and its angle recorded at 100 Hz for 60 s. The quality factor follows from'),
    Eq([R('Q'), R('='), frac([sub(R('ω'), R('0'))], [R('2γ')]), R('='), frac([R('π')], [R('γT')])], 2),
    H1('Results'),
    P('The measured signal and its fitted envelope are shown in Figure 1; Table 1 summarises the fitted parameters.'),
    ...Figure('decay.png', 430, 'Figure 1: Measured amplitude and fitted exponential envelope.'),
    Cap('Table 1: Fitted parameters.'),
    Grid([['Parameter', 'Value', 'Uncertainty'], ['ω~0~ (rad s^−1^)', '2.001', '0.002'], ['γ (s^−1^)', '0.249', '0.004'], ['Q', '4.02', '0.07']], [3000, 3000, 3026], { align: ['l', 'c', 'c'] }),
    P('', { spacing: { after: 120 } }),
    H1('Conclusion'),
    P('The linear model describes the motion well for amplitudes below 15°. Larger amplitudes would need the full non-linear equation.'),
    H1('References'),
    ...Numbers(['L. D. Landau and E. M. Lifshitz, *Mechanics*, 3rd ed. (Pergamon, 1976).', 'A. P. French, *Vibrations and Waves* (Norton, 1971).', 'J. R. Taylor, *Classical Mechanics* (University Science Books, 2005).']),
  ] }],
}

// ---------- 8. lab report ----------
docs['08-lab-report'] = {
  title: 'Lab report', sections: [{ properties: A4, footers: pageFooter('CHEM 2041 — Lab report'), children: [
    Title('X-ray Diffraction of a Powder Sample'),
    Sub('CHEM 2041 Laboratory · Group 3 · 3 November 2026'),
    H1('Aim'),
    P('To identify the crystal phase of an unknown powder and to estimate its lattice parameter from the positions of the diffraction peaks.'),
    H1('Theory'),
    P('Diffraction occurs when Bragg’s law is satisfied:'),
    Eq([R('nλ'), R('='), R('2d'), R(' sin'), R('θ')], 1),
    P(['For a cubic lattice the spacing of the (', M(R('hkl')), ') planes is'].map(x => typeof x === 'string' ? new TextRun(x) : x)),
    Eq([sub(R('d'), R('hkl')), R('='), frac([R('a')], [sqrt([sup(R('h'), R('2')), R('+'), sup(R('k'), R('2')), R('+'), sup(R('l'), R('2'))])])], 2),
    H1('Method'),
    ...Numbers(['Grind about 0.5 g of the sample in an agate mortar.', 'Load the powder into the sample holder and level the surface.', 'Record a scan from 20° to 85° (2θ) with Cu Kα radiation (λ = 1.5406 Å).', 'Find the peak positions with the analysis software.']),
    H1('Results'),
    ...Figure('xrd.png', 430, 'Figure 1: Diffraction pattern of the unknown powder.'),
    Cap('Table 1: Peak positions and indexing.'),
    Grid([['2θ (°)', 'd (Å)', '(hkl)', 'a (Å)'], ['38.2', '2.354', '(111)', '4.077'], ['44.4', '2.039', '(200)', '4.078'], ['64.6', '1.442', '(220)', '4.078']], [2256, 2256, 2256, 2258], { align: ['c', 'c', 'c', 'c'] }),
    P('', { spacing: { after: 120 } }),
    H1('Discussion'),
    P('The three peaks index to a face-centred cubic lattice with a = 4.078 ± 0.001 Å, which matches gold. The small spread in a is within the error of the peak positions.'),
    H1('Conclusion'),
    P('The powder is gold (fcc, a = 4.078 Å).'),
  ] }],
}

// ---------- 9. thesis chapter ----------
docs['09-thesis-chapter'] = {
  title: 'Thesis chapter', footnotes: {
    1: { children: [P('The same notation is used throughout the thesis.')] },
    2: { children: [P('Values from the NIST database, accessed October 2026.')] },
  }, sections: [{ properties: A4, headers: pageHeader('Chapter 3. Theory of photoemission'), footers: pageFooter(), children: [
    Title('Chapter 3'),
    Sub('Theory of Photoemission'),
    H1('Introduction'),
    P(['This chapter introduces the theory needed to interpret the spectra of the following chapters', new FootnoteReferenceRun(1), '. The photoelectric effect, first explained by Einstein, relates the kinetic energy of an emitted electron to the photon energy.'].flatMap(x => typeof x === 'string' ? runs(x) : [x])),
    Quote('“It is the theory which decides what we can observe.” — A. Einstein'),
    H1('The photoelectric equation'),
    H2('Binding energy'),
    P('Energy conservation gives'),
    Eq([sub(R('E'), R('kin')), R('='), R('hν'), R('−'), sub(R('E'), R('B')), R('−'), R('φ')], '3.1'),
    P(['where ', M(R('φ')), ' is the work function of the spectrometer.'].map(x => typeof x === 'string' ? new TextRun(x) : x)),
    H2('Cross-sections'),
    P(['The intensity of a peak is proportional to its photoionisation cross-section', new FootnoteReferenceRun(2), ' and to the number of atoms probed:'].flatMap(x => typeof x === 'string' ? runs(x) : [x])),
    Eq([R('I'), R('='), R('nσ'), integral([sup(R('e'), [R('−z/λ')]), R('dz')], R('0'), R('∞')), R('='), R('nσλ')], '3.2'),
    H3('Inelastic mean free path'),
    P('The mean free path λ depends on the kinetic energy; for most solids it is between 0.5 and 3 nm in the range used here.'),
    H1('Peak shapes'),
    P('A core-level peak is described by a sum of Gaussian and Lorentzian contributions:'),
    Eq([R('f(E)'), R('='), sum([sub(R('A'), R('i')), R(' '), sub(R('V'), R('i')), R('(E)')], R('i=1'), R('N'))], '3.3'),
    ...Figure('xrd.png', 400, 'Figure 3.1: A spectrum fitted with three components.'),
    H1('Summary'),
    ...Bullets(['The kinetic energy gives the binding energy (Eq. 3.1).', 'Intensities follow cross-sections and the mean free path (Eq. 3.2).', 'Peak shapes are fitted as sums of Voigt functions (Eq. 3.3).']),
  ] }],
}

// ---------- 10. project proposal ----------
docs['10-project-proposal'] = {
  title: 'Project proposal', sections: [{ properties: A4, footers: pageFooter('Project proposal'), children: [
    Title('Open Spectroscopy Toolkit'),
    Sub('A proposal for a two-year software development project'),
    H1('Summary'),
    P('We propose to build an open, documented toolkit for analysing spectroscopy data, to replace the proprietary packages used today in most laboratories.'),
    H1('Objectives'),
    ...Numbers(['Release a stable, tested core library.', 'Provide a graphical interface for non-programmers.', 'Train at least 100 users through online workshops.']),
    H1('Approach'),
    P('The work follows four phases (Figure 1), each ending with a public release.'),
    ...Figure('process.png', 440, 'Figure 1: The four phases of the project.'),
    H1('Timeline'),
    Grid([['Phase', 'Months', 'Deliverable'], ['Plan', '1–3', 'Requirements and design document'], ['Build', '4–15', 'Core library and interface'], ['Test', '16–20', 'Beta release with users'], ['Release', '21–24', 'Version 1.0 and workshops']], [2000, 2000, 5026]),
    P('', { spacing: { after: 120 } }),
    H1('Budget'),
    P('The total requested is **£240,000**, split as in Figure 2.'),
    ...Figure('pie.png', 340, 'Figure 2: Breakdown of the budget.'),
    H1('Risks'),
    Grid([['Risk', 'Likelihood', 'Mitigation'], ['Key developer leaves', 'Low', 'Two developers share each module'], ['Low uptake', 'Medium', 'Early user workshops and feedback']], [3500, 1800, 3726]),
  ] }],
}

// ---------- 11. user manual ----------
docs['11-user-manual'] = {
  title: 'User manual', sections: [{ properties: A4, headers: pageHeader('SpectraView 2.0 — User manual'), footers: pageFooter(), children: [
    Title('SpectraView 2.0'),
    Sub('User manual'),
    new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
    H1('Installation'),
    ...Numbers(['Download the installer from the project website.', 'Run the installer and follow the steps:', ['accept the licence;', 'choose an installation folder;', 'tick “Create a desktop shortcut”.'], 'Start SpectraView from the Start menu.']),
    Quote('Note: administrator rights are needed only for an installation for all users.'),
    H1('Getting started'),
    H2('Opening a file'),
    P('Choose **File ▸ Open** and pick a spectrum (.vms, .csv or .txt). The spectrum appears in the main window.'),
    H2('Command line'),
    P('Spectra can also be converted from the command line:'),
    ...Code(['spectraview convert sample.vms --to csv', 'spectraview fit sample.csv --model voigt --peaks 3']),
    P('', { spacing: { after: 120 } }),
    H1('Keyboard shortcuts'),
    Grid([['Action', 'Windows', 'macOS'], ['Open', 'Ctrl+O', '⌘O'], ['Save', 'Ctrl+S', '⌘S'], ['Fit peaks', 'Ctrl+F', '⌘F'], ['Zoom to fit', 'Ctrl+0', '⌘0']], [3500, 2763, 2763]),
    P('', { spacing: { after: 120 } }),
    H1('Troubleshooting'),
    ...Bullets(['**The window is blank** — update the graphics driver.', '**A file will not open** — check that it is not still being written by the instrument.']),
    P(['More help is available on the ', new ExternalHyperlink({ link: 'https://example.com/spectraview', children: [new TextRun({ text: 'project website', style: 'Hyperlink' })] }), '.'].map(x => typeof x === 'string' ? new TextRun(x) : x)),
  ] }],
}

// ---------- 12. newsletter (two columns) ----------
docs['12-newsletter'] = {
  title: 'Newsletter', sections: [
    { properties: { ...A4 }, children: [
      Title('Department Newsletter'),
      Sub('Issue 14 · Autumn 2026'),
    ] },
    { properties: { ...A4, type: SectionType.CONTINUOUS, column: { space: 708, count: 2 } }, footers: pageFooter('Department Newsletter · Autumn 2026'), children: [
      H1('New instrument arrives'),
      P('The new photoelectron spectrometer was installed in October. It offers a smaller spot size and faster mapping, and is open to all groups from January.'),
      ...Figure('bars.png', 260, 'Figure 1: Instrument bookings per quarter.'),
      H1('Awards'),
      P('Congratulations to **Dr R. Patel**, who received the Young Investigator Award, and to the undergraduate team that won the regional chemistry quiz.'),
      H1('Events'),
      ...Bullets(['12 Dec — Christmas lecture', '15 Jan — Open day', '3 Feb — Careers fair']),
      H1('From the head of department'),
      P('This has been a busy term. I would like to thank everyone who helped with the move into the new building, and especially the technical staff, who kept the laboratories running throughout.'),
      Quote('“Science is a way of thinking much more than it is a body of knowledge.” — Carl Sagan'),
      H1('Contact'),
      P('Send news for the next issue to newsletter@example.com by 1 February.'),
    ] },
  ],
}

// ---------- 13. invoice ----------
docs['13-invoice'] = {
  title: 'Invoice', sections: [{ properties: LETTER, children: [
    Title('Invoice'),
    Grid([['Invoice no.', 'INV-2026-0147'], ['Date', '10 November 2026'], ['Due', '10 December 2026']], [2400, 3000], { header: false }),
    P('', { spacing: { after: 120 } }),
    P('**Bill to:**', { spacing: { after: 0 } }), P('Example University, Accounts Payable', { spacing: { after: 0 } }), P('1 College Road, Oxford OX1 2JD', { spacing: { after: 240 } }),
    Grid([['Description', 'Qty', 'Unit price (£)', 'Amount (£)'], ['XPS analysis, standard (per sample)', '12', '85.00', '1,020.00'], ['Depth profile', '3', '240.00', '720.00'], ['Report and consultation (hours)', '2', '95.00', '190.00'], ['', '', '**Subtotal**', '1,930.00'], ['', '', '**VAT (20%)**', '386.00'], ['', '', '**Total**', '**2,316.00**']], [4560, 1000, 1900, 1900], { align: ['l', 'c', 'r', 'r'] }),
    P('', { spacing: { after: 240 } }),
    P('Payment by bank transfer to sort code 12-34-56, account 12345678, quoting the invoice number.'),
    P('*Thank you for your business.*', { alignment: AlignmentType.CENTER }),
  ] }],
}

// ---------- 14. maths homework ----------
docs['14-maths-homework'] = {
  title: 'Maths homework', sections: [{ properties: A4, footers: pageFooter('MATH 1010 — Problem sheet 5'), children: [
    Title('Problem Sheet 5'),
    Sub('MATH 1010 Calculus · due Friday 20 November'),
    H1('Question 1'),
    P('Evaluate the integral'),
    Eq([integral([sup(R('x'), R('2')), sup(R('e'), R('x')), R('dx')], R('0'), R('1'))]),
    P('*Solution.* Integrating by parts twice,'),
    Eq([integral([sup(R('x'), R('2')), sup(R('e'), R('x')), R('dx')], R('0'), R('1')), R('='), R('[('), sup(R('x'), R('2')), R('−2x+2)'), sup(R('e'), R('x')), sub(R(']'), R('0')), R('^1'), R('='), R('e−2')], 1),
    H1('Question 2'),
    P('Show that'),
    Eq([sum([frac([R('1')], [sup(R('k'), R('2'))])], R('k=1'), R('∞')), R('='), frac([sup(R('π'), R('2'))], [R('6')])], 2),
    P('*Hint.* Use the Fourier series of x^2^ on [−π, π].'),
    H1('Question 3'),
    P(['Solve the quadratic ', M(R('a'), sup(R('x'), R('2')), R('+bx+c=0')), ':'].map(x => typeof x === 'string' ? new TextRun(x) : x)),
    Eq([R('x'), R('='), frac([R('−b±'), sqrt([sup(R('b'), R('2')), R('−4ac')])], [R('2a')])], 3),
    H1('Question 4'),
    P('Find the limit as n → ∞ of (1 + 1/n)^n^, and state the theorem you use.'),
  ] }],
}

// ---------- 15. essay ----------
docs['15-essay'] = {
  title: 'Essay', footnotes: {
    1: { children: [P('Snow, C. P., *The Two Cultures* (Cambridge University Press, 1959), p. 4.')] },
    2: { children: [P('Feynman, R., *The Pleasure of Finding Things Out* (Perseus, 1999).')] },
  }, sections: [{ properties: A4, footers: pageFooter(), children: [
    Title('Why Scientists Should Write Well'),
    new Paragraph({ text: 'Jordan Lee', style: 'Author' }),
    new Paragraph({ text: 'History and Philosophy of Science, Essay 2', style: 'Author' }),
    P(['Scientific results reach other people only through language. C. P. Snow warned that the sciences and the humanities had become “two cultures” unable to talk to each other', new FootnoteReferenceRun(1), '. Sixty years later, the problem is often not the gap between cultures but the gap between a paper and its reader.'].flatMap(x => typeof x === 'string' ? runs(x) : [x]), { spacing: { line: 360, after: 160 } }),
    P('Clear writing is not decoration. A method described ambiguously cannot be repeated, and a result hidden in a long sentence is easily missed. Good writing is therefore part of good science.', { spacing: { line: 360, after: 160 } }),
    H1('The cost of obscurity'),
    P(['Feynman argued that if you cannot explain something simply, you do not really understand it', new FootnoteReferenceRun(2), '. Obscure prose can hide weak reasoning, from the reader and from the writer alike.'].flatMap(x => typeof x === 'string' ? runs(x) : [x]), { spacing: { line: 360, after: 160 } }),
    Quote('“The ability to simplify means to eliminate the unnecessary so that the necessary may speak.” — Hans Hofmann'),
    H1('Conclusion'),
    P('Teaching writing alongside experimental skills would make science more open, more reproducible and more useful to society.', { spacing: { line: 360, after: 160 } }),
    H1('Works cited'),
    P('Feynman, R. *The Pleasure of Finding Things Out*. Perseus, 1999.', { indent: { left: 720, hanging: 720 } }),
    P('Snow, C. P. *The Two Cultures*. Cambridge University Press, 1959.', { indent: { left: 720, hanging: 720 } }),
  ] }],
}

// ---------- write ----------

// Word's display equation: the paragraph's m:oMath inside m:oMathPara.
function wrapDisplayMath(buf) {
  const files = unzipSync(new Uint8Array(buf))
  const f = 'word/document.xml'
  const xml = strFromU8(files[f]).replace(
    /<w:p>(?:(?!<\/w:p>).)*?<w:pStyle w:val="DisplayEquation"\/>(?:(?!<\/w:p>).)*?<\/w:p>/gs,
    p => p.replace(/<m:oMath>(.*?)<\/m:oMath>/s, '<m:oMathPara><m:oMath>$1</m:oMath></m:oMathPara>'))
  files[f] = strToU8(xml)
  return Buffer.from(zipSync(files, { level: 6 }))
}

;(async () => {
  for (const [name, d] of Object.entries(docs)) {
    const doc = new Document({
      creator: 'KherveTeX examples', title: d.title, styles, numbering,
      features: { updateFields: true }, footnotes: d.footnotes, sections: d.sections,
    })
    const out = wrapDisplayMath(await Packer.toBuffer(doc))
    fs.writeFileSync(path.join(OUT, `${name}.docx`), out)
    console.log(`${name}.docx`)
  }
})()
