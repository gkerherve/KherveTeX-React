// What an original file says, read without the importer: for an assistant
// (Claude, ChatGPT) checking an import against its source. A Word file
// becomes plain lines — its style names, list levels, tables, equations
// (as LaTeX), pictures, footnotes, comments and text boxes — so what the
// importer missed or got wrong shows up beside get_outline.
import { unzipSync } from 'fflate'
import { isElement, parseXml, type XElement } from './docxPackage.ts'
import { ommlToLatex } from './omml.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'

const kids = (el: XElement): XElement[] => {
  const out: XElement[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) if (isElement(n)) out.push(n)
  return out
}
const isW = (el: XElement, name: string) => el.namespaceURI === W && el.localName === name
const wAttr = (el: XElement | null | undefined, name: string) => el?.getAttributeNS(W, name) || el?.getAttribute(`w:${name}`) || ''
const child = (el: XElement | null | undefined, name: string) => (el ? kids(el).find(k => isW(k, name)) ?? null : null)

interface Ctx {
  styles: Map<string, string>
  rels: Map<string, string>
  numFmt: Map<string, string>
  notes: string[]
}

// Word's relationships part: rId -> target.
function relsOf(xml: Uint8Array | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  for (const m of new TextDecoder().decode(xml).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1]
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1]
    if (id && target) map.set(id, target.replace(/&amp;/g, '&'))
  }
  return map
}

// The text of a run container (a paragraph, a hyperlink, an insertion...).
function inlineText(el: XElement, ctx: Ctx): string {
  let s = ''
  for (const k of kids(el)) {
    if (k.namespaceURI === M && (k.localName === 'oMath' || k.localName === 'oMathPara')) {
      const maths = k.localName === 'oMathPara' ? kids(k).filter(x => x.localName === 'oMath') : [k]
      for (const om of maths) s += ` $${ommlToLatex(om)}$ `
      continue
    }
    if (k.namespaceURI !== W) {
      s += inlineText(k, ctx)
      continue
    }
    switch (k.localName) {
      case 'r': s += runText(k, ctx); break
      case 'hyperlink': {
        const t = inlineText(k, ctx)
        const url = ctx.rels.get(k.getAttributeNS(R, 'id') || k.getAttribute('r:id') || '')
        s += url ? `[${t}](${url})` : t
        break
      }
      case 'ins': case 'smartTag': case 'sdt': case 'sdtContent': case 'fldSimple': case 'customXml':
        s += inlineText(k, ctx)
        break
      case 'del': case 'pPr': case 'rPr': case 'bookmarkStart': case 'bookmarkEnd': case 'proofErr': break
      case 'commentRangeStart': s += '⟦'; break
      case 'commentRangeEnd': s += '⟧'; break
      default: s += inlineText(k, ctx)
    }
  }
  return s
}

function runText(r: XElement, ctx: Ctx): string {
  let s = ''
  const rPr = child(r, 'rPr')
  const va = wAttr(child(rPr, 'vertAlign'), 'val')
  for (const k of kids(r)) {
    if (isW(k, 't')) s += k.textContent ?? ''
    else if (isW(k, 'tab')) s += '\t'
    else if (isW(k, 'br') || isW(k, 'cr')) s += wAttr(k, 'type') === 'page' ? '\n[page break]\n' : '\n'
    else if (isW(k, 'sym')) s += String.fromCharCode(parseInt(wAttr(k, 'char') || '0', 16) & 0xff || 0x3f)
    else if (isW(k, 'footnoteReference') || isW(k, 'endnoteReference')) s += `[^${wAttr(k, 'id')}]`
    else if (isW(k, 'commentReference')) s += `[comment ${wAttr(k, 'id')}]`
    else if (isW(k, 'drawing') || isW(k, 'pict') || isW(k, 'object')) s += picture(k, ctx)
    else if (k.localName === 'AlternateContent') s += picture(k, ctx)
  }
  if (va === 'superscript' && s.trim()) return `^{${s}}`
  if (va === 'subscript' && s.trim()) return `_{${s}}`
  return s
}

