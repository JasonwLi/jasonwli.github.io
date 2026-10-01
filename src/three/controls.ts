/**
 * Pointer / wheel / pinch / double-click controls, the anchor solver and the
 * programmatic view API (C1).
 *
 * Zoom lives in log space as a DEPTH below the choreographed framing:
 *   depth = ln maxViewKm − ln viewKm   (0 = widest, ln(max/min) = the tier floor)
 * so the choreography can change maxViewKm (section scroll, resize) without
 * un-zooming or re-zooming the view. CameraRig damps depth → targetDepth and
 * mirrors both into globeState.logViewKm / targetLogViewKm every frame.
 *
 * Every gesture that must keep a surface point under the cursor (drag, wheel and
 * pinch zoom, trackpad pan, double-click) goes through solveAnchor: Newton on
 * (yaw, pitch) so that the globe-local direction projects to the target pixel at
 * the TARGET pose (target viewKm and tilt), with a numeric Jacobian.
 *
 * F0 bug fixes kept: #1 per-frame disc hit-test and wheel owner, #2 Lenis glide,
 * #3 hover clears on drag and re-picks at 10 Hz, #4 pinch anchored at the
 * midpoint, #7 zoom gestures are travel-only.
 */
import * as THREE from 'three'
import { globeState, type Vec2 } from './globeState'
import { facingAngles, nearestAngle } from './globeMath'
import { sceneRefs } from './sceneRefs'
import { pickPin } from './instrument/pinsPx'
import { LIMB, instrumentLayout, limbFor } from './instrument/anchors'
import { PING_RADIUS } from './instrument/StarPins'
import { locations, type TravelLocation } from '../data/travel'
import { useSite } from '../state/store'
import { getLenis } from '../hooks/useLenis'
import { CAM_Z, FOV, altFromViewKm, camDistance, computeCamera, silhouetteR, viewKmFromAlt } from './camera'
import { TILT_MAX } from './geo/radii'
import { tiltForViewKm } from './lod'

/** re-pick period for hover under a still pointer, ms */
const REPICK_MS = 100
/** DOM regions that own the pointer even when they overlap the disc */
const UI_SELECTOR = '.travel-col, .gallery, .lightbox, .site-nav, .instrument-ui'
const PITCH_MAX = 1.25
/** wheel: ln(viewKm) per deltaY px (mouse / trackpad scroll) and per ctrl-pinch px */
const WHEEL_K = 0.0016
const PINCH_K = 0.01
/** fully zoomed out + wheel-out this long hands the wheel to the page */
const ESCAPE_MS = 350
const ESCAPE_IDLE_MS = 250
const INERTIA_WINDOW_MS = 80
const INERTIA_DECAY = 4
/** the theme's sight point: the active place rests at 0.42 R along the bearing β */
const SIGHT_FRAC = 0.42
const ANCHOR_TOL_PX = 2

// ———————————————————— shared view state ————————————————————

/** Zoom depth below the framing (see header). tiltOverride: debug setView only. */
export const view = {
  depth: 0,
  targetDepth: 0,
  tiltOverride: null as number | null,
}

/** The choreographed rig, written by CameraRig every frame before controls run. */
export const rig = {
  C: new THREE.Vector3(),
  s: 1,
  screenTargetPx: [0, 0] as Vec2,
  w: 1,
  h: 1,
  lnMax: Math.log(20000),
  lnMin: Math.log(500),
}

export function depthSpan(): number {
  return Math.max(0, rig.lnMax - rig.lnMin)
}
function clampDepth(d: number): number {
  return THREE.MathUtils.clamp(d, 0, depthSpan())
}
/** viewKm for a zoom depth at the current framing */
export function viewKmAtDepth(depth: number): number {
  return Math.exp(rig.lnMax - depth)
}
/** Tilt for a view span: debug override, else TILT_MAX[tier]·smoothstep(2500, 900, viewKm). */
export function tiltFor(viewKm: number): number {
  return view.tiltOverride ?? tiltForViewKm(viewKm, TILT_MAX[globeState.tier])
}

// ———————————————————— projection helpers ————————————————————

const scratchCam = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100)
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _toCam = new THREE.Vector3()
const _ray = new THREE.Raycaster()
const _ndc = new THREE.Vector2()
const _sphere = new THREE.Sphere()
const _hit = new THREE.Vector3()
const _q = new THREE.Quaternion()

