// KherveTeX's Word-style ribbon (khervedoc/ribbon.py): flat text tabs,
// labelled groups of big 32 px buttons and rows of small 18 px buttons,
// three small rows as tall as one big button. Its contents come from
// ribbonModel.ts.
import { runAction } from '../app/actions'
import { setSetting, setting } from '../platform/settings'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CommandState } from './commands'
import { useRibbonWidgets } from '../editor/ribbonState'
import { Icon } from './icons'
import { isBetaClass } from './pageBeta'
import { Popup } from './Menu'
import { classTip } from './classInfo'
import {
  bigLabel, COMMANDS, CORNER_LABELLED, CORNER_LEFT, CORNER_RIGHT, FONT_SIZES,
  GALLERY_INLINE, PARAGRAPH_STYLES, RIBBON_TABS, shortText, TEMPLATE_CHOICES,
  type Command, type ContextKind, type MenuEntry, type RibbonGroup, type RibbonItem,
} from './ribbonModel'
import { lookupTip, useTipProps, type TipContent } from './Tooltip'
import { FEEDBACK_EMAIL, SHORT_NAME } from '../version'
import './ribbon.css'

const TILE_W = 70
const TILE_H = 40

function tipFor(c: Command): TipContent {
  const rich = lookupTip(c.tip ?? `act_${c.id}`)
  if (rich) return { rich, shortcut: c.shortcut }
  return { plain: c.tooltip ?? shortText(c.text) }
}

interface OpenMenu {
  owner: string
  rect: DOMRect
  entries?: MenuEntry[]
  iconSize?: number
  kind?: 'classGrid'
}

interface Ctx {
  cmd: CommandState
  menu: OpenMenu | null
  openMenu: (m: OpenMenu | null) => void
  docClass: string
  fontSize: string
  setFontSize: (v: string) => void
  styleLevel: number
  setStyleLevel: (lv: number) => void
}

function Chevron({ className = '' }: { className?: string }) {
  return (
    <svg className={'rb-chevron ' + className} width='7' height='4'
      viewBox='0 0 7 4' aria-hidden='true'>
      <path d='M0 0 H7 L3.5 4 Z' fill='currentColor' />
    </svg>
  )
}

function iconOf(c: Command, ctx: Ctx, size: number) {
  if (!c.icon) return null
  const arg = c.id === 'doc_class' ? ctx.docClass : c.iconArg
  return <Icon name={c.icon} arg={arg} size={size} width={c.iconW} height={c.iconH} />
}

function menuSize(c: Command): number {
  if (c.id === 'size' || c.id === 'orientation' || c.id === 'columns') return 28
  if (c.id.startsWith('gallery_')) return 26
  return 16
}

function BigButton({ c, ctx }: { c: Command, ctx: Ctx }) {
  const tip = useTipProps(tipFor(c))
  const text = c.id === 'doc_class' ? ctx.docClass : shortText(c.text)
  const [l1, l2] = bigLabel(text)
  const on = c.checkable && ctx.cmd.isChecked(c.id)
  const isOpen = ctx.menu?.owner === c.id
  const open = (el: HTMLElement) => ctx.openMenu(isOpen ? null : {
    owner: c.id, rect: el.getBoundingClientRect(), entries: c.menu,
    iconSize: menuSize(c), kind: c.menuKind,
  })
  const label = (
    <span className='rb-label'>{l1}<br />{l2 || ' '}</span>
  )
  if (c.popup === 'split') {
    return (
      <div className={'rb-split' + (isOpen ? ' open' : '')} data-menu-owner {...tip}>
        <button type='button' className={'rb-btn rb-big' + (on ? ' on' : '')}
          onClick={() => ctx.cmd.trigger(c.id)}>
          <span className='rb-icon32'>{iconOf(c, ctx, 32)}</span>{label}
        </button>
        <button type='button' className='rb-btn rb-split-arrow' aria-label={`${text} options`}
          onClick={e => open(e.currentTarget.parentElement!)}><Chevron /></button>
      </div>
    )
  }
  if (c.popup === 'instant') {
    return (
      <button type='button' data-menu-owner {...tip}
        className={'rb-btn rb-big' + (isOpen ? ' on' : '')}
        onClick={e => open(e.currentTarget)}>
        <span className='rb-icon32'>{iconOf(c, ctx, 32)}</span>{label}
        <Chevron className='rb-chevron-under' />
      </button>
    )
  }
  return (
    <button type='button' {...tip} className={'rb-btn rb-big' + (on ? ' on' : '')}
      aria-pressed={c.checkable ? on : undefined}
      onClick={() => ctx.cmd.trigger(c.id)}>
      <span className='rb-icon32'>{iconOf(c, ctx, 32)}</span>{label}
    </button>
  )
}

