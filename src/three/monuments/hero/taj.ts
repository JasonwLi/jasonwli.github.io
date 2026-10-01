/**
 * Taj Mahal: the red sandstone terrace and the square white marble plinth; the
 * chamfered mausoleum with a tall pishtaq (iwan frame rising above the parapet, its deep
 * pointed-arch recess) on each face and two storeys of smaller arched alcoves on the
 * flanks and chamfers, guldasta pinnacles on the corners; the onion dome on its tall
 * drum with the lotus crown and finial; the four chhatris round it; and the four
 * three-tier minarets with their balconies and chhatri caps at the plinth corners.
 */
import type { Kit } from '../kit.ts'
import { M } from '../palette.ts'
import { archHole, bayOutline, slab } from './parts.ts'

const P = 0.66 // plinth half width
const PH = 0.08 // plinth height
const B = 0.4 // mausoleum half width
const C = 0.12 // chamfer
const BH = 0.42 // body height above the plinth (parapet)

function chhatri(k: Kit, x: number, y: number, z: number, r: number, h: number, pillars = true) {
  k.prism(x, y, z, r * 1.1, r * 1.1, h * 0.12, 8, M.marble, Math.PI / 8, false) // base
  if (pillars)
    for (let i = 0; i < 8; i += 2) {
      const a = Math.PI / 8 + (i / 8) * Math.PI * 2
      const p: [number, number, number] = [x + Math.sin(a) * r * 0.85, y + h * 0.12, z + Math.cos(a) * r * 0.85]
      k.beam(p, [p[0], p[1] + h * 0.36, p[2]], r * 0.22, r * 0.22, M.marble, false)
    }
  k.prism(x, y + h * 0.12, z, r * 0.55, r * 0.55, h * 0.36, 8, M.stoneShade, Math.PI / 8, false) // shaded interior
  k.prism(x, y + h * 0.48, z, r * 1.25, r * 1.0, h * 0.06, 8, M.marble, Math.PI / 8, true) // chhajja eave
  k.lathe(x, y + h * 0.54, z, [[r * 0.85, 0], [r * 1.0, h * 0.12], [r * 0.75, h * 0.26], [r * 0.25, h * 0.38], [0, h * 0.42]], 8, M.marble)
  k.prism(x, y + h * 0.96, z, r * 0.08, 0, h * 0.1, 4, M.marble)
}

function minaret(k: Kit, x: number, z: number, y0: number, h: number) {
  const r = 0.042
  k.prism(x, y0, z, r * 1.5, r * 1.5, h * 0.05, 8, M.marble, Math.PI / 8, false)
  const tiers = [[0.05, 0.36], [0.4, 0.28], [0.7, 0.18]]
  tiers.forEach(([a, len], i) => {
    const rr = r * (1 - i * 0.1)
    k.prism(x, y0 + h * a, z, rr, rr * 0.94, h * len, 8, M.marble, Math.PI / 8, false)
    // balcony
    const yb = y0 + h * (a + len)
    k.prism(x, yb - h * 0.01, z, rr * 1.6, rr * 1.6, h * 0.024, 8, M.marble, Math.PI / 8, true)
  })
  chhatri(k, x, y0 + h * 0.9, z, r * 1.25, h * 0.2, false)
}

