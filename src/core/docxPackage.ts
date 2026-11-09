// The slice of python-docx 1.2 that importers.import_docx relies on,
// reimplemented over the raw OOXML package: the OPC loader (content types,
// relationships, the part walk docx.Document(path) performs), lxml-style
// element access, and the parts the importer reaches through
// (styles, numbering, core properties). Behaviour that would make
// python-docx raise raises here too, so a file the Python app cannot open
// is not silently accepted.

import { strFromU8, unzipSync } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import type { Document as XDocument, Element as XElement, Node as XNode } from '@xmldom/xmldom'

export type { XElement }

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  xml: 'http://www.w3.org/XML/1998/namespace',
} as const

export const RT = {
  OFFICE_DOCUMENT: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  CORE_PROPERTIES: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  STYLES: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  NUMBERING: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  IMAGE: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  HYPERLINK: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
} as const

export const CT = {
  WML_DOCUMENT_MAIN: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  WML_STYLES: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  WML_NUMBERING: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  OPC_CORE_PROPERTIES: 'application/vnd.openxmlformats-package.core-properties+xml',
} as const

// Content types python-docx loads as XmlPart: parsed when the package
// opens, so a malformed one fails the open.
const XML_PART_TYPES = new Set<string>([
  CT.OPC_CORE_PROPERTIES,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  CT.WML_DOCUMENT_MAIN,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  CT.WML_NUMBERING,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  CT.WML_STYLES,
])

// A Python exception carried over: `type` is the exception class name.
export class PyError extends Error {
  readonly type: string
  constructor(type: string, message: string) {
    super(`${type}: ${message}`)
    this.type = type
  }
}

// ---------------------------------------------------------------- XML

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

// lxml's parser: XML 1.0 line-end handling (only CR and CRLF become LF),
// and any error is fatal.
export function parseXml(bytes: Uint8Array): XDocument {
  let text: string
  try {
    text = decodeXml(bytes)
  } catch {
    throw new PyError('XMLSyntaxError', 'invalid encoding')
  }
  const parser = new DOMParser({
    normalizeLineEndings: (s: string) => s.replace(/\r\n?/g, '\n'),
    onError: (level: string, msg: string) => {
      if (level !== 'warning') throw new PyError('XMLSyntaxError', msg)
    },
  })
  try {
    return parser.parseFromString(text, 'text/xml')
  } catch (e) {
    if (e instanceof PyError) throw e
    throw new PyError('XMLSyntaxError', String(e))
  }
}

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_NODE = 4
const PI_NODE = 7
const COMMENT_NODE = 8

export const isElement = (n: XNode): n is XElement => n.nodeType === ELEMENT_NODE

// Iterating an lxml element yields its element, comment and processing-
// instruction children (blank text is gone, other text is .text/.tail).
// The importer reads `child.tag` as a string, which a comment or PI does
// not have: Python raises AttributeError there, so this does too.
export function* iterChildren(el: XElement): Generator<XElement> {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === ELEMENT_NODE) yield n as XElement
    else if (n.nodeType === COMMENT_NODE || n.nodeType === PI_NODE) {
      throw new PyError('AttributeError', "'cython_function_or_method' object has no attribute 'rpartition'")
    }
  }
}

export const localName = (el: XElement): string => el.localName ?? el.nodeName

export function is(el: XElement, ns: string, local: string): boolean {
  return el.namespaceURI === ns && el.localName === local
}

// element.find(qn(tag)): first child element with that tag.
export function find(el: XElement, ns: string, local: string): XElement | null {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (isElement(n) && is(n, ns, local)) return n
  }
  return null
}

// element.findall(qn(tag)): child elements with that tag.
export function findall(el: XElement, ns: string, local: string): XElement[] {
  const out: XElement[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (isElement(n) && is(n, ns, local)) out.push(n)
  }
  return out
}

// element.findall(".//" + qn(tag)): descendants in document order.
export function descendants(el: XElement, ns: string, local: string): XElement[] {
  const out: XElement[] = []
  const walk = (p: XElement) => {
    for (let n = p.firstChild; n; n = n.nextSibling) {
      if (!isElement(n)) continue
      if (is(n, ns, local)) out.push(n)
      walk(n)
    }
  }
  walk(el)
  return out
}