/** Pose the scratch camera at the rig with the given view span and tilt. */
function poseScratch(viewKm: number, tilt: number): THREE.PerspectiveCamera {
  computeCamera(
    { C: rig.C, Rw: rig.s, viewKm, tilt, screenTargetPx: rig.screenTargetPx, viewport: { w: rig.w, h: rig.h }, fov: FOV },
    scratchCam,
  )
  scratchCam.updateMatrixWorld()
  return scratchCam
}

/** Project a globe-local unit direction at (yaw, pitch) through cam → canvas px; returns facing cosine. */
function projectLocal(
  dir: THREE.Vector3,
  yaw: number,
  pitch: number,
  cam: THREE.Camera,
  out: Vec2,
  radius = 1,
): number {
  _w.copy(dir).applyEuler(_e.set(pitch, yaw, 0, 'XYZ'))
  _v.copy(_w).multiplyScalar(rig.s * radius).add(rig.C)
  _toCam.copy(cam.position).sub(_v).normalize()
  const facing = _w.dot(_toCam)
  _v.project(cam)
  out[0] = ((_v.x + 1) / 2) * rig.w
  out[1] = ((1 - _v.y) / 2) * rig.h
  return facing
}

export interface AnchorSolve {
  yaw: number
  pitch: number
  /** residual, px */
  err: number
  /** the direction faces the camera at the solution */
  front: boolean
}

/**
 * Newton solve for (yaw, pitch) so that localDir projects to targetPx (canvas px)
 * at the target pose (opts.viewKm / opts.tilt default to the current targets).
 * Numeric Jacobian (eps 1e-4 rad), pitch clamped to ±1.25, step clamped to 0.5 rad.
 */
export function solveAnchor(
  localDir: THREE.Vector3,
  targetPx: Vec2,
  opts: { viewKm?: number; tilt?: number; yaw0?: number; pitch0?: number; iters?: number; radius?: number } = {},
): AnchorSolve {
  const g = globeState
  const viewKm = opts.viewKm ?? viewKmAtDepth(view.targetDepth)
  const cam = poseScratch(viewKm, opts.tilt ?? tiltFor(viewKm))
  let yaw = opts.yaw0 ?? g.targetYaw
  let pitch = opts.pitch0 ?? g.targetPitch
  const iters = opts.iters ?? 4
  const rad = opts.radius ?? 1
  const p0: Vec2 = [0, 0]
  const py: Vec2 = [0, 0]
  const pp: Vec2 = [0, 0]
  const EPS = 1e-4
  for (let i = 0; i < iters; i++) {
    projectLocal(localDir, yaw, pitch, cam, p0, rad)
    const fx = p0[0] - targetPx[0]
    const fy = p0[1] - targetPx[1]
    if (Math.hypot(fx, fy) < 0.01) break
    projectLocal(localDir, yaw + EPS, pitch, cam, py, rad)
    projectLocal(localDir, yaw, pitch + EPS, cam, pp, rad)
    const a = (py[0] - p0[0]) / EPS
    const c = (py[1] - p0[1]) / EPS
    const b = (pp[0] - p0[0]) / EPS
    const d = (pp[1] - p0[1]) / EPS
    const det = a * d - b * c
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) break
    let dYaw = (d * fx - b * fy) / det
    let dPitch = (-c * fx + a * fy) / det
    const m = Math.hypot(dYaw, dPitch)
    if (m > 0.5) {
      dYaw *= 0.5 / m
      dPitch *= 0.5 / m
    }
    yaw -= dYaw
    pitch = THREE.MathUtils.clamp(pitch - dPitch, -PITCH_MAX, PITCH_MAX)
  }
  const front = projectLocal(localDir, yaw, pitch, cam, p0, rad) > 0
  return { yaw, pitch, err: Math.hypot(p0[0] - targetPx[0], p0[1] - targetPx[1]), front }
}

/**
 * Globe-local unit direction under canvas pixel (x, y), or null (sky / off the disc).
 * 'current' = the rendered camera and globe; 'target' = the pose the view is heading to.
 */
