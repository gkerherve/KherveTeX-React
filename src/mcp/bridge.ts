// The app's side of KherveTeX's MCP support (khervedoc/mcp_bridge.py).
//
// The Rust shell (src-tauri/src/mcp.rs) owns the loopback socket and the
// endpoint file, checks each request's token, and hands it here as an
// `mcp-request` event; this answers it by running the tool in tools.ts
// against the live document, then replies with `mcp_respond`.
// src-tauri/src/mcp_server.rs (the stdio process Claude launches) is the
// only intended client.
//
// Security posture: the listener binds to 127.0.0.1 only, and every
// request must carry the random token from the endpoint file, which is
// written user-readable only. The bridge is off unless the user turns it
// on in AI > Connect to Claude.
import {
  PATH_TOOLS, READ_ONLY_TOOLS, TOOLS, ToolExecutor, type ToolHost, type ToolResult,
  type ToolSpec,
} from './tools.ts'

// 0 lets the OS pick a free port; the endpoint file carries the choice.
export const DEFAULT_PORT = 0

// What a connected client may do, weakest first. "read" inspects only;
// "edit" changes the open document and may save it in place; "full" may
// also open, save-as and export to paths the client chooses.
export const ACCESS_LEVELS = ['read', 'edit', 'full'] as const
export type Access = typeof ACCESS_LEVELS[number]
export const DEFAULT_ACCESS: Access = 'full'

// How many recent calls the dialog's activity log shows.
const LOG_LEN = 200

// Is *name* callable at this access level?
export function toolAllowed(name: string, access: string): boolean {
  if (access === 'full') return true
  if (PATH_TOOLS.has(name)) return false
  if (access === 'edit') return true
  return READ_ONLY_TOOLS.has(name)
}

// Below Full, a client may not pick filesystem paths.
function namesAPath(name: string, input: Record<string, unknown>): boolean {
  return PATH_TOOLS.has(name) || (name === 'save_document' && Boolean(input.path))
}

export interface LogEntry { time: string; tool: string; outcome: string }

// The Rust side, as the bridge drives it (a stand-in in the tests).
export interface BridgeShell {
  // Bind and publish the endpoint; null when the port could not be bound.
  start(port: number, version: string): Promise<{ port: number; pid: number; endpoint: string } | null>
  stop(): Promise<void>
  endpointPath(): Promise<string>
}

// One request as mcp.rs forwards it: params are JSON text.
export interface BridgeRequest { id: number; method: string; params: string }

export interface BridgeAppInfo {
  version: string
  // MainWindow._current_path
  document(): string | null
}

type Listener<A extends unknown[]> = (...args: A) => void

