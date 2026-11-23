// The updater manifest (latest.json) of a release, from its signed assets.
//
//   node scripts/latest_json.mjs <owner/repo> <tag> <version> <notes.txt> <sigs dir> > latest.json
//
// release.yml builds Windows and Linux in parallel jobs (the Mac's .app.tar.gz
// is built on a Mac and uploaded to the draft by hand);
// each uploads its installer or .app.tar.gz with its .sig, and this writes
// the one manifest from what was uploaded, after them all — tauri-action's
// own per-job merge races when the jobs finish together. tauri-plugin-updater
// reads it at releases/latest/download/latest.json.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Asset name (without .sig) → updater platform keys. NSIS is the Windows
// updater bundle in Tauri 2; the macOS one is the .app.tar.gz.
const PLATFORMS = [
  [/x64-setup\.exe$/i, ['windows-x86_64', 'windows-x86_64-nsis']],
  [/(aarch64|arm64)\.app\.tar\.gz$/i, ['darwin-aarch64', 'darwin-aarch64-app']],
  [/(x64|x86_64)\.app\.tar\.gz$/i, ['darwin-x86_64', 'darwin-x86_64-app']],
  // Linux: each install type its own key (the updater looks for
  // linux-x86_64-<bundle type> first); no plain linux-x86_64, or a .deb
  // install would fetch the AppImage and fail to install it.
  [/(amd64|x86_64)\.AppImage$/i, ['linux-x86_64-appimage']],
  [/(amd64|x86_64)\.deb$/i, ['linux-x86_64-deb']],
]
const REQUIRED = ['windows-x86_64', 'darwin-aarch64']

export function manifest({ repo, tag, version, notes, sigs }) {
  const platforms = {}
  for (const [asset, signature] of Object.entries(sigs)) {
    const hit = PLATFORMS.find(([re]) => re.test(asset))
    if (!hit) continue
    // The tag URL, not the asset's: a draft's asset URLs change when it is published.
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`
    for (const key of hit[1]) {
      if (platforms[key]) throw new Error(`two assets for ${key}: ${platforms[key].url} and ${url}`)
      platforms[key] = { signature: signature.trim(), url }
    }
  }
  const missing = REQUIRED.filter(k => !platforms[k])
  if (missing.length) throw new Error(`no signed updater bundle for ${missing.join(', ')}`)
  return { version: version.replace(/^v/, ''), notes, pub_date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), platforms }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('latest_json.mjs')) {
  const [repo, tag, version, notesFile, sigDir] = process.argv.slice(2)
  if (!sigDir) {
    console.error('usage: node scripts/latest_json.mjs <owner/repo> <tag> <version> <notes.txt> <sigs dir>')
    process.exit(2)
  }
  const sigs = {}
  for (const f of readdirSync(sigDir)) {
    if (f.endsWith('.sig')) sigs[f.slice(0, -4)] = readFileSync(join(sigDir, f), 'utf8')
  }
  const notes = readFileSync(notesFile, 'utf8').trim()
  process.stdout.write(JSON.stringify(manifest({ repo, tag, version, notes, sigs }), null, 2) + '\n')
}