export function rayLocal(x: number, y: number, which: 'current' | 'target'): THREE.Vector3 | null {
  const g = globeState
  let cam: THREE.Camera | null
  if (which === 'current') {
    cam = sceneRefs.camera
    if (!cam || !sceneRefs.inner) return null
  } else {
    const vk = viewKmAtDepth(view.targetDepth)
    cam = poseScratch(vk, tiltFor(vk))
  }
  _ndc.set((x / rig.w) * 2 - 1, -(y / rig.h) * 2 + 1)
  _ray.setFromCamera(_ndc, cam)
  if (!_ray.ray.intersectSphere(_sphere.set(rig.C, rig.s), _hit)) return null
  const dir = _hit.clone().sub(rig.C).normalize()
  if (which === 'current' && sceneRefs.inner) {
    sceneRefs.inner.getWorldQuaternion(_q)
    return dir.applyQuaternion(_q.invert())
  }
  // undo the inner rotation at the target angles (Euler XYZ: v_world = Rx·Ry·v_local)
  _q.setFromEuler(_e.set(g.targetPitch, g.targetYaw, 0, 'XYZ'))
  return dir.applyQuaternion(_q.invert())
}

function applySolve(sol: AnchorSolve): boolean {
  if (sol.err > ANCHOR_TOL_PX || !sol.front) return false
  globeState.targetYaw = sol.yaw
  globeState.targetPitch = sol.pitch
  return true
}

/** Angular-rate fallback (sky at tilt, off-disc drags): k = (viewKm/6371)/h rad per px. */
function rateRotate(dxPx: number, dyPx: number) {
  const g = globeState
  const k = viewKmAtDepth(view.targetDepth) / 6371 / Math.max(1, rig.h)
  g.targetYaw += dxPx * k
  g.targetPitch = THREE.MathUtils.clamp(g.targetPitch + dyPx * k, -PITCH_MAX, PITCH_MAX)
}

/**
 * The anchor of a wheel burst at a still cursor is held (not re-raycast per event),
 * so per-step solver residuals cannot accumulate into drift.
 */
const held = { dir: null as THREE.Vector3 | null, x: 0, y: 0, t: 0 }

/**
 * Zoom by dLn (ln units, + = in), keeping the surface under canvas px `about` (if on
 * the globe). `anchor` pins a specific globe-local direction to `about` instead
 * (pinch: the point grabbed at pinch start follows the midpoint, so it also pans).
 */
function zoomAt(dLn: number, about: Vec2 | null, anchor?: THREE.Vector3 | null) {
  const g = globeState
  const now = performance.now()
  let dir = anchor ?? null
  if (anchor === undefined && about) {
    const keep = held.dir && Math.hypot(about[0] - held.x, about[1] - held.y) < 2 && now - held.t < 400
    dir = keep ? held.dir : rayLocal(about[0], about[1], 'target')
    held.dir = dir
    held.x = about[0]
    held.y = about[1]
    held.t = now
  }
  const before = view.targetDepth
  view.targetDepth = clampDepth(before + dLn)
  view.tiltOverride = null
  g.lastInteraction = now
  stopInertia()
  if (!dir || !about || (anchor === undefined && view.targetDepth === before)) return
  applySolve(solveAnchor(dir, about))
}

// ———————————————————— programmatic API ————————————————————

let canvasEl: HTMLCanvasElement | null = null

function toCanvas(clientX: number, clientY: number): Vec2 {
  const r = canvasEl?.getBoundingClientRect()
  return [clientX - (r?.left ?? 0), clientY - (r?.top ?? 0)]
}

/**
 * Programmatic view controls (the theme's keyboard-accessible Zoom in / Zoom out /
 * Reset view). zoomBy(factor, aboutPx?): factor > 1 zooms in (the theme uses ×1.6
 * steps); aboutPx is a client-px anchor, default the view centre (screenTargetPx).
 * resetView(): back to the choreographed framing (depth 0, no tilt).
 */
export const globeActions = {
  zoomBy(factor: number, aboutPx?: [number, number]): void {
    if (!(factor > 0)) return
    zoomAt(Math.log(factor), aboutPx ? toCanvas(aboutPx[0], aboutPx[1]) : null)
  },
  resetView(): void {
    view.targetDepth = 0
    view.tiltOverride = null
    globeState.lastInteraction = performance.now()
  },
}

/**
 * Debug setView (window.__globe.setView): faces lat/lon at the view target, sets
 * viewKm and tilt, and snaps the current values so screenshots are deterministic.
 * Turns auto-rotate off (sticky) so the view stays put.
 */
