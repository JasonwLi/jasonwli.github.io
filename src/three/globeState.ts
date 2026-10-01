/**
 * Mutable, frame-loop-owned globe state. Lives outside React to avoid re-renders.
 *
 * CONTRACT (frozen by F0): add fields, never rename. (The legacy zoom/targetZoom
 * were removed by INT once logViewKm drove the camera.)
 */

export type Tier = 'low' | 'mid' | 'high'
export type MapMode = 'terrain' | 'climate'
/** Texture load stages (manifest.stages). Not the theme's limb stages; see LimbStage. */
export type TerrainStage = 'none' | 'A' | 'B' | 'C' | 'D'
export type Vec2 = [number, number]
/** The theme's deep-zoom instrument stages (renamed from its 'A/B/C' to avoid a clash). */
export type LimbStage = 'full' | 'arc' | 'neatline'
/** 'rim': readout hangs outside the rim at sightBearing. 'below': the beta=180deg fallback, one centred line under the limb. */
export type ReadoutSide = 'rim' | 'below'

/** Per-frame level-of-detail bus, written once per frame by lod.ts computeLod() inside the CameraRig frame. Every layer reads it; none re-derives thresholds. */
export interface LodBus {
  viewKm: number // vertical ground span at the view target, km
  zoom01: number // 0 at choreographed framing .. 1 at tier minViewKm (log space)
  altitudeR: number // camera height above target surface, globe radii
  tilt: number // camera tilt from nadir, rad
  pxPerKm: number // CSS px per km at target
  heightScale: number // radius units per metre = EXAG * displaceFade / 6371000
  displaceFade: number
  detailFade: number
  waveFade: number
  ribbonFade: number
  treeFade: number
  monument3dFade: number
  glyphFade: number
  labelTier: 0 | 1 | 2 | 3 | 4
  limbFade: number
  atmosphereFade: number
}

/** Neatline (limbStage 'neatline') registration data: true ray/sphere crossings of the viewport edges. */
export interface NeatlineAnchors {
  /** packed crossings: [edge(0 top,1 right,2 bottom,3 left), alongPx, lat, lon] x n */
  edges: Float32Array
  /** graduation interval in degrees chosen for the current scale */
  interval: number
  /** packed [edge, alongPx] where the edge leaves the globe (sky-facing span starts) */
  horizonNotches: Float32Array
}

/**
 * Screen-space anchors for the DOM instrument overlay (CSS px relative to the canvas).
 * Written by I1 each frame (F0 ships a basic version in instrument/anchors.ts).
 * I1 supplies raw signals only; T1's overlay owns the DOM timeline.
 */
export interface InstrumentAnchors {
  globeCenterPx: Vec2 // projected globe centre C
  radiusPx: number // true silhouette radius f*Rw/sqrt(d^2-Rw^2)
  silhouetteRpx: number // same value as radiusPx (named for the theme's limb geometry)
  limbRotation: number // rad; the limb scale turns with the globe (= -lambdaC in rad, wrapped)
  lambdaC: number // deg; longitude of the sub-camera (view-centre) surface point
  phiC: number // deg; latitude of the sub-camera surface point
  limbStage: LimbStage // with 10% hysteresis on visibleArcFrac
  visibleArcFrac: number // 0..1 fraction of the rim circle inside the free rect
  fiducialAngle: number // rad, CSS screen space; 12 o'clock (-PI/2) in 'full', mid visible arc in 'arc'
  activeIndex: number // index into locations (first-visit order), -1 none
  activePx: Vec2 | null
  activeVisible: number // 0..1 horizon fade
  activeFacing: number // cosine between the pin normal and the view direction (<0 = far side)
  activeOcculted: boolean // true when the active pin is behind the globe
  activeSettled: boolean // pin screen speed < 20 px/s for 120 ms
  hoverIndex: number
  hoverPx: Vec2 | null
  hoverVisible: number
  alidadeAngle: number // rad, CSS screen space (0 = +x, clockwise positive); raw atan2 each frame, held within 0.08R
  limbMarkPx: Vec2 | null // point on the limb at alidadeAngle where the readout leader lands
  sightBearing: number // rad; the chosen beta from the theme's fit rule
  readoutSide: ReadoutSide
  loadProgress: number // 0..1, globeState.loadProgress damped (lambda 8)
  limbOpacity: number // per-section rule (hero 1, work fades, travel smoothstep, footer 0)
  pinScale: number // per-section pin size multiplier
  routeOpacity: number // hero 0.55, work follows dim, travel 1, climate x0.6
  travelArmed: boolean // true after travelIn rises past 0.5; re-armed (false) below 0.2
  travelArmSeq: number // increments on each arm edge (one-shot engrave trigger)
  camChanged: boolean // camera or globe pose changed this frame (neatline sampling gate)
  neatline: NeatlineAnchors
}

export const LOD_DEFAULT: LodBus = {
  viewKm: 20000, zoom01: 0, altitudeR: 3, tilt: 0, pxPerKm: 0.05, heightScale: 0,
  displaceFade: 0, detailFade: 0, waveFade: 0, ribbonFade: 0, treeFade: 0,
  monument3dFade: 0, glyphFade: 0, labelTier: 0, limbFade: 1, atmosphereFade: 1,
}

