// Import a Rich Text Format file (.rtf: WordPad, TextEdit, Word, Pages'
// export) into the document model: headings, paragraphs with bold /
// italic / underline and alignment, bulleted lines, tables, footnotes and
// PNG / JPEG pictures (saved into *imageDir*).

import type { FileAccess } from './kdocz.ts'
import * as M from './model.ts'
import { join } from './paths.ts'

interface State {
  b: boolean; i: boolean; ul: boolean; scaps: boolean
  fs: number            // font size, half points
  skip: boolean
  uc: number
  // Called when the group closes (footnotes, pictures).
  end?: () => void
}

// Windows-1252 bytes 0x80-0x9f (the rest map to Latin-1).
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
function cp1252(n: number): string {
  return n >= 0x80 && n <= 0x9f ? CP1252[n - 0x80] : String.fromCharCode(n)
}

// Destinations whose text is not part of the document.
const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer', 'headerl', 'headerr',
  'headerf', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl',
  'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'pgdsctbl',
  'fldinst', 'nonshppict', 'object', 'filetbl', 'listtext', 'pntext', 'annotation', 'atnid', 'atnauthor',
  'bkmkstart', 'bkmkend', 'xe', 'tc', 'falt', 'panose', 'mmathPr', 'wgrffmtfilter', 'docvar', 'title',
  'author', 'operator', 'company'])

