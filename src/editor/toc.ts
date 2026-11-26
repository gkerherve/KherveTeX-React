// References ▸ Table of Contents as Word shows it: a raw \tableofcontents
// (\listoffigures, \listoftables) block is drawn in the editor as the list
// LaTeX prints — its title, then each numbered heading (figure, table)
// with its number, a dotted leader and its page in the last compiled PDF.
// A click on an entry goes to that heading.
import type { Node as PMNode } from 'prosemirror-model'
import { captionText } from './convert.ts'

export type TocKind = 'tableofcontents' | 'listoffigures' | 'listoftables'

// The block's LaTeX: an optional \setcounter{tocdepth}{N} line (the
// Automatic Table's levels), then the command.
export const TOC_BLOCK_RE = /^\s*(?:\\setcounter\{tocdepth\}\{(-?\d)\}\s*)?\\(tableofcontents|listoffigures|listoftables)\s*$/

export function tocBlock(text: string): { kind: TocKind; depth: number | null } | null {
  const m = TOC_BLOCK_RE.exec(text)
  return m ? { kind: m[2] as TocKind, depth: m[1] !== undefined ? Number(m[1]) : null } : null
}

export function tocLatex(kind: TocKind, depth: number | null = null): string {
  return (depth !== null && kind === 'tableofcontents' ? `\\setcounter{tocdepth}{${depth}}\n` : '') + `\\${kind}`
}

export interface TocEntry { level: number; number: string; text: string; pos: number }

export const TOC_TITLES: Record<TocKind, string> = {
  tableofcontents: 'Contents', listoffigures: 'List of Figures', listoftables: 'List of Tables',
}

// The entries of a list, in document order. `numbers` maps a heading's
// position to the number the editor paints before it (layout).
export function tocEntries(doc: PMNode, kind: TocKind, depth: number | null,
  numbers: Map<number, string>): TocEntry[] {
  const out: TocEntry[] = []
  const hasChapters = (() => { let c = false; doc.forEach(n => { if (n.type.name === 'section' && n.attrs.level === 0) c = true }); return c })()
  // LaTeX's default tocdepth: 3 (article), 2 with chapters (report, book).
  const maxLevel = depth ?? (hasChapters ? 2 : 3)
  let figs = 0, tabs = 0, chapter = 0
  // After \\appendix the chapters are lettered.
  let appendix = false
  doc.forEach((node, pos) => {
    const name = node.type.name
    if (name === 'raw_latex' && /^\s*\\appendix\b/.test(node.textContent)) { appendix = true; chapter = 0 }
    if (name === 'section') {
      if (node.attrs.level === 0 && node.attrs.numbered) chapter += 1
      // Unnumbered headings are listed too, without a number, as in Word
      // (the serializer adds \\addcontentsline for them).
      if (kind !== 'tableofcontents' || !node.textContent.trim()) return
      const level: number = node.attrs.level
      if (level > maxLevel) return
      // A chapter's number is painted as its "Chapter N" line, not before it.
      const own = level === 0 && hasChapters ? (appendix ? String.fromCharCode(64 + chapter) : String(chapter)) : ''
      out.push({ level: hasChapters ? level : level - 1, number: node.attrs.numbered ? (numbers.get(pos) || own) : '', text: node.textContent, pos })
    } else if (name === 'figure' && node.attrs.caption) {
      figs += 1
      if (kind === 'listoffigures') out.push({ level: 0, number: hasChapters ? `${chapter}.${figs}` : String(figs), text: captionText(node.attrs.caption), pos })
    } else if (name === 'table' && node.attrs.caption) {
      tabs += 1
      if (kind === 'listoftables') out.push({ level: 0, number: hasChapters ? `${chapter}.${tabs}` : String(tabs), text: captionText(node.attrs.caption), pos })
    }
  })
  return out
}

