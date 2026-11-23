// Insert / Layout ▸ Header & Footer and its tab (editor/headerFooter.ts):
// Header, Footer and Page Number layouts, fields, a picture, moving
// between the bands and the pages, the options and the positions.
import type { HeaderFooter } from '../../core/model.ts'
import { editor } from '../../editor/controller.ts'
import { HF_DEFAULT, type Band } from '../../editor/headerFooter.ts'
import { platform } from '../../platform/index.ts'
import { registerActions, type Handler } from '../actions.ts'

const hfe = () => editor()?.hf
type Key = 'header' | 'footer' | 'first_header' | 'first_footer' | 'even_header' | 'even_footer'

function splitParts(s = ''): string[] {
  const p = s.split('\t')
  return [p[0] ?? '', p[1] ?? '', p.slice(2).join(' ')]
}
function joinParts([l, c, r]: string[]): string {
  return r ? `${l}\t${c}\t${r}` : c ? `${l}\t${c}` : l
}

// A layout for the header or footer (its odd, even and first-page texts
// alike), then edited.
function layout(band: Band, text: string): void {
  const e = hfe()
  if (!e) return
  e.update(hf => {
    const next = { ...hf, [band]: text }
    if (hf.odd_even) next[`even_${band}` as Key] = text
    return next
  })
  e.open(band)
}

// The page number at one side of the header or footer, the rest kept.
function pageNumber(band: Band, side: 0 | 1 | 2): void {
  const e = hfe()
  if (!e) return
  e.update(hf => {
    const next: HeaderFooter = { ...hf }
    for (const k of [band, `even_${band}`] as Key[]) {
      if (k.startsWith('even_') && !hf.odd_even) continue
      const p = splitParts(stripPageNumbers(next[k] ?? ''))
      p[side] = '{PAGE}'
      next[k] = joinParts(p)
    }
    return next
  })
  e.open(band)
}

function stripPageNumbers(s: string): string {
  return joinParts(splitParts(s).map(p => p.replace(/Page \{PAGE\} of \{NUMPAGES\}/g, '').replace(/\{(PAGE|NUMPAGES)\}/g, '').trim()))
}

async function pickPicture(): Promise<string | null> {
  try {
    const r = await platform().openFileDialog({
      title: 'Picture for the header or footer',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }, { name: 'All', extensions: ['*'] }],
    })
    return r?.[0] ?? null
  } catch {
    return null
  }
}

const actions: Record<string, Handler> = {
  hf_header_blank: () => hfe()?.open('header'),
  hf_header_three: () => layout('header', 'Type here\tType here\tType here'),
  hf_header_title: () => layout('header', '{TITLE}\t\t{DATE}'),
  hf_header_remove: () => hfe()?.remove('header'),
  hf_footer_blank: () => hfe()?.open('footer'),
  hf_footer_three: () => layout('footer', 'Type here\tType here\tType here'),
  hf_footer_remove: () => hfe()?.remove('footer'),
  pagenum_xy: () => layout('footer', '\tPage {PAGE} of {NUMPAGES}'),
  pagenum_remove: () => hfe()?.update(hf => {
    const next = { ...hf }
    for (const k of ['header', 'footer', 'first_header', 'first_footer', 'even_header', 'even_footer'] as Key[]) {
      if (next[k] !== undefined) next[k] = stripPageNumbers(next[k]!)
    }
    return next
  }),
  hf_datetime: () => hfe()?.insertField('DATE'),
  hf_picture: async () => {
    const p = await pickPicture()
    if (p) hfe()?.insertField(`PICTURE:${p}`)
  },
  hf_goto_header: () => hfe()?.open('header'),
  hf_goto_footer: () => hfe()?.open('footer'),
  hf_prev: () => hfe()?.step(-1),
  hf_next: () => hfe()?.step(1),
  hf_link: () => {},
  hf_first: () => {
    const e = hfe()
    if (!e) return
    const on = !e.current()?.different_first
    e.update({ different_first: on || undefined })
    // Its own band shown at once: page 1's.
    if (on && e.editing) e.open(e.editing.band, 0)
  },
  hf_oddeven: () => {
    const e = hfe()
    if (!e) return
    const cur = e.current() ?? HF_DEFAULT
    const on = !cur.odd_even
    // Even pages start as a copy of the others.
    e.update(on ? { odd_even: true, even_header: cur.even_header ?? cur.header, even_footer: cur.even_footer ?? cur.footer }
      : { odd_even: undefined })
  },
  hf_showtext: () => {
    const e = hfe()
    if (!e) return
    e.setShowText(!e.showText)
    editor()?.syncToolbar()
  },
  hf_close: () => hfe()?.close(),
}
for (const f of ['PAGE', 'NUMPAGES', 'DATE', 'TITLE', 'AUTHOR']) actions[`hf_field_${f}`] = () => hfe()?.insertField(f)
for (const [side, i] of [['l', 0], ['c', 1], ['r', 2]] as const) {
  actions[`pagenum_top_${side}`] = () => pageNumber('header', i)
  actions[`pagenum_bottom_${side}`] = () => pageNumber('footer', i)
}
for (const k of ['header_cm', 'footer_cm'] as const) {
  actions[`hfpos:${k}`] = v => {
    const cm = parseFloat(String(v))
    if (Number.isFinite(cm)) hfe()?.update({ [k]: Math.max(0, Math.min(10, cm)) })
  }
}

registerActions(actions)