// element.get(name): the attribute's value or null. `ns` null means an
// attribute without a namespace.
export function get(el: XElement, ns: string | null, local: string): string | null {
  const attrs = el.attributes
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs.item(i)!
    if ((a.namespaceURI ?? null) === ns && (a.localName ?? a.name) === local) return a.value
  }
  return null
}

const BLANK = /^[ \t\n\r]*$/

function xmlSpacePreserve(el: XElement): boolean {
  for (let n: XNode | null = el; n && isElement(n); n = n.parentNode) {
    const v = get(n, NS.xml, 'space')
    if (v === 'preserve') return true
    if (v === 'default') return false
  }
  return false
}

// lxml's element.text: the character data before the first child node, or
// null. python-docx parses with remove_blank_text=True, which drops a
// whitespace-only run of text that is followed by a child node (libxml2's
// areBlanks) unless xml:space="preserve" is in force.
export function lxmlText(el: XElement): string | null {
  let s = ''
  let n = el.firstChild
  let any = false
  for (; n && (n.nodeType === TEXT_NODE || n.nodeType === CDATA_NODE); n = n.nextSibling) {
    s += (n as unknown as { data: string }).data
    any = true
  }
  if (!any) return null
  if (n && BLANK.test(s) && !xmlSpacePreserve(el)) return null
  return s
}

// ---------------------------------------------------------------- posixpath

export function posixNormpath(p: string): string {
  if (p === '') return '.'
  const initial = p.startsWith('/') ? (p.startsWith('//') && !p.startsWith('///') ? 2 : 1) : 0
  const out: string[] = []
  for (const comp of p.split('/')) {
    if (comp === '' || comp === '.') continue
    if (comp !== '..' || (!initial && !out.length) || (out.length && out[out.length - 1] === '..')) out.push(comp)
    else if (out.length) out.pop()
  }
  const s = '/'.repeat(initial) + out.join('/')
  return s || '.'
}

function posixJoin(a: string, b: string): string {
  if (b.startsWith('/')) return b
  if (a === '' || a.endsWith('/')) return a + b
  return a + '/' + b
}

function posixSplit(p: string): [string, string] {
  const i = p.lastIndexOf('/') + 1
  let head = p.slice(0, i)
  const tail = p.slice(i)
  if (head && head !== '/'.repeat(head.length)) head = head.replace(/\/+$/, '')
  return [head, tail]
}

function posixRelpath(path: string, start: string): string {
  const sp = posixNormpath(start).split('/').filter(Boolean)
  const pp = posixNormpath(path).split('/').filter(Boolean)
  let i = 0
  while (i < sp.length && i < pp.length && sp[i] === pp[i]) i++
  const rel = [...Array(sp.length - i).fill('..'), ...pp.slice(i)]
  return rel.length ? rel.join('/') : '.'
}

// PackURI helpers.
export const baseURI = (partname: string) => posixSplit(partname)[0]
export const packFilename = (partname: string) => posixSplit(partname)[1]
export function packExt(partname: string): string {
  const name = packFilename(partname)
  const dot = name.lastIndexOf('.')
  let ext = ''
  if (dot > 0 && /[^.]/.test(name.slice(0, dot))) ext = name.slice(dot)
  return ext.startsWith('.') ? ext.slice(1) : ext
}
const relsUri = (partname: string) => posixJoin(posixJoin(baseURI(partname), '_rels'), `${packFilename(partname)}.rels`)
const fromRelRef = (base: string, ref: string) => posixNormpath(posixJoin(base, ref))
// PackURI.relative_ref
export const relativeRef = (partname: string, base: string) =>
  base === '/' ? partname.slice(1) : posixRelpath(partname, base)

// ---------------------------------------------------------------- the package

export interface Rel {
  rId: string | null
  reltype: string | null
  targetRef: string | null  // the Target attribute as stored
  external: boolean
  target: Part | null       // internal relationships only
  baseURI: string
}

export interface Part {
  partname: string
  contentType: string
  blob: Uint8Array
  xml: XDocument | null     // the parsed element of an XmlPart
  rels: Map<string | null, Rel>
}

