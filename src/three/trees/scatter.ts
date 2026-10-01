/**
 * World-anchored tree scatter (C6). Pure; runs in scatter.worker.ts.
 *
 * Stability is the point: every candidate tree is a fixed point on the globe, so
 * re-scattering (a moved view, a new zoom band) never moves, reshuffles or re-colours
 * a tree that is already on screen.
 *  - A fixed reduced lat/lon grid of ~cellKm cells (rows of constant latitude, each row
 *    holding round(2πR cosφ / cellKm) cells) covers the sphere. Cell (row, col) owns one
 *    candidate with hashed jitter, rank u, species pick, yaw, size and value jitter.
 *  - Density (D3 trees equirect: R conifer, G broadleaf, B palm = tropical rainforest;
 *    bilinear) turns u into
 *    a threshold t = u / density. A tree shows when the global level τ >= t; τ follows the
 *    zoom continuously in the shader (smaller τ when zoomed out = sparser), so zooming
 *    grows/shrinks individual trees in place instead of re-dealing them.
 *  - Meshes: 0 conifer, 1 broadleaf (+ 75% of the jungle as broad canopy trees), 2 palm.
 *  - The worker returns every candidate inside the region cap with t <= tauHi (the zoom
 *    headroom), keeping the lowest thresholds when the budget is hit; tauEff is then the
 *    level actually covered, and the shader never asks for more.
 */

export interface DensityField {
  w: number
  h: number
  /** RGBA bytes, row 0 = north, cell centres */
  data: Uint8Array
}

export interface ScatterRequest {
  id: number
  /** region cap centre (unit vector, globe frame) and angular radius (rad) */
  centre: [number, number, number]
  radius: number
  /** highest τ the result must cover (zoom-in headroom) */
  tauHi: number
  budget: number
  cellKm: number
}

export interface SpeciesBuffers {
  /** per instance: dir.xyz, w = grass tint 0..1 or JUNGLE_FLAG (broadleaf mesh) */
  a: Float32Array
  /** per instance: yaw, size jitter, threshold t, value jitter */
  b: Float32Array
  count: number
}

export interface ScatterResult {
  id: number
  centre: [number, number, number]
  radius: number
  tauHi: number
  tauEff: number
  species: [SpeciesBuffers, SpeciesBuffers, SpeciesBuffers]
  stats: { cells: number; candidates: number; kept: number; cut: boolean; ms: number }
}

/** share of jungle (B channel) trees drawn as palms; the rest are broad canopy trees */
export const PALM_SHARE = 0.25
/** a.w value marking a jungle canopy tree on the broadleaf mesh */
export const JUNGLE_FLAG = 2

const R_KM = 6371
const TWO_PI = Math.PI * 2

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}
const INV32 = 1 / 4294967296
function rnd(h: number, k: number): number {
  return hash(h, k) * INV32
}

/** bilinear density channels (0..1) at lat/lon degrees; returns the sum and writes r,g,b */
function sampleDensity(f: DensityField, lat: number, lon: number, out: Float64Array): number {
  const { w, h, data } = f
  const x = ((((lon + 180) / 360) * w - 0.5) % w + w) % w
  const y = Math.min(h - 1, Math.max(0, ((90 - lat) / 180) * h - 0.5))
  const i0 = Math.floor(x)
  const j0 = Math.floor(y)
  const i1 = i0 + 1 === w ? 0 : i0 + 1
  const j1 = Math.min(h - 1, j0 + 1)
  const fx = x - i0
  const fy = y - j0
  const w00 = (1 - fx) * (1 - fy)
  const w10 = fx * (1 - fy)
  const w01 = (1 - fx) * fy
  const w11 = fx * fy
  const a = (j0 * w + i0) * 4
  const b = (j0 * w + i1) * 4
  const c = (j1 * w + i0) * 4
  const d = (j1 * w + i1) * 4
  for (let k = 0; k < 3; k++) out[k] = (data[a + k] * w00 + data[b + k] * w10 + data[c + k] * w01 + data[d + k] * w11) / 255
  return out[0] + out[1] + out[2]
}

class Pool {
  sp: Uint8Array
  f: Float32Array
  n = 0
  constructor(cap: number) {
    this.sp = new Uint8Array(cap)
    this.f = new Float32Array(cap * 8)
  }
  push(sp: number, x: number, y: number, z: number, grass: number, yaw: number, size: number, t: number, val: number) {
    if (this.n === this.sp.length) {
      const sp2 = new Uint8Array(this.sp.length * 2)
      sp2.set(this.sp)
      const f2 = new Float32Array(this.f.length * 2)
      f2.set(this.f)
      this.sp = sp2
      this.f = f2
    }
    const o = this.n * 8
    this.sp[this.n] = sp
    this.f[o] = x
    this.f[o + 1] = y
    this.f[o + 2] = z
    this.f[o + 3] = grass
    this.f[o + 4] = yaw
    this.f[o + 5] = size
    this.f[o + 6] = t
    this.f[o + 7] = val
    this.n++
  }
}

