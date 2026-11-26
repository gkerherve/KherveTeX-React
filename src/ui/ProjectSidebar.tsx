// The "Documents" dock (QDockWidget holding _ProjectSidebar in
// khervedoc/mainwindow.py): the open document, or a project's documents
// with tick boxes, page ranges and chapter numbers; Auto page numbers;
// drag to reorder; Up / Down / Remove; Add (new or existing file, or a
// file dropped on the panel); Compile; and the right-click menu. Its logic
// is SidebarModel in src/app/project.ts; this is only the widgets.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent, type MouseEvent, type PointerEvent } from 'react'
import { session, setDocumentsDock, useDocumentsDock } from '../app/actions/project'
import { SECTION_TYPE_LABELS, type SidebarModel } from '../app/project'
import { platform } from '../platform'
import { openDialog, type Close } from './dialogs/dialogHost'
import { promptText } from './dialogs/EditorDialogs'
import { api as chaptersApi } from '../app/actions/chapters'
import type { ChapterRow } from './dialogs/ChaptersDialog'
import './ProjectSidebar.css'

const ROW_MIME = 'application/x-khervetex-row'

// QInputDialog.getInt
function promptInt(title: string, label: string, value: number, min: number, max: number): Promise<number | null> {
  return openDialog<number>((close: Close<number>) => {
    function Prompt() {
      const [v, setV] = useState(String(value))
      const ok = () => {
        const n = Math.trunc(Number(v))
        close(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value)
      }
      return (
        <form className='dlg' role='dialog' aria-label={title}
          onSubmit={e => { e.preventDefault(); ok() }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
          <div className='dlg-title'>{title}</div>
          <div className='dlg-body'>
            <label className='dlg-label'>{label}</label>
            <input autoFocus type='number' min={min} max={max} step={1} value={v}
              onChange={e => setV(e.target.value)} />
          </div>
          <div className='dlg-buttons'>
            <button type='submit'>OK</button>
            <button type='button' onClick={() => close(null)}>Cancel</button>
          </div>
        </form>
      )
    }
    return <Prompt />
  })
}

// A single document's chapters (one .ktex holding a thesis): each with
// Compile and Show, dragged into order, clicked to go to it.
function ChapterList() {
  const [rows, setRows] = useState<ChapterRow[]>(() => chaptersApi.list())
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  useEffect(() => chaptersApi.subscribe(() => setRows(chaptersApi.list())), [])
  if (!rows.length) {
    return <div className='ps-empty'>No chapters yet. <b>+ Add</b> a document: it becomes a chapter of this file
      (each top-level heading is one).</div>
  }
  return (
    <div className='ps-list ps-chapters' role='listbox'>
      {rows.map((r, i) => (
        <div key={r.key} className={`ps-row ps-ch${r.compiled ? '' : ' grey'}${over === i && drag !== null && drag !== i ? ' drop-above' : ''}`}
          draggable onDragStart={e => { setDrag(i); e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={e => { e.preventDefault(); setOver(i) }} onDragLeave={() => setOver(o => (o === i ? null : o))}
          onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain') || drag); if (from !== i) chaptersApi.move(from, i); setDrag(null); setOver(null) }}
          onDragEnd={() => { setDrag(null); setOver(null) }}
          onClick={() => chaptersApi.goTo(i)} title={`${r.title} - ${r.summary}`}>
          <input type='checkbox' checked={r.compiled} title='Compile (in the PDF preview)'
            onClick={e => e.stopPropagation()} onChange={e => chaptersApi.setCompiled(i, e.target.checked)} />
          <button type='button' className={`ps-eye${r.shown ? '' : ' off'}`} title={r.shown ? 'Shown - click to fold it away while you write' : 'Folded - click to show it'}
            onClick={e => { e.stopPropagation(); chaptersApi.setShown(r.key, !r.shown) }}>{r.shown ? '👁' : '–'}</button>
          <span className='ps-text'>{i + 1}. {r.title}</span>
        </div>
      ))}
    </div>
  )
}

async function pickExisting(sb: SidebarModel): Promise<void> {
  const paths = await platform().openFileDialog({
    title: 'Add existing documents', multiple: true,
    filters: [
      { name: 'kTeX documents', extensions: ['ktex', 'ktexz', 'json', 'kdocz', 'tex'] },
      { name: 'All files', extensions: [] },
    ],
  })
  if (paths?.length) await sb.signals.addExistingRequested?.(paths)
}

interface MenuItem {
  text: string
  run?: () => void | Promise<void>
  disabled?: boolean
  checked?: boolean
  items?: MenuEntry[]
}
type MenuEntry = MenuItem | '-'

function MenuList({ entries, x, y, onClose }: { entries: MenuEntry[]; x: number; y: number; onClose: () => void }) {
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // Keep it on screen (QMenu flips up or left at the edges).
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect()
    setPos({
      left: Math.max(2, x + r.width > innerWidth - 2 ? innerWidth - r.width - 2 : x),
      top: Math.max(2, y + r.height > innerHeight - 2 ? innerHeight - r.height - 2 : y),
    })
  }, [x, y])
  const checks = entries.some(e => e !== '-' && e.checked !== undefined)
  return (
    <div ref={ref} className='qmenu' role='menu' onMouseDown={e => e.stopPropagation()}
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? 'visible' : 'hidden' }}>
      {entries.map((e, i) => e === '-'
        ? <div key={i} className='qmenu-sep' />
        : (
          <div key={i} role='menuitem'
            className={'qmenu-item' + (e.disabled ? ' disabled' : '') + (sub?.index === i ? ' open' : '')}
            onMouseEnter={ev => {
              const r = ev.currentTarget.getBoundingClientRect()
              setSub(e.items ? { index: i, x: r.right - 2, y: r.top - 3 } : null)
            }}
            onClick={() => {
              if (e.items || e.disabled) return
              onClose()
              void e.run?.()
            }}>
            {checks && <span className='qmenu-icon'>{e.checked ? '✓' : ''}</span>}
            <span className='qmenu-text'>{e.text}</span>
            {e.items && <span className='qmenu-arrow'>{'▸'}</span>}
          </div>
        ))}
      {sub && entries[sub.index] !== '-' && (
        <MenuList entries={(entries[sub.index] as MenuItem).items!} x={sub.x} y={sub.y} onClose={onClose} />
      )}
    </div>
  )
}

