// The single-file .ktex container — a ZIP holding the document JSON plus
// every image the document references. A port of khervedoc/kdocz.py; the
// archives are interchangeable with the Python app's. .ktexz / .kdocz are
// the same container under its older names and still open.
//
//   manifest.json   schema version + producing app
//   document.json   the document model, figure paths pointing at the
//                   bundled files ("figures/figure_001.png")
//   document.tex    the generated LaTeX, for readers without KherveTeX
//   project.json    only in a project's main document: its other .ktex files
//   kherveref.bib   the cited entries of a KherveRef-managed document
//   figures/        the bundled images (older archives used images/)

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { Zippable } from 'fflate'
import { document as makeDocument, fromJson, toJson } from './model.ts'
import type { Block, Document, Figure } from './model.ts'
import { basename, dirname, isAbsolute, join, normalize, suffix, withSuffix } from './paths.ts'
import { pyJson, strip, zpad } from './py.ts'
import { serializeDocument } from './serializer.ts'

export const SCHEMA_VERSION = 1
export const MANIFEST_BASENAME = 'manifest.json'
export const DOC_BASENAME = 'document.json'
export const TEX_BASENAME = 'document.tex'
export const PROJECT_BASENAME = 'project.json'
export const IMAGES_DIR = 'figures'
export const EQUATIONS_DIR = 'equations'
export const NATIVE_SUFFIX = '.ktex'
export const BIB_BASENAME = 'kherveref.bib'

// The file access the container needs. Tauri's fs plugin in the app, node:fs
// in the tests; relative paths are as the caller's working directory sees them.
export interface FileAccess {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<void>  // creates parent folders
}

export function isKdoczPath(path: string): boolean {
  const s = path.toLowerCase()
  return s.endsWith('.ktex') || s.endsWith('.kdocz') || s.endsWith('.ktexz')
}

// A bundle under a pre-.ktex name; saving converts it to .ktex.
export function isLegacyBundle(path: string): boolean {
  const s = path.toLowerCase()
  return s.endsWith('.kdocz') || s.endsWith('.ktexz')
}

const FIGURE_SIBLINGS: Record<string, string[]> = {
  drawing: ['.svg', '.pdf'],
  flowchart: ['.pdf', '.flow.json', '.tikz'],
}

// A copy of `doc` whose Figure paths point at figures/…, plus the (source
// file, archive name) pairs to store. Figures whose file is missing keep
// their path so the user can re-link them later.
async function bundleFigures(doc: Document, baseDir: string, fs: FileAccess): Promise<[Document, [string, string][]]> {
  const rewritten: Block[] = []
  const images: [string, string][] = []
  const bySource = new Map<string, string>()  // de-dupe identical paths
  let counter = 1
  // The archive name for one picture file (adding it once), or its own
  // path when the file is missing so the user can re-link it later.
  const bundle = async (src: string, source: string): Promise<string> => {
    let arcName = bySource.get(src)
    if (arcName !== undefined) return arcName
    let srcPath = src
    // Fall back to looking next to the saved file for relative
    // references — the common case for imported documents not yet saved.
    if (!isAbsolute(srcPath) && !(await fs.exists(srcPath))) {
      const candidate = join(baseDir, src)
      if (await fs.exists(candidate)) srcPath = candidate
    }
    if (await fs.exists(srcPath)) {
      const ext = suffix(srcPath) || '.png'
      arcName = `${IMAGES_DIR}/figure_${zpad(counter, 3)}${ext}`
      counter += 1
      images.push([srcPath, arcName])
      // The editable source and the PDF LaTeX includes live beside the
      // PNG preview; keep them paired by stem.
      for (const sibExt of FIGURE_SIBLINGS[source] ?? []) {
        const sib = withSuffix(srcPath, sibExt)
        if (await fs.exists(sib)) images.push([sib, arcName.slice(0, -ext.length) + sibExt])
      }
    } else {
      arcName = src
    }
    bySource.set(src, arcName)
    return arcName
  }
  for (const block of doc.children) {
    if (block.type === 'Figure' && block.path) {
      const arcName = await bundle(block.path, block.source)
      const out = { ...block, path: arcName } as Figure
      if (block.extra && block.extra.length) {
        out.extra = []
        for (const e of block.extra) out.extra.push({ ...e, path: e.path ? await bundle(e.path, '') : e.path })
      }
      rewritten.push(out)
    } else {
      rewritten.push(block)
    }
  }
  return [makeDocument(rewritten, doc.meta), images]
}

// The archive bytes for `doc` and its images, with the generated LaTeX
// alongside so the archive is readable on its own. `bibText` (the cited
// KherveRef entries) is bundled so the document compiles without the library;
// `projectJson` keeps a project's main document's project.
export async function packKtex(doc: Document, baseDir: string, fs: FileAccess,
  opts: { bibText?: string; projectJson?: string | null } = {}): Promise<Uint8Array> {
  const [archiveDoc, images] = await bundleFigures(doc, baseDir, fs)
  const files: Zippable = {}
  if (opts.projectJson != null) files[PROJECT_BASENAME] = strToU8(opts.projectJson)
  files[MANIFEST_BASENAME] = strToU8(pyJson({ format: 'ktex', schema_version: SCHEMA_VERSION, app: 'KherveTeX' }))
  files[DOC_BASENAME] = strToU8(toJson(archiveDoc))
  files[TEX_BASENAME] = strToU8(serializeDocument(archiveDoc))
  for (const [srcPath, arcName] of images) files[arcName] = await fs.read(srcPath)
  if (opts.bibText) files[BIB_BASENAME] = strToU8(opts.bibText)
  return zipSync(files, { level: 6 })
}

