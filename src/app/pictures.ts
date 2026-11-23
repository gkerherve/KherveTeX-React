import { pref } from './prefs.ts'
// Pictures from outside the document: pasted from the clipboard (Cmd+V, the
// Paste button, Paste Special ▸ Picture) or dropped on the page (a file
// from Finder, the screenshot thumbnail macOS shows after Cmd+Shift+4).
// Each is saved in the document's figures folder (drawing/host.imagesDir:
// .kherve/figures beside a saved document) and inserted as a figure where
// it was dropped, or at the caret. Names and sizes: core/pictures.ts.
import { TextSelection } from 'prosemirror-state'
import * as M from '../core/model.ts'
import { basename, join } from '../core/paths.ts'
import {
  LATEX_IMAGE_EXTS, extForType, extOf, isImageName, isImageType, naturalWidth, pictureFileName, pngDpi,
} from '../core/pictures.ts'
export { imageFiles, isPicturePaste } from '../editor/pictureTransfer.ts'
import { imagesDir } from '../drawing/host.ts'
import * as C from '../editor/commands.ts'
import { editor } from '../editor/controller.ts'
import { platform } from '../platform/index.ts'
import { appStore } from './store.ts'

export interface Picture {
  bytes: Uint8Array
  // Its file name (from Finder, the clipboard), which names the copy.
  name: string
  type: string
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.heic': 'image/heic', '.heif': 'image/heif', '.pdf': 'application/pdf',
}

// The picture decoded by the web view (it reads every format macOS does).
async function decode(bytes: Uint8Array, mime: string): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const img = new Image()
  img.src = url
  try {
    await img.decode()
    return img
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function toPng(img: HTMLImageElement): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 1
  canvas.height = img.naturalHeight || 1
  canvas.getContext('2d')?.drawImage(img, 0, 0)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

// Save one picture in the figures folder: the figure that shows it, or
// null when it is not a picture the web view can read.
async function savePicture(p: Picture): Promise<M.Figure | null> {
  let ext = extOf(p.name)
  if (!ext || !MIME[ext]) ext = extForType(p.type)
  let bytes = p.bytes
  let width = '0.8\\textwidth'
  if (ext !== '.pdf') {
    const img = await decode(bytes, MIME[ext] ?? p.type)
    if (!img) return null
    if (!LATEX_IMAGE_EXTS.includes(ext)) {
      const png = await toPng(img)
      if (!png) return null
      bytes = png
      ext = '.png'
    }
    width = naturalWidth(img.naturalWidth, ext === '.png' ? pngDpi(bytes) : null)
  }
  // Preferences ▸ Edit: pictures inserted at a set share of the text width.
  const share = pref('edit/picture_width')
  if (share !== 'natural') width = `${share}\\textwidth`
  const dir = await imagesDir()
  const pf = platform()
  const names = new Set((await pf.listDir(dir).catch(() => [])).map(e => e.name))
  const name = pictureFileName(p.name, ext, n => names.has(n))
  const path = join(dir, name)
  await pf.writeFile(path, bytes)
  return M.figure({ path, caption: '', width })
}

// Insert pictures as figures at document position `at` (where they were
// dropped) or at the caret; how many were inserted.
export async function insertPictures(pics: Picture[], at: number | null = null): Promise<number> {
  const figs: M.Figure[] = []
  for (const p of pics) {
    const f = await savePicture(p).catch(() => null)
    if (f) figs.push(f)
  }
  const e = editor()
  if (!e || !figs.length) {
    if (pics.length) appStore().set({ status: 'That picture could not be read.' })
    return 0
  }
  if (at !== null) {
    const s = e.view.state
    const pos = Math.max(0, Math.min(at, s.doc.content.size))
    e.view.dispatch(s.tr.setSelection(TextSelection.near(s.doc.resolve(pos))))
  }
  e.run(C.insertModelBlocks(figs, { select: 0, trailingParagraph: true }))
  e.syncToolbar()
  appStore().set({ status: figs.length === 1 ? 'Picture inserted' : `${figs.length} pictures inserted` })
  return figs.length
}

async function fromFile(f: File, name?: string): Promise<Picture> {
  return { bytes: new Uint8Array(await f.arrayBuffer()), name: name ?? f.name, type: f.type }
}

// Cmd+V on the page / a drop from a browser: the files' pictures.
export async function insertPictureFiles(files: File[], at: number | null = null, pasted = false): Promise<number> {
  // A pasted screenshot has no name of its own ("image.png").
  const pics = await Promise.all(files.map(f => fromFile(f, pasted ? 'pasted-picture' + extOf(f.name) : undefined)))
  return insertPictures(pics, at)
}

// A drop from Finder or the screenshot thumbnail (the desktop app gets
// paths): the pictures among them.
export async function insertPicturePaths(paths: string[], at: number | null = null): Promise<number> {
  const pics: Picture[] = []
  for (const p of paths.filter(isImageName)) {
    try {
      pics.push({ bytes: await platform().readFile(p), name: basename(p), type: MIME[extOf(p)] ?? '' })
    } catch {
      // unreadable (a cloud file not downloaded): skipped
    }
  }
  return insertPictures(pics, at)
}

// The picture on the clipboard, read through the clipboard API (the Paste
// button, Paste Special), or null when it holds none or holds text.
export async function clipboardPicture(): Promise<Picture | null> {
  try {
    const items = await navigator.clipboard.read()
    for (const it of items) {
      if (it.types.includes('text/plain')) {
        const t = await (await it.getType('text/plain')).text()
        if (t.trim()) return null
      }
      const type = it.types.find(isImageType)
      if (type) {
        const blob = await it.getType(type)
        return { bytes: new Uint8Array(await blob.arrayBuffer()), name: 'pasted-picture' + extForType(type), type }
      }
    }
  } catch {
    // no permission, or no clipboard API
  }
  return null
}

// The document position under a point of the window, or null off the text.
export function positionAt(x: number, y: number): number | null {
  const e = editor()
  if (!e) return null
  return e.view.posAtCoords({ left: x, top: y })?.pos ?? null
}
