/**
 * CPU quadtree selection for the cube-sphere patches (C2b, CDLOD-lite).
 * Node = (face, level, ix, iy) covering s,t in [-1,1] / 2^level. Selection runs in
 * the globe-local frame (unit sphere): the caller passes the camera position and the
 * frustum already transformed by the inverse inner-group matrix.
 *
 * Refinement is breadth-first so the patch budget is spent on the coarsest levels
 * first (never one face at max depth while another is missing):
 *   split when (nodeArc / distToCam) * focalPx > patchPx and level < maxLevel;
 *   cull by the horizon (cap centre angle - cap radius > horizon angle) and by the
 *   frustum (bounding sphere of the cap, padded for displacement).
 */
import { Frustum, Sphere, Vector3 } from 'three'
import { faceSTToDir } from '../geo/cubemap'

export interface QuadParams {
  /** camera position in the globe-local frame (globe radius = 1) */
  cam: Vector3
  /** frustum in the globe-local frame */
  frustum: Frustum
  /** px per unit tangent at distance 1 (viewport height / 2 / tan(fov/2)) */
  focalPx: number
  patchPx: number
  maxLevel: number
  maxNodes: number
  /** max displacement above radius 1 (radius units), for culling margins */
  maxLift: number
}

interface Node {
  face: number
  level: number
  ix: number
  iy: number
  c: Vector3 // centre direction
  rad: number // angular radius (rad)
}

const tmpA = new Vector3()
const sphere = new Sphere()
const pool: Node[] = []
let poolUsed = 0

function makeNode(face: number, level: number, ix: number, iy: number): Node {
  const n = pool[poolUsed] ?? (pool[poolUsed] = { face: 0, level: 0, ix: 0, iy: 0, c: new Vector3(), rad: 0 })
  poolUsed++
  n.face = face
  n.level = level
  n.ix = ix
  n.iy = iy
  const k = 2 / (1 << level)
  const s0 = -1 + ix * k
  const t0 = -1 + iy * k
  faceSTToDir(face, s0 + k / 2, t0 + k / 2, n.c)
  // angular radius: widest of the four corners (and edge midpoints at level 0, where the cap bulges)
  let minDot = 1
  for (let j = 0; j <= 2; j++) {
    for (let i = 0; i <= 2; i++) {
      if (i === 1 && j === 1) continue
      if (level > 0 && (i === 1 || j === 1)) continue
      faceSTToDir(face, s0 + (i * k) / 2, t0 + (j * k) / 2, tmpA)
      minDot = Math.min(minDot, tmpA.dot(n.c))
    }
  }
  n.rad = Math.acos(Math.min(1, minDot))
  return n
}

function visible(n: Node, p: QuadParams, camDir: Vector3, horizon: number): boolean {
  const ang = Math.acos(Math.max(-1, Math.min(1, n.c.dot(camDir))))
  if (ang - n.rad > horizon) return false
  // bounding sphere of the cap between radius cos(rad) (chord plane) and 1 + lift
  const chord = 2 * Math.sin(n.rad / 2)
  sphere.center.copy(n.c)
  sphere.radius = chord + p.maxLift + 0.002
  return p.frustum.intersectsSphere(sphere)
}

function wantsSplit(n: Node, p: QuadParams): boolean {
  if (n.level >= p.maxLevel) return false
  const dist = Math.max(1e-5, p.cam.distanceTo(n.c) - 2 * Math.sin(n.rad / 2))
  const arc = 2 * n.rad
  return (arc / dist) * p.focalPx > p.patchPx
}

/**
 * Fill `out` with (face, level, ix, iy) per selected node; returns the count.
 * `out` must hold maxNodes * 4 floats.
 */
export function selectNodes(p: QuadParams, out: Float32Array): number {
  poolUsed = 0
  const d = Math.max(p.cam.length(), 1.000001)
  const camDir = tmpCam.copy(p.cam).divideScalar(d)
  // horizon from the camera for the sphere plus the tallest displaced terrain beyond it
  const horizon = Math.acos(Math.min(1, 1 / d)) + Math.acos(1 / (1 + p.maxLift)) + 0.01

  let level: Node[] = []
  for (let f = 0; f < 6; f++) {
    const n = makeNode(f, 0, 0, 0)
    if (visible(n, p, camDir, horizon)) level.push(n)
  }
  const done: Node[] = []
  while (level.length) {
    const next: Node[] = []
    for (let i = 0; i < level.length; i++) {
      const n = level[i]
      // budget: every remaining node of this level emits at least one patch
      const committed = done.length + next.length + (level.length - i)
      if (wantsSplit(n, p) && committed + 3 <= p.maxNodes) {
        const before = next.length
        for (let cy = 0; cy < 2; cy++) {
          for (let cx = 0; cx < 2; cx++) {
            const c = makeNode(n.face, n.level + 1, n.ix * 2 + cx, n.iy * 2 + cy)
            if (visible(c, p, camDir, horizon)) next.push(c)
          }
        }
        if (next.length === before) continue // all four children culled
      } else {
        done.push(n)
      }
    }
    level = next
  }
  const count = Math.min(done.length, p.maxNodes)
  for (let i = 0; i < count; i++) {
    const n = done[i]
    out[i * 4] = n.face
    out[i * 4 + 1] = n.level
    out[i * 4 + 2] = n.ix
    out[i * 4 + 3] = n.iy
  }
  return count
}

const tmpCam = new Vector3()
