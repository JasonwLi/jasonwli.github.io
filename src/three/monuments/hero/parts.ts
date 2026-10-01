/**
 * Shared building blocks for the hero monument models (procedural, authored in code).
 *
 * Same model space as the archetype kit (kit.ts): y up, ground y = 0, x right, z toward
 * the viewer (the front), form height ~1. Everything lands in the archetype's one
 * BufferGeometry through Kit.prim, so a hero model is just another sub-mesh (aVar).
 */
import * as THREE from 'three'
import type { Kit, V3 } from '../kit.ts'

export type Build = (k: Kit) => void
export type P2 = [number, number]

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A triangle soup split into one primitive per colour (a primitive carries one flat
 * colour). colourOf(triIndex) picks each triangle's paint; vertices are compacted per
 * group.
 */
export function painted(k: Kit, V: V3[], T: number[][], colourOf: (t: number) => string) {
  const groups = new Map<string, number[]>()
  T.forEach((_, i) => {
    const c = colourOf(i)
    let g = groups.get(c)
    if (!g) groups.set(c, (g = []))
    g.push(i)
  })
  for (const [hex, list] of groups) {
    const map = new Map<number, number>()
    const VV: V3[] = []
    const TT = list.map((ti) =>
      T[ti].map((vi) => {
        let j = map.get(vi)
        if (j === undefined) {
          j = VV.length
          map.set(vi, j)
          VV.push(V[vi])
        }
        return j
      }),
    )
    k.prim(VV, TT, hex)
  }
}

/** A quad strip grid (rows x cols vertices, row-major) as triangles. */
export function gridTris(rows: number, cols: number, wrap = false): number[][] {
  const T: number[][] = []
  const cn = wrap ? cols : cols - 1
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c < cn; c++) {
      const c1 = (c + 1) % cols
      const a = r * cols + c, b = r * cols + c1, d = (r + 1) * cols + c1, e = (r + 1) * cols + c
      T.push([a, b, d], [a, d, e])
    }
  return T
}

/**
 * Lathe over part of the circle: profile [[r, y], ...], angles a0 -> a1 (rad, measured
 * from +z toward +x), n segments. No caps. sx / sz squash the section (ellipses).
 */
export function latheArc(
  k: Kit, x: number, y0: number, z: number, profile: P2[], n: number, a0: number, a1: number, hex: string, sx = 1, sz = 1,
) {
  const V: V3[] = []
  for (const [r, y] of profile)
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      V.push([x + Math.sin(a) * r * sx, y0 + y, z + Math.cos(a) * r * sz])
    }
  k.prim(V, gridTris(profile.length, n + 1), hex)
}

/** Dome cap: a quarter-ellipse profile, `rings` bands, closed at the crown. */
export function domeProfile(r: number, h: number, rings: number, pow = 1): P2[] {
  const p: P2[] = []
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * Math.PI * 0.5
    p.push([Math.cos(a) * r, Math.pow(Math.sin(a), pow) * h])
  }
  p.push([0, h])
  return p
}

/** Ribbed dome: every other meridian pushed out by `rib` (a lead dome with stone ribs). */
export function ribbedDome(k: Kit, x: number, y0: number, z: number, profile: P2[], ribs: number, rib: number, hex: string, rot = 0) {
  const n = ribs * 2
  const V: V3[] = []
  const rows: number[][] = []
  for (const [r, y] of profile) {
    const row: number[] = []
    if (r === 0) {
      row.push(V.length)
      V.push([x, y0 + y, z])
    } else
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2
        const rr = r * (i % 2 ? 1 : 1 + rib)
        row.push(V.length)
        V.push([x + Math.sin(a) * rr, y0 + y, z + Math.cos(a) * rr])
      }
    rows.push(row)
  }
  const T: number[][] = []
  for (let q = 0; q + 1 < rows.length; q++) {
    const A = rows[q], B = rows[q + 1]
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      if (B.length === 1) T.push([A[i], A[j], B[0]])
      else T.push([A[i], A[j], B[j]], [A[i], B[j], B[i]])
    }
  }
  k.prim(V, T, hex)
}

