// Preferences ▸ AutoCorrect, as Word's: text replaced as you type (-->
// becomes →, (c) ©, -- –...) and the first letter of a sentence
// capitalised. Never in raw LaTeX or code blocks.
import { InputRule, inputRules } from 'prosemirror-inputrules'
import type { Plugin } from 'prosemirror-state'
import { AUTOCORRECT_LIST, pref } from '../app/prefs.ts'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function autocorrectPlugin(): Plugin {
  // Chains: "--" gives "–" before "-->" is complete, so "–>" and "–-"
  // finish the arrow and the em dash; "<=" gives "≤" before "<==".
  const pairs: [string, string][] = [
    ...AUTOCORRECT_LIST.slice().sort((a, b) => b[0].length - a[0].length),
    ['–>', '→'], ['–-', '—'], ['≤=', '⇐'], ['≤>', '⇔'], ['<–', '←'],
  ]
  const rules = pairs.map(([from, to]) => new InputRule(new RegExp(esc(from) + '$'), (state, _m, start, end) => {
    if (!pref('autocorrect/replace')) return null
    if (state.selection.$from.parent.type.spec.code) return null
    return state.tr.insertText(to, start, end)
  }))
  rules.push(new InputRule(/(?:^|[.!?]\s+)([a-z])$/, (state, m, _start, end) => {
    if (!pref('autocorrect/capitalise')) return null
    const $p = state.selection.$from
    if ($p.parent.type.spec.code || !$p.parent.isTextblock) return null
    return state.tr.insertText(m[1].toUpperCase(), end - 1, end)
  }))
  return inputRules({ rules })
}
