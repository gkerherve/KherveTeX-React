// References straight from a running Zotero (port 23119 on this computer).
//
// 1. Better BibTeX's "Cite as you write" (CAYW): Zotero shows its own
//    picker; the references chosen come back as BibTeX.
// 2. Without Better BibTeX, Zotero 7's local API (Settings ▸ Advanced ▸
//    "Allow other applications on this computer to communicate with
//    Zotero"): the whole library as BibTeX.
// The HTTP GET is injected (platform localhostGet), so this has no DOM.

export const ZOTERO = 'http://127.0.0.1:23119'

export type LocalGet = (url: string, timeoutSecs: number) => Promise<{ status: number; body: string }>

export type ZoteroState =
  | 'better-bibtex'       // CAYW answers: pick in Zotero
  | 'local-api'           // Zotero 7's local API is on: whole library
  | 'running'             // Zotero runs, neither of the above
  | 'not-running'

async function tryGet(get: LocalGet, path: string, secs: number) {
  try {
    return await get(ZOTERO + path, secs)
  } catch {
    return null
  }
}

export async function zoteroState(get: LocalGet): Promise<ZoteroState> {
  const probe = await tryGet(get, '/better-bibtex/cayw?probe=true', 5)
  if (probe && probe.status === 200 && /ready/i.test(probe.body)) return 'better-bibtex'
  const api = await tryGet(get, '/api/users/0/items/top?limit=1&format=keys', 5)
  if (api && api.status === 200) return 'local-api'
  const ping = probe ?? await tryGet(get, '/connector/ping', 5)
  return ping ? 'running' : 'not-running'
}

// The references picked in Zotero's CAYW window, as BibTeX ('' when the
// picker was closed without a choice). Waits for the person to pick.
export async function zoteroPick(get: LocalGet): Promise<string> {
  for (const translator of ['betterbibtex', 'Better%20BibTeX']) {
    const r = await get(`${ZOTERO}/better-bibtex/cayw?format=translate&translator=${translator}`, 600)
    if (r.status === 200) return r.body.trim()
  }
  throw new Error('Better BibTeX did not export the references.')
}

// The whole library (top-level items) as BibTeX, a page at a time.
export async function zoteroLibrary(get: LocalGet, pageSize = 100, maxItems = 10000): Promise<string> {
  const parts: string[] = []
  for (let start = 0; start < maxItems; start += pageSize) {
    const r = await get(`${ZOTERO}/api/users/0/items/top?format=bibtex&limit=${pageSize}&start=${start}`, 60)
    if (r.status !== 200) throw new Error(`Zotero answered ${r.status}: ${r.body.slice(0, 200)}`)
    const text = r.body.trim()
    if (!text) break
    parts.push(text)
    if ((text.match(/^\s*@\w+\s*\{/gm) ?? []).length < pageSize) break
  }
  return parts.join('\n\n')
}

export const ZOTERO_HELP = 'kTeX takes references from Zotero in one of three ways:\n\n'
  + '• With the Better BibTeX add-on for Zotero (recommended): Zotero opens its own '
  + 'search window and you pick the references.\n'
  + '• With Zotero 7 alone: in Zotero, Settings ▸ Advanced, tick “Allow other applications '
  + 'on this computer to communicate with Zotero”; kTeX then takes the whole library.\n'
  + '• Without either: in Zotero, File ▸ Export Library (or select items, right-click ▸ '
  + 'Export Items) as BibTeX, then use Import file… here.'
