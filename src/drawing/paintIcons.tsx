// The drawing dialog's icons (icons.py paint_tool, color_swatch,
// pen_preview): drawn on a 24-unit grid, shapes from their own geometry.
import type { ReactNode } from 'react'
import { arcPath, ARC_KINDS, polygonForKind, type Cmd } from '../core/paintModel'
import { cmdsToD } from '../core/paintRender'

const FG = '#222222'
const ACCENT = '#1a6dd8'
const ACCENT2 = '#d96b00'
const SOFT = 'rgba(26,109,216,0.235)'

type P = [number, number]
const pts = (a: P[]) => a.map(p => p.join(',')).join(' ')
const Poly = ({ p, s = FG, w = 1.6, fill = 'none', open = false }: { p: P[]; s?: string; w?: number; fill?: string; open?: boolean }) =>
  open ? <polyline points={pts(p)} fill={fill} stroke={s} strokeWidth={w} strokeLinecap='round' strokeLinejoin='round' />
    : <polygon points={pts(p)} fill={fill} stroke={s} strokeWidth={w} strokeLinecap='round' strokeLinejoin='round' />
const L = ({ a, b, s = FG, w = 1.6, dash }: { a: P; b: P; s?: string; w?: number; dash?: string }) =>
  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={s} strokeWidth={w} strokeLinecap='round' strokeDasharray={dash} />
const R = ({ x, y, w, h, s = FG, sw = 1.6, fill = 'none', r = 0, dash }: { x: number; y: number; w: number; h: number; s?: string; sw?: number; fill?: string; r?: number; dash?: string }) =>
  <rect x={x} y={y} width={w} height={h} rx={r} stroke={s} strokeWidth={sw} fill={fill} strokeDasharray={dash} strokeLinejoin='round' />
const C = ({ cx, cy, r, ry, s = FG, w = 1.6, fill = 'none' }: { cx: number; cy: number; r: number; ry?: number; s?: string; w?: number; fill?: string }) =>
  <ellipse cx={cx} cy={cy} rx={r} ry={ry ?? r} stroke={s} strokeWidth={w} fill={fill} />
const Pth = ({ d, s = FG, w = 1.6, fill = 'none' }: { d: string; s?: string; w?: number; fill?: string }) =>
  <path d={d} stroke={s} strokeWidth={w} fill={fill} strokeLinecap='round' strokeLinejoin='round' />

function zorder(up: boolean, full: boolean) {
  const back = '#b9c3cf'
  const lo = { x: 3, y: 9, w: 11, h: 11 }
  const hi = { x: 10, y: 4, w: 11, h: 11 }
  return <>
    <R {...(up ? lo : hi)} sw={1.2} fill={up ? back : ACCENT} />
    <R {...(up ? hi : lo)} sw={1.2} fill={up ? ACCENT : back} />
    {full && <L a={[3, up ? 2 : 22]} b={[8, up ? 2 : 22]} w={1.6} />}
  </>
}

function copy() {
  return <><R x={4} y={3} w={11} h={13} r={1.5} sw={1.4} /><R x={9} y={8} w={11} h={13} r={1.5} sw={1.4} fill='#ffffff' /></>
}

