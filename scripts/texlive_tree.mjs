// Builds the package tree for the "try it online" compiler
// (src/platform/swiftlatex.ts): every TeX file in this Mac's tectonic cache
// (what kTeX's documents and templates have needed so far) plus the classes
// kTeX ships (src-tauri/resources/styles, which win over tectonic's), in one
// flat folder with an index.txt. Published on GitHub Pages
// (gkerherve/ktex-texlive); in dev Vite serves web/texlive-local at /texlive/.
//
//   node scripts/texlive_tree.mjs [outDir]       (default web/texlive-local)
//
// Then build the engine's format from the new tree: `npm run dev`, open the
// app, and in the console run
//   const m = await import('/src/platform/swiftlatex.ts')
//   await fetch('/__ktex-save-format', { method: 'POST', body: await m.buildFormat() })
// which writes swiftlatexxetex.fmt into web/texlive-local; run this script
// again to gzip it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = process.argv[2] ?? join(root, 'web', 'texlive-local')
const cache = join(homedir(), 'Library', 'Caches', 'TectonicProject.Tectonic', 'bundles')
mkdirSync(out, { recursive: true })

const names = new Set()
function addDir(dir, overwrite) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const src = join(dir, name)
    if (name.startsWith('.') || name === 'README.txt' || name === 'index.txt' || !statSync(src).isFile()) continue
    if (overwrite || !names.has(name)) copyFileSync(src, join(out, name))
    names.add(name)
  }
}
// tectonic keeps each bundle's files in data/<hash>/ (older layouts nest a
// second bundles/ folder).
for (const base of [join(cache, 'data'), join(cache, 'bundles', 'data')]) {
  if (!existsSync(base)) continue
  for (const d of readdirSync(base)) if (statSync(join(base, d)).isDirectory()) addDir(join(base, d), false)
}
addDir(join(root, 'src-tauri', 'resources', 'styles'), true)
// The format, and a gzipped copy the page unpacks itself (GitHub Pages
// sends the 24 MB file uncompressed).
const fmt = join(out, 'swiftlatexxetex.fmt')
if (existsSync(fmt)) {
  names.add('swiftlatexxetex.fmt')
  writeFileSync(fmt + '.gz', gzipSync(readFileSync(fmt), { level: 9 }))
}
writeFileSync(join(out, 'index.txt'), [...names].sort().join('\n') + '\n')
console.log(`${names.size} files in ${out}`)
