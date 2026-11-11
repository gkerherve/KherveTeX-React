// What a paste or a drop carries in pictures (app/pictures.ts saves and
// inserts them), and copied figures made to paste anywhere.
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model'
import { isAbsolute, join } from '../core/paths.ts'
import { isImageName, isImageType } from '../core/pictures.ts'

// The picture files a paste or a drop carries.
export function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const files = [...(dt.files ?? [])]
  for (const it of [...(dt.items ?? [])]) {
    if (it.kind === 'file') {
      const f = it.getAsFile()
      if (f && !files.some(x => x.name === f.name && x.size === f.size)) files.push(f)
    }
  }
  return files.filter(f => isImageType(f.type) || isImageName(f.name))
}

// A paste is a picture when it carries one and no text: copying from Word
// or a web page also puts a picture of the selection on the clipboard, and
// the text is what is meant there.
export function isPicturePaste(dt: DataTransfer | null): boolean {
  if (!dt || !imageFiles(dt).length) return false
  return !(dt.getData('text/plain') || '').trim()
}

// The slice with each figure's path made absolute against `docDir`, so a
// copied figure pastes into a document in another folder and still shows.
export function absoluteFigurePaths(slice: Slice, docDir: string | null): Slice {
  if (!docDir) return slice
  const map = (frag: Fragment): Fragment => {
    const out: PMNode[] = []
    frag.forEach(n => {
      if (n.type.name === 'figure' && n.attrs.path && !isAbsolute(n.attrs.path)) {
        out.push(n.type.create({ ...n.attrs, path: join(docDir, n.attrs.path) }, n.content, n.marks))
      } else {
        out.push(n.isLeaf ? n : n.copy(map(n.content)))
      }
    })
    return Fragment.from(out)
  }
  return new Slice(map(slice.content), slice.openStart, slice.openEnd)
}