const DRAW: Record<string, () => ReactNode> = {
  pointer: () => <Poly p={[[6, 3], [6, 19], [10, 15], [13, 21], [15.5, 20], [12.5, 14], [18, 14]]} w={1.4} fill={FG} />,
  pencil: () => <><Poly p={[[16, 3], [21, 8], [9, 20], [4, 15]]} w={1.3} fill={ACCENT2} />
    <Poly p={[[4, 15], [9, 20], [3, 21]]} w={1.3} fill={FG} /><L a={[14, 5]} b={[19, 10]} w={1.1} /></>,
  eraser: () => <><Poly p={[[13, 3], [21, 11], [14, 18], [6, 10]]} w={1.3} fill='#f28b9b' />
    <Poly p={[[6, 10], [14, 18], [11, 21], [7, 21], [3, 17], [3, 13]]} w={1.3} fill='#ffffff' />
    <L a={[11, 21]} b={[21, 21]} w={1.3} /></>,
  bucket: () => <><Poly p={[[10, 3], [18, 11], [11, 18], [3, 10]]} w={1.4} fill={SOFT} />
    <L a={[10, 3]} b={[8, 1.5]} w={1.4} />
    <path d='M19.5,13 C22,17 22.5,20 19.5,20.5 C16.5,20 17,17 19.5,13' fill={ACCENT} /></>,
  picker: () => <><C cx={18} cy={6} r={3.2} w={1.4} fill={FG} /><L a={[15, 7]} b={[17, 9]} w={1.4} />
    <L a={[15.5, 8.5]} b={[6, 18]} w={2.2} /><L a={[6, 18]} b={[4, 20]} w={2.2} s={ACCENT} /></>,
  line: () => <><L a={[4, 20]} b={[20, 4]} w={2} /><circle cx={4} cy={20} r={2} fill={ACCENT} />
    <circle cx={20} cy={4} r={2} fill={ACCENT} /></>,
  arrow: () => <><L a={[4, 20]} b={[17, 7]} w={2} /><Poly p={[[21, 3], [19.5, 12], [12, 4.5]]} w={2} fill={FG} /></>,
  dimension: () => <><L a={[3, 7]} b={[3, 19]} w={1.3} /><L a={[21, 7]} b={[21, 19]} w={1.3} /><L a={[4, 13]} b={[20, 13]} w={1.3} />
    <Poly p={[[4, 13], [8, 11], [8, 15]]} w={1.3} fill={FG} /><Poly p={[[20, 13], [16, 11], [16, 15]]} w={1.3} fill={FG} />
    <text x={12} y={10} fontSize={7} fontWeight='bold' textAnchor='middle' fill={ACCENT} fontFamily='sans-serif'>mm</text></>,
  protractor: () => <><Pth d='M3,19 A9,14 0 0 1 21,19 Z' w={1.5} fill={SOFT} /><L a={[12, 19]} b={[17, 9]} w={1.5} s={ACCENT} /></>,
  text: () => <><text x={12} y={18.5} fontSize={19} fontWeight='bold' textAnchor='middle' fill={FG} fontFamily='Georgia, serif'>T</text>
    <L a={[19, 5]} b={[19, 19]} w={1.2} s={ACCENT} /></>,
  image: () => <><R x={3} y={4} w={18} h={16} r={2} sw={1.4} />
    <polygon points='4.5,18.5 10,11 14,15.5 16,13.5 19.5,18.5' fill={ACCENT} /><circle cx={16} cy={8.5} r={2} fill={ACCENT2} /></>,
  group: () => <><R x={2.5} y={2.5} w={19} h={19} s={ACCENT} sw={1.2} dash='3 1.5' />
    <R x={5} y={5} w={8} h={8} sw={1.5} fill={SOFT} /><C cx={15} cy={15} r={4} w={1.5} fill={SOFT} /></>,
  ungroup: () => <><R x={3.5} y={3.5} w={8} h={8} sw={1.5} fill={SOFT} /><C cx={16.5} cy={16.5} r={4} w={1.5} fill={SOFT} /></>,
  front: () => zorder(true, true),
  forward: () => zorder(true, false),
  backward: () => zorder(false, false),
  back: () => zorder(false, true),
  copy,
  paste: () => <><R x={4} y={4} w={16} h={18} r={2} sw={1.4} fill={SOFT} /><R x={8.5} y={2} w={7} h={4} r={1} sw={1.4} fill={FG} /></>,
  duplicate: () => <>{copy()}<L a={[14.5, 11.5]} b={[14.5, 17.5]} s={ACCENT} /><L a={[11.5, 14.5]} b={[17.5, 14.5]} s={ACCENT} /></>,
  delete: () => <><L a={[4, 6]} b={[20, 6]} w={1.4} /><R x={9.5} y={3} w={5} h={3} sw={1.4} />
    <Poly p={[[6, 6], [18, 6], [17, 21], [7, 21]]} w={1.4} /><L a={[10, 9.5]} b={[10, 18]} w={1.4} /><L a={[14, 9.5]} b={[14, 18]} w={1.4} /></>,
  fit: () => <><R x={6} y={6} w={12} h={12} s={ACCENT} sw={1.2} dash='3 1.5' />
    {([[3, 3, 1, 1], [21, 3, -1, 1], [3, 21, 1, -1], [21, 21, -1, -1]] as number[][]).map(([x, y, dx, dy], i) =>
      <g key={i}><L a={[x, y]} b={[x + 4 * dx, y]} /><L a={[x, y]} b={[x, y + 4 * dy]} /></g>)}</>,
  flip_h: () => <><L a={[12, 2]} b={[12, 22]} w={1.1} dash='3 2' /><Poly p={[[10, 5], [10, 19], [3, 19]]} w={1.4} fill={FG} />
    <Poly p={[[14, 5], [14, 19], [21, 19]]} w={1.4} fill={SOFT} /></>,
  flip_v: () => <g transform='translate(24,0) rotate(90)'>{DRAW.flip_h()}</g>,
  rotate: () => <><Pth d='M19,12 A7,7 0 1 1 12,5' w={1.8} /><polygon points='15.5,2 15.5,10 9.5,5.5' fill={FG} /></>,
  explode: () => <>{([[[3, 8], [10, 3]], [[14, 3], [21, 8]], [[21, 13], [21, 21]], [[3, 13], [3, 21]], [[7, 21], [17, 21]]] as P[][]).map((l, i) =>
    <L key={i} a={l[0]} b={l[1]} />)}</>,
  flowchart: () => <><R x={7} y={1.5} w={10} h={5} r={2.5} sw={1.3} fill={SOFT} /><Poly p={[[12, 9], [17, 12.5], [12, 16], [7, 12.5]]} w={1.3} fill={SOFT} />
    <R x={7} y={18.5} w={10} h={4.5} sw={1.3} fill={SOFT} /><L a={[12, 6.5]} b={[12, 9]} w={1.3} /><L a={[12, 16]} b={[12, 18.5]} w={1.3} /></>,
  electrical: () => <><L a={[2, 12]} b={[6, 12]} w={1.5} /><Poly open p={[[6, 12], [7.5, 8], [10, 16], [12.5, 8], [15, 16], [17.5, 8], [18.5, 12]]} w={1.5} />
    <L a={[18.5, 12]} b={[22, 12]} w={1.5} /></>,
  optics: () => <><L a={[2, 8]} b={[12, 12]} s='#d8000c' w={1.4} /><L a={[2, 16]} b={[12, 12]} s='#d8000c' w={1.4} /><L a={[12, 12]} b={[22, 12]} s='#d8000c' w={1.4} />
    <Pth d='M9,3 Q14,12 9,21 Q4,12 9,3' w={1.4} fill={SOFT} /></>,
  maths: () => <><L a={[3, 21]} b={[21, 21]} w={1.3} /><L a={[3, 21]} b={[3, 3]} w={1.3} />
    <Pth d='M4,19 C9,19 10,4 13,4 C16,4 17,17 21,17' s={ACCENT} /></>,
  arrows: () => <Pth d='M5.5,3 H18.5 A3,3 0 0 1 21.5,6 V12 A3,3 0 0 1 18.5,15 H12 L6,21 L7,15 H5.5 A3,3 0 0 1 2.5,12 V6 A3,3 0 0 1 5.5,3 Z' w={1.4} fill={SOFT} />,
  labware: () => <><Poly p={[[9, 2.5], [9, 9], [3.5, 20], [4.5, 21.5], [19.5, 21.5], [20.5, 20], [15, 9], [15, 2.5]]} w={1.4} fill={SOFT} />
    <L a={[6.5, 15.5]} b={[17.5, 15.5]} s={ACCENT} w={1.2} /></>,
  chemistry: () => <><Poly p={Array.from({ length: 6 }, (_, k) => [12 + 8.5 * Math.cos((90 + 60 * k) * Math.PI / 180), 12 + 8.5 * Math.sin((90 + 60 * k) * Math.PI / 180)] as P)} w={1.4} />
    <C cx={12} cy={12} r={4.8} s={ACCENT} w={1.3} /></>,
  canvas: () => <><R x={5} y={5} w={14} h={14} sw={1.4} fill='#ffffff' /><L a={[2, 5]} b={[2, 19]} s={ACCENT} w={1.4} /><L a={[5, 22]} b={[19, 22]} s={ACCENT} w={1.4} /></>,
}