// \sN -> heading level, from the style sheet ("heading 1", "Titre 2"...).
function headingStyles(rtf: string): Map<number, number> {
  const out = new Map<number, number>()
  const sheet = /\{\\stylesheet([\s\S]*?)\}\s*(?:\{\\\*?\\?(?:listtable|info|generator|rsidtbl)|\\pard|\{\\\*\\latentstyles)/.exec(rtf)
  const text = sheet ? sheet[1] : ''
  for (const m of text.matchAll(/\\s(\d+)\b[^;{}]*?\s((?:heading|titre|überschrift)\s*(\d))\s*;/gi)) {
    out.set(Number(m[1]), Number(m[3]))
  }
  return out
}

export async function importRtf(bytes: Uint8Array | string, imageDir: string, fs: FileAccess): Promise<M.Document> {
  const rtf = typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes)
  if (!/^\s*\{\\rtf/.test(rtf)) throw new Error('This is not an RTF file.')
  const headings = headingStyles(rtf)
  const blocks: M.Block[] = []
  const pictures: { name: string; data: Uint8Array }[] = []

  let st: State = { b: false, i: false, ul: false, scaps: false, fs: 24, skip: false, uc: 1 }
  const stack: State[] = []
  let inl: M.Inline[] = []
  // Paragraph properties (\pard resets them).
  let align: M.Alignment = 'justify'
  let level = 0
  let inTable = false
  let row: string[] = []
  let rows: string[][] = []
  let pendingSkip = 0
  let destNext = false
  let figuresAfter: M.Figure[] = []
  // The list a paragraph is an item of (\lsN), and the biggest font in it.
  let listNo: number | null = null
  let paraFs = 0
  const orderedLists = listKinds(rtf)

  const marks = (): M.Mark[] => {
    const m: M.Mark[] = []
    if (st.b) m.push('bold')
    if (st.i) m.push('italic')
    if (st.ul) m.push('underline')
    if (st.scaps) m.push('smallcaps')
    return m
  }
  const emit = (t: string) => {
    if (st.skip || !t) return
    if (pendingSkip > 0) { const n = Math.min(pendingSkip, t.length); pendingSkip -= n; t = t.slice(n); if (!t) return }
    const m = marks()
    if (t.trim()) paraFs = Math.max(paraFs, st.fs)
    const last = inl[inl.length - 1]
    if (last?.type === 'Text' && last.marks.join() === m.join()) last.text += t
    else inl.push(M.text(t, m))
  }
  const plain = (x: M.Inline[]) => x.map(n => n.type === 'Text' ? n.text : '').join('').trim()
  const flushTable = () => {
    if (rows.length) {
      const w = Math.max(...rows.map(r => r.length))
      for (const r of rows) while (r.length < w) r.push('')
      blocks.push(M.table({ rows, caption: '', label: null, header: rows.length > 1 }))
    }
    rows = []
  }
  const endParagraph = () => {
    const children = trim(inl)
    inl = []
    const fs = paraFs
    paraFs = 0
    if (inTable) return
    flushTable()
    if (children.length) {
      const first = children[0]
      const bullet = listNo !== null ? null
        : first.type === 'Text' ? /^[•·▪◦\-–]\s+|^\d+[.)]\s+/.exec(first.text) : null
      // A short line all in a big bold font is a heading (TextEdit, Pages
      // and WordPad write no heading styles).
      const allBold = children.every(x => x.type !== 'Text' || x.marks.includes('bold'))
      const guess = allBold && plain(children).length < 200
        ? (fs >= 40 ? 1 : fs >= 32 ? 2 : fs >= 28 ? 3 : 0) : 0
      const lvl = level || guess
      if (lvl) blocks.push(M.section(Math.min(lvl, 3), children.map(x => x.type === 'Text'
        ? M.text(x.text, x.marks.filter(k => k !== 'bold')) : x)))
      else if (listNo !== null) {
        const ordered = orderedLists.get(listNo) ?? false
        const prev = blocks[blocks.length - 1]
        if (prev?.type === 'List' && prev.ordered === ordered) prev.items.push(M.listItem(children))
        else blocks.push(M.list(ordered, [M.listItem(children)]))
      } else if (bullet && first.type === 'Text') {
        first.text = first.text.slice(bullet[0].length)
        const ordered = /^\d/.test(bullet[0])
        const prev = blocks[blocks.length - 1]
        if (prev?.type === 'List' && prev.ordered === ordered) prev.items.push(M.listItem(children))
        else blocks.push(M.list(ordered, [M.listItem(children)]))
      } else blocks.push(M.paragraph(children, align))
    }
    blocks.push(...figuresAfter)
    figuresAfter = []
  }

  let i = 0
  const n = rtf.length
  while (i < n) {
    const c = rtf[i]
    if (c === '{') {
      stack.push(st)
      st = { ...st, end: undefined }
      destNext = true
      i++
      continue
    }
    if (c === '}') {
      st.end?.()
      st = stack.pop() ?? st
      destNext = false
      i++
      continue
    }
    if (c === '\r' || c === '\n') { i++; continue }
    if (c !== '\\') {
      let j = i
      while (j < n && !'\\{}\r\n'.includes(rtf[j])) j++
      emit(rtf.slice(i, j))
      destNext = false
      i = j
      continue
    }
    // A control symbol or word.
    const nx = rtf[i + 1]
    if (nx === '*') {
      // An optional destination: skipped, except Word's picture (\shppict).
      i += 2
      if (!/^\s*\\shppict\b/.test(rtf.slice(i, i + 12))) st.skip = true
      continue
    }
    if (nx === "'") {
      emit(cp1252(parseInt(rtf.slice(i + 2, i + 4), 16)))
      i += 4
      continue
    }
    if (nx === '\\' || nx === '{' || nx === '}') { emit(nx); i += 2; continue }
    if (nx === '~') { emit('\u00a0'); i += 2; continue }
    if (nx === '-' || nx === '_') { if (nx === '_') emit('-'); i += 2; continue }
    if (nx === '\n' || nx === '\r') { if (!st.skip) endParagraph(); i += 2; continue }
    const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40))
    if (!m) { i += 2; continue }
    i += m[0].length
    const word = m[1]
    const arg = m[2] !== undefined ? Number(m[2]) : null
    const first = destNext
    destNext = false
    if (first && SKIP.has(word)) { st.skip = true; continue }
    if (st.skip) continue
    switch (word) {
      case 'par': endParagraph(); break
      case 'pard': align = 'justify'; level = 0; inTable = false; listNo = null; break
      case 'ls': listNo = arg; break
      case 'fs': st.fs = arg ?? 24; break
      case 'plain': st.b = st.i = st.ul = st.scaps = false; st.fs = 24; break
      case 'b': st.b = arg !== 0; break
      case 'i': st.i = arg !== 0; break
      case 'ul': st.ul = arg !== 0; break
      case 'ulnone': st.ul = false; break
      case 'scaps': st.scaps = arg !== 0; break
      case 'qc': align = 'center'; break
      case 'qr': align = 'right'; break
      case 'ql': align = 'left'; break
      case 'qj': align = 'justify'; break
      case 'outlinelevel': if (arg !== null && arg < 9) level = arg + 1; break
      case 's': if (arg !== null && headings.has(arg)) level = headings.get(arg)!; break
      case 'tab': emit('\t'); break
      case 'line': emit('\n'); break
      case 'emdash': emit('—'); break
      case 'endash': emit('–'); break
      case 'lquote': emit('‘'); break
      case 'rquote': emit('’'); break
      case 'ldblquote': emit('“'); break
      case 'rdblquote': emit('”'); break
      case 'bullet': emit('•'); break
      case 'uc': st.uc = arg ?? 1; break
      case 'u': {
        if (arg !== null) emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg))
        pendingSkip = st.uc
        break
      }
      case 'intbl': inTable = true; break
      case 'cell': row.push(plain(trim(inl))); inl = []; break
      case 'row': rows.push(row); row = []; inl = []; inTable = false; break
      case 'footnote': {
        const saved = inl
        const savedMarks = { b: st.b, i: st.i, ul: st.ul }
        // The note's own \pard must not change the paragraph it is in.
        const para = { align, level, listNo, inTable }
        inl = []
        st.end = () => {
          const note = trim(inl)
          inl = saved
          ;({ align, level, listNo, inTable } = para)
          inl.push(M.footnote(note))
          Object.assign(st, savedMarks)
        }
        break
      }
      case 'pict': {
        const start = i
        let depth = 0
        let j = i
        for (; j < n; j++) {
          if (rtf[j] === '{') depth++
          else if (rtf[j] === '}') { if (depth === 0) break; depth-- }
        }
        const body = rtf.slice(start, j)
        const kind = /\\pngblip/.test(body) ? 'png' : /\\jpegblip/.test(body) ? 'jpg' : null
        const hex = body.replace(/\{[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[^0-9a-f]/gi, '')
        if (kind && hex.length > 16) {
          const data = new Uint8Array(hex.length >> 1)
          for (let k = 0; k < data.length; k++) data[k] = parseInt(hex.substr(k * 2, 2), 16)
          const name = `image_${String(pictures.length + 1).padStart(3, '0')}.${kind}`
          pictures.push({ name, data })
          const goal = /\\picwgoal(\d+)/.exec(body)
          const cm = goal ? Number(goal[1]) / 567 : 12
          figuresAfter.push(M.figure({ path: join(imageDir, name).replaceAll('\\', '/'), caption: '', label: null,
            width: `${Math.min(1, cm / 16).toFixed(2)}\\textwidth` }))
        }
        i = j
        break
      }
      default: break
    }
  }
  endParagraph()
  inTable = false
  flushTable()
  for (const p of pictures) await fs.write(join(imageDir, p.name), p.data)
  return M.document(blocks)
}