/**
 * Wall panel outline (x right, y up) of width w and height h with an arched opening of
 * width ow cut from the bottom (a bay of an arcade): jambs to spring height sh, then a
 * round (or pointed) arch of `seg` segments. Centred on x = 0, bottom at y = 0.
 */
export function bayOutline(w: number, h: number, ow: number, sh: number, seg = 4, pointed = false): P2[] {
  const a = w / 2, o = ow / 2
  const pts: P2[] = [[-a, 0], [-o, 0], [-o, sh]]
  for (let i = 1; i < seg; i++) pts.push(archPt(o, sh, i / seg, pointed))
  pts.push([o, sh], [o, 0], [a, 0], [a, h], [-a, h])
  return pts
}

/** A closed arched window/niche polygon (for holes): bottom y0, jamb to sh, arch above. */
export function archHole(cx: number, y0: number, ow: number, sh: number, seg = 4, pointed = false): P2[] {
  const o = ow / 2
  const pts: P2[] = [[cx - o, y0], [cx + o, y0], [cx + o, y0 + sh]]
  for (let i = seg - 1; i >= 1; i--) {
    const [x, y] = archPt(o, sh, i / seg, pointed)
    pts.push([cx + x, y0 + y])
  }
  pts.push([cx - o, y0 + sh])
  return pts
}

/** Point t (0 = left springer, 1 = right springer) along a round or two-centred pointed arch. */
function archPt(o: number, sh: number, t: number, pointed: boolean): P2 {
  if (!pointed) {
    const a = Math.PI * (1 - t)
    return [Math.cos(a) * o, sh + Math.sin(a) * o]
  }
  // two-centred arch: each half an arc of radius 1.6 o centred on the opposite side
  const R = 1.6 * o
  const left = t <= 0.5
  const cx = left ? -o + R : o - R
  const a0 = left ? Math.PI : 0
  const apexA = Math.acos(-cx / R) // angle where x = 0
  const u = left ? t * 2 : (1 - t) * 2
  const a = left ? a0 + (apexA - a0) * u : a0 + (Math.PI - apexA - a0) * u
  return [cx + Math.cos(a) * R, sh + Math.abs(Math.sin(a)) * R]
}

/** Points along a parabola sag between p0 and p1 (cable), n segments. */
export function sagPts(p0: V3, p1: V3, sag: number, n: number): V3[] {
  const out: V3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - sag * 4 * t * (1 - t), p0[2] + (p1[2] - p0[2]) * t])
  }
  return out
}

/** A polyline of beams (cable, rib, girder). */
export function chain(k: Kit, pts: V3[], w: number, d: number, hex: string, caps = false) {
  for (let i = 0; i + 1 < pts.length; i++) k.beam(pts[i], pts[i + 1], w, d, hex, caps)
}

/** A flat vertical quad from a to b (bottom points) rising by h, double-sided (2 tris). */
export function quad(k: Kit, a: V3, b: V3, h: number, hex: string) {
  k.prim([a, b, [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]]], [[0, 1, 2], [0, 2, 3]], hex)
}

/** A thin vertical line member (suspender, hanger): a 3-sided prism, no caps (6 tris). */
export function rod(k: Kit, a: V3, b: V3, r: number, hex: string) {
  const V: V3[] = []
  for (const p of [a, b])
    for (let i = 0; i < 3; i++) {
      const t = (i / 3) * Math.PI * 2
      V.push([p[0] + Math.sin(t) * r, p[1], p[2] + Math.cos(t) * r])
    }
  k.prim(V, [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4], [2, 0, 3], [2, 3, 5]], hex)
}

