// Import an OpenDocument text (.odt: LibreOffice, OpenOffice, Google Docs'
// "Download ▸ OpenDocument") into the document model: headings, paragraphs
// with bold / italic / underline, lists, tables, footnotes, links and
// pictures (saved into *imageDir*, as the Word importer does).

import { unzipSync } from 'fflate'
import type { Element as XElement, Node as XNode } from '@xmldom/xmldom'
import { parseXml } from './docxPackage.ts'
import type { FileAccess } from './kdocz.ts'
import * as M from './model.ts'
import { join } from './paths.ts'

const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0'
const NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const NS_DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'
const NS_STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'
const NS_FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0'
const NS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const NS_XLINK = 'http://www.w3.org/1999/xlink'
const NS_SVG = 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0'

interface TextStyle { marks: M.Mark[]; align?: M.Alignment; parent?: string; heading?: number; pt?: number }

const kids = (n: XNode): XElement[] => {
  const out: XElement[] = []
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as XElement)
  return out
}
const is = (e: XElement, ns: string, name: string) => e.namespaceURI === ns && e.localName === name
const attr = (e: XElement, ns: string, name: string) => e.getAttributeNS(ns, name) || ''

// Automatic and named styles: the marks and alignment each gives.
function readStyles(roots: (XElement | null)[]): Map<string, TextStyle> {
  const styles = new Map<string, TextStyle>()
  for (const root of roots) {
    if (!root) continue
    for (const s of root.getElementsByTagNameNS(NS_STYLE, 'style') as unknown as Iterable<XElement>) {
      const name = attr(s, NS_STYLE, 'name')
      const st: TextStyle = { marks: [], parent: attr(s, NS_STYLE, 'parent-style-name') || undefined }
      for (const p of kids(s)) {
        if (is(p, NS_STYLE, 'text-properties')) {
          if (/bold|[6-9]00/.test(attr(p, NS_FO, 'font-weight'))) st.marks.push('bold')
          if (attr(p, NS_FO, 'font-style') === 'italic') st.marks.push('italic')
          const u = attr(p, NS_STYLE, 'text-underline-style')
          if (u && u !== 'none') st.marks.push('underline')
          if (attr(p, NS_FO, 'font-variant') === 'small-caps') st.marks.push('smallcaps')
          if (/mono|courier|consol/i.test(attr(p, NS_STYLE, 'font-name'))) st.marks.push('code')
          const size = /([\d.]+)pt/.exec(attr(p, NS_FO, 'font-size'))
          if (size) st.pt = Number(size[1])
        }
        if (is(p, NS_STYLE, 'paragraph-properties')) {
          const a = attr(p, NS_FO, 'text-align')
          st.align = a === 'center' ? 'center' : a === 'end' || a === 'right' ? 'right'
            : a === 'justify' ? 'justify' : a === 'start' || a === 'left' ? 'left' : undefined
        }
      }
      const outline = attr(s, NS_STYLE, 'default-outline-level')
      if (outline) st.heading = Number(outline)
      else if (/^(Heading|Titre)[ _]?(\d)$/i.test(name)) st.heading = Number(/(\d)$/.exec(name)![1])
      styles.set(name, st)
    }
  }
  return styles
}

class OdtReader {
  pictures: { name: string; data: Uint8Array }[] = []
  title: M.Inline[] | null = null
  private files: Record<string, Uint8Array>
  private styles: Map<string, TextStyle>
  constructor(files: Record<string, Uint8Array>, styles: Map<string, TextStyle>) {
    this.files = files
    this.styles = styles
  }

  private style(name: string): TextStyle {
    const seen = new Set<string>()
    const marks: M.Mark[] = []
    let align: M.Alignment | undefined
    let heading: number | undefined
    let pt: number | undefined
    for (let n: string | undefined = name; n && !seen.has(n); n = this.styles.get(n)?.parent) {
      seen.add(n)
      const s = this.styles.get(n)
      if (!s) break
      for (const m of s.marks) if (!marks.includes(m)) marks.push(m)
      align ??= s.align
      heading ??= s.heading
      pt ??= s.pt
    }
    return { marks, align, heading, pt }
  }

