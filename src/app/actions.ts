// Command id → handler. Each area of the app registers its handlers from
// its own file in src/app/actions/ (picked up by the glob below), so the
// areas never edit a shared list. A command with no handler only logs.
export type Handler = (arg?: unknown) => void | Promise<void>

// The eager glob below is hoisted above this module's body, so each action
// module calls registerActions before a top-level `const` here would be
// initialised. A hoisted function holds the table instead.
function table(): Map<string, Handler> {
  const t = table as { map?: Map<string, Handler> }
  return (t.map ??= new Map())
}

export function registerActions(map: Record<string, Handler>): void {
  for (const [id, h] of Object.entries(map)) table().set(id, h)
}

export function hasAction(id: string): boolean {
  return table().has(id)
}

export async function runAction(id: string, arg?: unknown): Promise<void> {
  const h = table().get(id)
  if (!h) { console.log('unwired command:', id); return }
  try {
    await h(arg)
  } catch (e) {
    console.error(id, e)
    // The status bar shows the failure, as MainWindow's statusBar message.
    const { appStore } = await import('./store')
    appStore().set({ status: `${id} failed: ${e instanceof Error ? e.message : String(e)}` })
  }
}

// Every module in ./actions registers itself on import.
import.meta.glob('./actions/*.ts', { eager: true })
