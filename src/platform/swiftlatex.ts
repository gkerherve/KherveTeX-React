// The "try it online" compiler: SwiftLaTeX's XeTeX and dvipdfmx compiled to
// WebAssembly, each in its own Web Worker. Only the browser platform loads
// it (the desktop app compiles with tectonic). The engines come from
// web/swiftlatex/ (scripts/swiftlatex_patch.mjs) and fetch TeX files from
// kTeX's package tree: TEXLIVE_URL, a flat folder with an index.txt.

export const ENGINE_DIR = './swiftlatex/'
export const TEXLIVE_URL: string = import.meta.env.VITE_KTEX_TEXLIVE_URL
  ?? (import.meta.env.DEV ? `${location.origin}/texlive/` : 'https://gkerherve.github.io/ktex-texlive/')

export const ONLINE_ENGINE_NOTE =
  'Compiled online with SwiftLaTeX (XeTeX in your browser), not the desktop app’s tectonic: '
  + 'fonts, packages and layout may differ from kTeX on macOS, Windows and Linux.'

interface Reply { result?: string; cmd?: string; status?: number; log?: string; pdf?: ArrayBuffer }

class EngineWorker {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private readonly script: string

  constructor(script: string) {
    this.script = script
  }

  load(): Promise<void> {
    if (!this.ready) {
      this.ready = new Promise((resolve, reject) => {
        const w = new Worker(new URL(this.script, new URL(ENGINE_DIR, document.baseURI)))
        w.onmessage = (ev: MessageEvent<Reply>) => {
          if (ev.data.result === 'ok') resolve()
          else reject(new Error(`${this.script} failed to start`))
        }
        w.onerror = () => reject(new Error(`${this.script} could not be loaded`))
        w.postMessage({ cmd: 'settexliveurl', url: TEXLIVE_URL })
        this.worker = w
      })
      this.ready.catch(() => { this.ready = null })
    }
    return this.ready
  }

  post(msg: Record<string, unknown>, transfer: Transferable[] = []): void {
    this.worker!.postMessage(msg, transfer)
  }

  // Runs one compile command and waits for its answer.
  run(cmd: string): Promise<Reply> {
    return new Promise(resolve => {
      this.worker!.onmessage = (ev: MessageEvent<Reply>) => {
        if (ev.data.cmd === 'compile') resolve(ev.data)
      }
      this.worker!.postMessage({ cmd })
    })
  }

  kill(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
  }
}

const xetex = new EngineWorker('swiftlatexxetex.js')
const FORMAT = 'swiftlatexxetex.fmt'
let formatStaged: Promise<void> | null = null

// The format is 24 MB and GitHub Pages does not compress it, so the tree
// also holds it gzipped (5 MB): unpacked here and written into the engine's
// /tex folder, where its file lookup finds it. Without it (an old tree, a
// browser with no DecompressionStream) the engine downloads the plain file.
function stageFormat(): Promise<void> {
  if (!formatStaged) {
    formatStaged = (async () => {
      try {
        const r = await fetch(`${TEXLIVE_URL}${FORMAT}.gz`)
        if (!r.ok || !r.body) return
        const data = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
        xetex.post({ cmd: 'writefile', url: `../tex/${FORMAT}`, src: data }, [data.buffer])
      } catch { /* the engine fetches the plain format */ }
    })()
  }
  return formatStaged
}
const dvipdfm = new EngineWorker('swiftlatexdvipdfm.js')

export interface OnlineFile { path: string; data: Uint8Array }
export interface OnlineResult { pdf: Uint8Array | null; log: string; status: number }

// One compile at a time: the workers keep a single work folder.
let queue: Promise<unknown> = Promise.resolve()

function stage(engine: EngineWorker, files: OnlineFile[]): void {
  engine.post({ cmd: 'flushcache' })
  const dirs = new Set<string>()
  for (const f of files) {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  for (const d of [...dirs].sort()) engine.post({ cmd: 'mkdir', url: d })
  for (const f of files) engine.post({ cmd: 'writefile', url: f.path, src: f.data })
}

// Compiles `main` (a .tex path relative to the work folder) to PDF: XeTeX
// (which runs BibTeX itself) writes an .xdv, dvipdfmx turns it into a PDF.
export function compileOnline(main: string, files: OnlineFile[]): Promise<OnlineResult> {
  const job = queue.then(async (): Promise<OnlineResult> => {
    await Promise.all([xetex.load(), dvipdfm.load()])
    await stageFormat()
    stage(xetex, files)
    xetex.post({ cmd: 'setmainfile', url: main })
    const tex = await xetex.run('compilelatex')
    const log = tex.log ?? ''
    if (tex.result !== 'ok' || !tex.pdf) return { pdf: null, log, status: tex.status ?? -1 }
    const xdv = main.replace(/\.tex$/, '.xdv')
    stage(dvipdfm, [...files.filter(f => !f.path.endsWith('.tex')), { path: xdv, data: new Uint8Array(tex.pdf) }])
    dvipdfm.post({ cmd: 'setmainfile', url: xdv })
    const pdf = await dvipdfm.run('compilepdf')
    const all = log + '\n\n--- dvipdfmx ---\n' + (pdf.log ?? '')
    if (pdf.result !== 'ok' || !pdf.pdf) return { pdf: null, log: all, status: pdf.status ?? -1 }
    return { pdf: new Uint8Array(pdf.pdf), log: all, status: 0 }
  })
  queue = job.catch(() => {})
  return job
}

// Builds the engine's format (swiftlatexxetex.fmt) from xelatex.ini in the
// package tree. Run once when the package tree changes, from the browser
// console in the online build: `await ktexBuildFormat()` downloads it.
export async function buildFormat(): Promise<Uint8Array> {
  await xetex.load()
  xetex.post({ cmd: 'flushcache' })
  const r = await xetex.run('compileformat')
  if (r.result !== 'ok' || !r.pdf) throw new Error('format build failed:\n' + (r.log ?? ''))
  return new Uint8Array(r.pdf)
}

export function cancelOnline(): void {
  xetex.kill()
  dvipdfm.kill()
}
