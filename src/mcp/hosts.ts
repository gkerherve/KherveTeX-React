// Write KherveTeX's entry into an MCP host's own config file
// (khervedoc/mcp_hosts.py).
//
// Hand-editing claude_desktop_config.json is the step that stops people
// using the bridge at all, and the installed application already knows the
// one thing a hand-edit gets wrong — the path to its own executable. So it
// writes the entry itself.
//
// The machine is injected (HostIo): the dialog is a thin layer over this,
// and the merge logic is the part worth testing without a window.
//
// Every write here touches a file another application owns, so the rules
// are strict: never clobber a file we could not parse, always back up
// first, always write atomically, and never touch a key that is not ours.

export const SERVER_NAME = 'khervetex'

export type Platform = 'darwin' | 'win' | 'linux'

export interface RunOutcome { code: number | null; stdout: string; stderr: string; error: string | null }

// What host configuration needs from the machine.
export interface HostIo {
  platform: Platform
  home: string
  env: Record<string, string>
  // launch_command(): [this executable, "--mcp-server"]
  launchCommand: string[]
  isFile(path: string): Promise<boolean>
  isDir(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  // shutil.copy2
  copy(src: string, dest: string): Promise<void>
  // Create the folder, write beside the file, rename over it.
  writeAtomic(path: string, text: string): Promise<void>
  // shutil.which
  which(name: string): Promise<string | null>
  run(program: string, args: string[], timeoutSecs: number): Promise<RunOutcome>
  now(): Date
}

let io: HostIo | null = null

export function setHostIo(h: HostIo): void {
  io = h
}

function host(): HostIo {
  if (!io) throw new Error('host io not set')
  return io
}

// ── The entry itself ───────────────────────────────────────────────

// Argv an MCP host should run to reach this installation: the app's own
// executable with --mcp-server (the frozen-build branch of the Python).
export function launchCommand(): string[] {
  return [...host().launchCommand]
}

// The `mcpServers` value describing this installation.
export function serverEntry(): Record<string, unknown> {
  const argv = launchCommand()
  return { command: argv[0], args: argv.slice(1) }
}

// json.dumps(value, indent=indent): Python's layout and ensure_ascii.
export function pyDumps(value: unknown, indent = 2): string {
  const pad = (n: number) => ' '.repeat(n * indent)
  // ensure_ascii: everything outside ' '..'~' as \uXXXX (UTF-16 units).
  const str = (s: string) => {
    let out = ''
    for (const ch of JSON.stringify(s)) {
      const c = ch.charCodeAt(0)
      out += ch.length === 1 && c <= 0x7e ? ch
        : Array.from({ length: ch.length }, (_, k) => '\\u' + ch.charCodeAt(k).toString(16).padStart(4, '0')).join('')
    }
    return out
  }
  const enc = (v: unknown, depth: number): string => {
    if (v === null || v === undefined) return 'null'
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v > 0 ? 'Infinity' : v < 0 ? '-Infinity' : 'NaN'
    if (typeof v === 'string') return str(v)
    if (Array.isArray(v)) {
      if (!v.length) return '[]'
      return '[\n' + v.map(x => pad(depth + 1) + enc(x, depth + 1)).join(',\n') + '\n' + pad(depth) + ']'
    }
    const entries = Object.entries(v as Record<string, unknown>)
    if (!entries.length) return '{}'
    return '{\n' + entries.map(([k, x]) => pad(depth + 1) + str(k) + ': ' + enc(x, depth + 1)).join(',\n')
      + '\n' + pad(depth) + '}'
  }
  return enc(value, 0)
}

// JSON snippet for a host whose config file we cannot safely edit.
export function hostConfig(indent = 2): string {
  return pyDumps({ mcpServers: { [SERVER_NAME]: serverEntry() } }, indent)
}

// One-liner for `claude mcp add`.
export function cliCommand(): string {
  const quoted = launchCommand().map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')
  return `claude mcp add ${SERVER_NAME} -- ${quoted}`
}

// os.path.expandvars(os.path.expanduser(path))
export function expandPath(path: string, h: HostIo = host()): string {
  let p = path
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = h.home + p.slice(1)
  const env = h.env
  const look = (name: string, whole: string) => (name in env ? env[name] : whole)
  p = p.replace(/\$(\w+)|\$\{([^}]*)\}/g, (whole, a: string | undefined, b: string | undefined) => look(a ?? b ?? '', whole))
  if (h.platform === 'win') p = p.replace(/%([^%]+)%/g, (whole, name: string) => look(name, whole))
  return p
}

