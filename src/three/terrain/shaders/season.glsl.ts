/**
 * Seasonal colour (step 6). The painted land and the tree crowns follow the visitor's
 * date (globeState.seasonPhase; ?season=YYYY-MM-DD overrides it, like the snow).
 *
 * Phase: uSeasonPhase = (cos, sin) of 2π(dayOfYear − 15)/365.25, so (1, 0) is northern
 * mid-winter, (0, 1) mid-April, (0, -1) mid-October. The southern hemisphere negates it
 * (half a year on). Every season term is a smooth window of that phase, so the colour is
 * a continuous function of the day-of-year: no month steps.
 *
 * The season map (uSeasonMap, equirect 1440x720, scripts/terrain/bake_season.py):
 *   r  deciduous share of the tree cover (Köppen-gated; IGBP 3/4 deciduous, 5 mixed)
 *   g  dry-season browning, signed: 0.5 + 0.5 amp, + = dry in local summer (Cs*, Ds*,
 *      cold steppe), - = dry in local winter (Aw, Am, Cw*, the Sahel / monsoon margin)
 *   b  deciduous tree density on the ground (Köppen gate x deciduous cover)
 *
 * Terms (local phase θ'):
 *   autumn  cos(θ' − θa)^3, θa = mid-October at 42°, 1.2 days earlier per degree poleward
 *   bare    smoothstep(0.1, 0.8, cos θ' + 0.3 sin θ') (leaves fall in Nov, return ~Apr/May)
 *   spring  cos(θ' − θs)^2, θs = May 1 at 42°, 1.5 days later per degree poleward
 *   dry     |g| x smoothstep(-0.3, 0.8, cos(θ' − θd)), θd = Aug 20 (summer-dry) or Mar 1
 *           (winter-dry); wet = the opposite window, a light green-up
 * Colour: each term RE-HUES the colour at its own luminance (x a small gain), so the
 * painted value structure stays and the OKLab L caps (land 0.66) still bind after
 * lighting. Cost: one bilinear fetch, ~4 trig and, only where deciduous trees are, two
 * value-noise octaves for the autumn patches.
 */
export const seasonGLSL = /* glsl */ `
uniform sampler2D uSeasonMap;
uniform float uSeasonOn;
uniform vec2 uSeasonPhase;
uniform vec3 cAutRusset;
uniform vec3 cAutOchre;
uniform vec3 cAutAmber;
uniform vec3 cSeasonBare;
uniform vec3 cSeasonSpring;
uniform vec3 cSeasonDry;
uniform vec3 cSeasonWet;
uniform vec4 uSeasonAmt; // autumn, bare, spring, dry/wet

const float S_DAY = 0.0172024; // 2pi / 365.25

vec2 seasonUv(vec3 d) {
  float lon = atan(-d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  return vec2(0.5 + lon / 6.28318531, 0.5 - lat / 3.14159265);
}

float sLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// re-hue c toward the hue/chroma of t at c's own luminance (x gain)
vec3 sHue(vec3 c, vec3 t, float gain) { return t * (sLum(c) / max(sLum(t), 1e-5)) * gain; }

float sHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float sNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// the autumn hue of a place (static patches ~190 km, a finer ~65 km break-up): ground and
// tree crowns call the same function so canopy and ground agree
vec3 autumnHue(vec3 d) {
  float h = sNoise(d * 34.0) * 0.7 + sNoise(d * 97.0 + 3.1) * 0.3;
  vec3 t = mix(cAutRusset, cAutOchre, smoothstep(0.34, 0.52, h));
  return mix(t, cAutAmber, smoothstep(0.56, 0.7, h));
}
float autumnPatch(vec3 d) { return mix(0.45, 1.0, smoothstep(0.25, 0.65, sNoise(d * 61.0 + 7.7))); }

// x autumn, y bare, z spring, w temperate belt; dry / wet out
vec4 seasonTerms(vec3 d, float g, out float dry, out float wet) {
  vec2 ph = d.y >= 0.0 ? uSeasonPhase : -uSeasonPhase; // local (cos, sin): +x mid-winter, +y mid-spring
  float alat = abs(asin(clamp(d.y, -1.0, 1.0))) * 57.29578;
  float ta = 4.712389 + (42.0 - alat) * 1.2 * S_DAY;
  float aut = pow(max(ph.x * cos(ta) + ph.y * sin(ta), 0.0), 3.0);
  float bare = smoothstep(0.1, 0.8, ph.x + 0.3 * ph.y);
  float ts = 1.8235 + (alat - 42.0) * 1.5 * S_DAY;
  float spr = pow(max(ph.x * cos(ts) + ph.y * sin(ts), 0.0), 2.0);
  float temperate = smoothstep(24.0, 34.0, alat) * (1.0 - smoothstep(62.0, 72.0, alat));
  float sg = g * 2.0 - 1.0;
  float amp = max(abs(sg) - 0.02, 0.0);
  float td = sg > 0.0 ? 3.7333 : 0.7741;
  float cd = ph.x * cos(td) + ph.y * sin(td);
  dry = amp * smoothstep(-0.3, 0.8, cd);
  wet = amp * smoothstep(0.2, 0.9, -cd);
  return vec4(aut, bare, spr, temperate);
}

// the painted ground (linear albedo, before lighting); m = the season map at d
vec3 seasonGround(vec3 alb, vec3 d, vec3 m) {
  float dry, wet;
  vec4 s = seasonTerms(d, m.g, dry, wet);
  float lum = max(sLum(alb), 1e-5);
  float green = clamp((alb.g - max(alb.r, alb.b)) / lum * 1.5, 0.0, 1.0); // painted greens only
  vec3 c = alb;
  // spring: fresh, lighter yellow-green on grass, farm and the new leaves
  c = mix(c, sHue(c, cSeasonSpring, 1.1), uSeasonAmt.z * s.z * s.w * green);
  // dry-season straw / wet-season green on the grass of savanna, monsoon and Mediterranean lands
  c = mix(c, sHue(c, cSeasonDry, 1.06), uSeasonAmt.w * dry);
  c = mix(c, sHue(c, cSeasonWet, 1.0), uSeasonAmt.w * 0.35 * wet);
  // autumn: deciduous woods turn russet / ochre / amber in warm patches, then go bare
  float dec = clamp(m.b * 1.25, 0.0, 1.0);
  if (dec * (s.x + s.y) > 0.002) {
    c = mix(c, sHue(c, autumnHue(d), 1.12), uSeasonAmt.x * s.x * (1.0 - s.y) * dec * autumnPatch(d));
    c = mix(c, sHue(c, cSeasonBare, 1.0), uSeasonAmt.y * s.y * clamp(m.b * 1.6, 0.0, 1.0));
  }
  // winter: the temperate belt's open ground goes a duller, browner green where no snow lies
  c = mix(c, sHue(c, cSeasonBare, 1.0), 0.45 * uSeasonAmt.y * s.y * s.w * green * (1.0 - dec));
  return mix(alb, c, uSeasonOn);
}
`
