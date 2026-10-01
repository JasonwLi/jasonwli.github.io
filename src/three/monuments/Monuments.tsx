/**
 * 3D monuments (C5; mid/high only, null on low).
 *
 * One InstancedMesh per archetype (15 draw calls at most; meshes with no visible
 * instance are skipped), every landmark form a sub-mesh picked by iVar. Per frame on
 * the CPU (72 instances):
 *  - position: the landmark direction, pushed off a coincident pin (clearance in px,
 *    capped at 0.01 rad), lifted onto the displaced terrain exactly like the pins
 *    (1 + max(0, sampleHeightM) * lod.heightScale; natural features use their foot
 *    height) and sunk 4% of the model so slopes never show a gap;
 *  - size: scale = min(worldH, 40/pxPerUnit) / worldH with worldH = 0.006 R x fame
 *    (1.15 world-famous, 0.95 notable) and pxPerUnit measured at the monument
 *    (critique). No visited scale. MINIMUM LEGIBLE SIZE (finish review): a monument
 *    whose natural height is under 30 px (hidden again under 27 px) is not drawn at all
 *    rather than held at a 14 px floor, where the forms became sprite crumbs; its
 *    engraved 2D glyph keeps the place until the 3D form is legible (monumentShown);
 *  - orientation: up = the ground normal leaned back from the viewer until the view is
 *    at least 55 deg off vertical (the near-nadir travel camera would otherwise see
 *    roofs only), front toward the camera with a fixed per-landmark 3/4 turn;
 *  - visibility: lod.monument3dFade x horizon fade x declutter (stronger landmarks win
 *    when two overlap on screen), eased as a 250 ms scale-in from the ground (instant
 *    under reduced motion). Phones (globeState.isPhone or pointer:coarse) show visited
 *    places only;
 *  - dim: x0.5 while the landmark's near_place pin is hovered or active.
 * Pins stay on top (I1: depthTest false, renderOrder 30); monuments depth-test against
 * the terrain.
 *
 * Debug (?debug=1): __globe.monuments() → visible instances + draw stats;
 * __globe.monumentBench(n) → ms/frame with and without monuments; ?monuments=0 disables.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ARCHETYPES, type Archetype } from '../../data/landmarks'
import type { Tier } from '../globeState'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { registerDebug } from '../debugHooks'
import { neatGuard } from '../instrument/screenObstacles'
import { buildArchetype } from './archetypes'
import { attachInstanceAttributes, makeMonumentMaterial } from './material'
import { CameraContext, clearOfPin, groundM, isCoarsePointer, landmarkInfos, monumentShown, type LandmarkInfo } from './landmarkFrame'

const WORLD_H = 0.006
const SHOW_AT_PX = 30 // natural on-screen height a monument needs to appear
const HIDE_BELOW_PX = 27 // ...and the height under which it leaves again (hysteresis)
const MAX_PX = 40
const MAX_PIN_OFFSET = 0.01 // rad
const PIN_CLEAR_PX = 9 // pin outer radius (5.5) + a gap, added to half the monument width
const MIN_VIEW_ANGLE = (55 * Math.PI) / 180
const NATURAL = new Set<Archetype>(['mountain-peak', 'waterfall', 'canyon', 'rock'])
const SCALE_IN_MS = 250
const GATE_ON_KM = 1600
const GATE_OFF_KM = 1620
const SCREEN_MARGIN_PX = 80
const DIM_MS = 150

interface Slot {
  info: LandmarkInfo
  arch: Archetype
  mesh: number // index into meshes
  slot: number // instance index inside the mesh
  variant: number
  size: number // model size measure (formSize)
  mainSize: number // the landmark's main form size (parts scale with it)
  width: number // model bbox width
  height: number
  part: { x: number; z: number; s: number } | null
  yaw: number
}

interface MeshRec {
  arch: Archetype
  mesh: THREE.InstancedMesh
  iVar: THREE.InstancedBufferAttribute
  iDim: THREE.InstancedBufferAttribute
  iUp: THREE.InstancedBufferAttribute
  count: number
}

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('monuments') === '0'

export function Monuments({ tier }: { tier: Tier }) {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  const parts = useMemo(() => {
    const infos = landmarkInfos()
    const material = makeMonumentMaterial()
    // count instances per archetype (landmarks + parts)
    const per = new Map<Archetype, number>()
    const bump = (a: Archetype) => per.set(a, (per.get(a) ?? 0) + 1)
    for (const i of infos) {
      bump(i.lm.arch)
      for (const p of i.lm.parts ?? []) bump(p.arch)
    }
    const meshes: MeshRec[] = []
    const meshOf = new Map<Archetype, number>()
    for (const arch of ARCHETYPES) {
      const count = per.get(arch) ?? 0
      if (!count) continue
      const src = buildArchetype(arch).geometry
      const g = new THREE.BufferGeometry()
      for (const [n, a] of Object.entries(src.attributes)) g.setAttribute(n, a)
      g.setIndex(src.index)
      const { iVar, iDim, iUp } = attachInstanceAttributes(g, count)
      const mesh = new THREE.InstancedMesh(g, material, count)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.raycast = () => {}
      mesh.visible = false
      mesh.name = `monuments:${arch}`
      mesh.userData.iVar = iVar
      meshOf.set(arch, meshes.length)
      meshes.push({ arch, mesh, iVar, iDim, iUp, count: 0 })
    }
    const slots: Slot[] = []
    const add = (info: LandmarkInfo, arch: Archetype, form: string, part: Slot['part']) => {
      const kit = buildArchetype(arch)
      const variant = kit.index.get(form) ?? 0
      const f = kit.forms[variant]
      const m = meshes[meshOf.get(arch)!]
      const slot = m.count++
      ;(m.mesh.userData.iVar as THREE.InstancedBufferAttribute).setX(slot, variant)
      // fixed 3/4 turn per landmark: alternate sides, 18-30 deg
      const yaw = (info.index % 2 ? 1 : -1) * (0.32 + ((info.index * 7) % 5) * 0.05)
      const mainSize = part ? (slots.find((q) => q.info === info && !q.part)?.size ?? f.size) : f.size
      slots.push({ info, arch, mesh: meshOf.get(arch)!, slot, variant, size: f.size, mainSize, width: f.box[3] - f.box[0], height: f.box[4], part, yaw })
    }
    for (const info of infos) {
      add(info, info.lm.arch, info.lm.form, null)
      for (const p of info.lm.parts ?? []) add(info, p.arch, p.form, { x: p.x, z: p.z, s: p.s })
    }
    const group = new THREE.Group()
    group.name = 'monuments'
    for (const m of meshes) group.add(m.mesh)
    const anim = infos.map(() => ({ vis: 0, dim: 0, legible: false }))
    return { infos, material, meshes, slots, group, anim, on: false, ctx: new CameraContext(), stats: { visible: 0, meshes: 0, tris: 0, cpuMs: 0 } }
  }, [])

  useEffect(() => {
    registerDebug('monuments', () => ({
      tier,
      visible: parts.stats.visible,
      meshesDrawn: parts.stats.meshes,
      trianglesDrawn: parts.stats.tris,
      cpuMs: +parts.stats.cpuMs.toFixed(3),
      fade: globeState.lod.monument3dFade,
      list: parts.infos.filter((_, i) => parts.anim[i].vis > 0.01).map((i) => i.lm.id),
    }))
    registerDebug('monumentUniform', (k: string, v: number) => {
      const u = parts.material.uniforms[k]
      if (u) u.value = v
      return Object.keys(parts.material.uniforms)
    })
    registerDebug('monumentBench', (n = 60) => {
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const run = () => {
        gl.render(scene, camera)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      for (let i = 0; i < 5; i++) run()
      const t0 = performance.now()
      for (let i = 0; i < n; i++) run()
      const on = (performance.now() - t0) / n
      const calls = gl.info.render.calls
      const tris = gl.info.render.triangles
      const was = parts.group.visible
      parts.group.visible = false
      for (let i = 0; i < 3; i++) run()
      const t1 = performance.now()
      for (let i = 0; i < n; i++) run()
      const off = (performance.now() - t1) / n
      const callsOff = gl.info.render.calls
      const trisOff = gl.info.render.triangles
      parts.group.visible = was
      return {
        msWith: +on.toFixed(3), msWithout: +off.toFixed(3), monumentMs: +(on - off).toFixed(3),
        drawCalls: calls, drawCallsWithout: callsOff, monumentCalls: calls - callsOff,
        triangles: tris, monumentTriangles: tris - trisOff, cpuPlacementMs: +parts.stats.cpuMs.toFixed(3),
      }
    })
  }, [parts, gl, scene, camera, tier])

  useEffect(
    () => () => {
      for (const m of parts.meshes) {
        m.mesh.geometry.dispose()
        m.mesh.dispose()
      }
      parts.material.dispose()
    },
    [parts],
  )

  // scratch (allocation-free frame)
  const tmp = useMemo(
    () => ({
      d: new THREE.Vector3(), base: new THREE.Vector3(), U: new THREE.Vector3(), F: new THREE.Vector3(), X: new THREE.Vector3(),
      U2: new THREE.Vector3(), F2: new THREE.Vector3(), Xr: new THREE.Vector3(), Zr: new THREE.Vector3(), v: new THREE.Vector3(),
      p: new THREE.Vector3(), m: new THREE.Matrix4(),
      scr: [0, 0] as [number, number],
      placed: [] as { x: number; y: number; r: number; pr: number }[],
      frame: [] as { scale: number; ppu: number; sx: number; sy: number; ok: boolean; facing: number }[],
    }),
    [],
  )

  useFrame((_, rawDt) => {
    const g = globeState
    const lod = g.lod
    const inner = sceneRefs.inner
    const { meshes, slots, anim, infos, ctx, stats, material } = parts
    // gate: on below 1600 km (off again above 1620), then a 250 ms scale-in per monument.
    // lod.monument3dFade's 1600->1200 ramp is not used as a scale: at 1500 km it would
    // draw every monument at 16% (specks); see the report.
    const gateOn = !disabled && tier !== 'low' && lod.viewKm < (parts.on ? GATE_OFF_KM : GATE_ON_KM)
    parts.on = gateOn
    const fade = gateOn ? 1 : 0
    const anyAnim = anim.some((a) => a.vis > 0.001)
    if (!inner || (fade <= 0 && !anyAnim)) {
      for (const m of meshes) m.mesh.visible = false
      monumentShown.fill(0)
      stats.visible = 0
      stats.meshes = 0
      stats.tris = 0
      return
    }
    const t0 = performance.now()
    const dt = Math.min(rawDt, 0.1) * 1000
    ctx.update(camera, inner, size.width, size.height)
    const phoneOnly = g.isPhone || isCoarsePointer()
    const hover = g.anchors.hoverIndex
    const active = g.anchors.activeIndex

    // pass 1: per landmark scale, ppu, screen position, eligibility
    const fr = tmp.frame
    fr.length = infos.length
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i]
      const f = (fr[i] ??= { scale: 0, ppu: 1, sx: 0, sy: 0, ok: false, facing: 0 })
      const ppu = ctx.pxPerUnit(info.dir)
      const famous = info.lm.fame === 3 ? 1.15 : 0.95
      const naturalPx = WORLD_H * famous * ppu
      const a = anim[i]
      a.legible = naturalPx >= (a.legible ? HIDE_BELOW_PX : SHOW_AT_PX)
      f.ppu = ppu
      f.scale = Math.min(WORLD_H * famous, MAX_PX / ppu)
      f.facing = ctx.facing(info.dir, info.dir)
      f.ok = fade > 0 && a.legible && f.facing > 0.02 && (!phoneOnly || info.visited) && ctx.project(info.dir, tmp.scr)
      f.sx = tmp.scr[0]
      f.sy = tmp.scr[1]
      const mg = SCREEN_MARGIN_PX
      if (f.sx < -mg || f.sy < -mg || f.sx > size.width + mg || f.sy > size.height + mg) f.ok = false
      // deep zoom: keep off the neatline's tick band and its scale numerals (finish review)
      if (f.ok && neatGuard.on) {
        const r = Math.min(f.scale * ppu, MAX_PX) * 0.5
        if (f.sx < neatGuard.x0 + r || f.sx > neatGuard.x1 - r || f.sy < neatGuard.y0 + r * 2 || f.sy > neatGuard.y1) f.ok = false
        const nb = neatGuard.boxes
        for (let q = 0; f.ok && q + 3 < nb.length; q += 4) {
          if (f.sx + r > nb[q] && f.sx - r < nb[q + 2] && f.sy > nb[q + 1] && f.sy - 2 * r < nb[q + 3]) f.ok = false
        }
      }
    }
    // declutter: strongest first; reject when the footprints overlap on screen
    const order = infos.map((_, i) => i).sort((a, b) => infos[b].priority - infos[a].priority || a - b)
    const placed = tmp.placed
    placed.length = 0
    const keep = new Uint8Array(infos.length)
    for (const i of order) {
      const f = fr[i]
      if (!f.ok) continue
      const r = (f.scale * f.ppu) * 0.55
      let clash = false
      for (const q of placed) if (Math.hypot(q.x - f.sx, q.y - f.sy) < (q.r + r) * 0.9) clash = true
      if (clash) continue
      placed.push({ x: f.sx, y: f.sy, r, pr: infos[i].priority })
      keep[i] = 1
    }
    for (let i = 0; i < infos.length; i++) {
      const a = anim[i]
      const target = keep[i] ? 1 : 0
      a.vis = reducedMotion ? target : target > a.vis ? Math.min(target, a.vis + dt / SCALE_IN_MS) : Math.max(target, a.vis - dt / SCALE_IN_MS)
      const pi = infos[i].placeIndex
      const dimT = pi >= 0 && (pi === hover || pi === active) ? 1 : 0
      a.dim = reducedMotion ? dimT : dimT > a.dim ? Math.min(1, a.dim + dt / DIM_MS) : Math.max(0, a.dim - dt / DIM_MS)
      monumentShown[i] = a.vis * fade * THREE.MathUtils.smoothstep(fr[i].facing, 0.02, 0.18)
    }

    // pass 2: instance matrices
    for (const rec of meshes) rec.mesh.count = 0
    let visible = 0
    let tris = 0
    const { d, base, U, F, X, U2, F2, Xr, Zr, v, p, m } = tmp
    for (const s of slots) {
      const i = s.info.index
      const f = fr[i]
      const rec = meshes[s.mesh]
      const horizon = THREE.MathUtils.smoothstep(f.facing, 0.02, 0.18)
      const vis = anim[i].vis * fade * horizon
      if (vis <= 0.001) continue
      const kMain = f.scale / s.mainSize
      const k = s.part ? kMain * s.part.s : f.scale / s.size
      // pin clearance in screen px, capped at 0.01 rad
      const halfW = (s.part ? kMain : k) * s.width * 0.5 * f.ppu
      const need = Math.min(MAX_PIN_OFFSET, (PIN_CLEAR_PX + halfW) / f.ppu)
      // frame at the landmark: F toward the viewer on the ground, X screen-right
      U.copy(s.info.dir)
      F.copy(ctx.camUpLocal).addScaledVector(U, -ctx.camUpLocal.dot(U))
      if (F.lengthSq() < 1e-9) F.set(1, 0, 0).addScaledVector(U, -U.x)
      F.normalize().negate()
      X.crossVectors(U, F).normalize()
      // clear the pin toward screen-left and a little down: C4's place names sit to the right
      v.copy(X).multiplyScalar(-0.94).addScaledVector(F, 0.34)
      clearOfPin(s.info, need, d, v)
      U.copy(d)
      const foot = NATURAL.has(s.arch) ? s.size * k * 0.35 : 0
      const r = 1 + groundM(d, foot) * lod.heightScale - 0.04 * s.height * k
      base.copy(d).multiplyScalar(r)
      F.copy(ctx.camUpLocal).addScaledVector(U, -ctx.camUpLocal.dot(U))
      if (F.lengthSq() < 1e-9) F.set(1, 0, 0).addScaledVector(U, -U.x)
      F.normalize().negate()
      X.crossVectors(U, F).normalize()
      v.copy(ctx.camLocal).sub(base).normalize()
      const theta = Math.acos(Math.min(1, Math.max(-1, v.dot(U))))
      const lean = Math.max(0, MIN_VIEW_ANGLE - theta)
      U2.copy(U).multiplyScalar(Math.cos(lean)).addScaledVector(F, -Math.sin(lean))
      F2.copy(F).multiplyScalar(Math.cos(lean)).addScaledVector(U, Math.sin(lean))
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw)
      Xr.copy(X).multiplyScalar(c).addScaledVector(F2, -sn)
      Zr.copy(X).multiplyScalar(sn).addScaledVector(F2, c)
      p.copy(base)
      if (s.part) p.addScaledVector(Xr, s.part.x * kMain).addScaledVector(Zr, s.part.z * kMain)
      const kk = k * vis
      m.set(
        Xr.x * kk, U2.x * kk, Zr.x * kk, p.x,
        Xr.y * kk, U2.y * kk, Zr.y * kk, p.y,
        Xr.z * kk, U2.z * kk, Zr.z * kk, p.z,
        0, 0, 0, 1,
      )
      // pack live instances at the front so the draw covers only them
      const j = rec.mesh.count++
      rec.mesh.setMatrixAt(j, m)
      rec.iVar.setX(j, s.variant)
      rec.iDim.setX(j, anim[i].dim)
      rec.iUp.setXYZ(j, U.x, U.y, U.z)
      if (!s.part) visible++
      tris += buildArchetype(s.arch).forms[s.variant].tris * 2
    }
    let drawn = 0
    for (const rec of meshes) {
      const live = rec.mesh.count > 0
      rec.mesh.visible = live
      if (!live) continue
      drawn++
      rec.mesh.instanceMatrix.needsUpdate = true
      rec.iVar.needsUpdate = true
      rec.iDim.needsUpdate = true
      rec.iUp.needsUpdate = true
    }
    material.uniforms.uViewport.value.set(size.width, size.height)
    material.uniforms.uPxRatio.value = gl.getPixelRatio()
    material.uniforms.uDim.value = g.dim
    stats.visible = visible
    stats.meshes = drawn
    stats.tris = tris
    stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1
  })

  if (tier === 'low' || disabled) return null
  return <primitive object={parts.group} />
}

export default Monuments