  inlines(e: XElement, marks: M.Mark[] = []): M.Inline[] {
    const out: M.Inline[] = []
    const push = (t: string) => {
      if (!t) return
      const last = out[out.length - 1]
      if (last?.type === 'Text' && last.marks.join() === marks.join()) last.text += t
      else out.push(M.text(t, marks))
    }
    for (let c = e.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { push((c.nodeValue ?? '').replace(/\s+/g, ' ')); continue }
      if (c.nodeType !== 1) continue
      const k = c as XElement
      if (is(k, NS_TEXT, 's')) push(' '.repeat(Number(attr(k, NS_TEXT, 'c') || 1)))
      else if (is(k, NS_TEXT, 'tab')) push('\t')
      else if (is(k, NS_TEXT, 'line-break')) push('\n')
      else if (is(k, NS_TEXT, 'span')) {
        const m = [...marks]
        for (const x of this.style(attr(k, NS_TEXT, 'style-name')).marks) if (!m.includes(x)) m.push(x)
        out.push(...mergeText(out, this.inlines(k, m)))
      } else if (is(k, NS_TEXT, 'a')) {
        out.push(M.link(attr(k, NS_XLINK, 'href'), this.inlines(k, marks)))
      } else if (is(k, NS_TEXT, 'note')) {
        const body = kids(k).find(x => is(x, NS_TEXT, 'note-body'))
        const inl: M.Inline[] = []
        for (const p of body ? kids(body) : []) {
          if (inl.length) inl.push(M.text(' '))
          inl.push(...this.inlines(p))
        }
        out.push(M.footnote(inl))
      } else if (is(k, NS_DRAW, 'frame') || is(k, NS_OFFICE, 'annotation') || is(k, NS_TEXT, 'bookmark')
        || is(k, NS_TEXT, 'bookmark-start') || is(k, NS_TEXT, 'bookmark-end')) {
        // Pictures become figures of their own (blocks); comments are left out.
      } else {
        out.push(...mergeText(out, this.inlines(k, marks)))
      }
    }
    return out
  }

  // Pictures inside a paragraph (draw:frame > draw:image), saved.
  private frames(e: XElement): M.Figure[] {
    const figs: M.Figure[] = []
    for (const img of e.getElementsByTagNameNS(NS_DRAW, 'image') as unknown as Iterable<XElement>) {
      const href = attr(img, NS_XLINK, 'href')
      const data = this.files[href]
      if (!data) continue
      const ext = (/\.(\w+)$/.exec(href)?.[1] ?? 'png').toLowerCase()
      const name = `image_${String(this.pictures.length + 1).padStart(3, '0')}.${ext}`
      this.pictures.push({ name, data })
      const frame = img.parentNode as XElement
      const w = attr(frame, NS_SVG, 'width')
      const cm = /([\d.]+)cm/.exec(w)?.[1] ?? (/([\d.]+)in/.test(w) ? String(Number(/([\d.]+)in/.exec(w)![1]) * 2.54) : '')
      const width = cm ? `${Math.min(1, Number(cm) / 16).toFixed(2)}\\textwidth` : '0.8\\textwidth'
      figs.push(M.figure({ path: name, caption: '', label: null, width }))
    }
    return figs
  }

  private spanSizes(e: XElement): number[] {
    const out: number[] = []
    for (const sp of e.getElementsByTagNameNS(NS_TEXT, 'span') as unknown as Iterable<XElement>) {
      const pt = this.style(attr(sp, NS_TEXT, 'style-name')).pt
      if (pt) out.push(pt)
    }
    return out
  }

  private paragraph(e: XElement, heading?: number): M.Block[] {
    const st = this.style(attr(e, NS_TEXT, 'style-name'))
    const children = trimInlines(this.inlines(e))
    const figs = this.frames(e)
    // A short line all bold in a big font is a heading (TextEdit and
    // Google Docs often write no heading styles).
    const texts = children.filter(x => x.type === 'Text') as M.Text[]
    const allBold = texts.length > 0 && texts.every(x => x.marks.includes('bold') || st.marks.includes('bold'))
    const len = inlineText(children).length
    const pt = Math.max(st.pt ?? 0, ...this.spanSizes(e))
    const guess = allBold && len < 200 ? (pt >= 20 ? 1 : pt >= 16 ? 2 : pt >= 14 ? 3 : undefined) : undefined
    const level = heading ?? st.heading ?? guess
    if (level) for (const x of texts) x.marks = x.marks.filter(k => k !== 'bold')
    const name = attr(e, NS_TEXT, 'style-name')
    const blocks: M.Block[] = []
    if (/^Title$/i.test(name) && !this.title && children.length) { this.title = children; return figs }
    if (children.length) {
      if (level) blocks.push(M.section(Math.min(Math.max(level, 1), 3), children))
      else blocks.push(M.paragraph(children, st.align ?? 'justify'))
    }
    return [...blocks, ...figs]
  }

  private list(e: XElement): M.Block[] {
    const style = attr(e, NS_TEXT, 'style-name')
    const ordered = this.listOrdered(style)
    const items: M.ListItem[] = []
    const extra: M.Block[] = []
    const walk = (l: XElement) => {
      for (const item of kids(l)) {
        if (!is(item, NS_TEXT, 'list-item') && !is(item, NS_TEXT, 'list-header')) continue
        for (const c of kids(item)) {
          if (is(c, NS_TEXT, 'list')) walk(c)          // nested lists flatten
          else if (is(c, NS_TEXT, 'p') || is(c, NS_TEXT, 'h')) {
            const inl = trimInlines(this.inlines(c))
            if (inl.length) items.push(M.listItem(inl))
            extra.push(...this.frames(c))
          }
        }
      }
    }
    walk(e)
    return [...(items.length ? [M.list(ordered, items)] : []), ...extra]
  }

