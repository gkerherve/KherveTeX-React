// The window's status bar: on the left the recent-files combo, then the
// document's name and folder; right side in Qt's order: the Light / Dark
// switch, editor zoom (−, slider, +, percent), the PDF zoom, fit width,
// the PDF-follows-the-text toggle and the compiler indicator.
import { friendlyDir } from '../core/friendlyDir.ts'
import { useRef, type PointerEvent } from 'react'
import { Icon } from './icons'
import { useTipProps } from './Tooltip'

// theme_switch.ThemeSwitch: a sliding pill whose knob shows a sun or moon.
function ThemeSwitch({ dark, onToggle }: { dark: boolean, onToggle: () => void }) {
  const tip = useTipProps({
    plain: dark ? 'Switch to the light theme' : 'Switch to the dark theme',
  })
  const h = 18
  const r = h / 2 - 2
  const cx = dark ? 39 - h / 2 : 1 + h / 2
  const cy = 10
  const rays = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7],
    [0.7, -0.7], [-0.7, -0.7]]
  return (
    <button type='button' className='sb-switch' role='switch' aria-checked={dark}
      aria-label='Dark theme' onClick={onToggle} {...tip}>
      <svg width='40' height='20' viewBox='0 0 40 20' aria-hidden='true'>
        <defs>
          <mask id='sb-moon'>
            <circle cx={cx} cy={cy} r={r * 0.72} fill='white' />
            <circle cx={cx + r * 0.38} cy={cy - r * 0.3} r={r * 0.62} fill='black' />
          </mask>
        </defs>
        <rect x='1' y='1' width='38' height={h} rx={h / 2}
          fill={dark ? '#2b579a' : '#c8cdd3'} />
        <circle cx={cx} cy={cy} r={r} fill='#ffffff' />
        {dark
          ? <circle cx={cx} cy={cy} r={r * 0.72} fill='#2b579a' mask='url(#sb-moon)' />
          : (
            <g stroke='#d98a00' strokeWidth='1.1' strokeLinecap='round'>
              <circle cx={cx} cy={cy} r={r * 0.42} fill='#d98a00' stroke='none' />
              {rays.map(([dx, dy]) => (
                <line key={`${dx},${dy}`} x1={cx + dx * r * 0.62} y1={cy + dy * r * 0.62}
                  x2={cx + dx * r * 0.88} y2={cy + dy * r * 0.88} />
              ))}
            </g>
          )}
      </svg>
    </button>
  )
}

// Fusion's QSlider with TicksBelow: a rounded groove filled in blue up to
// a white handle, tick marks every `tick` under it.
function ZoomSlider({ min, max, value, tick, width, onChange }: {
  min: number, max: number, value: number, tick: number, width: number,
  onChange: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const handle = 16
  const span = width - handle
  const at = (Math.min(max, Math.max(min, value)) - min) / (max - min) * span
  const pick = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (e.clientX - r.left - handle / 2) / span))
    onChange(Math.round(min + f * (max - min)))
  }
  const ticks: number[] = []
  for (let v = min; v <= max; v += tick) ticks.push((v - min) / (max - min) * span + handle / 2)
  return (
    <div ref={ref} className='sb-slider' style={{ width }} role='slider'
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e) }}
      onPointerMove={e => { if (e.buttons & 1) pick(e) }}
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(Math.min(max, value + 10))
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(Math.max(min, value - 10))
      }}>
      <div className='sb-groove' />
      <div className='sb-fill' style={{ width: at + handle / 2 }} />
      <div className='sb-handle' style={{ left: at }} />
      {ticks.map(x => <div key={x} className='sb-tick' style={{ left: Math.round(x) }} />)}
    </div>
  )
}

function ToolIcon({ name, tip, on, onClick }: {
  name: string, tip: string, on?: boolean, onClick: () => void
}) {
  const t = useTipProps({ plain: tip })
  return (
    <button type='button' className={'sb-tool' + (on ? ' on' : '')} aria-label={tip}
      onClick={onClick} {...t}>
      <Icon name={name} size={24} />
    </button>
  )
}

