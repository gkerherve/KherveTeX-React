// The Help menu's own dialogs: User guide (F1), Keyboard shortcuts and
// About KherveTeX — MainWindow._show_help_guide, _show_shortcuts, _about.
import { version as reactVersion } from 'react'
import pkg from '../../../package.json'
import { isTauri, platform } from '../../platform'
import { aboutHtml, showAboutDialog, showHelpGuide, showShortcuts, type Library } from '../../ui/dialogs/HelpDialogs'
import { registerActions } from '../actions'

// The version a dependency was built against, as package.json pins it.
function declared(name: string): string {
  const deps = pkg.dependencies as Record<string, string>
  return (deps[name] ?? '').replace(/^[\^~]/, '') || '(unknown)'
}

// __init__.version_string(): "v<major>.<minor>" (no git build tag here).
export function versionString(): string {
  return 'v' + pkg.version.split('.').slice(0, 2).join('.')
}

async function tauriVersion(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const { getTauriVersion } = await import('@tauri-apps/api/app')
    return await getTauriVersion()
  } catch {
    return null
  }
}

export async function aboutLibraries(): Promise<[Library[], string]> {
  const tec = await platform().findTectonic().then(e => (e ? 'installed' : 'not found'), () => 'not found')
  const tauri = await tauriVersion()
  const pdfjsVersion = await import('pdfjs-dist').then(m => m.version, () => '(unknown)')
  const libraries: Library[] = [
    { name: 'React', version: reactVersion,
      role: 'The entire GUI (ribbon, menus, the formatted-text page, dialogs).',
      url: 'https://react.dev/' },
    { name: 'Tauri', version: tauri ?? 'not running (browser preview)',
      role: 'The desktop shell: the window, file access, running the engines and git.',
      url: 'https://tauri.app/' },
    { name: 'ProseMirror', version: declared('prosemirror-view'),
      role: 'The editing core of the Visual tab: the document, selections and undo.',
      url: 'https://prosemirror.net/' },
    { name: 'PDF.js', version: pdfjsVersion,
      role: 'Renders the live PDF preview pane and reads PDFs for the PDF importer.',
      url: 'https://mozilla.github.io/pdf.js/' },
    { name: 'git2-rs (libgit2)', version: 'built in',
      role: 'Drives the auto-commit on Save, the history viewer and the push to GitHub.',
      url: 'https://github.com/rust-lang/git2-rs' },
    { name: 'fflate', version: declared('fflate'),
      role: 'Reads and writes the .ktex, .docx and Overleaf .zip archives.',
      url: 'https://github.com/101arrowz/fflate' },
    { name: 'tectonic', version: tec,
      role: 'External LaTeX engine. Auto-downloads packages on first '
        + 'compile; produces the PDF shown in the preview pane and '
        + 'exported by File → Export → PDF.',
      url: 'https://tectonic-typesetting.github.io/' },
  ]
  const runtime = `React ${reactVersion}` + (tauri ? ` · Tauri ${tauri}` : '')
  return [libraries, runtime]
}

async function about(): Promise<void> {
  const [libraries, runtime] = await aboutLibraries()
  await showAboutDialog(versionString(), aboutHtml(libraries, runtime))
}

registerActions({
  help_guide: () => showHelpGuide(),
  shortcuts: () => showShortcuts(),
  about: () => about(),
})
