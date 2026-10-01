/** Shared sizes of the drawing kit (kept out of the component files for fast refresh). */

/** the index triangle: 7 wide, 6 tall, apex up */
export const INDEX_TRIANGLE = { w: 7, h: 6 } as const

/**
 * The flat-scale tick module (ScaleRule). `top` is the room above the baseline
 * (the baseline sits at y = top + 0.5 in the SVG), `below` the room under it for
 * the index triangle. Consumers place HTML labels with these.
 */
export const SCALE_RULE = {
  top: 16,
  below: INDEX_TRIANGLE.h + 1,
  minor: 4,
  major: 11,
  majorCurrent: 15,
  pitch: 6,
} as const
