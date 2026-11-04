// QDialog.exec() for the drawing dialogs: mount a component in its own
// root above the window (below message boxes, which must stay on top of
// it) and resolve with the value it closes with, null for Cancel.
import { useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './drawing.css'

export type Close<T> = (value: T | null) => void

export function openModal<T>(render: (close: Close<T>) => ReactNode): Promise<T | null> {
  return new Promise(resolve => {
    const el = document.createElement('div')
    el.className = 'kd-veil'
    document.body.appendChild(el)
    const root = createRoot(el)
    let done = false
    const close: Close<T> = (value) => {
      if (done) return
      done = true
      root.unmount()
      el.remove()
      resolve(value)
    }
    root.render(render(close))
  })
}

export interface FigureDetails { caption: string; label: string }

// _InsertFigureDialog with the path read-only ("Drawing details",
// "Flowchart details").
function FigureDetailsDialog({ path, title, close }: { path: string; title: string; close: Close<FigureDetails> }) {
  const [caption, setCaption] = useState('')
  const [label, setLabel] = useState('')
  const ok = () => close({ caption: caption.trim(), label: label.trim() })
  return (
    <div className='kd-dialog' style={{ minWidth: 420 }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null) }
        if (e.key === 'Enter') { e.preventDefault(); ok() }
      }}>
      <div className='kd-titlebar'>{title}</div>
      <div className='kd-body'>
        <div className='kd-form'>
          <label>Image path:</label>
          <input type='text' readOnly value={path} />
          <label>Caption:</label>
          <input type='text' autoFocus value={caption} onChange={e => setCaption(e.target.value)} />
          <label>Label:</label>
          <input type='text' placeholder='e.g. fig:my-figure' value={label}
            onChange={e => setLabel(e.target.value)} />
        </div>
        <div className='kd-row' style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button type='button' className='kd-btn default' onClick={ok}>OK</button>
          <button type='button' className='kd-btn' onClick={() => close(null)}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export function askFigureDetails(path: string, title: string): Promise<FigureDetails | null> {
  return openModal<FigureDetails>(close => <FigureDetailsDialog path={path} title={title} close={close} />)
}
