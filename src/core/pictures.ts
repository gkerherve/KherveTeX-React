// Pictures that come from outside the document: pasted from the clipboard
// (a screenshot, an image copied in Preview or a browser) or dropped on the
// page (a file from Finder, the screenshot thumbnail macOS shows). Each is
// saved as a file in the document's figures folder and inserted as a
// figure. This module is the pure part: names, formats and sizes.

// What LaTeX (graphicx under tectonic) includes as it is; anything else a
// browser can decode (GIF, WebP, BMP, TIFF, HEIC, SVG) is turned into PNG.
export const LATEX_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.pdf']
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.pdf', '.gif', '.bmp', '.tif', '.tiff',
  '.webp', '.svg', '.heic', '.heif']

export function extOf(name: string): string {
  const m = /\.[^./\\]+$/.exec(name)
  return m ? m[0].toLowerCase() : ''
}

export function isImageName(name: string): boolean {
  return IMAGE_EXTS.includes(extOf(name))
}

export function isImageType(mime: string): boolean {
  return mime.startsWith('image/') || mime === 'application/pdf'
}

// The extension for a clipboard type ("image/png" -> ".png").
export function extForType(mime: string): string {
  const sub = mime.split('/')[1]?.split(/[+;]/)[0] ?? ''
  if (mime === 'application/pdf') return '.pdf'
  if (sub === 'jpeg') return '.jpg'
  return sub ? `.${sub}` : '.png'
}

// A file name graphicx reads: \includegraphics breaks on spaces and on a
// dot before the extension ("Screenshot 2026-11-11 at 12.30.45.png"), so
// the stem keeps letters, digits, '-' and '_'; a number is added when the
// name is taken.
export function pictureFileName(original: string, ext: string, taken: (name: string) => boolean): string {
  const stem = original.replace(/\.[^./\\]+$/, '').replace(/^.*[\\/]/, '')
  const clean = stem.normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'picture'
  let name = clean + ext
  for (let n = 2; taken(name); n++) name = `${clean}-${n}${ext}`
  return name
}

// The resolution a PNG records (its pHYs chunk), in dots per inch; null
// when it records none. macOS screenshots on a Retina screen say 144.
export function pngDpi(bytes: Uint8Array): number | null {
  if (bytes.length < 16 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let i = 8
  while (i + 8 <= bytes.length) {
    const len = dv.getUint32(i)
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    if (type === 'pHYs' && i + 8 + 9 <= bytes.length) {
      const ppx = dv.getUint32(i + 8)
      const unit = bytes[i + 16]
      return unit === 1 && ppx > 0 ? ppx * 0.0254 : null
    }
    if (type === 'IDAT' || type === 'IEND') return null
    i += 12 + len
  }
  return null
}

// Wider than this, a picture takes 0.8 of the text width, as Insert ▸
// Figure gives it.
const FULL_CM = 12

// The figure's width: the picture's own size on paper (pixels at its
// resolution, 96 dpi when it records none), or 0.8\textwidth for a large
// one; a small screenshot of a button stays small.
export function naturalWidth(pxWidth: number, dpi: number | null): string {
  if (!(pxWidth > 0)) return '0.8\\textwidth'
  const cm = pxWidth / (dpi && dpi > 0 ? dpi : 96) * 2.54
  if (cm >= FULL_CM) return '0.8\\textwidth'
  return `${Math.max(0.5, Math.round(cm * 10) / 10)}cm`
}
