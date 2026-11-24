// Written here (not ported from Python): a showcase of the coloured
// callout boxes of Insert > Box (v497), with custom boxes (v498).

import * as M from '../model.ts'
import type { Document as KDocument } from '../model.ts'
import { _meta, _p, Author, Document, Section, Text, Title } from '../exampleHelpers.ts'

type Run = string | [string, string[]]

const runs = (...rs: Run[]): M.Inline[] =>
  rs.map(r => typeof r === 'string' ? Text({ text: r }) : Text({ text: r[0], marks: [...r[1]] }))

// A box of one or more paragraphs: the first starts it, the rest continue it.
function box(kind: string, title: string, paras: Run[][], color?: string): M.Theorem[] {
  return paras.map((p, i) => M.theorem(kind, title, runs(...p), i === 0, color))
}

const h = (t: string) => Section({ level: 1, children: [Text({ text: t })] })

// Every kind of box, what each is for, and boxes of your own.
export function calloutBoxes(): KDocument {
  return Document({
    meta: _meta({
      title: 'Coloured boxes',
      author: '',
      documentclass: 'article',
      body_font_pt: 11,
      preamble_extras: '\\date{}\n',
    }),
    children: [
      Title({ children: [Text({ text: 'Coloured boxes' })] }),
      Author({ children: [Text({ text: 'Insert > Box, beside Insert > Table' })] }),
      _p(
        'A box sets a paragraph apart: a titled, coloured frame that the reader ' +
        'spots at a glance. Put the cursor where the box should go, open ',
        ['Insert', ['bold']], ', and pick a kind from ', ['Box', ['bold']],
        ' in the ', ['Tables & Boxes', ['italic']], ' group. Type inside it as in ' +
        'any paragraph; press Enter for a second paragraph in the same box. ' +
        'In the PDF each box is a breakable tcolorbox, so a long one carries on ' +
        'over the page.',
      ),

      h('The seven built-in boxes'),
      _p('Each kind has its own colour and a heading you can rename.'),
      ...box('note', '', [[
        'A ', ['Note', ['bold']], ' adds something worth knowing that is not ' +
        'part of the main line of the text: the reaction also runs at room ' +
        'temperature, only more slowly.',
      ]]),
      ...box('tip', '', [[
        'A ', ['Tip', ['bold']], ' saves the reader time: press Ctrl+Z to undo ' +
        'inserting a box, the text you typed in it included.',
      ]]),
      ...box('info', '', [[
        ['Information', ['bold']], ' gives background or context: the samples ' +
        'were stored at 4 °C for no more than a week before measurement.',
      ]]),
      ...box('important', '', [[
        'Use ', ['Important', ['bold']], ' for what must not be missed: ' +
        'reports are due on Friday 12 December at noon.',
      ]]),
      ...box('warning', '', [[
        'A ', ['Warning', ['bold']], ' points out a risk of a wrong result or ' +
        'lost work: the calibration drifts if the instrument has warmed up for ' +
        'less than thirty minutes.',
      ]]),
      ...box('danger', '', [[
        ['Danger', ['bold']], ' is for harm to people or equipment: hydrofluoric ' +
        'acid burns are not felt at first. Wear nitrile gloves and a face ' +
        'shield, and keep calcium gluconate gel within reach.',
      ]]),
      ...box('summary', '', [
        [['Key points', ['bold']], ' close a section with what to remember:'],
        ['Boxes are inserted from Insert > Box.'],
        ['Each paragraph of a box can be as long as you like.'],
        ['The colour and heading can be changed at any time.'],
      ]),

      h('Your own heading'),
      _p(
        'The heading is the kind\u2019s name until you change it. These boxes ' +
        'keep their kind and colour but carry a heading of their own.',
      ),
      ...box('tip', 'Shortcut', [[
        'Select a word and press Ctrl+B to make it bold, inside a box as ' +
        'anywhere else.',
      ]]),
      ...box('warning', 'Before you submit', [[
        'Check that every figure is referred to in the text and that every ' +
        'citation is in the reference list.',
      ]]),
      ...box('note', 'Example 1: a worked calculation', [
        ['A ball thrown up at 12 m/s rises for t = v / g = 12 / 9.81 \u2248 1.22 s.'],
        ['It reaches a height of v\u00b2 / 2g = 144 / 19.62 \u2248 7.3 m before ' +
          'it starts to fall.'],
      ]),

      h('Boxes of your own'),
      _p(
        ['Insert > Box > Custom…', ['bold']], ' asks for a name and a colour. ' +
        'To recolour any box later, click inside it and use ',
        ['Colour…', ['bold']], ' on the Box tab.',
      ),
      ...box('custom', 'Exercise', [[
        'Rewrite the paragraph above with three boxes of your own, each in a ' +
        'different colour.',
      ]], '#7B1FA2'),
      ...box('custom', 'Solution', [[
        'There is no single answer: choose colours that stay readable when the ' +
        'page is printed in grey.',
      ]], '#00897B'),
      ...box('custom', 'Did you know?', [[
        'The first LaTeX release came out in 1984, six years after TeX itself.',
      ]], '#F9A825'),
      ...box('custom', 'Checklist', [
        ['– Title page and abstract'],
        ['– Figures numbered and captioned'],
        ['– Spelling checked'],
      ], '#5D4037'),
      ...box('important', 'A recoloured Important box', [[
        'This one is still an Important box, drawn in navy instead of purple.',
      ]], '#1A237E'),

      h('Good practice'),
      _p(
        'A box draws the eye, so use them sparingly: one or two a page is plenty. ' +
        'Keep the same kind for the same purpose all through a document, so that ' +
        'readers learn that orange means caution and green means a tip.',
      ),
    ],
  })
}
