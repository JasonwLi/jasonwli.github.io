/**
 * Painted terrain fragment (C2b), MID/HIGH cube path.
 *   col = mix(land, water) * day, land = albedo x detail x relief (+ snow, rivers),
 *   then the OKLab L cap (land 0.66, snow 0.86), the climate mix (C3's frozen
 *   climateShade signature) and the section dim. Linear light; ends with the
 *   tonemapping + colorspace chunks (the Canvas is flat).
 * No atmosphere, rim, glint or time-driven pattern (critique).
 *
 * Decode (manifest encodings): terrain.r = sqrt(h/9000 m), .g = sqrt(depth/11000 m),
 * .b = coast SDF (0.5 zero, +/-128 km, + land); hydro.r = river 1 - d/24 km,
 * .g = lake SDF (0.5 zero, +/-64 km, + water), .b = snow propensity.
 */
import { climateGLSL } from './climate.glsl'
import { FRAG_OUT, commonGLSL, fragCommonGLSL } from './common.glsl'
import { detailGLSL } from './detail.glsl'
import { reliefGLSL } from './relief.glsl'
import { snowGLSL } from './snow.glsl'
import { waterGLSL } from './water.glsl'

export const terrainFrag = /* glsl */ `
${FRAG_OUT}
${commonGLSL}
${fragCommonGLSL}
${reliefGLSL}
${waterGLSL}
${snowGLSL}
${detailGLSL}
uniform samplerCube uAlbedo;
uniform samplerCube uHydro;
uniform sampler2D uPrevAlbedo;
uniform float uStageMix;
uniform vec2 uDay;
uniform float uLandCap;
uniform float uSnowCap;
uniform float uCapKnee;
uniform vec3 cRiver;
uniform vec3 cLake;
uniform float uRiverPx;
uniform float uRiverMinKm;
uniform float uRiverTexel; // rad per hydro texel
uniform float uRiverAlpha;
uniform float uRiverCrestMin; // stream-order proxy: the texel-averaged crest of a wide river
uniform float uModeMix;
uniform float uHasKoppen;
uniform float uDim;
in vec3 vDir;
${climateGLSL}

void main() {
  vec3 d = normalize(vDir);
  vec3 E, N;
  tangentFrame(d, E, N);
  float pixAng = max(length(fwidth(d)), 1e-6);
  float kmPerPx = pixAng * EARTH_KM;
  vec3 flatV = normalize(uNormalView * d);

  vec4 ter = texture(uTerrain, d);
  vec4 hyd = texture(uHydro, d);
  float coastKm = (ter.b - 0.5) * 256.0;
  // anti-aliased shores from the SDFs' own screen derivative (anisotropy-correct at the limb)
  float coastPx = max(fwidth(coastKm), 0.01);
  float land = smoothstep(-0.6, 0.6, coastKm / coastPx);
  float lakeKm = (hyd.g - 0.5) * 128.0;
  float lake = smoothstep(-0.6, 0.6, lakeKm / max(fwidth(lakeKm), 0.01)) * land;

  float shadeLand, shadeSea, slope, lap;
  reliefShade(d, E, N, flatV, pixAng, land, ter.r, shadeLand, shadeSea, slope, lap);

  // ---- land
  vec3 alb = texture(uAlbedo, d).rgb;
  if (uHasDetail > 0.5 && uDetailFade > 0.001 && land > 0.0) alb *= detailFactor(d, kmPerPx);
  // relief-following snow edge only where there is relief (plains keep a clean edge)
  float snow = snowCover(d, hyd.b, lap * smoothstep(0.08, 0.35, slope)) * land;
  vec3 landCol = mix(alb * shadeLand, snowColor(shadeLand), snow);
  // The 1 - d/24 km field is sampled at ~10 km texels: along a thin river its bilinear
  // crest dips between texel centres, so a plain threshold breaks into beads. Lift the
  // crest with the max of samples along the flow: the flow is the Hessian eigenvector of
  // least curvature (the crest bends sharply across a river, barely along it). Then
  // threshold at max(uRiverPx px, uRiverMinKm) half width. Only near rivers.
  float river = 0.0;
  if (uRiverAlpha > 0.001 && hyd.r > 0.55 && land > 0.0) {
    float h = uRiverTexel;
    float r0 = hyd.r;
    float rE = texture(uHydro, d + E * h).r, rW = texture(uHydro, d - E * h).r;
    float rNn = texture(uHydro, d + N * h).r, rS = texture(uHydro, d - N * h).r;
    float rNE = texture(uHydro, d + (E + N) * h).r, rSW = texture(uHydro, d - (E + N) * h).r;
    float rNW = texture(uHydro, d + (N - E) * h).r, rSE = texture(uHydro, d + (E - N) * h).r;
    float a = rE + rW - 2.0 * r0;
    float c = rNn + rS - 2.0 * r0;
    float b = 0.25 * (rNE + rSW - rNW - rSE);
    float lam = 0.5 * (a + c) + sqrt(0.25 * (a - c) * (a - c) + b * b);
    vec2 v = abs(lam - a) > abs(lam - c) ? vec2(b, lam - a) : vec2(lam - c, b);
    v = length(v) > 1e-6 ? normalize(v) : vec2(1.0, 0.0);
    // off the crest the field is a ramp (|grad| ~ 1/24 per km) and the Hessian is ~0:
    // there the flow is simply perpendicular to the gradient
    vec2 g = vec2(rE - rW, rNn - rS);
    float ramp = smoothstep(0.35, 0.7, length(g) * 24.0 / (2.0 * h * EARTH_KM));
    vec2 gp = length(g) > 1e-6 ? normalize(vec2(-g.y, g.x)) : v;
    v = normalize(mix(v * sign(dot(v, gp) + 1e-6), gp, ramp));
    vec3 A = E * v.x + N * v.y;
    float rv = r0;
    rv = max(rv, texture(uHydro, d + A * (0.35 * h)).r);
    rv = max(rv, texture(uHydro, d - A * (0.35 * h)).r);
    rv = max(rv, texture(uHydro, d + A * (0.7 * h)).r);
    rv = max(rv, texture(uHydro, d - A * (0.7 * h)).r);
    // the true crest is 1.0 but its bilinear sample sags by up to ~0.7 texel; measure the
    // pixel against the local crest (max of every tap) instead of against 1.0
    float crest = max(max(max(rE, rW), max(rNn, rS)), max(max(rNE, rSW), max(rNW, rSE)));
    crest = max(crest, rv);
    float kmAcross = max(fwidth(hyd.r) * 24.0, 1e-3);
    float hw = max(uRiverPx * kmAcross, uRiverMinKm) / 24.0;
    float aa = max(fwidth(hyd.r), 1e-4);
    river = (1.0 - smoothstep(hw - aa, hw + aa, crest - rv)) * smoothstep(0.62, 0.72, crest)
          * smoothstep(uRiverCrestMin - 0.025, uRiverCrestMin + 0.005, crest)
          * (1.0 - snow) * uRiverAlpha * (1.0 - lake);
  }
  landCol = mix(landCol, cRiver * mix(1.0, shadeLand, 0.4), river);

  // ---- water (sea + lakes)
  vec3 sea = seaColor(ter.g, max(-coastKm, 0.0), coastPx, kmPerPx, d) * shadeSea;
  vec3 lakeCol = cLake * mix(1.0, shadeLand, 0.25);
  float water = max(1.0 - land, lake);
  vec3 waterCol = mix(sea, lakeCol, lake);

  float day = dayTerm(flatV, uLightView, uDay);
  vec3 col = mix(landCol, waterCol, water) * day;
  col = capLuma(col, mix(uLandCap, uSnowCap, snow * (1.0 - water)), uCapKnee);

  // stage A -> B crossfade from the equirect preview (sampled only while it runs)
  if (uStageMix < 0.999) {
    vec3 prev = capLuma(texEq(uPrevAlbedo, d).rgb * day, uLandCap, uCapKnee);
    col = mix(prev, col, uStageMix);
  }

  float k = uModeMix * uHasKoppen;
  if (k > 0.001) col = mix(col, climateShade(d, col, shadeLand, 1.0 - water, water), k);
  col *= 1.0 - uDim * 0.78;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
