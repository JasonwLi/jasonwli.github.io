/**
 * LOW-tier / stage-A equirect material (C2b) on SphereGeometry(1, 128, 64). Holds a
 * current (uAlbedo/uData) and a previous (uAlbedo0/uData0) set so the preview ->
 * LOW crossfade (uStageMix) never pops; uPaint fades 'the plate before painting'
 * (steel field + graticule + coastline) into the paint.
 */
import { Color, FrontSide, GLSL3, Matrix3, ShaderMaterial, Vector2, Vector3, type IUniform } from 'three'
import { tokens } from '../../../theme/tokens'
import { climateUniforms } from '../shaders/climate.glsl'
import { equirectFrag, equirectVert } from '../shaders/equirect.frag'
import { look } from '../look'
import { dummy2D } from './dummies'

export function createTerrainEquirectMaterial(): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    uAlbedo: { value: dummy2D() },
    uData: { value: dummy2D() },
    uAlbedo0: { value: dummy2D() },
    uData0: { value: dummy2D() },
    uHasTex: { value: 0 },
    uStageMix: { value: 1 },
    uPaint: { value: 0 },
    uNormalView: { value: new Matrix3() },
    uLightView: { value: new Vector3(...look.lightView).normalize() },
    uDay: { value: new Vector2(...look.day) },
    uLandCap: { value: look.landLumaCap },
    uSnowCap: { value: look.snowLumaCap },
    uCapKnee: { value: look.capKnee },
    cFoam: { value: new Color(look.foam) },
    uFoamWidthKm: { value: look.foamWidthKm },
    uFoamAlpha: { value: look.foamAlpha },
    uWaveFade: { value: 0 },
    cSnow: { value: new Color(look.snow) },
    cSnowShadow: { value: new Color(look.snowShadow) },
    uSeason: { value: 0 },
    uSnowReach: { value: look.snowWinterReach },
    uSnowBias: { value: look.snowBias },
    cField: { value: new Color(tokens.steelField) },
    cGrat: { value: new Color(tokens.giltWorn) },
    cCoast: { value: new Color(tokens.silver3) },
    uModeMix: { value: 0 },
    uHasKoppen: { value: 0 },
    uDim: { value: 0 },
    ...climateUniforms(),
  }
  return new ShaderMaterial({
    name: 'terrain-equirect',
    glslVersion: GLSL3,
    vertexShader: equirectVert,
    fragmentShader: equirectFrag,
    uniforms,
    side: FrontSide,
    depthWrite: true,
    depthTest: true,
  })
}
