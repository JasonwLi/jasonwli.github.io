/**
 * Instrument anchors (I1). Runs in the Instrument frame (priority −2) after
 * CameraRig (−3) has settled the pose, the camera and the disc (measureDisc →
 * globeState.centerPx/radiusPx, the TRUE silhouette R = f·Rw/√(d²−Rw²)), and after
 * updatePinsPx. Writes globeState.anchors for the DOM overlay (T1c), which owns
 * every timeline; I1 supplies raw signals only.
 *
 * Angle conventions: CSS screen space, radians, 0 = +x, clockwise positive
 * (so −π/2 is 12 o'clock). lambdaC/phiC are geographic degrees.
 *
 * Allocation-free per frame: the Vec2 fields (activePx, hoverPx, limbMarkPx) are
 * persistent arrays mutated in place, or null. Consumers must copy, not keep them.
 */
import * as THREE from 'three'
import { globeState, type InstrumentAnchors } from '../globeState'
import { useSite } from '../../state/store'
import { locations } from '../../data/travel'
import { pinFacing } from './pinsPx'
import { limbOpacityAt } from '../../theme/choreography'
import { smoothstep } from '../lod'

/**
 * Limb geometry: constant CSS px offsets beyond the silhouette R (theme 'globe
 * instrument'). T1c draws the limb from this table so the overlay registers
 * with the anchors. compact applies below compactBelowR (phones, the parked work
 * globe), with a 4 px hysteresis on the way back up.
 */
export const LIMB = {
  full: { seat: 3, fillet: 12, fillet2: 14, numerals: 24, tickIn: 33, tickOut: 44, rim: 48, fiducial: 54 },
  compact: { seat: 3, fillet: 6, fillet2: 7, numerals: 13, tickIn: 20, tickOut: 28, rim: 28, fiducial: 34 },
  compactBelowR: 220,
} as const
export type LimbGeometry = (typeof LIMB)['full'] | (typeof LIMB)['compact']

/** Breakpoint where the layout collapses to the phone column (matches CameraRig / site.css). */
export const MOBILE_MAX_W = 860
/** Free area height fraction on the phone travel layout (globe band = top 52vh). */
export const PHONE_TRAVEL_BAND = 0.52

/** Live instrument layout, updated every frame with the anchors (read-only for consumers). */
export const instrumentLayout = {
  compact: false,
  limb: LIMB.full as LimbGeometry,
  /** the free rect the limb must fit in and the neatline insets from (CSS px) */
  free: { x0: 0, y0: 0, x1: 1, y1: 1 },
  mobile: false,
}

/** Limb table for a silhouette radius (no hysteresis; the live choice is instrumentLayout.limb). */
export function limbFor(radiusPx: number, mobile = false): LimbGeometry {
  return mobile || radiusPx < LIMB.compactBelowR ? LIMB.compact : LIMB.full
}

const HOLD_FRAC = 0.08
const SETTLE_SPEED = 20 // px/s
const SETTLE_MS = 120
const OCCULT_FACING = 0.05
const ARC_SAMPLES = 64
const ARC_TO_NEAT = 0.2
const ARC_BACK = 0.28
const READOUT_W = 190
const DEG = Math.PI / 180
const B40 = (40 - 90) * DEG
const B320 = (320 - 90) * DEG
const B180 = (180 - 90) * DEG

const _cam = new THREE.Vector3()
const _c = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _local = new THREE.Vector3()
const _activePx: [number, number] = [0, 0]
const _hoverPx: [number, number] = [0, 0]
const _limbMarkPx: [number, number] = [0, 0]
const lastPose = new Float64Array(23)
const lastActivePx: [number, number] = [0, 0]
let lastActiveIdx = -1
let haveLastActive = false
let slowSince = 0
let armed = true

