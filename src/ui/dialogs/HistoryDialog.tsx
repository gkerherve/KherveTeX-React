// The commit browser with its branch graph and branch management: a port
// of khervedoc/history_dialog.py.
//
//   - Left:  the commit list with the DAG rail painted in its first column
//            (merge points, forks, parallel lines) and branch labels drawn
//            next to the commits they point at.
//   - Right: the full message and metadata, the coloured unified diff and
//            the Restore button.
//   - Top:   the branch bar (current branch, switch, create, delete), so
//            branches are managed without leaving the dialog.
import {
  useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { basename } from '../../core/paths'
import { git, type BranchInfo, type GraphRow } from '../../platform/git'
import { critical, escapeHtml, information, messageBox, warning } from '../../platform/MessageBox'
import { promptText } from './EditorDialogs'
import { openDialog, type Close } from './dialogHost'
import './gitDialogs.css'

// ---- rail / graph colours ----

export const RAIL_COLOURS = [
  '#1a6dd8', // blue
  '#d96b00', // orange
  '#2a8c4a', // green
  '#a83070', // magenta
  '#7b5ea7', // purple
  '#b08800', // gold
  '#00838f', // teal
  '#c44040', // red
]

export function railColour(rail: number): string {
  return RAIL_COLOURS[rail % RAIL_COLOURS.length]
}

// ---- diff highlighter (_DiffHighlighter) ----

export type DiffLineKind = 'header' | 'hunk' | 'add' | 'del' | 'plain'

export function diffLineKind(text: string): DiffLineKind {
  if (!text) return 'plain'
  if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('diff ')
    || text.startsWith('index ') || text.startsWith('new file') || text.startsWith('deleted file')
    || text.startsWith('similarity ') || text.startsWith('rename ')) return 'header'
  if (text.startsWith('@@')) return 'hunk'
  if (text.startsWith('+')) return 'add'
  if (text.startsWith('-')) return 'del'
  return 'plain'
}

// ---- graph column (_GraphDelegate) ----

const GRAPH_COL_W = 16 // pixels per rail column
const DOT_R = 4 // commit-dot radius
const GRAPH_PAD = 8 // left padding before the first rail

function maxRails(commits: GraphRow[]): number {
  let m = 1
  for (const c of commits) {
    m = Math.max(m, c.rail + 1)
    for (const [a, b] of c.rails_after) m = Math.max(m, a + 1, b + 1)
  }
  return m
}

// _graph_col_width: how wide column 0 needs to be for the DAG + labels.
export function graphColWidth(commits: GraphRow[]): number {
  let labelW = 0
  for (const c of commits) for (const b of c.branches) labelW = Math.max(labelW, b.length * 8 + 20)
  return GRAPH_PAD + maxRails(commits) * GRAPH_COL_W + labelW + 20
}

