// The app's one highlighter; the dictionary loads on first use.
import { loadSettings, setSetting, setting } from '../platform/settings.ts'
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
    // The words the user added to the dictionary stay known
    // (QSettings "spell_words", as MainWindow keeps them).
    void loadSettings().then(() => {
      const words = setting<unknown>('spell_words', [])
      h.loadDictionary(Array.isArray(words) ? words.filter((w): w is string => typeof w === 'string') : [])
      h.onWordAdded = () => setSetting('spell_words', h.addedWords())
    })
  }
  return shared
}
