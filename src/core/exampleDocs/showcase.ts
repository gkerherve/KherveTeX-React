// Written here (not ported from Python): everyday documents built with
// the coloured boxes, Insert ▸ Elements, margin notes, fancy tables and
// chapter titles - the Examples tab's "Boxes & elements" gallery.

import * as M from '../model.ts'
import type { Document as KDocument } from '../model.ts'
import { _items, _meta, _p, Author, Document, Section, Text, Title } from '../exampleHelpers.ts'
import { dropCapLatex, iconLatex, marginNoteLatex, widgetText, type WidgetData, type WidgetKind } from '../widgets.ts'

const h = (t: string, level = 1) => Section({ level, children: [Text({ text: t })] })
const w = <K extends WidgetKind>(kind: K, data: WidgetData[K]) => M.rawLatex(widgetText(kind, data))
const note = (text: string, color = '1F6FB5', style: 'plain' | 'line' | 'box' = 'box') =>
  M.inlineRaw(marginNoteLatex({ color, style, text }))
const box = (kind: string, title: string, text: string, color?: string) => M.theorem(kind, title, [M.text(text)], true, color)
const drop = (letter: string, rest: string, color = '000000', lines = 3) =>
  M.inlineRaw(dropCapLatex({ lines, letter, rest, color, margin: false, smallcaps: true }))
const table = (rows: string[][], caption: string, style: string, alignment = '') =>
  M.table({ rows, caption, style, header: true, alignment } as Partial<M.Table> as M.Table)

// ------------------------------------------------------ project status report
export function statusReport(): KDocument {
  return Document({
    meta: _meta({
      title: 'Project status report', author: '', documentclass: 'article', body_font_pt: 11,
      margin_right_cm: 4, preamble_extras: '\\date{}\n', design: { chapter_style: 'bar', colors: 'blue_green' },
    }),
    children: [
      Title({ children: [Text({ text: 'Solar Roof Pilot: status report, month 9' })] }),
      Author({ children: [Text({ text: 'Project office, 24 November 2026' })] }),
      box('summary', 'At a glance', 'On schedule and 4% under budget. Installation is 70% complete; the inverter delay is now resolved. One decision is needed from the board (section 4).'),
      h('Progress'),
      M.paragraph([M.text('Work packages, as a share of the work planned for each'), note('Figures from the site log of 21 November.', '1E5C6B', 'line'), M.text('.')]),
      w('progress', {
        style: 'rounded', length: 'medium', percent: true, color: '1E5C6B',
        items: [{ label: 'Site surveys', value: 100 }, { label: 'Permits', value: 100 }, { label: 'Installation', value: 70 },
          { label: 'Grid connection', value: 35 }, { label: 'Monitoring', value: 10 }],
      }),
      h('Milestones'),
      w('timeline', {
        layout: 'horizontal', color: '1E5C6B',
        events: [{ date: 'Mar', title: 'Kick-off', text: 'Team in place' }, { date: 'Jun', title: 'Permits', text: 'All 40 roofs' },
          { date: 'Sep', title: 'First roofs', text: '12 live' }, { date: 'Dec', title: 'All installed', text: 'Planned' },
          { date: 'Feb', title: 'Handover', text: 'To operations' }],
      }),
      h('Budget'),
      table([['Item', 'Budget (k€)', 'Spent (k€)', 'Forecast (k€)'], ['Panels', '420', '310', '415'],
        ['Inverters', '95', '60', '98'], ['Labour', '180', '120', '170'], ['Contingency', '40', '5', '20'],
        ['Total', '735', '495', '703']], 'Budget and forecast, month 9', 'banded:1E5C6B', 'lrrr'),
      h('Risks and decisions'),
      box('warning', 'Risk: winter weather', 'Roof work stops below 2 °C or in wind above 40 km/h. Two weeks of slack are in the plan; more would move the handover.'),
      box('important', 'Decision needed', 'Approve the extension to the eight school roofs (quote attached, 96 k€) at the December board.'),
      h('Next month'),
      w('checklist', {
        title: '', style: 'box', columns: 2, grey_done: true, color: '1E5C6B',
        items: [{ text: 'Finish roofs 29-34', done: false }, { text: 'Second grid inspection', done: false },
          { text: 'Order spare inverters', done: true }, { text: 'Monitoring dashboard demo', done: false }],
      }),
    ],
  })
}

