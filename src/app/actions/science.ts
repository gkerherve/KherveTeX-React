// The Science tab: quantities with units, constants, physics notation,
// nuclides and decays, significant figures and errors, matrices (ordinary
// maths), and the drawn science elements (data plot, circuit, Feynman, MO,
// Bohr, element tiles, hazard labels, reaction scheme, algorithm, lab
// notebook) - their insert commands, Edit… dialogs and tab options.
import { mathBlock, mathInline } from '../../core/model.ts'
import {
  CONSTANTS, decayTex, matrixTex, nuclideTex, PHYSICS, propagate, quantityTex, roundedTex,
  type Bracket, type Decay, type MatrixFill, type Op,
} from '../../core/sciMath.ts'
import { element, ELEMENTS } from '../../core/elements.ts'
import {
  CIRCUIT_PARTS, FEYNMAN_PROCESSES, GHS, MO_MOLECULES, type AlgorithmData, type BohrData, type CircuitData, type ElementTileData,
  type FeynmanData, type HazardData, type MoData, type NotebookData, type PlotData, type SchemeData,
} from '../../core/science.ts'
import type { WidgetKind } from '../../core/widgets.ts'
import * as C from '../../editor/commands.ts'
import { editor } from '../../editor/controller.ts'
import * as W from '../../editor/widgetCommands.ts'
import { formDialog } from '../../ui/dialogs/EditorDialogs.tsx'
import { registerActions, type Handler } from '../actions.ts'
import { NOTEBOOK_TEMPLATES, notebookSections } from '../../core/science.ts'
import { notebookDialog } from '../../ui/dialogs/NotebookDialog.tsx'

import { editorApi } from '../editorApi.ts'
import { appStore } from '../store.ts'

const run = (cmd: C.Command): boolean => editor()?.run(cmd) ?? false
const sync = () => editor()?.syncToolbar()
const state = () => editor()?.view.state ?? null
const status = (s: string) => appStore().set({ status: s })
const lines = (s: string) => s.split('\n').map(l => l.trim()).filter(l => l)
const num = (s: string) => parseFloat(s.replace(',', '.').replace(/\s/g, ''))
const inline = (latex: string) => editorApi()?.insertInline(mathInline(latex))
const block = (latex: string) => editorApi()?.insertBlock(mathBlock(latex, false, null))

function upd(kind: WidgetKind, fn: (d: any) => void): Handler {
  return () => {
    const s = state()
    const w = s && W.currentWidget(s)
    if (!w || w.widget.kind !== kind) return
    run(W.updateWidget(d => { fn(d) }))
    sync()
  }
}

// The lab notebook's own window: sections and their blocks, added with buttons.
async function editNotebook(n: NotebookData, addSection: boolean) {
  const r = await notebookDialog({ date: n.date, title: n.title, sections: notebookSections(n) }, addSection)
  if (r) run(W.updateWidget<'notebook'>(x => { x.date = r.date; x.title = r.title; x.sections = r.sections.filter(t => t.heading || t.text); delete x.aim; delete x.method; delete x.observations; delete x.result }))
}

