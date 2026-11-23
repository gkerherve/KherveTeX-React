// Header & Footer, as Word's: each page's header and footer drawn in its
// margins, and a double-click there edits them in place. The page's body
// dims; the edited band shows a line and its name ("Header", "First Page
// Footer"...) and three zones, left, centre and right (Word's tab stops),
// where fields (page number, date...) show as their values.
import { HF_FIELD_RE, type DocMeta, type HeaderFooter } from '../core/model.ts'
import type { PageGeometry } from './layout.ts'

export type Band = 'header' | 'footer'
export type Variant = '' | 'first_' | 'even_'
const CM = 96 / 2.54
const PT = 96 / 72

// What a new header and footer start from: the class's page number at the
// foot's centre, so opening them changes nothing on the page.
export const HF_DEFAULT: HeaderFooter = { header: '', footer: '\t{PAGE}', header_cm: 1.25, footer_cm: 1.25 }

export interface HfHost {
  root: HTMLElement
  meta: () => DocMeta
  setHeaderFooter: (hf: HeaderFooter | undefined) => void
  geometry: () => PageGeometry
  sheets: () => number
  // The page number printed on sheet k ("3"), the page count.
  pageLabel: (k: number) => string
  pageCount: () => number
  bodyFont: () => { family: string; sizePx: number }
  resolveImage: (path: string) => string | null
  zoom: () => number
  // The editing mode started or ended (the Header & Footer tab).
  changed: () => void
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export function variantFor(hf: HeaderFooter, sheet: number, label: string): Variant {
  const n = /^\d+$/.test(label) ? Number(label) : sheet + 1
  if (hf.different_first && sheet === 0) return 'first_'
  if (hf.odd_even && n % 2 === 0) return 'even_'
  return ''
}

export function textOf(hf: HeaderFooter, band: Band, v: Variant): string {
  return (hf[`${v}${band}` as keyof HeaderFooter] as string | undefined) ?? ''
}

function parts(s: string): [string, string, string] {
  const p = s.split('\t')
  return [p[0] ?? '', p[1] ?? '', p.slice(2).join(' ')]
}

export class HeaderFooterEditor {
  private host: HfHost
  // The band edited, on which sheet; null when not editing.
  editing: { band: Band; sheet: number } | null = null
  showText = true
  private layer: HTMLElement
  private cells: HTMLElement[] = []
  private lastCell = 0
  private timer = 0
  private draft: HeaderFooter | null = null

  constructor(host: HfHost) {
    this.host = host
    this.layer = document.createElement('div')
    this.layer.className = 'kt-overlay kt-hf-layer'
    host.root.appendChild(this.layer)
    host.root.addEventListener('dblclick', this.onDblClick, true)
  }

  destroy(): void {
    this.host.root.removeEventListener('dblclick', this.onDblClick, true)
    this.layer.remove()
  }

  // The settings shown: the document's, or a new one being edited.
  current(): HeaderFooter | null {
    return this.host.meta().header_footer ?? this.draft
  }

  private onDblClick = (e: MouseEvent) => {
    const g = this.host.geometry()
    const r = this.host.root.getBoundingClientRect()
    const z = this.host.zoom()
    const x = (e.clientX - r.left) / z, y = (e.clientY - r.top) / z
    if (x < 0 || x > g.widthPx) return
    const sheet = Math.floor(y / g.heightPx)
    if (sheet < 0 || sheet >= this.host.sheets()) return
    const yIn = y - sheet * g.heightPx
    const band: Band | null = yIn < g.topPx ? 'header' : yIn > g.heightPx - g.bottomPx ? 'footer' : null
    if (band) {
      e.preventDefault()
      e.stopPropagation()
      this.open(band, sheet)
    } else if (this.editing) {
      // A double-click on the body goes back to it, as in Word.
      this.close()
    }
  }

  open(band: Band, sheet = this.editing?.sheet ?? 0): void {
    this.flush()
    if (!this.host.meta().header_footer && !this.draft) this.draft = { ...HF_DEFAULT }
    const was = !!this.editing
    this.editing = { band, sheet: Math.max(0, Math.min(sheet, this.host.sheets() - 1)) }
    this.host.root.classList.add('kt-hf-editing')
    this.host.root.classList.toggle('kt-hf-hide-text', !this.showText)
    this.render()
    if (!was) this.host.changed()
    this.cells[this.lastCell]?.focus()
    this.placeCaretAtEnd(this.cells[this.lastCell])
    this.host.changed()
  }

  close(): void {
    if (!this.editing) return
    this.flush()
    this.editing = null
    this.draft = null
    this.cells = []
    this.layer.replaceChildren()
    this.host.root.classList.remove('kt-hf-editing', 'kt-hf-hide-text')
    this.host.changed()
  }

  setShowText(on: boolean): void {
    this.showText = on
    this.host.root.classList.toggle('kt-hf-hide-text', !!this.editing && !on)
  }

