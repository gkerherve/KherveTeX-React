// The placement button at the top right of a figure or a table: where
// LaTeX may put the float ([H] exactly here, [htbp] the best place, [t]
// the top of a page...), as the letters after \begin{figure}.
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export const PLACEMENTS: { value: string; label: string; tip: string }[] = [
  { value: '', label: 'Document default', tip: 'Exactly here when the document loads the float package (kTeX documents do), else the best place' },
  { value: 'H', label: 'Exactly here [H]', tip: 'Never moves: stays where it is in the text (a page may end early to make room)' },
  { value: 'h', label: 'Here if it fits [h]', tip: 'Here when there is room, else LaTeX moves it' },
  { value: 'htbp', label: 'Best place [htbp]', tip: 'Here, at the top or bottom of a page, or on a page of floats: LaTeX chooses' },
  { value: 'ht', label: 'Here or top [ht]', tip: 'Here, or at the top of the next page' },
  { value: 't', label: 'Top of a page [t]', tip: 'At the top of this page or the next' },
  { value: 'b', label: 'Bottom of a page [b]', tip: 'At the bottom of this page or the next' },
  { value: 'p', label: 'Page of floats [p]', tip: 'On a page holding only figures and tables' },
]

// The short text the button shows.
export function placementBadge(p: string): string {
  return p ? `[${p}]` : 'Place'
}

// A figure or table node: its placement attribute.
function setAttr(view: EditorView, getPos: () => number | undefined) {
  return (value: string) => {
    const pos = getPos()
    if (pos === undefined) return
    const node = view.state.doc.nodeAt(pos)
    if (!node) return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, placement: value }))
    view.focus()
  }
}

// A figure or table written in LaTeX: \begin{figure}[...] at its start.
export const RAW_FLOAT_HEAD = /^(\s*\\begin\{(figure|table)\*?\})(\[[^\]\n]*\])?/

export function rawPlacement(text: string): string | null {
  const m = RAW_FLOAT_HEAD.exec(text)
  return m ? (m[3] ?? '').slice(1, -1) : null
}

// Its [...] rewritten in the block's own text.
function setRaw(view: EditorView, pos: number) {
  return (value: string) => {
    const node = view.state.doc.nodeAt(pos)
    const m = node && RAW_FLOAT_HEAD.exec(node.textContent)
    if (!node || !m) return
    const from = pos + 1 + m[1].length
    const to = from + (m[3]?.length ?? 0)
    const tr = view.state.tr
    if (value) tr.insertText(`[${value}]`, from, to)
    else tr.delete(from, to)
    view.dispatch(tr)
    view.focus()
  }
}

let openMenu: HTMLElement | null = null
function closeMenu(): void {
  openMenu?.remove()
  openMenu = null
}

function showMenu(button: HTMLElement, apply: (v: string) => void, current: string, what: string): void {
  closeMenu()
  const menu = document.createElement('div')
  menu.className = 'kt-place-menu'
  menu.setAttribute('role', 'menu')
  const head = document.createElement('div')
  head.className = 'kt-place-head'
  head.textContent = `Where LaTeX puts this ${what}`
  menu.appendChild(head)
  const bang = current.startsWith('!')
  const base = current.replace(/^!/, '')
  for (const p of PLACEMENTS) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'kt-place-item' + (p.value === base ? ' on' : '')
    item.textContent = (p.value === base ? '✓ ' : '') + p.label
    item.title = p.tip
    item.addEventListener('mousedown', e => {
      e.preventDefault()
      closeMenu()
      apply(p.value && bang && p.value !== 'H' ? `!${p.value}` : p.value)
    })
    menu.appendChild(item)
  }
  const sep = document.createElement('div')
  sep.className = 'kt-place-sep'
  menu.appendChild(sep)
  const force = document.createElement('button')
  force.type = 'button'
  force.className = 'kt-place-item' + (bang ? ' on' : '')
  force.textContent = (bang ? '✓ ' : '') + 'Ignore LaTeX\'s limits [!]'
  force.title = 'Let LaTeX place it even where its rules on how many floats a page holds would stop it'
  force.disabled = !base || base === 'H'
  force.addEventListener('mousedown', e => {
    e.preventDefault()
    closeMenu()
    apply(bang ? base : `!${base}`)
  })
  menu.appendChild(force)
  // Any letters: h, t, b, p, H and !, typed in (Enter applies them).
  const custom = document.createElement('label')
  custom.className = 'kt-place-custom'
  custom.textContent = 'Letters: '
  const input = document.createElement('input')
  input.value = current
  input.placeholder = 'htbp'
  input.size = 6
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); closeMenu(); apply(input.value.replace(/[^htbpH!]/g, '')) }
    else if (e.key === 'Escape') closeMenu()
  })
  custom.appendChild(input)
  menu.appendChild(custom)
  document.body.appendChild(menu)
  const r = button.getBoundingClientRect()
  const w = menu.offsetWidth
  menu.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, r.right - w))}px`
  menu.style.top = `${Math.min(innerHeight - menu.offsetHeight - 4, r.bottom + 2)}px`
  openMenu = menu
  const off = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) { closeMenu(); document.removeEventListener('mousedown', off, true) }
  }
  setTimeout(() => document.addEventListener('mousedown', off, true), 0)
}

function button(current: () => string, apply: (v: string) => void, what: string, now: string): HTMLElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'kt-place-btn' + (now ? ' set' : '')
  b.contentEditable = 'false'
  b.textContent = placementBadge(now)
  b.title = `Placement of this ${what} in the PDF (LaTeX's [H], [htbp], [t]...)`
  b.addEventListener('mousedown', e => {
    e.preventDefault()
    e.stopPropagation()
    showMenu(b, apply, current(), what)
  })
  return b
}

// The button for a figure or table written in LaTeX (a raw block at `pos`).
export function rawPlacementButton(view: EditorView, pos: number, text: string): HTMLElement {
  const what = RAW_FLOAT_HEAD.exec(text)?.[2] ?? 'figure'
  return button(() => rawPlacement(view.state.doc.nodeAt(pos)?.textContent ?? '') ?? '', setRaw(view, pos), what, rawPlacement(text) ?? '')
}

// The button for `node` (a figure or a table).
export function placementButton(node: PMNode, view: EditorView, getPos: () => number | undefined): HTMLElement {
  const what = node.type.name === 'table' ? 'table' : 'figure'
  const current = () => { const p = getPos(); return p === undefined ? '' : (view.state.doc.nodeAt(p)?.attrs.placement as string) || '' }
  return button(current, setAttr(view, getPos), what, node.attrs.placement || '')
}
