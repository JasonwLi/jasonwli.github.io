/**
 * Machu Picchu, the postcard view from the Guardhouse: the saddle between the peaks,
 * its flanks dropping steeply into the Urubamba gorge; the citadel on the saddle (the
 * green main plaza, the stepped urban sector of roofless granite houses, a few
 * re-thatched gables, the Intihuatana hill); the agricultural terraces stepping down the
 * front slope in long curved bands; and behind it all the sugar-loaf of Huayna Picchu
 * with Uña Picchu at its shoulder.
 *
 * Miniature legibility (32-48 px on the painted globe): the ruins and terrace walls are
 * pale granite (graniteLight) over mid-green terrace treads, so the citadel and the stepped
 * bands read against the mountain. Huayna Picchu and the flanks are a MID cloud-forest green
 * (cloudForest / scrubMid, L 0.45-0.49) with mid rock (rockMid) on a mid-umber rim
 * (plinthMid), and the flanks fall off quickly: at the wide travel view the deep greens and
 * the dark plinth read as one dark heap on the Andes (step-6 fix), so the dark mass is kept
 * small and the pale granite dominates.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import * as THREE from 'three'
import { gridTris, latheArc, painted, rng } from './parts.ts'

const PY = 0.3 // plateau height
const PL = 0.035 // plinth height

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
    return y > h * 0.7 && t % 3 === 0 ? M.rockMid : t % 4 === 0 ? M.scrubMid : M.cloudForest
  })
}

/**
 * A heightfield over a rounded (elliptical) footprint: the square grid is mapped onto the
 * disc (x = u sqrt(1 - v^2/2), z = v sqrt(1 - u^2/2)) so the patch has no square corners
 * (a square tile read as a dark box at wide-view size), with one skirt ring down to y = 0.
 */
function heightDisc(
  k: Kit, cx: number, cz: number, rx: number, rz: number, n: number,
  h: (x: number, z: number) => number, colourAt: (y: number, slope: number) => string, skirt: string,
) {
  const V: V3[] = []
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const u = (2 * i) / n - 1, v = (2 * j) / n - 1
      const x = cx + rx * u * Math.sqrt(1 - (v * v) / 2), z = cz + rz * v * Math.sqrt(1 - (u * u) / 2)
      V.push([x, h(x, z), z])
    }
  const T = gridTris(n + 1, n + 1)
  const nn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3()
  painted(k, V, T, (t) => {
    const [a, b, c] = T[t].map((i) => V[i])
    e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    nn.crossVectors(e1, e2).normalize()
    return colourAt((a[1] + b[1] + c[1]) / 3, 1 - Math.abs(nn.y))
  })
  const at = (i: number, j: number) => V[j * (n + 1) + i]
  const ring: V3[] = []
  for (let i = 0; i < n; i++) ring.push(at(i, 0))
  for (let j = 0; j < n; j++) ring.push(at(n, j))
  for (let i = n; i > 0; i--) ring.push(at(i, n))
  for (let j = n; j > 0; j--) ring.push(at(0, j))
  ring.push(ring[0])
  const SV: V3[] = []
  for (const p of ring) SV.push(p, [p[0], 0, p[2]])
  const ST: number[][] = []
  for (let i = 0; i + 1 < ring.length; i++) ST.push([i * 2, i * 2 + 2, i * 2 + 3], [i * 2, i * 2 + 3, i * 2 + 1])
  k.prim(SV, ST, skirt)
}