  // Previous / Next: the same band on the page before or after.
  step(d: number): void {
    if (!this.editing) return
    const n = this.editing.sheet + d
    if (n < 0 || n >= this.host.sheets()) return
    this.open(this.editing.band, n)
  }

  // A change made from the ribbon (Different First Page, a page number...).
  update(patch: Partial<HeaderFooter> | ((hf: HeaderFooter) => HeaderFooter)): void {
    this.flush()
    const cur = this.current() ?? { ...HF_DEFAULT }
    const next = typeof patch === 'function' ? patch({ ...cur }) : { ...cur, ...patch }
    for (const k of Object.keys(next) as (keyof HeaderFooter)[]) if (next[k] === undefined) delete next[k]
    this.draft = null
    this.host.setHeaderFooter(next)
    if (this.editing) this.render()
  }

  remove(band: Band): void {
    this.update(hf => ({ ...hf, [band]: '', first_header: band === 'header' ? '' : hf.first_header,
      first_footer: band === 'footer' ? '' : hf.first_footer,
      even_header: band === 'header' ? '' : hf.even_header, even_footer: band === 'footer' ? '' : hf.even_footer }))
  }

  // A field (PAGE, DATE, PICTURE:path...) at the caret in the band being
  // edited; the header opened first when nothing is.
  insertField(f: string): void {
    if (!this.editing) this.open('header')
    const cell = this.cells[this.lastCell] ?? this.cells[0]
    if (!cell) return
    const node = this.fieldNode(f)
    const sel = window.getSelection()
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
    if (r && cell.contains(r.startContainer)) {
      r.deleteContents()
      r.insertNode(node)
      r.setStartAfter(node)
      r.collapse(true)
      sel!.removeAllRanges()
      sel!.addRange(r)
    } else {
      cell.appendChild(node)
    }
    cell.focus()
    this.commitSoon(0)
  }

  // ---- drawing ----

  // The header and footer of every sheet, for the overlay (the band being
  // edited is drawn by the edit layer).
  paint(sheets: number): string {
    const hf = this.current()
    if (!hf) return ''
    const out: string[] = []
    for (let k = 0; k < sheets; k++) {
      const v = variantFor(hf, k, this.host.pageLabel(k))
      for (const band of ['header', 'footer'] as Band[]) {
        if (this.editing && this.editing.sheet === k && this.editing.band === band) continue
        const t = textOf(hf, band, v)
        if (!t) continue
        out.push(this.bandHtml(t, band, k, hf))
      }
    }
    return out.join('')
  }

  private lineBox(band: Band, sheet: number, hf: HeaderFooter): { top: number; lh: number; size: number } {
    const g = this.host.geometry()
    const size = this.host.bodyFont().sizePx
    const lh = size * 1.25
    // LaTeX's head box ends 14 pt under "Header from Top"; the footer's
    // baseline is "Footer from Bottom" up from the paper's foot.
    const base = band === 'header'
      ? (hf.header_cm ?? 1.25) * CM + 14 * PT
      : g.heightPx - (hf.footer_cm ?? 1.25) * CM
    return { top: sheet * g.heightPx + base - 0.8 * lh, lh, size }
  }

  private bandHtml(text: string, band: Band, sheet: number, hf: HeaderFooter): string {
    const g = this.host.geometry()
    const { top, lh, size } = this.lineBox(band, sheet, hf)
    const f = this.host.bodyFont()
    const w = g.widthPx - g.leftPx - g.rightPx
    const [l, c, r] = parts(text)
    const cell = (s: string, align: string) => s
      ? `<div class="kt-hf-text" style="left:${g.leftPx}px;width:${w}px;top:${top}px;line-height:${lh}px;`
        + `font-family:${f.family};font-size:${size}px;text-align:${align}">${this.valuesHtml(s, sheet)}</div>`
      : ''
    return cell(l, 'left') + cell(c, 'center') + cell(r, 'right')
  }

  // A text with its fields as their values on sheet k.
  private valuesHtml(s: string, sheet: number): string {
    let out = ''
    let last = 0
    for (const m of s.matchAll(HF_FIELD_RE)) {
      out += esc(s.slice(last, m.index))
      out += this.fieldHtml(m[1], sheet)
      last = (m.index ?? 0) + m[0].length
    }
    return out + esc(s.slice(last))
  }

  private fieldValue(f: string, sheet: number): string {
    const m = this.host.meta()
    const now = new Date()
    return f === 'PAGE' ? this.host.pageLabel(sheet).split(' ')[0]
      : f === 'NUMPAGES' ? String(this.host.pageCount())
        : f === 'DATE' ? `${now.toLocaleString('en-GB', { month: 'long' })} ${now.getDate()}, ${now.getFullYear()}`
          : f === 'TITLE' ? m.title || '' : f === 'AUTHOR' ? m.author || '' : ''
  }

  private fieldHtml(f: string, sheet: number): string {
    if (f.startsWith('PICTURE:')) {
      const src = this.host.resolveImage(f.slice(8).trim())
      return src ? `<img class="kt-hf-pic" src="${esc(src)}" alt="" style="height:${0.9 * CM}px">` : '[picture]'
    }
    return esc(this.fieldValue(f, sheet))
  }

