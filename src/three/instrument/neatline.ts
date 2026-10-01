/**
 * Neatline registration (I1): true ray/sphere crossings of the graticule with the
 * free-area edges, for the deep-zoom 'neatline' limb stage (T1c draws it).
 *
 * The rectangle is the free rect (anchors.instrumentLayout.free) inset 8 px. Each
 * edge is sampled at S points (16 on phones / low tier, else 48); every sample ray
 * is intersected with the globe sphere (surface radius 1, local frame), and
 * crossings of multiples of interval/5 (minors; majors are the multiples of
 * interval) are found by sign change of floor(coord/step), linearly interpolated,
 * with the antimeridian unwrapped.
 *
 * Packed output (globeState.anchors.neatline):
 *   edges          [edge, alongPx, lat, lon] × n. edge 0 top, 1 right, 2 bottom, 3 left.
 *                  alongPx is the absolute screen coordinate along the edge (x for
 *                  top/bottom, y for left/right), CSS px. The coordinate that crossed
 *                  carries its value; the other is NaN (meridian crossing: lat NaN;
 *                  parallel crossing: lon NaN).
 *   interval       major interval in degrees from {10, 5, 1, 0.5, 1/6, 1/60}, the
 *                  smallest whose majors are ≥ 48 px apart.
 *   horizonNotches [edge, alongPx] × n where the edge leaves the globe (sky starts).
 *
 * Runs only on camChanged frames (or when the stage changes) and only when
 * limbStage !== 'full'. Allocation-free after warm-up: one capacity buffer per
 * output plus a pool of subarray views keyed by count.
 */
import * as THREE from 'three'
import { globeState } from '../globeState'
import { EARTH_KM } from '../geo/radii'
import { instrumentLayout } from './anchors'

const INSET = 8
const MIN_MAJOR_PX = 48
const INTERVALS = [1 / 60, 1 / 6, 0.5, 1, 5, 10] as const
const MAX_PER_SEG = 8
const DEG = Math.PI / 180
const KM_PER_DEG = (EARTH_KM * Math.PI) / 180

const S_MAX = 48
const edgeBuf = new Float32Array(4 * S_MAX * MAX_PER_SEG * 2 * 4)
const notchBuf = new Float32Array(4 * S_MAX * 2)
const edgeViews = new Map<number, Float32Array>()
const notchViews = new Map<number, Float32Array>()

function view(pool: Map<number, Float32Array>, buf: Float32Array, len: number): Float32Array {
  let v = pool.get(len)
  if (!v) {
    v = buf.subarray(0, len)
    pool.set(len, v)
  }
  return v
}

const _o = new THREE.Vector3()
const _d = new THREE.Vector3()
const _c = new THREE.Vector3()
const _oc = new THREE.Vector3()
const _p = new THREE.Vector3()

// per-edge sample scratch
const sHit = new Uint8Array(S_MAX + 1)
const sDisc = new Float32Array(S_MAX + 1)
const sLat = new Float32Array(S_MAX + 1)
const sLon = new Float32Array(S_MAX + 1)
const sAlong = new Float32Array(S_MAX + 1)

let lastStage = ''
let nEdge = 0
let nNotch = 0

