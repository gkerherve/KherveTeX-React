// Smoke-test a built KherveTeX: the port of ../KherveTeX/packaging/smoke_test.py.
//
//   node scripts/smoke_test.mjs src-tauri/target/release/bundle/macos/KherveTeX.app
//   node scripts/smoke_test.mjs "%LOCALAPPDATA%\KherveTeX\khervetex.exe"
//
// An installer fails quietly: a sidecar or a resource left out of the bundle
// only shows on a user's first compile, and a package or font missing from
// the bundled TeX cache only on a PC that has never been online. So this:
//
// * runs the bundled tectonic (`--version`);
// * writes every starter example as the app serializes it (src/core, the
//   same code the app runs, images absent as compileTex rewrites them), the
//   kitchen-sink document of every document class the app offers, and a
//   12 pt two-column document with \url;
// * starts the real executable with `--smoke-test` on an EMPTY tectonic
//   cache (a brand-new PC): it seeds that cache from its bundled one exactly
//   as at start-up, then compiles each document with `--only-cached`, no
//   network, the bundled styles in place (src-tauri/src/smoke.rs);
// * fails when the cache was not seeded, the tectonic found is not the
//   bundled one, or a document has no PDF or misses a file or a font.
//
// Exits non-zero on failure.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIN_SEEDED = 50

function fail(message) {
  console.log(`SMOKE TEST FAILED: ${message}`)
  process.exit(1)
}

// The app's executable: a path to it, or to the .app bundle on macOS.
function appExecutable(arg) {
  let p = resolve(arg)
  if (!existsSync(p)) fail(`${p} does not exist`)
  if (statSync(p).isDirectory() && p.endsWith('.app')) {
    const macos = join(p, 'Contents', 'MacOS')
    const main = readdirSync(macos).find(f => f !== 'tectonic')
    if (!main) fail(`no executable in ${macos}`)
    p = join(macos, main)
  }
  return p
}

async function loadCore() {
  const { runnerImport } = await import(pathToFileURL(join(ROOT, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)
  const load = async (rel) => (await runnerImport(join(ROOT, rel), { root: ROOT, configFile: false, logLevel: 'error' })).module
  return {
    examples: await load('src/core/examples.ts'),
    serializer: await load('src/core/serializer.ts'),
    compiler: await load('src/core/compiler.ts'),
    ribbon: await load('src/ui/ribbonModel.ts'),
  }
}

function documents(core) {
  const { EXAMPLES } = core.examples
  const { serializeDocument } = core.serializer
  const { bundleDocuments, rewriteIncludegraphics } = core.compiler
  const docs = {}
  // A document opened from the gallery has no folder yet: compileTex then
  // swaps each \includegraphics for a placeholder box.
  EXAMPLES.forEach(([, factory], i) => {
    docs[`example${String(i).padStart(2, '0')}`] = rewriteIncludegraphics(serializeDocument(factory()), null, () => false)
  })
  for (const [name, tex] of bundleDocuments(core.ribbon.TEMPLATE_CHOICES)) {
    docs[`class-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`] = tex
  }
  docs.fonts12 = '\\documentclass[12pt,twocolumn]{article}'
    + '\\usepackage[a4paper]{geometry}\\usepackage{amsmath,amssymb,graphicx,'
    + 'multicol,float,setspace,xurl}\\begin{document}\\section{A}Text '
    + '\\textbf{b} \\emph{i} \\texttt{t} \\textsf{s} \\url{https://x.org} '
    + '$x^2$\\footnote{n}\\end{document}'
  return docs
}

const real = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }

async function main() {
  const args = process.argv.slice(2)
  const ti = args.indexOf('--timeout')
  const timeout = ti >= 0 ? Number(args.splice(ti, 2)[1]) : 2400
  if (!args[0]) fail('usage: node scripts/smoke_test.mjs <app executable or .app> [--timeout s]')
  const exe = appExecutable(args[0])
  const tecName = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic'
  const tec = join(dirname(exe), tecName)
  if (!existsSync(tec)) fail(`no bundled ${tecName} next to ${exe}`)
  const v = spawnSync(tec, ['--version'], { encoding: 'utf8' })
  if (v.status !== 0) fail(`bundled tectonic did not run: ${v.stderr || v.error}`)
  console.log(`bundled ${basename(tec)}: ${v.stdout.trim()}`)

  const work = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'ktex_smoke_'))
  const cache = join(work, 'tectonic-cache')       // empty: a brand-new machine
  const out = join(work, 'out')
  mkdirSync(out, { recursive: true })
  const core = await loadCore()
  const docs = documents(core)
  const files = Object.entries(docs).map(([name, tex]) => {
    const f = join(work, `${name}.tex`)
    writeFileSync(f, tex, 'utf8')
    return f
  })
  console.log(`${files.length} documents -> ${work}`)

  const t0 = Date.now()
  const env = { ...process.env, TECTONIC_CACHE_DIR: cache, KHERVETEX_NO_UPDATE: '1' }
  const r = spawnSync(exe, ['--smoke-test', out, ...files], {
    env, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 256 * 1024 * 1024,
  })
  if (r.error) fail(`the app did not run: ${r.error.message}`)
  if (r.status !== 0) fail(`the app exited with code ${r.status}:\n${r.stderr}`)
  const reportPath = join(out, 'smoke-report.json')
  if (!existsSync(reportPath)) fail(`the app wrote no ${reportPath}`)
  const rep = JSON.parse(readFileSync(reportPath, 'utf8'))
  console.log(`app ${rep.app_version}: ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (rep.error) fail(rep.error)

  if (!rep.tectonic?.bundled) fail(`the app found ${rep.tectonic?.path}, not its bundled tectonic`)
  if (real(rep.tectonic.path) !== real(tec)) fail(`the app runs ${rep.tectonic.path}, expected ${tec}`)
  console.log(`bundled cache: ${rep.bundled_cache_files} files; styles: ${rep.styles_dir}`)
  if (real(rep.cache_dir) !== real(cache)) fail(`the app seeded ${rep.cache_dir}, not the empty cache ${cache}`)
  if (rep.seeded_files < MIN_SEEDED) fail(`the app did not seed the empty tectonic cache (${rep.seeded_files} files)`)
  console.log(`seeded the empty cache with ${rep.seeded_files} files in ${rep.seed_seconds.toFixed(1)} s`)

  const { missingFromLog, MISSING_CLASS_RE } = core.compiler
  const failed = []
  for (const d of rep.documents) {
    const log = `${d.log}\n${d.tex_log_tail}`
    const missing = [...new Set(missingFromLog(log))]
    const noClass = MISSING_CLASS_RE.exec(log)
    const ok = d.pdf && !d.timed_out && !missing.length && !noClass && !log.includes('not loadable')
    console.log(`  offline ${d.name}: ${ok ? 'ok' : 'FAILED'} (${d.seconds.toFixed(1)} s, code ${d.code}`
      + `${missing.length ? `, missing ${missing.join(', ')}` : ''})`)
    if (!ok) failed.push(d)
  }
  if (rep.documents.length !== files.length) fail(`the app compiled ${rep.documents.length} of ${files.length} documents`)
  if (failed.length) {
    for (const d of failed) console.log(`--- ${d.name}\n${d.log.slice(-2000)}`)
    fail(`${failed.length} of ${files.length} documents do not compile offline from the seeded cache: `
      + failed.map(d => d.name).join(', '))
  }
  console.log(`${files.length} documents compile offline from the seeded cache`)
  console.log('SMOKE TEST PASSED')
}

await main()
