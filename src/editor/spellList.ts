// The Spelling panel's view of the visual editor: every mistake of the
// document's prose with where it is (DocumentEditor.misspellings), and
// the change that corrects one (DocumentEditor.replace_range).
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { contextAround, type SpellHighlighter } from '../spell/spellcheck.ts'

// A text block's text with the document position of each character;
// inline objects read as U+FFFC, which no word contains.
export function blockChars(node: PMNode, start: number): { text: string; pos: number[] } {
  let text = ''
  const pos: number[] = []
  node.forEach((child, off) => {
    if (child.isText) {
      const t = child.text!
      for (let i = 0; i < t.length; i++) { text += t[i]; pos.push(start + off + i) }
    } else {
      text += '￼'
      pos.push(start + off)
    }
  })
  return { text, pos }
}

// One spelling mistake, as the Spelling panel lists it: where it is in
// the document, the word, and the text around it in its paragraph.
export interface Misspelling {
  start: number
  end: number
  word: string
  before: string
  after: string
}

// Every unknown word of the document's prose, in order
// (DocumentEditor.misspellings): the same blocks as the underline.
export function misspellings(doc: PMNode, sh: SpellHighlighter): Misspelling[] {
  const out: Misspelling[] = []
  doc.descendants((node, p) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    const { text, pos } = blockChars(node, p + 1)
    for (const [a, b] of sh.misspelledRanges(text)) {
      if (b <= a) continue
      const [before, after] = contextAround(text, a, b)
      out.push({ start: pos[a], end: pos[b - 1] + 1, word: text.slice(a, b), before, after })
    }
    return false
  })
  return out
}

// The transaction that puts `text` in place of [start, end) if it still
// reads `word`, keeping the word's marks (bold, italic, font), as the
// right-click suggestions do; null when the text moved on.
export function replaceWord(state: EditorState, start: number, end: number, word: string,
  text: string): Transaction | null {
  const doc = state.doc
  if (start < 0 || end > doc.content.size || doc.textBetween(start, end, '\n', '\uFFFC') !== word) return null
  const marks = doc.resolve(start).marksAcross(doc.resolve(end)) ?? []
  return state.tr.replaceWith(start, end, state.schema.text(text, marks))
}