function SmallButton({ c, ctx, text }: { c: Command, ctx: Ctx, text: boolean }) {
  const tip = useTipProps(tipFor(c))
  const on = c.checkable && ctx.cmd.isChecked(c.id)
  // A small button with a menu, as Word's Bullets, Numbering, Shading:
  // the icon does the last choice (split) or opens the menu (instant), the
  // arrow beside it opens the menu.
  if (c.menu && c.popup) {
    const isOpen = ctx.menu?.owner === c.id
    const open = (el: HTMLElement) => ctx.openMenu(isOpen ? null : {
      owner: c.id, rect: el.getBoundingClientRect(), entries: c.menu, iconSize: menuSize(c), kind: c.menuKind,
    })
    return (
      <div className={'rb-split rb-split-small' + (isOpen ? ' open' : '')} data-menu-owner {...tip}>
        <button type='button' className={'rb-btn rb-small' + (text ? ' rb-text' : '') + (on ? ' on' : '')} aria-label={shortText(c.text)}
          onClick={e => (c.popup === 'split' ? ctx.cmd.trigger(c.id) : open(e.currentTarget.parentElement!))}>
          {c.icon && <Icon name={c.icon} arg={c.iconArg} size={18} />}
          {text && <span>{shortText(c.text)}</span>}
        </button>
        <button type='button' className='rb-btn rb-split-arrow-small' aria-label={`${shortText(c.text)} options`}
          onClick={e => open(e.currentTarget.parentElement!)}><Chevron /></button>
      </div>
    )
  }
  return (
    <button type='button' {...tip}
      className={'rb-btn rb-small' + (text ? ' rb-text' : '') + (on ? ' on' : '')}
      aria-pressed={c.checkable ? on : undefined} aria-label={shortText(c.text)}
      onClick={() => ctx.cmd.trigger(c.id)}>
      {c.icon && <Icon name={c.icon} arg={c.iconArg} size={18} />}
      {text && <span>{shortText(c.text)}</span>}
    </button>
  )
}

// Word's font box: the font of the selected text, or (nothing selected)
// the document's body font.
const FONT_CHOICES: [string, string][] = [
  ['default', 'Computer Modern'], ['times', 'Times'], ['helvetica', 'Helvetica'], ['arial', 'Arial'],
  ['palatino', 'Palatino'], ['courier', 'Courier'], ['charter', 'Charter'], ['bookman', 'Bookman'],
  ['avantgarde', 'Avant Garde'], ['sans', 'Sans serif (CM)'], ['mono', 'Typewriter (CM)'],
]
function FontFamilyCombo({ ctx }: { ctx: Ctx }) {
  const w = useRibbonWidgets()
  const isOpen = ctx.menu?.owner === 'fontfamily'
  const name = FONT_CHOICES.find(([k]) => k === w.fontFamily)?.[1] ?? 'Computer Modern'
  return (
    <div className='rb-combo rb-combo-font' data-menu-owner title='Font'>
      <button type='button' className='rb-combo-value' aria-label='Font'
        onClick={e => ctx.openMenu(isOpen ? null : {
          owner: 'fontfamily', rect: e.currentTarget.parentElement!.getBoundingClientRect(),
          entries: FONT_CHOICES.map(([k, label]) => ({ text: label, checkable: true, checked: k === w.fontFamily, command: `fontfamily:${k}` })),
        })}>{name}</button>
      <button type='button' className='rb-combo-arrow' aria-label='Fonts'
        onClick={e => ctx.openMenu(isOpen ? null : {
          owner: 'fontfamily', rect: e.currentTarget.parentElement!.getBoundingClientRect(),
          entries: FONT_CHOICES.map(([k, label]) => ({ text: label, checkable: true, checked: k === w.fontFamily, command: `fontfamily:${k}` })),
        })}><Chevron /></button>
    </div>
  )
}

