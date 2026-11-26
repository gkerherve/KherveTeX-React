// kTeX ▸ Preferences, as Word's Preferences window: a grid of panes in
// three sections (Authoring and Proofing Tools, Output and Sharing,
// Personal Settings), each opening in place with Back / Forward, Show All
// and a search box. Every choice applies at once, as in Word.
import { OPTIONAL_TABS } from '../officeRibbon.ts'
import { useEffect, useState, type ReactNode } from 'react'
import type { LayoutMode } from '../../app/store'
import { runAction } from '../../app/actions'
import { AUTOCORRECT_LIST, pref, prefsChanged, setPref, type TrackLook } from '../../app/prefs'
import { platform } from '../../platform/index'
import { setSetting, setting } from '../../platform/settings'
import { SHORT_NAME } from '../../version'
import { isCommandChecked, setCommandChecked } from '../commands'
import { Icon } from '../icons'
import { COMMANDS, CORNER_LEFT, orderedNames, RIBBON_TABS, shortText } from '../ribbonModel'
import { MODES } from '../WelcomeDialog'
import { openDialog } from './dialogHost'
import './prefs.css'

const USER_NAME_KEY = 'user/name'

interface Pane { key: string; title: string; icon: string; section: string; words: string }

const SECTIONS = ['Authoring and Proofing Tools', 'Output and Sharing', 'Personal Settings']
const PANES: Pane[] = [
  { key: 'general', title: 'General', icon: 'pref_general', section: SECTIONS[0],
    words: 'welcome page start compile automatically pdf follows text how you work side window visual page only' },
  { key: 'view', title: 'View', icon: 'page_view', section: SECTIONS[0],
    words: 'formatting marks paragraph latex source spelling underline fit page width ribbon group titles collapse' },
  { key: 'ribbon', title: 'Ribbon & Toolbar', icon: 'pref_ribbon', section: SECTIONS[0],
    words: 'customise ribbon tabs quick access toolbar buttons' },
  { key: 'edit', title: 'Edit', icon: 'pref_edit', section: SECTIONS[0],
    words: 'pictures insert paste width size' },
  { key: 'spelling', title: 'Spelling & Grammar', icon: 'spell_check', section: SECTIONS[0],
    words: 'check spelling as you type uppercase repeated words dictionary ignored' },
  { key: 'autocorrect', title: 'AutoCorrect', icon: 'pref_autocorrect', section: SECTIONS[0],
    words: 'replace text as you type arrows symbols dashes capitalise first letter sentences' },
  { key: 'access', title: 'Accessibility', icon: 'pref_access', section: SECTIONS[0],
    words: 'larger controls ribbon' },
  { key: 'save', title: 'Save', icon: 'file_save', section: SECTIONS[1],
    words: 'autosave automatically minutes version history snapshot' },
  { key: 'track', title: 'Track Changes', icon: 'track_changes', section: SECTIONS[1],
    words: 'mark-up insertions deletions underline strikethrough colour author' },
  { key: 'user', title: 'User Information', icon: 'pref_user', section: SECTIONS[2],
    words: 'name initials email affiliation author comments' },
  { key: 'files', title: 'File Locations', icon: 'pref_files', section: SECTIONS[2],
    words: 'styles folder templates cls sty bst' },
]

// ---------- controls ----------

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className='pf-group'><div className='pf-group-title'>{title}</div>{children}</div>
}
function Check({ label, value, onChange, note }: { label: string; value: boolean; onChange: (v: boolean) => void; note?: string }) {
  return (
    <label className='pf-check'><input type='checkbox' checked={value} onChange={e => onChange(e.target.checked)} />
      <span>{label}{note && <span className='pf-note'>{note}</span>}</span></label>
  )
}
function Choice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange: (v: T) => void
}) {
  return (
    <label className='pf-row'><span className='pf-row-label'>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value as T)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select></label>
  )
}
function Text({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className={'pf-field' + (wide ? ' wide' : '')}><span>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} /></label>
  )
}

