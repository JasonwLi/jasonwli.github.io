/**
 * The 15 monument archetypes (C5) as procedural low-poly sub-mesh kits.
 *
 * One BufferGeometry per archetype (one InstancedMesh each); every landmark form is a
 * sub-mesh tagged aVar = its index in the archetype, and the instance attribute iVar
 * picks it (other sub-meshes collapse in the vertex shader). Each form is 30-300
 * model triangles (checked by dev/check-landmarks.ts and the specimen page), plus the
 * same count again as inverted-hull outline triangles.
 *
 * Model space: y up, ground at 0; x right; z toward the viewer (the monument's front
 * always faces the camera, see Monuments.tsx). Silhouettes first: at 14-40 px only
 * the outline, the colour blocks and the light/shade split read.
 */
import * as THREE from 'three'
import type { Archetype } from '../../data/landmarks'
import { Kit, type V3 } from './kit.ts'
import { M } from './palette.ts'

type Build = (k: Kit) => void

// ---------- helpers on top of the kit ----------

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Oriented box from a to b (centre line), cross-section w (horizontal) x d. 12 tris. */
function beam(k: Kit, a: V3, b: V3, w: number, d: number, hex: string) {
  const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
  let s = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0))
  if (s.lengthSq() < 1e-6) s = new THREE.Vector3(1, 0, 0)
  s.normalize()
  const t = new THREE.Vector3().crossVectors(s, u).normalize()
  const V: V3[] = []
  for (const p of [a, b])
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
      V.push([p[0] + (s.x * w * i + t.x * d * j) / 2, p[1] + (s.y * w * i + t.y * d * j) / 2, p[2] + (s.z * w * i + t.z * d * j) / 2])
  const T: number[][] = []
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    T.push([i, j, 4 + j], [i, 4 + j, 4 + i])
  }
  T.push([0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6])
  k.prim(V, T, hex)
}

/**
 * Irregular crag/cone: n sides, rings at the given height fractions, radius r*(1-f)^p,
 * seeded radial jitter; the part above snowFrom (fraction of h) in snowHex.
 */
function crag(
  k: Kit, x: number, z: number, r: number, h: number, n: number, seed: number, hex: string,
  opts: { snowHex?: string; snowFrom?: number; rings?: number[]; p?: number; jitter?: number; lean?: [number, number]; top?: number; sx?: number } = {},
) {
  const R = rng(seed)
  const rings = opts.rings ?? [0, 0.4, 0.75]
  const p = opts.p ?? 1
  const jit = opts.jitter ?? 0.22
  const [lx, lz] = opts.lean ?? [0, 0]
  const topR = opts.top ?? 0
  const sx = opts.sx ?? 1
  const ringPts: V3[][] = rings.map((f) => {
    const rr = topR + (r - topR) * Math.pow(1 - f, p)
    const pts: V3[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R() * 0.3
      const j = 1 - jit + R() * jit * 2
      pts.push([x + lx * f * h + Math.sin(a) * rr * j * sx, f * h * (f > 0 ? 1 - jit * 0.3 + R() * jit * 0.6 : 1), z + lz * f * h + Math.cos(a) * rr * j])
    }
    return pts
  })
  const apex: V3 = [x + lx * h, h, z + lz * h]
  const snowFrom = opts.snowFrom ?? 2
  const split = rings.findIndex((f) => f >= snowFrom)
  const emit = (from: number, to: number, withApex: boolean, color: string) => {
    const V: V3[] = []
    const T: number[][] = []
    for (let q = from; q <= to; q++) V.push(...ringPts[q])
    const nr = to - from + 1
    for (let q = 0; q + 1 < nr; q++)
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        T.push([q * n + i, q * n + j, (q + 1) * n + j], [q * n + i, (q + 1) * n + j, (q + 1) * n + i])
      }
    if (withApex) {
      if (topR > 0) {
        for (let i = 1; i + 1 < n; i++) T.push([(nr - 1) * n, (nr - 1) * n + i, (nr - 1) * n + i + 1])
      } else {
        V.push(apex)
        for (let i = 0; i < n; i++) T.push([(nr - 1) * n + i, (nr - 1) * n + ((i + 1) % n), nr * n])
      }
    }
    k.prim(V, T, color)
  }
  if (split <= 0 || !opts.snowHex) emit(0, rings.length - 1, true, hex)
  else {
    emit(0, split, false, hex)
    emit(split, rings.length - 1, true, opts.snowHex)
  }
}

/** Ramp/stair wedge on a face: from ground at z0 up to height y1 at z1, width w. 8 tris. */
function ramp(k: Kit, x: number, z0: number, z1: number, y1: number, w: number, hex: string, y0 = 0) {
  const a = w / 2
  k.prim(
    [[x - a, y0, z0], [x + a, y0, z0], [x + a, y1, z1], [x - a, y1, z1], [x - a, y0, z1], [x + a, y0, z1]],
    [[0, 1, 2], [0, 2, 3], [0, 3, 4], [1, 5, 2], [4, 3, 2], [4, 2, 5]],
    hex,
  )
}

/** Onion dome lathe (r radius, h height) with n sides. */
function onion(k: Kit, x: number, y0: number, z: number, r: number, h: number, n: number, hex: string) {
  k.lathe(x, y0, z, [[r * 0.8, 0], [r * 1.12, h * 0.25], [r * 0.9, h * 0.55], [r * 0.3, h * 0.82], [0, h]], n, hex)
}

/** Hemispherical-ish dome. */
function dome(k: Kit, x: number, y0: number, z: number, r: number, h: number, n: number, hex: string, rings = 3) {
  const prof: [number, number][] = []
  for (let i = 0; i < rings; i++) {
    const a = (i / rings) * Math.PI * 0.5
    prof.push([Math.cos(a) * r, Math.sin(a) * h])
  }
  prof.push([0, h])
  k.lathe(x, y0, z, prof, n, hex)
}

// ---------- archetype forms ----------

const pyramid: [string, Build][] = [
  ['giza', (k) => {
    // Khufu with its casing cap, Khafre behind-left, Menkaure, and the Sphinx in front
    k.frustum4(0, 0, 0, 1.5, 1.5, 0.22, 0.22, 0.86, M.sandstone)
    k.frustum4(0, 0.86, 0, 0.22, 0.22, 0, 0, 0.14, M.limestone)
    k.frustum4(-1.15, 0, -0.6, 1.4, 1.4, 0.2, 0.2, 0.8, M.ochre)
    k.frustum4(-1.15, 0.8, -0.6, 0.2, 0.2, 0, 0, 0.12, M.limestone)
    k.frustum4(-1.95, 0, -1.1, 0.7, 0.7, 0, 0, 0.45, M.sandstone)
    k.box(0.95, 0, 0.95, 0.14, 0.1, 0.42, M.ochre)
    k.box(0.95, 0, 1.12, 0.12, 0.17, 0.12, M.ochre)
    k.frustum4(0.95, 0.17, 1.12, 0.12, 0.1, 0.06, 0.06, 0.05, M.ochre)
  }],
  ['stepped', (k) => {
    // Pyramid of the Sun: five sloping talud terraces, front stair, flat summit
    const W = [2.1, 1.72, 1.36, 1.02, 0.7], H = [0.26, 0.22, 0.2, 0.17, 0.15]
    let y = 0
    W.forEach((w, i) => {
      const w1 = i + 1 < W.length ? W[i + 1] + 0.08 : w - 0.08
      k.frustum4(0, y, 0, w, w, w1, w1, H[i], M.rock)
      y += H[i]
    })
    ramp(k, 0, 1.15, 0.36, y, 0.26, M.stoneShade)
    k.box(0, y, 0, 0.36, 0.04, 0.36, M.stoneShade)
  }],
  ['castillo', (k) => {
    // El Castillo: nine narrow terraces read as six, stairs on two faces, temple on top
    const n = 6
    for (let i = 0; i < n; i++) {
      const w = 1.6 - i * 0.16
      k.frustum4(0, i * 0.12, 0, w, w, w - 0.06, w - 0.06, 0.12, M.limestone)
    }
    const top = n * 0.12
    ramp(k, 0, 0.84, 0.36, top, 0.28, M.stoneShade)
    k.push(0, 0, 0, Math.PI / 2)
    ramp(k, 0, 0.84, 0.36, top, 0.28, M.stoneShade)
    k.pop()
    k.box(0, top, 0, 0.5, 0.2, 0.46, M.limestone)
    k.box(0, top + 0.2, 0, 0.56, 0.05, 0.52, M.stoneShade)
    k.box(0, top, 0.235, 0.14, 0.14, 0.02, M.dark)
  }],
  ['borobudur', (k) => {
    // five square galleries, three round terraces ringed with stupas, the crowning stupa
    const S = [2.4, 2.1, 1.85, 1.6, 1.38]
    S.forEach((w, i) => k.frustum4(0, i * 0.075, 0, w, w, w - 0.06, w - 0.06, 0.075, i % 2 ? M.stoneShade : M.rock))
    let y = S.length * 0.075
    const R = [0.62, 0.5, 0.38]
    const N = [8, 6, 4]
    R.forEach((r, i) => {
      k.prism(0, y, 0, r + 0.06, r, 0.05, 10, M.rock, Math.PI / 10)
      k.ringOf(N[i], r - 0.02, 0, Math.PI * 2, (x, z) => k.prism(x, y + 0.05, z, 0.055, 0, 0.12, 5, M.stoneShade))
      y += 0.07
    })
    k.lathe(0, y, 0, [[0.2, 0], [0.23, 0.08], [0.18, 0.17], [0.05, 0.24], [0.03, 0.45], [0, 0.5]], 8, M.stoneShade)
  }],
]

