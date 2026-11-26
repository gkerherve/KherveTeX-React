// LaTeX kept as written (a letter's \opening and \closing, an exam's
// questions) drawn in the page view as the PDF prints it: the code shows
// only while the caret is in the block, to edit it. Only the commands
// below are drawn; a block with anything else stays as code.
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { DocMeta } from '../core/model.ts'
import { renderMath } from '../math/render.ts'

// ---------------------------------------------------------- small parser

// The {...} argument at `i` (s[i] === '{'): its text and the index after it.
function braced(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '{') depth++
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1]
  }
  return null
}

// The [...] option at `i`, if any.
function bracket(s: string, i: number): [string, number] | null {
  if (s[i] !== '[') return null
  const j = s.indexOf(']', i)
  return j < 0 ? null : [s.slice(i + 1, j), j + 1]
}

// \cmd{arg} anywhere in `s` (the first one).
export function argOf(s: string, cmd: string): string | null {
  const re = new RegExp(`\\\\${cmd}\\s*\\{`)
  const m = re.exec(s)
  if (!m) return null
  return braced(s, m.index + m[0].length - 1)?.[0] ?? null
}

// \setkomavar{name}{value}.
function komavar(s: string, name: string): string | null {
  const re = new RegExp(`\\\\setkomavar\\s*\\{${name}\\}\\s*(?:\\[[^\\]]*\\])?\\s*\\{`)
  const m = re.exec(s)
  return m ? braced(s, m.index + m[0].length - 1)?.[0] ?? null : null
}

// ------------------------------------------------------ text with maths

const SYMBOLS: Record<string, string> = {
  ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '&': '&', '%': '%', '$': '$', '#': '#', '_': '_', '{': '{', '}': '}',
  ldots: '…', dots: '…', textendash: '–', textemdash: '—', enspace: ' ', quad: ' ', qquad: '  ',
  LaTeX: 'LaTeX', TeX: 'TeX', today: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
}
const STYLE: Record<string, string> = { textbf: 'b', emph: 'i', textit: 'i', textsc: 'span', texttt: 'code', underline: 'u', textsf: 'span', textrm: 'span' }

// Inline LaTeX (text, $maths$, \textbf{...}, \\) appended to `el`.
export function inlineInto(el: HTMLElement, s: string, fontPx: number): void {
  let text = ''
  const flush = () => { if (text) { el.append(text.replace(/~/g, ' ').replace(/---/g, '—').replace(/--/g, '–').replace(/``/g, '“').replace(/''/g, '”')); text = '' } }
  for (let i = 0; i < s.length;) {
    const c = s[i]
    if (c === '$') {
      const j = s.indexOf('$', i + 1)
      if (j < 0) { text += s.slice(i); break }
      flush()
      el.appendChild(math(s.slice(i + 1, j), fontPx))
      i = j + 1
      continue
    }
    if (c === '\\') {
      if (s[i + 1] === '\\') { flush(); el.appendChild(document.createElement('br')); i += 2; continue }
      const m = /^\\([A-Za-z]+|.)\s*/.exec(s.slice(i))!
      const name = m[1]
      let at = i + m[0].length
      if (STYLE[name] && s[at] === '{') {
        const b = braced(s, at)
        if (b) {
          flush()
          const span = document.createElement(STYLE[name])
          if (name === 'textsc') span.style.fontVariant = 'small-caps'
          if (name === 'textsf') span.style.fontFamily = 'sans-serif'
          inlineInto(span, b[0], fontPx)
          el.appendChild(span)
          i = b[1]
          continue
        }
      }
      if (name in SYMBOLS) { text += SYMBOLS[name]; i = /^[A-Za-z]/.test(name) ? at : i + 1 + name.length; continue }
      if (name === 'hrulefill') { flush(); const r = document.createElement('span'); r.className = 'kt-rl-fill'; el.appendChild(r); i = at; continue }
      // Anything else: its argument's text, the command dropped.
      if (s[at] === '{') { const b = braced(s, at); if (b) { text += b[0]; i = b[1]; continue } }
      i = at
      continue
    }
    if (c === '{' || c === '}') { i++; continue }
    text += c
    i++
  }
  flush()
}

function math(latex: string, fontPx: number): HTMLElement {
  const span = document.createElement('span')
  span.className = 'kt-math-svg'
  try {
    const r = renderMath(latex, { display: false, fontPx })
    span.innerHTML = r.svg
    const svg = span.firstElementChild as HTMLElement | null
    if (svg) { svg.style.width = `${r.width}px`; svg.style.height = `${r.height}px` }
    span.style.verticalAlign = `${-(r.height - r.baseline)}px`
  } catch { span.textContent = latex }
  return span
}