// A picture, a chart or a text box in a run.
function picture(el: XElement, ctx: Ctx): string {
  const all = el.getElementsByTagNameNS(W, 'txbxContent')
  if (all.length) {
    const box = all[0] as unknown as XElement
    return `\n[text box: ${blocksText(box, ctx).join(' / ')}]\n`
  }
  const blip = el.getElementsByTagNameNS(A, 'blip')[0] as unknown as XElement | undefined
  const id = blip ? blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed') || '' : ''
  const docPr = el.getElementsByTagNameNS(WP, 'docPr')[0] as unknown as XElement | undefined
  const alt = docPr ? (docPr.getAttribute('descr') || docPr.getAttribute('name') || '') : ''
  if (/chart/i.test(el.toString().slice(0, 4000)) && !id) return '[chart]'
  return `[picture${id ? `: word/${ctx.rels.get(id) ?? id}` : ''}${alt ? ` "${alt}"` : ''}]`
}

function paragraphLine(p: XElement, ctx: Ctx): string {
  const pPr = child(p, 'pPr')
  const styleId = wAttr(child(pPr, 'pStyle'), 'val')
  const style = ctx.styles.get(styleId) ?? styleId
  const numPr = child(pPr, 'numPr')
  const text = inlineText(p, ctx).replace(/[ ]{2,}/g, ' ').trim()
  let head = ''
  if (numPr) {
    const lvl = Number(wAttr(child(numPr, 'ilvl'), 'val') || 0)
    const fmt = ctx.numFmt.get(`${wAttr(child(numPr, 'numId'), 'val')}:${lvl}`) ?? 'bullet'
    head = `${'  '.repeat(lvl)}${fmt === 'bullet' ? '•' : '1.'} `
  }
  const align = wAttr(child(pPr, 'jc'), 'val')
  const tags = [style && !/^(Normal|Default Paragraph Font|Standard)$/i.test(style) ? style : '',
    align === 'center' ? 'centred' : align === 'right' ? 'right' : ''].filter(Boolean)
  if (!text && !tags.length) return ''
  return `${tags.length ? `[${tags.join(', ')}] ` : ''}${head}${text}`
}

function tableLines(tbl: XElement, ctx: Ctx): string[] {
  const rows = kids(tbl).filter(k => isW(k, 'tr'))
  const out = [`[table: ${rows.length} rows]`]
  for (const tr of rows) {
    const cells = kids(tr).filter(k => isW(k, 'tc')).map(tc => {
      const span = Number(wAttr(child(child(tc, 'tcPr'), 'gridSpan'), 'val') || 1)
      const merged = wAttr(child(child(tc, 'tcPr'), 'vMerge'), 'val') === '' && child(child(tc, 'tcPr'), 'vMerge') ? '↑' : ''
      const t = blocksText(tc, ctx).map(l => l.replace(/^\[[^\]]*\] /, '')).join(' / ').replace(/\|/g, '\\|')
      return (merged || t) + (span > 1 ? ` (spans ${span})` : '')
    })
    out.push(`| ${cells.join(' | ')} |`)
  }
  out.push('[end table]')
  return out
}

function blocksText(body: XElement, ctx: Ctx): string[] {
  const out: string[] = []
  for (const k of kids(body)) {
    if (isW(k, 'p')) {
      const line = paragraphLine(k, ctx)
      if (line) out.push(line)
      if (child(child(k, 'pPr'), 'sectPr')) out.push('[section break]')
    } else if (isW(k, 'tbl')) out.push(...tableLines(k, ctx))
    else if (isW(k, 'sdt') || isW(k, 'sdtContent') || isW(k, 'customXml')) out.push(...blocksText(k, ctx))
    else if (k.namespaceURI === M && k.localName === 'oMathPara') out.push(inlineText(k, ctx).trim())
  }
  return out
}

function notesOf(xml: Uint8Array | undefined, tag: string, label: string, ctx: Ctx): string[] {
  if (!xml) return []
  const root = parseXml(xml).documentElement as unknown as XElement
  const out: string[] = []
  for (const n of kids(root).filter(k => isW(k, tag))) {
    const id = wAttr(n, 'id')
    if (tag !== 'comment' && Number(id) <= 0) continue
    const who = tag === 'comment' ? ` by ${wAttr(n, 'author') || '?'}` : ''
    out.push(`[${label} ${id}${who}] ${blocksText(n, ctx).join(' ')}`)
  }
  return out
}

