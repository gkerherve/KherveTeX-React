// Every icon is drawn here, in code, as inline SVG: a port of
// khervedoc/icons.py, call for call. The Word-style icons use the same
// 24-unit canvas as the Qt `_W` painter, so a 32 px ribbon button scales
// it exactly as QPainter did. Colours are CSS variables so a dark theme
// only has to redefine them.
import type { ReactElement, ReactNode } from 'react'

export interface IconProps {
  size?: number
  width?: number
  height?: number
  // The one parameter of icons drawn from data: a table style, a class...
  arg?: string
}

const INK = 'var(--icon-ink)'
const BLUE = 'var(--icon-blue)'
const PAPER = 'var(--icon-paper)'
const TINT = 'var(--icon-tint)'
// The older, pre-Fluent palette (equation builder and paint tools).
const FG = 'var(--icon-fg)'
const ACCENT = 'var(--icon-accent)'
const ACCENT2 = 'var(--icon-accent2)'
const GREEN = '#107c10'
const RED = '#c42b1c'
const OVERLEAF_GREEN = '#138a36'
const SANS = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
const SERIF = 'Georgia, serif'

type Pt = [number, number]

function Svg({ size = 24, width, height, view = 24, viewH, children }: {
  size?: number, width?: number, height?: number, view?: number,
  viewH?: number, children: ReactNode
}) {
  const w = width ?? size
  const h = height ?? size
  return (
    <svg className='kicon' width={w} height={h}
      viewBox={`0 0 ${view} ${viewH ?? view}`} aria-hidden='true'
      strokeLinecap='round' strokeLinejoin='round'>
      {children}
    </svg>
  )
}

function L(x1: number, y1: number, x2: number, y2: number, color = INK,
  w = 1.5, dash?: string): ReactElement {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color}
    strokeWidth={w} strokeDasharray={dash}
    strokeLinecap={dash ? 'butt' : 'round'} />
}

function R(x: number, y: number, w: number, h: number, o: {
  color?: string, fill?: string, r?: number, lw?: number, dash?: string
} = {}): ReactElement {
  const r = o.r ?? 1.5
  return <rect x={x} y={y} width={w} height={h} rx={r} ry={r}
    stroke={o.color ?? INK} strokeWidth={o.lw ?? 1.5}
    fill={o.fill ?? 'none'} strokeDasharray={o.dash} />
}

function F(x: number, y: number, w: number, h: number, color: string) {
  return <rect x={x} y={y} width={w} height={h} fill={color} />
}

function P(pts: Pt[], o: {
  color?: string, fill?: string, lw?: number, closed?: boolean
} = {}): ReactElement {
  const d = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const stroke = o.color ?? INK
  const sw = o.lw ?? 1.5
  return o.closed === false
    ? <polyline points={d} stroke={stroke} strokeWidth={sw} fill='none' />
    : <polygon points={d} stroke={stroke} strokeWidth={sw}
      fill={o.fill ?? 'none'} />
}

function D(x: number, y: number, r = 1.4, color = INK) {
  return <circle cx={x} cy={y} r={r} fill={color} />
}

function C(x: number, y: number, r: number, color = INK, w = 1.5,
  fill = 'none') {
  return <circle cx={x} cy={y} r={r} stroke={color} strokeWidth={w}
    fill={fill} />
}

// QPainter.drawText(rect, AlignCenter, s): the line box centred in rect.
function T(rect: [number, number, number, number], s: string, o: {
  size?: number, bold?: boolean, italic?: boolean, color?: string,
  family?: string, align?: 'center' | 'left'
} = {}): ReactElement {
  const [x, y, w, h] = rect
  const left = o.align === 'left'
  return (
    <text x={left ? x : x + w / 2} y={y + h / 2}
      textAnchor={left ? 'start' : 'middle'} dominantBaseline='central'
      fontFamily={o.family ?? SANS} fontSize={o.size ?? 15}
      fontWeight={o.bold ? 700 : 400}
      fontStyle={o.italic ? 'italic' : 'normal'} fill={o.color ?? INK}
      stroke='none'>{s}</text>
  )
}

// _W.page: a document sheet with a folded corner.
function Page(x = 5, y = 2.5, w = 14, h = 19, fold = 4): ReactElement {
  return (
    <g>
      {P([[x, y], [x + w - fold, y], [x + w, y + fold], [x + w, y + h],
        [x, y + h]], { fill: PAPER })}
      {P([[x + w - fold, y], [x + w - fold, y + fold], [x + w, y + fold]],
        { closed: false })}
    </g>
  )
}

// QPainter.drawArc: angles in degrees, counter-clockwise from 3 o'clock.
function arcPath(cx: number, cy: number, rx: number, ry: number,
  start: number, span: number): string {
  const rad = (a: number) => a * Math.PI / 180
  const x1 = cx + rx * Math.cos(rad(start))
  const y1 = cy - ry * Math.sin(rad(start))
  const x2 = cx + rx * Math.cos(rad(start + span))
  const y2 = cy - ry * Math.sin(rad(start + span))
  const large = Math.abs(span) > 180 ? 1 : 0
  const sweep = span > 0 ? 0 : 1
  return `M${x1},${y1} A${rx},${ry} 0 ${large} ${sweep} ${x2},${y2}`
}

function Arc(cx: number, cy: number, r: number, start: number, span: number,
  color: string, w: number) {
  return <path d={arcPath(cx, cy, r, r, start, span)} stroke={color}
    strokeWidth={w} fill='none' />
}

// ----- file -----

export function FileNew(p: IconProps) {
  return <Svg {...p}>{Page()}{L(16, 15, 16, 21, BLUE, 1.8)}
    {L(13, 18, 19, 18, BLUE, 1.8)}</Svg>
}

export function FileOpen(p: IconProps) {
  return <Svg {...p}>
    {P([[2.5, 6], [8.5, 6], [10.5, 8], [20, 8], [20, 19.5], [2.5, 19.5]],
      { fill: 'var(--icon-folder)' })}
    {P([[2.5, 19.5], [5.5, 11.5], [22, 11.5], [19.5, 19.5]],
      { fill: 'var(--icon-folder-front)' })}
  </Svg>
}

export function FileSave(p: IconProps) {
  return <Svg {...p}>
    {P([[3.5, 3.5], [17, 3.5], [20.5, 7], [20.5, 20.5], [3.5, 20.5]],
      { fill: BLUE, color: BLUE })}
    {F(7, 4.5, 9, 5.5, PAPER)}
    {F(13, 5.3, 1.8, 3.6, BLUE)}
    {R(6.5, 13, 11, 7, { color: PAPER, fill: PAPER, r: 0.6, lw: 0.8 })}
  </Svg>
}

export function ExportPdf(p: IconProps) {
  return <Svg {...p}>{Page(4, 2.5, 14, 19)}
    {R(9, 11, 13, 8, { color: '#c43e1c', fill: '#c43e1c', r: 1.2, lw: 1 })}
    {T([9, 11, 13, 8], 'PDF', { size: 6.5, bold: true, color: 'white' })}
  </Svg>
}

// A page with Word's blue "W" tab: export to .docx.
export function ExportDocx(p: IconProps) {
  return <Svg {...p}>{Page(4, 2.5, 14, 19)}
    {R(9, 11, 13, 8, { color: '#2b579a', fill: '#2b579a', r: 1.2, lw: 1 })}
    {T([9, 11, 13, 8], 'W', { size: 7, bold: true, color: 'white' })}
  </Svg>
}

function printerParts() {
  return <g>
    {R(6.5, 3, 11, 6, { fill: PAPER })}
    {R(2.5, 8.5, 19, 9, { fill: TINT })}
    {R(6.5, 14, 11, 7, { fill: PAPER })}
    {L(8.5, 17, 15.5, 17, INK, 1)}{L(8.5, 19, 13.5, 19, INK, 1)}
    {D(18.3, 11.3, 0.9, BLUE)}
  </g>
}

export function Printer(p: IconProps) {
  return <Svg {...p}>{printerParts()}</Svg>
}

export function PrintPreview(p: IconProps) {
  return <Svg {...p}>{Page(3, 2.5, 13, 18)}{C(15, 15, 4, BLUE, 1.6, PAPER)}
    {L(18, 18, 21.5, 21.5, BLUE, 2)}</Svg>
}

export function ProjectOpen(p: IconProps) {
  return <Svg {...p}>{Page(8, 2.5, 12, 15, 3)}{Page(4, 6, 12, 15.5, 3)}
    {[12, 14.5, 17].map(y => <g key={y}>{L(6.5, y, 13, y, BLUE, 1)}</g>)}
  </Svg>
}

function UndoArrow({ mirror, ...p }: IconProps & { mirror: boolean }) {
  const x = (v: number) => mirror ? 24 - v : v
  return <Svg {...p}>
    <path d={`M${x(9)},9.5 L${x(13)},9.5 C${x(21.5)},9.5 ${x(21.5)},20 `
      + `${x(13)},20 L${x(10)},20`} stroke={BLUE} strokeWidth={2}
      fill='none' />
    {P([[x(9.5), 4], [x(3.5), 9.5], [x(9.5), 15]],
      { color: BLUE, fill: BLUE, lw: 1 })}
  </Svg>
}

export function Undo(p: IconProps) { return <UndoArrow {...p} mirror={false} /> }
export function Redo(p: IconProps) { return <UndoArrow {...p} mirror /> }

// ----- font group: Office draws letters in a plain sans -----

function Letter({ s, fs = 19, bold, italic, family, ...p }: IconProps & {
  s: string, fs?: number, bold?: boolean, italic?: boolean, family?: string
}) {
  return <Svg {...p}>{T([0, 0, 24, 23], s, { size: fs, bold, italic, family })}
  </Svg>
}

export function Bold(p: IconProps) { return <Letter {...p} s='B' bold /> }
export function Italic(p: IconProps) { return <Letter {...p} s='I' italic /> }

export function Underline(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 24, 20], 'U', { size: 18 })}
    {L(5.5, 21, 18.5, 21, INK, 1.6)}</Svg>
}

export function Strike(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 24, 24], 'ab', { size: 17 })}
    {L(2.5, 13, 21.5, 13, INK, 1.4)}</Svg>
}

export function Subscript(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 17, 22], 'x', { size: 19 })}
    {T([13, 11, 10, 13], '2', { size: 11, bold: true, color: BLUE })}</Svg>
}

