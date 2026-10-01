/**
 * Shared landmark placement helpers (C5): static per-landmark data (direction, visited,
 * nearest pin, owning pin) and the per-frame camera context both monument layers use
 * (CPU horizon test, px per globe-radius unit measured AT the point — lod.pxPerKm is
 * a viewport-centre figure and C4 found it ~2.4x off on phones).
 */
import * as THREE from 'three'
import { LANDMARKS, type Landmark, landmarkVisited } from '../../data/landmarks'
import { locations } from '../../data/travel'
import { meshMip, surfaceHeightM } from '../geo/meshHeight'
import { sampleHeightM } from '../geo/heightGrid'

const DEG = Math.PI / 180

export interface LandmarkInfo {
  lm: Landmark
  index: number
  dir: THREE.Vector3
  visited: boolean
  /** index into locations of the owning place (near_place), -1 if none */
  placeIndex: number
  /** nearest pin (any place): direction and index, -1 if there are no places */
  pinIndex: number
  pinDir: THREE.Vector3 | null
  /** a stable fallback tangent bearing for pin clearance (rad) */
  bearing: number
  /** priority: visited first, then fame */
  priority: number
}

export function dirOf(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
  const la = lat * DEG
  const lo = lon * DEG
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo))
}

export function latLonOf(d: THREE.Vector3): [number, number] {
  return [Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG, Math.atan2(-d.z, d.x) / DEG]
}

let infos: LandmarkInfo[] | null = null

/**
 * Per landmark (LANDMARKS order): how much of the 3D monument is drawn this frame (0..1),
 * written by Monuments and read by LandmarkGlyphs, which keeps the engraved 2D glyph on a
 * landmark until its 3D form is big enough to be legible (finish review).
 */
export const monumentShown = new Float32Array(LANDMARKS.length)

export function landmarkInfos(): LandmarkInfo[] {
  if (infos) return infos
  const pinDirs = locations.map((l) => dirOf(l.lat, l.lon))
  infos = LANDMARKS.map((lm, index) => {
    const dir = dirOf(lm.lat, lm.lon)
    let pinIndex = -1
    let best = -2
    pinDirs.forEach((p, i) => {
      const c = p.dot(dir)
      if (c > best) {
        best = c
        pinIndex = i
      }
    })
    const visited = landmarkVisited(lm, locations)
    const placeIndex = lm.nearPlace ? locations.findIndex((l) => l.slug === lm.nearPlace) : -1
    // golden-angle bearings keep landmarks sharing a pin apart when they sit on it
    const bearing = (index * 2.39996) % (Math.PI * 2)
    return {
      lm, index, dir, visited, placeIndex, pinIndex,
      pinDir: pinIndex >= 0 ? pinDirs[pinIndex] : null,
      bearing,
      priority: (visited ? 10 : 0) + lm.fame,
    }
  })
  return infos
}

const tA = new THREE.Vector3()

/**
 * Land test for the monument site nudge: the CPU height grid (~20 km cells, ocean = 0,
 * land >= 0, loaded before monuments show) read bilinearly, so a point within half a cell
 * of the coast counts as land. Land at or below sea level reads as water (none of the
 * monument sites is).
 */
export function isLandDir(d: THREE.Vector3): boolean {
  const [lat, lon] = latLonOf(d)
  return sampleHeightM(lat, lon) > 0.5
}

/**
 * Ground height (m, >= 0) at a direction, from the mesh's own height texels when known
 * (geo/meshHeight; monuments sit on the drawn relief below 1500 km), else the CPU grid.
 * Natural features use their lowest foot sample.
 */
export function groundM(d: THREE.Vector3, footRad = 0): number {
  const [lat, lon] = latLonOf(d)
  const mip = meshMip()
  let h = surfaceHeightM(lat, lon, mip)
  if (footRad > 0) {
    const dl = footRad / DEG
    const dlo = dl / Math.max(0.2, Math.cos(lat * DEG))
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      h = Math.min(h, surfaceHeightM(lat + Math.sin(a) * dl, lon + Math.cos(a) * dlo, mip))
    }
  }
  return h
}

/**
 * Highest drawn ground (m) on two rings (reachRad and half of it, radius units = radians)
 * around a direction, at the mesh's current mip: the relief that can stand in front of a
 * monument's body along the view rays (Monuments' close-zoom depth lift).
 */
export function groundMaxM(d: THREE.Vector3, reachRad: number): number {
  const [lat, lon] = latLonOf(d)
  const mip = meshMip()
  let h = surfaceHeightM(lat, lon, mip)
  const cl = Math.max(0.2, Math.cos(lat * DEG))
  for (const f of [0.5, 1]) {
    const dl = (reachRad * f) / DEG
    const dlo = dl / cl
    for (let i = 0; i < 8; i++) {
      const a = ((i + f) / 8) * Math.PI * 2
      h = Math.max(h, surfaceHeightM(lat + Math.sin(a) * dl, lon + Math.cos(a) * dlo, mip))
    }
  }
  return h
}

/** Per-frame camera context in the globe-local (inner group) frame. */
export class CameraContext {
  camLocal = new THREE.Vector3()
  camUpLocal = new THREE.Vector3()
  private invQ = new THREE.Quaternion()
  private wp = new THREE.Vector3()
  private scale = 1
  private proj5 = 1
  private viewH = 1
  private viewW = 1
  private camera: THREE.Camera | null = null
  private inner: THREE.Object3D | null = null

  update(camera: THREE.Camera, inner: THREE.Object3D, viewW: number, viewH: number) {
    this.camera = camera
    this.inner = inner
    inner.updateWorldMatrix(true, false)
    camera.getWorldPosition(this.camLocal)
    inner.worldToLocal(this.camLocal)
    inner.getWorldQuaternion(this.invQ).invert()
    this.camUpLocal.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(this.invQ).normalize()
    this.scale = new THREE.Vector3().setFromMatrixScale(inner.matrixWorld).x
    this.proj5 = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5]
    this.viewW = viewW
    this.viewH = viewH
  }

  /** Cosine between the surface normal at p (local) and the direction to the camera. */
  facing(p: THREE.Vector3, normal: THREE.Vector3): number {
    tA.copy(this.camLocal).sub(p).normalize()
    return tA.dot(normal)
  }

  /** CSS px per globe-radius unit at local point p (perspective, measured at its depth). */
  pxPerUnit(p: THREE.Vector3): number {
    const cam = this.camera
    if (!cam || !this.inner) return 1
    this.wp.copy(p)
    this.inner.localToWorld(this.wp)
    this.wp.applyMatrix4(cam.matrixWorldInverse)
    return (this.scale * (this.viewH / 2) * this.proj5) / Math.max(1e-6, -this.wp.z)
  }

  /** Screen position (CSS px, canvas-relative) of local point p; returns false behind the camera. */
  project(p: THREE.Vector3, out: [number, number]): boolean {
    const cam = this.camera
    if (!cam || !this.inner) return false
    this.wp.copy(p)
    this.inner.localToWorld(this.wp)
    this.wp.project(cam)
    out[0] = ((this.wp.x + 1) / 2) * this.viewW
    out[1] = ((1 - this.wp.y) / 2) * this.viewH
    return this.wp.z < 1
  }
}

export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false
  } catch {
    return false
  }
}
