// Palette pictures: a formula typeset to SVG at a size that fits a button
// (QIcon scales a pixmap down to the icon size, never up).
import * as mb from './mathbox.ts'
import { renderRow, type RenderedImage } from './mathlayout.ts'

const cache = new Map<string, RenderedImage>()

// mathlayout.render_pixmap(latex, px, display): pad 4.
export function renderPixmap(latex: string, px: number, display = false): RenderedImage {
  const key = `${px}|${display}|${latex}`
  let img = cache.get(key)
  if (!img) {
    img = renderRow(mb.parseLatex(latex), px, display, 4.0)
    cache.set(key, img)
  }
  return img
}

// The SVG resized to (w, h).
export function svgSized(img: RenderedImage, w: number, h: number): string {
  return img.svg.replace(/^<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${w}" height="${h}"`)
}

// The SVG scaled down (aspect kept) to fit maxW × maxH.
export function svgFit(img: RenderedImage, maxW: number, maxH: number): { svg: string; w: number; h: number } {
  const s = Math.min(1, maxW / img.width, maxH / img.height)
  const w = img.width * s
  const h = img.height * s
  return { svg: svgSized(img, w, h), w, h }
}
