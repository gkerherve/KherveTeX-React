// The visual editor: DocumentEditor + PagedTextEdit (editor.py,
// paged_edit.py) over ProseMirror. It owns the view, keeps the store's
// document in step with it, lays the pages out, paints the sheets, the
// headers, footers and footnotes, and offers the EditorApi.
import { designCss } from '../core/design.ts'
import { autocorrectPlugin } from './autocorrect.ts'
import { InkLayer, anchorAtPos, posOfAnchor } from './ink.ts'
import { HeaderFooterEditor } from './headerFooter.ts'
import { PREFS_EVENT, pref } from '../app/prefs.ts'
import { syncDesignChecks } from '../app/actions/design.ts'
const PX_PER_CM_C = 96 / 2.54
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { history } from 'prosemirror-history'
import { setTracking, trackPlugin } from './track.ts'
import { AllSelection, EditorState, NodeSelection, Selection, TextSelection, type Plugin, type Transaction } from 'prosemirror-state'
import { tableEditing } from 'prosemirror-tables'
import { EditorView } from 'prosemirror-view'
import { runAction } from '../app/actions.ts'
import { blockMoverPlugin } from './blockMover.ts'
import type { EquationEditing } from '../app/actions/math.ts'
import type { PageEditing } from '../app/actions/page.ts'
import type { PageFurniture, PdfTypography } from '../app/pageAnchors.ts'
import { setEditorApi, type EditorApi } from '../app/editorApi.ts'
import { appStore, editDoc } from '../app/store.ts'
import { FIGURE_UPDATED_EVENT } from '../drawing/host.ts'
import * as M from '../core/model.ts'
import { isAbsolute, join } from '../core/paths.ts'
import { ReferenceResolver } from '../core/references.ts'
import { autoBibliography, BIB_STYLES, citeMode } from '../core/autoBibliography.ts'
import { AUTO_BIB_REFRESH, autoBibliographyPlugin } from './autoBibView.ts'
import { figuresFloat } from '../core/serializer.ts'
import type { ContextKind } from '../ui/ribbonModel.ts'
import { setCommandChecked } from '../ui/commands.ts'
import * as C from './commands.ts'
import { docFromPM, docToPM } from './convert.ts'
import { editorKeymaps } from './keymap.ts'
import { loadFonts, pdfFont, primaryFamily } from './latexFonts.ts'
import { anchorTargets, screenFontFor, type DocLayout, type PageAnchor, type PageGeometry } from './layout.ts'
import { computeColumnSpacers, computeSpacers, refreshColumns, sameSpacers, type PageStart } from './paginate.ts'
import { layoutKey, layoutPlugin, pagesKey, pagesPlugin } from './plugins.ts'
import { bibliographyPlugin } from './bibView.ts'
import { moderncvPlugin } from './cvView.ts'
import { posterBackground, posterPlugin } from './posterView.ts'
import { showContextMenu } from './contextMenu.ts'
import { setRibbonWidgets } from './ribbonState.ts'
import { SPELL_CURRENT, SPELL_REFRESH, spellCurrentPlugin, spellPlugin } from './spell.ts'
import { misspellings, replaceWord } from './spellList.ts'
import { spellHighlighter } from '../spell/shared.ts'
import { nodeViews, type ViewHost } from './views.ts'
import { ReviewMargin } from './reviewMargin.ts'
import { absoluteFigurePaths, imageFiles, isPicturePaste } from './pictureTransfer.ts'
import { resolvedSourceDir } from '../app/compile.ts'

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

// The citations' display text, in the style the PDF prints them
// (core/autoBibliography): natbib author-year, or numbered in the order
// of the reference list LaTeX writes at the end.
function makeResolver(doc: M.Document): ReferenceResolver {
  const r = new ReferenceResolver(doc, null, extraBib)
  r.citeMode = citeMode(doc)
  if (r.citeMode && !r.citeMode.authorYear) r.listNumbers = autoBibliography(doc, extraBib)?.numbers ?? null
  return r
}

export function editorBibliography(): string {
  return extraBib
}
const DESK = '#d0d4d8'
const SHEET_EDGE = '#b8bcc1'
// The text of the title, authors, affiliations and correspondence, one
// space between words: what a first page prints at its top as body.
function titleAreaText(doc: import('prosemirror-model').Node): string {
  const out: string[] = []
  doc.forEach(n => {
    if (['title', 'author', 'affiliation', 'correspondence'].includes(n.type.name)) out.push(n.textContent)
  })
  return out.join(' ').replace(/\s+/g, ' ')
}

const FIELD_RE = /\{(\w+)\}/g

