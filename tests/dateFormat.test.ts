import { describe, expect, it } from 'vitest'
import { dateCommand, formatDate } from '../src/core/dateFormat.ts'

describe('title date', () => {
  const d = new Date(2026, 10, 9)
  it('formats', () => {
    expect(formatDate('d_month_y', d)).toBe('9 November 2026')
    expect(formatDate('month_d_y', d)).toBe('November 9, 2026')
    expect(formatDate('dd_mm_yyyy', d)).toBe('09/11/2026')
    expect(formatDate('iso', d)).toBe('2026-11-09')
    expect(formatDate('', d, true)).toBe('9 November 2026')
  })
  it('writes \\date only when needed', () => {
    expect(dateCommand({}, d)).toBe('')
    expect(dateCommand({ show_date: false, date_format: 'iso' }, d)).toBe('\\date{}')
    expect(dateCommand({ date_format: 'month_y' }, d)).toBe('\\date{November 2026}')
  })
})
