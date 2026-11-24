// The Science tab's safety, physics and maths drawings (core/science2.ts):
// risk matrix, safety signs, free-body diagram, ray diagram, wave, energy
// levels, function plot, number line, Venn diagram, triangle, statistics
// and unit circle - insert commands, Edit… dialogs and tab options.
import {
  SIGNS, WAVE_KINDS, type ForcesData, type FunctionData, type LevelsData, type NumberLineData, type OpticsData, type RiskData, type SignsData,
  type StatsData, type TriangleData, type UnitCircleData, type VennData, type WaveData,
} from '../../core/science2.ts'
import type { WidgetKind } from '../../core/widgets.ts'
import { GEO_HELP, GEO_PARAMS, GEO_SHAPES, presetScript, type GeoShape, type GeometryData } from '../../core/geometry.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import * as W from '../../editor/widgetCommands.ts'
import { formDialog } from '../../ui/dialogs/EditorDialogs.tsx'
import { registerActions, type Handler } from '../actions.ts'

const run = (cmd: C.Command): boolean => editor()?.run(cmd) ?? false
const sync = () => editor()?.syncToolbar()
const state = () => editor()?.view.state ?? null
const num = (s: string, d = 0) => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : d }

function upd(kind: WidgetKind, fn: (d: any) => void): Handler {
  return () => {
    const s = state()
    const w = s && W.currentWidget(s)
    if (!w || w.widget.kind !== kind) return
    run(W.updateWidget(d => { fn(d) }))
    sync()
  }
}

