// Automatic updates — the port of khervedoc/updater.py onto
// tauri-plugin-updater.
//
// The Python app usually runs from a source checkout, so its update is the
// newest commits of the branch; an installed copy only offers the release
// page. This app is always installed, so an update is the newest signed
// GitHub release (latest.json, written by .github/workflows/release.yml).
// The behaviour is updater.py's: a few seconds after start-up — and every
// half hour while it stays open — the app looks for a release in the
// background. With "Update automatically" on it brings itself up to date
// (download and install; on Windows the NSIS installer can only run as the
// app quits, so there it downloads and installs on restart), lists what
// changed and offers to restart. Help ▸ Check for updates… does the same on
// demand and, with the toggle off, asks before updating. Nothing runs in
// the browser build or when KHERVETEX_NO_UPDATE=1 is set.
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { isTauri } from '../../platform'
import { information, progressBox, warning } from '../../platform/MessageBox'
import { setSetting, setting } from '../../platform/settings'
import { setCommandChecked } from '../../ui/commands'
import { updateDialog } from '../../ui/dialogs/UpdateDialog'
import { registerActions } from '../actions'
import { shutdownCompiles } from '../compile'
import { appStore } from '../store'
import { offerSaveBefore } from './file'

import { SHORT_NAME as APP_NAME, shortVersion, VERSION as CURRENT } from '../../version'
export { shortVersion }
export const KEY_AUTO = 'update/auto'              // default on
export const STARTUP_DELAY_MS = 5000
export const INTERVAL_MS = 30 * 60 * 1000


// The installer is a separate program on Windows that replaces the running
// executable, so it can only run as the app quits.
const installsOnQuit = (): boolean => typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)

// Commit subjects as a bullet list, the "v0.12:" / "Area:" prefix in bold.
export function changelogMarkdown(subjects: string[]): string {
  const lines: string[] = []
  for (const subject of subjects) {
    const m = /^([^:]{1,40}):\s+(.+)$/s.exec(subject)
    const text = m ? `**${m[1]}** — ${m[2]}` : subject
    lines.push(`- ${text}`)
  }
  return lines.join('\n')
}

// The release notes are the commit subjects, one per line (release.yml);
// a bullet the release already has is not doubled.
export function releaseNotes(body: string | undefined): string {
  const subjects = (body ?? '').split(/\r?\n/).map(l => l.trim().replace(/^[-*]\s+/, '')).filter(Boolean)
  return changelogMarkdown(subjects)
}

export function autoEnabled(): boolean {
  const value = setting<unknown>(KEY_AUTO, true)
  return value === true || value === 'true' || value === 'True' || value === 1 || value === '1'
}