export function taj(k: Kit) {
  // red sandstone terrace, then the marble plinth with its arcaded face
  k.box(0, 0, 0, P * 2 + 0.24, 0.025, P * 2 + 0.14, M.redstone)
  k.box(0, 0.025, 0, P * 2, PH - 0.025, P * 2, M.marble)
  // the plinth's arcade of blind niches: flat dark panels on each face
  for (let f = 0; f < 4; f++) {
    k.push(0, 0, 0, (f * Math.PI) / 2)
    for (let i = 0; i < 11; i++) {
      const t = -P + 0.08 + (i * (2 * P - 0.16)) / 10
      k.prim([[t - 0.025, 0.035, P + 0.001], [t + 0.025, 0.035, P + 0.001], [t + 0.025, 0.07, P + 0.001], [t - 0.025, 0.07, P + 0.001]], [[0, 1, 2], [0, 2, 3]], M.stoneShade)
    }
    k.pop()
  }
  const y0 = PH
  // ---- the chamfered body: an irregular octagon ----
  const oct: [number, number][] = [[-B + C, -B], [B - C, -B], [B, -B + C], [B, B - C], [B - C, B], [-B + C, B], [-B, B - C], [-B, -B + C]]
  const V: [number, number, number][] = []
  for (const [x, z] of oct) V.push([x, y0, z])
  for (const [x, z] of oct) V.push([x, y0 + BH, z])
  const T: number[][] = []
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    T.push([i, j, 8 + j], [i, 8 + j, 8 + i])
  }
  for (let i = 1; i < 7; i++) T.push([8, 8 + i, 8 + i + 1])
  k.prim(V, T, M.marble)
  // parapet band: the same chamfered outline, a hair proud
  const PV: [number, number, number][] = []
  for (const [x, z] of oct) PV.push([x * 1.025, y0 + BH - 0.004, z * 1.025])
  for (const [x, z] of oct) PV.push([x * 1.025, y0 + BH + 0.02, z * 1.025])
  const PT: number[][] = []
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    PT.push([i, j, 8 + j], [i, 8 + j, 8 + i])
  }
  k.prim(PV, PT, M.marble)

  // ---- the four pishtaqs, plus alcoves on the flanks and the chamfers ----
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2
    k.push(Math.sin(a) * B, y0, Math.cos(a) * B, a)
    // the frame rising above the parapet, with its tall pointed arch cut through it
    const fw = 0.34, fh = BH + 0.08
    const arch = bayOutline(fw, fh, 0.2, 0.25, 6, true)
    slab(k, arch, 0.05, M.marble, (i) => i >= 1 && i <= arch.length - 5)
    // the recess: back wall and the half-vault hood, in shade
    k.box(0, 0, -0.035, 0.2, 0.36, 0.02, M.stoneShade)
    k.box(0, 0.0, -0.01, 0.07, 0.12, 0.002, M.dark) // the doorway grille
    k.box(0, 0.16, -0.01, 0.14, 0.08, 0.002, M.stoneShade)
    // calligraphy band framing the arch
    k.box(0, fh - 0.04, 0.026, fw - 0.04, 0.01, 0.002, M.stoneShade)
    for (const s of [-1, 1]) k.box(s * (fw / 2 - 0.02), 0.02, 0.026, 0.01, fh - 0.06, 0.002, M.stoneShade)
    // guldasta pinnacles at the frame corners
    for (const s of [-1, 1]) {
      k.prism(s * fw / 2, 0, 0.0, 0.016, 0.016, fh + 0.05, 8, M.marble, 0, false)
      k.lathe(s * fw / 2, fh + 0.05, 0, [[0.02, 0], [0.022, 0.012], [0, 0.04]], 6, M.marble)
    }
    // two storeys of alcoves on each flank of the frame
    for (const s of [-1, 1])
      for (const yy of [0.03, 0.22]) {
        k.push(s * 0.26, yy, 0.002)
        const h = archHole(0, 0, 0.08, 0.11, 4, true)
        k.prim(h.map(([x, y]): [number, number, number] => [x, y, 0]), h.slice(1, -1).map((_, i) => [0, i + 1, i + 2]), M.stoneShade)
        k.pop()
      }
    k.pop()
    // chamfer alcoves
    const c = a + Math.PI / 4
    const d = (B - C / 2) * Math.SQRT2 * 0.995
    k.push(Math.sin(c) * d, y0, Math.cos(c) * d, c)
    for (const yy of [0.03, 0.22]) {
      k.push(0, yy, 0.004)
      const h = archHole(0, 0, 0.09, 0.11, 4, true)
      k.prim(h.map(([x, y]): [number, number, number] => [x, y, 0]), h.slice(1, -1).map((_, i) => [0, i + 1, i + 2]), M.stoneShade)
      k.pop()
    }
    k.pop()
  }

  // ---- dome: drum, onion, lotus crown, finial ----
  const yd = y0 + BH + 0.02
  k.prism(0, yd, 0, 0.2, 0.2, 0.12, 16, M.marble, 0, false)
  k.prism(0, yd + 0.12, 0, 0.21, 0.205, 0.015, 16, M.marble, 0, false)
  const R = 0.235
  k.lathe(0, yd + 0.135, 0, [
    [0.2, 0], [0.228, 0.05], [R, 0.1], [0.228, 0.15], [0.2, 0.2], [0.15, 0.25], [0.09, 0.29], [0.045, 0.32], [0.02, 0.345], [0, 0.35],
  ], 20, M.marble)
  k.lathe(0, yd + 0.48, 0, [[0.028, 0], [0.035, 0.012], [0.012, 0.03], [0.02, 0.05], [0.006, 0.07], [0, 0.11]], 6, M.marble)
  // ---- four chhatris on the roof corners ----
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) chhatri(k, sx * 0.25, yd - 0.02, sz * 0.25, 0.07, 0.2)
  // ---- minarets at the plinth corners ----
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) minaret(k, sx * (P - 0.05), sz * (P - 0.05), PH, 0.62)
}
