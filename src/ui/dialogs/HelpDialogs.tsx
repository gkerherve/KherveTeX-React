// Help ▸ User guide, Keyboard shortcuts and About KherveTeX:
// MainWindow._show_help_guide (a QTabWidget of QTextBrowser pages, 680 x
// 560), _show_shortcuts (a rich-text QMessageBox) and _about (680 x 760:
// the app icon beside its name and version over a QTextBrowser).
import { useState, type MouseEvent, type ReactNode } from 'react'
import { platform } from '../../platform'
import { messageBox } from '../../platform/MessageBox'
import { Icon } from '../icons'
import { Mnemonic } from '../Menu'
import { openDialog } from './dialogHost'
import { HELP_PAGES, SHORTCUT_ROWS } from './helpGuide'
import './helpDialogs.css'

// QTextBrowser.setOpenExternalLinks(True): a link opens in the browser.
function openLinks(e: MouseEvent): void {
  const a = (e.target as Element).closest('a')
  const href = a?.getAttribute('href')
  if (!href) return
  e.preventDefault()
  void platform().openUrl(href).catch(() => {})
}

function Browser({ html }: { html: string }) {
  return <div className='help-browser' onClick={openLinks} dangerouslySetInnerHTML={{ __html: html }} />
}

function Frame({ title, className, children, onClose }: {
  title: string, className: string, children: ReactNode, onClose: () => void
}) {
  return (
    <div className={`dlg ${className}`} role='dialog' aria-modal='true' aria-label={title}>
      <div className='dlg-title help-titlebar'>
        <span>{title}</span>
        <button type='button' className='help-x' aria-label='Close' onClick={onClose}>✕</button>
      </div>
      {children}
    </div>
  )
}

function UserGuide({ close }: { close: () => void }) {
  const [tab, setTab] = useState(0)
  return (
    <Frame title='KherveTeX User Guide' className='dlg-help' onClose={close}>
      <div className='help-tabs' role='tablist'>
        {HELP_PAGES.map(([t], i) => (
          <button key={t} type='button' role='tab' aria-selected={i === tab} autoFocus={i === 0}
            className={'help-tab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}>
            <Mnemonic text={t} show={false} />
          </button>
        ))}
      </div>
      <Browser html={HELP_PAGES[tab][1]} />
    </Frame>
  )
}

export function showHelpGuide(): Promise<void> {
  return openDialog<void>(close => <UserGuide close={() => close(null)} />).then(() => undefined)
}

// _show_shortcuts: the QMessageBox's rich text.
export function shortcutsHtml(): string {
  let html = '<h3>Keyboard shortcuts</h3>'
  for (const [group, shortcuts] of SHORTCUT_ROWS) {
    html += `<h4 style='margin-bottom:2px; color:#1a3a8c;'>${group}</h4>`
    html += "<table cellpadding='3' style='margin-left:8px;'>"
    for (const [key, desc] of shortcuts) {
      html += "<tr><td><code style='background:#eef3ff; padding:2px 6px; border-radius:3px;'>"
        + `${key.replace(/&/g, '&amp;')}</code></td>`
        + `<td style='padding-left:12px;'>${desc.replace(/&/g, '&amp;')}</td></tr>`
    }
    html += '</table>'
  }
  return html
}

export async function showShortcuts(): Promise<void> {
  await messageBox({ title: 'Keyboard shortcuts', html: shortcutsHtml() })
}

export interface Library {
  name: string
  version: string
  role: string
  url: string
}

// The libraries table and the author note of _about, for this build's
// own stack (React and Tauri where the Python app lists PySide6 and Qt).
export function aboutHtml(libraries: Library[], runtime: string): string {
  const rows = libraries.map(({ name, version, role, url }) =>
    '<tr>'
    + "<td valign='top' style='padding:6px 14px 6px 0'>"
    + `<b>${name}</b><br>`
    + `<span style='color:#666;font-size:9pt'>${version}</span></td>`
    + `<td valign='top' style='padding:6px 0'>${role}<br>`
    + `<a href='${url}'>${url}</a></td>`
    + '</tr>').join('')
  const libTable = "<table cellpadding='0' cellspacing='0' style='border-collapse:collapse'>"
    + rows + '</table>'
  return '<h3>About the author</h3>'
    + '<p><b>Gwilherm Kerhervé</b> &nbsp;—&nbsp; '
    + 'Research Associate, Department of Materials, '
    + "<a href='https://www.imperial.ac.uk/materials/'>"
    + 'Imperial College London</a>.</p>'
    + '<p>Works on surface analysis and X-ray Photoelectron '
    + 'Spectroscopy (XPS), with a focus on materials for energy '
    + 'storage and catalysis. Maintains a small constellation of '
    + 'open-source tools for the XPS community, including '
    + "<a href='https://github.com/gkerherve/KherveFitting'>"
    + 'KherveFitting</a> (peak fitting for XPS spectra) and '
    + "<a href='https://github.com/gkerherve/spe_reader'>"
    + 'spe-xps-reader</a> (an open reader for PHI Instruments SPE '
    + 'binary files). KherveTeX grew out of the same workflow — '
    + 'writing papers and reports in LaTeX without leaving the '
    + 'WYSIWYG comfort zone of Word.</p>'
    + "<p><a href='mailto:g.kerherve@imperial.ac.uk'>"
    + 'g.kerherve@imperial.ac.uk</a></p>'
    + '<hr>'
    + '<h3>Libraries</h3>'
    + `<p style='color:#666;margin-bottom:6pt'>${runtime}</p>`
    + libTable
    + "<p style='color:#888;margin-top:14pt;font-size:9pt'>"
    + 'Every toolbar icon is drawn at runtime in code — no '
    + 'binary image assets ship with the app. PDF compilation runs '
    + 'in the background so the editor stays responsive.'
    + '</p>'
}

function About({ version, html, close }: { version: string, html: string, close: () => void }) {
  return (
    <Frame title='About kTeX' className='dlg-about' onClose={close}>
      <div className='about-header' onClick={openLinks}>
        <div className='about-logo'><Icon name='app_icon' size={96} /></div>
        <div className='about-heading'>
          <h2 style={{ margin: 0 }}>kTeX</h2>
          <p style={{ color: '#888', margin: '3px 0 0 0' }}>{version}</p>
          <p style={{ margin: '8px 0 0 0' }}>A WYSIWYG LaTeX document editor with built-in Git version history.</p>
          <p style={{ margin: '6px 0 0 0' }}>Press <b>F1</b> for the User Guide.</p>
          <p style={{ margin: '6px 0 0 0' }}>© 2026 Gwilherm Kerhervé · GPL-3.0<br />
            <a href='https://github.com/gkerherve/kherveTeX'>github.com/gkerherve/kherveTeX</a></p>
        </div>
      </div>
      <Browser html={html} />
      <div className='dlg-buttons'>
        <button type='button' autoFocus onClick={close}>Close</button>
      </div>
    </Frame>
  )
}

export function showAboutDialog(version: string, html: string): Promise<void> {
  return openDialog<void>(close => <About version={version} html={html} close={() => close(null)} />)
    .then(() => undefined)
}