// A command toggle (formatting marks, spelling...): the ribbon's state.
function useCommandToggle(id: string): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(() => isCommandChecked(id))
  return [on, v => { setOn(v); setCommandChecked(id, v); void runAction(id, v) }]
}
// A stored preference, applied at once.
function usePref<K extends Parameters<typeof pref>[0]>(k: K): [ReturnType<typeof pref<K>>, (v: ReturnType<typeof pref<K>>) => void] {
  const [v, setV] = useState(() => pref(k))
  return [v, nv => { setV(nv); setPref(k, nv) }]
}
function useSetting<T>(k: string, d: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => setting(k, d))
  return [v, nv => { setV(nv); setSetting(k, nv); prefsChanged() }]
}

// ---------- panes ----------

function General() {
  const [welcome, setWelcome] = useSetting('show_welcome', true)
  const [follow, setFollow] = useSetting('pdf_follows_text', true)
  const [auto, setAuto] = useCommandToggle('auto_compile')
  const [fast, setFast] = useCommandToggle('fast_latex')
  const [layout, setLayout] = useState<LayoutMode>(() => setting<LayoutMode>('layout_mode', 'side'))
  return (<>
    <Group title='Settings'>
      <Check label={`Show the Welcome page when ${SHORT_NAME} starts`} value={welcome} onChange={setWelcome} />
      <Check label='Compile the PDF automatically as you type' value={auto} onChange={setAuto} />
      <Check label='Fast LaTeX: one quick pass and a saved package setup (Export and Print stay full)' value={fast} onChange={setFast} />
      <Check label='The PDF follows the text as you scroll' value={follow} onChange={setFollow} />
    </Group>
    <Group title='How you work'>
      {MODES.map(([m, title, text]) => (
        <label key={m} className='pf-radio'>
          <input type='radio' name='pf-layout' checked={layout === m}
            onChange={() => { setLayout(m); void import('../../app/actions/file').then(f => f.applyLayoutMode(m)) }} />
          <span><b>{title}</b><span className='pf-note'>{text}</span></span>
        </label>
      ))}
    </Group>
  </>)
}

function View() {
  const [marks, setMarks] = useCommandToggle('show_marks')
  const [source, setSource] = useCommandToggle('show_latex_source')
  const [spell, setSpell] = useCommandToggle('spell_check')
  const [fit, setFitState] = useState(() => isCommandChecked('fit_page_width'))
  const setFit = (v: boolean) => { setFitState(v); setCommandChecked('fit_page_width', v); setSetting('fit_page_width', v) }
  const [titles, setTitles] = usePref('ribbon/group_titles')
  const [folded, setFolded] = useSetting('ribbon_folded', false)
  return (<>
    <Group title='Show in Document'>
      <Check label='Formatting marks (¶, spaces, page breaks)' value={marks} onChange={setMarks} />
      <Check label='LaTeX source of LaTeX written in the text' value={source} onChange={setSource} />
      <Check label='Spelling mistakes (red wavy underline)' value={spell} onChange={setSpell} />
    </Group>
    <Group title='Show Window Elements'>
      <Check label='Fit the page to the window width' value={fit} onChange={setFit} />
    </Group>
    <Group title='Ribbon'>
      <Check label='Show group titles' value={titles} onChange={setTitles} />
      <Check label='Collapse the ribbon (only the tab names; double-click a tab to toggle)' value={folded} onChange={setFolded} />
    </Group>
  </>)
}

