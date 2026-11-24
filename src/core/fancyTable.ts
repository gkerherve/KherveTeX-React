// Table Design ▸ Fancy styles: a table drawn in one colour. Stored in
// Table.style as "<kind>:<RRGGBB>" so files stay plain JSON (the Python
// app reads an unknown style as the default lines).
//   banded  a filled header row (white bold text) and tinted alternate rows
//   header  a filled header row and thin grey lines between the rows
//   accent  no fill: thick coloured rules above and below, a thin one under
//           the header, the header's text in the colour

export type FancyKind = 'banded' | 'header' | 'accent'
export const FANCY_KINDS: [FancyKind, string][] = [['banded', 'Banded'], ['header', 'Coloured header'], ['accent', 'Accent lines']]
export const FANCY_DEFAULT = '1F6FB5'
// The colours offered on the ribbon (the callout boxes' palette).
export const FANCY_COLORS: [string, string][] = [
  ['1F6FB5', 'Blue'], ['2E7D32', 'Green'], ['00838F', 'Teal'], ['6A1B9A', 'Purple'],
  ['E65100', 'Orange'], ['C62828', 'Red'], ['37474F', 'Slate'], ['5D4037', 'Brown'],
]

export function parseFancy(style: string | null | undefined): { kind: FancyKind; color: string } | null {
  const m = /^(banded|header|accent):#?([0-9a-fA-F]{6})$/.exec(style ?? '')
  return m ? { kind: m[1] as FancyKind, color: m[2].toUpperCase() } : null
}

export const fancyStyle = (kind: FancyKind, color: string): string => `${kind}:${color.replace('#', '').toUpperCase()}`

// The colour mixed with white: pct of the colour (0-100), as RRGGBB.
export function tint(hex: string, pct: number): string {
  const h = hex.replace('#', '')
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16)
    return Math.round(255 - (255 - v) * pct / 100).toString(16).padStart(2, '0')
  }
  return (ch(0) + ch(2) + ch(4)).toUpperCase()
}

export const FANCY_RULE_GREY = 'BFBFBF'
