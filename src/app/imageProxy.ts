// Fast LaTeX's stand-ins for large PNGs (core/compiler.ts proxyImages):
// the picture scaled to at most 1800 px on its longest side, as a JPEG,
// or a PNG when it has transparency, made once per file and version and
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

// maxSide 1800: the preview's copy of a large PNG; 240: the tiny copy
// shown while typing.
export function imageProxyIn(buildDir: string, maxSide = 1800): (path: string) => Promise<string | null> {
  return async (path: string) => {
    const st = await platform().stat(path)
    if (!st) return null
    const key = `${path}|${st.mtime}|${maxSide}`
    let p = made.get(key)
    if (!p) {
      p = (async () => {
        const bytes = await platform().readFile(path)
        const png = /\.png$/i.test(path)
        const alpha = png && hasAlpha(bytes)
        const bmp = await createImageBitmap(new Blob([bytes.slice()], { type: png ? 'image/png' : 'image/jpeg' }))
        const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
        if (k >= 1) { bmp.close(); return path }   // small already: itself
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
        const c = new OffscreenCanvas(w, h)
        const g = c.getContext('2d')!
        if (!alpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h) }
        g.imageSmoothingQuality = maxSide < 600 ? 'low' : 'high'
        g.drawImage(bmp, 0, 0, w, h)
        bmp.close()
        const blob = await c.convertToBlob(alpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: maxSide < 600 ? 0.6 : 0.88 })
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
