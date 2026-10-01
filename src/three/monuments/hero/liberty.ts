/**
 * Statue of Liberty: Fort Wood's eleven-pointed star walls, Hunt's granite pedestal
 * (battered base, rusticated corner piers, the loggia band of the colonnade, cornice
 * and balcony), and the copper-green figure: the folded robe, the right arm raised with
 * the torch and its gallery and flame, the tablet held on the left forearm, the head
 * with its seven-rayed crown.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'

/** lathe with radial folds: r(y, a) = r * (1 + fold * sin(folds a + phase)), elliptical section */
function robe(k: Kit, x: number, z: number, rings: [number, number, number][], n: number, folds: number, hex: string, sx = 1.15, sz = 0.9) {
  const V: V3[] = []
  rings.forEach(([r, y, fold], j) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const rr = r * (1 + fold * Math.sin(folds * a + j * 0.7))
      V.push([x + Math.sin(a) * rr * sx, y, z + Math.cos(a) * rr * sz])
    }
  })
  const T: number[][] = []
  for (let j = 0; j + 1 < rings.length; j++)
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + ((i + 1) % n)
      T.push([a, b, b + n], [a, b + n, a + n])
    }
  k.prim(V, T, hex)
}

export function liberty(k: Kit) {
  // ---- Fort Wood: the eleven-pointed star ----
  const star: [number, number][] = []
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.PI / 22
    const r = i % 2 ? 0.3 : 0.45
    star.push([Math.sin(a) * r, Math.cos(a) * r])
  }
  k.push(0, 0, 0, 0, 1, 1, 1, 0, -Math.PI / 2)
  k.extrude(star, 0.055, M.stoneShade, [], 0.0275)
  k.pop()
  k.prism(0, 0.055, 0, 0.27, 0.27, 0.004, 22, M.lawn, 0, true)
  // ---- pedestal ----
  k.frustum4(0, 0.055, 0, 0.3, 0.3, 0.23, 0.23, 0.07, M.granite) // battered base
  k.box(0, 0.125, 0, 0.2, 0.3, 0.2, M.travertine)
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(sx * 0.092, 0.125, sz * 0.092, 0.032, 0.3, 0.032, M.granite) // corner piers
  // the loggia: dark recessed openings with columns, each face
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2
    k.push(Math.sin(a) * 0.1, 0.3, Math.cos(a) * 0.1, a)
    k.box(0, 0, 0.001, 0.12, 0.055, 0.002, M.rockDark)
    for (const x of [-0.04, 0, 0.04]) k.box(x, 0, 0.004, 0.012, 0.055, 0.006, M.travertine)
    k.box(0, -0.1, 0.002, 0.05, 0.06, 0.002, M.stoneShade) // panel for the shields
    k.pop()
  }
  k.box(0, 0.425, 0, 0.23, 0.018, 0.23, M.travertine) // cornice
  k.box(0, 0.443, 0, 0.2, 0.017, 0.2, M.granite) // balcony parapet
  k.box(0, 0.46, 0, 0.13, 0.012, 0.13, M.travertine) // statue plinth
  // ---- the figure ----
  const y0 = 0.472
  robe(k, 0, 0, [
    [0.06, y0, 0.12], [0.056, y0 + 0.07, 0.1], [0.05, y0 + 0.15, 0.08], [0.046, y0 + 0.22, 0.06],
    [0.05, y0 + 0.28, 0.05], [0.052, y0 + 0.315, 0.03], [0.03, y0 + 0.335, 0], [0.016, y0 + 0.345, 0],
  ], 16, 5, M.patina)
  // the toga's diagonal swag across the chest
  k.beam([0.05, y0 + 0.23, 0.04], [-0.04, y0 + 0.31, 0.04], 0.018, 0.012, M.verdigris)
  // head and face
  const hy = y0 + 0.345
  k.lathe(0, hy, 0.004, [[0.017, 0], [0.024, 0.012], [0.024, 0.028], [0.016, 0.042], [0, 0.047]], 8, M.patina)
  // crown: diadem and seven rays fanned round the front of the head
  k.prism(0, hy + 0.026, 0.004, 0.027, 0.027, 0.008, 8, M.patina, 0, false)
  for (let i = 0; i < 7; i++) {
    const a = -1.5 + (i / 6) * 3.0 // round the front
    const el = 0.35
    const d: V3 = [Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)]
    const p: V3 = [d[0] * 0.024, hy + 0.034 + d[1] * 0.01, 0.004 + d[2] * 0.024]
    const q: V3 = [p[0] + d[0] * 0.045, p[1] + d[1] * 0.045, p[2] + d[2] * 0.045]
    k.beam(p, q, 0.007, 0.004, M.patina, true)
  }
  // right arm raised (viewer's left), the sleeve falling from it
  const sh: V3 = [-0.05, y0 + 0.3, 0]
  const el: V3 = [-0.068, y0 + 0.39, 0.008]
  const hand: V3 = [-0.06, y0 + 0.47, 0.004]
  k.beam(sh, el, 0.03, 0.028, M.patina)
  k.beam(el, hand, 0.024, 0.022, M.patina)
  k.prim([[-0.035, y0 + 0.28, 0.0], [-0.07, y0 + 0.38, 0.012], [-0.05, y0 + 0.24, 0.02], [-0.065, y0 + 0.3, -0.015]], [[0, 1, 2], [0, 3, 1]], M.patina)
  // torch: handle, cup, gallery, flame
  k.prism(hand[0], hand[1], hand[2], 0.011, 0.013, 0.035, 8, M.patina, 0, false)
  k.prism(hand[0], hand[1] + 0.035, hand[2], 0.013, 0.022, 0.016, 8, M.patina, 0, false)
  k.prism(hand[0], hand[1] + 0.051, hand[2], 0.03, 0.03, 0.004, 10, M.verdigris, 0, true)
  k.lathe(hand[0], hand[1] + 0.055, hand[2], [[0.016, 0], [0.019, 0.012], [0.012, 0.03], [0, 0.048]], 7, M.ochre)
  // left arm bent, holding the tablet (JULY IV MDCCLXXVI) against the side
  const ls: V3 = [0.05, y0 + 0.3, 0]
  const le: V3 = [0.066, y0 + 0.22, 0.02]
  k.beam(ls, le, 0.026, 0.024, M.patina)
  k.beam(le, [0.05, y0 + 0.215, 0.06], 0.022, 0.02, M.patina)
  k.push(0.072, y0 + 0.16, 0.035, 0, 1, 1, 1, -0.22, 0.2)
  k.box(0, 0, 0, 0.022, 0.13, 0.065, M.verdigris)
  k.pop()
  // the left foot stepping forward under the hem, the broken chain
  k.box(0.02, y0, 0.06, 0.03, 0.012, 0.03, M.patina)
}
