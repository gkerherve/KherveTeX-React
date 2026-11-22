// Insert ▸ Chart: the chart type, a title and the data (Word's chart
// sheet as text), previewed as it changes.
import { useMemo, useState } from 'react'
import { chartScene, parseChartData, type ChartKind } from '../core/chart'
import { sceneToSvg } from '../core/paintRender'
import { openModal, type Close } from './modal'

export interface ChartChoice { kind: ChartKind; title: string; data: string }

const KINDS: [ChartKind, string][] = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie'], ['scatter', 'Scatter (X, Y)']]
const SAMPLE = 'Category, Series 1, Series 2, Series 3\nCategory 1, 4.3, 2.4, 2\nCategory 2, 2.5, 4.4, 2\nCategory 3, 3.5, 1.8, 3\nCategory 4, 4.5, 2.8, 5'

function ChartDialog({ close }: { close: Close<ChartChoice> }) {
  const [kind, setKind] = useState<ChartKind>('column')
  const [title, setTitle] = useState('Chart Title')
  const [data, setData] = useState(SAMPLE)
  const svg = useMemo(() => {
    const d = parseChartData(data)
    if (!d) return ''
    const sc = chartScene(kind, d, title)
    return sceneToSvg(sc, { x: 0, y: 0, w: sc.width, h: sc.height }, 360, 225)
  }, [kind, title, data])
  return (
    <div className='kd-dialog' style={{ width: 780 }}>
      <div className='kd-titlebar'>Insert Chart</div>
      <div className='kd-body' style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {KINDS.map(([k, label]) => (
              <button key={k} type='button' onClick={() => setKind(k)}
                style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #bbb', background: k === kind ? '#dce9f9' : '#fff' }}>{label}</button>
            ))}
          </div>
          <label style={{ fontSize: 13 }}>Title <input value={title} onChange={e => setTitle(e.target.value)} style={{ width: '70%' }} /></label>
          <label style={{ fontSize: 13 }}>Data: a first row of series names, then one row per category
            {kind === 'scatter' ? ' (first column: the X values)' : ''}; values separated by commas, semicolons or tabs (paste from Excel).</label>
          <textarea value={data} onChange={e => setData(e.target.value)} rows={10}
            style={{ fontFamily: 'Menlo, Consolas, monospace', fontSize: 12, width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={{ width: 360, height: 225, border: '1px solid #ddd', background: '#fff' }}
          dangerouslySetInnerHTML={{ __html: svg || '<p style="padding:8px;color:#888">Type at least a row of names and one of values.</p>' }} />
      </div>
      <div className='kd-row' style={{ justifyContent: 'flex-end' }}>
        <button type='button' className='kd-btn default' disabled={!svg} onClick={() => close({ kind, title, data })}>Insert</button>
        <button type='button' className='kd-btn' onClick={() => close(null)}>Cancel</button>
      </div>
      </div>
    </div>
  )
}

export function openChartDialog(): Promise<ChartChoice | null> {
  return openModal<ChartChoice>(close => <ChartDialog close={close} />)
}