export function Superscript(p: IconProps) {
  return <Svg {...p}>{T([0, 2, 17, 22], 'x', { size: 19 })}
    {T([13, 0, 10, 13], '2', { size: 11, bold: true, color: BLUE })}</Svg>
}

export function Smallcaps(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 15, 23], 'A', { size: 18 })}
    {T([12, 4, 12, 19], 'A', { size: 12 })}</Svg>
}

export function Code(p: IconProps) {
  return <Svg {...p}>
    {P([[8.5, 6], [3.5, 12], [8.5, 18]], { closed: false, lw: 1.6 })}
    {P([[15.5, 6], [20.5, 12], [15.5, 18]], { closed: false, lw: 1.6 })}
    {L(13.3, 5, 10.7, 19, BLUE, 1.6)}
  </Svg>
}

export function Highlight(p: IconProps) {
  const yellow = '#ffe600'
  return <Svg {...p}>
    {P([[15, 2.5], [20, 7.5], [11.5, 16], [6.5, 11]], { fill: PAPER, lw: 1.3 })}
    {P([[6.5, 11], [11.5, 16], [9, 17.5], [5, 13.5]], { fill: INK, lw: 1 })}
    {P([[5, 13.5], [9, 17.5], [3.5, 17.5]],
      { color: yellow, fill: yellow, lw: 0.5 })}
    {F(2.5, 19.5, 19, 3, yellow)}
  </Svg>
}

// ----- paragraph group -----

export function BulletList(p: IconProps) {
  return <Svg {...p}>{[6, 12, 18].map(y => <g key={y}>
    {D(4.5, y, 1.8, BLUE)}{L(9, y, 21, y, INK, 1.4)}</g>)}</Svg>
}

export function NumberedList(p: IconProps) {
  return <Svg {...p}>{[5.5, 12, 18.5].map((y, k) => <g key={y}>
    {T([0, y - 5, 8, 10], String(k + 1), { size: 8, bold: true, color: BLUE })}
    {L(9, y, 21, y, INK, 1.4)}</g>)}</Svg>
}

function Align({ widths, ...p }: IconProps & { widths: Pt[] }) {
  return <Svg {...p}>{widths.map(([x1, x2], k) => <g key={k}>
    {L(x1, 5 + k * 4.6, x2, 5 + k * 4.6, INK, 1.4)}</g>)}</Svg>
}

export function AlignLeft(p: IconProps) {
  return <Align {...p} widths={[[3, 21], [3, 14], [3, 21], [3, 12]]} />
}
export function AlignCenter(p: IconProps) {
  return <Align {...p} widths={[[3, 21], [7, 17], [3, 21], [8, 16]]} />
}
export function AlignRight(p: IconProps) {
  return <Align {...p} widths={[[3, 21], [10, 21], [3, 21], [12, 21]]} />
}
export function AlignJustify(p: IconProps) {
  return <Align {...p} widths={[[3, 21], [3, 21], [3, 21], [3, 21]]} />
}

export function FormattingMarks(p: IconProps) {
  return <Letter {...p} s='¶' />
}

export function GalleryMore(p: IconProps) {
  return <Svg {...p}>{P([[5, 9], [12, 16], [19, 9]], { closed: false, lw: 2 })}
  </Svg>
}

export function SpellCheck(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 24, 15], 'ABC', { size: 8.5, bold: true })}
    {P([[5, 16.5], [9.5, 20.5], [19, 11.5]],
      { color: BLUE, closed: false, lw: 2 })}</Svg>
}

// The Spelling panel: a word underlined in red, then the list of the
// others.
export function SpellingList(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 24, 12], 'abc', { size: 8, bold: true })}
    {P([[4, 13.5], [6, 12], [8, 13.5], [10, 12], [12, 13.5], [14, 12], [16, 13.5], [18, 12], [20, 13.5]],
      { color: '#d8000c', closed: false, lw: 1.2 })}
    {L(4, 17, 20, 17, BLUE, 1.4)}{L(4, 20.5, 15, 20.5, BLUE, 1.4)}</Svg>
}

// ----- review -----

export function Comment(p: IconProps) {
  return <Svg {...p}>
    {P([[3, 4], [21, 4], [21, 16], [11, 16], [6.5, 20.5], [6.5, 16], [3, 16]],
      { fill: PAPER })}
    {L(6.5, 8.5, 17.5, 8.5, BLUE, 1.2)}{L(6.5, 11.8, 14, 11.8, BLUE, 1.2)}
  </Svg>
}

export function AcceptChange(p: IconProps) {
  return <Svg {...p}>{P([[4.5, 12.5], [9.5, 17.5], [19.5, 6.5]],
    { closed: false, color: GREEN, lw: 2.4 })}</Svg>
}

export function RejectChange(p: IconProps) {
  return <Svg {...p}>{L(6, 6, 18, 18, RED, 2.4)}{L(18, 6, 6, 18, RED, 2.4)}
  </Svg>
}

export function PrevComment(p: IconProps) {
  return <Svg {...p}>
    {P([[5, 4], [19, 4], [19, 13], [5, 13]], { fill: PAPER, lw: 1.2 })}
    {P([[7, 21], [12, 16], [17, 21]], { color: BLUE, closed: false, lw: 1.8 })}
  </Svg>
}

export function NextComment(p: IconProps) {
  return <Svg {...p}>
    {P([[5, 11], [19, 11], [19, 20], [5, 20]], { fill: PAPER, lw: 1.2 })}
    {P([[7, 3], [12, 8], [17, 3]], { color: BLUE, closed: false, lw: 1.8 })}
  </Svg>
}

export function History(p: IconProps) {
  return <Svg {...p}>{C(12.5, 12.5, 8.5, INK, 1.5, PAPER)}
    {L(12.5, 7.5, 12.5, 12.5, BLUE, 1.7)}{L(12.5, 12.5, 16, 14.5, BLUE, 1.7)}
  </Svg>
}

function Cloud({ up, arrow, ...p }: IconProps & { up: boolean, arrow: string }) {
  const [tip, back] = up ? [11.5, 14.5] : [20.5, 17.5]
  return <Svg {...p}>
    <path d='M6.5,18.5 C1.5,18.5 1.5,11 6.5,11 C7.5,5 16.5,5 17.5,10
      C22.5,10 22.5,18.5 17.5,18.5 Z' stroke={INK} strokeWidth={1.5}
      fill={PAPER} />
    {L(12, 20.5, 12, 11.5, arrow, 1.8)}
    {P([[9, back], [12, tip], [15, back]],
      { color: arrow, closed: false, lw: 1.8 })}
  </Svg>
}

export function Commit(p: IconProps) { return <Cloud {...p} up arrow={BLUE} /> }
export function OverleafSend(p: IconProps) {
  return <Cloud {...p} up arrow={OVERLEAF_GREEN} />
}
export function OverleafGet(p: IconProps) {
  return <Cloud {...p} up={false} arrow={OVERLEAF_GREEN} />
}

export function OverleafZip(p: IconProps) {
  return <Svg {...p}>{Page(4, 2.5, 14, 19)}
    {[5, 8, 11, 14].map(y => <g key={y}>{L(11, y, 13, y, INK, 1.4)}</g>)}
    {L(19, 9, 19, 20, OVERLEAF_GREEN, 1.8)}
    {P([[16, 17], [19, 20], [22, 17]],
      { color: OVERLEAF_GREEN, closed: false, lw: 1.8 })}
  </Svg>
}

export function Branch(p: IconProps) {
  return <Svg {...p}>{L(7, 5, 7, 19)}
    <path d='M17,8 C17,14 7,12 7,17' stroke={INK} strokeWidth={1.5}
      fill='none' />
    {([[7, 5], [7, 19], [17, 7]] as Pt[]).map(([x, y]) =>
      <g key={`${x}-${y}`}>{C(x, y, 2.2, BLUE, 1.5, PAPER)}</g>)}
  </Svg>
}

// References ▸ Style: how references print — "[1]" and an author–year line.
export function ReferenceStyle(p: IconProps) {
  return <Svg {...p}>
    {R(3, 3, 18, 18, { fill: PAPER, color: BLUE, r: 1.5, lw: 1.2 })}
    {T([4, 4, 9, 7], '[1]', { size: 6.5, bold: true, color: BLUE })}
    {L(13, 7.5, 19, 7.5, INK, 1.1)}
    {T([4, 11, 9, 7], 'Aa', { size: 6.5, bold: true, color: INK })}
    {L(13, 14.5, 19, 14.5, INK, 1.1)}{L(6, 18.5, 19, 18.5, INK, 1.1)}
  </Svg>
}

// References ▸ Captions & labels: numbered items with a caption line each.
export function Captions(p: IconProps) {
  return <Svg {...p}>
    {R(3, 3, 7, 5, { fill: TINT, color: BLUE, r: 0.8, lw: 1.1 })}{L(12, 4.5, 21, 4.5, INK, 1.1)}{L(12, 7, 18, 7, BLUE, 1)}
    {R(3, 10, 7, 5, { fill: TINT, color: BLUE, r: 0.8, lw: 1.1 })}{L(12, 11.5, 21, 11.5, INK, 1.1)}{L(12, 14, 18, 14, BLUE, 1)}
    {R(3, 17, 7, 5, { fill: TINT, color: BLUE, r: 0.8, lw: 1.1 })}{L(12, 18.5, 21, 18.5, INK, 1.1)}{L(12, 21, 18, 21, BLUE, 1)}
  </Svg>
}

// File ▸ Share ▸ GitHub: a cloud with a branch in it.
export function GitHub(p: IconProps) {
  return <Svg {...p}>
    <path d='M6.5,18.5 C3.5,18.5 2,16.6 2,14.6 C2,12.4 3.8,10.8 5.9,10.9 C6.4,7.9 8.9,5.5 12,5.5 C15.3,5.5 17.8,8 18,11 C20.3,11.1 22,12.8 22,14.8 C22,16.9 20.4,18.5 18.2,18.5 Z'
      stroke={BLUE} strokeWidth={1.4} fill={TINT} />
    {L(10, 10, 10, 16, INK, 1.2)}
    <path d='M14.5,11 C14.5,13.5 10,12.8 10,15' stroke={INK} strokeWidth={1.2} fill='none' />
    {C(10, 10, 1.3, INK, 1, PAPER)}{C(10, 16, 1.3, INK, 1, PAPER)}{C(14.5, 10.6, 1.3, INK, 1, PAPER)}
  </Svg>
}

