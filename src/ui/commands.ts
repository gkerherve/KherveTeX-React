import { useCallback, useState } from 'react'
import { COMMANDS } from './ribbonModel'

export interface CommandState {
  isChecked: (id: string) => boolean
  trigger: (id: string) => void
}

function initialChecks(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const c of Object.values(COMMANDS)) if (c.checkable) out[c.id] = !!c.checked
  return out
}

// Commands are not wired to the editor yet: triggering one only logs it
// and flips its checked state the way the QAction (and its exclusive
// QActionGroup) would, so the ribbon and the menus stay in step.
export function useCommandState(): CommandState {
  const [checks, setChecks] = useState(initialChecks)
  const trigger = useCallback((id: string) => {
    console.log(id)
    const cmd = COMMANDS[id]
    if (!cmd?.checkable) return
    setChecks(prev => {
      const next = { ...prev }
      if (cmd.group) {
        for (const c of Object.values(COMMANDS)) if (c.group === cmd.group) next[c.id] = false
        next[id] = true
      } else {
        next[id] = !prev[id]
      }
      return next
    })
  }, [])
  const isChecked = useCallback((id: string) => !!checks[id], [checks])
  return { isChecked, trigger }
}