// _recent_combo: a combo listing the recent files by name (full path in
// the tooltip); picking one opens it, and the combo goes back to its
// "Recent files" placeholder.
function RecentCombo({ recent, onOpen }: {
  recent: readonly string[], onOpen: (path: string) => void
}) {
  const tip = useTipProps({ plain: 'Open a recent file' })
  const name = (p: string) => p.replace(/^.*[\\/]/, '')
  return (
    <select className='sb-recent' aria-label='Recent files' value='' disabled={!recent.length}
      onChange={e => { if (e.target.value) onOpen(e.target.value) }} {...tip}>
      <option value='' disabled hidden>{recent.length ? 'Recent files' : 'No recent files'}</option>
      {recent.map(p => <option key={p} value={p} title={p}>{name(p)}</option>)}
    </select>
  )
}

export interface StatusBarProps {
  fileName: string | null
  // The saved document's folder and git branch (_update_title's label).
  dir?: string | null
  branch?: string
  // _compile_label / _compile_progress while a compile runs.
  compiling?: boolean
  dark: boolean
  onToggleTheme: () => void
  zoom: number
  onZoom: (z: number) => void
  pdfZoom: number
  onPdfZoom: (z: number) => void
  pdfFitWidth: boolean
  onPdfFitWidth: () => void
  showPdfZoom: boolean
  compiler: string
  message?: string
  recent?: readonly string[]
  onOpenRecent?: (path: string) => void
  // The PDF scrolls with the page view.
  pdfFollow?: boolean
  onPdfFollow?: () => void
}

export function StatusBar(p: StatusBarProps) {
  return (
    <div className='statusbar'>
      {p.onOpenRecent && <RecentCombo recent={p.recent ?? []} onOpen={p.onOpenRecent} />}
      <div className='sb-path' title={p.fileName && p.dir ? `${p.dir}/${p.fileName}` : undefined}>
        {p.fileName
          ? <>
            <b>{p.fileName}</b>
            {p.branch && <>{'  '}<span className='sb-branch'>{p.branch}</span></>}
            {p.dir && <>{'  —  '}<span className='sb-dir'>{friendlyDir(p.dir)}</span></>}
          </>
          : <><b>Untitled</b>{'  —  '}<span className='sb-faint'>not saved yet</span></>}
        {p.message && <span className='sb-faint'>{'  —  '}{p.message}</span>}
      </div>
      <ThemeSwitch dark={p.dark} onToggle={p.onToggleTheme} />
      <ToolIcon name='zoom_out' tip='Zoom out' onClick={() => p.onZoom(Math.max(25, p.zoom - 10))} />
      <ZoomSlider min={25} max={300} tick={25} width={140} value={p.zoom} onChange={p.onZoom} />
      <ToolIcon name='zoom_in' tip='Zoom in' onClick={() => p.onZoom(Math.min(300, p.zoom + 10))} />
      <span className='sb-pct'>{p.zoom}%</span>
      {p.showPdfZoom && (
        <>
          <span className='sb-pdf-sep'> | PDF:</span>
          <ToolIcon name='zoom_out' tip='PDF zoom out'
            onClick={() => p.onPdfZoom(Math.max(25, p.pdfZoom - 10))} />
          <ZoomSlider min={25} max={400} tick={25} width={100} value={p.pdfZoom}
            onChange={p.onPdfZoom} />
          <ToolIcon name='zoom_in' tip='PDF zoom in'
            onClick={() => p.onPdfZoom(Math.min(400, p.pdfZoom + 10))} />
          <span className='sb-pct'>{p.pdfZoom}%</span>
          <ToolIcon name='fit_width' tip='Fit page width (Ctrl+0)' on={p.pdfFitWidth}
            onClick={p.onPdfFitWidth} />
          {p.onPdfFollow && <ToolIcon name='pdf_follow'
            tip={p.pdfFollow ? 'The PDF follows the text (click to stop)' : 'Make the PDF follow the text'}
            on={p.pdfFollow} onClick={p.onPdfFollow} />}
        </>
      )}
      <span className='sb-compiler'>{p.compiler}</span>
      {p.compiling && <>
        <span className='sb-compile-label'>Compiling…</span>
        <span className='sb-progress' role='progressbar' aria-label='Compiling'><span /></span>
      </>}
    </div>
  )
}
