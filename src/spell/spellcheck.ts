// Live spell checking for the visual editor: the logic of spellcheck.py's
// SpellHighlighter without the Qt highlighter. The editor asks
// misspelledRanges() for each prose block and underlines what comes back
// with a red wavy line (#d8000c, Qt's SpellCheckUnderline colour).
import { capitalize } from '../core/py.ts'
import { SpellChecker } from './spellchecker.ts'

// Words to skip: pure digits, single letters, anything with a digit,
// or anything containing a backslash (stray LaTeX text). Bracketing
// punctuation and apostrophes are stripped before lookup so contractions
// like "don't" still hit the dictionary.
const WORD_RE = /[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g
const STRIP = "’'’"

export const UNDERLINE_COLOR = '#d8000c'

// Worth-looking-up: at least three letters and alphabetic.
export function isCheckable(word: string): boolean {
  if ([...word].length < 3) return false
  return [...word].every(c => /\p{L}/u.test(c) || "'’-".includes(c))
}

// Characters of the paragraph shown on each side of a mistake in the
// Spelling panel.
export const CONTEXT_CHARS = 30

// The text before and after text[start:end] in its paragraph, for the
// Spelling panel's list: at most `width` characters each side, cut at a
// word, whitespace runs shown as one space, an ellipsis where the
// paragraph goes on. Inline objects (U+FFFC) read as a space.
export function contextAround(text: string, start: number, end: number,
  width = CONTEXT_CHARS): [string, string] {
  const tidy = (s: string) => s.replace(/\uFFFC/g, ' ').replace(/\s+/g, ' ')
  let before = text.slice(0, start)
  let after = text.slice(end)
  if (before.length > width) {
    const cut = before.slice(-width)
    const sp = cut.indexOf(' ')
    before = '…' + (sp >= 0 && sp < width - 1 ? cut.slice(sp + 1) : cut)
  }
  if (after.length > width) {
    const cut = after.slice(0, width)
    const sp = cut.lastIndexOf(' ')
    after = (sp > 0 ? cut.slice(0, sp) : cut) + '…'
  }
  return [tidy(before).replace(/^\s+/, ''), tidy(after).replace(/\s+$/, '')]
}

function stripChars(s: string, chars: string): string {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

function pyIsUpper(s: string): boolean {
  let cased = false
  for (const c of s) {
    if (c.toLowerCase() !== c.toUpperCase()) {
      cased = true
      if (c !== c.toUpperCase()) return false
    }
  }
  return cased
}

export class SpellHighlighter {
  private checker: SpellChecker | null
  private enabled: boolean
  // Cache: word (lowercased) -> true if unknown. Avoids re-doing the
  // dictionary lookup on every keystroke for stable text.
  private unknownCache = new Map<string, boolean>()
  // User additions ("ignore this word in future"). Kept lowercase.
  private ignored = new Set<string>()
  // The words added to the dictionary (not those only ignored), and who
  // keeps them: the app saves them in its settings.
  private added: string[] = []
  onWordAdded: ((word: string) => void) | null = null
  private listeners = new Set<() => void>()

  constructor(checker: SpellChecker | null) {
    this.checker = checker
    this.enabled = checker !== null
  }

  isAvailable(): boolean { return this.checker !== null }

  // The dictionary arrives asynchronously in the app.
  setChecker(checker: SpellChecker): void {
    const wasOff = this.checker === null
    this.checker = checker
    if (wasOff) this.enabled = true
    this.unknownCache.clear()
    this.changed()
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }

  private changed(): void { for (const l of this.listeners) l() }

  isEnabled(): boolean { return this.enabled && this.checker !== null }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return
    this.enabled = on && this.checker !== null
    // Rehighlight everything so existing squiggles are cleared or applied.
    this.changed()
  }

  // Mark `word` as known: "Add to dictionary" in the right-click menu and
  // the Spelling panel. The app keeps the user's words (onWordAdded) so
  // they stay known in later sessions.
  addToDictionary(word: string): void {
    if (!word) return
    this.ignoreWord(word)
    const key = word.toLowerCase()
    if (!this.added.includes(key)) {
      this.added.push(key)
      this.onWordAdded?.(key)
    }
  }

  // Stop flagging `word` for the rest of this session (the Spelling
  // panel's Ignore all).
  ignoreWord(word: string): void {
    if (!word) return
    this.ignored.add(word.toLowerCase())
    this.unknownCache.delete(word.toLowerCase())
    this.changed()
  }

  // The user's own words, kept from earlier sessions.
  loadDictionary(words: Iterable<string>): void {
    for (const w of words) {
      if (w && !this.added.includes(w.toLowerCase())) {
        this.added.push(w.toLowerCase())
        this.ignored.add(w.toLowerCase())
      }
    }
    this.unknownCache.clear()
    this.changed()
  }

  // The words the user added to the dictionary, in order.
  addedWords(): string[] { return [...this.added] }

  private lookup(key: string): boolean {
    let cached = this.unknownCache.get(key)
    if (cached === undefined) {
      cached = this.checker!.unknown([key]).size > 0
      this.unknownCache.set(key, cached)
    }
    return cached
  }

  // True if `word` looks like a checkable English word that the
  // dictionary doesn't know (the context menu's suggestions test).
  isMisspelled(word: string): boolean {
    if (!this.isEnabled() || !word) return false
    if (!isCheckable(word)) return false
    const key = stripChars(word.toLowerCase(), STRIP)
    if (!key || this.ignored.has(key)) return false
    return this.lookup(key)
  }

  // Top correction suggestions, ordered by usage frequency in the bundled
  // corpus, more common first, alphabetical on ties; matched to the case
  // of the input.
  suggestions(word: string, limit = 7): string[] {
    // Only the dictionary is needed: the Spelling panel lists mistakes
    // with the underline turned off too.
    if (this.checker === null || !word) return []
    const checker = this.checker!
    const key = stripChars(word.toLowerCase(), STRIP)
    const cands = checker.candidates(key)
    if (!cands || !cands.size) return []
    const ranked = [...cands].sort((a, b) => {
      const d = checker.wordUsageFrequency(b) - checker.wordUsageFrequency(a)
      return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0
    })
    const caseMatch = (w: string) => {
      if (pyIsUpper(word)) return w.toUpperCase()
      if (pyIsUpper(word.slice(0, 1))) return capitalize(w)
      return w
    }
    return ranked.slice(0, limit).map(caseMatch)
  }

  // [start, end) UTF-16 offsets of the unknown words in a block of prose:
  // what the underline marks, and what the Spelling panel lists (with the
  // underline turned off too).
  misspelledRanges(text: string): [number, number][] {
    if (this.checker === null || !text) return []
    const out: [number, number][] = []
    for (const m of text.matchAll(WORD_RE)) {
      const raw = m[0]
      if (!isCheckable(raw)) continue
      const key = stripChars(raw.toLowerCase(), STRIP)
      if (!key || this.ignored.has(key)) continue
      if (this.lookup(key)) out.push([m.index, m.index + raw.length])
    }
    return out
  }
}
