// The compile's own copies of a document's PNGs, as PDFs the engine embeds
// without decoding them (pngPdf.ts): made once per picture and kept in a
// folder of their own, so every later compile, in this session or the
// next, in this document or another holding the same picture, only copies
// them into the PDF. The copies hold the same pixels: Export and Print use
// them too.
import type { CompilerHost } from './compiler.ts'
import { join } from './paths.ts'
import { planPngPdf } from './pngPdf.ts'

export type PictureHost = Pick<CompilerHost, 'stat' | 'exists' | 'mkdir' | 'remove' | 'listDir'>
  & Required<Pick<CompilerHost, 'readFile' | 'writeFile'>>

// Copies not made again for this long are cleared out (a picture still in
// use is simply made again, which takes a moment).
const KEEP_MS = 45 * 24 * 3600 * 1000
// Pictures read and written at once: enough to keep the disk busy without
// holding a whole thesis's pictures in memory.
const AT_ONCE = 4

export function pdfPictures(host: PictureHost, dir: string, now: () => number = Date.now): (path: string) => Promise<string | null> {
  const made = new Map<string, Promise<string | null>>()
  let ready: Promise<void> | null = null
  const prepare = () => ready ??= (async () => {
    await host.mkdir(dir)
    try {
      for (const f of await host.listDir(dir)) {
        if (f.isFile && f.mtime > 0 && now() - f.mtime > KEEP_MS) await host.remove(f.path).catch(() => {})
      }
    } catch { /* an unreadable folder: copies are made as needed */ }
  })()
  let busy = 0
  const waiting: (() => void)[] = []
  const turn = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (busy >= AT_ONCE) await new Promise<void>(r => waiting.push(r))
    busy++
    try { return await fn() } finally { busy--; waiting.shift()?.() }
  }
  return async (path: string) => {
    if (!/\.png$/i.test(path)) return null
    const st = await host.stat(path)
    if (!st || !st.isFile) return null
    const key = `${path}|${st.mtime}|${st.size ?? 0}`
    let p = made.get(key)
    if (!p) {
      p = turn(async () => {
        await prepare()
        const plan = planPngPdf(await host.readFile(path))
        if (!plan) return null
        const out = join(dir, plan.name)
        // A copy counts once its mark is written after it: one cut short
        // (the app closed) is made again.
        const mark = `${out}.ok`
        if (await host.exists(mark) && await host.exists(out)) return out
        const pdf = await plan.make()
        if (!pdf) return null
        await host.remove(mark).catch(() => {})
        await host.writeFile(out, pdf)
        await host.writeFile(mark, new Uint8Array(0))
        return out
      }).catch(() => null)
      made.set(key, p)
    }
    return p
  }
}
