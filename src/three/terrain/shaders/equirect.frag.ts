/**
 * LOW-tier / stage-A equirect fragment (C2b). The albedo already carries relief,
 * water ramp, coast line, rivers and permanent snow (D3's LOW bake); this adds the
 * seasonal snow (data.b, same formula as the cube), the static surf at close zoom
 * (data.r coast SDF), the soft day ramp, the L cap, climate (climateGLSLEq), the dim,
 * and 'the plate before painting' under uPaint (theme: paint floods in over 600 ms).
 * uAlbedo0/uData0 hold the previous set while uStageMix crossfades A -> LOW B.
 * lowData packing: r = coast SDF (0.5 zero, +/-128 km, + land), g = bathy, b = snow.
 */
import { climateGLSLEq } from './climate.glsl'
import { FRAG_OUT, commonGLSL, fragCommonGLSL } from './common.glsl'
import { snowGLSL } from './snow.glsl'

export const equirectVert = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const equirectFrag = /* glsl */ `
${FRAG_OUT}
${commonGLSL}
${fragCommonGLSL}
${snowGLSL}
uniform sampler2D uAlbedo;
uniform sampler2D uData;
uniform sampler2D uAlbedo0;
uniform sampler2D uData0;
uniform float uHasTex;
uniform float uStageMix;
uniform float uPaint;
uniform mat3 uNormalView;
uniform vec3 uLightView;
uniform vec2 uDay;
uniform float uLandCap;
uniform float uSnowCap;
uniform float uCapKnee;
uniform vec3 cFoam;
uniform float uFoamWidthKm;
uniform float uFoamAlpha;
uniform float uWaveFade;
uniform vec3 cField;
uniform vec3 cGrat;
uniform vec3 cCoast;
uniform float uModeMix;
uniform float uHasKoppen;
uniform float uDim;
in vec3 vDir;
${climateGLSLEq}

vec3 paintedEq(sampler2D albT, sampler2D dataT, vec3 d, float kmPerPx, float day, out float coastS) {
  vec3 alb = texEq(albT, d).rgb;
  vec4 data = texEq(dataT, d);
  coastS = data.r - 0.5;
  float coastKm = coastS * 256.0;
  float land = smoothstep(-0.6, 0.6, coastKm / max(kmPerPx, 0.02));
  // seasonal snow over land (the permanent part is already painted in)
  float snow = snowCover(d, data.b, 0.0) * land;
  float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
  vec3 snowCol = snowColor(clamp(sqrt(lum / 0.2), 0.5, 1.2));
  vec3 col = mix(alb, snowCol, snow);
  if (uWaveFade > 0.001) {
    float seaKm = max(-coastKm, 0.0);
    float band = (1.0 - smoothstep(0.2 * uFoamWidthKm, uFoamWidthKm, seaKm)) * (1.0 - land);
    float n = vnoise(d * (EARTH_KM / 2.0)) * 0.65 + vnoise(d * (EARTH_KM / 0.7)) * 0.35;
    float stripes = smoothstep(0.35, 0.85, sin(seaKm * 1.6 - n * 5.0) * 0.5 + 0.5);
    col = mix(col, cFoam, band * stripes * smoothstep(0.35, 0.7, n) * uFoamAlpha * uWaveFade);
  }
  col *= day;
  return capLuma(col, mix(uLandCap, uSnowCap, snow), uCapKnee);
}

void main() {
  vec3 d = normalize(vDir);
  float pixAng = max(length(fwidth(d)), 1e-6);
  float kmPerPx = pixAng * EARTH_KM;
  vec3 flatV = normalize(uNormalView * d);
  float day = dayTerm(flatV, uLightView, uDay);

  vec3 col = cField;
  float coastS = 0.0;
  if (uHasTex > 0.5) {
    col = paintedEq(uAlbedo, uData, d, kmPerPx, day, coastS);
    if (uStageMix < 0.999) {
      float c0;
      col = mix(paintedEq(uAlbedo0, uData0, d, kmPerPx, day, c0), col, uStageMix);
    }
  }
  if (uPaint < 0.999) {
    col = mix(plateColor(d, cField, cGrat, cCoast, coastS, uHasTex), col, uPaint);
  }
  float k = uModeMix * uHasKoppen;
  if (k > 0.001) {
    float landM = step(0.0, coastS);
    col = mix(col, climateShade(d, col, 1.0, landM, 1.0 - landM), k);
  }
  col *= 1.0 - uDim * 0.78;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
