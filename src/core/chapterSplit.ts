// Port of khervedoc/chapter_split.py: split a long document into a project
// with one document per chapter (or per section).
//
// An imported thesis or book (.tex, Word, PDF) is one long document;
// editing and compiling it as a project of chapter documents is much
// faster, since the editor lays out and the compiler typesets one chapter
// at a time while the project still builds the whole book. `chapterPlan`
// finds the chapters, `shouldOffer` says whether the document is long
// enough to be worth splitting, and `writeChapterProject` writes the
// documents and the project that lists them.
//
// The split keeps the book as it was: every chapter-level heading starts a
// document of its own, in order and numbered as before (an "Appendix" or
// "Bibliography" chapter stays a chapter, the chapters after an \appendix
// are appendices), and what comes before the first chapter (the title, an
// abstract, acknowledgements) is a front-matter document. The project
// prints the same pages as the single document.
import * as kdocz from './kdocz.ts'
import type { FileAccess } from './kdocz.ts'
import {
  chapterEntry, classSupportsChapter, document as makeDocument, project as makeProject, projectToJson,
} from './model.ts'
import type { Block, Document, Section } from './model.ts'
import { basename, dirname, join } from './paths.ts'
import * as projectStore from './projectStore.ts'

// A document shorter than this is quick enough as it is.
export const SPLIT_MIN_PAGES = 30
// Characters of body text on a typical page, and what a figure, table and
// display equation take of one.
const CHARS_PER_PAGE = 2600
const FIGURE_PAGES = 0.35
const TABLE_PAGES = 0.25
const EQUATION_PAGES = 0.05

// The characters of text in a block (its inlines, items, cells).
function textLen(node: unknown): number {
  if (typeof node === 'string' || node === null || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + textLen(x), 0)
  const o = node as Record<string, unknown>
  let n = typeof o.text === 'string' ? (o.text as string).length : 0
  for (const k of ['children', 'items', 'rows', 'cells']) if (k in o) n += textLen(o[k])
  return n
}

