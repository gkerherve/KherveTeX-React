import type { FileAccess } from '../src/core/kdocz.ts'

// An in-memory FileAccess. A path that is a prefix folder of a stored file
// (or ".") exists and, like a real folder, cannot be read.
export function memFs(initial: Record<string, Uint8Array> = {}): FileAccess & { files: Map<string, Uint8Array> } {
  const files = new Map(Object.entries(initial))
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/\.$/, '')
  const isDir = (p: string) => {
    const n = norm(p)
    if (n === '.' || n === '') return true
    return [...files.keys()].some((k) => k.startsWith(n.replace(/\/$/, '') + '/'))
  }
  return {
    files,
    exists: async (p) => files.has(norm(p)) || isDir(p),
    read: async (p) => {
      const n = norm(p)
      const f = files.get(n)
      if (f) return f
      const e = new Error(isDir(p) ? `EISDIR: illegal operation on a directory, read '${p}'` : `ENOENT: ${p}`)
      ;(e as Error & { code: string }).code = isDir(p) ? 'EISDIR' : 'ENOENT'
      throw e
    },
    write: async (p, data) => {
      files.set(norm(p), data)
    },
  }
}

export const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
export const toB64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