// statusBar().showMessage(text, ms); 0 keeps it.
let statusTimer: ReturnType<typeof setTimeout> | null = null
function status(text: string, ms = 8000): void {
  appStore().set({ status: text })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = null
  if (ms > 0) statusTimer = setTimeout(() => { if (appStore().get().status === text) appStore().set({ status: '' }) }, ms)
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

let busy = false
let scheduled = false
// The release this run already installed (or, on Windows, downloaded):
// the half-hourly check must not fetch it again, only remind.
let ready: Update | null = null

// Start the background checks; called once at start-up.
export async function scheduleUpdates(delayMs = STARTUP_DELAY_MS): Promise<void> {
  setCommandChecked('update_automatically', autoEnabled())
  // One updater per app (Updater is owned by the QApplication): the main
  // window's, not one per File ▸ New window.
  if (scheduled || !isTauri() || getCurrentWindow().label !== 'main') return
  if (await invoke<boolean>('updates_disabled').catch(() => false)) return
  scheduled = true
  setTimeout(() => void start(false), delayMs)
  setInterval(() => void start(false), INTERVAL_MS)
}

export function checkNow(): Promise<void> {
  return start(true)
}

async function start(manual: boolean): Promise<void> {
  if (busy) {
    if (manual) status('Already checking for updates…')
    return
  }
  if (!manual && !autoEnabled()) return
  if (!isTauri()) {
    if (manual) await information('Check for updates', `${APP_NAME} ${CURRENT} is up to date.`)
    return
  }
  busy = true
  try {
    if (manual) status('Checking for updates…', 0)
    let update: Update | null
    try {
      update = await check()
    } catch (e) {
      if (manual) {
        status('')
        await warning('Check for updates', `Could not check for updates.\n\n${message(e)}`)
      }
      return
    }
    if (manual) status('')
    if (!update) {
      if (manual) await information('Check for updates', `${APP_NAME} ${CURRENT} is up to date.`)
      return
    }
    await offer(update, manual)
  } finally {
    busy = false
  }
}

// download() then, where the app may be replaced while it runs, install().
async function bringUpToDate(update: Update, onProgress?: (text: string) => void): Promise<void> {
  let total = 0
  let done = 0
  await update.download(ev => {
    if (ev.event === 'Started') total = ev.data.contentLength ?? 0
    else if (ev.event === 'Progress') {
      done += ev.data.chunkLength
      onProgress?.(total ? `Downloading… ${Math.round((done / total) * 100)} %` : 'Downloading…')
    } else onProgress?.('Installing…')
  })
  if (!installsOnQuit()) await update.install()
}

async function offer(update: Update, manual: boolean): Promise<void> {
  const latest = shortVersion(update.version)
  const notes = releaseNotes(update.body)
  const prior = ready
  const already = prior !== null && prior.version === update.version
  if (prior && already) update = prior
  else if (autoEnabled()) {
    try {
      await bringUpToDate(update)
      ready = update
    } catch (e) {
      if (manual) await warning('Update failed', message(e))
      else status(`An update is available (${APP_NAME} ${latest}), but it could not be installed: ${message(e)}`, 15000)
      return
    }
  }
  if (ready === update) {
    const onQuit = installsOnQuit()
    status(onQuit
      ? `${APP_NAME} ${latest} downloaded — restart to install it.`
      : `${APP_NAME} updated to ${latest} — restart to use it.`, 0)
    // The half-hourly check reminds in the status bar, not with the dialog again.
    if (already && !manual) return
    const accepted = await updateDialog({
      title: `${APP_NAME} updated`,
      intro: onQuit
        ? `${APP_NAME} ${latest} was downloaded (you have ${CURRENT}). Restart to install and use the new version.`
        : `${APP_NAME} was brought up to date (${CURRENT} → ${latest}). Restart to use the new version.`,
      notesMd: notes,
      acceptText: 'Restart now',
    })
    if (accepted) await restart(update)
    return
  }
  const accepted = await updateDialog({
    title: 'Update available',
    intro: `${APP_NAME} ${latest} is available (you have ${CURRENT}). Update now?`,
    notesMd: notes,
    acceptText: 'Update and restart',
  })
  if (!accepted) return
  const box = progressBox('Update', 'Downloading…')
  try {
    await Promise.race([
      bringUpToDate(update, t => box.setLabel(t)).then(() => { ready = update }),
      box.cancelled.then(() => { throw new Error('Cancelled.') }),
    ])
  } catch (e) {
    box.close()
    await warning('Update failed', message(e))
    return
  }
  box.close()
  status(`Updated to ${latest}.`, 0)
  await restart(update)
}

// Offer to save the open document, then start the new version: on Windows
// the installer does it as the app quits, elsewhere the app relaunches.
export async function restart(update: Update | null = null): Promise<void> {
  if (!(await offerSaveBefore('restarting'))) return
  await shutdownCompiles()
  try {
    if (update && installsOnQuit()) await update.install()
    await relaunch()
  } catch {
    await information('Restart', `Please close and start ${APP_NAME} again to use the update.`)
  }
}

registerActions({
  check_updates: () => checkNow(),
  check_updates_menu: () => checkNow(),
  // The command state already flipped the check; store it, as act.toggled.
  update_automatically: (on) => { setSetting(KEY_AUTO, on === undefined ? !autoEnabled() : !!on) },
})
