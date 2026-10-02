/**
 * Life-on-the-map material (life/Life.tsx): one instanced quad, one draw call, four kinds of
 * painted wash, all procedural (no texture):
 *  0 SMOKE  a soft round puff, billboarded at its anchor (px offset + px size);
 *  1 MIST   a wide low spray puff, billboarded;
 *  2 BOW    a faint three-band arc (muted rose / sage / pale blue: never gilt, never vermilion);
 *  3 CLOUD  a flat elongated wisp lying on a shell above the terrain (tangent quad, world size).
 * Painted, not photoreal: a static per-instance value-noise edge (the forms never boil; motion
 * is only the CPU-placed drift / rise), a two-tone fill lit from the upper left (One Light:
 * a dome normal from the density gradient against the key in screen space), and a faint
 * engraved hatch on the shade side. Whites are capped at OKLab L 0.80 (look.ts life tones), so
 * nothing glares on the dark page; alpha is the paint's opacity, never additive.
 *
 * Depth: billboards take their anchor's depth (the CPU slides the anchor toward the eye along
 * its view ray, so it sits in front of its own summit without moving on screen); clouds are
 * real geometry above the relief. Depth-tested, never depth-writing.
 */
import * as THREE from 'three'
import { look } from '../terrain/look'

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iRect;   // billboards: offset px (x, y up), half size px (w, h)
  attribute vec3 iE;      // clouds: the quad's half axes on the shell (globe-local)
  attribute vec3 iN;
  attribute vec4 iMeta;   // kind, alpha, seed, age (smoke: 0..1 of its rise)
  uniform vec2 uViewport;
  varying vec2 vUv;
  varying vec4 vMeta;
  varying vec2 vLight;
  varying vec2 vPxPerUv;
  const vec2 KEY = vec2(-0.6402, 0.7682); // upper left, screen space (y up)
  void main() {
    vUv = position.xy * 2.0;
    vMeta = iMeta;
    vec4 clip;
    if (iMeta.x > 2.5) {
      vec3 p = iPos + iE * vUv.x + iN * vUv.y;
      mat4 mvp = projectionMatrix * modelViewMatrix;
      clip = mvp * vec4(p, 1.0);
      // the key light in the quad's own uv frame (its axes as seen on screen)
      vec4 c0 = mvp * vec4(iPos, 1.0);
      vec4 cx = mvp * vec4(iPos + iE, 1.0);
      vec4 cy = mvp * vec4(iPos + iN, 1.0);
      vec2 s0 = c0.xy / c0.w * uViewport * 0.5;
      vec2 ax = cx.xy / cx.w * uViewport * 0.5 - s0;
      vec2 ay = cy.xy / cy.w * uViewport * 0.5 - s0;
      vPxPerUv = vec2(length(ax), length(ay));
      vLight = normalize(vec2(dot(normalize(ax), KEY), dot(normalize(ay), KEY)) + 1e-5);
    } else {
      clip = projectionMatrix * modelViewMatrix * vec4(iPos, 1.0);
      vec2 px = iRect.xy + vUv * iRect.zw;
      clip.xy += px * 2.0 / uViewport * clip.w;
      vPxPerUv = iRect.zw;
      vLight = KEY;
    }
    gl_Position = iMeta.y < 0.003 ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
  }