function PopupMenu({ entries, x, y, onClose }: { entries: MenuEntry[]; x: number; y: number; onClose: () => void }) {
  useEffect(() => {
    const down = () => onClose()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])
  return <MenuList entries={entries} x={x} y={y} onClose={onClose} />
}

// _on_context_menu
function contextEntries(sb: SidebarModel, idx: number | null): MenuEntry[] {
  const add: MenuItem = { text: 'Add document…', run: () => sb.signals.addChapterRequested?.() }
  if (idx === null || sb.project === null) return [add]
  const ch = sb.chapters[idx]
  const ctype = ch.chapter_type ?? 'chapter'
  return [
    add,
    { text: 'Move up', disabled: !(idx > 0), run: () => sb.move(idx, -1) },
    { text: 'Move down', disabled: !(idx < sb.chapters.length - 1), run: () => sb.move(idx, +1) },
    '-',
    {
      text: 'Rename label…',
      run: async () => sb.rename(idx, await promptText('Rename chapter', 'Label:', ch.label)),
    },
    {
      text: 'Section type',
      items: SECTION_TYPE_LABELS.map(([key, label]) => ({
        text: label, checked: ctype === key, run: () => sb.setSectionType(idx, key),
      })),
    },
    {
      text: 'Set chapter number…',
      run: async () => {
        const cur = ch.chapter_number !== null ? ch.chapter_number : 0
        const val = await promptInt('Set chapter number', 'Chapter number (0 = auto from position):', cur, 0, 999)
        if (val !== null) sb.setChapterNumber(idx, val)
      },
    },
    {
      text: 'Set start page…',
      run: async () => {
        const val = await promptInt('Set start page', 'Page number (0 = continue from previous):',
          ch.start_page || 0, 0, 9999)
        if (val !== null) sb.setStartPage(idx, val)
      },
    },
    {
      text: 'Page numbering',
      items: [
        { text: 'Arabic (1, 2, 3…)', checked: ch.numbering === 'arabic', run: () => sb.setNumbering(idx, 'arabic') },
        { text: 'Roman (i, ii, iii…)', checked: ch.numbering === 'roman', run: () => sb.setNumbering(idx, 'roman') },
      ],
    },
    '-',
    { text: 'Remove from project…', run: () => sb.signals.removeRequested?.(idx) },
  ]
}

