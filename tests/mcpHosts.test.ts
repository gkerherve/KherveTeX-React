// mcp_hosts: writing KherveTeX's entry into an MCP client's config file,
// against a temporary home folder only (never the real config files).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cliCommand, expandPath, Host, hostByKey, hostConfig, HOSTS, pyDumps, serverEntry, setHostIo, type HostIo, type RunOutcome } from '../src/mcp/hosts.ts'

const EXE = '/Applications/KherveTeX.app/Contents/MacOS/khervetex'

let home: string
let runs: string[][]
let cliOk: boolean

function io(platform: HostIo['platform'] = 'darwin'): HostIo {
  return {
    platform, home, env: { APPDATA: join(home, 'AppData', 'Roaming') }, launchCommand: [EXE, '--mcp-server'],
    isFile: async p => existsSync(p) && statSync(p).isFile(),
    isDir: async p => !!p && existsSync(p) && statSync(p).isDirectory(),
    readText: async p => readFileSync(p, 'utf8'),
    copy: async (a, b) => copyFileSync(a, b),
    writeAtomic: async (p, text) => {
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(`${p}.khervedoc-tmp`, text)
      renameSync(`${p}.khervedoc-tmp`, p)
    },
    which: async name => (cliOk ? `/usr/local/bin/${name}` : null),
    run: async (program, args): Promise<RunOutcome> => {
      runs.push([program, ...args])
      return { code: 0, stdout: 'done\n', stderr: '', error: null }
    },
    now: () => new Date(2026, 10, 4, 9, 5, 7),
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'kt-hosts-'))
  runs = []
  cliOk = true
  setHostIo(io())
})

const desktop = () => hostByKey('claude-desktop')!
const desktopFile = () => join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')

describe('the entry', () => {
  it('runs this executable with --mcp-server', () => {
    expect(serverEntry()).toEqual({ command: EXE, args: ['--mcp-server'] })
    expect(cliCommand()).toBe(`claude mcp add khervetex -- ${EXE} --mcp-server`)
    expect(hostConfig()).toBe(`{\n  "mcpServers": {\n    "khervetex": {\n      "command": "${EXE}",\n`
      + '      "args": [\n        "--mcp-server"\n      ]\n    }\n  }\n}')
  })

  it('quotes a path with spaces for the CLI', () => {
    setHostIo({ ...io('win'), launchCommand: ['C:\\Program Files\\KherveTeX\\KherveTeX.exe', '--mcp-server'] })
    expect(cliCommand()).toBe('claude mcp add khervetex -- "C:\\Program Files\\KherveTeX\\KherveTeX.exe" --mcp-server')
  })

  it('dumps JSON as Python does', () => {
    expect(pyDumps({ a: 'é\u{1F600}', b: [], c: {}, d: [1, null, true] })).toBe(
      '{\n  "a": "\\u00e9\\ud83d\\ude00",\n  "b": [],\n  "c": {},\n  "d": [\n    1,\n    null,\n    true\n  ]\n}')
  })

  it('expands ~ and %VAR% like os.path', () => {
    expect(expandPath('~/.cursor/mcp.json')).toBe(`${home}/.cursor/mcp.json`)
    setHostIo(io('win'))
    expect(expandPath('%APPDATA%/Claude/x.json')).toBe(join(home, 'AppData', 'Roaming') + '/Claude/x.json')
    expect(expandPath('%NOPE%/x')).toBe('%NOPE%/x')
    expect(hostByKey('vscode')!.path()).toBe(join(home, 'AppData', 'Roaming') + '/Code/User/mcp.json')
  })
})

