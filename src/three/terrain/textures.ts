/**
 * Terrain texture registry (types frozen by F0; C2a fills it). Layers read the
 * current set from `terrainTextures` and subscribe for stage changes.
 * Colour spaces (R1/R7): albedo, koppenColor and previews.albedo are sRGB; every
 * other texture is NoColorSpace data built from lossless images.
 */
import type { CompressedArrayTexture, CompressedCubeTexture, CubeTexture, Texture } from 'three'

export interface TerrainTextures {
  /** stage A: shared equirect preview (albedo sRGB, data = lowData packing) */
  preview?: { albedo: Texture; data: Texture }
  /** LOW tier equirects */
  albedoEq?: Texture
  dataEq?: Texture
  koppenColorEq?: Texture
  /** MID/HIGH cubes */
  albedo?: CompressedCubeTexture
  terrain?: CubeTexture
  hydro?: CubeTexture
  heightHi?: CubeTexture
  splatA?: CubeTexture
  splatB?: CubeTexture
  splatC?: CubeTexture
  detail?: CompressedArrayTexture
  koppenColor?: CompressedCubeTexture
  koppenIdx?: CubeTexture
}

export const terrainTextures: TerrainTextures = {}

const listeners = new Set<(t: TerrainTextures) => void>()

/** Subscribe to texture-set changes; returns an unsubscribe function. */
export function onTerrainTextures(cb: (t: TerrainTextures) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Publish after mutating terrainTextures (C2a). */
export function emitTerrainTextures(): void {
  for (const cb of listeners) cb(terrainTextures)
}
