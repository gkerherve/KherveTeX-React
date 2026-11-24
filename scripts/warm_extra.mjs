// Tops up the bundled TeX cache with what kTeX's own documents need.
//
// The cache comes from the Python app's warm-up (its examples only), so a
// package only kTeX's examples use (qrcode, lettrine, fontawesome5...) was
// never in it, and those documents failed to compile offline on a new PC.
// This compiles every kTeX example and template ONLINE into that cache, so
// tectonic fetches whatever is missing. Called by src-tauri/fetch_tectonic.mjs
// before a release build; the smoke test then checks it all offline.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function documents() {
  const { runnerImport } = await import(pathToFileURL(join(ROOT, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)
  const load = async (rel) => (await runnerImport(join(ROOT, rel), { root: ROOT, configFile: false, logLevel: 'error' })).module
  const { EXAMPLES } = await load('src/core/examples.ts')
  const { serializeDocument } = await load('src/core/serializer.ts')
  const { bundleDocuments, rewriteIncludegraphics } = await load('src/core/compiler.ts')
  const { TEMPLATE_CHOICES } = await load('src/ui/ribbonModel.ts')
  const docs = EXAMPLES.map(([, factory]) => rewriteIncludegraphics(serializeDocument(factory()), null, () => false))
  for (const [, tex] of bundleDocuments(TEMPLATE_CHOICES)) docs.push(tex)
  return docs
}

export async function warmExtra(tectonic, cache, styles) {
  tectonic = resolve(tectonic); cache = resolve(cache)
  const docs = await documents()
  const work = mkdtempSync(join(tmpdir(), 'ktex_warm_'))
  if (existsSync(styles)) for (const f of readdirSync(styles)) copyFileSync(join(styles, f), join(work, f))
  const env = { ...process.env, TECTONIC_CACHE_DIR: cache }
  let failed = 0
  docs.forEach((tex, i) => {
    const f = join(work, `d${i}.tex`)
    writeFileSync(f, tex, 'utf8')
    const r = spawnSync(tectonic, ['-Z', 'continue-on-errors', '--outdir', work, f],
      { cwd: work, env, encoding: 'utf8', timeout: 600_000 })
    if (r.status !== 0) { failed++; console.warn(`  warm: document ${i} did not compile:\n${(r.stderr || '').split('\n').slice(-6).join('\n')}`) }
  })
  rmSync(work, { recursive: true, force: true })
  console.log(`tectonic cache topped up from ${docs.length} kTeX documents (${failed} with errors)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tectonic, cache, styles] = process.argv.slice(2)
  mkdirSync(cache, { recursive: true })
  await warmExtra(tectonic, cache, styles ?? '')
}