// ----- compile -----

export function CompilePdf(p: IconProps) {
  return <Svg {...p}>{Page(3, 2.5, 13, 18)}
    {P([[13, 11], [21.5, 16], [13, 21]], { color: GREEN, fill: GREEN, lw: 1 })}
  </Svg>
}

export function AutoCompileOn(p: IconProps) {
  return <Svg {...p}>{Arc(12, 12, 8, 60, 290, GREEN, 1.8)}
    {P([[16, 2.5], [19.5, 6], [15, 8]], { color: GREEN, fill: GREEN, lw: 1 })}
    {D(12, 12, 2, GREEN)}</Svg>
}

export function AutoCompileOff(p: IconProps) {
  return <Svg {...p}>{Arc(12, 12, 8, 60, 290, INK, 1.8)}
    {L(4, 20, 20, 4, RED, 1.8)}</Svg>
}

function pictureParts() {
  return <g>
    {R(3, 4.5, 18, 15, { fill: PAPER })}
    {P([[4.5, 18], [10, 11], [14, 15.5], [16.5, 13], [19.5, 18]],
      { color: BLUE, fill: TINT, lw: 1.2 })}
    {D(16, 8.5, 1.8, '#f2b01e')}
  </g>
}

export function CompileNoImages(p: IconProps) {
  return <Svg {...p}>{pictureParts()}{L(3, 21, 21, 3, RED, 1.8)}</Svg>
}

export function CompileRange(p: IconProps) {
  return <Svg {...p}>{Page(5, 2.5, 14, 19)}{F(6, 8, 12, 7, TINT)}
    {L(3, 8, 21, 8, BLUE, 1.4)}{L(3, 15, 21, 15, BLUE, 1.4)}</Svg>
}

// ----- insert -----

export function Figure(p: IconProps) {
  return <Svg {...p}>{pictureParts()}</Svg>
}

export function Table(p: IconProps) {
  return <Svg {...p}>
    {R(3, 4, 18, 16, { fill: PAPER, r: 1 })}
    {F(3.8, 4.8, 16.4, 4, TINT)}
    {L(3, 9, 21, 9, INK, 1)}{L(3, 14.5, 21, 14.5, INK, 1)}
    {L(9, 4, 9, 20, INK, 1)}{L(15, 4, 15, 20, INK, 1)}
  </Svg>
}

export function Drawing(p: IconProps) {
  return <Svg {...p}>
    <ellipse cx={7.5} cy={7.5} rx={4.5} ry={4.5} stroke={BLUE}
      strokeWidth={1.5} fill={TINT} />
    {R(11, 11, 10, 9, { color: INK, fill: PAPER, r: 0.8 })}
    {P([[5, 21], [9, 14], [13, 21]], { color: INK, fill: PAPER })}
  </Svg>
}

export function FlowchartBuilder(p: IconProps) {
  return <Svg {...p}>
    {R(7, 2.5, 10, 5, { fill: TINT, color: BLUE, r: 1 })}
    {L(12, 7.5, 12, 10.5, INK, 1.2)}
    {P([[12, 10.5], [16.5, 13.5], [12, 16.5], [7.5, 13.5]], { fill: PAPER })}
    {L(12, 16.5, 12, 18.5, INK, 1.2)}
    {R(7, 18.5, 10, 3.5, { fill: TINT, color: BLUE, r: 1 })}
  </Svg>
}

export function Link(p: IconProps) {
  return <Svg {...p}>
    {R(2.5, 8.5, 11, 7, { color: BLUE, r: 3.5, lw: 1.8 })}
    {R(10.5, 8.5, 11, 7, { color: INK, r: 3.5, lw: 1.8 })}
  </Svg>
}

export function Footnote(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 17, 15], 'ab', { size: 11 })}
    {T([14, 0, 9, 9], '1', { size: 7.5, bold: true, color: BLUE })}
    {L(3, 17, 11, 17, INK, 1)}{L(3, 20.5, 20, 20.5, BLUE, 1.2)}</Svg>
}

// Review ▸ Your name: a person with a name tag.
export function YourName(p: IconProps) {
  return <Svg {...p}>
    {C(9, 7, 3.5, INK, 1.4, TINT)}
    <path d='M2.5,20 C2.5,14.5 15.5,14.5 15.5,20 Z' stroke={INK} strokeWidth={1.4} fill={TINT} />
    {R(13, 11, 9, 6, { fill: PAPER, color: BLUE, r: 1, lw: 1.3 })}
    {L(15, 14, 20, 14, BLUE, 1.2)}
  </Svg>
}

// Help ▸ Buy me a coffee: a take-away cup with steam.
export function Coffee(p: IconProps) {
  return <Svg {...p}>
    <path d='M6,9 L18,9 L16.5,21 L7.5,21 Z' stroke={INK} strokeWidth={1.4} fill='#ffdd00' />
    {R(5, 6.5, 14, 2.5, { fill: PAPER, color: INK, r: 1, lw: 1.3 })}
    <path d='M9.5,5 C8.5,3.8 10.5,3 9.5,1.5 M13.5,5 C12.5,3.8 14.5,3 13.5,1.5' stroke={INK} strokeWidth={1} fill='none' />
    {L(7.8, 13, 16.2, 13, INK, 1)}{L(7.5, 16.5, 16.5, 16.5, INK, 1)}
  </Svg>
}

// References ▸ Insert citation: a line of text with a blue citation
// mark "[1]" being put in at the caret, and a green plus.
export function Citation(p: IconProps) {
  return <Svg {...p}>
    {L(2.5, 6, 13, 6, INK, 1.3)}{L(2.5, 10, 9, 10, INK, 1.3)}
    {L(2.5, 18.5, 21, 18.5, INK, 1.3)}
    {L(10.5, 7.5, 10.5, 13, BLUE, 1.4)}
    {R(11.5, 8.5, 10, 7, { fill: TINT, color: BLUE, r: 1.5, lw: 1.3 })}
    {T([11.5, 8.5, 10, 7], '[1]', { size: 5.8, bold: true, color: BLUE })}
    {L(18.5, 1.5, 18.5, 6.5, GREEN, 1.8)}{L(16, 4, 21, 4, GREEN, 1.8)}
  </Svg>
}

// References ▸ Reference library: the document's references as books on
// a shelf, the books a reference manager keeps.
export function ManageReferences(p: IconProps) {
  return <Svg {...p}>
    {R(3, 5, 4, 15, { fill: BLUE, color: BLUE, r: 0.6, lw: 1 })}
    {L(3.8, 8, 6.2, 8, PAPER, 1)}{L(3.8, 16.5, 6.2, 16.5, PAPER, 1)}
    {R(8, 3, 4.5, 17, { fill: TINT, color: BLUE, r: 0.6, lw: 1.2 })}
    {L(9, 6.5, 11.5, 6.5, BLUE, 1)}
    {R(13.5, 7, 3.5, 13, { fill: '#c97b1a', color: '#9a5c12', r: 0.6, lw: 1 })}
    <g transform='rotate(-16 19.5 20)'>
      {R(17.6, 6.5, 3.8, 13.5, { fill: GREEN, color: '#0b5a0b', r: 0.6, lw: 1 })}
    </g>
    {L(1.5, 21, 22.5, 21, INK, 1.6)}
  </Svg>
}

// References ▸ From Zotero: a red tile with a Z.
export function RefsZotero(p: IconProps) {
  return <Svg {...p}>
    {R(3, 3, 18, 18, { fill: '#cc2936', color: '#a01f2a', r: 3, lw: 1 })}
    {P([[7.5, 7.5], [16.5, 7.5], [7.5, 16.5], [16.5, 16.5]], { color: '#ffffff', closed: false, lw: 2.2 })}
  </Svg>
}

// References ▸ From EndNote: a page marked EN, with an arrow in.
export function RefsEndNote(p: IconProps) {
  return <Svg {...p}>
    {R(5, 2.5, 14, 19, { fill: PAPER, color: INK, r: 1, lw: 1.3 })}
    {R(5, 2.5, 14, 7.5, { fill: '#1f3864', color: '#1f3864', r: 1, lw: 1 })}
    {T([5, 2.5, 14, 7.5], 'EN', { size: 6, bold: true, color: '#ffffff' })}
    {L(8, 13.5, 16, 13.5, INK, 1)}{L(8, 16.5, 16, 16.5, INK, 1)}{L(8, 19, 13, 19, INK, 1)}
  </Svg>
}

// References ▸ Import file: a page with a green arrow coming in.
export function RefsImport(p: IconProps) {
  return <Svg {...p}>{Page(3, 2.5, 13, 19)}
    {L(6, 10, 12, 10, INK, 1)}{L(6, 13, 12, 13, INK, 1)}{L(6, 16, 10, 16, INK, 1)}
    {L(21.5, 8, 21.5, 17, GREEN, 1.8)}
    {P([[18.5, 14], [21.5, 17], [24, 14]], { color: GREEN, closed: false, lw: 1.8 })}
  </Svg>
}

// References ▸ Bibliography: a page of numbered entries.
export function Bibliography(p: IconProps) {
  return <Svg {...p}>
    {R(4, 2.5, 16, 19, { fill: PAPER, r: 1 })}
    {T([5, 4, 5, 5], '[1]', { size: 4.5, bold: true, color: BLUE })}
    {L(10.5, 6.5, 18, 6.5, INK, 1)}
    {L(10.5, 8.8, 16, 8.8, INK, 1)}
    {T([5, 11, 5, 5], '[2]', { size: 4.5, bold: true, color: BLUE })}
    {L(10.5, 13.5, 18, 13.5, INK, 1)}
    {L(10.5, 15.8, 15, 15.8, INK, 1)}
  </Svg>
}

export function CrossRef(p: IconProps) {
  return <Svg {...p}>
    {P([[6, 3], [18, 3], [18, 21], [12, 16.5], [6, 21]],
      { fill: TINT, color: BLUE })}
    {L(9, 8, 15, 8, INK, 1)}
  </Svg>
}

export function MathInline(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 24, 22], 'π',
    { size: 17, color: BLUE, family: SERIF })}</Svg>
}

export function MathBlock(p: IconProps) {
  return <Svg {...p}>{R(2.5, 4.5, 19, 15, { fill: PAPER })}
    {T([2.5, 4.5, 19, 14], 'π', { size: 13, color: BLUE, family: SERIF })}</Svg>
}