  private listStyles = new Map<string, boolean>()
  setListStyles(roots: (XElement | null)[]): void {
    for (const root of roots) {
      if (!root) continue
      for (const ls of root.getElementsByTagNameNS(NS_TEXT, 'list-style') as unknown as Iterable<XElement>) {
        const first = kids(ls)[0]
        this.listStyles.set(attr(ls, NS_STYLE, 'name'), !!first && is(first, NS_TEXT, 'list-level-style-number'))
      }
    }
  }
  private listOrdered(name: string): boolean { return this.listStyles.get(name) ?? false }

  private table(e: XElement): M.Table {
    const rows: string[][] = []
    let header = false
    const plain = (x: XElement): string => kids(x).map(p => inlineText(this.inlines(p))).join(' ').trim()
    const walk = (x: XElement) => {
      for (const c of kids(x)) {
        if (is(c, NS_TABLE, 'table-header-rows')) { header = true; walk(c) }
        else if (is(c, NS_TABLE, 'table-rows') || is(c, NS_TABLE, 'table-row-group')) walk(c)
        else if (is(c, NS_TABLE, 'table-row')) {
          const row: string[] = []
          for (const cell of kids(c)) {
            if (is(cell, NS_TABLE, 'table-cell')) {
              row.push(plain(cell))
              const span = Number(attr(cell, NS_TABLE, 'number-columns-spanned') || 1)
              for (let i = 1; i < span; i++) row.push('')
            } else if (is(cell, NS_TABLE, 'covered-table-cell')) {
              // filled by the spanning cell's padding above
            }
          }
          rows.push(row)
        }
      }
    }
    walk(e)
    const width = Math.max(1, ...rows.map(r => r.length))
    for (const r of rows) while (r.length < width) r.push('')
    return M.table({ rows, caption: '', label: null, header: header || rows.length > 1 })
  }

  blocks(body: XElement): M.Block[] {
    const out: M.Block[] = []
    for (const e of kids(body)) {
      if (is(e, NS_TEXT, 'h')) out.push(...this.paragraph(e, Number(attr(e, NS_TEXT, 'outline-level') || 1)))
      else if (is(e, NS_TEXT, 'p')) out.push(...this.paragraph(e))
      else if (is(e, NS_TEXT, 'list')) out.push(...this.list(e))
      else if (is(e, NS_TABLE, 'table')) out.push(this.table(e))
      else if (is(e, NS_TEXT, 'section')) out.push(...this.blocks(e))
    }
    return out
  }
}

function mergeText(before: M.Inline[], add: M.Inline[]): M.Inline[] {
  const last = before[before.length - 1]
  const first = add[0]
  if (last?.type === 'Text' && first?.type === 'Text' && last.marks.join() === first.marks.join()) {
    last.text += first.text
    return add.slice(1)
  }
  return add
}

function trimInlines(inl: M.Inline[]): M.Inline[] {
  const out = inl.filter(x => x.type !== 'Text' || x.text !== '')
  if (out[0]?.type === 'Text') out[0].text = out[0].text.replace(/^\s+/, '')
  const last = out[out.length - 1]
  if (last?.type === 'Text') last.text = last.text.replace(/\s+$/, '')
  return out.filter(x => x.type !== 'Text' || x.text !== '')
}

function inlineText(inl: M.Inline[]): string {
  return inl.map(x => x.type === 'Text' ? x.text : x.type === 'Link' ? inlineText(x.children) : '').join('')
}

// The .odt's document: pictures are written into *imageDir* through *fs*.
export async function importOdt(bytes: Uint8Array, imageDir: string, fs: FileAccess): Promise<M.Document> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new Error('This is not an OpenDocument text file (.odt).')
  }
  const content = files['content.xml']
  if (!content) throw new Error('This .odt file has no content (content.xml is missing).')
  const doc = parseXml(content)
  const stylesDoc = files['styles.xml'] ? parseXml(files['styles.xml']) : null
  const roots = [doc.documentElement, stylesDoc?.documentElement ?? null]
  const reader = new OdtReader(files, readStyles(roots))
  reader.setListStyles(roots)
  const body = doc.getElementsByTagNameNS(NS_OFFICE, 'text')[0] as XElement | undefined
  const blocks = body ? reader.blocks(body) : []
  for (const p of reader.pictures) await fs.write(join(imageDir, p.name), p.data)
  // Figures point into imageDir (as the Word importer's do).
  for (const b of blocks) if (b.type === 'Figure') b.path = join(imageDir, b.path).replaceAll('\\', '/')
  const meta = M.docMeta()
  if (reader.title) meta.title = inlineText(reader.title)
  return M.document(blocks, meta)
}
