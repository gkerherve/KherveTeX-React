// history_dialog.py's pure parts: the diff highlighter's line classes, the
// rail colours and the width of the graph column.
import { describe, expect, it } from 'vitest'

// Loaded by path at run time: the tests' tsconfig (nodenext) does not
// type-check the app's bundler-style imports.
const load = (p: string) => import(/* @vite-ignore */ p)
const { diffLineKind, graphColWidth, railColour } = await load('../src/ui/dialogs/HistoryDialog.tsx')

interface GraphRow {
  oid: string; short_oid: string; timestamp: string; epoch: number; author: string; subject: string
  body: string; parents: string[]; rail: number; rails_before: [number, number][]
  rails_after: [number, number][]; branches: string[]; is_merge: boolean
}

const row = (over: Partial<GraphRow>): GraphRow => ({
  oid: 'a'.repeat(40), short_oid: 'aaaaaaaa', timestamp: '2026-01-01T00:00:00', epoch: 0,
  author: 'A <a@b>', subject: 's', body: '', parents: [], rail: 0, rails_before: [], rails_after: [],
  branches: [], is_merge: false, ...over,
})

describe('_DiffHighlighter', () => {
  it('classifies lines as the Qt highlighter does', () => {
    expect(diffLineKind('diff --git a/x b/x')).toBe('header')
    expect(diffLineKind('index 123..456')).toBe('header')
    expect(diffLineKind('new file mode 100644')).toBe('header')
    expect(diffLineKind('--- a/x')).toBe('header')
    expect(diffLineKind('+++ b/x')).toBe('header')
    expect(diffLineKind('@@ -1 +1,2 @@')).toBe('hunk')
    expect(diffLineKind('+second line')).toBe('add')
    expect(diffLineKind('-old')).toBe('del')
    expect(diffLineKind(' hello world')).toBe('plain')
    expect(diffLineKind('')).toBe('plain')
  })
})

describe('_GraphDelegate', () => {
  it('cycles eight rail colours', () => {
    expect(railColour(0)).toBe('#1a6dd8')
    expect(railColour(8)).toBe('#1a6dd8')
    expect(railColour(1)).toBe('#d96b00')
  })

  it('sizes the graph column for the rails and the widest label', () => {
    // GRAPH_PAD + max_rail * GRAPH_COL_W + max_label_w + 20
    expect(graphColWidth([row({})])).toBe(8 + 16 + 0 + 20)
    expect(graphColWidth([row({ rail: 1, branches: ['dev'] }), row({ rails_after: [[2, 2]] })]))
      .toBe(8 + 3 * 16 + (3 * 8 + 20) + 20)
  })
})