export const ANCHORS_DEFAULT: InstrumentAnchors = {
  globeCenterPx: [0, 0], radiusPx: 1, silhouetteRpx: 1, limbRotation: 0, lambdaC: 0, phiC: 0,
  limbStage: 'full', visibleArcFrac: 1, fiducialAngle: -Math.PI / 2,
  activeIndex: -1, activePx: null, activeVisible: 0, activeFacing: 0, activeOcculted: false,
  activeSettled: false, hoverIndex: -1, hoverPx: null, hoverVisible: 0, alidadeAngle: 0,
  limbMarkPx: null, sightBearing: (-40 * Math.PI) / 180, readoutSide: 'rim', loadProgress: 0,
  limbOpacity: 1, pinScale: 1, routeOpacity: 0.55, travelArmed: false, travelArmSeq: 0,
  camChanged: true,
  neatline: { edges: new Float32Array(0), interval: 10, horizonNotches: new Float32Array(0) },
}

function freshAnchors(): InstrumentAnchors {
  return {
    ...ANCHORS_DEFAULT,
    globeCenterPx: [0, 0],
    neatline: { edges: new Float32Array(0), interval: 10, horizonNotches: new Float32Array(0) },
  }
}

// initial view faces ~25°N 45°E — the Cairo↔Balkans↔SE-Asia heart of the route
export const globeState = {
  yaw: -2.44,
  pitch: 0.44,
  targetYaw: -2.44,
  targetPitch: 0.44,
  autoRotate: true,
  dragging: false,
  lastInteraction: 0,
  /** smoothed placement, driven by scroll each frame */
  posX: 0,
  posY: 0,
  scale: 1,
  dim: 0,
  /** how far the travel section owns the viewport, 0..1 (written each frame) */
  travelIn: 0,
  /** scroll progress into the work log / footer, 0..1 (written each frame by CameraRig) */
  workIn: 0,
  footIn: 0,
  /** true while the pointer sits over the globe's projected disc (recomputed every frame) */
  pointerInGlobe: false,
  /** projected disc, in canvas px — the drag/zoom maths grab the surface with these (every frame) */
  radiusPx: 1,
  centerPx: [0, 0] as [number, number],

  // ---- F0 additions ----
  logViewKm: Math.log(20000),
  targetLogViewKm: Math.log(20000),
  minViewKm: 500,
  maxViewKm: 20000,
  tilt: 0,
  targetTilt: 0,
  tier: 'mid' as Tier,
  /** pointer:coarse && min(w,h) < 600 (set by probeTier). No trees, visited-only monuments. */
  isPhone: false,
  stage: 'none' as TerrainStage,
  /** raw bytes received / total for stages A+B (C2a publishes; anchors.loadProgress is the damped copy) */
  loadProgress: 0,
  /** a globe surface (loading sphere or real globe) is mounted; pins render only when true (bug #5) */
  surfaceReady: false,
  mapMode: 'terrain' as MapMode,
  modeMix: 0, // 0 terrain .. 1 climate (damped)
  targetModeMix: 0,
  /** Köppen group isolated in climate mode: 0..4 = A..E, -1 none (mirrors store.isolateGroup) */
  isolateGroup: -1,
  season: 0, // -1..1, +1 = northern mid-winter; set once from visitor date or ?season=YYYY-MM-DD
  /** last known pointer (client px), updated on pointermove/pointerdown; hit tests re-run every frame */
  pointer: { x: -1, y: -1, inCanvas: false, overUi: false },
  wheelOwner: 'page' as 'page' | 'globe',
  viewport: { w: 1, h: 1, freeLeftPx: 0 },
  /** 4 floats per location (locations order): x, y (CSS px), visible 0..1, pickRadiusPx */
  pinsPx: new Float32Array(0),
  lod: { ...LOD_DEFAULT } as LodBus,
  anchors: freshAnchors(),
}

// ---- frame bus (module level) ----
const frameListeners = new Set<(dt: number) => void>()
/** DOM overlays subscribe here to update in the same frame as the canvas. */
export function subscribeFrame(cb: (dt: number) => void): () => void {
  frameListeners.add(cb)
  return () => {
    frameListeners.delete(cb)
  }
}
/** Called once per frame by the instrument frame (after the camera and anchors are final). */
export function emitFrame(dt: number): void {
  for (const cb of frameListeners) cb(dt)
}

/** Season from ?season=YYYY-MM-DD or today: cos(2π(dayOfYear − 15)/365.25); +1 = northern mid-winter. */
export function seasonFor(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const day = Math.floor((date.getTime() - start) / 86400000) + 1
  return Math.cos((2 * Math.PI * (day - 15)) / 365.25)
}

function initSeason() {
  if (typeof window === 'undefined') return
  const q = new URLSearchParams(window.location.search).get('season')
  const d = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? new Date(`${q}T12:00:00Z`) : new Date()
  globeState.season = seasonFor(Number.isNaN(d.getTime()) ? new Date() : d)
}
initSeason()