// Edit… for the science elements; false when the selection is not one.
export async function editScience(): Promise<boolean> {
  const s = state()
  const w = s && W.currentWidget(s)
  if (!w) return false
  const d = w.widget.data as any
  switch (w.widget.kind) {
    case 'plot': {
      const p = d as PlotData
      const r = await formDialog('Edit data plot', [
        { key: 'title', label: 'Title (optional):', value: p.title },
        { key: 'xlabel', label: 'x axis:', value: p.xlabel },
        { key: 'ylabel', label: 'y axis:', value: p.ylabel },
        { key: 'data', label: 'Data (paste from a spreadsheet or a CSV / text file):', value: p.data, type: 'code', rows: 10,
          help: 'One point per line: x, y (more columns: more curves). An optional first line names the columns.' },
        { key: 'peaks', label: 'Peak labels:', value: p.peaks, type: 'textarea', rows: 3, help: 'x: label, one per line, e.g. "458.8: Ti 2p3/2".' },
      ])
      if (r) run(W.updateWidget<'plot'>(x => { x.title = r.title.trim(); x.xlabel = r.xlabel; x.ylabel = r.ylabel; x.data = r.data; x.peaks = r.peaks }))
      break
    }
    case 'circuit': {
      const c = d as CircuitData
      const r = await formDialog('Edit circuit', [{ key: 'components', label: 'Components, in order around the circuit:', value: c.components, type: 'textarea',
        help: `One per line: the part, then its label, e.g. "resistor R1 = 100 Ω". Parts: ${CIRCUIT_PARTS.join(', ')}. The first is the source.` }])
      if (r) run(W.updateWidget<'circuit'>(x => { x.components = r.components }))
      break
    }
    case 'feynman': {
      const f = d as FeynmanData
      const names = FEYNMAN_PROCESSES.map(([, n]) => n)
      const r = await formDialog('Edit Feynman diagram', [
        { key: 'process', label: 'Process:', value: FEYNMAN_PROCESSES.find(([k]) => k === f.process)![1], type: 'select', options: names },
        { key: 'labels', label: 'Particle labels (in, in, out, out, exchanged):', value: f.labels.join(', '), help: 'Leave as they are to keep the process\'s own.' },
      ])
      if (r) run(W.updateWidget<'feynman'>(x => {
        const p = FEYNMAN_PROCESSES.find(([, n]) => n === r.process)!
        const changed = p[0] !== x.process
        x.process = p[0]
        x.labels = changed ? [...p[2]] : r.labels.split(',').map(t => t.trim())
      }))
      break
    }
    case 'mo': {
      const r = await formDialog('MO diagram', [{ key: 'molecule', label: 'Molecule:', value: (d as MoData).molecule, type: 'select', options: MO_MOLECULES }])
      if (r) run(W.updateWidget<'mo'>(x => { x.molecule = r.molecule }))
      break
    }
    case 'bohr': {
      const r = await formDialog('Bohr model', [{ key: 'element', label: 'Element (symbol, name or atomic number):', value: (d as BohrData).element }])
      if (r && element(r.element)) run(W.updateWidget<'bohr'>(x => { x.element = r.element.trim() }))
      else if (r) status(`No element "${r.element}".`)
      break
    }
    case 'element': {
      const e = d as ElementTileData
      const r = await formDialog('Element tiles', [{ key: 'elements', label: 'Elements (symbols, names or numbers, separated by commas):', value: e.elements }])
      if (r) run(W.updateWidget<'element'>(x => { x.elements = r.elements }))
      break
    }
    case 'hazard': {
      const h = d as HazardData
      const r = await formDialog('Hazard labels', [
        { key: 'pictograms', label: 'Pictograms:', value: h.pictograms.join(', '), help: `Any of: ${GHS.map(([k, n]) => `${k} (${n})`).join(', ')}.` },
        { key: 'signal', label: 'Signal word:', value: h.signal, type: 'select', options: ['Danger', 'Warning', ''] },
        { key: 'statements', label: 'H and P statements, one per line:', value: h.statements, type: 'textarea', help: 'e.g. H225, H319, P210, P280: their wording is filled in.' },
      ])
      if (r) run(W.updateWidget<'hazard'>(x => {
        x.pictograms = r.pictograms.split(/[,\s]+/).filter(p => GHS.some(([k]) => k === p))
        x.signal = r.signal as HazardData['signal']
        x.statements = r.statements
      }))
      break
    }
    case 'scheme': {
      const sc = d as SchemeData
      const text = sc.steps.map((st, i) => `${st.name} | ${st.chemfig}` + (i < sc.arrows.length ? `\n-> ${sc.arrows[i].above} | ${sc.arrows[i].below}` : '')).join('\n')
      const r = await formDialog('Reaction scheme', [{ key: 'text', label: 'Molecules and arrows:', value: text, type: 'code', rows: 10,
        help: 'A molecule: name | chemfig formula (e.g. ethanol | CH_3-CH_2-OH). An arrow between two: -> above | below.' }])
      if (r) run(W.updateWidget<'scheme'>(x => {
        x.steps = []; x.arrows = []
        for (const l of lines(r.text)) {
          if (l.startsWith('->')) { const [a = '', b = ''] = l.slice(2).split('|').map(t => t.trim()); x.arrows[Math.max(0, x.steps.length - 1)] = { above: a, below: b } }
          else { const [name = '', fig = ''] = l.split('|').map(t => t.trim()); x.steps.push({ name, chemfig: fig || name }) }
        }
        for (let i = 0; i < x.steps.length - 1; i++) x.arrows[i] = x.arrows[i] ?? { above: '', below: '' }
      }))
      break
    }
    case 'algorithm': {
      const a = d as AlgorithmData
      const r = await formDialog('Algorithm', [
        { key: 'title', label: 'Caption:', value: a.title },
        { key: 'code', label: 'Pseudocode (indent the body of if / for / while / function):', value: a.code, type: 'code', rows: 12,
          help: 'Keywords: function name(args), if … then, else, else if, for …, while …, return …; "x = …" becomes x ← …; $…$ is maths.' },
      ])
      if (r) run(W.updateWidget<'algorithm'>(x => { x.title = r.title.trim(); x.code = r.code }))
      break
    }
    case 'notebook':
      await editNotebook(d as NotebookData, false)
      break
    default: return false
  }
  sync()
  return true
}

