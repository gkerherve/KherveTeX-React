// The Spelling panel's logic (khervedoc/spelling_panel.py, SpellingPanel
// without its widgets): every spelling mistake of the document in a list.
//
// It is not an autocorrector. The underline shows mistakes where they
// are; this panel lists them all, so none is missed in a long document.
// Click a mistake to go to it on the page (it is selected there), pick the
// right spelling among the suggestions and press Change; or Ignore it,
// Ignore all of that word, or Add it to the dictionary. Nothing changes
// until the user confirms it, one mistake (or one word, Change all) at a
// time. After each fix the next mistake is selected and shown.
//
// The list follows the document: it is checked again a moment after each
// edit while the panel is open. It lists the document in the editor (in a
// project, the open document).
import type { Misspelling } from '../editor/spellList.ts'
import type { SpellHighlighter } from '../spell/spellcheck.ts'

// What the panel needs of the editor (EditorApi's spelling part).
export interface SpellingEditor {
  misspellings(): Misspelling[]
  selectRange(start: number, end: number): void
  replaceRange(start: number, end: number, word: string, text: string): boolean
}

type Key = string

// One mistake, as Ignore remembers it: the word and the text around it,
// which an edit elsewhere in the document leaves as it is.
function key(m: Misspelling): Key {
  return JSON.stringify([m.word, m.before, m.after])
}

export function summary(n: number): string {
  if (n === 0) return 'No spelling mistakes found.'
  return `${n} spelling mistake${n !== 1 ? 's' : ''}`
}

export class SpellingPanelModel {
  items: Misspelling[] = []
  current = -1
  suggestions: string[] = []
  // The suggestion picked (index in suggestions), -1 for none.
  chosenIndex = -1
  summaryText = ''
  // Mistakes the user ignored one by one, this session.
  private ignored = new Set<Key>()
  private serial = 0
  private listeners = new Set<() => void>()

  private editor: () => SpellingEditor | null
  private sh: () => SpellHighlighter

  constructor(editor: () => SpellingEditor | null, sh: () => SpellHighlighter) {
    this.editor = editor
    this.sh = sh
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }

  version = (): number => this.serial

  private changed(): void {
    this.serial += 1
    for (const l of this.listeners) l()
  }

  chosen(): string | null {
    return this.chosenIndex >= 0 ? this.suggestions[this.chosenIndex] ?? null : null
  }

  // Check the document again. The row selected stays selected (the same
  // mistake, else the one now in its place), or `select`; `go` shows it
  // on the page.
  refresh(select: number | null = null, go = false): void {
    let keep: Key | null = null
    if (select === null && this.current >= 0 && this.current < this.items.length) {
      keep = key(this.items[this.current])
      select = this.current
    }
    const ed = this.editor()
    const sh = this.sh()
    this.items = ed && sh.isAvailable() ? ed.misspellings().filter(m => !this.ignored.has(key(m))) : []
    let row = -1
    if (keep !== null) row = this.items.findIndex(m => key(m) === keep)
    if (row < 0 && select !== null && this.items.length) row = Math.min(Math.max(select, 0), this.items.length - 1)
    this.setCurrent(row, false)
    this.summaryText = sh.isAvailable() ? summary(this.items.length) : 'The spelling dictionary is not available.'
    this.changed()
    if (go) this.goToCurrent()
  }

  private setCurrent(row: number, go: boolean): void {
    this.current = row
    this.fillSuggestions()
    if (go) this.goToCurrent()
  }

  // Select the index-th mistake (and one of its suggestions), as a click
  // does: the page goes to it.
  select(index: number, suggestion: string | null = null): void {
    this.setCurrent(index >= 0 && index < this.items.length ? index : -1, true)
    if (suggestion !== null) {
      const i = this.suggestions.indexOf(suggestion)
      if (i >= 0) this.chosenIndex = i
    }
    this.changed()
  }

  choose(index: number): void {
    this.chosenIndex = index >= 0 && index < this.suggestions.length ? index : -1
    this.changed()
  }

  goToCurrent(): void {
    const m = this.items[this.current]
    if (m) this.editor()?.selectRange(m.start, m.end)
  }

  private fillSuggestions(): void {
    const m = this.items[this.current]
    this.suggestions = m ? this.sh().suggestions(m.word) : []
    this.chosenIndex = this.suggestions.length ? 0 : -1
  }

  // ---- the buttons ----

  // Change the selected mistake to the selected suggestion, then show the
  // next mistake.
  change(): void {
    const i = this.current
    const m = this.items[i]
    const repl = this.chosen()
    if (!m || repl === null) return
    this.editor()?.replaceRange(m.start, m.end, m.word, repl)
    this.afterFix(i)
  }

  // Change every mistake spelled as the selected one.
  changeAll(): void {
    const i = this.current
    const m = this.items[i]
    const repl = this.chosen()
    if (!m || repl === null) return
    const ed = this.editor()
    // From the end, so the earlier positions stay right.
    for (const o of [...this.items].reverse()) {
      if (o.word === m.word) ed?.replaceRange(o.start, o.end, m.word, repl)
    }
    this.afterFix(i)
  }

  ignore(): void {
    const m = this.items[this.current]
    if (!m) return
    this.ignored.add(key(m))
    this.afterFix(this.current)
  }

  ignoreAll(): void {
    const m = this.items[this.current]
    if (!m) return
    this.sh().ignoreWord(m.word)
    this.afterFix(this.current)
  }

  addToDictionary(): void {
    const m = this.items[this.current]
    if (!m) return
    this.sh().addToDictionary(m.word)
    this.afterFix(this.current)
  }

  // The mistake at i is gone: the next one takes its row.
  private afterFix(i: number): void {
    this.current = -1
    this.refresh(i, true)
  }
}
