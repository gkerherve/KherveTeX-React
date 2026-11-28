// The Admin & Office, Accountants and Architect elements in the editor,
// as the PDF shows them (core/office.ts): a table as an HTML table, a
// drawing as SVG.
import { OFFICE_KINDS, officeRender, type OfficeKind, type TableSpec } from '../core/office.ts'
import { drawingSvg } from './widgetView.ts'

export const isOfficeKind = (k: string): k is OfficeKind => (OFFICE_KINDS as readonly string[]).includes(k)

function table(t: TableSpec): HTMLElement {
  const C = '#' + t.color
  const box = document.createElement('div')
  box.className = 'kt-o-table'
  if (t.title) { const h = document.createElement('div'); h.className = 'kt-o-title'; h.style.color = C; h.textContent = t.title; box.appendChild(h) }
  if (t.info) {
    const info = document.createElement('div'); info.className = 'kt-o-info'
    t.info.forEach((ls, side) => {
      const b = document.createElement('div'); b.style.textAlign = side ? 'right' : 'left'
      ls.forEach((l, i) => { const p = document.createElement('div'); p.textContent = l; if (!i) p.style.fontWeight = '700'; b.appendChild(p) })
      info.appendChild(b)
    })
    box.appendChild(info)
  }
  const tb = document.createElement('table')
  tb.style.setProperty('--kO', C)
  if (t.header) {
    const tr = tb.createTHead().insertRow()
    t.header.forEach((h, i) => { const th = document.createElement('th'); th.textContent = h; if (!t.cols[i]?.width) th.style.whiteSpace = 'nowrap'; th.style.textAlign = t.cols[i]?.align === 'r' ? 'right' : t.cols[i]?.align === 'c' ? 'center' : 'left'; tr.appendChild(th) })
  }
  const body = tb.createTBody()
  for (const r of t.rows) {
    const tr = body.insertRow()
    if (r.style && r.style !== 'normal') tr.className = `kt-o-${r.style}`
    if (r.style === 'heading') { const td = tr.insertCell(); td.colSpan = t.cols.length; td.textContent = r.cells[0] ?? ''; td.style.color = C; continue }
    r.cells.forEach((c, i) => {
      const td = tr.insertCell(); td.textContent = c
      const a = t.cols[i]?.align
      td.style.textAlign = a === 'r' ? 'right' : a === 'c' ? 'center' : 'left'
      // A column of a set width (cm) wraps at it; the others never wrap,
      // as LaTeX's l, c and r columns.
      const w = t.cols[i]?.width
      if (w) { td.style.width = `${w}cm`; td.style.minWidth = `${w}cm`; td.style.maxWidth = `${w}cm` } else td.style.whiteSpace = 'nowrap'
      if (r.colors?.[i]) td.style.color = '#' + r.colors[i]
    })
  }
  box.appendChild(tb)
  if (t.note) { const n = document.createElement('div'); n.className = 'kt-o-note'; n.textContent = t.note; box.appendChild(n) }
  return box
}

export function officeView(body: HTMLElement, kind: OfficeKind, data: unknown) {
  const o = officeRender(kind, data)
  if (o.table) body.appendChild(table(o.table))
  else if (o.drawing) body.appendChild(drawingSvg(o.drawing))
}