export function machuPicchu(k: Kit) {
  // ---- the saddle: an elliptical plateau, its flanks falling steeply into the gorge ----
  const AX = 0.46, AZ = 0.56, CZ = 0.02
  const rho = (x: number, z: number) => Math.hypot(x / AX, (z - CZ) / AZ)
  const fall = (r: number) => (r <= 1 ? PY : PY * Math.exp(-(((r - 1) / 0.5) ** 2)))
  // the terraced sector (front-left): the ground there sits just under the stepped bands
  const terraced = (x: number, z: number) => x < 0.05 && z > -0.45 && rho(x, z) > 0.98
  const H = (x: number, z: number) => {
    const r = rho(x, z)
    return Math.max(0, fall(r) - (terraced(x, z) ? 0.03 : 0) + (r > 1.05 ? 0.012 * Math.sin(x * 13 + z * 7) : 0))
  }
  // a thin mid-umber rim under the rounded patch, everything else stands on it
  k.prism(-0.03, 0, 0.02, 0.9, 0.88, PL, 20, M.plinthMid)
  k.push(0, PL, 0)
  heightDisc(k, -0.03, 0.02, 0.9, 0.84, 16, H, (y, slope) => (y > PY - 0.005 ? M.terrace : slope > 0.6 ? M.rockMid : y < 0.08 ? M.scrubMid : M.cloudForest), M.plinthMid)
  // ---- Huayna Picchu behind, Uña Picchu at its shoulder ----
  peak(k, 0.16, -0.62, 0.3, 0.9, 7, -0.06)
  peak(k, -0.24, -0.55, 0.19, 0.56, 13)
  // ---- agricultural terraces: bands following the contours down the front-left flank ----
  const steps = 8
  const r0 = 1.0, dr = 0.105
  for (let i = 0; i < steps; i++) {
    const ra = r0 + i * dr, rb = ra + dr
    const ya = fall(ra) + 0.004, yb = fall(rb) + 0.004
    const a0 = Math.PI * 1.08, a1 = Math.PI * 1.97
    latheArc(k, 0, 0, CZ, [[ra, yb - 0.01], [ra, ya + 0.006]], 12, a0, a1, M.graniteLight, AX, AZ) // riser: a pale stone lip standing proud of the tread
    latheArc(k, 0, 0, CZ, [[rb, yb], [ra, yb]], 12, a0, a1, M.terrace, AX, AZ) // tread
  }
  // ---- the citadel ----
  // main plaza: the long lawn down the middle of the saddle, a step lower
  k.box(-0.02, PY - 0.004, 0.0, 0.2, 0.008, 0.56, M.lawn)
  // urban sector (east, right): rows of roofless houses stepping down
  const R = rng(5)
  const house = (x: number, z: number, w: number, d: number, y: number, roof: boolean) => {
    const h = 0.052 + R() * 0.012 // a touch over scale so the citadel reads at 32-48 px
    // walls rise from the stepped ground of their row (y is the house floor)
    k.box(x, PY - 0.004, z, w, y - PY + 0.004 + h, d, M.graniteLight)
    if (roof) k.gable(x, y + h, z, w + 0.012, 0.035, d + 0.01, M.ochre)
    else k.box(x, y + h - 0.004, z, w - 0.02, 0.006, d - 0.02, M.stoneShade) // the open interior, a mid cut inside the pale walls (a dark one turned the block into a checker)
  }
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 5; c++) {
      const y = PY - 0.004 + (3 - r) * 0.012
      house(0.18 + r * 0.075, -0.24 + c * 0.11, 0.06, 0.085, y, (r + c) % 5 === 1)
    }
  // sacred sector (west, left): temples on the higher ground, the Intihuatana hill at the north
  for (let c = 0; c < 4; c++) house(-0.22, -0.18 + c * 0.13, 0.08, 0.1, PY + 0.02, c === 2)
  for (let c = 0; c < 3; c++) house(-0.33, -0.1 + c * 0.15, 0.06, 0.09, PY - 0.004, false)
  for (let i = 0; i < 4; i++) k.frustum4(-0.12, PY - 0.004 + i * 0.022, -0.36, 0.2 - i * 0.04, 0.16 - i * 0.03, 0.18 - i * 0.04, 0.14 - i * 0.03, 0.022, i % 2 ? M.lawn : M.graniteLight)
  k.box(-0.12, PY + 0.084, -0.36, 0.02, 0.025, 0.015, M.graniteLight) // the hitching post of the sun
  // the round Temple of the Sun (Torreón) and the guardhouse up front
  k.prism(-0.06, PY - 0.004, 0.2, 0.04, 0.04, 0.05, 8, M.graniteLight, 0, true)
  house(0.1, 0.4, 0.07, 0.06, PY - 0.004, true)
  k.pop() // the plinth lift
}