function shape(kind: string): ReactNode {
  const box = { x: 3.5, y: 5.5, w: 17, h: 13 }
  if (kind === 'rect') return <R {...box} sw={1.7} fill={SOFT} />
  if (kind === 'roundrect') return <R {...box} r={4} sw={1.7} fill={SOFT} />
  if (kind === 'circle') return <C cx={12} cy={12} r={8} w={1.7} fill={SOFT} />
  if (kind === 'ellipse') return <C cx={12} cy={12} r={9.5} ry={5.5} w={1.7} fill={SOFT} />
  const r = { x: 3.5, y: 3.5, w: 17, h: 17 }
  const cmds: Cmd[] = ARC_KINDS.includes(kind) ? arcPath(kind, r)
    : polygonForKind(kind, r).map((p, i) => [i ? 'L' : 'M', p[0], p[1]] as Cmd)
  return <Pth d={cmdsToD(cmds) + ' Z'} w={1.7} fill={SOFT} />
}

export function PaintIcon({ name, size = 24 }: { name: string; size?: number }) {
  const draw = DRAW[name]
  return <svg width={size} height={size} viewBox='0 0 24 24' aria-hidden='true'>{draw ? draw() : shape(name)}</svg>
}

export function Swatch({ color, size = 16, none = false }: { color: string; size?: number; none?: boolean }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden='true'>
      <rect x={1} y={1} width={size - 2} height={size - 2} rx={3} stroke='#777' strokeWidth={1} fill={none ? '#ffffff' : color} />
      {none && <line x1={3} y1={size - 3} x2={size - 3} y2={3} stroke='#d8000c' strokeWidth={1.6} />}
    </svg>
  )
}