function RibbonPane() {
  const [tab, setTab] = useState<'ribbon' | 'quick'>('ribbon')
  const [hidden, setHidden] = usePref('ribbon/hidden_tabs')
  const [shown, setShown] = usePref('ribbon/shown_tabs')
  const [quick, setQuick] = usePref('ribbon/hidden_quick')
  const [order, setOrder] = usePref('ribbon/order')
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const byName = new Map(RIBBON_TABS.filter(t => !t.context).map(t => [t.name, t]))
  const names = orderedNames([...byName.keys()], order)
  // Drop the dragged tab before the row it is dropped on.
  const dropOn = (moved: string | null, target: string) => {
    if (!moved || moved === target || !byName.has(moved)) return
    const rest = names.filter(n => n !== moved)
    rest.splice(rest.indexOf(target), 0, moved)
    setOrder(rest)
  }
  return (<>
    <div className='pf-tabs'>
      <button type='button' className={tab === 'ribbon' ? 'on' : ''} onClick={() => setTab('ribbon')}>Ribbon</button>
      <button type='button' className={tab === 'quick' ? 'on' : ''} onClick={() => setTab('quick')}>Quick Access Toolbar</button>
    </div>
    {tab === 'ribbon' ? (
      <Group title='Customise the Ribbon: Main Tabs'>
        <div className='pf-list'>
          {names.map(n => {
            const t = byName.get(n)!
            const extra = OPTIONAL_TABS.includes(n)
            const on = extra ? shown.includes(n) : !hidden.includes(n)
            return (
              <label key={n} className={`pf-list-row pf-drag${drag === n ? ' dragging' : ''}${over === n && drag && drag !== n ? ' drop-before' : ''}`}
                draggable onDragStart={e => { setDrag(n); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n) }}
                onDragOver={e => { e.preventDefault(); setOver(n) }} onDragLeave={() => setOver(o => (o === n ? null : o))}
                onDrop={e => { e.preventDefault(); dropOn(e.dataTransfer.getData('text/plain') || drag, n); setDrag(null); setOver(null) }}
                onDragEnd={() => { setDrag(null); setOver(null) }}>
                <span className='pf-grip' title='Drag to move this tab'>⋮⋮</span>
                <input type='checkbox' checked={on} disabled={n === 'Home'}
                  onChange={e => extra
                    ? setShown(e.target.checked ? [...shown, n] : shown.filter(x => x !== n))
                    : setHidden(e.target.checked ? hidden.filter(x => x !== n) : [...hidden, n])} />
                <span>{n}{extra ? <span className='pf-note'> (extra)</span> : null}</span><span className='pf-note'>{t.groups.map(g => g.label).join(', ')}</span>
              </label>
            )
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span className='pf-note'>Drag a tab by its ⋮⋮ to put it where you want.</span>
          <button type='button' disabled={!order.length} onClick={() => setOrder([])}>Reset order</button>
        </div>
        <div className='pf-note'>Home always stays. Tables, pictures, equations and theorems keep their own tabs when you are in one.</div>
      </Group>
    ) : (
      <Group title='Customise the Quick Access Toolbar'>
        <div className='pf-list'>
          {CORNER_LEFT.filter((id): id is string => !!id).map(id => (
            <label key={id} className='pf-list-row'>
              <input type='checkbox' checked={!quick.includes(id)}
                onChange={e => setQuick(e.target.checked ? quick.filter(x => x !== id) : [...quick, id])} />
              {COMMANDS[id]?.icon && <Icon name={COMMANDS[id].icon!} size={16} />}
              <span>{shortText(COMMANDS[id]?.text ?? id)}</span>
            </label>
          ))}
        </div>
      </Group>
    )}
  </>)
}

function Edit() {
  const [w, setW] = usePref('edit/picture_width')
  return (
    <Group title='Pictures'>
      <Choice label='Insert and paste pictures at:' value={w} onChange={setW}
        options={[['natural', 'Their own size'], ['1', 'Full text width'], ['0.8', '80% of the text width'], ['0.5', 'Half the text width']]} />
      <div className='pf-note'>A picture's size can still be changed afterwards (Picture tab ▸ Size).</div>
    </Group>
  )
}

function Spelling() {
  const [spell, setSpell] = useCommandToggle('spell_check')
  const [upper, setUpper] = usePref('spell/ignore_upper')
  const [rep, setRep] = usePref('spell/flag_repeated')
  return (
    <Group title='Spelling'>
      <Check label='Check spelling as you type' value={spell} onChange={setSpell} />
      <Check label='Ignore words in UPPERCASE' value={upper} onChange={setUpper} />
      <Check label='Flag repeated words ("the the")' value={rep} onChange={setRep} />
      <div className='pf-buttons'>
        <button type='button' onClick={() => { void runAction('spelling_list') }}>Spelling list…</button>
      </div>
    </Group>
  )
}

function AutoCorrect() {
  const [rep, setRep] = usePref('autocorrect/replace')
  const [cap, setCap] = usePref('autocorrect/capitalise')
  return (<>
    <Group title='AutoCorrect'>
      <Check label='Capitalise first letter of sentences' value={cap} onChange={setCap} />
      <Check label='Replace text as you type' value={rep} onChange={setRep} />
      <table className='pf-table'><thead><tr><th>Replace</th><th>With</th></tr></thead>
        <tbody>{AUTOCORRECT_LIST.map(([a, b]) => <tr key={a}><td><code>{a}</code></td><td>{b}</td></tr>)}</tbody></table>
      <div className='pf-note'>Never in raw LaTeX or code. Undo (Cmd+Z) right after takes the correction back.</div>
    </Group>
  </>)
}

function Access() {
  const [big, setBig] = usePref('access/larger_controls')
  return (
    <Group title='Larger Control Surfaces'>
      <div className='pf-note'>Makes the ribbon's buttons and text larger, for easier use.</div>
      <Check label='Use larger controls' value={big} onChange={setBig} />
    </Group>
  )
}

function Save() {
  const [min, setMin] = usePref('save/autosave_minutes')
  const [zipName, setZipName] = usePref('files/ktex_zip')
  return (<>
    <Group title='File name'>
      <Check label='Name new documents .ktex.zip' value={zipName} onChange={setZipName}
        note='A .ktex is an ordinary ZIP archive holding your LaTeX (document.tex), pictures and references. Named thesis.ktex.zip it says so: any computer opens it as a ZIP. kTeX opens and saves both names alike; documents you already have keep their names.' />
    </Group>
    <Group title='Save Options'>
      <Check label='AutoSave a saved document' value={min > 0} onChange={v => setMin(v ? 10 : 0)}
        note='Each save also keeps a version in the document’s history (History ▸ Versions).' />
      <label className='pf-row'><span className='pf-row-label'>Save every:</span>
        <input type='number' min={1} max={120} value={min || 10} disabled={min <= 0} style={{ width: 60 }}
          onChange={e => setMin(Math.max(1, Math.min(120, Number(e.target.value) || 10)))} /> minutes</label>
    </Group>
  </>)
}

function Track() {
  const [look, setLook] = usePref('track/look')
  const set = (p: Partial<TrackLook>) => setLook({ ...look, ...p })
  const colours: [string, string][] = [['author', 'By author'], ['#1a5fd0', 'Blue'], ['#c62828', 'Red'], ['#2e7d32', 'Green'],
    ['#6a1b9a', 'Violet'], ['#e65100', 'Orange'], ['#000000', 'Black']]
  const insStyle = { underline: { textDecoration: 'underline' }, double: { textDecoration: 'underline double' }, bold: { fontWeight: 700 },
    italic: { fontStyle: 'italic' }, colour: {} }[look.insert]
  const delStyle = look.delete === 'hidden' ? { display: 'none' } : { textDecoration: look.delete === 'double' ? 'line-through double' : 'line-through' }
  const col = look.colour === 'author' ? undefined : look.colour
  return (
    <Group title='Mark-up (on the page)'>
      <Choice label='Insertions:' value={look.insert} onChange={v => set({ insert: v })}
        options={[['underline', 'Underline'], ['double', 'Double underline'], ['bold', 'Bold'], ['italic', 'Italic'], ['colour', 'Colour only']]} />
      <Choice label='Deletions:' value={look.delete} onChange={v => set({ delete: v })}
        options={[['strike', 'Strikethrough'], ['double', 'Double strikethrough'], ['hidden', 'Hidden']]} />
      <Choice label='Colour:' value={look.colour} onChange={v => set({ colour: v })} options={colours} />
      <div className='pf-sample'>
        <span style={{ ...insStyle, color: col ?? '#1a5fd0' }}>New text</span>{' '}
        <span style={{ ...delStyle, color: col ?? '#c62828' }}>Old text</span>
      </div>
      <div className='pf-note'>The PDF keeps the changes package's mark-up (Review ▸ Markup Options).</div>
    </Group>
  )
}

function User() {
  const [name, setName] = useSetting(USER_NAME_KEY, '')
  const [ini, setIni] = usePref('user/initials')
  const [mail, setMail] = usePref('user/email')
  const [aff, setAff] = usePref('user/affiliation')
  const [auth, setAuth] = usePref('user/author_new_docs')
  return (
    <Group title='User Information'>
      <div className='pf-fields'>
        <Text label='Name' value={name} onChange={setName} wide />
        <Text label='Initials' value={ini} onChange={setIni} />
      </div>
      <div className='pf-note'>Your comments, reviews and tracked changes are signed with your name.</div>
      <div className='pf-fields'><Text label='Email' value={mail} onChange={setMail} wide /></div>
      <div className='pf-fields'><Text label='Affiliation (institution, department)' value={aff} onChange={setAff} wide /></div>
      <Check label='Use my name and affiliation as the author of new documents' value={auth} onChange={setAuth} />
    </Group>
  )
}

function Files() {
  const [dirs, setDirs] = useState<string[]>([])
  useEffect(() => { void platform().styleDirs().then(setDirs).catch(() => setDirs([])) }, [])
  const rows: [string, string][] = dirs.map((d, i): [string, string] => [i === 0 && dirs.length > 1 ? 'Your styles (.cls, .sty, .bst)' : 'Bundled styles', d])
  return (
    <Group title='File Locations'>
      <table className='pf-table pf-files'><thead><tr><th>File types</th><th>Locations</th><th /></tr></thead>
        <tbody>
          {rows.length ? rows.map(([t, d]) => (
            <tr key={d}><td>{t}</td><td title={d}>{d}</td>
              <td><button type='button' onClick={() => { void platform().openPath(d).catch(() => {}) }}>Open</button></td></tr>
          )) : <tr><td colSpan={3} className='pf-note'>The folders are shown in the desktop app.</td></tr>}
        </tbody></table>
      <div className='pf-buttons'><button type='button' onClick={() => { void runAction('manage_styles') }}>Manage styles…</button></div>
    </Group>
  )
}

const RENDER: Record<string, () => ReactNode> = {
  general: () => <General />, view: () => <View />, ribbon: () => <RibbonPane />, edit: () => <Edit />,
  spelling: () => <Spelling />, autocorrect: () => <AutoCorrect />, access: () => <Access />, save: () => <Save />,
  track: () => <Track />, user: () => <User />, files: () => <Files />,
}

// ---------- the window ----------

function Preferences({ close, start }: { close: () => void; start: string | null }) {
  const [hist, setHist] = useState<(string | null)[]>([start])
  const [at, setAt] = useState(0)
  const [q, setQ] = useState('')
  const cur = hist[at]
  const go = (k: string | null) => { const h = [...hist.slice(0, at + 1), k]; setHist(h); setAt(h.length - 1); setQ('') }
  const pane = PANES.find(p => p.key === cur)
  const ql = q.trim().toLowerCase()
  const match = (p: Pane) => !ql || (p.title + ' ' + p.words).toLowerCase().includes(ql)
  return (
    <div className='dlg pf-window' role='dialog' aria-label={`${SHORT_NAME} Preferences`}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
      <div className='pf-bar'>
        <div className='pf-nav'>
          <button type='button' aria-label='Back' disabled={at === 0} onClick={() => setAt(at - 1)}>‹</button>
          <button type='button' aria-label='Forward' disabled={at >= hist.length - 1} onClick={() => setAt(at + 1)}>›</button>
        </div>
        <button type='button' className='pf-all' aria-label='Show All' title='Show All' onClick={() => go(null)}>
          <svg width='16' height='16' viewBox='0 0 16 16' aria-hidden='true'>{[0, 1, 2].flatMap(r => [0, 1, 2].map(c =>
            <rect key={`${r}${c}`} x={1 + c * 5} y={1 + r * 5} width='3.4' height='3.4' rx='0.8' fill='currentColor' />))}</svg>
        </button>
        <div className='pf-title'>{pane ? pane.title : `${SHORT_NAME} Preferences`}</div>
        <input className='pf-search' type='search' placeholder='Search' value={q} onChange={e => setQ(e.target.value)} aria-label='Search preferences' />
        <button type='button' className='pf-close' aria-label='Close' onClick={close}>×</button>
      </div>
      {pane && !ql ? (
        <div className='pf-pane'>{RENDER[pane.key]()}</div>
      ) : (
        <div className='pf-grid'>
          {SECTIONS.map(s => {
            const ps = PANES.filter(p => p.section === s)
            return (
              <div key={s} className='pf-section'>
                <div className='pf-section-title'>{s}</div>
                <div className='pf-icons'>
                  {ps.map(p => (
                    <button key={p.key} type='button' className={'pf-icon' + (ql && !match(p) ? ' dim' : ql ? ' hit' : '')}
                      onClick={() => go(p.key)}>
                      <Icon name={p.icon} size={32} /><span>{p.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function preferencesDialog(start: string | null = null): Promise<void> {
  return openDialog<void>(close => <Preferences start={start} close={() => close(null)} />).then(() => undefined)
}