export function Symbol(p: IconProps) {
  return <Letter {...p} s='Ω' fs={17} family={SERIF} />
}

export function EquationBuilder(p: IconProps) {
  return <Svg {...p}>
    {T([1, 0, 22, 13], 'x', { size: 10, italic: true, family: SERIF, color: BLUE })}
    {L(5, 12, 19, 12, INK, 1.3)}
    {T([1, 12, 22, 12], 'y', { size: 10, italic: true, family: SERIF, color: BLUE })}
    {R(2, 2, 20, 20, { color: INK, r: 2, lw: 1 })}
  </Svg>
}

export function Chemistry(p: IconProps) {
  return <Svg {...p}>
    {P([[9, 3], [15, 3]], { closed: false })}
    {P([[10, 3], [10, 9], [4.5, 19.5], [5.5, 21], [18.5, 21], [19.5, 19.5],
      [14, 9], [14, 3]], { closed: false })}
    {P([[7, 15], [17, 15], [19, 19.5], [5, 19.5]],
      { color: BLUE, fill: TINT, lw: 0.8 })}
  </Svg>
}

function hexagon(r: number): Pt[] {
  return [0, 1, 2, 3, 4, 5].map(k => {
    const a = (90 + 60 * k) * Math.PI / 180
    return [12 + r * Math.cos(a), 12 + r * Math.sin(a)] as Pt
  })
}

export function ChemfigStructure(p: IconProps) {
  const inner = hexagon(5)
  return <Svg {...p}>{P(hexagon(8), { fill: PAPER })}
    {[0, 2, 4].map(k => <g key={k}>
      {L(inner[k][0], inner[k][1], inner[k + 1][0], inner[k + 1][1], BLUE, 1.3)}
    </g>)}
  </Svg>
}

function Columns({ n, ...p }: IconProps & { n: number }) {
  const gap = 1.8
  const w = (14 - gap * (n - 1)) / n
  const cols = Array.from({ length: n }, (_, k) => 5 + k * (w + gap))
  return <Svg {...p}>{R(3, 3, 18, 18, { fill: PAPER, r: 1, lw: 1.2 })}
    {cols.map(x => [6.5, 9.5, 12.5, 15.5, 18.5].map(y =>
      <g key={`${x}-${y}`}>{L(x, y, x + w, y, BLUE, 1)}</g>))}
  </Svg>
}

export function OneColumn(p: IconProps) { return <Columns {...p} n={1} /> }
export function TwoColumns(p: IconProps) { return <Columns {...p} n={2} /> }
export function ThreeColumns(p: IconProps) { return <Columns {...p} n={3} /> }

export function PageBreak(p: IconProps) {
  return <Svg {...p}>
    {P([[5, 2.5], [19, 2.5], [19, 9], [5, 9]], { closed: false })}
    {P([[5, 21.5], [5, 15], [19, 15], [19, 21.5]], { closed: false })}
    {L(2, 12, 22, 12, BLUE, 1.3, '5.2 2.6')}
  </Svg>
}

export function HorizontalRule(p: IconProps) {
  return <Svg {...p}>{L(4, 6, 20, 6, INK, 1)}{L(4, 18, 20, 18, INK, 1)}
    {L(2.5, 12, 21.5, 12, BLUE, 2)}</Svg>
}

// A calendar page: the \\maketitle date.
export function TitleDate(p: IconProps) {
  return <Svg {...p}>{R(4, 5, 16, 15, { fill: PAPER })}{L(4, 9.5, 20, 9.5, BLUE, 2)}
    {L(8, 3, 8, 7, INK, 1.6)}{L(16, 3, 16, 7, INK, 1.6)}
    {L(7.5, 13.5, 16.5, 13.5, INK, 1)}{L(7.5, 16.5, 13, 16.5, INK, 1)}</Svg>
}

// ----- view -----

export function ZoomIn(p: IconProps) {
  return <Svg {...p}>{C(10, 10, 6.5, INK, 1.6, PAPER)}
    {L(15, 15, 21, 21, INK, 2)}{L(7, 10, 13, 10, BLUE, 1.6)}
    {L(10, 7, 10, 13, BLUE, 1.6)}</Svg>
}

export function ZoomOut(p: IconProps) {
  return <Svg {...p}>{C(10, 10, 6.5, INK, 1.6, PAPER)}
    {L(15, 15, 21, 21, INK, 2)}{L(7, 10, 13, 10, BLUE, 1.6)}</Svg>
}

export function FitWidth(p: IconProps) {
  return <Svg {...p}>{R(6, 3, 12, 18, { fill: PAPER, r: 1, lw: 1.2 })}
    {L(2, 12, 22, 12, BLUE, 1.5)}
    {P([[5, 9.5], [2, 12], [5, 14.5]], { color: BLUE, closed: false })}
    {P([[19, 9.5], [22, 12], [19, 14.5]], { color: BLUE, closed: false })}
  </Svg>
}

// One long document split into several: a page, an arrow, three small
// pages (icons.split_documents).
export function SplitDocuments(p: IconProps) {
  return <Svg {...p}>{P([[2, 3], [8.5, 3], [11, 5.5], [11, 21], [2, 21]], { fill: PAPER, lw: 1.2 })}
    {L(4, 8, 9, 8, BLUE, 1)}{L(4, 10.5, 9, 10.5, BLUE, 1)}{L(4, 13, 9, 13, BLUE, 1)}{L(4, 15.5, 9, 15.5, BLUE, 1)}
    {L(12, 12, 15, 12, BLUE, 1.4)}
    {P([[14, 10], [16.5, 12], [14, 14]], { color: BLUE, fill: BLUE })}
    {[2.5, 9.5, 16.5].map(y => <g key={y}>{P([[17, y], [21, y], [22.5, y + 1.5], [22.5, y + 5.5], [17, y + 5.5]], { fill: PAPER, lw: 1.1 })}</g>)}
  </Svg>
}

// The Documents panel: a list of documents beside the page.
export function DocumentsPanel(p: IconProps) {
  return <Svg {...p}>{R(2.5, 4, 19, 16, { fill: PAPER, r: 1.5, lw: 1.2 })}
    {L(9, 4, 9, 20, INK, 1.2)}
    {L(4, 8, 7.5, 8, BLUE, 1.4)}{L(4, 11, 7.5, 11, BLUE, 1.4)}{L(4, 14, 7.5, 14, BLUE, 1.4)}
    {L(11, 8, 19.5, 8, INK, 1)}{L(11, 10.5, 19.5, 10.5, INK, 1)}{L(11, 13, 17, 13, INK, 1)}
  </Svg>
}

// The PDF follows the text: a page and the PDF beside it, linked.
export function PdfFollow(p: IconProps) {
  return <Svg {...p}>{R(2, 4, 8.5, 12, { fill: PAPER, r: 1, lw: 1.2 })}
    {L(4, 7.5, 8.5, 7.5, INK, 1)}{L(4, 10, 8.5, 10, INK, 1)}{L(4, 12.5, 7, 12.5, INK, 1)}
    {R(13.5, 8, 8.5, 12, { fill: PAPER, r: 1, lw: 1.2 })}
    {R(13.5, 8, 8.5, 3.5, { fill: '#d32f2f', r: 1, lw: 0 })}
    {L(9, 18.5, 13, 18.5, BLUE, 1.5)}{L(6, 16, 6, 18.5, BLUE, 1.5)}{L(6, 18.5, 9, 18.5, BLUE, 1.5)}
    {P([[11, 16.8], [13.3, 18.5], [11, 20.2]], { color: BLUE, closed: false })}
  </Svg>
}

export function Heading({ arg = '1', ...p }: IconProps) {
  const level = Number(arg)
  const size = ({ 1: 14, 2: 13, 3: 12 } as Record<number, number>)[level] ?? 11
  return <Svg {...p}>{T([0, 0, 24, 23], `H${level}`,
    { size, bold: true, color: BLUE })}</Svg>
}

// ----- clipboard -----

export function Paste(p: IconProps) {
  return <Svg {...p}>
    {R(4, 4.5, 14, 17, { fill: 'var(--icon-clipboard)', r: 1.5 })}
    {R(8, 2.5, 6, 4, { fill: PAPER, r: 1 })}
    {Page(10, 9, 11, 13, 3)}
    {L(12, 15, 18, 15, BLUE, 1)}{L(12, 17.5, 16.5, 17.5, BLUE, 1)}
  </Svg>
}

export function Cut(p: IconProps) {
  return <Svg {...p}>{L(8, 3, 15.5, 15, INK, 1.6)}{L(16, 3, 8.5, 15, INK, 1.6)}
    {C(7, 18, 3, BLUE, 1.6, PAPER)}{C(17, 18, 3, BLUE, 1.6, PAPER)}</Svg>
}

export function Copy(p: IconProps) {
  return <Svg {...p}>{Page(8, 2.5, 12, 15, 3)}{Page(4, 6.5, 12, 15, 3)}</Svg>
}

// ----- contextual tabs: table, picture, equation, page setup -----

function grid(x = 3, y = 7, w = 14, h = 14) {
  return <g>
    {R(x, y, w, h, { fill: PAPER, r: 0.8, lw: 1.2 })}
    {L(x, y + h / 2, x + w, y + h / 2, INK, 0.9)}
    {L(x + w / 2, y, x + w / 2, y + h, INK, 0.9)}
  </g>
}

function plus(x: number, y: number) {
  return <g>{L(x - 3, y, x + 3, y, BLUE, 1.8)}{L(x, y - 3, x, y + 3, BLUE, 1.8)}</g>
}

function cross(x: number, y: number) {
  return <g>{L(x - 2.8, y - 2.8, x + 2.8, y + 2.8, RED, 1.8)}
    {L(x + 2.8, y - 2.8, x - 2.8, y + 2.8, RED, 1.8)}</g>
}

export function TableRowAbove(p: IconProps) {
  return <Svg {...p}>{grid(3, 9, 18, 12)}{F(3.8, 9.8, 16.4, 5, TINT)}
    {plus(12, 4.5)}</Svg>
}

export function TableRowBelow(p: IconProps) {
  return <Svg {...p}>{grid(3, 3, 18, 12)}{F(3.8, 9.5, 16.4, 4.8, TINT)}
    {plus(12, 19.5)}</Svg>
}

export function TableColLeft(p: IconProps) {
  return <Svg {...p}>{grid(9, 3, 12, 18)}{F(9.8, 3.8, 5, 16.4, TINT)}
    {plus(4.5, 12)}</Svg>
}