  // ---- editing ----

  private label(band: Band, v: Variant): string {
    const name = band === 'header' ? 'Header' : 'Footer'
    return v === 'first_' ? `First Page ${name}` : v === 'even_' ? `Even Page ${name}` : this.current()?.odd_even ? `Odd Page ${name}` : name
  }

  render(): void {
    if (!this.editing) return
    const hf = this.current() ?? { ...HF_DEFAULT }
    const { band, sheet } = this.editing
    const g = this.host.geometry()
    const v = variantFor(hf, sheet, this.host.pageLabel(sheet))
    const { top, lh, size } = this.lineBox(band, sheet, hf)
    const f = this.host.bodyFont()
    const edge = band === 'header' ? sheet * g.heightPx + g.topPx : (sheet + 1) * g.heightPx - g.bottomPx
    this.layer.replaceChildren()
    const line = document.createElement('div')
    line.className = 'kt-hf-line'
    line.style.cssText = `left:${sheet === 0 ? 0 : 0}px;width:${g.widthPx}px;top:${edge}px`
    const tab = document.createElement('div')
    tab.className = 'kt-hf-tab'
    tab.textContent = this.label(band, v)
    tab.style.cssText = band === 'header' ? `left:6px;top:${edge}px` : `left:6px;top:${edge}px;transform:translateY(-100%)`
    const row = document.createElement('div')
    row.className = 'kt-hf-row'
    row.style.cssText = `left:${g.leftPx}px;width:${g.widthPx - g.leftPx - g.rightPx}px;top:${top}px;`
      + `font-family:${f.family};font-size:${size}px;line-height:${lh}px;min-height:${lh}px`
    const texts = parts(textOf(hf, band, v))
    this.cells = (['left', 'center', 'right'] as const).map((align, i) => {
      const c = document.createElement('div')
      c.className = 'kt-hf-cell'
      c.contentEditable = 'true'
      c.spellcheck = true
      c.style.textAlign = align
      c.dataset.placeholder = ['Type here', '', ''][i]
      c.innerHTML = this.editHtml(texts[i], sheet)
      c.addEventListener('focus', () => { this.lastCell = i })
      c.addEventListener('input', () => this.commitSoon())
      c.addEventListener('keydown', (e) => this.onKey(e, i))
      return c
    })
    row.append(...this.cells)
    this.layer.append(line, tab, row)
  }

  private editHtml(s: string, sheet: number): string {
    let out = ''
    let last = 0
    for (const m of s.matchAll(HF_FIELD_RE)) {
      out += esc(s.slice(last, m.index))
      out += `<span class="kt-hf-field" contenteditable="false" data-f="${esc(m[1])}">${this.fieldHtml(m[1], sheet)}</span>`
      last = (m.index ?? 0) + m[0].length
    }
    return out + esc(s.slice(last))
  }

  private fieldNode(f: string): HTMLElement {
    const span = document.createElement('span')
    span.className = 'kt-hf-field'
    span.contentEditable = 'false'
    span.dataset.f = f
    span.innerHTML = this.fieldHtml(f, this.editing?.sheet ?? 0)
    return span
  }

  private onKey(e: KeyboardEvent, i: number): void {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); this.close() }
    else if (e.key === 'Enter') e.preventDefault()
    else if (e.key === 'Tab') {
      e.preventDefault()
      const n = this.cells[i + (e.shiftKey ? -1 : 1)]
      if (n) { n.focus(); this.placeCaretAtEnd(n) }
    }
  }

  private placeCaretAtEnd(el: HTMLElement | undefined): void {
    if (!el) return
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  }

  // A cell's text: its words, its fields as {PAGE}...
  private static read(el: Node): string {
    let s = ''
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) s += (n.nodeValue ?? '').replace(/[\t\n\r]+/g, ' ')
      else if (n instanceof HTMLElement && n.dataset.f) s += `{${n.dataset.f}}`
      else if (n instanceof HTMLElement && n.tagName === 'BR') s += ''
      else s += HeaderFooterEditor.read(n)
    })
    return s
  }

  private commitSoon(ms = 350): void {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.flush(), ms)
  }

  // The edited band's text into the document.
  private flush(): void {
    clearTimeout(this.timer)
    if (!this.editing || !this.cells.length) return
    const hf = { ...(this.current() ?? HF_DEFAULT) }
    const { band, sheet } = this.editing
    const v = variantFor(hf, sheet, this.host.pageLabel(sheet))
    const [l, c, r] = this.cells.map(x => HeaderFooterEditor.read(x).replace(/ /g, ' '))
    const text = r ? `${l}\t${c}\t${r}` : c ? `${l}\t${c}` : l
    const key = `${v}${band}` as 'header'
    if ((hf[key] ?? '') === text && this.host.meta().header_footer) return
    hf[key] = text
    this.draft = null
    this.host.setHeaderFooter(hf)
  }
}