function FontSizeCombo({ ctx }: { ctx: Ctx }) {
  const [value, setValue] = useState(ctx.fontSize)
  useEffect(() => setValue(ctx.fontSize), [ctx.fontSize])
  const tip = useTipProps({ rich: lookupTip('fontsize')! })
  const isOpen = ctx.menu?.owner === 'fontsize'
  const commit = (v: string) => { if (v !== ctx.fontSize) ctx.setFontSize(v) }
  return (
    <div className='rb-combo' data-menu-owner {...tip}>
      <input value={value} aria-label='Body text font size (pt)'
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(value) }}
        onBlur={() => commit(value)} />
      <button type='button' className='rb-combo-arrow' aria-label='Font sizes'
        onClick={e => ctx.openMenu(isOpen ? null : {
          owner: 'fontsize', rect: e.currentTarget.parentElement!.getBoundingClientRect(),
          entries: FONT_SIZES.map(pt => ({ text: String(pt), checkable: true,
            checked: String(pt) === value, command: `fontsize:${pt}` })),
        })}>
        <Chevron />
      </button>
    </div>
  )
}

// Layout ▸ Indent (Left / Right, cm) and Spacing (Before / After, pt):
// Word's number boxes with their up and down steps, for the caret's
// paragraph.
const PARA_FIELDS = {
  left_cm: { label: 'Left', unit: 'cm', step: 0.1, icon: 'indent_inc' },
  right_cm: { label: 'Right', unit: 'cm', step: 0.1, icon: 'indent_dec' },
  before_pt: { label: 'Before', unit: 'pt', step: 6, icon: 'space_before' },
  after_pt: { label: 'After', unit: 'pt', step: 6, icon: 'space_after' },
} as const
function ParaField({ field }: { field: keyof typeof PARA_FIELDS }) {
  const w = useRibbonWidgets()
  const f = PARA_FIELDS[field]
  const cur = w.para ? w.para[field] : 0
  const shown = `${Math.round(cur * 100) / 100} ${f.unit}`
  const [value, setValue] = useState(shown)
  useEffect(() => setValue(shown), [shown])
  const commit = (v: number) => {
    if (!w.para || !isFinite(v)) { setValue(shown); return }
    void runAction(`parafield:${field}`, String(Math.max(0, Math.round(v * 100) / 100)))
  }
  return (
    <div className='rb-parafield' title={`${f.label} ${field.endsWith('cm') ? 'indent' : 'spacing'} of the paragraph`}>
      <Icon name={f.icon} size={16} />
      <span className='rb-parafield-label'>{f.label}:</span>
      <div className='rb-spin'>
        <input value={value} disabled={!w.para} aria-label={`${f.label} (${f.unit})`}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(parseFloat(value)) }}
          onBlur={() => { if (value !== shown) commit(parseFloat(value)) }} />
        <div className='rb-spin-arrows'>
          <button type='button' disabled={!w.para} aria-label='Up' onClick={() => commit(cur + f.step)}>▴</button>
          <button type='button' disabled={!w.para} aria-label='Down' onClick={() => commit(cur - f.step)}>▾</button>
        </div>
      </div>
    </div>
  )
}

function StyleTileButton({ level, name, on, onPick }: {
  level: number, name: string, on: boolean, onPick: () => void
}) {
  const tip = useTipProps({ rich: lookupTip('style')! })
  return (
    <button type='button' {...tip} className={'rb-btn rb-tile' + (on ? ' on' : '')}
      aria-pressed={on} aria-label={`${name} style`} onClick={onPick}>
      <Icon name='style_tile' arg={`${level}|${name}`} width={TILE_W} height={TILE_H} />
    </button>
  )
}

const styleName = (label: string) => label === 'Body text' ? 'Normal' : label

