/**
 * Monument material (C5, finish-review re-authoring): GLSL3 ShaderMaterial shared by every
 * archetype mesh, painted to sit in the terrain's painted-relief world rather than read as
 * flat grey primitives.
 *
 * - Light: the terrain's view-space upper-left key (look.lightView) and soft day ramp
 *   (look.day) on the ground normal. Each flat facet (screen-derivative normal) is sorted by
 *   how it faces the key light's bearing in the plane the form stands on (its drawn up: the
 *   instance's y axis, upright at wide views; the ground normal made the lit side swing
 *   with the position on the disc) into THREE PAINTED FACE TONES with wide
 *   value steps (finish review round 2): lit walls/roof slopes a warm sunlit ochre (x1.22,
 *   38% toward look.monumentWarm), flat roofs and side-on facets the half tone (x0.66), walls
 *   turned away the cool blued shade (x0.30, 50% toward look.monumentCool), the deepest x0.62
 *   again. So every form shows a lit side against a shade side at 30-40 px.
 * - Engraving: screen-space 45 deg cuts sized in CSS px: dense (2.6 px pitch) on shade facets
 *   with a cross-cut (3.2 px) in the deepest shade, sparse (4.4 px) on the half tone, lit faces
 *   clean; on from 22 px tall, i.e. on every drawn monument.
 * - Lit colour capped at OKLab L 0.70 (critique), then the hover/active dim and the
 *   section dim (x (1 - 0.78 dim), the terrain's factor).
 * - Outline: an inverted hull drawn in a deep tone of the face's own paint (an ink cut,
 *   not a black band), expanded uOutlinePx (1.0) CSS px along the projected outward direction
 *   and pushed back uHullPush model heights in depth so it shows only on the silhouette and
 *   on real depth steps. (A shallow push let the hulls of thin parts, Milan's pinnacle rows,
 *   win the depth test over the wall behind them and merge into a black wedge.)
 * - Sub-mesh select: vertices whose aVar differs from the instance's iVar collapse.
 * - Wide-view miniatures (iLift): the whole form slides toward the eye along its view rays
 *   by iLift model heights, so an exaggerated upright token is never cut by the curved
 *   ground; at close zoom on displaced terrain, the relief rising above the form's base
 *   within its reach (Monuments RELIEF_*), so a monument in a valley is not buried by
 *   the exaggerated peaks around it; 0 on flat ground (plain terrain depth test).
 * - Theme guard (guardThemeColours, applied by Monuments to every archetype geometry): no
 *   gilt-like or vermilion faces whichever form they come from.
 * R1: vertex colours are linear (converted from sRGB hex at build), output goes through
 * tonemapping_fragment + colorspace_fragment.
 */
import * as THREE from 'three'
import { look } from '../terrain/look.ts'
import { tokens } from '../../theme/tokens.ts'
import { MONUMENT_CAP_L } from './palette.ts'

const vertexShader = /* glsl */ `
  attribute vec3 aCol;
  attribute vec3 aOut;
  attribute float aVar;
  attribute float aHull;
  attribute float iVar;
  attribute float iDim;
  attribute vec3 iUp;
  attribute float iLift;
  uniform vec2 uViewport;
  uniform float uOutlinePx;
  uniform float uHullPush;
  varying vec3 vCol;
  varying vec3 vPosV;
  varying vec3 vUpV;
  varying vec3 vModelUpV;
  varying float vHull;
  varying float vDim;
  varying float vHPx;
  void main() {
    vCol = aCol;
    vHull = aHull;
    vDim = iDim;
    if (abs(aVar - iVar) > 0.5) {
      vPosV = vec3(0.0);
      vUpV = vec3(0.0, 0.0, 1.0);
      vModelUpV = vec3(0.0, 1.0, 0.0);
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    mat4 mvi = modelViewMatrix * instanceMatrix;
    vec4 pv = mvi * vec4(position, 1.0);
    vUpV = normalize(mat3(modelViewMatrix) * iUp);
    // the form's own drawn up (upright on screen at wide views, the leaned ground normal
    // at close zoom): the facet tones are sorted against the light's bearing in the plane
    // the model stands on, so the same face is lit wherever on the disc it stands
    vModelUpV = normalize(mat3(mvi) * vec3(0.0, 1.0, 0.0));
    vec4 clip;
    float hV = length((mvi * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    // the monument's on-screen height in CSS px (model height 1 = the form's height)
    float hPx = hV * projectionMatrix[1][1] * 0.5 * uViewport.y / max(-pv.z, 1e-6);
    vHPx = hPx;
    // wide-view miniatures: slide the whole form toward the eye along its view rays (same
    // screen position, own depth order kept) so the curved ground never cuts into an
    // exaggerated token standing upright near the bottom of the disc
    pv.xyz -= normalize(pv.xyz) * iLift * hV;
    if (aHull > 0.5) {
      vec4 c0 = projectionMatrix * pv;
      vec4 c2 = projectionMatrix * (mvi * vec4(position + aOut * 0.03, 1.0));
      pv.xyz += normalize(pv.xyz) * uHullPush * hV;
      clip = projectionMatrix * pv;
      vec2 d = (c2.xy / c2.w - c0.xy / c0.w) * uViewport;
      float l = length(d);
      // the outline thins on the smaller monuments so a small form is not all ink
      float w = uOutlinePx * mix(0.8, 1.0, smoothstep(24.0, 44.0, hPx));
      if (l > 1e-6) clip.xy += (d / l) * w * 2.0 / uViewport * clip.w;
    } else {
      clip = projectionMatrix * pv;
    }
    vPosV = pv.xyz;
    gl_Position = clip;
  }
`

const fragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform vec3 uLightView;
  uniform vec2 uDay;
  uniform vec3 uIncise;
  uniform float uCap;
  uniform float uKnee;
  uniform float uDim;
  uniform float uPxRatio;
  uniform vec3 uWarm;
  uniform vec3 uCool;
  varying vec3 vCol;
  varying vec3 vPosV;
  varying vec3 vUpV;
  varying vec3 vModelUpV;
  varying float vHull;
  varying float vDim;
  varying float vHPx;
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
  // one engraved cut: a line of ~0.85 CSS px every pitch CSS px along direction dir
  float cut(vec2 p, vec2 dir, float pitch) {
    float t = dot(p, dir) / pitch;
    float d = abs(fract(t) - 0.5) * pitch; // CSS px from the line centre
    return 1.0 - smoothstep(0.3, 0.85, d);
  }
  void main() {
    vec3 col;
    if (vHull > 0.5) {
      // the ink cut: a deep tone of the paint it outlines, leaning to the groove colour
      col = mix(uIncise, vCol * 0.22, 0.3);
    } else {
      vec3 n = cross(dFdx(vPosV), dFdy(vPosV));
      float nl = length(n);
      n = nl > 1e-12 ? n / nl : -normalize(vPosV);
      if (dot(n, vPosV) > 0.0) n = -n; // facing the eye
      vec3 up = normalize(vUpV);
      float lu = dot(up, uLightView);
      float day = mix(uDay.x, uDay.y, lu * 0.5 + 0.5);
      // facet light relative to the ground it stands on, sorted into three painted tones
      // with wide value steps (finish review round 2: at 30-45 px the old +16% / -28% steps
      // merged into one pale block). Roofs and other up-facing facets take the half tone, so
      // a lit wall always reads against its roof; walls turned from the light take the cool
      // blued shade; the deepest facets go darker still.
      // facing toward the key light's ground-plane bearing: so every form has a lit side
      // and a shade side however near-vertical the light is in view space
      vec3 mup = normalize(vModelUpV);
      vec3 lt = uLightView - mup * dot(mup, uLightView);
      lt = dot(lt, lt) > 1e-6 ? normalize(lt) : vec3(-0.7071, 0.7071, 0.0);
      float side = dot(n - mup * dot(n, mup), lt);
      float lit = step(0.16, side);
      float shade = 1.0 - step(-0.16, side);
      float deep = 1.0 - step(-0.62, side);
      vec3 base = vCol * day;
      float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
      vec3 cHalf = base * 0.66;
      vec3 cLit = mix(base * 1.22, uWarm * lum * 1.3, 0.38);
      vec3 cShade = mix(base * 0.30, uCool * lum * 0.34, 0.5);
      col = cHalf;
      col = mix(col, cLit, lit);
      col = mix(col, cShade, shade);
      col = mix(col, cShade * 0.62, deep);
      // engraved hatching sized to the screen: a dense 45 deg cut on shade facets (a
      // cross-cut in the deepest shade) and a sparse one on the half tone; lit faces stay
      // clean. On from 22 px tall, so every drawn monument (30-40 px) carries it.
      float hatchOn = smoothstep(20.0, 26.0, vHPx);
      if (hatchOn > 0.0) {
        vec2 p = gl_FragCoord.xy / uPxRatio;
        float hs = cut(p, vec2(0.7071, 0.7071), 2.6);
        hs = max(hs, deep * cut(p, vec2(0.7071, -0.7071), 3.2));
        float hh = cut(p, vec2(0.7071, 0.7071), 4.4) * (1.0 - lit) * (1.0 - shade);
        col = mix(col, col * 0.42, hs * shade * hatchOn * 0.85);
        col = mix(col, col * 0.62, hh * hatchOn * 0.6);
      }
      col = capLuma(col, uCap, uKnee);
    }
    col *= (1.0 - 0.5 * vDim) * (1.0 - 0.78 * uDim);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface MonumentUniforms {
  [k: string]: THREE.IUniform
  uViewport: THREE.IUniform<THREE.Vector2>
  uOutlinePx: THREE.IUniform<number>
  uHullPush: THREE.IUniform<number>
  uDim: THREE.IUniform<number>
  uPxRatio: THREE.IUniform<number>
}

function unitLuma(c: THREE.Color): THREE.Vector3 {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return new THREE.Vector3(c.r / l, c.g / l, c.b / l)
}

export function makeMonumentMaterial(): THREE.ShaderMaterial & { uniforms: MonumentUniforms } {
  const m = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uOutlinePx: { value: 1.0 },
      uHullPush: { value: 0.22 },
      uLightView: { value: new THREE.Vector3(...look.lightView).normalize() },
      uDay: { value: new THREE.Vector2(...look.day) },
      uIncise: { value: new THREE.Color(tokens.incise) },
      uCap: { value: MONUMENT_CAP_L },
      uKnee: { value: 0.04 },
      uDim: { value: 0 },
      uPxRatio: { value: 1 },
      // the painted relief's warm light and cool shade (linear, unit luminance)
      uWarm: { value: unitLuma(new THREE.Color(look.monumentWarm)) },
      uCool: { value: unitLuma(new THREE.Color(look.monumentCool)) },
    },
  })
  return m as THREE.ShaderMaterial & { uniforms: MonumentUniforms }
}

