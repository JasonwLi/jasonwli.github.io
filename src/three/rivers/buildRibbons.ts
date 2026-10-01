/**
 * River ribbon geometry (C6). Pure and dependency-free: runs inside ribbon.worker.ts
 * and in node checks.
 *
 * Per polyline (rivers.json: [lon, lat, ...], longitudes may be unwrapped):
 *  1. lon/lat -> unit vectors (globe frame x = cos φ cos λ, y = sin φ, z = -cos φ sin λ).
 *     Working on the sphere makes the antimeridian a non-event (unwrapped or not).
 *  2. Chaikin corner cutting, 2 passes, in 3D (end points kept), renormalised.
 *  3. Uniform resampling by arc length (spacing per rank; scaled up when the vertex
 *     budget would be exceeded), so the vertex-shader terrain lift follows the relief.
 *  4. A triangle strip as an indexed list: two vertices per sample (side -1 / +1) with
 *     the same centre direction and a tangent-plane offset direction = the averaged
 *     segment normal, mitred (1 / cos of the half angle, limited to 2).
 *
 * Output (all Float32 except the index): dir xyz, off xyz (unit normal x mitre), meta
 * (side, rank). Rank widths and fades live in the shader (RiverRibbons).
 */

export interface RiverIn {
  n: string
  r: number
  p: number[]
}

export interface RibbonBuild {
  dir: Float32Array
  off: Float32Array
  meta: Float32Array
  index: Uint32Array
  stats: {
    rivers: number
    vertices: number
    triangles: number
    spacingKm: [number, number]
    lengthKm: number
    perRank: Record<number, number>
    ms: number
  }
}

export interface RibbonOptions {
  maxRank: number
  /** resample spacing km for ranks <= 5 and for ranks 6+ */
  spacingKm: [number, number]
  /** hard vertex budget (spacing grows to fit) */
  maxVertices: number
  chaikin: number
}

export const RIBBON_DEFAULTS: RibbonOptions = { maxRank: 8, spacingKm: [2.5, 3.5], maxVertices: 400_000, chaikin: 2 }

const R_KM = 6371
const DEG = Math.PI / 180

function toDirs(p: number[]): Float64Array {
  const n = p.length >> 1
  const out = new Float64Array(n * 3)
  let k = 0
  let px = 2
  let py = 2
  let pz = 2
  for (let i = 0; i < n; i++) {
    const lo = p[2 * i] * DEG
    const la = p[2 * i + 1] * DEG
    const c = Math.cos(la)
    const x = c * Math.cos(lo)
    const y = Math.sin(la)
    const z = -c * Math.sin(lo)
    // drop exact repeats (zero-length segments break the normals)
    if (Math.abs(x - px) + Math.abs(y - py) + Math.abs(z - pz) < 1e-9) continue
    out[k++] = x
    out[k++] = y
    out[k++] = z
    px = x
    py = y
    pz = z
  }
  return out.subarray(0, k)
}

function chaikin(src: Float64Array): Float64Array {
  const n = src.length / 3
  if (n < 3) return src
  const out = new Float64Array((2 * (n - 1)) * 3)
  let k = 0
  out[k++] = src[0]
  out[k++] = src[1]
  out[k++] = src[2]
  for (let i = 0; i < n - 1; i++) {
    const a = i * 3
    const b = a + 3
    if (i > 0) {
      out[k++] = 0.75 * src[a] + 0.25 * src[b]
      out[k++] = 0.75 * src[a + 1] + 0.25 * src[b + 1]
      out[k++] = 0.75 * src[a + 2] + 0.25 * src[b + 2]
    }
    if (i < n - 2) {
      out[k++] = 0.25 * src[a] + 0.75 * src[b]
      out[k++] = 0.25 * src[a + 1] + 0.75 * src[b + 1]
      out[k++] = 0.25 * src[a + 2] + 0.75 * src[b + 2]
    }
  }
  const e = (n - 1) * 3
  out[k++] = src[e]
  out[k++] = src[e + 1]
  out[k++] = src[e + 2]
  const r = out.subarray(0, k)
  for (let i = 0; i < r.length; i += 3) {
    const l = Math.hypot(r[i], r[i + 1], r[i + 2])
    r[i] /= l
    r[i + 1] /= l
    r[i + 2] /= l
  }
  return r
}

