/**
 * Great Wall at Badaling: the wall snaking along the crest of the scrub-covered ridges,
 * climbing and dipping, its walkway between a crenellated outer battlement and a low
 * inner parapet, punctuated by square two-storey watchtowers with arched windows and
 * crenellated roofs (one with its pavilion), the steepest stretch climbing to the
 * highest tower on the right.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { heightfield } from './parts.ts'

const X0 = -1.25, X1 = 1.25
const zPath = (u: number) => 0.24 * Math.sin(Math.PI * 2.1 * u + 0.4) - 0.12 * u + 0.04
const uOf = (x: number) => (x - X0) / (X1 - X0)
/** the hills fall away at both ends of the patch */
const taper = (u: number) => Math.min(1, u / 0.12, (1 - u) / 0.12) ** 0.7
const crest = (u: number) => (0.1 + 0.3 * u + 0.08 * Math.sin(Math.PI * 4 * u - 0.6) + 0.03 * Math.sin(Math.PI * 9 * u)) * Math.max(0, taper(u))
const WH = 0.08 // wall height above the crest
const WW = 0.075 // wall width

export function greatWall(k: Kit) {
  // ---- the ridges ----
  const H = (x: number, z: number) => {
    const u = Math.min(1, Math.max(0, uOf(x)))
    const d = z - zPath(u)
    const ridge = crest(u) * Math.exp(-((d / 0.42) ** 2))
    const other = 0.12 * Math.exp(-(((x + 0.3) / 0.5) ** 2) - (((z + 0.6) / 0.25) ** 2)) * Math.max(0, taper(u)) // a back ridge
    return Math.max(0, Math.max(ridge, other) - 0.012)
  }
  heightfield(k, X0, X1, -0.75, 0.65, 16, 9, H, (_x, y, _z, slope) => (slope > 0.66 ? M.cliff : y > 0.24 ? M.green : M.greenDark), M.greenDark)
  // ---- the wall ----
  const n = 44
  const C: V3[] = []
  const side: V3[] = []
  for (let i = 0; i <= n; i++) {
    const u = 0.05 + (i / n) * 0.9
    const x = X0 + (X1 - X0) * u
    const z = zPath(u)
    C.push([x, crest(u), z])
  }
  for (let i = 0; i <= n; i++) {
    const a = C[Math.max(0, i - 1)], b = C[Math.min(n, i + 1)]
    const dx = b[0] - a[0], dz = b[2] - a[2]
    const l = Math.hypot(dx, dz)
    side.push([-dz / l, 0, dx / l]) // horizontal normal (toward +z on a left-to-right run)
  }
  const V: V3[] = []
  for (let i = 0; i <= n; i++) {
    const c = C[i], s = side[i]
    const hw = WW / 2
    V.push(
      [c[0] + s[0] * hw * 1.25, c[1] - 0.04, c[2] + s[2] * hw * 1.25], // front foot (battered)
      [c[0] + s[0] * hw, c[1] + WH, c[2] + s[2] * hw], // front top
      [c[0] - s[0] * hw, c[1] + WH, c[2] - s[2] * hw], // back top
      [c[0] - s[0] * hw * 1.25, c[1] - 0.04, c[2] - s[2] * hw * 1.25], // back foot
    )
  }
  const T: number[][] = []
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = (i + 1) * 4
    T.push([a, b, b + 1], [a, b + 1, a + 1]) // front face
    T.push([a + 1, b + 1, b + 2], [a + 1, b + 2, a + 2]) // walkway
    T.push([a + 2, b + 2, b + 3], [a + 2, b + 3, a + 3]) // back face
  }
  k.prim(V, T, M.incaStone)
  // walkway paving: a slightly darker strip, and the low inner parapet (front)
  const parapet: V3[] = []
  const pt: number[][] = []
  const bat: V3[] = []
  const bt: number[][] = []
  for (let i = 0; i <= n; i++) {
    const c = C[i], s = side[i]
    const f = WW / 2 - 0.006
    parapet.push([c[0] + s[0] * f, c[1] + WH, c[2] + s[2] * f], [c[0] + s[0] * f, c[1] + WH + 0.014, c[2] + s[2] * f])
    bat.push([c[0] - s[0] * f, c[1] + WH, c[2] - s[2] * f], [c[0] - s[0] * f, c[1] + WH + 0.016, c[2] - s[2] * f])
    if (i < n) {
      pt.push([i * 2, i * 2 + 2, i * 2 + 3], [i * 2, i * 2 + 3, i * 2 + 1])
      bt.push([i * 2, i * 2 + 2, i * 2 + 3], [i * 2, i * 2 + 3, i * 2 + 1])
    }
  }
  k.prim(parapet, pt, M.incaStone)
  k.prim(bat, bt, M.incaStone)
  // merlons on the outer battlement (every segment), stepping with the slope
  for (let i = 0; i < n; i++) {
    const c0 = C[i], c1 = C[i + 1], s = side[i]
    const m: V3 = [(c0[0] + c1[0]) / 2 - s[0] * (WW / 2 - 0.006), (c0[1] + c1[1]) / 2 + WH + 0.016, (c0[2] + c1[2]) / 2 - s[2] * (WW / 2 - 0.006)]
    k.beam(m, [m[0], m[1] + 0.016, m[2]], 0.026, 0.008, M.incaStone)
  }
  // ---- watchtowers ----
  const towers = [3, 15, 27, 37, 43]
  towers.forEach((i, j) => {
    const c = C[i], s = side[i]
    const rot = Math.atan2(s[0], s[2])
    const y = c[1] - 0.03
    k.push(c[0], y, c[2], rot)
    const th = WH + 0.11
    k.box(0, 0, 0, 0.14, th, 0.14, M.incaStone)
    k.box(0, th - 0.012, 0, 0.15, 0.012, 0.15, M.stoneShade)
    // arched windows: two per face (dark)
    for (const f of [0, 1, 2, 3]) {
      k.push(0, 0, 0, (f * Math.PI) / 2)
      for (const dx of [-0.028, 0.028]) k.box(dx, th - 0.065, 0.0705, 0.018, 0.03, 0.002, M.rockDark)
      k.pop()
    }
    // crenellated roof parapet
    for (let q = 0; q < 4; q++)
      for (const t of [-0.04, 0, 0.04]) {
        const a = (q * Math.PI) / 2
        k.box(Math.sin(a) * 0.066 + Math.cos(a) * t, th, Math.cos(a) * 0.066 - Math.sin(a) * t, 0.024, 0.018, 0.024, M.incaStone)
      }
    if (j === 1 || j === 4) k.eave(0, th, 0, 0.08, 0.08, 0.055, 0.014, 0.012, M.khmerDark, 0.3)
    k.pop()
  })
}
