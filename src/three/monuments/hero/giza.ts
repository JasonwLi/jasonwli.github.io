/**
 * Giza: Khufu (front right, stripped to its stepped core courses, flat-topped), Khafre
 * behind it on higher ground keeping its pale casing cap, Menkaure at the back with its
 * three queens' pyramids, Khufu's queens on its east side, the mastaba field, and the
 * Sphinx crouched in its quarried hollow before Khafre's valley temple. The three main
 * pyramids step back on the site's south-west diagonal.
 */
import type { Kit } from '../kit.ts'
import { M } from '../palette.ts'

/** Pyramid of stacked courses: base b, height h, n courses, step inset s; apex/capH optional cap. */
function stepped(k: Kit, x: number, y0: number, z: number, b: number, h: number, n: number, hex: string, s: number, capFrom = 1, capHex = hex, top = 0) {
  const dh = h / n
  for (let i = 0; i < n; i++) {
    const f0 = i / n, f1 = (i + 1) / n
    const w0 = top + (b - top) * (1 - f0)
    const w1 = top + (b - top) * (1 - f1)
    const c = f0 >= capFrom ? capHex : hex
    if (f0 >= capFrom || s === 0) {
      // smooth casing: one slope per course
      k.frustum4(x, y0 + i * dh, z, w0, w0, w1, w1, dh, c)
    } else {
      // stepped core: a riser then the tread
      k.frustum4(x, y0 + i * dh, z, w0, w0, w1 + s, w1 + s, dh, c)
    }
  }
}

export function giza(k: Kit) {
  const R = Math.PI / 4.6 // the site's diagonal toward the viewer
  // Khufu: 230 m base, 139 m today (flat top), course steps
  const kx = 0.32, kz = 0.42
  k.push(kx, 0, kz, R * 0.15)
  stepped(k, 0, 0, 0, 1.46, 0.9, 16, M.sandstone, 0.012, 1, M.sandstone, 0.07)
  k.box(0, 0.9, 0, 0.07, 0.012, 0.07, M.ochre)
  // entrance notch on the north face (toward the viewer here)
  k.frustum4(0, 0.16, 0.565, 0.06, 0.04, 0.03, 0.02, 0.05, M.rockDark)
  k.pop()
  // Khafre: 215 m base, 136 m, on a 0.05 plinth, casing kept on the top quarter
  const fx = -0.82, fz = -0.42
  k.push(fx, 0, fz, R * 0.15)
  k.box(0, 0, 0, 1.52, 0.05, 1.52, M.cliff)
  stepped(k, 0, 0.05, 0, 1.36, 0.93, 14, M.ochre, 0.01, 0.74, M.limestone)
  k.pop()
  // Menkaure: 103 m base, 65 m, with the vertical gash on its north face
  const mx = -1.5, mz = -0.98
  k.push(mx, 0, mz, R * 0.15)
  stepped(k, 0, 0, 0, 0.66, 0.43, 7, M.sandstone, 0.008, 1, M.sandstone)
  k.box(0, 0.1, 0.27, 0.05, 0.12, 0.01, M.rockDark)
  // three queens' pyramids to its south (front here)
  for (let i = 0; i < 3; i++) stepped(k, -0.28 + i * 0.28, 0, 0.56, 0.18, 0.1, 3, i === 0 ? M.sandstone : M.ochre, 0.012)
  k.pop()
  // Khufu's three queens on its east side, in a row
  k.push(kx, 0, kz, R * 0.15)
  for (let i = 0; i < 3; i++) stepped(k, 0.92, 0, -0.42 + i * 0.34, 0.24, 0.15, 3, M.ochre, 0.014)
  // eastern mastaba field: low rows behind the queens
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) k.frustum4(0.5 + c * 0.2, 0, -0.98 - r * 0.15, 0.15, 0.1, 0.13, 0.08, 0.04, M.cliff)
  k.pop()
  // western cemetery between Khufu and the view's left
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) k.frustum4(-0.6 + c * 0.17, 0, 0.62 + r * 0.17, 0.12, 0.1, 0.1, 0.08, 0.035, M.cliff)
  // causeway from Khafre to the valley temple and the Sphinx
  k.beam([fx + 0.4, 0.02, fz + 0.62], [-0.32, 0.02, 1.02], 0.06, 0.04, M.cliff)
  // the Sphinx enclosure (quarried hollow) and the Sphinx facing east (+x)
  const sx = -0.6, sz = 1.18
  k.push(sx, 0, sz, -0.25, 1.35)
  k.box(0, 0, 0, 0.5, 0.025, 0.26, M.rockDark)
  // lion body: haunch, back, chest
  k.frustum4(-0.06, 0.025, 0, 0.3, 0.1, 0.28, 0.08, 0.055, M.sandstone)
  k.frustum4(-0.17, 0.08, 0, 0.1, 0.08, 0.06, 0.06, 0.02, M.sandstone)
  k.box(0.1, 0.025, 0, 0.08, 0.09, 0.1, M.sandstone)
  // forepaws
  for (const dz of [-0.028, 0.028]) k.box(0.18, 0.025, dz, 0.16, 0.022, 0.03, M.sandstone)
  // head with the nemes (lappets) and face
  k.frustum4(0.12, 0.115, 0, 0.07, 0.1, 0.05, 0.05, 0.05, M.ochre)
  k.box(0.15, 0.115, 0, 0.04, 0.045, 0.04, M.sandstone)
  k.prism(0.13, 0.165, 0, 0.026, 0.0, 0.016, 5, M.ochre)
  k.pop()
  // Khafre's valley temple beside it (blocky granite)
  k.box(-0.24, 0, 1.18, 0.2, 0.06, 0.2, M.cliff)
  k.box(-0.47, 0, 0.98, 0.18, 0.05, 0.12, M.cliff)
}
