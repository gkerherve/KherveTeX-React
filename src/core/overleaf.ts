// Work on a document with collaborators on Overleaf. A port of
// khervedoc/overleaf.py.
//
// Overleaf keeps every project in a git repository (https://git.overleaf.com/
// <project id>), reachable with the user name "git" and a Git authentication
// token from Overleaf's account settings. Sending writes the document as
// LaTeX (main .tex, figures, bibliography) into a local clone of that
// repository and pushes it; getting pulls what collaborators changed and reads
// the .tex back into a document.
//
// Overleaf's git access needs a plan that includes it. On a free plan the same
// files go up as a zip through Overleaf's "Upload project" (File > Share >
// Download for Overleaf).
//
// The git calls go through the injected OverleafIo (overleafIo.ts).

import { strToU8, unzipSync } from 'fflate'
import { exportLatexZip } from './kdocz.ts'
import type { FileAccess } from './kdocz.ts'
import { importTex } from './importers.ts'
import type { ImportFs } from './importers.ts'
import type { Document } from './model.ts'
import { basename, join, normalize, suffix } from './paths.ts'
import { pyRe, reSearch, strip } from './py.ts'
import { overleafIo } from './overleafIo.ts'
import type { OverleafIo } from './overleafIo.ts'

export const GIT_HOST = 'https://git.overleaf.com/'
export const BRANCH = 'master'
const ID_RE = pyRe('\\b([0-9a-f]{24})\\b')

// A message for the user: what went wrong and what to do about it.
export class OverleafError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverleafError'
  }
}

// The project's git address from whatever the user pasted: the
// browser link (overleaf.com/project/<id>), the git link, or the bare id.
// Anything else is taken as a git address as it is (a test server).
export function gitUrl(link: string | null | undefined): string {
  link = strip(link || '')
  if (!link) throw new OverleafError('Paste the link of your Overleaf project.')
  const m = reSearch(ID_RE, link)
  if (m && (link.includes('overleaf.com') || link === m[1])) return GIT_HOST + m[1]
  // Share > Copy sharing link (overleaf.com/<token>, /read/<token>) only
  // invites people; git needs the project's own id.
  if (link.includes('overleaf.com')) {
    throw new OverleafError(
      'That is a sharing link, not the project link. Open the project on ' +
      'overleaf.com and copy the address from the browser bar ' +
      '(https://www.overleaf.com/project/…).')
  }
  if (link.includes('://') || link.startsWith('/')) return link
  throw new OverleafError(
    'That does not look like an Overleaf project link. Open the project ' +
    'on overleaf.com and copy the address from the browser.')
}

// The git command line (which stands in for pygit2 here) reports a refused
// token as "could not read Username ... terminal prompts disabled".
const AUTH_RE = pyRe('401|403|auth|credential|could not read (Username|Password)', 'i')
const NOT_FOUND_RE = pyRe('404|not found|does not appear', 'i')

function errorText(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc)
}

export function explain(exc: unknown): OverleafError {
  const text = errorText(exc)
  if (reSearch(AUTH_RE, text)) {
    return new OverleafError(
      'Overleaf did not accept the token. Create a Git authentication ' +
      'token in Overleaf (Account Settings > Git Integration) and paste ' +
      'it again. Git access needs an Overleaf plan that includes it; ' +
      'on a free plan use Download for Overleaf instead.')
  }
  if (reSearch(NOT_FOUND_RE, text)) {
    return new OverleafError(
      'Overleaf could not find that project. Check the link, and that ' +
      'the token belongs to the project\'s owner or an invited ' +
      'collaborator (people who only have the sharing link cannot use ' +
      'git).\n\nGit said: ' + text.trim().split('\n').pop())
  }
  return new OverleafError(`Overleaf: ${text}`)
}

// A working copy of `url` in `into`, up to date with Overleaf: an existing
// clone of the same project is fetched and force-checked-out, anything else
// there is replaced by a fresh clone. Returns the working folder.
async function clone(url: string, token: string, into: string, io: OverleafIo): Promise<string> {
  if (await io.fs.exists(join(into, '.git'))) {
    if (await io.remoteUrl(into) === url) {
      await io.fetch(into, token)
      await io.checkoutRemoteBranch(into, BRANCH)
      return into
    }
    await io.removeTree(into)
  }
  await io.clone(url, into, token, BRANCH)
  return into
}

