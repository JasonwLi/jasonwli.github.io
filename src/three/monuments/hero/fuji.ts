/**
 * Mount Fuji: the near-perfect stratovolcano cone with its concave flanks steepening to
 * the truncated summit, the summit crater ringed by its eight peaks, the snow cap
 * reaching down the ravines in long streaks over the bare rust-brown upper slopes, the
 * forested lower slopes (Aokigahara at the foot), and the Hoei crater breaking the
 * south-east flank. Vertical exaggeration ~2.5x, as Fuji is always drawn.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { painted, rng } from './parts.ts'

const N = 36
const H = 0.9
const R0 = 0.98
const RT = 0.11 // summit radius

export function fuji(k: Kit) {
  const Rnd = rng(3776)
  // profile: concave, r(t) = RT + (R0 - RT) (1 - t)^1.9
  const rows = 12
  const ts: number[] = []
  for (let j = 0; j <= rows; j++) ts.push(1 - Math.pow(1 - j / rows, 1.15))
  const jit: number[] = []
  for (let i = 0; i < N; i++) jit.push(Rnd())
  // snow line per meridian: streaks down the ravines
  const snowT = (i: number) => {
    const streak = (i * 7) % 5 === 0 ? 0.13 + jit[i] * 0.06 : (i * 3) % 4 === 0 ? 0.08 : jit[i] * 0.05
    return 0.6 - streak
  }
  const hoei = (a: number, t: number) => {
    // the Hoei crater: a scoop on the south-east flank (front-right) near t 0.5
    const da = Math.atan2(Math.sin(a - 2.3), Math.cos(a - 2.3))
    return Math.exp(-((da / 0.22) ** 2) - (((t - 0.5) / 0.09) ** 2))
  }
  const V: V3[] = []
  ts.forEach((t, j) => {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      // ridges and ravines: alternate meridians in and out a little on the upper cone
      const rib = j > 1 && j < rows ? 1 + (i % 2 ? 0.035 : -0.02) * (0.4 + t) : 1
      let r = (RT + (R0 - RT) * Math.pow(1 - t, 1.9)) * rib * (j === 0 ? 1 + (jit[i] - 0.5) * 0.08 : 1)
      let y = t * H
      const ho = hoei(a + Math.PI / 2, t)
      r *= 1 - 0.1 * ho
      y -= 0.03 * ho
      V.push([Math.sin(a) * r, y, Math.cos(a) * r * 0.92])
    }
  })
  // summit crater: the rim peaks, then the bowl
  const rim = V.length
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    const r = RT * 0.82
    V.push([Math.sin(a) * r, H + (i % 4 === 0 ? 0.012 : 0.004), Math.cos(a) * r * 0.92])
  }
  const bowl = V.length
  V.push([0, H - 0.05, 0])
  const T: number[][] = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < N; i++) {
      const a = j * N + i, b = j * N + ((i + 1) % N)
      T.push([a, b, b + N], [a, b + N, a + N])
    }
  const top = rows * N
  for (let i = 0; i < N; i++) {
    const j2 = (i + 1) % N
    T.push([top + i, top + j2, rim + j2], [top + i, rim + j2, rim + i])
    T.push([rim + i, rim + j2, bowl])
  }
  painted(k, V, T, (t) => {
    const tri = T[t]
    if (tri.includes(bowl)) return M.rockDark
    // meridian index and height fraction of the triangle
    const i = tri[0] % N
    const ty = Math.max(...tri.map((v) => V[v][1])) / H
    const tmin = Math.min(...tri.map((v) => V[v][1])) / H
    if (tmin >= snowT(i) - 0.001) return M.snow
    if (ty > 0.36) return t % 7 === 0 ? M.rockDark : M.volcanic
    if (ty > 0.2) return t % 5 === 0 ? M.volcanic : M.cliff
    return t % 4 === 0 ? M.greenDark : M.forest
  })
}