function insert(kind: WidgetKind): Handler {
  return () => { run(W.insertWidget(kind)); sync() }
}

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

const actions: Record<string, Handler> = {
  sci_plot: insert('plot'),
  sci_circuit: insert('circuit'),
  sci_feynman: insert('feynman'),
  sci_mo: insert('mo'),
  sci_bohr: insert('bohr'),
  sci_element: insert('element'),
  sci_hazard: insert('hazard'),
  sci_scheme: insert('scheme'),
  sci_algorithm: insert('algorithm'),
  sci_notebook: () => { run(W.insertWidget('notebook')); run(W.updateWidget<'notebook'>(x => { x.date = today() })); sync() },

  // A quantity with its unit and uncertainty.
  sci_units: async () => {
    const r = await formDialog('Quantity with units', [
      { key: 'value', label: 'Value:', value: '9.81', help: 'e.g. 6.02e23 for 6.02 × 10²³.' },
      { key: 'unc', label: 'Uncertainty (optional):', value: '' },
      { key: 'unit', label: 'Unit:', value: 'm/s^2', help: 'e.g. kg m/s^2, J/(mol K) as J/mol/K, µm, °C, Ω, eV, %.' },
    ], 'Insert')
    if (r && r.value.trim()) inline(quantityTex(r.value, r.unc, r.unit))
  },
  // Rounds a value to its uncertainty; with a second quantity, combines them.
  sci_sigfig: async () => {
    const r = await formDialog('Significant figures and errors', [
      { key: 'a', label: 'Value A:', value: '9.8123' }, { key: 'da', label: 'Uncertainty of A:', value: '0.0234' },
      { key: 'op', label: 'Combine with B (optional):', value: '', type: 'select', options: ['', '+', '-', '×', '÷'] },
      { key: 'b', label: 'Value B:', value: '' }, { key: 'db', label: 'Uncertainty of B:', value: '' },
      { key: 'unit', label: 'Unit of the result:', value: '' },
    ], 'Insert')
    if (!r) return
    const op = r.op as Op
    const a = num(r.a), da = num(r.da)
    if (!Number.isFinite(a)) { status('Value A is not a number.'); return }
    const res = op ? propagate(a, da || 0, num(r.b), num(r.db) || 0, op) : { v: a, u: da || 0 }
    inline(roundedTex(res.v, res.u, r.unit))
    status(`${op ? 'Combined and rounded' : 'Rounded'}: the uncertainty to 1 significant figure (2 if it starts with 1), the value to match.`)
  },
  sci_nuclear: async () => {
    const r = await formDialog('Nuclide or decay', [
      { key: 'el', label: 'Element (symbol, name or atomic number):', value: 'U' },
      { key: 'a', label: 'Mass number A:', value: '238', type: 'number' },
      { key: 'decay', label: 'Decay:', value: '', type: 'select', options: ['', 'alpha', 'beta-', 'beta+', 'gamma'] },
    ], 'Insert')
    if (!r) return
    const el = element(r.el)
    if (!el) { status(`No element "${r.el}".`); return }
    const a = Math.round(num(r.a)) || Math.round(Number(el.mass))
    if (r.decay) block(decayTex(el.symbol, a, r.decay as Decay))
    else inline(nuclideTex(el.symbol, a, el.z))
  },
  sci_matrix: async () => {
    const r = await formDialog('Matrix', [
      { key: 'rows', label: 'Rows:', value: '3', type: 'number' }, { key: 'cols', label: 'Columns:', value: '3', type: 'number' },
      { key: 'bracket', label: 'Brackets:', value: '( )', type: 'select', options: ['( )', '[ ]', '{ }', '| | (determinant)', '‖ ‖', 'none'] },
      { key: 'fill', label: 'Fill with:', value: 'a₁₁, a₁₂ …', type: 'select', options: ['a₁₁, a₁₂ …', 'zeros', 'identity', 'general m × n (with dots)'] },
      { key: 'name', label: 'Letter:', value: 'a' },
    ], 'Insert')
    if (!r) return
    const br: Record<string, Bracket> = { '( )': 'pmatrix', '[ ]': 'bmatrix', '{ }': 'Bmatrix', '| | (determinant)': 'vmatrix', '‖ ‖': 'Vmatrix', none: 'matrix' }
    const fl: Record<string, MatrixFill> = { 'a₁₁, a₁₂ …': 'symbols', zeros: 'zeros', identity: 'identity', 'general m × n (with dots)': 'general' }
    block(matrixTex(Math.round(num(r.rows)) || 3, Math.round(num(r.cols)) || 3, br[r.bracket], fl[r.fill], r.name.trim() || 'a'))
  },
  sci_constants: () => {},
  ...Object.fromEntries(CONSTANTS.map(([, tex], i) => [`sci_const_${i}`, () => inline(tex)])),
  sci_physics: () => {},
  ...Object.fromEntries(PHYSICS.map(([, tex], i) => [`sci_phys_${i}`, () => inline(tex)])),

  // Tab options.
  plot_reverse: upd('plot', (d: PlotData) => { d.reverse_x = !d.reverse_x }),
  plot_points: upd('plot', (d: PlotData) => { d.points = !d.points }),
  plot_yticks: upd('plot', (d: PlotData) => { d.y_ticks = !d.y_ticks }),
  circ_series: upd('circuit', (d: CircuitData) => { d.layout = 'series' }),
  circ_parallel: upd('circuit', (d: CircuitData) => { d.layout = 'parallel' }),
  ...Object.fromEntries(FEYNMAN_PROCESSES.map(([k, , labels]) => [`fey_${k}`, upd('feynman', (d: FeynmanData) => { d.process = k; d.labels = [...labels] })])),
  ...Object.fromEntries(MO_MOLECULES.map(m => [`mo_${m}`, upd('mo', (d: MoData) => { d.molecule = m })])),
  el_mass: upd('element', (d: ElementTileData) => { d.show_mass = !d.show_mass }),
  ...Object.fromEntries(GHS.map(([k]) => [`ghs_${k}`, upd('hazard', (d: HazardData) => {
    d.pictograms = d.pictograms.includes(k) ? d.pictograms.filter(p => p !== k) : [...d.pictograms, k]
  })])),
  hz_danger: upd('hazard', (d: HazardData) => { d.signal = 'Danger' }),
  hz_warning: upd('hazard', (d: HazardData) => { d.signal = 'Warning' }),
  alg_numbers: upd('algorithm', (d: AlgorithmData) => { d.numbers = !d.numbers }),
  // Lab notebook: add a section, start from a template, layout, signature.
  nb_add: async () => {
    const s = state()
    const w = s && W.currentWidget(s)
    if (w && w.widget.kind === 'notebook') { await editNotebook(w.widget.data as NotebookData, true); sync() }
  },
  ...Object.fromEntries(NOTEBOOK_TEMPLATES.map(([name, heads]) => [`nb_tpl_${name.replace(/\W/g, '')}`, upd('notebook', (d: NotebookData) => {
    // Keep any text already written under a heading of the same name.
    const old = new Map(notebookSections(d).map(x => [x.heading.toLowerCase(), x.text]))
    d.sections = heads.map(h => ({ heading: h, text: old.get(h.toLowerCase()) ?? '' }))
  })])),
  nb_beside: upd('notebook', (d: NotebookData) => { d.layout = 'beside' }),
  nb_above: upd('notebook', (d: NotebookData) => { d.layout = 'above' }),
  nb_signature: upd('notebook', (d: NotebookData) => { d.signature = !d.signature }),
}
void ELEMENTS

registerActions(actions)
