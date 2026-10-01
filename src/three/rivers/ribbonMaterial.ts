/**
 * Painted river ribbon material (C6). GLSL3, R1 colour chunks, linear maths.
 *
 * Vertex: centre = dir * (1 + LIFT.ribbon + h * uHeightScale) with h sampled from the
 * terrain mesh's own height texture (surfaceLift.ts); the strip is offset in the tangent
 * plane by half the rank width, never thinner than uMinPx screen px measured ALONG the
 * offset direction (so tilt foreshortening is accounted for). Fades per rank group
 * (uFade = ranks <= 4, 5-6, 7+: stream-order culling at mid zoom, RiverRibbons) and
 * x (1 - modeMix) (hidden in Climate).
 * Fragment: EU4 painted water: a darker channel with lighter banks, the terrain's soft
 * day ramp from the one upper-left key light, a 1 px soft edge, x (1 - 0.78 dim).
 */
import * as THREE from 'three'
import { look } from '../terrain/look'
import { LIFT } from '../geo/radii'
import { liftGLSL, type LiftUniforms } from './surfaceLift'

/** full ribbon width in km by NE scalerank (critique: 2-6 km) */
export const RIVER_WIDTH_KM = [6, 6, 4.5, 4.5, 3, 3, 2.2, 2.2, 2] as const
/** river bank colour (lighter than look.river: the painted shallow edge) */
export const RIVER_EDGE = '#4d7491'

const vertexShader = /* glsl */ `
// position = the centre direction (unit)
in vec3 aOff;
in vec2 aMeta; // side, rank
${liftGLSL}
uniform vec3 uFade;
uniform float uLift;
uniform float uMinPx;
uniform vec2 uViewport;
uniform float uWidthKm[9];
out float vSide;
out float vAlpha;
out vec3 vNormalV;

void main() {
  float rank = aMeta.y;
  float fade = rank < 4.5 ? uFade.x : (rank < 6.5 ? uFade.y : uFade.z);
  if (fade <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vSide = 0.0;
    vAlpha = 0.0;
    vNormalV = vec3(0.0, 0.0, 1.0);
    return;
  }
  vec3 d = normalize(position);
  vec4 pv0 = modelViewMatrix * vec4(d, 1.0);
  float upp = unitsPerPxAt(pv0);
  float h = terrainHeightM(d, upp);
  vec3 c = d * (1.0 + uLift + h * uHeightScale);
  float miter = length(aOff);
  vec3 n = aOff / max(miter, 1e-6);
  // screen px per local unit along the offset direction (tilt-aware)
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(c, 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(c + n * 1e-3, 1.0);
  vec2 sp = (c1.xy / c1.w - c0.xy / c0.w) * 0.5 * uViewport;
  float pxPerUnit = max(length(sp) * 1000.0, 1e-3);
  int ri = int(clamp(rank, 0.0, 8.0) + 0.5);
  float half0 = 0.5 * uWidthKm[ri] / 6371.0;
  float halfW = clamp(0.5 * uMinPx / pxPerUnit, half0, half0 * 4.0);
  vec3 p = c + n * (halfW * miter * aMeta.x);
  vSide = aMeta.x;
  vAlpha = fade;
  vNormalV = normalize(normalMatrix * d);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const fragmentShader = /* glsl */ `
layout(location = 0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
uniform vec3 uRiver;
uniform vec3 uEdge;
uniform vec3 uLightView;
uniform vec2 uDay;
uniform float uDim;
uniform float uAlpha;
in float vSide;
in float vAlpha;
in vec3 vNormalV;
void main() {
  float a = abs(vSide);
  // coverage-style 1 px edge: a 1.2 px ribbon keeps a full-strength core (a plain
  // smoothstep over fwidth would fade the whole of a thin ribbon)
  float aa = max(fwidth(vSide), 1e-4);
  float edge = clamp((1.0 - a) / aa + 0.5, 0.0, 1.0);
  vec3 col = mix(uRiver, uEdge, smoothstep(0.45, 0.95, a));
  float day = mix(uDay.x, uDay.y, dot(normalize(vNormalV), uLightView) * 0.5 + 0.5);
  col *= day * (1.0 - 0.78 * uDim);
  gl_FragColor = vec4(col, vAlpha * uAlpha * edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export interface RibbonUniforms extends LiftUniforms {
  uFade: THREE.IUniform<THREE.Vector3>
  uLift: THREE.IUniform<number>
  uMinPx: THREE.IUniform<number>
  uViewport: THREE.IUniform<THREE.Vector2>
  uDim: THREE.IUniform<number>
  uAlpha: THREE.IUniform<number>
}

export function makeRibbonMaterial(lift: LiftUniforms): THREE.ShaderMaterial & { uniforms: RibbonUniforms } {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      ...lift,
      uFade: { value: new THREE.Vector3() },
      uLift: { value: LIFT.ribbon },
      uMinPx: { value: 1.5 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uWidthKm: { value: [...RIVER_WIDTH_KM] },
      uRiver: { value: new THREE.Color(look.river) },
      uEdge: { value: new THREE.Color(RIVER_EDGE) },
      uLightView: { value: new THREE.Vector3(...look.lightView).normalize() },
      uDay: { value: new THREE.Vector2(...look.day) },
      uDim: { value: 0 },
      uAlpha: { value: 0.95 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: THREE.DoubleSide,
  })
  return m as THREE.ShaderMaterial & { uniforms: RibbonUniforms }
}
