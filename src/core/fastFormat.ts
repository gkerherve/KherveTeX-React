// Fast LaTeX's saved setup: the heavy packages a document loads (TikZ,
// pgfplots, chemfig...) compiled once into a TeX format, so later
// compiles start with them already loaded instead of reading them again.
//
// XeTeX cannot save a format once an OpenType font is loaded, and a
// document class loads one; so the format holds only packages that are
// safe to load before the class (TikZ is loaded under the old TeX fonts,
// then the default encoding is put back). Tectonic reads formats by name
// from its cache's formats/ folder, as <bundle digest>-<name>-<version>.fmt,
// so the built file is copied there beside its own latex format.
import type { CompilerHost } from './compiler.ts'
import { join } from './paths.ts'

// Packages loaded before the class, in this order, when the document
// loads them without options.
const SAFE = ['amsmath', 'amssymb', 'graphicx', 'booktabs', 'array', 'xcolor', 'tikz', 'pgfplots', 'chemfig', 'mhchem', 'siunitx']
// These load xcolor themselves: an xcolor with options in the document
// would then clash.
const LOADS_XCOLOR = new Set(['tikz', 'pgfplots', 'chemfig', 'xcolor'])

// What the format would preload for this LaTeX source.
export function preloadList(tex: string): string[] {
  const head = tex.split('\\begin{document}')[0] ?? ''
  const plain = new Set<string>()
  for (const m of head.matchAll(/\\usepackage\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) plain.add(p.trim())
  const withOpts = new Set<string>()
  for (const m of head.matchAll(/\\(?:usepackage|RequirePackage|PassOptionsToPackage)\s*\[[^\]]*\]\s*\{([^}]*)\}/g)) for (const p of m[1].split(',')) withOpts.add(p.trim())
  // Classes that load these with their own options.
  const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(head)?.[1] ?? ''
  const xcolorBusy = withOpts.has('xcolor') || /beamer|tikzposter|moderncv|europasscv|awesome|sn-jnl|elsarticle|acmart/.test(cls) || /\[[^\]]*table[^\]]*\]\s*\{xcolor\}/.test(head)
  return SAFE.filter(p => plain.has(p) && !withOpts.has(p) && !(xcolorBusy && LOADS_XCOLOR.has(p)))
}

export function formatName(list: string[]): string {
  let h = 5381
  for (const c of list.join(',')) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return `ktfast${h.toString(36)}`
}

export function formatSource(list: string[]): string {
  return [
    '\\let\\ktdump\\dump\\let\\dump\\relax',
    '\\input xelatex.ini',
    '\\makeatletter\\let\\kt@enc\\encodingdefault',
    // No OpenType font may be loaded when the format is saved.
    '\\def\\encodingdefault{OT1}\\fontencoding{OT1}\\fontfamily{cmr}\\selectfont',
    ...list.map(p => `\\RequirePackage{${p}}`),
    '\\let\\encodingdefault\\kt@enc\\makeatother',
    '\\ktdump',
  ].join('\n') + '\n'
}

// Format names known to fail (a clash): not tried again this session.
const bad = new Set<string>()

export function markFormatBad(name: string): void { bad.add(name) }

interface Plan { name: string; list: string[]; file: string; target: string; ready: boolean }

// Where this document's format is, or would be.
export async function formatPlan(host: CompilerHost, formatsDir: string, tex: string): Promise<Plan | null> {
  const list = preloadList(tex)
  if (!list.length) return null
  const name = formatName(list)
  if (bad.has(name)) return null
  let entries
  try { entries = await host.listDir(formatsDir) } catch { return null }
  // The latex format tectonic made names the bundle and engine version.
  const base = entries.map(e => /^([0-9a-f]{64})-latex-(\d+)\.fmt$/.exec(e.name)).find(Boolean)
  if (!base) return null
  const file = `${base[1]}-${name}-${base[2]}.fmt`
  return { name, list, file, target: join(formatsDir, file), ready: entries.some(e => e.name === file) }
}

// Build the format (a second or two, once); false when it cannot be made.
// Run between compiles: tectonic runs one at a time.
export async function buildFormat(host: CompilerHost, tectonic: string, workdir: string, plan: Plan): Promise<boolean> {
  try {
    const dir = join(workdir, 'fastfmt')
    await host.mkdir(dir)
    const src = join(dir, `${plan.name}.tex`)
    await host.writeText(src, formatSource(plan.list))
    const r = await host.run(tectonic, ['--only-cached', '--outfmt', 'fmt', '--outdir', dir, src], { timeoutSecs: 300 })
    const out = join(dir, `${plan.name}.fmt`)
    if (r.code !== 0 || !(await host.exists(out))) { bad.add(plan.name); return false }
    await host.copy(out, plan.target)
    return true
  } catch {
    bad.add(plan.name)
    return false
  }
}
