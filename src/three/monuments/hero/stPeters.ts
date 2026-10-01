/**
 * St Peter's Basilica and Square: Maderno's travertine facade (giant Corinthian order,
 * central pediment, the benediction loggia, attic crowned by its row of statues, the
 * clock bays at the ends) before the long nave; Michelangelo's Greek-cross body with its
 * apsidal arms; the drum ringed by paired-column buttresses; the raised lead dome with
 * its sixteen travertine ribs, the lantern, ball and cross; Vignola's minor cupolas; and
 * in front Bernini's keyhole piazza: the straight corridors, the two curved four-column
 * colonnade arms embracing the oval, the obelisk and the two fountains.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { latheArc } from './parts.ts'

const FZ = 0.3 // facade front plane
const DZ = -0.45 // dome centre

function dome(k: Kit, x: number, y0: number, z: number, s: number, ribs: number, drum: boolean) {
  const r = 0.165 * s
  if (drum) {
    k.prism(x, y0, z, r * 0.98, r * 0.98, 0.14 * s, 16, M.travertine, 0, false)
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2
      const p: V3 = [x + Math.sin(a) * r * 1.02, y0, z + Math.cos(a) * r * 1.02]
      k.beam(p, [p[0], y0 + 0.14 * s, p[2]], 0.032 * s, 0.03 * s, M.travertine, false)
      const b = a + Math.PI / ribs
      k.push(x + Math.sin(b) * r * 0.99, y0 + 0.04 * s, z + Math.cos(b) * r * 0.99, b)
      k.prim([[-0.012 * s, 0, 0], [0.012 * s, 0, 0], [0.012 * s, 0.05 * s, 0], [-0.012 * s, 0.05 * s, 0]], [[0, 1, 2], [0, 2, 3]], M.rockDark)
      k.pop()
    }
    k.prism(x, y0 + 0.14 * s, z, r * 1.06, r * 1.04, 0.02 * s, 16, M.travertine, 0, false) // attic of the drum
    y0 += 0.16 * s
  }
  const prof: [number, number][] = [[1, 0], [0.97, 0.3], [0.88, 0.56], [0.7, 0.78], [0.45, 0.93], [0.24, 1.0]]
  const H = 0.26 * s
  const n = drum ? 24 : 12
  k.lathe(x, y0, z, prof.map(([f, t]): [number, number] => [f * r, t * H]), n, M.lead, 0, true)
  // ribs: flat travertine strips standing just proud of the lead
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2
    const V: V3[] = []
    for (const [f, t] of prof) {
      const rr = f * r * 1.012 + 0.002
      for (const da of [-0.045, 0.045]) V.push([x + Math.sin(a + da) * rr, y0 + t * H + 0.002, z + Math.cos(a + da) * rr])
    }
    const T: number[][] = []
    for (let j = 0; j + 1 < prof.length; j++) T.push([j * 2, j * 2 + 1, j * 2 + 3], [j * 2, j * 2 + 3, j * 2 + 2])
    k.prim(V, T, M.travertine)
  }
  // lantern, cupola, ball and cross
  const yl = y0 + H
  k.prism(x, yl, z, 0.24 * r, 0.24 * r, 0.07 * s, 8, M.travertine, 0, false)
  k.lathe(x, yl + 0.07 * s, z, [[0.28 * r, 0], [0.2 * r, 0.03 * s], [0.04 * r, 0.06 * s]], 8, M.lead)
  if (drum) {
    k.prism(x, yl + 0.13 * s, z, 0.012, 0.012, 0.012, 6, M.bronze)
    k.box(x, yl + 0.142 * s, z, 0.006, 0.04, 0.006, M.bronze)
    k.box(x, yl + 0.162 * s, z, 0.022, 0.006, 0.006, M.bronze)
  }
}

export function stPeters(k: Kit) {
  // ---- Michelangelo's body: Greek cross with apsidal arms ----
  const BH = 0.34
  k.box(0, 0, DZ, 0.5, BH, 0.5, M.travertine)
  for (const [ax, az] of [[1, 0], [-1, 0], [0, -1]]) {
    const cx = ax * 0.36, cz = DZ + az * 0.36
    k.box(cx, 0, cz, ax ? 0.22 : 0.4, BH, az ? 0.22 : 0.4, M.travertine)
    const a0 = Math.atan2(ax, az) - Math.PI / 2
    latheArc(k, ax * 0.47, 0, DZ + az * 0.47, [[0.2, 0], [0.2, BH]], 8, a0, a0 + Math.PI, M.travertine)
    latheArc(k, ax * 0.47, BH, DZ + az * 0.47, [[0.2, 0], [0, 0.06]], 8, a0, a0 + Math.PI, M.lead)
    k.gable(ax ? cx : 0, BH, az ? cz : DZ, ax ? 0.22 : 0.4, 0.06, az ? 0.22 : 0.4, M.lead)
  }
  k.box(0, BH - 0.03, DZ, 0.54, 0.03, 0.54, M.travertine) // attic band
  // ---- nave (Maderno) back from the facade to the crossing ----
  k.box(0, 0, (FZ + DZ) / 2, 0.38, 0.3, FZ - DZ - 0.1, M.travertine)
  k.gable(0, 0.3, (FZ + DZ) / 2 + 0.02, 0.38, 0.07, FZ - DZ - 0.12, M.lead)
  for (const s of [-1, 1]) k.box(s * 0.27, 0, (FZ + DZ) / 2 + 0.05, 0.16, 0.2, 0.45, M.travertine) // side chapels
  // ---- facade ----
  const FW = 0.84
  k.box(0, 0, FZ - 0.03, FW, 0.27, 0.06, M.travertine)
  k.box(0, 0.27, FZ - 0.02, FW + 0.02, 0.03, 0.08, M.travertine) // entablature
  k.box(0, 0.3, FZ - 0.03, FW, 0.045, 0.06, M.travertine) // attic
  // the giant order: eight columns and pilasters
  for (const x of [-0.39, -0.3, -0.19, -0.1, -0.04, 0.04, 0.1, 0.19, 0.3, 0.39]) {
    const col = Math.abs(x) < 0.12
    k.beam([x, 0, FZ + (col ? 0.014 : 0.004)], [x, 0.27, FZ + (col ? 0.014 : 0.004)], col ? 0.028 : 0.026, col ? 0.028 : 0.012, M.travertine, false)
  }
  // central pediment over the four columns
  k.push(0, 0.3, FZ + 0.005)
  k.prim([[-0.13, 0, 0.03], [0.13, 0, 0.03], [0, 0.07, 0.03], [-0.13, 0, -0.03], [0.13, 0, -0.03], [0, 0.07, -0.03]],
    [[0, 1, 2], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2]], M.travertine)
  k.pop()
  // doors, the benediction loggia and windows (dark)
  for (const x of [-0.145, -0.07, 0, 0.07, 0.145]) k.box(x, 0, FZ + 0.0005, 0.04, x ? 0.09 : 0.11, 0.002, M.dark)
  k.box(0, 0.16, FZ + 0.0005, 0.05, 0.07, 0.002, M.rockDark)
  for (const x of [-0.25, 0.25]) k.box(x, 0.14, FZ + 0.0005, 0.04, 0.06, 0.002, M.rockDark)
  // statues along the attic
  for (let i = 0; i < 11; i++) {
    const x = -0.36 + (i * 0.72) / 10
    k.prism(x, 0.345, FZ - 0.005, 0.009, 0.006, 0.035, 4, M.travertine)
  }
  // the clock bays at the ends
  for (const s of [-1, 1]) {
    k.box(s * 0.47, 0, FZ - 0.04, 0.1, 0.3, 0.07, M.travertine)
    k.prism(s * 0.47, 0.3, FZ - 0.04, 0.03, 0.03, 0.03, 8, M.travertine, 0, false)
    k.lathe(s * 0.47, 0.33, FZ - 0.04, [[0.032, 0], [0.025, 0.02], [0, 0.035]], 8, M.lead)
  }
  // ---- domes ----
  dome(k, 0, BH, DZ, 1, 16, true)
  for (const [x, z] of [[-0.29, DZ + 0.29], [0.29, DZ + 0.29]]) {
    k.prism(x, BH, z, 0.06, 0.06, 0.06, 12, M.travertine, 0, false)
    dome(k, x, BH + 0.06, z, 0.38, 8, false)
  }
  // ---- Bernini's piazza ----
  const OZ = 0.98, OX = 0.8, OB = 0.48
  k.box(0, 0, (FZ + OZ - OB) / 2 + 0.06, 0.66, 0.004, OZ - OB - FZ + 0.06, M.stoneShade) // piazza retta
  k.lathe(0, 0, OZ, [[1, 0.003], [0, 0.003]], 24, M.stoneShade, 0, true, OX, OB) // oval paving
  // straight corridors from the facade ends to the oval
  for (const s of [-1, 1]) {
    const end: V3 = [s * Math.sin(Math.PI * 0.2) * (OX + 0.06), 0, OZ - Math.cos(Math.PI * 0.2) * (OB + 0.06)]
    k.beam([s * 0.47, 0.065, FZ + 0.02], [end[0], 0.065, end[2]], 0.13, 0.13, M.travertine)
    k.beam([s * 0.47, 0.135, FZ + 0.02], [end[0], 0.135, end[2]], 0.1, 0.012, M.lead)
  }
  // the curved colonnade arms: roof with balustrade, outer and inner column rows
  const seg = 8
  for (const s of [-1, 1]) {
    // angle from the oval's back (toward the facade) round the side to the open front
    const a0 = Math.PI * 0.2, a1 = Math.PI * 0.8
    const P = (t: number, f: number, y: number): V3 => [s * Math.sin(t) * (OX + f), y, OZ - Math.cos(t) * (OB + f)]
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg
      k.beam(P(t0, 0.06, 0.135), P(t1, 0.06, 0.135), 0.13, 0.04, M.travertine) // entablature, roof and balustrade
      for (let c = 0; c < 2; c++) {
        const t = t0 + ((t1 - t0) * (c + 0.5)) / 2
        for (const f of [0.0, 0.12]) {
          const b = P(t, f, 0)
          k.beam(b, [b[0], 0.115, b[2]], 0.018, 0.018, M.travertine, false)
        }
      }
      // statues on the balustrade
      if (i % 2 === 0) {
        const b = P((t0 + t1) / 2, 0.06, 0.155)
        k.prism(b[0], 0.155, b[2], 0.008, 0.005, 0.03, 4, M.travertine)
      }
    }
  }
  // obelisk and the two fountains
  k.box(0, 0, OZ, 0.04, 0.03, 0.04, M.stoneShade)
  k.frustum4(0, 0.03, OZ, 0.024, 0.024, 0.015, 0.015, 0.18, M.limestone)
  k.frustum4(0, 0.21, OZ, 0.015, 0.015, 0, 0, 0.02, M.bronze)
  for (const s of [-1, 1]) {
    k.prism(s * 0.36, 0, OZ, 0.045, 0.045, 0.012, 10, M.stoneShade, 0, true)
    k.prism(s * 0.36, 0.012, OZ, 0.012, 0.02, 0.03, 8, M.travertine, 0, true)
  }
}
