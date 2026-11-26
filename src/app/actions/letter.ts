// A letter's Edit window (letter and scrlttr2): sender, date, recipient,
// subject, opening, closing, signature, enclosures and cc as fields, not
// LaTeX. The words live where LaTeX wants them: the \begin{letter},
// \opening, \closing, \encl and \cc commands in the text, the sender and
// signature in the preamble (\address, \signature, \date; KOMA's
// \setkomavar{fromname}...). A click on the drawn letter opens it.
import type { Node as PMNode } from 'prosemirror-model'
import type { DocMeta } from '../../core/model.ts'
import { editor } from '../../editor/controller.ts'
import { argOf, rawLookHooks } from '../../editor/rawLook.ts'
import { officeDialog, type OfficeField } from '../../ui/dialogs/OfficeDialog.tsx'
import { registerActions } from '../actions.ts'

// LaTeX to the text shown in a field, and back.
const show = (s: string | null) => (s ?? '').replace(/\s*\\\\\s*/g, '\n').replace(/\\([&%#_$])/g, '$1').replace(/\\ /g, ' ').replace(/~/g, ' ').trim()
const tex = (s: string) => s.trim().replace(/([&%#_$])/g, '\\$1').replace(/\r?\n/g, '\\\\')

// The {...} at `i` (its end), braces balanced.
function argEnd(s: string, i: number): number {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return j + 1
  }
  return -1
}

// `\cmd{...}` in `s` with its argument replaced (or removed when empty and
// `drop`); null when `s` has no \cmd.
function replaceArg(s: string, cmd: string, value: string, drop = false): string | null {
  const m = new RegExp(`\\\\${cmd.replace(/[{}]/g, c => '\\' + c)}\\s*\\{`).exec(s)
  if (!m) return null
  const open = m.index + m[0].length - 1
  const end = argEnd(s, open)
  if (end < 0) return null
  if (drop && !value) return (s.slice(0, m.index) + s.slice(end)).replace(/\n{2,}/g, '\n').replace(/^\n|\n$/g, '')
  return s.slice(0, open) + `{${value}}` + s.slice(end)
}

function komavar(pre: string, name: string): string | null {
  const m = new RegExp(`\\\\setkomavar\\s*\\{${name}\\}\\s*\\{`).exec(pre)
  if (!m) return null
  const open = m.index + m[0].length - 1
  const end = argEnd(pre, open)
  return end < 0 ? null : pre.slice(open + 1, end - 1)
}

function setKomavar(pre: string, name: string, value: string): string {
  const m = new RegExp(`\\\\setkomavar\\s*\\{${name}\\}\\s*\\{`).exec(pre)
  if (m) {
    const open = m.index + m[0].length - 1
    const end = argEnd(pre, open)
    if (end > 0) return value ? pre.slice(0, open) + `{${value}}` + pre.slice(end) : (pre.slice(0, m.index) + pre.slice(end)).replace(/\n{2,}/g, '\n')
  }
  return value ? `${pre.replace(/\s*$/, '')}\n\\setkomavar{${name}}{${value}}\n` : pre
}

function setCommand(pre: string, cmd: string, value: string): string {
  const r = replaceArg(pre, cmd, value, true)
  if (r !== null) return r
  return value ? `${pre.replace(/\s*$/, '')}\n\\${cmd}{${value}}\n` : pre
}

// The raw blocks of the letter (those holding its commands).
function letterBlocks(doc: PMNode): { pos: number; text: string }[] {
  const out: { pos: number; text: string }[] = []
  doc.forEach((n, pos) => {
    if (n.type.name === 'raw_latex' && /\\(?:begin\{letter\}|opening|closing|encl|cc|end\{letter\})\b|\\begin\{letter\}/.test(n.textContent)) out.push({ pos, text: n.textContent })
  })
  return out
}

const find = (blocks: { text: string }[], cmd: string) => {
  for (const b of blocks) { const a = argOf(b.text, cmd); if (a !== null) return a }
  return null
}

async function editLetter(): Promise<void> {
  const e = editor()
  if (!e) return
  const meta = e.meta as DocMeta
  const koma = (meta.documentclass || '').toLowerCase().startsWith('scrlttr')
  const pre = meta.preamble_extras || ''
  const blocks = letterBlocks(e.view.state.doc)
  const recipient = (() => {
    for (const b of blocks) {
      const m = /\\begin\{letter\}\s*\{/.exec(b.text)
      if (m) { const open = m.index + m[0].length - 1; const end = argEnd(b.text, open); if (end > 0) return b.text.slice(open + 1, end - 1) }
    }
    return ''
  })()
  const f = (key: string, label: string, value: string | null, more: Partial<OfficeField> = {}): OfficeField => ({ key, label, value: show(value), ...more })
  const fields: OfficeField[] = koma
    ? [f('fromname', 'Your name', komavar(pre, 'fromname')), f('fromaddress', 'Your address', komavar(pre, 'fromaddress'), { type: 'textarea' }),
      f('fromemail', 'Email', komavar(pre, 'fromemail')), f('fromphone', 'Phone', komavar(pre, 'fromphone')),
      f('date', 'Date (empty: today)', komavar(pre, 'date')), f('to', 'To (name and address)', recipient, { type: 'textarea' }),
      f('subject', 'Subject', komavar(pre, 'subject')), f('opening', 'Opening', find(blocks, 'opening')),
      f('closing', 'Closing', find(blocks, 'closing')), f('signature', 'Signature', komavar(pre, 'signature'), { type: 'textarea' }),
      f('encl', 'Enclosures', find(blocks, 'encl')), f('cc', 'Copy to (cc)', find(blocks, 'cc'))]
    : [f('address', 'Your name and address', argOf(pre, 'address'), { type: 'textarea' }), f('date', 'Date (empty: today)', argOf(pre, 'date')),
      f('to', 'To (name and address)', recipient, { type: 'textarea' }), f('opening', 'Opening', find(blocks, 'opening')),
      f('closing', 'Closing', find(blocks, 'closing')), f('signature', 'Signature (name, role)', argOf(pre, 'signature'), { type: 'textarea' }),
      f('encl', 'Enclosures', find(blocks, 'encl')), f('cc', 'Copy to (cc)', find(blocks, 'cc'))]
  const r = await officeDialog('Letter', fields)
  if (!r) return
  const v = (k: string) => tex(r.values[k] ?? '')
  // The preamble: sender, date, subject, signature.
  let p = pre
  if (koma) {
    for (const k of ['fromname', 'fromaddress', 'fromemail', 'fromphone', 'date', 'subject', 'signature']) p = setKomavar(p, k, v(k))
  } else {
    p = setCommand(p, 'address', v('address'))
    p = setCommand(p, 'date', v('date'))
    p = setCommand(p, 'signature', v('signature'))
  }
  // The letter's commands in the text.
  const st = e.view.state
  let tr = st.tr
  const edited = blocks.map(b => {
    let t = b.text
    const m = /\\begin\{letter\}\s*\{/.exec(t)
    if (m) { const open = m.index + m[0].length - 1; const end = argEnd(t, open); if (end > 0) t = t.slice(0, open) + `{${v('to')}}` + t.slice(end) }
    t = replaceArg(t, 'opening', v('opening')) ?? t
    t = replaceArg(t, 'closing', v('closing')) ?? t
    for (const k of ['encl', 'cc']) {
      const r2 = replaceArg(t, k, v(k), true)
      if (r2 !== null) t = r2
      // A new enclosure or cc line goes before \end{letter}.
      else if (v(k) && /\\end\{letter\}/.test(t)) t = t.replace(/\\end\{letter\}/, `\\${k}{${v(k)}}\n\\end{letter}`)
    }
    return { ...b, next: t }
  })
  // From the last, so the positions before stay put.
  for (const b of [...edited].reverse()) {
    if (b.next === b.text) continue
    const node = tr.doc.nodeAt(b.pos)
    if (!node) continue
    tr = tr.replaceWith(b.pos + 1, b.pos + node.nodeSize - 1, b.next ? st.schema.text(b.next) : [])
  }
  if (tr.docChanged) e.view.dispatch(tr)
  if (p !== pre) e.setMeta({ ...e.meta, preamble_extras: p })
  e.view.focus()
}

rawLookHooks.letter = () => { void editLetter() }
registerActions({ letter_edit: () => editLetter() })