export function scatterTrees(field: DensityField, req: ScatterRequest, valueJitter = 0.06): ScatterResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const [cx, cy, cz] = req.centre
  const phiC = Math.asin(Math.max(-1, Math.min(1, cy)))
  const lamC = Math.atan2(-cz, cx)
  const r = Math.min(req.radius, Math.PI)
  const cosR = Math.cos(r)
  const nRows = Math.max(1, Math.round((Math.PI * R_KM) / req.cellKm))
  const dLat = Math.PI / nRows
  const j0 = Math.max(0, Math.floor((phiC - r + Math.PI / 2) / dLat) - 1)
  const j1 = Math.min(nRows - 1, Math.ceil((phiC + r + Math.PI / 2) / dLat) + 1)
  const sinC = Math.sin(phiC)
  const cosC = Math.cos(phiC)
  const tauHi = req.tauHi
  const pool = new Pool(Math.max(1024, req.budget))
  const dens = new Float64Array(3)
  let cells = 0
  for (let j = j0; j <= j1; j++) {
    const phi = -Math.PI / 2 + (j + 0.5) * dLat
    const cphi = Math.cos(phi)
    const n = Math.max(1, Math.floor((TWO_PI * R_KM * cphi) / req.cellKm))
    const cellAng = TWO_PI / n
    let k0: number
    let k1: number
    const den = cphi * cosC
    const cosD = den > 1e-9 ? (Math.cos(Math.min(Math.PI, r + dLat)) - Math.sin(phi) * sinC) / den : -2
    if (cosD <= -1) {
      k0 = 0
      k1 = n - 1
    } else if (cosD > 1) {
      continue
    } else {
      const D = Math.acos(cosD) + cellAng
      k0 = Math.floor(((lamC - D + Math.PI) / TWO_PI) * n)
      k1 = Math.floor(((lamC + D + Math.PI) / TWO_PI) * n)
      if (k1 - k0 + 1 >= n) {
        k0 = 0
        k1 = n - 1
      }
    }
    const rowSeed = hash(j, 0x51ed27)
    for (let k = k0; k <= k1; k++) {
      const i = ((k % n) + n) % n
      cells++
      const h = hash(rowSeed, i)
      const u = rnd(h, 1)
      if (u > tauHi) continue // density <= 1, so t >= u
      const la = phi + (rnd(h, 2) - 0.5) * dLat * 0.92
      const lo = -Math.PI + (i + 0.04 + 0.92 * rnd(h, 3)) * cellAng
      const cl = Math.cos(la)
      const x = cl * Math.cos(lo)
      const y = Math.sin(la)
      const z = -cl * Math.sin(lo)
      if (x * cx + y * cy + z * cz < cosR) continue
      const sum = Math.min(1, sampleDensity(field, (la * 180) / Math.PI, (lo * 180) / Math.PI, dens))
      if (sum < 0.02) continue
      const t = u / sum
      if (t > tauHi) continue
      const pick = rnd(h, 4) * (dens[0] + dens[1] + dens[2])
      const kind = pick < dens[0] ? 0 : pick < dens[0] + dens[1] ? 1 : 2
      // mesh: 0 conifer, 1 broadleaf (+ jungle canopy trees), 2 palm (a quarter of the jungle)
      const sp = kind === 2 ? (rnd(h, 8) < PALM_SHARE ? 2 : 1) : kind
      // a.w on the broadleaf mesh: 0..1 grass tint (sparse cover: woody savanna, forest
      // edges), JUNGLE_FLAG (2) = a jungle canopy tree (jungle colour, broader crown)
      const grass = kind === 1 ? 1 - Math.min(1, Math.max(0, (sum - 0.2) / 0.35)) : kind === 2 && sp === 1 ? JUNGLE_FLAG : 0
      pool.push(sp, x, y, z, grass, rnd(h, 5) * TWO_PI, 0.8 + 0.4 * rnd(h, 6), t, (rnd(h, 7) * 2 - 1) * valueJitter)
    }
  }
  // budget: keep the lowest thresholds
  let tauEff = tauHi
  let cut = false
  if (pool.n > req.budget) {
    const ts = new Float32Array(pool.n)
    for (let q = 0; q < pool.n; q++) ts[q] = pool.f[q * 8 + 6]
    ts.sort()
    tauEff = ts[req.budget] * 0.9999
    cut = true
  }
  const counts = [0, 0, 0]
  for (let q = 0; q < pool.n; q++) if (pool.f[q * 8 + 6] <= tauEff) counts[pool.sp[q]]++
  const species = counts.map((c) => ({ a: new Float32Array(c * 4), b: new Float32Array(c * 4), count: 0 })) as ScatterResult['species']
  for (let q = 0; q < pool.n; q++) {
    const o = q * 8
    if (pool.f[o + 6] > tauEff) continue
    const s = species[pool.sp[q]]
    const p = s.count * 4
    s.a[p] = pool.f[o]
    s.a[p + 1] = pool.f[o + 1]
    s.a[p + 2] = pool.f[o + 2]
    s.a[p + 3] = pool.f[o + 3]
    s.b[p] = pool.f[o + 4]
    s.b[p + 1] = pool.f[o + 5]
    s.b[p + 2] = pool.f[o + 6]
    s.b[p + 3] = pool.f[o + 7]
    s.count++
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    id: req.id,
    centre: req.centre,
    radius: req.radius,
    tauHi,
    tauEff,
    species,
    stats: { cells, candidates: pool.n, kept: counts[0] + counts[1] + counts[2], cut, ms: Math.round(t1 - t0) },
  }
}
