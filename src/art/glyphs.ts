/**
 * Icon geometry (rendered by src/art/icons.tsx). Authored on small grids,
 * 1 unit = 1 px at the default size; strokes are non-scaling 1.25 px.
 *
 *   grid     glyph
 *   16       close, zoomIn, zoomOut, resetView, brokenPlate
 *   8x14     chevronLeft / chevronRight (prev / next)
 *   7x12     back
 *   22       mail, github, linkedin (footer actions)
 */
export interface Glyph {
  w: number
  h: number
  /** stroked geometry */
  d: string
  /** small filled marks (pivot dots), cut with the same groove */
  dots?: { cx: number; cy: number; r: number }[]
  join?: 'round' | 'miter'
}

/** circle as two arcs (keeps every glyph a single path) */
const ring = (cx: number, cy: number, r: number) =>
  `M${cx + r},${cy}A${r},${r} 0 1 1 ${cx - r},${cy}A${r},${r} 0 1 1 ${cx + r},${cy}`

export const GLYPHS = {
  close: { w: 16, h: 16, d: 'M3,3L13,13M13,3L3,13' },
  chevronLeft: { w: 8, h: 14, d: 'M7,1L1,7L7,13' },
  chevronRight: { w: 8, h: 14, d: 'M1,1L7,7L1,13' },
  /** "All places": the 7x12 chevron */
  back: { w: 7, h: 12, d: 'M6.5,0.5L1,6L6.5,11.5' },
  zoomIn: { w: 16, h: 16, d: `${ring(7, 7, 5.5)}M11,11L14.5,14.5M4.5,7H9.5M7,4.5V9.5` },
  zoomOut: { w: 16, h: 16, d: `${ring(7, 7, 5.5)}M11,11L14.5,14.5M4.5,7H9.5` },
  /** the limb in miniature: ring, four inward cardinal ticks, a pivot */
  resetView: { w: 16, h: 16, d: `${ring(8, 8, 6)}M8,2v2M14,8h-2M8,14v-2M2,8h2`, dots: [{ cx: 8, cy: 8, r: 0.75 }] },
  /** a photograph that failed to load: a plate with one diagonal cut */
  brokenPlate: { w: 16, h: 16, d: 'M2,3H14V13H2ZM5,13L11,3', join: 'miter' },
  /** envelope, square joins */
  mail: { w: 22, h: 22, d: 'M3,5H19V17H3ZM3.5,6L11,12L18.5,6', join: 'miter' },
  /** the octocat re-drawn as one outline plus its tail */
  github: {
    w: 22,
    h: 22,
    d:
      'M8.4,19.8V17.2C5.3,16.7 3.8,14.6 3.8,11.4C3.8,10.2 4.2,9.1 4.9,8.3C4.6,7.3 4.7,6.1 5.1,5' +
      'C6,5 7.2,5.5 8.3,6.4C10.1,5.9 11.9,5.9 13.7,6.4C14.8,5.5 16,5 16.9,5C17.3,6.1 17.4,7.3 17.1,8.3' +
      'C17.8,9.1 18.2,10.2 18.2,11.4C18.2,14.6 16.7,16.7 13.6,17.2C14,17.7 14.2,18.4 14.2,19.1V19.8' +
      'M8.4,18.3C5.7,19.2 5.2,17 3.6,16.7',
  },
  /** "in" in a cut cartouche */
  linkedin: {
    w: 22,
    h: 22,
    d:
      'M5.5,3H16.5A2.5,2.5 0 0 1 19,5.5V16.5A2.5,2.5 0 0 1 16.5,19H5.5A2.5,2.5 0 0 1 3,16.5V5.5A2.5,2.5 0 0 1 5.5,3Z' +
      'M7.5,10V15.5M10.5,15.5V10M10.5,12.6C10.5,11 11.4,10 12.8,10C14.2,10 14.9,11 14.9,12.6V15.5',
    dots: [{ cx: 7.5, cy: 7.4, r: 0.9 }],
  },
} satisfies Record<string, Glyph>

export type GlyphName = keyof typeof GLYPHS