export class EditorController implements ViewHost {
  view: EditorView
  private root: HTMLElement
  private sheetsEl: HTMLElement
  private inkLayer: InkLayer
  private flowEl: HTMLElement
  private overlayEl: HTMLElement
  // Header & Footer (Insert / Layout ▸ Header, a double-click in a margin).
  hf!: HeaderFooterEditor
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
  private images = new Map<string, { abs: string; url: string; sig: string | null } | null>()
  private exportQueued = false
  private lastContext: ContextKind | null = null
  private destroyed = false
  private review!: ReviewMargin
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
    // Draw tab: the pen strokes over the pages.
    this.inkLayer = new InkLayer({
      ink: () => this.meta.ink ?? [],
      setInk: ink => {
        const { ink: _old, ...rest } = this.meta
        void _old
        this.setMeta(ink.length ? { ...rest, ink } : rest)
      },
      pageHeightPx: () => this.layout.geometry.heightPx,
      pageWidthPx: () => this.layout.geometry.widthPx,
      zoom: () => this.zoom(),
      anchorFor: (x, y) => {
        const r = this.inkLayer.el.getBoundingClientRect(), z = this.zoom() || 1
        const hit = this.view.posAtCoords({ left: r.left + x * z, top: r.top + y * z })
        if (!hit) return null
        const a = anchorAtPos(this.view.state.doc, hit.pos)
        const pt = a && this.anchorScreen(a.pos)
        return a && pt ? { block: a.block, offset: a.offset, x: pt[0], y: pt[1] } : null
      },
      anchorPoint: a => {
        const pos = posOfAnchor(this.view.state.doc, a)
        return pos === null ? null : this.anchorScreen(pos)
      },
    })
    mount.replaceChildren(this.sheetsEl, this.flowEl, this.overlayEl, this.inkLayer.el)
    // Header & Footer: drawn on each page, edited in place (headerFooter.ts).
    this.hf = new HeaderFooterEditor({
      root: mount,
      meta: () => this.meta,
      setHeaderFooter: hf => {
        const { header_footer: _old, ...rest } = this.meta
        void _old
        this.setMeta(hf ? { ...rest, header_footer: hf } : rest)
      },
      geometry: () => this.layout.geometry,
      sheets: () => this.sheets,
      pageLabel: k => this.labels[k] ?? String(k + this.firstPage),
      pageCount: () => this.sheets,
      bodyFont: () => ({ family: this.layout.bodyChar.family, sizePx: this.layout.bodyChar.sizePx }),
      resolveImage: p => this.resolveImage(p),
      zoom: () => this.zoom(),
      changed: () => { this.paintOverlay(this.layout.geometry, this.sheets); this.syncToolbar() },
    })

