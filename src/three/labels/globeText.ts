/**
 * Shared troika plumbing for the globe's lettering (C4): self-hosted fonts, the
 * no-CDN builder config, and GlobeBatchedText, a BatchedText whose per-member
 * "matrix" carries a globe frame instead of an affine transform.
 *
 * troika lays every member out in its own text plane (fontSize 1, so 1 unit = 1 em).
 * The batch shader normally multiplies by the member matrix; we replace that line so
 * each glyph vertex is
 *   1. lifted to the cap-centre line   q = (x, y + preY) · scale   (scale = units per em)
 *   2. bent along the label's in-plane arc (radius A, signed; + = arch toward 'up'):
 *        θ = q.x / A;  q = (A + q.y)(sin θ, cos θ) − (0, A)
 *   3. shifted by a post offset (declutter nudge / pin offset), in radius units
 *   4. wrapped onto the sphere with the exponential map about the label centre n:
 *        d = |q|;  p = (n cos d + (u q.x + v q.y)/d · sin d) · rLift
 *      (mode 1 = billboard: p = n·rLift + u q.x + v q.y, used by place labels)
 * and the fragment alpha is multiplied by the per-vertex horizon fade
 * smoothstep(0.12, 0.34, facing), so nothing ever shows on the far side even with
 * depthTest off. Members with opacity 0 collapse to a point (no fill cost).
 *
 * Member data (Text.matrix.elements, column-major, matrixAutoUpdate = false):
 *   [0..2] n (unit, globe-local)   [3]  rLift (radius units)
 *   [4..6] u (baseline direction)  [7]  arc radius A (radius units, 0 = straight)
 *   [8..10] v (text up)            [11] scale (radius units per em)
 *   [12] mode (0 sphere, 1 billboard)  [13] post offset u  [14] post offset v  [15] preY (em)
 *
 * troika never reaches a CDN: unicodeFontsURL points at a self-hosted path that does
 * not exist, and every string is sanitised to the fonts' generated coverage first, so
 * the fallback resolver is never even asked.
 */
import * as THREE from 'three'
import { BatchedText, Text, configureTextBuilder } from 'troika-three-text'
import { CAP_HEIGHT_EM, FONT_SUBSTITUTES, ITALIC_CHARS, TITLING_CHARS } from './fontCoverage'

const BASE = import.meta.env.BASE_URL
export const FONT_ITALIC = `${BASE}fonts/castoro-italic-labels.woff`
export const FONT_TITLING = `${BASE}fonts/castoro-titling-labels.woff`
export { CAP_HEIGHT_EM }

configureTextBuilder({
  sdfGlyphSize: 64,
  defaultFontURL: FONT_ITALIC,
  // never the jsdelivr default: a self-hosted (absent) path. Coverage makes it unreachable.
  unicodeFontsURL: `${BASE}fonts/no-unicode-fallback/`,
  useWorker: true,
})

const italicSet = new Set(Array.from(ITALIC_CHARS, (c) => c.codePointAt(0)!))
const titlingSet = new Set(Array.from(TITLING_CHARS, (c) => c.codePointAt(0)!))
const subs = new Map(FONT_SUBSTITUTES.map(([a, b]) => [a, b]))

/** Map/strip characters the self-hosted font cannot draw (e.g. U+02BB → U+2018). */
export function sanitize(text: string, cut: 'italic' | 'titling'): string {
  const set = cut === 'italic' ? italicSet : titlingSet
  let out = ''
  for (const ch of text) {
    let cp = ch.codePointAt(0)!
    if (!set.has(cp)) cp = subs.get(cp) ?? -1
    if (cp >= 0 && set.has(cp)) out += String.fromCodePoint(cp)
    else if (/\s/.test(ch)) out += ' '
    else if (import.meta.env.DEV) console.warn(`[labels] dropped U+${ch.codePointAt(0)!.toString(16)} from "${text}"`)
  }
  return out
}

const SHADER_PATCH_VERTEX = /(\w+)\.xyz = \(matrix \* vec4\(\1, 1\.0\)\)\.xyz;/
const GLOBE_VERTEX = (P: string) => `{
  vec3 gN = matrix[0].xyz; float gR = matrix[0].w;
  vec3 gU = matrix[1].xyz; float gArc = matrix[1].w;
  vec3 gV = matrix[2].xyz; float gS = matrix[2].w;
  vec4 gM = matrix[3];
  vec2 gq = vec2(${P}.x, ${P}.y + gM.w) * gS;
  if (abs(gArc) > 1e-9) {
    float gth = gq.x / gArc;
    float grr = gArc + gq.y;
    gq = vec2(grr * sin(gth), grr * cos(gth) - gArc);
  }
  gq += gM.yz;
  vec3 gP;
  if (gM.x > 0.5) {
    gP = gN * gR + gU * gq.x + gV * gq.y;
    vGlobeFace = 1.0;
  } else {
    float gd = length(gq);
    vec3 gt = gd > 1e-9 ? (gU * gq.x + gV * gq.y) / gd : gU;
    gP = (gN * cos(gd) + gt * sin(gd)) * gR;
    vec3 gw = (modelMatrix * vec4(gP, 1.0)).xyz;
    vec3 gc = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vGlobeFace = dot(normalize(gw - gc), normalize(cameraPosition - gw));
  }
  if (troikaBatchTexel(6.0).y <= 0.0005) gP = vec3(0.0);
  ${P} = gP;
}`
const SRGB_TO_LINEAR = `vec3 gSrgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`

