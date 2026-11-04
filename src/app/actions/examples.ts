// The examples: the welcome page's tour and example list
// (MainWindow._open_example_here), Help ▸ Take the guided tour, and the
// Examples tab / File ▸ New from Template galleries (MainWindow._open_example).
// KherveTeX opens a gallery example in a new window; with one window here
// it takes the current page's place, after offering to save it.
import { GALLERY, welcome, type Factory } from '../../core/examples'
import { registerActions } from '../actions'
import { kickCompile } from '../compile'
import { appStore } from '../store'
import { offerSaveBefore, openUnsaved, setExampleOpener } from './file'

// _open_example_here: user-default meta fields are layered on top
// (openUnsaved) so the example follows the same conventions as File > New.
async function openExampleHere(factory: Factory): Promise<void> {
  openUnsaved(factory())
  if (appStore().get().autoCompile) await kickCompile()
}

// _open_example, from the ribbon or the menus.
async function openExample(factory: Factory, label: string): Promise<void> {
  if (!(await offerSaveBefore(`opening ${label}`))) return
  await openExampleHere(factory)
}

// The welcome page passes the entry's index in GALLERY order.
setExampleOpener(index => {
  const entry = GALLERY[index]
  if (entry) return openExampleHere(entry[2])
})

// A gallery entry by its index or label (the menus' `example:<label>`).
function byArg(arg: unknown): [string, Factory] | null {
  const entry = typeof arg === 'number' ? GALLERY[arg]
    : GALLERY.find(([, label]) => label === arg)
  return entry ? [entry[1], entry[2]] : null
}

registerActions({
  tour: () => openExample(welcome, 'the guided tour'),
  open_example: (arg) => {
    const e = byArg(arg)
    if (e) return openExample(e[1], e[0])
  },
  ...Object.fromEntries(GALLERY.map(([, label, factory]) =>
    [`example:${label}`, () => openExample(factory, label)])),
})