// --------------------------------------------------------------- one-page CV
export function cvTimeline(): KDocument {
  return Document({
    meta: _meta({
      title: 'CV with timeline', author: '', documentclass: 'article', body_font_pt: 11,
      preamble_extras: '\\date{}\n', design: { chapter_style: 'ruled', colors: 'violet' },
    }),
    children: [
      Title({ children: [Text({ text: 'Dr Alex Morgan' })] }),
      M.author([M.text('Materials scientist   '), M.inlineRaw(iconLatex({ color: '5B2C83', size: 'normalsize', name: 'envelope' })), M.text(' alex.morgan@example.org   '),
        M.inlineRaw(iconLatex({ color: '5B2C83', size: 'normalsize', name: 'phone' })), M.text(' +44 20 7946 0000   '),
        M.inlineRaw(iconLatex({ color: '5B2C83', size: 'normalsize', name: 'linkedin' })), M.text(' alexmorgan')]),
      _p('Surface scientist with ten years of X-ray photoelectron spectroscopy, thin-film growth and data analysis, looking for a lead role in battery materials.'),
      h('Experience'),
      w('timeline', {
        layout: 'vertical', color: '5B2C83',
        events: [{ date: '2022-', title: 'Senior scientist, Northbridge Batteries', text: 'Lead XPS and ToF-SIMS for cathode coatings; team of four.' },
          { date: '2018-22', title: 'Research fellow, University of Leeds', text: 'Atomic layer deposition of oxide films; 14 papers.' },
          { date: '2014-18', title: 'PhD, University of Manchester', text: 'Thesis: interfaces in oxide heterostructures.' }],
      }),
      h('Skills'),
      w('progress', {
        style: 'thin', length: 'medium', percent: false, color: '5B2C83',
        items: [{ label: 'XPS / surface analysis', value: 95 }, { label: 'Thin-film growth', value: 85 },
          { label: 'Python and data analysis', value: 80 }, { label: 'Project management', value: 70 }, { label: 'French', value: 60 }],
      }),
      h('Selected publications'),
      _items('Morgan A. et al., Coating NMC811 with alumina by ALD, J. Power Sources 512 (2025).',
        'Morgan A., Shirley backgrounds revisited, Surf. Interface Anal. 55 (2023).',
        'Lee K., Morgan A., Oxygen vacancies at LaAlO3/SrTiO3, Phys. Rev. B 104 (2021).'),
      h('Online'),
      w('qrcode', { url: 'https://orcid.org/0000-0002-1825-0097', size: 2.2, align: 'left', caption: 'ORCID: all publications', color: '5B2C83' }),
    ],
  })
}

// ------------------------------------------------------- programming tutorial
export function codeTutorial(): KDocument {
  return Document({
    meta: _meta({
      title: 'Programming tutorial', author: '', documentclass: 'article', body_font_pt: 11,
      margin_right_cm: 4.2, preamble_extras: '\\date{}\n', design: { chapter_style: 'boxed', colors: 'green' },
    }),
    children: [
      Title({ children: [Text({ text: 'Fitting a straight line in Python' })] }),
      Author({ children: [Text({ text: 'Lesson 3 of Data analysis for scientists' })] }),
      w('checklist', {
        title: 'By the end you will be able to', style: 'circle', columns: 1, grey_done: false, color: '38761D',
        items: [{ text: 'load measurements from a CSV file', done: false }, { text: 'fit y = a x + b with NumPy', done: false },
          { text: 'report the slope with its uncertainty', done: false }],
      }),
      h('Loading the data'),
      M.paragraph([M.text('Keep the data in a plain CSV file, one measurement per line'), note('CSV: values separated by commas; any spreadsheet saves it.', '38761D', 'line'), M.text('.')]),
      w('code', {
        language: 'Python', theme: 'light', numbers: true, frame: true, title: 'load.py',
        code: 'import numpy as np\n\n# two columns: temperature (K), resistance (ohm)\nT, R = np.loadtxt("data.csv", delimiter=",", unpack=True)\nprint(len(T), "points")',
      }),
      box('tip', '', 'np.loadtxt skips lines that start with #, so a header line written as a comment is safe.'),
      h('Fitting'),
      w('code', {
        language: 'Python', theme: 'dark', numbers: true, frame: true, title: 'fit.py',
        code: '(a, b), cov = np.polyfit(T, R, 1, cov=True)\nda, db = np.sqrt(np.diag(cov))\nprint(f"slope = {a:.4f} +/- {da:.4f} ohm/K")',
      }),
      box('warning', '', 'polyfit gives the uncertainty only with cov=True, and only from the scatter of the points: add your instrument error separately.'),
      h('Exercises'),
      w('checklist', {
        title: '', style: 'box', columns: 1, grey_done: true, color: '38761D',
        items: [{ text: 'Plot the data and the fitted line with matplotlib.', done: false },
          { text: 'Fit only the points above 200 K. Does the slope change?', done: false },
          { text: 'Compare with scipy.stats.linregress.', done: false }],
      }),
      box('summary', 'Remember', 'Always report a fitted value with its uncertainty and units, and look at the residuals before trusting a straight line.'),
    ],
  })
}