export function TableColRight(p: IconProps) {
  return <Svg {...p}>{grid(3, 3, 12, 18)}{F(9.5, 3.8, 4.8, 16.4, TINT)}
    {plus(19.5, 12)}</Svg>
}

export function TableDeleteRow(p: IconProps) {
  return <Svg {...p}>{grid(3, 3, 14, 14)}{F(3.8, 3.8, 12.4, 6.4, '#f6d5d1')}
    {cross(19, 19)}</Svg>
}

export function TableDeleteCol(p: IconProps) {
  return <Svg {...p}>{grid(3, 3, 14, 14)}{F(3.8, 3.8, 6.4, 12.4, '#f6d5d1')}
    {cross(19, 19)}</Svg>
}

export function TableDelete(p: IconProps) {
  return <Svg {...p}>{grid(3, 3, 14, 14)}{cross(19, 19)}</Svg>
}

export function TableStylePlain(p: IconProps) {
  return <Svg {...p}>{R(3, 4, 18, 16, { fill: PAPER, r: 0.5, lw: 1.2 })}
    {L(3, 9, 21, 9, INK, 1)}{L(3, 14.5, 21, 14.5, INK, 1)}
    {L(9, 4, 9, 20, INK, 1)}{L(15, 4, 15, 20, INK, 1)}</Svg>
}

export function TableStyleBooktabs(p: IconProps) {
  return <Svg {...p}>{L(3, 4.5, 21, 4.5, INK, 2)}{L(3, 9, 21, 9, INK, 1)}
    {L(3, 19.5, 21, 19.5, INK, 2)}
    {[12, 15.5].map(y => <g key={y}>{L(5, y, 10, y, BLUE, 1)}
      {L(14, y, 19, y, BLUE, 1)}</g>)}</Svg>
}

export function PictureDelete(p: IconProps) {
  return <Svg {...p}>{R(2.5, 3.5, 15, 12.5, { fill: PAPER })}
    {P([[4, 14.5], [8.5, 9], [12, 12.5], [16, 14.5]],
      { color: BLUE, fill: TINT, lw: 1 })}
    {cross(19, 19)}</Svg>
}

export function PictureEdit(p: IconProps) {
  return <Svg {...p}>{R(2.5, 3.5, 15, 12.5, { fill: PAPER })}
    {P([[19.5, 9.5], [22, 12], [13, 21], [10, 21.5], [10.5, 18.5]],
      { color: BLUE, fill: TINT, lw: 1.3 })}</Svg>
}

export function PictureWidth({ arg = '0.5', ...p }: IconProps) {
  const w = 18 * Number(arg)
  return <Svg {...p}>{R(2, 5, 20, 14, { color: '#999', r: 0.5, lw: 0.8 })}
    {R(12 - w / 2, 8, w, 8, { color: BLUE, fill: TINT, r: 0.5, lw: 1 })}</Svg>
}

export function EquationNumbered(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 15, 24], 'π', { size: 13, color: BLUE, family: SERIF })}
    {T([12, 0, 12, 24], '(1)', { size: 7.5 })}</Svg>
}

export function EquationDelete(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 17, 22], 'π', { size: 15, color: BLUE, family: SERIF })}
    {cross(19, 19)}</Svg>
}

export function PageSize(p: IconProps) {
  return <Svg {...p}>{Page(6, 2.5, 12, 18, 3.5)}
    {L(3.5, 3, 3.5, 20.5, BLUE, 1)}{L(8, 22.5, 16, 22.5, BLUE, 1)}</Svg>
}

export function PageMargins(p: IconProps) {
  return <Svg {...p}>{R(4, 2.5, 16, 19.5, { fill: PAPER, r: 0.5, lw: 1.2 })}
    <rect x={7} y={5.5} width={10} height={13.5} stroke={BLUE} strokeWidth={1}
      strokeDasharray='4 2' strokeLinecap='butt' fill='none' />
  </Svg>
}

// arg is "<width_in>x<height_in>".
export function PaperThumb({ arg = '8.27x11.69', ...p }: IconProps) {
  const [wi, hi] = arg.split('x').map(Number)
  const s = 19 / Math.max(wi, hi)
  const w = wi * s
  const h = hi * s
  return <Svg {...p}>{Page(12 - w / 2, 12 - h / 2, w, h, 3)}</Svg>
}

// ----- view tab -----

export function PageView(p: IconProps) {
  return <Svg {...p}>{Page(5, 2.5, 14, 19)}
    {T([5, 5, 14, 9], 'Aa', { size: 7.5, bold: true, color: BLUE })}
    {[15, 17.5].map(y => <g key={y}>{L(7.5, y, 16.5, y, INK, 1)}</g>)}</Svg>
}

export function ConsoleView(p: IconProps) {
  return <Svg {...p}>{R(2.5, 4, 19, 16, { fill: '#1e1e1e', r: 1.5 })}
    {P([[6, 9], [9, 12], [6, 15]], { color: '#7ec27e', closed: false })}
    {L(11, 15, 17, 15, '#d4d4d4', 1.4)}</Svg>
}

export function PdfDetach(p: IconProps) {
  return <Svg {...p}>{R(2.5, 6, 13, 15, { fill: PAPER, r: 1 })}
    {R(9, 3, 12.5, 10, { color: BLUE, fill: TINT, r: 1 })}
    {L(13, 11, 19, 5, BLUE, 1.5)}
    {P([[15.5, 5], [19, 5], [19, 8.5]], { color: BLUE, closed: false })}</Svg>
}

export function Theorem(p: IconProps) {
  return <Svg {...p}>{R(3, 3.5, 18, 17, { fill: PAPER, r: 1.2 })}
    {T([5, 4.5, 15, 8], 'Thm', { size: 6.5, bold: true, color: BLUE, align: 'left' })}
    {[14, 17].map(y => <g key={y}>{L(5.5, y, 18.5, y, INK, 1)}</g>)}</Svg>
}

export function Caption(p: IconProps) {
  return <Svg {...p}>{R(4, 3, 16, 11, { fill: PAPER, r: 0.8 })}
    {P([[5.5, 12.5], [10, 7.5], [13, 10.5], [18.5, 12.5]],
      { color: BLUE, fill: TINT, lw: 1 })}
    {L(4, 17.5, 20, 17.5, BLUE, 1.6)}{L(6.5, 20.5, 17.5, 20.5, INK, 1.1)}</Svg>
}

// ----- Table Design / Table Layout -----

function miniTable({ rows = 4, cols = 3, x = 2.5, y = 3.5, w = 19, h = 17,
  lines = 'h', header = true, stripes = false }: {
  rows?: number, cols?: number, x?: number, y?: number, w?: number,
  h?: number, lines?: string, header?: boolean, stripes?: boolean
}) {
  const rh = h / rows
  const cw = w / cols
  const out: ReactElement[] = []
  if (header) out.push(F(x, y, w, rh, TINT))
  if (stripes) {
    for (let r = 2; r < rows; r += 2) out.push(F(x, y + r * rh, w, rh, '#e9eef7'))
  }
  if (lines === 'h' || lines === 'grid' || lines === 'book') {
    for (let r = 0; r <= rows; r++) {
      const heavy = lines === 'book' && (r === 0 || r === rows)
      if (lines === 'book' && r > 1 && r < rows) continue
      out.push(L(x, y + r * rh, x + w, y + r * rh, INK, heavy ? 1.6 : 0.9))
    }
  }
  if (lines === 'grid') {
    for (let k = 0; k <= cols; k++) out.push(L(x + k * cw, y, x + k * cw, y + h, INK, 0.9))
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      out.push(L(x + k * cw + 1.5, y + r * rh + rh / 2, x + (k + 1) * cw - 1.5,
        y + r * rh + rh / 2, header && r === 0 ? BLUE : '#9a9a9a', 0.8))
    }
  }
  return <g>{out.map((e, i) => <g key={i}>{e}</g>)}</g>
}

const TABLE_LINES: Record<string, string> = {
  '': 'h', grid: 'grid', plain: 'none', booktabs: 'book', striped: 'book',
}

export function TableStyleIcon({ arg = '', ...p }: IconProps) {
  return <Svg {...p}>{miniTable({ lines: TABLE_LINES[arg] ?? 'h',
    stripes: arg === 'striped' })}</Svg>
}

export function TableMerge(p: IconProps) {
  return <Svg {...p}>{R(2.5, 5, 19, 14, { fill: PAPER, r: 0.6, lw: 1.2 })}
    {P([[5, 12], [8, 9.5], [8, 14.5]], { color: BLUE, fill: BLUE, lw: 1 })}
    {P([[19, 12], [16, 9.5], [16, 14.5]], { color: BLUE, fill: BLUE, lw: 1 })}
    {L(8, 12, 16, 12, BLUE, 1.4)}</Svg>
}

export function TableSplit(p: IconProps) {
  return <Svg {...p}>{R(2.5, 5, 19, 14, { fill: PAPER, r: 0.6, lw: 1.2 })}
    {L(12, 5, 12, 19, INK, 1.2)}
    {P([[4.5, 12], [8, 9.5], [8, 14.5]], { color: BLUE, fill: BLUE, lw: 1 })}
    {P([[19.5, 12], [16, 9.5], [16, 14.5]], { color: BLUE, fill: BLUE, lw: 1 })}
  </Svg>
}

// arg "desc" sorts Z to A.
export function SortIcon({ arg = '', ...p }: IconProps) {
  const [top, bottom] = arg === 'desc' ? ['Z', 'A'] : ['A', 'Z']
  return <Svg {...p}>
    {T([2, 1, 10, 11], top, { size: 9, bold: true, color: BLUE })}
    {T([2, 12, 10, 11], bottom, { size: 9, bold: true })}
    {L(16, 4, 16, 20)}
    {P([[12.5, 16.5], [16, 20.5], [19.5, 16.5]], { closed: false })}
  </Svg>
}

export function ShadingIcon({ arg = '#ffeb3b', ...p }: IconProps) {
  return <Svg {...p}>
    {P([[9, 3], [19, 13], [12, 20], [2, 10]], { fill: PAPER, lw: 1.3 })}
    <ellipse cx={20} cy={17} rx={2} ry={2.5} fill='#3aa0ff' />
    {F(2, 21, 20, 2.5, arg)}
  </Svg>
}

export function HeaderRow(p: IconProps) {
  return <Svg {...p}>{miniTable({ rows: 4, cols: 3 })}</Svg>
}

