// The visual editor's dialogs, as editor.py and mainwindow.py build them:
// QInputDialog prompts, Insert table / Insert figure, Insert Caption,
// Document settings (DocSettingsDialog) and Manage LaTeX styles
// (style_dialog.py). Each resolves with its result, or null on Cancel.
import { useState, type ReactNode } from 'react'
import { TEMPLATE_CHOICES } from '../ribbonModel'
import type { DocMeta } from '../../core/model'
import { openDialog, type Close } from './dialogHost'
import './editorDialogs.css'

function Frame({ title, children, onOk, close, okText = 'OK', className = '', extra, cancelText = 'Cancel' }: {
  title: string; children: ReactNode; onOk: () => void; close: Close<never>; okText?: string; className?: string
  extra?: ReactNode; cancelText?: string
}) {
  return (
    <form className={`dlg ${className}`} role='dialog' aria-label={title}
      onSubmit={e => { e.preventDefault(); onOk() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(null) } }}>
      <div className='dlg-title'>{title}</div>
      <div className='dlg-body'>{children}</div>
      <div className='dlg-buttons'>
        {extra}
        <button type='submit'>{okText}</button>
        <button type='button' onClick={() => close(null)}>{cancelText}</button>
      </div>
    </form>
  )
}

// QInputDialog.getText / getMultiLineText.
export function promptText(title: string, label: string, value = '', opts: { multiline?: boolean; placeholder?: string } = {}): Promise<string | null> {
  return openDialog<string>(close => {
    function Prompt() {
      const [v, setV] = useState(value)
      return (
        <Frame title={title} close={close as Close<never>} onOk={() => close(v)}>
          <label className='dlg-label'>{label}</label>
          {opts.multiline
            ? <textarea autoFocus rows={8} value={v} placeholder={opts.placeholder}
              onChange={e => setV(e.target.value)} onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(v) }
              }} />
            : <input autoFocus value={v} placeholder={opts.placeholder} onChange={e => setV(e.target.value)} />}
        </Frame>
      )
    }
    return <Prompt />
  })
}

