/**
 * Place pins (I1). The theme's hard-circle ring pins (critique: theme ring design,
 * I1's depth handling):
 *   photo      core r3.25 steel-deep · ring r3.25–4.5 gilt-2 · outer r4.5–5.5 incise   (≈10 px)
 *   photo-less 8 gilt dashes on a continuous incise ring over a 35% incise core (contrast)
 *   hover      core steel-raised · ring gilt · ×1.2, grown over 140 ms                (≈12 px)
 *   active     core r4.5 vermilion · r4.5–5.75 incise · r5.75–6.75 silver · r6.75–7.75 incise (≈16 px);
 *              the silver ring draws on clockwise from 12 o'clock over 260 ms once anchors.activeSettled
 * Sizes are CSS px, constant on screen (clip-space offset × w) and × anchors.pinScale
 * (work: 0.7 → 7 px). Vermilion appears on the active pin only.
 *
 * depthTest false + renderOrder 30 (pins sit above monuments, trees and labels); the
 * far side is hidden by the CPU horizon fade computed in pinsPx.ts (aVis), so pins
 * are never seen through the globe. No pulse: the instrument is still.
 *
 * Hover and active are drawn by a second 2-instance mesh at renderOrder 31 so they
 * always sit on top of their neighbours; the main mesh skips those two indices.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { locations } from '../../data/travel'
import { tokens } from '../../theme/tokens'
import { LIFT, R_SURFACE } from '../geo/radii'
import { globeState } from '../globeState'
import { pinEmpty, pinLiftVersion, pinLocal, pinVis, updatePinLift } from './pinsPx'

/**
 * Pin radius (globe radii) at zero terrain displacement. C1's fly-to solves the
 * sight point at this radius; the drawn pin adds max(0, h)·lod.heightScale on top.
 */
export const PING_RADIUS = R_SURFACE + LIFT.pin

/** Quad edge in CSS px at pinScale 1 (largest state: active r7.75, hover r6.6). */
const QUAD_PX = 24
const HOVER_MS = 140
const RING_MS = 260