const obelisk: [string, Build][] = [
  ['obelisk', (k) => {
    k.box(0, 0, 0, 0.34, 0.04, 0.34, M.stoneShade)
    k.box(0, 0.04, 0, 0.26, 0.05, 0.26, M.sandstone)
    k.frustum4(0, 0.09, 0, 0.15, 0.15, 0.1, 0.1, 0.8, M.sandstone)
    k.frustum4(0, 0.89, 0, 0.1, 0.1, 0, 0, 0.11, M.gold)
  }],
]

function peristyle(stone: string, roof: string): Build {
  return (k) => {
    const W = 2.3, D = 1.05
    for (let i = 0; i < 3; i++) k.box(0, i * 0.04, 0, W - i * 0.08, 0.04, D - i * 0.08, M.stoneShade)
    const y0 = 0.12, ch = 0.5
    const cw = W - 0.3, cd = D - 0.3
    const col = (x: number, z: number) => k.prism(x, y0, z, 0.05, 0.042, ch, 4, stone, Math.PI / 4, false)
    for (let i = 0; i < 8; i++) {
      const x = -cw / 2 + (cw * i) / 7
      col(x, cd / 2)
      col(x, -cd / 2)
    }
    for (let i = 1; i < 5; i++) {
      const z = -cd / 2 + (cd * i) / 5
      col(-cw / 2, z)
      col(cw / 2, z)
    }
    k.box(0, y0, 0, cw - 0.3, ch * 0.92, cd - 0.24, M.stoneShade) // cella in shadow
    k.box(0, y0 + ch, 0, cw + 0.12, 0.12, cd + 0.12, stone)
    k.gable(0, y0 + ch + 0.12, 0, cw + 0.12, 0.2, cd + 0.12, roof)
  }
}

const templeColumns: [string, Build][] = [
  ['peristyle', peristyle(M.marble, M.limestone)],
  ['peristyle-sand', peristyle(M.sandstone, M.sandstone)],
  ['hypostyle', (k) => {
    // Karnak: first pylon (two battered towers + gate) and the hypostyle column forest
    k.box(0, 0, -0.35, 1.9, 0.04, 1.5, M.stoneShade)
    for (const s of [-1, 1]) k.frustum4(s * 0.45, 0.04, 0.3, 0.72, 0.3, 0.6, 0.22, 0.71, M.sandstone)
    k.box(0, 0.04, 0.3, 0.2, 0.5, 0.24, M.ochre)
    k.box(0, 0.54, 0.3, 0.26, 0.06, 0.26, M.sandstone)
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        const x = -0.6 + c * 0.4, z = -0.1 - r * 0.32
        k.prism(x, 0.04, z, 0.085, 0.075, 0.5 - r * 0.03, 6, M.sandstone, 0, false)
      }
    k.box(0, 0.5, -0.42, 1.4, 0.05, 0.12, M.ochre)
  }],
  ['colossi', (k) => {
    // Abu Simbel: cliff with the battered facade and four seated colossi
    k.frustum4(0, 0, -0.12, 2.1, 0.7, 1.95, 0.4, 0.86, M.ochre, 0, -0.12)
    k.box(0, 0.74, 0.12, 1.6, 0.1, 0.12, M.sandstone)
    k.box(0, 0, 0.24, 0.16, 0.26, 0.02, M.dark)
    for (const x of [-0.72, -0.34, 0.34, 0.72]) {
      k.box(x, 0, 0.3, 0.3, 0.12, 0.3, M.sandstone) // legs + throne
      k.box(x, 0.12, 0.24, 0.28, 0.3, 0.2, M.sandstone) // torso
      k.box(x, 0.42, 0.26, 0.14, 0.14, 0.14, M.sandstone) // head
      k.frustum4(x, 0.42, 0.24, 0.24, 0.12, 0.08, 0.08, 0.18, M.ochre) // nemes headdress
      k.frustum4(x, 0.56, 0.25, 0.08, 0.08, 0.04, 0.04, 0.1, M.sandstone) // double crown
    }
  }],
  ['rockcut', (k) => {
    // Petra's Treasury: rose cliff, two-storey columned facade, tholos with its urn
    k.frustum4(0, 0, -0.2, 1.9, 0.5, 1.7, 0.4, 1.12, M.redstone)
    k.box(0, 0, 0.08, 1.0, 0.04, 0.1, M.sandstone)
    for (let i = 0; i < 6; i++) k.prism(-0.42 + i * 0.168, 0.04, 0.12, 0.035, 0.03, 0.36, 4, M.sandstone, Math.PI / 4, false)
    k.box(0, 0.4, 0.09, 1.0, 0.07, 0.12, M.sandstone)
    k.gable(0, 0.47, 0.09, 0.42, 0.12, 0.1, M.sandstone)
    for (const s of [-1, 1]) {
      k.box(s * 0.36, 0.5, 0.08, 0.26, 0.3, 0.1, M.sandstone)
      k.frustum4(s * 0.36, 0.8, 0.08, 0.26, 0.1, 0.12, 0.05, 0.05, M.sandstone)
      for (const dx of [-0.09, 0.09]) k.prism(s * 0.36 + dx, 0.5, 0.15, 0.025, 0.022, 0.3, 4, M.sandstone, Math.PI / 4, false)
    }
    k.prism(0, 0.52, 0.08, 0.12, 0.12, 0.3, 8, M.sandstone, 0, false)
    k.prism(0, 0.82, 0.08, 0.14, 0, 0.1, 8, M.sandstone)
    k.lathe(0, 0.92, 0.08, [[0.03, 0], [0.05, 0.04], [0.02, 0.09], [0, 0.1]], 5, M.sandstone)
  }],
]