// QInputDialog.getItem.
export function promptItem(title: string, label: string, items: string[], current = 0): Promise<string | null> {
  return openDialog<string>(close => {
    function Pick() {
      const [v, setV] = useState(items[current] ?? items[0])
      return (
        <Frame title={title} close={close as Close<never>} onOk={() => close(v)}>
          <label className='dlg-label'>{label}</label>
          <select autoFocus value={v} onChange={e => setV(e.target.value)}>
            {items.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </Frame>
      )
    }
    return <Pick />
  })
}

export interface TableChoice { rows: number; cols: number; caption: string; label: string }

// _InsertTableDialog.
export function insertTableDialog(): Promise<TableChoice | null> {
  return openDialog<TableChoice>(close => {
    function Dlg() {
      const [rows, setRows] = useState(3)
      const [cols, setCols] = useState(3)
      const [caption, setCaption] = useState('')
      const [label, setLabel] = useState('')
      return (
        <Frame title='Insert table' close={close as Close<never>} className='dlg-ed'
          onOk={() => close({ rows, cols, caption: caption.trim(), label: label.trim() })}>
          <div className='dlg-form'>
            <label>Rows:</label>
            <input type='number' min={1} max={50} value={rows} autoFocus
              onChange={e => setRows(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
            <label>Columns:</label>
            <input type='number' min={1} max={20} value={cols}
              onChange={e => setCols(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
            <label>Caption:</label>
            <input value={caption} onChange={e => setCaption(e.target.value)} />
            <label>Label:</label>
            <input value={label} placeholder='e.g. tab:my-table' onChange={e => setLabel(e.target.value)} />
          </div>
        </Frame>
      )
    }
    return <Dlg />
  })
}

export interface FigureChoice { path: string; caption: string; label: string }

// _InsertFigureDialog (also re-editing an existing figure).
export function figureDialog(opts: {
  title?: string; path?: string; caption?: string; label?: string; pathReadonly?: boolean
  browse?: () => Promise<string | null>
} = {}): Promise<FigureChoice | null> {
  return openDialog<FigureChoice>(close => {
    function Dlg() {
      const [path, setPath] = useState(opts.path ?? '')
      const [caption, setCaption] = useState(opts.caption ?? '')
      const [label, setLabel] = useState(opts.label ?? '')
      return (
        <Frame title={opts.title ?? 'Insert figure'} close={close as Close<never>} className='dlg-ed dlg-figure'
          onOk={() => close({ path: path.trim(), caption: caption.trim(), label: label.trim() })}>
          <div className='dlg-form'>
            <label>Image path:</label>
            <div className='dlg-row'>
              <input value={path} readOnly={opts.pathReadonly} autoFocus onChange={e => setPath(e.target.value)} />
              {!opts.pathReadonly && opts.browse && (
                <button type='button' onClick={async () => {
                  const p = await opts.browse!()
                  if (p) setPath(p)
                }}>Browse...</button>
              )}
            </div>
            <label>Caption:</label>
            <input value={caption} onChange={e => setCaption(e.target.value)} />
            <label>Label:</label>
            <input value={label} placeholder='e.g. fig:my-figure' onChange={e => setLabel(e.target.value)} />
          </div>
        </Frame>
      )
    }
    return <Dlg />
  })
}

// MainWindow._insert_caption.
export function captionDialog(kind: 'Table' | 'Figure', caption: string, label: string): Promise<[string, string] | null> {
  return openDialog<[string, string]>(close => {
    function Dlg() {
      const [c, setC] = useState(caption)
      const [l, setL] = useState(label)
      return (
        <Frame title={caption ? 'Edit Caption' : 'Insert Caption'} close={close as Close<never>} className='dlg-ed'
          onOk={() => close([c.trim(), l.trim()])}>
          <div className='dlg-form'>
            <label>Caption</label>
            <input autoFocus style={{ minWidth: 360 }} value={c}
              placeholder={`${kind} 1: describe the ${kind.toLowerCase()}`} onChange={e => setC(e.target.value)} />
            <label>Label (for cross-references)</label>
            <input value={l} placeholder='Made from the caption when left empty' onChange={e => setL(e.target.value)} />
          </div>
        </Frame>
      )
    }
    return <Dlg />
  })
}

// mainwindow._FONT_FAMILIES: code, label.
export const FONT_FAMILIES: [string, string][] = [
  ['default', 'Computer Modern (LaTeX default)'],
  ['times', 'Times Roman'],
  ['palatino', 'Palatino'],
  ['charter', 'Charter'],
  ['libertine', 'Linux Libertine'],
  ['helvetica', 'Helvetica (sans-serif)'],
  ['courier', 'Courier (monospace)'],
]

const EDITOR_FONTS = ['Georgia', 'Latin Modern Roman', 'Times New Roman', 'Palatino', 'Helvetica', 'Arial',
  'Calibri', 'Cambria', 'Garamond', 'Courier New', 'Verdana']

// DocSettingsDialog: all document-level typesetting knobs in one tabbed
// dialog; result_meta carries forward what it does not expose.
export function docSettingsDialog(meta: DocMeta): Promise<DocMeta | null> {
  return openDialog<DocMeta>(close => {
    function Dlg() {
      const [tab, setTab] = useState(0)
      const [title, setTitle] = useState(meta.title)
      const [authorText, setAuthor] = useState(meta.author)
      const [docclass, setDocclass] = useState(meta.documentclass)
      const [visual, setVisual] = useState(meta.visual_font_family)
      const [family, setFamily] = useState(FONT_FAMILIES.some(([c]) => c === meta.body_font_family) ? meta.body_font_family : 'default')
      const [pt, setPt] = useState([10, 11, 12].includes(meta.body_font_pt) ? meta.body_font_pt : 12)
      const [spacing, setSpacing] = useState(meta.line_spacing)
      const [indent, setIndent] = useState(meta.paragraph_indent)
      const [m, setM] = useState([meta.margin_top_cm, meta.margin_bottom_cm, meta.margin_left_cm, meta.margin_right_cm])
      const [cols, setCols] = useState([1, 2, 3].includes(meta.column_count) ? meta.column_count : 1)
      const [pkgs, setPkgs] = useState(meta.packages.join('\n'))
      const ok = () => close({
        ...meta,
        title,
        author: authorText.trim(),
        documentclass: docclass.trim() || 'article',
        packages: pkgs.split('\n').map(p => p.trim()).filter(Boolean),
        margin_top_cm: m[0], margin_bottom_cm: m[1], margin_left_cm: m[2], margin_right_cm: m[3],
        body_font_pt: pt, body_font_family: family, visual_font_family: visual,
        line_spacing: spacing, paragraph_indent: indent, column_count: cols,
      })
      const margin = (i: number, label: string) => (
        <>
          <label>{label}</label>
          <span className='dlg-row'>
            <input type='number' min={0.5} max={6} step={0.1} value={m[i]}
              onChange={e => { const v = [...m]; v[i] = Math.max(0.5, Math.min(6, Math.round((Number(e.target.value) || 0.5) * 10) / 10)); setM(v) }} />
            <span>cm</span>
          </span>
        </>
      )
      const tabs = ['Metadata', 'Text', 'Layout', 'Packages']
      return (
        <Frame title='Document settings' close={close as Close<never>} onOk={ok} className='dlg-ed dlg-docsettings'>
          <div className='dlg-tabs' role='tablist'>
            {tabs.map((t, i) => (
              <button type='button' key={t} role='tab' aria-selected={tab === i}
                className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{t}</button>
            ))}
          </div>
          <div className='dlg-tabpage'>
            {tab === 0 && (
              <div className='dlg-form'>
                <label>Title:</label>
                <input value={title} onChange={e => setTitle(e.target.value)} />
                <label>Author:</label>
                <textarea rows={3} value={authorText} placeholder={'Name\nDepartment, Institution, City, Country'}
                  onChange={e => setAuthor(e.target.value)} />
                <label>Document class:</label>
                <span>
                  <input list='kt-doc-classes' value={docclass} onChange={e => setDocclass(e.target.value)} />
                  <datalist id='kt-doc-classes'>{TEMPLATE_CHOICES.map(c => <option key={c} value={c} />)}</datalist>
                </span>
              </div>
            )}
            {tab === 1 && (
              <div className='dlg-form'>
                <b className='dlg-span'>Visual editor</b>
                <label>Editor font:</label>
                <span>
                  <input list='kt-editor-fonts' value={visual} onChange={e => setVisual(e.target.value)} />
                  <datalist id='kt-editor-fonts'>{EDITOR_FONTS.map(f => <option key={f} value={f} />)}</datalist>
                </span>
                <span className='dlg-span' />
                <b className='dlg-span'>Compiled output (LaTeX / Typst)</b>
                <label>Output font:</label>
                <select value={family} onChange={e => setFamily(e.target.value)}>
                  {FONT_FAMILIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </select>
                <label>Body size:</label>
                <select value={pt} onChange={e => setPt(Number(e.target.value))}>
                  {[10, 11, 12].map(v => <option key={v} value={v}>{v} pt</option>)}
                </select>
                <label>Line spacing:</label>
                <input type='number' min={0.8} max={3} step={0.1} value={spacing}
                  onChange={e => setSpacing(Math.max(0.8, Math.min(3, Math.round((Number(e.target.value) || 1) * 100) / 100)))} />
                <span />
                <label className='dlg-check'>
                  <input type='checkbox' checked={indent} onChange={e => setIndent(e.target.checked)} />
                  Indent first line of every paragraph
                </label>
              </div>
            )}
            {tab === 2 && (
              <div className='dlg-form'>
                <b className='dlg-span'>Page margins</b>
                {margin(0, 'Top:')}{margin(1, 'Bottom:')}{margin(2, 'Left:')}{margin(3, 'Right:')}
                <b className='dlg-span'>Columns</b>
                <label>Whole document:</label>
                <select value={cols} onChange={e => setCols(Number(e.target.value))}>
                  <option value={1}>1 column (single)</option>
                  <option value={2}>2 columns</option>
                  <option value={3}>3 columns</option>
                </select>
                <i className='dlg-span'>For a multi-column region inside an otherwise one-column<br />
                  document, use Insert → Multi-column region instead.</i>
              </div>
            )}
            {tab === 3 && (
              <div className='dlg-packages'>
                <div>Extra LaTeX packages, one per line. geometry / setspace are added automatically by kTeX.</div>
                <textarea value={pkgs} placeholder='One package name per line' onChange={e => setPkgs(e.target.value)} />
              </div>
            )}
          </div>
        </Frame>
      )
    }
    return <Dlg />
  })
}

export interface StyleFile { name: string; ext: string; location: 'Bundled' | 'User'; path: string }

// StyleDialog (style_dialog.py): the bundled and user .cls / .sty / .bst
// files the compiler finds, with Import and Remove for user files.
export function styleDialog(env: {
  list: () => Promise<StyleFile[]>
  importFile: () => Promise<void>
  remove: (f: StyleFile) => Promise<void>
  openFolder: () => Promise<void>
}): Promise<null> {
  return openDialog<null>(close => {
    function Dlg() {
      const [files, setFiles] = useState<StyleFile[] | null>(null)
      const [sel, setSel] = useState(-1)
      const reload = () => { void env.list().then(f => { setFiles(f); setSel(-1) }) }
      if (files === null) reload()
      const cur = files && sel >= 0 ? files[sel] : null
      return (
        <div className='dlg dlg-ed dlg-styles' role='dialog' aria-label='Manage LaTeX styles'
          onKeyDown={e => { if (e.key === 'Escape') close(null) }}>
          <div className='dlg-title'>Manage LaTeX styles</div>
          <div className='dlg-body'>
            <div>
              <b>Bundled styles</b> ship with kTeX and are always available. <b>User styles</b> are
              files you imported — they live in a personal folder and survive app updates.<br /><br />
              Any <code>.cls</code> (document class), <code>.sty</code> (package) or <code>.bst</code>{' '}
              (bibliography style) file placed here is found automatically by the LaTeX compiler.
            </div>
            <div className='dlg-table'>
              <table>
                <thead><tr><th>File</th><th>Type</th><th>Location</th><th>Path</th></tr></thead>
                <tbody>
                  {(files ?? []).map((f, i) => (
                    <tr key={f.path} className={i === sel ? 'selected' : ''} onClick={() => setSel(i)}>
                      <td>{f.name}</td><td>{f.ext}</td><td>{f.location}</td><td>{f.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className='dlg-buttons'>
            <button type='button' onClick={() => { void env.importFile().then(reload) }}>Import style file…</button>
            <button type='button' disabled={!cur || cur.location !== 'User'}
              onClick={() => { if (cur) void env.remove(cur).then(reload) }}>Remove</button>
            <button type='button' onClick={() => { void env.openFolder() }}>Open user folder</button>
            <span style={{ flex: 1 }} />
            <button type='button' onClick={() => close(null)}>Close</button>
          </div>
        </div>
      )
    }
    return <Dlg />
  })
}

// References ▸ Cross-reference: the document's labels to pick from (or a
// label typed by hand), and the command — \ref, \eqref or \pageref.
export interface CrossRefChoice { label: string; kind: 'ref' | 'eqref' | 'pageref' }

// Modeless: Insert puts the reference at the caret and keeps the dialog
// open, so the user can type on and insert another; OK inserts and closes.
// An entry may have no label yet (a figure with a caption only): `key`
// tells the rows apart, and `resolve` gives it a label when it is picked.
export type CrossRefEntry = import('../../core/labels').LabelEntry & { key?: string }

export function askCrossRef(labels: CrossRefEntry[],
  onInsert?: (c: CrossRefChoice) => void,
  resolve: (e: CrossRefEntry) => string = e => e.label): Promise<CrossRefChoice | null> {
  const KIND_NAME = { section: 'Section', figure: 'Figure', table: 'Table', equation: 'Equation', other: 'Label' }
  const keyOf = (e: CrossRefEntry) => e.key ?? e.label
  return openDialog<CrossRefChoice>(close => {
    function Pick() {
      const [picked, setPicked] = useState(labels[0] ? keyOf(labels[0]) : '')
      const [typed, setTyped] = useState(labels[0]?.label ?? '')
      const entry = labels.find(l => keyOf(l) === picked)
      const [kind, setKind] = useState<CrossRefChoice['kind']>(entry?.kind === 'equation' ? 'eqref' : 'ref')
      const label = typed
      const setLabel = (l: string) => { setTyped(l); setPicked('') }
      const choose = (k: string) => {
        const e = labels.find(x => keyOf(x) === k)
        setPicked(k)
        setTyped(e?.label ?? '')
        if (e) setKind(e.kind === 'equation' ? 'eqref' : 'ref')
      }
      // The label to refer to: the picked item's (given one now when it
      // has none), else what was typed.
      const target = (): string => {
        const e = labels.find(x => keyOf(x) === picked)
        if (e) {
          const l = e.label || resolve(e)
          e.label = l
          setTyped(l)
          return l
        }
        return label.trim()
      }
      const ok = () => { const l = target(); if (l) close({ label: l, kind }) }
      return (
        <Frame title='Cross-reference' className='dlg-xref' close={close as Close<never>} onOk={ok}
          okText={onInsert ? 'Insert and close' : 'OK'} cancelText={onInsert ? 'Close' : 'Cancel'}
          extra={onInsert && <button type='button' onClick={() => { const l = target(); if (l) onInsert({ label: l, kind }) }}>Insert</button>}>
          <label className='dlg-label'>Refer to:</label>
          <div className='dlg-xref-list' role='listbox' aria-label='Labels'>
            {labels.length === 0 && <div className='dlg-xref-empty'>
              Nothing to refer to yet: no figure, table, numbered equation or heading. A label can be typed below.</div>}
            {labels.map(l => (
              <div key={keyOf(l)} role='option' aria-selected={keyOf(l) === picked}
                className={'dlg-xref-row' + (keyOf(l) === picked ? ' on' : '')}
                onClick={() => choose(keyOf(l))}
                onDoubleClick={() => { const lab = l.label || resolve(l); l.label = lab; close({ label: lab, kind: l.kind === 'equation' ? 'eqref' : 'ref' }) }}>
                <span className='dlg-xref-kind'>{KIND_NAME[l.kind]} {l.number}</span>
                <span className='dlg-xref-text'>{l.text}</span>
                <span className='dlg-xref-key'>{l.label || 'label made when chosen'}</span>
              </div>
            ))}
          </div>
          <div className='dlg-xref-form'>
            <label htmlFor='xref-label'>Label:</label>
            <input id='xref-label' value={label} onChange={e => setLabel(e.target.value)} spellCheck={false} />
            <label htmlFor='xref-kind'>Show:</label>
            <select id='xref-kind' value={kind} onChange={e => setKind(e.target.value as CrossRefChoice['kind'])}>
              <option value='ref'>Number — \ref (e.g. 2)</option>
              <option value='eqref'>Equation number — \eqref (e.g. (2))</option>
              <option value='pageref'>Page number — \pageref</option>
            </select>
          </div>
        </Frame>
      )
    }
    return <Pick />
  }, { modeless: !!onInsert })
}

// Insert ▸ Box ▸ Custom and the Box tab's Colour…: a name (when asked
// for) and a colour, in one dialog. The colour field is clicked by the
// user, never opened from code: WebKit (the macOS app) ignores a
// programmatic click on <input type=color> once an await has passed.
export const BOX_SWATCHES = ['#1F6FB5', '#2E7D32', '#00838F', '#6A1B9A', '#E65100', '#C62828',
  '#37474F', '#7B1FA2', '#00897B', '#F9A825', '#5D4037', '#1A237E']

export function boxStyleDialog(title: string, color: string, name: string | null): Promise<{ name: string; color: string } | null> {
  return openDialog<{ name: string; color: string }>(close => {
    function Dlg() {
      const [n, setN] = useState(name ?? '')
      const [c, setC] = useState(/^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : '#455A64')
      return (
        <Frame title={title} close={close as Close<never>} className='dlg-ed'
          onOk={() => close({ name: n.trim(), color: c.toUpperCase() })}>
          <div className='dlg-form'>
            {name !== null && <>
              <label>Name:</label>
              <input autoFocus value={n} placeholder='e.g. Exercise' onChange={e => setN(e.target.value)} />
            </>}
            <label>Colour:</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {BOX_SWATCHES.map(s => (
                <button key={s} type='button' title={s} aria-label={`Colour ${s}`} onClick={() => setC(s)}
                  style={{ width: 22, height: 22, padding: 0, background: s, cursor: 'pointer',
                    border: s === c ? '2px solid #000' : '1px solid #999', borderRadius: 3 }} />
              ))}
              <input type='color' aria-label='Other colour' title='Other colour…' value={c.toLowerCase()}
                onChange={e => setC(e.target.value.toUpperCase())} style={{ width: 34, height: 24, padding: 0 }} />
            </div>
            <label>Preview:</label>
            <div style={{ border: `1.5px solid ${c}`, borderRadius: 4, overflow: 'hidden', minWidth: 220 }}>
              <div style={{ background: c, color: '#fff', fontWeight: 600, padding: '2px 8px' }}>{n.trim() || 'Box'}</div>
              <div style={{ background: `${c}14`, padding: '4px 8px', fontSize: 12 }}>The text of the box.</div>
            </div>
          </div>
        </Frame>
      )
    }
    return <Dlg />
  })
}

// Insert ▸ Elements' Edit…: a few labelled fields; resolves with their values.
export interface FormField {
  key: string; label: string; value: string
  type?: 'text' | 'textarea' | 'code' | 'select' | 'number'
  options?: string[]; help?: string; rows?: number
}

export function formDialog(title: string, fields: FormField[], okText = 'OK'): Promise<Record<string, string> | null> {
  return openDialog<Record<string, string>>(close => {
    function Dlg() {
      const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map(f => [f.key, f.value])))
      const set = (k: string, x: string) => setV(o => ({ ...o, [k]: x }))
      return (
        <Frame title={title} close={close as Close<never>} className='dlg-ed' okText={okText} onOk={() => close(v)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 420 }}>
            {fields.map((f, i) => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <label className='dlg-label'>{f.label}</label>
                {f.type === 'textarea' || f.type === 'code'
                  ? <textarea autoFocus={i === 0} rows={f.rows ?? 8} value={v[f.key]} spellCheck={f.type !== 'code'}
                    style={f.type === 'code' ? { fontFamily: 'Menlo, Consolas, monospace', fontSize: 12, whiteSpace: 'pre', tabSize: 4 } : undefined}
                    onChange={e => set(f.key, e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); close(v) }
                      if (e.key === 'Tab' && f.type === 'code') {
                        e.preventDefault()
                        const t = e.currentTarget, a = t.selectionStart, b = t.selectionEnd
                        set(f.key, t.value.slice(0, a) + '    ' + t.value.slice(b))
                        requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 4 })
                      }
                    }} />
                  : f.type === 'select'
                    ? <select autoFocus={i === 0} value={v[f.key]} onChange={e => set(f.key, e.target.value)}>
                      {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    : <input autoFocus={i === 0} type={f.type === 'number' ? 'number' : 'text'} value={v[f.key]}
                      onChange={e => set(f.key, e.target.value)} />}
                {f.help && <div style={{ fontSize: 11, color: '#666' }}>{f.help}</div>}
              </div>
            ))}
          </div>
        </Frame>
      )
    }
    return <Dlg />
  })
}

// Insert ▸ Icon: a grid of icons; resolves with the chosen name.
export function iconPickerDialog(icons: [string, string, string][], current = ''): Promise<string | null> {
  return openDialog<string>(close => {
    function Dlg() {
      const [q, setQ] = useState('')
      const shown = icons.filter(([n, label]) => !q || (n + ' ' + label).toLowerCase().includes(q.toLowerCase()))
      return (
        <Frame title='Insert icon' close={close as Close<never>} className='dlg-ed' onOk={() => { if (shown[0]) close(shown[0][0]) }}>
          <input autoFocus placeholder='Search icons (phone, mail, star…)' value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 58px)', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
            {shown.map(([n, label, ch]) => (
              <button key={n} type='button' title={label} onClick={() => close(n)}
                style={{ height: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                  border: n === current ? '2px solid #2b579a' : '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', padding: 0 }}>
                <span style={{ fontSize: 20, lineHeight: 1 }}>{ch}</span>
                <span style={{ fontSize: 9, color: '#555', maxWidth: 54, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              </button>
            ))}
          </div>
        </Frame>
      )
    }
    return <Dlg />
  })
}
