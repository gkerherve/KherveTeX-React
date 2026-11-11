// Pictures pasted or dropped into the document (core/pictures.ts,
// editor/pictureTransfer.ts): file names graphicx reads, the size a
// screenshot prints at, which pastes are pictures, and copied figures
// that paste into another folder.
import { Slice } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import * as M from '../src/core/model.ts'
import { extForType, isImageName, naturalWidth, pictureFileName, pngDpi } from '../src/core/pictures.ts'
import { docToPM } from '../src/editor/convert.ts'
import { absoluteFigurePaths, imageFiles, isPicturePaste } from '../src/editor/pictureTransfer.ts'

// A PNG header with a pHYs chunk of `ppm` pixels per metre.
function png(ppm: number | null): Uint8Array {
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const chunk = (type: string, data: number[]) => {
    const len = data.length
    parts.push(len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...[...type].map(c => c.charCodeAt(0)), ...data, 0, 0, 0, 0)
  }
  chunk('IHDR', new Array(13).fill(0))
  if (ppm !== null) {
    const b = [ppm >>> 24, (ppm >>> 16) & 255, (ppm >>> 8) & 255, ppm & 255]
    chunk('pHYs', [...b, ...b, 1])
  }
  chunk('IDAT', [0])
  return new Uint8Array(parts)
}

function fakeTransfer(files: { name: string; type: string }[], text = ''): DataTransfer {
  const fs = files.map(f => ({ ...f, size: 10 })) as unknown as File[]
  return {
    files: fs, items: [], getData: (t: string) => (t === 'text/plain' ? text : ''),
  } as unknown as DataTransfer
}

describe('pictures', () => {
  it('names a screenshot so graphicx reads it', () => {
    const taken = new Set(['Screenshot-2026-11-11-at-12-30-45.png'])
    expect(pictureFileName('Screenshot 2026-11-11 at 12.30.45.png', '.png', n => taken.has(n)))
      .toBe('Screenshot-2026-11-11-at-12-30-45-2.png')
    expect(pictureFileName('Café photo.JPG', '.jpg', () => false)).toBe('Cafe-photo.jpg')
    expect(pictureFileName('', '.png', () => false)).toBe('picture.png')
  })
  it('reads the resolution a PNG records', () => {
    expect(pngDpi(png(5669))).toBeCloseTo(144, 0)     // a Retina screenshot
    expect(pngDpi(png(null))).toBe(null)
    expect(pngDpi(new Uint8Array([1, 2, 3]))).toBe(null)
  })
  it('prints a picture at its own size, a large one at 0.8 of the text width', () => {
    expect(naturalWidth(400, 144)).toBe('7.1cm')
    expect(naturalWidth(2880, 144)).toBe('0.8\\textwidth')
    expect(naturalWidth(0, null)).toBe('0.8\\textwidth')
    expect(naturalWidth(10, 96)).toBe('0.5cm')
  })
  it('knows picture names and clipboard types', () => {
    expect(isImageName('a/b/shot.HEIC')).toBe(true)
    expect(isImageName('thesis.ktex')).toBe(false)
    expect(extForType('image/jpeg')).toBe('.jpg')
    expect(extForType('image/svg+xml')).toBe('.svg')
    expect(extForType('application/pdf')).toBe('.pdf')
  })
  it('a paste with a picture and no text is a picture', () => {
    expect(isPicturePaste(fakeTransfer([{ name: 'image.png', type: 'image/png' }]))).toBe(true)
    // Word puts a picture of the copied text on the clipboard too.
    expect(isPicturePaste(fakeTransfer([{ name: 'image.png', type: 'image/png' }], 'Some text'))).toBe(false)
    expect(isPicturePaste(fakeTransfer([], 'text'))).toBe(false)
    expect(imageFiles(fakeTransfer([{ name: 'notes.txt', type: 'text/plain' }, { name: 'a.gif', type: '' }]))
      .map(f => f.name)).toEqual(['a.gif'])
  })
  it('a copied figure keeps its full path', () => {
    const doc = docToPM(M.document([
      M.figure({ path: 'Images/plot.png' }),
      M.figure({ path: '/abs/drawing.png' }),
    ]))
    const out = absoluteFigurePaths(new Slice(doc.content, 0, 0), '/Users/me/thesis')
    const paths: string[] = []
    out.content.forEach(n => paths.push(n.attrs.path))
    expect(paths).toEqual(['/Users/me/thesis/Images/plot.png', '/abs/drawing.png'])
    expect(absoluteFigurePaths(new Slice(doc.content, 0, 0), null).content.firstChild!.attrs.path).toBe('Images/plot.png')
  })
})
