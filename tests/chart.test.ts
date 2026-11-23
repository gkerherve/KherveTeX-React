import { describe, expect, test } from 'vitest'
import { CHART_KINDS, chartData, chartScene, chartSpecFrom, newChartSpec, parseSheet, seriesFor } from '../src/core/chart.ts'
import * as M from '../src/core/model.ts'
import { serializeDocument } from '../src/core/serializer.ts'

describe('charts', () => {
  test('every chart type draws', () => {
    for (const { kind } of CHART_KINDS) {
      const sc = chartScene(newChartSpec(kind))
      expect(sc.items.length, kind).toBeGreaterThan(10)
    }
  })
  test('a sheet pasted from Excel (tabs) or a CSV', () => {
    expect(parseSheet('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseSheet('a;b\n1,5;2')).toEqual([['a', 'b'], ['1,5', '2']])
  })
  test('decimal commas, empty cells and text X values', () => {
    const s = newChartSpec('scatter')
    s.rows = [['x', 'y'], ['A', '1,5'], ['B', ''], ['C', '3']]
    const d = chartData(s)!
    expect(d.xs).toEqual([1, 2, 3])
    expect(d.values[0][0]).toBe(1.5)
    expect(Number.isNaN(d.values[0][1])).toBe(true)
  })
  test('a saved spec reads back, with a style for each series', () => {
    const s = newChartSpec('line')
    s.rows[0].push('Series 4')
    const back = chartSpecFrom(JSON.parse(JSON.stringify({ ...s, series: s.series.slice(0, 1) })))!
    expect(back.kind).toBe('line')
    expect(seriesFor(back)).toHaveLength(4)
    expect(chartSpecFrom({ kind: 'nope', rows: [] })).toBeNull()
  })
  test('LaTeX includes the chart PDF', () => {
    const doc = M.document([M.figure({ path: 'figures/chart_001.png', source: 'chart', caption: 'Yields' })] as M.Block[])
    expect(serializeDocument(doc)).toContain('figures/chart_001.pdf')
  })
})