function div(cls: string, parent?: HTMLElement): HTMLElement {
  const d = document.createElement('div')
  d.className = cls
  parent?.appendChild(d)
  return d
}
function lines(parent: HTMLElement, s: string, fontPx: number, cls = ''): HTMLElement {
  const d = div(cls, parent)
  inlineInto(d, s, fontPx)
  return d
}

// --------------------------------------------------------------- letters

const LETTER_CMDS = /^\\(?:begin\{letter\}|end\{letter\}|opening|closing|encl|cc|ps)(?![A-Za-z])/

function letterLook(text: string, meta: DocMeta, fontPx: number): HTMLElement | null {
  const src = text.trim()
  if (!src.split('\n').every(l => !l.trim() || LETTER_CMDS.test(l.trim()))) return null
  const pre = meta.preamble_extras || ''
  const koma = (meta.documentclass || '').toLowerCase().startsWith('scrlttr')
  const box = div('kt-rl kt-rl-letter')
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const m = /^\s*\\(begin\{letter\}|end\{letter\}|opening|closing|encl|cc|ps)\s*/.exec(rest)
    if (!m) break
    i += m[0].length
    const cmd = m[1]
    if (cmd === 'end{letter}') continue
    const b = braced(src, i)
    if (!b) return null
    i = b[1]
    const arg = b[0]
    if (cmd === 'begin{letter}') {
      if (koma) {
        const name = komavar(pre, 'fromname') ?? ''
        const addr = (komavar(pre, 'fromaddress') ?? '').replace(/\\\\/g, ', ')
        if (name || addr) lines(box, [name, addr].filter(Boolean).join(', '), fontPx * 0.7, 'kt-rl-back')
        lines(box, arg, fontPx, 'kt-rl-to')
        const date = komavar(pre, 'date')
        lines(box, date ?? '\\today', fontPx, 'kt-rl-date')
        const subject = komavar(pre, 'subject')
        if (subject) lines(box, subject, fontPx, 'kt-rl-subject')
      } else {
        const from = argOf(pre, 'address')
        if (from) lines(box, from, fontPx, 'kt-rl-from')
        lines(box, argOf(pre, 'date') ?? '\\today', fontPx, 'kt-rl-from kt-rl-fromdate')
        lines(box, arg, fontPx, 'kt-rl-to')
      }
    } else if (cmd === 'opening') {
      lines(box, arg, fontPx, 'kt-rl-opening')
    } else if (cmd === 'closing') {
      const close = div(koma ? 'kt-rl-closing koma' : 'kt-rl-closing', box)
      lines(close, arg, fontPx)
      const sig = koma ? komavar(pre, 'signature') ?? komavar(pre, 'fromname') : argOf(pre, 'signature')
      if (sig) lines(close, sig, fontPx, 'kt-rl-sig')
    } else if (cmd === 'encl') {
      lines(box, `encl: ${arg}`, fontPx, 'kt-rl-encl')
    } else if (cmd === 'cc') {
      lines(box, `cc: ${arg}`, fontPx, 'kt-rl-encl')
    } else if (cmd === 'ps') {
      lines(box, arg, fontPx, 'kt-rl-encl')
    }
  }
  return box.childElementCount ? box : null
}

// ------------------------------------------------------------------ exams

interface Q { points: number; text: string; parts: { points: number; text: string; solution: string }[]; solution: string; box: string }

