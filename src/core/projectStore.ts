// Where a document's files live on disk. A port of khervedoc/project_store.py.
//
// A folder holds only the user's .ktex files (and exported PDFs). Every
// working file — generated .tex, equation previews, pasted figures,
// unpacked project documents — goes in a hidden `.kherve/` folder beside
// them, which Git still tracks so history stays readable.

import * as kdocz from './kdocz.ts'
import type { FileAccess } from './kdocz.ts'
import { fromJson, projectFromJson, toJson } from './model.ts'
import type { Document, Project } from './model.ts'
import { basename, dirname, join, suffix } from './paths.ts'
import { strToU8 } from 'fflate'

export const WORK_DIR = '.kherve'

// FileAccess plus mkdir, for the folder work_dir creates up front. Without
// it the folder appears with the first file written into it.
export interface StoreFs extends FileAccess {
  mkdir?(path: string): Promise<void>  // parents=True, exist_ok=True
  // A new folder in the system's temporary folder.
  makeTempDir?(prefix: string): Promise<string>
}

// A folder a cloud service keeps in sync (OneDrive, iCloud Drive, Dropbox,
// Google Drive).
const SYNCED_RE = /[\\/]Library[\\/](?:CloudStorage|Mobile Documents)[\\/]|[\\/](?:OneDrive|Dropbox|Google Drive|iCloud Drive)[^\\/]*[\\/]/i
export function isSyncedFolder(folder: string): boolean {
  return SYNCED_RE.test(folder + '/')
}

let localBase: string | null = null
const fnv = (s: string) => {
  let h = 0x811c9dc5
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

// Where a document's figures unpack: under .kherve/, or for a folder a
// cloud service syncs, in a local folder of the project's own. There the
// service uploaded every unpacked picture again, and while it did reading
// one timed out: the compile stopped ("Operation timed out").
async function filesDir(folder: string, stem: string, fs: StoreFs): Promise<string> {
  if (isSyncedFolder(folder) && fs.makeTempDir) {
    localBase ??= dirname(await fs.makeTempDir('khervetex-'))
    const d = join(join(join(localBase, 'khervetex-files'), fnv(folder)), stem)
    await fs.mkdir?.(d)
    return d
  }
  return join(join(await workDir(folder, fs), 'files'), stem)
}

export async function workDir(folder: string, fs?: StoreFs): Promise<string> {
  const d = join(folder, WORK_DIR)
  await fs?.mkdir?.(d)
  return d
}

export function docStem(path: string): string {
  const name = basename(path)
  for (const ext of ['.kdocproj.json', '.ktex.json', '.kdoc.json']) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length)
  }
  // Path.stem
  const s = suffix(name)
  return s ? name.slice(0, -s.length) : name
}

// Python's read_text(encoding="utf-8"): a BOM stays, newlines are universal.
const readText = async (path: string, fs: FileAccess) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(await fs.read(path)).replace(/\r\n?/g, '\n')

// Load a project document; .ktex figures unpack under .kherve/ (filesDir).
export async function readDoc(path: string, fs: StoreFs): Promise<Document> {
  if (kdocz.isKdoczPath(path)) {
    const [doc] = await kdocz.loadKdocz(path, await filesDir(dirname(path), docStem(path), fs), fs)
    return doc
  }
  return fromJson(await readText(path, fs))
}

export async function writeDoc(doc: Document, path: string, fs: FileAccess): Promise<void> {
  if (kdocz.isKdoczPath(path)) await kdocz.saveKdocz(doc, path, fs)
  else await fs.write(path, strToU8(toJson(doc)))
}

// The project in a main .ktex (or a legacy .kdocproj.json).
export async function readProject(path: string, fs: FileAccess): Promise<Project | null> {
  if (basename(path).toLowerCase().endsWith('.kdocproj.json')) {
    return projectFromJson(await readText(path, fs))
  }
  const text = kdocz.isKdoczPath(path) ? await kdocz.readProjectJson(path, fs) : null
  return text ? projectFromJson(text) : null
}

export async function uniquePath(folder: string, stem: string, fs: FileAccess, ext = '.ktex'): Promise<string> {
  let dest = join(folder, `${stem}${ext}`)
  let n = 1
  while (await fs.exists(dest)) {
    dest = join(folder, `${stem}_${n}${ext}`)
    n += 1
  }
  return dest
}
