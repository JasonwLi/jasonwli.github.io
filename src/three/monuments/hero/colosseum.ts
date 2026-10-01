/**
 * Colosseum: the travertine ellipse (188 x 156 m, 48 m) with the outer wall standing to
 * its full four storeys only on the north arc (three arcades framed by engaged columns
 * and cornices, then the solid attic with pilasters), its broken ends stepped down and
 * shored by the brick buttresses; elsewhere the lower inner ring shows its two arcaded
 * storeys. Inside: the ruined cavea with its radial vault walls, the arena wall, the
 * exposed hypogeum maze and the reconstructed arena floor at one end.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { bayOutline, latheArc, pushChord, slab } from './parts.ts'

const A = 1.0 // half length (x)
const B = 0.82 // half width (z)
const N = 28 // bays round the ellipse
const TIER = 0.125
const ATTIC = 0.11

const at = (t: number, s = 1, y = 0): V3 => [Math.sin(t) * A * s, y, Math.cos(t) * B * s]

function bay(k: Kit, p0: V3, p1: V3, y: number, h: number, d: number, hex: string, seg: number, ow = 0.6, sh = 0.52) {
  const w = pushChord(k, p0, p1, y) + 0.004
  const o = bayOutline(w, h, w * ow, h * sh, seg)
  // walls only round the opening (jambs + soffit): the bay's outer edges abut its neighbours;
  // one face (the material is double-sided), the soffits give the wall its depth
  slab(k, o, d, hex, (i) => i >= 1 && i <= o.length - 5, [], false)
  k.pop()
}

export function colosseum(k: Kit) {
  const step = (Math.PI * 2) / N
  // which bays of the outer wall still stand, per storey (0-2 arcades, 3 attic): the
  // north arc, its ends stepped down
  const from = Math.round((0.74 * Math.PI) / step)
  const to = Math.round((1.62 * Math.PI) / step)
  const stands = (i: number, tier: number) => i >= from + tier && i < to - tier * 0.6 - (tier === 3 ? 1 : 0)
  // plinth step round the whole ellipse
  k.lathe(0, 0, 0, [[1.04, 0], [1.04, 0.02]], 28, M.stoneShade, 0, false, A, B)

  // ---- outer wall ----
  for (let i = from; i < to; i++) {
    const t0 = i * step, t1 = (i + 1) * step
    for (let tier = 0; tier < 3; tier++) {
      if (!stands(i, tier)) continue
      const y = 0.02 + tier * TIER
      bay(k, at(t0), at(t1), y, TIER, 0.05, M.travertine, 3)
      // engaged half column at the bay's start (Tuscan, Ionic, Corinthian)
      const p = at(t0, 1.02, y)
      k.beam(p, [p[0], y + TIER * 0.9, p[2]], 0.018, 0.018, M.travertine, false)
    }
    if (stands(i, 3)) {
      // attic: solid wall with pilasters and small square windows every other bay
      const y = 0.02 + 3 * TIER
      const w = pushChord(k, at(t0), at(t1), y) + 0.004
      k.box(0, 0, 0, w, ATTIC, 0.05, M.travertine)
      k.box(-w / 2, 0, 0.03, 0.014, ATTIC * 0.92, 0.012, M.limestone)
      if (i % 2) k.box(0, ATTIC * 0.45, 0.026, 0.03, 0.03, 0.004, M.rockDark)
      k.pop()
    }
  }
  // the cornice of each storey: a proud band along the standing arc
  for (let tier = 0; tier < 4; tier++) {
    let a = -1, b = -1
    for (let i = from; i < to; i++) if (stands(i, tier)) { if (a < 0) a = i; b = i + 1 }
    if (a < 0) continue
    const y = 0.02 + tier * TIER + (tier === 3 ? ATTIC : TIER) - 0.014
    latheArc(k, 0, y, 0, [[1.03, 0], [1.03, 0.014], [1.0, 0.014]], (b - a) * 2, a * step, b * step, M.limestone, A, B)
  }
  // the broken ends: travertine core spurs and the brick buttresses (Stern's, Valadier's)
  for (const [i, sgn] of [[from, -1], [to, 1]] as [number, number][]) {
    // a brick wedge sloping from the full wall height down along the lost arc
    const t = i * step
    const tf = t + sgn * step * 1.05
    const P = (tt: number, f: number, y: number) => at(tt, f, y)
    const V = [P(t, 1.02, 0.02), P(tf, 1.02, 0.02), P(t, 1.02, 0.3), P(t, 0.9, 0.02), P(tf, 0.9, 0.02), P(t, 0.9, 0.3)]
    k.prim(V, [[0, 1, 2], [3, 5, 4], [1, 4, 5], [1, 5, 2], [0, 2, 5], [0, 5, 3]], M.brick)
  }

  // ---- inner ring: two arcaded storeys where the outer wall is gone ----
  const S2 = 0.885
  for (let i = to - 1; i < from + N + 1; i++) {
    const t0 = i * step, t1 = (i + 1) * step
    bay(k, at(t0, S2), at(t1, S2), 0.02, TIER, 0.04, M.travertine, 2, 0.58, 0.55)
    bay(k, at(t0, S2), at(t1, S2), 0.02 + TIER, TIER * 0.92, 0.04, M.limestone, 2, 0.5, 0.55)
  }
  latheArc(k, 0, 0.02 + TIER * 1.92 - 0.012, 0, [[S2 + 0.022, 0], [S2 + 0.022, 0.014], [S2, 0.014]], (from + N - to + 2) * 2, (to - 1) * step, (from + N + 1) * step, M.stoneShade, A, B)
  // outer-wall stumps along the lost arc: low piers at ground level
  for (let i = to + 1; i < from + N; i += 2) {
    const p = at(i * step, 1.0, 0.02)
    k.beam(p, [p[0], 0.05 + (i % 3) * 0.015, p[2]], 0.03, 0.03, M.stoneShade, false)
  }

  // ---- cavea: the raked seating, ruined to its brick vaults ----
  const topY = 0.02 + TIER * 1.92
  k.lathe(0, 0, 0, [[0.86, topY], [0.7, 0.2], [0.54, 0.1], [0.5, 0.075]], 28, M.cliff, 0, false, A, B)
  // radial vault walls of brick (ridges on the ruined slope)
  for (let i = 0; i < 22; i++) {
    const t = (i / 22) * Math.PI * 2
    k.beam(at(t, 0.84, topY + 0.008), at(t, 0.54, 0.107), 0.014, 0.024, M.brick, false)
  }
  // ring corridors (praecinctiones) as pale bands
  k.lathe(0, 0, 0, [[0.705, 0.205], [0.69, 0.205]], 28, M.travertine, 0, false, A, B)
  // arena wall
  k.lathe(0, 0, 0, [[0.5, 0.075], [0.5, 0.02]], 28, M.stoneShade, 0, false, A, B)
  // arena floor: hypogeum pit with its parallel walls; the reconstructed deck at the east end
  k.lathe(0, 0, 0, [[0.5, 0.02], [0, 0.02]], 28, M.rockDark, 0, false, A, B)
  for (let j = -3; j <= 3; j++) {
    const z = j * 0.05
    const half = Math.sqrt(Math.max(0, 1 - (z / (0.5 * B)) ** 2)) * 0.5 * A
    k.box(-0.1, 0.02, z, (half - 0.03) * 2 - 0.2, 0.035, 0.012, M.stoneShade)
  }
  k.box(-0.1, 0.02, 0, 0.62, 0.035, 0.012, M.stoneShade)
  k.lathe(0.32, 0, 0, [[0.16, 0.06], [0, 0.06]], 10, M.wood, 0, true, 1, 1.6)
}