    const s = appStore().get()
    this.lastDoc = s.doc
    this.serial = s.docSerial
    this.resolverCache = makeResolver(s.doc)
    this.view = new EditorView({ mount: pmEl }, {
      state: this.makeState(s.doc),
      nodeViews: nodeViews(this, this.atoms),
      dispatchTransaction: tr => this.dispatch(tr),
      // Viewing mode (the Editing ▾ menu): the page is read, not changed.
      editable: () => !this.readOnly,
      // writingsuggestions: no macOS inline predictions, which WebKit paints as
      // grey text after the caret that looks as if it were in the document.
      attributes: { spellcheck: 'false', writingsuggestions: 'false', autocorrect: 'off', class: 'kt-flow' },
      // A picture on the clipboard (a screenshot, an image copied in
      // Preview or a browser) or dropped from a browser becomes a figure
      // (app/pictures.ts); text pastes as before.
      handlePaste: (_v, e) => {
        if (!isPicturePaste(e.clipboardData)) return false
        const files = imageFiles(e.clipboardData)
        void import('../app/pictures.ts').then(m => m.insertPictureFiles(files, null, true))
        return true
      },
      handleDrop: (v, e) => {
        const files = imageFiles(e.dataTransfer)
        if (!files.length) return false
        e.preventDefault()
        const at = v.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null
        void import('../app/pictures.ts').then(m => m.insertPictureFiles(files, at))
        return true
      },
      // A copied figure carries its full path, so it pastes into a
      // document in another folder (or another window) and still shows.
      transformCopied: slice => absoluteFigurePaths(slice, resolvedSourceDir()),
      handleDOMEvents: {
        focus: () => { this.syncToolbar(); return false },
        // A click on a box's title bar (drawn above its first line) opens
        // its name and colour, as a click on a table's caption does.
        mousedown: (v, e) => {
          const el = (e.target as HTMLElement | null)?.closest?.('.kt-num-callout') as HTMLElement | null
          if (!el || e.button !== 0) return false
          const bar = parseFloat(getComputedStyle(el, '::before').height) || 18
          if (e.clientY > el.getBoundingClientRect().top + bar + 2) return false
          e.preventDefault()
          const pos = v.posAtDOM(el, 0)
          v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos))))
          void runAction('box_style')
          return true
        },
        // A double-click on a table's caption (drawn under the table)
        // edits it, as on a figure's.
        dblclick: (v, e) => {
          const wrap = e.target as HTMLElement | null
          if (!wrap?.classList?.contains('kt-table-wrap') || !wrap.dataset.caption) return false
          const table = wrap.querySelector('table')
          const cell = wrap.querySelector('td, th')
          if (!table || !cell || e.clientY <= table.getBoundingClientRect().bottom) return false
          e.preventDefault()
          const pos = v.posAtDOM(cell, 0)
          v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(pos))))
          void runAction('caption')
          return true
        },
        contextmenu: (_v, e) => { e.preventDefault(); return showContextMenu(this, e) },
      },
    })
    // A click on the sheet outside the text (the blank page under the last
    // line, the margins) puts the caret on the nearest line, as Word does;
    // below the text, at the end.
    mount.addEventListener('mousedown', e => {
      const t = e.target as Node
      if (e.button !== 0 || this.view.dom.contains(t)) return
      if (!(t === this.flowEl || t === mount || this.sheetsEl.contains(t))) return
      e.preventDefault()
      const st = this.view.state
      const flow = this.view.dom.getBoundingClientRect()
      const x = Math.min(Math.max(e.clientX, flow.left + 1), flow.right - 1)
      const y = Math.min(Math.max(e.clientY, flow.top + 1), flow.bottom - 1)
      // The end of the document only for a click below its last line; a
      // click the text cannot be found for leaves the caret where it was,
      // never sends it to the end. No scrollIntoView: the caret is where
      // the user clicked, and WebKit (the desktop app) misplaced the page
      // when asked to scroll to it.
      let end = Infinity
      try { end = this.view.coordsAtPos(st.doc.content.size).bottom } catch { /* keep Infinity */ }
      const hit = this.view.posAtCoords({ left: x, top: y })
      // In the left margin, as in Word: a click selects the line beside
      // it, a double-click its paragraph, a triple-click everything.
      if (hit && e.clientY <= end && e.clientX < flow.left) {
        if (e.detail >= 3) {
          this.view.dispatch(st.tr.setSelection(new AllSelection(st.doc)))
        } else {
          const $h = st.doc.resolve(hit.pos)
          let from: number, to: number
          if (e.detail === 2 && $h.parent.isTextblock) {
            from = $h.start(); to = $h.end()
          } else {
            const a = this.view.posAtCoords({ left: flow.left + 1, top: y })
            const b = this.view.posAtCoords({ left: flow.right - 1, top: y })
            from = Math.min(a?.pos ?? hit.pos, b?.pos ?? hit.pos)
            to = Math.max(a?.pos ?? hit.pos, b?.pos ?? hit.pos)
            // The line's own text, in its own paragraph.
            if ($h.parent.isTextblock) { from = Math.max(from, $h.start()); to = Math.min(to, $h.end()) }
          }
          if (to > from) this.view.dispatch(st.tr.setSelection(TextSelection.create(st.doc, from, to)))
          else this.view.dispatch(st.tr.setSelection(Selection.near($h, 1)))
        }
      } else if (hit && e.clientY <= end) {
        this.view.dispatch(st.tr.setSelection(Selection.near(st.doc.resolve(hit.pos), 1)))
      } else if (e.clientY > end) {
        this.view.dispatch(st.tr.setSelection(Selection.atEnd(st.doc)))
      }
      this.view.focus()
    })
    // A double-click on a reference list's title (bibView.ts).
    pmEl.addEventListener('kt-bibliography', () => { void runAction('bibliography') })
    this.review = new ReviewMargin(mount, () => this.view)
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
    window.addEventListener('focus', this.onWindowFocus)
    window.addEventListener(PREFS_EVENT, this.onPrefs)
    void loadFonts(this.families()).then(() => this.relayout())
    this.schedulePages(0)
    this.syncToolbar()
  }

  // Preferences changed: the track look and the spelling options.
  private onPrefs = (): void => {
    if (this.destroyed) return
    this.applyGeometry()
    this.view.dispatch(this.view.state.tr.setMeta(SPELL_REFRESH, true).setMeta('addToHistory', false))
  }

  destroy(): void {
    this.destroyed = true
    this.hf.destroy()
    this.flushExport()
    this.unsub()
    this.unsubSpell()
    bibListeners.delete(this.refreshResolverNow)
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts)
    window.removeEventListener(FIGURE_UPDATED_EVENT, this.onFigureUpdated)
    window.removeEventListener('focus', this.onWindowFocus)
    window.removeEventListener(PREFS_EVENT, this.onPrefs)
    clearTimeout(this.pageTimer)
    clearTimeout(this.resolverTimer)
    if (current === this) { setCurrent(null); setEditorApi(null) }
    this.review.destroy()
    this.inkLayer.destroy()
    this.view.destroy()
  }

  // ---------- state ----------

  private plugins(meta: M.DocMeta): Plugin[] {
    return [
      layoutPlugin(meta), bibliographyPlugin(), moderncvPlugin(), posterPlugin(), pagesPlugin(), spellPlugin(), spellCurrentPlugin(),
      autoBibliographyPlugin(() => extraBib, () => { void runAction('manage_references') }),
      ...editorKeymaps({ run: id => { void runAction(id); return true } }),
      history(), tableEditing(), gapCursor(), dropCursor(), trackPlugin(), autocorrectPlugin(), blockMoverPlugin(),
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
    if (tr.docChanged) this.mapInk(before.doc, tr)
    const pages = tr.getMeta(pagesKey)
    const metaChanged = !!tr.getMeta(layoutKey)
    if (tr.docChanged || metaChanged) {
      if (!tr.getMeta(NO_EXPORT)) this.queueExport()
      if (metaChanged) this.applyGeometry()
      this.schedulePages(tr.docChanged && !metaChanged ? 120 : 0)
    } else if (pages) {
      this.schedulePages(0, true)
    }
    if (tr.docChanged || tr.selectionSet || metaChanged) { this.syncToolbar(); this.review?.schedule() }
  }

  // Run a command on the current state.
  run(cmd: C.Command): boolean {
    // A ribbon or menu command runs with the focus away from the page. If
    // it redraws the block holding the caret (a box added or removed),
    // WebKit (the desktop app) puts its own caret at the end of the
    // document, and focus() then scrolls the page there. So: where the
    // caret is still on screen at the old scroll, the page stays put.
    const sc = this.scroller()
    const top = sc ? sc.scrollTop : 0
    const ok = cmd(this.view.state, tr => this.view.dispatch(tr))
    this.view.focus()
    if (sc) {
      const keep = () => {
        if (sc.scrollTop === top) return
        try {
          const head = this.view.state.selection.head
          const c = this.view.coordsAtPos(head)
          const r = sc.getBoundingClientRect()
          const y = c.top + (sc.scrollTop - top)  // where the caret would be at the old scroll
          if (y >= r.top && y + (c.bottom - c.top) <= r.bottom) sc.scrollTop = top
        } catch { /* no caret coordinates: leave it */ }
      }
      keep()
      requestAnimationFrame(keep)
      setTimeout(keep, 60)
    }
    return ok
  }

  // The element the page scrolls in (the desk around the sheets).
  private scroller(): HTMLElement | null {
    for (let el = this.view.dom.parentElement; el; el = el.parentElement) {
      const o = getComputedStyle(el).overflowY
      if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) return el
    }
    return null
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

  // Draw tab: anchored strokes keep their word when the text before it
  // changes (a paragraph added above, words typed in front).
  private mapInk(old: EditorState['doc'], tr: Transaction): void {
    const ink = this.meta.ink
    if (!ink?.some(s => s.anchor)) return
    let changed = false
    const next = ink.map(s => {
      if (!s.anchor) return s
      const from = posOfAnchor(old, s.anchor)
      if (from === null) return s
      const a = anchorAtPos(this.view.state.doc, tr.mapping.map(from, 1), false)
      if (!a || (a.block === s.anchor.block && a.offset === s.anchor.offset)) return s
      changed = true
      return { ...s, anchor: { ...s.anchor, block: a.block, offset: a.offset } }
    })
    if (!changed) return
    queueMicrotask(() => {
      if (this.destroyed) return
      this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { meta: { ...this.meta, ink: next } }).setMeta('addToHistory', false))
    })
  }

  // The baseline point of the text at `pos`, in layout px over the sheets.
  private anchorScreen(pos: number): [number, number] | null {
    try {
      const c = this.view.coordsAtPos(pos, 1)
      const r = this.inkLayer.el.getBoundingClientRect(), z = this.zoom() || 1
      // Latin Modern's ascent in its 105.15 + 35.55 % content box.
      const base = c.top + (c.bottom - c.top) * 0.747
      return [(c.left - r.left) / z, (base - r.top) / z]
    } catch { return null }
  }

  // set_meta: page size, class, fonts, margins... changed.
  // View ▸ Fix page layout: every page and column break dropped and the
  // pages laid out again from the start.
  repaginate(): void {
    this.view.dispatch(this.view.state.tr.setMeta(pagesKey, []).setMeta('addToHistory', false))
    this.schedulePages(0)
  }

  // Viewing (true) or Editing / Reviewing (false), as Word's mode menu.
  readOnly = false
  setReadOnly(on: boolean): void {
    this.readOnly = on
    this.view.setProps({})
    this.view.dom.classList.toggle('kt-viewing', on)
  }

  setMeta(meta: M.DocMeta): void {
    this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { meta }).setMeta('addToHistory', false))
    // The bibliography style decides how citations print.
    this.refreshResolverNow()
    void loadFonts(this.families()).then(() => this.relayout())
  }

  // _sheet_labels: each sheet named for the PDF page it shows; a sheet that
  // only exists because the editor's page overflowed reads "N (cont.)".
  private sheetLabels(sheets: number): string[] {
    const H = this.layout.geometry.heightPx
    const anchors = layoutKey.getState(this.view.state)!.anchors
    if (!anchors.length) {
      return Array.from({ length: sheets }, (_, k) => String(k + this.firstPage))
    }
    const starts = new Map<number, number>([[0, this.firstPage]])
    const z = this.zoom()
    const top0 = this.flowEl.getBoundingClientRect().top
    for (const t of anchorTargets(this.view.state.doc, anchors)) {
      let y: number
      try {
        // A figure (a leaf) by its box: pos + 1 is already the paragraph
        // after it, and its sheet read as "(cont.)".
        const leaf = this.view.state.doc.nodeAt(t.pos)
        const dom = leaf && !leaf.isTextblock ? this.view.nodeDOM(t.pos) : null
        const top = dom instanceof HTMLElement ? dom.getBoundingClientRect().top
          : this.view.coordsAtPos(Math.min(t.pos + 1 + t.offset, this.view.state.doc.content.size)).top
        y = (top - top0) / z
      } catch { continue }
      const k = Math.floor(y / H)
      if (!starts.has(k)) starts.set(k, t.page)
    }
    // A sheet with no page start is the run-on of the page before it,
    // unless the next start leaves room for exactly the sheets between:
    // then those are the PDF's blank pages (pdfPageStarts), numbered on.
    const keys = [...starts.keys()].sort((a, b) => a - b)
    const out: string[] = []
    let cur = 1
    let curSheet = 0
    for (let k = 0; k < sheets; k++) {
      if (starts.has(k)) { cur = starts.get(k)!; curSheet = k; out.push(String(cur)); continue }
      const next = keys.find(x => x > k)
      const blank = next !== undefined && starts.get(next)! - cur === next - curSheet
      out.push(blank ? String(cur + k - curSheet) : `${cur} (cont.)`)
    }
    return out
  }

  private firstPage = 1
  // The last painted sheet labels (sheetLabels), for pdfSpotAt.
  private labels: string[] = []

  // The PDF page a point of the page view shows: its sheet's label ("7",
  // or "7 (cont.)" for the run-on of page 7, whose end it then shows).
  pdfSpotAt(clientY: number): { page: number; frac: number } | null {
    const H = this.layout.geometry.heightPx
    if (!H || !this.flowEl.isConnected) return null
    const y = (clientY - this.flowEl.getBoundingClientRect().top) / this.zoom()
    const k = Math.max(0, Math.min(this.sheets - 1, Math.floor(y / H)))
    const label = this.labels[k] ?? String(k + this.firstPage)
    const page = parseInt(label, 10)
    if (!Number.isFinite(page)) return null
    const frac = label.includes('cont') ? 1 : Math.max(0, Math.min(1, (y - k * H) / H))
    return { page, frac }
  }

  // Where a PDF page and height on it stand in the page view (client y):
  // the sheet labelled with that page (its run-on "(cont.)" sheet for the
  // part past its foot).
  spotClientY(page: number, frac: number): number | null {
    const H = this.layout.geometry.heightPx
    if (!H || !this.flowEl.isConnected) return null
    let k = -1
    for (let i = 0; i < this.sheets; i++) {
      const label = this.labels[i] ?? String(i + this.firstPage)
      if (parseInt(label, 10) === page && !label.includes('cont')) { k = i; break }
    }
    if (k < 0) return null
    return this.flowEl.getBoundingClientRect().top + (k + frac) * H * this.zoom()
  }

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
  setPageAnchors(anchors: readonly PageAnchor[], furniture?: readonly PageFurniture[], typography?: PdfTypography): void {
    this.pdfFurniture = furniture ?? null
    this.view.dispatch(this.view.state.tr.setMeta(layoutKey, { anchors: [...anchors], typography: typography ?? null })
      .setMeta('addToHistory', false).setMeta(NO_EXPORT, true))
  }

  // The page anchors as the layout holds them (the page check reads them).
  heldAnchors(): readonly PageAnchor[] {
    return layoutKey.getState(this.view.state)!.anchors
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
    this.resolverCache = makeResolver(docFromPM(this.view.state.doc, this.meta))
    for (const a of this.atoms) a.render()
    // The reference list at the end follows the citations.
    this.view.dispatch(this.view.state.tr.setMeta(AUTO_BIB_REFRESH, true)
      .setMeta('addToHistory', false).setMeta(NO_EXPORT, true))
  }

  // ---------- ViewHost ----------

  resolver(): ReferenceResolver {
    return this.resolverCache
  }

  bodyPx(): number {
    return this.layout.bodyChar.sizePx
  }

  textWidthPx(): number {
    // Node views are built inside new EditorView(), before this.view is
    // set: a figure there is drawn at the class's text width and redrawn
    // once the layout runs.
    if (!this.view) return 605
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
      const [url, sig] = await Promise.all([(imageLoader ?? defaultImageLoader)(abs), imageSignature(abs)])
      if (!url || this.destroyed) return
      this.images.set(path, { abs, url, sig })
      for (const a of this.atoms) a.render()
      this.schedulePages(0)
    })()
    return null
  }

  // An image file changed on disk while the window was in the background
  // (re-cropped, re-exported, written by another tool): reload just those
  // figures, as the PDF already does on its next compile.
  private onWindowFocus = (): void => {
    void (async () => {
      let any = false
      for (const [path, entry] of [...this.images]) {
        if (!entry) continue
        const sig = await imageSignature(entry.abs)
        if (this.destroyed) return
        if (sig === entry.sig) continue
        const url = sig === null ? null : await (imageLoader ?? defaultImageLoader)(entry.abs)
        if (this.destroyed) return
        URL.revokeObjectURL(entry.url)
        if (url) this.images.set(path, { abs: entry.abs, url, sig })
        else this.images.delete(path)
        any = true
      }
      if (any) { for (const a of this.atoms) a.render(); this.schedulePages(0) }
    })()
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

  // _on_image_resized: the picture's new width, in the document.
  onFigureResized(pos: number, width: string): void {
    const node = this.view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'figure') return
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, width })
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)))
    this.syncToolbar()
  }

  onCaptionDoubleClick(pos: number): void {
    this.selectNode(pos)
    void runAction('caption')
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
    // Text set to a size (Home ▸ font size on a selection) scales from it.
    st.setProperty('--kt-body-pt', String(this.meta.body_font_pt || 12))
    // Layout ▸ Hyphenation ▸ None: no word broken at a line end, as the PDF.
    this.root.classList.toggle('kt-nohyphen', this.meta.hyphenation === false)
    // Review ▸ Track Changes and the markup shown (All, Simple, None, Original).
    setTracking(!!this.meta.track_changes)
    for (const k of ['simple', 'none', 'original']) this.root.classList.toggle(`kt-markup-${k}`, this.meta.markup === k)
    // Preferences ▸ Track Changes: how insertions and deletions look here.
    const tl = pref('track/look')
    for (const k of ['underline', 'double', 'bold', 'italic', 'colour']) this.root.classList.toggle(`kt-ins-${k}`, tl.insert === k)
    for (const k of ['strike', 'double', 'hidden']) this.root.classList.toggle(`kt-del-${k}`, tl.delete === k)
    this.root.classList.toggle('kt-track-fixed', tl.colour !== 'author')
    if (tl.colour !== 'author') this.root.style.setProperty('--kt-track-colour', tl.colour)
    // Design tab: the heading look (style set, colours, fonts).
    const dcss = designCss(this.meta.design, this.meta.documentclass)
    this.root.classList.toggle('kt-design', !!dcss)
    let styleEl = this.root.querySelector<HTMLStyleElement>(':scope > style.kt-design-css')
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.className = 'kt-design-css'; this.root.prepend(styleEl) }
    if (styleEl.textContent !== dcss) styleEl.textContent = dcss
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

  // Where the compiled PDF starts its pages (a page that starts at a
  // block's start is forced by the layout already; one inside a paragraph
  // is forced here), and the empty PDF pages before each: pageAnchors
  // lists every page with text, so a page number it skips is blank.
  private pdfPageStarts(): PageStart[] {
    const anchors = layoutKey.getState(this.view.state)!.anchors
    if (!anchors.length) return []
    const listed = new Set(anchors.map(([n]) => n))
    return anchorTargets(this.view.state.doc, anchors).map(t => {
      let blanks = 0
      for (let p = t.page - 1; p >= 2 && !listed.has(p); p--) blanks++
      return t.offset > 0 ? { pos: t.pos + 1 + t.offset, inline: true, blanks } : { pos: t.pos, inline: false, blanks }
    })
  }

  // Where the compiled PDF starts each column after a page's first (in a
  // document set in columns), as page starts are found.
  private pdfColumnStarts(): PageStart[] {
    const typo = layoutKey.getState(this.view.state)!.typography as { columnStarts?: [number, string][] } | null
    const cs = typo?.columnStarts
    if (!cs?.length) return []
    return anchorTargets(this.view.state.doc, cs).map(t =>
      t.offset > 0 ? { pos: t.pos + 1 + t.offset, inline: true, blanks: 0 } : { pos: t.pos, inline: false, blanks: 0 })
  }

  private paginate(): void {
    if (this.destroyed || !this.view.dom.isConnected) return
    const geo = this.layout.geometry
    const old = pagesKey.getState(this.view.state)!.spacers
    const { spacers, measure } = geo.cols > 1
      ? computeColumnSpacers(this.view, geo, this.flowEl, old, this.columnShrink, this.pdfPageStarts(),
        layoutKey.getState(this.view.state)!.anchors.length > 0, this.pdfColumnStarts(),
        { notes: this.footnoteBoxes(geo).map(n => ({ pos: n.pos, height: n.height })) })
      : computeSpacers(this.view, geo, this.flowEl, this.pdfPageStarts(),
        layoutKey.getState(this.view.state)!.anchors.length > 0, figuresFloat(this.meta))
    if (!sameSpacers(old, spacers) && this.pageIter < (geo.cols > 1 ? 14 : 6)) {
      this.pageIter += 1
      this.view.dispatch(this.view.state.tr.setMeta(pagesKey, spacers).setMeta('addToHistory', false))
      return
    }
    this.sheets = measure.sheets
    refreshColumns(this.flowEl)
    this.paint(geo)
    this.review.schedule()
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
    // A tikzposter's background colour.
    const bg = posterBackground(this.meta) || this.meta.design?.page_color || ''
    const parts: string[] = []
    // Design ▸ Watermark and Page Borders, on every sheet (1 cm in).
    const D = this.meta.design
    const cm = PX_PER_CM_C
    const border = D?.page_border ? ({
      box: `border:0.8px solid #000`, thick: `border:3px solid #000`, double: `border:3px double #000`,
      art: `border:3px solid #000;outline:0.7px solid #000;outline-offset:-6px`, shadow: `border:0.8px solid #000;box-shadow:4px 4px 0 #444`,
    } as Record<string, string>)[D.page_border] : ''
    const wm = D?.watermark ? D.watermark.replace(/[<&]/g, '') : ''
    const wmSize = wm ? Math.max(28, Math.min(130, (geo.widthPx * 1.05) / Math.max(4, wm.length) * 1.25)) : 0
    for (let k = 0; k < n; k++) {
      const top = k * H + (k ? g / 2 : 0)
      const bottom = k < n - 1 ? (k + 1) * H - g / 2 : total - 1
      parts.push(`<div class="kt-sheet" style="top:${top}px;height:${bottom - top}px;border-color:${SHEET_EDGE}${bg ? `;background:${bg}` : ''}"></div>`)
      if (border) parts.push(`<div class="kt-sheet-border" style="top:${top + cm}px;height:${bottom - top - 2 * cm}px;left:${cm}px;right:${cm}px;${border}"></div>`)
      if (wm) parts.push(`<div class="kt-sheet-watermark" style="top:${top}px;height:${bottom - top}px;font-size:${wmSize}px"><span style="transform:rotate(-45deg)">${wm}</span></div>`)
      if (k < n - 1) {
        parts.push(`<div class="kt-sheet-gap" style="top:${bottom}px;height:${g}px;background:${DESK}"></div>`)
      }
    }
    this.sheetsEl.innerHTML = parts.join('')
    this.inkLayer.render(n)
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

  // Each footnote: its mark's place and its note's text and height, in a
  // column's width (columns) or the text width.
  private footnoteBoxes(geo: PageGeometry): { el: HTMLElement; pos: number; text: string; height: number }[] {
    const small = this.layout.bodyChar.sizePx * 0.8
    const lineH = small * 1.407
    const textW = geo.widthPx - geo.leftPx - geo.rightPx
    const colW = geo.cols > 1 ? (textW - (geo.cols - 1) * geo.colGapPx) / geo.cols : textW
    const perLine = Math.max(10, colW / (small * 0.47))
    const out: { el: HTMLElement; pos: number; text: string; height: number }[] = []
    for (const el of this.flowEl.querySelectorAll<HTMLElement>('.kt-footnote')) {
      let pos: number
      try { pos = this.view.posAtDOM(el, 0) } catch { continue }
      const text = el.title || ''
      out.push({ el, pos, text, height: 6 + Math.max(1, Math.ceil((text.length + 3) / perLine)) * lineH })
    }
    return out
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
    // In columns: each note at the foot of its mark's column, inside the
    // text area (the column keeps room for it), as LaTeX sets it.
    if (geo.cols > 1) {
      notes.clear()
      const z = this.zoom()
      const left0 = this.flowEl.getBoundingClientRect().left
      const textW = geo.widthPx - geo.leftPx - geo.rightPx
      const colW = (textW - (geo.cols - 1) * geo.colGapPx) / geo.cols
      const cols = new Map<string, { sheet: number; col: number; items: { n: number; text: string; height: number }[] }>()
      this.footnoteBoxes(geo).forEach((b, i) => {
        // Where the mark's caret is (the element's own box was found at a
        // stale place in columns).
        let c = { left: b.el.getBoundingClientRect().left, top: b.el.getBoundingClientRect().top }
        try { c = this.view.coordsAtPos(b.pos) } catch { /* the element's own place */ }
        const x = (c.left + 1 - left0) / z
        const col = Math.max(0, Math.min(geo.cols - 1, Math.floor((x - geo.leftPx) / (colW + geo.colGapPx))))
        const sheet = Math.max(0, Math.floor((c.top - this.flowEl.getBoundingClientRect().top) / z / H))
        const key = `${sheet},${col}`
        if (!cols.has(key)) cols.set(key, { sheet, col, items: [] })
        cols.get(key)!.items.push({ n: i + 1, text: b.text, height: b.height })
      })
      for (const { sheet, col, items } of cols.values()) {
        const g = sheet < sheets - 1 ? gap / 2 : 0
        const x = geo.leftPx + col * (colW + geo.colGapPx)
        let y = (sheet + 1) * H - g - geo.bottomPx - items.reduce((a, it) => a + it.height, 0)
        out.push(`<div class="kt-fn-rule" style="left:${x}px;top:${y + 2}px;width:${colW * 0.4}px"></div>`)
        for (const it of items) {
          out.push(`<div class="kt-fn" style="left:${x}px;width:${colW}px;top:${y + 5}px;white-space:normal;text-align:justify;`
            + `font-family:${L.bodyChar.family};font-size:${small}px;line-height:${small * 1.407}px">`
            + `<sup style="font-size:${small * 0.75}px">${it.n}</sup> ${esc(it.text)}</div>`)
          y += it.height
        }
      }
    }
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
    this.labels = labels
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
      // Headers and footers of the document's own replace the class's.
      if (this.hf.current()) continue
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
        const titleArea = k === 0 ? titleAreaText(this.view.state.doc) : ''
        const headBottom = geo.topPx / s
        const footTop = (H - geo.bottomPx) / s
        for (const sp of pdfPage.spans) {
          if (sp.bottom > headBottom + 1 && sp.top < footTop - 1) continue
          // A class with a small top margin (revtex4-2) prints the title in
          // the band searched for running heads: on the first page, text of
          // the title area is the document's own, already on the page.
          const t = sp.text.replace(/\s+/g, ' ').trim()
          if (k === 0 && t.length > 2 && titleArea.includes(t)) continue
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
    out.push(this.hf.paint(sheets))
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
      docClass: meta.documentclass, disabledStyles: disabled, design: meta.design ?? {},
      // The size and font at the caret (a mark), or the body's.
      fontSize: String(C.sizeAt(s, meta.body_font_pt)),
      fontFamily: (() => {
        const m = C.marksHere(s).find(x => x.type.name === 'fontfamily')
        return m ? String(m.attrs.name) : (meta.body_font_family || 'default')
      })(),
      para: s.selection.$from.parent.type.name === 'paragraph' ? {
        left_cm: s.selection.$from.parent.attrs.left_cm || 0, right_cm: s.selection.$from.parent.attrs.right_cm || 0,
        before_pt: s.selection.$from.parent.attrs.before_pt || 0, after_pt: s.selection.$from.parent.attrs.after_pt || 0,
      } : null,
    })
    for (const code of ['A4', 'Letter', 'Legal']) setCommandChecked(`pagesize_${code}`, meta.page_size === code)
    setCommandChecked('orient_portrait', !meta.landscape)
    setCommandChecked('orient_landscape', !!meta.landscape)
    for (const k of ['none', 'continuous', 'page', 'section']) setCommandChecked(`ln_${k}`, (meta.line_numbers ?? 'none') === k)
    setCommandChecked('hyph_auto', meta.hyphenation !== false)
    setCommandChecked('hyph_none', meta.hyphenation === false)
    setCommandChecked('track_changes', !!meta.track_changes)
    for (const k of ['all', 'simple', 'none', 'original']) setCommandChecked(`markup:${k}`, (meta.markup ?? 'all') === k)
    setCommandChecked('markup_insdel', !meta.markup)
    syncDesignChecks(meta)
    for (const [code] of BIB_STYLES) setCommandChecked(`bib_style_${code}`, (meta.bib_style || 'plainnat') === code)
    for (const [name, m] of MARGIN_PRESETS) {
      const cur = [meta.margin_top_cm, meta.margin_bottom_cm, meta.margin_left_cm, meta.margin_right_cm]
      setCommandChecked(`margin_${name}`, (name === 'Mirrored') === !!meta.mirror_margins && cur.every((v, i) => Math.abs(v - m[i]) < 0.01))
    }
    const ctx = this.hf?.editing ? 'headerfooter' as const : C.contextObject(s)
    const hfs = this.hf?.current()
    setCommandChecked('hf_first', !!hfs?.different_first)
    setCommandChecked('hf_oddeven', !!hfs?.odd_even)
    setCommandChecked('hf_showtext', this.hf ? this.hf.showText : true)
    setRibbonWidgets({ hf: { header_cm: hfs?.header_cm ?? 1.25, footer_cm: hfs?.footer_cm ?? 1.25 } })
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
    } else if (ctx === 'callout') {
      const kind = C.currentTheoremKind(s)
      if (kind) setCommandChecked(`box_kind_${kind}`, true)
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
      setPageAnchors: (_pages, anchors, furniture, typography) => this.setPageAnchors(anchors, furniture, typography),
      pdfSpotAt: y => this.pdfSpotAt(y),
      spotClientY: (page, frac) => this.spotClientY(page, frac),
      // The contextual Equation tab (src/app/actions/math.ts).
      equationNumbered: () => C.currentEquationNumbered(this.view.state),
      setEquationNumbered: on => { this.run(C.setEquationNumbered(on)) },
      equationLabel: () => C.currentEquationLabel(this.view.state),
      setEquationLabel: label => { this.run(C.setEquationLabel(label)) },
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
      misspellings: () => misspellings(this.view.state.doc, spellHighlighter()),
      selectRange: (start, end) => {
        const doc = this.view.state.doc
        const at = (n: number) => Math.max(0, Math.min(n, doc.content.size))
        this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, at(start), at(end)))
          .setMeta(SPELL_CURRENT, { start: at(start), end: at(end) }))
        // To the word itself: its paragraph is as wide as the page, and
        // scrolling to it moved the page sideways.
        const word = this.view.dom.querySelector('.kt-spell-current')
        if (word) word.scrollIntoView({ block: 'center', inline: 'nearest' })
        else this.scrollToSelection()
      },
      replaceRange: (start, end, word, text) => {
        const tr = replaceWord(this.view.state, start, end, word, text)
        if (tr) this.view.dispatch(tr)
        return tr !== null
      },
      bibliography: () => {
        let hit: { pos: number; text: string } | null = null
        this.view.state.doc.forEach((node, pos) => {
          if (!hit && node.type.name === 'raw_latex' && node.textContent.includes('\\begin{thebibliography}')) {
            hit = { pos, text: node.textContent }
          }
        })
        return hit
      },
      setBibliography: (pos, text) => {
        const s = this.view.state
        const raw = s.schema.nodes.raw_latex
        const old = pos === null ? null : s.doc.nodeAt(pos)
        const node = raw.create(old?.type === raw ? old.attrs : null, text ? s.schema.text(text) : null)
        const tr = old?.type === raw ? s.tr.replaceWith(pos!, pos! + old.nodeSize, node)
          : s.tr.insert(s.doc.content.size, node)
        this.view.dispatch(tr.scrollIntoView())
      },
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
  // Left / right are the inside / outside margins (mirror_margins).
  ['Mirrored', [2.54, 2.54, 3.18, 2.54]],
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

// A cheap fingerprint of an image file (length + FNV-1a of its bytes), so a
// window focus reloads only the figures whose file really changed.
async function imageSignature(path: string): Promise<string | null> {
  try {
    const { platform } = await import('../platform/index.ts')
    const data = await platform().readFile(path)
    let h = 0x811c9dc5
    for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193)
    return `${data.length}:${(h >>> 0).toString(16)}`
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
