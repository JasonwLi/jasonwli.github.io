/**
 * Relief shade (C2b). Height is sqrt-encoded (terrain.r = sqrt(h / 9000 m)), so the
 * raw channel is already a compressed height: z_km = exag * 3 * r = exag * sqrt(h km),
 * which lifts low hills and tames the Himalaya (the D3 LOW hillshade uses the same
 * curve). The sea floor uses bathy (terrain.g = sqrt(depth / 11000 m)) at uSeaRelief.
 *
 * Four taps at dir +/- eps*east, dir +/- eps*north; eps follows the larger of the
 * texel and the pixel footprint so the gradient never aliases at distance. The shade
 * is relative to the flat sphere under the same light (the day ramp owns the global
 * falloff), so mountains are lit from the screen's upper-left wherever the globe turns.
 */
export const reliefGLSL = /* glsl */ `
uniform samplerCube uTerrain;
uniform samplerCube uHeightHi;
uniform float uHasHeightHi;
uniform float uTexelAngle;   // rad per terrain texel at a face centre
uniform float uTexelAngleHi; // rad per heightHi texel
uniform float uReliefExag;
uniform float uReliefGain;
uniform float uReliefMin;
uniform float uReliefMax;
uniform float uSeaRelief;
uniform float uReliefStrength;
uniform mat3 uNormalView;
uniform vec3 uLightView;

float hillShade(vec2 g, vec3 d, vec3 E, vec3 N, vec3 flatV) {
  vec3 nV = normalize(uNormalView * normalize(d - g.x * E - g.y * N));
  float h = 1.0 + uReliefGain * (dot(nV, uLightView) - dot(flatV, uLightView));
  return mix(1.0, clamp(h, uReliefMin, uReliefMax), uReliefStrength);
}

// shadeLand / shadeSea: multiplicative relief shade; slope: |grad| of the land z (0..)
// lap: centre minus the mean of the four taps (sqrt-height units; + on ridges and peaks)
void reliefShade(vec3 d, vec3 E, vec3 N, vec3 flatV, float pixAng, float landish, float rC,
                 out float shadeLand, out float shadeSea, out float slope, out float lap) {
  float eps = max(uTexelAngle * 1.5, pixAng);
  vec4 e1 = texture(uTerrain, d + E * eps);
  vec4 e0 = texture(uTerrain, d - E * eps);
  vec4 n1 = texture(uTerrain, d + N * eps);
  vec4 n0 = texture(uTerrain, d - N * eps);
  float k = 1.0 / (2.0 * eps * EARTH_KM);
  vec2 gL = vec2(e1.r - e0.r, n1.r - n0.r) * (3.0 * uReliefExag * k);
  vec2 gS = vec2(e1.g - e0.g, n1.g - n0.g) * (-3.3166 * uReliefExag * uSeaRelief * k);
  lap = rC - 0.25 * (e1.r + e0.r + n1.r + n0.r);
  if (uHasHeightHi > 0.5 && landish > 0.0) {
    float eh = max(uTexelAngleHi * 1.5, pixAng);
    float kh = 1.0 / (2.0 * eh * EARTH_KM);
    float a1 = texture(uHeightHi, d + E * eh).r;
    float a0 = texture(uHeightHi, d - E * eh).r;
    float b1 = texture(uHeightHi, d + N * eh).r;
    float b0 = texture(uHeightHi, d - N * eh).r;
    gL = vec2(a1 - a0, b1 - b0) * (3.0 * uReliefExag * kh);
    lap = texture(uHeightHi, d).r - 0.25 * (a1 + a0 + b1 + b0);
  }
  shadeLand = hillShade(gL, d, E, N, flatV);
  shadeSea = hillShade(gS, d, E, N, flatV);
  slope = length(gL);
}
`
