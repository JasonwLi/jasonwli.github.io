/**
 * 2D engraved landmark glyphs (C5, all tiers) — 'map symbols in land ink'.
 *
 * Critique amendments: inked in tokens.labelLand (umber engraved on the paint; climate
 * mode moves toward tokens.labelClimate like the land labels), shown only when
 * travelIn > 0.35 and viewKm is between 1000 and 6000 (LOW has no 3D monuments, so its
 * band runs down to its 1200 km floor), no visited brightness, never vermilion.
 * Finish review: the hand-off to the 3D monuments is per landmark — a glyph stays until
 * its own 3D form is drawn (monumentShown: the wide-view miniature set at any zoom, the
 * rest once legible), so no landmark is drawn twice and none blinks out between the
 * layers. Glyphs also keep off every drawn miniature's footprint (monumentBoxes).
 *
 * One instanced screen-space quad per landmark (one draw call): 26 px, anchored at the
 * lifted surface point (LIFT.glyph + terrain) with a 4 px lift; CPU horizon fade;
 * declutter at 5 Hz (visited first, then fame); a glyph sitting on a pin slides
 * to the pin's left so the pin and its name stay readable. depthTest off, renderOrder 18 (under the map
 * names 19, the route 20-23 and the pins 30). Phones show visited places only.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ARCHETYPES } from '../../data/landmarks'
import { tokens, labelClimateAlpha } from '../../theme/tokens'
import { useSite } from '../../state/store'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { LIFT } from '../geo/radii'
import { smoothstep } from '../lod'
import { registerDebug } from '../debugHooks'
import { GLYPH_PATHS } from './glyphPaths'
import { GLYPH_BOX_PX, glyphBoxes, glyphPlaces, monumentBoxes } from '../instrument/screenObstacles'
import { CameraContext, glyphShiftPx, glyphShown, groundM, isCoarsePointer, landmarkInfos, monumentShown } from './landmarkFrame'

const GLYPH_PX = GLYPH_BOX_PX
const LIFT_PX = 4
const CELL = 128
const STROKE_VB = 2.4 // viewBox units: ~1 px at 26 px
const DECLUTTER_MS = 200
const FADE_MS = 200
const PIN_CLEAR_PX = 15

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('monuments') === '0'

function makeAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = CELL * 4
  c.height = CELL * 4
  const ctx = c.getContext('2d')!
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ARCHETYPES.forEach((a, i) => {
    const s = CELL / 64
    ctx.setTransform(s, 0, 0, s, (i % 4) * CELL, Math.floor(i / 4) * CELL)
    ctx.lineWidth = STROKE_VB
    ctx.stroke(new Path2D(GLYPH_PATHS[a]))
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace // coverage only; the ink is a uniform
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.anisotropy = 4
  return t
}

const vertexShader = /* glsl */ `
  attribute vec3 aPos;
  attribute float aCell;
  attribute float aAlpha;
  attribute vec2 aShift;
  uniform vec2 uViewport;
  uniform float uSize;
  uniform float uLift;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec2 cell = vec2(mod(aCell, 4.0), floor(aCell / 4.0));
    vec2 q = position.xy + 0.5; // 0..1, y up
    vUv = vec2((cell.x + q.x) / 4.0, 1.0 - (cell.y + 1.0 - q.y) / 4.0);
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(aPos, 1.0);
    vec2 px = position.xy * uSize + vec2(0.0, uSize * 0.5 + uLift) + vec2(aShift.x, -aShift.y);
    clip.xy += px * 2.0 / uViewport * clip.w;
    gl_Position = aAlpha < 0.003 ? vec4(2.0, 2.0, 2.0, 1.0) : clip;
  }
`

