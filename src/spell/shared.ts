// The app's one highlighter; the dictionary loads on first use.
import { SpellChecker } from './spellchecker.ts'
import { SpellHighlighter } from './spellcheck.ts'

let shared: SpellHighlighter | null = null

export function spellHighlighter(): SpellHighlighter {
  if (!shared) {
    shared = new SpellHighlighter(null)
    const h = shared
    void fetch(`${import.meta.env.BASE_URL}dict/en.json.gz`)
      .then(r => r.arrayBuffer())
      .then(b => h.setChecker(SpellChecker.fromGzipJson(new Uint8Array(b))))
      .catch(e => console.warn('spell check dictionary unavailable', e))
  }
  return shared
}
