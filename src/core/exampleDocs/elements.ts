// Written here (not ported from Python): Insert ▸ Elements, Layout ▸
// Margin Note, Table Design ▸ Fancy Styles and Design ▸ Chapter Titles,
// each shown with what it is for.

import * as M from '../model.ts'
import type { Document as KDocument } from '../model.ts'
import { _meta, _p, Author, Document, Section, Text, Title } from '../exampleHelpers.ts'
import { DEFAULTS, dropCapLatex, marginNoteLatex, widgetText } from '../widgets.ts'

const h = (t: string) => Section({ level: 1, children: [Text({ text: t })] })
const raw = (t: string) => M.rawLatex(t)
const note = (text: string, color = '1F6FB5', style: 'plain' | 'line' | 'box' = 'box') =>
  M.inlineRaw(marginNoteLatex({ color, style, text }))

function table(style: string, caption: string): M.Table {
  return M.table({
    rows: [['Sample', 'Mass (g)', 'Yield (\\%)'], ['A', '1.20', '85'], ['B', '0.95', '78'], ['C', '1.41', '91'], ['D', '1.02', '80']],
    caption, style, header: true, alignment: 'lcc',
  } as Partial<M.Table> as M.Table)
}

export function fancyElements(): KDocument {
  return Document({
    meta: _meta({
      title: 'Fancy elements',
      author: '',
      documentclass: 'article',
      body_font_pt: 11,
      // Room in the right margin for the notes.
      margin_right_cm: 4.5,
      preamble_extras: '\\date{}\n',
      design: { chapter_style: 'band', colors: 'blue' },
    }),
    children: [
      Title({ children: [Text({ text: 'Fancy elements' })] }),
      Author({ children: [Text({ text: 'Drop caps, margin notes, checklists, progress bars, timelines, QR codes, code and coloured tables' })] }),
      M.paragraph([
        M.inlineRaw(dropCapLatex({ lines: 3, letter: 'E', rest: 'very', color: '1F6FB5', margin: false, smallcaps: true })),
        M.text(' element on this page is real LaTeX, drawn in the editor as the PDF shows it. Click one: its own tab opens on the '
          + 'ribbon with all its options, Edit… to change its text, Delete to remove it and Close to go back to typing. '
          + 'A double-click opens Edit… at once, and the × in its corner removes it.'),
        note('Drop cap: Insert > Drop Cap, with the caret in a paragraph.'),
      ]),
      _p('The paragraph above begins with a drop cap: a large first letter over three lines, the rest of the word in small capitals. '
        + 'Its tab sets the height (two to five lines), puts the letter in the margin, and changes its colour.'),

      h('Margin notes'),
      M.paragraph([
        M.text('Layout > Margin Note puts a note in the right margin, level with the line it belongs to'),
        note('A note in a box.', '1F6FB5', 'box'),
        M.text('. A note can be plain coloured text, have a line beside it'),
        note('A note with a line beside it.', '2E7D32', 'line'),
        M.text(', or sit in a tinted box, each in any colour'),
        note('Plain coloured text.', 'C62828', 'plain'),
        M.text('. Wide Margin, on the Layout tab and the Margin Note tab, makes the right margin 4.5 cm so the notes have room, as in this document.'),
      ]),

      h('Checklists'),
      _p('Insert > Checklist. Edit… takes one item per line; start a line with [x] to tick it. Boxes or circles, one to three columns, and ticked items in grey.'),
      raw(widgetText('checklist', DEFAULTS.checklist)),
      raw(widgetText('checklist', {
        title: 'Packing list', style: 'circle', columns: 3, grey_done: false, color: '2E7D32',
        items: [{ text: 'Passport', done: true }, { text: 'Tickets', done: true }, { text: 'Charger', done: false },
          { text: 'Adapter', done: false }, { text: 'Camera', done: true }, { text: 'Notebook', done: false }],
      })),

      h('Progress bars'),
      _p('Insert > Progress Bars: one bar per line, "Label: percentage". Rounded, square or thin, three lengths, with or without the figures.'),
      raw(widgetText('progress', DEFAULTS.progress)),
      raw(widgetText('progress', {
        style: 'thin', length: 'long', percent: false, color: 'E65100',
        items: [{ label: 'Python', value: 90 }, { label: 'LaTeX', value: 75 }, { label: 'MATLAB', value: 50 }],
      })),

      h('Timelines'),
      _p('Insert > Timeline: one event per line, "Date | Title | Text". Down the page, or across it.'),
      raw(widgetText('timeline', DEFAULTS.timeline)),
      raw(widgetText('timeline', {
        layout: 'horizontal', color: '6A1B9A',
        events: [{ date: 'Jan', title: 'Kick-off', text: 'Team and plan' }, { date: 'Apr', title: 'Prototype', text: 'First tests' },
          { date: 'Jul', title: 'Trials', text: 'With users' }, { date: 'Oct', title: 'Launch', text: 'Version 1.0' }],
      })),

      h('QR codes'),
      _p('Insert > QR Code asks for a link; readers scan it with a phone. Three sizes, left, centre or right, a caption, any colour.'),
      raw(widgetText('qrcode', { url: 'https://github.com/gkerherve/KherveTeX-React', size: 3, align: 'center', caption: 'kTeX on GitHub', color: '1F3864' })),

      h('Code listings'),
      _p('Insert > Code Listing: program code with its keywords, strings and comments in colour. Thirteen languages, a light, dark or plain theme, line numbers and a frame.'),
      raw(widgetText('code', DEFAULTS.code)),
      raw(widgetText('code', {
        language: 'JavaScript', theme: 'dark', numbers: false, frame: true, title: 'Fetching data',
        code: 'async function load(url) {\n  const res = await fetch(url)  // wait for the answer\n  return res.json()\n}',
      })),

      h('Coloured tables'),
      _p('Click in a table: Table Design > Fancy Styles draws it in one colour. Banded fills the header and every other row, '
        + 'Coloured header fills the header and rules the rows in grey, Accent lines draws only coloured rules. Colour picks the colour.'),
      table('banded:1F6FB5', 'Banded, in blue'),
      table('header:2E7D32', 'Coloured header, in green'),
      table('accent:C62828', 'Accent lines, in red'),

      h('Chapter titles'),
      _p('Design > Chapter Titles sets how each chapter opens (in a document without chapters, each section): a big number, '
        + 'a coloured band (as here), a rule, a boxed number, a side bar, or centred. They take the accent colour of Design > Colours.'),
    ],
  })
}