export async function editScience2(): Promise<boolean> {
  const s = state()
  const w = s && W.currentWidget(s)
  if (!w) return false
  const d = w.widget.data as any
  switch (w.widget.kind) {
    case 'risk': {
      const r = await formDialog('Risk matrix', [{ key: 'risks', label: 'Risks, one per line:', value: (d as RiskData).risks, type: 'textarea',
        help: 'Risk: likelihood, severity - each 1 to 5, e.g. "HF splash: 2, 5". The score is their product: green 1-3, yellow 4-7, orange 8-14, red 15-25.' }])
      if (r) run(W.updateWidget<'risk'>(x => { x.risks = r.risks }))
      break
    }
    case 'signs': {
      const r = await formDialog('Safety signs', [{ key: 'signs', label: 'Signs, separated by commas:', value: (d as SignsData).signs.join(', '),
        help: `Any of: ${SIGNS.map(([k, cap]) => `${k} (${cap})`).join(', ')}.` }])
      if (r) run(W.updateWidget<'signs'>(x => { x.signs = r.signs.split(/[,\s]+/).filter(k => SIGNS.some(sg => sg[0] === k)) }))
      break
    }
    case 'forces': {
      const f = d as ForcesData
      const r = await formDialog('Free-body diagram', [
        { key: 'forces', label: 'Forces, one per line:', value: f.forces, type: 'textarea',
          help: 'Name: direction in degrees (0 = right, 90 = up, 270 = down), length in cm, e.g. "Weight W: 270, 1.6".' },
        { key: 'object', label: 'Object:', value: f.object, type: 'select', options: ['box', 'ball', 'slope'] },
        { key: 'angle', label: 'Slope angle (degrees):', value: String(f.angle), type: 'number' },
      ])
      if (r) run(W.updateWidget<'forces'>(x => { x.forces = r.forces; x.object = r.object as ForcesData['object']; x.angle = num(r.angle, 30) }))
      break
    }
    case 'optics': {
      const o = d as OpticsData
      const r = await formDialog('Ray diagram', [
        { key: 'lens', label: 'Lens:', value: o.lens, type: 'select', options: ['converging', 'diverging'] },
        { key: 'focal', label: 'Focal length (cm):', value: String(o.focal), type: 'number' },
        { key: 'object', label: 'Object distance (cm):', value: String(o.object), type: 'number' },
        { key: 'height', label: 'Object height (cm):', value: String(o.height), type: 'number' },
      ])
      if (r) run(W.updateWidget<'optics'>(x => { x.lens = r.lens as OpticsData['lens']; x.focal = num(r.focal, 4); x.object = num(r.object, 7); x.height = num(r.height, 1.5) }))
      break
    }
    case 'wave': {
      const v = d as WaveData
      const kinds = WAVE_KINDS.map(([, n]) => n)
      const r = await formDialog('Wave', [
        { key: 'kind', label: 'Type:', value: WAVE_KINDS.find(([k]) => k === (v.kind ?? 'sine'))![1], type: 'select', options: kinds },
        { key: 'axis', label: 'Against:', value: v.axis === 't' ? 'time t (period T)' : 'distance x (wavelength λ)', type: 'select', options: ['distance x (wavelength λ)', 'time t (period T)'] },
        { key: 'wavelength', label: 'Wavelength λ (or period T):', value: String(v.wavelength), type: 'number' },
        { key: 'amplitude', label: 'Amplitude A:', value: String(v.amplitude), type: 'number' },
        { key: 'cycles', label: 'Number of cycles shown:', value: String(v.cycles), type: 'number' },
        { key: 'phase', label: 'Phase (degrees):', value: String(v.phase ?? 0), type: 'number', help: 'Shifts the wave along: 90 starts it at a crest.' },
        { key: 'shift', label: 'Second wave behind by (degrees):', value: String(v.shift ?? 90), type: 'number', help: 'For a sine, square, triangle or sawtooth with Second wave on: 180 is in antiphase.' },
        { key: 'ratio', label: 'Beats: frequency ratio of the two waves:', value: String(v.ratio ?? 1.1), type: 'number', help: 'e.g. 1.1: the closer to 1, the longer the beats.' },
        { key: 'damping', label: 'Damped: damping per cycle:', value: String(v.damping ?? 0.25), type: 'number', help: '0 for none; 0.25 halves it in about 3 cycles.' },
      ])
      if (r) run(W.updateWidget<'wave'>(x => {
        x.kind = WAVE_KINDS.find(([, n]) => n === r.kind)![0]
        x.axis = r.axis.startsWith('time') ? 't' : 'x'
        x.wavelength = num(r.wavelength, 4); x.amplitude = num(r.amplitude, 1); x.cycles = num(r.cycles, 2)
        x.phase = num(r.phase, 0); x.shift = num(r.shift, 90); x.ratio = num(r.ratio, 1.1); x.damping = num(r.damping, 0.25)
      }))
      break
    }
    case 'levels': {
      const l = d as LevelsData
      const r = await formDialog('Energy levels', [
        { key: 'levels', label: 'Levels, one per line:', value: l.levels, type: 'textarea', help: 'Name: energy in eV, e.g. "n = 2: -3.40".' },
        { key: 'transitions', label: 'Transitions, one per line:', value: l.transitions, type: 'textarea', help: 'From → to: label, e.g. "3 → 2: Hα 656 nm" (levels named n = …).' },
      ])
      if (r) run(W.updateWidget<'levels'>(x => { x.levels = r.levels; x.transitions = r.transitions }))
      break
    }
    case 'function': {
      const f = d as FunctionData
      const r = await formDialog('Function plot', [
        { key: 'functions', label: 'Functions of x, one per line:', value: f.functions, type: 'code', rows: 4,
          help: 'e.g. sin(x), x^2 - 1, exp(-x^2), 2x + 1, sqrt(x), ln(x). Also cos tan asin acos atan sinh cosh tanh log abs, pi and e.' },
        { key: 'xmin', label: 'x from:', value: String(f.xmin), type: 'number' }, { key: 'xmax', label: 'x to:', value: String(f.xmax), type: 'number' },
        { key: 'ymin', label: 'y from (empty: automatic):', value: f.ymin }, { key: 'ymax', label: 'y to (empty: automatic):', value: f.ymax },
      ])
      if (r) run(W.updateWidget<'function'>(x => { x.functions = r.functions; x.xmin = num(r.xmin, -4); x.xmax = num(r.xmax, 4); x.ymin = r.ymin.trim(); x.ymax = r.ymax.trim() }))
      break
    }
    case 'numberline': {
      const n = d as NumberLineData
      const r = await formDialog('Number line', [
        { key: 'from', label: 'From:', value: String(n.from), type: 'number' }, { key: 'to', label: 'To:', value: String(n.to), type: 'number' },
        { key: 'step', label: 'Step between ticks:', value: String(n.step), type: 'number' },
        { key: 'points', label: 'Points, one per line:', value: n.points, type: 'textarea', rows: 3, help: 'value: open or closed, then an optional label, e.g. "3: open x = 3".' },
        { key: 'intervals', label: 'Intervals, one per line:', value: n.intervals, type: 'textarea', rows: 2, help: 'e.g. "-2 to 3", "1 to ∞".' },
      ])
      if (r) run(W.updateWidget<'numberline'>(x => { x.from = num(r.from, -5); x.to = num(r.to, 5); x.step = num(r.step, 1); x.points = r.points; x.intervals = r.intervals }))
      break
    }
    case 'venn': {
      const v = d as VennData
      const r = await formDialog('Venn diagram', [
        { key: 'sets', label: 'Sets (2 or 3), separated by commas:', value: v.sets },
        { key: 'regions', label: 'What each region holds, one per line:', value: v.regions, type: 'textarea',
          help: 'A, B, C: only in that set; AB, AC, BC: in both; ABC: in all three; O: outside them all. e.g. "AB: 4".' },
      ])
      if (r) run(W.updateWidget<'venn'>(x => { x.sets = r.sets; x.regions = r.regions }))
      break
    }
    case 'triangle': {
      const t = d as TriangleData
      const r = await formDialog('Triangle', [
        { key: 'a', label: 'Side a (opposite A):', value: String(t.a), type: 'number' }, { key: 'b', label: 'Side b (opposite B):', value: String(t.b), type: 'number' },
        { key: 'c', label: 'Side c (opposite C):', value: String(t.c), type: 'number' }, { key: 'labels', label: 'Corner names:', value: t.labels },
      ])
      if (r) run(W.updateWidget<'triangle'>(x => { x.a = num(r.a, 5); x.b = num(r.b, 4); x.c = num(r.c, 3); x.labels = r.labels }))
      break
    }
    case 'stats': {
      const st = d as StatsData
      const r = await formDialog('Statistics', [
        { key: 'data', label: 'The numbers (spaces, commas or one per line; paste a column):', value: st.data, type: 'code', rows: 6 },
        { key: 'xlabel', label: 'What they measure:', value: st.xlabel },
        { key: 'bins', label: 'Bars (histogram):', value: String(st.bins), type: 'number' },
      ])
      if (r) run(W.updateWidget<'stats'>(x => { x.data = r.data; x.xlabel = r.xlabel; x.bins = Math.round(num(r.bins, 7)) }))
      break
    }
    case 'unitcircle': {
      const r = await formDialog('Unit circle', [{ key: 'angles', label: 'Angles in degrees, separated by commas:', value: (d as UnitCircleData).angles }])
      if (r) run(W.updateWidget<'unitcircle'>(x => { x.angles = r.angles }))
      break
    }
    default: return false
  }
  sync()
  return true
}

