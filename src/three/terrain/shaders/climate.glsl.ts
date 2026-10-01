/**
 * Climate (Köppen) map-mode chunk (C3). Frozen signature (F0):
 *   vec3 climateShade(vec3 dir, vec3 terrainLit, float reliefShade, float landMask, float oceanMask)
 * The terrain fragment ends with: col = mix(col, climateShade(...), uModeMix * uHasKoppen).
 * climateGLSLEq (LOW equirect) defines the same function.
 *
 * Look (theme + critique amendment): flat painted class colours from
 * src/data/koppen-palette.json (the same constant the legend draws) under the terrain's
 * own relief shade and day ramp, land OKLab L capped at uLandCap (0.66); sea and lakes
 * keep the terrain's steel water. Class boundaries are an --incise cut line, 1.25 px at
 * 60%. NO hatching. uIsolate (group 0..4 = A..E, -1 none) desaturates every other group
 * to 35% chroma, faded by uIsolateMix (200 ms).
 *
 * Cube path: colour comes from the koppenIdx cube (R8, NEAREST, value = idx*8) looked up
 * in the palette uniform, so legend and globe match exactly whatever the bake. The four
 * texel centres around the fragment are fetched (face-plane lattice, the same in every
 * GL face) and their bilinear CLASS weights give a smooth majority contour: the
 * boundary line is anti-aliased along that contour at any zoom. When a texel shrinks
 * under ~1.5 px the lookup is supersampled 2x2 inside the pixel instead (no shimmer;
 * the line comes from sub-sample disagreement). The koppenColor cube is only a
 * fallback if the index cube is missing.
 * LOW path: the baked koppenColorEq (mipmapped), the boundary from its screen
 * derivative, and the class for isolation by nearest palette match.
 *
 * climateUniforms() returns uniform objects that this module keeps bound: it listens to
 * the texture registry (C2a) for the Köppen textures and to the frame bus for the
 * isolation fade, so TerrainGlobe only spreads the uniforms and sets uHasKoppen.
 */
import { Color, type IUniform } from 'three'
import palette from '../../../data/koppen-palette.json'
import { tokens } from '../../../theme/tokens'
import { globeState, subscribeFrame } from '../../globeState'
import { dummy2D, dummyCube } from '../materials/dummies'
import { onTerrainTextures, terrainTextures, type TerrainTextures } from '../textures'

/** 31 linear colours: [0] unused (ocean), [1..30] the classes */
function paletteColors(): Color[] {
  const out = Array.from({ length: 31 }, () => new Color(tokens.steel))
  for (const e of palette as { idx: number; hex: string }[]) out[e.idx] = new Color(e.hex)
  return out
}

const ISOLATE_LAMBDA = 15 // ~95% in 200 ms
const sets = new Set<Record<string, IUniform>>()
let wired = false
let isoMix = 0
let isoGroup = -1

function faceSize(t: unknown): number {
  const img = (t as { image?: unknown } | undefined)?.image
  const first = Array.isArray(img) ? img[0] : img
  const w = (first as { width?: number; image?: { width?: number } } | undefined)?.width
    ?? (first as { image?: { width?: number } } | undefined)?.image?.width
  return typeof w === 'number' && w > 0 ? w : 256
}