// \begin{questions} ... \end{questions}, its questions, parts and solutions.
export function parseQuestions(src: string): Q[] | null {
  const body = /\\begin\{questions\}([\s\S]*)\\end\{questions\}/.exec(src)?.[1]
  if (body === undefined) return null
  const out: Q[] = []
  let q: Q | null = null
  let inParts = false
  let i = 0
  const take = (stop: RegExp): string => {
    const m = stop.exec(body.slice(i))
    const end = m ? i + m.index : body.length
    const t = body.slice(i, end).trim()
    i = end
    return t
  }
  const STOP = /\\question\b|\\part\b|\\begin\{(?:parts|solution)\}|\\end\{parts\}|\\makeemptybox/
  while (i < body.length) {
    const rest = body.slice(i)
    let m: RegExpExecArray | null
    if ((m = /^\s+/.exec(rest))) { i += m[0].length; continue }
    if ((m = /^\\question\b\s*/.exec(rest))) {
      i += m[0].length
      const opt = bracket(body, i)
      if (opt) i = opt[1]
      q = { points: Number(opt?.[0] ?? 0) || 0, text: take(STOP), parts: [], solution: '', box: '' }
      out.push(q)
      continue
    }
    if ((m = /^\\begin\{parts\}/.exec(rest))) { i += m[0].length; inParts = true; continue }
    if ((m = /^\\end\{parts\}/.exec(rest))) { i += m[0].length; inParts = false; continue }
    if ((m = /^\\part\b\s*/.exec(rest))) {
      if (!q || !inParts) return null
      i += m[0].length
      const opt = bracket(body, i)
      if (opt) i = opt[1]
      q.parts.push({ points: Number(opt?.[0] ?? 0) || 0, text: take(STOP), solution: '' })
      continue
    }
    if ((m = /^\\begin\{solution\}(?:\[[^\]]*\])?/.exec(rest))) {
      i += m[0].length
      const end = body.indexOf('\\end{solution}', i)
      if (end < 0 || !q) return null
      const sol = body.slice(i, end).trim()
      i = end + '\\end{solution}'.length
      if (inParts && q.parts.length) q.parts[q.parts.length - 1].solution = sol
      else q.solution = sol
      continue
    }
    if ((m = /^\\makeemptybox\s*/.exec(rest))) {
      i += m[0].length
      const b = braced(body, i)
      if (!b || !q) return null
      i = b[1]
      q.box = b[0]
      continue
    }
    return null
  }
  return out
}

const pts = (n: number) => (n ? `(${n})` : '')

function questionsLook(q: Q[], fontPx: number): HTMLElement {
  const box = div('kt-rl kt-rl-exam')
  q.forEach((x, n) => {
    const row = div('kt-rl-q', box)
    const head = div('kt-rl-qhead', row)
    lines(head, '', fontPx, 'kt-rl-qnum').textContent = `${n + 1}.`
    const qt = lines(head, x.text, fontPx, 'kt-rl-qtext')
    div('kt-rl-pts', head).textContent = pts(x.points)
    if (x.solution) solution(qt, x.solution, fontPx)
    x.parts.forEach((p, k) => {
      const ph = div('kt-rl-qhead kt-rl-part', row)
      div('kt-rl-qnum', ph).textContent = `(${String.fromCharCode(97 + k)})`
      const pt = lines(ph, p.text, fontPx, 'kt-rl-qtext')
      div('kt-rl-pts', ph).textContent = pts(p.points)
      if (p.solution) solution(pt, p.solution, fontPx)
    })
    if (x.box) {
      const e = div('kt-rl-emptybox', row)
      e.style.height = /em$/.test(x.box) ? `${parseFloat(x.box) * fontPx}px` : x.box
    }
  })
  return box
}

// A solution: the PDF prints none (only with \\printanswers), so a small
// tag at the end of the question, its working shown on hover; the page
// keeps the PDF's height.
function solution(parent: HTMLElement, s: string, fontPx: number): void {
  const tag = document.createElement('span')
  tag.className = 'kt-rl-soltag'
  tag.textContent = 'solution'
  const pop = div('kt-rl-solution', tag)
  const head = document.createElement('span')
  head.className = 'kt-rl-solhead'
  head.textContent = 'Solution - not printed (the exam class prints it with \\printanswers)'
  pop.appendChild(head)
  inlineInto(pop, s, fontPx)
  parent.append(' ', tag)
}

