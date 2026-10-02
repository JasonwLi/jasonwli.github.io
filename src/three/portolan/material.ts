/**
 * Portolan ocean marks material (portolan/Portolan.tsx): one instanced spherical cap per wind
 * rose, lying on the sea surface, drawn analytically in the fragment shader (no texture, so
 * every line stays crisp at any zoom):
 *
 *  - the ROSE: an engraved 32-point wind rose in cut lines only (Brass Is Cut): the eight
 *    winds (cardinals longer, in gilt; intercardinals in tempered brass), eight half winds
 *    and sixteen quarter winds as kite outlines with their spines, the points stacked like
 *    an engraving (a lower point's lines are hidden inside the points above it), a ring
 *    behind the star, a double outer ring with 32 ticks (128 fine ticks once the rose is
 *    large), a small hub circle and a plain north mark (an open lozenge with a cross-guard)
 *    beyond the north point. Each cut sits on an incise groove offset half a pixel to the
 *    lower right (One Light). Detail steps in with the rose's own size on screen.
 *  - the RHUMBS: 32 rays leaving the outer ring along the 16 great circles through the rose
 *    centre (on a sphere the portolan's straight radials are great circles), as fine
 *    gilt-worn hairlines that fade with distance from the rose (gone by the cap edge); only
 *    the nearest ray is evaluated per pixel.
 *
 * Masked to open water by the terrain's coast SDF (fading in 40 -> 140 km offshore), faded at
 * the horizon, and yielding under the screen obstacles (uMask: a coarse CSS-px coverage grid
 * the CPU stamps with names, pins, towns, monuments, glyphs, ships and the drawn route). Line
 * widths are in CSS px (x the pixel ratio) from the screen derivative of each distance (anisotropy-correct
 * near the limb). Depth-tested on a lift above the sea, never depth-writing.
 */
import * as THREE from 'three'
import { tokens } from '../../theme/tokens'

/** the cap's angular radius (rad): the rhumbs are gone before it */
export const CAP_RAD = 0.5
const RINGS = 28
const SEGS = 96

const vertexShader = /* glsl */ `
  attribute vec3 iC;     // the rose centre (unit, globe-local)
  attribute vec3 iE;     // its east
  attribute vec3 iN;     // its north
  attribute float iR;    // the rose radius (rad)
  uniform float uLift;
  varying vec3 vDir;
  varying vec3 vC;
  varying vec3 vE;
  varying vec3 vN;
  varying float vR;
  void main() {
    // position = (sin a cos az, sin a sin az, cos a) around +z
    vec3 d = normalize(iE * position.x + iN * position.y + iC * position.z);
    vDir = d;
    vC = iC;
    vE = iE;
    vN = iN;
    vR = iR;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(d * (1.0 + uLift), 1.0);
  }
`

const fragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform samplerCube uTerrain;
  uniform float uHasTerrain;
  uniform sampler2D uMask;
  uniform vec2 uMaskSize;   // cells
  uniform float uMaskCell;  // CSS px per cell
  uniform vec2 uViewport;   // CSS px
  uniform float uPxRatio;
  uniform vec3 uCamLocal;   // the camera in globe-local units
  uniform float uAlpha;     // section x zoom x mode fade
  uniform float uRoseAlpha;
  uniform float uRhumbAlpha;
  uniform float uCap;
  uniform float uDebugMask;
  uniform vec3 cGilt;
  uniform vec3 cGilt2;
  uniform vec3 cWorn;
  uniform vec3 cIncise;
  varying vec3 vDir;
  varying vec3 vC;
  varying vec3 vE;
  varying vec3 vN;
  varying float vR;

  const float PI = 3.14159265359;
  const float S8 = 0.38268343;  // sin 22.5
  const float C8 = 0.92387953;
  const float S16 = 0.19509032; // sin 11.25
  const float C16 = 0.98078528;

  // coverage of a line of half width w (device px) at distance dpx; thinner than 1 px dims
  float cut(float dpx, float w) {
    float ww = max(w, 0.5);
    return clamp(ww + 0.5 - dpx, 0.0, 1.0) * (w / ww);
  }
  float segD(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }
  vec2 rot(vec2 p, float a) {
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  // a kite point along +y: centre -> base corners (radius b, +-half angle) -> tip L.
  // returns (distance to its two outer edges, inside 0/1, distance to its spine)
  vec3 kite(vec2 p, float L, float b, float sh, float ch) {
    vec2 bl = vec2(-b * sh, b * ch), br = vec2(b * sh, b * ch), tip = vec2(0.0, L);
    float dEdge = min(segD(p, bl, tip), segD(p, br, tip));
    float dSpine = segD(p, vec2(0.0, b * ch * 0.5), tip);
    float inside = 0.0;
    if (p.y > 0.0 && p.y < L) {
      float hw = p.y < b * ch ? p.y * (sh / ch) : b * sh * (L - p.y) / (L - b * ch);
      inside = step(abs(p.x), hw);
    }
    return vec3(dEdge, inside, dSpine);
  }

  // the rose at q (rose radii, x east / y north); u = rose radii per device px, rpx = the
  // rose radius in CSS px (detail steps). Returns (coverage gilt, coverage tempered)
  vec2 rose(vec2 q, float u, float rpx) {
    float r = length(q);
    if (r > 1.32) return vec2(0.0);
    float th = atan(q.x, q.y); // bearing, clockwise from north
    float hair = 0.5 * uPxRatio; // a 1 CSS px cut
    float g = 0.0, t = 0.0;
    // ---- the eight winds (the nearest two)
    float k = floor(th / (PI / 4.0) + 0.5);
    float side = th - k * PI / 4.0 > 0.0 ? 1.0 : -1.0;
    float inMain = 0.0;
    for (int i = 0; i < 2; i++) {
      float kk = k + float(i) * side;
      float ki = mod(kk + 8.0, 8.0);
      bool card = mod(ki, 2.0) < 0.5;
      vec2 p = rot(q, kk * PI / 4.0); // the point at bearing kk*45 brought to +y
      vec3 kd = kite(p, card ? 0.9 : 0.64, 0.15, S8, C8);
      inMain = max(inMain, kd.y);
      float c = cut(kd.x / u, card ? hair * 1.3 : hair);
      float s = cut(kd.z / u, hair * 0.8) * 0.7;
      if (card) g = max(g, max(c, s)); else t = max(t, max(c, s));
    }
    // ---- the eight half winds, hidden inside the winds
    float k2 = floor((th - PI / 8.0) / (PI / 4.0) + 0.5);
    vec2 p2 = rot(q, k2 * PI / 4.0 + PI / 8.0);
    vec3 hd = kite(p2, 0.5, 0.11, S8, C8);
    float hwind = max(cut(hd.x / u, hair), cut(hd.z / u, hair * 0.8) * 0.6) * (1.0 - inMain);
    float inHalf = max(inMain, hd.y);
    t = max(t, hwind * smoothstep(26.0, 40.0, rpx));
    // ---- the sixteen quarter winds (large roses only)
    float qd = smoothstep(55.0, 85.0, rpx);
    if (qd > 0.0) {
      float k3 = floor((th - PI / 16.0) / (PI / 8.0) + 0.5);
      vec2 p3 = rot(q, k3 * PI / 8.0 + PI / 16.0);
      vec3 qk = kite(p3, 0.36, 0.08, S16, C16);
      float quarter = max(cut(qk.x / u, hair * 0.85), cut(qk.z / u, hair * 0.7) * 0.5) * (1.0 - inHalf);
      t = max(t, quarter * qd);
      inHalf = max(inHalf, qk.y * qd);
    }
    // ---- the ring behind the star and the hub
    t = max(t, cut(abs(r - 0.3) / u, hair * 0.85) * (1.0 - inHalf) * smoothstep(30.0, 45.0, rpx));
    g = max(g, cut(abs(r - 0.035) / u, hair));
    // ---- the outer double ring and its ticks
    t = max(t, cut(abs(r - 1.0) / u, hair));
    t = max(t, cut(abs(r - 0.955) / u, hair * 0.85) * smoothstep(22.0, 34.0, rpx));
    if (r > 0.955 && r < 1.0) {
      float a32 = th / (PI / 16.0);
      float dt32 = abs(a32 - floor(a32 + 0.5)) * (PI / 16.0) * r; // arc distance, rose radii
      t = max(t, cut(dt32 / u, hair * 0.8) * smoothstep(34.0, 50.0, rpx));
      float a128 = th / (PI / 64.0);
      float dt128 = abs(a128 - floor(a128 + 0.5)) * (PI / 64.0) * r;
      t = max(t, cut(dt128 / u, hair * 0.6) * step(r, 0.98) * smoothstep(120.0, 170.0, rpx) * 0.8);
    }
    // ---- the north mark beyond the north point: an open lozenge on a cross-guard
    float nm = smoothstep(24.0, 36.0, rpx);
    if (nm > 0.0 && q.y > 0.98 && q.y < 1.3 && abs(q.x) < 0.12) {
      vec2 a = vec2(0.0, 1.03), b = vec2(0.055, 1.13), c = vec2(0.0, 1.26), d = vec2(-0.055, 1.13);
      float dl = min(min(segD(q, a, b), segD(q, b, c)), min(segD(q, c, d), segD(q, d, a)));
      float dg = segD(q, vec2(-0.085, 1.06), vec2(0.085, 1.06));
      g = max(g, max(cut(dl / u, hair), cut(dg / u, hair * 0.85)) * nm);
    }
    return vec2(g, t);
  }

  void main() {
    vec3 d = normalize(vDir);
    float cosA = dot(d, vC);
    float ang = acos(clamp(cosA, -1.0, 1.0));
    // azimuthal-equidistant coordinates around the rose (rose radii)
    vec3 tng = d - vC * cosA;
    float tl = length(tng);
    vec2 dirT = tl > 1e-7 ? vec2(dot(tng, vE), dot(tng, vN)) / tl : vec2(0.0, 1.0);
    vec2 q = dirT * (ang / vR);
    // screen derivatives first (uniform control flow)
    vec2 qx = dFdx(q), qy = dFdy(q);
    float dE = dot(d, vE), dN = dot(d, vN);
    vec2 gE = vec2(dFdx(dE), dFdy(dE)), gN = vec2(dFdx(dN), dFdy(dN));
    // rose radii per device px (geometric mean of the screen Jacobian)
    float u = sqrt(max(abs(qx.x * qy.y - qx.y * qy.x), 1e-12));
    float rpx = 1.0 / (u * uPxRatio); // the rose radius in CSS px
    float r = length(q);

    if (ang > uCap) discard;
    // horizon: fade where the sea turns away from the eye
    vec3 toCam = normalize(uCamLocal - d);
    float facing = dot(toCam, d);
    float hor = smoothstep(0.08, 0.3, facing);
    if (hor <= 0.0) discard;
    // open water only, clear of the coast paint
    float sea = 1.0;
    if (uHasTerrain > 0.5) {
      float coastKm = (texture(uTerrain, d).b - 0.5) * 256.0;
      sea = 1.0 - smoothstep(-140.0, -40.0, coastKm);
    }
    if (sea <= 0.0) discard;
    // the screen obstacles (names, pins, ships, the route ...)
    vec2 css = vec2(gl_FragCoord.x / uPxRatio, uViewport.y - gl_FragCoord.y / uPxRatio);
    float block = texture(uMask, css / (uMaskCell * uMaskSize)).r;

    // ---- rhumbs: the 16 great circles through the centre, outside the outer ring. A point
    // at bearing th lies on the circle of bearing b at a distance with sin = sin(ang) sin(th - b),
    // so only the nearest of the 32 rays matters; the circle's plane normal is
    // n = N sin b - E cos b, so s = dot(d, n) and its screen gradient come from dE / dN
    float rh = 0.0;
    if (r > 1.0) {
      float th = atan(dirT.x, dirT.y);
      float k = floor(th / (PI / 16.0) + 0.5);
      float b = k * PI / 16.0;
      float cb = cos(b), sb = sin(b);
      float s = dN * sb - dE * cb;
      vec2 gs = vec2(gN.x * sb - gE.x * cb, gN.y * sb - gE.y * cb);
      float spx = abs(s) / max(length(gs), 1e-9);
      // the eight winds (every 45 deg) a touch stronger; half winds; quarter winds
      float km = mod(k + 32.0, 4.0);
      float cls = km < 0.5 ? 1.0 : abs(km - 2.0) < 0.5 ? 0.72 : 0.5;
      rh = cut(spx, 0.5 * uPxRatio) * cls;
      // from the ring outwards: full near it, gone by the cap edge
      rh *= smoothstep(1.0, 1.25, r) * (1.0 - smoothstep(0.12, uCap * 0.96, ang));
    }

    // ---- the rose and its incise groove (offset half a CSS px to the lower right)
    vec2 cr = vec2(0.0);
    float groove = 0.0;
    if (r < 1.32) {
      cr = rose(q, u, rpx);
      vec2 o = 0.5 * uPxRatio * (qx - qy); // q at the pixel half a CSS px up-left
      vec2 cg = rose(q - o, u, rpx);
      groove = max(cg.x, cg.y);
    }

    float base = uAlpha * sea * hor;
    float aRh = rh * uRhumbAlpha * (1.0 - block);
    // a small rose (wide view) packs its cuts densely: it steps back a little
    float aRose = uRoseAlpha * (1.0 - 0.65 * block) * mix(0.75, 1.0, smoothstep(30.0, 90.0, rpx));
    float aG = cr.x * aRose;
    float aT = cr.y * aRose * 0.85;
    float aI = groove * aRose * 0.55;
    // composite (over): groove, then the rhumbs, then the tempered and gilt cuts
    vec3 col = cIncise;
    float a = aI;
    col = mix(col, cWorn, aRh / max(a + aRh * (1.0 - a), 1e-5));
    a = a + aRh * (1.0 - a);
    col = mix(col, cGilt2, aT / max(a + aT * (1.0 - a), 1e-5));
    a = a + aT * (1.0 - a);
    col = mix(col, cGilt, aG / max(a + aG * (1.0 - a), 1e-5));
    a = a + aG * (1.0 - a);
    a *= base;
    if (uDebugMask > 0.5) {
      col = mix(col, vec3(1.0, 0.0, 0.0), block);
      a = max(a, block * 0.45 * base);
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

export interface PortolanUniforms {
  [k: string]: THREE.IUniform
}

export function makePortolanMaterial(mask: THREE.Texture): THREE.ShaderMaterial {
  const c = (hex: string) => new THREE.Color(hex)
  return new THREE.ShaderMaterial({
    name: 'portolan',
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    uniforms: {
      uTerrain: { value: null },
      uHasTerrain: { value: 0 },
      uMask: { value: mask },
      uMaskSize: { value: new THREE.Vector2(1, 1) },
      uMaskCell: { value: 4 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uPxRatio: { value: 1 },
      uCamLocal: { value: new THREE.Vector3(0, 0, 3) },
      uAlpha: { value: 0 },
      uRoseAlpha: { value: 0.5 },
      uRhumbAlpha: { value: 0.4 },
      uCap: { value: CAP_RAD },
      uDebugMask: { value: 0 },
      uLift: { value: 0.0006 },
      cGilt: { value: c(tokens.gilt) },
      cGilt2: { value: c(tokens.gilt2) },
      cWorn: { value: c(tokens.giltWorn) },
      cIncise: { value: c(tokens.incise) },
    },
  })
}

/** One spherical cap (angular radius CAP_RAD around +z) instanced per rose. */
export function makePortolanGeometry(count: number) {
  const pos: number[] = []
  const idx: number[] = []
  pos.push(0, 0, 1)
  for (let i = 1; i <= RINGS; i++) {
    const a = (CAP_RAD * 1.02 * i) / RINGS
    for (let j = 0; j < SEGS; j++) {
      const az = (2 * Math.PI * j) / SEGS
      pos.push(Math.sin(a) * Math.cos(az), Math.sin(a) * Math.sin(az), Math.cos(a))
    }
  }
  for (let j = 0; j < SEGS; j++) idx.push(0, 1 + j, 1 + ((j + 1) % SEGS))
  for (let i = 1; i < RINGS; i++) {
    const r0 = 1 + (i - 1) * SEGS, r1 = 1 + i * SEGS
    for (let j = 0; j < SEGS; j++) {
      const j1 = (j + 1) % SEGS
      idx.push(r0 + j, r1 + j, r1 + j1, r0 + j, r1 + j1, r0 + j1)
    }
  }
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const mk = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(count * n), n)
  const iC = mk(3), iE = mk(3), iN = mk(3), iR = mk(1)
  g.setAttribute('iC', iC)
  g.setAttribute('iE', iE)
  g.setAttribute('iN', iN)
  g.setAttribute('iR', iR)
  g.instanceCount = count
  return { geometry: g, iC, iE, iN, iR }
}
