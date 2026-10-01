/**
 * Parthenon as it stands: the three-stepped crepidoma, the Doric peristyle of 8 x 17
 * fluted columns with their echinus and abacus capitals, the architrave, the triglyph
 * frieze and cornice, the two pediment frames at the east and west ends, and no roof:
 * from above the open interior shows the cella walls and the inner porch columns.
 * Turned on the site so the west front and the north flank both face the viewer.
 */
import type { Kit } from '../kit.ts'
import { M } from '../palette.ts'

const L = 2.3 // stylobate length (x)
const W = 1.02 // stylobate width (z)

export function parthenon(k: Kit) {
  k.push(0, 0, 0, -0.75)
  // crepidoma: three steps
  for (let i = 0; i < 3; i++) k.box(0, i * 0.022, 0, L + 0.12 - i * 0.04, 0.022, W + 0.12 - i * 0.04, i === 0 ? M.stoneShade : M.marble)
  const y0 = 0.066
  const ch = 0.42 // column height
  const r0 = 0.034, r1 = 0.027
  const cx = L / 2 - 0.06, cz = W / 2 - 0.06
  const col = (x: number, z: number, h = ch, hex = M.marble) => {
    // tapering shaft (hexagonal: at 120 px the six facets read as the fluting's light/shade)
    k.lathe(x, y0, z, [[r0, 0], [r1, h * 0.86]], 6, hex, Math.PI / 6, false)
    k.lathe(x, y0 + h * 0.86, z, [[r1, 0], [r0 * 1.25, h * 0.1]], 6, hex, Math.PI / 6, false) // echinus
    k.box(x, y0 + h * 0.96, z, r0 * 2.7, h * 0.04, r0 * 2.7, M.marble) // abacus
  }
  for (let i = 0; i < 17; i++) {
    const x = -cx + (2 * cx * i) / 16
    col(x, cz)
    col(x, -cz)
  }
  for (let i = 1; i < 7; i++) {
    const z = -cz + (2 * cz * i) / 7
    col(-cx, z)
    col(cx, z)
  }
  const ye = y0 + ch
  // entablature: architrave, frieze with triglyph bands, cornice (a ring of beams)
  const ring = (y: number, h: number, out: number, hex: string) => {
    const a = cx + 0.045 + out, b = cz + 0.045 + out
    const t = 0.09
    k.box(0, y, b - t / 2, 2 * a, h, t, hex)
    k.box(0, y, -b + t / 2, 2 * a, h, t, hex)
    k.box(a - t / 2, y, 0, t, h, 2 * b - 2 * t, hex)
    k.box(-a + t / 2, y, 0, t, h, 2 * b - 2 * t, hex)
  }
  ring(ye, 0.05, 0, M.marble)
  ring(ye + 0.05, 0.05, -0.006, M.stoneShade)
  // triglyphs: pale panels just proud of the dark frieze, over each column and between
  const tri = (x: number, z: number, alongX: boolean) => {
    const a = 0.011, y = ye + 0.053, h = 0.044
    const V: [number, number, number][] = alongX
      ? [[x - a, y, z], [x + a, y, z], [x + a, y + h, z], [x - a, y + h, z]]
      : [[x, y, z - a], [x, y, z + a], [x, y + h, z + a], [x, y + h, z - a]]
    k.prim(V, [[0, 1, 2], [0, 2, 3]], M.marble)
  }
  for (let i = 0; i <= 32; i++) {
    const x = -cx + (cx * i) / 16
    for (const s of [-1, 1]) tri(x, s * (cz + 0.041), true)
  }
  for (let i = 0; i <= 14; i++) {
    const z = -cz + (cz * i) / 7
    for (const s of [-1, 1]) tri(s * (cx + 0.041), z, false)
  }
  ring(ye + 0.1, 0.022, 0.016, M.marble)
  // pediments at both ends: tympanum and raking cornices
  const yp = ye + 0.122
  for (const s of [-1, 1]) {
    const x = s * (cx + 0.02)
    const hz = cz + 0.06
    const ph = 0.15
    k.prim(
      [[x, yp, -hz], [x, yp, hz], [x, yp + ph, 0], [x - s * 0.06, yp, -hz], [x - s * 0.06, yp, hz], [x - s * 0.06, yp + ph, 0]],
      [[0, 1, 2], [3, 5, 4], [0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2]],
      M.stoneShade,
    )
    // raking cornices (proud, pale) along both slopes
    k.beam([x + s * 0.012, yp + 0.008, -hz - 0.02], [x + s * 0.012, yp + ph + 0.012, 0], 0.03, 0.09, M.marble)
    k.beam([x + s * 0.012, yp + 0.008, hz + 0.02], [x + s * 0.012, yp + ph + 0.012, 0], 0.03, 0.09, M.marble)
    // the surviving pediment figures (west end): a few weathered blocks
    if (s < 0) for (const z of [-0.3, -0.18, 0.22, 0.32]) k.box(x + 0.01, yp, z, 0.03, 0.05 * (1 - Math.abs(z) * 1.5), 0.06, M.marble)
  }
  // open interior: floor, the cella walls (ruined to uneven heights), the inner porches
  k.box(0, y0, 0, 2 * cx - 0.1, 0.004, 2 * cz - 0.1, M.stoneShade)
  const cw = 1.45, cd = 0.5
  const seg = [0.3, 0.22, 0.14, 0.2, 0.26]
  seg.forEach((h, i) => {
    const x = -cw / 2 + (cw * (i + 0.5)) / seg.length
    for (const s of [-1, 1]) k.box(x, y0, s * cd / 2, cw / seg.length + 0.002, h, 0.04, M.marble)
  })
  k.box(-0.08, y0, 0, 0.04, 0.24, cd, M.marble) // cross wall between naos and parthenon room
  for (const s of [-1, 1]) {
    k.box(s * cw / 2, y0, 0, 0.04, 0.12, cd, M.marble)
    for (let j = 0; j < 6; j++) col(s * (cw / 2 + 0.1), -0.25 + j * 0.1, ch * 0.9)
  }
  k.pop()
}