function insert(kind: WidgetKind): Handler {
  return () => { run(W.insertWidget(kind)); sync() }
}

const actions: Record<string, Handler> = {
  sci_risk: insert('risk'), sci_signs: insert('signs'),
  sci_forces: insert('forces'), sci_optics: insert('optics'), sci_wave: insert('wave'), sci_levels: insert('levels'),
  sci_function: insert('function'), sci_numberline: insert('numberline'), sci_venn: insert('venn'),
  sci_triangle: insert('triangle'), sci_stats: insert('stats'), sci_unitcircle: insert('unitcircle'),
  sg_captions: upd('signs', (d: SignsData) => { d.captions = !d.captions }),
  ...Object.fromEntries(SIGNS.map(([k]) => [`sg_${k}`, upd('signs', (d: SignsData) => {
    d.signs = d.signs.includes(k) ? d.signs.filter(x => x !== k) : [...d.signs, k]
  })])),
  fb_box: upd('forces', (d: ForcesData) => { d.object = 'box' }),
  fb_ball: upd('forces', (d: ForcesData) => { d.object = 'ball' }),
  fb_slope: upd('forces', (d: ForcesData) => { d.object = 'slope' }),
  op_converging: upd('optics', (d: OpticsData) => { d.lens = 'converging' }),
  op_diverging: upd('optics', (d: OpticsData) => { d.lens = 'diverging' }),
  wv_labels: upd('wave', (d: WaveData) => { d.labels = !d.labels }),
  wv_second: upd('wave', (d: WaveData) => { d.second = !d.second }),
  ...Object.fromEntries(WAVE_KINDS.map(([k]) => [`wv_k_${k}`, upd('wave', (d: WaveData) => { d.kind = k })])),
  wv_kind: () => {},
  wv_x: upd('wave', (d: WaveData) => { d.axis = 'x' }),
  wv_t: upd('wave', (d: WaveData) => { d.axis = 't' }),
  wv_axes: upd('wave', (d: WaveData) => { d.axes = d.axes === false }),
  wv_peaks: upd('wave', (d: WaveData) => { d.peaks = !d.peaks }),
  wv_arrow: upd('wave', (d: WaveData) => { d.arrow = !d.arrow }),
  fn_grid: upd('function', (d: FunctionData) => { d.grid = !d.grid }),
  tri_angles: upd('triangle', (d: TriangleData) => { d.angles = !d.angles }),
  st_hist: upd('stats', (d: StatsData) => { d.kind = 'histogram' }),
  st_box: upd('stats', (d: StatsData) => { d.kind = 'boxplot' }),
  uc_proj: upd('unitcircle', (d: UnitCircleData) => { d.projections = !d.projections }),
}