function arcLen(d: Float64Array): number {
  let L = 0
  for (let i = 3; i < d.length; i += 3) {
    const dot = d[i - 3] * d[i] + d[i - 2] * d[i + 1] + d[i - 1] * d[i + 2]
    L += Math.acos(Math.min(1, Math.max(-1, dot)))
  }
  return L
}

/** Uniform arc-length resampling (chord interpolation + renormalise; segments are a few km). */
function resample(d: Float64Array, step: number): Float64Array {
  const n = d.length / 3
  if (n < 2) return d
  const L = arcLen(d)
  const m = Math.max(1, Math.round(L / step))
  const out = new Float64Array((m + 1) * 3)
  let seg = 0
  let segStart = 0
  let segLen = Math.acos(Math.min(1, Math.max(-1, d[0] * d[3] + d[1] * d[4] + d[2] * d[5])))
  for (let k = 0; k <= m; k++) {
    const s = (k / m) * L
    while (seg < n - 2 && s > segStart + segLen) {
      segStart += segLen
      seg++
      const a = seg * 3
      segLen = Math.acos(Math.min(1, Math.max(-1, d[a] * d[a + 3] + d[a + 1] * d[a + 4] + d[a + 2] * d[a + 5])))
    }
    const t = segLen > 0 ? Math.min(1, Math.max(0, (s - segStart) / segLen)) : 0
    const a = seg * 3
    let x = d[a] + (d[a + 3] - d[a]) * t
    let y = d[a + 1] + (d[a + 4] - d[a + 1]) * t
    let z = d[a + 2] + (d[a + 5] - d[a + 2]) * t
    const l = Math.hypot(x, y, z)
    x /= l
    y /= l
    z /= l
    out[k * 3] = x
    out[k * 3 + 1] = y
    out[k * 3 + 2] = z
  }
  return out
}

/** unit normal of segment a->b in the tangent plane at its midpoint (cross(mid, b - a)) */
function segNormal(d: Float64Array, i: number, out: number[]): boolean {
  const a = i * 3
  const b = a + 3
  const mx = d[a] + d[b]
  const my = d[a + 1] + d[b + 1]
  const mz = d[a + 2] + d[b + 2]
  const tx = d[b] - d[a]
  const ty = d[b + 1] - d[a + 1]
  const tz = d[b + 2] - d[a + 2]
  const nx = my * tz - mz * ty
  const ny = mz * tx - mx * tz
  const nz = mx * ty - my * tx
  const l = Math.hypot(nx, ny, nz)
  if (l < 1e-15) return false
  out[0] = nx / l
  out[1] = ny / l
  out[2] = nz / l
  return true
}

