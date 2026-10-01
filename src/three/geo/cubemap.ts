/**
 * THE GL cube-face table (R6). The only copy in TS; scripts/terrain/lib/cube.py is
 * its numpy twin and scripts/terrain/check_cube_parity.mjs keeps them identical.
 *
 * Face order: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z (suffixes px nx py ny pz nz).
 * Texel centres: s = 2*(col+.5)/N - 1 (left→right), t = 2*(row+.5)/N - 1 (top→bottom).
 *   +X (1,-t,-s)   -X (-1,-t,s)   +Y (s,1,t)   -Y (s,-1,-t)   +Z (s,-t,1)   -Z (-s,-t,-1)
 * Globe frame: lat = asin(y), lon = atan2(-z, x), the exact inverse of
 * globeMath.latLonToVec3 (x = cos lat cos lon, y = sin lat, z = -cos lat sin lon):
 * lon 0 → +X, lon 90°E → -Z, north pole → +Y.
 * Faces are stored row 0 = top and uploaded with flipY = false (R5).
 *
 * Runs under `node --experimental-strip-types`: keep imports explicit (.ts) and type-only where possible.
 */
import { Vector3 } from 'three'

export const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const
export type FaceName = (typeof FACES)[number]

const DEG = Math.PI / 180

/** Direction (unit) through the centre of texel (col,row) on face `face` of an N×N cube. */
export function faceTexelToDir(face: number, col: number, row: number, n: number, out = new Vector3()): Vector3 {
  const s = (2 * (col + 0.5)) / n - 1
  const t = (2 * (row + 0.5)) / n - 1
  return faceSTToDir(face, s, t, out)
}

/** Direction (unit) for face coordinates s,t in [-1,1] (may extend beyond for padding). */
export function faceSTToDir(face: number, s: number, t: number, out = new Vector3()): Vector3 {
  switch (face) {
    case 0: out.set(1, -t, -s); break
    case 1: out.set(-1, -t, s); break
    case 2: out.set(s, 1, t); break
    case 3: out.set(s, -1, -t); break
    case 4: out.set(s, -t, 1); break
    case 5: out.set(-s, -t, -1); break
    default: throw new Error(`bad cube face ${face}`)
  }
  return out.normalize()
}

/**
 * Face and s,t in [-1,1] for a direction (need not be unit). Major axis picks the
 * face; ties go X, then Y, then Z.
 */
export function dirToFaceUV(dir: Vector3): { face: number; s: number; t: number } {
  const { x, y, z } = dir
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  if (ax >= ay && ax >= az) {
    return x >= 0 ? { face: 0, s: -z / ax, t: -y / ax } : { face: 1, s: z / ax, t: -y / ax }
  }
  if (ay >= az) {
    return y >= 0 ? { face: 2, s: x / ay, t: z / ay } : { face: 3, s: x / ay, t: -z / ay }
  }
  return z >= 0 ? { face: 4, s: x / az, t: -y / az } : { face: 5, s: -x / az, t: -y / az }
}

/** lat = asin(y), lon = atan2(-z, x), in degrees. `dir` need not be unit. */
export function dirToLatLon(dir: Vector3): { lat: number; lon: number } {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1
  const y = Math.min(1, Math.max(-1, dir.y / len))
  return { lat: Math.asin(y) / DEG, lon: Math.atan2(-dir.z, dir.x) / DEG }
}

/** Unit direction for lat/lon in degrees; equals globeMath.latLonToVec3(lat, lon, 1). */
export function latLonToDir(lat: number, lon: number, out = new Vector3()): Vector3 {
  const la = lat * DEG
  const lo = lon * DEG
  const c = Math.cos(la)
  return out.set(c * Math.cos(lo), Math.sin(la), -c * Math.sin(lo))
}
