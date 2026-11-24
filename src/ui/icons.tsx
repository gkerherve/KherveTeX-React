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

// The title bar's icons: white outlines (currentColor) on the blue bar.
function TbUndoArrow({ mirror, ...p }: IconProps & { mirror: boolean }) {
  const x = (v: number) => mirror ? 24 - v : v
  return <Svg {...p}>
    <path d={`M${x(5)},10 L${x(14)},10 C${x(20)},10 ${x(20)},19 ${x(14)},19 L${x(10)},19`} stroke='currentColor' strokeWidth={1.8} fill='none' strokeLinecap='round' />
    <path d={`M${x(9)},5.5 L${x(4.5)},10 L${x(9)},14.5`} stroke='currentColor' strokeWidth={1.8} fill='none' strokeLinecap='round' strokeLinejoin='round' />
  </Svg>
}
function TbSave(p: IconProps) {
  return <Svg {...p}>
    <path d='M4.5,4.5 H16.5 L19.5,7.5 V19.5 H4.5 Z' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
    <path d='M8,4.5 V9 H15 V4.5' stroke='currentColor' strokeWidth={1.6} fill='none' />
    <rect x='7.5' y='13' width='9' height='6.5' stroke='currentColor' strokeWidth={1.6} fill='none' />
  </Svg>
}
// The mode menu (Editing, Reviewing, Viewing) and Share, as Word's.
function ModeEditing(p: IconProps) {
  return <Svg {...p}>
    <path d='M5,19 L6,15 L15.5,5.5 L18.5,8.5 L9,18 Z' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
    <path d='M13.5,7.5 L16.5,10.5' stroke='currentColor' strokeWidth={1.6} />
  </Svg>
}
function ModeReviewing(p: IconProps) {
  return <Svg {...p}>
    <path d='M4,17 L5,13.5 L13,5.5 L15.5,8 L7.5,16 Z' stroke='currentColor' strokeWidth={1.5} fill='none' strokeLinejoin='round' />
    <path d='M12,19.5 H20 M16,15.5 V19.5' stroke='#c43e1c' strokeWidth={1.8} strokeLinecap='round' />
  </Svg>
}
function ModeViewing(p: IconProps) {
  return <Svg {...p}>
    <path d='M2.5,12 C6,6 18,6 21.5,12 C18,18 6,18 2.5,12 Z' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
    <circle cx='12' cy='12' r='3.2' stroke='currentColor' strokeWidth={1.6} fill='none' />
  </Svg>
}
function Repaginate(p: IconProps) {
  return <Svg {...p}>
    {Page(4, 3, 10, 13, 2)}{Page(10, 8, 10, 13, 2)}
    <path d='M19.5,5.5 A6,6 0 0 0 14,2.5' stroke='#107c41' strokeWidth={1.6} fill='none' />
    <path d='M19.8,2.8 L19.6,5.8 L16.6,5.4' stroke='#107c41' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
  </Svg>
}
function ShareIcon(p: IconProps) {
  return <Svg {...p}>
    <path d='M8,9 H6 V20 H18 V9 H16' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
    <path d='M12,14 V3.5 M8.5,7 L12,3.5 L15.5,7' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinecap='round' strokeLinejoin='round' />
  </Svg>
}
// Export on the title bar: a page with a W / PDF tag, in white.
function TbDocx(p: IconProps) {
  return <Svg {...p}>
    <path d='M7,3.5 H15 L19,7.5 V20.5 H7 Z' stroke='currentColor' strokeWidth={1.5} fill='none' strokeLinejoin='round' />
    <rect x='2.5' y='9' width='10' height='8' rx='1.5' fill='#fff' />
    <path d='M4.2,10.8 L5.4,15.3 L7.5,11.6 L9.6,15.3 L10.8,10.8' stroke='#2b579a' strokeWidth={1.3} fill='none' strokeLinejoin='round' />
  </Svg>
}
function TbPdf(p: IconProps) {
  return <Svg {...p}>
    <path d='M7,3.5 H15 L19,7.5 V20.5 H7 Z' stroke='currentColor' strokeWidth={1.5} fill='none' strokeLinejoin='round' />
    <rect x='2' y='9' width='12' height='8' rx='1.5' fill='#fff' />
    <text x='8' y='15.4' textAnchor='middle' fontSize='5.6' fontWeight='700' fill='#c43e1c' fontFamily='Arial, sans-serif'>PDF</text>
  </Svg>
}
function TbNew(p: IconProps) {
  return <Svg {...p}>
    <path d='M6,3.5 H14 L18.5,8 V20.5 H6 Z' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
    <path d='M13.5,3.5 V8.5 H18.5' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
  </Svg>
}
function TbOpen(p: IconProps) {
  return <Svg {...p}>
    <path d='M3.5,18.5 V6 H9 L11,8 H17.5 V10.5' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
    <path d='M3.5,18.5 L6.5,10.5 H21 L18,18.5 Z' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
  </Svg>
}
function TbPrint(p: IconProps) {
  return <Svg {...p}>
    <path d='M7,9 V4.5 H17 V9' stroke='currentColor' strokeWidth={1.6} fill='none' strokeLinejoin='round' />
    <rect x='3.5' y='9' width='17' height='7.5' rx='1.5' stroke='currentColor' strokeWidth={1.6} fill='none' />
    <rect x='7' y='14' width='10' height='6' stroke='currentColor' strokeWidth={1.6} fill='#2b579a' />
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

// Insert ▸ Illustrations: Shapes (a square over a circle), Chart (bars),
// Screenshot (a camera in a dashed frame).
export function Shapes(p: IconProps) {
  return <Svg {...p}><circle cx={14.5} cy={14.5} r={7} fill={PAPER} stroke={INK} strokeWidth={1.4} />
    {F(3, 3, 10, 10, '#4a86d4')}</Svg>
}
// SmartArt: Word's green chevron with a list beside it.
export function SmartArt(p: IconProps) {
  return <Svg {...p}>{P([[2, 6], [11, 6], [15, 11], [11, 16], [2, 16], [6, 11]], { fill: '#8fd19e', color: '#2e7d32', lw: 1 })}
    {R(12, 9, 10, 11, { fill: PAPER, lw: 1.1, r: 1 })}{L(14, 12.5, 20, 12.5, INK, 1)}{L(14, 15, 20, 15, INK, 1)}{L(14, 17.5, 18, 17.5, INK, 1)}</Svg>
}
export function Chart(p: IconProps) {
  return <Svg {...p}>{F(4, 11, 4, 10, '#9aa0a6')}{F(10, 4, 4, 17, INK)}{F(16, 8, 4, 13, '#4a86d4')}{L(2.5, 21.5, 21.5, 21.5, INK, 1)}</Svg>
}
export function Screenshot(p: IconProps) {
  return <Svg {...p}>{R(2, 2, 16, 14, { dash: '2 1.6', lw: 1.1 })}
    {R(5, 9, 12, 9, { fill: PAPER, lw: 1.3, r: 1.5 })}<circle cx={11} cy={13.5} r={2.4} fill='none' stroke={INK} strokeWidth={1.2} />
    {L(19.5, 17, 19.5, 23, '#2e9e4a', 1.6)}{L(16.5, 20, 22.5, 20, '#2e9e4a', 1.6)}</Svg>
}

// Review ▸ Tracking: a page with red and black lines and a pencil;
// the markup views as a small page.
export function TrackChanges(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 14, 19, 3)}
    {L(6, 8, 13, 8, '#d32f2f', 1.2)}{L(6, 11, 11, 11, '#d32f2f', 1.2)}{L(6, 14, 12, 14, INK, 1.2)}
    {P([[20.5, 9], [22.5, 11], [13, 20.5], [10.5, 21], [11, 18.5]], { fill: '#9ec5f8', color: BLUE, lw: 1 })}</Svg>
}
export function MarkupView(p: IconProps) {
  return <Svg {...p}>{Page(4, 3, 10, 13, 2.5)}{L(6, 8, 11, 8, '#d32f2f', 1.1)}{L(6, 11, 10, 11, INK, 1.1)}
    {Page(11, 9, 10, 13, 2.5)}{P([[13, 15], [16, 18], [19, 15]], { closed: false, lw: 1.2, color: BLUE })}</Svg>
}
export function MarkupOptions(p: IconProps) {
  return <Svg {...p}>{Page(5, 3, 13, 18, 3)}{L(8, 9, 14, 9, '#d32f2f', 1.2)}{L(8, 12, 12, 12, '#d32f2f', 1.2)}{L(8, 15, 14, 15, INK, 1.2)}</Svg>
}

