// Fetch the tectonic engine that ships inside KherveTeX, and its warmed
// package cache — the port of ../KherveTeX/packaging/fetch_tectonic.py.
//
//   node src-tauri/fetch_tectonic.mjs          # before a release build
//   node src-tauri/fetch_tectonic.mjs --dev    # before `tauri dev`
//
// Every installer must carry BOTH the binary and a warmed cache: without the
// cache a new PC starts empty, every compile goes online, a slow or filtered
// network fails with "Offline, and … not in the local TeX cache yet", and a
// missing font prints blank text (what broke the Windows 0.214 installs).
// So a release build stops here when the cache has fewer than 500 files.
//
// The binary becomes the Tauri sidecar binaries/tectonic-<target triple>;
// the cache and the bundled styles become resources/ (src-tauri/src/
// tectonic.rs seeds the user's cache from it at start-up). The cache is the
// one the Python app warms (`python packaging/fetch_tectonic.py --warm` in
// ../KherveTeX), so both apps compile exactly the same documents offline.

import { execFileSync } from 'node:child_process'
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep in step with ../KherveTeX/packaging/fetch_tectonic.py.
export const TECTONIC_VERSION = '0.17.0'
const MIN_CACHE_FILES = 500

const HERE = dirname(fileURLToPath(import.meta.url))
const PY_APP = resolve(HERE, '..', '..', 'KherveTeX')
const BIN = join(HERE, 'binaries')
const RES = join(HERE, 'resources')
const dev = process.argv.includes('--dev')

function targetTriple() {
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    const m = /^host: (\S+)/m.exec(out)
    if (m) return m[1]
  } catch { /* no rustc on PATH: derive it */ }
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'darwin') return `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
  return 'x86_64-unknown-linux-gnu'
}

// The official release archive for this machine (tectonic publishes musl
// builds for Linux).
function releaseTarget(triple) {
  if (triple.includes('windows')) return ['x86_64-pc-windows-msvc', 'zip']
  if (triple.includes('apple')) return [triple, 'tar.gz']
  return ['x86_64-unknown-linux-musl', 'tar.gz']
}

function version(exe) {
  try {
    return execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 30000 })
  } catch {
    return ''
  }
}

async function fetchBinary() {
  const triple = targetTriple()
  const exeName = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic'
  const out = join(BIN, `tectonic-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
  if (existsSync(out) && version(out).includes(TECTONIC_VERSION)) return out
  mkdirSync(BIN, { recursive: true })
  const local = join(PY_APP, 'packaging', 'bin', exeName)
  if (existsSync(local) && version(local).includes(TECTONIC_VERSION)) {
    copyFileSync(local, out)
  } else {
    const [rel, ext] = releaseTarget(triple)
    const name = `tectonic-${TECTONIC_VERSION}-${rel}.${ext}`
    const url = 'https://github.com/tectonic-typesetting/tectonic/releases/download/'
      + `tectonic%40${TECTONIC_VERSION}/${name}`
    console.log(`Downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    const tmp = mkdtempSync(join(tmpdir(), 'khervetex-tectonic-'))
    const archive = join(tmp, name)
    writeFileSync(archive, new Uint8Array(await res.arrayBuffer()))
    // bsdtar reads .zip too (Windows 10+ ships it as tar.exe).
    execFileSync('tar', ['-xf', archive, '-C', tmp])
    const found = findFile(tmp, exeName)
    if (!found) throw new Error(`${name} has no ${exeName}`)
    copyFileSync(found, out)
    rmSync(tmp, { recursive: true, force: true })
  }
  chmodSync(out, 0o755)
  console.log(`tectonic ${TECTONIC_VERSION} -> ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`)
  return out
}

function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const f = findFile(p, name)
      if (f) return f
    } else if (e.name === name) {
      return p
    }
  }
  return null
}

function countFiles(dir) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : (e.name === 'README.txt' ? 0 : 1)
  }
  return n
}

function syncCache() {
  const src = join(PY_APP, 'khervedoc', 'tectonic_cache')
  const dest = join(RES, 'tectonic_cache')
  const have = countFiles(src)
  if (have > 0 && countFiles(dest) !== have) {
    rmSync(dest, { recursive: true, force: true })
    cpSync(src, dest, { recursive: true })
  }
  const n = countFiles(dest)
  if (n < MIN_CACHE_FILES) {
    const msg = `The tectonic cache has ${n} files (at least ${MIN_CACHE_FILES} needed). `
      + `Warm it in ../KherveTeX with: python packaging/fetch_tectonic.py --warm`
    if (!dev) throw new Error(msg)
    console.warn(`warning: ${msg}`)
    mkdirSync(dest, { recursive: true })
    // The resource glob must match something even when the cache is empty.
    writeFileSync(join(dest, 'README.txt'), 'Not warmed: dev build.\n')
  } else {
    console.log(`tectonic cache: ${n} files -> ${dest}`)
  }
}

function syncStyles() {
  const src = join(PY_APP, 'khervedoc', 'styles')
  const dest = join(RES, 'styles')
  mkdirSync(dest, { recursive: true })
  if (existsSync(src)) {
    for (const f of readdirSync(src)) {
      if (/\.(cls|sty|bst|txt)$/i.test(f)) copyFileSync(join(src, f), join(dest, f))
    }
  } else if (!dev) {
    throw new Error(`${src} is missing: the bundled styles (sn-jnl, mimosis, resume...) must ship`)
  } else {
    writeFileSync(join(dest, 'README.txt'), 'Bundled LaTeX styles.\n')
  }
}

await fetchBinary()
syncCache()
syncStyles()