// The cover block above the questions: a framed note, a name line, the
// table of marks.
function examFrontLook(src: string, doc: PMNode, fontPx: number): HTMLElement | null {
  const known = /\\(?:begin|end)\{center\}|\\fbox|\\parbox|\\centering|\\vspace|\\makebox|\\enspace|\\hrulefill|\\gradetable|\\textwidth|\\mathrm|\\,|\\\\|\\(?:begin|end)\{flushleft\}/g
  const unknown = src.replace(known, '').match(/\\[A-Za-z]+/g)?.filter(c => !['\\textbf', '\\emph', '\\textit', '\\sqrt', '\\Omega'].includes(c))
  if (unknown?.length || !/\\gradetable|\\fbox|\\makebox/.test(src)) return null
  const box = div('kt-rl kt-rl-examfront')
  const fb = /\\fbox\{\\fbox\{\\parbox\{[^}]*\}\{/.exec(src) ?? /\\fbox\{\\parbox\{[^}]*\}\{/.exec(src)
  if (fb) {
    const arg = braced(src, fb.index + fb[0].length - 1)?.[0] ?? ''
    const frame = div('kt-rl-frame' + (fb[0].startsWith('\\fbox{\\fbox') ? ' double' : ''), box)
    lines(frame, arg.replace(/^\s*\\centering\s*/, ''), fontPx)
  }
  const mk = /\\makebox\[[^\]]*\]\{/.exec(src)
  if (mk) lines(box, braced(src, mk.index + mk[0].length - 1)?.[0] ?? '', fontPx, 'kt-rl-nameline')
  if (/\\gradetable/.test(src)) {
    // The questions in the document, for the table.
    let qs: Q[] = []
    doc.forEach(n => { if (n.type.name === 'raw_latex') { const p = parseQuestions(n.textContent); if (p) qs = qs.concat(p) } })
    if (qs.length) {
      const t = document.createElement('table')
      t.className = 'kt-rl-grades'
      const row = (label: string, cells: string[]) => {
        const tr = document.createElement('tr')
        for (const c of [label, ...cells]) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td) }
        t.appendChild(tr)
      }
      const p = qs.map(x => x.points + x.parts.reduce((a, b) => a + b.points, 0))
      row('Question:', [...qs.map((_, k) => String(k + 1)), 'Total'])
      row('Points:', [...p.map(String), String(p.reduce((a, b) => a + b, 0))])
      row('Score:', qs.map(() => '').concat(''))
      box.appendChild(t)
    }
  }
  return box
}

// --------------------------------------------------------------- plugin

export function rawLookOf(node: PMNode, doc: PMNode, meta: DocMeta | null, fontPx: number): HTMLElement | null {
  const text = node.textContent
  if (!meta) return null
  const cls = (meta.documentclass || '').toLowerCase()
  if (cls === 'letter' || cls.startsWith('scrlttr')) return letterLook(text, meta, fontPx)
  if (cls === 'exam') {
    const q = parseQuestions(text)
    if (q && /^\s*\\begin\{questions\}/.test(text) && /\\end\{questions\}\s*$/.test(text)) return questionsLook(q, fontPx)
    return examFrontLook(text, doc, fontPx)
  }
  return null
}

interface LookState { decos: DecorationSet; editing: boolean }
const rawLookKey = new PluginKey<LookState>('kt-raw-look')

// `meta`: the document's settings (the letter's sender, its class).
export function rawLookPlugin(meta: (state: EditorState) => DocMeta | null, fontPx: () => number): Plugin {
  const build = (state: EditorState, editing: boolean): DecorationSet => {
    const m = meta(state)
    const cls = (m?.documentclass || '').toLowerCase()
    if (!m || !(cls === 'letter' || cls.startsWith('scrlttr') || cls === 'exam')) return DecorationSet.empty
    const decos: Decoration[] = []
    const { from, to } = state.selection
    state.doc.forEach((node, pos) => {
      if (node.type.name !== 'raw_latex') return
      // Being edited (the caret moved or clicked into it): the code. A
      // document just opened, its caret at the start, keeps the drawing.
      if (editing && from <= pos + node.nodeSize - 1 && to >= pos + 1) return
      const px = fontPx()
      const look = rawLookOf(node, state.doc, m, px)
      if (!look) return
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'kt-raw-widget kt-raw-looked' }))
      decos.push(Decoration.widget(pos + node.nodeSize, (view: EditorView) => {
        const el = rawLookOf(node, view.state.doc, m, px) ?? look
        el.classList.add('kt-widget')
        el.contentEditable = 'false'
        el.title = 'Click to edit its LaTeX'
        el.addEventListener('mousedown', e => {
          e.preventDefault()
          const at = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size))
          view.dispatch(view.state.tr.setSelection(TextSelection.near(at)))
          view.focus()
        })
        return el
      }, { side: -1, ignoreSelection: true, key: `rl:${pos}:${node.textContent.length}:${cls}:${px}:${node.textContent.slice(0, 40)}` }))
    })
    return DecorationSet.create(state.doc, decos)
  }
  let lastMeta: DocMeta | null = null
  let lastPx = 0
  return new Plugin<LookState>({
    key: rawLookKey,
    state: {
      init: (_c, s) => { lastMeta = meta(s); lastPx = fontPx(); return { decos: build(s, false), editing: false } },
      apply: (tr, prev, _old, s) => {
        // The class, the sender or the type size changed: drawn again.
        const changed = meta(s) !== lastMeta || fontPx() !== lastPx
        lastMeta = meta(s)
        lastPx = fontPx()
        const editing = tr.selectionSet ? true : prev.editing
        return tr.docChanged || tr.selectionSet || changed ? { decos: build(s, editing), editing } : prev
      },
    },
    props: { decorations: s => rawLookKey.getState(s)?.decos },
  })
}
