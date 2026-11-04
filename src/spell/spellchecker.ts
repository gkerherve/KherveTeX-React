// A port of pyspellchecker 0.9's SpellChecker (Peter Norvig's algorithm)
// for the calls spellcheck.py makes: unknown, known, candidates and
// word_usage_frequency, over the same en.json.gz frequency list, so the
// same words are flagged and the same suggestions offered.
import { gunzipSync, strFromU8 } from 'fflate'

const PUNCTUATION = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')
// Python's float() on a stripped string: digits with optional '_'
// separators, a fraction, an exponent, or inf/infinity.
const PY_FLOAT_RE = /^\s*[+-]?(?:(?:\d(?:_?\d)*)?\.?\d(?:_?\d)*(?:[eE][+-]?\d(?:_?\d)*)?|\d(?:_?\d)*\.|inf(?:inity)?)\s*$/i

export class SpellChecker {
  private readonly dict: Map<string, number>
  private readonly totalWords: number
  private readonly longest: number
  private readonly letters: string[]

  constructor(frequencies: Record<string, number> | Map<string, number>) {
    this.dict = frequencies instanceof Map
      ? new Map([...frequencies].map(([k, v]) => [k.toLowerCase(), v]))
      : new Map(Object.entries(frequencies).map(([k, v]) => [k.toLowerCase(), v]))
    let total = 0
    let longest = 0
    const letters = new Set<string>()
    for (const [k, v] of this.dict) {
      total += v
      const chars = [...k]
      if (chars.length > longest) longest = chars.length
      for (const c of chars) letters.add(c)
    }
    this.totalWords = total
    this.longest = longest
    this.letters = [...letters]
  }

  static fromGzipJson(bytes: Uint8Array): SpellChecker {
    // A server may already have undone the gzip (Content-Encoding).
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
    return new SpellChecker(JSON.parse(strFromU8(raw)) as Record<string, number>)
  }

  has(word: string): boolean {
    return this.dict.has(word.toLowerCase())
  }

  private shouldCheck(word: string): boolean {
    const n = [...word].length
    if (n === 1 && PUNCTUATION.has(word)) return false
    // allow removal of up to 2 letters
    if (n > this.longest + 3) return false
    // nan passes the float(word) so this will bypass that issue (#125)
    if (word.toLowerCase() === 'nan') return true
    return !PY_FLOAT_RE.test(word)
  }

  known(words: Iterable<string>): Set<string> {
    const out = new Set<string>()
    for (const w0 of words) {
      const w = w0.toLowerCase()
      if (this.dict.has(w) && this.shouldCheck(w)) out.add(w)
    }
    return out
  }

  unknown(words: Iterable<string>): Set<string> {
    const out = new Set<string>()
    for (const w0 of words) {
      if (!this.shouldCheck(w0)) continue
      const w = w0.toLowerCase()
      if (!this.dict.has(w)) out.add(w)
    }
    return out
  }

  wordUsageFrequency(word: string): number {
    return (this.dict.get(word) ?? 0) / this.totalWords
  }

  editDistance1(word: string): Set<string> {
    const w = word.toLowerCase()
    if (!this.shouldCheck(w)) return new Set([w])
    const chars = [...w]
    const out = new Set<string>()
    for (let i = 0; i <= chars.length; i++) {
      const L = chars.slice(0, i).join('')
      const R = chars.slice(i)
      const rest = R.slice(1).join('')
      if (R.length) out.add(L + rest)
      if (R.length > 1) out.add(L + R[1] + R[0] + R.slice(2).join(''))
      for (const c of this.letters) {
        if (R.length) out.add(L + c + rest)
        out.add(L + c + R.join(''))
      }
    }
    return out
  }

  private editDistanceAlt(words: Iterable<string>): string[] {
    const out: string[] = []
    for (const w0 of words) {
      const w = w0.toLowerCase()
      if (!this.shouldCheck(w)) continue
      for (const e of this.known(this.editDistance1(w))) out.push(e)
    }
    return out
  }

  candidates(word: string): Set<string> | null {
    // short-cut if word is correct already
    if (this.known([word]).size) return new Set([word])
    if (!this.shouldCheck(word)) return new Set([word])
    const res = [...this.editDistance1(word)]
    let tmp = this.known(res)
    if (tmp.size) return tmp
    // if still not found, use the edit distance 1 to calc edit distance 2
    tmp = this.known(this.editDistanceAlt(res))
    return tmp.size ? tmp : null
  }
}
