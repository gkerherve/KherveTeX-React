// Help ▸ User guide, Keyboard shortcuts and About KherveTeX:
// MainWindow._show_help_guide (a QTabWidget of QTextBrowser pages, 680 x
// 560), _show_shortcuts (a rich-text QMessageBox) and _about (680 x 760:
// the app icon beside its name and version over a QTextBrowser).
import { type MouseEvent, type ReactNode } from 'react'
import { platform } from '../../platform'
import { messageBox } from '../../platform/MessageBox'
import { COFFEE_URL, FEEDBACK_EMAIL } from '../../version'
import { Icon } from '../icons'
import { openDialog } from './dialogHost'
import { SHORTCUT_ROWS } from './helpGuide'
import { UserGuide } from './guide/UserGuide'
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
  const tools: [string, string][] = [
    ['KherveFitting', 'XPS peak fitting'], ['KherveDB', 'the NIST XPS binding-energy database'],
    ['KherveNoise', 'spectrum denoising'], ['KherveSheet', 'a spreadsheet for scientific data'],
    ['KhervePlot', 'publication-quality plots'], ['KherveMol', 'molecules and crystal structures in 2D and 3D'],
    ['KhervePaint', 'scientific drawings'], ['KherveRef', 'references for LaTeX and Word'],
    ['KherveSlide', 'Beamer slides'], ['KhervePDF', 'PDF reading and annotation'],
    ['kCAD', 'parametric CAD'], ['KherveLAB', 'lab instrument booking'], ['KherveNote', 'talk notes to LaTeX'],
  ]
  const promo = "<div style='background:#eef4fb;border:1px solid #c9d9ee;border-radius:8px;padding:10px 14px;margin-bottom:12px'>"
    + "<h3 style='margin:0 0 6px 0'>Part of KherveTools — free software for scientists</h3>"
    + '<p style=\'margin:0 0 6px 0\'>kTeX is one of a family of free tools made by a scientist for scientists: '
    + 'to analyse data, plot it, draw it, cite it and write it up — from the measurement to the paper. '
    + 'They work together (kTeX cites from KherveRef, draws with KhervePaint) and each is free to download '
    + 'for Windows, Mac and Linux.</p>'
    + "<p style='margin:0 0 6px 0'>" + tools.map(([n, w]) => `<b>${n}</b> (${w})`).join(', ') + '.</p>'
    + "<p style='margin:0'>All the tools, with downloads and guides: "
    + "<a href='https://khervetools.com'><b>khervetools.com</b></a></p></div>"
  return promo + '<h3>About the author</h3>'
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
    + 'binary files). kTeX grew out of the same workflow — '
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
          <p style={{ margin: '6px 0 0 0' }}>kTeX is in <b>beta</b>: some parts are still new. Feedback is very welcome —<br />
            <a href={`mailto:${FEEDBACK_EMAIL}?subject=kTeX%20feedback`}>{FEEDBACK_EMAIL}</a></p>
          <p style={{ margin: '6px 0 0 0' }}>More free tools for scientists at{' '}
            <a href='https://khervetools.com'><b>khervetools.com</b></a></p>
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


// Help ▸ Buy me a coffee (KherveFitting's Help menu and About box): the QR
// code to scan with a phone, and the link.
function Coffee({ close }: { close: () => void }) {
  return (
    <Frame title='Buy me a coffee' className='dlg-coffee' onClose={close}>
      <div className='coffee-body'>
        <p>kTeX is free. If it helps you, you can buy me a coffee — thank you!</p>
        <img src={`${import.meta.env.BASE_URL}buymeacoffee_qr.png`} width={200} height={200}
          alt='QR code for buymeacoffee.com/gkerherve' />
        <p>Scan the code with your phone, or open
          {' '}<a href={COFFEE_URL} onClick={(e) => { e.preventDefault(); void platform().openUrl(COFFEE_URL).catch(() => {}) }}>
            buymeacoffee.com/gkerherve</a>.</p>
      </div>
      <div className='dlg-buttons'>
        <button type='button' autoFocus onClick={close}>Close</button>
      </div>
    </Frame>
  )
}

export function showCoffeeDialog(): Promise<void> {
  return openDialog<void>(close => <Coffee close={() => close(null)} />).then(() => undefined)
}
