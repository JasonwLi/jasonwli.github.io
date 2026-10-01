/**
 * Radii contract (radius units, globe R = 1). Frozen by F0; INT tunes LIFT values.
 * Every layer that sits on the surface computes surfaceRadius(lat, lon, lod.heightScale)
 * and adds its LIFT so pins, labels, glyphs, ribbons and the route agree.
 */
import { sampleHeightM } from './heightGrid.ts'

export const EARTH_KM = 6371
/** vertical exaggeration of displaced terrain */
export const EXAG = 12
export const R_SURFACE = 1.0
/** surface lifts per layer. The route has no LIFT entry: its parabola + terrain floor live in RouteLine. */
export const LIFT = { pin: 0.0025, label: 0.0035, glyph: 0.003, ribbon: 0.0006 } as const
/** hover tooltip offset above the pin, CSS px */
export const HOVER_LIFT_PX = 28
/** max camera tilt from nadir, rad (critique: 'slight' tilt, 22° on mid/high) */
export const TILT_MAX = { low: 0.25, mid: 0.38, high: 0.38 } as const
export const MIN_VIEW_KM = { low: 1200, mid: 500, high: 300 } as const

/** 1 + sampleHeightM(lat, lon) * heightScale (heightScale = lod.heightScale, 0 when not displaced) */
export function surfaceRadius(lat: number, lon: number, heightScale: number): number {
  return heightScale === 0 ? R_SURFACE : R_SURFACE + sampleHeightM(lat, lon) * heightScale
}
