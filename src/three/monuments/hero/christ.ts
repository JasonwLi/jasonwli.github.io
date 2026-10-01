/**
 * Christ the Redeemer on Corcovado: the steep granite summit (a sheer bare face toward
 * the city, the Tijuca forest on its gentler flanks), the summit terrace and stairs, the
 * pedestal with its chapel, and the Art Deco soapstone figure: straight-falling robe
 * with its vertical folds, arms outstretched (28 m span for 30 m height) with the
 * hanging sleeves, hands open, head slightly bowed. The statue is enlarged against the
 * mountain so it reads at 40 px.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { painted, rng } from './parts.ts'

export function christ(k: Kit) {
  // ---- the peak: jittered lathe, painted rock where steep, forest elsewhere ----
  const R = rng(41)
  const n = 16
  const prof: [number, number][] = [[0.62, 0], [0.5, 0.12], [0.36, 0.26], [0.24, 0.38], [0.15, 0.46], [0.11, 0.5]]
  const V: V3[] = []
  prof.forEach(([r, y], j) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      // the sheer face: on the front-left the slope is cut back steeply
      const cliff = Math.max(0, Math.cos(a + 0.6)) * (j > 0 && j < prof.length - 1 ? 0.45 : 0)
      const jit = j === 0 || j === prof.length - 1 ? 1 : 0.85 + R() * 0.3
      const rr = r * jit * (1 - cliff * (1 - y * 1.6))
      V.push([Math.sin(a) * rr, y + (j > 0 && j < prof.length - 1 ? (R() - 0.5) * 0.03 : 0), Math.cos(a) * rr * 0.85])
    }
  })
  const top = V.length
  V.push([0, 0.5, 0])
  const T: number[][] = []
  for (let j = 0; j + 1 < prof.length; j++)
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + ((i + 1) % n)
      T.push([a, b, b + n], [a, b + n, a + n])
    }
  const last = (prof.length - 1) * n
  for (let i = 0; i < n; i++) T.push([last + i, last + ((i + 1) % n), top])
  painted(k, V, T, (t) => {
    const [a, b, c] = T[t].map((i) => V[i])
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]
    const steep = 1 - Math.abs(ny) / Math.hypot(nx, ny, nz)
    const y = (a[1] + b[1] + c[1]) / 3
    if (y > 0.47) return M.stoneShade
    if (steep > 0.62) return M.rock
    return y < 0.2 || t % 5 ? M.forest : M.greenDark
  })
  // ---- summit terrace, stairs, pedestal and chapel ----
  k.prism(0, 0.5, 0, 0.13, 0.13, 0.012, 10, M.stoneShade, 0, true)
  k.box(0.0, 0.47, 0.13, 0.05, 0.03, 0.06, M.stoneShade)
  k.box(0, 0.512, 0, 0.075, 0.05, 0.075, M.soapstone) // pedestal / chapel
  k.box(0, 0.512, 0.0385, 0.022, 0.03, 0.002, M.dark) // chapel door
  k.box(0, 0.562, 0, 0.085, 0.008, 0.085, M.soapstone)
  // ---- the figure ----
  const y0 = 0.57
  const VV: V3[] = []
  const rings: [number, number][] = [[0.034, 0], [0.038, 0.12], [0.042, 0.24], [0.048, 0.32], [0.052, 0.352], [0.03, 0.372]]
  const m = 12
  rings.forEach(([r, y]) => {
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2
      const fold = 1 + (y < 0.3 ? 0.07 * Math.sin(a * 4) : 0)
      VV.push([Math.sin(a) * r * fold * 1.15, y0 + y, Math.cos(a) * r * fold * 0.8])
    }
  })
  const TT: number[][] = []
  for (let j = 0; j + 1 < rings.length; j++)
    for (let i = 0; i < m; i++) {
      const a = j * m + i, b = j * m + ((i + 1) % m)
      TT.push([a, b, b + m], [a, b + m, a + m])
    }
  k.prim(VV, TT, M.soapstone)
  // arms: outstretched, slightly falling to the hands; sleeves hanging beneath
  const ay = y0 + 0.34
  const span = 0.2
  for (const s of [-1, 1]) {
    const sh: V3 = [s * 0.035, ay, 0]
    const hand: V3 = [s * span, ay - 0.012, 0.004]
    k.beam(sh, hand, 0.028, 0.026, M.soapstone)
    k.beam(hand, [s * (span + 0.018), ay - 0.016, 0.006], 0.016, 0.01, M.soapstone)
    // sleeve: a hanging drape under the forearm, thickened
    k.prim(
      [[s * 0.05, ay - 0.01, 0.01], [s * 0.15, ay - 0.012, 0.01], [s * 0.13, ay - 0.06, 0.008], [s * 0.06, ay - 0.075, 0.008],
        [s * 0.05, ay - 0.01, -0.01], [s * 0.15, ay - 0.012, -0.01], [s * 0.13, ay - 0.06, -0.008], [s * 0.06, ay - 0.075, -0.008]],
      [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]],
      M.soapstone,
    )
  }
  // head, bowed a little forward, with the hair falling to the shoulders
  k.lathe(0, ay + 0.03, 0.006, [[0.016, 0], [0.023, 0.014], [0.024, 0.034], [0.016, 0.052], [0, 0.058]], 8, M.soapstone)
  k.box(0, ay + 0.02, -0.008, 0.034, 0.04, 0.018, M.soapstone)
}
