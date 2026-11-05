// The main window's pure parts: QAction shortcuts (Ctrl→⌘ on macOS),
// the menus rebuilt at run time, the templates folder and JSON of
// _save_as_template, the Window menu label, the bundle label, the saved
// theme, the Help texts and KherveRef's QSettings formats.
import { describe, expect, it } from 'vitest'

// Loaded by path at run time: the tests' tsconfig (nodenext) does not
// type-check the app's bundler-style imports.
const load = (p: string) => import(/* @vite-ignore */ p)
const sc = await load('../src/ui/globalShortcuts.ts')
const lm = await load('../src/ui/liveMenus.ts')
const tpl = await load('../src/app/actions/templates.ts')
const win = await load('../src/app/actions/window.ts')
const theme = await load('../src/app/actions/theme.ts')
const help = await load('../src/ui/dialogs/HelpDialogs.tsx')
const krs = await load('../src/platform/kherverefSettings.ts')
const model = await load('../src/core/model.ts')

const key = (over: Record<string, unknown>) => ({
  key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over,
})

describe('global shortcuts', () => {
  it('parses Qt key sequences', () => {
    expect(sc.parseShortcut('Ctrl+Shift+P')).toEqual({ ctrl: true, shift: true, alt: false, key: 'P' })
    expect(sc.parseShortcut('F1')).toEqual({ ctrl: false, shift: false, alt: false, key: 'F1' })
  })

  it('maps Ctrl to Cmd on macOS', () => {
    expect(sc.commandForKey(key({ key: 's', code: 'KeyS', metaKey: true }), true)).toBe('save')
    expect(sc.commandForKey(key({ key: 's', code: 'KeyS', ctrlKey: true }), true)).toBe(null)
    expect(sc.commandForKey(key({ key: 's', code: 'KeyS', ctrlKey: true }), false)).toBe('save')
    expect(sc.commandForKey(key({ key: 's', code: 'KeyS', metaKey: true }), false)).toBe(null)
  })

  it('tells Shift and Alt variants apart', () => {
    expect(sc.commandForKey(key({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }), false)).toBe('save_as')
    expect(sc.commandForKey(key({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }), false)).toBe('print_preview')
    expect(sc.commandForKey(key({ key: 'p', code: 'KeyP', ctrlKey: true }), false)).toBe('print')
    expect(sc.commandForKey(key({ key: 'v', code: 'KeyV', ctrlKey: true, altKey: true }), false)).toBe('paste_special')
    expect(sc.commandForKey(key({ key: 'F1', code: 'F1' }), false)).toBe('help_guide')
    expect(sc.commandForKey(key({ key: '1', code: 'Digit1', ctrlKey: true }), false)).toBe('view_formatted')
    expect(sc.commandForKey(key({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true }), false)).toBe('prev_comment')
    expect(sc.commandForKey(key({ key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true }), false)).toBe('show_marks')
    expect(sc.commandForKey(key({ key: 'x', code: 'KeyX' }), false)).toBe(null)
  })
})

describe('live menus', () => {
  const items = [
    'new',
    { text: 'New from &Template', items: [{ text: '&My templates', items: [{ text: '(no saved templates)', disabled: true }] }] },
    { text: 'Open &Recent', items: [{ text: '(no recent files)', disabled: true }] },
    'download_bundle',
  ]
  const live = {
    recent: [{ text: '/a/b.ktex' }], templates: [{ text: 'Mine', items: [] }], windows: [], bundleText: 'X',
  }

  it('puts the recent files, templates and bundle label in', () => {
    const out = lm.withLiveMenus('&File', items, live)
    expect(out[0]).toBe('new')
    expect(out[1].items[0].items).toEqual([{ text: 'Mine', items: [] }])
    expect(out[2].items).toEqual([{ text: '/a/b.ktex' }])
    expect(out[3]).toEqual({ text: 'X', command: 'download_bundle' })
  })

  it('replaces the whole Window menu', () => {
    const w = [{ text: 'Untitled', checkable: true, checked: true }]
    expect(lm.withLiveMenus('&Window', [{ text: 'old' }], { ...live, windows: w })).toEqual(w)
  })

  it('feeds the Examples tab gallery', async () => {
    const { COMMANDS } = await load('../src/ui/ribbonModel.ts')
    lm.setLiveMenus({ templates: [{ text: 'Thesis', items: [] }] })
    expect(COMMANDS.gallery_mine.menu).toEqual([{ text: 'Thesis', items: [] }])
  })
})