// How many more `tile`s fit in the ribbon's spare width (0..max): the
// gallery grows into it and gives it back when the window narrows.
function useFill<T extends HTMLElement>(tile: string, max: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [extra, setExtra] = useState(0)
  useLayoutEffect(() => {
    const gal = ref.current
    const body = gal?.closest('.rb-body') as HTMLElement | null
    if (!gal || !body) return
    const fit = () => {
      const w = gal.querySelector(tile)?.getBoundingClientRect().width ?? 0
      const last = body.lastElementChild?.getBoundingClientRect().right ?? 0
      const pad = parseFloat(getComputedStyle(body).paddingRight) || 0
      const free = body.getBoundingClientRect().right - pad - last
      if (w <= 0) return
      setExtra(n => Math.max(0, Math.min(max, n + Math.floor(free / (w + 1)))))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(body)
    return () => ro.disconnect()
  }, [extra, tile, max])
  return [ref, extra]
}

// The tiles in their usual order, so a click does not reshuffle them; the
// current class goes first only when it would otherwise be hidden.
function shownClasses(cur: string, extra: number): string[] {
  const first = TEMPLATE_CHOICES.slice(0, extra + 1)
  return first.includes(cur) ? first : [cur, ...first.slice(0, extra)]
}

// Layout > Document type: as many classes as fit (the current one always
// among them), and ▾ for the full grid.
function ClassGallery({ ctx }: { ctx: Ctx }) {
  const cur = ctx.docClass
  const others = TEMPLATE_CHOICES.filter(c => c !== cur)
  const [ref, extra] = useFill<HTMLDivElement>('.rb-classtile', others.length)
  const isOpen = ctx.menu?.owner === 'doc_class'
  const moreTip = useTipProps({ plain: 'All document types' })
  return (
    <div className='rb-gallery' ref={ref}>
      {shownClasses(cur, extra).map(cls => <ClassTile key={cls} cls={cls} on={cls === cur} />)}
      <button type='button' data-menu-owner {...moreTip}
        className={'rb-btn rb-gallery-more' + (isOpen ? ' on' : '')} aria-label='All document types'
        onClick={e => ctx.openMenu(isOpen ? null : {
          owner: 'doc_class', rect: e.currentTarget.getBoundingClientRect(), kind: 'classGrid',
        })}>
        <Icon name='gallery_more' size={14} />
      </button>
    </div>
  )
}

// One document type; hover says what it is for and where it comes from.
function ClassTile({ cls, on }: { cls: string, on: boolean }) {
  const tip = useTipProps({ rich: classTip(cls, isBetaClass(cls)) })
  return (
    <button type='button' {...tip} className={'rb-btn rb-classtile' + (on ? ' on' : '')}
      aria-pressed={on} onClick={() => { void runAction('doc_class', cls) }}>
      <Icon name='class_thumbnail' arg={cls} width={34} height={43} />
      <span className='rb-classtile-name'>{cls}</span>
      {isBetaClass(cls) && <span className='beta-tag rb-classbeta'>beta</span>}
    </button>
  )
}

function ClassCell({ cls, on, onPick }: { cls: string, on: boolean, onPick: (cls: string) => void }) {
  const tip = useTipProps({ rich: classTip(cls, isBetaClass(cls)) })
  return (
    <button type='button' {...tip} className={'rb-classcell' + (on ? ' on' : '')} onClick={() => onPick(cls)}>
      <Icon name='class_thumbnail' arg={cls} width={52} height={66} />
      <span>{cls}</span>
      {isBetaClass(cls) && <span className='beta-tag rb-classbeta'>beta</span>}
    </button>
  )
}

// Tiles beyond GALLERY_INLINE, in the order they join when there is room.
const GALLERY_MORE = [4, 5, -2, -7, -8, -3, -4, -5, -6]

function StyleGallery({ ctx }: { ctx: Ctx }) {
  const level = ctx.styleLevel
  const pick = ctx.setStyleLevel
  const isOpen = ctx.menu?.owner === 'styles'
  const moreTip = useTipProps({ plain: 'All paragraph styles' })
  // As many tiles as the ribbon has room for (at least the inline five).
  const [ref, extra] = useFill<HTMLDivElement>('.rb-tile', GALLERY_MORE.length)
  return (
    <div className='rb-gallery' ref={ref}>
      {[...GALLERY_INLINE, ...GALLERY_MORE.slice(0, extra)].map(lv => {
        const label = PARAGRAPH_STYLES.find(([, l]) => l === lv)![0]
        return <StyleTileButton key={lv} level={lv} name={styleName(label)}
          on={level === lv} onPick={() => pick(lv)} />
      })}
      <button type='button' data-menu-owner {...moreTip}
        className={'rb-btn rb-gallery-more' + (isOpen ? ' on' : '')}
        aria-label='All paragraph styles'
        onClick={e => ctx.openMenu(isOpen ? null : {
          owner: 'styles', rect: e.currentTarget.getBoundingClientRect(),
          iconSize: TILE_W,
          entries: PARAGRAPH_STYLES.map(([label, lv]) => ({
            text: '', icon: 'style_tile', iconArg: `${lv}|${styleName(label)}`,
            checkable: true, checked: lv === level, command: `style:${lv}`,
          })),
        })}>
        <Icon name='gallery_more' size={14} />
      </button>
    </div>
  )
}

function NumberedTile() {
  const w = useRibbonWidgets()
  const on = w.numbered
  const tip = useTipProps({ rich: lookupTip('numbered')! })
  return (
    <button type='button' {...tip} className={'rb-btn rb-tile rb-tile-solo' + (on ? ' on' : '')}
      aria-pressed={on} aria-label='Numbered headings'
      disabled={!w.numberedEnabled}
      onClick={() => { void runAction('numbered_headings', !on) }}>
      <Icon name='numbered_heading_tile' width={TILE_W} height={TILE_H} />
    </button>
  )
}

function Item({ it, ctx, large, text }: {
  it: RibbonItem, ctx: Ctx, large: boolean, text: boolean
}) {
  if (typeof it !== 'string') {
    if (it.widget === 'fontsize') return <FontSizeCombo ctx={ctx} />
    if (it.widget === 'fontfamily') return <FontFamilyCombo ctx={ctx} />
    if (it.widget === 'parafield') return <ParaField field={it.field} />
    if (it.widget === 'styles') return <StyleGallery ctx={ctx} />
    if (it.widget === 'classes') return <ClassGallery ctx={ctx} />
    return <NumberedTile />
  }
  const c = COMMANDS[it]
  if (!c) return null
  return large ? <BigButton c={c} ctx={ctx} /> : <SmallButton c={c} ctx={ctx} text={text} />
}

function Group({ g, ctx }: { g: RibbonGroup, ctx: Ctx }) {
  return (
    <>
      <div className='rb-group'>
        <div className='rb-group-body'>
          {g.large?.map((it, i) => <Item key={i} it={it} ctx={ctx} large text />)}
          {g.rows && (g.text
            ? (
              <div className='rb-text-rows'
                style={{ gridTemplateRows: `repeat(${g.rows.length}, 1fr)` }}>
                {g.rows.map((row, r) => row.map((it, k) => (
                  <div key={`${r}-${k}`} style={{ gridRow: r + 1, gridColumn: k + 1 }}>
                    <Item it={it} ctx={ctx} large={false} text />
                  </div>
                )))}
              </div>
            )
            : (
              <div className='rb-icon-rows'>
                {g.rows.map((row, r) => (
                  <div key={r} className='rb-icon-row'>
                    {row.map((it, k) => <Item key={k} it={it} ctx={ctx} large={false} text={false} />)}
                  </div>
                ))}
              </div>
            ))}
        </div>
        <div className='rb-caption'>{g.label}</div>
      </div>
      <div className='rb-sep' />
    </>
  )
}

function CornerButton({ id, ctx }: { id: string, ctx: Ctx }) {
  const c = COMMANDS[id]
  return <SmallButton c={c} ctx={ctx} text={CORNER_LABELLED.has(id)} />
}

function Corner({ ids, ctx, side }: { ids: (string | null)[], ctx: Ctx, side: string }) {
  return (
    <div className={`rb-corner rb-corner-${side}`}>
      {ids.map((id, i) => id === null
        ? <div key={i} className='rb-corner-sep' />
        : <CornerButton key={id} id={id} ctx={ctx} />)}
    </div>
  )
}

function ClassGrid({ rect, current, onPick, onClose }: {
  rect: DOMRect, current: string, onPick: (cls: string) => void, onClose: () => void
}) {
  // Opened from ▾ at the right of the ribbon, the grid would run off the
  // window: keep it on screen (right-aligned to the button when needed).
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(rect.left)
  useLayoutEffect(() => {
    const w = ref.current?.getBoundingClientRect().width ?? 0
    setLeft(Math.max(4, Math.min(rect.left, innerWidth - w - 4)))
  }, [rect.left])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest('.qmenu, [data-menu-owner]')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [onClose])
  return (
    <div ref={ref} className='qmenu rb-classgrid' style={{ left, top: rect.bottom }}>
      {TEMPLATE_CHOICES.map(cls => <ClassCell key={cls} cls={cls} on={cls === current} onPick={onPick} />)}
    </div>
  )
}