export function debugSetView(v: { lat?: number; lon?: number; km?: number; tilt?: number }): void {
  const g = globeState
  stopInertia()
  fly = null
  g.autoRotate = false
  g.lastInteraction = performance.now()
  if (v.km !== undefined && v.km > 0) {
    view.targetDepth = clampDepth(rig.lnMax - Math.log(v.km))
    view.depth = view.targetDepth
  }
  if (v.tilt !== undefined) {
    view.tiltOverride = THREE.MathUtils.clamp(v.tilt, 0, 0.6)
    g.targetTilt = view.tiltOverride
    g.tilt = view.tiltOverride
  }
  if (v.lat !== undefined && v.lon !== undefined) {
    const f = facingAngles(v.lat, v.lon)
    g.targetYaw = nearestAngle(f.yaw, g.yaw)
    g.targetPitch = THREE.MathUtils.clamp(f.pitch, -PITCH_MAX, PITCH_MAX)
    g.yaw = g.targetYaw
    g.pitch = g.targetPitch
  }
}

// ———————————————————— fly-to (critique blocker 1) ————————————————————

let fly: { loc: TravelLocation; t0: number; dir: THREE.Vector3; depth: number } | null = null

/**
 * Fly to a place when its gallery opens. The view keeps its zoom when zoom01 < 0.05;
 * otherwise it zooms out to max(current, the largest view that keeps limbStage
 * 'full'). The place rests at the theme's sight point: 0.42 R from the projected
 * centre along anchors.sightBearing (β), solved with solveAnchor; near the poles
 * the nearest reachable bearing is used. Re-solved every frame (tickFly) until the
 * user interacts, so a fly started from the hero lands right after the scroll glide.
 */
export function flyTo(loc: TravelLocation, reducedMotion: boolean): void {
  const g = globeState
  stopInertia()
  const zoom01 = g.lod.zoom01
  let depth = view.targetDepth
  if (zoom01 >= 0.05) {
    // deepest depth whose silhouette still fits the full limb
    // the instrument's live free rect and limb table (phones: 28 px compact limb, top 52% band)
    const F = instrumentLayout.free
    const fit = Math.min(F.x1 - F.x0, F.y1 - F.y0) / 2 - 8
    const Rmax = fit - limbFor(fit - LIMB.full.rim, instrumentLayout.mobile).rim - 2
    if (Rmax > 0) {
      const f = rig.h / 2 / Math.tan((FOV * Math.PI) / 360)
      const d = Math.sqrt(rig.s * rig.s + ((f * rig.s) / Rmax) ** 2)
      const vFull = viewKmFromAlt(Math.max(d - rig.s, 1e-4), rig.s)
      depth = Math.min(depth, Math.max(0, rig.lnMax - Math.log(vFull)))
    } else depth = 0
  }
  fly = {
    loc,
    t0: performance.now(),
    dir: new THREE.Vector3(),
    depth,
  }
  // globe-local direction of the place (latLonToVec3 convention, unit)
  const phi = ((90 - loc.lat) * Math.PI) / 180
  const theta = ((loc.lon + 180) * Math.PI) / 180
  fly.dir.set(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))
  view.targetDepth = clampDepth(depth)
  tickFly(reducedMotion, true)
}

/** Solve the fly target for the current framing (called every frame by CameraRig). */
export function tickFly(reducedMotion: boolean, first = false): void {
  if (!fly) return
  const g = globeState
  const { active } = useSite.getState()
  if (active !== fly.loc || g.lastInteraction > fly.t0 || g.dragging) {
    fly = null
    return
  }
  view.targetDepth = clampDepth(fly.depth)
  const vk = viewKmAtDepth(view.targetDepth)
  const tilt = tiltFor(vk)
  const cam = poseScratch(vk, tilt)
  // projected centre and silhouette radius at the target pose
  _v.copy(rig.C).project(cam)
  const cx = ((_v.x + 1) / 2) * rig.w
  const cy = ((1 - _v.y) / 2) * rig.h
  const alt = Math.min(altFromViewKm(vk, rig.s), Math.max(CAM_Z - rig.s, 1e-4))
  const R = silhouetteR(rig.s, camDistance(rig.s, alt, tilt), rig.h)
  const f0 = facingAngles(fly.loc.lat, fly.loc.lon)
  const yaw0 = nearestAngle(f0.yaw, first ? g.yaw : g.targetYaw)
  const pitch0 = THREE.MathUtils.clamp(f0.pitch, -PITCH_MAX, PITCH_MAX)
  const beta = g.anchors.sightBearing
  let best: AnchorSolve | null = null
  let fallback: AnchorSolve | null = null
  // β first, then the nearest reachable bearing (poles: the pitch clamp), alternating ±15°
  for (let k = 0; k <= 24; k++) {
    const off = k === 0 ? 0 : (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2) * ((15 * Math.PI) / 180)
    const b = beta + off
    const target: Vec2 = [cx + Math.cos(b) * SIGHT_FRAC * R, cy + Math.sin(b) * SIGHT_FRAC * R]
    const sol = solveAnchor(fly.dir, target, { viewKm: vk, tilt, yaw0, pitch0, iters: 10, radius: PING_RADIUS })
    if (!sol.front) continue
    if (sol.err <= ANCHOR_TOL_PX) {
      best = sol
      break
    }
    if (!fallback || sol.err < fallback.err) fallback = sol
  }
  best ??= fallback
  g.targetYaw = best ? best.yaw : yaw0
  g.targetPitch = best ? best.pitch : pitch0
  if (reducedMotion) {
    g.yaw = g.targetYaw
    g.pitch = g.targetPitch
    view.depth = view.targetDepth
  }
}