// The page each entry is on: the last PDF page starting at or before it.
export function pageOf(pos: number, starts: { page: number; pos: number }[]): number | null {
  if (!starts.length) return null
  let page = 1
  for (const s of starts) if (s.pos <= pos) page = s.page; else break
  return page
}

// How LaTeX sets the list (layout's TocLook): the title's font and room,
// the entries' line height, the room before a chapter's entry.
export interface TocStyle {
  titleChar: { family: string; sizePx: number; bold: boolean; italic: boolean; color: string }
  titleTop: number; titleBelow: number; rowPx: number; rowGap: number; chapterGap: number
}

export function tocWidget(kind: TocKind, entries: TocEntry[], pages: (number | null)[],
  go: (pos: number) => void, remove?: () => void, look?: TocStyle): HTMLElement {
  const box = document.createElement('div')
  box.className = 'kt-toc'
  box.contentEditable = 'false'
  const h = document.createElement('div')
  h.className = 'kt-toc-title'
  h.textContent = TOC_TITLES[kind]
  if (look) {
    const c = look.titleChar
    Object.assign(h.style, {
      fontFamily: c.family, fontSize: `${c.sizePx}px`, fontWeight: c.bold ? '700' : '400', fontStyle: c.italic ? 'italic' : 'normal',
      color: c.color || '', lineHeight: '1.2', marginTop: `${look.titleTop}px`, marginBottom: `${look.titleBelow}px`,
    })
  }
  box.appendChild(h)
  // A click on the title selects the table, as in Word; its × removes it.
  if (remove) {
    h.title = 'Click to select; × removes the table'
    h.style.cursor = 'pointer'
    const x = document.createElement('button')
    x.type = 'button'
    x.className = 'kt-toc-close'
    x.textContent = '×'
    x.title = `Remove ${TOC_TITLES[kind] === 'Contents' ? 'Table of Contents' : TOC_TITLES[kind]}`
    x.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); remove() })
    box.appendChild(x)
    h.addEventListener('mousedown', ev => {
      ev.preventDefault()
      box.classList.add('sel')
      const off = (e: MouseEvent) => {
        if (!box.contains(e.target as Node)) { box.classList.remove('sel'); document.removeEventListener('mousedown', off, true) }
      }
      document.addEventListener('mousedown', off, true)
    })
  }
  if (!entries.length) {
    const p = document.createElement('div')
    p.className = 'kt-toc-empty'
    p.textContent = kind === 'tableofcontents' ? 'No headings yet: apply Heading 1–3 to build the table.'
      : kind === 'listoffigures' ? 'No captioned figures yet.' : 'No captioned tables yet.'
    box.appendChild(p)
  }
  entries.forEach((e, i) => {
    const row = document.createElement('div')
    row.className = `kt-toc-row kt-toc-l${Math.min(4, e.level)}`
    row.style.paddingLeft = `${e.level * 1.5}em`
    if (look) {
      row.style.lineHeight = `${look.rowPx}px`
      // Each entry a paragraph: \\parskip above it, and 1em more above a
      // chapter's.
      row.style.marginTop = `${(i > 0 ? look.rowGap : 0) + (e.level === 0 && i > 0 ? look.chapterGap : 0)}px`
    }
    const num = document.createElement('span')
    num.className = 'kt-toc-num'
    num.textContent = e.number
    const txt = document.createElement('span')
    txt.className = 'kt-toc-text'
    txt.textContent = e.text
    const dots = document.createElement('span')
    dots.className = 'kt-toc-dots'
    const pg = document.createElement('span')
    pg.className = 'kt-toc-page'
    pg.textContent = pages[i] !== null ? String(pages[i]) : ''
    if (e.number) row.appendChild(num)
    row.append(txt, dots, pg)
    row.title = 'Go to this heading'
    row.addEventListener('mousedown', ev => { ev.preventDefault(); go(e.pos) })
    box.appendChild(row)
  })
  return box
}
