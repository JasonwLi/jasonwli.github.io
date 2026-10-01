/**
 * Big Ben (the Elizabeth Tower) at the north end of the Palace of Westminster: the
 * honey limestone shaft with its Perpendicular panelling and string courses, the
 * projecting clock stage with the four great dials under their gablets, the open belfry,
 * the steep cast-iron spire with its corner pinnacles and lucarnes, the lantern and
 * finial; beside it a stretch of the Palace's river front with its bays, pinnacled
 * roofline and slate roof.
 */
import type { Kit } from '../kit.ts'
import { M } from '../palette.ts'

const S = 0.125 // shaft width (12 m of 96 m)

function dial(k: Kit, r: number) {
  // opal glass dial, iron rim ring, two hands (local plane z = 0)
  const n = 16
  const V: [number, number, number][] = [[0, 0, 0]]
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    V.push([Math.sin(a) * r, Math.cos(a) * r, 0])
  }
  k.prim(V, Array.from({ length: n }, (_, i) => [0, 1 + i, 1 + ((i + 1) % n)]), M.chalk)
  const R: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    R.push([Math.sin(a) * r, Math.cos(a) * r, 0.001], [Math.sin(a) * r * 1.22, Math.cos(a) * r * 1.22, 0.001])
  }
  k.prim(R, Array.from({ length: n }, (_, i) => {
    const j = (i + 1) % n
    return [[i * 2, j * 2, j * 2 + 1], [i * 2, j * 2 + 1, i * 2 + 1]]
  }).flat(), M.anston)
  k.prim([[-0.002, 0, 0.002], [0.002, 0, 0.002], [0, r * 0.8, 0.002]], [[0, 1, 2]], M.dark)
  k.prim([[0, -0.002, 0.002], [0, 0.002, 0.002], [r * 0.55, r * 0.25, 0.002]], [[0, 1, 2]], M.dark)
}

export function bigBen(k: Kit) {
  // ---- the tower ----
  const tx = 0.18, tz = 0.05
  k.push(tx, 0, tz)
  k.box(0, 0, 0, S + 0.012, 0.03, S + 0.012, M.anston) // plinth
  k.box(0, 0.03, 0, S, 0.5, S, M.anston)
  // Perpendicular panelling: vertical mullion ribs and string courses on each face
  for (let f = 0; f < 4; f++) {
    k.push(0, 0, 0, (f * Math.PI) / 2)
    for (const x of [-0.042, -0.014, 0.014, 0.042]) k.box(x, 0.06, S / 2, 0.006, 0.46, 0.006, M.anston)
    for (const y of [0.16, 0.3, 0.42]) k.box(0, y, S / 2 + 0.002, S, 0.008, 0.004, M.anston)
    // the recessed panels between ribs
    for (const x of [-0.028, 0, 0.028]) k.box(x, 0.07, S / 2 - 0.001, 0.02, 0.44, 0.002, M.cliff)
    k.pop()
  }
  // corner buttress shafts
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(sx * S / 2, 0.03, sz * S / 2, 0.016, 0.62, 0.016, M.anston)
  // ---- clock stage ----
  const cy = 0.53
  const CS = S + 0.02
  k.box(0, cy, 0, CS, 0.13, CS, M.anston)
  k.box(0, cy + 0.13, 0, CS + 0.008, 0.012, CS + 0.008, M.anston)
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2
    k.push(Math.sin(a) * (CS / 2 + 0.001), cy + 0.068, Math.cos(a) * (CS / 2 + 0.001), a)
    dial(k, 0.04)
    k.pop()
    // gablet over each dial with its pinnacles
    k.push(Math.sin(a) * (CS / 2), cy + 0.142, Math.cos(a) * (CS / 2), a)
    k.prim([[-0.05, 0, 0.004], [0.05, 0, 0.004], [0, 0.04, 0.004], [-0.05, 0, -0.02], [0.05, 0, -0.02], [0, 0.04, -0.02]],
      [[0, 1, 2], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2]], M.anston)
    k.pop()
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.box(sx * CS / 2, cy, sz * CS / 2, 0.02, 0.16, 0.02, M.anston)
    k.prism(sx * CS / 2, cy + 0.16, sz * CS / 2, 0.012, 0, 0.05, 4, M.anston, Math.PI / 4)
  }
  // ---- belfry: open arcade ----
  const by = cy + 0.142
  k.box(0, by, 0, S - 0.005, 0.07, S - 0.005, M.anston)
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2
    k.push(Math.sin(a) * (S / 2 - 0.0015), by + 0.012, Math.cos(a) * (S / 2 - 0.0015), a)
    for (const x of [-0.034, 0, 0.034]) k.box(x, 0, 0, 0.024, 0.048, 0.002, M.dark)
    k.pop()
  }
  k.box(0, by + 0.07, 0, S + 0.006, 0.01, S + 0.006, M.anston)
  // ---- spire: steep iron pyramid, lucarnes, corner pinnacles, lantern, finial ----
  const sy = by + 0.08
  k.frustum4(0, sy, 0, S - 0.01, S - 0.01, 0.03, 0.03, 0.15, M.iron)
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2
    k.push(Math.sin(a) * 0.045, sy + 0.02, Math.cos(a) * 0.045, a)
    k.box(0, 0, 0, 0.026, 0.035, 0.02, M.iron)
    k.prim([[-0.016, 0.035, 0.01], [0.016, 0.035, 0.01], [0, 0.06, 0.01], [-0.016, 0.035, -0.01], [0.016, 0.035, -0.01], [0, 0.06, -0.01]],
      [[0, 1, 2], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2]], M.iron)
    k.pop()
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    k.prism(sx * (S / 2 - 0.006), sy, sz * (S / 2 - 0.006), 0.011, 0.011, 0.04, 4, M.anston, Math.PI / 4, false)
    k.prism(sx * (S / 2 - 0.006), sy + 0.04, sz * (S / 2 - 0.006), 0.013, 0, 0.06, 4, M.iron, Math.PI / 4)
  }
  k.prism(0, sy + 0.15, 0, 0.02, 0.016, 0.03, 8, M.iron, 0, false) // lantern
  k.prism(0, sy + 0.18, 0, 0.018, 0, 0.06, 8, M.iron)
  k.prism(0, sy + 0.24, 0, 0.004, 0.002, 0.04, 4, M.bronze) // finial and cross
  k.pop()
  // ---- the Palace's river front ----
  const pz = -0.02
  k.box(-0.42, 0, pz, 0.92, 0.17, 0.2, M.anston)
  k.gable(-0.42, 0.17, pz, 0.92, 0.045, 0.2, M.slate)
  k.box(-0.42, 0, pz + 0.105, 0.92, 0.015, 0.012, M.cliff) // terrace edge
  for (let i = 0; i < 13; i++) {
    const x = -0.86 + i * 0.07
    k.box(x, 0.0, pz + 0.101, 0.012, 0.19, 0.008, M.anston) // buttress ribs
    k.prism(x, 0.19, pz + 0.101, 0.008, 0, 0.035, 4, M.anston, Math.PI / 4) // pinnacles
    if (i < 12) for (const y of [0.03, 0.1]) k.box(x + 0.035, y, pz + 0.1005, 0.026, 0.045, 0.002, M.cliff) // window bays
  }
  // pavilion towers on the river front with their pyramid roofs
  for (const x of [-0.12, -0.72]) {
    k.box(x, 0, pz + 0.01, 0.1, 0.22, 0.2, M.anston)
    k.frustum4(x, 0.22, pz + 0.01, 0.1, 0.2, 0.02, 0.08, 0.05, M.slate)
  }
}