const domeArch: [string, Build][] = [
  ['basilica', (k) => {
    // St Peter's: travertine facade + portico, nave, drum, ribbed lead dome, lantern
    k.box(0, 0, 0.45, 1.5, 0.36, 0.3, M.limestone)
    k.gable(0, 0.36, 0.55, 0.5, 0.1, 0.1, M.limestone)
    k.box(0, 0, -0.15, 0.62, 0.4, 0.95, M.limestone)
    k.gable(0, 0.4, -0.15, 0.62, 0.12, 0.95, M.stoneShade)
    k.prism(0, 0.4, -0.25, 0.3, 0.3, 0.14, 12, M.limestone, 0, false)
    k.lathe(0, 0.54, -0.25, [[0.32, 0], [0.3, 0.12], [0.22, 0.24], [0.1, 0.31], [0, 0.32]], 12, M.steelGrey)
    k.prism(0, 0.84, -0.25, 0.05, 0.05, 0.08, 6, M.limestone)
    k.prism(0, 0.92, -0.25, 0.05, 0, 0.08, 6, M.steelGrey)
    for (const s of [-1, 1]) dome(k, s * 0.5, 0.36, 0.25, 0.1, 0.12, 6, M.steelGrey, 2)
  }],
  ['byzantine', (k) => {
    // Hagia Sophia: buttressed mass, low ribbed dome with semi-domes, four pencil minarets
    k.box(0, 0, 0, 1.15, 0.36, 1.0, M.ochre)
    k.box(0, 0.36, 0, 0.7, 0.08, 0.7, M.ochre)
    k.prism(0, 0.44, 0, 0.34, 0.34, 0.06, 12, M.ochre, 0, false)
    dome(k, 0, 0.5, 0, 0.36, 0.2, 12, M.roof, 3)
    for (const s of [-1, 1]) k.lathe(0, 0.36, s * 0.34, [[0.3, 0], [0.24, 0.1], [0, 0.15]], 8, M.roof, 0, true, 1, 0.6)
    for (const [x, z] of [[-0.66, 0.56], [0.66, 0.56], [-0.66, -0.56], [0.66, -0.56]]) {
      k.prism(x, 0, z, 0.04, 0.034, 0.82, 6, M.limestone, 0, false)
      k.prism(x, 0.62, z, 0.055, 0.055, 0.03, 6, M.limestone, 0, true)
      k.prism(x, 0.82, z, 0.036, 0, 0.18, 6, M.roof)
    }
  }],
  ['florence', (k) => {
    // Santa Maria del Fiore: marble nave, octagonal drum, Brunelleschi's ribbed brick dome, Giotto's campanile
    k.box(0, 0, 0.35, 0.56, 0.34, 1.0, M.marble)
    k.gable(0, 0.34, 0.35, 0.56, 0.1, 1.0, M.brick)
    k.prism(0, 0, -0.32, 0.44, 0.44, 0.36, 8, M.marble, Math.PI / 8, false)
    k.prism(0, 0.36, -0.32, 0.3, 0.3, 0.14, 8, M.marble, Math.PI / 8, false)
    k.lathe(0, 0.5, -0.32, [[0.32, 0], [0.3, 0.12], [0.24, 0.24], [0.13, 0.33], [0.06, 0.36]], 8, M.brick, Math.PI / 8)
    k.prism(0, 0.86, -0.32, 0.05, 0.05, 0.06, 6, M.marble)
    k.prism(0, 0.92, -0.32, 0.05, 0, 0.08, 6, M.gold)
    k.box(0.55, 0, 0.55, 0.17, 0.78, 0.17, M.marble)
    k.box(0.55, 0.78, 0.55, 0.2, 0.04, 0.2, M.marble)
  }],
  ['parliament', (k) => {
    // Hungarian Parliament: long gothic-revival river front, central ribbed dome and spire
    k.box(0, 0, 0, 2.6, 0.3, 0.5, M.limestone)
    k.gable(0, 0.3, 0, 2.6, 0.14, 0.5, M.brick)
    for (const s of [-1, 1]) {
      k.box(s * 0.75, 0, 0.05, 0.3, 0.42, 0.56, M.limestone)
      k.frustum4(s * 0.75, 0.42, 0.05, 0.3, 0.56, 0, 0, 0.18, M.brick)
      for (const d of [-1, 1]) k.prism(s * 0.75 + d * 0.13, 0.42, 0.31, 0.03, 0, 0.16, 4, M.limestone)
    }
    k.prism(0, 0.3, 0, 0.24, 0.24, 0.2, 12, M.limestone, 0, false)
    k.lathe(0, 0.5, 0, [[0.26, 0], [0.22, 0.14], [0.12, 0.26], [0.04, 0.32]], 12, M.brick)
    k.prism(0, 0.82, 0, 0.04, 0, 0.18, 6, M.limestone)
    for (let i = 0; i < 8; i++) k.prism(-1.15 + i * 0.32 + (i > 3 ? 0.32 : 0), 0.3, 0.25, 0.03, 0, 0.14, 4, M.limestone)
  }],
  ['helsinki', (k) => {
    // Helsinki Cathedral: podium and steps, white greek-cross body, green central dome, four cupolas
    k.box(0, 0, 0, 1.6, 0.12, 1.5, M.stoneShade)
    ramp(k, 0, 1.0, 0.75, 0.12, 0.7, M.limestone)
    k.box(0, 0.12, 0, 1.0, 0.36, 0.56, M.white)
    k.box(0, 0.12, 0, 0.56, 0.36, 1.0, M.white)
    k.gable(0, 0.48, 0.2, 0.56, 0.12, 0.6, M.white)
    k.push(0, 0, 0, Math.PI / 2)
    k.gable(0, 0.48, 0, 0.56, 0.12, 1.0, M.white)
    k.pop()
    k.prism(0, 0.48, 0, 0.2, 0.2, 0.16, 12, M.white, 0, false)
    k.lathe(0, 0.64, 0, [[0.22, 0], [0.19, 0.1], [0.1, 0.2], [0.03, 0.24]], 12, M.verdigris)
    k.prism(0, 0.88, 0, 0.035, 0.035, 0.06, 6, M.white)
    k.prism(0, 0.94, 0, 0.04, 0, 0.06, 6, M.verdigris)
    for (const [x, z] of [[-0.36, 0.36], [0.36, 0.36], [-0.36, -0.36], [0.36, -0.36]]) {
      k.prism(x, 0.48, z, 0.07, 0.07, 0.08, 6, M.white, 0, false)
      dome(k, x, 0.56, z, 0.08, 0.08, 6, M.verdigris, 2)
    }
  }],
  ['taj', (k) => {
    // Taj Mahal: plinth, chamfered body with the iwan, onion dome, chhatris, four minarets
    k.box(0, 0, 0, 1.9, 0.08, 1.9, M.marble)
    k.prism(0, 0.08, 0, 0.62, 0.62, 0.36, 8, M.marble, Math.PI / 8)
    k.box(0, 0.12, 0.555, 0.26, 0.28, 0.02, M.stoneShade)
    k.prism(0, 0.44, 0, 0.24, 0.24, 0.1, 10, M.marble, 0, false)
    onion(k, 0, 0.54, 0, 0.27, 0.36, 10, M.marble)
    k.prism(0, 0.9, 0, 0.02, 0, 0.1, 4, M.gold)
    for (const [x, z] of [[-0.36, 0.36], [0.36, 0.36], [-0.36, -0.36], [0.36, -0.36]]) {
      k.prism(x, 0.44, z, 0.07, 0.07, 0.06, 6, M.marble, 0, false)
      k.prism(x, 0.5, z, 0.09, 0, 0.09, 6, M.marble)
    }
    for (const [x, z] of [[-0.86, 0.86], [0.86, 0.86], [-0.86, -0.86], [0.86, -0.86]]) {
      k.prism(x, 0.08, z, 0.05, 0.04, 0.62, 5, M.marble, 0, false)
      k.prism(x, 0.7, z, 0.055, 0, 0.08, 5, M.marble)
    }
  }],
  ['opera', (k) => {
    // Sydney Opera House: granite podium and two rows of nested white shells
    k.box(0, 0, 0, 2.1, 0.12, 1.0, M.stoneShade)
    const shell = (x: number, z: number, w: number, h: number, lean: number) => {
      const a = w / 2
      k.prim(
        [[x - a, 0.12, z], [x + a, 0.12, z], [x, 0.12 + h, z - lean], [x, 0.12 + h * 0.5, z + w * 0.42], [x, 0.12, z - w * 0.2]],
        [[0, 3, 2], [3, 1, 2], [0, 1, 3], [0, 2, 4], [4, 2, 1]],
        M.white,
      )
    }
    for (const [x, s] of [[-0.45, 1], [0.48, 0.82]] as [number, number][]) {
      shell(x, 0.32, 0.5 * s, 0.82 * s, 0.25 * s)
      shell(x, 0.02, 0.46 * s, 0.7 * s, 0.22 * s)
      shell(x, -0.26, 0.4 * s, 0.52 * s, 0.18 * s)
    }
    shell(0.05, 0.42, 0.24, 0.32, 0.1)
  }],
]

const spire: [string, Build][] = [
  ['gothic', (k) => {
    // Milan: broad marble front, a forest of pinnacles, the tiburio spire with the Madonnina.
    // Pinnacles and spire are drawn stout enough to stay whole at 30-40 px (finish review
    // round 2: the 0.03-radius needles fell below a pixel and the form read as a box).
    k.box(0, 0, 0, 1.2, 0.36, 1.5, M.marble)
    k.gable(0, 0.36, 0, 1.0, 0.14, 1.4, M.stoneShade)
    k.push(0, 0, 0.75, Math.PI / 2)
    k.gable(0, 0.36, 0, 0.05, 0.26, 1.2, M.marble)
    k.pop()
    for (let i = 0; i < 6; i++) {
      const x = -0.55 + i * 0.22
      k.prism(x, 0.36, 0.75, 0.055, 0, 0.3 + (i === 2 || i === 3 ? 0.1 : 0), 4, M.marble)
    }
    for (let i = 0; i < 5; i++) {
      const z = 0.55 - i * 0.27
      k.prism(-0.58, 0.36, z, 0.05, 0, 0.26, 4, M.marble)
      k.prism(0.58, 0.36, z, 0.05, 0, 0.26, 4, M.marble)
    }
    k.prism(0, 0.46, -0.2, 0.16, 0.13, 0.2, 8, M.marble, 0, false)
    k.prism(0, 0.66, -0.2, 0.11, 0, 0.34, 8, M.marble)
    k.prism(0, 0.98, -0.2, 0.03, 0, 0.08, 4, M.gold)
  }],
  ['fairytale', (k) => {
    // Neuschwanstein on its crag: white palace, slender round towers with slate cones
    crag(k, 0, 0, 0.75, 0.3, 7, 11, M.rockDark, { rings: [0, 0.6], top: 0.45, jitter: 0.12 })
    k.box(0, 0.26, 0, 0.75, 0.42, 0.32, M.white)
    k.gable(0, 0.68, 0, 0.75, 0.12, 0.32, M.slate)
    k.box(-0.42, 0.26, 0.05, 0.18, 0.5, 0.18, M.white)
    k.frustum4(-0.42, 0.76, 0.05, 0.2, 0.2, 0, 0, 0.14, M.slate)
    const tower = (x: number, z: number, r: number, h: number) => {
      k.prism(x, 0.26, z, r, r, h, 8, M.white, 0, false)
      k.prism(x, 0.26 + h, z, r * 1.25, 0, r * 3.2, 8, M.slate)
    }
    tower(0.36, 0.18, 0.06, 0.52)
    tower(0.2, -0.16, 0.05, 0.5)
    tower(-0.12, 0.18, 0.045, 0.44)
  }],
  ['prague', (k) => {
    // Prague Castle front with St Vitus' twin spires and the green-helmed great tower behind
    k.box(0, 0, 0.25, 2.0, 0.24, 0.32, M.limestone)
    k.gable(0, 0.24, 0.25, 2.0, 0.08, 0.32, M.brick)
    k.box(0, 0, -0.25, 0.4, 0.42, 1.0, M.stoneShade)
    k.gable(0, 0.42, -0.25, 0.4, 0.14, 1.0, M.slate)
    for (const s of [-1, 1]) {
      k.box(s * 0.13, 0, 0.18, 0.12, 0.72, 0.12, M.stoneShade)
      k.frustum4(s * 0.13, 0.72, 0.18, 0.12, 0.12, 0, 0, 0.26, M.stoneShade)
    }
    k.box(0.32, 0, -0.35, 0.18, 0.6, 0.18, M.stoneShade)
    onion(k, 0.32, 0.6, -0.35, 0.1, 0.2, 6, M.verdigris)
    k.prism(0.32, 0.8, -0.35, 0.02, 0, 0.08, 4, M.verdigris)
  }],
  ['sagrada', (k) => {
    // Sagrada Familia: clusters of tapering bell towers, the tallest crossing tower
    k.box(0, 0, 0, 0.8, 0.3, 1.2, M.sandstone)
    const spireT = (x: number, z: number, r: number, h: number, hex: string) =>
      k.lathe(x, 0, z, [[r, 0], [r * 0.72, h * 0.62], [0, h]], 5, hex)
    for (let i = 0; i < 4; i++) {
      spireT(-0.3 + i * 0.2, 0.55, 0.07, 0.62 + (i === 1 || i === 2 ? 0.08 : 0), M.sandstone)
      spireT(-0.3 + i * 0.2, -0.55, 0.07, 0.58 + (i === 1 || i === 2 ? 0.08 : 0), M.ochre)
    }
    for (const [x, z] of [[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]]) spireT(x, z, 0.08, 0.8, M.limestone)
    k.lathe(0, 0, 0, [[0.11, 0], [0.1, 0.5], [0.06, 0.85], [0, 1.0]], 8, M.limestone)
  }],
  ['basils', (k) => {
    // St Basil's: brick base, central tent spire, onion domes in restrained colours
    k.box(0, 0, 0, 1.0, 0.18, 1.0, M.brick)
    k.prism(0, 0.18, 0, 0.16, 0.14, 0.24, 8, M.brick, 0, false)
    k.prism(0, 0.42, 0, 0.13, 0, 0.42, 8, M.gold)
    onion(k, 0, 0.84, 0, 0.05, 0.12, 6, M.gold)
    const C = [M.verdigris, M.brick, M.gold, M.roof]
    ;[[-0.32, 0.32], [0.32, 0.32], [-0.32, -0.32], [0.32, -0.32]].forEach(([x, z], i) => {
      const h = i < 2 ? 0.3 : 0.24
      k.prism(x, 0.18, z, 0.09, 0.08, h, 6, M.brick, 0, false)
      onion(k, x, 0.18 + h, z, 0.1, 0.22, 6, C[i])
    })
  }],
]

