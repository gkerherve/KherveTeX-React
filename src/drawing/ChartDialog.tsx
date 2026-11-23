// Insert ▸ Chart and a double-click on a chart: the chart editor. The chart
// types on the left (each with what it is for), the live chart and its data
// sheet (an Excel-like grid: type, Tab / Enter to move, paste from Excel) in
// the middle, and the Format panel on the right: titles, axes, legend,
// gridlines, data labels, colours, and each series' line, width and marker.
import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import {
  CHART_KINDS, PALETTES, chartData, defaultSeries, newChartSpec, paletteColors, parseSheet, seriesFor,
  type ChartKind, type ChartSpec, type LegendPos, type Marker, type SeriesStyle,
} from '../core/chart'
import type { Dash } from '../core/paintModel'
import { chartSvg } from './chartFiles'
import { openModal, type Close } from './modal'
import './chart.css'

export interface ChartResult { spec: ChartSpec; caption: string; label: string }

const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LINE_KINDS: ChartKind[] = ['line', 'area', 'scatter', 'scatter_line']
const DASHES: [Dash, string][] = [['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted'], ['dashdot', 'Dash-dot']]
const MARKERS: [Marker, string][] = [['none', 'None'], ['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'], ['diamond', 'Diamond']]
const LEGENDS: [LegendPos, string][] = [['bottom', 'Bottom'], ['right', 'Right'], ['top', 'Top'], ['none', 'None']]

// A little chart of each type for the gallery, drawn by the real renderer.
const THUMBS: Record<string, string> = {}
function thumb(kind: ChartKind): string {
  if (!THUMBS[kind]) {
    const s = newChartSpec(kind)
    s.title = ''
    s.legend = 'none'
    s.gridlines = false
    s.rows = kind === 'scatter' || kind === 'scatter_line'
      ? [['x', 'a', 'b'], ['0', '1', '0.5'], ['1', '2.6', '1.4'], ['2', '3.4', '2.6'], ['3', '3.8', '3.1'], ['4', '4.1', '3.3']]
      : [['c', 'a', 'b', 'c'], ['1', '4', '2.4', '2'], ['2', '2.5', '4.4', '2'], ['3', '3.5', '1.8', '3'], ['4', '4.5', '2.8', '5']]
    s.series = s.series.map(st => ({ ...st, width: 5, marker: kind === 'scatter' ? 'circle' : 'none' }))
    THUMBS[kind] = chartSvg(s, 84, 52)
  }
  return THUMBS[kind]
}

function squareUp(rows: string[][]): string[][] {
  const w = Math.max(2, ...rows.map(r => r.length))
  return rows.map(r => [...r, ...new Array(Math.max(0, w - r.length)).fill('')])
}

function DashIcon({ dash }: { dash: Dash }) {
  const d = { solid: '', dash: '6 3', dot: '1.5 3', dashdot: '6 3 1.5 3' }[dash]
  return <svg width='34' height='10'><line x1='2' y1='5' x2='32' y2='5' stroke='currentColor' strokeWidth='2' strokeDasharray={d} strokeLinecap='round' /></svg>
}
function MarkerIcon({ m }: { m: Marker }) {
  const p = { none: null, circle: <circle cx='8' cy='8' r='4.5' />, square: <rect x='3.5' y='3.5' width='9' height='9' />,
    triangle: <polygon points='8,2.5 13.5,12.5 2.5,12.5' />, diamond: <polygon points='8,2 14,8 8,14 2,8' /> }[m]
  return <svg width='16' height='16' fill='currentColor'>{p ?? <line x1='3' y1='13' x2='13' y2='3' stroke='currentColor' strokeWidth='1.4' />}</svg>
}