// Word's Font group: grow / shrink font, change case, clear formatting,
// font colour (the bar takes the chosen colour).
export function GrowFont(p: IconProps) {
  return <Svg {...p}>{T([0, 3, 17, 21], 'A', { size: 19 })}
    {P([[16, 7], [19, 3.5], [22, 7]], { closed: false, lw: 1.3, color: BLUE })}</Svg>
}
export function ShrinkFont(p: IconProps) {
  return <Svg {...p}>{T([0, 5, 16, 19], 'A', { size: 15 })}
    {P([[16, 4], [19, 7.5], [22, 4]], { closed: false, lw: 1.3, color: BLUE })}</Svg>
}
export function ChangeCase(p: IconProps) {
  return <Svg {...p}>{T([0, 2, 13, 20], 'A', { size: 16 })}{T([11, 5, 13, 18], 'a', { size: 14 })}</Svg>
}
export function ClearFormat(p: IconProps) {
  return <Svg {...p}>{T([0, 0, 18, 20], 'A', { size: 18 })}
    {P([[13, 15], [18, 10.5], [22, 14.5], [17, 19]], { fill: '#c879d6', color: '#8e3fa0', lw: 1 })}</Svg>
}
export function FontColor({ arg = '#c00000', ...p }: IconProps) {
  const c = arg.startsWith('#') ? arg : `#${arg}`
  return <Svg {...p}>{T([0, 0, 24, 19], 'A', { size: 17 })}{F(3, 19.5, 18, 3.5, c)}</Svg>
}
export function UnderlineStyle({ arg = 'double', ...p }: IconProps) {
  const y = 12
  return <Svg {...p}>
    {arg === 'double' && <>{L(2, y - 1.5, 22, y - 1.5, INK, 1.2)}{L(2, y + 1.5, 22, y + 1.5, INK, 1.2)}</>}
    {arg === 'single' && L(2, y, 22, y, INK, 1.4)}
    {arg === 'dotted' && L(2, y, 22, y, INK, 1.6, '0.1 2.6')}
    {arg === 'dashed' && L(2, y, 22, y, INK, 1.4, '3.5 2.2')}
    {arg === 'wave' && <path d='M2 12 q2.5 -3 5 0 t5 0 t5 0 t5 0' fill='none' stroke={INK} strokeWidth={1.3} />}
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

export function MultilevelList(p: IconProps) {
  return <Svg {...p}>
    {T([0, 0.5, 7, 10], '1', { size: 7.5, bold: true, color: BLUE })}{L(8, 5, 21, 5, INK, 1.4)}
    {T([3, 7, 10, 10], 'a', { size: 7.5, bold: true, color: BLUE })}{L(11, 12, 21, 12, INK, 1.4)}
    {T([6, 13.5, 13, 10], 'i', { size: 7.5, bold: true, color: BLUE })}{L(14, 19, 21, 19, INK, 1.4)}
  </Svg>
}

function IndentIcon({ inc, ...p }: IconProps & { inc: boolean }) {
  return <Svg {...p}>
    {L(3, 4, 21, 4, INK, 1.4)}{L(11, 9.5, 21, 9.5, INK, 1.4)}{L(11, 14.5, 21, 14.5, INK, 1.4)}{L(3, 20, 21, 20, INK, 1.4)}
    {inc ? <>{L(2.5, 12, 8.5, 12, BLUE, 1.5)}{P([[6, 9.5], [8.8, 12], [6, 14.5]], { closed: false, lw: 1.5, color: BLUE })}</>
      : <>{L(3, 12, 9, 12, BLUE, 1.5)}{P([[5.5, 9.5], [2.7, 12], [5.5, 14.5]], { closed: false, lw: 1.5, color: BLUE })}</>}
  </Svg>
}
export const IndentDec = (p: IconProps) => <IndentIcon {...p} inc={false} />
export const IndentInc = (p: IconProps) => <IndentIcon {...p} inc />

export function LineSpacing(p: IconProps) {
  return <Svg {...p}>
    {L(10, 5, 21, 5, INK, 1.4)}{L(10, 10, 21, 10, INK, 1.4)}{L(10, 15, 21, 15, INK, 1.4)}{L(10, 20, 21, 20, INK, 1.4)}
    {L(5, 4, 5, 21, BLUE, 1.3)}{P([[2.5, 6.5], [5, 3.5], [7.5, 6.5]], { closed: false, lw: 1.3, color: BLUE })}
    {P([[2.5, 18.5], [5, 21.5], [7.5, 18.5]], { closed: false, lw: 1.3, color: BLUE })}
  </Svg>
}

// Borders: the dotted grid of a box with the chosen sides drawn solid.
export function ParaBorders({ arg, ...p }: IconProps) {
  const a = arg || 'bottom'
  const dot = (x1: number, y1: number, x2: number, y2: number) => L(x1, y1, x2, y2, '#9aa0a6', 0.9, '1 1.6')
  const solid = (x1: number, y1: number, x2: number, y2: number) => L(x1, y1, x2, y2, INK, 1.6)
  const top = a === 'top' || a === 'topbottom' || a === 'box'
  const bot = a === 'bottom' || a === 'topbottom' || a === 'box'
  const side = a === 'box'
  return <Svg {...p}>
    {dot(12, 4, 12, 20)}{dot(4, 12, 20, 12)}
    {top ? solid(4, 4, 20, 4) : dot(4, 4, 20, 4)}
    {bot ? solid(4, 20, 20, 20) : dot(4, 20, 20, 20)}
    {side ? solid(4, 4, 4, 20) : dot(4, 4, 4, 20)}
    {side ? solid(20, 4, 20, 20) : dot(20, 4, 20, 20)}
  </Svg>
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

// References ▸ From Mendeley: a red tile with an M.
export function RefsMendeley(p: IconProps) {
  return <Svg {...p}>
    {R(3, 3, 18, 18, { fill: '#9d1620', color: '#7a1018', r: 9, lw: 1 })}
    {P([[7, 16.5], [7, 8], [12, 13], [17, 8], [17, 16.5]], { color: '#ffffff', closed: false, lw: 2 })}
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
// References ▸ Import ▸ KherveRef: a library book marked k.
export function RefsKherveRef(p: IconProps) {
  return <Svg {...p}>{R(4, 3, 15, 18, { fill: '#2b5797', color: '#1d3d6b', lw: 1.2, r: 1.5 })}{F(6, 3.6, 1.2, 16.8, '#9ec5f8')}
    {T([7, 5, 12, 13], 'k', { size: 13, bold: true, color: '#fff', family: 'Georgia, serif' })}</Svg>
}
export function RefsImport(p: IconProps) {
  return <Svg {...p}>{Page(3, 2.5, 13, 19)}
    {L(6, 10, 12, 10, INK, 1)}{L(6, 13, 12, 13, INK, 1)}{L(6, 16, 10, 16, INK, 1)}
    {L(21.5, 8, 21.5, 17, GREEN, 1.8)}
    {P([[18.5, 14], [21.5, 17], [24, 14]], { color: GREEN, closed: false, lw: 1.8 })}
  </Svg>
}

// References ▸ Import ▸ BibTeX: a page marked ".bib", a green arrow in.
export function RefsBib(p: IconProps) {
  return <Svg {...p}>{Page(3, 2.5, 13, 19)}
    {T([3.5, 9, 12, 7], 'bib', { size: 6, bold: true, color: BLUE })}
    {L(6, 17, 12, 17, INK, 1)}
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

// Layout ▸ Breaks: the foot of one page and the head of the next, the
// gap between them marked, text lines on each.
export function Breaks(p: IconProps) {
  return <Svg {...p}>
    {P([[4, 2], [4, 9.5], [20, 9.5], [20, 2]], { closed: false, fill: PAPER })}
    {L(7, 5, 17, 5, BLUE, 1.1)}
    {P([[4, 22], [4, 14.5], [20, 14.5], [20, 22]], { closed: false, fill: PAPER })}
    {L(7, 18, 17, 18, BLUE, 1.1)}
    {L(1.5, 12, 22.5, 12, INK, 1, '2 1.6')}
  </Svg>
}

// A column break: two columns, the left one ending early, an arrow on.
export function ColumnBreak(p: IconProps) {
  return <Svg {...p}>{R(3, 3, 18, 18, { fill: PAPER, r: 1, lw: 1.2 })}
    {[6.5, 9.5].map(y => <g key={y}>{L(5.5, y, 11, y, BLUE, 1)}</g>)}
    {[6.5, 9.5, 12.5, 15.5, 18.5].map(y => <g key={y}>{L(13, y, 18.5, y, BLUE, 1)}</g>)}
    {L(5.5, 13, 9.5, 13, INK, 1, '1.5 1')}
    {P([[9, 11.5], [11, 13], [9, 14.5]], { closed: false, lw: 1, color: INK })}
  </Svg>
}

// A section break to the next page or the next odd page: a page with a
// number at its foot.
function SectionPage({ label, ...p }: IconProps & { label: string }) {
  return <Svg {...p}>{Page(5, 2.5, 14, 19)}
    {[7, 10, 13].map(y => <g key={y}>{L(7.5, y, 16.5, y, BLUE, 1)}</g>)}
    {T([5, 15, 14, 6], label, { size: 6.5, bold: true, color: INK })}</Svg>
}
export const SectionNext = (p: IconProps) => <SectionPage {...p} label="→" />
export const SectionOdd = (p: IconProps) => <SectionPage {...p} label="1 3" />

// Line Numbers: lines of text with their numbers in the margin.
export function LineNumbers(p: IconProps) {
  return <Svg {...p}>
    {T([1, 2.5, 6, 8], '1', { size: 7, color: BLUE })}
    {T([1, 9.5, 6, 8], '2', { size: 7, color: BLUE })}
    {T([1, 16, 6, 8], '3', { size: 7, color: BLUE })}
    {[6.5, 13.5, 20].map(y => <g key={y}>{L(9, y, 22, y, INK, 1.3)}</g>)}
  </Svg>
}

// Hyphenation: "a-" over "bc", a word broken at a line end.
export function Hyphenation(p: IconProps) {
  return <Svg {...p}>
    {T([7, 1, 14, 11], 'a-', { size: 9, color: INK, align: 'left' })}
    {T([2, 12, 14, 11], 'bc', { size: 9, color: INK, align: 'left' })}
    {L(13.5, 6.5, 16.5, 6.5, BLUE, 1.6)}
  </Svg>
}

// ----- Header & Footer (Word's tab) -----

// A page with its header (or footer) band shaded orange, as Word's.
function BandPage({ foot, ...p }: IconProps & { foot: boolean }) {
  return <Svg {...p}>{Page(4, 2, 16, 20, 3)}
    {foot ? F(5, 16.5, 14, 4.5, '#f4b183') : F(5, 3, 11.5, 4.5, '#f4b183')}
    {foot ? L(4.5, 16, 19.5, 16, '#c55a11', 1) : L(4.5, 8, 19.5, 8, '#c55a11', 1)}
    {[10.5, 13].map(y => <g key={y}>{L(7, foot ? y - 1 : y, 17, foot ? y - 1 : y, INK, 1)}</g>)}
  </Svg>
}
export const HfHeader = (p: IconProps) => <BandPage {...p} foot={false} />
export const HfFooter = (p: IconProps) => <BandPage {...p} foot />
export function HfPageNum(p: IconProps) {
  return <Svg {...p}>{Page(4, 2, 16, 20, 3)}
    {T([4, 6, 16, 12], '#', { size: 11, bold: true, color: BLUE })}</Svg>
}
export function HfDateTime(p: IconProps) {
  return <Svg {...p}>{R(3, 4, 15, 14, { fill: PAPER })}{L(3, 8, 18, 8, INK, 1.2)}
    {L(7, 2.5, 7, 6, INK, 1.4)}{L(14, 2.5, 14, 6, INK, 1.4)}
    <circle cx={17} cy={17} r={5} fill={PAPER} stroke={BLUE} strokeWidth={1.3} />
    {L(17, 17, 17, 14, BLUE, 1.2)}{L(17, 17, 19, 18, BLUE, 1.2)}</Svg>
}
export function HfField(p: IconProps) {
  return <Svg {...p}>{R(2.5, 7, 19, 10, { fill: PAPER, r: 1 })}{F(5, 10, 14, 4, '#c8c8c8')}</Svg>
}
export function HfPicture(p: IconProps) {
  return <Svg {...p}>{R(2.5, 4, 15, 12, { fill: PAPER })}
    {P([[4, 14], [8, 9], [11, 12], [13, 10], [16, 14]], { color: GREEN, closed: false, lw: 1.2 })}
    {R(10, 11, 12, 9, { fill: '#cfe3f7', color: BLUE })}{L(13, 22, 19, 22, INK, 1.2)}</Svg>
}
export const HfGotoHeader = (p: IconProps) => <Svg {...p}>{Page(5, 2, 14, 20, 3)}
  {F(6, 3, 9, 4, '#f4b183')}{L(12, 18, 12, 9.5, BLUE, 1.4)}{P([[9.5, 12], [12, 9.5], [14.5, 12]], { closed: false, color: BLUE, lw: 1.4 })}</Svg>
export const HfGotoFooter = (p: IconProps) => <Svg {...p}>{Page(5, 2, 14, 20, 3)}
  {F(6, 16.5, 12, 4.5, '#f4b183')}{L(12, 5, 12, 13.5, BLUE, 1.4)}{P([[9.5, 11], [12, 13.5], [14.5, 11]], { closed: false, color: BLUE, lw: 1.4 })}</Svg>
const HfStep = ({ up, ...p }: IconProps & { up: boolean }) => <Svg {...p}>{R(4, 3, 16, 18, { fill: PAPER })}
  {F(5, up ? 4 : 15, 14, 5, '#f4b183')}
  {up ? P([[9, 14], [12, 11], [15, 14]], { closed: false, color: BLUE, lw: 1.6 }) : P([[9, 9], [12, 12], [15, 9]], { closed: false, color: BLUE, lw: 1.6 })}</Svg>
export const HfPrev = (p: IconProps) => <HfStep {...p} up />
export const HfNext = (p: IconProps) => <HfStep {...p} up={false} />
export function HfLink(p: IconProps) {
  return <Svg {...p}>{R(3, 3, 12, 8, { fill: PAPER })}{R(9, 13, 12, 8, { fill: PAPER })}
    {L(7, 11, 7, 17, INK, 1.2)}{L(7, 17, 9, 17, INK, 1.2)}</Svg>
}
export function HfClose(p: IconProps) {
  return <Svg {...p}>{R(3, 3, 18, 18, { fill: '#c42b1c', color: '#c42b1c', r: 2 })}
    {L(8, 8, 16, 16, '#fff', 2)}{L(16, 8, 8, 16, '#fff', 2)}</Svg>
}
const HfPos = ({ foot, ...p }: IconProps & { foot: boolean }) => <Svg {...p}>
  {F(3, foot ? 14 : 4, 18, 6, '#9dc3e6')}{L(3, foot ? 21 : 3, 21, foot ? 21 : 3, INK, 1.2)}
  {L(12, foot ? 13 : 11, 12, foot ? 20 : 4, INK, 1)}
  {P(foot ? [[10, 18], [12, 20], [14, 18]] : [[10, 6], [12, 4], [14, 6]], { closed: false, lw: 1 })}</Svg>
export const HfTop = (p: IconProps) => <HfPos {...p} foot={false} />
export const HfBottom = (p: IconProps) => <HfPos {...p} foot />

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

// Layout ▸ Margins (Word's): a page, its margins' lines across it and the
// text area in blue.
export function PageMargins(p: IconProps) {
  return <Svg {...p}>{R(3.5, 2, 17, 20, { fill: PAPER, r: 0.5, lw: 1.1 })}
    {L(7, 2, 7, 22, INK, 0.7)}{L(17, 2, 17, 22, INK, 0.7)}{L(3.5, 5.5, 20.5, 5.5, INK, 0.7)}{L(3.5, 18.5, 20.5, 18.5, INK, 0.7)}
    <rect x={7} y={5.5} width={10} height={13} stroke={BLUE} strokeWidth={1.3} fill='none' />
  </Svg>
}

// Layout ▸ Margins: an A4 page with its margins' lines across it and the
// text area outlined, as Word's list draws them. arg is "t,b,l,r" in cm,
// "m..." for Mirrored (two facing pages, left = inside).
export function MarginThumb({ arg = '2.54,2.54,2.54,2.54', ...p }: IconProps) {
  const mirror = arg.startsWith('m')
  const [t, b, l, r] = arg.replace(/^m/, '').split(',').map(Number)
  const LINE = '#9db8d9'
  const page = (x: number, y: number, w: number, h: number, left: number, right: number, key: string) => {
    const s = w / 21
    const xl = x + left * s, xr = x + w - right * s, yt = y + t * s, yb = y + h - b * s
    return <g key={key}>
      {R(x, y, w, h, { fill: PAPER, r: 0.3, lw: 0.8 })}
      {L(xl, y, xl, y + h, LINE, 0.6)}{L(xr, y, xr, y + h, LINE, 0.6)}
      {L(x, yt, x + w, yt, LINE, 0.6)}{L(x, yb, x + w, yb, LINE, 0.6)}
      <rect x={xl} y={yt} width={xr - xl} height={yb - yt} fill='none' stroke={BLUE} strokeWidth={0.9} />
    </g>
  }
  return <Svg {...p}>{mirror
    ? [page(0.8, 4.5, 10.8, 15.2, r, l, 'l'), page(12.4, 4.5, 10.8, 15.2, l, r, 'r')]
    : page(4.5, 2, 15, 21, l, r, 'p')}</Svg>
}

// arg is "<width_in>x<height_in>".
export function PaperThumb({ arg = '8.27x11.69', ...p }: IconProps) {
  const [wi, hi] = arg.split('x').map(Number)
  const s = 19 / Math.max(wi, hi)
  const w = wi * s
  const h = hi * s
  return <Svg {...p}>{Page(12 - w / 2, 12 - h / 2, w, h, 3)}</Svg>
}

// Orientation: a portrait page with a landscape one over it.
export function Orientation(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 12, 16, 2.5)}{F(8, 11, 14, 10, '#fff')}{Page(8, 11, 14, 10, 2.5)}</Svg>
}

// Space before / after: lines with a blue double arrow above or below.
function SpaceIcon({ after, ...p }: IconProps & { after: boolean }) {
  const lines = after ? [4, 8.5, 13] : [11, 15.5, 20]
  const [a, b] = after ? [15, 21] : [3, 9]
  return <Svg {...p}>
    {lines.map(v => <g key={v}>{L(10, v, 21, v, INK, 1.3)}</g>)}
    {L(5, a, 5, b, BLUE, 1.3)}
    {P([[3, a + 2], [5, a], [7, a + 2]], { closed: false, lw: 1.3, color: BLUE })}
    {P([[3, b - 2], [5, b], [7, b - 2]], { closed: false, lw: 1.3, color: BLUE })}
  </Svg>
}
export const SpaceBefore = (p: IconProps) => <SpaceIcon {...p} after={false} />
export const SpaceAfter = (p: IconProps) => <SpaceIcon {...p} after />

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

// Move a box or table up / down a block: the block and an arrow.
function MoveBlock(p: IconProps & { down?: boolean }) {
  const d = !!p.down
  return <Svg {...p}>{R(9, d ? 3 : 12, 12, 9, { fill: TINT, color: BLUE, r: 1 })}
    {L(5, d ? 4 : 20, 5, d ? 19 : 5, INK, 1.6)}
    {P(d ? [[2, 15.5], [5, 19.5], [8, 15.5]] : [[2, 8.5], [5, 4.5], [8, 8.5]], { color: INK, lw: 1.6 })}</Svg>
}
export const MoveUp = (p: IconProps) => <MoveBlock {...p} />
export const MoveDown = (p: IconProps) => <MoveBlock {...p} down />

// A coloured box with a title bar (Insert > Box).
export function Callout(p: IconProps) {
  return <Svg {...p}>{R(3, 4, 18, 16, { fill: TINT, color: BLUE, r: 1.5 })}
    {R(3, 4, 18, 4.5, { fill: BLUE, color: BLUE, r: 1.5 })}
    {[13, 16.5].map(y => <g key={y}>{L(5.5, y, 18.5, y, INK, 1)}</g>)}</Svg>
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

// Table Design ▸ Fancy styles: arg "banded", "header" or "accent".
export function FancyTableIcon({ arg = 'banded', ...p }: IconProps) {
  const C = '#1F6FB5', x = 2.5, y = 3.5, w = 19, rows = 4, rh = 17 / 4, cols = 3, cw = w / cols
  const out: ReactElement[] = []
  if (arg !== 'accent') out.push(F(x, y, w, rh, C))
  if (arg === 'banded') for (let r = 2; r < rows; r += 2) out.push(F(x, y + r * rh, w, rh, '#d6e4f3'))
  if (arg === 'header') for (let r = 2; r < rows; r++) out.push(L(x, y + r * rh, x + w, y + r * rh, '#bbbbbb', 0.7))
  if (arg === 'accent') { out.push(L(x, y, x + w, y, C, 1.8)); out.push(L(x, y + rh, x + w, y + rh, C, 0.9)) }
  out.push(L(x, y + rows * rh, x + w, y + rows * rh, C, 1.6))
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    out.push(L(x + k * cw + 1.5, y + r * rh + rh / 2, x + (k + 1) * cw - 1.5, y + r * rh + rh / 2,
      r === 0 ? (arg === 'accent' ? C : '#ffffff') : '#9a9a9a', 0.9))
  }
  return <Svg {...p}><g>{out.map((e, i) => <g key={i}>{e}</g>)}</g></Svg>
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

// The Settings button: a gear.
export function SettingsIcon(p: IconProps) {
  const teeth: string[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    const [c, s] = [Math.cos(a), Math.sin(a)]
    teeth.push(`M${12 + 6.2 * c - 1.4 * s} ${12 + 6.2 * s + 1.4 * c}L${12 + 9 * c - 1.2 * s} ${12 + 9 * s + 1.2 * c}`
      + `L${12 + 9 * c + 1.2 * s} ${12 + 9 * s - 1.2 * c}L${12 + 6.2 * c + 1.4 * s} ${12 + 6.2 * s - 1.4 * c}Z`)
  }
  return <Svg {...p}>
    <path d={teeth.join('')} fill={BLUE} />
    {C(12, 12, 6.6, BLUE, 1.6, PAPER)}
    {C(12, 12, 2.4, BLUE, 1.4, PAPER)}
  </Svg>
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
  tb_save: TbSave, tb_print: TbPrint, tb_new: TbNew, tb_open: TbOpen, tb_docx: TbDocx, tb_pdf: TbPdf,
  repaginate: Repaginate, mode_editing: ModeEditing, mode_reviewing: ModeReviewing, mode_viewing: ModeViewing, share: ShareIcon, tb_undo: (p: IconProps) => <TbUndoArrow {...p} mirror={false} />,
  tb_redo: (p: IconProps) => <TbUndoArrow {...p} mirror />,
  bold: Bold, italic: Italic, underline: Underline, strike: Strike,
  subscript: Subscript, superscript: Superscript, smallcaps: Smallcaps,
  code: Code, highlight: Highlight, bullet_list: BulletList,
  shapes: Shapes, chart: Chart, smartart: SmartArt, screenshot: Screenshot,
  toc: Toc, table_of_figures: TableOfFigures, update_toc: UpdateToc, remove_toc: RemoveToc,
  themes: Themes, design_colors: DesignColors, design_fonts: DesignFonts, para_spacing: ParaSpacing,
  set_default: SetDefault, watermark: Watermark, page_color: PageColor, page_borders: PageBorders,
  style_set_tile: StyleSetTile,
  draw_tool: DrawTool, eraser_tool: EraserTool, add_pen: AddPen, ink_pen: InkPen,
  pref_general: PrefGeneral, pref_ribbon: PrefRibbon, pref_edit: PrefEdit, pref_autocorrect: PrefAutoCorrect,
  pref_access: PrefAccess, pref_user: PrefUser, pref_files: PrefFiles,
  track_changes: TrackChanges, markup_view: MarkupView, markup_options: MarkupOptions,
  grow_font: GrowFont, shrink_font: ShrinkFont, change_case: ChangeCase, clear_format: ClearFormat,
  font_color: FontColor, underline_style: UnderlineStyle,
  multilevel_list: MultilevelList, indent_dec: IndentDec, indent_inc: IndentInc, line_spacing: LineSpacing,
  para_borders: ParaBorders,
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
  citation: Citation, manage_references: ManageReferences, refs_zotero: RefsZotero, refs_mendeley: RefsMendeley, coffee: Coffee, your_name: YourName, refs_endnote: RefsEndNote, refs_import: RefsImport, refs_bib: RefsBib, refs_kherveref: RefsKherveRef, bibliography: Bibliography, cross_ref: CrossRef, math_inline: MathInline,
  math_block: MathBlock, symbol: Symbol, equation_builder: EquationBuilder,
  chemistry: Chemistry, chemfig_structure: ChemfigStructure,
  one_column: OneColumn, two_columns: TwoColumns,
  three_columns: ThreeColumns, page_break: PageBreak,
  breaks: Breaks, column_break: ColumnBreak, section_next: SectionNext, section_odd: SectionOdd,
  line_numbers: LineNumbers, hyphenation: Hyphenation,
  hf_header: HfHeader, hf_footer: HfFooter, hf_pagenum: HfPageNum, hf_datetime: HfDateTime, hf_field: HfField,
  hf_picture: HfPicture, hf_goto_header: HfGotoHeader, hf_goto_footer: HfGotoFooter, hf_prev: HfPrev, hf_next: HfNext,
  hf_link: HfLink, hf_close: HfClose, hf_top: HfTop, hf_bottom: HfBottom,
  horizontal_rule: HorizontalRule, title_date: TitleDate, zoom_in: ZoomIn, zoom_out: ZoomOut,
  fit_width: FitWidth, pdf_follow: PdfFollow, documents_panel: DocumentsPanel, split_documents: SplitDocuments, heading: Heading, paste: Paste, cut: Cut, copy: Copy,
  table_row_above: TableRowAbove, table_row_below: TableRowBelow,
  table_col_left: TableColLeft, table_col_right: TableColRight,
  table_delete_row: TableDeleteRow, table_delete_col: TableDeleteCol,
  table_delete: TableDelete, table_style_plain: TableStylePlain,
  table_style_booktabs: TableStyleBooktabs, picture_delete: PictureDelete,
  picture_edit: PictureEdit, picture_width: PictureWidth,
  equation_numbered: EquationNumbered, equation_delete: EquationDelete,
  page_size: PageSize, page_margins: PageMargins, paper_thumb: PaperThumb, margin_thumb: MarginThumb,
  orientation: Orientation, space_before: SpaceBefore, space_after: SpaceAfter,
  page_view: PageView, console_view: ConsoleView, pdf_detach: PdfDetach,
  theorem: Theorem, callout: Callout, move_up: MoveUp, move_down: MoveDown, caption: Caption, table_style_icon: TableStyleIcon, fancy_table: FancyTableIcon, element: ElementIcon,
  table_merge: TableMerge, table_split: TableSplit, sort_icon: SortIcon,
  shading_icon: ShadingIcon, header_row: HeaderRow,
  repeat_header: RepeatHeader, help_icon: HelpIcon, settings: SettingsIcon,
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


// Insert ▸ Elements, Layout ▸ Margin Note, Design ▸ Chapter Titles and
// their tabs' options. arg picks the picture.
const starPath = (cx: number, cy: number, r: number) => Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r
  return `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
}).join(' ')

export function ElementIcon({ arg = 'checklist', ...p }: IconProps) {
  const box = (x: number, y: number, on: boolean, round = false) => round
    ? <g><circle cx={x + 2.5} cy={y + 2.5} r={2.5} stroke={BLUE} strokeWidth={1.1} fill={on ? '#d6e4f3' : 'none'} />
      {on && <polyline points={`${x + 1},${y + 2.6} ${x + 2.2},${y + 3.8} ${x + 4.2},${y + 1.4}`} stroke={BLUE} strokeWidth={1.2} fill='none' />}</g>
    : <g>{R(x, y, 5, 5, { color: BLUE, lw: 1.1, r: 0.8, fill: on ? '#d6e4f3' : 'none' })}
      {on && <polyline points={`${x + 1},${y + 2.6} ${x + 2.2},${y + 3.8} ${x + 4.2},${y + 1.4}`} stroke={BLUE} strokeWidth={1.2} fill='none' />}</g>
  const bar = (y: number, w: number, h = 3, r = 1.5) => <g><rect x={3} y={y} width={18} height={h} rx={r} fill='#d6e4f3' /><rect x={3} y={y} width={w} height={h} rx={r} fill={BLUE} /></g>
  switch (arg) {
    case 'checklist': case 'ck_box': case 'ck_circle': {
      const round = arg === 'ck_circle'
      return <Svg {...p}>{box(3, 3, true, round)}{L(10, 5.5, 21, 5.5, INK, 1.2)}{box(3, 10, true, round)}{L(10, 12.5, 19, 12.5, INK, 1.2)}
        {box(3, 17, false, round)}{L(10, 19.5, 20, 19.5, INK, 1.2)}</Svg>
    }
    case 'ck_cols': return <Svg {...p}>{box(2, 4, true)}{L(8, 6.5, 11, 6.5)}{box(2, 13, false)}{L(8, 15.5, 11, 15.5)}{box(13, 4, true)}{L(19, 6.5, 22, 6.5)}{box(13, 13, false)}{L(19, 15.5, 22, 15.5)}</Svg>
    case 'ck_grey': return <Svg {...p}>{box(3, 6, true)}{L(10, 8.5, 21, 8.5, '#aaaaaa', 1.6)}{box(3, 14, false)}{L(10, 16.5, 19, 16.5, INK, 1.6)}</Svg>
    case 'ck_tick': return <Svg {...p}>{box(3, 4, true)}{box(3, 11, true)}{box(3, 18, true)}{L(10, 6.5, 20, 6.5)}{L(10, 13.5, 20, 13.5)}{L(10, 20.5, 20, 20.5)}</Svg>
    case 'ck_untick': return <Svg {...p}>{box(3, 4, false)}{box(3, 11, false)}{box(3, 18, false)}{L(10, 6.5, 20, 6.5)}{L(10, 13.5, 20, 13.5)}{L(10, 20.5, 20, 20.5)}</Svg>
    case 'progress': case 'pg_rounded': return <Svg {...p}>{bar(4, 16)}{bar(10.5, 11)}{bar(17, 6)}</Svg>
    case 'pg_square': return <Svg {...p}>{bar(4, 16, 3, 0)}{bar(10.5, 11, 3, 0)}{bar(17, 6, 3, 0)}</Svg>
    case 'pg_thin': return <Svg {...p}>{bar(5, 16, 1.4, 0.7)}{bar(11.5, 11, 1.4, 0.7)}{bar(18, 6, 1.4, 0.7)}</Svg>
    case 'pg_short': return <Svg {...p}><rect x={3} y={10.5} width={8} height={3} rx={1.5} fill={BLUE} /></Svg>
    case 'pg_medium': return <Svg {...p}><rect x={3} y={10.5} width={13} height={3} rx={1.5} fill={BLUE} /></Svg>
    case 'pg_long': return <Svg {...p}><rect x={3} y={10.5} width={18} height={3} rx={1.5} fill={BLUE} /></Svg>
    case 'pg_percent': return <Svg {...p}>{T([2, 4, 20, 16], '%', { size: 15, bold: true, color: BLUE })}</Svg>
    case 'timeline': case 'tl_vertical': return <Svg {...p}>{L(8, 4, 8, 20, '#9fb6d8', 1.6)}{D(8, 5, 2, BLUE)}{D(8, 12, 2, BLUE)}{D(8, 19, 2, BLUE)}
      {L(12, 5, 21, 5, INK, 1.2)}{L(12, 12, 19, 12, INK, 1.2)}{L(12, 19, 20, 19, INK, 1.2)}{L(2, 5, 5, 5, BLUE, 1.2)}{L(2, 12, 5, 12, BLUE, 1.2)}{L(2, 19, 5, 19, BLUE, 1.2)}</Svg>
    case 'tl_horizontal': return <Svg {...p}>{L(2, 12, 22, 12, '#9fb6d8', 1.6)}{D(5, 12, 2, BLUE)}{D(12, 12, 2, BLUE)}{D(19, 12, 2, BLUE)}
      {L(3.5, 7, 6.5, 7, BLUE, 1.2)}{L(10.5, 7, 13.5, 7, BLUE, 1.2)}{L(17.5, 7, 20.5, 7, BLUE, 1.2)}{L(3, 17, 7, 17)}{L(10, 17, 14, 17)}{L(17, 17, 21, 17)}</Svg>
    case 'tl_add': return <Svg {...p}>{L(8, 4, 8, 20, '#9fb6d8', 1.6)}{D(8, 6, 2, BLUE)}{D(8, 13, 2, BLUE)}{L(12, 6, 20, 6)}{L(12, 13, 18, 13)}
      {L(16, 19, 22, 19, GREEN, 1.8)}{L(19, 16, 19, 22, GREEN, 1.8)}</Svg>
    case 'qrcode': case 'qr_medium': case 'qr_small': case 'qr_large': {
      const k = arg === 'qr_small' ? 0.7 : arg === 'qr_large' ? 1.15 : 1
      const o = 12 - 9 * k, u = 18 * k / 9
      const cells = [[0, 0], [0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1], [2, 2], [4, 4], [5, 3], [3, 5], [6, 6], [4, 6], [6, 4], [8, 8], [7, 5], [5, 7]]
      const finder = (x: number, y: number) => <g>{R(o + x * u, o + y * u, 3 * u, 3 * u, { color: INK, lw: 1, r: 0 })}{F(o + (x + 1) * u, o + (y + 1) * u, u, u, INK)}</g>
      return <Svg {...p}>{finder(0, 0)}{finder(6, 0)}{finder(0, 6)}{cells.filter(([a, b]) => a > 3 || b > 3).map(([a, b], i) => <g key={i}>{F(o + a * u, o + b * u, u, u, INK)}</g>)}</Svg>
    }
    case 'align_left': return <Svg {...p}>{R(3, 6, 9, 9, { color: BLUE, lw: 1.2, r: 0 })}{L(3, 19, 21, 19, '#aaaaaa', 1)}</Svg>
    case 'align_center': return <Svg {...p}>{R(7.5, 6, 9, 9, { color: BLUE, lw: 1.2, r: 0 })}{L(3, 19, 21, 19, '#aaaaaa', 1)}</Svg>
    case 'align_right': return <Svg {...p}>{R(12, 6, 9, 9, { color: BLUE, lw: 1.2, r: 0 })}{L(3, 19, 21, 19, '#aaaaaa', 1)}</Svg>
    case 'caption': return <Svg {...p}>{R(6, 3, 12, 12, { color: BLUE, lw: 1.2, r: 0 })}{L(5, 19, 19, 19, INK, 1.4)}</Svg>
    case 'code': case 'cd_light': case 'cd_dark': case 'cd_plain': {
      const bg = arg === 'cd_dark' ? '#263238' : arg === 'cd_plain' ? 'none' : '#eef2f6'
      const fg = arg === 'cd_dark' ? '#82aaff' : BLUE
      return <Svg {...p}>{R(2.5, 4, 19, 16, { color: arg === 'cd_plain' ? '#aaaaaa' : '#8a9bb0', fill: bg, lw: 1, r: 1.5 })}
        <polyline points='9,8.5 5.5,12 9,15.5' stroke={fg} strokeWidth={1.6} fill='none' /><polyline points='15,8.5 18.5,12 15,15.5' stroke={fg} strokeWidth={1.6} fill='none' />
        {L(13, 8, 11, 16, arg === 'cd_dark' ? '#eceff1' : INK, 1.3)}</Svg>
    }
    case 'cd_numbers': return <Svg {...p}>{T([1, 2, 6, 6], '1', { size: 6, color: '#888' })}{T([1, 9, 6, 6], '2', { size: 6, color: '#888' })}{T([1, 16, 6, 6], '3', { size: 6, color: '#888' })}
      {L(8, 5, 20, 5, BLUE, 1.3)}{L(8, 12, 17, 12, INK, 1.3)}{L(8, 19, 19, 19, INK, 1.3)}</Svg>
    case 'cd_frame': return <Svg {...p}>{R(3, 4, 18, 16, { color: INK, lw: 1.2, r: 0 })}{L(6, 9, 16, 9, BLUE, 1.3)}{L(6, 14, 18, 14, INK, 1.3)}</Svg>
    case 'cd_title': return <Svg {...p}>{L(7, 3.5, 17, 3.5, INK, 1.6)}{R(3, 7, 18, 13, { color: '#8a9bb0', fill: '#eef2f6', lw: 1, r: 1 })}{L(6, 11, 15, 11, BLUE, 1.2)}{L(6, 15, 17, 15, INK, 1.2)}</Svg>
    case 'cd_lang': return <Svg {...p}>{T([1, 3, 22, 18], 'Py', { size: 11, bold: true, color: BLUE })}</Svg>
    case 'dropcap': case 'dc_dropped': case 'dc_margin': {
      const x = arg === 'dc_margin' ? 0 : 2
      return <Svg {...p}>{T([x, 2, 10, 13], 'A', { size: 15, bold: true, color: BLUE, family: 'Georgia, serif' })}
        {L(13, 5, 22, 5)}{L(13, 9.5, 22, 9.5)}{L(arg === 'dc_margin' ? 10 : 13, 14, 22, 14)}{L(2, 18.5, 22, 18.5)}</Svg>
    }
    case 'dc_lines': return <Svg {...p}>{T([1, 1, 11, 15], 'A', { size: 17, bold: true, color: BLUE, family: 'Georgia, serif' })}{L(13, 4, 22, 4)}{L(13, 8.5, 22, 8.5)}{L(13, 13, 22, 13)}{L(2, 18, 22, 18)}</Svg>
    case 'dc_smallcaps': return <Svg {...p}>{T([1, 4, 22, 16], 'Aᴀ', { size: 12, color: INK, family: 'Georgia, serif' })}</Svg>
    case 'marginnote': case 'mn_box': case 'mn_line': case 'mn_plain': {
      const note = arg === 'mn_line' ? <g>{L(15, 5, 15, 13, BLUE, 1.6)}{L(17, 6, 22, 6)}{L(17, 9, 21, 9)}{L(17, 12, 22, 12)}</g>
        : arg === 'mn_plain' ? <g>{L(15, 6, 22, 6, BLUE, 1.2)}{L(15, 9, 21, 9, BLUE, 1.2)}{L(15, 12, 22, 12, BLUE, 1.2)}</g>
          : <g>{R(14.5, 4, 8, 10, { color: BLUE, fill: '#d6e4f3', lw: 1, r: 0.8 })}{L(16, 7, 21, 7, INK, 0.9)}{L(16, 10, 20, 10, INK, 0.9)}</g>
      return <Svg {...p}>{R(1.5, 2, 21, 20, { color: '#aaaaaa', lw: 0.9, r: 0.5 })}{L(4, 6, 12, 6)}{L(4, 9.5, 12, 9.5)}{L(4, 13, 12, 13)}{L(4, 16.5, 12, 16.5)}
        {D(12.6, 9.2, 1, BLUE)}{note}</Svg>
    }
    case 'mn_room': return <Svg {...p}>{R(2, 3, 20, 18, { color: '#aaaaaa', lw: 0.9, r: 0.5 })}{L(13, 3, 13, 21, BLUE, 1, '1.5 1.5')}{L(4, 7, 11, 7)}{L(4, 11, 11, 11)}{L(4, 15, 11, 15)}
      <polyline points='15,12 20,12' stroke={GREEN} strokeWidth={1.4} fill='none' /><polyline points='18,10 20,12 18,14' stroke={GREEN} strokeWidth={1.4} fill='none' /></Svg>
    case 'chapter': return <Svg {...p}>{Page(3, 2, 18, 20, 3.5)}{T([5, 4, 7, 10], '1', { size: 11, bold: true, color: BLUE })}{L(6, 15, 17, 15, INK, 1.8)}{L(6, 18.5, 15, 18.5, '#aaaaaa', 1)}</Svg>
    case 'edit': return <Svg {...p}>{R(3, 5, 13, 15, { color: '#8a9bb0', lw: 1, r: 1 })}{L(6, 9, 13, 9)}{L(6, 12.5, 12, 12.5)}
      <polygon points='19,4 22,7 14,15 11,16 12,13' stroke={BLUE} strokeWidth={1.2} fill='#d6e4f3' /></Svg>
    case 'close': return <Svg {...p}>{R(3, 3, 18, 18, { color: '#8a9bb0', lw: 1, r: 2 })}{L(8, 8, 16, 16, RED, 1.8)}{L(16, 8, 8, 16, RED, 1.8)}</Svg>
    case 'delete': return <Svg {...p}>{R(6, 7, 12, 14, { color: INK, lw: 1.3, r: 1 })}{L(4, 6, 20, 6, INK, 1.4)}{L(10, 3.5, 14, 3.5, INK, 1.4)}{L(10, 10, 10, 18, RED, 1.2)}{L(14, 10, 14, 18, RED, 1.2)}</Svg>
    case 'after': return <Svg {...p}>{R(3, 3, 18, 8, { color: BLUE, fill: '#d6e4f3', lw: 1, r: 1 })}{L(4, 16, 20, 16)}{L(4, 20, 14, 20)}<polyline points='12,12 12,14' stroke={GREEN} strokeWidth={1.4} /></Svg>
    case 'color': return <Svg {...p}><circle cx={12} cy={12} r={8} fill='none' stroke={INK} strokeWidth={1} />
      <path d='M12 4 A8 8 0 0 1 19.4 15 L12 12 Z' fill='#1F6FB5' /><path d='M19.4 15 A8 8 0 0 1 4.6 15 L12 12 Z' fill='#2E7D32' /><path d='M4.6 15 A8 8 0 0 1 12 4 L12 12 Z' fill='#E65100' /></Svg>
    case 'titlepage': return <Svg {...p}>{Page(3, 2, 18, 20, 3.5)}{F(3.7, 2.7, 16.6, 7, BLUE)}{L(6, 6, 15, 6, '#ffffff', 1.8)}{L(6, 13, 12, 13, INK, 1)}{L(6, 18, 10, 18, '#aaaaaa', 1)}</Svg>
    case 'pageedge': return <Svg {...p}>{Page(3, 2, 18, 20, 3.5)}{F(3.7, 2.7, 16.6, 3, BLUE)}{F(18, 9, 2.3, 4, BLUE)}{L(6, 10, 15, 10)}{L(6, 13.5, 15, 13.5)}{L(6, 17, 13, 17)}</Svg>
    case 'pullquote': case 'pq_rules': return <Svg {...p}>{L(3, 5, 21, 5, BLUE, 1.2)}{T([3, 6, 18, 12], '“ ”', { size: 13, bold: true, color: BLUE, family: 'Georgia, serif' })}{L(3, 19, 21, 19, BLUE, 1.2)}</Svg>
    case 'pq_bar': return <Svg {...p}>{L(5, 4, 5, 20, BLUE, 2.6)}{L(9, 8, 20, 8, BLUE, 1.4)}{L(9, 12, 18, 12, BLUE, 1.4)}{L(9, 16, 14, 16, INK, 1)}</Svg>
    case 'pq_marks': return <Svg {...p}>{R(2.5, 5, 19, 14, { color: 'none', fill: '#e4edf7', r: 1.5 })}{T([2, 2, 9, 12], '“', { size: 16, bold: true, color: BLUE, family: 'Georgia, serif' })}{L(10, 11, 19, 11, BLUE, 1.3)}{L(8, 15, 17, 15, BLUE, 1.3)}</Svg>
    case 'sidebar': case 'sb_right': return <Svg {...p}>{L(2, 5, 12, 5)}{L(2, 9, 12, 9)}{L(2, 13, 12, 13)}{L(2, 17, 22, 17)}{L(2, 21, 20, 21)}{R(14, 3, 8, 12, { color: 'none', fill: '#d6e4f3', r: 0 })}{L(14, 3, 22, 3, BLUE, 1.6)}</Svg>
    case 'sb_left': return <Svg {...p}>{R(2, 3, 8, 12, { color: 'none', fill: '#d6e4f3', r: 0 })}{L(2, 3, 10, 3, BLUE, 1.6)}{L(12, 5, 22, 5)}{L(12, 9, 22, 9)}{L(12, 13, 22, 13)}{L(2, 17, 22, 17)}{L(2, 21, 20, 21)}</Svg>
    case 'sb_full': return <Svg {...p}>{R(2, 5, 20, 14, { color: 'none', fill: '#d6e4f3', r: 0 })}{L(2, 5, 22, 5, BLUE, 1.6)}{L(5, 10, 19, 10)}{L(5, 14, 17, 14)}</Svg>
    case 'rating': return <Svg {...p}>{[0, 1, 2].map(i => <polygon key={i} points={starPath(4.5 + i * 7.5, 12, 3.6)} fill={i < 2 ? '#F9A825' : 'none'} stroke='#F9A825' strokeWidth={1} />)}</Svg>
    case 'rt_dots': return <Svg {...p}>{[0, 1, 2, 3].map(i => <circle key={i} cx={4 + i * 5.4} cy={12} r={2.2} fill={i < 3 ? GREEN : 'none'} stroke={GREEN} strokeWidth={1} />)}</Svg>
    case 'gauge': return <Svg {...p}><path d='M3 17 A9 9 0 0 1 21 17' fill='none' stroke='#d6e4f3' strokeWidth={3.5} /><path d='M3 17 A9 9 0 0 1 16.5 9.2' fill='none' stroke={BLUE} strokeWidth={3.5} />{T([7, 11, 10, 8], '%', { size: 8, bold: true, color: BLUE })}</Svg>
    case 'gg_ring': return <Svg {...p}><circle cx={12} cy={12} r={8} fill='none' stroke='#d6e4f3' strokeWidth={3.5} /><path d='M12 4 A8 8 0 1 1 4.4 14.5' fill='none' stroke={BLUE} strokeWidth={3.5} /></Svg>
    case 'steps': return <Svg {...p}>{[0, 1, 2].map(i => <g key={i}><circle cx={4 + i * 8} cy={12} r={3.2} fill={BLUE} />{T([1 + i * 8, 8, 6, 8], String(i + 1), { size: 6, bold: true, color: '#fff' })}</g>)}{L(7.5, 12, 8.6, 12, BLUE, 1.2)}{L(15.5, 12, 16.6, 12, BLUE, 1.2)}</Svg>
    case 'st_vertical': return <Svg {...p}>{[0, 1, 2].map(i => <g key={i}><circle cx={5} cy={4.5 + i * 7.5} r={2.8} fill={BLUE} />{L(10, 4.5 + i * 7.5, 21, 4.5 + i * 7.5)}</g>)}</Svg>
    case 'gantt': return <Svg {...p}>{L(2, 3, 2, 21, '#aaaaaa', 1)}{R(4, 4, 8, 3, { color: 'none', fill: BLUE, r: 1 })}{R(8, 10, 9, 3, { color: 'none', fill: BLUE, r: 1 })}{R(13, 16, 7, 3, { color: 'none', fill: BLUE, r: 1 })}<polygon points='21,20.5 22.5,22 21,23.5 19.5,22' fill={RED} /></Svg>
    case 'chart': return <Svg {...p}>{L(3, 3, 3, 21, '#888', 1)}{L(3, 21, 21, 21, '#888', 1)}{F(5, 12, 3.2, 9, BLUE)}{F(9.5, 7, 3.2, 14, '#E65100')}{F(14, 10, 3.2, 11, BLUE)}{F(18.5, 5, 2.5, 16, '#E65100')}</Svg>
    case 'ch_hbar': return <Svg {...p}>{L(3, 3, 3, 21, '#888', 1)}{F(3, 5, 14, 3.2, BLUE)}{F(3, 10.4, 18, 3.2, '#E65100')}{F(3, 15.8, 10, 3.2, BLUE)}</Svg>
    case 'ch_line': return <Svg {...p}>{L(3, 3, 3, 21, '#888', 1)}{L(3, 21, 21, 21, '#888', 1)}<polyline points='5,17 9,11 13,13 17,6 20,8' fill='none' stroke={BLUE} strokeWidth={1.6} /><polyline points='5,19 9,16 13,17 17,12 20,13' fill='none' stroke='#E65100' strokeWidth={1.6} /></Svg>
    case 'ch_pie': return <Svg {...p}><circle cx={12} cy={12} r={9} fill={BLUE} /><path d='M12 12 L12 3 A9 9 0 0 1 20.6 14.6 Z' fill='#E65100' /><path d='M12 12 L20.6 14.6 A9 9 0 0 1 9 20.5 Z' fill={GREEN} /></Svg>
    case 'icon': return <Svg {...p}>{T([1, 1, 11, 11], '☎', { size: 10, color: BLUE })}{T([12, 1, 11, 11], '✉', { size: 10, color: '#E65100' })}{T([1, 12, 11, 11], '★', { size: 10, color: '#F9A825' })}{T([12, 12, 11, 11], '⚠', { size: 10, color: RED })}</Svg>
    default: return <Svg {...p}>{R(4, 4, 16, 16, { color: BLUE })}</Svg>
  }
}

// Insert ▸ Contents: a page of entries with dotted leaders and page numbers.
export function Toc(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 17, 20, 3.5)}
    {L(6, 7, 12, 7, BLUE, 1.6)}{L(12.5, 7, 15.5, 7, INK, 0.9, '0.8 1.2')}{L(16.5, 7, 17, 7, INK, 1.4)}
    {L(8, 11, 13, 11, INK, 1.2)}{L(13.5, 11, 15.5, 11, INK, 0.9, '0.8 1.2')}{L(16.5, 11, 17, 11, INK, 1.4)}
    {L(8, 14, 12, 14, INK, 1.2)}{L(12.5, 14, 15.5, 14, INK, 0.9, '0.8 1.2')}{L(16.5, 14, 17, 14, INK, 1.4)}
    {L(6, 18, 11, 18, BLUE, 1.6)}{L(11.5, 18, 15.5, 18, INK, 0.9, '0.8 1.2')}{L(16.5, 18, 17, 18, INK, 1.4)}</Svg>
}
export function TableOfFigures(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 17, 20, 3.5)}
    {R(6, 5.5, 6, 4.5, { fill: '#cfe3f8', color: BLUE, lw: 1, r: 0.5 })}{P([[6.5, 9.5], [8.5, 7.3], [10, 8.6], [11.5, 9.5]], { closed: false, color: GREEN, lw: 0.9 })}
    {L(6, 13, 13, 13, INK, 1.2)}{L(13.5, 13, 15.5, 13, INK, 0.9, '0.8 1.2')}{L(16.5, 13, 17, 13, INK, 1.4)}
    {L(6, 16.5, 12, 16.5, INK, 1.2)}{L(12.5, 16.5, 15.5, 16.5, INK, 0.9, '0.8 1.2')}{L(16.5, 16.5, 17, 16.5, INK, 1.4)}</Svg>
}
export function UpdateToc(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 14, 18, 3)}{L(6, 7, 13, 7, INK, 1.1)}{L(6, 10, 12, 10, INK, 1.1)}{L(6, 13, 11, 13, INK, 1.1)}
    <path d='M21 15.5a4.5 4.5 0 1 1-1.3-3.2' fill='none' stroke={GREEN} strokeWidth={1.6} />
    {P([[20.2, 10], [20.4, 13], [17.4, 12.6]], { fill: GREEN, color: GREEN, lw: 1 })}</Svg>
}
export function RemoveToc(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 14, 18, 3)}{L(6, 7, 13, 7, INK, 1.1)}{L(6, 10, 12, 10, INK, 1.1)}
    {L(14, 14, 21, 21, RED, 2)}{L(21, 14, 14, 21, RED, 2)}</Svg>
}
// Design tab.
export function Themes(p: IconProps) {
  return <Svg {...p}>{R(2.5, 2.5, 19, 19, { fill: PAPER, lw: 1.2, r: 1 })}
    {T([3, 2, 12, 11], 'Aa', { size: 10, color: INK })}
    {F(4, 15, 4, 4, '#4472C4')}{F(8.5, 15, 4, 4, '#ED7D31')}{F(13, 15, 4, 4, '#A5A5A5')}{F(17.5, 15, 3, 4, '#FFC000')}</Svg>
}
export function DesignColors(p: IconProps) {
  const [a, b] = (p.arg ?? '#4472C4|#ED7D31').split('|')
  return <Svg {...p}>{F(3, 3, 9, 9, a)}{F(12, 3, 9, 9, b)}{F(3, 12, 9, 9, '#FFC000')}{F(12, 12, 9, 9, '#A5A5A5')}
    {R(3, 3, 18, 18, { lw: 0.6, r: 0 })}</Svg>
}
export function DesignFonts(p: IconProps) {
  return <Svg {...p}>{T([0, 1, 24, 22], 'Aa', { size: 17, family: SERIF })}</Svg>
}
export function ParaSpacing(p: IconProps) {
  return <Svg {...p}>{L(9, 5, 21, 5)}{L(9, 9, 21, 9)}{L(9, 15, 21, 15)}{L(9, 19, 17, 19)}
    {L(5, 4, 5, 20, BLUE, 1.2)}{P([[3, 6.5], [5, 3.5], [7, 6.5]], { closed: false, color: BLUE, lw: 1.2 })}
    {P([[3, 17.5], [5, 20.5], [7, 17.5]], { closed: false, color: BLUE, lw: 1.2 })}</Svg>
}
export function SetDefault(p: IconProps) {
  return <Svg {...p}>{C(12, 12, 8.5, GREEN, 1.6)}{P([[7.5, 12.5], [10.8, 15.6], [16.8, 8.8]], { closed: false, color: GREEN, lw: 1.8 })}</Svg>
}
export function Watermark(p: IconProps) {
  return <Svg {...p}>{Page(4, 2, 16, 20, 3.5)}
    <text x={12} y={13.5} textAnchor='middle' dominantBaseline='central' fontFamily={SANS} fontSize={9} fontWeight={700}
      fill='none' stroke={RED} strokeWidth={0.7} transform='rotate(-45 12 13)'>A</text></Svg>
}
export function PageColor(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 14, 18, 3)}
    {P([[13, 9], [19, 9], [20, 16], [12, 16]], { fill: p.arg ?? '#FFF2CC', color: INK, lw: 1.1 })}
    <path d='M21 17.5c0 1.5 1.6 1.5 1.6 0l-0.8-1.6z' fill={BLUE} stroke='none' />
    {F(3, 21, 18, 2.5, p.arg ?? '#FFC000')}</Svg>
}
export function PageBorders(p: IconProps) {
  return <Svg {...p}>{R(5, 2, 14, 20, { fill: PAPER, lw: 1.4, r: 0 })}{R(7, 4, 10, 16, { color: '#d9822b', lw: 1.6, r: 0 })}</Svg>
}
// Design ▸ Document Formatting: a page in a style set (arg "set|accent|second").
export function StyleSetTile({ arg = 'default|#2F5496|#ED7D31', width = 64, height = 52 }: IconProps) {
  const [set, accent, second] = arg.split('|')
  const w = width, h = height
  const col = set === 'default' ? '#222' : accent
  const sans = set === 'basic' || set === 'shaded' || set === 'lines_accent'
  const fam = sans ? SANS : SERIF
  const title = set === 'elegant' ? 'TITLE' : 'Title'
  const anchor = set === 'centered' ? 'middle' : 'start'
  const x = set === 'centered' ? w / 2 : 5
  const lines = [0, 1, 2, 3].map(i => <line key={i} x1={5} x2={w - 5 - (i === 3 ? 14 : 0)} y1={33 + i * 4.5} y2={33 + i * 4.5} stroke='#9aa0a6' strokeWidth={1} />)
  return (
    <svg className='kicon' width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden='true'>
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} fill='#fff' stroke='#d0d0d0' />
      <text x={x} y={10} textAnchor={anchor} dominantBaseline='central' fontFamily={fam} fontSize={10}
        fontWeight={set === 'elegant' || set === 'lines_accent' ? 400 : 700} fill={set === 'shaded' ? '#222' : col}>{title}</text>
      {set === 'shaded' && <rect x={4} y={17} width={w - 8} height={9} fill={accent} />}
      <text x={set === 'centered' ? w / 2 : set === 'shaded' ? 7 : 5} y={21.5} textAnchor={anchor} dominantBaseline='central'
        fontFamily={fam} fontSize={7} fontWeight={set === 'elegant' ? 400 : 700}
        fill={set === 'shaded' ? '#fff' : col}>{set === 'elegant' ? 'HEADING 1' : set === 'casual' ? <><tspan fill={second}>1 </tspan>Heading 1</> : 'Heading 1'}</text>
      {(set === 'lines' || set === 'lines_accent') && <line x1={5} x2={w - 5} y1={27} y2={27} stroke={set === 'lines' ? '#222' : second} strokeWidth={set === 'lines' ? 0.7 : 1.3} />}
      {lines}
    </svg>
  )
}


// Preferences window panes.
export function PrefGeneral(p: IconProps) {
  return <Svg {...p}>{R(6, 3, 12, 18, { fill: PAPER, lw: 1.3, r: 2 })}{R(9, 6, 6, 12, { lw: 1.1, r: 1 })}{R(9.5, 6.5, 5, 5.5, { fill: '#9aa0a6', lw: 0, r: 0.8 })}</Svg>
}
export function PrefRibbon(p: IconProps) {
  return <Svg {...p}>{R(2.5, 4, 19, 16, { fill: PAPER, lw: 1.3, r: 1.5 })}{F(3.2, 4.7, 17.6, 3.3, '#9ec5f8')}
    {L(5, 11, 9, 11, INK, 1.1)}{L(11, 11, 14, 11, INK, 1.1)}{L(16, 11, 19, 11, INK, 1.1)}{L(5, 14, 8, 14, INK, 1.1)}{L(11, 14, 15, 14, INK, 1.1)}</Svg>
}
export function PrefEdit(p: IconProps) {
  return <Svg {...p}>{Page(3, 2, 14, 19, 3)}{L(6, 8, 13, 8, INK, 1.1)}{L(6, 11, 12, 11, INK, 1.1)}{L(6, 14, 10, 14, INK, 1.1)}
    {P([[20.5, 8], [22.5, 10], [14, 18.5], [11.5, 19], [12, 16.5]], { fill: '#9ec5f8', color: BLUE, lw: 1 })}</Svg>
}
export function PrefAutoCorrect(p: IconProps) {
  return <Svg {...p}>{T([0, 6, 16, 12], 'ABC', { size: 7.5, bold: true })}{L(1.5, 17, 14.5, 17, RED, 1.4, '1.5 1')}
    {P([[19, 3], [15.5, 11], [18.5, 11], [16.5, 20], [21.5, 9.5], [18.5, 9.5], [20.5, 3]], { fill: '#f39c12', color: '#d35400', lw: 0.8 })}</Svg>
}
export function PrefAccess(p: IconProps) {
  return <Svg {...p}>{Page(4, 2, 15, 20, 3.5)}{C(11.5, 8, 1.7, BLUE, 1.2, BLUE)}{L(7.5, 11, 15.5, 11, BLUE, 1.4)}
    {L(11.5, 11, 11.5, 15, BLUE, 1.4)}{L(11.5, 15, 9, 19, BLUE, 1.4)}{L(11.5, 15, 14, 19, BLUE, 1.4)}</Svg>
}
export function PrefUser(p: IconProps) {
  return <Svg {...p}>{R(2.5, 5, 19, 14, { fill: PAPER, lw: 1.3, r: 1.5 })}{F(3.2, 5.7, 17.6, 2.6, BLUE)}
    {C(8, 12.5, 2, INK, 1.1)}<path d='M4.8 17.5c0.6-2.2 5.8-2.2 6.4 0' fill='none' stroke={INK} strokeWidth={1.1} />
    {L(13, 12, 19, 12, INK, 1.1)}{L(13, 15, 18, 15, INK, 1.1)}</Svg>
}
export function PrefFiles(p: IconProps) {
  return <Svg {...p}><path d='M2.5 7.5V18.5H18V9.5H10L8.5 7.5Z' fill='#c3d6ea' stroke={INK} strokeWidth={1.2} strokeLinejoin='round' />
    {C(17, 15, 3.2, INK, 1.4, '#fff')}{L(19.3, 17.3, 22, 20, INK, 1.8)}</Svg>
}


// Draw tab.
export function DrawTool(p: IconProps) {
  return <Svg {...p}>{P([[19, 2.5], [21.5, 5], [10, 16.5], [6.5, 17.5], [7.5, 14]], { fill: PAPER, lw: 1.1 })}{L(16.5, 5, 19, 7.5, INK, 1)}
    <path d='M3 21c2-3 4 0 6-1.5s1-3 3-2.5 2 2 4 1' fill='none' stroke={RED} strokeWidth={1.3} /></Svg>
}
export function EraserTool(p: IconProps) {
  return <Svg {...p}>{P([[13, 3], [21, 11], [14, 18], [6, 10]], { fill: '#e8b8f0', color: '#8e44ad', lw: 1.1 })}
    {P([[6, 10], [14, 18], [11, 21], [3, 13]], { fill: '#fff', color: '#8e44ad', lw: 1.1 })}
    <path d='M13 21.5c2-1.5 3 0 5-1s2-1 3 0' fill='none' stroke={INK} strokeWidth={1} /></Svg>
}
export function AddPen(p: IconProps) {
  return <Svg {...p}>{L(12, 4, 12, 20, GREEN, 1.6)}{L(4, 12, 20, 12, GREEN, 1.6)}</Svg>
}
// A pen of the gallery (arg "kind|#colour"), drawn as Word's: body, collar, tip.
export function InkPen({ arg = 'pen|#000000', width = 26, height = 52 }: IconProps) {
  const [kind, color] = arg.split('|')
  const hl = kind === 'highlighter', pencil = kind === 'pencil'
  const light = /^#?f{6}$/i.test(color.replace('#', '')) || color.toUpperCase() === '#FFFFFF'
  return (
    <svg className='kicon' width={width} height={height} viewBox='0 0 26 52' aria-hidden='true'>
      <rect x={4} y={2} width={18} height={hl ? 30 : 32} rx={hl ? 1 : 2} fill={pencil ? '#8a8a8a' : color} stroke='#222' strokeWidth={1.2} />
      {pencil && <><line x1={10} y1={2} x2={10} y2={34} stroke='#555' /><line x1={16} y1={2} x2={16} y2={34} stroke='#555' /></>}
      {hl
        ? <><path d='M4 32 L22 32 L20 42 L6 42 Z' fill='#fff' stroke='#222' strokeWidth={1.2} /><path d='M7 42 L19 42 L19 47 L7 49 Z' fill={color} stroke='#222' strokeWidth={1} /></>
        : <><path d={`M4 34 L22 34 L14.5 47 L11.5 47 Z`} fill={pencil ? '#f5deb3' : '#fff'} stroke='#222' strokeWidth={1.2} />
          <path d='M11.5 47 L14.5 47 L13 50.5 Z' fill={pencil ? '#555' : light ? '#ddd' : color} stroke='#222' strokeWidth={0.8} /></>}
    </svg>
  )
}

export function Icon({ name, ...p }: IconProps & { name: string }) {
  const Draw = ICONS[name]
  return Draw ? <Draw {...p} /> : null
}