export interface Package {
  rels: Map<string | null, Rel>
  parts: Map<string, Part>
}

// Relationship.target_ref
export function relTargetRef(rel: Rel): string | null {
  return rel.external ? rel.targetRef : relativeRef(rel.target!.partname, rel.baseURI)
}

// Relationships.part_with_reltype
export function partWithReltype(rels: Map<string | null, Rel>, reltype: string): Part {
  const matching = [...rels.values()].filter((r) => r.reltype === reltype)
  if (matching.length === 0) throw new PyError('KeyError', `no relationship of type '${reltype}' in collection`)
  if (matching.length > 1) throw new PyError('ValueError', `multiple relationships of type '${reltype}' in collection`)
  const rel = matching[0]
  if (rel.external) throw new PyError('ValueError', 'target_part property on _Relationship is undefined when target mode is External')
  return rel.target!
}

interface SRel {
  rId: string | null
  reltype: string | null
  targetRef: string | null
  external: boolean
  baseURI: string
}

function srelTargetPartname(s: SRel): string {
  if (s.targetRef === null) throw new PyError('TypeError', 'expected str, bytes or os.PathLike object, not NoneType')
  return fromRelRef(s.baseURI, s.targetRef)
}

// docx.Document(path) up to the main document part: PackageReader walks every
// part reachable from the package relationships, then the parts and their
// relationships are unmarshalled.
export function openPackage(bytes: Uint8Array): Package {
  let zip: Record<string, Uint8Array>
  try {
    zip = unzipSync(bytes)
  } catch {
    throw new PyError('PackageNotFoundError', 'Package not found')
  }
  const blobFor = (partname: string): Uint8Array => {
    const name = partname.slice(1)
    if (!Object.prototype.hasOwnProperty.call(zip, name)) {
      throw new PyError('KeyError', `"There is no item named '${name}' in the archive"`)
    }
    return zip[name]
  }
  const ctRoot = parseXml(blobFor('/[Content_Types].xml')).documentElement!
  const overrides = new Map<string, string>()
  const defaults = new Map<string, string>()
  for (const o of findall(ctRoot, NS.ct, 'Override')) overrides.set((get(o, null, 'PartName') ?? '').toLowerCase(), get(o, null, 'ContentType') ?? '')
  for (const d of findall(ctRoot, NS.ct, 'Default')) defaults.set((get(d, null, 'Extension') ?? '').toLowerCase(), get(d, null, 'ContentType') ?? '')
  const contentType = (partname: string): string => {
    const o = overrides.get(partname.toLowerCase())
    if (o !== undefined) return o
    const d = defaults.get(packExt(partname).toLowerCase())
    if (d !== undefined) return d
    throw new PyError('KeyError', `no content type for partname '${partname}' in [Content_Types].xml`)
  }
  const srelsFor = (sourceUri: string): SRel[] => {
    const name = relsUri(sourceUri).slice(1)
    if (!Object.prototype.hasOwnProperty.call(zip, name)) return []
    const root = parseXml(zip[name]).documentElement!
    return findall(root, NS.pr, 'Relationship').map((r) => ({
      rId: get(r, null, 'Id'),
      reltype: get(r, null, 'Type'),
      targetRef: get(r, null, 'Target'),
      external: (get(r, null, 'TargetMode') ?? 'Internal') === 'External',
      baseURI: baseURI(sourceUri),
    }))
  }

  const pkgSrels = srelsFor('/')
  const sparts: { partname: string; contentType: string; reltype: string | null; blob: Uint8Array; srels: SRel[] }[] = []
  const visited: string[] = []
  const walk = (srels: SRel[]) => {
    for (const srel of srels) {
      if (srel.external) continue
      const partname = srelTargetPartname(srel)
      if (visited.includes(partname)) continue
      visited.push(partname)
      const partSrels = srelsFor(partname)
      const blob = blobFor(partname)
      sparts.push({ partname, contentType: contentType(partname), reltype: srel.reltype, blob, srels: partSrels })
      walk(partSrels)
    }
  }
  walk(pkgSrels)

  const parts = new Map<string, Part>()
  for (const s of sparts) {
    // An image relationship makes an ImagePart whatever the content type.
    const isXml = s.reltype !== RT.IMAGE && XML_PART_TYPES.has(s.contentType)
    parts.set(s.partname, {
      partname: s.partname, contentType: s.contentType, blob: s.blob,
      xml: isXml ? parseXml(s.blob) : null, rels: new Map(),
    })
  }
  const pkg: Package = { rels: new Map(), parts }
  const load = (target: Map<string | null, Rel>, srels: SRel[]) => {
    for (const s of srels) {
      target.set(s.rId, {
        rId: s.rId, reltype: s.reltype, targetRef: s.targetRef, external: s.external,
        target: s.external ? null : parts.get(srelTargetPartname(s))!, baseURI: s.baseURI,
      })
    }
  }
  load(pkg.rels, pkgSrels)
  for (const s of sparts) load(parts.get(s.partname)!.rels, s.srels)
  return pkg
}