// ----------------------------------------------------------- magazine article
export function magazineArticle(): KDocument {
  return Document({
    meta: _meta({
      title: 'Magazine feature', author: '', documentclass: 'article', body_font_pt: 11,
      margin_right_cm: 4.5, preamble_extras: '\\date{}\n', design: { chapter_style: 'bignumber', colors: 'red' },
    }),
    children: [
      Title({ children: [Text({ text: 'The quiet return of the night train' })] }),
      Author({ children: [Text({ text: 'Travel feature - six minutes to read' })] }),
      M.paragraph([drop('S', 'leeper', 'A61C1C'), M.text(' trains were written off twenty years ago: too slow, too costly, beaten by cheap flights. Now new lines open every year, '
        + 'and on the busiest routes the berths sell out weeks ahead. What changed is less the trains than the travellers.'),
      note('Europe had 59 night routes in 2026, up from 24 in 2016.', 'A61C1C', 'plain')]),
      h('A hotel that moves'),
      M.paragraph([M.text('The appeal is simple: you board after dinner in one capital and wake up in another, with no airport at either end. '
        + 'Operators have learned to sell the night, not the distance'), note('Most new coaches have two- and four-berth cabins with their own washbasin.', 'A61C1C', 'line'),
      M.text(': breakfast in bed, a shower, a quiet carriage.')]),
      box('custom', 'Did you know?', 'The longest regular night train in Europe runs from Stockholm to Narvik: 1,500 km and nineteen hours, most of it above the Arctic Circle.', '#A61C1C'),
      h('The numbers'),
      table([['Route', 'Hours', 'From (€)', 'By air (h)'], ['Paris - Vienna', '14', '89', '6'], ['Brussels - Prague', '13', '79', '5'],
        ['Zurich - Amsterdam', '12', '69', '5'], ['Stockholm - Berlin', '15', '99', '5']], 'Night trains against a door-to-door flight', 'accent:A61C1C', 'lccc'),
      h('Booking'),
      _p('Berths open three to six months ahead. Book a whole cabin if you travel as two; a single berth in a shared cabin costs about half.'),
      w('qrcode', { url: 'https://www.seat61.com', size: 2.5, align: 'right', caption: 'Routes and booking tips', color: 'A61C1C' }),
    ],
  })
}

// ---------------------------------------------------------------- event flyer
export function eventFlyer(): KDocument {
  return Document({
    meta: _meta({
      title: 'Event programme', author: '', documentclass: 'article', body_font_pt: 11,
      preamble_extras: '\\date{}\n', design: { chapter_style: 'band', colors: 'orange' },
    }),
    children: [
      Title({ children: [Text({ text: 'Open Day: Science in the City' })] }),
      Author({ children: [Text({ text: 'Saturday 14 March 2027 - 10:00 to 17:00 - free, all ages' })] }),
      w('qrcode', { url: 'https://example.org/openday', size: 3.5, align: 'center', caption: 'Scan to book your workshops', color: 'C55A11' }),
      h('The day'),
      w('timeline', {
        layout: 'horizontal', color: 'C55A11',
        events: [{ date: '10:00', title: 'Doors open', text: 'Main hall' }, { date: '11:00', title: 'Liquid nitrogen show', text: 'Lecture theatre' },
          { date: '13:00', title: 'Lab tours', text: 'Every 30 min' }, { date: '15:00', title: 'Robot race', text: 'Atrium' },
          { date: '16:30', title: 'Prizes', text: 'Main hall' }],
      }),
      h('Workshops'),
      table([['Workshop', 'Ages', 'Time', 'Room'], ['Build a battery from lemons', '6+', '10:30', 'Lab 2'], ['Extract your own DNA', '10+', '11:30', 'Lab 4'],
        ['Code a light show', '12+', '14:00', 'IT suite'], ['Microscopes: tiny worlds', 'All', 'All day', 'Lab 1']], 'Workshops (book with the QR code)', 'header:C55A11', 'lccc'),
      h('Before you come'),
      w('checklist', {
        title: '', style: 'circle', columns: 2, grey_done: false, color: 'C55A11',
        items: [{ text: 'Book your workshops', done: false }, { text: 'Closed shoes for the labs', done: false },
          { text: 'A packed lunch, or the café', done: false }, { text: 'A camera', done: false }],
      }),
      box('info', 'Getting here', 'Five minutes from Central station on foot. There is no parking on site; the Park and Ride bus stops at the door every 15 minutes.'),
    ],
  })
}

