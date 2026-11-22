// Insert ▸ SmartArt: Word's layouts and its text pane (one item a line,
// a tab or two spaces in front for a sub-item), previewed as it changes.
import { useMemo, useState } from 'react'
import { parseSmartText, smartArtScene, type SmartArtKind } from '../core/smartart'
import { sceneToSvg } from '../core/paintRender'
import { openModal, type Close } from './modal'

export interface SmartArtChoice { kind: SmartArtKind; text: string }

const KINDS: [SmartArtKind, string, string][] = [
  ['list', 'List', 'Step 1\n  detail\nStep 2\n  detail\nStep 3\n  detail'],
  ['process', 'Process', 'Plan\nPrepare\nMeasure\nAnalyse'],
  ['cycle', 'Cycle', 'Plan\nDo\nCheck\nAct'],
  ['hierarchy', 'Hierarchy', 'Director\n  Group A\n    Postdoc\n    Student\n  Group B\n    Student'],
  ['venn', 'Relationship (Venn)', 'Theory\nExperiment\nSimulation'],
  ['pyramid', 'Pyramid', 'Vision\nStrategy\nTactics\nOperations'],
  ['matrix', 'Matrix', 'Strengths\nWeaknesses\nOpportunities\nThreats'],
]

function SmartArtDialog({ close }: { close: Close<SmartArtChoice> }) {
  const [kind, setKind] = useState<SmartArtKind>('process')
  const [text, setText] = useState(KINDS[1][2])
  const [edited, setEdited] = useState(false)
  const svg = useMemo(() => {
    const nodes = parseSmartText(text)
    if (!nodes.length) return ''
    const sc = smartArtScene(kind, nodes)
    return sceneToSvg(sc, { x: 0, y: 0, w: sc.width, h: sc.height }, 380, 230)
  }, [kind, text])
  const pick = (k: SmartArtKind, sample: string) => { setKind(k); if (!edited) setText(sample) }
  return (
    <div className='kd-dialog' style={{ width: 800 }}>
      <div className='kd-titlebar'>Choose a SmartArt Graphic</div>
      <div className='kd-body' style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {KINDS.map(([k, name, sample]) => (
            <button key={k} type='button' onClick={() => pick(k, sample)}
              style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #bbb', background: k === kind ? '#dce9f9' : '#fff' }}>{name}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13 }}>Type your text here: one item a line; a Tab (or two spaces) in front for a sub-item.</label>
            <textarea value={text} rows={11} onChange={e => { setText(e.target.value); setEdited(true) }}
              onKeyDown={e => {
                if (e.key !== 'Tab') return
                e.preventDefault()
                const t = e.currentTarget, s = t.selectionStart
                const v = t.value.slice(0, s) + '\t' + t.value.slice(t.selectionEnd)
                setText(v); setEdited(true)
                requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 1 })
              }}
              style={{ fontSize: 13, width: '100%', boxSizing: 'border-box', tabSize: 2 }} />
          </div>
          <div style={{ width: 380, height: 230, border: '1px solid #ddd', background: '#fff' }}
            dangerouslySetInnerHTML={{ __html: svg || '<p style="padding:8px;color:#888">Type at least one line.</p>' }} />
        </div>
        <div className='kd-row' style={{ justifyContent: 'flex-end' }}>
          <button type='button' className='kd-btn default' disabled={!svg} onClick={() => close({ kind, text })}>Insert</button>
          <button type='button' className='kd-btn' onClick={() => close(null)}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function openSmartArtDialog(): Promise<SmartArtChoice | null> {
  return openModal<SmartArtChoice>(close => <SmartArtDialog close={close} />)
}