// \lsN -> numbered (true) or bulleted, from the list table: \levelnfc23
// (and 255) are bullets, the others numbers.
function listKinds(rtf: string): Map<number, boolean> {
  const byList = new Map<number, boolean>()
  for (const m of rtf.matchAll(/\{\\list\\listtemplateid-?\d+[\s\S]*?\\levelnfc(\d+)[\s\S]*?\\listid(-?\d+)\s*\}/g)) {
    const id = Number(m[2])
    if (!byList.has(id)) byList.set(id, m[1] !== '23' && m[1] !== '255')
  }
  const out = new Map<number, boolean>()
  for (const m of rtf.matchAll(/\\listoverride\\listid(-?\d+)[^}]*?\\ls(\d+)/g)) {
    out.set(Number(m[2]), byList.get(Number(m[1])) ?? false)
  }
  return out
}

function trim(inl: M.Inline[]): M.Inline[] {
  const out = inl.filter(x => x.type !== 'Text' || x.text !== '')
  if (out[0]?.type === 'Text') out[0].text = out[0].text.replace(/^[ \t]+/, '')
  const last = out[out.length - 1]
  if (last?.type === 'Text') last.text = last.text.replace(/\s+$/, '')
  return out.filter(x => x.type !== 'Text' || x.text !== '')
}
