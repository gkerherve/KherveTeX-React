// The Word-style buttons at the right of the tab row: the mode (Editing,
// Reviewing, Viewing) and Share (Overleaf, email, WhatsApp, the PDF in the
// Finder).
//   Editing    you change the document.
//   Reviewing  your changes are suggestions: Track Changes stays on.
//   Viewing    you read it: the page cannot be changed.
import { editor } from '../../editor/controller.ts'
import { basename, join } from '../../core/paths.ts'
import { platform } from '../../platform'
import { critical, information } from '../../platform/MessageBox'
import { registerActions, runAction, type Handler } from '../actions.ts'
import { fullCompile, docStem } from '../compile.ts'
import { appStore } from '../store.ts'

export type EditMode = 'editing' | 'reviewing' | 'viewing'
export const MODE_EVENT = 'kt-edit-mode'
let mode: EditMode = 'editing'
export function editMode(): EditMode { return mode }

async function setMode(m: EditMode): Promise<void> {
  const e = editor()
  if (!e) return
  const was = mode
  mode = m
  e.setReadOnly(m === 'viewing')
  if (m === 'reviewing' && !e.meta.track_changes) await runAction('track_changes', true)
  // Leaving Reviewing for Editing turns off the tracking it turned on.
  if (was === 'reviewing' && m === 'editing' && e.meta.track_changes) await runAction('track_changes', false)
  window.dispatchEvent(new CustomEvent(MODE_EVENT))
  appStore().set({ status: m === 'viewing' ? 'Viewing: the document cannot be changed. Choose Editing to make changes.'
    : m === 'reviewing' ? 'Reviewing: your changes are suggestions (Track Changes is on).' : '' })
}

// The compiled PDF, copied under the document's name to a temporary
// folder (mail and WhatsApp attach it from there); null if it failed.
async function pdfCopy(purpose: string): Promise<string | null> {
  const r = await fullCompile(purpose)
  if (r === null) return null
  if (!r.ok || r.pdfPath === null) {
    await critical('Compile failed', r.error || 'Unknown error')
    return null
  }
  const p = platform()
  const dir = await p.makeTempDir('ktex-share-')
  const cur = appStore().get().path
  const name = (cur ? docStem(cur) : 'document') + '.pdf'
  const out = join(dir, name)
  await p.writeFile(out, await p.readFile(r.pdfPath))
  return out
}

// Open *file* with a Mac app (a new mail with it attached, WhatsApp's
// share); false when that is not possible here.
async function openWith(app: string, file: string): Promise<boolean> {
  const r = await platform().run('/usr/bin/open', ['-a', app, file], { timeoutSecs: 30 }).catch(() => null)
  return !!r && r.code === 0
}

const DESKTOP_ONLY = 'Sharing by email or WhatsApp works in the kTeX app (macOS), not in the browser.'

const actions: Record<string, Handler> = {
  repaginate: () => { editor()?.repaginate() },
  'mode:editing': () => setMode('editing'),
  'mode:reviewing': () => setMode('reviewing'),
  'mode:viewing': () => setMode('viewing'),
  'share:overleaf': () => runAction('overleaf_send'),
  'share:overleaf_zip': () => runAction('overleaf_zip'),
  'share:email_pdf': async () => {
    const pdf = await pdfCopy('share the PDF')
    if (pdf && !(await openWith('Mail', pdf))) await information('Share', DESKTOP_ONLY)
  },
  // Outlook: a new message with the PDF attached (Outlook for Mac opens a
  // file it is given as a new message's attachment).
  'share:outlook': async () => {
    const pdf = await pdfCopy('share the PDF')
    if (!pdf) return
    if (await openWith('Microsoft Outlook', pdf)) return
    if (!(await openWith('Mail', pdf))) await information('Share', DESKTOP_ONLY)
    else await information('Share', 'Microsoft Outlook is not installed: the PDF was put in a new mail in Mail.')
  },
  // Teams has no way for another app to attach a file to a chat: the PDF
  // is shown in the Finder, ready to drag into the chat, and Teams opens.
  'share:teams': async () => {
    const pdf = await pdfCopy('share the PDF')
    if (!pdf) return
    await platform().reveal(pdf).catch(() => {})
    const opened = await openWith('Microsoft Teams', pdf) || await openWith('Microsoft Teams (work or school)', pdf)
    if (!opened) void platform().openUrl('https://teams.microsoft.com/').catch(() => {})
    await information('Share', `${basename(pdf)} is shown in the Finder: drag it into the Teams chat or channel to send it.`)
  },
  'share:email_ktex': async () => {
    if (!appStore().get().path) await runAction('save')
    const path = appStore().get().path
    if (!path) return
    await runAction('save')
    if (!(await openWith('Mail', path))) await information('Share', DESKTOP_ONLY)
  },
  'share:whatsapp': async () => {
    const pdf = await pdfCopy('share the PDF')
    if (!pdf) return
    if (await openWith('WhatsApp', pdf)) return
    // No WhatsApp app: the PDF in the Finder, to drop into WhatsApp Web.
    await platform().reveal(pdf).catch(() => {})
    void platform().openUrl('https://web.whatsapp.com/').catch(() => {})
    await information('Share', `WhatsApp is not installed: ${basename(pdf)} is shown in the Finder; drag it into the WhatsApp Web chat that opened.`)
  },
  'share:reveal_pdf': async () => {
    const pdf = await pdfCopy('show the PDF')
    if (pdf) await platform().reveal(pdf).catch(() => information('Share', DESKTOP_ONLY))
  },
}

registerActions(actions)