// Python's round(): half to even.
function pyRound(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

// About how many pages the document prints.
export function estimatePages(doc: Document): number {
  let pages = 0
  let chars = 0
  for (const b of doc.children) {
    if (b.type === 'Figure') pages += FIGURE_PAGES
    else if (b.type === 'Table') pages += TABLE_PAGES
    else if (b.type === 'MathBlock') pages += EQUATION_PAGES
    chars += textLen(b)
  }
  return pyRound(pages + chars / CHARS_PER_PAGE)
}

// The heading levels that start a chapter. In report and book, the
// Chapter style (0) and Heading 1 (1) both print as \chapter; in a plain
// article (a Word or PDF thesis comes in as one) Heading 1 is the chapter,
// and the project becomes a report so it prints as one.
function chapterLevels(doc: Document): number[] {
  const cls = (doc.meta.documentclass || '').toLowerCase()
  if (classSupportsChapter(cls)) return [0, 1]
  if (cls === 'article') return [0, 1]
  return []
}

function headingText(sec: Section): string {
  return sec.children.map(c => ('text' in c && typeof c.text === 'string' ? c.text : '')).join('').trim()
}

const APPENDIX_RE = /^\s*\\appendix\s*$/

// An \appendix on its own: a raw block, or a paragraph holding only that
// command.
export function isAppendixMark(block: Block): boolean {
  if (block.type === 'RawLatex') return APPENDIX_RE.test(block.text || '')
  if (block.type === 'Paragraph') {
    const kids = block.children.filter(c => !(c.type === 'Text' && !c.text.trim()))
    return kids.length === 1 && kids[0].type === 'InlineRaw' && APPENDIX_RE.test(kids[0].latex || '')
  }
  return false
}

// A heading that only says which chapter follows ("CHAPTER I", "Chapter
// 2", "Part III"): a PDF or Word thesis sets it on a line of its own.
const CHAPTER_MARK_RE = /^(?:chapter|part)\s*(?:[ivxlcdm]+|\d+)?\s*[.:]?$/i
// The pages before the first chapter.
const FRONT_RE = new RegExp('^(?:acknowledge?ments?|contents|table of contents|list of (?:figures|tables|'
  + 'abbreviations|symbols|publications)|abstract|preface|dedication|'
  + 'declaration(?: of originality)?|nomenclature|glossary|foreword)\\s*[.:]?$', 'i')
const APPENDIX_TITLE_RE = /^appendi(?:x|ces)\b/i

// One chapter's title from the headings that open it: the chapter mark
// dropped, a title broken over two headings joined.
function mergeLabel(texts: string[]): string {
  const words = texts.filter(t => !CHAPTER_MARK_RE.test(t))
  return (words.length ? words : texts).join(' ')
}

export type SplitBy = 'chapter' | 'section'
export type PlanEntry = [label: string, chapterType: string, blocks: Block[]]

// [label, chapter_type, blocks] for each document of the split: a front
// matter first when anything comes before the first chapter, then one per
// chapter, or with by "section" also one per section of a chapter
// (chapter_type "section": it continues its chapter's page). Empty when
// there are fewer than two chapters.
//
// Chapter headings with nothing between them open one chapter ("CHAPTER I"
// then "Introduction"; a long title an import broke in two). The title
// page, acknowledgements, contents and lists of figures and tables at the
// start are the front matter. An \appendix between chapters, or a chapter
// called Appendix, starts the appendices: the project writes \appendix
// itself before them and letters them A, B... as the document did (inside
// the chapter before, it was undone by the chapter counter the project
// sets), so the mark is left out.
export function chapterPlan(doc: Document, by: SplitBy = 'chapter'): PlanEntry[] {
  const levels = chapterLevels(doc)
  if (!levels.length) return []
  const cls = (doc.meta.documentclass || '').toLowerCase()
  const sectionLevel = by === 'section' && classSupportsChapter(cls) ? 2 : null
  const children = doc.children
  // Each document: where it starts, the headings that open it, and
  // whether it is a chapter (else a section of one).
  const groups: [number, string[], boolean][] = []
  children.forEach((b, i) => {
    if (b.type !== 'Section' || !headingText(b)) return
    if (levels.includes(b.level)) {
      const last = groups[groups.length - 1]
      if (last && last[2] && i === last[0] + last[1].length) last[1].push(headingText(b))
      else groups.push([i, [headingText(b)], true])
    } else if (b.level === sectionLevel && groups.length) {
      groups.push([i, [headingText(b)], false])
    }
  })
  const labels = groups.map(([, t]) => mergeLabel(t))
  const chapters = groups.map((_, g) => g).filter(g => groups[g][2])
  // The front matter runs to the last front-matter heading in the first
  // half (the title heading of a PDF before its acknowledgements too).
  let front = -1
  for (const g of chapters.slice(0, Math.max(1, Math.floor(chapters.length / 2)))) {
    if (FRONT_RE.test(labels[g])) front = g
  }
  const body: number[] = []
  for (let g = front + 1; g < groups.length; g++) body.push(g)
  if (body.filter(g => groups[g][2]).length < 2) return []
  const first = groups[body[0]][0]
  const marks = children.map((b, i) => (isAppendixMark(b) ? i : -1)).filter(i => i > first)
  const appendixFrom = Math.min(...marks,
    ...body.filter(g => groups[g][2] && APPENDIX_TITLE_RE.test(labels[g])).map(g => groups[g][0]),
    children.length)
  const keep = (blocks: Block[]) => blocks.filter(b => !isAppendixMark(b))
  const plan: PlanEntry[] = []
  if (first > 0) plan.push(['Front matter', 'frontmatter', keep(children.slice(0, first))])
  body.forEach((g, k) => {
    const at = groups[g][0]
    const end = k + 1 < body.length ? groups[body[k + 1]][0] : children.length
    const ctype = !groups[g][2] ? 'section' : at >= appendixFrom ? 'appendix' : 'chapter'
    plan.push([labels[g], ctype, keep(children.slice(at, end))])
  })
  return plan
}

// A document with chapters, long enough that splitting it pays.
export function shouldOffer(doc: Document): boolean {
  return chapterPlan(doc).filter(p => p[1] === 'chapter' || p[1] === 'appendix').length >= 2
    && estimatePages(doc) >= SPLIT_MIN_PAGES
}

function fileStem(label: string, limit = 48): string {
  let s = label.replace(/[^\p{L}\p{N}_\- ]+/gu, '').trim()
  s = s.replace(/\s+/g, ' ').slice(0, limit).trim()
  return s || 'Chapter'
}

// Where the split of `source` goes: a new folder beside it.
export async function projectFolder(source: string, fs: FileAccess): Promise<string> {
  const stem = basename(source).replace(/\.[^.]*$/, '')
  const base = `${stem} (chapters)`
  let folder = join(dirname(source), base)
  let n = 2
  while (await fs.exists(folder)) {
    folder = join(dirname(source), `${base} ${n}`)
    n += 1
  }
  return folder
}

// Write each document of the split into `folder` and the project into the
// first of them, the project's main .ktex; return that file. The documents
// share the original's settings; split by chapter, a plain article becomes
// a report so its chapters print as chapters.
export async function writeChapterProject(doc: Document, folder: string, title: string,
  by: SplitBy, fs: projectStore.StoreFs): Promise<string> {
  const plan = chapterPlan(doc, by)
  if (!plan.length) throw new Error('The document has fewer than two chapters.')
  await fs.mkdir?.(folder)
  const meta = structuredClone(doc.meta)
  if (by === 'chapter' && (meta.documentclass || '').toLowerCase() === 'article') meta.documentclass = 'report'
  const proj = makeProject({ meta: structuredClone(meta) })
  proj.meta.title = title
  let main: string | null = null
  let number = 0
  let section = 0
  for (const [k, [label, ctype, blocks]] of plan.entries()) {
    let stem: string
    if (ctype === 'section') {
      section += 1
      stem = `${String(number).padStart(2, '0')}.${section} ${fileStem(label)}`
    } else if (ctype !== 'frontmatter') {
      number += 1
      section = 0
      stem = `${String(number).padStart(2, '0')} ${fileStem(label)}`
    } else {
      stem = fileStem(label)
    }
    const path = await projectStore.uniquePath(folder, stem, fs)
    await projectStore.writeDoc(makeDocument(blocks, structuredClone(meta)), path, fs)
    proj.chapters.push(chapterEntry({
      path: basename(path), label, enabled: true, start_page: k === 0 ? 1 : null, numbering: 'arabic',
      chapter_type: ctype,
    }))
    main ??= path
  }
  await kdocz.writeProjectJson(main!, projectToJson(proj), fs)
  return main!
}