const icon = (name: string, color = '1F6FB5', size: 'normalsize' | 'large' | 'Large' | 'huge' = 'normalsize') =>
  M.inlineRaw(iconLatex({ color, size, name }))

// --------------------------------------------------------------- business plan
export function businessPlan(): KDocument {
  return Document({
    meta: _meta({
      title: 'Greenleaf Coffee: business plan 2027', author: '', documentclass: 'article', body_font_pt: 11,
      design: { title_style: 'band', page_edge: 'band', chapter_style: 'bar', colors: 'green' },
    }),
    children: [
      Title({ children: [Text({ text: 'Greenleaf Coffee: business plan 2027' })] }),
      Author({ children: [Text({ text: 'Three cafés, one roastery, zero waste' })] }),
      h('Where we are'),
      _p('Greenleaf opened its first café in 2023. Two years on, the three cafés are profitable and the roastery supplies twelve offices. These are the figures the plan starts from.'),
      w('gauge', { style: 'ring', color: '38761D', items: [{ label: 'Seats filled (avg.)', value: 72 }, { label: 'Waste recycled', value: 94 }, { label: 'Return customers', value: 61 }] }),
      w('pullquote', { text: 'Good coffee should leave nothing behind but the taste.', author: 'Maya Chen, founder', style: 'bar', color: '38761D' }),
      h('Sales'),
      table([['Quarter', 'Cafés (k€)', 'Roastery (k€)'], ['Q1', '210', '45'], ['Q2', '245', '58'], ['Q3', '262', '71'], ['Q4', '288', '90']], 'Sales in 2026', 'banded:38761D', 'lrr'),
      w('chart', { type: 'bar', title: 'Sales in 2026 (k€)', size: 'medium', legend: true, color: '38761D', labels: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: 'Cafés', values: [210, 245, 262, 288] }, { name: 'Roastery', values: [45, 58, 71, 90] }] }),
      h('How the plan works'),
      w('steps', { layout: 'horizontal', color: '38761D', steps: [{ title: 'Roast', text: 'In-house, small batches' }, { title: 'Sell', text: 'Cafés and offices' },
        { title: 'Collect', text: 'Cups and grounds back' }, { title: 'Reuse', text: 'Compost and new cups' }] }),
      w('sidebar', { title: 'In numbers', position: 'right', color: '38761D', text: 'Staff: 34\nCups a day: 2,400\nOffice clients: 12\n\nTarget 2027: a fourth café and 30 office clients.' }),
      _p('The fourth café opens in spring in the university quarter, where a survey of 600 students found that two in three would switch to a café that takes its cups back. '
        + 'The roastery doubles its capacity at the same time, so that the office contracts, which pay monthly and in advance, grow from twelve to thirty. '
        + 'Both steps are paid for from this year\'s profit and a bank loan of 180 k€ over five years.'),
      h('Timetable'),
      w('gantt', { periods: 12, unit: 'Month', grid: true, color: '38761D', tasks: [
        { name: 'Lease and fit-out', start: 1, end: 3 }, { name: 'Hire and train', start: 2, end: 4 }, { name: 'Café 4 opens', start: 4, end: 4, milestone: true },
        { name: 'Second roaster', start: 3, end: 6 }, { name: 'Office sales drive', start: 5, end: 12 }, { name: 'Year review', start: 12, end: 12, milestone: true }] }),
      box('important', 'What we ask', 'Approval of the 180 k€ loan and of the lease for the university quarter by the end of January.'),
    ],
  })
}