// ———————————————————— inertia ————————————————————

const samples: { t: number; yaw: number; pitch: number }[] = []
const inertia = { vy: 0, vp: 0 }

function stopInertia() {
  inertia.vy = 0
  inertia.vp = 0
  samples.length = 0
}

/** Release inertia, decay λ 4 (called every frame by CameraRig). */
export function tickInertia(dt: number): void {
  if (inertia.vy === 0 && inertia.vp === 0) return
  const g = globeState
  g.targetYaw += inertia.vy * dt
  g.targetPitch = THREE.MathUtils.clamp(g.targetPitch + inertia.vp * dt, -PITCH_MAX, PITCH_MAX)
  const k = Math.exp(-INERTIA_DECAY * dt)
  inertia.vy *= k
  inertia.vp *= k
  if (Math.hypot(inertia.vy, inertia.vp) < 1e-3) stopInertia()
  else g.lastInteraction = performance.now()
}

// ———————————————————— ownership + per-frame upkeep ————————————————————

let lastPick = 0
let escapeActive = false
let lastWheelT = 0
let wheelOutStart = 0

/** true when canvas point (x, y) lies on the projected globe disc (per-frame disc) */
function onDiscCanvas(x: number, y: number): boolean {
  const g = globeState
  return Math.hypot(x - g.centerPx[0], y - g.centerPx[1]) < g.radiusPx * 1.01
}
function onDisc(clientX: number, clientY: number): boolean {
  if (!canvasEl) return false
  const [x, y] = toCanvas(clientX, clientY)
  return onDiscCanvas(x, y)
}

function wheelOwnerNow(now: number): 'page' | 'globe' {
  const g = globeState
  if (escapeActive && now - lastWheelT > ESCAPE_IDLE_MS) escapeActive = false
  return g.travelIn > 0.55 &&
    g.pointer.inCanvas &&
    !g.pointer.overUi &&
    (g.pointerInGlobe || g.lod.zoom01 > 0.001) &&
    !escapeActive
    ? 'globe'
    : 'page'
}

function refreshPointerTarget(x: number, y: number) {
  if (!canvasEl) return
  const hit = document.elementFromPoint(x, y)
  globeState.pointer.inCanvas = hit === canvasEl
  globeState.pointer.overUi = !!(hit as HTMLElement | null)?.closest?.(UI_SELECTOR)
}

/**
 * Per-frame control upkeep, called by CameraRig after the disc is re-measured:
 * pointerInGlobe + wheelOwner from the cached pointer (bug #1) and the ~10 Hz
 * hover re-pick (bug #3).
 */
export function tickControls(now: number): void {
  const g = globeState
  const p = g.pointer
  if (p.x < 0) {
    g.pointerInGlobe = false
    g.wheelOwner = 'page'
    return
  }
  const repick = now - lastPick > REPICK_MS
  if (repick) {
    lastPick = now
    // the page may have scrolled a DOM element under the still pointer
    refreshPointerTarget(p.x, p.y)
  }
  g.pointerInGlobe = onDisc(p.x, p.y)
  g.wheelOwner = wheelOwnerNow(now)

  if (repick && !g.dragging && canvasEl) {
    const { hovered, setHovered } = useSite.getState()
    const idx = p.inCanvas ? pickPin(p.x, p.y, canvasEl) : -1
    const hit = idx >= 0 ? locations[idx] : null
    if (hit !== hovered) setHovered(hit)
    const cur = hit ? 'pointer' : ''
    if (canvasEl.style.cursor !== cur) canvasEl.style.cursor = cur
  }
}