export function RepeatHeader(p: IconProps) {
  return <Svg {...p}>
    {miniTable({ rows: 2, cols: 3, x: 2.5, y: 2, w: 19, h: 8 })}
    {miniTable({ rows: 2, cols: 3, x: 2.5, y: 13.5, w: 19, h: 8 })}
  </Svg>
}

// ----- help tab -----

export function HelpIcon(p: IconProps) {
  return <Svg {...p}>{C(12, 12, 9, BLUE, 1.6, PAPER)}
    {T([3, 3, 18, 18], '?', { size: 13, bold: true, color: BLUE })}</Svg>
}

export function KeyboardIcon(p: IconProps) {
  const keys: Pt[] = []
  for (const y of [9.5, 12.5]) for (let x = 5; x < 20; x += 3) keys.push([x, y])
  return <Svg {...p}>{R(2, 6, 20, 12, { fill: PAPER, r: 2 })}
    {keys.map(([x, y]) => <g key={`${x}-${y}`}>{F(x - 0.9, y - 0.9, 1.8, 1.8, INK)}</g>)}
    {L(8, 15.5, 16, 15.5, BLUE, 1.6)}</Svg>
}

export function WelcomeIcon(p: IconProps) {
  return <Svg {...p}>
    {P([[3, 11.5], [12, 3.5], [21, 11.5]], { closed: false, lw: 1.6 })}
    {P([[5.5, 10], [5.5, 20.5], [18.5, 20.5], [18.5, 10]], { closed: false })}
    {R(10, 14, 4, 6.5, { color: BLUE, fill: TINT, r: 0.5, lw: 1.2 })}
  </Svg>
}

export function UpdateIcon(p: IconProps) {
  return <Svg {...p}>{Arc(12, 12, 8, 100, 300, BLUE, 1.8)}
    {L(12, 7.5, 12, 15.5, INK, 1.6)}
    {P([[9, 12.5], [12, 15.5], [15, 12.5]], { closed: false, lw: 1.6 })}</Svg>
}

export function AboutIcon(p: IconProps) {
  return <Svg {...p}>{C(12, 12, 9, INK, 1.5, PAPER)}{D(12, 7.5, 1.3, BLUE)}
    {L(12, 11, 12, 17, BLUE, 2)}</Svg>
}

// ----- galleries: style tiles, class thumbnails -----

let measureCtx: CanvasRenderingContext2D | null = null

function textWidth(font: string, s: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return s.length * 7
  measureCtx.font = font
  return measureCtx.measureText(s).width
}

// Word's Styles gallery: a sample in the style's own look over its name.
const STYLE_LOOK: Record<number, [string, number, boolean, boolean, string]> = {
  0: [SERIF, 11, false, false, 'fg'],
  [-1]: [SERIF, 14, false, false, 'fg'],
  [-2]: [SERIF, 10, false, true, 'fg'],
  [-7]: [SERIF, 9, false, true, 'muted'],
  [-8]: [SERIF, 9, false, false, 'muted'],
  [-3]: [SERIF, 10, true, false, 'fg'],
  [-4]: [SERIF, 9, false, true, 'fg'],
  [-6]: ['Helvetica, Arial, sans-serif', 12, true, false, 'accent'],
  [-5]: [SERIF, 16, true, false, 'accent'],
  1: [SERIF, 15, true, false, 'accent'],
  2: [SERIF, 13, true, false, 'accent'],
  3: [SERIF, 12, true, false, 'accent'],
  4: [SERIF, 11, true, true, 'accent'],
  5: [SERIF, 10, false, true, 'accent'],
}

const UI_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"

function elide(s: string, font: string, max: number): string {
  if (textWidth(font, s) <= max) return s
  let t = s
  while (t.length > 1 && textWidth(font, t + '…') > max) t = t.slice(0, -1)
  return t + '…'
}

// arg is "<level>|<name>".
// A menu asks for a square `size`; the tile keeps its 70 x 40 shape in it.
export function StyleTile({ arg = '0|Normal', size, width = size ?? 70,
  height = size ? Math.round(size * 4 / 7) : 40 }: IconProps) {
  const [lv, name] = arg.split('|')
  const level = Number(lv)
  const [family, pt, bold, italic, tone] = STYLE_LOOK[level] ?? STYLE_LOOK[0]
  const color = { fg: FG, accent: BLUE, muted: 'var(--icon-muted)' }[tone]
  const w = width
  const h = height
  let px = pt + 2
  const font = (n: number) =>
    `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${n}px ${family}`
  // Word shrinks the sample rather than cut it off.
  while (textWidth(font(px), 'AaBbCc') > w - 6 && px > 8) px -= 1
  const label = elide(name, `10px ${UI_FONT}`, w - 2)
  return (
    <svg className='kicon' width={w} height={h} viewBox={`0 0 ${w} ${h}`}
      aria-hidden='true'>
      <text x={w / 2} y={(h - 15) / 2} textAnchor='middle'
        dominantBaseline='central' fontFamily={family} fontSize={px}
        fontWeight={bold ? 700 : 400} fontStyle={italic ? 'italic' : 'normal'}
        fill={color}>AaBbCc</text>
      {(level === 1 || level === -5) &&
        <line x1={8} y1={h - 17.5} x2={w - 8} y2={h - 17.5} stroke={color}
          strokeWidth={1} />}
      <text x={w / 2} y={h - 7} textAnchor='middle' dominantBaseline='central'
        fontFamily={UI_FONT} fontSize={10} fill={FG}>{label}</text>
    </svg>
  )
}

export function NumberedHeadingTile({ width = 70, height = 40 }: IconProps) {
  const w = width
  const h = height
  return (
    <svg className='kicon' width={w} height={h} viewBox={`0 0 ${w} ${h}`}
      aria-hidden='true'>
      <text x={w / 2} y={(h - 15) / 2} textAnchor='middle'
        dominantBaseline='central' fontFamily={SERIF} fontSize={13}
        fontWeight={700} fill={ACCENT}>1.2 Aa</text>
      <text x={w / 2} y={h - 7} textAnchor='middle' dominantBaseline='central'
        fontFamily={UI_FONT} fontSize={10} fill={FG}>Numbered</text>
    </svg>
  )
}

const TWO_COL = new Set(['ieeetran', 'revtex4-2', 'acmart', 'mnras', 'sn-jnl',
  'elsarticle', 'achemso'])
const BOOKISH = new Set(['book', 'report', 'memoir', 'scrbook', 'scrreprt',
  'amsbook', 'elegantbook', 'mimosis', 'hepthesis', 'suftesi', 'toptesi',
  'disser'])

// A miniature first page showing the class's layout, like the page
// previews in Word's template picker. Drawn on a 52 x 66 canvas.
export function ClassThumbnail({ arg = 'article', size,
  width = size ? Math.round(size * 52 / 66) : 52, height = size ?? 66 }: IconProps) {
  const c = arg.toLowerCase()
  const w = 52
  const h = 66
  const ink = 'var(--thumb-ink)'
  const acc = ACCENT
  let page = { x: 4, y: 2, w: w - 8, h: h - 4 }
  if (c === 'beamer') page = { x: 2, y: h / 2 - (w - 4) * 0.375, w: w - 4, h: (w - 4) * 0.75 }
  else if (c === 'standalone') page = { x: 10, y: h / 2 - 12, w: w - 20, h: 24 }
  const x0 = page.x + 4
  const y0 = page.y + 4
  const pw = page.w - 8
  const out: ReactElement[] = []
  const lines = (x: number, y: number, width: number, n: number, step = 3.2,
    last = 0.6) => {
    for (let k = 0; k < n; k++) {
      const ww = width * (k === n - 1 ? last : 1)
      out.push(<line x1={x} y1={y + k * step} x2={x + ww} y2={y + k * step}
        stroke={ink} strokeWidth={1} />)
    }
  }
  const bar = (x: number, y: number, width: number, height: number,
    color: string) => out.push(<rect x={x} y={y} width={width} height={height}
      fill={color} />)
  if (c === 'beamer') {
    bar(page.x, page.y, page.w, 7, acc)
    for (let k = 0; k < 3; k++) {
      const yy = page.y + 12 + k * 5
      out.push(<circle cx={x0 + 1} cy={yy} r={0.8} stroke={ink} fill='none' />)
      out.push(<line x1={x0 + 4} y1={yy} x2={x0 + pw * 0.8} y2={yy}
        stroke={ink} strokeWidth={1} />)
    }
  } else if (c === 'letter' || c === 'scrlttr2') {
    lines(x0 + pw * 0.55, y0, pw * 0.45, 3, 3.2, 1)
    lines(x0, y0 + 13, pw * 0.4, 3, 3.2, 1)
    lines(x0, y0 + 26, pw, 8)
  } else if (c === 'moderncv' || c === 'europasscv') {
    bar(x0, y0, pw * 0.6, 4, acc)
    for (let k = 0; k < 4; k++) {
      const yy = y0 + 10 + k * 12
      bar(x0, yy, pw * 0.25, 2, acc)
      lines(x0 + pw * 0.32, yy + 1, pw * 0.68, 3, 3.2, 0.8)
    }
  } else if (c === 'tikzposter' || c === 'a0poster') {
    bar(page.x, page.y, page.w, 9, acc)
    const half = (pw - 2) / 2
    for (let col = 0; col < 2; col++) {
      for (let row = 0; row < 2; row++) {
        out.push(<rect x={x0 + col * (half + 2)} y={y0 + 9 + row * 24}
          width={half} height={21} stroke={acc} strokeWidth={0.8} fill='none' />)
      }
    }
  } else if (c === 'standalone') {
    const cx = page.x + page.w / 2
    const cy = page.y + page.h / 2
    out.push(<circle cx={cx - 4} cy={cy} r={5} stroke={acc} strokeWidth={1.2}
      fill='none' />)
    out.push(<rect x={cx + 1} y={cy - 4} width={8} height={8} stroke={acc}
      strokeWidth={1.2} fill='none' />)
  } else if (c.startsWith('tufte')) {
    bar(x0, y0, pw * 0.6, 3, ink)
    lines(x0, y0 + 9, pw * 0.65, 12)
    for (const k of [0, 1, 3]) {
      const yy = y0 + 10 + k * 8
      out.push(<line x1={x0 + pw * 0.75} y1={yy} x2={x0 + pw} y2={yy}
        stroke={ink} strokeWidth={0.6} />)
      out.push(<line x1={x0 + pw * 0.75} y1={yy + 2} x2={x0 + pw * 0.92}
        y2={yy + 2} stroke={ink} strokeWidth={0.6} />)
    }
  } else if (BOOKISH.has(c)) {
    out.push(<text x={x0} y={y0 + 10} fontFamily={SERIF} fontSize={7}
      fontWeight={700} fill={acc}>Chapter 1</text>)
    bar(x0, y0 + 14, pw, 0.8, acc)
    lines(x0, y0 + 21, pw, 10)
  } else if (c === 'exam') {
    for (let k = 0; k < 4; k++) {
      const yy = y0 + 4 + k * 13
      out.push(<text x={x0} y={yy + 2} fontFamily={UI_FONT} fontSize={5}
        fontWeight={700} fill={acc}>{`${k + 1}.`}</text>)
      lines(x0 + 6, yy, pw - 6, 3, 3.2, 0.5)
    }
  } else {
    bar(x0 + pw * 0.15, y0, pw * 0.7, 3, ink)
    lines(x0 + pw * 0.3, y0 + 6, pw * 0.4, 1, 3.2, 1)
    if (TWO_COL.has(c)) {
      const col = (pw - 3) / 2
      lines(x0, y0 + 13, col, 12)
      lines(x0 + col + 3, y0 + 13, col, 12)
    } else {
      lines(x0 + pw * 0.1, y0 + 12, pw * 0.8, 2, 3.2, 1)
      bar(x0, y0 + 21, pw * 0.4, 1.8, acc)
      lines(x0, y0 + 26, pw, 9)
    }
  }
  return (
    <svg className='kicon' width={width} height={height}
      viewBox={`0 0 ${w} ${h}`} aria-hidden='true'>
      <rect x={page.x} y={page.y} width={page.w} height={page.h}
        stroke='#999' strokeWidth={0.8} fill='var(--thumb-paper)' />
      {out.map((e, i) => <g key={i}>{e}</g>)}
    </svg>
  )
}

