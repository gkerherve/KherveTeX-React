// Ports tests/test_spelling_panel.py: every spelling mistake of the
// document in a list, to go to each one and fix it, ignore it or add it
// to the dictionary. Nothing is corrected until the user says so.
import { readFileSync } from 'node:fs'
import { EditorState, TextSelection } from 'prosemirror-state'
import { beforeEach, describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { SpellChecker } from '../src/spell/spellchecker.ts'
import { contextAround, SpellHighlighter } from '../src/spell/spellcheck.ts'

const sc = SpellChecker.fromGzipJson(new Uint8Array(readFileSync('public/dict/en.json.gz')))
import { SpellingPanelModel } from '../src/app/spellingPanel.ts'
import { docFromPM, docToPM } from '../src/editor/convert.ts'
import { misspellings, replaceWord } from '../src/editor/spellList.ts'

let H = new SpellHighlighter(sc)

const doc = () => M.document([
  M.section(1, [M.text('Introduction')]),
  M.paragraph([M.text('The quick brwon fox jumps over the lazy dog.')]),
  M.mathBlock('\\alpha + \\betaa = \\gammma'),
  M.paragraph([M.text('Another brwon dog, and a mistkae here.')]),
])

// The visual editor's spelling part over an EditorState.
function editorOver(d: M.Document) {
  let state = EditorState.create({ doc: docToPM(d) })
  return {
    get state() { return state },
    misspellings: () => misspellings(state.doc, H),
    selectRange: (a: number, b: number) => {
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, a, b)))
    },
    replaceRange: (a: number, b: number, w: string, t: string) => {
      const tr = replaceWord(state, a, b, w, t)
      if (tr) state = state.apply(tr)
      return tr !== null
    },
  }
}

let ed: ReturnType<typeof editorOver>
let panel: SpellingPanelModel

const texts = () => docFromPM(ed.state.doc, doc().meta).children
  .filter((b): b is M.Paragraph => b.type === 'Paragraph')
  .map(b => b.children.map(c => ('text' in c ? c.text : '')).join(''))
const words = () => panel.items.map(m => m.word)
const selected = () => ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to)

beforeEach(() => {
  H = new SpellHighlighter(sc)
  ed = editorOver(doc())
  panel = new SpellingPanelModel(() => ed, () => H)
  panel.refresh()
})

describe('test_spelling_panel', () => {
  it('test_context_around_cuts_at_a_word', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve'
    const a = text.indexOf('seven')
    expect(contextAround(text, a, a + 5, 12)).toEqual(['…five six ', ' eight nine…'])
    expect(contextAround('a brwon b', 2, 7)).toEqual(['a ', ' b'])
  })
  it('test_every_mistake_is_listed_in_order', () => {
    expect(words()).toEqual(['brwon', 'brwon', 'mistkae'])
    const m = panel.items[0]
    expect(m.before).toBe('The quick ')
    expect(m.after.startsWith(' fox jumps')).toBe(true)
    expect(panel.summaryText).toBe('3 spelling mistakes')
  })
  it('test_listed_with_the_underline_off', () => {
    H.setEnabled(false)
    panel.refresh()
    expect(panel.items.length).toBe(3)
  })
  it('test_click_goes_to_the_mistake', () => {
    panel.select(2)
    expect(selected()).toBe('mistkae')
  })
  it('test_nothing_changes_until_the_user_confirms', () => {
    panel.select(0)
    expect(texts()[0]).toBe('The quick brwon fox jumps over the lazy dog.')
  })
  it('test_change_fixes_one_and_shows_the_next', () => {
    panel.select(0, 'brown')
    panel.change()
    expect(texts()[0]).toBe('The quick brown fox jumps over the lazy dog.')
    expect(texts()[1]).toBe('Another brwon dog, and a mistkae here.')
    expect(words()).toEqual(['brwon', 'mistkae'])
    expect(panel.current).toBe(0)
    expect(selected()).toBe('brwon')
  })
  it('test_change_all', () => {
    panel.select(1, 'brown')
    panel.changeAll()
    expect(texts().join(' ')).not.toContain('brwon')
    expect(words()).toEqual(['mistkae'])
  })
  it('test_ignore_one_and_ignore_all', () => {
    panel.select(0)
    panel.ignore()
    expect(words()).toEqual(['brwon', 'mistkae'])
    expect(panel.items[0].before).toBe('Another ')
    panel.select(1)
    panel.ignoreAll()
    expect(words()).toEqual(['brwon'])
    expect(texts()[1]).toBe('Another brwon dog, and a mistkae here.')
  })
  it('test_add_to_dictionary_is_kept', () => {
    const kept: string[] = []
    H.onWordAdded = w => kept.push(w)
    panel.select(2)
    panel.addToDictionary()
    expect(kept).toEqual(['mistkae'])
    expect(H.addedWords()).toEqual(['mistkae'])
    expect(words()).toEqual(['brwon', 'brwon'])
  })
  it('test_no_mistakes', () => {
    ed = editorOver(M.document([M.paragraph([M.text('All good here.')])]))
    panel = new SpellingPanelModel(() => ed, () => H)
    panel.refresh()
    expect(panel.items).toEqual([])
    expect(panel.summaryText).toBe('No spelling mistakes found.')
    expect(panel.chosen()).toBe(null)
  })
  it('test_keeps_the_word_format', () => {
    ed = editorOver(M.document([M.paragraph([M.text('A '), M.text('brwon', ['bold']), M.text(' fox.')])]))
    panel = new SpellingPanelModel(() => ed, () => H)
    panel.refresh()
    panel.select(0, 'brown')
    panel.change()
    const p = docFromPM(ed.state.doc, doc().meta).children[0] as M.Paragraph
    expect(p.children).toEqual([M.text('A '), M.text('brown', ['bold']), M.text(' fox.')])
  })
})
