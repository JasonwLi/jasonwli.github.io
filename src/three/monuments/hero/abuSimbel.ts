/**
 * Abu Simbel, the Great Temple: the battered facade cut into the sandstone hill (the
 * rebuilt dome behind it), the cavetto cornice with its frieze of seated baboons, the
 * four seated colossi of Ramesses II on their thrones (nemes headdress, double crown,
 * false beard, hands on knees), the second from the left broken, its head and torso
 * fallen at its feet; the doorway with Ra-Horakhty in his niche above it, and the small
 * standing queens and princes between the colossi's legs.
 */
import type { Kit } from '../kit.ts'
import { M } from '../palette.ts'
import { latheArc } from './parts.ts'

const FZ = 0.0 // facade plane at its foot
const BATTER = 0.12 // the facade leans back this much over its height
const FH = 0.82

function colossus(k: Kit, x: number, z: number, broken: boolean) {
  const S = M.sandstone, O = M.ochre
  // throne block behind, the lower legs and feet, the lap
  k.box(x, 0, z - 0.07, 0.28, 0.3, 0.12, O)
  for (const dx of [-0.05, 0.05]) {
    k.frustum4(x + dx, 0, z + 0.1, 0.07, 0.08, 0.065, 0.07, 0.2, S) // shins
    k.box(x + dx, 0, z + 0.16, 0.07, 0.025, 0.07, S) // feet
  }
  k.frustum4(x, 0.2, z + 0.04, 0.2, 0.22, 0.19, 0.2, 0.055, S) // thighs / lap
  if (broken) {
    // the torso and head lie in pieces at the feet
    k.frustum4(x, 0.255, z - 0.01, 0.16, 0.1, 0.14, 0.08, 0.04, O) // broken stump
    k.push(x - 0.06, 0.03, z + 0.32, 0.6, 1, 1, 1, 0, -0.25)
    k.frustum4(0, 0, 0, 0.18, 0.1, 0.24, 0.12, 0.08, S) // fallen torso
    k.pop()
    k.push(x + 0.12, 0.06, z + 0.3, -0.5, 1, 1, 1, 0.9)
    k.frustum4(0, 0, 0, 0.17, 0.09, 0.1, 0.09, 0.1, O) // fallen head in its nemes
    k.pop()
    return
  }
  // torso tapering from the shoulders to the waist; arms hanging to the knees
  k.frustum4(x, 0.255, z + 0.0, 0.14, 0.09, 0.23, 0.11, 0.18, S)
  for (const s of [-1, 1]) {
    k.beam([x + s * 0.105, 0.42, z + 0.005], [x + s * 0.1, 0.27, z + 0.03], 0.04, 0.05, S) // upper arm
    k.beam([x + s * 0.09, 0.265, z + 0.03], [x + s * 0.07, 0.265, z + 0.14], 0.04, 0.035, S) // forearm on the thigh
  }
  // the nemes: a broad headcloth, lappets falling on the chest, the face, the beard
  const hy = 0.43
  k.frustum4(x, hy - 0.03, z - 0.005, 0.2, 0.1, 0.1, 0.08, 0.1, O)
  for (const s of [-1, 1]) k.box(x + s * 0.05, hy - 0.06, z + 0.04, 0.035, 0.07, 0.015, O) // lappets
  k.frustum4(x, hy - 0.01, z + 0.03, 0.075, 0.04, 0.06, 0.035, 0.085, S) // face
  k.frustum4(x, hy - 0.055, z + 0.045, 0.024, 0.02, 0.018, 0.016, 0.045, O) // false beard
  // the double crown: red crown band, white crown bulb
  k.prism(x, hy + 0.07, z, 0.05, 0.046, 0.03, 8, O, 0, false)
  k.lathe(x, hy + 0.1, z, [[0.035, 0], [0.038, 0.03], [0.03, 0.065], [0.016, 0.09], [0, 0.1]], 8, S)
  // a small standing queen between the legs
  k.box(x, 0, z + 0.16, 0.03, 0.11, 0.022, O)
  k.prism(x, 0.11, z + 0.16, 0.014, 0.012, 0.02, 6, O)
}

