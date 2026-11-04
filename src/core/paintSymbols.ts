// The spec-library symbol modules (khervedoc/paint/<name>.py), keyed by
// the module's last name component — the "<lib>" of a placed symbol's id
// "<lib>:<name>" (PaintScene._place_symbol) and of the MCP authoring
// LIBRARIES tuple, in that tuple's order.

import * as flowchart from './paintSymFlowchart.ts'
import * as electrical from './paintSymElectrical.ts'
import * as optics from './paintSymOptics.ts'
import * as maths from './paintSymMaths.ts'
import * as labware from './paintSymLabware.ts'
import * as arrows from './paintSymArrows.ts'

// One shape-spec dict (the AI/example format): "shape" plus its geometry
// and style keys, in the order the Python builder writes them.
export type SymbolSpec = Record<string, string | number>
export type SymbolBuilder = (w: number, h: number) => SymbolSpec[]

export interface SymbolModule {
  readonly NAME: string
  readonly REFERENCE_MM: number
  readonly SIZES: Record<string, [number, number]>
  readonly LABELS: Record<string, string>
  readonly CATEGORIES: [string, string[]][] | undefined
  sizeMm(name: string): [number, number]
  buildSpecs(name: string, w: number, h: number): SymbolSpec[]
}

export const SYMBOL_MODULES = { flowchart, electrical, optics, maths, labware, arrows } satisfies Record<
  string,
  SymbolModule
>
