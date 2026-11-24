// Word's "Search" box: every ribbon tool (and every item of its menus)
// with where it lives, "Insert ▸ Illustrations ▸ Shapes".
import { COMMANDS, RIBBON_TABS, shortText, type MenuEntry, type RibbonItem } from './ribbonModel.ts'
import { TIPS } from './tooltips.ts'
import { MORE_TIPS } from './tooltipsMore.ts'

// What a search also matches: the tool's long hover help, so "spectrum"
// finds Data Plot and "inequality" the Number Line.
const helpOf = (id: string, tipKey?: string) => {
  const t = TIPS[tipKey ?? `act_${id}`] ?? MORE_TIPS[tipKey ?? `act_${id}`] ?? TIPS[`act_${id}`] ?? MORE_TIPS[`act_${id}`]
  return t ? ` ${t.title} ${t.what}` : ''
}

export interface ToolHit {
  label: string
  // Tab ▸ Group (▸ the button whose menu holds it).
  where: string
  tab: string
  group: string
  // What runs: a command id, a menu command, or nothing (a widget: show it).
  command?: string
  icon?: string
  iconArg?: string
  keywords: string
}

const WIDGET_NAMES: Record<string, string> = {
  fontfamily: 'Font', fontsize: 'Font Size', styles: 'Styles', classes: 'Document type',
  numbered: 'Numbered headings', stylesets: 'Style sets (Document Formatting)',
}
const FIELD_NAMES: Record<string, string> = {
  left_cm: 'Indent Left', right_cm: 'Indent Right', before_pt: 'Spacing Before', after_pt: 'Spacing After',
}

let cache: ToolHit[] | null = null
const CONTEXT_TABS = new Set(RIBBON_TABS.filter(t => t.context).map(t => t.name))

export function toolIndex(): ToolHit[] {
  if (cache) return cache
  const out: ToolHit[] = []
  const seen = new Set<string>()
  const add = (h: ToolHit) => {
    const k = `${h.label}|${h.where}`
    if (seen.has(k) || !h.label) return
    seen.add(k)
    out.push(h)
  }
  const menu = (entries: MenuEntry[] | undefined, where: string, tab: string, group: string) => {
    for (const e of entries ?? []) {
      if (typeof e === 'string') {
        if (e === '-') continue
        const c = COMMANDS[e]
        if (c) add({ label: shortText(c.text), where, tab, group, command: c.id, icon: c.icon, iconArg: c.iconArg, keywords: `${c.tooltip ?? ''}${helpOf(c.id, c.tip)}` })
        continue
      }
      if (e.disabled) continue
      const label = shortText(e.text || '')
      if (e.items) menu(e.items, `${where} ▸ ${label}`, tab, group)
      else if (label && e.command) add({ label, where, tab, group, command: e.command, icon: e.icon, iconArg: e.iconArg, keywords: `${e.detail ?? ''}${helpOf(e.command)}` })
    }
  }
  // The buttons every element's tab shares (Edit, Colour, Move, Delete,
  // Close) would answer every search: they are left out.
  const SHARED = /^(w_|block_up$|block_down$)/
  for (const t of RIBBON_TABS) {
    for (const g of t.groups) {
      const where = `${t.name} ▸ ${g.label}`
      const items: RibbonItem[] = [...(g.large ?? []), ...(g.rows ?? []).flat()]
      for (const it of items) {
        if (typeof it !== 'string') {
          const label = it.widget === 'parafield' ? FIELD_NAMES[it.field] : WIDGET_NAMES[it.widget]
          add({ label, where, tab: t.name, group: g.label, keywords: '' })
          continue
        }
        const c = COMMANDS[it]
        if (!c || (t.context && SHARED.test(c.id))) continue
        const label = shortText(c.text)
        add({
          label, where, tab: t.name, group: g.label, command: c.menu && c.popup === 'instant' ? undefined : c.id,
          icon: c.icon, iconArg: c.iconArg, keywords: `${c.tooltip ?? ''}${helpOf(c.id, c.tip)}`,
        })
        if (c.menu) menu(c.menu, `${where} ▸ ${label}`, t.name, g.label)
      }
    }
  }
  cache = out
  return out
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// The best matches first: a label that starts with the query, then one
// with a word that does, then anywhere, then the location or tooltip.
export function searchTools(query: string, limit = 12): ToolHit[] {
  const q = norm(query.trim())
  if (!q) return []
  const words = q.split(/\s+/)
  const scored: [number, ToolHit][] = []
  for (const h of toolIndex()) {
    const label = norm(h.label), where = norm(h.where), kw = norm(h.keywords)
    if (!words.every(w => label.includes(w) || where.includes(w) || kw.includes(w))) continue
    let s = 4
    if (label.startsWith(q)) s = 0
    else if (label.split(/[\s(/-]+/).some(w => w.startsWith(words[0]))) s = 1
    else if (label.includes(q)) s = 2
    else if (where.includes(q)) s = 3
    // A contextual tab's tools after the ribbon's own.
    if (CONTEXT_TABS.has(h.tab)) s += 5
    scored.push([s * 1000 + label.length, h])
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, h]) => h)
}