// Python's utf-8 codec keeps a BOM as U+FEFF and replaces bad bytes.
const decode = (data: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(data)
// read_text(): text mode reads universal newlines.
const readText = (data: Uint8Array) => decode(data).replace(/\r\n?/g, '\n')

// Path.stem
function stem(path: string): string {
  const name = basename(path)
  const s = suffix(name)
  return s ? name.slice(0, -s.length) : name
}

// The project's main file: the root .tex that starts a document,
// preferring main.tex as Overleaf does.
export async function mainTex(folder: string, io: OverleafIo = overleafIo()): Promise<string | null> {
  if (await io.fs.exists(join(folder, 'main.tex'))) return join(folder, 'main.tex')
  const names = (await io.listDir(folder)).filter(n => n.endsWith('.tex')).sort()
  for (const name of names) {
    const path = join(folder, name)
    if (readText(await io.fs.read(path)).includes('\\documentclass')) return path
  }
  return null
}

// Write `doc` as an Overleaf project into `folder`: the same files as
// the LaTeX package export, plus any extra files (the bibliography).
export async function writeProject(doc: Document, baseDir: string, folder: string, fs: FileAccess,
  mainName = 'main', extraFiles: Record<string, string> | null = null): Promise<string> {
  const bundle = unzipSync(await exportLatexZip(doc, baseDir, fs, mainName))
  for (const [name, data] of Object.entries(bundle)) {
    if (!name.endsWith('/')) await fs.write(join(folder, name), data)
  }
  for (const [name, text] of Object.entries(extraFiles ?? {})) {
    await fs.write(join(folder, name), strToU8(text))
  }
  return join(folder, `${mainName}.tex`)
}

// Push `doc` to the Overleaf project. Returns a line for the status bar.
// `fs` reads the document's figures (from `baseDir`) and writes the clone.
export async function send(doc: Document, baseDir: string, link: string, token: string,
  cacheDir: string, extraFiles: Record<string, string> | null = null,
  message = 'Update from kTeX', io: OverleafIo = overleafIo(), fs: FileAccess = io.fs): Promise<string> {
  const url = gitUrl(link)
  let folder: string
  try {
    folder = await clone(url, token, cacheDir, io)
  } catch (exc) {
    throw explain(exc)
  }
  const existing = await mainTex(folder, io)
  const mainName = existing ? stem(existing) : 'main'
  await writeProject(doc, baseDir, folder, fs, mainName, extraFiles)
  const tree = await io.stageAll(folder)
  const head = await io.headTree(folder)
  if (head !== null && head === tree) return 'Overleaf already has this version.'
  await io.commit(folder, `refs/heads/${BRANCH}`, message, tree)
  try {
    await io.push(folder, `refs/heads/${BRANCH}`, token)
  } catch (exc) {
    throw explain(exc)
  }
  return `Sent to Overleaf (${mainName}.tex).`
}

// Binary files the importer never reads as text; everything else in the
// clone is loaded so \input and friends resolve as they do on disk.
const BINARY_SUFFIXES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.bmp', '.tif', '.tiff',
  '.webp', '.zip', '.gz', '.svgz', '.ttf', '.otf', '.woff', '.woff2'])

// The clone as the synchronous file view import_tex reads through.
async function cloneImportFs(folder: string, io: OverleafIo): Promise<ImportFs> {
  const files = new Map<string, string>()
  for (const rel of await io.listTree(folder)) {
    if (BINARY_SUFFIXES.has(suffix(rel).toLowerCase())) {
      files.set(normalize(join(folder, rel)), '')
      continue
    }
    files.set(normalize(join(folder, rel)), readText(await io.fs.read(join(folder, rel))))
  }
  return {
    isFile: (p) => files.has(normalize(p)),
    readText: (p) => files.get(normalize(p)) ?? null,
    resolve: (p) => normalize(p),
  }
}

// The project as Overleaf has it now, read back into a document, with
// the folder its figures are in.
export async function receive(link: string, token: string, cacheDir: string,
  io: OverleafIo = overleafIo()): Promise<[Document, string]> {
  const url = gitUrl(link)
  let folder: string
  try {
    folder = await clone(url, token, cacheDir, io)
  } catch (exc) {
    throw explain(exc)
  }
  const main = await mainTex(folder, io)
  if (main === null) throw new OverleafError('The Overleaf project has no main .tex file yet.')
  const source = readText(await io.fs.read(main))
  return [importTex(source, folder, await cloneImportFs(folder, io)), folder]
}

// MainWindow._overleaf_link_key: where the project link is remembered, per
// document.
export function linkKey(currentPath: string | null, projectPath: string | null): string {
  const where = currentPath || projectPath
  return where ? `overleaf/${where}` : 'overleaf/untitled'
}

// MainWindow._overleaf_cache's folder name: sha1(link)[:12], under
// <settings dir>/overleaf/.
export async function cacheKey(link: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', strToU8(link))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}