export function abuSimbel(k: Kit) {
  // ---- the hill: the rebuilt sandstone dome behind the facade ----
  const hz = FZ - BATTER - 0.03
  latheArc(k, 0, 0, hz, [[1, 0], [0.97, 0.36], [0.86, 0.62], [0.66, 0.8], [0.38, 0.9], [0, 0.93]], 12, Math.PI / 2, Math.PI * 1.5, M.ochre, 0.98, 0.72)
  // ---- the facade: a battered slab between the hill's flanks ----
  const W = 1.44
  k.prim(
    [[-W / 2, 0, FZ], [W / 2, 0, FZ], [W / 2 - 0.02, FH, FZ - BATTER], [-W / 2 + 0.02, FH, FZ - BATTER],
      [-W / 2, 0, FZ - BATTER - 0.04], [W / 2, 0, FZ - BATTER - 0.04]],
    [[0, 1, 2], [0, 2, 3], [0, 3, 4], [1, 5, 2]],
    M.sandstone,
  )
  // flanking hill shoulders (the cut ends of the facade)
  for (const s of [-1, 1]) {
    k.prim(
      [[s * W / 2, 0, FZ], [s * (W / 2 + 0.28), 0, FZ - 0.2], [s * (W / 2 - 0.02), FH, FZ - BATTER], [s * (W / 2 + 0.12), FH * 0.6, FZ - 0.2]],
      [[0, 1, 3], [0, 3, 2]],
      M.ochre,
    )
  }
  // torus moulding up the sides and the cavetto cornice with the baboon frieze
  for (const s of [-1, 1]) k.beam([s * (W / 2 - 0.015), 0, FZ - 0.005], [s * (W / 2 - 0.03), FH, FZ - BATTER - 0.005], 0.018, 0.02, M.sandstone)
  k.beam([-W / 2 + 0.02, FH - 0.05, FZ - BATTER + 0.012], [W / 2 - 0.02, FH - 0.05, FZ - BATTER + 0.012], 0.03, 0.04, M.sandstone)
  k.beam([-W / 2 + 0.02, FH - 0.02, FZ - BATTER + 0.024], [W / 2 - 0.02, FH - 0.02, FZ - BATTER + 0.024], 0.025, 0.06, M.ochre)
  for (let i = 0; i < 22; i++) {
    const x = -W / 2 + 0.06 + (i * (W - 0.12)) / 21
    k.prism(x, FH - 0.005, FZ - BATTER + 0.024, 0.014, 0.011, 0.028, 5, M.sandstone, 0, false) // seated baboon
    k.prism(x, FH + 0.023, FZ - BATTER + 0.026, 0.011, 0.004, 0.016, 5, M.sandstone)
  }
  // ---- the doorway and Ra-Horakhty's niche ----
  k.box(0, 0, FZ + 0.002, 0.1, 0.22, 0.004, M.dark)
  k.box(0, 0.22, FZ + 0.0, 0.14, 0.03, 0.03, M.sandstone)
  k.box(0, 0.3, FZ - 0.04, 0.1, 0.18, 0.012, M.rockDark) // niche
  k.box(0, 0.3, FZ - 0.03, 0.05, 0.15, 0.04, M.sandstone) // the falcon-headed god
  k.prism(0, 0.45, FZ - 0.02, 0.025, 0.025, 0.02, 8, M.sandstone, 0, true) // sun disc
  // ---- the four colossi ----
  const Z = FZ + 0.14
  colossus(k, -0.5, Z, false)
  colossus(k, -0.2, Z, true)
  colossus(k, 0.2, Z, false)
  colossus(k, 0.5, Z, false)
  // forecourt terrace
  k.box(0, 0, FZ + 0.3, W + 0.1, 0.012, 0.36, M.stoneShade)
}
