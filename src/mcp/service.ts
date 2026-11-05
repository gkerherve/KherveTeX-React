// MainWindow.mcp_bridge / start_mcp_if_enabled: the one bridge of this
// window, its settings, the Tauri wiring (requests arrive as the
// `mcp-request` event and go back through `mcp_respond`), and what host
// configuration needs from the machine.
import { invoke } from '@tauri-apps/api/core'
import pkg from '../../package.json'
import { appStore } from '../app/store.ts'
import { isTauri, platform } from '../platform'
import { setting } from '../platform/settings.ts'
import { createAppHost } from './appHost.ts'
import { ACCESS_LEVELS, DEFAULT_ACCESS, McpBridge, type BridgeRequest, type BridgeShell } from './bridge.ts'
import { setHostIo, type HostIo, type Platform } from './hosts.ts'
import type { ToolHost } from './tools.ts'

// __version__: "<major>.<minor>"
export const APP_VERSION = pkg.version.split('.').slice(0, 2).join('.')

interface Started { port: number; pid: number; endpoint: string }
interface Status { running: boolean; port: number; pid: number; endpoint: string }

const tauriShell: BridgeShell = {
  start: async (port, version) => {
    try {
      return await invoke<Started>('mcp_start', { port, version })
    } catch {
      return null
    }
  },
  stop: () => invoke('mcp_stop'),
  endpointPath: async () => (await invoke<Status>('mcp_status')).endpoint,
}

// The browser preview has no socket to open.
const noShell: BridgeShell = {
  start: async () => null,
  stop: async () => {},
  endpointPath: async () => '',
}

let bridge: McpBridge | null = null
let host: ToolHost | null = null
let hostReady: Promise<void> | null = null

let statusTimer: ReturnType<typeof setTimeout> | null = null
// statusBar().showMessage(msg, 4000)
function showMessage(msg: string): void {
  appStore().set({ status: msg })
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { if (appStore().get().status === msg) appStore().set({ status: '' }) }, 4000)
}

// The loopback bridge Claude's MCP server talks to (lazy).
export function mcpBridge(): McpBridge {
  if (bridge) return bridge
  const b = new McpBridge(isTauri() ? tauriShell : noShell, () => host!, {
    version: APP_VERSION,
    document: () => appStore().get().path,
  })
  const level = setting<string>('mcp/access', DEFAULT_ACCESS)
  b.setAccess((ACCESS_LEVELS as readonly string[]).includes(level) ? level : DEFAULT_ACCESS)
  b.onToolInvoked((name, outcome) => showMessage(`Claude: ${name} — ${outcome}`))
  bridge = b
  return b
}

let listening: Promise<void> | null = null

// Requests reach this window only; each is answered whatever happens.
function listen(): Promise<void> {
  if (!listening) {
    listening = (async () => {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      await getCurrentWebviewWindow().listen<BridgeRequest>('mcp-request', async (e) => {
        const req = e.payload
        let reply: string
        try {
          await hostReady
          reply = await mcpBridge().answer(req)
        } catch (exc) {
          reply = JSON.stringify({ error: exc instanceof Error ? exc.message : String(exc) })
        }
        await invoke('mcp_respond', { id: req.id, reply }).catch(() => {})
      })
    })()
  }
  return listening
}

// McpBridge.start with the window's tools ready to answer.
export async function startBridge(): Promise<boolean> {
  hostReady ??= createAppHost().then(h => { host = h })
  await hostReady
  if (isTauri()) await listen()
  return mcpBridge().start()
}

export async function startMcpIfEnabled(): Promise<void> {
  // One bridge per process: the endpoint file names one window — the main
  // one (the detached PDF window never starts it).
  if (isTauri()) {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    if (getCurrentWebviewWindow().label !== 'main') return
  }
  if (setting('mcp/enabled', false)) await startBridge()
}

// ---- the machine, for host configuration (mcp_hosts) ----

interface HostContext { platform: Platform; home: string; env: Record<string, string>; state_dir: string }

let ioReady: Promise<void> | null = null

export function hostIoReady(): Promise<void> {
  ioReady ??= (async () => {
    if (!isTauri()) {
      // The browser cannot see other applications' settings.
      setHostIo({
        platform: 'linux', home: '', env: {}, launchCommand: ['KherveTeX', '--mcp-server'],
        isFile: async () => false, isDir: async () => false, readText: async () => '',
        copy: async () => {}, writeAtomic: async () => { throw new Error('not available in the browser') },
        which: async () => null, run: async () => ({ code: null, stdout: '', stderr: '', error: 'browser' }),
        now: () => new Date(),
      })
      return
    }
    const ctx = await invoke<HostContext>('mcp_host_context')
    const launch = await invoke<string[]>('mcp_launch_command')
    const p = platform()
    const io: HostIo = {
      platform: ctx.platform, home: ctx.home, env: ctx.env, launchCommand: launch,
      isFile: async (path) => !!(await p.stat(path).catch(() => null))?.isFile,
      isDir: async (path) => !!path && !!(await p.stat(path).catch(() => null))?.isDir,
      readText: (path) => p.readText(path),
      copy: (src, dest) => p.copy(src, dest),
      writeAtomic: (path, text) => invoke('mcp_write_atomic', { path, text }),
      which: (name) => invoke<string | null>('which_program', { name }),
      run: async (program, args, timeoutSecs) => {
        const r = await p.run(program, args, { timeoutSecs })
        return { code: r.code, stdout: r.stdout, stderr: r.stderr, error: r.error }
      },
      now: () => new Date(),
    }
    setHostIo(io)
  })()
  return ioReady
}