describe('config files', () => {
  it('lists the Python hosts in order', () => {
    expect(HOSTS.map(h => h.key)).toEqual(['claude-desktop', 'claude-code', 'cursor', 'windsurf', 'vscode', 'cline',
      'lmstudio', 'zed'])
  })

  it('detects an installed host by its config folder', async () => {
    expect(await desktop().status()).toBe('not installed')
    mkdirSync(dirname(desktopFile()), { recursive: true })
    expect(await desktop().status()).toBe('not connected')
  })

  it('adds the entry, keeps every other key, and backs the old file up', async () => {
    mkdirSync(dirname(desktopFile()), { recursive: true })
    writeFileSync(desktopFile(), JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }))
    const r = await desktop().connect()
    expect(r).toMatchObject({ ok: true, host: 'Claude Desktop', action: 'added', restart: true, path: desktopFile() })
    expect(r.backup).toBe(`${desktopFile()}.khervedoc-20261104-090507.bak`)
    expect(JSON.parse(readFileSync(r.backup!, 'utf8')).mcpServers.other).toBeTruthy()
    const doc = JSON.parse(readFileSync(desktopFile(), 'utf8'))
    expect(doc.theme).toBe('dark')
    expect(doc.mcpServers.other).toEqual({ command: 'x' })
    expect(doc.mcpServers.khervetex).toEqual({ command: EXE, args: ['--mcp-server'] })
    expect(readFileSync(desktopFile(), 'utf8').endsWith('}\n')).toBe(true)
    expect(await desktop().status()).toBe('connected')
    expect((await desktop().connect()).action).toBe('updated')
    expect(readdirSync(dirname(desktopFile())).some(f => f.endsWith('-tmp'))).toBe(false)
  })

  it('notices an entry pointing at another installation', async () => {
    mkdirSync(dirname(desktopFile()), { recursive: true })
    writeFileSync(desktopFile(), JSON.stringify({ mcpServers: { khervetex: { command: '/old', args: [] } } }))
    expect(await desktop().status()).toBe('connected (points elsewhere)')
  })

  it('never overwrites a file it cannot parse', async () => {
    mkdirSync(dirname(desktopFile()), { recursive: true })
    writeFileSync(desktopFile(), '{ broken')
    const r = await desktop().connect()
    expect(r.ok).toBe(false)
    expect(r.error).toContain('is not valid JSON')
    expect(readFileSync(desktopFile(), 'utf8')).toBe('{ broken')
  })

  it('refuses a server table that is not an object', async () => {
    mkdirSync(dirname(desktopFile()), { recursive: true })
    writeFileSync(desktopFile(), JSON.stringify({ mcpServers: [] }))
    expect((await desktop().connect()).error).toBe(`'mcpServers' in ${desktopFile()} is not an object.`)
  })

  it('removes only its own entry', async () => {
    mkdirSync(dirname(desktopFile()), { recursive: true })
    writeFileSync(desktopFile(), JSON.stringify({ mcpServers: { other: {}, khervetex: {} } }))
    const r = await desktop().disconnect()
    expect(r).toMatchObject({ ok: true, action: 'removed', restart: true })
    expect(JSON.parse(readFileSync(desktopFile(), 'utf8'))).toEqual({ mcpServers: { other: {} } })
    expect((await desktop().disconnect()).action).toBe('already absent')
  })

  it('writes VS Code\'s shape with its type key', async () => {
    const vs = hostByKey('vscode')!
    const r = await vs.connect()
    expect(r.ok).toBe(true)
    expect(JSON.parse(readFileSync(vs.path()!, 'utf8'))).toEqual({
      servers: { khervetex: { command: EXE, args: ['--mcp-server'], type: 'stdio' } } })
    expect(await vs.upToDate()).toBe(true)
  })

  it('never rewrites Zed, and gives the snippet instead', async () => {
    const r = await hostByKey('zed')!.connect()
    expect(r).toMatchObject({ ok: false, manual: true })
    expect(existsSync(hostByKey('zed')!.path()!)).toBe(false)
  })

  it('adds a config file the user picked', async () => {
    const f = join(home, 'client', 'mcp.json')
    const h = Host.forFile(f, 'servers')
    h.entryExtra = { type: 'stdio' }
    expect(h.label).toBe('mcp.json')
    expect((await h.connect()).action).toBe('added')
    expect(JSON.parse(readFileSync(f, 'utf8')).servers.khervetex.type).toBe('stdio')
  })
})

describe('Claude Code', () => {
  it('goes through the claude CLI, replacing a stale entry', async () => {
    const r = await hostByKey('claude-code')!.connect()
    expect(r).toMatchObject({ ok: true, action: 'added', path: 'managed by the claude CLI', restart: false, output: 'done' })
    expect(runs).toEqual([
      ['/usr/local/bin/claude', 'mcp', 'remove', 'khervetex'],
      ['/usr/local/bin/claude', 'mcp', 'add', 'khervetex', '--', EXE, '--mcp-server'],
    ])
    expect(existsSync(join(home, '.claude.json'))).toBe(false)
  })

  it('says what to do when the CLI is missing', async () => {
    cliOk = false
    const r = await hostByKey('claude-code')!.connect()
    expect(r.ok).toBe(false)
    expect(r.error).toContain("The 'claude' command is not on PATH")
  })
})