// ---------------------------------------------------------------- styles

const STYLE_TYPES = new Set(['paragraph', 'character', 'table', 'numbering'])
const BABEL_UI: Record<string, string> = {
  caption: 'Caption', footer: 'Footer', header: 'Header',
  'heading 1': 'Heading 1', 'heading 2': 'Heading 2', 'heading 3': 'Heading 3',
  'heading 4': 'Heading 4', 'heading 5': 'Heading 5', 'heading 6': 'Heading 6',
  'heading 7': 'Heading 7', 'heading 8': 'Heading 8', 'heading 9': 'Heading 9',
}

function styleType(s: XElement): string | null {
  const t = get(s, NS.w, 'type')
  if (t === null) return null
  if (!STYLE_TYPES.has(t)) throw new PyError('ValueError', `WD_STYLE_TYPE has no XML mapping for '${t}'`)
  return t
}

function onOff(v: string): boolean {
  if (!['1', '0', 'true', 'false', 'on', 'off'].includes(v)) {
    throw new PyError('InvalidXmlError', `value must be one of '1', '0', 'true', 'false', 'on', or 'off', got '${v}'`)
  }
  return v === '1' || v === 'true' || v === 'on'
}

// The paragraph style python-docx resolves for a style id (None = the
// paragraph has no w:pStyle): Styles.get_by_id(style_id, PARAGRAPH).
// `styles` is the w:styles element, or null when the document has no styles
// part — python-docx then uses its default-styles.xml, whose only paragraph
// style is "Normal".
export interface StyleRef { name: string | null }

export function paragraphStyle(styles: XElement | null, styleId: string | null): StyleRef | null {
  if (styles === null) return { name: 'Normal' }
  const byDefault = (): StyleRef | null => {
    const defaults = findall(styles, NS.w, 'style').filter((s) => {
      if (styleType(s) !== 'paragraph') return false
      const d = get(s, NS.w, 'default')
      return d !== null && onOff(d)
    })
    return defaults.length ? styleOf(defaults[defaults.length - 1]) : null
  }
  if (styleId === null) return byDefault()
  let style: XElement | null = null
  if (styleId) {
    if (styleId.includes('"')) throw new PyError('XPathEvalError', 'Invalid predicate')
    style = findall(styles, NS.w, 'style').find((s) => get(s, NS.w, 'styleId') === styleId) ?? null
  }
  if (style === null || styleType(style) !== 'paragraph') return byDefault()
  return styleOf(style)
}

function styleOf(s: XElement): StyleRef {
  return {
    get name() {
      const n = find(s, NS.w, 'name')
      if (n === null) return null
      const v = get(n, NS.w, 'val')
      if (v === null) throw new PyError('InvalidXmlError', "required 'w:val' attribute not present on element w:name")
      return BABEL_UI[v] ?? v
    },
  }
}

// CT_P.style: w:pPr/w:pStyle/@w:val, which is required when w:pStyle is present.
export function pStyleId(p: XElement): string | null {
  const pPr = find(p, NS.w, 'pPr')
  if (pPr === null) return null
  const ps = find(pPr, NS.w, 'pStyle')
  if (ps === null) return null
  const v = get(ps, NS.w, 'val')
  if (v === null) throw new PyError('InvalidXmlError', "required 'w:val' attribute not present on element w:pStyle")
  return v
}

// ---------------------------------------------------------------- tables