const fragmentShader = /* glsl */ `
  layout(location = 0) out highp vec4 pc_fragColor;
  #define gl_FragColor pc_fragColor
  uniform sampler2D uAtlas;
  uniform vec3 uInk;
  uniform vec3 uInkClimate;
  uniform float uClimateAlpha;
  uniform float uModeMix;
  uniform float uSize;
  uniform vec3 uHalo;
  uniform float uHaloAlpha;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float cov = texture(uAtlas, vUv).a;
    // INT-B: a pale 1.3 px halo (dilated coverage) so the umber ink still reads over the dark
    // steel sea at coasts; on the painted land it is a faint engraved lift. Terrain mode only.
    vec2 px = vec2(1.3 / (4.0 * uSize));
    float h = 0.0;
    h = max(h, texture(uAtlas, vUv + vec2(px.x, 0.0)).a);
    h = max(h, texture(uAtlas, vUv - vec2(px.x, 0.0)).a);
    h = max(h, texture(uAtlas, vUv + vec2(0.0, px.y)).a);
    h = max(h, texture(uAtlas, vUv - vec2(0.0, px.y)).a);
    h = max(h, texture(uAtlas, vUv + px * 0.7071).a);
    h = max(h, texture(uAtlas, vUv - px * 0.7071).a);
    h = max(h, texture(uAtlas, vUv + vec2(px.x, -px.y) * 0.7071).a);
    h = max(h, texture(uAtlas, vUv + vec2(-px.x, px.y) * 0.7071).a);
    float ha = h * uHaloAlpha * (1.0 - uModeMix);
    float a0 = cov + ha * (1.0 - cov);
    float a = a0 * vAlpha * mix(1.0, uClimateAlpha, uModeMix);
    if (a < 0.004) discard;
    vec3 ink = mix(uInk, uInkClimate, uModeMix);
    gl_FragColor = vec4((ink * cov + uHalo * ha * (1.0 - cov)) / max(a0, 1e-4), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function LandmarkGlyphs() {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const tier = useSite((s) => s.tier)
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  const parts = useMemo(() => {
    const infos = landmarkInfos()
    const n = infos.length
    const pos = new Float32Array(n * 3)
    const cell = new Float32Array(n)
    const alpha = new Float32Array(n)
    const shift = new Float32Array(n * 2)
    infos.forEach((info, i) => {
      cell[i] = ARCHETYPES.indexOf(info.lm.arch)
      pos.set([info.dir.x * (1 + LIFT.glyph), info.dir.y * (1 + LIFT.glyph), info.dir.z * (1 + LIFT.glyph)], i * 3)
    })
    const quad = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    const aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)
    const aAlpha = new THREE.InstancedBufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage)
    const aShift = new THREE.InstancedBufferAttribute(shift, 2).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aPos', aPos)
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 1))
    g.setAttribute('aAlpha', aAlpha)
    g.setAttribute('aShift', aShift)
    g.instanceCount = n
    const atlas = makeAtlas()
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uAtlas: { value: atlas },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uSize: { value: GLYPH_PX },
        uLift: { value: LIFT_PX },
        uInk: { value: new THREE.Color(tokens.labelLand) },
        uInkClimate: { value: new THREE.Color(tokens.labelClimate) },
        uHalo: { value: new THREE.Color(tokens.labelSea) },
        uHaloAlpha: { value: 0.6 },
        uClimateAlpha: { value: labelClimateAlpha },
        uModeMix: { value: 0 },
      },
    })
    const mesh = new THREE.Mesh(g, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 18
    mesh.raycast = () => {}
    mesh.visible = false
    mesh.name = 'landmark-glyphs'
    return {
      infos, mesh, material, atlas, aPos, aAlpha, aShift, pos, alpha, shift,
      target: new Float32Array(n), facing: new Float32Array(n), scr: new Float32Array(n * 2),
      ctx: new CameraContext(), lastDeclutter: -1e9, liftScale: -1, shown: 0,
    }
  }, [])

  useEffect(() => {
    registerDebug('glyphs', () => ({
      shown: parts.shown,
      list: parts.infos.filter((_, i) => parts.alpha[i] > 0.05).map((i) => i.lm.id),
    }))
    return () => {
      parts.mesh.geometry.dispose()
      parts.material.dispose()
      parts.atlas.dispose()
    }
  }, [parts])

  useFrame(() => {
    const g = globeState
    const lod = g.lod
    const inner = sceneRefs.inner
    const p = parts
    const low = tier === 'low'
    const band = smoothstep(6000, 5200, lod.viewKm) * (low ? 1 : smoothstep(950, 1100, lod.viewKm))
    const gate = disabled || !g.surfaceReady ? 0 : smoothstep(0.35, 0.5, g.travelIn) * band * (1 - g.dim)
    let any = false
    for (let i = 0; i < p.alpha.length; i++) if (p.alpha[i] > 0.003) any = true
    if (!inner || (gate <= 0 && !any)) {
      p.mesh.visible = false
      p.shown = 0
      glyphBoxes.length = 0
      glyphPlaces.length = 0
      glyphShown.fill(0)
      return
    }
    p.mesh.visible = true
    const now = performance.now()
    const n = p.infos.length
    const ctx = p.ctx
    ctx.update(camera, inner, size.width, size.height)

    // re-lift with the terrain displacement (same rule as the pins)
    if (Math.abs(lod.heightScale - p.liftScale) > 0.05 * Math.max(p.liftScale, 1e-12) || (lod.heightScale === 0) !== (p.liftScale === 0)) {
      p.liftScale = lod.heightScale
      p.infos.forEach((info, i) => {
        const r = 1 + LIFT.glyph + groundM(info.dir) * lod.heightScale
        p.pos[i * 3] = info.dir.x * r
        p.pos[i * 3 + 1] = info.dir.y * r
        p.pos[i * 3 + 2] = info.dir.z * r
      })
      p.aPos.needsUpdate = true
    }

    const tmp = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const info = p.infos[i]
      tmp.set(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2])
      p.facing[i] = ctx.facing(tmp, info.dir)
    }

    // declutter at 5 Hz: visited first, then fame; slide off coincident pins
    if (now - p.lastDeclutter > DECLUTTER_MS) {
      p.lastDeclutter = now
      const phoneOnly = g.isPhone || isCoarsePointer()
      const pins = g.pinsPx
      const xy: [number, number] = [0, 0]
      const order = p.infos.map((_, i) => i).sort((a, b) => p.infos[b].priority - p.infos[a].priority || a - b)
      const boxes: [number, number][] = []
      glyphBoxes.length = 0
      glyphPlaces.length = 0
      for (const i of order) {
        const info = p.infos[i]
        p.target[i] = 0
        if (p.facing[i] < 0.05 || (phoneOnly && !info.visited) || monumentShown[i] > 0.5) continue
        tmp.set(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2])
        if (!ctx.project(tmp, xy)) continue
        // pin clearance: the glyph stands above its point; a pin under it pushes it aside
        let sx = 0
        for (let q = 0; q + 3 < pins.length; q += 4) {
          if (pins[q + 2] < 0.2) continue
          const dx = xy[0] - pins[q], dy = xy[1] - pins[q + 1]
          if (Math.abs(dx) < PIN_CLEAR_PX && dy > -GLYPH_PX - LIFT_PX && dy < PIN_CLEAR_PX * 0.5) {
            sx = -PIN_CLEAR_PX - dx // to the pin's left: place names sit on its right
            break
          }
        }
        const cx = xy[0] + sx
        const cy = xy[1] - LIFT_PX - GLYPH_PX / 2
        if (cx < -GLYPH_PX || cy < -GLYPH_PX || cx > size.width + GLYPH_PX || cy > size.height + GLYPH_PX) continue
        let clash = false
        for (const [bx, by] of boxes) if (Math.abs(bx - cx) < GLYPH_PX + 4 && Math.abs(by - cy) < GLYPH_PX + 4) clash = true
        // never under / against a drawn 3D miniature
        const hg = GLYPH_PX / 2 + 3
        for (let q = 0; !clash && q + 3 < monumentBoxes.length; q += 4) {
          if (cx + hg > monumentBoxes[q] && cx - hg < monumentBoxes[q + 2] && cy + hg > monumentBoxes[q + 1] && cy - hg < monumentBoxes[q + 3]) clash = true
        }
        if (clash) continue
        boxes.push([cx, cy])
        // labels yield to placed glyphs (published for C4's declutter)
        if (gate > 0.3) {
          glyphBoxes.push(cx, cy)
          glyphPlaces.push(info.placeIndex)
        }
        p.target[i] = 1
        p.shift[i * 2] = sx
        p.shift[i * 2 + 1] = 0
      }
      p.aShift.needsUpdate = true
    }

    const step = reducedMotion ? 1 : Math.min(1, 16.7 / FADE_MS)
    let shown = 0
    for (let i = 0; i < n; i++) {
      const horizon = smoothstep(0.02, 0.18, p.facing[i])
      const t = p.target[i] * gate * horizon * (1 - monumentShown[i])
      const a = p.alpha[i]
      p.alpha[i] = reducedMotion ? t : a + Math.max(-step, Math.min(step, t - a))
      if (p.alpha[i] > 0.05) shown++
      glyphShown[i] = p.alpha[i]
      glyphShiftPx[i] = p.shift[i * 2]
    }
    p.shown = shown
    p.aAlpha.needsUpdate = true
    const u = p.material.uniforms
    u.uViewport.value.set(size.width, size.height)
    u.uModeMix.value = g.modeMix
  })

  if (disabled) return null
  return <primitive object={parts.mesh} />
}

export default LandmarkGlyphs
