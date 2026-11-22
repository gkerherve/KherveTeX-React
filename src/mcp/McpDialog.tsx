// Control panel for the assistant connection (khervedoc/mcp_dialog.py).
//
// Shows whether the connection is open and wires Claude Desktop, Claude
// Code and their relatives up to it.
//
// Nothing here says "MCP" unless the user has to type it somewhere: the
// protocol is our problem, not theirs. What a person needs to know is
// which application to connect, that it must be restarted afterwards, and
// that they then say "KherveTeX" in the chat -- that last step is
// invisible, and skipping it makes a correctly connected assistant look
// broken.
//
// Editing claude_desktop_config.json by hand is the step that stops people
// connecting at all, so the dialog detects the applications on this
// machine and writes the entry itself (see hosts.ts). The snippet and its
// Copy button stay for the ones we refuse to rewrite and for anyone
// configuring a machine by hand.
//
// Like the Python QDialog.show(), it is modeless: the document stays
// usable while it is open, so the user can watch Claude work.
import { useCallback, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { platform } from '../platform'
import { information, question, warning } from '../platform/MessageBox.tsx'
import { setSetting } from '../platform/settings.ts'
import { ACCESS_LEVELS, type Access, type McpBridge } from './bridge.ts'
import { cliCommand, Host, HOSTS, hostConfig, tomlEntry, type HostReport, type HostStatus } from './hosts.ts'
import { hostIoReady, mcpBridge, startBridge } from './service.ts'
import '../ui/dialogs/dialogs.css'
import './mcp.css'

// Access level → (label, what it means). Order matches ACCESS_LEVELS.
const ACCESS_LABELS: [string, string][] = [
  ['Read only', 'Read the document, its LaTeX and the compiled PDF.'],
  ['Edit', 'Also write and restructure the document, compile, save in place.'],
  ['Full (recommended)', 'Also open, import, save-as and export to files the assistant chooses.'],
]

const FLAVOURS = ['Claude Desktop / Cursor / Zed (JSON)', 'Claude Code (command line)', 'ChatGPT / Codex (~/.codex/config.toml)']

const TITLE = 'Connect to Claude or ChatGPT'

interface HostRow { status: HostStatus; connected: boolean; upToDate: boolean; path: string | null }

function McpServerDialog({ bridge, close }: { bridge: McpBridge; close: () => void }) {
  const [running, setRunning] = useState(bridge.isRunning())
  const [port, setPort] = useState(bridge.port())
  const [statusError, setStatusError] = useState(false)
  const [endpoint, setEndpoint] = useState('')
  const [access, setAccessState] = useState<Access>(bridge.access())
  const [rows, setRows] = useState<HostRow[] | null>(null)
  const [row, setRow] = useState(0)
  const [flavour, setFlavour] = useState(0)
  const [snippet, setSnippet] = useState('')
  const [activity, setActivity] = useState<string[]>(() =>
    [...bridge.log].reverse().map(e => `${e.time}  ${e.tool} — ${e.outcome}`))

  // _refresh_hosts: every host's state, keeping the current selection.
  const refreshHosts = useCallback(async () => {
    await hostIoReady()
    const out: HostRow[] = []
    for (const h of HOSTS) {
      out.push({ status: await h.status(), connected: await h.connected(), upToDate: await h.upToDate(), path: h.path() })
    }
    setRows(out)
  }, [])

  // _refresh
  const refresh = useCallback(() => {
    setRunning(bridge.isRunning())
    setPort(bridge.port())
    setStatusError(false)
    setAccessState(bridge.access())
    setActivity([...bridge.log].reverse().map(e => `${e.time}  ${e.tool} — ${e.outcome}`))
    void bridge.endpointPath().then(setEndpoint).catch(() => {})
    void refreshHosts()
  }, [bridge, refreshHosts])

  useEffect(() => {
    refresh()
    const offs = [
      bridge.onStarted(() => refresh()),
      bridge.onStopped(() => refresh()),
      bridge.onToolInvoked((name, outcome) => {
        setActivity(a => [`${name} — ${outcome}`, ...a].slice(0, 50))
      }),
    ]
    return () => { for (const off of offs) off() }
  }, [bridge, refresh])

  // _refresh_snippet
  useEffect(() => {
    void hostIoReady().then(() => setSnippet(flavour === 0 ? hostConfig() : flavour === 1 ? cliCommand() : tomlEntry()))
  }, [flavour])

  const onToggled = async (on: boolean) => {
    if (on) {
      if (!(await startBridge())) {
        setRunning(false)
        setStatusError(true)
        return
      }
    } else {
      await bridge.stop()
    }
    setSetting('mcp/enabled', on)
    refresh()
  }

  const onAccessChanged = (index: number) => {
    const level = ACCESS_LEVELS[index]
    bridge.setAccess(level)
    setSetting('mcp/access', level)
    setAccessState(level)
  }

  let accessHint = ACCESS_LABELS[ACCESS_LEVELS.indexOf(access)][1]
  if (access === 'full') {
    accessHint += ' That is real code running in this process, with '
      + 'your permissions — the same reach as a =PY cell '
      + 'you typed yourself, so connect only applications '
      + 'you trust. Drop to Edit on a shared machine.'
  }

  const selected: Host | null = HOSTS[row] ?? null
  const sel = rows?.[row] ?? null

  // _report: what a connect/disconnect actually did.
  const report = async (result: HostReport) => {
    const name = result.host || 'host'
    if (!result.ok) {
      await warning(TITLE, result.error ?? `Could not configure ${name}.`)
      void refreshHosts()
      return
    }
    const lines = [`${name}: kTeX ${result.action ?? 'updated'}.`, `File: ${result.path ?? ''}`]
    if (result.backup) lines.push(`Previous version saved as ${result.backup}`)
    if (result.restart) lines.push(`\nRestart ${name} for it to take effect.`)
    if (result.action !== 'removed') {
      // The step with no visible cue: a correctly connected assistant sits
      // there doing nothing until a chat names this application.
      lines.push(`\nThen mention kTeX in your chat with ${name} `
        + '— say "in kTeX, proofread section 2" or "put my Word file ~/Documents/report.docx into kTeX" — '
        + 'and it will work in the open document.')
    }
    await information(TITLE, lines.join('\n'))
    void refreshHosts()
  }

  // Connecting an application turns the connection on: the entry is only
  // useful while kTeX is listening.
  const ensureRunning = async (): Promise<boolean> => {
    if (bridge.isRunning()) return true
    await onToggled(true)
    if (bridge.isRunning()) return true
    await warning(TITLE, 'kTeX could not open its local connection (another program may hold the port).')
    return false
  }

  const onConnect = async () => {
    if (!selected) return
    if (!(await ensureRunning())) return
    await report(await selected.connect())
  }

  // Every application found on this computer, in one go.
  const onConnectAll = async () => {
    if (!(await ensureRunning())) return
    await hostIoReady()
    const done: string[] = []
    const failed: string[] = []
    for (const h of HOSTS) {
      if (h.manual || !(await h.exists()) || (await h.upToDate())) continue
      const r = await h.connect()
      if (r.ok) done.push(h.label)
      else failed.push(`${h.label}: ${r.error ?? 'failed'}`)
    }
    void refreshHosts()
    if (!done.length && !failed.length) {
      await information(TITLE, 'Every application found on this computer is already connected.')
      return
    }
    const lines: string[] = []
    if (done.length) lines.push(`Connected: ${done.join(', ')}.`, 'Quit and reopen each of them so they load kTeX.')
    if (failed.length) lines.push('', 'Not connected:', ...failed)
    lines.push('', 'Then say "kTeX" in the chat, e.g. "in kTeX, put my Word file ~/Documents/report.docx into kTeX".')
    await (failed.length ? warning : information)(TITLE, lines.join('\n'))
  }

  // Add KherveTeX to a config file the user points us at.
  //
  // The named entries cannot cover every MCP client, and guessing a path
  // wrongly is worse than asking.
  const onOtherHost = async () => {
    if (!(await ensureRunning())) return
    const picked = await platform().openFileDialog({
      title: "Choose the client's MCP config file",
      filters: [{ name: 'JSON config', extensions: ['json'] }, { name: 'All files', extensions: [] }],
    })
    if (!picked?.length) return
    const path = picked[0]
    // Match the file's own convention rather than imposing ours: most
    // clients copied Claude Desktop's "mcpServers", VS Code and its
    // relatives use "servers".
    let shape = 'mcpServers'
    try {
      const doc = JSON.parse(await platform().readText(path))
      if (doc && typeof doc === 'object' && 'servers' in doc && !('mcpServers' in doc)) shape = 'servers'
    } catch { /* empty or unreadable: connect() reports it */ }
    await hostIoReady()
    const h = Host.forFile(path, shape)
    if (shape === 'servers') h.entryExtra = { type: 'stdio' }
    await report(await h.connect())
  }

  const onDisconnect = async () => {
    if (!selected) return
    if (!(await question(TITLE, `Remove KherveTeX from ${selected.label}'s configuration?\n`
      + 'Other servers are left untouched.'))) return
    await report(await selected.disconnect())
  }

  const copy = () => { void navigator.clipboard?.writeText(snippet).catch(() => {}) }

  const hostHint: string[] = []
  if (selected) {
    if (selected.manual) hostHint.push('Cannot be edited automatically.')
    if (selected.note) hostHint.push(selected.note)
  }

  return (
    <div className='dlg dlg-mcp' role='dialog' aria-label={TITLE}>
      <div className='dlg-title'>{TITLE}</div>
      <div className='dlg-body mcp-body'>
        <div>
          Let Claude or ChatGPT read and edit this document directly — no API key, it uses the login you
          already have. Works with <b>Claude Desktop</b>, <b>Claude Code</b>, the <b>ChatGPT</b> desktop app
          and Codex, and with Cursor, Cline, VS Code and LM Studio.<br /><br />
          It can import a Word, LibreOffice, PDF or LaTeX file, check the import against the original and fix
          it, edit, compile, and export to PDF, Word or LaTeX. Every change it makes is undoable with Ctrl+Z.
        </div>
        <label className='mcp-check'>
          <input type='checkbox' checked={running} onChange={e => { void onToggled(e.target.checked) }} />
          Let assistants connect to this document
        </label>
        <div className='mcp-status'>
          {statusError
            ? <><b>Could not open a local port.</b> Another process may be holding it.</>
            : running
              ? <><b style={{ color: '#2e7d32' }}>Listening</b> on 127.0.0.1:{port}<br />endpoint file: {endpoint}</>
              : <><b style={{ color: '#b71c1c' }}>Stopped</b> — no assistant can reach this document.</>}
        </div>
        <div className='mcp-row'>
          <span>The assistant may:</span>
          <select value={ACCESS_LEVELS.indexOf(access)} onChange={e => onAccessChanged(Number(e.target.value))}>
            {ACCESS_LABELS.map(([label, tip], i) => <option key={label} value={i} title={tip}>{label}</option>)}
          </select>
        </div>
        <div className='mcp-hint'>{accessHint}</div>

        <fieldset className='mcp-group'>
          <legend>Connect an application</legend>
          <div>
            Press <b>Connect all</b> to set up every application found on this computer, or pick one and press
            Connect — kTeX writes itself into that application's own settings, so there is no file to edit.
          </div>
          <div className='mcp-list mcp-hosts' role='listbox'>
            {HOSTS.map((h, i) => {
              const st = rows?.[i]?.status ?? ''
              const cls = st.startsWith('connected') ? 'mcp-ok' : st === 'not installed' ? 'mcp-gray' : ''
              return (
                <div key={h.key} role='option' aria-selected={i === row}
                  className={`${cls}${i === row ? ' selected' : ''}`} onMouseDown={() => setRow(i)}>
                  {h.label}{st ? ` — ${st}` : ''}
                </div>
              )
            })}
          </div>
          <div className='mcp-buttons'>
            <button onClick={() => { void onConnectAll() }}
              title='Connect every application found on this computer'><b>Connect all</b></button>
            <button disabled={!selected || selected.manual} onClick={() => { void onConnect() }}>
              {sel && sel.connected && !sel.upToDate ? 'Update entry' : 'Connect'}
            </button>
            <button disabled={!selected || !sel?.connected || selected.manual} onClick={() => { void onDisconnect() }}>
              Disconnect
            </button>
            <button title="Pick any MCP client's JSON config file and add kTeX to it."
              onClick={() => { void onOtherHost() }}>Other application…</button>
          </div>
          <div className='mcp-hint mcp-select'>
            {hostHint.join('  ')}{sel?.path ? <>{hostHint.length ? '  ' : ''}<i>{sel.path}</i></> : null}
          </div>
        </fieldset>

        <div className='mcp-row'>
          <span>Or set it up by hand:</span>
          <select value={flavour} onChange={e => setFlavour(Number(e.target.value))}>
            {FLAVOURS.map((f, i) => <option key={f} value={i}>{f}</option>)}
          </select>
        </div>
        <textarea className='mcp-snippet' readOnly value={snippet} spellCheck={false} />

        <div>
          <b>Then say &quot;kTeX&quot; in the chat.</b> The assistant only reaches for this document when you
          point it here &mdash; <i>&quot;in kTeX, tighten the introduction and add a results table&quot;</i>, or
          <i> &quot;put my Word document ~/Documents/report.docx into kTeX and fix what the import got
          wrong&quot;</i>. After that it carries on in the open document.<br /><br />
          Quit and reopen the application after connecting &mdash; it reads its tool list once at startup
          &mdash; and leave kTeX running with the box above ticked.
        </div>

        <fieldset className='mcp-group'>
          <legend>Recent activity</legend>
          <div className='mcp-list mcp-activity'>
            {activity.map((a, i) => <div key={i}>{a}</div>)}
          </div>
        </fieldset>
      </div>
      <div className='dlg-buttons'>
        <button onClick={copy}>Copy</button>
        <button onClick={close}>Close</button>
      </div>
    </div>
  )
}

let open: { root: Root; el: HTMLElement } | null = null

// MainWindow._show_mcp_dialog
export function showMcpDialog(): void {
  if (open) {
    open.el.querySelector<HTMLElement>('.dlg')?.focus()
    return
  }
  const el = document.createElement('div')
  el.className = 'mcp-layer'
  document.body.appendChild(el)
  const root = createRoot(el)
  const close = () => {
    root.unmount()
    el.remove()
    open = null
  }
  el.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
  open = { root, el }
  root.render(<McpServerDialog bridge={mcpBridge()} close={close} />)
}
