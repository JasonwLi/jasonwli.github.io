/**
 * Shared GLSL (C2b). GLSL3 (three r185 declares no fragment output for GLSL3
 * ShaderMaterials, so every fragment shader starts with FRAG_OUT).
 *
 * Cube face table = src/three/geo/cubemap.ts (R6): +X (1,-t,-s) -X (-1,-t,s)
 * +Y (s,1,t) -Y (s,-1,-t) +Z (s,-t,1) -Z (-s,-t,-1), t = face-image down.
 * Equirect uv from the direction (R5): lon = atan(-z, x), u = 0.5 + lon/2pi,
 * v = 0.5 - lat/pi (row 0 = north, flipY = false).
 */

export const FRAG_OUT = /* glsl */ `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
`

export const commonGLSL = /* glsl */ `
#ifndef TERRAIN_COMMON
#define TERRAIN_COMMON
const float PI = 3.14159265359;
const float EARTH_KM = 6371.0;

float sq(float x) { return x * x; }
float sat(float x) { return clamp(x, 0.0, 1.0); }

vec3 faceDir(int face, float s, float t) {
  if (face == 0) return vec3(1.0, -t, -s);
  if (face == 1) return vec3(-1.0, -t, s);
  if (face == 2) return vec3(s, 1.0, t);
  if (face == 3) return vec3(s, -1.0, -t);
  if (face == 4) return vec3(s, -t, 1.0);
  return vec3(-s, -t, -1.0);
}

// local east / north on the unit sphere (east = Y x dir, north = dir x east); pole-safe
void tangentFrame(vec3 d, out vec3 E, out vec3 N) {
  vec3 e = vec3(d.z, 0.0, -d.x); // cross((0,1,0), d)
  float l = length(e);
  E = l > 1e-5 ? e / l : vec3(0.0, 0.0, -1.0);
  N = cross(d, E);
}

// OKLab lightness of a linear sRGB colour
float oklabL(vec3 c) {
  vec3 lms = vec3(
    dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
  return dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468));
}

// soft-knee OKLab L cap: scaling linear RGB by k scales L by cbrt(k), so k = (Lt/L)^3
vec3 capLuma(vec3 c, float cap, float knee) {
  float L = oklabL(c);
  float k0 = cap - knee;
  if (L <= k0) return c;
  float Lt = k0 + knee * (1.0 - exp(-(L - k0) / knee));
  float r = Lt / L;
  return c * (r * r * r);
}

// static value noise (no time input: the theme allows no idle loops)
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

#endif
`

/** Fragment-only helpers (derivatives). Include after commonGLSL. */
export const fragCommonGLSL = /* glsl */ `
// equirect sample from a direction with seam-safe derivatives at the antimeridian
vec4 texEq(sampler2D tex, vec3 d) {
  float lon = atan(-d.z, d.x);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(0.5 + lon / (2.0 * PI), 0.5 - lat / PI);
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (abs(dx.x) > abs(dx2.x)) dx = dx2;
  if (abs(dy.x) > abs(dy2.x)) dy = dy2;
  return textureGrad(tex, uv, dx, dy);
}

// ~1 px line coverage from a distance in pixels
float line1(float dpx) { return 1.0 - smoothstep(0.0, 1.0, dpx); }

// 'the plate before painting' (same drawing as I1's EngravedSphere): steel field,
// 10 deg gilt-worn graticule, silver-3 coastline at the coast SDF zero
vec3 plateColor(vec3 n, vec3 cField, vec3 cGrat, vec3 cCoast, float coastS, float hasCoast) {
  float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
  float lon = degrees(atan(-n.z, n.x));
  float lonB = degrees(atan(n.z, -n.x));
  float dLon = min(fwidth(lon), fwidth(lonB));
  float dLat = fwidth(lat);
  float gLat = abs(fract(lat / 10.0 + 0.5) - 0.5) * 10.0 / max(dLat, 1e-5);
  float gLon = abs(fract(lon / 10.0 + 0.5) - 0.5) * 10.0 / max(dLon, 1e-5);
  float grat = max(line1(gLat), line1(gLon) * (1.0 - smoothstep(78.0, 80.0, abs(lat))));
  vec3 col = mix(cField, cGrat, grat);
  if (hasCoast > 0.5) {
    float dpx = abs(coastS) / max(fwidth(coastS), 1e-5);
    col = mix(col, cCoast, line1(dpx));
  }
  return col;
}

// soft ambient day ramp from the single key light
float dayTerm(vec3 nView, vec3 L, vec2 range) {
  return mix(range.x, range.y, dot(nView, L) * 0.5 + 0.5);
}
`