`

const fragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform vec3 uSmokeLit;
  uniform vec3 uSmokeShade;
  uniform vec3 uMist;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec3 uBow0;
  uniform vec3 uBow1;
  uniform vec3 uBow2;
  uniform float uPxRatio;
  varying vec2 vUv;
  varying vec4 vMeta;
  varying vec2 vLight;
  varying vec2 vPxPerUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 7.1) + 0.15 * vnoise(p * 4.11 + 3.7);
  }

  // density 0..1 (a soft dome) of each kind at uv (-1..1)
  float puff(vec2 uv, float seed) {
    float n = fbm(uv * 1.9 + seed * 17.0);
    return 1.0 - length(uv * vec2(0.92, 1.08)) * (0.7 + 0.6 * n);
  }
  float mist(vec2 uv, float seed) {
    float n = fbm(uv * vec2(2.2, 3.0) + seed * 11.0);
    vec2 q = uv * vec2(1.0, 1.25);
    return 1.0 - length(q) * (0.78 + 0.5 * n);
  }
  float cloud(vec2 uv, float seed) {
    // one body of a few merged billows (soft union), its edge broken by a static noise and
    // its ends drawn out a little into east-west streaks
    float d = 1.0 - dot(uv * vec2(1.06, 1.3), uv * vec2(1.06, 1.3));
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 c = vec2(-0.45 + fi * 0.45 + (hash(vec2(seed, fi)) - 0.5) * 0.2, 0.12 + (hash(vec2(fi, seed)) - 0.5) * 0.2);
      vec2 q = (uv - c) / vec2(0.42, 0.62);
      d = max(d, 0.85 - dot(q, q));
    }
    float bill = fbm(uv * vec2(3.0, 4.2) + seed * 9.0);
    float streak = fbm(vec2(uv.x * 1.3, uv.y * 7.0) + seed * 5.0);
    d += 0.55 * (bill - 0.5) + 0.25 * (streak - 0.5) * abs(uv.x);
    // a flatter underside (painted map clouds sit on a level base)
    d -= 0.35 * smoothstep(0.2, 0.85, -uv.y);
    return d - 0.08;
  }
  float density(float kind, vec2 uv, float seed) {
    if (kind < 0.5) return puff(uv, seed);
    if (kind < 1.5) return mist(uv, seed);
    return cloud(uv, seed);
  }

  void main() {
    float kind = vMeta.x;
    float alpha = vMeta.y;
    float seed = vMeta.z;
    vec2 uv = vUv;
    if (kind > 1.5 && kind < 2.5) {
      // the faint bow: three muted bands on an arc filling the quad (ends at its lower
      // corners, crown at its top edge)
      float r = length(vec2(uv.x, (uv.y + 1.0) * 0.5));
      float t = (r - 0.84) / 0.16;
      if (t < 0.0 || t > 1.0) discard;
      float band = smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.75, 1.0, t));
      vec3 col = mix(uBow2, uBow1, smoothstep(0.28, 0.4, t));
      col = mix(col, uBow0, smoothstep(0.6, 0.72, t));
      float ends = smoothstep(-0.9, -0.2, uv.y);
      float a = band * ends * alpha;
      if (a < 0.004) discard;
      gl_FragColor = vec4(col, a);
      #include <colorspace_fragment>
      return;
    }
    float d = density(kind, uv, seed);
    float cov = smoothstep(0.0, kind > 2.5 ? 0.5 : 0.45, d);
    if (cov * alpha < 0.004) discard;
    // dome normal from the density gradient (uv-space), lit from the upper left
    vec2 e = vec2(0.06, 0.0);
    float dx = density(kind, uv + e.xy, seed) - density(kind, uv - e.xy, seed);
    float dy = density(kind, uv + e.yx, seed) - density(kind, uv - e.yx, seed);
    vec3 nrm = normalize(vec3(-dx, -dy, 0.12 + 0.25 * clamp(d, 0.0, 1.0)));
    float lit = clamp(dot(nrm, normalize(vec3(vLight, 0.9))) * 0.75 + 0.35, 0.0, 1.0);
    vec3 litCol = kind < 0.5 ? uSmokeLit : kind < 1.5 ? uMist : uCloudLit;
    vec3 shadeCol = kind < 0.5 ? uSmokeShade : kind < 1.5 ? mix(uMist, uCloudShade, 0.6) : uCloudShade;
    // smoke darkens a little as it ages and thins (ash, not steam)
    if (kind < 0.5) litCol = mix(litCol, shadeCol, 0.25 * vMeta.w);
    vec3 col = mix(shadeCol, litCol, smoothstep(0.15, 0.85, lit));
    // the side away from the key (the underside) sinks toward the shade tone
    float under = smoothstep(-0.1, 0.9, dot(uv, -vLight)) * (kind > 2.5 ? 0.55 : 0.3);
    col = mix(col, shadeCol, under);
    // engraved hatch on the shade side: 45 deg cuts at a 3 px pitch (screen space)
    float shade = 1.0 - smoothstep(0.2, 0.55, lit);
    float minPx = min(vPxPerUv.x, vPxPerUv.y);
    float pitch = 3.0 * uPxRatio;
    float cut = 1.0 - smoothstep(0.0, 0.9 * uPxRatio, abs(mod(gl_FragCoord.x + gl_FragCoord.y, pitch) - 0.5 * pitch) - 0.25 * pitch);
    col *= 1.0 - 0.16 * cut * shade * smoothstep(8.0, 16.0, minPx);
    float a = cov * alpha * (kind > 2.5 ? 0.5 : kind > 0.5 ? 0.58 : 0.74);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

export interface LifeUniforms {
  [k: string]: THREE.IUniform
  uViewport: { value: THREE.Vector2 }
  uPxRatio: { value: number }
}

export function makeLifeMaterial(): THREE.ShaderMaterial & { uniforms: LifeUniforms } {
  const c = (hex: string) => new THREE.Color(hex)
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uPxRatio: { value: 1 },
      uSmokeLit: { value: c(look.lifeSmokeLit) },
      uSmokeShade: { value: c(look.lifeSmokeShade) },
      uMist: { value: c(look.lifeMist) },
      uCloudLit: { value: c(look.lifeCloudLit) },
      uCloudShade: { value: c(look.lifeCloudShade) },
      uBow0: { value: c(look.lifeBow[0]) },
      uBow1: { value: c(look.lifeBow[1]) },
      uBow2: { value: c(look.lifeBow[2]) },
    },
  }) as THREE.ShaderMaterial & { uniforms: LifeUniforms }
}

/** The instanced quad and its per-instance attributes (capacity fixed at build). */
export function makeLifeGeometry(capacity: number) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = quad.index
  g.setAttribute('position', quad.getAttribute('position'))
  const mk = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage)
  const iPos = mk(3), iRect = mk(4), iE = mk(3), iN = mk(3), iMeta = mk(4)
  g.setAttribute('iPos', iPos)
  g.setAttribute('iRect', iRect)
  g.setAttribute('iE', iE)
  g.setAttribute('iN', iN)
  g.setAttribute('iMeta', iMeta)
  g.instanceCount = 0
  quad.dispose()
  return { geometry: g, iPos, iRect, iE, iN, iMeta }
}
