/**
 * Readout placement (T1c), the theme's fit rule applied to the live alidade:
 *
 *   'rim'    the leader leaves the limb mark (rim point at the set-tick bearing)
 *            16 px radially, then 20 px horizontally outward; the block (italic
 *            name, coordinates, dates) hangs at its end. If the block would
 *            cross the free area's right edge − 8, the leader runs the other way;
 *            if it would cross the column edge + 24 as well, fall back to
 *   'below'  one centred line hanging 14 px past the rim, straight off the mark
 *            (above the limb when the mark is on the upper half).
 *   'edge'   deep zoom (neatline, or the mark is off the visible arc): the block
 *            hangs from the top edge at the place's x by an 18 px leader; off
 *            frame it clamps to the nearest edge or corner.
 *
 * Pure: returns the leader path, its end dot and the block's top-left corner.
 */
export interface FreeRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type ReadoutKind = 'rim' | 'below' | 'edge'

export interface Placement {
  kind: ReadoutKind
  leader: string
  /** leader end (the 2 px dot) */
  ex: number
  ey: number
  /** block top-left */
  x: number
  y: number
  /** 0.4 when the place is off frame (edge kind), else 1 */
  alpha: number
}

const RADIAL = 16
const RUN = 20
const GAP = 6
const BELOW = 14
const EDGE_LEADER = 18
const r2 = (v: number) => Math.round(v * 100) / 100
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, lo > hi ? lo : v))

/** block metrics: the rim block (3 lines) and the one-line variant */
export interface BlockSize {
  w: number
  h: number
  /** y of the name's centre line inside the block (the leader end aligns to it) */
  nameMid: number
  lineW: number
  lineH: number
}

export function placeRim(
  mx: number,
  my: number,
  angle: number,
  size: BlockSize,
  F: FreeRect,
  preferBelow: boolean,
): Placement {
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  const bx = mx + ux * RADIAL
  const by = my + uy * RADIAL
  if (!preferBelow) {
    const first = ux >= 0 ? 1 : -1
    for (const dir of [first, -first]) {
      const ex = bx + dir * RUN
      const x = dir > 0 ? ex + GAP : ex - GAP - size.w
      if (x >= F.x0 + 24 && x + size.w <= F.x1 - 8) {
        const y = clamp(by - size.nameMid, F.y0 + 8, F.y1 - 8 - size.h)
        return {
          kind: 'rim',
          leader: `M${r2(mx)},${r2(my)}L${r2(bx)},${r2(by)}H${r2(ex)}`,
          ex,
          ey: by,
          x,
          y,
          alpha: 1,
        }
      }
    }
  }
  // one centred line straight off the mark, past the rim (below, or above on the upper half)
  const down = uy >= -0.2
  const ey = down ? my + BELOW : my - BELOW
  const yTop = down ? ey + 4 : ey - 4 - size.lineH
  const x = clamp(mx - size.lineW / 2, F.x0 + 24, F.x1 - 8 - size.lineW)
  return {
    kind: 'below',
    leader: `M${r2(mx)},${r2(my)}V${r2(ey)}`,
    ex: mx,
    ey,
    x,
    y: clamp(yTop, F.y0 + 8, F.y1 - 8 - size.lineH),
    alpha: 1,
  }
}

/** clearance from the left edge: the latitude numerals (tick 11 + "46°30′N") */
const LAT_CLEAR = 72
/** clearance from the right edge's ticks */
const EDGE_CLEAR = 20

export type EdgeSide = 'top' | 'bottom'

/** pins inside a block rect (padded 6 px); the active pin weighs 10 (the block must never hide it) */
function pinsUnder(x: number, y: number, w: number, h: number, pins: ArrayLike<number> | null, active: number): number {
  if (!pins) return 0
  let n = 0
  for (let i = 0; i + 3 < pins.length; i += 4) {
    if (pins[i + 2] < 0.5) continue
    const px = pins[i]
    const py = pins[i + 1]
    if (px > x - 6 && px < x + w + 6 && py > y - 6 && py < y + h + 6) n += i / 4 === active ? 10 : 1
  }
  return n
}

/**
 * Deep zoom: hang from the neatline's inner top edge at the place's x, or rise from
 * the bottom edge when the top block would cover pins (the active pin above all).
 * The block clears the left edge's latitude numerals and the right edge's ticks; off
 * frame it takes the edge nearest the place (by y) and dims to 0.4.
 * `prev` is the side used last frame: a side only flips for strictly fewer pins.
 */
export function placeEdge(
  px: number,
  py: number,
  inner: FreeRect,
  size: BlockSize,
  F: FreeRect,
  pins: ArrayLike<number> | null = null,
  active = -1,
  prev: EdgeSide = 'top',
): Placement & { side: EdgeSide } {
  const off = px < F.x0 || px > F.x1 || py < F.y0 || py > F.y1
  const mx = clamp(px, inner.x0 + LAT_CLEAR / 2, inner.x1 - EDGE_CLEAR)
  const x = clamp(mx - size.w / 2, inner.x0 + LAT_CLEAR, inner.x1 - EDGE_CLEAR - size.w)
  const topEy = inner.y0 + EDGE_LEADER
  const topY = topEy + 4
  const botEy = inner.y1 - EDGE_LEADER
  const botY = botEy - 4 - size.h
  const nt = pinsUnder(x, topY - EDGE_LEADER, size.w, size.h + EDGE_LEADER, pins, active)
  const nb = pinsUnder(x, botY, size.w, size.h + EDGE_LEADER, pins, active)
  // off frame the edge nearest the place wins ties; on frame the side held last frame
  const tie: EdgeSide = off ? (py > (F.y0 + F.y1) / 2 ? 'bottom' : 'top') : prev
  const side: EdgeSide = nt === nb ? tie : nt < nb ? 'top' : 'bottom'
  const top = side === 'top'
  const ey = top ? topEy : botEy
  return {
    kind: 'edge',
    leader: `M${r2(mx)},${r2(top ? inner.y0 : inner.y1)}V${r2(ey)}`,
    ex: mx,
    ey,
    x,
    y: top ? topY : botY,
    alpha: off ? 0.4 : 1,
    side,
  }
}