function bind(u: Record<string, IUniform>, t: TerrainTextures) {
  u.uKoppenIdx.value = t.koppenIdx ?? dummyCube()
  u.uHasKoppenIdx.value = t.koppenIdx ? 1 : 0
  u.uKoppenFace.value = faceSize(t.koppenIdx)
  u.uKoppenColor.value = t.koppenColor ?? dummyCube()
  u.uKoppenColorEq.value = t.koppenColorEq ?? dummy2D()
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function wire() {
  if (wired) return
  wired = true
  onTerrainTextures((t) => {
    for (const u of sets) bind(u, t)
  })
  subscribeFrame((dt) => {
    const g = globeState.isolateGroup
    const want = g >= 0 && globeState.mapMode === 'climate' ? 1 : 0
    if (want) isoGroup = g
    if (reducedMotion()) isoMix = want
    else isoMix = want + (isoMix - want) * Math.exp(-ISOLATE_LAMBDA * dt)
    if (Math.abs(isoMix - want) < 1e-3) isoMix = want
    if (isoMix === 0) isoGroup = -1
    for (const u of sets) {
      u.uIsolate.value = isoGroup
      u.uIsolateMix.value = isoMix
    }
  })
}

export function climateUniforms(): Record<string, IUniform> {
  const u: Record<string, IUniform> = {
    uKoppenIdx: { value: dummyCube() },
    uHasKoppenIdx: { value: 0 },
    uKoppenFace: { value: 256 },
    uKoppenColor: { value: dummyCube() },
    uKoppenColorEq: { value: dummy2D() },
    uKoppenPal: { value: paletteColors() },
    uClimateEdge: { value: new Color(tokens.incise) },
    uClimateEdgeAlpha: { value: 0.6 },
    uClimateEdgePx: { value: 1.25 },
    uIsolate: { value: -1 },
    uIsolateMix: { value: 0 },
    uIsolateChroma: { value: 0.35 },
  }
  bind(u, terrainTextures)
  sets.add(u)
  wire()
  return u
}

const sharedGLSL = /* glsl */ `
uniform vec3 uKoppenPal[31];
uniform vec3 uClimateEdge;
uniform float uClimateEdgeAlpha;
uniform float uClimateEdgePx;
uniform float uIsolate;
uniform float uIsolateMix;
uniform float uIsolateChroma;

int kGroup(int c) {
  return c <= 0 ? -1 : c <= 3 ? 0 : c <= 7 ? 1 : c <= 16 ? 2 : c <= 28 ? 3 : 4;
}
// palette colour of a class, desaturated when another group is isolated
vec3 kColor(int c) {
  vec3 col = uKoppenPal[clamp(c, 0, 30)];
  if (uIsolateMix > 0.0 && float(kGroup(c)) != uIsolate) {
    float y = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(y), uIsolateMix * (1.0 - uIsolateChroma));
  }
  return col;
}
// the painted class colour under the terrain's light, capped like the land
vec3 kLight(vec3 base, vec3 dir, float reliefShade) {
  float day = dayTerm(normalize(uNormalView * dir), uLightView, uDay);
  return capLuma(base * reliefShade * day, uLandCap, uCapKnee);
}
float kLine(float dpx) {
  float hw = 0.5 * uClimateEdgePx;
  return clamp(hw + 0.5 - dpx, 0.0, 1.0);
}
`

export const climateGLSL = /* glsl */ `
uniform samplerCube uKoppenIdx;
uniform samplerCube uKoppenColor;
uniform float uHasKoppenIdx;
uniform float uKoppenFace;
${sharedGLSL}

int kFetch(int m, float s, vec2 p) {
  vec3 q = m == 0 ? vec3(s, p.x, p.y) : m == 1 ? vec3(p.x, s, p.y) : vec3(p.x, p.y, s);
  return int(floor(texture(uKoppenIdx, q).r * 31.875 + 0.5)); // r*255/8
}

// 4-tap class lookup at direction d: dominant class, runner-up and the majority margin
void kTaps(vec3 d, out int cBest, out int cNext, out float margin, out float texAng) {
  vec3 a = abs(d);
  int m; float s; vec2 p;
  if (a.x >= a.y && a.x >= a.z) { m = 0; s = sign(d.x); p = d.yz / a.x; }
  else if (a.y >= a.z) { m = 1; s = sign(d.y); p = d.xz / a.y; }
  else { m = 2; s = sign(d.z); p = d.xy / a.z; }
  float n = uKoppenFace;
  texAng = (2.0 / n) / (1.0 + dot(p, p));
  vec2 t = (p * 0.5 + 0.5) * n - 0.5;
  vec2 i0 = floor(t);
  vec2 f = t - i0;
  float lo = -1.0 + 1.0 / n, hi = 1.0 - 1.0 / n;
  int c[4];
  c[0] = kFetch(m, s, clamp((i0 + vec2(0.5, 0.5)) / n * 2.0 - 1.0, lo, hi));
  c[1] = kFetch(m, s, clamp((i0 + vec2(1.5, 0.5)) / n * 2.0 - 1.0, lo, hi));
  c[2] = kFetch(m, s, clamp((i0 + vec2(0.5, 1.5)) / n * 2.0 - 1.0, lo, hi));
  c[3] = kFetch(m, s, clamp((i0 + vec2(1.5, 1.5)) / n * 2.0 - 1.0, lo, hi));
  float w[4];
  w[0] = (1.0 - f.x) * (1.0 - f.y);
  w[1] = f.x * (1.0 - f.y);
  w[2] = (1.0 - f.x) * f.y;
  w[3] = f.x * f.y;
  float sum[4];
  // ocean / no-data texels (0) never win: land next to a coarse coast takes its land neighbour
  for (int i = 0; i < 4; i++) {
    float acc = 0.0;
    for (int j = 0; j < 4; j++) acc += c[j] == c[i] ? w[j] : 0.0;
    sum[i] = c[i] == 0 ? -1.0 : acc;
  }
  int bi = 0;
  for (int i = 1; i < 4; i++) if (sum[i] > sum[bi]) bi = i;
  cBest = c[bi];
  float second = 0.0;
  cNext = cBest;
  for (int i = 0; i < 4; i++) {
    if (c[i] != cBest && sum[i] > second) { second = sum[i]; cNext = c[i]; }
  }
  if (sum[bi] < 0.0) cBest = 0; // all four are ocean
  margin = sum[bi] - second;
}

// 16-tap cubic B-spline class weights: the majority contour is C1-smooth, so class
// edges read as drawn curves at close zoom instead of chamfered texel blocks
// (single-texel specks melt away, which is the painterly simplification we want)
void kTaps16(vec3 d, out int cBest, out int cNext, out float margin, out float texAng) {
  vec3 a = abs(d);
  int m; float s; vec2 p;
  if (a.x >= a.y && a.x >= a.z) { m = 0; s = sign(d.x); p = d.yz / a.x; }
  else if (a.y >= a.z) { m = 1; s = sign(d.y); p = d.xz / a.y; }
  else { m = 2; s = sign(d.z); p = d.xy / a.z; }
  float n = uKoppenFace;
  texAng = (2.0 / n) / (1.0 + dot(p, p));
  vec2 t = (p * 0.5 + 0.5) * n - 0.5;
  vec2 i0 = floor(t);
  vec2 f = t - i0;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 wv[4];
  wv[0] = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  wv[1] = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  wv[2] = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  wv[3] = f3 / 6.0;
  float lo = -1.0 + 1.0 / n, hi = 1.0 - 1.0 / n;
  int c[16];
  float w[16];
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      int k = j * 4 + i;
      c[k] = kFetch(m, s, clamp((i0 + vec2(float(i) - 0.5, float(j) - 0.5)) / n * 2.0 - 1.0, lo, hi));
      w[k] = wv[i].x * wv[j].y;
    }
  }
  float best = -1.0, second = 0.0;
  cBest = 0;
  cNext = 0;
  for (int i = 0; i < 16; i++) {
    if (c[i] == 0) continue; // ocean / no-data never wins: coastal land takes its land neighbour
    float acc = 0.0;
    for (int j = 0; j < 16; j++) acc += c[j] == c[i] ? w[j] : 0.0;
    if (acc > best) {
      if (c[i] != cBest && best > second) { second = best; cNext = cBest; }
      best = acc; cBest = c[i];
    } else if (c[i] != cBest && acc > second) {
      second = acc; cNext = c[i];
    }
  }
  if (second <= 0.0) cNext = cBest;
  margin = max(best, 0.0) - second;
}

vec3 climateShade(vec3 dir, vec3 terrainLit, float reliefShade, float landMask, float oceanMask) {
  if (uHasKoppenIdx < 0.5) {
    // fallback: the baked colour cube only
    return mix(terrainLit, kLight(texture(uKoppenColor, dir).rgb, dir, reliefShade), landMask);
  }
  vec3 d = normalize(dir);
  vec3 ddx = dFdx(d), ddy = dFdy(d);
  float pixAng = max(length(fwidth(d)), 1e-7);

  int cB, cN; float margin, texAng;
  kTaps16(d, cB, cN, margin, texAng);
  float texPx = texAng / pixAng;
  // near: smooth majority contour, AA by its own screen derivative
  float dpx = margin / max(fwidth(margin), 1e-4);
  float valid = cB == 0 ? 0.0 : 1.0;
  vec3 near = mix(kColor(cN), kColor(cB), clamp(0.5 + dpx, 0.0, 1.0));
  float lineNear = cN != cB ? kLine(dpx) : 0.0;

  vec3 base = near;
  float line = lineNear;
  float farT = 1.0 - smoothstep(1.0, 1.6, texPx);
  if (farT > 0.0) {
    // minified: 2x2 supersample of the pixel footprint
    vec3 acc = vec3(0.0);
    float nOk = 0.0;
    int cls[4];
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i == 1 || i == 3 ? 0.25 : -0.25, i >= 2 ? 0.25 : -0.25);
      int b, nx; float mg, ta;
      kTaps(normalize(d + ddx * o.x + ddy * o.y), b, nx, mg, ta);
      cls[i] = b;
      if (b != 0) { acc += kColor(b); nOk += 1.0; }
    }
    int diff = 0;
    for (int i = 1; i < 4; i++) diff += (cls[i] != cls[0] && cls[i] != 0 && cls[0] != 0) ? 1 : 0;
    float lineFar = min(float(diff) * 0.75, 1.0) * 0.8;
    if (nOk > 0.0) {
      base = mix(near, acc / nOk, valid > 0.0 ? farT : 1.0);
      valid = 1.0;
    }
    line = mix(lineNear, lineFar, farT);
  }

  vec3 col = kLight(base, d, reliefShade);
  col = mix(col, uClimateEdge, line * uClimateEdgeAlpha);
  return mix(terrainLit, col, landMask * valid);
}
`

export const climateGLSLEq = /* glsl */ `
uniform sampler2D uKoppenColorEq;
${sharedGLSL}

vec3 climateShade(vec3 dir, vec3 terrainLit, float reliefShade, float landMask, float oceanMask) {
  vec3 d = normalize(dir);
  vec3 base = texEq(uKoppenColorEq, d).rgb;
  // boundary: where the baked colour changes faster than a pixel
  float e = length(fwidth(base));
  float line = smoothstep(0.012, 0.045, e) * (1.0 - oceanMask);
  if (uIsolateMix > 0.0) {
    // class by nearest palette entry (the bake is drawn from the same palette)
    int best = 1;
    float bd = 1e9;
    for (int i = 1; i < 31; i++) {
      vec3 q = uKoppenPal[i] - base;
      float dd = dot(q, q);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (float(kGroup(best)) != uIsolate) {
      float y = dot(base, vec3(0.2126, 0.7152, 0.0722));
      base = mix(base, vec3(y), uIsolateMix * (1.0 - uIsolateChroma));
    }
  }
  vec3 col = kLight(base, d, reliefShade);
  col = mix(col, uClimateEdge, line * uClimateEdgeAlpha);
  return mix(terrainLit, col, landMask);
}
`