const tower: [string, Build][] = [
  ['pharos', (k) => {
    // Pharos (on the Qaitbay site): square base, octagonal middle, round lantern
    k.box(0, 0, 0, 0.9, 0.06, 0.9, M.stoneShade)
    k.frustum4(0, 0.06, 0, 0.56, 0.56, 0.46, 0.46, 0.44, M.limestone)
    k.box(0, 0.5, 0, 0.5, 0.03, 0.5, M.limestone)
    k.prism(0, 0.53, 0, 0.19, 0.16, 0.26, 8, M.limestone, Math.PI / 8)
    k.prism(0, 0.79, 0, 0.11, 0.1, 0.13, 8, M.limestone)
    k.prism(0, 0.92, 0, 0.07, 0, 0.08, 6, M.bronze)
  }],
  ['minaret', (k) => {
    // Kairouan: walled courtyard and the three-stage square minaret with its small dome
    k.box(0, 0, 0, 1.3, 0.12, 0.9, M.sandstone)
    k.box(0, 0, 0, 1.0, 0.13, 0.6, M.ochre)
    k.frustum4(0, 0, -0.3, 0.36, 0.36, 0.3, 0.3, 0.56, M.sandstone)
    k.box(0, 0.56, -0.3, 0.24, 0.2, 0.24, M.sandstone)
    k.box(0, 0.76, -0.3, 0.15, 0.1, 0.15, M.sandstone)
    dome(k, 0, 0.86, -0.3, 0.075, 0.1, 6, M.sandstone, 2)
  }],
  ...(['lattice', 'lattice-red'] as const).map((name): [string, Build] => [name, (k) => {
    // Eiffel / Tokyo Tower: four splayed legs, platforms, the concave shaft, antenna
    const red = name === 'lattice-red'
    const a = red ? M.rust : M.bronze
    const b = red ? M.white : M.bronze
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.frustum4(sx * 0.4, 0, sz * 0.4, 0.13, 0.13, 0.08, 0.08, 0.28, a, -sx * 0.23, -sz * 0.23)
    k.box(0, 0.28, 0, 0.5, 0.04, 0.5, b)
    k.frustum4(0, 0.32, 0, 0.36, 0.36, 0.2, 0.2, 0.16, a)
    k.frustum4(0, 0.48, 0, 0.2, 0.2, 0.13, 0.13, 0.12, a)
    k.box(0, 0.6, 0, 0.18, 0.03, 0.18, b)
    k.frustum4(0, 0.63, 0, 0.12, 0.12, 0.06, 0.06, 0.18, a)
    k.frustum4(0, 0.81, 0, 0.06, 0.06, 0.035, 0.035, 0.1, red ? M.white : a)
    k.box(0, 0.91, 0, 0.05, 0.02, 0.05, b)
    k.prism(0, 0.93, 0, 0.012, 0, 0.07, 4, a)
  }]),
  ['clock', (k) => {
    // Big Ben (Elizabeth Tower) beside the Palace of Westminster
    k.box(-0.5, 0, 0, 0.8, 0.2, 0.32, M.ochre)
    k.gable(-0.5, 0.2, 0, 0.8, 0.06, 0.32, M.slate)
    k.box(0, 0, 0, 0.2, 0.56, 0.2, M.ochre)
    k.box(0, 0.56, 0, 0.24, 0.13, 0.24, M.ochre)
    k.box(0, 0.585, 0.121, 0.15, 0.08, 0.01, M.marble)
    k.box(0.121, 0.585, 0, 0.01, 0.08, 0.15, M.marble)
    k.box(0, 0.69, 0, 0.2, 0.07, 0.2, M.ochre)
    k.frustum4(0, 0.76, 0, 0.2, 0.2, 0.05, 0.05, 0.16, M.slate)
    k.frustum4(0, 0.92, 0, 0.05, 0.05, 0, 0, 0.08, M.gold)
    for (const [x, z] of [[-0.1, 0.1], [0.1, 0.1], [-0.1, -0.1], [0.1, -0.1]]) k.prism(x, 0.76, z, 0.018, 0, 0.08, 4, M.ochre)
  }],
  ['belem', (k) => {
    // Belem Tower: crenellated bastion on the river, the tall tower with corner sentry turrets
    k.box(0, 0, 0.2, 0.7, 0.24, 0.5, M.limestone)
    for (let i = 0; i < 5; i++) k.box(-0.28 + i * 0.14, 0.24, 0.43, 0.07, 0.05, 0.04, M.limestone)
    k.box(0, 0, -0.18, 0.34, 0.66, 0.34, M.limestone)
    k.box(0, 0.4, -0.005, 0.2, 0.08, 0.04, M.stoneShade)
    for (let i = 0; i < 3; i++) k.box(-0.12 + i * 0.12, 0.66, -0.02, 0.06, 0.05, 0.03, M.limestone)
    for (const [x, z] of [[-0.17, -0.01], [0.17, -0.01], [-0.17, -0.35], [0.17, -0.35]]) {
      k.prism(x, 0.58, z, 0.04, 0.04, 0.12, 6, M.limestone, 0, false)
      dome(k, x, 0.7, z, 0.045, 0.06, 6, M.limestone, 2)
    }
    for (const [x, z] of [[-0.35, 0.45], [0.35, 0.45]]) {
      k.prism(x, 0.24, z, 0.04, 0.04, 0.08, 6, M.limestone, 0, false)
      dome(k, x, 0.32, z, 0.045, 0.06, 6, M.limestone, 2)
    }
    k.frustum4(0, 0.66, -0.18, 0.26, 0.26, 0.2, 0.2, 0.06, M.limestone)
  }],
  ['saucer', (k) => {
    // Space Needle: three pinched legs, the flying-saucer top house, the spire
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6
      const s = Math.sin(a), c = Math.cos(a)
      beam(k, [s * 0.3, 0, c * 0.3], [s * 0.06, 0.42, c * 0.06], 0.045, 0.045, M.white)
      beam(k, [s * 0.06, 0.42, c * 0.06], [s * 0.1, 0.74, c * 0.1], 0.04, 0.04, M.white)
    }
    k.lathe(0, 0.72, 0, [[0.06, 0], [0.26, 0.05], [0.25, 0.08], [0.13, 0.12]], 12, M.white)
    k.lathe(0, 0.84, 0, [[0.13, 0], [0.09, 0.03], [0.02, 0.04]], 12, M.gold)
    k.prism(0, 0.88, 0, 0.015, 0, 0.12, 4, M.white)
  }],
  ['needle', (k) => {
    // CN Tower: Y-buttressed hexagonal shaft, main pod, sky pod, mast
    k.prism(0, 0, 0, 0.075, 0.045, 0.66, 6, M.steelGrey, 0, false)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      beam(k, [Math.sin(a) * 0.16, 0, Math.cos(a) * 0.16], [Math.sin(a) * 0.03, 0.4, Math.cos(a) * 0.03], 0.05, 0.03, M.steelGrey)
    }
    k.lathe(0, 0.56, 0, [[0.05, 0], [0.12, 0.025], [0.12, 0.055], [0.06, 0.08]], 10, M.iron)
    k.lathe(0, 0.73, 0, [[0.04, 0], [0.06, 0.015], [0.04, 0.03]], 8, M.iron)
    k.prism(0, 0.66, 0, 0.04, 0.02, 0.2, 6, M.steelGrey)
    k.prism(0, 0.86, 0, 0.012, 0, 0.14, 4, M.white)
  }],
  ['taipei101', (k) => {
    // Taipei 101: tapered base and eight flared pagoda-like segments, the crown and spire
    k.frustum4(0, 0, 0, 0.36, 0.36, 0.26, 0.26, 0.24, M.glass)
    for (let i = 0; i < 8; i++) k.frustum4(0, 0.24 + i * 0.075, 0, 0.21, 0.21, 0.27, 0.27, 0.075, i % 2 ? M.glass : M.verdigris)
    k.frustum4(0, 0.84, 0, 0.16, 0.16, 0.1, 0.1, 0.06, M.glass)
    k.prism(0, 0.9, 0, 0.02, 0, 0.1, 4, M.steelGrey)
  }],
  ['mbs', (k) => {
    // Marina Bay Sands: three splayed twin-slab towers under the ship-shaped SkyPark
    for (const x of [-0.5, 0, 0.5]) {
      k.frustum4(x, 0, 0.05, 0.2, 0.12, 0.2, 0.12, 0.74, M.glass, 0, -0.06)
      k.frustum4(x, 0, -0.12, 0.2, 0.12, 0.2, 0.12, 0.74, M.glass, 0, 0.06)
    }
    k.prim(
      [[-0.72, 0.74, -0.1], [0.92, 0.74, -0.1], [0.92, 0.74, 0.08], [-0.72, 0.74, 0.08], [-0.72, 0.8, -0.1], [0.98, 0.8, -0.1], [0.98, 0.8, 0.08], [-0.72, 0.8, 0.08]],
      [[0, 1, 5], [0, 5, 4], [3, 2, 6], [3, 6, 7], [1, 2, 6], [1, 6, 5], [0, 3, 7], [0, 7, 4], [4, 5, 6], [4, 6, 7]],
      M.white,
    )
    k.box(0, 0, 0.3, 1.6, 0.1, 0.25, M.white)
  }],
  ['twin', (k) => {
    // Petronas Towers: stepped octagonal shafts, the skybridge, pinnacles
    for (const x of [-0.27, 0.27]) {
      const tiers: [number, number][] = [[0.13, 0.52], [0.115, 0.12], [0.095, 0.08], [0.075, 0.06], [0.05, 0.04]]
      let y = 0
      for (const [r, h] of tiers) {
        k.prism(x, y, 0, r, r * 0.98, h, 8, M.steelGrey, Math.PI / 8, false)
        y += h
      }
      k.prism(x, y, 0, 0.05, 0.03, 0.06, 8, M.steelGrey, Math.PI / 8)
      k.prism(x, y + 0.06, 0, 0.02, 0, 0.12, 4, M.steelGrey)
    }
    k.box(0, 0.4, 0, 0.3, 0.035, 0.05, M.iron)
    for (const s of [-1, 1]) beam(k, [s * 0.15, 0.4, 0], [s * 0.04, 0.3, 0], 0.02, 0.03, M.iron)
  }],
]

