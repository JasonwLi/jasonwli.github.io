/**
 * Tree material (C6). GLSL3, R1 colour chunks, linear maths. One material per species
 * (only uCol differs; every other uniform object is shared).
 *
 * Vertex: per instance iA = (dir.xyz, grass tint | jungle flag), iB = (yaw, size jitter, threshold t,
 * value jitter). Visibility is a pure function of uniforms, so it is identical before
 * and after a re-scatter swap (no pop):
 *   vis = smoothstep(1, 1.45, uTau / t) * uFade * keep-out(landmarks) * riverClear
 * and the tree SCALES with vis (scale-in from the ground; no alpha, no sorting).
 * The base sits on the terrain mesh's own displaced height (surfaceLift.ts).
 * Fragment: lit like the terrain and the monuments: the one upper-left key light
 * (look.lightView) as a flat facet term relative to the ground normal, times the soft
 * day ramp on the ground normal, baked base band (aShade), OKLab L capped at the land
 * cap, x (1 - 0.78 dim). No time uniform: no sway, no idle animation.
 */
import * as THREE from 'three'
import { look } from '../terrain/look'
import { hydroGLSL, liftGLSL, type HydroUniforms, type LiftUniforms } from '../rivers/surfaceLift'
import { TREE_COLOURS } from './palette'

export const MAX_KEEPOUTS = 16

const vertexShader = /* glsl */ `
in float aShade;
in float aTrunk;
in vec4 iA;
in vec4 iB;
${liftGLSL}
${hydroGLSL}
uniform float uTau;
uniform float uFade;
uniform float uSize;
uniform vec4 uKeep[${MAX_KEEPOUTS}];
uniform int uKeepN;
out vec3 vPosV;
out vec3 vUpV;
out float vShade;
out float vTrunk;
out float vGrass;
out float vVal;
out float vJungle;

void main() {
  float g = uTau / max(iB.z, 1e-6);
  float vis = smoothstep(1.0, 1.45, g) * uFade;
  vec3 d = normalize(iA.xyz);
  vis *= riverClear(d);
  for (int k = 0; k < ${MAX_KEEPOUTS}; k++) {
    if (k >= uKeepN) break;
    float ch = length(d - uKeep[k].xyz);
    vis *= smoothstep(uKeep[k].w, uKeep[k].w * 1.4, ch);
  }
  float s = uSize * iB.y * vis;
  // iA.w >= 1.5 (broadleaf mesh): a jungle canopy tree, broader and flatter
  float jungle = step(1.5, iA.w);
  vShade = aShade;
  vTrunk = aTrunk;
  vGrass = jungle > 0.5 ? 0.0 : iA.w;
  vJungle = jungle;
  vVal = iB.w;
  if (s < 1e-7) {
    vPosV = vec3(0.0);
    vUpV = vec3(0.0, 0.0, 1.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 pv0 = modelViewMatrix * vec4(d, 1.0);
  float h = terrainHeightM(d, unitsPerPxAt(pv0));
  vec3 base = d * (1.0 + h * uHeightScale);
  vec3 ref = abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 e = normalize(cross(ref, d));
  vec3 nn = cross(d, e);
  float cy = cos(iB.x);
  float sy = sin(iB.x);
  vec3 X = e * cy + nn * sy;
  vec3 Z = nn * cy - e * sy;
  // INT-B: jungle crowns 1.6x broader (was 1.3): the budget caps jungle at ~1/4 of the design
  // density, so broader crowns close the canopy at 600-900 km without more instances
  vec3 lp = position * vec3(1.0 + 0.6 * jungle, 1.0 - 0.15 * jungle, 1.0 + 0.6 * jungle);
  vec3 p = base + (X * lp.x + d * lp.y + Z * lp.z) * s;
  vec4 pv = modelViewMatrix * vec4(p, 1.0);
  vPosV = pv.xyz;
  vUpV = normalize(normalMatrix * d);
  gl_Position = projectionMatrix * pv;
}
`

const fragmentShader = /* glsl */ `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
uniform vec3 uCol;
uniform vec3 uGrassCol;
uniform vec3 uJungleCol;
uniform vec3 uTrunkCol;
uniform vec3 uLightView;
uniform vec2 uDay;
uniform float uGain;
uniform vec2 uShadeRange;
uniform float uCap;
uniform float uKnee;
uniform float uDim;
in vec3 vPosV;
in vec3 vUpV;
in float vShade;
in float vTrunk;
in float vGrass;
in float vVal;
in float vJungle;
float oklabL(vec3 c) {
  vec3 lms = vec3(
    dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
  return dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468));
}
vec3 capLuma(vec3 c, float cap, float knee) {
  float L = oklabL(c);
  float k0 = cap - knee;
  if (L <= k0) return c;
  float Lt = min(cap, k0 + knee * (1.0 - exp(-(L - k0) / knee)));
  float r = Lt / L;
  return c * (r * r * r);
}
void main() {
  vec3 n = normalize(cross(dFdx(vPosV), dFdy(vPosV)));
  if (dot(n, vPosV) > 0.0) n = -n;
  vec3 up = normalize(vUpV);
  float lu = dot(up, uLightView);
  float day = mix(uDay.x, uDay.y, lu * 0.5 + 0.5);
  float key = clamp(1.0 + uGain * (dot(n, uLightView) - lu), uShadeRange.x, uShadeRange.y);
  vec3 leaf = mix(mix(uCol, uGrassCol, vGrass), uJungleCol, vJungle);
  vec3 base = vTrunk > 0.5 ? uTrunkCol : leaf * (1.0 + vVal);
  vec3 col = capLuma(base * vShade * day * key, uCap, uKnee);
  col *= 1.0 - 0.78 * uDim;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export interface TreeShared extends LiftUniforms, HydroUniforms {
  uTau: THREE.IUniform<number>
  uFade: THREE.IUniform<number>
  uSize: THREE.IUniform<number>
  uKeep: THREE.IUniform<THREE.Vector4[]>
  uKeepN: THREE.IUniform<number>
  uDim: THREE.IUniform<number>
}

function lin(c: readonly [number, number, number]): THREE.Color {
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace)
}

export function makeTreeShared(lift: LiftUniforms, hydro: HydroUniforms): TreeShared {
  return {
    ...lift,
    ...hydro,
    uTau: { value: 0 },
    uFade: { value: 0 },
    uSize: { value: 0 },
    uKeep: { value: Array.from({ length: MAX_KEEPOUTS }, () => new THREE.Vector4()) },
    uKeepN: { value: 0 },
    uDim: { value: 0 },
  }
}

export function makeTreeMaterial(shared: TreeShared, col: readonly [number, number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared,
      uCol: { value: lin(col) },
      uJungleCol: { value: lin(TREE_COLOURS.jungle) },
      uGrassCol: { value: lin(TREE_COLOURS.grass) },
      uTrunkCol: { value: lin(TREE_COLOURS.trunk) },
      uLightView: { value: new THREE.Vector3(...look.lightView).normalize() },
      uDay: { value: new THREE.Vector2(...look.day) },
      uGain: { value: 0.8 },
      uShadeRange: { value: new THREE.Vector2(0.55, 1.2) },
      uCap: { value: look.landLumaCap },
      uKnee: { value: look.capKnee },
    },
    side: THREE.DoubleSide,
  })
}