function hhmmss(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Loopback JSON server exposing the AI tool set to MCP clients.
export class McpBridge {
  readonly log: LogEntry[] = []
  private running = false
  private portNo = 0
  private pidNo = 0
  private accessLevel: Access = DEFAULT_ACCESS
  private busy = false
  private executor: ToolExecutor | null = null
  private started = new Set<Listener<[number]>>()
  private stopped = new Set<Listener<[]>>()
  private invoked = new Set<Listener<[string, string]>>()

  private shell: BridgeShell
  private host: () => ToolHost
  private app: BridgeAppInfo

  constructor(shell: BridgeShell, host: () => ToolHost, app: BridgeAppInfo) {
    this.shell = shell
    this.host = host
    this.app = app
  }

  // ── signals ─────────────────────────────────────────────────

  onStarted(l: Listener<[number]>): () => void { this.started.add(l); return () => { this.started.delete(l) } }
  onStopped(l: Listener<[]>): () => void { this.stopped.add(l); return () => { this.stopped.delete(l) } }
  // tool name, outcome
  onToolInvoked(l: Listener<[string, string]>): () => void {
    this.invoked.add(l)
    return () => { this.invoked.delete(l) }
  }

  // ── lifecycle ───────────────────────────────────────────────

  isRunning(): boolean {
    return this.running
  }

  port(): number {
    return this.running ? this.portNo : 0
  }

  access(): Access {
    return this.accessLevel
  }

  // Change what connected clients may do, effective immediately.
  //
  // Hosts cache `tools/list` from their startup, so tightening this
  // mid-session shows up as a refusal rather than a shorter tool list
  // until they reconnect.
  setAccess(level: string): void {
    if (!(ACCESS_LEVELS as readonly string[]).includes(level)) throw new Error(`Unknown access level '${level}'`)
    this.accessLevel = level as Access
  }

  // The tool table as this access level sees it.
  visibleTools(): ToolSpec[] {
    return TOOLS.filter(t => toolAllowed(t.name, this.accessLevel))
  }

  // Begin listening. Returns false (with no side effects) if the port
  // could not be bound.
  async start(port = DEFAULT_PORT): Promise<boolean> {
    if (this.running) return true
    let r: Awaited<ReturnType<BridgeShell['start']>>
    try {
      r = await this.shell.start(port, this.app.version)
    } catch {
      r = null
    }
    if (r === null) return false
    this.running = true
    this.portNo = r.port
    this.pidNo = r.pid
    for (const l of this.started) l(r.port)
    return true
  }

  async stop(): Promise<void> {
    await this.shell.stop().catch(() => {})
    this.running = false
    for (const l of this.stopped) l()
  }

  // ── requests ────────────────────────────────────────────────

  // _handle_line after the token check: the reply's body.
  async handle(method: string, params: Record<string, unknown>): Promise<{ result: unknown } | { error: string }> {
    try {
      if (method === 'get_status') return { result: this.status() }
      if (method === 'list_tools') return { result: this.visibleTools() }
      if (method === 'call_tool') return { result: await this.callTool(params) }
      return { error: `Unknown bridge method: '${method}'` }
    } catch (exc) {
      return { error: exc instanceof Error ? exc.message : String(exc) }
    }
  }

  // One forwarded request → the JSON text mcp_respond sends back.
  async answer(req: BridgeRequest): Promise<string> {
    let params: Record<string, unknown> = {}
    try {
      const p = JSON.parse(req.params || '{}')
      if (p && typeof p === 'object' && !Array.isArray(p)) params = p
    } catch { /* treated as no params */ }
    const body = await this.handle(req.method, params)
    try {
      return JSON.stringify(body)
    } catch (exc) {
      return JSON.stringify({ error: `Unserialisable result: ${exc instanceof Error ? exc.message : exc}` })
    }
  }

  // ── tool execution ──────────────────────────────────────────

  status(): Record<string, unknown> {
    return {
      app: 'KherveTeX',
      version: this.app.version,
      pid: this.pidNo,
      access: this.accessLevel,
      document: this.app.document() ?? 'Untitled',
    }
  }

  private record(name: string, outcome: string): void {
    this.log.push({ time: hhmmss(new Date()), tool: name, outcome })
    if (this.log.length > LOG_LEN) this.log.splice(0, this.log.length - LOG_LEN)
    for (const l of this.invoked) l(name, outcome)
  }

  async callTool(params: Record<string, unknown>): Promise<ToolResult> {
    const name = params.name
    if (!name) return { error: 'Missing tool name.' }
    const tool = String(name)
    const raw = params.input
    const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    if (!toolAllowed(tool, this.accessLevel) || (this.accessLevel !== 'full' && namesAPath(tool, input))) {
      const reason = PATH_TOOLS.has(tool) || tool === 'save_document'
        ? `${tool} reads or writes a file path you chose, which needs MCP access set to 'Full'.`
        : `${tool} would change the document, and MCP access is set to 'Read only'.`
      this.record(tool, 'refused')
      return { error: `Refused: ${reason} The user can change this in AI ▸ Connect to Claude.` }
    }
    // Tool calls are asynchronous (a compile, file writes), so a second
    // request can arrive while one runs. Two tool calls interleaving on
    // one document would corrupt both.
    if (this.busy) {
      this.record(tool, 'busy')
      return { error: 'KherveTeX is still running the previous tool call. Retry when it finishes.' }
    }
    if (this.executor === null) this.executor = new ToolExecutor(this.host())
    // One edit per mutating call: appHost.setChildren / replaceText are
    // each one closed history group, so a single Ctrl+Z reverts whatever
    // the remote agent just did.
    this.busy = true
    let result: ToolResult
    try {
      result = await this.executor.execute(tool, input)
    } catch (exc) {
      result = { error: exc instanceof Error ? `${exc.name}: ${exc.message}` : String(exc) }
    } finally {
      this.busy = false
    }
    // str(result["error"]): a compile's null error reads "None", as in Python.
    const summary = result && typeof result === 'object' && 'error' in result
      ? (result.error === null || result.error === undefined ? 'None' : String(result.error)) : 'ok'
    this.record(tool, summary)
    return result
  }

  pid(): number {
    return this.pidNo
  }

  endpointPath(): Promise<string> {
    return this.shell.endpointPath()
  }
}
