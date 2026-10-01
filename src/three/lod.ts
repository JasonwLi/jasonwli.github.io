/**
 * Level-of-detail bus (plan §4). computeLod runs once per frame inside the
 * CameraRig frame (priority −3) and fills globeState.lod; no layer re-derives
 * these thresholds. C1 owns after F0.
 *
 * The theme's deep-zoom gates were written in 'zoom ×' units; VIEW_GATES is the
 * binding translation to viewKm (critique 12). Layers read the fades on the bus;
 * the gates are exported for overlays (view controls) and checks.
 */
import type { LodBus, Tier } from './globeState'
import { EARTH_KM, EXAG } from './geo/radii'

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function computeLod(
  viewKm: number,
  tilt: number,
  altitudeR: number,
  tier: Tier,
  radiusPx: number,
  viewport: { w: number; h: number; freeLeftPx: number },
  out: LodBus,
): void {
  const cube = tier !== 'low'
  out.viewKm = viewKm
  out.tilt = tilt
  out.altitudeR = altitudeR
  // projection-true scale at the view target from the silhouette: R_px = f/√(d²−1),
  // target scale = f/(d−1) with d = 1 + altitudeR, so px/radius = R_px·√((d+1)/(d−1)).
  // (viewport.h / viewKm was ~2.4× too small on phones, where the globe band is not
  // the viewport height.) Fallback before the disc is measured.
  const alt = Math.max(altitudeR, 1e-6)
  out.pxPerKm =
    radiusPx > 2 ? (radiusPx * Math.sqrt((2 + alt) / alt)) / EARTH_KM : viewport.h / Math.max(viewKm, 1e-3)
  out.displaceFade = cube ? smoothstep(1500, 1000, viewKm) : 0
  out.heightScale = (EXAG * out.displaceFade) / (EARTH_KM * 1000)
  out.detailFade = smoothstep(4000, 2000, viewKm)
  out.waveFade = smoothstep(3000, 1500, viewKm)
  // vector ribbons fade in exactly as the raster rivers fade out (look.riverOutKm 4500 → 3500)
  out.ribbonFade = smoothstep(4500, 3500, viewKm)
  // 3D monuments: a quick on/off at the 1600 km gate (Monuments: on < 1600, off > 1620)
  out.monument3dFade = cube ? smoothstep(1620, 1600, viewKm) : 0
  // glyphs: in 6000 → 5200; out 1100 → 950 (per landmark they hand off earlier, as soon as
  // that landmark's 3D monument is legible: LandmarkGlyphs + monumentShown; LOW: no lower limit)
  out.glyphFade = smoothstep(6000, 5200, viewKm) * (cube ? smoothstep(950, 1100, viewKm) : 1)
  out.treeFade = cube ? smoothstep(1400, 1000, viewKm) * smoothstep(0.05, 0.2, tilt) : 0
  out.labelTier = viewKm > 9000 ? 0 : viewKm > 5000 ? 1 : viewKm > 2500 ? 2 : viewKm > 1000 ? 3 : 4
  // limbFade: the limb fades by limb stage only; anchors.ts writes it once the stage is known
  out.atmosphereFade = smoothstep(0.2, 0.6, altitudeR)
}

/** zoom01 = (ln max − ln view) / (ln max − ln min), clamped 0..1. */
export function zoom01(viewKm: number, maxViewKm: number, minViewKm: number): number {
  const den = Math.log(maxViewKm) - Math.log(minViewKm)
  if (den <= 0) return 0
  return Math.min(1, Math.max(0, (Math.log(maxViewKm) - Math.log(viewKm)) / den))
}

/**
 * Theme zoom gates in viewKm (critique 12). Monuments, place labels and trees match
 * the fades above (monument3dFade starts at 1600, PlaceLabels below 2500,
 * treeFade starts at 1400); the view controls show once zoom01 > 0.05.
 */
export const VIEW_GATES = {
  /** T1c Zoom in / Zoom out / Reset buttons (also gates auto-rotate) */
  viewControlsZoom01: 0.05,
  monumentsKm: 1600,
  placeLabelsKm: 2500,
  treesKm: 1400,
  /** tilt ramp: 0 above, TILT_MAX[tier] at/below */
  tiltStartKm: 2500,
  tiltFullKm: 900,
} as const

/** True when the theme's view controls should show (travel only; caller checks travelIn > 0.55). */
export function viewControlsVisible(lod: LodBus): boolean {
  return lod.zoom01 > VIEW_GATES.viewControlsZoom01
}

/** Tilt target for a view span: TILT_MAX · smoothstep(2500, 900, viewKm). */
export function tiltForViewKm(viewKm: number, tiltMax: number): number {
  return tiltMax * smoothstep(VIEW_GATES.tiltStartKm, VIEW_GATES.tiltFullKm, viewKm)
}