const dirname = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? '' : i === 0 ? p.slice(0, 1) : p.slice(0, i)
}
const basename = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every(k => k in b && deepEqual((a as never)[k], (b as never)[k]))
  }
  return false
}

const zp = (n: number) => String(n).padStart(2, '0')
// time.strftime('%Y%m%d-%H%M%S')
function stamp(d: Date): string {
  return `${d.getFullYear()}${zp(d.getMonth() + 1)}${zp(d.getDate())}-${zp(d.getHours())}${zp(d.getMinutes())}${zp(d.getSeconds())}`
}

export interface HostReport {
  ok: boolean
  host: string
  error?: string
  manual?: boolean
  path?: string
  backup?: string
  action?: string
  restart?: boolean
  output?: string
}

export type HostStatus = 'not installed' | 'not connected' | 'connected (points elsewhere)' | 'connected'

type Doc = Record<string, unknown>

// One MCP host we know how to configure.
//
// *paths* maps sys.platform prefixes to the config file. *manual* marks a
// host whose file we refuse to rewrite — Zed keeps comments in its
// settings, and json.dump would silently eat them — so the user gets the
// snippet instead.
export class Host {
  overridePath: string | null = null
  readonly key: string
  readonly label: string
  private paths: Partial<Record<Platform, string>>
  readonly note: string
  readonly manual: boolean
  // argv prefix, for CLI-managed hosts
  readonly cli: string[] | null
  // Top-level key holding the server table. Most clients copied Claude
  // Desktop's "mcpServers"; VS Code uses "servers".
  readonly shape: string
  // Extra keys this client wants inside the entry itself.
  entryExtra: Record<string, unknown>

  constructor(key: string, label: string, paths: Partial<Record<Platform, string>>, note = '', manual = false,
    cli: string[] | null = null, shape = 'mcpServers', entryExtra: Record<string, unknown> = {}) {
    this.key = key
    this.label = label
    this.paths = paths
    this.note = note
    this.manual = manual
    this.cli = cli
    this.shape = shape
    this.entryExtra = entryExtra
  }

  // A one-off host for a config file the user picked themselves.
  //
  // The named entries below cannot cover every MCP client, and guessing a
  // path wrongly is worse than asking, so the dialog offers this for
  // anything not listed.
  static forFile(path: string, shape = 'mcpServers'): Host {
    const h = new Host('custom', basename(path) || 'config', {},
      'Restart the application to pick up the change.', false, null, shape)
    h.overridePath = expandPath(path)
    return h
  }

  entry(): Record<string, unknown> {
    return { ...serverEntry(), ...this.entryExtra }
  }

  path(): string | null {
    if (this.overridePath) return this.overridePath
    const tail = this.paths[host().platform]
    return tail ? expandPath(tail) : null
  }

  // ── State ───────────────────────────────────────────────────

  // Is this host installed? Its config dir is the tell.
  async exists(): Promise<boolean> {
    const p = this.path()
    if (!p) return false
    return (await host().isFile(p)) || (await host().isDir(p)) || host().isDir(dirname(p))
  }

  // Is KherveTeX already in this host's config?
  async connected(): Promise<boolean> {
    const doc = await this.read()
    if (doc === null) return false
    const servers = doc[this.shape]
    return !!servers && typeof servers === 'object' && SERVER_NAME in (servers as Doc)
  }

  // Is the entry present *and* pointing at this installation?
  async upToDate(): Promise<boolean> {
    const doc = await this.read()
    if (doc === null) return false
    const servers = (doc[this.shape] || {}) as Doc
    return typeof servers === 'object' && deepEqual(servers[SERVER_NAME], this.entry())
  }

  async status(): Promise<HostStatus> {
    if (!(await this.exists())) return 'not installed'
    if (!(await this.connected())) return 'not connected'
    if (!(await this.upToDate())) return 'connected (points elsewhere)'
    return 'connected'
  }

  // ── File access ─────────────────────────────────────────────