export function buildRibbons(rivers: RiverIn[], opts: Partial<RibbonOptions> = {}): RibbonBuild {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const o = { ...RIBBON_DEFAULTS, ...opts }
  // pass 1: smooth every line, measure length per rank class
  const lines: { d: Float64Array; r: number }[] = []
  let lenLo = 0
  let lenHi = 0
  for (const rv of rivers) {
    if (!(rv.r <= o.maxRank) || !rv.p || rv.p.length < 4) continue
    let d = toDirs(rv.p)
    if (d.length < 6) continue
    for (let k = 0; k < o.chaikin; k++) d = chaikin(d)
    const L = arcLen(d) * R_KM
    if (rv.r <= 5) lenLo += L
    else lenHi += L
    lines.push({ d, r: rv.r })
  }
  // spacing: grow both classes together until the strip fits the vertex budget
  let [sLo, sHi] = o.spacingKm
  const estimate = (a: number, b: number) => 2 * (lenLo / a + lenHi / b + lines.length * 2)
  while (estimate(sLo, sHi) > o.maxVertices) {
    sLo *= 1.08
    sHi *= 1.08
  }
  // pass 2: resample + emit
  const samples: Float64Array[] = []
  let nv = 0
  let nt = 0
  let lengthKm = 0
  const perRank: Record<number, number> = {}
  for (const l of lines) {
    const step = (l.r <= 5 ? sLo : sHi) / R_KM
    const s = resample(l.d, step)
    samples.push(s)
    const n = s.length / 3
    nv += 2 * n
    nt += 2 * (n - 1)
    lengthKm += arcLen(s) * R_KM
    perRank[l.r] = (perRank[l.r] ?? 0) + 2 * n
  }
  const dir = new Float32Array(nv * 3)
  const off = new Float32Array(nv * 3)
  const meta = new Float32Array(nv * 2)
  const index = new Uint32Array(nt * 3)
  let v = 0
  let ii = 0
  const nPrev = [0, 0, 0]
  const nNext = [0, 0, 0]
  for (let li = 0; li < lines.length; li++) {
    const s = samples[li]
    const rank = lines[li].r
    const n = s.length / 3
    let havePrev = false
    for (let i = 0; i < n; i++) {
      const hasNext = i < n - 1 && segNormal(s, i, nNext)
      let mx: number
      let my: number
      let mz: number
      let scale = 1
      if (havePrev && hasNext) {
        mx = nPrev[0] + nNext[0]
        my = nPrev[1] + nNext[1]
        mz = nPrev[2] + nNext[2]
        let l = Math.hypot(mx, my, mz)
        if (l < 1e-9) {
          // a full reversal: fall back to the incoming normal
          mx = nPrev[0]
          my = nPrev[1]
          mz = nPrev[2]
          l = 1
        }
        mx /= l
        my /= l
        mz /= l
        const c = mx * nNext[0] + my * nNext[1] + mz * nNext[2]
        scale = Math.min(2, 1 / Math.max(c, 0.5))
      } else if (hasNext) {
        mx = nNext[0]
        my = nNext[1]
        mz = nNext[2]
      } else {
        mx = nPrev[0]
        my = nPrev[1]
        mz = nPrev[2]
      }
      // project onto the tangent plane at the sample
      const px = s[i * 3]
      const py = s[i * 3 + 1]
      const pz = s[i * 3 + 2]
      const dp = mx * px + my * py + mz * pz
      mx -= dp * px
      my -= dp * py
      mz -= dp * pz
      const lm = Math.hypot(mx, my, mz) || 1
      mx = (mx / lm) * scale
      my = (my / lm) * scale
      mz = (mz / lm) * scale
      for (let side = -1; side <= 1; side += 2) {
        dir[v * 3] = px
        dir[v * 3 + 1] = py
        dir[v * 3 + 2] = pz
        off[v * 3] = mx
        off[v * 3 + 1] = my
        off[v * 3 + 2] = mz
        meta[v * 2] = side
        meta[v * 2 + 1] = rank
        v++
      }
      if (i > 0) {
        const a0 = v - 4
        const a1 = v - 3
        const b0 = v - 2
        const b1 = v - 1
        index[ii++] = a0
        index[ii++] = a1
        index[ii++] = b0
        index[ii++] = a1
        index[ii++] = b1
        index[ii++] = b0
      }
      if (hasNext) {
        nPrev[0] = nNext[0]
        nPrev[1] = nNext[1]
        nPrev[2] = nNext[2]
        havePrev = true
      }
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    dir,
    off,
    meta,
    index,
    stats: {
      rivers: lines.length,
      vertices: nv,
      triangles: nt,
      spacingKm: [+sLo.toFixed(2), +sHi.toFixed(2)],
      lengthKm: Math.round(lengthKm),
      perRank,
      ms: Math.round(t1 - t0),
    },
  }
}
