// The visual editor: DocumentEditor + PagedTextEdit (editor.py,
// paged_edit.py) over ProseMirror. It owns the view, keeps the store's
// document in step with it, lays the pages out, paints the sheets, the
// headers, footers and footnotes, and offers the EditorApi.
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { history } from 'prosemirror-history'
import { EditorState, NodeSelection, TextSelection, type Plugin, type Transaction } from 'prosemirror-state'
import { tableEditing } from 'prosemirror-tables'
import { EditorView } from 'prosemirror-view'
import { runAction } from '../app/actions.ts'
import type { EquationEditing } from '../app/actions/math.ts'
import type { PageEditing } from '../app/actions/page.ts'
import type { PageFurniture } from '../app/pageAnchors.ts'
import { setEditorApi, type EditorApi } from '../app/editorApi.ts'
import { appStore, editDoc } from '../app/store.ts'
import { FIGURE_UPDATED_EVENT } from '../drawing/host.ts'
import * as M from '../core/model.ts'
import { isAbsolute, join } from '../core/paths.ts'
import { ReferenceResolver } from '../core/references.ts'
import type { ContextKind } from '../ui/ribbonModel.ts'
import { setCommandChecked } from '../ui/commands.ts'
import * as C from './commands.ts'
import { docFromPM, docToPM } from './convert.ts'
import { editorKeymaps } from './keymap.ts'
import { loadFonts, pdfFont, primaryFamily } from './latexFonts.ts'
import { anchorTargets, screenFontFor, type DocLayout, type PageAnchor, type PageGeometry } from './layout.ts'
import { computeColumnSpacers, computeSpacers, sameSpacers } from './paginate.ts'
import { layoutKey, layoutPlugin, pagesKey, pagesPlugin } from './plugins.ts'
import { showContextMenu } from './contextMenu.ts'
import { setRibbonWidgets } from './ribbonState.ts'
import { SPELL_REFRESH, spellPlugin } from './spell.ts'
import { spellHighlighter } from '../spell/shared.ts'
import { nodeViews, type ViewHost } from './views.ts'

let current: EditorController | null = null

// The mounted editor, for the ribbon actions.
export function editor(): EditorController | null {
  return current
}

function setCurrent(e: EditorController | null): void {
  current = e
}

// Bibliography text the citations resolve against (KherveRef library).
let extraBib = ''
const bibListeners = new Set<() => void>()
export function setEditorBibliography(text: string): void {
  if (text === extraBib) return
  extraBib = text
  for (const l of bibListeners) l()
}

// Where figure images come from: a URL for a figure path, or null.
type ImageLoader = (absPath: string) => Promise<string | null>
let imageLoader: ImageLoader | null = null
export function setImageLoader(fn: ImageLoader | null): void {
  imageLoader = fn
}

const NO_EXPORT = 'kt-no-export'
const DESK = '#d0d4d8'
const SHEET_EDGE = '#b8bcc1'
const FIELD_RE = /\{(\w+)\}/g

export class EditorController implements ViewHost {
  view: EditorView
  private root: HTMLElement
  private sheetsEl: HTMLElement
  private flowEl: HTMLElement
  private overlayEl: HTMLElement
  private onContext: (k: ContextKind | null) => void
  private atoms = new Set<{ render(): void }>()
  private lastDoc: M.Document
  private serial: number
  private unsub: () => void
  private unsubSpell: () => void
  private resolverCache: ReferenceResolver
  private resolverTimer = 0
  private pageTimer = 0
  private pageIter = 0
  private columnShrink: number[] = []
  private sheets = 1
  private images = new Map<string, { abs: string; url: string } | null>()
  private exportQueued = false
  private lastContext: ContextKind | null = null
  private destroyed = false
  // Measurements made before a font arrived (a title's line count, a
  // run-in heading's width) are made again.
  private onFonts = () => this.relayout()