/** Per-instance attributes every archetype mesh carries (sub-mesh select, dim, ground normal, depth lift in model heights). */
export function attachInstanceAttributes(g: THREE.BufferGeometry, count: number) {
  const iVar = new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
  const iDim = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage)
  const iUp = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage)
  const iLift = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('iVar', iVar)
  g.setAttribute('iDim', iDim)
  g.setAttribute('iUp', iUp)
  g.setAttribute('iLift', iLift)
  return { iVar, iDim, iUp, iLift }
}

// ---------------------------------------------------------------- theme colour guard

function linToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToLin(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/**
 * The theme's colour rules applied to any monument paint, whoever authored the form
 * (DESIGN.md: The Brass Is Cut Rule, The One Active Place Rule): a gilt-like face
 * (OKLCh hue 74-94, chroma >= 0.075 — the brass family) is set back to an aged,
 * low-chroma brass-stone (C 0.045, L <= 0.58) so gilt stays a cut line; a vermilion-like
 * face (hue 20-46, C >= 0.13) is held at C 0.11. Returns a guarded copy of the linear
 * vertex-colour attribute (the source geometry is shared and left untouched) and the
 * number of vertices changed.
 */
export function guardThemeColours(src: THREE.BufferAttribute): { attr: THREE.BufferAttribute; changed: number } {
  const a = src.array as Float32Array
  const out = new Float32Array(a.length)
  let changed = 0
  const cache = new Map<string, [number, number, number] | null>()
  for (let i = 0; i < a.length; i += 3) {
    const key = `${a[i]},${a[i + 1]},${a[i + 2]}`
    let hit = cache.get(key)
    if (hit === undefined) {
      hit = null
      const [L, ca, cb] = linToOklab(a[i], a[i + 1], a[i + 2])
      const C = Math.hypot(ca, cb)
      const h = ((Math.atan2(cb, ca) * 180) / Math.PI + 360) % 360
      let C2 = C
      let L2 = L
      if (h >= 74 && h <= 94 && C >= 0.075) {
        C2 = 0.045
        L2 = Math.min(L, 0.58)
      } else if (h >= 20 && h <= 46 && C >= 0.13) C2 = 0.11
      if (C2 !== C || L2 !== L) {
        const k = C > 1e-6 ? C2 / C : 0
        const rgb = oklabToLin(L2, ca * k, cb * k)
        hit = [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2])]
      }
      cache.set(key, hit)
    }
    if (hit) {
      out[i] = hit[0]
      out[i + 1] = hit[1]
      out[i + 2] = hit[2]
      changed++
    } else {
      out[i] = a[i]
      out[i + 1] = a[i + 1]
      out[i + 2] = a[i + 2]
    }
  }
  return { attr: new THREE.BufferAttribute(out, 3), changed }
}
