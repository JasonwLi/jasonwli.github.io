/**
 * Eiffel Tower: four lattice legs splaying out on the tower's exponential profile, each
 * a box girder of four corner chords braced by diagonals; the decorative arches between
 * the legs under the first platform; the first-floor gallery ring, the second platform
 * where the legs merge, the single tapering lattice shaft, the top platform with its
 * campanile and antenna. 330 m to 125 m base: the true slender proportion.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'

const YS = [0, 0.17, 0.35, 0.6, 0.84, 0.88]
const WS = [0.19, 0.107, 0.062, 0.034, 0.018, 0.017]
/** half width of the tower's outer profile at height y (log-linear between the survey points) */
function w(y: number) {
  for (let i = 0; i + 1 < YS.length; i++)
    if (y <= YS[i + 1]) {
      const t = (y - YS[i]) / (YS[i + 1] - YS[i])
      return Math.exp(Math.log(WS[i]) * (1 - t) + Math.log(WS[i + 1]) * t)
    }
  return WS[WS.length - 1]
}
/** a leg's own width below the second platform (the legs merge there) */
function lw(y: number) {
  const t = Math.min(1, y / 0.35)
  return 0.086 * (1 - t) + w(0.35) * t - 0.012 * Math.sin(Math.PI * t)
}

const IRON = M.bronze

export function eiffel(k: Kit) {
  const chordW = (y: number) => 0.017 - y * 0.012
  // ---- the four legs ----
  const legY = [0, 0.05, 0.1, 0.17, 0.23, 0.29, 0.35]
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const corner = (y: number, cx: 0 | 1, cz: 0 | 1): V3 => {
        const o = w(y), i = o - lw(y)
        return [sx * (cx ? o : i), y, sz * (cz ? o : i)]
      }
      for (let s = 0; s + 1 < legY.length; s++) {
        const y0 = legY[s], y1 = legY[s + 1]
        const cw = chordW(y0)
        // corner chords
        for (const [cx, cz] of [[1, 1], [1, 0], [0, 1], [0, 0]] as [0 | 1, 0 | 1][]) k.beam(corner(y0, cx, cz), corner(y1, cx, cz), cw, cw, IRON, false)
        // diagonal bracing on all four faces (fine, no outline)
        k.hull = false
        const flip = s % 2
        k.beam(corner(y0, 1, flip ? 1 : 0), corner(y1, 1, flip ? 0 : 1), cw * 0.45, cw * 0.45, IRON, false)
        k.beam(corner(y0, flip ? 1 : 0, 1), corner(y1, flip ? 0 : 1, 1), cw * 0.45, cw * 0.45, IRON, false)
        k.beam(corner(y0, 0, flip ? 0 : 1), corner(y1, 0, flip ? 1 : 0), cw * 0.45, cw * 0.45, IRON, false)
        k.beam(corner(y0, flip ? 0 : 1, 0), corner(y1, flip ? 1 : 0, 0), cw * 0.45, cw * 0.45, IRON, false)
        k.hull = true
      }
      // masonry pier at the foot
      const p = corner(0, 1, 1), q = corner(0, 0, 0)
      k.box((p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2, Math.abs(p[0] - q[0]) + 0.03, 0.02, Math.abs(p[2] - q[2]) + 0.03, M.stoneShade)
    }
  // ---- arches between the legs (in the plane of the outer faces) ----
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2
    const pts: V3[] = []
    const n = 9
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const y = 0.035 + 0.1 * Math.sin(Math.PI * t)
      const half = w(0.035) - lw(0.035) + 0.01
      const x = -half * Math.cos(Math.PI * t)
      const z = w(y) - 0.012
      pts.push([x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)])
    }
    for (let i = 0; i + 1 < pts.length; i++) k.beam(pts[i], pts[i + 1], 0.012, 0.01, IRON, false)
  }
  // ---- first floor: girder ring with the gallery, overhanging the legs ----
  const ring = (y: number, h: number, outer: number, inner: number, hex: string) => {
    const t = outer - inner, m = (outer + inner) / 2
    k.box(0, y, m, outer * 2, h, t, hex)
    k.box(0, y, -m, outer * 2, h, t, hex)
    k.box(m, y, 0, t, h, inner * 2, hex)
    k.box(-m, y, 0, t, h, inner * 2, hex)
  }
  ring(0.165, 0.026, 0.128, 0.06, IRON)
  ring(0.191, 0.012, 0.118, 0.07, M.iron) // gallery roof line
  // ---- the shaft above the second platform: four chords + bracing ----
  const shY = [0.35, 0.42, 0.5, 0.6, 0.68, 0.76, 0.84]
  for (let s = 0; s + 1 < shY.length; s++) {
    const y0 = shY[s], y1 = shY[s + 1]
    const cw = chordW(y0) * 0.9
    const C = (y: number, sx: number, sz: number): V3 => [sx * w(y), y, sz * w(y)]
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) k.beam(C(y0, sx, sz), C(y1, sx, sz), cw, cw, IRON, false)
    k.hull = false
    const fl = s % 2 ? 1 : -1
    k.beam(C(y0, 1, fl), C(y1, 1, -fl), cw * 0.45, cw * 0.45, IRON, false)
    k.beam(C(y0, -1, -fl), C(y1, -1, fl), cw * 0.45, cw * 0.45, IRON, false)
    k.beam(C(y0, fl, 1), C(y1, -fl, 1), cw * 0.45, cw * 0.45, IRON, false)
    k.beam(C(y0, -fl, -1), C(y1, fl, -1), cw * 0.45, cw * 0.45, IRON, false)
    k.hull = true
  }
  // ---- second platform ----
  k.box(0, 0.345, 0, 0.15, 0.022, 0.15, IRON)
  k.box(0, 0.367, 0, 0.11, 0.01, 0.11, M.iron)
  // intermediate platform (the lift change) and the top platform with its cabin
  k.box(0, 0.6, 0, w(0.6) * 2 + 0.01, 0.008, w(0.6) * 2 + 0.01, IRON)
  k.box(0, 0.838, 0, 0.05, 0.016, 0.05, IRON)
  k.box(0, 0.854, 0, 0.038, 0.03, 0.038, M.iron)
  k.box(0, 0.884, 0, 0.046, 0.008, 0.046, IRON)
  k.prism(0, 0.892, 0, 0.016, 0.012, 0.04, 8, IRON)
  k.prism(0, 0.932, 0, 0.012, 0.004, 0.03, 6, IRON)
  k.prism(0, 0.962, 0, 0.004, 0.0015, 0.04, 4, M.iron)
}
