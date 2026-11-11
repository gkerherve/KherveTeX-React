// Resizing a picture with Word's eight handles (paged_edit.py
// mouseMoveEvent, editor._on_image_resized).
import { describe, expect, it } from 'vitest'
import { figureWidthPx, resizedWidth, widthSpec } from '../src/editor/views.ts'

describe('figure handles', () => {
  it('a side or corner handle follows the mouse sideways', () => {
    expect(resizedWidth('e', 200, 100, 50, 0, 500)).toBe(250)
    expect(resizedWidth('se', 200, 100, -50, 30, 500)).toBe(150)
    expect(resizedWidth('w', 200, 100, -50, 0, 500)).toBe(250)
    expect(resizedWidth('nw', 200, 100, 40, 0, 500)).toBe(160)
  })
  it('the top and bottom handles scale by the height', () => {
    expect(resizedWidth('s', 200, 100, 0, 50, 500)).toBe(300)
    expect(resizedWidth('n', 200, 100, 0, 50, 500)).toBe(100)
  })
  it('stays between 24 px and the text width', () => {
    expect(resizedWidth('e', 200, 100, 900, 0, 500)).toBe(500)
    expect(resizedWidth('e', 200, 100, -900, 0, 500)).toBe(24)
  })
  it('records the width as a share of the text width', () => {
    expect(widthSpec(265, 500)).toBe('0.53\\textwidth')
    expect(widthSpec(600, 500)).toBe('1.00\\textwidth')
    expect(widthSpec(5, 500)).toBe('0.05\\textwidth')
    expect(figureWidthPx(widthSpec(265, 500), 500)).toBeCloseTo(265, 0)
  })
})