function TabBar({ tabs, current, onPick }: {
  tabs: typeof RIBBON_TABS, current: string, onPick: (name: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabs])
  const scroll = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' })
  return (
    <>
      <div ref={ref} className='rb-tabs' role='tablist'>
        {tabs.map(t => (
          <button type='button' key={t.name} role='tab' aria-selected={t.name === current}
            className={'rb-tab' + (t.name === current ? ' on' : '') + (t.context ? ' ctx' : '')}
            onClick={() => onPick(t.name)}>
            {/* The bold twin reserves the width so the open tab does not jump. */}
            <span className='rb-tab-text' data-text={t.name}>{t.name}</span>
          </button>
        ))}
      </div>
      {overflow && (
        <div className='rb-tab-scroll'>
          <button type='button' aria-label='Scroll tabs left' onClick={() => scroll(-120)}>
            <svg width='6' height='9' viewBox='0 0 6 9' aria-hidden='true'>
              <path d='M5 0.5 L0.5 4.5 L5 8.5 Z' fill='currentColor' /></svg>
          </button>
          <button type='button' aria-label='Scroll tabs right' onClick={() => scroll(120)}>
            <svg width='6' height='9' viewBox='0 0 6 9' aria-hidden='true'>
              <path d='M1 0.5 L5.5 4.5 L1 8.5 Z' fill='currentColor' /></svg>
          </button>
        </div>
      )}
    </>
  )
}