// arg is a colour, or "none" for the red "no colour" slash.
export function ColorSwatch({ arg = '#ffeb3b', size = 16 }: IconProps) {
  const none = arg === 'none'
  const s = size
  return (
    <svg className='kicon' width={s} height={s} viewBox={`0 0 ${s} ${s}`}
      aria-hidden='true'>
      <rect x={1} y={1} width={s - 2} height={s - 2} rx={3} ry={3}
        stroke='#777' strokeWidth={1} fill={none ? '#ffffff' : arg} />
      {none && <line x1={3} y1={s - 3} x2={s - 3} y2={3} stroke='#d8000c'
        strokeWidth={1.6} />}
    </svg>
  )
}

// ----- app icon: "kTeX" above a page bearing the LaTeX logo -----

export function AppIcon({ size = 24 }: IconProps) {
  const sz = 100
  const m = sz * 0.06
  const radius = sz * 0.22
  const w = sz - 2 * m
  const h = w
  const pw = w * 0.54
  const ph = h * 0.48
  const px = m + (w - pw) / 2
  const py = m + h * 0.45
  const fold = pw * 0.22
  return (
    <svg className='kicon' width={size} height={size} viewBox='0 0 100 100'
      aria-hidden='true'>
      <rect x={m} y={m} width={w} height={h} rx={radius} fill='#1a6dd8'
        stroke='#155bb5' strokeWidth={2} />
      <text x={50} y={m + h * 0.05 + h * 0.165} textAnchor='middle'
        dominantBaseline='central' fontFamily={SANS} fontWeight={700}
        fontSize={27} fill='#ffffff'>kTeX</text>
      <path d={`M${px},${py} L${px + pw - fold},${py} L${px + pw},${py + fold}
        L${px + pw},${py + ph} L${px},${py + ph} Z`} fill='#ffffff'
        stroke='#cfd6e0' strokeWidth={1.2} />
      <path d={`M${px + pw - fold},${py} L${px + pw - fold},${py + fold}
        L${px + pw},${py + fold}`} fill='none' stroke='#cfd6e0'
        strokeWidth={1.2} />
      <text x={px + pw / 2} y={py + ph * 0.62} textAnchor='middle'
        dominantBaseline='central' fontFamily="'Times New Roman', serif"
        fontSize={11} fill='#1a1a1a'>
        L<tspan dx={-3} dy={-3} fontSize={8}>A</tspan>
        <tspan dx={-1} dy={3}>T</tspan>
        <tspan dx={-1.5} dy={2.5}>E</tspan>
        <tspan dx={-0.5} dy={-2.5}>X</tspan>
      </text>
    </svg>
  )
}

// ----- equation builder category icons (the older palette) -----

function Eq({ children, ...p }: IconProps & { children: ReactNode }) {
  return <Svg {...p}>{children}</Svg>
}

// Qt point sizes on a 96 dpi screen.
const pt = (n: number) => n * 4 / 3
const MATH = "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', serif"

export function EqFractions(p: IconProps) {
  return <Eq {...p}>
    {T([4, 2, 16, 10], 'a+b', { size: pt(7), italic: true, family: MATH, color: FG })}
    {L(5, 12, 19, 12, FG, 1.4)}
    {T([4, 12, 16, 10], 'c', { size: pt(7), italic: true, family: MATH, color: FG })}
  </Eq>
}

export function EqSums(p: IconProps) {
  return <Eq {...p}>{T([0, 0, 24, 24], 'Σ', { size: pt(16), family: MATH, color: ACCENT })}</Eq>
}

export function EqIntegrals(p: IconProps) {
  return <Eq {...p}>{T([0, -1, 24, 24], '∫', { size: pt(18), family: MATH, color: ACCENT })}</Eq>
}

export function EqScripts(p: IconProps) {
  return <Eq {...p}>
    {T([2, 4, 14, 16], 'x', { size: pt(12), italic: true, family: MATH, color: FG })}
    {T([13, 2, 10, 10], '2', { size: pt(7), italic: true, family: MATH, color: ACCENT, align: 'left' })}
    {T([13, 12, 10, 10], 'i', { size: pt(7), italic: true, family: MATH, color: ACCENT, align: 'left' })}
  </Eq>
}

export function EqDerivatives(p: IconProps) {
  return <Eq {...p}>
    {T([2, 2, 20, 10], 'dy', { size: pt(8), italic: true, family: MATH, color: FG })}
    {L(5, 12, 19, 12, FG, 1.2)}
    {T([2, 12, 20, 10], 'dx', { size: pt(8), italic: true, family: MATH, color: FG })}
  </Eq>
}

export function EqGreek(p: IconProps) {
  return <Eq {...p}>{T([-2, 0, 24, 24], 'αβ', { size: pt(11), italic: true, family: MATH, color: ACCENT })}</Eq>
}

export function EqVectors(p: IconProps) {
  return <Eq {...p}>
    {L(6, 7, 18, 7, ACCENT, 1.4)}{L(15, 4, 18, 7, ACCENT, 1.4)}
    {L(15, 10, 18, 7, ACCENT, 1.4)}
    {T([0, 6, 24, 16], 'x', { size: pt(11), italic: true, family: MATH, color: FG })}
  </Eq>
}

export function EqBrackets(p: IconProps) {
  return <Eq {...p}>
    <path d={arcPath(8, 12, 4, 9, 110, 140)} stroke={ACCENT} strokeWidth={1.6} fill='none' />
    <path d={arcPath(16, 12, 4, 9, -70, 140)} stroke={ACCENT} strokeWidth={1.6} fill='none' />
  </Eq>
}

export function EqRelations(p: IconProps) {
  return <Eq {...p}>{T([0, 0, 24, 24], '≤≥', { size: pt(12), family: MATH, color: FG })}</Eq>
}

export function EqFunctions(p: IconProps) {
  return <Eq {...p}>{T([0, 0, 24, 24], 'sin', { size: pt(10), family: MATH, color: ACCENT })}</Eq>
}

export function EqEnvironments(p: IconProps) {
  return <Eq {...p}>
    {P([[8, 4], [6, 4], [6, 10], [4, 12], [6, 14], [6, 20], [8, 20]],
      { color: ACCENT, closed: false, lw: 1.6 })}
    {L(10, 8, 20, 8, FG, 1.2)}{L(10, 12, 18, 12, FG, 1.2)}{L(10, 16, 20, 16, FG, 1.2)}
  </Eq>
}

// ----- drawing dialog (paint tools) -----

const SOFT = 'var(--icon-soft)'

function pen(color: string, w = 1.6) {
  return { stroke: color, strokeWidth: w, strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const }
}

function poly(pts: Pt[], color: string, w: number, fill = 'none') {
  return <polygon points={pts.map(q => q.join(',')).join(' ')} {...pen(color, w)}
    fill={fill} />
}

