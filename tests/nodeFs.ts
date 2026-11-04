import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FileAccess } from '../src/core/kdocz.ts'

export const nodeFs: FileAccess = {
  exists: async (p) => existsSync(p),
  read: async (p) => new Uint8Array(await readFile(p)),
  write: async (p, data) => {
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
  },
}
