/**
 * Ship material: the monument material (three painted face tones, upper-left key light,
 * OKLab L cap 0.70, inverted-hull ink outline) with two changes for an 18-26 px token:
 *  - a per-instance alpha (iAlpha) so a ship fades at a coast, the horizon or a section
 *    change instead of popping (transparent, still depth-writing; hull and model share the
 *    one draw, so a half-faded ship shows a faint ink rim, briefly);
 *  - no engraved hatching (the monuments switch it on from 22 px tall; on a 20 px sail it
 *    reads as noise): its threshold is moved past any ship size.
 */
import * as THREE from 'three'
import { makeMonumentMaterial, attachInstanceAttributes, type MonumentUniforms } from '../monuments/material'

function patch(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`ship material: shader anchor missing: ${from}`)
  return src.replace(from, to)
}

export function makeShipMaterial(): THREE.ShaderMaterial & { uniforms: MonumentUniforms } {
  const m = makeMonumentMaterial()
  let vs = m.vertexShader
  vs = patch(vs, 'attribute float iLift;', 'attribute float iLift;\n  attribute float iAlpha;\n  varying float vAlpha;')
  vs = patch(vs, 'vCol = aCol;', 'vCol = aCol;\n    vAlpha = iAlpha;')
  let fs = m.fragmentShader
  fs = patch(fs, 'varying float vHPx;', 'varying float vHPx;\n  varying float vAlpha;')
  fs = patch(fs, 'float hatchOn = smoothstep(20.0, 26.0, vHPx);', 'float hatchOn = smoothstep(60.0, 72.0, vHPx);')
  // sailcloth (the pale paint) never takes the cool shade: a 20 px sail in shade read as a
  // dark blot; it drops to the half tone instead (lit / half only)
  fs = patch(fs, 'float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));', 'float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));\n      float cloth = step(0.2, dot(vCol, vec3(0.2126, 0.7152, 0.0722)));\n      shade *= 1.0 - cloth;\n      deep *= 1.0 - cloth;')
  fs = patch(fs, 'gl_FragColor = vec4(col, 1.0);', 'if (vAlpha < 0.004) discard;\n    gl_FragColor = vec4(col, vAlpha);')
  m.vertexShader = vs
  m.fragmentShader = fs
  m.transparent = true
  m.depthWrite = true
  m.needsUpdate = true
  return m
}

/** The monument instance attributes plus iAlpha. */
export function attachShipAttributes(g: THREE.BufferGeometry, count: number) {
  const base = attachInstanceAttributes(g, count)
  const iAlpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('iAlpha', iAlpha)
  return { ...base, iAlpha }
}
