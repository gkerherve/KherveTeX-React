// Paper sizes in inches; the same identifiers reach LaTeX's geometry package.

export const DPI = 96

export interface PageSize {
  code: string
  geometry_option: string
  width_in: number
  height_in: number
}

export const A4: PageSize = { code: 'A4', geometry_option: 'a4paper', width_in: 8.27, height_in: 11.69 }
export const LETTER: PageSize = { code: 'Letter', geometry_option: 'letterpaper', width_in: 8.5, height_in: 11.0 }
export const LEGAL: PageSize = { code: 'Legal', geometry_option: 'legalpaper', width_in: 8.5, height_in: 14.0 }

export const ALL: PageSize[] = [A4, LETTER, LEGAL]

export const widthPx = (p: PageSize) => Math.round(p.width_in * DPI)
export const heightPx = (p: PageSize) => Math.round(p.height_in * DPI)

export function byCode(code: string): PageSize {
  return ALL.find((p) => p.code.toLowerCase() === code.toLowerCase()) ?? A4
}
