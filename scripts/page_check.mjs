// Page check, part 1: compile every gallery example and a sample document
// of every document class the app offers, as the app would (src/core: the
// same serializer, images swapped for placeholder boxes as for an Untitled
// document, the bundled styles in place), into .pagecheck/.
//
//   node scripts/page_check.mjs [--only <substring>]
//
// Part 2 runs in the app in a browser (npm run dev): it loads each
// document into the page view, anchors it to its PDF exactly as after a
// compile, and compares every sheet with its PDF page (first and last
// line, header and footer, "(cont.)" overflow sheets). See
// src/dev/pageCheck.ts.

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '.pagecheck')
const STYLES = join(ROOT, 'src-tauri', 'resources', 'styles')
const TECTONIC = join(ROOT, 'src-tauri', 'binaries',
  `tectonic-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`)

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

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function run(cmd, args, opts) {
  return new Promise((ok) => {
    const p = spawn(cmd, args, opts)
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { out += d })
    p.on('close', code => ok({ code, out }))
  })
}

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
  const core = await loadCore()
  const { serializeDocument } = core.serializer
  const { rewriteIncludegraphics, templateSampleDocument } = core.compiler
  const jobs = []
  for (const [label, factory] of core.examples.EXAMPLES) {
    const doc = factory()
    jobs.push({ id: `ex-${slug(label)}`, kind: 'example', label, cls: doc.meta.documentclass, doc })
  }
  for (const cls of core.ribbon.TEMPLATE_CHOICES) {
    jobs.push({ id: `cls-${slug(cls)}`, kind: 'class', label: cls, cls, doc: templateSampleDocument(cls) })
  }
  const todo = only ? jobs.filter(j => j.id.includes(only) || j.label.includes(only)) : jobs
  mkdirSync(OUT, { recursive: true })
  const results = []
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const j = todo[next++]
      const dir = join(OUT, j.id)
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      for (const f of readdirSync(STYLES)) if (f.endsWith('.cls') || f.endsWith('.sty')) copyFileSync(join(STYLES, f), join(dir, f))
      const tex = rewriteIncludegraphics(serializeDocument(j.doc), null, () => false)
      writeFileSync(join(dir, 'document.tex'), tex)
      const t0 = Date.now()
      const r = await run(TECTONIC, ['-Z', 'continue-on-errors', '--keep-logs', '--outdir', dir, join(dir, 'document.tex')],
        { env: { ...process.env, TEXINPUTS: STYLES + ':' } })
      const pdf = existsSync(join(dir, 'document.pdf'))
      results.push({ id: j.id, kind: j.kind, label: j.label, cls: j.cls, pdf: pdf ? `${j.id}/document.pdf` : null,
        code: r.code, seconds: (Date.now() - t0) / 1000 })
      console.log(`${pdf ? 'ok    ' : 'FAILED'} ${j.id} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
      if (!pdf) console.log(r.out.slice(-1500))
    }
  }
  await Promise.all(Array.from({ length: Math.max(2, Math.min(6, cpus().length - 2)) }, worker))
  const order = new Map(jobs.map((j, i) => [j.id, i]))
  results.sort((a, b) => order.get(a.id) - order.get(b.id))
  const indexPath = join(OUT, 'index.json')
  let prev = []
  if (only && existsSync(indexPath)) prev = (await import(pathToFileURL(indexPath).href, { with: { type: 'json' } })).default
  const merged = [...prev.filter(p => !results.some(r => r.id === p.id)), ...results]
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
  writeFileSync(indexPath, JSON.stringify(merged, null, 1))
  console.log(`${results.filter(r => r.pdf).length} of ${results.length} compiled -> ${OUT}`)
}

await main()