const bridge: [string, Build][] = [
  ['stone-arch', (k) => {
    // Stari Most: one steep humped arch between the Tara and Halebija towers
    const pts: [number, number][] = [[-1.1, 0], [-1.1, 0.42], [0, 0.58], [1.1, 0.42], [1.1, 0], [0.72, 0]]
    for (let i = 1; i < 8; i++) {
      const t = i / 8
      const a = Math.PI * t
      pts.push([0.72 * Math.cos(a), 0.47 * Math.pow(Math.sin(a), 0.85)])
    }
    pts.push([-0.72, 0])
    k.extrude(pts, 0.2, M.chalk)
    for (const s of [-1, 1]) {
      k.box(s * 1.25, 0, -0.05, 0.3, 0.62, 0.3, M.limestone)
      k.frustum4(s * 1.25, 0.62, -0.05, 0.34, 0.34, 0, 0, 0.18, M.slate)
    }
  }],
  ['iron-arch', (k) => {
    // Dom Luis I: the great iron arch carrying the upper deck, lower deck, granite piers
    const outer: [number, number][] = []
    const inner: [number, number][] = []
    for (let i = 0; i <= 9; i++) {
      const t = -1 + (2 * i) / 9
      outer.push([t * 0.95, 0.7 * (1 - t * t)])
    }
    for (let i = 9; i >= 0; i--) {
      const t = -1 + (2 * i) / 9
      inner.push([t * 0.8, 0.58 * (1 - t * t)])
    }
    k.extrude([...outer, ...inner].map(([x, y]) => [x, y + 0.04] as [number, number]), 0.1, M.iron)
    k.box(0, 0.72, 0, 2.6, 0.04, 0.16, M.iron)
    k.box(0, 0.12, 0.1, 1.2, 0.035, 0.12, M.iron)
    for (const x of [-0.7, -0.45, 0.45, 0.7]) k.box(x, 0.3 * (1 - (x / 0.95) ** 2) + 0.04, 0, 0.025, 0.72 - (0.3 * (1 - (x / 0.95) ** 2) + 0.04), 0.06, M.iron)
    for (const s of [-1, 1]) k.box(s * 1.15, 0, 0, 0.26, 0.72, 0.24, M.limestone)
  }],
  ['suspension', (k) => {
    // Golden Gate: two art-deco towers, the deck and the sagging main cable
    const tx = 0.6
    for (const s of [-1, 1]) {
      for (const dz of [-0.06, 0.06]) k.frustum4(s * tx, 0, dz, 0.07, 0.06, 0.05, 0.05, 1.0, M.rust)
      for (const y of [0.42, 0.66, 0.88]) k.box(s * tx, y, 0, 0.05, 0.05, 0.12, M.rust)
    }
    k.box(0, 0.24, 0, 2.7, 0.045, 0.14, M.rust)
    const cable = (x0: number, y0: number, x1: number, y1: number, sag: number, n: number) => {
      let prev: V3 = [x0, y0, 0.07]
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const p: V3 = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - sag * 4 * t * (1 - t), 0.07]
        beam(k, prev, p, 0.018, 0.018, M.rust)
        prev = p
      }
    }
    cable(-tx, 0.98, tx, 0.98, 0.7, 6)
    cable(-1.3, 0.3, -tx, 0.98, 0.1, 2)
    cable(tx, 0.98, 1.3, 0.3, 0.1, 2)
  }],
]

const statue: [string, Build][] = [
  ['liberty', (k) => {
    // Statue of Liberty: star-fort base, pedestal, robed figure, raised torch, tablet
    k.prism(0, 0, 0, 0.42, 0.42, 0.08, 6, M.stoneShade, Math.PI / 6)
    k.frustum4(0, 0.08, 0, 0.28, 0.28, 0.22, 0.22, 0.3, M.limestone)
    k.lathe(0, 0.38, 0, [[0.085, 0], [0.075, 0.2], [0.05, 0.36]], 6, M.verdigris)
    k.prism(0, 0.74, 0, 0.035, 0.03, 0.06, 5, M.verdigris)
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 4) * Math.PI
      beam(k, [0, 0.79, 0], [Math.sin(a) * 0.05, 0.79 + Math.cos(a) * 0.035 + 0.02, 0.01], 0.01, 0.01, M.verdigris)
    }
    beam(k, [0.04, 0.68, 0], [0.1, 0.9, 0], 0.03, 0.03, M.verdigris)
    k.prism(0.1, 0.9, 0, 0.03, 0.025, 0.04, 5, M.verdigris)
    k.prism(0.1, 0.94, 0, 0.022, 0, 0.06, 5, M.gold)
    k.box(-0.06, 0.56, 0.04, 0.05, 0.1, 0.03, M.verdigris)
  }],
  ['christ', (k) => {
    // Christ the Redeemer on the Corcovado summit, arms outstretched
    crag(k, 0, 0, 0.5, 0.34, 7, 5, M.greenDark, { rings: [0, 0.5], top: 0.16, jitter: 0.15 })
    k.box(0, 0.32, 0, 0.12, 0.08, 0.12, M.marble)
    k.lathe(0, 0.4, 0, [[0.06, 0], [0.055, 0.25], [0.045, 0.4]], 6, M.marble)
    k.box(0, 0.74, 0, 0.66, 0.045, 0.05, M.marble)
    k.prism(0, 0.8, 0, 0.03, 0.028, 0.07, 5, M.marble)
  }],
  ['moai', (k) => {
    // Ahu Tongariki: the ahu platform and a row of seven moai of varied height
    k.box(0, 0, 0, 2.3, 0.08, 0.36, M.rock)
    const H = [0.86, 0.95, 0.8, 1.0, 0.9, 0.82, 0.92]
    H.forEach((h, i) => {
      const x = -0.96 + i * 0.32
      const s = h
      k.frustum4(x, 0.08, 0, 0.17, 0.13, 0.15, 0.11, 0.44 * s, M.rockDark)
      k.box(x, 0.08 + 0.44 * s, -0.01, 0.13, 0.36 * s, 0.13, M.rockDark)
      k.box(x, 0.08 + 0.62 * s, 0.065, 0.13, 0.05 * s, 0.03, M.rockDark)
    })
  }],
]