// ———————————————————— DOM listeners ————————————————————

export function attachControls(el: HTMLCanvasElement, ctx: { reducedMotion: boolean }): () => void {
  canvasEl = el
  el.style.touchAction = 'pan-y'
  let lastX = 0
  let lastY = 0
  let dragDist = 0
  let grabDir: THREE.Vector3 | null = null
  // active touches, for pinch-to-zoom
  const pointers = new Map<number, [number, number]>()
  let pinchDist = 0
  let pinchDir: THREE.Vector3 | null = null

  const pingAt = (clientX: number, clientY: number) => {
    const i = pickPin(clientX, clientY, el)
    return i >= 0 ? locations[i] : null
  }

  const track = (e: PointerEvent | WheelEvent) => {
    const g = globeState
    g.pointer.x = e.clientX
    g.pointer.y = e.clientY
    g.pointer.inCanvas = e.target === el
    g.pointer.overUi = !!(e.target as HTMLElement | null)?.closest?.(UI_SELECTOR)
    g.pointerInGlobe = onDisc(e.clientX, e.clientY)
    g.wheelOwner = wheelOwnerNow(performance.now())
  }

  const sample = () => {
    const now = performance.now()
    samples.push({ t: now, yaw: globeState.targetYaw, pitch: globeState.targetPitch })
    while (samples.length > 2 && now - samples[0].t > INERTIA_WINDOW_MS * 2) samples.shift()
  }

  /** move the grabbed surface point to the cursor (canvas px), else the rate fallback */
  const dragTo = (x: number, y: number, dx: number, dy: number) => {
    if (!(grabDir && applySolve(solveAnchor(grabDir, [x, y])))) {
      rateRotate(dx, dy)
      // re-grab whatever is under the cursor now (e.g. coming back onto the disc)
      grabDir = rayLocal(x, y, 'target')
    }
    globeState.lastInteraction = performance.now()
    sample()
  }

  const down = (e: PointerEvent) => {
    track(e)
    if (e.button !== 0 && e.pointerType === 'mouse') return
    pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1])
      globeState.dragging = false
      const m = toCanvas((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
      pinchDir = rayLocal(m[0], m[1], 'target')
      return
    }
    const g = globeState
    stopInertia()
    held.dir = null
    // catch the globe: grabbing stops whatever it was settling toward
    g.targetYaw = g.yaw
    g.targetPitch = g.pitch
    g.dragging = true
    g.lastInteraction = performance.now()
    lastX = e.clientX
    lastY = e.clientY
    dragDist = 0
    const [x, y] = toCanvas(e.clientX, e.clientY)
    grabDir = rayLocal(x, y, 'current')
    sample()
  }

  const move = (e: PointerEvent) => {
    track(e)
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.size === 2 && globeState.travelIn > 0.55) {
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      // bug #4: anchor about the pinch midpoint, like the wheel
      if (pinchDist > 0 && d > 0) zoomAt(Math.log(d / pinchDist), toCanvas((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), pinchDir)
      pinchDist = d
      return
    }
    if (globeState.dragging) {
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      const wasStill = dragDist < 3
      dragDist += Math.abs(dx) + Math.abs(dy)
      // bug #3: a real drag started — the tooltip must not stick to a moving pin
      if (wasStill && dragDist >= 3) {
        const { hovered, setHovered } = useSite.getState()
        if (hovered) setHovered(null)
        el.style.cursor = ''
      }
      const [x, y] = toCanvas(e.clientX, e.clientY)
      dragTo(x, y, dx, dy)
    } else if (e.target === el) {
      const hit = pingAt(e.clientX, e.clientY)
      const { hovered, setHovered } = useSite.getState()
      if (hit !== hovered) setHovered(hit)
      el.style.cursor = hit ? 'pointer' : ''
      lastPick = performance.now()
    }
  }

  // Wheel (capture phase on window, so the owner is settled before Lenis sees it):
  //  - mouse wheel and trackpad pinch (ctrlKey) zoom toward the cursor
  //  - once leaned in (zoom01 > 0.02), a trackpad two-finger scroll pans via the drag path
  //  - fully zoomed out and still wheeling out for 350 ms hands the wheel to the page
  const wheel = (e: WheelEvent) => {
    const g = globeState
    const now = performance.now()
    track(e)
    const prevWheel = lastWheelT
    lastWheelT = now
    if (g.wheelOwner !== 'globe') return
    const atWidest = view.targetDepth <= 1e-4 && g.lod.zoom01 <= 0.002
    if (atWidest && e.deltaY > 0 && !e.ctrlKey) {
      if (!wheelOutStart || now - prevWheel > ESCAPE_IDLE_MS) wheelOutStart = now
      if (now - wheelOutStart >= ESCAPE_MS) {
        escapeActive = true
        wheelOutStart = 0
        g.wheelOwner = 'page'
        return // the page (Lenis) scrolls this one
      }
    } else wheelOutStart = 0
    e.preventDefault()
    const [x, y] = toCanvas(e.clientX, e.clientY)
    const trackpad =
      e.deltaMode === 0 && (e.deltaX !== 0 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)))
    if (trackpad && !e.ctrlKey && g.lod.zoom01 > 0.02) {
      stopInertia()
      held.dir = null
      const dir = rayLocal(x, y, 'target')
      if (!(dir && applySolve(solveAnchor(dir, [x - e.deltaX, y - e.deltaY])))) rateRotate(-e.deltaX, -e.deltaY)
      g.lastInteraction = now
      return
    }
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
    zoomAt(-dy * (e.ctrlKey ? PINCH_K : WHEEL_K), [x, y])
  }

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    pinchDist = 0
    const wasDragging = globeState.dragging
    globeState.dragging = false
    globeState.lastInteraction = performance.now()
    grabDir = null
    // release inertia from the last 80 ms of the drag (none under reduced motion)
    if (wasDragging && !ctx.reducedMotion && dragDist >= 8 && samples.length >= 2) {
      const now = performance.now()
      const last = samples[samples.length - 1]
      let first = last
      for (let i = samples.length - 1; i >= 0 && now - samples[i].t <= INERTIA_WINDOW_MS; i--) first = samples[i]
      const span = (last.t - first.t) / 1000
      if (now - last.t < INERTIA_WINDOW_MS && span > 0.008) {
        inertia.vy = (last.yaw - first.yaw) / span
        inertia.vp = (last.pitch - first.pitch) / span
      }
      samples.length = 0
    } else stopInertia()
    if (wasDragging && dragDist < 8 && e.target === el) {
      const hit = pingAt(e.clientX, e.clientY)
      if (hit) {
        useSite.getState().setActive(hit)
        // a ping pressed from the hero/work sections glides you to the globe
        const travelEl = document.getElementById('travel')
        if (travelEl && travelEl.getBoundingClientRect().top > window.innerHeight * 0.35) {
          // bug #2: Lenis owns the scroll; native smooth scroll would fight it
          const lenis = getLenis()
          if (lenis) lenis.scrollTo(travelEl, { duration: 1.4 })
          else travelEl.scrollIntoView({ behavior: ctx.reducedMotion ? 'auto' : 'smooth' })
        }
      }
    }
  }
  const leave = () => {
    globeState.pointer.inCanvas = false
    const { hovered, setHovered } = useSite.getState()
    if (hovered) setHovered(null)
    el.style.cursor = ''
  }
  // double-click: zoom ×2.2 toward the point under the cursor (travel only, bug #7);
  // off the globe it resets to the framing
  const dbl = (e: MouseEvent) => {
    if (e.target !== el || globeState.travelIn <= 0.55) return
    const [x, y] = toCanvas(e.clientX, e.clientY)
    if (!rayLocal(x, y, 'target')) {
      globeActions.resetView()
      return
    }
    zoomAt(Math.log(2.2), [x, y])
  }
  // touch scrolling fires pointercancel, not pointerup — without this the
  // globe keeps rotating with every scroll gesture
  const cancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    pinchDist = 0
    grabDir = null
    globeState.dragging = false
    globeState.lastInteraction = performance.now()
    stopInertia()
  }
  el.addEventListener('pointerdown', down)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  el.addEventListener('pointerleave', leave)
  el.addEventListener('dblclick', dbl)
  window.addEventListener('wheel', wheel, { passive: false, capture: true })
  return () => {
    el.removeEventListener('pointerdown', down)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    el.removeEventListener('pointerleave', leave)
    el.removeEventListener('dblclick', dbl)
    window.removeEventListener('wheel', wheel, { capture: true })
    if (canvasEl === el) canvasEl = null
  }
}