/**
 * Heightfield patch over [x0, x1] x [z0, z1] with nx x nz cells, height h(x, z), painted
 * per triangle by colourAt(x, y, z, slope) of the triangle's centroid. Skirt walls on
 * the four edges drop to y = 0 so the patch reads as a solid hill from the side.
 */
export function heightfield(
  k: Kit, x0: number, x1: number, z0: number, z1: number, nx: number, nz: number,
  h: (x: number, z: number) => number, colourAt: (x: number, y: number, z: number, slope: number) => string, skirt: string,
) {
  const V: V3[] = []
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz
      V.push([x, h(x, z), z])
    }
  const T = gridTris(nz + 1, nx + 1)
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3()
  painted(k, V, T, (t) => {
    const [a, b, c] = T[t].map((i) => V[i])
    e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    e2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    n.crossVectors(e1, e2).normalize()
    const slope = 1 - Math.abs(n.y)
    return colourAt((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3, slope)
  })
  // skirts
  const edge = (pts: V3[]) => {
    const SV: V3[] = []
    for (const p of pts) SV.push(p, [p[0], 0, p[2]])
    const ST: number[][] = []
    for (let i = 0; i + 1 < pts.length; i++) ST.push([i * 2, i * 2 + 2, i * 2 + 3], [i * 2, i * 2 + 3, i * 2 + 1])
    k.prim(SV, ST, skirt)
  }
  const row = (j: number) => V.slice(j * (nx + 1), (j + 1) * (nx + 1))
  const col = (i: number) => Array.from({ length: nz + 1 }, (_, j) => V[j * (nx + 1) + i])
  edge(row(0))
  edge(row(nz))
  edge(col(0))
  edge(col(nx))
}

/** Rotate a point about the y axis (rad, from +z toward +x). */
export function rotY(p: V3, a: number, cx = 0, cz = 0): V3 {
  const c = Math.cos(a), s = Math.sin(a)
  const x = p[0] - cx, z = p[2] - cz
  return [cx + x * c + z * s, p[1], cz - x * s + z * c]
}

/**
 * Extruded slab (outline in x/y, thickness d along z, centred on z = 0) with optional
 * holes; side walls only on the outline edges where wall(i) is true (edge i runs from
 * point i to i + 1), so abutting bays skip their hidden joints. Holes always get walls.
 */
export function slab(k: Kit, outline: P2[], d: number, hex: string, wall: (i: number) => boolean = () => true, holes: P2[][] = [], back = true) {
  const faces = THREE.ShapeUtils.triangulateShape(
    outline.map(([x, y]) => new THREE.Vector2(x, y)),
    holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))),
  )
  const all = [...outline, ...holes.flat()]
  const n = all.length
  const V: V3[] = []
  for (const [x, y] of all) V.push([x, y, d / 2])
  for (const [x, y] of all) V.push([x, y, -d / 2])
  const T: number[][] = []
  for (const f of faces) {
    T.push([f[0], f[1], f[2]])
    if (back) T.push([f[0] + n, f[2] + n, f[1] + n])
  }
  const walls = (start: number, len: number, mask: (i: number) => boolean) => {
    for (let i = 0; i < len; i++) {
      if (!mask(i)) continue
      const a = start + i, b = start + ((i + 1) % len)
      T.push([a, b, b + n], [a, b + n, a + n])
    }
  }
  walls(0, outline.length, wall)
  let s = outline.length
  for (const h of holes) {
    walls(s, h.length, () => true)
    s += h.length
  }
  k.prim(V, T, hex)
}

/** Placement on a ring: push a frame whose local x runs from p0 to p1 (on the ground plane) and whose local z faces outward. */
export function pushChord(k: Kit, p0: V3, p1: V3, y = 0) {
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2]
  k.push((p0[0] + p1[0]) / 2, y, (p0[2] + p1[2]) / 2, Math.atan2(-dz, dx))
  return Math.hypot(dx, dz)
}
