/**
 * Limb geometry (T1c): path strings for the engraved degree limb, built in the
 * limb's own frame (origin at the globe centre, θ clockwise from 12 o'clock, so
 * a point at radius r is (sinθ*r, −cosθ*r)). The overlay rotates the frame by
 * −λc, so the numeral under the fiducial reads the meridian facing you.
 *
 * Radii are live (R + the constant px offsets of I1's LIMB table); tick lengths
 * are constant px, so the tick paths are rebuilt whenever R moves by > 0.5 px,
 * never scaled. Full limb: ticks 4/7/11 px hanging inward from R+44; compact
 * (phones, R < 220): 3/5/8 px from R+28.
 */
import type { LimbGeometry } from '../three/instrument/anchors'

const DEG = Math.PI / 180
const f = (v: number) => (Math.round(v * 100) / 100).toString()

export const isCompact = (g: LimbGeometry) => g.rim < 40

/** tick lengths [1°, 5°, 10°] for a limb table */
export function tickLens(g: LimbGeometry): [number, number, number] {
  return isCompact(g) ? [3, 5, 8] : [4, 7, 11]
}

/** numerals every 10° on the full limb at R ≥ 260, else every 30° */
export function numeralStep(R: number, g: LimbGeometry): 10 | 30 {
  return !isCompact(g) && R >= 260 ? 10 : 30
}

function seg(thetaDeg: number, rIn: number, rOut: number, tangent = 0): string {
  const t = thetaDeg * DEG
  const s = Math.sin(t)
  const c = Math.cos(t)
  // tangent offset along (cosθ, sinθ)
  const ox = c * tangent
  const oy = s * tangent
  return `M${f(s * rIn + ox)},${f(-c * rIn + oy)}L${f(s * rOut + ox)},${f(-c * rOut + oy)}`
}

export interface TickPaths {
  minor: string
  mid: string
  major: string
}

/**
 * The three tick classes as one path each (360 / 72 / 36 segments, cardinals
 * doubled: two parallel 1 px lines 2 px apart at 0°, 90°, 180°, 270°).
 */
export function buildTicks(R: number, g: LimbGeometry): TickPaths {
  const out = R + g.tickOut
  const [l1, l5, l10] = tickLens(g)
  let minor = ''
  let mid = ''
  let major = ''
  for (let d = 0; d < 360; d++) {
    if (d % 10 === 0) {
      if (d % 90 === 0) major += seg(d, out - l10, out, -1) + seg(d, out - l10, out, 1)
      else major += seg(d, out - l10, out)
    } else if (d % 5 === 0) mid += seg(d, out - l5, out)
    else minor += seg(d, out - l1, out)
  }
  return { minor, mid, major }
}

/** numeral label for limb degree d (0..350): longitude east-positive, 0–359 round the limb */
export const numeralText = (d: number) => String(d)

/** transform of the numeral at limb degree d (radially oriented; flipped to read upright in the lower half) */
export function numeralTransform(d: number, R: number, g: LimbGeometry, flip: boolean): string {
  return `rotate(${d}) translate(0 ${f(-(R + g.numerals))})${flip ? ' rotate(180)' : ''}`
}

/** wrap degrees to (−180, 180] */
export function wrap180(d: number): number {
  let v = d % 360
  if (v > 180) v -= 360
  else if (v <= -180) v += 360
  return v
}

/**
 * The re-cut of the limb's own ticks within ±5° of the set tick, in the limb
 * frame: two paths ordered outward from the set bearing (left side, right side),
 * so a stroke draw-on along each reads as the cut running away from the mark.
 * `localDeg` is the bearing in limb degrees (clockwise from the limb's 0).
 */
export function buildRecut(localDeg: number, R: number, g: LimbGeometry): { left: string; right: string } {
  const out = R + g.tickOut
  const [l1, l5, l10] = tickLens(g)
  const len = (k: number) => (k % 10 === 0 ? l10 : k % 5 === 0 ? l5 : l1)
  let left = ''
  let right = ''
  const c = Math.round(localDeg)
  for (let k = c; k >= Math.ceil(localDeg - 5); k--) {
    if (k > localDeg + 1e-6) continue
    const m = ((k % 360) + 360) % 360
    left += seg(k, out - len(m), out)
  }
  for (let k = Math.floor(localDeg) + 1; k <= localDeg + 5; k++) {
    const m = ((k % 360) + 360) % 360
    right += seg(k, out - len(m), out)
  }
  return { left: left || 'M0,0', right: right || 'M0,0' }
}

/** circle as a path starting at 12 o'clock, clockwise (draw-on starts at the fiducial) */
export function circlePath(r: number): string {
  const rr = f(r)
  return `M0,${f(-r)}A${rr},${rr} 0 1 1 0,${rr}A${rr},${rr} 0 1 1 0,${f(-r)}`
}

/**
 * The load sweep: a pie wedge from 12 o'clock clockwise through frac*360°, in
 * screen orientation (it does not turn with the limb). Clips the whole limb so
 * it is cut clockwise from the fiducial as the textures arrive.
 */
export function sweepWedge(frac: number, r: number): string {
  const p = Math.max(0, Math.min(1, frac))
  if (p <= 0) return 'M0,0Z'
  if (p >= 0.9999) return `M${f(-r)},${f(-r)}H${f(r)}V${f(r)}H${f(-r)}Z`
  const t = p * 2 * Math.PI
  const x = Math.sin(t) * r
  const y = -Math.cos(t) * r
  return `M0,0L0,${f(-r)}A${f(r)},${f(r)} 0 ${p > 0.5 ? 1 : 0} 1 ${f(x)},${f(y)}Z`
}