// A .docx as text an assistant can compare with the imported document.
export function docxText(bytes: Uint8Array): string {
  let z: Record<string, Uint8Array>
  try {
    z = unzipSync(bytes)
  } catch {
    throw new Error('Not a Word .docx file (it is not a zip package).')
  }
  const main = z['word/document.xml']
  if (!main) throw new Error('Not a Word .docx file (no word/document.xml).')
  const ctx: Ctx = { styles: new Map(), rels: relsOf(z['word/_rels/document.xml.rels']), numFmt: new Map(), notes: [] }
  if (z['word/styles.xml']) {
    const s = new TextDecoder().decode(z['word/styles.xml'])
    for (const m of s.matchAll(/<w:style\b[^>]*w:styleId="([^"]*)"[^>]*>[\s\S]*?<w:name w:val="([^"]*)"/g)) ctx.styles.set(m[1], m[2])
  }
  if (z['word/numbering.xml']) {
    const s = new TextDecoder().decode(z['word/numbering.xml'])
    const abs = new Map<string, Map<number, string>>()
    for (const m of s.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)) {
      const lv = new Map<number, string>()
      for (const l of m[0].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[\s\S]*?<w:numFmt w:val="([^"]*)"/g)) lv.set(Number(l[1]), l[2])
      abs.set(m[1], lv)
    }
    for (const m of s.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) {
      for (const [lvl, fmt] of abs.get(m[2]) ?? []) ctx.numFmt.set(`${m[1]}:${lvl}`, fmt)
    }
  }
  const doc = parseXml(main).documentElement as unknown as XElement
  const body = child(doc, 'body')
  const lines = body ? blocksText(body, ctx) : []
  const foot = notesOf(z['word/footnotes.xml'], 'footnote', 'footnote', ctx)
  const end = notesOf(z['word/endnotes.xml'], 'endnote', 'endnote', ctx)
  const comments = notesOf(z['word/comments.xml'], 'comment', 'comment', ctx)
  const media = Object.keys(z).filter(k => k.startsWith('word/media/'))
  const out = [...lines]
  if (foot.length || end.length) out.push('', '── notes ──', ...foot, ...end)
  if (comments.length) out.push('', '── comments (⟦…⟧ marks the text they cover) ──', ...comments)
  out.push('', `── ${media.length} picture file(s): ${media.map(m => m.slice(5)).join(', ') || 'none'} ──`)
  return out.join('\n')
}

// An OpenDocument text (.odt) as plain lines: headings, paragraphs, lists
// and table rows.
export function odtText(bytes: Uint8Array): string {
  const z = unzipSync(bytes)
  const content = z['content.xml']
  if (!content) throw new Error('Not an OpenDocument text (no content.xml).')
  const xml = new TextDecoder().decode(content)
  const body = xml.slice(xml.indexOf('<office:text'))
  const strip = (s: string) => s.replace(/<text:tab\/>/g, '\t').replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_m, n) => ' '.repeat(Number(n || 1)))
    .replace(/<text:note-citation[^>]*>[^<]*<\/text:note-citation>/g, '').replace(/<text:note\b[\s\S]*?<text:note-body>([\s\S]*?)<\/text:note-body>\s*<\/text:note>/g, ' [footnote: $1]')
    .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const out: string[] = []
  for (const m of body.matchAll(/<text:h\b[^>]*?(?:text:outline-level="(\d+)")?[^>]*>([\s\S]*?)<\/text:h>|<text:p\b[^>]*?(?:text:style-name="([^"]*)")?[^>]*>([\s\S]*?)<\/text:p>|<table:table-row\b|<draw:image\b[^>]*xlink:href="([^"]*)"/g)) {
    if (m[2] !== undefined) out.push(`[Heading ${m[1] ?? 1}] ${strip(m[2]).trim()}`)
    else if (m[4] !== undefined) { const t = strip(m[4]).trim(); if (t) out.push(m[3] && /title/i.test(m[3]) ? `[Title] ${t}` : t) } else if (m[5] !== undefined) out.push(`[picture: ${m[5]}]`)
    else out.push('[table row]')
  }
  return out.join('\n')
}
