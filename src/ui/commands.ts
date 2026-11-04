import { useCallback, useEffect, useRef, useState } from 'react'
import { runAction } from '../app/actions'
import { COMMANDS } from './ribbonModel'

export interface CommandState {
  isChecked: (id: string) => boolean
  trigger: (id: string) => void
  setChecked: (id: string, on: boolean) => void
}

function initialChecks(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const c of Object.values(COMMANDS)) if (c.checkable) out[c.id] = !!c.checked
  return out
}

let shared: CommandState | null = null

// The checked state of a command from outside React (an action syncing
// a toggle, as MainWindow's act_x.setChecked()).
export function setCommandChecked(id: string, on: boolean): void {
  shared?.setChecked(id, on)
}

export function isCommandChecked(id: string): boolean {
  return shared?.isChecked(id) ?? !!COMMANDS[id]?.checked
}

// Triggering a command flips its checked state the way the QAction (and
// its exclusive QActionGroup) would, so the ribbon and the menus stay in
// step, then runs the handler registered for it in src/app/actions/ with
// the new checked state.
export function useCommandState(): CommandState {
  const [checks, setChecks] = useState(initialChecks)
  const ref = useRef(checks)
  ref.current = checks

  const apply = useCallback((prev: Record<string, boolean>, id: string, on: boolean) => {
    const cmd = COMMANDS[id]
    const next = { ...prev }
    if (cmd?.group && on) {
      for (const c of Object.values(COMMANDS)) if (c.group === cmd.group) next[c.id] = false
    }
    next[id] = on
    return next
  }, [])

  const setChecked = useCallback((id: string, on: boolean) => {
    if (!!ref.current[id] === on) return
    ref.current = apply(ref.current, id, on)
    setChecks(ref.current)
  }, [apply])

  const trigger = useCallback((id: string) => {
    const cmd = COMMANDS[id]
    let on: boolean | undefined
    if (cmd?.checkable) {
      on = cmd.group ? true : !ref.current[id]
      ref.current = apply(ref.current, id, on)
      setChecks(ref.current)
    }
    void runAction(id, on)
  }, [apply])

  const isChecked = useCallback((id: string) => !!checks[id], [checks])
  const state = { isChecked, trigger, setChecked }
  useEffect(() => { shared = state })
  shared = state
  return state
}