describe('templates', () => {
  it('live where QSettings("kherveDOC", "kherveDOC") keeps its file', () => {
    expect(tpl.templatesDirFor('mac', '/Users/me')).toBe('/Users/me/Library/Preferences/templates')
    expect(tpl.templatesDirFor('linux', '/home/me')).toBe('/home/me/.config/kherveDOC/templates')
    expect(tpl.templatesDirFor('windows', 'D:\\Users\\me')).toBe('D:\\HKEY_CURRENT_USER\\Software\\kherveDOC\\templates')
  })

  it('write JSON as json.dumps(indent=2) with ensure_ascii', () => {
    const doc = model.document([model.paragraph([model.text('Café — ½ 😀\u007f')])])
    const out = tpl.templateJson(doc)
    expect(out).toContain('"Caf\\u00e9 \\u2014 \\u00bd \\ud83d\\ude00\\u007f"')
    expect(/[^\n -~]/.test(out)).toBe(false)
    expect(model.toJson(model.fromJson(out))).toBe(model.toJson(doc))
  })
})

describe('windows', () => {
  it('carry what to open in their URL', () => {
    expect(win.windowRequest('')).toBe(null)
    expect(win.windowRequest('?win=new')).toEqual({ kind: 'new' })
    const q = win.windowQuery({ kind: 'open', path: '/a b/c&d.ktex' })
    expect(win.windowRequest(q)).toEqual({ kind: 'open', path: '/a b/c&d.ktex' })
    expect(win.windowRequest(win.windowQuery({ kind: 'template', path: '/t/x.json' })))
      .toEqual({ kind: 'template', path: '/t/x.json' })
  })

  it('list the document name of each title', () => {
    expect(win.windowMenuLabel('KherveTeX v0.9 — paper.ktex [dev]', 0)).toBe('paper.ktex [dev]')
    expect(win.windowMenuLabel('', 2)).toBe('Window 3')
  })

  it('label the bundle action with the cache size', () => {
    expect(win.bundleLabel(0)).toBe('&Download offline bundle\u2026')
    expect(win.bundleLabel(412.6)).toBe('&Download offline bundle  \u2714 (413 MB cached)')
  })
})

describe('theme', () => {
  const settings = (v: Record<string, unknown>) => <T>(k: string, f: T): T => (k in v ? v[k] as T : f)
  it('is Light or Dark as last chosen', () => {
    expect(theme.savedTheme(settings({}))).toBe('Light')
    expect(theme.savedTheme(settings({ theme_name: 'Dark' }))).toBe('Dark')
    // A preset from before there were only these two.
    expect(theme.savedTheme(settings({ theme_name: 'Solarized', theme_dark: true }))).toBe('Dark')
    expect(theme.savedTheme(settings({ theme_name: 'Sepia', theme_dark: false }))).toBe('Light')
  })
})

describe('help', () => {
  it('lists the shortcuts of _show_shortcuts', () => {
    const html = help.shortcutsHtml()
    expect(html.startsWith('<h3>Keyboard shortcuts</h3>')).toBe(true)
    expect(html).toContain("<h4 style='margin-bottom:2px; color:#1a3a8c;'>File</h4>")
    expect(html).toContain('Find &amp; Replace')
  })

  it('builds the About libraries table', () => {
    const html = help.aboutHtml([{ name: 'React', version: '19', role: 'GUI', url: 'https://react.dev/' }], 'React 19')
    expect(html).toContain("<b>React</b><br><span style='color:#666;font-size:9pt'>19</span>")
    expect(html).toContain("<a href='https://react.dev/'>https://react.dev/</a>")
    expect(html).toContain("<p style='color:#666;margin-bottom:6pt'>React 19</p>")
  })
})

describe("KherveRef's QSettings", () => {
  it('reads the macOS preferences plist', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>last_library</key><string>/Users/me/REF Library</string>
  <key>recent_libraries</key><array><string>/Users/me/REF Library</string><string>/x</string></array>
  <key>n</key><integer>3</integer><key>b</key><true/>
</dict></plist>`
    expect(krs.parsePlist(xml)).toEqual({
      last_library: '/Users/me/REF Library', recent_libraries: ['/Users/me/REF Library', '/x'], n: 3, b: true,
    })
  })

  it('reads the Windows registry key', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\kherve\\KherveRef\r\n'
      + '    last_library    REG_SZ    C:\\Refs\\Lib\r\n'
      + '    recent_libraries    REG_MULTI_SZ    C:\\Refs\\Lib\\0D:\\Other\r\n'
      + '    empty    REG_SZ\r\n'
    expect(krs.parseRegQuery(out)).toEqual({
      last_library: 'C:\\Refs\\Lib', recent_libraries: ['C:\\Refs\\Lib', 'D:\\Other'], empty: '',
    })
  })

  it('reads the Linux INI file', () => {
    const ini = '[General]\nlast_library=/home/me/Lib\nrecent_libraries=/home/me/Lib, "/a, b"\nflag=true\n'
    expect(krs.parseIni(ini)).toEqual({
      last_library: '/home/me/Lib', recent_libraries: ['/home/me/Lib', '/a, b'], flag: true,
    })
  })
})