const LABEL_FONT = 'bold 8pt "Segoe UI", system-ui, sans-serif'
let measureCtx: CanvasRenderingContext2D | null = null
// fm.horizontalAdvance(text) in the label font.
function textWidth(text: string): number {
  if (!measureCtx && typeof document !== 'undefined') {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  if (!measureCtx) return text.length * 7
  measureCtx.font = LABEL_FONT
  return measureCtx.measureText(text).width
}

function GraphCell({ commits, row, rails }: { commits: GraphRow[]; row: number; rails: number }) {
  const c = commits[row]
  const xOf = (r: number) => GRAPH_PAD + r * GRAPH_COL_W + GRAPH_COL_W / 2
  const parts: ReactNode[] = []
  // Vertical continuation lines for every active rail; the dot's own rail
  // runs into the dot from above and on from below it.
  for (const [ri] of c.rails_after) {
    parts.push(<line key={`r${ri}`} x1={xOf(ri)} x2={xOf(ri)} y1='0' y2='100%'
      stroke={railColour(ri)} strokeWidth='2' />)
  }
  // Merge lines: the extra parents come in from other rails (found in the
  // next few rows) to this commit's dot.
  if (c.parents.length > 1) {
    for (const extra of c.parents.slice(1)) {
      for (let f = row + 1; f < Math.min(row + 6, commits.length); f++) {
        if (commits[f].oid === extra) {
          const pr = commits[f].rail
          parts.push(<line key={`m${extra}`} x1={xOf(c.rail)} y1='50%' x2={xOf(pr)} y2='100%'
            stroke={railColour(pr)} strokeWidth='2' />)
          break
        }
      }
    }
  }
  const r = c.is_merge ? DOT_R + 1 : DOT_R
  parts.push(<circle key='dot' cx={xOf(c.rail)} cy='50%' r={r} fill={railColour(c.rail)} />)
  // Branch labels next to the graph.
  const labelX = xOf(rails) + 4
  const labels = c.branches.map((b, i) => {
    const tw = textWidth(b) + 10
    const remote = b.includes('/')
    return (
      <g key={b} transform={`translate(${labelX}, ${-8 + i * 18})`}>
        <rect width={tw} height='16' rx='3' ry='3' fill={remote ? '#e8e0f0' : '#d0e8ff'} />
        <text x='5' y='8' dominantBaseline='central' fill={remote ? '#5a4080' : '#0a5090'}
          style={{ font: LABEL_FONT }}>{b}</text>
      </g>
    )
  })
  return (
    <svg className='hist-graph' aria-hidden='true'>
      {parts}
      {labels.length > 0 && <svg y='50%' overflow='visible'>{labels}</svg>}
    </svg>
  )
}

// ---- the dialog ----

function Meta({ c }: { c: GraphRow | null }) {
  if (!c) return <div className='hist-meta'>Select a commit to see its diff.</div>
  return (
    <div className='hist-meta'>
      <b className='hist-subject'>{c.subject}</b>
      {c.branches.length > 0 && <><br />{c.branches.map(b => (
        <span key={b} className='hist-tag'>{b}</span>
      ))}</>}
      <br /><span className='hist-grey'>{c.short_oid} &middot; {c.author} &middot; {c.timestamp}</span>
      {c.body && <><br /><pre className='hist-body'>{c.body}</pre></>}
    </div>
  )
}

function Diff({ text }: { text: string }) {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return (
    <div className='hist-diff' role='textbox' aria-readonly='true' aria-label='Diff' tabIndex={0}>
      {lines.map((l, i) => <div key={i} className={`hd-${diffLineKind(l)}`}>{l || ' '}</div>)}
    </div>
  )
}

const YES_CANCEL = [{ label: 'Yes', default: true }, { label: 'Cancel' }]
const YES_NO = [{ label: 'Yes', default: true }, { label: 'No' }]

function HistoryDialog({ repoDir, fileStem, onReload, close }: {
  repoDir: string; fileStem: string | null; onReload: () => Promise<void> | void; close: Close<void>
}) {
  const g = git()
  const rootRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [combo, setCombo] = useState<string>('')
  const [commits, setCommits] = useState<GraphRow[]>([])
  const [row, setRow] = useState(-1)
  const [diff, setDiff] = useState('')
  const [leftW, setLeftW] = useState(480)

  // _refresh_branch_bar
  const refreshBranchBar = useCallback(async () => {
    const [cur, all] = await Promise.all([g.currentBranch(repoDir), g.listBranches(repoDir)])
    setCurrent(cur)
    const local = all.filter(b => b.remote === null)
    setBranches(local)
    setCombo(local[0]?.name ?? '')
  }, [g, repoDir])

  const loadCommits = useCallback(async () => {
    const rows = await g.historyGraph(repoDir, 300)
    setCommits(rows)
    setRow(rows.length ? 0 : -1)
  }, [g, repoDir])

  useEffect(() => {
    void refreshBranchBar()
    void loadCommits()
  }, [refreshBranchBar, loadCommits])

  // _on_row_changed
  useEffect(() => {
    let live = true
    const c = commits[row]
    if (!c) { setDiff(''); return }
    void g.diffForCommit(repoDir, c.oid).then(d => {
      if (live) setDiff(d || '(no diff — empty commit or root commit with no tree)')
    })
    return () => { live = false }
  }, [g, repoDir, commits, row])

  // _refresh_after_branch_change: the graph and branch bar again, and the
  // document reloaded in the editor.
  const refreshAfterBranchChange = async () => {
    await refreshBranchBar()
    await loadCommits()
    await onReload()
  }

  const onSwitch = async () => {
    const name = combo
    if (!name) return
    const cur = await g.currentBranch(repoDir)
    if (name === cur) {
      await information('Already there', `You are already on branch '${name}'.`)
      return
    }
    const reply = await messageBox({ title: 'Switch branch', icon: 'question', buttons: YES_CANCEL,
      html: `Switch to branch <b>${escapeHtml(name)}</b>?<br><br>`
        + "<span style='color:#666;'>Unsaved changes in the editor will be lost. Save first if needed.</span>" })
    if (reply !== 'Yes') return
    const [ok, msg] = await g.switchBranch(repoDir, name)
    if (!ok) {
      await warning('Switch failed', msg)
      return
    }
    await refreshAfterBranchChange()
    await information('Switched', msg)
  }

  const onCreate = async () => {
    const typed = await promptText('New branch', 'Branch name:')
    if (typed === null || !typed.trim()) return
    const name = typed.trim().replaceAll(' ', '-')
    const [ok, msg] = await g.createBranch(repoDir, name)
    if (!ok) {
      await warning('Create failed', msg)
      return
    }
    // Offer to switch to it.
    const reply = await messageBox({ title: 'Branch created', icon: 'question', buttons: YES_NO,
      html: `Branch <b>${escapeHtml(name)}</b> created.<br>Switch to it now?` })
    if (reply === 'Yes') {
      const [ok2, msg2] = await g.switchBranch(repoDir, name)
      if (!ok2) {
        await warning('Switch failed', msg2)
        return
      }
    }
    await refreshAfterBranchChange()
  }

  const onDelete = async () => {
    const name = combo
    if (!name) return
    const cur = await g.currentBranch(repoDir)
    if (name === cur) {
      await messageBox({ title: 'Cannot delete', icon: 'warning',
        html: 'Cannot delete the branch you are currently on.<br>Switch to another branch first.' })
      return
    }
    const reply = await messageBox({ title: 'Delete branch', icon: 'question', buttons: YES_CANCEL,
      html: `Permanently delete branch <b>${escapeHtml(name)}</b>?<br><br>`
        + "<span style='color:#666;'>The commits themselves are not deleted — they remain reachable "
        + 'from other branches. Only the branch pointer is removed.</span>' })
    if (reply !== 'Yes') return
    const [ok, msg] = await g.deleteBranch(repoDir, name)
    if (!ok) {
      await warning('Delete failed', msg)
      return
    }
    await refreshAfterBranchChange()
  }

  // _on_restore_clicked
  const onRestore = async () => {
    const c = commits[row]
    if (!c) return
    const confirm = await messageBox({ title: 'Restore this version', icon: 'question', buttons: YES_CANCEL,
      html: '<b>Roll the document back to this version?</b><br><br>'
        + `<code>${escapeHtml(c.short_oid)}</code> &middot; ${escapeHtml(c.timestamp)}<br>`
        + `<i>${escapeHtml(c.subject)}</i><br><br>`
        + "<span style='color:#666;'>Your current document state isn't lost — every saved version is "
        + 'still in the history. The next Ctrl+S will record the restored contents as a new commit on top.'
        + '</span>' })
    if (confirm !== 'Yes') return
    const [ok, msg] = await g.restoreToCommit(repoDir, c.oid)
    if (!ok) {
      await critical('Restore failed', msg)
      return
    }
    await onReload()
    await messageBox({ title: 'Restored', icon: 'information',
      html: `The document was rolled back to commit <code>${escapeHtml(c.short_oid)}</code>.<br><br>`
        + "Save (Ctrl+S) when you're ready — that records the restored contents as a new commit on top." })
  }

  // QSplitter between the table and the details.
  const startSplit = (e: ReactPointerEvent) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = leftW
    const move = (ev: PointerEvent) => setLeftW(Math.max(120, w0 + ev.clientX - x0))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Up / Down move the selection, as in a QTableWidget.
  const onTableKey = (e: KeyboardEvent) => {
    if (!commits.length) return
    let next = row
    if (e.key === 'ArrowDown') next = Math.min(commits.length - 1, row + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, row - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = commits.length - 1
    else return
    e.preventDefault()
    setRow(next)
    tableRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  const rails = maxRails(commits)
  const graphW = graphColWidth(commits)
  const title = fileStem || basename(repoDir)
  return (
    <div ref={rootRef} className='dlg dlg-history' role='dialog' aria-label={`Version history — ${title}`}>
      <div className='dlg-title hist-titlebar'>
        <span>Version history — {title}</span>
        <button type='button' className='hist-x' aria-label='Close' onClick={() => close(null)}>×</button>
      </div>
      <div className='dlg-body hist-body-wrap'>
        <div className='hist-branchbar'>
          <span className='hist-branch-label'>Branch: <code>{current ?? '(detached)'}</code></span>
          <select className='hist-combo' title='Switch to another branch' value={combo}
            onChange={e => setCombo(e.target.value)}>
            {branches.map(b => (
              <option key={b.name} value={b.name}>{b.name + (b.current ? '  ← current' : '')}</option>
            ))}
          </select>
          <button type='button' title='Switch working tree to the selected branch' onClick={() => void onSwitch()}>Switch</button>
          <button type='button' title='Create a new branch from HEAD' onClick={() => void onCreate()}>+ New branch</button>
          <button type='button' title='Delete the selected branch' onClick={() => void onDelete()}>Delete</button>
        </div>
        <div className='hist-split'>
          <div ref={tableRef} className='hist-table' style={{ width: leftW }} tabIndex={0} onKeyDown={onTableKey}>
            <table>
              <colgroup>
                <col style={{ width: graphW }} /><col style={{ width: 140 }} /><col /><col style={{ width: 90 }} />
              </colgroup>
              <thead><tr><th>Graph</th><th>When</th><th>Message</th><th>Author</th></tr></thead>
              <tbody>
                {commits.map((c, i) => (
                  <tr key={c.oid} data-row={i} className={i === row ? 'selected' : i % 2 ? 'alt' : ''}
                    onMouseDown={() => setRow(i)}>
                    <td className='hist-graph-cell'><GraphCell commits={commits} row={i} rails={rails} /></td>
                    <td className='hist-when' title={c.timestamp}>{c.timestamp}</td>
                    <td title={c.subject}>{c.subject}</td>
                    <td title={c.author}>{c.author}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='hist-handle' onPointerDown={startSplit} />
          <div className='hist-right'>
            <Meta c={commits[row] ?? null} />
            <Diff text={diff} />
            <button type='button' className='hist-restore'
              title={'Roll the document files back to the selected commit. Your current state stays in '
                + 'the history — restoring just creates a new commit on top with the older contents.'}
              onClick={() => void onRestore()}>↩ Restore this version</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// HistoryDialog(repo_dir, parent, file_stem).exec(). `onReload` is the
// parent window's _reload_current, run after a restore or a branch change.
export function openHistoryDialog(repoDir: string, fileStem: string | null,
  onReload: () => Promise<void> | void): Promise<void> {
  return openDialog<void>(close => (
    <HistoryDialog repoDir={repoDir} fileStem={fileStem} onReload={onReload} close={close} />
  )).then(() => undefined)
}
