// Moving a box or a table by dragging it, as Word moves a table by its
// handle: hover over one and a grip shows in the left margin; drag the grip
// and a line shows where it will land between the blocks; let go to move it.
// A box moves whole (all its paragraphs).
import { Plugin, TextSelection, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { isCallout } from '../core/model.ts'

// A run of top-level blocks that moves as one: a box's paragraphs, a table,
// or (as a place to drop) any other block.
interface Unit { from: number; to: number; movable: boolean }

export function blockUnits(state: EditorState): Unit[] {
  const units: Unit[] = []
  state.doc.forEach((node, pos) => {
    const end = pos + node.nodeSize
    const box = node.type.name === 'theorem' && isCallout(node.attrs.kind)
    const prev = units[units.length - 1]
    // A paragraph continuing the box before it joins that box.
    if (box && !node.attrs.start && prev?.movable && prev.to === pos) {
      const before = state.doc.nodeAt(prev.from)
      if (before?.type.name === 'theorem' && before.attrs.kind === node.attrs.kind) { prev.to = end; return }
    }
    units.push({ from: pos, to: end, movable: box || node.type.name === 'table' })
  })
  return units
}

// The transaction moving [from, to) to the boundary at target (a unit's start
// or the end of the document); the caret goes to the start of what moved.
export function moveBlocks(state: EditorState, from: number, to: number, target: number) {
  if (target >= from && target <= to) return null
  const slice = state.doc.slice(from, to)
  const tr = state.tr
  let start: number
  if (target > to) {
    tr.insert(target, slice.content)
    tr.delete(from, to)
    start = target - (to - from)
  } else {
    tr.delete(from, to)
    tr.insert(target, slice.content)
    start = target
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(start + 1, tr.doc.content.size))))
  return tr
}

function rectOf(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos)
  return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null
}

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

export function blockMoverPlugin(): Plugin {
  return new Plugin({
    view(view) {
      const grip = document.createElement('div')
      grip.className = 'kt-move-grip'
      grip.title = 'Drag to move'
      grip.textContent = '⋮⋮'
      grip.hidden = true
      const line = document.createElement('div')
      line.className = 'kt-move-line'
      line.hidden = true
      document.body.append(grip, line)

      let hover: Unit | null = null
      let drag: { unit: Unit; target: number | null } | null = null
      let hideTimer = 0

      const place = (u: Unit) => {
        const r = rectOf(view, u.from)
        if (!r) return
        grip.style.left = `${r.left - 22}px`
        grip.style.top = `${r.top + 1}px`
        grip.hidden = false
      }
      const onMove = (e: MouseEvent) => {
        if (drag || !view.editable) return
        const at = view.posAtCoords({ left: e.clientX, top: e.clientY })
        const u = at ? blockUnits(view.state).find(x => x.movable && at.pos >= x.from && at.pos <= x.to) : undefined
        if (u) {
          clearTimeout(hideTimer)
          hover = u
          place(u)
        } else if (hover) {
          // A moment to reach the grip in the margin.
          clearTimeout(hideTimer)
          hideTimer = window.setTimeout(() => { if (!drag) { hover = null; grip.hidden = true } }, 400)
        }
      }
      const onScroll = () => { if (!drag) { hover = null; grip.hidden = true } }

      // The boundary nearest the mouse: before a unit, or at the very end.
      const nearest = (y: number, moving: Unit): { pos: number; y: number } | null => {
        let best: { pos: number; y: number } | null = null
        const units = blockUnits(view.state)
        const cands: { pos: number; y: number }[] = []
        for (const u of units) {
          const r = rectOf(view, u.from)
          if (r) cands.push({ pos: u.from, y: r.top - 2 })
        }
        const last = units[units.length - 1]
        const lr = last && rectOf(view, last.from)
        if (lr) cands.push({ pos: view.state.doc.content.size, y: lr.bottom + 2 })
        for (const c of cands) {
          if (c.pos >= moving.from && c.pos <= moving.to) continue
          if (!best || Math.abs(c.y - y) < Math.abs(best.y - y)) best = c
        }
        return best
      }
      const dragMove = (e: MouseEvent) => {
        if (!drag) return
        e.preventDefault()
        // Near the top or bottom of the page: scroll it.
        const sc = scrollerOf(view.dom)
        if (sc) {
          const r = sc.getBoundingClientRect()
          if (e.clientY < r.top + 40) sc.scrollTop -= 14
          else if (e.clientY > r.bottom - 40) sc.scrollTop += 14
        }
        const b = nearest(e.clientY, drag.unit)
        drag.target = b?.pos ?? null
        if (b) {
          const f = view.dom.getBoundingClientRect()
          line.style.left = `${f.left}px`
          line.style.width = `${f.width}px`
          line.style.top = `${b.y}px`
          line.hidden = false
        } else line.hidden = true
        grip.style.top = `${e.clientY - 9}px`
      }
      const dragEnd = () => {
        window.removeEventListener('mousemove', dragMove, true)
        window.removeEventListener('mouseup', dragEnd, true)
        document.body.classList.remove('kt-moving')
        line.hidden = true
        grip.hidden = true
        const d = drag
        drag = null
        hover = null
        if (!d || d.target === null) return
        const tr = moveBlocks(view.state, d.unit.from, d.unit.to, d.target)
        if (tr) view.dispatch(tr)
        view.focus()
      }
      grip.addEventListener('mousedown', e => {
        if (e.button !== 0 || !hover) return
        e.preventDefault()
        drag = { unit: hover, target: null }
        document.body.classList.add('kt-moving')
        window.addEventListener('mousemove', dragMove, true)
        window.addEventListener('mouseup', dragEnd, true)
      })
      grip.addEventListener('mouseenter', () => clearTimeout(hideTimer))

      const host = view.dom.parentElement ?? view.dom
      host.addEventListener('mousemove', onMove)
      const sc = scrollerOf(view.dom)
      sc?.addEventListener('scroll', onScroll)
      return {
        update() { if (!drag && hover) { hover = null; grip.hidden = true } },
        destroy() {
          host.removeEventListener('mousemove', onMove)
          sc?.removeEventListener('scroll', onScroll)
          grip.remove()
          line.remove()
        },
      }
    },
  })
}
