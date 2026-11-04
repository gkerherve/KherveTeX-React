// Reads an exported .docx back the way the Python tests do with
// docx.Document(path): paragraphs with their style name, text, runs and
// alignment; tables; the section margins; the core properties.
import { strFromU8, unzipSync } from 'fflate'
import {
  NS, find, findall, get, lxmlText, paragraphStyle, parseXml, pStyleId, rowCells,
} from '../src/core/docxPackage.ts'
import type { XElement } from '../src/core/docxPackage.ts'
import { cellText, paragraphText, runText } from '../src/core/docxImport.ts'

const onOff = (rPr: XElement | null, tag: string): boolean | null => {
  const e = rPr && find(rPr, NS.w, tag)
  if (!e) return null
  const v = get(e, NS.w, 'val')
  return v === null || ['1', 'true', 'on'].includes(v)
}

export function readDocx(bytes: Uint8Array) {
  const z = unzipSync(bytes)
  const doc = parseXml(z['word/document.xml']).documentElement!
  const styles = parseXml(z['word/styles.xml']).documentElement!
  const body = find(doc, NS.w, 'body')!
  const paragraphs = findall(body, NS.w, 'p').map((p) => {
    const pPr = find(p, NS.w, 'pPr')
    const jc = pPr && find(pPr, NS.w, 'jc')
    return {
      style: paragraphStyle(styles, pStyleId(p))?.name ?? null,
      text: paragraphText(p),
      alignment: jc ? get(jc, NS.w, 'val') : null,
      runs: findall(p, NS.w, 'r').map((r) => {
        const rPr = find(r, NS.w, 'rPr')
        return { text: runText(r), bold: onOff(rPr, 'b'), italic: onOff(rPr, 'i') }
      }),
    }
  })
  const tables = findall(body, NS.w, 'tbl').map((t) => ({
    rows: findall(t, NS.w, 'tr').map((tr) => ({ cells: rowCells(tr).map((tc) => ({ text: cellText(tc) })) })),
  }))
  const pgMar = find(find(body, NS.w, 'sectPr')!, NS.w, 'pgMar')!
  const twip = (k: string) => Number(get(pgMar, NS.w, k)) * 635
  const sections = [{ top_margin: twip('top'), bottom_margin: twip('bottom'), left_margin: twip('left'), right_margin: twip('right') }]
  const core = parseXml(z['docProps/core.xml']).documentElement!
  const coreText = (ns: string, tag: string) => {
    const e = find(core, ns, tag)
    return e ? (lxmlText(e) ?? '') : ''
  }
  const core_properties = { title: coreText(NS.dc, 'title'), author: coreText(NS.dc, 'creator') }
  return { paragraphs, tables, sections, core_properties, xml: strFromU8(z['word/document.xml']) }
}
