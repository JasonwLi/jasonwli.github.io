/**
 * Hover label placement (T1c; replaces C4's removed hover tooltip). No box: a
 * 0.75 px --silver-3 leader runs from the pin ring 14 px diagonally up-right,
 * then 20 px horizontally under the italic name; the country sits under the
 * line. It flips left within 240 px of the free area's right edge, and right
 * again if flipping would carry it over the travel column, so it never sits on
 * the column plate.
 */
import type { FreeRect } from './readoutFit'

const RING = 6 // hover pin ring ≈ 12 px across
const DIAG = 14 / Math.SQRT2
const RUN = 20
const FLIP_WITHIN = 240

const r2 = (v: number) => Math.round(v * 100) / 100

export interface HoverPlacement {
  leader: string
  /** label anchor: the elbow end of the horizontal run */
  x: number
  y: number
  /** +1 label to the right of the anchor, −1 to the left */
  dir: 1 | -1
}

export function placeHover(px: number, py: number, labelW: number, F: FreeRect): HoverPlacement {
  let dir: 1 | -1 = px > F.x1 - FLIP_WITHIN ? -1 : 1
  // a left-hand label must not reach the column
  if (dir < 0 && px - RING - DIAG - Math.max(RUN, labelW) < F.x0 + 8) dir = 1
  const sx = px + dir * RING * Math.SQRT1_2
  const sy = py - RING * Math.SQRT1_2
  const ex = sx + dir * DIAG
  const ey = sy - DIAG
  const x2 = ex + dir * RUN
  return { leader: `M${r2(sx)},${r2(sy)}L${r2(ex)},${r2(ey)}H${r2(x2)}`, x: ex, y: ey, dir }
}
