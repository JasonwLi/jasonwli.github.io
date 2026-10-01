/**
 * Hagia Sophia: the buff-rose mass with the great shallow central dome on its ring of
 * forty windows and buttresses, the pendentive cube with its tympanum walls, the east and
 * west semi-domes each opening into two exedra half-domes, the stepped flying buttress
 * piers on the north and south, the lead-roofed aisles and narthex, and the four Ottoman
 * minarets (the brick south-east one stouter). Main axis east-west along x.
 */
import type { Kit } from '../kit.ts'
import { M } from '../palette.ts'
import { domeProfile, latheArc } from './parts.ts'

const R = 0.236 // dome radius (31 m)

function minaret(k: Kit, x: number, z: number, h: number, r: number, hex: string, balconies: number[]) {
  k.box(x, 0, z, r * 2.6, h * 0.12, r * 2.6, hex) // square base
  k.prism(x, h * 0.12, z, r * 1.25, r * 1.1, h * 0.04, 8, hex, Math.PI / 8, false) // transition
  k.prism(x, h * 0.16, z, r, r * 0.9, h * 0.7, 10, hex, 0, false)
  for (const b of balconies) {
    k.prism(x, h * b, z, r * 1.15, r * 1.65, h * 0.02, 10, hex, 0, true)
    k.prism(x, h * b + h * 0.02, z, r * 1.65, r * 1.6, h * 0.018, 10, hex, 0, false)
  }
  k.prism(x, h * 0.86, z, r * 0.9, r * 0.85, h * 0.02, 10, hex, 0, false)
  k.prism(x, h * 0.86 + h * 0.02, z, r * 1.0, 0, h * 0.12, 10, M.lead)
  k.prism(x, h * 0.98, z, r * 0.12, 0, h * 0.04, 4, M.lead)
}

export function hagiaSophia(k: Kit) {
  // ---- ground mass: aisles, narthex, apse ----
  k.box(0, 0, 0, 0.98, 0.3, 0.88, M.plaster) // nave + aisles block
  for (const s of [-1, 1]) k.gable(0, 0.3, s * 0.3, 0.98, 0.05, 0.28, M.lead) // aisle roofs
  k.box(-0.6, 0, 0, 0.2, 0.26, 0.82, M.plaster) // inner + outer narthex
  k.gable(-0.6, 0.26, 0, 0.2, 0.05, 0.82, M.lead)
  k.box(-0.73, 0, 0, 0.08, 0.2, 0.7, M.plaster)
  latheArc(k, 0.49, 0, 0, [[0.14, 0], [0.14, 0.3]], 6, 0, Math.PI, M.plaster) // apse wall
  latheArc(k, 0.49, 0.3, 0, domeProfile(0.14, 0.1, 3), 6, 0, Math.PI, M.lead) // apse half-dome
  // ---- the pendentive cube and its tympanum walls (north and south) ----
  const cy = 0.3
  k.box(0, cy, 0, 2 * R + 0.06, 0.18, 2 * R + 0.06, M.plaster)
  for (const s of [-1, 1]) {
    const pts: [number, number][] = [[-R - 0.03, 0], [R + 0.03, 0]]
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI
      pts.push([Math.cos(a) * (R + 0.03), 0.015 + Math.sin(a) * 0.04])
    }
    k.push(0, cy + 0.18, s * (R + 0.01))
    k.extrude(pts, 0.04, M.plaster)
    // tympanum windows: a row of dark lights
    for (let i = 0; i < 7; i++) k.box(-0.15 + i * 0.05, -0.06, 0.021, 0.022, 0.05, 0.002, M.rockDark)
    k.pop()
  }
  // ---- the four great buttress piers, north and south, stepped ----
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 0.22, z = sz * 0.44
      k.box(x, 0, z, 0.15, 0.4, 0.14, M.plaster)
      k.frustum4(x, 0.4, z, 0.15, 0.14, 0.12, 0.08, 0.07, M.plaster, 0, -sz * 0.02)
      k.box(x, 0.47, z - sz * 0.02, 0.12, 0.012, 0.09, M.lead)
      // flying arch to the cube
      k.beam([x, 0.43, z - sz * 0.05], [x, 0.5, sz * (R + 0.02)], 0.06, 0.035, M.plaster)
    }
  // ---- semi-domes east and west, with their exedrae ----
  const sy = 0.4
  for (const s of [-1, 1]) {
    const a0 = s > 0 ? 0 : Math.PI
    // quarter-sphere opening toward the centre: half a dome on the outer side
    latheArc(k, s * (R + 0.02), sy, 0, [[R, 0], [R, 0.035]], 10, a0, a0 + Math.PI, M.plaster)
    latheArc(k, s * (R + 0.02), sy + 0.035, 0, domeProfile(R, 0.125, 4, 0.9), 12, a0, a0 + Math.PI, M.lead)
    for (const sz of [-1, 1]) {
      const ex = s * (R + 0.14), ez = sz * 0.18
      const ea = Math.atan2(s, sz * 0.9) - Math.PI / 2
      latheArc(k, ex, sy - 0.08, ez, [[0.1, 0], [0.1, 0.04]], 6, ea, ea + Math.PI, M.plaster)
      latheArc(k, ex, sy - 0.04, ez, domeProfile(0.1, 0.07, 3), 6, ea, ea + Math.PI, M.lead)
    }
  }
  // ---- drum: the ring of 40 windows between buttresses, then the dome ----
  const dy = 0.515
  k.box(0, cy + 0.18, 0, 2 * R + 0.02, dy - cy - 0.18, 2 * R + 0.02, M.plaster) // pendentive crown
  k.prism(0, dy, 0, R + 0.005, R + 0.005, 0.075, 20, M.plaster, 0, false)
  for (let i = 0; i < 20; i++) {
    const a = ((i + 0.5) / 20) * Math.PI * 2
    const x = Math.sin(a) * (R + 0.012), z = Math.cos(a) * (R + 0.012)
    k.push(x, dy, z, a)
    k.frustum4(0, 0, 0, 0.022, 0.034, 0.018, 0.014, 0.075, M.plaster)
    k.pop()
    // windows between them
    const b = (i / 20) * Math.PI * 2
    k.push(Math.sin(b) * (R + 0.007), dy + 0.018, Math.cos(b) * (R + 0.007), b)
    k.prim([[-0.012, 0, 0], [0.012, 0, 0], [0.012, 0.04, 0], [-0.012, 0.04, 0]], [[0, 1, 2], [0, 2, 3]], M.rockDark)
    k.pop()
  }
  k.lathe(0, dy + 0.075, 0, [[R + 0.012, 0], ...domeProfile(R, 0.2, 5, 0.85).slice(0, -1).map(([r, y]): [number, number] => [r, y + 0.006]), [0, 0.206]], 24, M.lead)
  k.prism(0, dy + 0.281, 0, 0.01, 0, 0.05, 4, M.bronze) // crescent finial
  // ---- minarets: SE brick (stout), the others limestone ----
  minaret(k, 0.62, 0.6, 0.9, 0.034, M.brick, [0.62])
  minaret(k, -0.78, 0.56, 0.95, 0.03, M.limestone, [0.56, 0.72])
  minaret(k, -0.78, -0.56, 0.95, 0.03, M.limestone, [0.56, 0.72])
  minaret(k, 0.64, -0.58, 0.88, 0.032, M.limestone, [0.62])
}
