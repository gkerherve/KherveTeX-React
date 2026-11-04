// Live spell checking: a red wavy underline under unknown words, as the
// SpellHighlighter (spellcheck.py) draws on every text block but math,
// figures, tables' frames and raw LaTeX (_SKIP_STATES).
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { spellHighlighter } from '../spell/shared.ts'

export const spellKey = new PluginKey<DecorationSet>('kt-spell')
export const SPELL_REFRESH = 'kt-spell-refresh'

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

function build(doc: PMNode): DecorationSet {
  const sh = spellHighlighter()
  if (!sh.isEnabled()) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, p) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    const { text, pos } = blockChars(node, p + 1)
    for (const [a, b] of sh.misspelledRanges(text)) {
      if (b > a) decos.push(Decoration.inline(pos[a], pos[b - 1] + 1, { class: 'kt-misspelled' }))
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

export function spellPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: spellKey,
    state: {
      init: (_c, state) => build(state.doc),
      apply: (tr, prev, _old, state) => tr.docChanged || tr.getMeta(SPELL_REFRESH) ? build(state.doc) : prev,
    },
    props: { decorations: state => spellKey.getState(state) },
  })
}
