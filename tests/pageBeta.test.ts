import { describe, expect, it } from 'vitest'
import { BETA_CLASSES, BETA_EXAMPLES, isBetaPage } from '../src/ui/pageBeta.ts'
import { GALLERY, TEMPLATE_CHOICES } from '../src/ui/ribbonModel.ts'

describe('page view beta list', () => {
  it('names only real gallery examples and classes', () => {
    const labels = new Set(GALLERY.flatMap(([, , items]) => items))
    for (const l of BETA_EXAMPLES) expect(labels.has(l), l).toBe(true)
    for (const c of BETA_CLASSES) expect((TEMPLATE_CHOICES as readonly string[]).includes(c), c).toBe(true)
  })

  it('follows the class or the example', () => {
    expect(isBetaPage('beamer', null)).toBe(true)
    expect(isBetaPage('article', 'Monthly planner')).toBe(true)
    expect(isBetaPage('article', 'Single-column article')).toBe(false)
    expect(isBetaPage('article', null)).toBe(false)
  })
})
