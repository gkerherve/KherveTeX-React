// Command id → handler. Each area of the app registers its handlers from
// its own file in src/app/actions/ (picked up by the glob below), so the
// areas never edit a shared list. A command with no handler only logs.
export type Handler = (arg?: unknown) => void | Promise<void>

const handlers = new Map<string, Handler>()

export function registerActions(map: Record<string, Handler>): void {
  for (const [id, h] of Object.entries(map)) handlers.set(id, h)
}

export function hasAction(id: string): boolean {
  return handlers.has(id)
}

export async function runAction(id: string, arg?: unknown): Promise<void> {
  const h = handlers.get(id)
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
