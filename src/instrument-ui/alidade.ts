/**
 * Alidade geometry (T1c). Every piece is built in the alidade's own frame:
 * origin on the silhouette (R) along the pin bearing, x = u radially outward
 * from R, y = v tangent. The overlay places the frame with one transform,
 * `translate(cx cy) rotate(bearing) translate(R 0)`, so the shapes stay constant
 * px while the limb grows and the blade swings with the globe.
 *
 *   blade     u 2 → tip: a straight taper with a sharpened last 8 px, stopping
 *             3 px short of the tick band so the scale stays readable
 *   pinnule   the sight vane, 3 × 9 across the blade at u 6.5–9.5
 *   set tick  1.5 px across the tick band (tickIn → tickOut) at the exact bearing
 *   stub      the occulted blade: a dashed line u 2 → tip
 *
 * Full limb: tip at u 30 (R+30, tick band R+33). Compact: tip at u 17.
 */
import type { LimbGeometry } from '../three/instrument/anchors'
import { isCompact } from './limbGeometry'

export interface AlidadeShape {
  blade: string
  pinnule: string
  stub: string
  /** set tick line, u from → to (v = 0) */
  setTick: string
  tip: number
}

export function alidadeShape(g: LimbGeometry): AlidadeShape {
  const tip = g.tickIn - 3
  const k = isCompact(g) ? 0.8 : 1
  const w0 = 2.5 * k
  const w1 = 1.2 * k
  const sharp = tip - 8
  const blade = `M2,${-w0}L${sharp},${-w1}L${tip},0L${sharp},${w1}L2,${w0}Z`
  const pv = 4.5 * k
  const pinnule = `M6.5,${-pv}H9.5V${pv}H6.5Z`
  return {
    blade,
    pinnule,
    stub: `M2,0H${tip}`,
    setTick: `M${g.tickOut},0H${g.tickIn}`,
    tip,
  }
}

/** the sighting hairline: from just outside the active pin ring (u < 0, inside the disc) to R+2 */
export function hairlinePath(pinU: number): string {
  // the active pin is ≈16 px across: start 9 px out from its centre
  const from = Math.min(pinU + 9, 2)
  return `M${(Math.round(from * 100) / 100).toString()},0H2`
}