/** Ray through CSS px (x, y) against the sphere; writes lat/lon (deg) and returns the discriminant (< 0 = sky). */
function cast(
  x: number,
  y: number,
  camera: THREE.Camera,
  inner: THREE.Object3D,
  w: number,
  h: number,
  Rw: number,
  i: number,
): void {
  _d.set((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5).unproject(camera).sub(_o).normalize()
  _oc.copy(_o).sub(_c)
  const b = _d.dot(_oc)
  const cc = _oc.lengthSq() - Rw * Rw
  const disc = b * b - cc
  sDisc[i] = disc / (Rw * Rw)
  if (disc < 0 || -b - Math.sqrt(disc) < 0) {
    sHit[i] = 0
    return
  }
  const t = -b - Math.sqrt(disc)
  _p.copy(_d).multiplyScalar(t).add(_o)
  inner.worldToLocal(_p).normalize()
  sHit[i] = 1
  sLat[i] = Math.asin(Math.max(-1, Math.min(1, _p.y))) / DEG
  sLon[i] = Math.atan2(-_p.z, _p.x) / DEG
}

function pushCrossings(edge: number, v0: number, v1: number, a0: number, a1: number, step: number, isLon: boolean) {
  const k0 = Math.floor(v0 / step)
  const k1 = Math.floor(v1 / step)
  if (k0 === k1) return
  const lo = Math.min(k0, k1) + 1
  const hi = Math.min(Math.max(k0, k1), lo + MAX_PER_SEG - 1)
  for (let k = lo; k <= hi; k++) {
    if (nEdge * 4 + 4 > edgeBuf.length) return
    const val = k * step
    const f = (val - v0) / (v1 - v0)
    const o = nEdge * 4
    edgeBuf[o] = edge
    edgeBuf[o + 1] = a0 + (a1 - a0) * f
    if (isLon) {
      edgeBuf[o + 2] = NaN
      let lon = val
      while (lon > 180) lon -= 360
      while (lon <= -180) lon += 360
      edgeBuf[o + 3] = lon
    } else {
      edgeBuf[o + 2] = val
      edgeBuf[o + 3] = NaN
    }
    nEdge++
  }
}

export function updateNeatline(camera: THREE.Camera, outer: THREE.Object3D, inner: THREE.Object3D): void {
  const g = globeState
  const a = g.anchors
  const stageChanged = a.limbStage !== lastStage
  lastStage = a.limbStage
  if (a.limbStage === 'full') {
    if (stageChanged || a.neatline.edges.length) {
      nEdge = 0
      nNotch = 0
      a.neatline.edges = view(edgeViews, edgeBuf, 0)
      a.neatline.horizonNotches = view(notchViews, notchBuf, 0)
    }
    return
  }
  if (!a.camChanged && !stageChanged) return

  const { w, h } = g.viewport
  const F = instrumentLayout.free
  const x0 = F.x0 + INSET
  const x1 = F.x1 - INSET
  const y0 = F.y0 + INSET
  const y1 = F.y1 - INSET
  const S = instrumentLayout.mobile || g.tier === 'low' ? 16 : S_MAX

  // interval: smallest whose majors are ≥ 48 px apart (meridians shrink by cos φc)
  const pxPerDeg = g.lod.pxPerKm * KM_PER_DEG
  const cosPhi = Math.max(0.17, Math.cos(a.phiC * DEG))
  let interval = 10
  for (let i = 0; i < INTERVALS.length; i++) {
    if (INTERVALS[i] * pxPerDeg * cosPhi >= MIN_MAJOR_PX) {
      interval = INTERVALS[i]
      break
    }
  }
  a.neatline.interval = interval
  const step = interval / 5

  camera.getWorldPosition(_o)
  outer.getWorldPosition(_c)
  const Rw = outer.scale.x
  nEdge = 0
  nNotch = 0
  for (let edge = 0; edge < 4; edge++) {
    for (let i = 0; i <= S; i++) {
      const f = i / S
      let x: number
      let y: number
      if (edge === 0) {
        x = x0 + (x1 - x0) * f
        y = y0
      } else if (edge === 1) {
        x = x1
        y = y0 + (y1 - y0) * f
      } else if (edge === 2) {
        x = x0 + (x1 - x0) * f
        y = y1
      } else {
        x = x0
        y = y0 + (y1 - y0) * f
      }
      sAlong[i] = edge === 0 || edge === 2 ? x : y
      cast(x, y, camera, inner, w, h, Rw, i)
    }
    for (let i = 0; i < S; i++) {
      const h0 = sHit[i]
      const h1 = sHit[i + 1]
      if (h0 !== h1) {
        // horizon: interpolate the discriminant's zero
        const d0 = sDisc[i]
        const d1 = sDisc[i + 1]
        const t = d0 !== d1 ? Math.min(1, Math.max(0, d0 / (d0 - d1))) : 0.5
        if (nNotch * 2 + 2 <= notchBuf.length) {
          notchBuf[nNotch * 2] = edge
          notchBuf[nNotch * 2 + 1] = sAlong[i] + (sAlong[i + 1] - sAlong[i]) * t
          nNotch++
        }
        continue
      }
      if (!h0) continue
      let l0 = sLon[i]
      let l1 = sLon[i + 1]
      if (l1 - l0 > 180) l1 -= 360
      else if (l0 - l1 > 180) l1 += 360
      // keep minors that are lon multiples relative to the unwrapped frame
      if (l0 < -180 || l1 < -180) {
        l0 += 360
        l1 += 360
      }
      pushCrossings(edge, l0, l1, sAlong[i], sAlong[i + 1], step, true)
      pushCrossings(edge, sLat[i], sLat[i + 1], sAlong[i], sAlong[i + 1], step, false)
    }
  }
  a.neatline.edges = view(edgeViews, edgeBuf, nEdge * 4)
  a.neatline.horizonNotches = view(notchViews, notchBuf, nNotch * 2)
}
