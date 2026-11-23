// The review margin: Word's comment balloons beside the page. Each
// comment mark (grouped by gid) gets a card level with its text, showing
// author, date and note, with Accept (keep the text, drop the note) and
// Reject (remove the commented text). A click on a card selects the text.
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { schema } from './schema.ts'

export interface CommentSpan {
  gid: number
  from: number
  to: number
  ranges: { from: number; to: number }[]
  note: string
  author: string
  timestamp: string
  text: string
}

export function commentSpans(view: EditorView): CommentSpan[] {
  const byGid = new Map<number, CommentSpan>()
  view.state.doc.descendants((node, pos) => {
    if (!node.isInline) return true
    const m = node.marks.find(x => x.type === schema.marks.comment)
    if (!m) return false
    const end = pos + node.nodeSize
    let s = byGid.get(m.attrs.gid)
    if (!s) {
      s = { gid: m.attrs.gid, from: pos, to: end, ranges: [], note: m.attrs.note, author: m.attrs.author,
        timestamp: m.attrs.timestamp, text: '' }
      byGid.set(m.attrs.gid, s)
    }
    const last = s.ranges[s.ranges.length - 1]
    if (last && last.to === pos) last.to = end
    else s.ranges.push({ from: pos, to: end })
    s.to = end
    s.text += node.isText ? node.text : '…'
    return false
  })
  return [...byGid.values()]
}

function shortDate(ts: string): string {
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// The comment column beside the page (its 20 px gap, 250 px cards and a
// little room after): the page view counts it in the page's width when
// there are comments, so fitting the width shows them.
export const REVIEW_COLUMN_PX = 290
export const REVIEW_EVENT = 'kt-review-shown'
let reviewShown = false
export function hasReviewColumn(): boolean { return reviewShown }
function setReviewShown(on: boolean): void {
  if (on === reviewShown) return
  reviewShown = on
  window.dispatchEvent(new CustomEvent(REVIEW_EVENT))
}

export class ReviewMargin {
  readonly el: HTMLElement
  private frame = 0
  private mount: HTMLElement
  private view: () => EditorView

  constructor(mount: HTMLElement, view: () => EditorView) {
    this.mount = mount
    this.view = view
    this.el = document.createElement('div')
    this.el.className = 'kt-review'
    this.el.addEventListener('mousedown', e => e.stopPropagation())
    mount.appendChild(this.el)
  }

  schedule(): void {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.render())
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.mount.classList.remove('kt-has-review')
    setReviewShown(false)
  }

  private accept(s: CommentSpan): void {
    const v = this.view()
    const tr = v.state.tr
    for (const r of s.ranges) tr.removeMark(r.from, r.to, schema.marks.comment)
    v.dispatch(tr)
    v.focus()
  }

  private reject(s: CommentSpan): void {
    const v = this.view()
    const tr = v.state.tr
    for (const r of [...s.ranges].reverse()) tr.delete(r.from, r.to)
    v.dispatch(tr)
    v.focus()
  }

  private select(s: CommentSpan): void {
    const v = this.view()
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, s.from, s.to)))
    v.focus()
  }

  render(): void {
    const v = this.view()
    if (!v.dom.isConnected) return
    const spans = commentSpans(v)
    this.mount.classList.toggle('kt-has-review', spans.length > 0)
    setReviewShown(spans.length > 0)
    this.el.replaceChildren()
    if (!spans.length) return
    const box = this.mount.getBoundingClientRect()
    const scale = box.width / (this.mount.offsetWidth || 1) || 1
    const { from: selFrom, to: selTo } = v.state.selection
    let floor = 0
    for (const s of spans) {
      let want = 0
      try { want = (v.coordsAtPos(s.from).top - box.top) / scale } catch { /* keep 0 */ }
      const card = document.createElement('div')
      card.className = 'kt-review-card'
      if (selFrom <= s.to && selTo >= s.from) card.classList.add('active')
      const head = document.createElement('div')
      head.className = 'kt-review-head'
      const who = document.createElement('b')
      who.textContent = s.author || 'Comment'
      const when = document.createElement('span')
      when.textContent = s.timestamp ? shortDate(s.timestamp) : ''
      head.append(who, when)
      const quote = document.createElement('div')
      quote.className = 'kt-review-quote'
      quote.textContent = s.text.length > 80 ? s.text.slice(0, 80) + '…' : s.text
      const note = document.createElement('div')
      note.className = 'kt-review-note'
      note.textContent = s.note || '(no note)'
      const btns = document.createElement('div')
      btns.className = 'kt-review-btns'
      const ok = document.createElement('button')
      ok.textContent = '✓ Accept'
      ok.title = 'Keep the text, remove the comment'
      ok.onclick = e => { e.stopPropagation(); this.accept(s) }
      const no = document.createElement('button')
      no.textContent = '✕ Reject'
      no.title = 'Remove the commented text'
      no.onclick = e => { e.stopPropagation(); this.reject(s) }
      btns.append(ok, no)
      card.append(head, quote, note, btns)
      card.onclick = () => this.select(s)
      card.onmouseenter = () => this.hover(s.gid, true)
      card.onmouseleave = () => this.hover(s.gid, false)
      this.el.appendChild(card)
      const top = Math.max(want, floor)
      card.style.top = `${top}px`
      floor = top + card.offsetHeight + 6
    }
  }

  private hover(gid: number, on: boolean): void {
    const v = this.view()
    for (const s of commentSpans(v)) {
      if (s.gid !== gid) continue
      for (let p = s.from; p < s.to; p++) {
        const d = v.domAtPos(p).node
        const el = (d.nodeType === 1 ? d : d.parentElement) as HTMLElement | null
        el?.closest('.kt-comment')?.classList.toggle('kt-comment-hot', on)
      }
    }
  }
}