// --------------------------------------------------------------- product review
export function productReview(): KDocument {
  return Document({
    meta: _meta({
      title: 'Product review', author: '', documentclass: 'article', body_font_pt: 11, preamble_extras: '\\date{}\n',
      design: { chapter_style: 'ruled', colors: 'orange' },
    }),
    children: [
      Title({ children: [Text({ text: 'Review: the Trailhead 40 hiking backpack' })] }),
      Author({ children: [Text({ text: 'Tested over 300 km in the Lake District and the Alps' })] }),
      w('rating', { max: 5, symbol: 'stars', show_value: true, color: 'F9A825', items: [{ label: 'Comfort', value: 4.5 }, { label: 'Build quality', value: 5 },
        { label: 'Weather protection', value: 3.5 }, { label: 'Pockets and access', value: 4 }, { label: 'Value for money', value: 4 }] }),
      w('pullquote', { text: 'The most comfortable 40-litre pack I have carried, let down only by its rain cover.', author: '', style: 'marks', color: 'C55A11' }),
      h('What we liked'),
      M.paragraph([icon('check-circle', '2E7D32', 'large'), M.text(' The ventilated back panel kept us cool on long climbs, and the hip belt spreads the load well even at 12 kg.')]),
      M.paragraph([icon('check-circle', '2E7D32', 'large'), M.text(' The front zip opens the whole pack, so nothing has to come out to reach the bottom.')]),
      h('What could be better'),
      M.paragraph([icon('times', 'C62828', 'large'), M.text(' The rain cover is thin and blew off twice in strong wind.')]),
      M.paragraph([icon('times', 'C62828', 'large'), M.text(' The hip-belt pockets are too small for a modern phone.')]),
      h('Where the weight goes'),
      w('chart', { type: 'pie', title: 'Pack weight, 1.35 kg', size: 'medium', legend: true, color: 'C55A11', labels: ['Frame and back', 'Fabric', 'Hip belt', 'Zips and buckles', 'Rain cover'],
        series: [{ name: 'Grams', values: [480, 390, 230, 170, 80] }] }),
      box('summary', 'Verdict', 'Four and a half stars: a light, comfortable pack for long days. Buy a better rain cover separately.'),
    ],
  })
}

// --------------------------------------------------------- research project plan
export function researchPlan(): KDocument {
  return Document({
    meta: _meta({
      title: 'Research project plan', author: '', documentclass: 'article', body_font_pt: 11,
      design: { title_style: 'framed', page_edge: 'thumb', chapter_style: 'boxed', colors: 'violet' },
    }),
    children: [
      Title({ children: [Text({ text: 'Cleaner Cathodes: a three-year research plan' })] }),
      Author({ children: [Text({ text: 'PhD project, Department of Materials, 2027-2030' })] }),
      h('The method'),
      w('steps', { layout: 'vertical', color: '5B2C83', steps: [
        { title: 'Make', text: 'Coat NMC811 powders with 1-5 nm of alumina by atomic layer deposition.' },
        { title: 'Measure', text: 'XPS and ToF-SIMS of the surface before and after cycling.' },
        { title: 'Cycle', text: 'Coin cells at 1C for 500 cycles, three cells per coating.' },
        { title: 'Model', text: 'Fit the capacity fade and relate it to the coating thickness.' }] }),
      h('Results so far'),
      _p('A table can become a chart: click in the table, then Table Layout > Chart from Table. The chart under this table was made that way.'),
      table([['Coating', 'Capacity 1st (mAh/g)', 'Capacity 500th (mAh/g)'], ['None', '201', '142'], ['1 nm', '199', '168'], ['2 nm', '196', '177'], ['5 nm', '188', '174']],
        'Capacity before and after 500 cycles', 'header:5B2C83', 'lcc'),
      w('chart', { type: 'bar', title: '', size: 'medium', legend: true, color: '5B2C83', labels: ['None', '1 nm', '2 nm', '5 nm'],
        series: [{ name: 'Capacity 1st (mAh/g)', values: [201, 199, 196, 188] }, { name: 'Capacity 500th (mAh/g)', values: [142, 168, 177, 174] }] }),
      w('gauge', { style: 'half', color: '5B2C83', items: [{ label: 'Samples made', value: 40 }, { label: 'Cells tested', value: 25 }, { label: 'Thesis written', value: 5 }] }),
      h('Timetable'),
      w('gantt', { periods: 12, unit: 'Quarter', grid: true, color: '5B2C83', tasks: [
        { name: 'Literature review', start: 1, end: 2 }, { name: 'ALD coatings', start: 2, end: 6 }, { name: 'Surface analysis', start: 3, end: 8 },
        { name: 'Cell cycling', start: 4, end: 10 }, { name: 'First paper', start: 6, end: 6, milestone: true }, { name: 'Modelling', start: 7, end: 11 },
        { name: 'Thesis', start: 10, end: 12 }, { name: 'Viva', start: 12, end: 12, milestone: true }] }),
    ],
  })
}