export function ProjectSidebar() {
  const visible = useDocumentsDock()
  const sb = session.sidebar
  useSyncExternalStore(sb.subscribe, sb.version)
  const [width, setWidth] = useState(150)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  if (!visible) return null
  const proj = sb.projectControlsVisible

  const dragSplitter = (e: PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const start = width
    const move = (ev: globalThis.PointerEvent) => setWidth(Math.min(600, Math.max(90, start + ev.clientX - startX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onContext = (e: MouseEvent, idx: number | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (idx !== null && sb.project !== null) sb.setCurrentRow(idx)
    setMenu({ x: e.clientX, y: e.clientY, entries: contextEntries(sb, idx) })
  }

  // InternalMove: a row dropped on the upper half of another goes above it.
  const rowDrop = (e: DragEvent, i: number) => {
    if (!e.dataTransfer.types.includes(ROW_MIME)) return
    e.preventDefault()
    setDropAt(null)
    const from = Number(e.dataTransfer.getData(ROW_MIME))
    const r = e.currentTarget.getBoundingClientRect()
    let to = e.clientY > r.top + r.height / 2 ? i + 1 : i
    const order = [...sb.chapters.keys()]
    order.splice(from, 1)
    if (to > from) to -= 1
    order.splice(to, 0, from)
    void sb.rowsMoved(order).then(() => sb.setCurrentRow(to))
  }

  return (
    <div className='documents-dock' style={{ width }}>
      <div className='dock-title'>
        <span>Documents</span>
        <button type='button' className='dock-close' title='Close' onClick={() => setDocumentsDock(false)}>
          {'✕'}
        </button>
      </div>
      <div className='ps-body'>
        {proj && <div className='ps-title'><b>{sb.titleText}</b></div>}
        {proj && <div className='ps-summary'>{sb.summaryText}</div>}
        {proj && (
          <label className='ps-auto' title={'Automatically compute each chapter\'s start page from the\n'
            + 'cumulative page counts of preceding chapters.\nPage counts update after every compilation.'}>
            <input type='checkbox' checked={sb.autoPage} onChange={e => void sb.onAutoPageToggled(e.target.checked)} />
            Auto page numbers
          </label>
        )}
        {!proj && <ChapterList />}
        {proj && <div className='ps-list' role='listbox' onContextMenu={e => onContext(e, null)}
          onClick={() => sb.setCurrentRow(-1)}>
          {sb.rows.map((r, i) => (
            <div key={i} role='option' aria-selected={sb.currentRow === i}
              className={'ps-row' + (sb.currentRow === i ? ' current' : '') + (r.grey ? ' grey' : '')
                + (r.bold ? ' bold' : '') + (dropAt === i ? ' drop-above' : '')
                + (dropAt === i + 1 && i === sb.rows.length - 1 ? ' drop-below' : '')}
              draggable={r.checkable}
              onDragStart={e => {
                e.dataTransfer.setData(ROW_MIME, String(i))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={e => {
                if (!e.dataTransfer.types.includes(ROW_MIME)) return
                e.preventDefault()
                const rc = e.currentTarget.getBoundingClientRect()
                setDropAt(e.clientY > rc.top + rc.height / 2 ? i + 1 : i)
              }}
              onDragLeave={() => setDropAt(null)}
              onDragEnd={() => setDropAt(null)}
              onDrop={e => rowDrop(e, i)}
              onClick={e => { e.stopPropagation(); if (r.checkable) sb.setCurrentRow(i) }}
              onDoubleClick={() => { if (r.checkable) void sb.doubleClick(i) }}
              onContextMenu={e => onContext(e, i)}>
              {r.checkable && (
                <input type='checkbox' checked={r.checked} onClick={e => e.stopPropagation()}
                  onChange={e => void sb.setChecked(i, e.target.checked)} />
              )}
              <span className='ps-text'>{r.text}</span>
            </div>
          ))}
        </div>}
        {proj && (
          <div className='ps-buttons'>
            <button type='button' title='Move selected chapter up' onClick={() => void sb.moveUp()}>{'▲ Up'}</button>
            <button type='button' title='Move selected chapter down' onClick={() => void sb.moveDown()}>{'▼ Down'}</button>
            <button type='button' title='Remove the selected document from the project (its file is kept on disk)'
              onClick={() => void sb.removeCurrent()}>{'✕ Remove'}</button>
          </div>
        )}
        <div className='ps-buttons'>
          <button type='button' className='ps-add'
            title='Add a document: a new chapter of this file, or another file copied in as one (everything stays inside this .ktex)'
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              const rc = e.currentTarget.getBoundingClientRect()
              setMenu({
                x: rc.left, y: rc.bottom, entries: [
                  // A single document: a chapter of this same file (the
                  // .ktex holds them all); a project: a document of its own.
                  { text: 'New document…', run: () => proj ? sb.signals.addChapterRequested?.()
                    : void promptText('Add document', 'Name of the new document (a chapter of this file):', `Chapter ${chaptersApi.list().length + 1}`)
                      .then(n => { if (n && n.trim()) chaptersApi.add(n.trim()) }) },
                  { text: 'Existing file…', run: () => proj ? pickExisting(sb) : void chaptersApi.addFile() },
                ],
              })
            }}>
            {'+ Add'} <span className='ps-caret'>{'▾'}</span>
          </button>
          {proj && (
            <button type='button' onClick={() => void sb.signals.compileRequested?.()}>{'▶ Compile'}</button>
          )}
        </div>
      </div>
      <div className='ps-splitter' onPointerDown={dragSplitter} />
      {menu && <PopupMenu entries={menu.entries} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}
