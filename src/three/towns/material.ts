/**
 * Town material: the monument material (three painted face tones, upper-left key light,
 * OKLab L cap 0.70, inverted-hull ink outline) with the ships' two changes for a 14-36 px
 * token: a per-instance alpha (iAlpha: a town fades in, out at the horizon and with the
 * section dim instead of popping; transparent, still depth-writing) and no engraved
 * hatching (on a 4 px cottage it reads as noise; the threshold moves past any town size).
 */
import * as THREE from 'three'
import { makeMonumentMaterial, attachInstanceAttributes, type MonumentUniforms } from '../monuments/material'

function patch(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`town material: shader anchor missing: ${from}`)
  return src.replace(from, to)
}

export function makeTownMaterial(): THREE.ShaderMaterial & { uniforms: MonumentUniforms } {
  const m = makeMonumentMaterial()
  let vs = m.vertexShader
  vs = patch(vs, 'attribute float iLift;', 'attribute float iLift;\n  attribute float iAlpha;\n  varying float vAlpha;')
  vs = patch(vs, 'vCol = aCol;', 'vCol = aCol;\n    vAlpha = iAlpha;')
  let fs = m.fragmentShader
  fs = patch(fs, 'varying float vHPx;', 'varying float vHPx;\n  varying float vAlpha;')
  fs = patch(fs, 'float hatchOn = smoothstep(20.0, 26.0, vHPx);', 'float hatchOn = smoothstep(90.0, 110.0, vHPx);')
  fs = patch(fs, 'gl_FragColor = vec4(col, 1.0);', 'if (vAlpha < 0.004) discard;\n    gl_FragColor = vec4(col, vAlpha);')
  m.vertexShader = vs
  m.fragmentShader = fs
  m.transparent = true
  m.depthWrite = true
  m.needsUpdate = true
  return m
}

/** The monument instance attributes plus iAlpha. */
export function attachTownAttributes(g: THREE.BufferGeometry, count: number) {
  const base = attachInstanceAttributes(g, count)
  base.iVar.setUsage(THREE.DynamicDrawUsage)
  const iAlpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('iAlpha', iAlpha)
  return { ...base, iAlpha }
}
