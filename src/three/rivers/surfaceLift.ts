/**
 * GPU terrain height for surface dressing (C6: river ribbons and trees).
 *
 * Why not the CPU height grid (geo/heightGrid, what pins use): the terrain MESH is
 * displaced from heightHi (HIGH) or the terrain cube (MID) at up to ~5 km texels, while
 * the CPU grid is a ~20 km equirect. Measured on D1/D2 data over the Alpine rivers
 * (459 river vertices, 44-48.5N 5-16E): grid - heightHi = p5 -27 m, p50 +45 m,
 * p95 +577 m, min -510 m, max +1106 m; x EXAG 12 that is ribbons floating up to 13 km
 * over their valleys or buried 6 km under the mesh. Sampling the very texture the mesh
 * uses, at the mip the mesh uses, makes ribbons and trees sit on the drawn relief.
 *
 * Same decode as terrain.vert: h_m = sq(tex.r) * 9000 (sqrt encoding), r = 1 + h * uHeightScale.
 * Mip: the mesh samples log2(faceSize / vertsPerFaceEdge); its vertex spacing is about
 * patchPx / 32 screen px, so the mip follows from the local units-per-pixel.
 */
import { CubeTexture, Texture, type IUniform } from 'three'
import { onTerrainTextures, terrainTextures, type TerrainTextures } from '../terrain/textures'
import { dummyCube } from '../terrain/materials/dummies'
import { look } from '../terrain/look'
import type { Tier } from '../globeState'

export interface LiftUniforms {
  [k: string]: IUniform
  uHgt: IUniform<Texture>
  uHgtOn: IUniform<number>
  uHgtTexel: IUniform<number> // rad per texel at mip 0
  uHgtMeshPx: IUniform<number> // mesh vertex spacing, screen px
  uHeightScale: IUniform<number>
  uViewH: IUniform<number>
}

/** GLSL (vertex): terrain height in metres at unit direction d given local units per px. */
export const liftGLSL = /* glsl */ `
uniform samplerCube uHgt;
uniform float uHgtOn;
uniform float uHgtTexel;
uniform float uHgtMeshPx;
uniform float uHeightScale;
uniform float uViewH;
float terrainHeightM(vec3 d, float unitsPerPx) {
  if (uHgtOn < 0.5 || uHeightScale <= 0.0) return 0.0;
  float mip = max(0.0, log2(max(uHgtMeshPx * unitsPerPx / uHgtTexel, 1.0)));
  float r = textureLod(uHgt, d, mip).r;
  return r * r * 9000.0;
}
// local (globe radius) units per CSS px at a view-space position
float unitsPerPxAt(vec4 pv) {
  float wsc = length(modelViewMatrix[0].xyz);
  return max(-pv.z, 1e-6) / (projectionMatrix[1][1] * 0.5 * uViewH) / max(wsc, 1e-6);
}
`

function faceSize(t: Texture | undefined): number {
  if (!t) return 256
  const img = (t as unknown as { image: unknown }).image
  const first = Array.isArray(img) ? img[0] : img
  const w = (first as { width?: number } | undefined)?.width ?? (first as { image?: { width?: number } } | undefined)?.image?.width
  return typeof w === 'number' && w > 0 ? w : 256
}

export function makeLiftUniforms(tier: Tier): LiftUniforms {
  const patchPx = tier === 'high' ? look.patchPx.high : look.patchPx.mid
  return {
    uHgt: { value: dummyCube() },
    uHgtOn: { value: 0 },
    uHgtTexel: { value: Math.PI / 2 / 256 },
    // the quadtree splits at patchPx; a live patch spans patchPx/2..patchPx -> ~0.75 * patchPx / 32
    uHgtMeshPx: { value: (0.75 * patchPx) / 32 },
    uHeightScale: { value: 0 },
    uViewH: { value: 1 },
  }
}

/** Keep uHgt on the texture the terrain mesh displaces with (heightHi, else the terrain cube). */
export function bindLift(u: LiftUniforms): () => void {
  const apply = (t: TerrainTextures) => {
    const tex: CubeTexture | undefined = t.heightHi ?? t.terrain
    u.uHgt.value = tex ?? dummyCube()
    u.uHgtOn.value = tex ? 1 : 0
    u.uHgtTexel.value = Math.PI / 2 / faceSize(tex)
  }
  apply(terrainTextures)
  return onTerrainTextures(apply)
}

/**
 * Tree clearance from rivers (C6): hydro.r = 1 - d / 24 km (the terrain shader's river
 * band, ranks <= 9). riverClear(d) is 0 within RIVER_CLEAR_KM of a river centreline and
 * ramps to 1 by 1.4x that, so no tree stands in a ribbon; also 0 on lakes (hydro.g lake
 * SDF, 0.5 = shore, + water, +-64 km) and within ~1 km of their shores.
 */
export const RIVER_CLEAR_KM = 3.6
export const hydroGLSL = /* glsl */ `
uniform samplerCube uHydro;
uniform float uHydroOn;
float riverClear(vec3 d) {
  if (uHydroOn < 0.5) return 1.0;
  vec2 hy = textureLod(uHydro, d, 0.0).rg;
  float dist = (1.0 - hy.r) * 24.0;
  float lakeKm = (hy.g - 0.5) * 128.0; // lake SDF: 0.5 = shore, + inside water, +-64 km
  return smoothstep(${RIVER_CLEAR_KM.toFixed(2)}, ${(RIVER_CLEAR_KM * 1.4).toFixed(2)}, dist)
       * (1.0 - smoothstep(-2.5, -0.5, lakeKm));
}
`

export interface HydroUniforms {
  [k: string]: IUniform
  uHydro: IUniform<Texture>
  uHydroOn: IUniform<number>
}

export function makeHydroUniforms(): HydroUniforms {
  return { uHydro: { value: dummyCube() }, uHydroOn: { value: 0 } }
}

export function bindHydro(u: HydroUniforms): () => void {
  const apply = (t: TerrainTextures) => {
    u.uHydro.value = t.hydro ?? dummyCube()
    u.uHydroOn.value = t.hydro ? 1 : 0
  }
  apply(terrainTextures)
  return onTerrainTextures(apply)
}