  private relayout(): void {
    if (this.destroyed) return
    this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { meta: this.meta })
      .setMeta('addToHistory', false).setMeta(NO_EXPORT, true))
  }

  constructor(mount: HTMLElement, onContext: (k: ContextKind | null) => void) {
    this.root = mount
    this.onContext = onContext
    mount.classList.add('kt-pages')
    // The page check (src/dev/pageCheck.ts) reads the layout through this.
    if (import.meta.env.DEV) (mount as HTMLElement & { __ktCtl?: unknown }).__ktCtl = this
    this.sheetsEl = document.createElement('div')
    this.sheetsEl.className = 'kt-sheets'
    // The page's padding and font sit on a wrapper: ProseMirror reads any
    // change to its own element's attributes as an edit.
    this.flowEl = document.createElement('div')
    this.flowEl.className = 'kt-flow-wrap'
    const pmEl = document.createElement('div')
    this.flowEl.appendChild(pmEl)
    this.overlayEl = document.createElement('div')
    this.overlayEl.className = 'kt-overlay'
    mount.replaceChildren(this.sheetsEl, this.flowEl, this.overlayEl)

    const s = appStore().get()
    this.lastDoc = s.doc
    this.serial = s.docSerial
    this.resolverCache = new ReferenceResolver(s.doc, null, extraBib)
    this.view = new EditorView({ mount: pmEl }, {
      state: this.makeState(s.doc),
      nodeViews: nodeViews(this, this.atoms),
      dispatchTransaction: tr => this.dispatch(tr),
      attributes: { spellcheck: 'false', class: 'kt-flow' },
      handleDOMEvents: {
        focus: () => { this.syncToolbar(); return false },
        contextmenu: (_v, e) => { e.preventDefault(); return showContextMenu(this, e) },
      },
    })
    this.applyGeometry()
    setCurrent(this)
    setEditorApi(this.api())
    this.unsub = appStore().subscribe(() => this.onStore())
    bibListeners.add(this.refreshResolverNow)
    this.unsubSpell = spellHighlighter().onChange(() => {
      if (!this.destroyed) this.view.dispatch(this.view.state.tr.setMeta(SPELL_REFRESH, true).setMeta('addToHistory', false))
    })
    document.fonts?.addEventListener?.('loadingdone', this.onFonts)
    window.addEventListener(FIGURE_UPDATED_EVENT, this.onFigureUpdated)
    void loadFonts(this.families()).then(() => this.relayout())
    this.schedulePages(0)
    this.syncToolbar()
  }

  destroy(): void {
    this.destroyed = true
    this.flushExport()
    this.unsub()
    this.unsubSpell()
    bibListeners.delete(this.refreshResolverNow)
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts)
    window.removeEventListener(FIGURE_UPDATED_EVENT, this.onFigureUpdated)
    clearTimeout(this.pageTimer)
    clearTimeout(this.resolverTimer)
    if (current === this) { setCurrent(null); setEditorApi(null) }
    this.view.destroy()
  }

  // ---------- state ----------

  private plugins(meta: M.DocMeta): Plugin[] {
    return [
      layoutPlugin(meta), pagesPlugin(), spellPlugin(),
      ...editorKeymaps({ run: id => { void runAction(id); return true } }),
      history(), tableEditing(), gapCursor(), dropCursor(),
    ]
  }

  private makeState(doc: M.Document): EditorState {
    return EditorState.create({ doc: docToPM(doc), plugins: this.plugins(doc.meta) })
  }

  get meta(): M.DocMeta {
    return layoutKey.getState(this.view.state)!.meta
  }

  get layout(): DocLayout {
    return layoutKey.getState(this.view.state)!.layout
  }

  get state(): EditorState {
    return this.view.state
  }

  private burst = { t: 0, n: 0 }

  private dispatch(tr: Transaction): void {
    if (this.destroyed) return
    const now = performance.now()
    if (now - this.burst.t > 1000) this.burst = { t: now, n: 0 }
    if (++this.burst.n > 300) {
      if (this.burst.n === 301) console.error('kt: transaction storm', tr.steps.map(s => s.toJSON()), tr.selectionSet, tr.docChanged)
      return
    }
    const before = this.view.state
    const next = before.apply(tr)
    this.view.updateState(next)
    const pages = tr.getMeta(pagesKey)
    const metaChanged = !!tr.getMeta(layoutKey)
    if (tr.docChanged || metaChanged) {
      if (!tr.getMeta(NO_EXPORT)) this.queueExport()
      if (metaChanged) this.applyGeometry()
      this.schedulePages(tr.docChanged && !metaChanged ? 120 : 0)
    } else if (pages) {
      this.schedulePages(0, true)
    }
    if (tr.docChanged || tr.selectionSet || metaChanged) this.syncToolbar()
  }

  // Run a command on the current state.
  run(cmd: C.Command): boolean {
    const ok = cmd(this.view.state, tr => this.view.dispatch(tr))
    this.view.focus()
    return ok
  }

  // ---------- the store ----------

  private queueExport(): void {
    if (this.exportQueued) return
    this.exportQueued = true
    queueMicrotask(() => this.flushExport())
  }

  // Hand the document to the store (DocumentEditor.documentChanged).
  flushExport(): void {
    if (!this.exportQueued) return
    this.exportQueued = false
    const doc = docFromPM(this.view.state.doc, this.meta)
    this.lastDoc = doc
    editDoc(doc)
    // The resolver renumbers citations and references after the edit.
    clearTimeout(this.resolverTimer)
    this.resolverTimer = window.setTimeout(this.refreshResolverNow, 450)
  }

  private onStore(): void {
    const s = appStore().get()
    if (s.docSerial === this.serial && s.doc !== this.lastDoc && s.doc.children === this.lastDoc.children) {
      // Only the meta changed (a package added for \ce, say): no reload,
      // the caret and the undo history stay.
      this.lastDoc = s.doc
      this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { meta: s.doc.meta })
        .setMeta('addToHistory', false).setMeta(NO_EXPORT, true))
      return
    }
    if (s.docSerial !== this.serial || s.doc !== this.lastDoc) {
      this.serial = s.docSerial
      this.lastDoc = s.doc
      this.reload(s.doc)
    }
  }

  // set_document: the document replaced wholesale (open, new, Code tab).
  reload(doc: M.Document): void {
    this.exportQueued = false
    this.pdfFurniture = null
    this.view.updateState(this.makeState(doc))
    this.refreshResolverNow()
    this.applyGeometry()
    void loadFonts(this.families()).then(() => this.relayout())
    this.schedulePages(0)
    this.syncToolbar()
  }

  // set_meta: page size, class, fonts, margins... changed.
  setMeta(meta: M.DocMeta): void {
    this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { meta }).setMeta('addToHistory', false))
    void loadFonts(this.families()).then(() => this.relayout())
  }

  // _sheet_labels: each sheet named for the PDF page it shows; a sheet that
  // only exists because the editor's page overflowed reads "N (cont.)".
  private sheetLabels(sheets: number): string[] {
    const H = this.layout.geometry.heightPx
    const anchors = layoutKey.getState(this.view.state)!.anchors
    if (!anchors.length || this.layout.geometry.cols > 1) {
      return Array.from({ length: sheets }, (_, k) => String(k + this.firstPage))
    }
    const starts = new Map<number, number>([[0, this.firstPage]])
    const z = this.zoom()
    const top0 = this.flowEl.getBoundingClientRect().top
    for (const t of anchorTargets(this.view.state.doc, anchors)) {
      let y: number
      try {
        y = (this.view.coordsAtPos(Math.min(t.pos + 1 + t.offset, this.view.state.doc.content.size)).top - top0) / z
      } catch { continue }
      const k = Math.floor(y / H)
      if (!starts.has(k)) starts.set(k, t.page)
    }
    const out: string[] = []
    let cur = 1
    for (let k = 0; k < sheets; k++) {
      if (starts.has(k)) { cur = starts.get(k)!; out.push(String(cur)) } else out.push(`${cur} (cont.)`)
    }
    return out
  }

  private firstPage = 1

  // set_first_page_number: a project document continues from the pages
  // of the documents before it.
  setPageNumberStart(n: number): void {
    const v = Math.max(1, Math.trunc(n || 1))
    if (v === this.firstPage) return
    this.firstPage = v
    this.paint(this.layout.geometry)
  }

  // set_page_anchors + sync_pages_to_pdf: the compiled PDF's page count
  // and the first text of each page after the first.
  setPageAnchors(anchors: readonly PageAnchor[], furniture?: readonly PageFurniture[]): void {
    this.pdfFurniture = furniture ?? null
    this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { anchors: [...anchors] })
      .setMeta('addToHistory', false).setMeta(NO_EXPORT, true))
  }

  // Each compiled PDF page's printed header and footer (pageAnchors); its
  // sheet paints them in place of the class's own.
  private pdfFurniture: readonly PageFurniture[] | null = null

  // set_heading_offset: numbered headings used by the project's earlier
  // documents, per level (index 0 = chapter).
  setHeadingOffset(headingOffset: number[]): void {
    const off = [...(headingOffset ?? [])].slice(0, 6)
    while (off.length < 6) off.push(0)
    this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { headingOffset: off })
      .setMeta('addToHistory', false).setMeta(NO_EXPORT, true))
  }

  private refreshResolverNow = (): void => {
    if (this.destroyed) return
    this.resolverCache = new ReferenceResolver(docFromPM(this.view.state.doc, this.meta), null, extraBib)
    for (const a of this.atoms) a.render()
  }

  // ---------- ViewHost ----------

  resolver(): ReferenceResolver {
    return this.resolverCache
  }

  bodyPx(): number {
    return this.layout.bodyChar.sizePx
  }

  textWidthPx(): number {
    const g = this.layout.geometry
    return g.widthPx - g.leftPx - g.rightPx
  }

  // A figure's image, by its model path: a URL once loaded, null until then
  // (the figure shows its path meanwhile, as Qt shows a missing image).
  resolveImage(path: string): string | null {
    if (!path) return null
    const hit = this.images.get(path)
    if (hit !== undefined) return hit?.url ?? null
    this.images.set(path, null)
    void (async () => {
      const abs = await resolveFigurePath(path)
      if (abs === null || this.destroyed) return
      const url = await (imageLoader ?? defaultImageLoader)(abs)
      if (!url || this.destroyed) return
      this.images.set(path, { abs, url })
      for (const a of this.atoms) a.render()
      this.schedulePages(0)
    })()
    return null
  }

  // refresh_figure_image: a drawing or flowchart was saved again.
  private onFigureUpdated = (e: Event): void => {
    const changed = (e as CustomEvent<{ path?: string }>).detail?.path ?? ''
    let any = false
    for (const [path, entry] of this.images) {
      const abs = entry?.abs ?? path
      if (!changed || abs === changed || abs.endsWith(changed) || changed.endsWith(path)) {
        if (entry) URL.revokeObjectURL(entry.url)
        this.images.delete(path)
        any = true
      }
    }
    if (any) for (const a of this.atoms) a.render()
  }

  onMathDoubleClick(pos: number, _display: boolean): void {
    this.selectNode(pos)
    void runAction('eq_edit')
  }

  onFigureDoubleClick(pos: number): void {
    this.selectNode(pos)
    void runAction('fig_edit')
  }

  onFootnoteDoubleClick(pos: number): void {
    this.selectNode(pos)
    void runAction('footnote_edit')
  }

  selectNode(pos: number): void {
    const tr = this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))
    this.view.dispatch(tr)
  }

  // ---------- geometry, sheets, overlay ----------

  private families(): string[] {
    const fams = new Set<string>()
    const add = (css: string) => fams.add(`'${primaryFamily(css)}'`)
    const L = this.layout
    add(L.bodyChar.family)
    for (const b of L.blocks) {
      if (b.char) add(b.char.family)
      for (const l of b.above) add(l.family)
      if (b.runIn) add(b.runIn.family)
    }
    return [...fams]
  }

  private applyGeometry(): void {
    const g = this.layout.geometry
    const st = this.root.style
    st.width = `${g.widthPx}px`
    st.setProperty('--kt-page-h', `${g.heightPx}px`)
    const f = this.flowEl.style
    f.paddingTop = `${g.topPx}px`
    f.paddingLeft = `${g.leftPx}px`
    f.paddingRight = `${g.rightPx}px`
    f.paddingBottom = `${g.bottomPx}px`
    const body = this.layout.bodyChar
    f.fontFamily = body.family
    f.fontSize = `${body.sizePx}px`
    f.setProperty('--kt-body-family', body.family)
    f.setProperty('--kt-body-size', `${body.sizePx}px`)
    // Columns: one balanced run of CSS columns, the title spanning them.
    this.flowEl.classList.toggle('kt-cols', g.cols > 1)
    f.setProperty('--kt-cols', String(g.cols))
    f.setProperty('--kt-colgap', `${g.colGapPx}px`)
    const full = g.widthPx - g.leftPx - g.rightPx
    f.setProperty('--kt-fullw', `${full}px`)
    f.setProperty('--kt-colw', `${(full - g.colGapPx * (g.cols - 1)) / g.cols}px`)
  }

  // Re-measure the flow and move page breaks, a few rounds until stable.
  schedulePages(delay: number, continuing = false): void {
    if (this.destroyed) return
    if (!continuing) { this.pageIter = 0; this.columnShrink = [] }
    clearTimeout(this.pageTimer)
    this.pageTimer = window.setTimeout(() => this.paginate(), delay)
  }

  // Where the compiled PDF starts a page inside a paragraph (a page that
  // starts at a block's start is forced by the layout already).
  private midParagraphPageStarts(): number[] {
    const anchors = layoutKey.getState(this.view.state)!.anchors
    if (!anchors.length) return []
    return anchorTargets(this.view.state.doc, anchors).filter(t => t.offset > 0)
      .map(t => t.pos + 1 + t.offset)
  }

  private paginate(): void {
    if (this.destroyed || !this.view.dom.isConnected) return
    const geo = this.layout.geometry
    const old = pagesKey.getState(this.view.state)!.spacers
    const { spacers, measure } = geo.cols > 1
      ? computeColumnSpacers(this.view, geo, this.flowEl, old, this.columnShrink)
      : computeSpacers(this.view, geo, this.flowEl, this.midParagraphPageStarts(),
        layoutKey.getState(this.view.state)!.anchors.length > 0)
    if (!sameSpacers(old, spacers) && this.pageIter < 6) {
      this.pageIter += 1
      this.view.dispatch(this.view.state.tr.setMeta(pagesKey, spacers).setMeta('addToHistory', false))
      return
    }
    this.sheets = measure.sheets
    this.paint(geo)
  }

  pageGapPx(): number {
    return Math.max(6, Math.round(this.layout.geometry.heightPx * 0.011))
  }

  // _paint_sheets, _paint_furniture and _paint_footnotes.
  private paint(geo: PageGeometry): void {
    const H = geo.heightPx
    const n = this.sheets
    const total = n * H
    this.root.style.height = `${total}px`
    this.flowEl.style.minHeight = `${total}px`
    const g = this.pageGapPx()
    const parts: string[] = []
    for (let k = 0; k < n; k++) {
      const top = k * H + (k ? g / 2 : 0)
      const bottom = k < n - 1 ? (k + 1) * H - g / 2 : total - 1
      parts.push(`<div class="kt-sheet" style="top:${top}px;height:${bottom - top}px;border-color:${SHEET_EDGE}"></div>`)
      if (k < n - 1) {
        parts.push(`<div class="kt-sheet-gap" style="top:${bottom}px;height:${g}px;background:${DESK}"></div>`)
      }
    }
    this.sheetsEl.innerHTML = parts.join('')
    this.paintOverlay(geo, n)
  }

  private sheetOf(el: Element): number {
    const z = this.zoom()
    const top = (el.getBoundingClientRect().top - this.flowEl.getBoundingClientRect().top) / z
    return Math.max(0, Math.floor(top / this.layout.geometry.heightPx))
  }

  private zoom(): number {
    const r = this.root.getBoundingClientRect()
    return this.root.offsetWidth ? r.width / this.root.offsetWidth : 1
  }

  private paintOverlay(geo: PageGeometry, sheets: number): void {
    const H = geo.heightPx
    const L = this.layout
    const look = L.look
    const pt = 96 / 72
    const out: string[] = []
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const gap = this.pageGapPx()

    // Footnotes: numbered through the document, each at the foot of the
    // sheet its mark is on.
    const notes = new Map<number, { n: number; text: string }[]>()
    let fn = 0
    for (const el of this.flowEl.querySelectorAll<HTMLElement>('.kt-footnote')) {
      fn += 1
      const mark = el.querySelector('.kt-footnote-mark')
      if (mark) mark.textContent = String(fn)
      const sheet = this.sheetOf(el)
      if (!notes.has(sheet)) notes.set(sheet, [])
      notes.get(sheet)!.push({ n: fn, text: el.title })
    }
    const small = L.bodyChar.sizePx * 0.8
    for (const [sheet, items] of notes) {
      const g = sheet < sheets - 1 ? gap / 2 : 0
      let y = (sheet + 1) * H - g - geo.bottomPx + 4
      out.push(`<div class="kt-fn-rule" style="left:${geo.leftPx}px;top:${y}px;width:${geo.widthPx * 0.3}px"></div>`)
      for (const it of items) {
        out.push(`<div class="kt-fn" style="left:${geo.leftPx}px;right:${geo.rightPx}px;top:${y + 2}px;`
          + `font-family:${L.bodyChar.family};font-size:${small}px;line-height:${small * 1.407}px">`
          + `<sup style="font-size:${small * 0.75}px">${it.n}</sup> ${esc(it.text)}</div>`)
        y += small * 1.407
      }
    }

    // Headers and footers the class prints, filled in with this
    // document's words (_paint_furniture).
    const furniture = look.furniture ?? {}
    const starts = new Map<number, DocLayout['heads']>()
    for (const h of L.heads) {
      const dom = this.view.nodeDOM(h.pos)
      if (!(dom instanceof HTMLElement)) continue
      const k = this.sheetOf(dom)
      if (!starts.has(k)) starts.set(k, [])
      starts.get(k)!.push(h)
    }
    const now = new Date()
    const month = now.toLocaleString('en-GB', { month: 'long' })
    const fields: Record<string, string> = {
      ...L.fields, date: `${month} ${now.getDate()}, ${now.getFullYear()}`,
      date_uk: `${now.getDate()} ${month} ${now.getFullYear()}`, pages: String(sheets),
      h1: '', h2: '', num1: '', num2: '',
    }
    const labels = this.sheetLabels(sheets)
    for (let k = 0; k < sheets; k++) {
      const label = labels[k]
      if (label.includes('cont')) {
        // A sheet the editor's page overflowed onto: "N (cont.)", in the
        // sheet painter's own colour, and no class furniture.
        const g = k < sheets - 1 ? gap / 2 : 0
        const size = L.bodyChar.sizePx * 0.9
        out.push(`<div class="kt-cont" style="left:0;right:0;top:${(k + 1) * H - geo.bottomPx / 2 - g - size * 0.6}px;`
          + `font-family:${L.bodyChar.family};font-size:${size}px">${esc(label)}</div>`)
        continue
      }
      let opensChapter = false
      let firstH2: [string, string] | null = null
      for (const h of starts.get(k) ?? []) {
        if (h.level === 1) {
          Object.assign(fields, { h1: h.title, num1: h.number, h2: '', num2: '' })
          opensChapter = opensChapter || h.isChapter
        } else if (!firstH2) {
          firstH2 = [h.title, h.number]
        }
      }
      const shown = { ...fields }
      if (firstH2) {
        Object.assign(shown, { h2: firstH2[0], num2: firstH2[1] })
        Object.assign(fields, { h2: firstH2[0], num2: firstH2[1] })
        for (const h of starts.get(k) ?? []) if (h.level !== 1) Object.assign(fields, { h2: h.title, num2: h.number })
      }
      const number = label.split(' ')[0]
      const pageNo = /^\d+$/.test(number) ? Number(number) : k + 1
      const kind = k === 0 ? 'first' : opensChapter && 'chapter' in furniture ? 'chapter'
        : pageNo % 2 === 0 ? 'even' : 'odd'
      shown.page = number
      const top = k * H
      // Compiled: the PDF page's own header and footer, at its positions,
      // with the class's rules.
      const pdfPage = this.pdfFurniture && this.firstPage === 1 && /^\d+$/.test(label)
        ? this.pdfFurniture[Number(label) - 1] : undefined
      if (pdfPage) {
        for (const item of furniture[kind] ?? []) {
          if (!item.rule) continue
          out.push(`<div class="kt-fur-rule" style="left:${geo.leftPx}px;right:${geo.rightPx}px;top:${top + item.y * pt}px;`
            + `border-top-width:${Math.max(0.5, (item.width ?? 0.4) * pt)}px"></div>`)
        }
        const s = geo.widthPx / pdfPage.width
        const headBottom = geo.topPx / s
        const footTop = (H - geo.bottomPx) / s
        for (const sp of pdfPage.spans) {
          if (sp.bottom > headBottom + 1 && sp.top < footTop - 1) continue
          const f = resolvePdfFont(sp.font, this.meta) ?? { family: L.bodyChar.family, bold: false, italic: false }
          const size = sp.size * s
          const lh = size * 1.2
          out.push(`<div class="kt-fur" style="left:${sp.x * s}px;top:${top + sp.baseline * s - 0.79 * lh}px;`
            + `line-height:${lh}px;white-space:pre;font-family:${f.family};font-weight:${f.bold ? 700 : 400};`
            + `font-style:${f.italic ? 'italic' : 'normal'};font-size:${size}px">${esc(sp.text)}</div>`)
        }
        continue
      }
      for (const item of furniture[kind] ?? []) {
        const y = top + item.y * pt
        if (item.rule) {
          out.push(`<div class="kt-fur-rule" style="left:${geo.leftPx}px;right:${geo.rightPx}px;top:${y}px;`
            + `border-top-width:${Math.max(0.5, (item.width ?? 0.4) * pt)}px"></div>`)
          continue
        }
        let text = item.text ?? ''
        const names = [...text.matchAll(FIELD_RE)].map(m => m[1])
        // A header that only names what this document does not have.
        if (names.length && !names.some(nm => shown[nm]) && !text.replace(FIELD_RE, '').replace(/^[ .:]+|[ .:]+$/g, '')) continue
        text = text.replace(FIELD_RE, (_m, nm: string) => shown[nm] ?? '').trim()
        if (item.upper) text = text.toUpperCase()
        const f = this.screenFontCss(item.font ?? '')
        const size = (item.size ?? 10) * pt
        const color = item.color && item.color !== '#000000' ? `color:${item.color};` : ''
        const anchor = item.anchor
        const pos = anchor === 'left' ? `left:${geo.leftPx}px;`
          : anchor === 'right' ? `right:${geo.rightPx}px;text-align:right;`
            : anchor === 'center' ? `left:${geo.leftPx}px;right:${geo.rightPx}px;text-align:center;`
              : `left:${(item.x ?? 0) * pt}px;`
        const lh = size * 1.2
        out.push(`<div class="kt-fur" style="${pos}top:${y - 0.79 * lh}px;line-height:${lh}px;`
          + `${f}font-size:${size}px;${color}">${esc(text)}</div>`)
      }
    }
    this.overlayEl.innerHTML = out.join('')
  }

  private screenFontCss(pdfName: string): string {
    // The block styles already resolved this name; reuse the layout's
    // resolution through a small probe.
    const probe = { family: this.layout.bodyChar.family, bold: false, italic: false }
    const r = resolvePdfFont(pdfName, this.meta) ?? probe
    return `font-family:${r.family};font-weight:${r.bold ? 700 : 400};font-style:${r.italic ? 'italic' : 'normal'};`
  }

  // ---------- toolbar sync (_sync_toolbar_state) ----------

  syncToolbar(): void {
    const s = this.view.state
    for (const [id, mark] of Object.entries(C.MARK_FOR_COMMAND)) setCommandChecked(id, C.isMarkActive(s, mark))
    const align = C.currentAlignment(s)
    const alignId = { left: 'align_left', center: 'align_center', right: 'align_right', justify: 'align_justify' }[align]
      ?? 'align_left'
    setCommandChecked(alignId, true)
    const meta = this.meta
    const cols = Math.max(1, Math.min(3, Math.trunc(meta.column_count || 1)))
    setCommandChecked(`cols_${cols}`, true)
    let level = C.currentHeadingLevel(s)
    if (level === -99) level = 0
    if (level === 0) setCommandChecked('h_body', true)
    const isHeading = (level >= 1 && level <= 5) || level === -5
    const cls = (meta.documentclass || '').toLowerCase()
    const disabled: Record<number, string> = {}
    if (!M.classSupportsChapter(meta.documentclass)) {
      disabled[-5] = `Chapter is only available in the book, report and memoir document classes — the current class is '${meta.documentclass}'.`
    }
    if (cls !== 'beamer') {
      disabled[-6] = `Frame is only available in the beamer document class — the current class is '${meta.documentclass}'.`
    }
    setRibbonWidgets({
      styleLevel: level, numberedEnabled: isHeading, numbered: isHeading ? C.isHeadingNumbered(s) : true,
      docClass: meta.documentclass, fontSize: String(meta.body_font_pt), disabledStyles: disabled,
    })
    for (const code of ['A4', 'Letter', 'Legal']) setCommandChecked(`pagesize_${code}`, meta.page_size === code)
    for (const [name, m] of MARGIN_PRESETS) {
      const cur = [meta.margin_top_cm, meta.margin_bottom_cm, meta.margin_left_cm, meta.margin_right_cm]
      setCommandChecked(`margin_${name}`, cur.every((v, i) => Math.abs(v - m[i]) < 0.01))
    }
    const ctx = C.contextObject(s)
    if (ctx === 'table') {
      const col = C.currentColumnAlignment(s)
      setCommandChecked(`tbl_align_${col || 'l'}`, true)
      const style = C.currentTableStyle(s)
      const styleId = { '': 'tbl_plain', grid: 'tbl_grid', booktabs: 'tbl_booktabs', striped: 'tbl_striped', plain: 'tbl_nolines' }[style]
      if (styleId) setCommandChecked(styleId, true)
      const [header, repeat] = C.tableHeader(s)
      setCommandChecked('tbl_header', header)
      setCommandChecked('tbl_repeat', repeat)
    } else if (ctx === 'figure') {
      const a = C.currentAlignment(s)
      setCommandChecked(a === 'left' ? 'fig_left' : a === 'right' ? 'fig_right' : 'fig_center', true)
    } else if (ctx === 'theorem') {
      const kind = C.currentTheoremKind(s)
      if (kind) setCommandChecked(`thm_kind_${kind}`, true)
    } else if (ctx === 'equation') {
      setCommandChecked('eq_numbered', C.currentEquationNumbered(s))
    }
    if (ctx !== this.lastContext) {
      this.lastContext = ctx
      this.onContext(ctx)
    }
  }

  // ---------- EditorApi ----------

  private api(): EditorApi & EquationEditing & PageEditing {
    return {
      // Projects and the compiled PDF (src/app/actions/page.ts).
      setPageNumberStart: n => this.setPageNumberStart(n),
      setHeadingOffset: c => this.setHeadingOffset(c ?? []),
      setPageAnchors: (_pages, anchors, furniture) => this.setPageAnchors(anchors, furniture),
      // The contextual Equation tab (src/app/actions/math.ts).
      equationNumbered: () => C.currentEquationNumbered(this.view.state),
      setEquationNumbered: on => { this.run(C.setEquationNumbered(on)) },
      deleteEquation: () => { this.run(C.deleteEquation) },
      insertInline: node => { this.run(C.insertInlines([node])) },
      insertBlock: node => { this.run(C.insertModelBlocks([node], { trailingParagraph: true })) },
      replaceMath: latex => { this.run(C.replaceMath(latex)) },
      selection: () => {
        const s = this.view.state
        const mb = C.currentMathBlock(s) ?? C.currentMathInline(s)
        return {
          context: C.contextObject(s),
          mathLatex: mb ? mb.node.attrs.latex : null,
          selectedText: s.doc.textBetween(s.selection.from, s.selection.to, '\n', ''),
        }
      },
      find: (text, opts) => {
        const ok = C.find(text, opts, this.view.state, tr => this.view.dispatch(tr))
        if (ok) this.scrollToSelection()
        return ok
      },
      replace: (find, repl, opts) => {
        const s = C.replace(find, repl, opts, this.view.state, tr => this.view.dispatch(tr))
        void s
        return C.find(find, { ...opts, forward: true }, this.view.state, tr => this.view.dispatch(tr))
      },
      replaceAll: (find, repl, opts) => C.replaceAll(find, repl, opts, this.view.state, tr => this.view.dispatch(tr)),
      revealText: snippet => this.revealText(snippet),
      focus: () => this.view.focus(),
    }
  }

  scrollToSelection(): void {
    const { node } = this.view.domAtPos(this.view.state.selection.from)
    const el = node instanceof HTMLElement ? node : node.parentElement
    el?.scrollIntoView({ block: 'center' })
  }

  // Scroll to the block holding this plain-text snippet (PDF → Visual).
  revealText(snippet: string): boolean {
    const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    const key = norm(snippet).slice(0, 40)
    if (key.length < 3) return false
    let hit = -1
    this.view.state.doc.descendants((node, pos) => {
      if (hit >= 0) return false
      if (node.isTextblock) {
        if (norm(node.textContent).includes(key)) hit = pos + 1
        return false
      }
      return true
    })
    if (hit < 0) return false
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, hit)))
    this.scrollToSelection()
    return true
  }
}

