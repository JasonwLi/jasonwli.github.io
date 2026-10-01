/**
 * Camera model (C1). The globe stays on the optical axis at the choreographed
 * scale; zoom and tilt move the CAMERA, and a lens shift (setViewOffset) puts the
 * view target where the choreography wants it on screen (plan §4, critique 13).
 *
 *   T   = C + Rw·(0, 0, 1)                         the view-target surface point
 *   alt = min(alt0, altFromViewKm(viewKm)),         alt0 = CAM_Z − Rw
 *   pos = T + alt·(0, −sin tilt, cos tilt)          up = +Y, lookAt(T)
 *   setViewOffset so that T projects to screenTargetPx
 *
 * At zoom 0 (alt = alt0, tilt 0) the camera sits at C + (0, 0, CAM_Z), so the
 * silhouette is an exact circle centred on screenTargetPx with radius
 * R = f·Rw/√(CAM_Z² − Rw²). rFromScale / scaleFromR convert between the two.
 */
import { Vector3, type Object3D, type PerspectiveCamera } from 'three'
import type { Vec2 } from './globeState'
import { EARTH_KM } from './geo/radii'

export const CAM_Z = 3.35
export const FOV = 42

export interface CameraParams {
  C: Vector3 // globe centre (world)
  Rw: number // globe radius (world)
  viewKm: number
  tilt: number
  screenTargetPx: Vec2 // where the view target T lands on screen (CSS px, canvas-relative)
  viewport: { w: number; h: number }
  fov: number
}

const _T = new Vector3()

/** Writes position, orientation, near/far, fov and the lens shift. Caller runs updateMatrixWorld(). */
export function computeCamera(p: CameraParams, out: PerspectiveCamera): void {
  const { C, Rw, tilt, viewport } = p
  const alt0 = Math.max(CAM_Z - Rw, 1e-4)
  const alt = Math.min(alt0, altFromViewKm(p.viewKm, Rw, p.fov))
  _T.set(C.x, C.y, C.z + Rw)
  out.position.set(_T.x, _T.y - alt * Math.sin(tilt), _T.z + alt * Math.cos(tilt))
  out.up.set(0, 1, 0)
  out.lookAt(_T)
  out.fov = p.fov
  out.near = Math.max(1e-4, 0.25 * alt)
  out.far = out.position.distanceTo(C) + 1.2 * Rw
  const w = Math.max(1, viewport.w)
  const h = Math.max(1, viewport.h)
  // the full image is centred on T; shift the window so T lands on the target
  out.setViewOffset(w, h, w / 2 - p.screenTargetPx[0], h / 2 - p.screenTargetPx[1], w, h)
  out.updateProjectionMatrix()
}

/** Camera altitude above the target surface (world units) → vertical view span in km. */
export function viewKmFromAlt(alt: number, Rw: number, fov = FOV): number {
  return ((alt * 2 * Math.tan((fov * Math.PI) / 360)) / Rw) * EARTH_KM
}

/** Vertical view span in km → camera altitude above the target surface (world units). */
export function altFromViewKm(viewKm: number, Rw: number, fov = FOV): number {
  return ((viewKm / EARTH_KM) * Rw) / (2 * Math.tan((fov * Math.PI) / 360))
}

/** Focal length in CSS px for a viewport height. */
export function focalPx(h: number, fov = FOV): number {
  return h / 2 / Math.tan((fov * Math.PI) / 360)
}

/** Silhouette radius (px) of a globe of world radius s seen from distance d. */
export function silhouetteR(s: number, d: number, h: number, fov = FOV): number {
  return d > s ? (focalPx(h, fov) * s) / Math.sqrt(d * d - s * s) : Math.max(h, 1) * 4
}

/** World scale whose zoom-0 silhouette (camera at distance CAM_Z) has radius R px. */
export function scaleFromR(R: number, h: number, fov = FOV): number {
  const f = focalPx(h, fov)
  return (R * CAM_Z) / Math.sqrt(f * f + R * R)
}

/** Camera distance |cam − C| for a pose (tilt orbits about T at altitude alt). */
export function camDistance(Rw: number, alt: number, tilt: number): number {
  const z = Rw + alt * Math.cos(tilt)
  const y = alt * Math.sin(tilt)
  return Math.sqrt(z * z + y * y)
}

const _c = new Vector3()
const _cam = new Vector3()

/**
 * Projected globe centre and true silhouette radius, CSS px:
 * R = f·Rw/√(d² − Rw²), f = (h/2)/tan(fov/2), d = |cam − C|.
 * CameraRig calls it every frame (bug #1) and writes globeState.centerPx/radiusPx.
 */
export function measureDisc(camera: PerspectiveCamera, outer: Object3D, w: number, h: number) {
  outer.getWorldPosition(_c)
  const Rw = outer.scale.x
  const d = camera.getWorldPosition(_cam).distanceTo(_c)
  _c.project(camera)
  const cx = ((_c.x + 1) / 2) * w
  const cy = ((1 - _c.y) / 2) * h
  const r = silhouetteR(Rw, d, h, camera.fov)
  return { cx, cy, r: Math.max(r, 1), d, Rw }
}

// ———————————————————— choreography table ————————————————————

export type ChoreoSection = 'hero' | 'work' | 'travel' | 'footer'
/** One choreography target (critique 13). centerPx/Rpx are CSS px of the zoom-0 silhouette. */
export interface ChoreoEntry {
  centerPx: Vec2
  Rpx: number
  dim: number
  pinScale: number
  limbOpacity: number
}
export interface ChoreoContext {
  w: number
  h: number
  /** CSS breakpoint (≤ 860 px): travel column collapses, globe sits in the top band */
  mobile: boolean
  /** right edge of .travel-col (desktop), 0 on mobile */
  colRightPx: number
}
/** Shape T1's src/theme/choreography.ts must export as `choreography`. */
export type ChoreographyFn = (section: ChoreoSection, ctx: ChoreoContext) => ChoreoEntry

