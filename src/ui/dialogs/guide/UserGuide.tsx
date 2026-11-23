// Help ▸ User guide (F1): the illustrated guide. Chapters on the left
// (grouped by part, filtered by the search box), the chapter on the right
// with its screenshots; a click on a picture shows it full size, a
// "Show me" link brings the ribbon tab forward, Previous / Next page on.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { platform } from '../../../platform'
import { GUIDE, type GuideChapter } from './guideContent'
import { useDragWindow } from '../useDragWindow'
import './guide.css'

const PART_COLOURS: Record<GuideChapter['part'], string> = {
  Start: '#2b579a', Write: '#107c41', Insert: '#c43e1c', Look: '#8764b8', Output: '#0078d4', Together: '#ca5010', More: '#5c5c5c',
}

const LAST = 'kt-guide-chapter'
function lastChapter(): number {
  try {
    const i = GUIDE.findIndex(c => c.id === localStorage.getItem(LAST))
    return i >= 0 ? i : 0
  } catch { return 0 }
}

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ')
const TEXT = GUIDE.map(c => (c.title + ' ' + c.blurb + ' ' + plain(c.html)).toLowerCase())

function hitsOf(q: string): number[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return GUIDE.map((_, i) => words.every(w => TEXT[i].includes(w))
    ? words.reduce((n, w) => n + TEXT[i].split(w).length - 1, 0) : 0)
}

// Mark the search words in the chapter's text (not inside buttons).
function highlight(root: HTMLElement, q: string): HTMLElement | null {
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1)
  if (!words.length) return null
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const nodes: Text[] = []
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (re.test(n.nodeValue ?? '') && !(n.parentElement?.closest('button, mark'))) nodes.push(n as Text)
    re.lastIndex = 0
  }
  let first: HTMLElement | null = null
  for (const n of nodes) {
    const frag = document.createDocumentFragment()
    for (const part of (n.nodeValue ?? '').split(re)) {
      if (!part) continue
      if (re.test(part)) {
        const m = document.createElement('mark')
        m.textContent = part
        first ??= m
        frag.appendChild(m)
      } else frag.appendChild(document.createTextNode(part))
      re.lastIndex = 0
    }
    n.replaceWith(frag)
  }
  return first
}

export function UserGuide({ close }: { close: () => void }) {
  const [cur, setCur] = useState(lastChapter)
  const [q, setQ] = useState('')
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const drag = useDragWindow(win)
  const hits = useMemo(() => hitsOf(q.trim()), [q])
  const searching = q.trim().length > 0
  const ch = GUIDE[cur]

  const go = (i: number) => {
    setCur(i)
    try { localStorage.setItem(LAST, GUIDE[i].id) } catch { /* private window */ }
  }

  useEffect(() => {
    const el = body.current
    if (!el) return
    el.scrollTop = 0
    const first = searching ? highlight(el, q.trim()) : null
    first?.scrollIntoView({ block: 'center' })
  }, [cur, q, searching])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); e.preventDefault()
        // Esc: the picture, then the search, then the guide.
        if (zoom) setZoom(null); else if (q) setQ(''); else close()
      } else if (!zoom && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') go(Math.min(GUIDE.length - 1, cur + 1))
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(Math.max(0, cur - 1))
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  const onBody = (e: MouseEvent) => {
    const t = e.target as HTMLElement
    const img = t.closest('.g-shot img, .g-tabrow img') as HTMLImageElement | null
    if (img) { setZoom({ src: img.getAttribute('src')!, alt: img.alt }); return }
    const showMe = t.closest('.g-show') as HTMLElement | null
    if (showMe) {
      const { tab, group } = showMe.dataset
      close()
      setTimeout(() => window.dispatchEvent(new CustomEvent('kt-tool-go', {
        detail: { label: group, where: `${tab} ▸ ${group}`, tab, group },
      })), 60)
      return
    }
    const a = t.closest('a') as HTMLAnchorElement | null
    const href = a?.getAttribute('href')
    if (!href) return
    e.preventDefault()
    if (href.startsWith('#')) {
      const i = GUIDE.findIndex(c => c.id === href.slice(1))
      if (i >= 0) go(i)
    } else void platform().openUrl(href).catch(() => {})
  }

  let lastPart = ''
  return (
    <div ref={win} className='dlg dlg-guide' role='dialog' aria-modal='true' aria-label='kTeX User Guide'>
      <div className='g-top' {...drag} title='Drag to move the guide; double-click to centre it'>
        <div className='g-brand'><span className='g-logo'>kTeX</span><span>User Guide</span></div>
        <div className='g-search'>
          <svg width='14' height='14' viewBox='0 0 13 13' aria-hidden='true'>
            <circle cx='5.5' cy='5.5' r='4.2' fill='none' stroke='currentColor' strokeWidth='1.4' />
            <path d='M8.6 8.6 L12 12' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' /></svg>
          <input type='search' autoFocus placeholder='Search the guide' aria-label='Search the guide' value={q}
            onChange={e => {
              const v = e.target.value
              setQ(v)
              const h = hitsOf(v.trim())
              // Go to the chapter that mentions it most.
              const best = h.reduce((b, n, i) => (n > h[b] ? i : b), 0)
              if (v.trim() && h[best] > 0) setCur(best)
            }}
            />
        </div>
        <button type='button' className='g-close' aria-label='Close' onClick={close}>✕</button>
      </div>
      <div className='g-main'>
        <nav className='g-nav' aria-label='Chapters'>
          {GUIDE.map((c, i) => {
            if (searching && !hits[i]) return null
            const head = !searching && c.part !== lastPart
            lastPart = c.part
            return (
              <div key={c.id}>
                {head && <div className='g-part' style={{ color: PART_COLOURS[c.part] }}>{c.part}</div>}
                <button type='button' className={'g-navitem' + (i === cur ? ' on' : '')} onClick={() => go(i)}
                  style={{ ['--part' as string]: PART_COLOURS[c.part] }}>
                  <span className='g-num'>{i + 1}</span>
                  <span className='g-navtext'><b>{c.title}</b>{searching && <small>{hits[i]} match{hits[i] === 1 ? '' : 'es'}</small>}</span>
                </button>
              </div>
            )
          })}
          {searching && !hits.some(n => n) && <div className='g-none'>Nothing found for “{q}”.</div>}
        </nav>
        <div className='g-body' ref={body} onClick={onBody}>
          <article className='g-page' key={ch.id + '|' + q}>
            <header className='g-head' style={{ ['--part' as string]: PART_COLOURS[ch.part] }}>
              <span className='g-chip'>{ch.part} · Chapter {cur + 1} of {GUIDE.length}</span>
              <h2>{ch.title}</h2>
              <p>{ch.blurb}</p>
            </header>
            <div className='g-content' dangerouslySetInnerHTML={{ __html: ch.html }} />
            <footer className='g-foot'>
              {cur > 0 ? <button type='button' className='g-pn' onClick={() => go(cur - 1)}><small>← Previous</small><b>{GUIDE[cur - 1].title}</b></button> : <span />}
              {cur < GUIDE.length - 1 ? <button type='button' className='g-pn g-next' onClick={() => go(cur + 1)}><small>Next →</small><b>{GUIDE[cur + 1].title}</b></button> : <span />}
            </footer>
          </article>
        </div>
      </div>
      {zoom && (
        <div className='g-zoom' onClick={() => setZoom(null)} role='presentation'>
          <img src={zoom.src} alt={zoom.alt} />
          <div className='g-zoomcap'>{zoom.alt} <span>Click or press Esc to close</span></div>
        </div>
      )}
    </div>
  )
}