const wall: [string, Build][] = [
  ['citywall', (k) => {
    // Dubrovnik: the ring of walls, round Minceta tower, red roofs inside, sea bastion
    const loop: [number, number][] = [[-0.9, 0.4], [-0.3, 0.55], [0.4, 0.5], [0.95, 0.2], [0.85, -0.35], [0.2, -0.55], [-0.5, -0.5], [-0.95, -0.1]]
    for (let i = 0; i < loop.length; i++) {
      const [x0, z0] = loop[i], [x1, z1] = loop[(i + 1) % loop.length]
      beam(k, [x0, 0.13, z0], [x1, 0.13, z1], 0.07, 0.26, M.limestone)
    }
    k.prism(-0.5, 0, -0.5, 0.15, 0.13, 0.5, 8, M.limestone)
    k.prism(0.95, 0, 0.2, 0.12, 0.12, 0.34, 8, M.limestone)
    k.box(0.4, 0, 0.5, 0.18, 0.32, 0.18, M.limestone)
    ;[[-0.4, 0.1], [0, 0.25], [0.35, -0.05], [-0.1, -0.2], [0.5, -0.3]].forEach(([x, z], i) => {
      k.box(x, 0, z, 0.3, 0.16 + (i % 2) * 0.04, 0.2, M.limestone)
      k.gable(x, 0.16 + (i % 2) * 0.04, z, 0.3, 0.09, 0.2, M.brick)
    })
    k.box(0.15, 0, 0.05, 0.12, 0.42, 0.12, M.limestone)
    k.frustum4(0.15, 0.42, 0.05, 0.12, 0.12, 0, 0, 0.12, M.verdigris)
  }],
  ['terraces', (k) => {
    // Machu Picchu: Huayna Picchu's sugar-loaf peak, the saddle, terraces and stone ruins
    crag(k, 0.15, -0.55, 0.42, 1.0, 7, 3, M.greenDark, { rings: [0, 0.35, 0.7], p: 0.8, jitter: 0.12, lean: [0, 0.05] })
    crag(k, -0.95, -0.2, 0.5, 0.5, 7, 9, M.greenDark, { rings: [0, 0.5], jitter: 0.15 })
    for (let i = 0; i < 4; i++) k.box(0, i * 0.06, 0.45 - i * 0.12, 1.5 - i * 0.12, 0.06, 0.4, i % 2 ? M.green : M.greenDark)
    ;[[-0.4, 0.1], [-0.15, 0.05], [0.15, 0.12], [0.4, 0.06], [0.0, -0.05], [-0.3, -0.06]].forEach(([x, z], i) =>
      k.box(x, 0.24, z, 0.16 + (i % 3) * 0.04, 0.07 + (i % 2) * 0.03, 0.1, M.limestone),
    )
    k.gable(0.15, 0.31, 0.12, 0.16, 0.06, 0.1, M.wood)
  }],
  ['greatwall', (k) => {
    // Great Wall at Badaling: the wall riding a ridge between two watchtowers
    const ridge: [number, number][] = [[-1.3, 0], [-1.3, 0.18], [-0.85, 0.36], [-0.4, 0.26], [0.1, 0.5], [0.6, 0.34], [1.05, 0.44], [1.3, 0.3], [1.3, 0]]
    k.extrude(ridge, 0.5, M.green, [], -0.1)
    const path: V3[] = [[-1.25, 0.24, 0.2], [-0.85, 0.42, 0.12], [-0.4, 0.33, 0.2], [0.1, 0.56, 0.1], [0.6, 0.41, 0.2], [1.05, 0.5, 0.12], [1.25, 0.37, 0.18]]
    for (let i = 0; i + 1 < path.length; i++) beam(k, path[i], path[i + 1], 0.07, 0.07, M.limestone)
    for (const p of [path[1], path[3], path[5]]) {
      k.box(p[0], p[1] - 0.04, p[2], 0.16, 0.18, 0.16, M.limestone)
      k.box(p[0], p[1] + 0.14, p[2], 0.19, 0.03, 0.19, M.stoneShade)
    }
  }],
]

function hall(roof: string): Build {
  return (k) => {
    // palace hall: marble terraces, lacquer-red columned hall, double-eaved roof
    k.box(0, 0, 0, 1.8, 0.08, 1.1, M.marble)
    k.box(0, 0.08, 0, 1.5, 0.07, 0.9, M.marble)
    ramp(k, 0, 0.75, 0.45, 0.15, 0.3, M.marble)
    k.box(0, 0.15, 0, 1.2, 0.24, 0.62, M.lacquer)
    k.eave(0, 0.39, 0, 1.2, 0.62, 0.14, 0.14, 0.05, roof, 0.6)
    k.box(0, 0.53, 0, 0.85, 0.08, 0.4, M.lacquer)
    k.eave(0, 0.61, 0, 0.85, 0.4, 0.2, 0.12, 0.05, roof, 0.7)
  }
}

const pagoda: [string, Build][] = [
  ['torii', (k) => {
    // Fushimi Inari: a receding tunnel of lacquered torii, black kasagi beams, the shrine
    const gate = (z: number, s: number) => {
      for (const sx of [-1, 1]) k.prism(sx * 0.3 * s, 0, z, 0.035 * s, 0.03 * s, 0.6 * s, 6, M.lacquer, 0, false)
      k.box(0, 0.46 * s, z, 0.74 * s, 0.04 * s, 0.05 * s, M.lacquer)
      k.frustum4(0, 0.58 * s, z, 0.78 * s, 0.07 * s, 0.9 * s, 0.08 * s, 0.05 * s, M.dark)
      k.box(0, 0.54 * s, z, 0.84 * s, 0.04 * s, 0.06 * s, M.lacquer)
    }
    gate(0.45, 1.25)
    gate(0.05, 1.0)
    gate(-0.3, 0.9)
    gate(-0.6, 0.8)
    k.box(0, 0, -1.0, 0.7, 0.24, 0.4, M.lacquer)
    k.eave(0, 0.24, -1.0, 0.7, 0.4, 0.2, 0.1, 0.04, M.slate, 0.7)
  }],
  ['hall', hall(M.slate)],
  ['hall-gold', hall(M.gold)],
  ['prang', (k) => {
    // Wat Arun: tiered base, the porcelain corn-cob central prang, four satellite prangs
    k.frustum4(0, 0, 0, 1.3, 1.3, 1.15, 1.15, 0.08, M.stoneShade)
    k.frustum4(0, 0.08, 0, 0.8, 0.8, 0.66, 0.66, 0.12, M.chalk)
    k.lathe(0, 0.2, 0, [[0.24, 0], [0.22, 0.12], [0.17, 0.14], [0.15, 0.32], [0.11, 0.34], [0.09, 0.55], [0.04, 0.7], [0, 0.8]], 8, M.chalk)
    for (const [x, z] of [[-0.48, 0.48], [0.48, 0.48], [-0.48, -0.48], [0.48, -0.48]])
      k.lathe(x, 0.08, z, [[0.09, 0], [0.07, 0.15], [0.03, 0.28], [0, 0.34]], 6, M.chalk)
  }],
  ['whitetemple', (k) => {
    // Wat Rong Khun: white platform, layered steep gables with flame finials, front bridge
    k.box(0, 0, 0, 1.2, 0.08, 1.5, M.white)
    ramp(k, 0, 1.15, 0.75, 0.08, 0.26, M.white)
    k.box(0, 0.08, 0, 0.6, 0.28, 1.0, M.white)
    for (let i = 0; i < 3; i++) {
      const w = 0.78 - i * 0.18
      k.push(0, 0.33 + i * 0.12, 0, Math.PI / 2)
      k.gable(0, 0, 0, 1.0 - i * 0.2, 0.2, w, M.white)
      k.pop()
    }
    for (const [x, z, h] of [[0, 0.5, 0.75], [0, -0.5, 0.7], [0, 0.0, 0.85], [-0.3, 0.45, 0.48], [0.3, 0.45, 0.48], [-0.3, -0.45, 0.46], [0.3, -0.45, 0.46]])
      k.prism(x, 0.3, z, 0.03, 0, h - 0.3 + 0.12, 4, M.chalk)
  }],
  ['angkor', (k) => {
    // Angkor Wat: three galleried terraces and the quincunx of lotus-bud towers
    k.box(0, 0, 0.9, 0.18, 0.04, 0.8, M.stoneShade)
    k.frustum4(0, 0, 0, 2.0, 1.7, 1.9, 1.6, 0.1, M.rock)
    k.frustum4(0, 0.1, 0, 1.5, 1.3, 1.4, 1.2, 0.12, M.stoneShade)
    k.frustum4(0, 0.22, 0, 1.0, 0.9, 0.9, 0.8, 0.14, M.rock)
    const bud = (x: number, z: number, y: number, s: number) =>
      k.lathe(x, y, z, [[0.1 * s, 0], [0.11 * s, 0.14 * s], [0.08 * s, 0.28 * s], [0.03 * s, 0.4 * s], [0, 0.46 * s]], 6, M.stoneShade)
    for (const [x, z] of [[-0.38, 0.32], [0.38, 0.32], [-0.38, -0.32], [0.38, -0.32]]) bud(x, z, 0.36, 0.95)
    bud(0, 0, 0.36, 1.3)
  }],
  ['gopuram', (k) => {
    // Tirumala: temple wall and the stepped, sculpted tower with its barrel-vault crown
    k.box(0, 0, 0, 1.5, 0.16, 0.7, M.chalk)
    let w = 0.72, d = 0.42, y = 0.16
    for (let i = 0; i < 6; i++) {
      const h = 0.11
      k.frustum4(0, y, -0.05, w, d, w - 0.07, d - 0.03, h, i % 2 ? M.sandstone : M.chalk)
      y += h
      w -= 0.08
      d -= 0.035
    }
    k.lathe(0, y, -0.05, [[0.14, 0], [0.13, 0.06], [0.07, 0.11], [0, 0.12]], 8, M.gold, 0, true, 1.6, 0.8)
    for (const dx of [-0.12, 0, 0.12]) k.prism(dx, y + 0.08, -0.05, 0.02, 0, 0.08, 4, M.gold)
  }],
]