const PAINT: Record<string, () => ReactNode> = {
  pointer: () => poly([[6, 3], [6, 19], [10, 15], [13, 21], [15.5, 20],
    [12.5, 14], [18, 14]], FG, 1.4, FG),
  pencil: () => <>{poly([[16, 3], [21, 8], [9, 20], [4, 15]], FG, 1.3, ACCENT2)}
    {poly([[4, 15], [9, 20], [3, 21]], FG, 1.3, FG)}
    {L(14, 5, 19, 10, FG, 1.1)}</>,
  eraser: () => <>{poly([[13, 3], [21, 11], [14, 18], [6, 10]], FG, 1.3, '#f28b9b')}
    {poly([[6, 10], [14, 18], [11, 21], [7, 21], [3, 17], [3, 13]], FG, 1.3, PAPER)}
    {L(11, 21, 21, 21, FG, 1.3)}</>,
  bucket: () => <>{poly([[10, 3], [18, 11], [11, 18], [3, 10]], FG, 1.4, SOFT)}
    {L(10, 3, 8, 1.5, FG, 1.4)}
    <path d='M19.5,13 C22,17 22.5,20 19.5,20.5 C16.5,20 17,17 19.5,13' fill={ACCENT} /></>,
  picker: () => <><circle cx={18} cy={6} r={3.2} {...pen(FG, 1.4)} fill={FG} />
    {L(15, 7, 17, 9, FG, 1.4)}{L(15.5, 8.5, 6, 18, FG, 2.2)}
    {L(6, 18, 4, 20, ACCENT, 2.2)}</>,
  line: () => <>{L(4, 20, 20, 4, FG, 2)}{D(4, 20, 2, ACCENT)}{D(20, 4, 2, ACCENT)}</>,
  arrow: () => <>{L(4, 20, 17, 7, FG, 2)}
    {poly([[21, 3], [19.5, 12], [12, 4.5]], FG, 2, FG)}</>,
  dimension: () => <>{L(3, 7, 3, 19, FG, 1.3)}{L(21, 7, 21, 19, FG, 1.3)}
    {L(4, 13, 20, 13, FG, 1.3)}
    {poly([[4, 13], [8, 11], [8, 15]], FG, 1.3, FG)}
    {poly([[20, 13], [16, 11], [16, 15]], FG, 1.3, FG)}
    {T([4, 3, 16, 9], 'mm', { size: 7, bold: true, color: ACCENT })}</>,
  protractor: () => <><path d='M3,19 A9,14 0 0 1 21,19 Z' {...pen(FG, 1.5)} fill={SOFT} />
    {L(12, 19, 17, 9, ACCENT, 1.5)}</>,
  rect: () => <rect x={3.5} y={5.5} width={17} height={13} {...pen(FG, 1.7)} fill={SOFT} />,
  roundrect: () => <rect x={3.5} y={5.5} width={17} height={13} rx={4} {...pen(FG, 1.7)} fill={SOFT} />,
  circle: () => <circle cx={12} cy={12} r={8} {...pen(FG, 1.7)} fill={SOFT} />,
  ellipse: () => <ellipse cx={12} cy={12} rx={9.5} ry={5.5} {...pen(FG, 1.7)} fill={SOFT} />,
  text: () => <>{T([0, 0, 24, 24], 'T', { size: 19, bold: true, color: FG, family: SERIF })}
    {L(19, 5, 19, 19, ACCENT, 1.2)}</>,
  image: () => <><rect x={3} y={4} width={18} height={16} rx={2} {...pen(FG, 1.4)} fill='none' />
    <polygon points='4.5,18.5 10,11 14,15.5 16,13.5 19.5,18.5' fill={ACCENT} />
    {D(16, 8.5, 2, ACCENT2)}</>,
  group: () => <><rect x={2.5} y={2.5} width={19} height={19} stroke={ACCENT}
    strokeWidth={1.2} strokeDasharray='4.8 2.4' fill='none' />
    <rect x={5} y={5} width={8} height={8} {...pen(FG, 1.5)} fill={SOFT} />
    <circle cx={15} cy={15} r={4} {...pen(FG, 1.5)} fill={SOFT} /></>,
  ungroup: () => <><rect x={3.5} y={3.5} width={8} height={8} {...pen(FG, 1.5)} fill={SOFT} />
    <circle cx={16.5} cy={16.5} r={4} {...pen(FG, 1.5)} fill={SOFT} /></>,
  copy: () => <><rect x={4} y={3} width={11} height={13} rx={1.5} {...pen(FG, 1.4)} fill='none' />
    <rect x={9} y={8} width={11} height={13} rx={1.5} {...pen(FG, 1.4)} fill={PAPER} /></>,
  paste: () => <><rect x={4} y={4} width={16} height={18} rx={2} {...pen(FG, 1.4)} fill={SOFT} />
    <rect x={8.5} y={2} width={7} height={4} rx={1} {...pen(FG, 1.4)} fill={FG} /></>,
  delete: () => <>{L(4, 6, 20, 6, FG, 1.4)}
    <rect x={9.5} y={3} width={5} height={3} {...pen(FG, 1.4)} fill='none' />
    {poly([[6, 6], [18, 6], [17, 21], [7, 21]], FG, 1.4)}
    {L(10, 9.5, 10, 18, FG, 1.4)}{L(14, 9.5, 14, 18, FG, 1.4)}</>,
  grid: () => <>{[4, 10, 16, 22].map(v => <g key={v}>{L(v - 1, 3, v - 1, 21, FG, 1)}
    {L(3, v - 1, 21, v - 1, FG, 1)}</g>)}</>,
  rotate: () => <><path d={arcPath(12, 12, 7, 7, 0, 270)} {...pen(FG, 1.8)} fill='none' />
    <polygon points='15.5,2 15.5,10 9.5,5.5' fill={FG} /></>,
  flowchart: () => <><rect x={7} y={1.5} width={10} height={5} rx={2.5} {...pen(FG, 1.3)} fill={SOFT} />
    {poly([[12, 9], [17, 12.5], [12, 16], [7, 12.5]], FG, 1.3, SOFT)}
    <rect x={7} y={18.5} width={10} height={4.5} {...pen(FG, 1.3)} fill={SOFT} />
    {L(12, 6.5, 12, 9, FG, 1.3)}{L(12, 16, 12, 18.5, FG, 1.3)}</>,
  electrical: () => <>{L(2, 12, 6, 12, FG, 1.5)}
    <polyline points='6,12 7.5,8 10,16 12.5,8 15,16 17.5,8 18.5,12' {...pen(FG, 1.5)} fill='none' />
    {L(18.5, 12, 22, 12, FG, 1.5)}</>,
  maths: () => <>{L(3, 21, 21, 21, FG, 1.3)}{L(3, 21, 3, 3, FG, 1.3)}
    <path d='M4,19 C9,19 10,4 13,4 C16,4 17,17 21,17' {...pen(ACCENT, 1.6)} fill='none' /></>,
  chemistry: () => <>{poly(hexagon(8.5), FG, 1.4)}
    <circle cx={12} cy={12} r={4.8} {...pen(ACCENT, 1.3)} fill='none' /></>,
  canvas: () => <><rect x={5} y={5} width={14} height={14} {...pen(FG, 1.4)} fill='#ffffff' />
    {L(2, 5, 2, 19, ACCENT, 1.4)}{L(5, 22, 19, 22, ACCENT, 1.4)}</>,
}

export const PAINT_TOOLS = Object.keys(PAINT)

export function PaintTool({ arg = 'pointer', ...p }: IconProps) {
  const draw = PAINT[arg]
  return <Svg {...p}>{draw ? draw() : null}</Svg>
}

// Keyed by the icons.py function name, so the ribbon table can name icons
// exactly as mainwindow.py does.
export const ICONS: Record<string, (p: IconProps) => ReactElement> = {
  file_new: FileNew, file_open: FileOpen, file_save: FileSave,
  export_pdf: ExportPdf, export_docx_icon: ExportDocx, printer: Printer, print_preview: PrintPreview,
  project_open: ProjectOpen, undo: Undo, redo: Redo,
  bold: Bold, italic: Italic, underline: Underline, strike: Strike,
  subscript: Subscript, superscript: Superscript, smallcaps: Smallcaps,
  code: Code, highlight: Highlight, bullet_list: BulletList,
  numbered_list: NumberedList, align_left: AlignLeft,
  align_center: AlignCenter, align_right: AlignRight,
  align_justify: AlignJustify, formatting_marks: FormattingMarks,
  gallery_more: GalleryMore, spell_check: SpellCheck, spelling_list: SpellingList, comment: Comment,
  accept_change: AcceptChange, reject_change: RejectChange,
  prev_comment: PrevComment, next_comment: NextComment, history: History,
  commit: Commit, overleaf_send: OverleafSend, overleaf_get: OverleafGet,
  overleaf_zip: OverleafZip, branch: Branch, github: GitHub, captions: Captions, reference_style: ReferenceStyle, compile_pdf: CompilePdf,
  auto_compile_on: AutoCompileOn, auto_compile_off: AutoCompileOff,
  compile_no_images: CompileNoImages, compile_range: CompileRange,
  figure: Figure, table: Table, drawing: Drawing,
  flowchart_builder: FlowchartBuilder, link: Link, footnote: Footnote,
  citation: Citation, manage_references: ManageReferences, refs_zotero: RefsZotero, coffee: Coffee, your_name: YourName, refs_endnote: RefsEndNote, refs_import: RefsImport, bibliography: Bibliography, cross_ref: CrossRef, math_inline: MathInline,
  math_block: MathBlock, symbol: Symbol, equation_builder: EquationBuilder,
  chemistry: Chemistry, chemfig_structure: ChemfigStructure,
  one_column: OneColumn, two_columns: TwoColumns,
  three_columns: ThreeColumns, page_break: PageBreak,
  horizontal_rule: HorizontalRule, title_date: TitleDate, zoom_in: ZoomIn, zoom_out: ZoomOut,
  fit_width: FitWidth, pdf_follow: PdfFollow, documents_panel: DocumentsPanel, split_documents: SplitDocuments, heading: Heading, paste: Paste, cut: Cut, copy: Copy,
  table_row_above: TableRowAbove, table_row_below: TableRowBelow,
  table_col_left: TableColLeft, table_col_right: TableColRight,
  table_delete_row: TableDeleteRow, table_delete_col: TableDeleteCol,
  table_delete: TableDelete, table_style_plain: TableStylePlain,
  table_style_booktabs: TableStyleBooktabs, picture_delete: PictureDelete,
  picture_edit: PictureEdit, picture_width: PictureWidth,
  equation_numbered: EquationNumbered, equation_delete: EquationDelete,
  page_size: PageSize, page_margins: PageMargins, paper_thumb: PaperThumb,
  page_view: PageView, console_view: ConsoleView, pdf_detach: PdfDetach,
  theorem: Theorem, caption: Caption, table_style_icon: TableStyleIcon,
  table_merge: TableMerge, table_split: TableSplit, sort_icon: SortIcon,
  shading_icon: ShadingIcon, header_row: HeaderRow,
  repeat_header: RepeatHeader, help_icon: HelpIcon,
  keyboard_icon: KeyboardIcon, welcome_icon: WelcomeIcon,
  update_icon: UpdateIcon, about_icon: AboutIcon, style_tile: StyleTile,
  numbered_heading_tile: NumberedHeadingTile,
  class_thumbnail: ClassThumbnail, color_swatch: ColorSwatch,
  app_icon: AppIcon, paint_tool: PaintTool,
  eq_fractions: EqFractions, eq_sums: EqSums, eq_integrals: EqIntegrals,
  eq_scripts: EqScripts, eq_derivatives: EqDerivatives, eq_greek: EqGreek,
  eq_vectors: EqVectors, eq_brackets: EqBrackets,
  eq_relations: EqRelations, eq_functions: EqFunctions,
  eq_environments: EqEnvironments,
}

export function Icon({ name, ...p }: IconProps & { name: string }) {
  const Draw = ICONS[name]
  return Draw ? <Draw {...p} /> : null
}
