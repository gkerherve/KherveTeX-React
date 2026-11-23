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
import { accentOf, secondOf, STYLE_SETS } from '../core/design'
import { searchTools, type ToolHit } from './ribbonSearch'
import { PREFS_EVENT, pref } from '../app/prefs'
import { PENS_EVENT, penIndex, pens, setPen, usePen } from '../app/actions/draw'
import { pickColor } from '../app/actions/table'
import { inkTool, setInkTool } from '../editor/ink'
import { titleBarShown } from './TitleBar'
import { WordControls } from './WordControls'
import { PEN_WIDTHS } from '../core/ink'
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
  kind?: 'classGrid' | 'tableGrid'
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
  if (c.id === 'margins') return 36
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
  if (c.checkbox) {
    return (
      <label className='rb-check' {...tip}>
        <input type='checkbox' checked={!!on} onChange={() => ctx.cmd.trigger(c.id)} />
        <span>{shortText(c.text)}</span>
      </label>
    )
  }
  return (
    <button type='button' {...tip} disabled={c.disabled}
      className={'rb-btn rb-small' + (text ? ' rb-text' : '') + (on ? ' on' : '')}
      aria-pressed={c.checkable ? on : undefined} aria-label={shortText(c.text)}
      onClick={() => ctx.cmd.trigger(c.id)}>
      {c.icon && <Icon name={c.icon} arg={c.iconArg} size={18} />}
      {text && <span>{shortText(c.text)}</span>}
      {c.beta && <span className='beta-tag rb-small-beta'>beta</span>}
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

// Header & Footer ▸ Position: Header from Top / Footer from Bottom (cm).
const HF_FIELDS = {
  header_cm: { label: 'Header from Top', icon: 'hf_top' },
  footer_cm: { label: 'Footer from Bottom', icon: 'hf_bottom' },
} as const
function HFField({ field }: { field: keyof typeof HF_FIELDS }) {
  const w = useRibbonWidgets()
  const f = HF_FIELDS[field]
  const cur = w.hf[field]
  const shown = `${Math.round(cur * 100) / 100} cm`
  const [value, setValue] = useState(shown)
  useEffect(() => setValue(shown), [shown])
  const commit = (v: number) => {
    if (!isFinite(v)) { setValue(shown); return }
    void runAction(`hfpos:${field}`, String(Math.max(0, Math.round(v * 100) / 100)))
  }
  return (
    <div className='rb-parafield rb-hffield' title={`${f.label}: the distance from the paper's edge`}>
      <Icon name={f.icon} size={18} />
      <span className='rb-parafield-label'>{f.label}:</span>
      <div className='rb-spin'>
        <input value={value} aria-label={`${f.label} (cm)`}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(parseFloat(value)) }}
          onBlur={() => { if (value !== shown) commit(parseFloat(value)) }} />
        <div className='rb-spin-arrows'>
          <button type='button' aria-label='Up' onClick={() => commit(cur + 0.05)}>▴</button>
          <button type='button' aria-label='Down' onClick={() => commit(cur - 0.05)}>▾</button>
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

// Draw ▸ Pens: Word's pen gallery. A click picks a pen and draws with it
// (the chosen one stands out); a click on the chosen pen opens its
// thickness and colour.
function PenGallery() {
  const [, tick] = useState(0)
  const [pop, setPop] = useState<DOMRect | null>(null)
  useEffect(() => {
    const on = () => tick(n => n + 1)
    window.addEventListener(PENS_EVENT, on)
    return () => window.removeEventListener(PENS_EVENT, on)
  }, [])
  const list = pens()
  const cur = penIndex()
  const drawing = inkTool()?.kind === 'pen'
  const pen = list[cur]
  return (
    <div className='rb-pens-wrap'>
    <div className='rb-pens'>
      {list.map((p, i) => (
        <button key={i} type='button' className={'rb-pen' + (i === cur && drawing ? ' on' : '')}
          title={`${p.kind === 'highlighter' ? 'Highlighter' : p.kind === 'pencil' ? 'Pencil' : 'Pen'}: ${p.color}, ${p.width} pt`}
          onClick={e => {
            if (i === cur && drawing) setPop(pop ? null : e.currentTarget.getBoundingClientRect())
            else { setPop(null); usePen(i) }
          }}>
          <Icon name='ink_pen' arg={`${p.kind}|${p.color}`} width={22} height={46} />
        </button>
      ))}
      {pop && pen && (
        <div className='rb-pen-pop' style={{ left: pop.left - 40, top: pop.bottom + 4 }} onMouseLeave={() => setPop(null)}>
          <div className='rb-pen-pop-title'>Thickness</div>
          <div className='rb-pen-widths'>
            {PEN_WIDTHS.filter(w => pen.kind === 'highlighter' ? w >= 3.5 : w <= 6).map(w => (
              <button key={w} type='button' className={w === pen.width ? 'on' : ''} title={`${w} pt`}
                onClick={() => { setPen(cur, { ...pen, width: w }); setPop(null) }}>
                <span style={{ width: Math.max(2, w * 1.6), height: Math.max(2, w * 1.6), background: pen.color, opacity: pen.alpha ?? 1 }} />
              </button>
            ))}
          </div>
          <button type='button' className='rb-pen-colour' onClick={() => {
            setPop(null)
            void pickColor(pen.color).then(c => { if (c) setPen(cur, { ...pen, color: c }) })
          }}>Colour…</button>
        </div>
      )}
    </div>
    <div className='rb-ink-beta' title={INK_BETA_TIP}>
      <span className='beta-tag'>beta</span>
      <span>Ink in the PDF may often miss the word it marks: check its position after compiling.</span>
    </div>
    </div>
  )
}

const INK_BETA_TIP = 'Drawing is in beta. kTeX ties each stroke to the word under it, but LaTeX lays out the page '
  + 'differently from the editor, so in the PDF a circle, underline or highlight may land beside its word, '
  + 'on the wrong line or a little off. Always check the PDF, and please send feedback (Help ▸ Send feedback).'

// Design ▸ Document Formatting: Word's style-set gallery, each tile a
// page in that heading look with the document's colours.
function StyleSetGallery({ ctx }: { ctx: Ctx }) {
  const d = useRibbonWidgets().design
  const cur = d.style_set ?? 'default'
  const arg = (k: string) => `${k}|${accentOf(d)}|${secondOf(d)}`
  const shown = STYLE_SETS.slice(0, 5).some(([k]) => k === cur) ? STYLE_SETS.slice(0, 5) : [STYLE_SETS.find(([k]) => k === cur)!, ...STYLE_SETS.slice(0, 4)]
  const isOpen = ctx.menu?.owner === 'stylesets'
  const moreTip = useTipProps({ plain: 'All style sets' })
  return (
    <div className='rb-gallery rb-stylesets'>
      {shown.map(([k, name]) => <StyleSetTileButton key={k} k={k} name={name} arg={arg(k)} on={k === cur} />)}
      <button type='button' data-menu-owner {...moreTip}
        className={'rb-btn rb-gallery-more' + (isOpen ? ' on' : '')} aria-label='All style sets'
        onClick={e => ctx.openMenu(isOpen ? null : {
          owner: 'stylesets', rect: e.currentTarget.getBoundingClientRect(), iconSize: 64,
          entries: STYLE_SETS.map(([k, name]) => ({ text: name, icon: 'style_set_tile', iconArg: arg(k), checkable: true, checked: k === cur, command: `styleset:${k}` })),
        })}>
        <Icon name='gallery_more' size={14} />
      </button>
    </div>
  )
}

function StyleSetTileButton({ k, name, arg, on }: { k: string, name: string, arg: string, on: boolean }) {
  const tip = useTipProps({ plain: `${name}: the look of the title and headings` })
  return (
    <button type='button' {...tip} className={'rb-btn rb-styleset' + (on ? ' on' : '')} aria-pressed={on}
      onClick={() => { void runAction(`styleset:${k}`) }}>
      <Icon name='style_set_tile' arg={arg} width={58} height={50} />
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
    if (it.widget === 'hffield') return <HFField field={it.field} />
    if (it.widget === 'styles') return <StyleGallery ctx={ctx} />
    if (it.widget === 'classes') return <ClassGallery ctx={ctx} />
    if (it.widget === 'stylesets') return <StyleSetGallery ctx={ctx} />
    if (it.widget === 'pens') return <PenGallery />
    return <NumberedTile />
  }
  const c = COMMANDS[it]
  if (!c) return null
  return large ? <BigButton c={c} ctx={ctx} /> : <SmallButton c={c} ctx={ctx} text={text} />
}

function Group({ g, ctx }: { g: RibbonGroup, ctx: Ctx }) {
  return (
    <>
      <div className='rb-group' data-group={g.label}>
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

// The quick-access buttons left of the tabs; with the blue title bar
// (macOS) they stay here, by the menus (the bar holds AutoSave, Save and the exports).
function leftCorner(hidden: string[]): (string | null)[] {
  const onBar: string[] = []
  // Without the bar, Export .docx / .pdf sit next to Save here.
  const base = titleBarShown() ? CORNER_LEFT : CORNER_LEFT.flatMap(id => (id === 'save' ? ['save', 'export_docx', 'export_pdf'] : [id]))
  const ids = base.filter(id => id === null || (!hidden.includes(id) && !onBar.includes(id)))
  while (ids.length && ids[ids.length - 1] === null) ids.pop()
  return ids
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

// Insert ▸ Table, as Word's: a 10 x 8 grid of cells lit up to the mouse
// ("3x4 Table"); a click inserts that table. Insert Table… opens the
// dialog, Convert Text to Table… turns the selected lines into rows.
function TableGrid({ rect, onClose }: { rect: DOMRect, onClose: () => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest('.rb-tablegrid, [data-menu-owner]')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])
  const [r, c] = hover
  const pick = (rows: number, cols: number) => { onClose(); void runAction('table_grid', `${rows}x${cols}`) }
  return (
    <div className='qmenu rb-tablegrid' style={{ left: Math.max(4, Math.min(rect.left, innerWidth - 250)), top: rect.bottom }}
      onMouseLeave={() => setHover([0, 0])}>
      <div className='rb-tablegrid-title'>{r && c ? `${c}x${r} Table` : 'Insert Table'}</div>
      <div className='rb-tablegrid-cells'>
        {Array.from({ length: 8 }, (_, i) => Array.from({ length: 10 }, (_, j) => (
          <div key={`${i}-${j}`} className={'rb-tg-cell' + (i < r && j < c ? ' on' : '')}
            onMouseEnter={() => setHover([i + 1, j + 1])} onMouseDown={e => { e.preventDefault(); pick(i + 1, j + 1) }} />
        )))}
      </div>
      <div className='rb-tablegrid-sep' />
      <button type='button' className='rb-tablegrid-item' onMouseDown={e => { e.preventDefault(); onClose(); void runAction('table') }}>
        <Icon name='table' size={16} /> Insert Table…</button>
      <button type='button' className='rb-tablegrid-item' onMouseDown={e => { e.preventDefault(); onClose(); void runAction('text_to_table') }}>
        <Icon name='table' size={16} /> Convert Text to Table…</button>
    </div>
  )
}

function TabBar({ tabs, current, onPick, onFold }: {
  tabs: typeof RIBBON_TABS, current: string, onPick: (name: string, clicks?: number) => void, onFold: (name: string) => void
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
            onClick={e => onPick(t.name, e.detail)} onDoubleClick={() => onFold(t.name)}>
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

// Word's Search box: type what you want to do; each tool shows where it
// lives (Tab ▸ Group). Enter or a click goes there and runs it.
export function ToolSearch({ onGo = h => window.dispatchEvent(new CustomEvent('kt-tool-go', { detail: h })) }: { onGo?: (h: ToolHit) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const hits = searchTools(q)
  const go = (h: ToolHit | undefined) => {
    if (!h) return
    setOpen(false); setQ('')
    onGo(h)
  }
  return (
    <div className='rb-search'>
      <svg width='13' height='13' viewBox='0 0 13 13' aria-hidden='true' className='rb-search-glass'>
        <circle cx='5.5' cy='5.5' r='4.2' fill='none' stroke='currentColor' strokeWidth='1.4' />
        <path d='M8.6 8.6 L12 12' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' /></svg>
      <input type='search' placeholder='Search tools' aria-label='Search tools' value={q}
        onChange={e => { setQ(e.target.value); setSel(0); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(hits.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(0, i - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]) }
          else if (e.key === 'Escape') { setQ(''); setOpen(false); (e.target as HTMLInputElement).blur() }
        }} />
      {open && q.trim() && (
        <div className='rb-search-list' role='listbox'>
          {!hits.length && <div className='rb-search-none'>No tool matches “{q}”.</div>}
          {hits.map((h, i) => (
            <div key={h.label + h.where} role='option' aria-selected={i === sel}
              className={'rb-search-hit' + (i === sel ? ' on' : '')}
              onMouseEnter={() => setSel(i)} onMouseDown={e => { e.preventDefault(); go(h) }}>
              <span className='rb-search-icon'>{h.icon && <Icon name={h.icon} arg={h.iconArg} size={18} />}</span>
              <span className='rb-search-label'>{h.label}</span>
              <span className='rb-search-where'>{h.where}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Ribbon({ cmd, context }: { cmd: CommandState, context: ContextKind | null }) {
  const [current, setCurrent] = useState('Home')
  // As Word: a double-click on a tab (Home, Insert...) folds the ribbon
  // away, leaving the tab names; a click on a tab shows it again, and a
  // double-click pins it back. Remembered.
  const [folded, setFolded] = useState(() => Boolean(setting('ribbon_folded', false)))
  const fold = (f: boolean) => { setFolded(f); setSetting('ribbon_folded', f) }
  // Folded or not before the double-click's first click (which unfolds).
  const before = useRef(false)
  const pick = (name: string, clicks = 1) => {
    if (clicks <= 1) before.current = folded
    setCurrent(name)
    if (folded) fold(false)
  }
  const toggleFold = (name: string) => {
    setCurrent(name)
    fold(!before.current)
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
  // Preferences ▸ Ribbon & Toolbar / View: tabs and quick buttons shown,
  // group titles; a change shows at once.
  const [, setPrefTick] = useState(0)
  useEffect(() => {
    const on = () => { setPrefTick(n => n + 1); setFolded(Boolean(setting('ribbon_folded', false))) }
    window.addEventListener(PREFS_EVENT, on)
    return () => window.removeEventListener(PREFS_EVENT, on)
  }, [])
  const hiddenTabs = pref('ribbon/hidden_tabs')
  const hiddenQuick = pref('ribbon/hidden_quick')
  const visible = RIBBON_TABS.filter(t => (!t.context || t.context === context) && (t.context || !hiddenTabs.includes(t.name)))
  const shown = visible.find(t => t.name === current) ?? visible[0]
  // Editing a header or footer opens its tab, as in Word; leaving goes back.
  useEffect(() => {
    if (context === 'headerfooter') setCurrent('Header & Footer')
    else setCurrent(c => (c === 'Header & Footer' ? 'Home' : c))
  }, [context])
  // Leaving the Draw tab puts the pen (or the eraser) down: back to typing.
  useEffect(() => { if (shown.name !== 'Draw' && inkTool()) setInkTool(null) }, [shown.name])

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

  // The Search box (in the menu bar) sends the tool picked here.
  const goTool = (h: ToolHit) => {
          setCurrent(h.tab)
          if (folded) { setFolded(false); setSetting('ribbon_folded', false) }
          // Show where it is: the group flashes.
          setTimeout(() => {
            const el = document.querySelector(`.rb-group[data-group="${CSS.escape(h.group)}"]`)
            if (el) { el.classList.remove('rb-flash'); void (el as HTMLElement).offsetWidth; el.classList.add('rb-flash') }
          }, 30)
          if (h.command) menuCmd.trigger(h.command)
  }
  const goRef = useRef(goTool)
  goRef.current = goTool
  useEffect(() => {
    const on = (e: Event) => goRef.current((e as CustomEvent<ToolHit>).detail)
    window.addEventListener('kt-tool-go', on)
    return () => window.removeEventListener('kt-tool-go', on)
  }, [])

  return (
    <div className={'ribbon' + (folded ? ' rb-folded' : '') + (pref('ribbon/group_titles') ? '' : ' rb-no-titles')}>
      <div className='rb-bar'>
        <Corner ids={leftCorner(hiddenQuick)} ctx={ctx} side='left' />
        <TabBar tabs={visible} current={shown.name} onPick={pick} onFold={toggleFold} />
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
        {!titleBarShown() && <WordControls />}
        <Corner ids={CORNER_RIGHT} ctx={ctx} side='right' />
      </div>
      {!folded && (
        <div className='rb-body' role='tabpanel' aria-label={shown.name}>
          {shown.groups.map((g, i) => <Group key={`${shown.name}-${i}`} g={g} ctx={ctx} />)}
        </div>
      )}
      {menu?.kind === 'tableGrid' && <TableGrid rect={menu.rect} onClose={closeMenu} />}
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
