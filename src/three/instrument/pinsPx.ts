/**
 * Pin placement and per-frame screen projection (I1).
 *
 * One source of truth for where a pin is: the lifted globe-local position
 *   dir · (1 + LIFT.pin + surfaceHeightM · lod.heightScale)   (mesh texels, else the CPU grid)
 * lives in `pinLocal` (3 floats per location, locations order = first-visit order).
 * StarPins uploads the SAME Float32Arrays as instance attributes, so the drawn pin,
 * the projected pinsPx, picking and the anchors can never disagree.
 *
 * globeState.pinsPx: 4 floats per location: x, y (CSS px, canvas-relative; the
 * projection includes the lens shift), visible 0..1 (horizon fade, 0 until a globe
 * surface is mounted), pickRadiusPx (22, regardless of the drawn size).
 *
 * Allocation-free per frame: module-level vectors, arrays resized only when the
 * location count changes.
 */
import * as THREE from 'three'
import { locations } from '../../data/travel'
import { globeState } from '../globeState'
import { LIFT, R_SURFACE } from '../geo/radii'
import { heightGridReady } from '../geo/heightGrid'
import { meshHeightReady, meshHeightVersion, meshMip, surfaceHeightM } from '../geo/meshHeight'

/** Hit radius in CSS px for every pin state (theme: 22 px regardless of the drawn size). */
export const PICK_RADIUS_PX = 22
/** Horizon fade on the facing cosine (pin normal · direction to the camera). */
export const FACING_FADE: readonly [number, number] = [0.02, 0.18]

/** Unit directions, 3 floats per location (globe-local frame, latLonToVec3 convention). */
export let pinDir = new Float32Array(0)
/** Terrain height in metres at each pin (mesh texels when known, else the CPU grid; 0 before either). */
export let pinHeightM = new Float32Array(0)
/** Lifted local positions, 3 floats per location. StarPins' aPos attribute shares this array. */
export let pinLocal = new Float32Array(0)
/** Horizon-fade visibility per location, 0..1. StarPins' aVis attribute shares this array. */
export let pinVis = new Float32Array(0)
/** Facing cosine per location (< 0 = far side), written every frame. */
export let pinFacingArr = new Float32Array(0)
/** Photo-less flag per location (1 = no photos). */
export let pinEmpty = new Float32Array(0)
/** Hero-scale thinning per location (1 = drawn), eased; see updatePinsPx. */
let pinThin = new Float32Array(0)
/** Locations by photo count, most first (the thinning keeps the strongest pin of a cluster). */
let thinOrder: number[] = []
/** Bumps whenever pinLocal is rewritten (StarPins re-uploads aPos). */
export let pinLiftVersion = 0

const DEG = Math.PI / 180
let liftScale = -1 // heightScale the current pinLocal was built for
let liftGridReady = false
let liftMeshVersion = -1
let liftMip = 0

function ensureArrays(n: number) {
  if (pinDir.length === n * 3) return
  pinDir = new Float32Array(n * 3)
  pinHeightM = new Float32Array(n)
  pinLocal = new Float32Array(n * 3)
  pinVis = new Float32Array(n)
  pinFacingArr = new Float32Array(n)
  pinEmpty = new Float32Array(n)
  pinThin = new Float32Array(n).fill(1)
  thinOrder = locations.map((_, i) => i).sort((a, b) => locations[b].photos.length - locations[a].photos.length || a - b)
  for (let i = 0; i < n; i++) {
    const l = locations[i]
    // x = cos(lat)cos(lon), y = sin(lat), z = −cos(lat)sin(lon) (globeMath.latLonToVec3)
    const la = l.lat * DEG
    const lo = l.lon * DEG
    pinDir[i * 3] = Math.cos(la) * Math.cos(lo)
    pinDir[i * 3 + 1] = Math.sin(la)
    pinDir[i * 3 + 2] = -Math.cos(la) * Math.sin(lo)
    pinEmpty[i] = l.photos.length ? 0 : 1
  }
  liftScale = -1
  liftGridReady = false
  liftMeshVersion = -1
}

/**
 * Re-lift the pins when lod.heightScale moves by more than 5% (or crosses 0), the CPU
 * height grid becomes ready, the mesh height source changes, or (while displaced) the
 * mesh's height mip moves by a quarter level. Heights come from the mesh's own texels
 * when known (geo/meshHeight: pins sit on the drawn relief below 1500 km), else the
 * CPU grid. Returns true when pinLocal was rewritten.
 */