/**
 * BatchedText with the globe frame transform. One draw call per pass (two when any
 * member has an outline). depthTest off, frustumCulled off (the member 'matrices' are
 * not affine, so troika's bounds are meaningless).
 */
export class GlobeBatchedText extends BatchedText {
  constructor(renderOrder: number) {
    super()
    this.frustumCulled = false
    this.renderOrder = renderOrder
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.raycast = () => {}
  }

  override createDerivedMaterial(baseMaterial: THREE.Material) {
    const m = super.createDerivedMaterial(baseMaterial)
    m.onBeforeCompile = (shader) => {
      let vs = shader.vertexShader
      if (!SHADER_PATCH_VERTEX.test(vs)) {
        console.error('[labels] troika batch shader changed: globe transform not applied')
      }
      vs = vs.replace(SHADER_PATCH_VERTEX, (_m, p: string) => GLOBE_VERTEX(p))
      // BatchedText packs colours with Color.getHex() (sRGB); decode so output conversion is right
      vs = vs.replace(/diffuse = troikaFloatToColor\(data\.x\);/, 'diffuse = gSrgbToLinear(troikaFloatToColor(data.x));')
      shader.vertexShader = `varying float vGlobeFace;\n${SRGB_TO_LINEAR}${vs}`
      shader.fragmentShader = `varying float vGlobeFace;\n${shader.fragmentShader.replace(
        'gl_FragColor.a *= edgeAlpha;',
        'gl_FragColor.a *= edgeAlpha * smoothstep(0.12, 0.34, vGlobeFace);',
      )}`
    }
    const key = m.customProgramCacheKey.bind(m)
    m.customProgramCacheKey = () => `${key()}|globe-text-1`
    return m
  }
}

/** A member Text configured for the batch (fontSize 1 = em units; we own its matrix). */
export function makeMember(text: string, font: string, letterSpacing: number, anchorX: 'center' | 'left'): Text {
  const t = new Text()
  t.text = text
  t.font = font
  t.fontSize = 1
  t.letterSpacing = letterSpacing
  t.anchorX = anchorX
  t.anchorY = 'top-cap'
  t.whiteSpace = 'nowrap'
  t.sdfGlyphSize = 64
  t.fillOpacity = 0
  t.matrixAutoUpdate = false
  return t
}

/** Write the globe-frame record into a member's matrix. */
export function writeMember(
  t: Text,
  n: THREE.Vector3,
  rLift: number,
  u: THREE.Vector3,
  arc: number,
  v: THREE.Vector3,
  scale: number,
  mode: 0 | 1,
  offU: number,
  offV: number,
  preY: number,
): void {
  const e = t.matrix.elements
  e[0] = n.x
  e[1] = n.y
  e[2] = n.z
  e[3] = rLift
  e[4] = u.x
  e[5] = u.y
  e[6] = u.z
  e[7] = arc
  e[8] = v.x
  e[9] = v.y
  e[10] = v.z
  e[11] = scale
  e[12] = mode
  e[13] = offU
  e[14] = offV
  e[15] = preY
}

/** CPU twin of the vertex transform (sphere mode), for screen bboxes. Writes `out` (globe-local). */
export function globePoint(
  n: THREE.Vector3,
  u: THREE.Vector3,
  v: THREE.Vector3,
  rLift: number,
  arc: number,
  x: number,
  y: number,
  offU: number,
  offV: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  let qx = x
  let qy = y
  if (Math.abs(arc) > 1e-9) {
    const th = qx / arc
    const rr = arc + qy
    qx = rr * Math.sin(th)
    qy = rr * Math.cos(th) - arc
  }
  qx += offU
  qy += offV
  const d = Math.hypot(qx, qy)
  const c = Math.cos(d)
  const s = d > 1e-9 ? Math.sin(d) / d : 1
  out.set(
    (n.x * c + (u.x * qx + v.x * qy) * s) * rLift,
    (n.y * c + (u.y * qx + v.y * qy) * s) * rLift,
    (n.z * c + (u.z * qx + v.z * qy) * s) * rLift,
  )
  return out
}

/** Unit direction (latLonToVec3 convention) and the local east / north tangents. */
export function frameAt(lat: number, lon: number, n: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3): void {
  const la = (lat * Math.PI) / 180
  const lo = (lon * Math.PI) / 180
  const cl = Math.cos(la)
  const sl = Math.sin(la)
  const co = Math.cos(lo)
  const so = Math.sin(lo)
  n.set(cl * co, sl, -cl * so)
  east.set(-so, 0, -co)
  north.set(-sl * co, cl, sl * so)
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
