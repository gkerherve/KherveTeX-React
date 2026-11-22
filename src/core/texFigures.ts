// Find the pictures of an imported .tex. LaTeX looks for \includegraphics
// files in the \graphicspath folders and tries the extensions in turn
// (\includegraphics{plot} is plot.pdf or plot.png); authors also keep
// them in a figures/ or images/ folder beside the .tex. Each figure's path
// becomes the file found, relative to the .tex, so the page shows it and
// the compile finds it.
import type { Document, Figure } from './model.ts'

// Folders pictures are usually kept in, beside the .tex.
export const IMAGE_FOLDERS = ['figures', 'Figures', 'figs', 'Figs', 'fig', 'images', 'Images', 'img', 'imgs',
  'graphics', 'Graphics', 'pictures', 'Pictures', 'plots', 'media']
// The extensions pdfLaTeX tries, then the ones the page view shows.
export const GRAPHIC_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.PDF', '.PNG', '.JPG', '.JPEG', '.eps', '.svg', '.gif']

// The folders of \graphicspath{{figures/}{img/}}, without their final /.
export function graphicsPaths(tex: string): string[] {
  const m = /\\graphicspath\s*\{((?:\s*\{[^{}]*\}\s*)+)\}/.exec(tex.replace(/(^|[^\\])%.*$/gm, '$1'))
  if (!m) return []
  return [...m[1].matchAll(/\{([^{}]*)\}/g)].map((x) => x[1].trim().replace(/^\.\//, '').replace(/\/+$/, ''))
}

const hasExt = (p: string) => /\.[A-Za-z0-9]{2,4}$/.test(p.split('/').pop() ?? '')
const isAbs = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

// Where *path* may be, relative to the .tex: as written, in the
// \graphicspath folders, then by its file name in the usual folders; each
// with the extensions LaTeX tries when it has none.
export function figureCandidates(path: string, graphicsDirs: string[] = []): string[] {
  const p = path.trim().replace(/^\.\//, '').replace(/\\/g, '/')
  const name = p.split('/').pop() ?? p
  const names = (n: string) => (hasExt(n) ? [n] : [n, ...GRAPHIC_EXTS.map((e) => n + e)])
  const out: string[] = []
  const add = (dir: string, n: string) => {
    for (const c of names(n)) {
      const full = dir ? `${dir}/${c}` : c
      if (!out.includes(full)) out.push(full)
    }
  }
  add('', p)
  for (const d of graphicsDirs) add(d, p)
  for (const d of graphicsDirs) add(d, name)
  add('', name)
  for (const d of IMAGE_FOLDERS) add(d, name)
  return out
}

// Point each figure of *doc* at the file found for it under *baseDir*
// (the .tex's folder). Returns how many paths changed.
export async function locateFigures(doc: Document, tex: string, baseDir: string,
  exists: (absPath: string) => Promise<boolean>): Promise<number> {
  const dirs = graphicsPaths(tex)
  const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}/${b}`
  const find = async (path: string): Promise<string | null> => {
    if (!path || isAbs(path) || /^[a-z]+:\/\//i.test(path)) return null
    for (const c of figureCandidates(path, dirs)) {
      if (await exists(join(baseDir, c))) return c
    }
    return null
  }
  let changed = 0
  for (const b of doc.children) {
    if (b.type !== 'Figure') continue
    const f = b as Figure
    const hit = await find(f.path)
    if (hit !== null && hit !== f.path) { f.path = hit; changed++ }
    for (const e of f.extra ?? []) {
      const h = await find(e.path)
      if (h !== null && h !== e.path) { e.path = h; changed++ }
    }
  }
  return changed
}
