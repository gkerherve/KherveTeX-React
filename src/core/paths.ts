// The few pathlib operations the core needs, on plain strings. Both
// separators are accepted so Windows paths stored in documents still work.

const lastSep = (p: string) => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))

export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  return trimmed.slice(lastSep(trimmed) + 1)
}

export function dirname(p: string): string {
  const i = lastSep(p)
  if (i < 0) return '.'
  return i === 0 ? p[0] : p.slice(0, i)
}

// Path.suffix: ".png" for "a/b.png", "" for ".hidden" or "noext".
export function suffix(p: string): string {
  const name = basename(p)
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? name.slice(i) : ''
}

// Path.with_suffix: replace the last suffix, or append one.
export function withSuffix(p: string, ext: string): string {
  const s = suffix(p)
  return (s ? p.slice(0, -s.length) : p) + ext
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p)
}

// base / rel, where an absolute rel wins as it does in pathlib.
export function join(base: string, rel: string): string {
  if (isAbsolute(rel)) return rel
  if (!base || base === '.') return rel
  return base.replace(/[\\/]+$/, '') + '/' + rel
}

// Path.resolve() for an already-absolute path: collapse "." and "..".
export function normalize(p: string): string {
  const fwd = p.replaceAll('\\', '/')
  const drive = /^[A-Za-z]:/.test(fwd) ? fwd.slice(0, 2) : ''
  const rest = fwd.slice(drive.length)
  const abs = rest.startsWith('/')
  const out: string[] = []
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push('..')
    } else {
      out.push(seg)
    }
  }
  return drive + (abs ? '/' : '') + out.join('/')
}
