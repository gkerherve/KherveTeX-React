// Live spell checking: a red wavy underline under unknown words, as the
// SpellHighlighter (spellcheck.py) draws on every text block but math,
// figures, tables' frames and raw LaTeX (_SKIP_STATES).
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { spellHighlighter } from '../spell/shared.ts'
import { blockChars } from './spellList.ts'

export const spellKey = new PluginKey<DecorationSet>('kt-spell')
export const SPELL_REFRESH = 'kt-spell-refresh'

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

// The mistake the Spelling panel went to, highlighted on the page: the
// selection is not drawn while the panel has the focus (Qt draws it
// anyway). It goes when the user moves the caret or edits the word.
export const spellCurrentKey = new PluginKey<DecorationSet>('kt-spell-current')
export const SPELL_CURRENT = 'kt-spell-current'

export function spellCurrentPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: spellCurrentKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, prev) => {
        const at = tr.getMeta(SPELL_CURRENT) as { start: number; end: number } | null | undefined
        if (at !== undefined) {
          return at ? DecorationSet.create(tr.doc, [Decoration.inline(at.start, at.end, { class: 'kt-spell-current' })])
            : DecorationSet.empty
        }
        if (tr.docChanged || tr.selectionSet) return DecorationSet.empty
        return prev
      },
    },
    props: { decorations: state => spellCurrentKey.getState(state) },
  })
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
