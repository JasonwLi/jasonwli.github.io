/**
 * The route's little carrack (ships follow-up): one procedural low-poly form built with the
 * monument kit (flat vertex colours, linear; duplicated hull triangles for the ink outline),
 * so it is painted by the same three-tone monument material and outline.
 *
 * Model space (differs from the monuments in one way): the BOW points along +x. y is up
 * (keel bottom y = 0, main masthead y ~ 0.95), z is the beam. Overall length (stern to the
 * bowsprit tip) is 1, so the drawn length in CSS px is the instance scale times the px per
 * unit, and the screen size rule ("~22 px") is a length.
 *
 * Form: a lofted hull (dark oak strakes over a darker bottom, pale-oak deck), a high
 * sterncastle and a forecastle, three masts (fore and main square-rigged with course and
 * topsail, braced 35 deg so a broadside view still shows canvas; a lateen on the mizzen),
 * a bowsprit, a main top and a small brick-red pennant. Canvas and wood come from the
 * monument palette (L <= 0.70); no gilt, no vermilion (the pennant is the torii lacquer,
 * C 0.10). Masts, yards, bowsprit and pennant are hairlines: no outline.
 */
import type * as THREE from 'three'
import { Kit, type V3 } from '../monuments/kit'
import { M } from '../monuments/palette'

export const SHIP = {
  hull: M.wood, //        oklch(0.42 0.050 55)  oak strakes
  bottom: M.rockDeep, //  oklch(0.36 0.020 60)  the wet bottom / wale shadow
  deck: M.bronze, //      oklch(0.50 0.075 62)  pale oak deck and castle tops
  spar: M.rockDark, //    oklch(0.44 0.025 60)  masts and yards
  canvas: M.limestone, // oklch(0.70 0.030 85)  sailcloth
  canvasShade: M.chalk, // oklch(0.70 0.018 95) the lateen, a cooler cloth
  pennant: M.lacquer, //  oklch(0.46 0.100 32)  brick red, not vermilion
} as const

export interface ShipGeometry {
  geometry: THREE.BufferGeometry
  tris: number
  /** model bbox [minX, minY, minZ, maxX, maxY, maxZ] */
  box: [number, number, number, number, number, number]
  /** y of the waterline (model units): the instance is sunk by this much */
  waterline: number
}

let cached: ShipGeometry | null = null

/** Hull stations: x, half beam at the deck, deck (sheer) y, keel y. Stern to bow. */
const STATIONS: [number, number, number, number][] = [
  [-0.4, 0.075, 0.2, 0.05],
  [-0.27, 0.1, 0.165, 0.008],
  [-0.05, 0.112, 0.145, 0],
  [0.17, 0.1, 0.15, 0.006],
  [0.3, 0.062, 0.17, 0.045],
  [0.37, 0, 0.2, 0.12],
]

/** A bowed square sail between y0 and y1, half width hw, bellied +x by b (3 x 3 grid, 8 tris). */
function squareSail(k: Kit, y0: number, y1: number, hw: number, b: number, hex: string) {
  const V: V3[] = []
  for (let r = 0; r < 3; r++) {
    const y = y1 + ((y0 - y1) * r) / 2
    for (let c = 0; c < 3; c++) {
      const z = -hw + hw * c
      // belly: deepest in the middle column and lower rows (wind fills the foot)
      const belly = (c === 1 ? 1 : 0.35) * (r === 0 ? 0.25 : r === 1 ? 1 : 0.7) * b
      V.push([belly, y, z * (r === 2 ? 0.94 : 1)])
    }
  }
  const T: number[][] = []
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c
      T.push([a, a + 1, a + 4], [a, a + 4, a + 3])
    }
  k.prim(V, T, hex)
}

