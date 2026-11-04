// The git and disk operations overleaf.ts needs, injected so the core runs in
// Vitest (the git CLI) and in the app (git2-rs through Tauri). They mirror
// the pygit2 calls khervedoc/overleaf.py makes, one for one. Every git
// failure throws an Error whose message is the git error text: overleaf.ts
// turns it into a message for the user (_explain).
//
// `token` is Overleaf's Git authentication token; "" means no credentials
// (pygit2 callbacks=None). With a token the credentials are user "git",
// password <token> (pygit2.UserPass("git", token)).

import type { FileAccess } from './kdocz.ts'
import type { Document } from './model.ts'

export interface OverleafIo {
  // The working tree: read, write (creating parent folders), exists.
  fs: FileAccess
  // Names (not paths) of the entries directly inside `dir`, files only.
  listDir(dir: string): Promise<string[]>
  // Every file under `dir`, '/'-separated and relative to it, skipping .git/.
  listTree(dir: string): Promise<string[]>
  // shutil.rmtree(dir).
  removeTree(dir: string): Promise<void>

  // repo.remotes["origin"].url of the repository at `dir`.
  remoteUrl(dir: string): Promise<string>
  // repo.remotes["origin"].fetch(callbacks=...).
  fetch(dir: string, token: string): Promise<void>
  // Force-checkout refs/remotes/origin/<branch> into the working tree and
  // point HEAD at it (checkout_tree GIT_CHECKOUT_FORCE + set_head).
  checkoutRemoteBranch(dir: string, branch: string): Promise<void>
  // pygit2.clone_repository(url, dir, callbacks=..., checkout_branch=branch);
  // creates the parent folders.
  clone(url: string, dir: string, token: string, branch: string): Promise<void>

  // index.add_all(); index.write(); index.write_tree() — the new tree's id.
  stageAll(dir: string): Promise<string>
  // HEAD's tree id, or null while HEAD is unborn.
  headTree(dir: string): Promise<string | null>
  // repo.create_commit(ref, sig, sig, message, tree, parents) with the user's
  // git identity (git_backend._signature: repo.default_signature, falling
  // back to "KherveTeX" <khervedoc@local>) and HEAD as the parent unless
  // HEAD is unborn. As libgit2, it fails ("current tip is not the first
  // parent") when `ref` exists and does not point at HEAD — which is the
  // case after a fetch brought collaborators' commits (HEAD is detached at
  // origin/<branch>, the local branch is behind): the Python app fails the
  // same way there.
  commit(dir: string, ref: string, message: string, tree: string): Promise<void>
  // repo.remotes["origin"].push([ref], callbacks=...).
  push(dir: string, ref: string, token: string): Promise<void>
}

let current: OverleafIo | null = null

export function setOverleafIo(io: OverleafIo | null): void {
  current = io
}

export function overleafIo(): OverleafIo {
  if (!current) throw new Error('Overleaf is not available in this build (no git backend).')
  return current
}

// What the Overleaf commands need from the app around the core (MainWindow
// in Python): settings, the settings folder the clones live under, the save
// dialog, and the document's bibliography.
export interface OverleafHost {
  // Disk access for Download for Overleaf (reading figures, writing the zip).
  fs: FileAccess
  // QSettings("kherveDOC", "kherveDOC").fileName()'s folder; clones go in
  // <it>/overleaf/<sha1(link)[:12]>.
  settingsDir(): Promise<string>
  // QSettings value / setValue (the remembered project link per document).
  settingValue(key: string): string | null
  setSettingValue(key: string, value: string): void
  // QFileDialog.getSaveFileName(title, defaultName, "Zip archive (*.zip)"):
  // the chosen absolute path, or null when cancelled.
  saveFileDialog(title: string, defaultName: string,
    filter: { name: string; extensions: string[] }): Promise<string | null>
  // Path.cwd(): the folder relative figure paths resolve against for an
  // Untitled document.
  cwd(): string
  // MainWindow._refresh_kherveref_bib(doc): kherveref.bib's text for a
  // document that cites from a KherveRef library, else "".
  kherverefBib?(doc: Document): Promise<string>
  // _overleaf_get: the Overleaf version opens in a new window with `folder`
  // as its document folder, nothing here replaced. Without it the version
  // replaces the open document.
  openInNewWindow?(doc: Document, folder: string, linkKeyValue: string): Promise<void>
}

let host: OverleafHost | null = null

export function setOverleafHost(h: OverleafHost | null): void {
  host = h
}

export function overleafHost(): OverleafHost {
  if (!host) throw new Error('Overleaf is not available in this build (no platform host).')
  return host
}