const vertexShader = /* glsl */ `
  attribute vec3 aPos;
  attribute float aVis;
  attribute float aEmpty;
  attribute float aIndex;
  uniform vec2 uViewport;
  uniform float uPinScale;
  uniform float uActive;
  uniform float uHover;
  uniform float uHoverT;
  uniform float uSkipTop;
  varying vec2 vPx;
  varying float vState;
  varying float vScale;
  varying float vAlpha;
  void main() {
    float isA = abs(aIndex - uActive) < 0.5 ? 1.0 : 0.0;
    float isH = (1.0 - isA) * (abs(aIndex - uHover) < 0.5 ? 1.0 : 0.0);
    // state: 0 photo, 1 photo-less, 2 hover (+0.5 when photo-less), 3 active
    vState = isA > 0.5 ? 3.0 : (isH > 0.5 ? 2.0 + 0.5 * aEmpty : aEmpty);
    vScale = uPinScale * (isH > 0.5 ? mix(1.0, 1.2, uHoverT) : 1.0);
    vAlpha = aVis;
    vPx = position.xy * ${QUAD_PX.toFixed(1)} * uPinScale;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(aPos, 1.0);
    clip.xy += vPx * 2.0 / uViewport * clip.w;
    gl_Position = clip;
    // hidden instances (far side, or drawn by the top mesh) leave the clip volume
    if (aVis < 0.002 || (uSkipTop > 0.5 && (isA + isH) > 0.5)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  // GLSL3 ShaderMaterial: three declares no fragment output, so declare it here
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform vec3 cSteelDeep;
  uniform vec3 cSteelRaised;
  uniform vec3 cGilt;
  uniform vec3 cGilt2;
  uniform vec3 cIncise;
  uniform vec3 cVermilion;
  uniform vec3 cSilver;
  uniform float uDim;
  uniform float uRing;
  varying vec2 vPx;
  varying float vState;
  varying float vScale;
  varying float vAlpha;
  const float TAU = 6.28318530718;
  // coverage of a disc of radius r (px) at distance d, ~1 px AA
  float disc(float d, float r, float aa) { return clamp((r - d) / aa + 0.5, 0.0, 1.0); }
  void main() {
    float d = length(vPx) / vScale;                 // distance in unscaled pin px
    float aa = max(fwidth(d), 1e-3);
    float ang = fract(atan(vPx.x, vPx.y) / TAU);   // 0 at 12 o'clock, clockwise
    vec3 col;
    float a;
    if (vState > 2.75) {
      // active: vermilion core, incise, silver (drawn on), incise
      float silverOn = step(ang, uRing);
      col = cIncise;
      col = mix(col, mix(cIncise, cSilver, silverOn), disc(d, 6.75, aa));
      col = mix(col, cIncise, disc(d, 5.75, aa));
      col = mix(col, cVermilion, disc(d, 4.5, aa));
      a = disc(d, 7.75, aa);
    } else {
      bool hover = vState > 1.75;
      bool empty = fract(vState) > 0.25 || (vState > 0.75 && vState < 1.25);
      vec3 ring = hover ? cGilt : cGilt2;
      vec3 core = hover ? cSteelRaised : cSteelDeep;
      col = cIncise;
      col = mix(col, ring, disc(d, 4.5, aa));
      col = mix(col, core, disc(d, 3.25, aa));
      a = disc(d, 5.5, aa);
      if (empty) {
        // 8 gilt dashes on a continuous incise ring over a 35% incise core: the dashes
        // keep >= 3:1 on coasts, land and under route lines (INT contrast fix; the
        // transparent-core gilt-2 dashes fell to ~1.5:1)
        float f = fract(ang * 8.0);
        float fw = max(fwidth(ang * 8.0), 1e-3);
        float dash = clamp((0.5 - abs(f - 0.25) * 2.0) / fw + 0.5, 0.0, 1.0);
        float band = disc(d, 4.5, aa) * (1.0 - disc(d, 3.25, aa));
        col = mix(cIncise, cGilt, band * dash);
        a = disc(d, 5.5, aa) * mix(1.0, 0.35, disc(d, 3.0, aa));
      }
    }
    a *= vAlpha * (1.0 - uDim * 0.85);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function makeMaterial(skipTop: boolean) {
  const c = (hex: string) => ({ value: new THREE.Color(hex) })
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uPinScale: { value: 1 },
      uActive: { value: -1 },
      uHover: { value: -1 },
      uHoverT: { value: 1 },
      uSkipTop: { value: skipTop ? 1 : 0 },
      uDim: { value: 0 },
      uRing: { value: 0 },
      cSteelDeep: c(tokens.steelDeep),
      cSteelRaised: c(tokens.steelRaised),
      cGilt: c(tokens.gilt),
      cGilt2: c(tokens.gilt2),
      cIncise: c(tokens.incise),
      cVermilion: c(tokens.vermilion),
      cSilver: c(tokens.silver),
    },
  })
}

function makeGeometry(pos: Float32Array, vis: Float32Array, empty: Float32Array, index: Float32Array) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const g = new THREE.InstancedBufferGeometry()
  g.index = quad.index
  g.setAttribute('position', quad.getAttribute('position'))
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  g.setAttribute('aVis', new THREE.InstancedBufferAttribute(vis, 1).setUsage(THREE.DynamicDrawUsage))
  g.setAttribute('aEmpty', new THREE.InstancedBufferAttribute(empty, 1))
  g.setAttribute('aIndex', new THREE.InstancedBufferAttribute(index, 1).setUsage(THREE.DynamicDrawUsage))
  g.instanceCount = index.length
  return g
}

export function StarPins({ reducedMotion }: { reducedMotion: boolean }) {
  const size = useThree((s) => s.size)

  const parts = useMemo(() => {
    const n = locations.length
    updatePinLift(globeState.lod.heightScale)
    const index = new Float32Array(n)
    for (let i = 0; i < n; i++) index[i] = i
    const mainMat = makeMaterial(true)
    const main = new THREE.Mesh(makeGeometry(pinLocal, pinVis, pinEmpty, index), mainMat)
    main.frustumCulled = false
    main.renderOrder = 30
    main.raycast = () => {}
    // top mesh: [hover, active] copied from the shared arrays each frame
    const topPos = new Float32Array(6)
    const topVis = new Float32Array(2)
    const topEmpty = new Float32Array(2)
    const topIndex = new Float32Array([-1, -1])
    const topMat = makeMaterial(false)
    const top = new THREE.Mesh(makeGeometry(topPos, topVis, topEmpty, topIndex), topMat)
    top.frustumCulled = false
    top.renderOrder = 31
    top.raycast = () => {}
    return { main, top, mainMat, topMat, topPos, topVis, topEmpty, topIndex, version: { v: -1 } }
  }, [])

  useEffect(
    () => () => {
      parts.main.geometry.dispose()
      parts.top.geometry.dispose()
      parts.mainMat.dispose()
      parts.topMat.dispose()
    },
    [parts],
  )

  // hover grow and active ring timelines (ms clocks, frame-driven)
  const anim = useMemo(() => ({ hover: -1, hoverT: 1, active: -1, ring: 0, ringStart: 0 }), [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05) * 1000
    const g = globeState
    const a = g.anchors
    const { main, top, mainMat, topMat, topPos, topVis, topEmpty, topIndex, version } = parts
    const n = locations.length
    if (!n) return

    if (version.v !== pinLiftVersion) {
      version.v = pinLiftVersion
      ;(main.geometry.getAttribute('aPos') as THREE.InstancedBufferAttribute).needsUpdate = true
    }
    ;(main.geometry.getAttribute('aVis') as THREE.InstancedBufferAttribute).needsUpdate = true

    const ai = a.activeIndex
    const hi = a.hoverIndex === ai ? -1 : a.hoverIndex

    // hover: ring grows 10 → 12 px over 140 ms (instant under reduced motion)
    if (hi !== anim.hover) {
      anim.hover = hi
      anim.hoverT = reducedMotion ? 1 : 0
    }
    anim.hoverT = Math.min(1, anim.hoverT + dt / HOVER_MS)

    // active: silver outer ring draws on once, 260 ms, starting at the first settled frame
    if (ai !== anim.active) {
      anim.active = ai
      anim.ring = 0
      anim.ringStart = 0
    }
    if (ai >= 0 && anim.ring < 1) {
      if (reducedMotion) anim.ring = 1
      else if (a.activeSettled || anim.ringStart > 0) {
        anim.ringStart = 1
        anim.ring = Math.min(1, anim.ring + dt / RING_MS)
      }
    }

    // top mesh slots: 0 = hover, 1 = active
    for (let s = 0; s < 2; s++) {
      const i = s === 0 ? hi : ai
      topIndex[s] = i
      if (i >= 0 && i < n) {
        topPos[s * 3] = pinLocal[i * 3]
        topPos[s * 3 + 1] = pinLocal[i * 3 + 1]
        topPos[s * 3 + 2] = pinLocal[i * 3 + 2]
        topVis[s] = pinVis[i]
        topEmpty[s] = pinEmpty[i]
      } else topVis[s] = 0
    }
    const tg = top.geometry
    ;(tg.getAttribute('aPos') as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(tg.getAttribute('aVis') as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(tg.getAttribute('aEmpty') as THREE.InstancedBufferAttribute).needsUpdate = true
    ;(tg.getAttribute('aIndex') as THREE.InstancedBufferAttribute).needsUpdate = true

    for (let k = 0; k < 2; k++) {
      const u = (k === 0 ? mainMat : topMat).uniforms
      u.uViewport.value.set(size.width, size.height)
      u.uPinScale.value = a.pinScale
      u.uActive.value = ai
      u.uHover.value = hi
      u.uHoverT.value = anim.hoverT
      u.uDim.value = g.dim
      u.uRing.value = anim.ring
    }
  })

  if (locations.length === 0) return null
  return (
    <>
      <primitive object={parts.main} />
      <primitive object={parts.top} />
    </>
  )
}

export default StarPins