function ChartEditor({ start, editing, close }: { start: ChartSpec; editing: boolean; close: Close<ChartResult> }) {
  const [spec, setSpecState] = useState<ChartSpec>(() => ({ ...start, rows: squareUp(start.rows), series: seriesFor(start) }))
  const [panel, setPanel] = useState<'chart' | 'series'>('chart')
  const [cur, setCur] = useState<[number, number]>([1, 1])
  const [selSeries, setSelSeries] = useState(0)
  const [caption, setCaption] = useState('')
  const [label, setLabel] = useState('')
  const sheet = useRef<HTMLDivElement>(null)

  const set = (patch: Partial<ChartSpec>) => setSpecState(s => {
    const n = { ...s, ...patch }
    n.series = seriesFor(n)
    return n
  })
  const setRows = (rows: string[][]) => set({ rows: squareUp(rows) })
  const setSeries = (k: number, patch: Partial<SeriesStyle>) => setSpecState(s => {
    const series = seriesFor(s).map((st, i) => (i === k ? { ...st, ...patch } : st))
    return { ...s, series }
  })

  const svg = useMemo(() => chartSvg(spec, 600, 375), [spec])
  const data = useMemo(() => chartData(spec), [spec])
  const info = CHART_KINDS.find(k => k.kind === spec.kind)!
  const lineKind = LINE_KINDS.includes(spec.kind)
  const pieKind = spec.kind === 'pie' || spec.kind === 'doughnut'
  const xy = spec.kind === 'scatter' || spec.kind === 'scatter_line'
  const rows = spec.rows
  const nCols = rows[0].length
  const names = rows[0].slice(1)
  const xNotNumbers = xy && data && rows.slice(1).some(r => r[0]?.trim() && !Number.isFinite(Number(r[0].replace(',', '.'))))

  const focusCell = (r: number, c: number) => {
    setCur([r, c])
    requestAnimationFrame(() => sheet.current?.querySelector<HTMLInputElement>(`input[data-rc="${r}:${c}"]`)?.focus())
  }
  const edit = (r: number, c: number, v: string) => {
    const next = rows.map(x => [...x])
    next[r][c] = v
    setRows(next)
  }
  const addRow = (at = rows.length, col = 0) => { const next = rows.map(x => [...x]); next.splice(at, 0, new Array(nCols).fill('')); setRows(next); focusCell(at, col) }
  const addSeries = () => {
    const next = rows.map((x, i) => [...x, i === 0 ? `Series ${nCols}` : ''])
    set({ rows: next, series: [...seriesFor(spec), defaultSeries(nCols - 1, spec.palette)] })
    focusCell(1, nCols)
  }
  const delRow = () => { if (rows.length <= 2 || cur[0] === 0) return; setRows(rows.filter((_, i) => i !== cur[0])); setCur([Math.min(cur[0], rows.length - 2), cur[1]]) }
  const delCol = () => {
    if (nCols <= 2 || cur[1] === 0) return
    const k = cur[1] - 1
    set({ rows: rows.map(x => x.filter((_, j) => j !== cur[1])), series: seriesFor(spec).filter((_, i) => i !== k) })
    setCur([cur[0], Math.min(cur[1], nCols - 2)])
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.altKey)) {
      e.preventDefault()
      if (r + 1 >= rows.length) addRow(rows.length, c)
      else focusCell(r + 1, c)
    } else if (e.key === 'ArrowUp' && r > 0) { e.preventDefault(); focusCell(r - 1, c) }
    else if (e.key === 'Tab' && !e.shiftKey && c + 1 >= nCols) { e.preventDefault(); focusCell(Math.min(r + 1, rows.length - 1), 0) }
  }
  // Paste a block from Excel / a CSV at this cell, growing the sheet.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n;]/.test(text.trim()) && !(text.includes(',') && text.includes('\n'))) return
    e.preventDefault()
    const block = parseSheet(text)
    const next = rows.map(x => [...x])
    block.forEach((line, i) => line.forEach((v, j) => {
      while (next.length <= r + i) next.push([])
      const row = next[r + i]
      while (row.length <= c + j) row.push('')
      row[c + j] = v
    }))
    setRows(next)
  }
  // The data stay as they are: a scatter of text categories places them
  // at 1, 2, 3… (and says so) until column A holds numbers.
  const pickKind = (k: ChartKind) => set({ kind: k })
  const setPalette = (p: string) => setSpecState(s => ({ ...s, palette: p, series: seriesFor(s).map((st, k) => ({ ...st, color: paletteColors(p)[k % 8] })) }))
  const st = seriesFor(spec)[Math.min(selSeries, Math.max(0, names.length - 1))]

  const ok = () => close({ spec: { ...spec, series: seriesFor(spec) }, caption: caption.trim(), label: label.trim() })

  return (
    <div className='ch-dialog' role='dialog' aria-label={editing ? 'Edit Chart' : 'Insert Chart'}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
      <div className='ch-top'>
        <svg width='18' height='18' viewBox='0 0 18 18' aria-hidden='true'><rect x='2' y='9' width='3' height='7' fill='#fff' /><rect x='7.5' y='4' width='3' height='12' fill='#fff' /><rect x='13' y='7' width='3' height='9' fill='#fff' /></svg>
        <b>{editing ? 'Edit Chart' : 'Insert Chart'}</b>
        <span>Pick a type, type or paste your data, then format it. Double-click the chart on the page to come back here.</span>
      </div>
      <div className='ch-main'>
        {/* ---- chart types ---- */}
        <aside className='ch-types'>
          <div className='ch-h'>Chart type</div>
          <div className='ch-kinds'>
            {CHART_KINDS.map(k => (
              <button key={k.kind} type='button' className={'ch-kind' + (k.kind === spec.kind ? ' on' : '')} title={k.text}
                onClick={() => pickKind(k.kind)}>
                <span className='ch-thumb' dangerouslySetInnerHTML={{ __html: thumb(k.kind) }} />
                <span>{k.name}</span>
              </button>
            ))}
          </div>
          <div className='ch-about'>
            <b>{info.name}</b>
            <p>{info.text}</p>
            <p className='ch-tip'>{info.tip}</p>
          </div>
        </aside>

        {/* ---- preview and sheet ---- */}
        <section className='ch-centre'>
          <div className='ch-preview' dangerouslySetInnerHTML={{ __html: svg }} />
          <div className='ch-sheetbar'>
            <b>Data</b>
            <span className='ch-hint'>{pieKind ? 'Column A: the slices; column B: their values.' : xy ? 'Column A: the X values (numbers); one column per Y series.' : 'Row 1: the series names; column A: the categories.'} Paste from Excel into any cell.</span>
            <span className='ch-grow' />
            <button type='button' onClick={() => addRow()}>+ Row</button>
            <button type='button' onClick={addSeries}>+ Series</button>
            <button type='button' onClick={delRow} disabled={rows.length <= 2 || cur[0] === 0} title='Delete the row of the selected cell'>− Row</button>
            <button type='button' onClick={delCol} disabled={nCols <= 2 || cur[1] === 0} title='Delete the series of the selected cell'>− Series</button>
          </div>
          {xNotNumbers && <div className='ch-warn'>A scatter chart needs numbers in column A: the points are placed at 1, 2, 3… meanwhile.</div>}
          <div className='ch-sheet' ref={sheet}>
            <table>
              <thead>
                <tr><th className='ch-corner' />{rows[0].map((_, c) => (
                  <th key={c} className={c === cur[1] ? 'on' : ''}>{COLS[c] ?? c + 1}</th>))}</tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r} className={r === 0 ? 'ch-names' : ''}>
                    <th className={r === cur[0] ? 'on' : ''}>{r + 1}</th>
                    {row.map((v, c) => (
                      <td key={c} className={(r === cur[0] && c === cur[1] ? 'sel ' : '') + (c > 0 && r > 0 && v.trim() && !Number.isFinite(Number(v.replace(',', '.'))) ? 'bad' : '')}
                        style={r === 0 && c > 0 ? { boxShadow: `inset 0 -3px 0 ${st && seriesFor(spec)[c - 1]?.color}` } : undefined}>
                        <input value={v} data-rc={`${r}:${c}`} spellCheck={false}
                          className={c > 0 && r > 0 ? 'num' : ''}
                          placeholder={r === 0 && c === 0 ? (xy ? 'X' : 'Category') : ''}
                          onFocus={() => { setCur([r, c]); if (c > 0) setSelSeries(c - 1) }}
                          onChange={e => edit(r, c, e.target.value)}
                          onKeyDown={e => onKey(e, r, c)}
                          onPaste={e => onPaste(e, r, c)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- format ---- */}
        <aside className='ch-format'>
          <div className='ch-tabs'>
            <button type='button' className={panel === 'chart' ? 'on' : ''} onClick={() => setPanel('chart')}>Chart</button>
            <button type='button' className={panel === 'series' ? 'on' : ''} onClick={() => setPanel('series')} disabled={pieKind}>Series</button>
          </div>
          {panel === 'chart' || pieKind ? (
            <div className='ch-form'>
              <label>Chart title<input value={spec.title} onChange={e => set({ title: e.target.value })} placeholder='No title' /></label>
              {!pieKind && <>
                <label>{spec.kind.startsWith('bar') ? 'Category axis title (vertical)' : 'Horizontal axis title'}<input value={spec.xTitle} onChange={e => set({ xTitle: e.target.value })} placeholder={xy ? 'e.g. Time (s)' : 'e.g. Month'} /></label>
                <label>{spec.kind.startsWith('bar') ? 'Value axis title (horizontal)' : 'Vertical axis title'}<input value={spec.yTitle} onChange={e => set({ yTitle: e.target.value })} placeholder='e.g. Concentration (mM)' /></label>
              </>}
              <div className='ch-field'>Legend
                <div className='ch-seg'>{LEGENDS.map(([k, t]) => (
                  <button key={k} type='button' className={spec.legend === k ? 'on' : ''} onClick={() => set({ legend: k })}>{t}</button>))}</div>
              </div>
              <div className='ch-checks'>
                {!pieKind && <label className='ch-check'><input type='checkbox' checked={spec.gridlines} onChange={e => set({ gridlines: e.target.checked })} />Gridlines</label>}
                <label className='ch-check'><input type='checkbox' checked={spec.dataLabels} onChange={e => set({ dataLabels: e.target.checked })} />{pieKind ? 'Values instead of %' : 'Data labels'}</label>
              </div>
              <div className='ch-field'>Colours
                <div className='ch-palettes'>{PALETTES.map(([k, t, cols]) => (
                  <button key={k} type='button' title={t} className={spec.palette === k ? 'on' : ''} onClick={() => setPalette(k)}>
                    {cols.slice(0, 6).map(c => <i key={c} style={{ background: c }} />)}
                  </button>))}</div>
              </div>
              {!pieKind && (
                <div className='ch-field'>Value axis
                  <div className='ch-minmax'>
                    <label>Min<input value={spec.yMin} onChange={e => set({ yMin: e.target.value })} placeholder='Auto' /></label>
                    <label>Max<input value={spec.yMax} onChange={e => set({ yMax: e.target.value })} placeholder='Auto' /></label>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className='ch-form'>
              <div className='ch-serieslist'>
                {names.map((n, k) => (
                  <button key={k} type='button' className={k === selSeries ? 'on' : ''} onClick={() => setSelSeries(k)}>
                    <i style={{ background: seriesFor(spec)[k].color }} />{n || `Series ${k + 1}`}
                  </button>
                ))}
              </div>
              {st && <>
                <div className='ch-field'>Colour
                  <div className='ch-colour'>
                    <input type='color' value={st.color} onChange={e => setSeries(selSeries, { color: e.target.value.toUpperCase() })} />
                    {paletteColors(spec.palette).map(c => <button key={c} type='button' style={{ background: c }} title={c} onClick={() => setSeries(selSeries, { color: c })} />)}
                  </div>
                </div>
                {lineKind ? <>
                  {spec.kind !== 'scatter' && <div className='ch-field'>Line
                    <div className='ch-seg ch-icons'>{DASHES.map(([d, t]) => (
                      <button key={d} type='button' title={t} className={st.dash === d ? 'on' : ''} onClick={() => setSeries(selSeries, { dash: d })}><DashIcon dash={d} /></button>))}</div>
                  </div>}
                  {spec.kind !== 'scatter' && <label className='ch-field'>Width <b>{st.width} pt</b>
                    <input type='range' min={0.5} max={6} step={0.5} value={st.width} onChange={e => setSeries(selSeries, { width: Number(e.target.value) })} /></label>}
                  <div className='ch-field'>Marker
                    <div className='ch-seg ch-icons'>{MARKERS.filter(([m]) => spec.kind !== 'scatter' || m !== 'none').map(([m, t]) => (
                      <button key={m} type='button' title={t} className={st.marker === m ? 'on' : ''} onClick={() => setSeries(selSeries, { marker: m })}><MarkerIcon m={m} /></button>))}</div>
                  </div>
                  {spec.kind !== 'scatter' && <label className='ch-check'><input type='checkbox' checked={st.smooth} onChange={e => setSeries(selSeries, { smooth: e.target.checked })} />Smooth line</label>}
                </> : <p className='ch-note'>Bars take the series colour. Line, area and scatter charts also have line styles and markers.</p>}
              </>}
            </div>
          )}
        </aside>
      </div>
      <div className='ch-foot'>
        {!editing && <>
          <label>Caption<input value={caption} onChange={e => setCaption(e.target.value)} placeholder='Printed under the chart (optional)' /></label>
          <label className='ch-label'>Label<input value={label} onChange={e => setLabel(e.target.value)} placeholder='fig:my-chart' /></label>
        </>}
        <span className='ch-grow' />
        <button type='button' className='ch-btn' onClick={() => close(null)}>Cancel</button>
        <button type='button' className='ch-btn ch-primary' disabled={!data} onClick={ok}>{editing ? 'Update chart' : 'Insert chart'}</button>
      </div>
    </div>
  )
}

export function openChartDialog(spec?: ChartSpec | null): Promise<ChartResult | null> {
  return openModal<ChartResult>(close => <ChartEditor start={spec ?? newChartSpec('column')} editing={!!spec} close={close} />)
}