export async function saveKdocz(doc: Document, outPath: string, fs: FileAccess, bibText = ''): Promise<void> {
  // A project's main document carries the project; saving its text must
  // not drop it.
  const projectJson = await readProjectJson(outPath, fs)
  await fs.write(outPath, await packKtex(doc, dirname(outPath), fs, { bibText, projectJson }))
}

function entries(bytes: Uint8Array): Record<string, Uint8Array> | null {
  try {
    return unzipSync(bytes)
  } catch {
    return null
  }
}

async function entriesAt(path: string, fs: FileAccess): Promise<Record<string, Uint8Array> | null> {
  try {
    return entries(await fs.read(path))
  } catch {
    return null
  }
}

// The project.json text stored in a .ktex, or null.
export async function readProjectJson(path: string, fs: FileAccess): Promise<string | null> {
  const z = await entriesAt(path, fs)
  return z && PROJECT_BASENAME in z ? strFromU8(z[PROJECT_BASENAME]) : null
}

// Store `projectJson` in the .ktex at `path`, keeping every other entry.
export async function writeProjectJson(path: string, projectJson: string, fs: FileAccess): Promise<void> {
  const src = unzipSync(await fs.read(path))
  const files: Zippable = {}
  for (const [name, data] of Object.entries(src)) {
    if (name !== PROJECT_BASENAME) files[name] = data
  }
  files[PROJECT_BASENAME] = strToU8(projectJson)
  await fs.write(path, zipSync(files, { level: 6 }))
}

// A ready-to-compile LaTeX package (Overleaf, journal upload): main.tex,
// figures/ and equations/ — one .tex per display equation, so they can be
// reused or submitted separately.
// *extra*: more files beside main.tex (the references, kherveref.bib, and
// the document's own .sty / .cls / .bib), so the package compiles anywhere.
export async function exportLatexZip(doc: Document, baseDir: string, fs: FileAccess, mainName = 'main',
  extra: Record<string, Uint8Array> = {}): Promise<Uint8Array> {
  const [texDoc, images] = await bundleFigures(doc, baseDir, fs)
  const files: Zippable = {}
  files[`${mainName}.tex`] = strToU8(serializeDocument(texDoc))
  for (const [name, data] of Object.entries(extra)) files[name] = data
  for (const [srcPath, arcName] of images) files[arcName] = await fs.read(srcPath)
  let n = 0
  for (const block of doc.children) {
    if (block.type === 'MathBlock' && strip(block.latex)) {
      n += 1
      const env = block.numbered ? 'equation' : 'equation*'
      const label = block.label ? `\\label{${block.label}}\n` : ''
      files[`${EQUATIONS_DIR}/eq_${zpad(n, 3)}.tex`] = strToU8(
        `\\begin{${env}}\n${label}${strip(block.latex)}\n\\end{${env}}\n`)
    }
  }
  return zipSync(files, { level: 6 })
}

export interface UnpackedKtex {
  doc: Document  // figure paths as stored: relative to the archive root
  files: Record<string, Uint8Array>
}

export function unpackKtex(bytes: Uint8Array, name = 'document.ktex'): UnpackedKtex {
  const files = unzipSync(bytes)
  if (MANIFEST_BASENAME in files) {
    const manifest = JSON.parse(strFromU8(files[MANIFEST_BASENAME]))
    const version = manifest.schema_version ?? 0
    if (version > SCHEMA_VERSION) {
      throw new Error(`${basename(name)} was produced by a newer kTeX (schema ${version} > ${SCHEMA_VERSION}).`)
    }
  }
  if (!(DOC_BASENAME in files)) throw new Error(`${basename(name)} has no ${DOC_BASENAME}`)
  return { doc: fromJson(strFromU8(files[DOC_BASENAME])), files }
}

// Open a .ktex: unpack it into `extractTo` and point Figure paths at the
// extracted files (absolute, forward-slashed), so the compiler finds every
// image with no further setup.
export async function loadKdocz(path: string, extractTo: string, fs: FileAccess): Promise<[Document, string]> {
  const { doc, files } = unpackKtex(await fs.read(path), path)
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith('/')) await fs.write(join(extractTo, name), data)
  }
  for (const block of doc.children) {
    if (block.type === 'Figure' && block.path) {
      const candidate = join(extractTo, block.path)
      if (await fs.exists(candidate)) block.path = normalize(candidate)
      for (const e of block.extra ?? []) {
        const c = join(extractTo, e.path)
        if (await fs.exists(c)) e.path = normalize(c)
      }
    }
  }
  return [doc, extractTo]
}

// The kherveref.bib bundled in a .ktex, or "".
export async function readBundledBib(path: string, fs: FileAccess): Promise<string> {
  const z = await entriesAt(path, fs)
  return z && BIB_BASENAME in z ? strFromU8(z[BIB_BASENAME]) : ''
}
