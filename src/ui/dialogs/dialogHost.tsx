// Modal dialogs as Qt's QDialog.exec(): openDialog() mounts a component in
// its own root above the window and resolves with the value it closes
// with, so an action can `await` the user's answer without App.tsx
// knowing about each dialog.
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './dialogs.css'

export type Close<T> = (value: T | null) => void

export function openDialog<T>(render: (close: Close<T>) => ReactNode): Promise<T | null> {
  return new Promise(resolve => {
    const el = document.createElement('div')
    el.className = 'dlg-backdrop'
    document.body.appendChild(el)
    const root = createRoot(el)
    const close: Close<T> = (value) => {
      root.unmount()
      el.remove()
      resolve(value)
    }
    el.addEventListener('keydown', e => { if (e.key === 'Escape') close(null) })
    root.render(render(close))
  })
}
