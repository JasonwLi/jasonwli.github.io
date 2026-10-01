/**
 * Angkor Wat from the western causeway: three concentric galleries rising in terraces,
 * the outer gallery with its cross-shaped western entrance (three truncated towers) and
 * corner pavilions; the second gallery with its corner towers; the steep central
 * pyramid with its stairs on every face, the third gallery, and the quincunx of
 * lotus-bud towers (the central one highest), each a tiered, corbelled, convex cone.
 * The two libraries stand in the outer court. Vertical scale exaggerated ~1.6x.
 */
import type { Kit } from '../kit.ts'
import { M } from '../palette.ts'

/** lotus-bud tower: square-ish cella then tiered convex cone; r radius, h height */
function bud(k: Kit, x: number, y0: number, z: number, r: number, h: number, tiers = 6) {
  const prof: [number, number][] = [[r * 1.1, 0], [r * 1.05, h * 0.06], [r, h * 0.08], [r, h * 0.3]]
  const y1 = 0.3
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers
    const rr = r * Math.sqrt(1 - Math.pow(f, 1.5)) * 1.02
    const y = y1 + (1 - y1) * f * 0.94
    prof.push([rr * 1.08, h * y], [rr * 0.94, h * (y + 0.05)])
  }
  prof.push([r * 0.12, h * 0.96], [0, h])
  k.lathe(x, y0, z, prof, 8, M.khmer, Math.PI / 8)
}

/** a small truncated pavilion tower (galleries' corners, gopuras): a simple tiered cone */
function knob(k: Kit, x: number, y0: number, z: number, r: number, h: number) {
  k.lathe(x, y0, z, [[r, 0], [r, h * 0.3], [r * 0.82, h * 0.42], [r * 0.7, h * 0.62], [r * 0.4, h * 0.85], [0, h]], 6, M.khmer, Math.PI / 6)
}

/** a rectangular gallery ring: half sizes a x b, width t, height h, roof rise rr */
function gallery(k: Kit, y: number, a: number, b: number, t: number, h: number, rr: number) {
  for (const s of [-1, 1]) {
    k.box(0, y, s * b, 2 * a + t, h, t, M.khmer)
    k.gable(0, y + h, s * b, 2 * a + t, rr, t * 1.15, M.khmerDark)
    k.box(s * a, y, 0, t, h, 2 * b - t, M.khmer)
    k.push(s * a, 0, 0, Math.PI / 2)
    k.gable(0, y + h, 0, 2 * b - t, rr, t * 1.15, M.khmerDark)
    k.pop()
  }
}

export function angkor(k: Kit) {
  // ---- outer court and causeway ----
  k.box(0, 0, 0.12, 1.94, 0.012, 1.72, M.lawn)
  k.box(0, 0, 1.08, 0.12, 0.02, 0.24, M.khmer) // causeway from the west
  // ---- first (outer) gallery on its low terrace ----
  k.box(0, 0.012, 0.12, 1.86, 0.025, 1.62, M.khmerDark)
  k.push(0, 0, 0.12)
  gallery(k, 0.037, 0.88, 0.76, 0.07, 0.06, 0.035)
  // corner pavilions
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.box(sx * 0.88, 0.037, sz * 0.76, 0.12, 0.08, 0.12, M.khmer)
    knob(k, sx * 0.88, 0.117, sz * 0.76, 0.045, 0.1)
  }
  // the western entrance: cross-shaped gopura with three truncated towers
  k.box(0, 0.037, 0.76, 0.34, 0.09, 0.14, M.khmer)
  k.box(0, 0.037, 0.76, 0.14, 0.11, 0.24, M.khmer)
  for (const x of [-0.12, 0, 0.12]) knob(k, x, x ? 0.127 : 0.147, 0.76, x ? 0.04 : 0.05, x ? 0.08 : 0.1)
  k.pop()
  // libraries in the outer court, and the cruciform terrace before the central mass
  for (const s of [-1, 1]) {
    k.box(s * 0.36, 0.012, 0.6, 0.14, 0.05, 0.09, M.khmer)
    k.gable(s * 0.36, 0.062, 0.6, 0.14, 0.04, 0.09, M.khmerDark)
  }
  k.box(0, 0.012, 0.48, 0.3, 0.035, 0.12, M.khmer)
  // ---- second gallery on its terrace ----
  const y2 = 0.04
  k.box(0, y2, 0, 1.1, 0.06, 0.98, M.khmerDark)
  gallery(k, y2 + 0.06, 0.52, 0.46, 0.06, 0.06, 0.03)
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.box(sx * 0.52, y2 + 0.06, sz * 0.46, 0.1, 0.08, 0.1, M.khmer)
    knob(k, sx * 0.52, y2 + 0.14, sz * 0.46, 0.04, 0.09)
  }
  // ---- the central pyramid: two steep stages, stairs on every face ----
  const y3 = y2 + 0.06
  k.frustum4(0, y3, 0, 0.78, 0.74, 0.7, 0.66, 0.12, M.khmer)
  k.frustum4(0, y3 + 0.12, 0, 0.66, 0.62, 0.6, 0.56, 0.12, M.khmerDark)
  const yt = y3 + 0.24
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2
    const half = f % 2 ? 0.37 : 0.39
    k.push(0, 0, 0, a)
    k.prim(
      [[-0.035, y3, half + 0.08], [0.035, y3, half + 0.08], [0.035, yt, half - 0.06], [-0.035, yt, half - 0.06], [-0.035, y3, half - 0.06], [0.035, y3, half - 0.06]],
      [[0, 1, 2], [0, 2, 3], [0, 3, 4], [1, 5, 2]],
      M.stoneShade,
    )
    k.box(0, yt, half - 0.04, 0.08, 0.07, 0.06, M.khmer) // stair-head porch
    k.pop()
  }
  // third gallery and its towers: four corners and the central bud
  gallery(k, yt, 0.28, 0.26, 0.05, 0.06, 0.028)
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.box(sx * 0.28, yt, sz * 0.26, 0.1, 0.08, 0.1, M.khmer)
    bud(k, sx * 0.28, yt + 0.08, sz * 0.26, 0.055, 0.3, 5)
  }
  // cruciform galleries joining the centre
  k.box(0, yt, 0, 0.5, 0.06, 0.05, M.khmer)
  k.box(0, yt, 0, 0.05, 0.06, 0.46, M.khmer)
  k.box(0, yt, 0, 0.16, 0.12, 0.16, M.khmer)
  bud(k, 0, yt + 0.12, 0, 0.075, 0.46, 7)
}