function ring(stone: string): Build {
  return (k) => {
    // Colosseum / El Jem: elliptical arcade of piers under a continuous band, the broken
    // lower front, inner tiers and the arena floor
    const n = 10, a = 0.95, b = 0.75
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2, tm = (t0 + t1) / 2
      const p = (t: number): V3 => [Math.sin(t) * a, 0, Math.cos(t) * b]
      const front = Math.cos(tm) > 0.35
      const top = front ? 0.5 : 0.72
      // pier at the segment start
      const ps = p(t0)
      k.push(ps[0], 0, ps[2], t0)
      k.box(0, 0, 0, 0.09, 0.36, 0.14, stone)
      k.pop()
      // band above the arches
      const A = p(t0), B = p(t1)
      beam(k, [A[0], (0.36 + top) / 2, A[2]], [B[0], (0.36 + top) / 2, B[2]], top - 0.36, 0.13, stone)
    }
    k.lathe(0, 0, 0, [[0.8, 0.36], [0.5, 0.06]], 12, M.stoneShade, 0, false, 1, b / a)
    k.lathe(0, 0, 0, [[0.5, 0], [0.5, 0.04]], 12, M.sandstone, 0, true, 1, b / a)
  }
}

const archArch: [string, Build][] = [
  ['ring', ring(M.limestone)],
  ['ring-sand', ring(M.sandstone)],
  ['theatre', (k) => {
    // Aspendos: the tall stage building (scaenae frons) with the half bowl of the cavea behind
    k.box(0, 0, 0.35, 1.7, 0.6, 0.16, M.ochre)
    for (const x of [-0.45, 0, 0.45]) k.box(x, 0, 0.435, 0.14, 0.24, 0.02, M.dark)
    for (const s of [-1, 1]) k.box(s * 0.92, 0, 0.32, 0.18, 0.66, 0.22, M.ochre)
    const n = 8
    for (let i = 0; i < n; i++) {
      const t0 = Math.PI / 2 + (i / n) * Math.PI, t1 = Math.PI / 2 + ((i + 1) / n) * Math.PI
      const R0 = 0.82, R1 = 0.3
      const P = (t: number, r: number, y: number): V3 => [Math.sin(t) * r, y, Math.cos(t) * r * 0.85 + 0.3]
      k.prim([P(t0, R1, 0.04), P(t1, R1, 0.04), P(t1, R0, 0.5), P(t0, R0, 0.5), P(t0, R0, 0), P(t1, R0, 0)],
        [[0, 1, 2], [0, 2, 3], [3, 2, 5], [3, 5, 4]], i % 2 ? M.sandstone : M.limestone)
      beam(k, P(t0, 0.88, 0.5), P(t1, 0.88, 0.5), 0.1, 0.1, M.ochre)
    }
  }],
  ['gate', (k) => {
    // Brandenburg Gate: twelve Doric columns, entablature, stepped attic, the bronze quadriga
    k.box(0, 0, 0, 1.4, 0.04, 0.42, M.stoneShade)
    for (let i = 0; i < 6; i++)
      for (const z of [0.14, -0.14]) k.prism(-0.6 + i * 0.24, 0.04, z, 0.045, 0.04, 0.48, 4, M.chalk, Math.PI / 4, false)
    k.box(0, 0.52, 0, 1.36, 0.1, 0.4, M.chalk)
    k.box(0, 0.62, 0, 0.62, 0.08, 0.3, M.chalk)
    k.box(0, 0.7, 0, 0.42, 0.04, 0.22, M.chalk)
    for (const x of [-0.12, -0.04, 0.04, 0.12]) {
      k.box(x, 0.74, 0.04, 0.05, 0.08, 0.16, M.verdigris)
      k.box(x, 0.8, 0.1, 0.04, 0.06, 0.05, M.verdigris)
    }
    k.box(0, 0.74, -0.05, 0.16, 0.06, 0.08, M.verdigris)
    k.lathe(0, 0.8, -0.06, [[0.03, 0], [0.02, 0.14], [0, 0.18]], 5, M.verdigris)
    beam(k, [0, 0.9, -0.06], [0.03, 1.0, -0.02], 0.01, 0.01, M.verdigris)
    for (const s of [-1, 1]) k.box(s * 0.88, 0.0, 0, 0.3, 0.34, 0.36, M.chalk)
  }],
]

const mountain: [string, Build][] = [
  ['peak', (k) => {
    // Mount Sinai: granite crags around the summit (chapel on top)
    crag(k, 0, 0, 0.9, 1.0, 7, 2, M.redstone, { rings: [0, 0.3, 0.62, 0.86], p: 1.1, jitter: 0.25 })
    crag(k, -0.62, 0.25, 0.5, 0.58, 6, 7, M.rock, { rings: [0, 0.5], jitter: 0.25 })
    crag(k, 0.6, 0.3, 0.42, 0.46, 6, 13, M.rockDark, { rings: [0, 0.5], jitter: 0.25 })
    k.box(0.04, 0.9, 0, 0.08, 0.06, 0.06, M.limestone)
  }],
  ['snowpeak', (k) => {
    // Everest with Lhotse and Nuptse: rock pyramids under snow
    crag(k, 0, -0.1, 0.85, 1.0, 6, 21, M.rockDark, { rings: [0, 0.32, 0.55, 0.8], p: 1.05, jitter: 0.2, snowHex: M.snow, snowFrom: 0.5, lean: [0.05, 0] })
    crag(k, 0.6, 0.15, 0.55, 0.78, 6, 22, M.rockDark, { rings: [0, 0.4, 0.7], jitter: 0.2, snowHex: M.snow, snowFrom: 0.4 })
    crag(k, -0.62, 0.2, 0.55, 0.62, 6, 23, M.rockDark, { rings: [0, 0.4, 0.7], jitter: 0.2, snowHex: M.snow, snowFrom: 0.4 })
  }],
  ...(['cone', 'snowcone'] as const).map((name): [string, Build] => [name, (k) => {
    // stratovolcano: concave cone with a summit crater (Fuji / El Misti wear snow)
    const snow = name === 'snowcone'
    const prof: [number, number][] = [[1.0, 0], [0.62, 0.28], [0.36, 0.58], [0.2, 0.86], [0.14, 0.96]]
    k.lathe(0, 0, 0, prof.slice(0, snow ? 3 : 5), 10, M.rockDark, 0, !snow)
    if (snow) k.lathe(0, 0, 0, prof.slice(2), 10, M.snow, 0, false)
    k.prism(0, 0.96, 0, 0.14, 0.08, -0.06, 10, snow ? M.snow : M.rockDark, 0, true)
  }]),
  ['vesuvius', (k) => {
    // Vesuvius: the broken Somma caldera wall, the inner cone, a thin plume
    k.lathe(0, 0, 0, [[1.1, 0], [0.75, 0.32], [0.55, 0.46], [0.5, 0.4]], 10, M.rockDark, 0, false)
    k.lathe(0.12, 0, -0.05, [[0.55, 0.3], [0.3, 0.68], [0.16, 0.8], [0.12, 0.76]], 9, M.rock, 0, true)
    const puff = (x: number, y: number, r: number) => k.lathe(x, y, -0.05, [[r * 0.6, 0], [r, r * 0.6], [r * 0.6, r * 1.2], [0, r * 1.4]], 6, M.smoke)
    puff(0.14, 0.78, 0.08)
    puff(0.2, 0.9, 0.1)
  }],
  ['crater', (k) => {
    // Diamond Head: tuff ring, the high seaward ridge, green crater floor
    const n = 10
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2
      const h = (t: number) => 0.32 + 0.38 * Math.max(0, Math.cos(t - 2.4)) ** 2
      const P = (t: number, r: number, y: number): V3 => [Math.sin(t) * r * 1.2, y, Math.cos(t) * r]
      k.prim(
        [P(t0, 1.0, 0), P(t1, 1.0, 0), P(t1, 0.72, h(t1)), P(t0, 0.72, h(t0)), P(t0, 0.5, 0.1), P(t1, 0.5, 0.1)],
        [[0, 1, 2], [0, 2, 3], [3, 2, 5], [3, 5, 4]],
        i % 2 ? M.rock : M.ochre,
      )
    }
    k.prism(0, 0, 0, 0.5, 0.5, 0.1, n, M.green, 0, true, )
  }],
  ['kili', (k) => {
    // Kilimanjaro: broad massif, flat snow-capped Kibo, jagged Mawenzi to the side
    k.lathe(0, 0, 0, [[1.3, 0], [0.9, 0.3], [0.55, 0.62]], 10, M.rockDark, 0, false)
    k.lathe(0, 0, 0, [[0.55, 0.62], [0.42, 0.74]], 10, M.snow, 0, true)
    crag(k, 0.8, 0.2, 0.32, 0.6, 6, 31, M.rockDark, { rings: [0, 0.45, 0.75], jitter: 0.3 })
  }],
]

function falls(k: Kit, pts: [number, number][], h: number, lipH: number) {
  // cliff segments along the lip polyline, water sheets falling in front of each
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1]
    beam(k, [x0, h / 2, z0 - 0.08], [x1, h / 2, z1 - 0.08], h, 0.16, M.rockDark)
    k.prim([[x0, h, z0], [x1, h, z1], [x1, 0.04, z1 + 0.1], [x0, 0.04, z0 + 0.1]], [[0, 1, 2], [0, 2, 3]], M.water)
    beam(k, [x0, h + lipH / 2, z0 - 0.2], [x1, h + lipH / 2, z1 - 0.2], lipH, 0.22, M.green)
  }
}

