/**
 * Petra, Al-Khazneh: the two-storey Hellenistic facade carved into a vertical cut in the
 * banded rose cliff at the end of the Siq. Lower storey: the hexastyle portico (the
 * middle four columns free-standing before a dark recess and doorway) under its
 * pediment; upper storey: the broken pediment, the side pavilions and the central
 * tholos with its conical roof, capital and urn. The Siq walls close in on both sides.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { gridTris, painted, rng } from './parts.ts'

const FW = 0.36 // half width of the cut face

function column(k: Kit, x: number, y: number, z: number, h: number, r: number) {
  k.prism(x, y, z, r * 1.3, r * 1.3, h * 0.04, 6, M.roseLight, 0, false) // base
  k.prism(x, y + h * 0.04, z, r, r * 0.9, h * 0.8, 8, M.roseLight, 0, false)
  k.prism(x, y + h * 0.84, z, r * 0.95, r * 1.45, h * 0.16, 6, M.roseLight, 0, true) // Corinthian capital
}

export function petra(k: Kit) {
  // ---- the cliff: a jagged, banded rock face curving forward into the Siq walls ----
  const R = rng(17)
  const nx = 20, ny = 10
  const X0 = -0.95, X1 = 0.95
  const jit: number[] = []
  for (let i = 0; i < (nx + 1) * (ny + 1); i++) jit.push(R())
  const topY = (x: number) => 1.0 + 0.06 * Math.sin(x * 7.3) + 0.04 * Math.sin(x * 17 + 1)
  const V: V3[] = []
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const x = X0 + ((X1 - X0) * i) / nx
      const y = (topY(x) * j) / ny
      const side = Math.max(0, Math.abs(x) - FW) / (0.95 - FW) // 0 at the cut, 1 at the ends
      // the cut face stays flat at z = -0.004; beyond it the rock bulges forward
      const z = side > 0 ? 0.03 + side * side * 0.28 + (jit[j * (nx + 1) + i] - 0.5) * 0.028 * (1 + side) : -0.004
      const xx = side > 0 ? x + (jit[(j * 7 + i * 3) % jit.length] - 0.5) * 0.02 : x
      V.push([xx, y, z])
    }
  // above the facade the cut face leans back into the cliff
  for (let i = 0; i <= nx; i++) {
    const p = V[ny * (nx + 1) + i]
    if (Math.abs(p[0]) < FW) p[2] = -0.06
  }
  const T = gridTris(ny + 1, nx + 1)
  const band = (y: number) => {
    const b = Math.floor(y * 9 + Math.sin(y * 31) * 0.6)
    return b % 3 === 0 ? M.redstone : M.rose
  }
  painted(k, V, T, (t) => {
    const [a, b, c] = T[t].map((i) => V[i])
    const cx = (a[0] + b[0] + c[0]) / 3
    const cy = (a[1] + b[1] + c[1]) / 3
    if (Math.abs(cx) < FW && cy < 0.93) return M.rose
    return band(cy)
  })
  // cliff top surface going back
  const TV: V3[] = []
  for (let i = 0; i <= nx; i++) {
    const p = V[ny * (nx + 1) + i]
    TV.push(p, [p[0] * 0.9, p[1] - 0.22, -0.45])
  }
  const TT: number[][] = []
  for (let i = 0; i < nx; i++) TT.push([i * 2, i * 2 + 2, i * 2 + 3], [i * 2, i * 2 + 3, i * 2 + 1])
  k.prim(TV, TT, M.redstone)

  // ---- lower storey ----
  const z0 = 0.0
  k.box(0, 0, z0 + 0.06, 0.66, 0.025, 0.12, M.roseLight) // stylobate
  k.box(0, 0.025, z0 - 0.02, 0.4, 0.29, 0.03, M.rockDark) // the recess behind the portico
  k.box(0, 0.025, z0 - 0.004, 0.08, 0.17, 0.012, M.dark) // doorway
  const lh = 0.27
  for (const x of [-0.27, -0.165, -0.06, 0.06, 0.165, 0.27]) column(k, x, 0.025, z0 + 0.07, lh, 0.021)
  // side bays: wall faces with the relief panels
  for (const s of [-1, 1]) {
    k.box(s * 0.255, 0.025, z0 + 0.012, 0.16, lh, 0.024, M.roseLight)
    k.box(s * 0.218, 0.06, z0 + 0.026, 0.05, 0.13, 0.006, M.rose)
  }
  // entablature with frieze, and the lower pediment over the middle four columns
  const ye = 0.025 + lh
  k.box(0, ye, z0 + 0.05, 0.64, 0.025, 0.11, M.roseLight)
  k.box(0, ye + 0.025, z0 + 0.05, 0.62, 0.026, 0.1, M.rose)
  k.box(0, ye + 0.051, z0 + 0.055, 0.66, 0.012, 0.12, M.roseLight)
  k.push(0, ye + 0.063, z0 + 0.075)
  k.prim(
    [[-0.2, 0, 0.035], [0.2, 0, 0.035], [0, 0.075, 0.035], [-0.2, 0, -0.03], [0.2, 0, -0.03], [0, 0.075, -0.03]],
    [[0, 1, 2], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2]],
    M.roseLight,
  )
  k.pop()
  // ---- upper storey ----
  const yu = ye + 0.11
  k.box(0, yu - 0.01, z0 + 0.03, 0.64, 0.03, 0.07, M.roseLight) // attic band
  const uh = 0.25
  // side pavilions: two columns each, entablature, half-pediments rising to the broken centre
  for (const s of [-1, 1]) {
    const cx = s * 0.22
    k.box(cx, yu + 0.02, z0 + 0.01, 0.17, uh, 0.02, M.rose)
    for (const dx of [-0.055, 0.055]) column(k, cx + dx, yu + 0.02, z0 + 0.045, uh * 0.86, 0.018)
    k.box(cx, yu + 0.02 + uh * 0.86, z0 + 0.035, 0.17, 0.03, 0.07, M.roseLight)
    const y1 = yu + 0.05 + uh * 0.86
    const xi = cx - s * 0.085, xo = cx + s * 0.085
    k.prim(
      [[xo, y1, z0 + 0.07], [xi, y1, z0 + 0.07], [xi, y1 + 0.07, z0 + 0.07], [xo, y1, z0], [xi, y1, z0], [xi, y1 + 0.07, z0]],
      [[0, 1, 2], [3, 5, 4], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2]],
      M.roseLight,
    )
    // the outer acroteria
    k.box(xo, y1, z0 + 0.04, 0.025, 0.04, 0.03, M.rose)
  }
  // tholos: drum with engaged columns, tent roof, capital and urn
  const tz = z0 + 0.05
  k.prism(0, yu + 0.02, tz, 0.075, 0.075, uh * 0.86, 12, M.roseLight, 0, false)
  for (const a of [-1.1, -0.4, 0.4, 1.1]) column(k, Math.sin(a) * 0.082, yu + 0.02, tz + Math.cos(a) * 0.082, uh * 0.86, 0.014)
  k.box(0, yu + 0.02 + uh * 0.37, tz + 0.074, 0.03, 0.09, 0.006, M.rose) // Isis relief niche
  const yt = yu + 0.02 + uh * 0.86
  k.prism(0, yt, tz, 0.095, 0.095, 0.022, 12, M.roseLight, 0, false)
  k.prism(0, yt + 0.022, tz, 0.095, 0.015, 0.075, 12, M.rose)
  k.lathe(0, yt + 0.097, tz, [[0.02, 0], [0.028, 0.012], [0.03, 0.03], [0.018, 0.05], [0.008, 0.06], [0, 0.064]], 8, M.roseLight)
}