function wrapPi(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Theme fit rule: the 190 px readout hung 16+20 px outside the rim at bearing ang stays in the free rect. */
function readoutFits(ang: number, cx: number, rimR: number, F: { x0: number; x1: number }): boolean {
  const rx = cx + Math.cos(ang) * rimR
  const x0 = Math.cos(ang) >= 0 ? rx + 36 : rx - 36 - READOUT_W
  return x0 >= F.x0 + 24 && x0 + READOUT_W <= F.x1 - 8
}

function poseSlot(i: number, v: number): boolean {
  const moved = Math.abs(v - lastPose[i]) > 1e-7
  lastPose[i] = v
  return moved
}

export function updateAnchors(
  dt: number,
  camera: THREE.Camera,
  outer: THREE.Object3D,
  inner: THREE.Object3D,
  viewport: { w: number; h: number; freeLeftPx: number },
  reducedMotion: boolean,
): void {
  const g = globeState
  const a: InstrumentAnchors = g.anchors
  const cx = g.centerPx[0]
  const cy = g.centerPx[1]
  const R = g.radiusPx
  a.globeCenterPx[0] = cx
  a.globeCenterPx[1] = cy
  a.radiusPx = R
  a.silhouetteRpx = R

  // ——— layout: free rect and limb table ———
  const L = instrumentLayout
  const mobile = viewport.w <= MOBILE_MAX_W || g.isPhone
  L.mobile = mobile
  L.free.x0 = viewport.freeLeftPx
  L.free.y0 = 0
  L.free.x1 = viewport.w
  L.free.y1 = mobile && g.travelIn > 0.5 ? viewport.h * PHONE_TRAVEL_BAND : viewport.h
  L.compact = mobile || (L.compact ? R < LIMB.compactBelowR + 4 : R < LIMB.compactBelowR)
  L.limb = L.compact ? LIMB.compact : LIMB.full
  const rimR = R + L.limb.rim

  // ——— camera / pose change detection (neatline sampling gate) ———
  const m = camera.matrixWorld.elements
  inner.getWorldQuaternion(_q)
  outer.getWorldPosition(_c)
  let changed = false
  for (let i = 0; i < 16; i++) changed = poseSlot(i, m[i]) || changed
  changed = poseSlot(16, _q.x) || changed
  changed = poseSlot(17, _q.y) || changed
  changed = poseSlot(18, _q.z) || changed
  changed = poseSlot(19, _q.w) || changed
  changed = poseSlot(20, outer.scale.x) || changed
  changed = poseSlot(21, viewport.w) || changed
  changed = poseSlot(22, viewport.h) || changed
  a.camChanged = changed

  // ——— sub-camera point: centre → camera direction in globe-local axes ———
  camera.getWorldPosition(_cam)
  _local.copy(_cam)
  inner.worldToLocal(_local).normalize()
  // lat = asin(y), lon = atan2(−z, x) (cube convention R6)
  a.phiC = Math.asin(Math.max(-1, Math.min(1, _local.y))) / DEG
  a.lambdaC = Math.atan2(-_local.z, _local.x) / DEG
  a.limbRotation = wrapPi(-a.lambdaC * DEG)

  // ——— active / hover from the per-frame pin projection ———
  const { active, hovered } = useSite.getState()
  const ai = active ? locations.indexOf(active) : -1
  const hi = hovered ? locations.indexOf(hovered) : -1
  const px = g.pinsPx
  a.activeIndex = ai
  a.hoverIndex = hi
  if (ai !== lastActiveIdx) {
    lastActiveIdx = ai
    haveLastActive = false
    slowSince = 0
    a.activeSettled = false
  }
  if (ai >= 0 && px.length >= (ai + 1) * 4) {
    const x = px[ai * 4]
    const y = px[ai * 4 + 1]
    _activePx[0] = x
    _activePx[1] = y
    a.activePx = _activePx
    a.activeVisible = px[ai * 4 + 2]
    a.activeFacing = pinFacing(ai)
    a.activeOcculted = a.activeFacing < OCCULT_FACING
    // alidade: raw bearing every frame (inherits the globe's damping), held near the
    // centre. Far side: the projected point's direction from the centre.
    const dx = x - cx
    const dy = y - cy
    if (Math.hypot(dx, dy) >= HOLD_FRAC * R) a.alidadeAngle = Math.atan2(dy, dx)
    _limbMarkPx[0] = cx + Math.cos(a.alidadeAngle) * rimR
    _limbMarkPx[1] = cy + Math.sin(a.alidadeAngle) * rimR
    a.limbMarkPx = _limbMarkPx
    // settled: pin screen speed < 20 px/s for 120 ms
    const now = performance.now()
    const speed = haveLastActive && dt > 0 ? Math.hypot(x - lastActivePx[0], y - lastActivePx[1]) / dt : Infinity
    if (speed < SETTLE_SPEED) {
      if (!slowSince) slowSince = now
    } else slowSince = 0
    a.activeSettled = reducedMotion || (slowSince > 0 && now - slowSince >= SETTLE_MS)
    lastActivePx[0] = x
    lastActivePx[1] = y
    haveLastActive = true
  } else {
    a.activePx = null
    a.activeVisible = 0
    a.activeFacing = 0
    a.activeOcculted = false
    a.activeSettled = false
    a.limbMarkPx = null
    haveLastActive = false
    slowSince = 0
  }
  if (hi >= 0 && px.length >= (hi + 1) * 4) {
    _hoverPx[0] = px[hi * 4]
    _hoverPx[1] = px[hi * 4 + 1]
    a.hoverPx = _hoverPx
    a.hoverVisible = px[hi * 4 + 2]
  } else {
    a.hoverPx = null
    a.hoverVisible = 0
  }

  // ——— limb stage: how much of the rim circle lies in the free rect ———
  const F = L.free
  let inside = 0
  let sx = 0
  let sy = 0
  for (let i = 0; i < ARC_SAMPLES; i++) {
    const t = (i / ARC_SAMPLES) * Math.PI * 2
    const x = cx + Math.cos(t) * rimR
    const y = cy + Math.sin(t) * rimR
    if (x >= F.x0 && x <= F.x1 && y >= F.y0 && y <= F.y1) {
      inside++
      sx += Math.cos(t)
      sy += Math.sin(t)
    }
  }
  a.visibleArcFrac = inside / ARC_SAMPLES
  const fit = Math.min(F.x1 - F.x0, F.y1 - F.y0) / 2 - 8
  if (rimR <= fit) a.limbStage = 'full'
  // INT: the 'arc' band is widened (neatline below 20% of the rim visible, back above 28%)
  // so one Zoom-in press from the travel framing lands in it instead of skipping it
  else if (a.limbStage === 'neatline') a.limbStage = a.visibleArcFrac > ARC_BACK ? 'arc' : 'neatline'
  else a.limbStage = a.visibleArcFrac < ARC_TO_NEAT ? 'neatline' : 'arc'
  a.fiducialAngle = a.limbStage === 'full' || inside === 0 ? -Math.PI / 2 : Math.atan2(sy, sx)

  // ——— sight bearing (theme fit rule): β 40°, else 320°, else 180° (one line below) ———
  if (readoutFits(B40, cx, rimR, F)) {
    a.sightBearing = B40
    a.readoutSide = 'rim'
  } else if (readoutFits(B320, cx, rimR, F)) {
    a.sightBearing = B320
    a.readoutSide = 'rim'
  } else {
    a.sightBearing = B180
    a.readoutSide = 'below'
  }

  // ——— per-section signals ———
  const travel = g.travelIn
  const work = g.workIn * (1 - travel)
  // one source of truth: the theme's scroll-coupled rule (the overlay reads the same function)
  a.limbOpacity = limbOpacityAt(g)
  // lod.limbFade agrees with the overlay: the limb fades by limb stage only (neatline = 0)
  g.lod.limbFade = a.limbStage === 'neatline' ? 0 : 1
  // pins 10 px in hero/travel, 7 px in work; 7 px on the small phone hero globe too
  // (finish review: Europe/Egypt read as one mass), back to 10 px as travel comes in
  const phoneHero = g.isPhone ? 1 - travel : 0
  a.pinScale = (1 - 0.3 * work) * (1 - 0.3 * phoneHero * (1 - work))
  // route: hero 0.55, work follows dim, travel 1; Climate ×0.6
  // contact: the course line recedes to a whisper with the dimmed globe (restraint)
  const foot = smoothstep(0, 0.6, g.footIn)
  a.routeOpacity = (0.55 * (1 - travel) * (1 - g.dim) + travel) * (1 - 0.4 * g.modeMix) * (1 - 0.85 * foot)

  // ——— travel arm: one-shot engrave trigger at 0.5 upward, re-armed below 0.2 ———
  if (armed && travel > 0.5) {
    armed = false
    a.travelArmed = true
    a.travelArmSeq++
  } else if (!armed && travel < 0.2) {
    armed = true
    a.travelArmed = false
  }

  // ——— texture load progress, damped (λ 8); instant under reduced motion ———
  a.loadProgress = reducedMotion
    ? g.loadProgress
    : THREE.MathUtils.damp(a.loadProgress, g.loadProgress, 8, Math.min(dt, 0.05))
}