export function updatePinLift(heightScale: number): boolean {
  const n = locations.length
  ensureArrays(n)
  const ready = heightGridReady()
  const mv = meshHeightVersion()
  const mip = heightScale > 0 && meshHeightReady() ? meshMip() : liftMip
  const heightsStale = (ready && !liftGridReady) || mv !== liftMeshVersion || Math.abs(mip - liftMip) > 0.25
  if (heightsStale) {
    liftMeshVersion = mv
    liftMip = mip
    for (let i = 0; i < n; i++) pinHeightM[i] = surfaceHeightM(locations[i].lat, locations[i].lon, mip)
  }
  const scaleMoved =
    liftScale < 0 ||
    (heightScale === 0) !== (liftScale === 0) ||
    Math.abs(heightScale - liftScale) > 0.05 * Math.max(liftScale, 1e-12)
  if (!scaleMoved && !heightsStale && ready === liftGridReady) return false
  liftGridReady = ready
  liftScale = heightScale
  for (let i = 0; i < n; i++) {
    const r = R_SURFACE + LIFT.pin + pinHeightM[i] * heightScale
    pinLocal[i * 3] = pinDir[i * 3] * r
    pinLocal[i * 3 + 1] = pinDir[i * 3 + 1] * r
    pinLocal[i * 3 + 2] = pinDir[i * 3 + 2] * r
  }
  pinLiftVersion++
  return true
}

const tmp = new THREE.Vector3()
const center = new THREE.Vector3()
const camPos = new THREE.Vector3()
const toCam = new THREE.Vector3()
const outward = new THREE.Vector3()

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Project every pin through inner.matrixWorld and the camera (lens shift included).
 * Call after CameraRig has updated the camera and the globe's world matrices.
 */
export function updatePinsPx(
  camera: THREE.Camera,
  inner: THREE.Object3D,
  viewport: { w: number; h: number },
): void {
  const n = locations.length
  ensureArrays(n)
  if (liftScale < 0) updatePinLift(globeState.lod.heightScale)
  if (globeState.pinsPx.length !== n * 4) globeState.pinsPx = new Float32Array(n * 4)
  const out = globeState.pinsPx
  const ready = globeState.surfaceReady
  inner.getWorldPosition(center)
  camera.getWorldPosition(camPos)
  for (let i = 0; i < n; i++) {
    tmp.set(pinLocal[i * 3], pinLocal[i * 3 + 1], pinLocal[i * 3 + 2])
    inner.localToWorld(tmp)
    toCam.copy(camPos).sub(tmp).normalize()
    const facing = outward.copy(tmp).sub(center).normalize().dot(toCam)
    pinFacingArr[i] = facing
    // facing-agnostic: far-side points still project (their direction from the
    // centre is the 'projected direction' the occulted alidade points along)
    tmp.project(camera)
    const vis = ready ? smoothstep(FACING_FADE[0], FACING_FADE[1], facing) : 0
    pinVis[i] = vis
    out[i * 4] = ((tmp.x + 1) / 2) * viewport.w
    out[i * 4 + 1] = ((1 - tmp.y) / 2) * viewport.h
    out[i * 4 + 2] = vis
    out[i * 4 + 3] = PICK_RADIUS_PX
  }
  thinPins(out)
}

/** Kept pins on the small phone hero globe stay at least this far apart (CSS px, x pinScale). */
const THIN_SEP_PX = 13
const _kept: number[] = []

/**
 * Hero-scale declutter (finish review, phones): on the small hero/work globe the rings
 * of a dense region overlapped into one mass. Greedy by photo count, a pin is drawn
 * only when no stronger pin sits within THIN_SEP_PX; the rest fade out (and are not
 * pickable). Off once travel comes in (every place is reachable there) and never for
 * the active or hovered place.
 */
function thinPins(out: Float32Array) {
  const g = globeState
  const on = g.isPhone ? 1 - smoothstep(0.35, 0.6, g.travelIn) : 0
  const sep = THIN_SEP_PX * Math.max(0.6, g.anchors.pinScale)
  _kept.length = 0
  for (const i of thinOrder) {
    let keep = 1
    if (on > 0 && out[i * 4 + 2] > 0.05 && i !== g.anchors.activeIndex && i !== g.anchors.hoverIndex) {
      const x = out[i * 4]
      const y = out[i * 4 + 1]
      for (const k of _kept) {
        if (Math.hypot(out[k * 4] - x, out[k * 4 + 1] - y) < sep) {
          keep = 0
          break
        }
      }
    }
    if (keep && out[i * 4 + 2] > 0.05) _kept.push(i)
    const target = keep ? 1 : 1 - on
    const t = pinThin[i]
    pinThin[i] = t + Math.max(-0.12, Math.min(0.12, target - t))
    pinVis[i] *= pinThin[i]
    out[i * 4 + 2] *= pinThin[i]
  }
}

/** Facing cosine of pin i from the last updatePinsPx (−1 when out of range). */
export function pinFacing(i: number): number {
  return i >= 0 && i < pinFacingArr.length ? pinFacingArr[i] : -1
}

/** Index of the nearest visible pin within its pick radius of client (x, y), or −1. */
export function pickPin(clientX: number, clientY: number, el: HTMLElement): number {
  const out = globeState.pinsPx
  if (!out.length) return -1
  const rect = el.getBoundingClientRect()
  const sx = clientX - rect.left
  const sy = clientY - rect.top
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < out.length / 4; i++) {
    // a pin half-faded at the limb is still pickable; one essentially gone is not
    if (out[i * 4 + 2] <= 0.15) continue
    const d = Math.hypot(out[i * 4] - sx, out[i * 4 + 1] - sy)
    if (d < out[i * 4 + 3] && d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}