registerActions(actions)

// ---------------------------------------------------------------- Geometry


export async function editGeometry(): Promise<boolean> {
  const s = state()
  const w = s && W.currentWidget(s)
  if (!w || w.widget.kind !== 'geometry') return false
  const g = w.widget.data as GeometryData
  if (g.shape === 'custom') {
    const r = await formDialog('Geometry: your own figure', [{ key: 'script', label: 'Points and shapes:', value: g.script, type: 'code', rows: 16, help: GEO_HELP }])
    if (r) run(W.updateWidget<'geometry'>(x => { x.script = r.script }))
  } else {
    const r = await formDialog('Geometry', [
      { key: 'shape', label: 'Shape:', value: GEO_SHAPES.find(([k]) => k === g.shape)![1], type: 'select', options: GEO_SHAPES.map(([, n]) => n) },
      ...GEO_PARAMS[g.shape].map(([k, label]) => ({ key: String(k), label: `${label}:`, value: String(g[k]), type: 'number' as const })),
      { key: 'names', label: 'Corner names, in order:', value: g.names, help: 'To change anything else (move a corner, add a line, a circle, a label), use Edit as Points on the Geometry tab.' },
    ])
    if (r) run(W.updateWidget<'geometry'>(x => {
      x.shape = GEO_SHAPES.find(([, n]) => n === r.shape)![0]
      for (const [k] of GEO_PARAMS[g.shape]) if (r[String(k)] !== undefined) (x as unknown as Record<string, number>)[String(k)] = num(r[String(k)], Number(x[k]))
      x.names = r.names
      if (x.shape === 'custom' && !x.script.trim()) x.script = presetScript({ ...x, shape: g.shape })
    }))
  }
  sync()
  return true
}

registerActions({
  sci_geometry: insert('geometry'),
  ...Object.fromEntries(GEO_SHAPES.map(([k]) => [`geo_${k}`, upd('geometry', (d: GeometryData) => {
    // Free mode starts from the figure on the page.
    if (k === 'custom' && d.shape !== 'custom') d.script = presetScript(d)
    d.shape = k as GeoShape
  })])),
  geo_points: upd('geometry', (d: GeometryData) => { if (d.shape !== 'custom') { d.script = presetScript(d); d.shape = 'custom' } }),
  geo_sides: upd('geometry', (d: GeometryData) => { d.sides = !d.sides }),
  geo_angles: upd('geometry', (d: GeometryData) => { d.angles = !d.angles }),
  geo_ticks: upd('geometry', (d: GeometryData) => { d.ticks = !d.ticks }),
  geo_fill: upd('geometry', (d: GeometryData) => { d.fill = !d.fill }),
})