export function Ribbon({ cmd, context }: { cmd: CommandState, context: ContextKind | null }) {
  const [current, setCurrent] = useState('Home')
  // As Word: a click on the open tab folds the ribbon away (only the tab
  // names stay); a click on a tab shows it again. Remembered.
  const [folded, setFolded] = useState(() => Boolean(setting('ribbon_folded', false)))
  const pick = (name: string) => {
    if (name === shown.name) {
      const f = !folded
      setFolded(f)
      setSetting('ribbon_folded', f)
    } else {
      setCurrent(name)
      if (folded) { setFolded(false); setSetting('ribbon_folded', false) }
    }
  }
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  // The hidden combos' state follows the caret (editor/ribbonState.ts).
  const widgets = useRibbonWidgets()
  const { docClass, fontSize, styleLevel } = widgets
  const setFontSize = (v: string) => { void runAction('fontsize', v) }
  const setStyleLevel = (lv: number) => {
    if (!(lv in widgets.disabledStyles)) void runAction('style', lv)
  }
  const closeMenu = useCallback(() => setMenu(null), [])
  const visible = RIBBON_TABS.filter(t => !t.context || t.context === context)
  const shown = visible.find(t => t.name === current) ?? visible[0]

  // Menu items that are not commands (font sizes, styles) report through
  // the same channel, so they also log.
  const menuCmd: CommandState = {
    isChecked: cmd.isChecked,
    setChecked: cmd.setChecked,
    trigger: id => {
      if (COMMANDS[id]) cmd.trigger(id)
      else if (id.startsWith('fontsize:')) setFontSize(id.slice(9))
      else if (id.startsWith('fontfamily:')) void runAction('fontfamily', id.slice(11))
      else if (id.startsWith('style:')) setStyleLevel(Number(id.slice(6)))
      else void runAction(id)
    },
  }
  const ctx: Ctx = { cmd, menu, openMenu: setMenu, docClass, fontSize, setFontSize,
    styleLevel, setStyleLevel }

  return (
    <div className='ribbon'>
      <div className='rb-bar'>
        <Corner ids={CORNER_LEFT} ctx={ctx} side='left' />
        <TabBar tabs={visible} current={shown.name} onPick={pick} />
        <div className='rb-bar-fill' />
        <button type='button' className='rb-feedback'
          title={`${SHORT_NAME} is in beta - some parts are still new. Click to email your feedback to ${FEEDBACK_EMAIL}`}
          onClick={() => { void runAction('send_feedback') }}>
          <span className='beta-tag'>beta</span> Send feedback
        </button>
        <button type='button' className='rb-coffee' aria-label='Buy me a coffee'
          title='Buy me a coffee: support kTeX (shows a QR code)'
          onClick={() => { void runAction('buy_coffee') }}>
          <Icon name='coffee' size={18} />
        </button>
        <Corner ids={CORNER_RIGHT} ctx={ctx} side='right' />
      </div>
      {!folded && (
        <div className='rb-body' role='tabpanel' aria-label={shown.name}>
          {shown.groups.map((g, i) => <Group key={`${shown.name}-${i}`} g={g} ctx={ctx} />)}
        </div>
      )}
      {menu?.kind === 'classGrid' && (
        <ClassGrid rect={menu.rect} current={docClass} onClose={closeMenu}
          onPick={cls => { void runAction('doc_class', cls); closeMenu() }} />
      )}
      {menu?.entries && (
        <Popup key={menu.owner} entries={menu.entries} anchor={menu.rect} cmd={menuCmd}
          onClose={closeMenu} iconSize={menu.iconSize} />
      )}
    </div>
  )
}
