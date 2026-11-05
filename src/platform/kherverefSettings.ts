// KherveRef's own QSettings("kherve", "KherveRef"), read the way Qt stores
// it on each system, for kherveref_link.known_libraries (recent_libraries,
// last_library):
//   macOS    the com.kherve.KherveRef preferences domain (`defaults export`,
//            which also sees values cfprefsd has not written to disk yet)
//   Windows  HKEY_CURRENT_USER\Software\kherve\KherveRef (`reg query`)
//   Linux    ~/.config/kherve/KherveRef.conf (Qt's INI format)
// Only reads; nothing here ever writes KherveRef's settings.
import { DOMParser } from '@xmldom/xmldom'
import { join } from '../core/paths'
import { platform } from './index'

export type SettingsValues = Record<string, unknown>

type El = { nodeType: number; nodeName: string; textContent: string | null; childNodes: ArrayLike<El> }

const elements = (n: El): El[] => Array.from(n.childNodes).filter(c => c.nodeType === 1)

function plistValue(n: El): unknown {
  switch (n.nodeName) {
    case 'string': return n.textContent ?? ''
    case 'integer': return parseInt(n.textContent ?? '0', 10)
    case 'real': return parseFloat(n.textContent ?? '0')
    case 'true': return true
    case 'false': return false
    case 'array': return elements(n).map(plistValue)
    case 'dict': return plistDict(n)
    default: return n.textContent ?? ''
  }
}

function plistDict(n: El): SettingsValues {
  const out: SettingsValues = {}
  const kids = elements(n)
  for (let i = 0; i + 1 < kids.length; i += 2) {
    if (kids[i].nodeName === 'key') out[kids[i].textContent ?? ''] = plistValue(kids[i + 1])
  }
  return out
}

// An XML property list (the top-level <dict>).
export function parsePlist(xml: string): SettingsValues {
  const doc = new DOMParser().parseFromString(xml, 'text/xml') as unknown as El
  const plist = elements(doc).find(e => e.nodeName === 'plist')
  const dict = plist && elements(plist).find(e => e.nodeName === 'dict')
  return dict ? plistDict(dict) : {}
}

// `reg query <key>` output: "    name    REG_SZ    value" lines. Qt keeps a
// QStringList as REG_MULTI_SZ, which reg prints joined by "\0".
export function parseRegQuery(out: string): SettingsValues {
  const res: SettingsValues = {}
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(line) ?? /^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)\s*$/.exec(line)
    if (!m) continue
    const [, name, type, value = ''] = m
    if (type === 'REG_MULTI_SZ') res[name] = value ? value.split('\\0').filter(v => v !== '') : []
    else if (type === 'REG_DWORD' || type === 'REG_QWORD') res[name] = parseInt(value, 16)
    else res[name] = value
  }
  return res
}

// One QSettings INI value: "a, b" is a string list, quotes keep commas.
function iniValue(raw: string): unknown {
  const items: string[] = []
  let cur = ''
  let quoted = false
  // The item had quotes: its text is exactly what they held.
  let itemQuoted = false
  const end = () => { items.push(itemQuoted ? cur : cur.trim()); cur = ''; itemQuoted = false }
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '"') {
      if (!quoted && !itemQuoted) cur = ''
      quoted = !quoted
      itemQuoted = true
      continue
    }
    if (ch === '\\' && i + 1 < raw.length) {
      const nx = raw[++i]
      cur += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx
      continue
    }
    if (ch === ',' && !quoted) { end(); continue }
    if (!quoted && itemQuoted) continue
    cur += ch
  }
  end()
  if (items.length > 1) return items
  const v = items[0]
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === '@Invalid()') return null
  return v
}

export function parseIni(text: string): SettingsValues {
  const res: SettingsValues = {}
  let section = 'General'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sec = /^\[(.*)\]$/.exec(line)
    if (sec) { section = sec[1]; continue }
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim().replace(/%2F/gi, '/')
    const name = section === 'General' ? key : `${section}/${key}`
    res[name] = iniValue(line.slice(eq + 1).trim())
  }
  return res
}

function os(): 'mac' | 'windows' | 'linux' {
  const p = typeof navigator !== 'undefined' ? (navigator.platform || navigator.userAgent) : ''
  return /Mac/i.test(p) ? 'mac' : /Win/i.test(p) ? 'windows' : 'linux'
}

// {} when KherveRef has never run here (or in the browser preview).
export async function readKherverefSettings(): Promise<SettingsValues> {
  const p = platform()
  if (p.kind !== 'tauri') return {}
  try {
    const sys = os()
    if (sys === 'mac') {
      const r = await p.run('/usr/bin/defaults', ['export', 'com.kherve.KherveRef', '-'], { timeoutSecs: 10 })
      return r.code === 0 ? parsePlist(r.stdout) : {}
    }
    if (sys === 'windows') {
      const r = await p.run('reg', ['query', 'HKCU\\Software\\kherve\\KherveRef'], { timeoutSecs: 10 })
      return r.code === 0 ? parseRegQuery(r.stdout) : {}
    }
    const file = join(await p.homeDir(), '.config/kherve/KherveRef.conf')
    return (await p.exists(file)) ? parseIni(await p.readText(file)) : {}
  } catch {
    return {}
  }
}