export function buildCaravel(): ShipGeometry {
  if (cached) return cached
  const k = new Kit()
  k.begin('carrack')

  // ——— hull: lofted strakes. Cross-section: deck port, wale port, bilge port, keel, and mirrored.
  const ring = (s: [number, number, number, number]): V3[] => {
    const [x, w, yd, yk] = s
    const yw = yk + 0.62 * (yd - yk) // the wale: upper strakes above, the dark bottom below
    const yb = yk + 0.22 * (yd - yk)
    return [
      [x, yd, -w],
      [x, yw, -w * 0.97],
      [x, yb, -w * 0.72],
      [x, yk, 0],
      [x, yb, w * 0.72],
      [x, yw, w * 0.97],
      [x, yd, w],
    ]
  }
  const rings = STATIONS.map(ring)
  const strip = (from: number, to: number, hex: string) => {
    // quads between consecutive stations for ring points from..to
    const V: V3[] = []
    const T: number[][] = []
    const per = to - from + 1
    rings.forEach((r) => {
      for (let p = from; p <= to; p++) V.push(r[p])
    })
    for (let s = 0; s + 1 < rings.length; s++)
      for (let p = 0; p + 1 < per; p++) {
        const a = s * per + p
        const b = (s + 1) * per + p
        T.push([a, b, b + 1], [a, b + 1, a + 1])
      }
    k.prim(V, T, hex)
  }
  strip(0, 1, SHIP.hull) // port upper strakes
  strip(5, 6, SHIP.hull) // starboard upper strakes
  strip(1, 5, SHIP.bottom) // the bottom, wale to wale
  // transom (flat stern)
  const st = rings[0]
  k.prim(st, [[0, 1, 6], [1, 5, 6], [1, 2, 5], [2, 4, 5], [2, 3, 4]], SHIP.hull)
  // deck between the sheer lines
  {
    const V: V3[] = []
    const T: number[][] = []
    STATIONS.forEach(([x, w, yd]) => V.push([x, yd, -w], [x, yd, w]))
    for (let s = 0; s + 1 < STATIONS.length; s++) {
      const a = s * 2
      T.push([a, a + 2, a + 3], [a, a + 3, a + 1])
    }
    k.prim(V, T, SHIP.deck)
  }

  // ——— castles: a high sterncastle and a forecastle, slight tumblehome
  k.frustum4(-0.315, 0.15, 0, 0.19, 0.2, 0.2, 0.165, 0.13, SHIP.hull)
  k.box(-0.315, 0.28, 0, 0.2, 0.012, 0.165, SHIP.deck)
  k.frustum4(0.25, 0.14, 0, 0.15, 0.17, 0.16, 0.13, 0.085, SHIP.hull)

  // ——— sails (outlined): fore and main square-rigged, braced 35 deg; lateen on the mizzen
  const BRACE = 0.6
  // main: course + topsail
  k.push(-0.02, 0, 0, BRACE)
  squareSail(k, 0.33, 0.6, 0.165, 0.05, SHIP.canvas)
  squareSail(k, 0.64, 0.83, 0.115, 0.035, SHIP.canvas)
  k.pop()
  // fore: course + topsail
  k.push(0.2, 0, 0, BRACE)
  squareSail(k, 0.3, 0.52, 0.135, 0.045, SHIP.canvas)
  squareSail(k, 0.56, 0.69, 0.09, 0.03, SHIP.canvas)
  k.pop()
  // mizzen lateen: a triangle in the centre plane, bellied to one side
  k.prim(
    [
      [-0.12, 0.7, 0],
      [-0.45, 0.33, 0],
      [-0.24, 0.31, 0],
      [-0.27, 0.46, 0.035],
    ],
    [[0, 3, 2], [0, 1, 3], [1, 2, 3]],
    SHIP.canvasShade,
  )

  // ——— hairlines (no outline): masts, yards, bowsprit, the main top, pennant
  k.hull = false
  const MW = 0.016
  k.beam([-0.02, 0.14, 0], [-0.02, 0.95, 0], MW, MW, SHIP.spar, false)
  k.beam([0.2, 0.15, 0], [0.2, 0.75, 0], MW * 0.9, MW * 0.9, SHIP.spar, false)
  k.beam([-0.26, 0.29, 0], [-0.26, 0.6, 0], MW * 0.8, MW * 0.8, SHIP.spar, false)
  k.beam([0.33, 0.18, 0], [0.63, 0.29, 0], MW * 0.8, MW * 0.8, SHIP.spar, false)
  // lateen yard
  k.beam([-0.1, 0.72, 0], [-0.47, 0.31, 0], MW * 0.7, MW * 0.7, SHIP.spar, false)
  // square yards, braced with their sails
  for (const [x, y, hw] of [
    [-0.02, 0.605, 0.18],
    [-0.02, 0.835, 0.13],
    [0.2, 0.525, 0.15],
    [0.2, 0.695, 0.1],
  ]) {
    k.push(x, y, 0, BRACE)
    k.beam([0, 0, -hw], [0, 0, hw], MW * 0.7, MW * 0.7, SHIP.spar, false)
    k.pop()
  }
  // the main top (fighting top)
  k.prism(-0.02, 0.86, 0, 0.032, 0.036, 0.03, 6, SHIP.hull)
  // pennant streaming aft from the main masthead
  k.prim(
    [
      [-0.02, 0.95, 0],
      [-0.02, 0.91, 0],
      [-0.16, 0.925, 0.01],
    ],
    [[0, 1, 2]],
    SHIP.pennant,
  )

  const geometry = k.build()
  const f = k.forms[0]
  // the length rule: stern to bowsprit tip is 1 (already authored to that), height from the box
  cached = { geometry, tris: f.tris, box: f.box, waterline: 0.075 }
  return cached
}
