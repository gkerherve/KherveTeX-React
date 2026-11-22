// An imported .tex finds its pictures: \graphicspath, no extension, or a
// figures/ / images/ folder beside it.
import { describe, expect, it } from 'vitest'
import { figureCandidates, graphicsPaths, locateFigures } from '../src/core/texFigures.ts'
import { document, figure } from '../src/core/model.ts'
import type { Figure } from '../src/core/model.ts'

const onDisk = (...files: string[]) => async (p: string) => files.includes(p)

describe('graphicsPaths', () => {
  it('reads the folders, not commented ones', () => {
    expect(graphicsPaths('\\graphicspath{{./figures/}{img/}}')).toEqual(['figures', 'img'])
    expect(graphicsPaths('% \\graphicspath{{x/}}\n')).toEqual([])
  })
})

describe('figureCandidates', () => {
  it('tries the path, the graphicspath folders, then the usual folders, with LaTeX extensions', () => {
    const c = figureCandidates('plot', ['figs'])
    expect(c.slice(0, 3)).toEqual(['plot', 'plot.pdf', 'plot.png'])
    expect(c.indexOf('figs/plot.png')).toBeGreaterThan(c.indexOf('plot.png'))
    expect(c).toContain('images/plot.jpg')
    expect(figureCandidates('a.png')).toContain('figures/a.png')
  })
})

describe('locateFigures', () => {
  it('points each figure at the file found beside the .tex', async () => {
    const doc = document([
      figure({ path: 'decay' }),
      figure({ path: 'setup.jpg' }),
      figure({ path: 'figs/old.png' }),
      figure({ path: 'ok.png', extra: [{ path: 'side' }] }),
      figure({ path: 'missing.png' }),
    ])
    const n = await locateFigures(doc, '\\graphicspath{{plots/}}', '/paper', onDisk(
      '/paper/plots/decay.pdf', '/paper/images/setup.jpg', '/paper/Figures/old.png', '/paper/ok.png', '/paper/figures/side.png'))
    expect(doc.children.map((b) => (b as Figure).path)).toEqual(
      ['plots/decay.pdf', 'images/setup.jpg', 'Figures/old.png', 'ok.png', 'missing.png'])
    expect((doc.children[3] as Figure).extra![0].path).toBe('figures/side.png')
    expect(n).toBe(4)
  })

  it('leaves absolute paths and URLs alone', async () => {
    const doc = document([figure({ path: '/abs/x.png' })])
    expect(await locateFigures(doc, '', '/p', onDisk('/p/figures/x.png'))).toBe(0)
  })
})