// Word's margin presets, in cm: top, bottom, left, right (_MARGIN_PRESETS).
export const MARGIN_PRESETS: [string, number[]][] = [
  ['Normal', [2.54, 2.54, 2.54, 2.54]],
  ['Narrow', [1.27, 1.27, 1.27, 1.27]],
  ['Moderate', [2.54, 2.54, 1.91, 1.91]],
  ['Wide', [2.54, 2.54, 5.08, 5.08]],
]

function resolvePdfFont(name: string, meta: M.DocMeta) {
  if (!name) return null
  const f = pdfFont(name)
  const replaced = (meta.visual_font_family !== '' && meta.visual_font_family !== 'Georgia')
    || meta.body_font_family !== 'default'
  return replaced && !name.includes('Sans') ? { ...f, family: screenFontFor(meta) } : f
}

// editor._resolve_image_path: an absolute path that exists, else relative
// to the document's folder (set_document_dir: the saved file's folder, an
// imported .tex's folder or an Overleaf clone), else to the figures folder.
async function resolveFigurePath(p: string): Promise<string | null> {
  try {
    const { platform } = await import('../platform/index.ts')
    const pf = platform()
    if (isAbsolute(p) && await pf.exists(p)) return p
    const { resolvedSourceDir } = await import('../app/compile.ts')
    const docDir = resolvedSourceDir()
    if (docDir) {
      const c = join(docDir, p)
      if (await pf.exists(c)) return c
    }
    const { imagesDir } = await import('../drawing/host.ts')
    const c = join(await imagesDir(), p)
    return (await pf.exists(c)) ? c : null
  } catch {
    return null
  }
}

// In the desktop app files come through the platform layer.
async function defaultImageLoader(path: string): Promise<string | null> {
  try {
    const { platform } = await import('../platform/index.ts')
    const p = platform()
    const data = await p.readFile(path)
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'pdf' ? 'application/pdf' : `image/${ext || 'png'}`
    return URL.createObjectURL(new Blob([data as BlobPart], { type }))
  } catch {
    return null
  }
}

// Development aid: ?ktdoc=<golden case> opens that golden document.
if (import.meta.env?.DEV && typeof location !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__kt = { editor, runAction, C, M, appStore }
  const name = new URLSearchParams(location.search).get('ktdoc')
  if (name) {
    setTimeout(async () => {
      const golden = await (await fetch('/tests/golden/documents.json')).json()
      const { replaceDoc } = await import('../app/store.ts')
      if (golden[name]) replaceDoc(M.fromJson(golden[name].document_json))
    }, 1500)
  }
}
