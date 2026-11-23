import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'

const WEB = join(import.meta.dirname, 'web')

// The "try it online" compiler (src/platform/swiftlatex.ts). In dev,
// /swiftlatex/ serves the engines and /texlive/ a local package tree
// (web/texlive-local, not in git). Only `npm run build:web` copies the
// engines into dist/: the desktop app compiles with tectonic.
function swiftlatex(mode: string): Plugin {
  const types: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm' }
  const serve = (prefix: string, dir: string) => (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    if (!req.url?.startsWith(prefix)) return next()
    const name = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
    const file = normalize(join(dir, name))
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      return res.end()
    }
    const ext = name.slice(name.lastIndexOf('.'))
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  }
  let outDir = 'dist'
  return {
    name: 'ktex-swiftlatex',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir) },
    configureServer(server) {
      server.middlewares.use(serve('/swiftlatex/', join(WEB, 'swiftlatex')))
      server.middlewares.use(serve('/texlive/', join(WEB, 'texlive-local')))
      // buildFormat()'s result, POSTed here, becomes the tree's format file.
      server.middlewares.use('/__ktex-save-format', (req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          writeFileSync(join(WEB, 'texlive-local', 'swiftlatexxetex.fmt'), Buffer.concat(chunks))
          res.end('saved')
        })
      })
    },
    closeBundle() {
      if (mode === 'web') cpSync(join(WEB, 'swiftlatex'), join(outDir, 'swiftlatex'), { recursive: true })
    },
  }
}

// Relative base so the same build works in Tauri and in a browser
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), swiftlatex(mode)],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
}))