  // Parsed config, or null when absent/unreadable/not an object.
  async read(): Promise<Doc | null> {
    const p = this.path()
    if (!p || !(await host().isFile(p))) return null
    let text: string
    try {
      text = (await host().readText(p)).trim()
    } catch {
      return null
    }
    if (!text) return {}
    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      return null
    }
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc as Doc : null
  }

  // Back up, then replace the config atomically. Returns the backup path.
  private async write(doc: Doc): Promise<string> {
    const p = this.path()!
    let backup = ''
    if (await host().isFile(p)) {
      backup = `${p}.khervedoc-${stamp(host().now())}.bak`
      await host().copy(p, backup)
    }
    // Atomic: never a half-written config.
    await host().writeAtomic(p, pyDumps(doc, 2) + '\n')
    return backup
  }

  // ── Mutation ────────────────────────────────────────────────

  // Add or refresh KherveTeX's entry. Returns a report.
  async connect(): Promise<HostReport> {
    if (this.manual) {
      return { ok: false, manual: true, host: this.label,
        error: `${this.label} keeps comments in its settings file, which rewriting would `
          + 'discard. Copy the snippet in instead.' }
    }
    if (this.cli) return this.connectViaCli()
    const p = this.path()
    if (!p) return { ok: false, host: this.label, error: `${this.label} is not supported on ${PY_PLATFORM[host().platform]}.` }
    let doc = await this.read()
    if (doc === null && (await host().isFile(p))) {
      return { ok: false, host: this.label, path: p,
        error: `${p} is not valid JSON. Fix or remove it first — overwriting it would throw away `
          + 'your other servers.' }
    }
    doc = doc ?? {}
    if (!(this.shape in doc)) doc[this.shape] = {}
    const servers = doc[this.shape]
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      return { ok: false, host: this.label, path: p, error: `'${this.shape}' in ${p} is not an object.` }
    }
    const existed = SERVER_NAME in servers
    ;(servers as Doc)[SERVER_NAME] = this.entry()
    let backup: string
    try {
      backup = await this.write(doc)
    } catch (exc) {
      return { ok: false, host: this.label, path: p, error: `Could not write ${p}: ${errText(exc)}` }
    }
    return { ok: true, host: this.label, path: p, backup, action: existed ? 'updated' : 'added', restart: true }
  }

  // Remove KherveTeX's entry, leaving every other one alone.
  async disconnect(): Promise<HostReport> {
    if (this.cli) return this.disconnectViaCli()
    const p = this.path()
    const doc = await this.read()
    if (doc === null) return { ok: false, host: this.label, error: `Could not read ${p}.` }
    const servers = doc[this.shape]
    if (!servers || typeof servers !== 'object' || Array.isArray(servers) || !(SERVER_NAME in servers)) {
      return { ok: true, host: this.label, path: p ?? undefined, action: 'already absent' }
    }
    delete (servers as Doc)[SERVER_NAME]
    let backup: string
    try {
      backup = await this.write(doc)
    } catch (exc) {
      return { ok: false, host: this.label, path: p ?? undefined, error: `Could not write ${p}: ${errText(exc)}` }
    }
    return { ok: true, host: this.label, path: p ?? undefined, backup, action: 'removed', restart: true }
  }

  // ── CLI-managed hosts ───────────────────────────────────────
  //
  // Claude Code keeps its servers in ~/.claude.json alongside a great deal
  // of unrelated session state. Its own CLI owns that file's shape, so
  // drive that rather than reaching into it.
  private async runCli(args: string[]): Promise<HostReport> {
    const cmd = this.cli![0]
    const exe = await host().which(cmd)
    if (!exe) {
      return { ok: false, host: this.label,
        error: `The '${cmd}' command is not on PATH, so its config cannot be edited `
          + 'safely. Run the command shown below in a terminal instead.' }
    }
    let proc: RunOutcome
    try {
      proc = await host().run(exe, args, 30)
    } catch (exc) {
      return { ok: false, host: this.label, error: `Could not run ${cmd}: ${errText(exc)}` }
    }
    if (proc.error !== null && proc.code === null) {
      return { ok: false, host: this.label, error: `Could not run ${cmd}: ${proc.error}` }
    }
    if (proc.code !== 0) {
      const detail = (proc.stderr || proc.stdout || '').trim()
      return { ok: false, host: this.label, error: `${cmd} failed: ${detail}` }
    }
    return { ok: true, host: this.label, output: (proc.stdout || '').trim() }
  }

  private async connectViaCli(): Promise<HostReport> {
    // Remove first so a stale entry is replaced rather than rejected:
    // `claude mcp add` refuses a name that already exists.
    await this.runCli(['mcp', 'remove', SERVER_NAME])
    const out = await this.runCli(['mcp', 'add', SERVER_NAME, '--', ...launchCommand()])
    if (out.ok) Object.assign(out, { action: 'added', path: 'managed by the claude CLI', restart: false })
    return out
  }

  private async disconnectViaCli(): Promise<HostReport> {
    const out = await this.runCli(['mcp', 'remove', SERVER_NAME])
    if (out.ok) Object.assign(out, { action: 'removed', path: 'managed by the claude CLI', restart: false })
    return out
  }
}

