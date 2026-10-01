/**
 * Snow (C2b). hydro.b = snow propensity: 0.95 = permanent (glaciers, ice shelves,
 * the BRIEF §2 snowline); lower values gain snow in winter. globeState.season is +1
 * at northern mid-winter (from the visitor's date or ?season=YYYY-MM-DD), so the
 * southern hemisphere uses -season.
 */
export const snowGLSL = /* glsl */ `
uniform float uSeason;
uniform float uSnowReach;
uniform float uSnowBias;
uniform vec3 cSnow;
uniform vec3 cSnowShadow;

// hiDetail: local height detail (sqrt units, + on peaks/ridges, - in valleys) so the
// snow edge follows the relief instead of the 1024-texel propensity field
float snowCover(vec3 d, float snowP, float hiDetail) {
  float winter = max(0.0, d.y >= 0.0 ? uSeason : -uSeason);
  float thr = 0.95 - uSnowReach * winter + uSnowBias;
  float p = snowP + hiDetail * 1.6;
  float aa = max(fwidth(p), 0.018);
  return smoothstep(thr - aa, thr + aa, p);
}

// cool white with a relief-shaded blue shadow
vec3 snowColor(float relief) {
  return mix(cSnowShadow, cSnow, sat((relief - 0.5) / 0.6)) * mix(0.78, 1.06, sat((relief - 0.4) / 0.8));
}
`
