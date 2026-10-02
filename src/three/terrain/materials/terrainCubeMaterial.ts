/**
 * MID/HIGH cube-path material (C2b): terrain.vert + terrain.frag, uniforms from look.ts.
 * bindCubeTextures() maps the loader's registry onto the samplers (dummies + uHas flags
 * for anything not loaded yet). Loader textures are immutable: never touch filters.
 */
import { Color, DoubleSide, GLSL3, Matrix3, ShaderMaterial, Vector2, Vector3, type IUniform, type Texture } from 'three'
import { climateUniforms } from '../shaders/climate.glsl'
import { seasonUniforms } from '../season'
import { terrainFrag } from '../shaders/terrain.frag'
import { terrainVert } from '../shaders/terrain.vert'
import type { TerrainTextures } from '../textures'
import { look } from '../look'
import { dummy2D, dummyArray, dummyCube, dummySeaCube } from './dummies'

type U = Record<string, IUniform>

function faceSizeOf(t: Texture | undefined, fallback: number): number {
  if (!t) return fallback
  const img = (t as unknown as { image: unknown }).image
  const first = Array.isArray(img) ? img[0] : img
  const w = (first as { width?: number; image?: { width?: number } } | undefined)?.width
    ?? (first as { image?: { width?: number } } | undefined)?.image?.width
  return typeof w === 'number' && w > 0 ? w : fallback
}

export function createTerrainCubeMaterial(): ShaderMaterial {
  const lv = new Vector3(...look.lightView).normalize()
  const uniforms: U = {
    uTerrain: { value: dummySeaCube() },
    uHydro: { value: dummyCube() },
    uAlbedo: { value: dummyCube() },
    uHeightHi: { value: dummyCube() },
    uHasHeightHi: { value: 0 },
    uSplatA: { value: dummyCube() },
    uSplatB: { value: dummyCube() },
    uSplatC: { value: dummyCube() },
    uDetail: { value: dummyArray() },
    uHasDetail: { value: 0 },
    uPrevAlbedo: { value: dummy2D() },
    uStageMix: { value: 1 },
    uTerrainSize: { value: 256 },
    uHeightHiSize: { value: 256 },
    uTexelAngle: { value: Math.PI / 2 / 256 },
    uTexelAngleHi: { value: Math.PI / 2 / 256 },
    uHeightScale: { value: 0 },
    uSkirtDepth: { value: look.skirtDepth },
    uNormalView: { value: new Matrix3() },
    uLightView: { value: lv },
    uDay: { value: new Vector2(...look.day) },
    uReliefExag: { value: look.reliefExag.far },
    uReliefGain: { value: look.reliefGain },
    uReliefMin: { value: look.reliefMin },
    uReliefMax: { value: look.reliefMax },
    uSeaRelief: { value: look.seaRelief },
    uReliefStrength: { value: 0 },
    uLandCap: { value: look.landLumaCap },
    uSnowCap: { value: look.snowLumaCap },
    uCapKnee: { value: look.capKnee },
    cShelf: { value: new Color(look.shelf) },
    cDeep: { value: new Color(look.deep) },
    cAbyss: { value: new Color(look.abyss) },
    cCoastLine: { value: new Color(look.coastLine) },
    cFoam: { value: new Color(look.foam) },
    cRiver: { value: new Color(look.river) },
    cLake: { value: new Color(look.lake) },
    cSnow: { value: new Color(look.snow) },
    cSnowShadow: { value: new Color(look.snowShadow) },
    uBandStepM: { value: look.bandStepM },
    uBandAmount: { value: look.bandAmount },
    uCoastLineKm: { value: look.coastLineKm },
    uCoastLinePx: { value: look.coastLinePx },
    uCoastLineAlpha: { value: look.coastLineAlpha },
    uFoamWidthKm: { value: look.foamWidthKm },
    uFoamAlpha: { value: look.foamAlpha },
    uWaveAmount: { value: look.waveAmount },
    uWaveFade: { value: 0 },
    uRiverPx: { value: look.riverPx },
    uRiverMinKm: { value: look.riverMinKm },
    uRiverTexel: { value: Math.PI / 2 / 256 },
    uRiverAlpha: { value: 0 },
    uRiverCrestMin: { value: 0 },
    uSeason: { value: 0 },
    uSnowReach: { value: look.snowWinterReach },
    uSnowBias: { value: look.snowBias },
    uDetailFade: { value: 0 },
    uDetailScaleKm: { value: new Vector2(...look.detailScaleKm) },
    uDetailMinTilePx: { value: new Vector2(...look.detailMinTilePx) },
    uDetailStrength: { value: [...look.detailStrength] },
    uModeMix: { value: 0 },
    uHasKoppen: { value: 0 },
    uDim: { value: 0 },
    ...climateUniforms(),
    ...seasonUniforms(),
  }
  const m = new ShaderMaterial({
    name: 'terrain-cube',
    glslVersion: GLSL3,
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms,
    side: DoubleSide, // face winding differs across the GL table; skirts face both ways
    depthWrite: true,
    depthTest: true,
  })
  return m
}

/**
 * The crest a river of width w km leaves in the baked 1 - d/24 km field once averaged over
 * a T km texel (river centred in the texel): wider (lower scalerank) rivers crest higher,
 * so a crest floor is a stream-order proxy for the raster (finish review).
 */
export function riverCrestFor(w: number, T: number): number {
  const a = Math.max(0, (T - w) / 2)
  return (Math.min(w, T) + 2 * (a - (a * a) / 48)) / T
}

/** Bind the registry to the samplers. Returns true when the stage-B core (albedo, terrain, hydro) is bound. */
export function bindCubeTextures(m: ShaderMaterial, t: TerrainTextures): boolean {
  const u = m.uniforms
  const core = !!(t.albedo && t.terrain && t.hydro)
  u.uAlbedo.value = t.albedo ?? dummyCube()
  u.uTerrain.value = t.terrain ?? dummySeaCube()
  u.uHydro.value = t.hydro ?? dummyCube()
  u.uRiverTexel.value = Math.PI / 2 / faceSizeOf(t.hydro, 256)
  u.uRiverCrestMin.value = riverCrestFor(look.riverRasterMinWidthKm, (u.uRiverTexel.value as number) * 6371)
  const ts = faceSizeOf(t.terrain, 256)
  u.uTerrainSize.value = ts
  u.uTexelAngle.value = Math.PI / 2 / ts
  u.uHeightHi.value = t.heightHi ?? dummyCube()
  u.uHasHeightHi.value = t.heightHi ? 1 : 0
  const hs = faceSizeOf(t.heightHi, ts)
  u.uHeightHiSize.value = hs
  u.uTexelAngleHi.value = Math.PI / 2 / hs
  const splats = !!(t.splatA && t.splatB && t.splatC && t.detail)
  u.uSplatA.value = t.splatA ?? dummyCube()
  u.uSplatB.value = t.splatB ?? dummyCube()
  u.uSplatC.value = t.splatC ?? dummyCube()
  u.uDetail.value = t.detail ?? dummyArray()
  u.uHasDetail.value = splats ? 1 : 0
  u.uPrevAlbedo.value = t.preview?.albedo ?? dummy2D()
  u.uHasKoppen.value = t.koppenIdx || t.koppenColor ? 1 : 0
  return core
}
