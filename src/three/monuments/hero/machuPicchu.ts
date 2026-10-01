/**
 * Machu Picchu, the postcard view from the Guardhouse: the saddle between the peaks,
 * its flanks dropping steeply into the Urubamba gorge; the citadel on the saddle (the
 * green main plaza, the stepped urban sector of roofless granite houses, a few
 * re-thatched gables, the Intihuatana hill); the agricultural terraces stepping down the
 * front slope in long curved bands; and behind it all the sugar-loaf of Huayna Picchu
 * with Uña Picchu at its shoulder.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { heightfield, latheArc, painted, rng } from './parts.ts'

const PY = 0.3 // plateau height

/** a steep jittered peak (lathe with seeded radial and height jitter) painted rock/forest by slope */
function peak(k: Kit, x: number, z: number, r: number, h: number, seed: number, lean = 0) {
  const R = rng(seed)
  const n = 11
  const prof: [number, number][] = [[1, 0], [0.82, 0.22], [0.6, 0.45], [0.42, 0.66], [0.25, 0.84], [0.12, 0.95]]
  const V: V3[] = []
  prof.forEach(([f, t], j) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.3
      const rr = r * f * (0.82 + R() * 0.36)
      V.push([x + Math.sin(a) * rr + lean * t * h, t * h * (j ? 0.96 + R() * 0.08 : 1), z + Math.cos(a) * rr])
    }
  })
  V.push([x + lean * h, h, z])
  const T: number[][] = []
  for (let j = 0; j + 1 < prof.length; j++)
    for (let i = 0; i < n; i++) {
      const a = j * n + i, b = j * n + ((i + 1) % n)
      T.push([a, b, b + n], [a, b + n, a + n])
    }
  const last = (prof.length - 1) * n
  for (let i = 0; i < n; i++) T.push([last + i, last + ((i + 1) % n), V.length - 1])
  painted(k, V, T, (t) => {
    const y = T[t].reduce((s, i) => s + V[i][1], 0) / 3
    return y > h * 0.7 && t % 3 === 0 ? M.rock : t % 4 === 0 ? M.greenDark : M.forest
  })
}

export function machuPicchu(k: Kit) {
  // ---- the saddle: an elliptical plateau, its flanks falling steeply into the gorge ----
  const AX = 0.46, AZ = 0.56, CZ = 0.02
  const rho = (x: number, z: number) => Math.hypot(x / AX, (z - CZ) / AZ)
  const fall = (r: number) => (r <= 1 ? PY : PY * Math.exp(-(((r - 1) / 0.62) ** 2)))
  // the terraced sector (front-left): the ground there sits just under the stepped bands
  const terraced = (x: number, z: number) => x < 0.05 && z > -0.45 && rho(x, z) > 0.98
  const H = (x: number, z: number) => {
    const r = rho(x, z)
    return Math.max(0, fall(r) - (terraced(x, z) ? 0.03 : 0) + (r > 1.05 ? 0.012 * Math.sin(x * 13 + z * 7) : 0))
  }
  heightfield(k, -1.05, 1.0, -0.8, 0.85, 18, 14, H, (_x, y, _z, slope) => (y > PY - 0.005 ? M.lawn : slope > 0.6 ? M.rock : y < 0.08 ? M.greenDark : M.forest), M.forest)
  // ---- Huayna Picchu behind, Uña Picchu at its shoulder ----
  peak(k, 0.16, -0.62, 0.3, 1.0, 7, -0.06)
  peak(k, -0.24, -0.55, 0.19, 0.56, 13)
  // ---- agricultural terraces: bands following the contours down the front-left flank ----
  const steps = 8
  const r0 = 1.0, dr = 0.105
  for (let i = 0; i < steps; i++) {
    const ra = r0 + i * dr, rb = ra + dr
    const ya = fall(ra) + 0.004, yb = fall(rb) + 0.004
    const a0 = Math.PI * 1.08, a1 = Math.PI * 1.97
    latheArc(k, 0, 0, CZ, [[ra, yb], [ra, ya]], 12, a0, a1, M.incaStone, AX, AZ) // riser
    latheArc(k, 0, 0, CZ, [[rb, yb], [ra, yb]], 12, a0, a1, M.lawn, AX, AZ) // tread
  }
  // ---- the citadel ----
  // main plaza: the long lawn down the middle of the saddle, a step lower
  k.box(-0.02, PY - 0.004, 0.0, 0.2, 0.008, 0.56, M.green)
  // urban sector (east, right): rows of roofless houses stepping down
  const R = rng(5)
  const house = (x: number, z: number, w: number, d: number, y: number, roof: boolean) => {
    const h = 0.04 + R() * 0.012
    // walls rise from the stepped ground of their row (y is the house floor)
    k.box(x, PY - 0.004, z, w, y - PY + 0.004 + h, d, M.incaStone)
    if (roof) k.gable(x, y + h, z, w + 0.012, 0.035, d + 0.01, M.ochre)
    else k.box(x, y + h - 0.004, z, w - 0.016, 0.006, d - 0.016, M.rockDark) // the open interior
  }
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 5; c++) {
      const y = PY - 0.004 + (3 - r) * 0.012
      house(0.18 + r * 0.075, -0.24 + c * 0.11, 0.06, 0.085, y, (r + c) % 5 === 1)
    }
  // sacred sector (west, left): temples on the higher ground, the Intihuatana hill at the north
  for (let c = 0; c < 4; c++) house(-0.22, -0.18 + c * 0.13, 0.08, 0.1, PY + 0.02, c === 2)
  for (let c = 0; c < 3; c++) house(-0.33, -0.1 + c * 0.15, 0.06, 0.09, PY - 0.004, false)
  for (let i = 0; i < 4; i++) k.frustum4(-0.12, PY - 0.004 + i * 0.022, -0.36, 0.2 - i * 0.04, 0.16 - i * 0.03, 0.18 - i * 0.04, 0.14 - i * 0.03, 0.022, i % 2 ? M.lawn : M.incaStone)
  k.box(-0.12, PY + 0.084, -0.36, 0.02, 0.025, 0.015, M.incaStone) // the hitching post of the sun
  // the round Temple of the Sun (Torreón) and the guardhouse up front
  k.prism(-0.06, PY - 0.004, 0.2, 0.04, 0.04, 0.05, 8, M.incaStone, 0, true)
  house(0.1, 0.4, 0.07, 0.06, PY - 0.004, true)
}