// pen_preview: a short stroke sample for the width / dash / arrowhead pickers.
export function PenPreview({ width = 2, dash = 'solid', head = '', length = 44 }: { width?: number; dash?: string; head?: string; length?: number }) {
  const h = 16
  const w = Math.min(width, h - 4)
  const pat = ({ dash: [4, 2], dot: [1, 2], dashdot: [4, 2, 1, 2] } as Record<string, number[]>)[dash]
  let x0 = 3
  let x1 = length - 3
  if (head) {
    x1 -= 4
    if (head === 'double') x0 += 4
  }
  const tip = (x: number, sign: number) => {
    const a: P = [x - sign * 8, h / 2 - 4.5]
    const b: P = [x - sign * 8, h / 2 + 4.5]
    if (head === 'open') return <Poly open p={[a, [x, h / 2], b]} w={1.3} />
    if (head === 'stealth') return <Poly p={[[x, h / 2], a, [x - sign * 5, h / 2], b]} w={1.3} fill={FG} />
    return <Poly p={[[x, h / 2], a, b]} w={1.3} fill={FG} />
  }
  return (
    <svg width={length} height={h} viewBox={`0 0 ${length} ${h}`} aria-hidden='true'>
      <line x1={x0} y1={h / 2} x2={x1} y2={h / 2} stroke={FG} strokeWidth={w}
        strokeLinecap={dash === 'dot' ? 'round' : 'butt'} strokeDasharray={pat ? pat.map(v => v * w).join(' ') : undefined} />
      {head && tip(length - 2, 1)}
      {head === 'double' && tip(2, -1)}
    </svg>
  )
}
