/**
 * Sydney Opera House: the granite-clad podium on Bennelong Point with the Monumental
 * Steps rising from the forecourt, and the two interlocking groups of tiled shells side
 * by side (the Concert Hall, larger, and the Joan Sutherland Theatre): in each, three
 * shells open toward the harbour, each mouth a pointed arch leaning forward and glazed,
 * stepping up and nesting behind one another, then a small shell turned back to the
 * south; and the little Bennelong restaurant pair on the steps. Each shell is a curved
 * sail (a swept pointed arch narrowing to its foot) with a raised lip.
 */
import type { Kit, V3 } from '../kit.ts'
import { M } from '../palette.ts'
import { chain } from './parts.ts'

const PY = 0.11 // podium top

/**
 * One shell: mouth (pointed arch) at x0 facing dir (+1 = +x), width w, height h, the apex
 * leaning out by lean; the shell sweeps back `depth` to its foot.
 */
function shell(k: Kit, x0: number, z0: number, w: number, h: number, depth: number, lean: number, dir: 1 | -1) {
  const S = 10, Tn = 6
  const mouth: V3[] = []
  for (let i = 0; i <= S; i++) {
    const u = (2 * i) / S - 1
    const y = h * (1 - Math.pow(Math.abs(u), 1.5))
    mouth.push([x0 + dir * lean * Math.pow(y / h, 1.6), PY + y, z0 + (u * w) / 2])
  }
  const foot: V3 = [x0 - dir * depth, PY, z0]
  const V: V3[] = []
  for (let j = 0; j <= Tn; j++) {
    const t = j / Tn
    for (let i = 0; i <= S; i++) {
      const m = mouth[i]
      // control point: behind the mouth, as high as it (a convex back), narrowing in z
      const c: V3 = [x0 - dir * depth * 0.4, m[1] + (m[1] - PY) * 0.3, z0 + (m[2] - z0) * 1.02]
      const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t
      V.push([a * m[0] + b * c[0] + d * foot[0], a * m[1] + b * c[1] + d * foot[1], a * m[2] + b * c[2] + d * foot[2]])
    }
  }
  const T: number[][] = []
  const C = S + 1
  for (let j = 0; j < Tn; j++)
    for (let i = 0; i < S; i++) {
      const a = j * C + i
      if (j === Tn - 1) T.push([a, a + 1, a + C])
      else T.push([a, a + 1, a + C + 1], [a, a + C + 1, a + C])
    }
  k.prim(V, T, M.chalk)
  // the raised lip round the mouth
  chain(k, mouth, 0.016, 0.02, M.chalk)
  // glazed mouth: a fan from the foot of the arch, set just inside
  const g: V3[] = [[x0 - dir * 0.03, PY, z0], ...mouth.map((p): V3 => [p[0] - dir * 0.035, p[1] - 0.004, p[2] * 0.985 + z0 * 0.015])]
  const gT: number[][] = []
  for (let i = 1; i < g.length - 1; i++) gT.push([0, i, i + 1])
  k.prim(g, gT, M.glass)
}

export function opera(k: Kit) {
  // ---- podium: stepped granite platform, broad at the south (-x) end ----
  k.box(0.05, 0, 0, 2.0, PY, 0.96, M.granite)
  k.box(0.05, PY - 0.01, 0.49, 1.9, 0.01, 0.03, M.stoneShade) // the broadwalk edge
  // Monumental Steps from the forecourt up to the podium
  const sx = -0.95
  for (let i = 0; i < 7; i++) k.box(sx - 0.03 - i * 0.03, 0, 0, 0.03, PY - i * 0.0155, 0.8, i % 2 ? M.granite : M.stoneShade)
  k.box(sx - 0.34, 0, 0, 0.18, 0.006, 1.0, M.stoneShade) // forecourt
  // ---- Concert Hall (west, back): three shells to the harbour, one turned south ----
  const groups: [number, number, number][] = [[-0.21, 0.0, 1.0], [0.25, 0.1, 0.86]]
  for (const [z, dx, s] of groups) {
    shell(k, 0.9 * s + dx, z, 0.4 * s, 0.56 * s, 0.56 * s, 0.2 * s, 1)
    shell(k, 0.56 * s + dx, z, 0.5 * s, 0.84 * s, 0.7 * s, 0.24 * s, 1)
    shell(k, 0.14 * s + dx, z, 0.44 * s, 0.66 * s, 0.56 * s, 0.2 * s, 1)
    shell(k, -0.52 * s + dx, z, 0.32 * s, 0.38 * s, 0.32 * s, 0.1 * s, -1)
  }
  // ---- Bennelong restaurant on the south-west steps ----
  shell(k, -0.6, 0.31, 0.22, 0.3, 0.26, 0.07, 1)
  shell(k, -0.86, 0.31, 0.2, 0.22, 0.2, 0.05, -1)
}