const waterfall: [string, Build][] = [
  ['horseshoe', (k) => {
    // Niagara's Horseshoe: the curved lip, the white sheet, the mist rising from the plunge pool
    const pts: [number, number][] = []
    for (let i = 0; i <= 6; i++) {
      const t = Math.PI * (0.15 + (0.7 * i) / 6)
      pts.push([-Math.cos(t) * 0.9, -Math.sin(t) * 0.5 + 0.35])
    }
    falls(k, pts, 0.42, 0.06)
    k.box(0, 0, 0.45, 2.0, 0.03, 0.5, M.waterDeep)
    k.lathe(0, 0.03, 0.15, [[0.3, 0], [0.34, 0.2], [0.2, 0.4], [0, 0.48]], 7, M.mist)
  }],
  ['cascades', (k) => {
    // Iguazu: two tiers of jungle-topped cliffs and a long row of falls
    falls(k, [[-1.2, -0.2], [-0.6, -0.3], [0, -0.22], [0.6, -0.32], [1.2, -0.2]], 0.5, 0.08)
    falls(k, [[-0.9, 0.3], [-0.3, 0.25], [0.3, 0.32]], 0.24, 0.06)
    k.box(0, 0, 0.6, 2.4, 0.03, 0.4, M.waterDeep)
    k.lathe(-0.2, 0.03, 0.0, [[0.25, 0], [0.3, 0.2], [0.16, 0.36], [0, 0.42]], 6, M.mist)
  }],
  ['chasm', (k) => {
    // Victoria Falls: a straight wall of water into the gorge, the 'smoke that thunders'
    falls(k, [[-1.2, -0.15], [-0.4, -0.12], [0.4, -0.16], [1.2, -0.13]], 0.36, 0.08)
    k.box(0, 0, 0.32, 2.4, 0.36, 0.3, M.rockDark)
    k.box(0, 0.36, 0.32, 2.4, 0.06, 0.3, M.green)
    k.lathe(0.2, 0.04, 0.05, [[0.2, 0], [0.32, 0.3], [0.26, 0.62], [0.12, 0.86], [0, 0.95]], 7, M.mist)
  }],
]

const canyon: [string, Build][] = [
  ['canyon', (k) => {
    // Grand Canyon: banded mesas either side of the gorge, buttes, the river far below
    const C = [M.redstone, M.ochre, M.sandstone, M.redstone]
    for (const s of [-1, 1]) {
      let w = 1.0
      for (let i = 0; i < 4; i++) {
        k.frustum4(s * (0.25 + w / 2), i * 0.12, 0, w, 1.2 - i * 0.04, w - 0.06, 1.16 - i * 0.04, 0.12, C[i])
        w -= 0.06
      }
    }
    for (const [x, z, h] of [[-0.1, 0.25, 0.32], [0.12, -0.25, 0.26]]) {
      k.frustum4(x, 0, z, 0.2, 0.2, 0.14, 0.14, h * 0.6, M.redstone)
      k.frustum4(x, h * 0.6, z, 0.14, 0.14, 0.08, 0.08, h * 0.4, M.ochre)
    }
    k.box(0, 0, 0, 0.5, 0.02, 1.2, M.waterDeep)
  }],
]

const rock: [string, Build][] = [
  ['mushroom', (k) => {
    // White Desert: chalk mushroom inselbergs on pale sand
    ;[[-0.4, 0.2, 1.0], [0.35, 0.3, 0.8], [0.05, -0.35, 0.9], [0.6, -0.2, 0.6]].forEach(([x, z, s], i) => {
      k.prism(x, 0.02, z, 0.09 * s, 0.06 * s, 0.4 * s, 5, M.chalk, i, false)
      k.lathe(x, 0.02 + 0.38 * s, z, [[0.06 * s, 0], [0.2 * s, 0.08 * s], [0.18 * s, 0.18 * s], [0, 0.24 * s]], 6, M.chalk)
    })
  }],
  ['mesa', (k) => {
    // Wadi Rum: steep red sandstone jebels with domed tops
    crag(k, -0.35, 0, 0.55, 0.85, 7, 41, M.redstone, { rings: [0, 0.55, 0.85], top: 0.32, p: 0.6, jitter: 0.12 })
    crag(k, 0.5, 0.15, 0.4, 0.6, 6, 42, M.ochre, { rings: [0, 0.6, 0.9], top: 0.22, p: 0.6, jitter: 0.12 })
  }],
  ['henge', (k) => {
    // Stonehenge: the sarsen circle with lintels and the inner trilithon horseshoe
    const n = 10, r = 0.7
    k.ringOf(n, r, 0, Math.PI * 2, (x, z, a, i) => {
      if (i === 7) return
      k.push(x, 0.02, z, a)
      k.box(0, 0, 0, 0.16, 0.36, 0.09, M.stoneShade)
      k.pop()
    })
    for (let i = 0; i < n; i += 2) {
      if (i === 6) continue
      const a0 = ((i + 0.5) / n) * Math.PI * 2, a1 = ((i + 1.5) / n) * Math.PI * 2
      beam(k, [Math.sin(a0) * r, 0.42, Math.cos(a0) * r], [Math.sin(a1) * r, 0.42, Math.cos(a1) * r], 0.06, 0.08, M.rock)
    }
    for (const [x, z] of [[-0.25, -0.15], [0.25, -0.15], [0, -0.32]]) {
      k.box(x - 0.07, 0.02, z, 0.09, 0.5, 0.08, M.stoneShade)
      k.box(x + 0.07, 0.02, z, 0.09, 0.5, 0.08, M.stoneShade)
      k.box(x, 0.52, z, 0.26, 0.06, 0.09, M.rock)
    }
  }],
  ['monolith', (k) => {
    // El Penon de Guatape: the granite dome with its zigzag stair seam, reservoir at its foot
    k.lathe(0, 0.02, 0, [[0.36, 0], [0.38, 0.38], [0.33, 0.72], [0.2, 0.92], [0, 0.98]], 8, M.steelGrey)
    for (let i = 0; i < 4; i++) beam(k, [0.06 * (i % 2 ? 1 : -1), 0.1 + i * 0.2, 0.39 - i * 0.012], [0.06 * (i % 2 ? -1 : 1), 0.3 + i * 0.2, 0.38 - i * 0.02], 0.03, 0.02, M.white)
  }],
  ['uluru', (k) => {
    // Uluru: the long red loaf with its fluted flanks
    k.lathe(0, 0.02, 0, [[0.45, 0], [0.45, 0.2], [0.38, 0.36], [0.22, 0.46], [0, 0.5]], 10, M.redstone, 0, true, 2.2, 1)
  }],
  ['reef', (k) => {
    // Great Barrier Reef: a turquoise shoal with coral heads and a sand cay
    k.prism(0, 0, 0, 1.0, 0.95, 0.03, 10, M.coral, 0.2, true)
    k.lathe(0.3, 0.03, -0.2, [[0.28, 0], [0.2, 0.05], [0, 0.07]], 7, M.sandstone, 0, true, 1.4, 0.8)
    ;[[-0.5, 0.2, 0.12], [-0.2, 0.45, 0.1], [0.2, 0.35, 0.14], [0.55, 0.1, 0.1], [-0.4, -0.35, 0.12], [0.0, 0.0, 0.16]].forEach(([x, z, r], i) =>
      k.lathe(x, 0.03, z, [[r, 0], [r * 0.9, r * 0.6], [r * 0.4, r * 1.1], [0, r * 1.2]], 6, i % 2 ? M.verdigris : M.bronze),
    )
  }],
  ['stacks', (k) => {
    // The Twelve Apostles: limestone stacks standing off the cliffed coast
    k.box(0, 0, -0.5, 2.4, 0.42, 0.4, M.ochre)
    k.box(0, 0.42, -0.5, 2.4, 0.04, 0.4, M.green)
    k.box(0, 0, 0.2, 2.4, 0.02, 1.0, M.waterDeep)
    ;[[-0.95, 0.1, 0.62], [-0.5, 0.35, 0.5], [-0.05, 0.05, 0.7], [0.45, 0.3, 0.55], [0.9, 0.0, 0.46]].forEach(([x, z, h], i) =>
      crag(k, x, z, 0.14, h, 6, 50 + i, M.ochre, { rings: [0, 0.7], top: 0.08, jitter: 0.18 }),
    )
  }],
]

export const ARCHETYPE_FORMS: Record<Archetype, [string, Build][]> = {
  pyramid,
  obelisk,
  'temple-columns': templeColumns,
  dome: domeArch,
  tower,
  'spire/cathedral': spire,
  bridge,
  statue,
  wall,
  'pagoda/torii': pagoda,
  arch: archArch,
  'mountain-peak': mountain,
  waterfall,
  canyon,
  rock,
}

export interface ArchetypeKit {
  geometry: THREE.BufferGeometry
  /** form name -> variant index */
  index: Map<string, number>
  forms: { name: string; tris: number; box: number[]; size: number }[]
}

/**
 * Size measure used for the on-screen clamp: the larger of the height and 0.7 x the
 * width (0.5 x the depth), so wide forms (bridges, walls) do not blow past 40 px.
 */
export function formSize(box: number[]): number {
  return Math.max(box[4], 0.7 * (box[3] - box[0]), 0.5 * (box[5] - box[2]))
}

const cache = new Map<Archetype, ArchetypeKit>()

export function buildArchetype(arch: Archetype): ArchetypeKit {
  const hit = cache.get(arch)
  if (hit) return hit
  const k = new Kit()
  const index = new Map<string, number>()
  for (const [name, fn] of ARCHETYPE_FORMS[arch]) {
    index.set(name, k.begin(name))
    fn(k)
  }
  const geometry = k.build()
  const forms = k.forms.map((f) => ({ name: f.name, tris: f.tris, box: [...f.box], size: formSize(f.box) }))
  const kit = { geometry, index, forms }
  cache.set(arch, kit)
  return kit
}
