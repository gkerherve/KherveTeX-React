// The preview's stand-ins for PNGs (core/compiler.ts proxyImages): a JPEG
// of the picture at the Auto-compile picture quality (4000, 1600 or 400 px), or a scaled PNG when it has transparency, made once per file and version and
// kept in the build folder. Only the preview uses them; Export and Print
// compile the originals.
import { join } from '../core/paths'
import { platform } from '../platform'

const made = new Map<string, Promise<string | null>>()

// PNG colour type 4 or 6, or a tRNS chunk: it has transparency.
function hasAlpha(b: Uint8Array): boolean {
  if (b.length > 25 && (b[25] === 4 || b[25] === 6)) return true
  const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 65536)))
  return head.includes('tRNS')
}

// maxSide 4000: the sharp preview's copy of a PNG; 240: the tiny copy
// shown while typing.
export function imageProxyIn(buildDir: string, maxSide = 4000): (path: string) => Promise<string | null> {
  return async (path: string) => {
    const st = await platform().stat(path)
    if (!st) return null
    const key = `${path}|${st.mtime}|${maxSide}`
    let p = made.get(key)
    if (!p) {
      p = (async () => {
        const bytes = await platform().readFile(path)
        const png = /\.png$/i.test(path)
        const bmp = await createImageBitmap(new Blob([bytes.slice()], { type: png ? 'image/png' : 'image/jpeg' }))
        const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
        // An alpha channel (plots often have one) that is all opaque counts
        // as none: look at the pixels.
        let alpha = png && hasAlpha(bytes)
        if (alpha) {
          // A small sample is enough, and keeps the window responsive.
          const ks = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
          const t = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * ks)), Math.max(1, Math.round(bmp.height * ks)))
          const tg = t.getContext('2d')!
          tg.drawImage(bmp, 0, 0, t.width, t.height)
          const px = tg.getImageData(0, 0, t.width, t.height).data
          alpha = false
          for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break }
        }
        // Small already (tiny copies), or a full-size one that would stay a
        // PNG (transparency): the original. A sharp copy of an opaque PNG
        // is a JPEG at full size: xdvipdfmx embeds JPEGs without decoding.
        if (k >= 1 && (maxSide < 600 || alpha)) { bmp.close(); return path }
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
        const c = new OffscreenCanvas(w, h)
        const g = c.getContext('2d')!
        if (!alpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h) }
        g.imageSmoothingQuality = maxSide < 600 ? 'low' : 'high'
        g.drawImage(bmp, 0, 0, w, h)
        bmp.close()
        const blob = await c.convertToBlob(alpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: maxSide < 600 ? 0.6 : maxSide < 2000 ? 0.8 : 0.92 })
        const dir = join(buildDir, 'kt-preview-images')
        await platform().mkdir(dir)
        let h32 = 5381
        for (const ch of key) h32 = ((h32 * 33) ^ ch.charCodeAt(0)) >>> 0
        const out = join(dir, `${h32.toString(36)}.${alpha ? 'png' : 'jpg'}`)
        await platform().writeFile(out, new Uint8Array(await blob.arrayBuffer()))
        return out
      })().catch(() => null)
      made.set(key, p)
    }
    return p
  }
}