// CT_DecimalNumber.val / XsdInt: int(str).
function decimal(el: XElement): number {
  const v = get(el, NS.w, 'val')
  if (v === null) throw new PyError('InvalidXmlError', `required 'w:val' attribute not present on element ${el.nodeName}`)
  const t = v.trim()
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) throw new PyError('ValueError', `invalid literal for int() with base 10: '${v}'`)
  return parseInt(t.replaceAll('_', ''), 10)
}

export function gridSpan(tc: XElement): number {
  const tcPr = find(tc, NS.w, 'tcPr')
  if (tcPr === null) return 1
  const gs = find(tcPr, NS.w, 'gridSpan')
  return gs === null ? 1 : decimal(gs)
}

export function vMerge(tc: XElement): string | null {
  const tcPr = find(tc, NS.w, 'tcPr')
  if (tcPr === null) return null
  const vm = find(tcPr, NS.w, 'vMerge')
  if (vm === null) return null
  return get(vm, NS.w, 'val') ?? 'continue'
}

function gridBefore(tr: XElement): number {
  const trPr = find(tr, NS.w, 'trPr')
  if (trPr === null) return 0
  const gb = find(trPr, NS.w, 'gridBefore')
  return gb === null ? 0 : decimal(gb)
}

function ancestorTr(tc: XElement): XElement {
  for (let n = tc.parentNode; n; n = n.parentNode) {
    if (isElement(n) && is(n, NS.w, 'tr')) return n
  }
  throw new PyError('IndexError', 'list index out of range')
}

function gridOffset(tc: XElement): number {
  let sum = gridBefore(ancestorTr(tc))
  for (let n = tc.previousSibling; n; n = n.previousSibling) {
    if (isElement(n) && is(n, NS.w, 'tc')) sum += gridSpan(n)
  }
  return sum
}

function tcAtGridOffset(tr: XElement, offset: number): XElement {
  let remaining = offset - gridBefore(tr)
  for (const tc of findall(tr, NS.w, 'tc')) {
    if (remaining < 0) break
    if (remaining === 0) return tc
    remaining -= gridSpan(tc)
  }
  throw new PyError('ValueError', `no \`tc\` element at grid_offset=${offset}`)
}

function tcAbove(tc: XElement): XElement {
  const tr = ancestorTr(tc)
  let above: XElement | null = null
  for (let n = tr.previousSibling; n; n = n.previousSibling) {
    if (isElement(n) && is(n, NS.w, 'tr')) {
      above = n
      break
    }
  }
  if (above === null) throw new PyError('ValueError', 'no tr above topmost tr in w:tbl')
  return tcAtGridOffset(above, gridOffset(tc))
}

// _Row.cells: one entry per layout-grid cell; a horizontally spanned w:tc
// repeats, a vertically continued one stands for the w:tc that starts it.
export function rowCells(tr: XElement): XElement[] {
  const out: XElement[] = []
  const iterTc = (tc: XElement) => {
    if (vMerge(tc) === 'continue') {
      iterTc(tcAbove(tc))
      return
    }
    for (let i = 0; i < gridSpan(tc); i++) out.push(tc)
  }
  for (const tc of findall(tr, NS.w, 'tc')) iterTc(tc)
  return out
}

const pyIndex = <T>(xs: T[], i: number): T => {
  const j = i < 0 ? xs.length + i : i
  if (j < 0 || j >= xs.length) throw new PyError('IndexError', 'list index out of range')
  return xs[j]
}

// Table._cells: the layout grid, row-major; used by Table.cell(r, c).
export function tableCells(tbl: XElement): XElement[] {
  const grid = find(tbl, NS.w, 'tblGrid')
  const colCount = grid === null ? 0 : findall(grid, NS.w, 'gridCol').length
  const cells: XElement[] = []
  for (const tr of findall(tbl, NS.w, 'tr')) {
    for (const tc of findall(tr, NS.w, 'tc')) {
      for (let i = 0; i < gridSpan(tc); i++) {
        if (vMerge(tc) === 'continue') cells.push(pyIndex(cells, -colCount))
        else if (i > 0) cells.push(cells[cells.length - 1])
        else cells.push(tc)
      }
    }
  }
  return cells
}

export { pyIndex, strFromU8 }