// ── ChatGPT (desktop app) and Codex: ~/.codex/config.toml ───────────
//
// ChatGPT's desktop app and the Codex CLI share one TOML file, where a
// server is a [mcp_servers.<name>] table with `command` and `args`. Only
// our table is touched, as text: comments and every other table stay as
// they were written.

// A TOML basic string.
export function tomlString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    .replace(/[\u0000-\u001f\u007f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"'
}

// Our table, as written into config.toml.
export function tomlEntry(): string {
  const [command, ...args] = launchCommand()
  return `[mcp_servers.${SERVER_NAME}]\ncommand = ${tomlString(command)}\nargs = [${args.map(tomlString).join(', ')}]\n`
}

const HEADER_RE = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/
const isOurs = (table: string) => {
  const t = table.replace(/"/g, '')
  return t === `mcp_servers.${SERVER_NAME}` || t.startsWith(`mcp_servers.${SERVER_NAME}.`)
}

// The text without our tables, and where the first one was (or -1).
export function tomlWithout(text: string): { rest: string[]; at: number } {
  const lines = text.split(/\r?\n/)
  const rest: string[] = []
  let ours = false
  let at = -1
  for (const line of lines) {
    const h = HEADER_RE.exec(line)
    if (h) {
      ours = isOurs(h[1])
      if (ours && at < 0) at = rest.length
    }
    if (!ours) rest.push(line)
  }
  return { rest, at }
}

// Our entry as it stands in the file: command and args, or null.
export function tomlRead(text: string): { command: string; args: string[] } | null {
  const lines = text.split(/\r?\n/)
  let inside = false
  let command: string | null = null
  let args: string[] = []
  const unq = (v: string) => {
    const m = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(v.trim())
    if (!m) return null
    if (m[2] !== undefined) return m[2]
    return m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_x, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\(.)/g, (_x, c) => ({ n: '\n', t: '\t' } as Record<string, string>)[c] ?? c)
  }
  for (const line of lines) {
    const h = HEADER_RE.exec(line)
    if (h) { inside = h[1].replace(/"/g, '') === `mcp_servers.${SERVER_NAME}`; continue }
    if (!inside) continue
    const kv = /^\s*(command|args)\s*=\s*(.*)$/.exec(line)
    if (!kv) continue
    if (kv[1] === 'command') command = unq(kv[2])
    else args = [...kv[2].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(m => unq(m[0]) ?? '')
  }
  return command === null ? null : { command, args }
}

// ChatGPT's desktop app and Codex.
class TomlHost extends Host {
  private appPaths: Partial<Record<Platform, string>>
  constructor(key: string, label: string, paths: Partial<Record<Platform, string>>, note: string,
    appPaths: Partial<Record<Platform, string>>) {
    super(key, label, paths, note)
    this.appPaths = appPaths
  }

  private async text(): Promise<string | null> {
    const p = this.path()
    if (!p || !(await host().isFile(p))) return null
    try { return await host().readText(p) } catch { return null }
  }

  async exists(): Promise<boolean> {
    const p = this.path()
    const app = this.appPaths[host().platform]
    return (!!p && (await host().isDir(dirname(p))))
      || (!!app && ((await host().isDir(expandPath(app))) || (await host().isFile(expandPath(app)))))
  }

  async connected(): Promise<boolean> {
    const t = await this.text()
    return t !== null && tomlRead(t) !== null
  }

  async upToDate(): Promise<boolean> {
    const t = await this.text()
    const e = t === null ? null : tomlRead(t)
    return e !== null && deepEqual([e.command, ...e.args], launchCommand())
  }

  private async save(text: string): Promise<string> {
    const p = this.path()!
    let backup = ''
    if (await host().isFile(p)) {
      backup = `${p}.khervedoc-${stamp(host().now())}.bak`
      await host().copy(p, backup)
    }
    await host().writeAtomic(p, text)
    return backup
  }

  async connect(): Promise<HostReport> {
    const p = this.path()
    if (!p) return { ok: false, host: this.label, error: `${this.label} is not supported here.` }
    const old = (await this.text()) ?? ''
    const existed = tomlRead(old) !== null
    const { rest, at } = tomlWithout(old)
    while (rest.length && !rest[rest.length - 1].trim()) rest.pop()
    const entry = tomlEntry().trimEnd().split('\n')
    const lines = at >= 0 ? [...rest.slice(0, at), ...entry, '', ...rest.slice(at)] : [...rest, ...(rest.length ? [''] : []), ...entry]
    let backup: string
    try {
      backup = await this.save(lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n')
    } catch (exc) {
      return { ok: false, host: this.label, path: p, error: `Could not write ${p}: ${errText(exc)}` }
    }
    return { ok: true, host: this.label, path: p, backup, action: existed ? 'updated' : 'added', restart: true }
  }

  async disconnect(): Promise<HostReport> {
    const p = this.path()
    const old = await this.text()
    if (old === null || tomlRead(old) === null) return { ok: true, host: this.label, path: p ?? undefined, action: 'already absent' }
    const { rest } = tomlWithout(old)
    let backup: string
    try {
      backup = await this.save(rest.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n')
    } catch (exc) {
      return { ok: false, host: this.label, path: p ?? undefined, error: `Could not write ${p}: ${errText(exc)}` }
    }
    return { ok: true, host: this.label, path: p ?? undefined, backup, action: 'removed', restart: true }
  }
}

const PY_PLATFORM: Record<Platform, string> = { darwin: 'darwin', win: 'win32', linux: 'linux' }

function errText(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc)
}

// Hosts we can configure, in the order the dialog lists them.
export const HOSTS: Host[] = [
  new Host('claude-desktop', 'Claude Desktop', {
    darwin: '~/Library/Application Support/Claude/claude_desktop_config.json',
    win: '%APPDATA%/Claude/claude_desktop_config.json',
    linux: '~/.config/Claude/claude_desktop_config.json',
  }, 'Restart Claude Desktop to pick up the change.'),
  new Host('claude-code', 'Claude Code', {
    darwin: '~/.claude.json',
    win: '~/.claude.json',
    linux: '~/.claude.json',
  }, 'Applied through the claude CLI. Reconnect the session to see the tools.', false, ['claude']),
  new TomlHost('chatgpt', 'ChatGPT (desktop app) and Codex', {
    darwin: '~/.codex/config.toml',
    win: '~/.codex/config.toml',
    linux: '~/.codex/config.toml',
  }, 'Quit and reopen ChatGPT (or restart Codex). kTeX then shows among its MCP servers; '
    + 'turn its tools on in a chat if ChatGPT asks.', { darwin: '/Applications/ChatGPT.app', win: '%LOCALAPPDATA%/Programs/ChatGPT' }),
  new Host('cursor', 'Cursor', {
    darwin: '~/.cursor/mcp.json',
    win: '~/.cursor/mcp.json',
    linux: '~/.cursor/mcp.json',
  }, 'Restart Cursor to pick up the change.'),
  new Host('windsurf', 'Windsurf', {
    darwin: '~/.codeium/windsurf/mcp_config.json',
    win: '~/.codeium/windsurf/mcp_config.json',
    linux: '~/.codeium/windsurf/mcp_config.json',
  }, 'Restart Windsurf to pick up the change.'),
  new Host('vscode', 'VS Code (Copilot)', {
    darwin: '~/Library/Application Support/Code/User/mcp.json',
    win: '%APPDATA%/Code/User/mcp.json',
    linux: '~/.config/Code/User/mcp.json',
  }, "Restart VS Code, or run 'MCP: List Servers' to start it.", false, null, 'servers', { type: 'stdio' }),
  new Host('cline', 'Cline (VS Code)', {
    darwin: '~/Library/Application Support/Code/User/globalStorage/'
      + 'saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    win: '%APPDATA%/Code/User/globalStorage/'
      + 'saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    linux: '~/.config/Code/User/globalStorage/'
      + 'saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
  }, 'Cline reloads its servers on its own.'),
  new Host('lmstudio', 'LM Studio', {
    darwin: '~/.lmstudio/mcp.json',
    win: '~/.lmstudio/mcp.json',
    linux: '~/.lmstudio/mcp.json',
  }, 'Restart LM Studio to pick up the change.'),
  new Host('zed', 'Zed', {
    darwin: '~/.config/zed/settings.json',
    win: '%APPDATA%/Zed/settings.json',
    linux: '~/.config/zed/settings.json',
  }, "Zed's settings file allows comments, so kTeX will not rewrite it. Copy the snippet in by hand.",
  true),
]

export function hostByKey(key: string): Host | null {
  return HOSTS.find(h => h.key === key) ?? null
}

// Hosts that appear to be installed on this machine.
export async function detected(): Promise<Host[]> {
  const out: Host[] = []
  for (const h of HOSTS) if (await h.exists()) out.push(h)
  return out
}
