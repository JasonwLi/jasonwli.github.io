/**
 * 3D monuments (C5 + the wide-view miniatures follow-up; mid/high only, null on low).
 *
 * One InstancedMesh per (archetype, form) in use, each drawing only its form's contiguous
 * range of the archetype's shared index (meshes with no visible instance are skipped, so
 * draw calls = distinct visible forms; the iVar collapse stays as a guard). Per frame on
 * the CPU (72 instances), in two regimes that share one size rule so nothing jumps:
 *
 *  - WIDE MINIATURES (EU5-style, every view): the curated set — every detailed hero model
 *    (monuments/hero, *-hero forms) plus visited built monuments whose form reads at that
 *    size (WIDE_FORMS: towers, spires, stepped pyramids) — stands on the globe as an
 *    exaggerated miniature of a constant screen size: capPx = 44 px desktop / 32 px phone
 *    for fame 3 (x0.86 for fame 2), heroes 48 / 35 px, times radiusPx / the section's
 *    reference radius (capped at 1) so they shrink with a small globe; they fade out with
 *    the section dim (work, contact). Slab-like forms (SLAB_FORMS: temples, palaces,
 *    theatres, walls, bridges) and natural features keep their 2D glyph and join only at
 *    close zoom. A greedy screen declutter (heroes, then visited x fame; incumbents kept:
 *    +0.5 priority and 15% looser spacing) keeps footprints >= 0.625 (pxA + pxB) apart and
 *    admits at most 14 (phones 6) at viewKm >= 4000, a budget that grows as
 *    (4000 / viewKm)^2 while zooming in; below 3000 km a hero that clashes with a placed
 *    neighbour (St Peter's beside the Colosseum) stands one spacing to its side instead.
 *    Horizon-faded (facing 0.1 -> 0.3), never past the disc edge.
 *  - CLOSE ZOOM (the C5 behaviour): every other landmark appears once its natural size
 *    (WORLD_H = 0.006 R x fame 1.15 / 0.95) reaches 30 px (slabs 56 px; hidden again under
 *    27 / 50 px) and is drawn at min(natural, capPx), so it grows with the zoom until it
 *    meets the cap the miniatures already hold. A miniature never changes size between
 *    the regimes.
 *  - position: the TRUE landmark site. Only when the footprint (base to top, the form's
 *    width, a little below the base for its depth) covers one of the landmark's own pins
 *    (near_place, or any place within 40 km) is it nudged: 8 screen directions x 3 px
 *    steps, the smallest displacement whose base (centre and both ends) is on land per the
 *    CPU height grid (never over open sea), with soft costs for covering other pins and
 *    for a body over water; the nudge is kept while valid and near-best and the base
 *    eases to it (110 ms). A non-hero that would move > 18 px waits. Lifted onto the
 *    displaced terrain exactly like the pins and sunk 4% of the model so slopes never
 *    show a gap;
 *  - orientation: up = the ground normal leaned back from the viewer until the view is
 *    at least 55 deg off vertical (the near-nadir travel camera would otherwise see
 *    roofs only), front toward the camera turned by the landmark's preferred facing
 *    (landmarks.ts `face`: front to the viewer's lower-left, into the upper-left key
 *    light, so the signature face is lit);
 *  - visibility: a 250 ms scale-in from the ground per monument (instant under reduced
 *    motion); phones show visited places only below the wide set;
 *  - dim: x0.5 and 0.88 scale while the landmark's near_place pin is hovered or active.
 * Pins stay on top (I1: depthTest false, renderOrder 30); monuments depth-test against
 * the terrain. The drawn footprints are published (screenObstacles.monumentBoxes) so the
 * region / place names and the 2D glyphs keep off them.
 *
 * Debug (?debug=1): __globe.monuments() → visible instances, per-landmark px + draw stats;
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
import { monumentBoxes, neatGuard } from '../instrument/screenObstacles'
import { buildArchetype } from './archetypes'
import { attachInstanceAttributes, guardThemeColours, makeMonumentMaterial } from './material'
import { locations } from '../../data/travel'
import { CameraContext, dirOf, groundM, isCoarsePointer, isLandDir, landmarkInfos, monumentShown, type LandmarkInfo } from './landmarkFrame'
import { HERO_FORM_NAMES } from './hero/index'
import { heightGridReady } from '../geo/heightGrid'

const WORLD_H = 0.006
const SHOW_AT_PX = 30 // natural on-screen height a close-zoom monument needs to appear
const HIDE_BELOW_PX = 27 // ...and the height under which it leaves again (hysteresis)
/** wide-view miniature size (fame 3), CSS px, at the section's reference globe radius */
const CAP_PX = 44
const CAP_PX_PHONE = 32
/** the detailed hero models carry more at the same size and may stand a little taller */
const HERO_CAP_PX = 48
const HERO_CAP_PX_PHONE = 35
const FAME2_K = 0.86
/**
 * Non-hero forms that read as themselves at miniature size (towers, spires, stepped
 * pyramids, gates of one silhouette): a visited landmark drawn with one joins the wide set.
 */
const WIDE_FORMS = new Set([
  'pharos', 'belem', 'needle', 'saucer', 'lattice-red', 'taipei101', 'twin', 'mbs',
  'fairytale', 'sagrada', 'basils', 'florence', 'torii', 'prang', 'castillo', 'stepped', 'borobudur', 'obelisk',
])
/**
 * Wide, low forms (temples, palaces, theatres, walls, bridges) that read as slabs at
 * 30-45 px: they keep the 2D glyph until their natural size is well past the cap.
 */
const SLAB_FORMS = new Set([
  'helsinki', 'gopuram', 'hypostyle', 'peristyle-sand', 'hall', 'hall-gold', 'whitetemple', 'theatre', 'ring-sand',
  'gate', 'parliament', 'citywall', 'iron-arch', 'stone-arch',
])
const SLAB_SHOW_PX = 56
const SLAB_HIDE_PX = 50
/** reference silhouette radius (choreography hero/travel: desktop R 300-320, phone 140-146) */
const REF_R = 300
const REF_R_PHONE = 140
const GLOBE_K_MIN = 0.55
/** centre-to-centre footprint spacing as a share of the two sizes (52 + 52 px -> 65 px) */
const SEP_K = 0.625
const KEEP_SEP = 0.85 // incumbents may sit 15% closer before they yield
const BUDGET = 14
const BUDGET_PHONE = 6
const WIDE_KM = 4000
const FACING_ON = 0.12
const FACING_KEEP = 0.08
const FACE_FADE: [number, number] = [0.1, 0.3]
const DISC_MARGIN_PX = 6 // the whole miniature stays inside the globe's disc
/** site nudge: a drawn pin (outer r 5.5 px) + a gap must stay outside the footprint */
const PIN_CLEAR_PX = 9
const PIN_VIS_MIN = 0.35
const FRONT_DROP = 0.18 // share of the height the footprint reaches below the base point
const NUDGE_STEP_PX = 3
const OTHER_PIN_PX = 0.25 // cost (px) of covering another place's pin (soft: a dense cluster cannot all clear, and the site matters more)
const OWN_PIN_KM = 40 // pins this close to the site are the landmark's own (must clear)
const NUDGE_DIRS = 8
const BODY_WATER_PX = 5 // cost (px) of a body standing over water on a land base
const KEEP_SLACK_PX = 6
/** never nudged further than this on the ground (a small phone globe would park Hagia
 * Sophia in Hungary): past it the monument stands on its true site under its pin */
const NUDGE_MAX_RAD = 500 / 6371
const NONHERO_NUDGE_PX = 18 // a non-hero miniature displaced further than this is not drawn
const NONHERO_NUDGE_KEEP_PX = 24
const PAIR_KM = 3000 // below this a clashing hero may stand beside its neighbour // the previous nudge is kept while within this of the best
const SLIDE_MS = 110
const MIN_VIEW_ANGLE = (55 * Math.PI) / 180
/** wide views: share of the upright-on-screen stance, its elevation, and the km ramp */
const UPRIGHT = 0.8
const VIEW_ELEV = (32 * Math.PI) / 180
const COS_E = Math.cos(VIEW_ELEV)
const SIN_E = Math.sin(VIEW_ELEV)
const UPRIGHT_KM: [number, number] = [1800, 3600]
/** depth lift toward the eye (model heights) at wide views, see material.ts iLift */
const LIFT_H = 1.2
const NATURAL = new Set<Archetype>(['mountain-peak', 'waterfall', 'canyon', 'rock'])
const SCALE_IN_MS = 250
const SCREEN_MARGIN_PX = 80
const DIM_MS = 150
const READY_MS = 400

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
  iLift: THREE.InstancedBufferAttribute
  count: number
  /** triangles one instance draws: its form's draw range (hull + model, hairlines without a hull counted once) */
  tris: number
}

interface FrameRec {
  scale: number // world size (formSize units) of the main form
  px: number // drawn size in CSS px
  ppu: number
  facing: number
  ok: boolean
  wide: boolean // member of the curated miniature set
  base: THREE.Vector3 // drawn ground direction (pre, or the pair shift beside a neighbour)
  pre: THREE.Vector3 // eased toward target
  side: number // the pair shift's last side (-1 left, 1 right, 0 none)
  target: THREE.Vector3 // the site, or the nudged site clear of the pins
  nudged: boolean
  /** debug: the site's pin cost, the chosen cost, own pins */
  why: string
  placed: boolean // base holds a valid placement
  bx: number // projected base (CSS px)
  by: number
}

/** ?nudgedbg: placement notes in __globe.monuments() (items[].why, waiting) */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nudgedbg')
const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('monuments') === '0'

const smooth = THREE.MathUtils.smoothstep
const tmpV = new THREE.Vector3()

export function Monuments({ tier }: { tier: Tier }) {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])

  const parts = useMemo(() => {
    const infos = landmarkInfos()
    const material = makeMonumentMaterial()
    // one InstancedMesh per (archetype, form) in use: every form's triangles are a
    // contiguous draw range of its archetype's index (hull then model), so an instance
    // only runs the vertices of its own form (the hero models add thousands of
    // triangles to an archetype). Attributes and the reordered index are shared per
    // archetype; draw calls = distinct visible forms.
    const used = new Map<string, number>() // `${arch}|${variant}` -> instance count
    const keyOf = (arch: Archetype, form: string) => `${arch}|${buildArchetype(arch).index.get(form) ?? 0}`
    for (const i of infos) {
      for (const [arch, form] of [[i.lm.arch, i.lm.form] as const, ...(i.lm.parts ?? []).map((p) => [p.arch, p.form] as const)]) {
        const k = keyOf(arch, form)
        used.set(k, (used.get(k) ?? 0) + 1)
      }
    }
    const meshes: MeshRec[] = []
    const meshOf = new Map<string, number>()
    let guarded = 0
    for (const arch of ARCHETYPES) {
      const keys = [...used.keys()].filter((k) => k.startsWith(arch + '|'))
      if (!keys.length) continue
      const src = buildArchetype(arch).geometry
      // shared attributes, with the theme guard: no gilt or vermilion faces, whoever authored the form
      const attrs: Record<string, THREE.BufferAttribute> = {}
      for (const [n, at] of Object.entries(src.attributes)) attrs[n] = at as THREE.BufferAttribute
      const guard = guardThemeColours(src.getAttribute('aCol') as THREE.BufferAttribute)
      attrs.aCol = guard.attr
      guarded += guard.changed
      // reorder the index by form: [hull_f, model_f] per form
      const idx = src.index!.array
      const aVar = src.getAttribute('aVar').array
      const aHull = src.getAttribute('aHull').array
      const buckets = new Map<number, [number[], number[]]>()
      for (let t = 0; t < idx.length; t += 3) {
        const v = idx[t]
        const f = Math.round(aVar[v])
        let bk = buckets.get(f)
        if (!bk) buckets.set(f, (bk = [[], []]))
        const into = bk[aHull[v] > 0.5 ? 0 : 1]
        into.push(idx[t], idx[t + 1], idx[t + 2])
      }
      const order = new (idx instanceof Uint32Array ? Uint32Array : Uint16Array)(idx.length)
      const range = new Map<number, [number, number]>()
      let o = 0
      for (const [f, [hull, model]] of [...buckets.entries()].sort((x, y) => x[0] - y[0])) {
        range.set(f, [o, hull.length + model.length])
        order.set(hull, o)
        order.set(model, o + hull.length)
        o += hull.length + model.length
      }
      const index = new THREE.BufferAttribute(order, 1)
      for (const k of keys) {
        const variant = Number(k.slice(k.lastIndexOf('|') + 1))
        const count = used.get(k)!
        const g = new THREE.BufferGeometry()
        for (const [n, at] of Object.entries(attrs)) g.setAttribute(n, at)
        g.setIndex(index)
        const r = range.get(variant) ?? [0, 0]
        g.setDrawRange(r[0], r[1])
        const { iVar, iDim, iUp, iLift } = attachInstanceAttributes(g, count)
        const mesh = new THREE.InstancedMesh(g, material, count)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        mesh.frustumCulled = false
        mesh.raycast = () => {}
        mesh.visible = false
        mesh.name = `monuments:${arch}:${buildArchetype(arch).forms[variant]?.name}`
        meshOf.set(k, meshes.length)
        meshes.push({ arch, mesh, iVar, iDim, iUp, iLift, count: 0, tris: r[1] / 3 })
      }
    }
    const slots: Slot[] = []
    const add = (info: LandmarkInfo, arch: Archetype, form: string, part: Slot['part']) => {
      const kit = buildArchetype(arch)
      const variant = kit.index.get(form) ?? 0
      const f = kit.forms[variant]
      const mi = meshOf.get(keyOf(arch, form))!
      const m = meshes[mi]
      const slot = m.count++
      // the landmark's preferred facing (front toward the viewer's lower-left, into the
      // upper-left key light); others a small fixed per-landmark turn the same way
      const yaw = info.lm.face ?? -(0.3 + ((info.index * 7) % 5) * 0.04)
      const mainSize = part ? (slots.find((q) => q.info === info && !q.part)?.size ?? f.size) : f.size
      slots.push({ info, arch, mesh: mi, slot, variant, size: f.size, mainSize, width: f.box[3] - f.box[0], height: f.box[4], part, yaw })
    }
    for (const info of infos) {
      add(info, info.lm.arch, info.lm.form, null)
      for (const p of info.lm.parts ?? []) add(info, p.arch, p.form, { x: p.x, z: p.z, s: p.s })
    }
    const mainSlot = infos.map((info) => slots.find((s) => s.info === info && !s.part)!)
    // the curated miniature set: every detailed hero model, plus visited built monuments
    // whose form reads at miniature size (WIDE_FORMS); slab-like forms and natural
    // features keep their 2D glyph and join at close zoom
    const hero = infos.map((i) => HERO_FORM_NAMES.has(i.lm.form))
    const slab = infos.map((i) => SLAB_FORMS.has(i.lm.form))
    // the landmark's own pins: its near_place and any place within OWN_PIN_KM of the site
    const ownPins = infos.map((i) => {
      const own = new Set<number>()
      if (i.placeIndex >= 0) own.add(i.placeIndex)
      locations.forEach((l, q) => {
        if (dirOf(l.lat, l.lon, tmpV).dot(i.dir) > Math.cos(OWN_PIN_KM / 6371)) own.add(q)
      })
      return own
    })
    const wideSet = infos.map((i, k) => hero[k] || (i.visited && WIDE_FORMS.has(i.lm.form) && !NATURAL.has(i.lm.arch)))
    const group = new THREE.Group()
    group.name = 'monuments'
    for (const m of meshes) group.add(m.mesh)
    const anim = infos.map(() => ({ vis: 0, dim: 0, legible: false, kept: false }))
    const frame: FrameRec[] = infos.map(() => ({
      scale: 0, px: 0, ppu: 1, facing: 0, ok: false, wide: false, base: new THREE.Vector3(), pre: new THREE.Vector3(), side: 0, target: new THREE.Vector3(), nudged: false, why: '', placed: false, bx: 0, by: 0,
    }))
    return {
      infos, material, meshes, slots, mainSlot, wideSet, hero, slab, ownPins, group, anim, frame, ready: 0, ctx: new CameraContext(),
      stats: { visible: 0, meshes: 0, tris: 0, cpuMs: 0, capPx: 0, budget: 0, guardedVerts: guarded },
    }
  }, [])

  useEffect(() => {
    registerDebug('monuments', () => ({
      tier,
      visible: parts.stats.visible,
      meshesDrawn: parts.stats.meshes,
      trianglesDrawn: parts.stats.tris,
      cpuMs: +parts.stats.cpuMs.toFixed(3),
      capPx: +parts.stats.capPx.toFixed(1),
      budget: parts.stats.budget,
      guardedVerts: parts.stats.guardedVerts,
      fade: globeState.lod.monument3dFade,
      list: parts.infos.filter((_, i) => parts.anim[i].vis > 0.01).map((i) => i.lm.id),
      /** per drawn landmark: id, size (CSS px, before the scale-in), drawn px (x scale-in), shown, base (CSS px), wide set */
      items: parts.infos
        .map((info, i) => ({ info, i }))
        .filter(({ i }) => monumentShown[i] > 0.01)
        .map(({ info, i }) => {
          const f = parts.frame[i]
          const off = Math.round((Math.acos(Math.min(1, f.base.dot(info.dir))) * 6371))
          return { id: info.lm.id, size: +f.px.toFixed(2), px: +(f.px * parts.anim[i].vis).toFixed(2), shown: +monumentShown[i].toFixed(3), x: Math.round(f.bx), y: Math.round(f.by), wide: f.wide, nudged: f.nudged, offKm: off, land: isLandDir(f.base), why: f.why }
        }),
      boxes: monumentBoxes.length / 4,
      /** wide-set landmarks not drawn, with the last placement note */
      waiting: parts.infos.filter((_, i) => parts.frame[i].wide && monumentShown[i] <= 0.01).map((info) => `${info.lm.id}:${parts.frame[info.index].why}`),
    }))
    registerDebug('monumentUniform', (k: string, v: number) => {
      const u = parts.material.uniforms[k]
      if (u) u.value = v
      return Object.keys(parts.material.uniforms)
    })
    registerDebug('monumentBench', (n = 60) => {
      // interleaved rounds (with / without the monuments), median per round: a single
      // with-then-without pair was dominated by GPU warm-up noise
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const run = () => {
        gl.render(scene, camera)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      const was = parts.group.visible
      const time = (on: boolean, k: number) => {
        parts.group.visible = on
        run()
        const t = performance.now()
        for (let i = 0; i < k; i++) run()
        return (performance.now() - t) / k
      }
      for (let i = 0; i < 10; i++) run()
      const rounds = 7
      const k = Math.max(4, Math.round(n / rounds))
      const on: number[] = []
      const off: number[] = []
      let calls = 0, tris = 0, callsOff = 0, trisOff = 0
      for (let r = 0; r < rounds; r++) {
        on.push(time(true, k))
        calls = gl.info.render.calls
        tris = gl.info.render.triangles
        off.push(time(false, k))
        callsOff = gl.info.render.calls
        trisOff = gl.info.render.triangles
      }
      parts.group.visible = was
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]
      const diffs = on.map((v, i) => v - off[i])
      return {
        msWith: +med(on).toFixed(3), msWithout: +med(off).toFixed(3), monumentMs: +med(diffs).toFixed(3),
        drawCalls: calls, drawCallsWithout: callsOff, monumentCalls: calls - callsOff,
        triangles: tris, monumentTriangles: tris - trisOff, cpuPlacementMs: +parts.stats.cpuMs.toFixed(3),
        visible: parts.stats.visible,
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
      monumentBoxes.length = 0
    },
    [parts],
  )

  // scratch (allocation-free frame)
  const tmp = useMemo(
    () => ({
      d: new THREE.Vector3(), base: new THREE.Vector3(), U: new THREE.Vector3(), F: new THREE.Vector3(), X: new THREE.Vector3(),
      U2: new THREE.Vector3(), F2: new THREE.Vector3(), Xr: new THREE.Vector3(), Zr: new THREE.Vector3(), v: new THREE.Vector3(),
      p: new THREE.Vector3(), top: new THREE.Vector3(), m: new THREE.Matrix4(),
      toCam: new THREE.Vector3(), vUp: new THREE.Vector3(), vF: new THREE.Vector3(),
      scr: [0, 0] as [number, number],
      scr2: [0, 0] as [number, number],
      placed: [] as { x: number; y: number; px: number; kept: boolean }[],
      pins: [] as number[],
      nearPins: [] as number[],
      lp: new THREE.Vector3(),
      best: new THREE.Vector3(),
      order: [] as number[],
      keep: new Uint8Array(0),
    }),
    [],
  )

  /** F (toward the viewer on the ground) and X (screen-right) at ground direction U */
  const groundFrame = (ctx: CameraContext, U: THREE.Vector3, F: THREE.Vector3, X: THREE.Vector3) => {
    F.copy(ctx.camUpLocal).addScaledVector(U, -ctx.camUpLocal.dot(U))
    if (F.lengthSq() < 1e-9) F.set(1, 0, 0).addScaledVector(U, -U.x)
    F.normalize().negate()
    X.crossVectors(U, F).normalize()
  }

  useFrame((_, rawDt) => {
    const g = globeState
    const lod = g.lod
    const inner = sceneRefs.inner
    const { meshes, slots, anim, infos, ctx, stats, material, frame: fr, mainSlot, wideSet, hero, slab, ownPins } = parts
    const dt = Math.min(rawDt, 0.1) * 1000
    // on once the painted surface is in (stage B+), on every cube tier and at every view
    const surface = g.surfaceReady && (g.stage === 'B' || g.stage === 'C' || g.stage === 'D')
    // the CPU height grid doubles as the land / water test for the site nudge: wait for it
    const readyT = !disabled && tier !== 'low' && surface && heightGridReady() ? 1 : 0
    parts.ready = reducedMotion ? readyT : readyT > parts.ready ? Math.min(1, parts.ready + dt / READY_MS) : Math.max(0, parts.ready - dt / READY_MS)
    // the work / contact plates dim the globe: the miniatures leave with the dim
    const sectionFade = 1 - smooth(g.dim, 0.12, 0.35)
    const fade = parts.ready * sectionFade
    const anyAnim = anim.some((a) => a.vis > 0.001)
    if (!inner || (fade <= 0 && !anyAnim)) {
      for (const m of meshes) m.mesh.visible = false
      monumentShown.fill(0)
      monumentBoxes.length = 0
      for (const a of anim) a.vis = 0
      stats.visible = 0
      stats.meshes = 0
      stats.tris = 0
      return
    }
    const t0 = performance.now()
    ctx.update(camera, inner, size.width, size.height)
    const phone = g.isPhone || isCoarsePointer()
    const hover = g.anchors.hoverIndex
    const active = g.anchors.activeIndex
    // one size rule for both regimes: the miniature cap, shrinking with a small globe
    const globeK = THREE.MathUtils.clamp(g.radiusPx / (phone ? REF_R_PHONE : REF_R), GLOBE_K_MIN, 1)
    const capPx = (phone ? CAP_PX_PHONE : CAP_PX) * globeK
    const heroCapPx = (phone ? HERO_CAP_PX_PHONE : HERO_CAP_PX) * globeK
    const budget0 = phone ? BUDGET_PHONE : BUDGET
    const budget = lod.viewKm >= WIDE_KM ? budget0 : Math.min(999, Math.round(budget0 * (WIDE_KM / lod.viewKm) ** 2))
    stats.capPx = capPx
    stats.budget = budget
    const cx = g.centerPx[0], cy = g.centerPx[1], R = g.radiusPx
    const { d, U, F, X, v, scr, scr2, top } = tmp

    // the drawn pins this frame (CSS px), for the site nudge
    const pinsPx = g.pinsPx
    const pins = tmp.pins
    pins.length = 0
    for (let q = 0; q + 3 < pinsPx.length; q += 4) if (pinsPx[q + 2] > PIN_VIS_MIN) pins.push(pinsPx[q], pinsPx[q + 1], q >> 2)
    const near = tmp.nearPins
    /**
     * Pin cost of a footprint (base bx,by; half width hw; height h px): Infinity when it
     * covers one of the landmark's own pins, else OTHER_PIN_PX per other pin it covers
     */
    const pinCost = (bx: number, by: number, hw: number, h: number, own: Set<number>) => {
      let c = 0
      for (let q = 0; q < near.length; q += 3) {
        const px = near[q], py = near[q + 1]
        const dx = Math.max(bx - hw - px, 0, px - bx - hw)
        // the form's front stands a little below its base point (its depth toward the viewer)
        const dy = Math.max(by - h - py, 0, py - by - FRONT_DROP * h)
        if (dx * dx + dy * dy < PIN_CLEAR_PX * PIN_CLEAR_PX) {
          if (own.has(near[q + 2])) return Infinity
          c += OTHER_PIN_PX
        }
      }
      return c
    }
    /** land under a candidate: -1 if the base (centre + both ends) is not on land, else the body's water cost */
    const landCost = (c: THREE.Vector3, hw: number, h: number, ppu: number) => {
      const { lp } = tmp
      if (!isLandDir(c)) return -1
      const w = (0.6 * hw) / ppu // the base ends (the outer 40% of a wide complex may overhang a shore)
      lp.copy(c).addScaledVector(X, w).normalize()
      if (!isLandDir(lp)) return -1
      lp.copy(c).addScaledVector(X, -w).normalize()
      if (!isLandDir(lp)) return -1
      lp.copy(c).addScaledVector(F, (-0.5 * h) / ppu).normalize()
      return isLandDir(lp) ? 0 : BODY_WATER_PX
    }
    /** deep zoom: the footprint inside the neatline's paint (always true without it) */
    const inNeat = (bx: number, by: number, hw: number, h: number) => {
      if (!neatGuard.on) return true
      if (bx - 0.8 * hw < neatGuard.x0 || bx + 0.8 * hw > neatGuard.x1 || by - h < neatGuard.y0 || by > neatGuard.y1) return false
      // ...and off its scale numerals
      const nb = neatGuard.boxes
      for (let q = 0; q + 3 < nb.length; q += 4) {
        if (bx + 0.8 * hw > nb[q] && bx - 0.8 * hw < nb[q + 2] && by > nb[q + 1] && by - h < nb[q + 3]) return false
      }
      return true
    }
    /** land at 1/4, 1/2 and 3/4 of the way from a to b */
    const landPath = (a0: THREE.Vector3, b0: THREE.Vector3) => {
      const { lp } = tmp
      for (const t of [0.25, 0.5, 0.75]) {
        lp.copy(a0).lerp(b0, t).normalize()
        if (!isLandDir(lp)) return false
      }
      return true
    }
    const slideK = reducedMotion ? 1 : 1 - Math.exp(-dt / SLIDE_MS)

    // pass 1: per landmark size, ground point (true site, nudged off pins onto land), screen footprint, eligibility
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i]
      const a = anim[i]
      const f = fr[i]
      const ppu = ctx.pxPerUnit(info.dir)
      const fame3 = info.lm.fame === 3
      const naturalPx = WORLD_H * (fame3 ? 1.15 : 0.95) * ppu
      a.legible = slab[i]
        ? naturalPx >= (a.legible ? SLAB_HIDE_PX : SLAB_SHOW_PX)
        : naturalPx >= (a.legible ? HIDE_BELOW_PX : SHOW_AT_PX)
      const capK = hero[i] ? heroCapPx * (fame3 ? 1 : 0.94) : capPx * (fame3 ? 1 : FAME2_K)
      f.wide = wideSet[i]
      const nearOk = a.legible && (!phone || info.visited)
      f.px = f.wide ? capK : Math.min(naturalPx, capK)
      f.ppu = ppu
      f.scale = f.px / ppu
      f.facing = ctx.facing(info.dir, info.dir)
      f.ok = false
      if (fade <= 0 || !(f.wide || nearOk) || f.facing <= (a.kept ? FACING_KEEP : FACING_ON)) {
        if (a.vis <= 0.001) f.placed = false
        continue
      }
      // placement: the TRUE site; only when the footprint covers a pin is it nudged, in
      // the screen direction (8 around) with the smallest displacement that clears every
      // pin and keeps the base on land (never over open sea); the previous nudge is kept
      // while it stays valid and near-best, and the drawn base eases to the target
      const ms = mainSlot[i]
      const halfW = f.px * (ms.width / ms.size) * 0.5
      const hPx = f.px * (ms.height / ms.size)
      U.copy(info.dir)
      groundFrame(ctx, U, F, X)
      if (!ctx.project(U, scr)) continue
      const sx = scr[0], sy = scr[1]
      // far enough to clear the own pin in any direction, never further
      const maxR = Math.max(halfW, hPx) + PIN_CLEAR_PX + NUDGE_STEP_PX
      const reach = maxR + halfW + hPx + PIN_CLEAR_PX
      near.length = 0
      for (let q = 0; q < pins.length; q += 3) {
        if (Math.abs(pins[q] - sx) < reach && Math.abs(pins[q + 1] - sy) < reach) near.push(pins[q], pins[q + 1], pins[q + 2])
      }
      const own = ownPins[i]
      const siteLand = isLandDir(U)
      const siteCost = pinCost(sx, sy, halfW, hPx, own)
      if (DEBUG) f.why = ''
      if (siteCost === 0) {
        f.target.copy(U)
        f.nudged = false
      } else {
        let bestCost = siteCost
        let bestJ = -1
        const best = tmp.best.copy(U)
        // the previous nudge, if still clear of the own pins and on land
        let prevCost = Infinity
        if (f.nudged && ctx.project(f.target, scr2)) {
          const pc = pinCost(scr2[0], scr2[1], halfW, hPx, own)
          const lc = pc < Infinity && inNeat(scr2[0], scr2[1], halfW, hPx) ? landCost(f.target, halfW, hPx, ppu) : -1
          if (lc >= 0) prevCost = Math.hypot(scr2[0] - sx, scr2[1] - sy) + lc + pc
        }
        for (let r = NUDGE_STEP_PX; r <= maxR && r < bestCost; r += NUDGE_STEP_PX) {
          const ang = r / ppu
          if (ang > NUDGE_MAX_RAD) break
          const ca = Math.cos(ang), sa = Math.sin(ang)
          for (let j = 0; j < NUDGE_DIRS; j++) {
            const th = (j / NUDGE_DIRS) * Math.PI * 2
            // tangent: screen-right (X) and screen-up (away from the viewer, -F)
            v.copy(X).multiplyScalar(Math.cos(th)).addScaledVector(F, -Math.sin(th))
            d.copy(U).multiplyScalar(ca).addScaledVector(v, sa)
            if (!ctx.project(d, scr2)) continue
            const disp = Math.hypot(scr2[0] - sx, scr2[1] - sy)
            if (disp >= bestCost) continue
            const pc = pinCost(scr2[0], scr2[1], halfW, hPx, own)
            if (disp + pc >= bestCost || !inNeat(scr2[0], scr2[1], halfW, hPx)) continue
            const lc = landCost(d, halfW, hPx, ppu)
            if (lc < 0 || disp + pc + lc >= bestCost) continue
            // no hopping across a sea to another shore (Giza onto Anatolia): the way from
            // a land site to the nudge stays on land
            if (siteLand && !landPath(U, d)) continue
            bestCost = disp + pc + lc
            best.copy(d)
            bestJ = j * 100 + r
          }
        }
        if (DEBUG) f.why = `site ${siteCost} best ${bestCost.toFixed(1)} prev ${prevCost.toFixed(1)} dir ${bestJ} site@${sx.toFixed(0)},${sy.toFixed(0)} own ${own.size} near ${near.length / 3} hw ${halfW.toFixed(0)} h ${hPx.toFixed(0)}`
        if (prevCost < Infinity && prevCost <= bestCost + KEEP_SLACK_PX) {
          f.nudged = true
        } else if (bestCost < Infinity) {
          f.target.copy(best)
          f.nudged = best.dot(U) < 1 - 1e-12
        } else {
          // nowhere clear on land nearby: the true site, under the pins (pins draw on top)
          f.target.copy(U)
          f.nudged = false
        }
      }
      if (!f.placed || a.vis <= 0.001) f.pre.copy(f.target)
      else f.pre.lerp(f.target, slideK).normalize()
      f.base.copy(f.pre)
      f.placed = true
      d.copy(f.base)
      if (!ctx.project(d, scr)) continue
      // a non-hero miniature that cannot stand near its site at this scale waits (its
      // glyph / the close-zoom regime carry it); heroes always stand, nudged
      if (!hero[i] && Math.hypot(scr[0] - sx, scr[1] - sy) > (a.kept ? NONHERO_NUDGE_KEEP_PX : NONHERO_NUDGE_PX)) continue
      f.bx = scr[0]
      f.by = scr[1]
      const mg = SCREEN_MARGIN_PX
      if (f.bx < -mg || f.by < -mg || f.bx > size.width + mg || f.by > size.height + mg) continue
      // the whole miniature stays inside the disc (it never stands out over the limb)
      if (R > 2 && lod.viewKm > 2500) {
        const rr = R - DISC_MARGIN_PX - (a.kept ? 0 : 4)
        const reach = Math.hypot(f.bx - cx, f.by - f.px - cy) + halfW
        if (Math.hypot(f.bx - cx, f.by - cy) + halfW > rr || reach > rr) {
          if (DEBUG) f.why += ' rej:disc'
          continue
        }
      }
      // deep zoom: keep off the neatline's tick band and its scale numerals (finish review)
      if (neatGuard.on) {
        if (!inNeat(f.bx, f.by, halfW, hPx)) {
          if (DEBUG) f.why += ' rej:neat'
          continue
        }
      }
      f.ok = true
    }

    // declutter: strongest first (visited x fame), incumbents ahead of newcomers of the
    // same class; footprints (centred half a height above the base) keep SEP_K x (pxA + pxB)
    const order = tmp.order
    order.length = 0
    for (let i = 0; i < infos.length; i++) if (fr[i].ok) order.push(i)
    // hero models first (they are what the wide view is for), then visited x fame
    const rank = (i: number) => (hero[i] ? 20 : 0) + infos[i].priority + (anim[i].kept ? 0.5 : 0)
    order.sort((a, b) => rank(b) - rank(a) || a - b)
    const placed = tmp.placed
    placed.length = 0
    /**
     * A hero that clashes with a placed neighbour (St Peter's 3 km from the Colosseum)
     * stands beside it instead: shifted screen-left or -right by one spacing, on land and
     * clear of its own pins; the side that worked last is tried first
     */
    const pairShift = (i: number) => {
      const f = fr[i]
      const ms = mainSlot[i]
      const halfW = f.px * (ms.width / ms.size) * 0.5
      const hPx = f.px * (ms.height / ms.size)
      groundFrame(ctx, f.pre, F, X)
      const first = f.side || -1
      let bestCost = Infinity
      for (const side of [first, -first]) {
        for (const k of [1, 1.35]) {
          const sh = side * k * SEP_K * 2 * f.px
          d.copy(f.pre).addScaledVector(X, sh / f.ppu).normalize()
          if (!ctx.project(d, scr)) continue
          const bx = scr[0], by = scr[1]
          if (bx < 0 || by < 0 || bx > size.width || by > size.height) continue
          if (!inNeat(bx, by, halfW, hPx)) continue
          // the side with its body on land wins (the last side on a tie)
          const lc = landCost(d, halfW, hPx, f.ppu)
          if (lc < 0 || lc + (k - 1) * 10 + (side === first ? 0 : 0.5) >= bestCost) continue
          near.length = 0
          for (let q = 0; q < pins.length; q += 3) near.push(pins[q], pins[q + 1], pins[q + 2])
          if (pinCost(bx, by, halfW, hPx, ownPins[i]) === Infinity) continue
          const fy = by - f.px * 0.5
          let ok = true
          for (const q of placed) if (Math.hypot(q.x - bx, q.y - fy) < SEP_K * (q.px + f.px)) ok = false
          if (!ok) continue
          bestCost = lc + (k - 1) * 10 + (side === first ? 0 : 0.5)
          tmp.best.copy(d)
          f.bx = bx
          f.by = by
          f.side = side
        }
      }
      if (bestCost < Infinity) {
        f.base.copy(tmp.best)
        return true
      }
      return false
    }
    if (tmp.keep.length !== infos.length) tmp.keep = new Uint8Array(infos.length)
    const keep = tmp.keep
    keep.fill(0)
    let n = 0
    for (const i of order) {
      if (n >= budget) break
      const f = fr[i]
      const fx = f.bx
      const fy = f.by - f.px * 0.5
      const kept = anim[i].kept
      let clash = false
      for (const q of placed) {
        const sep = SEP_K * (q.px + f.px) * (kept && q.kept ? KEEP_SEP : 1)
        if (Math.hypot(q.x - fx, q.y - fy) < sep) {
          clash = true
          break
        }
      }
      if (clash && !(hero[i] && lod.viewKm < PAIR_KM && pairShift(i))) continue
      placed.push({ x: f.bx, y: f.by - f.px * 0.5, px: f.px, kept })
      keep[i] = 1
      n++
    }
    for (let i = 0; i < infos.length; i++) {
      const a = anim[i]
      a.kept = keep[i] === 1
      const target = keep[i] ? 1 : 0
      a.vis = reducedMotion ? target : target > a.vis ? Math.min(target, a.vis + dt / SCALE_IN_MS) : Math.max(target, a.vis - dt / SCALE_IN_MS)
      const pi = infos[i].placeIndex
      const dimT = pi >= 0 && (pi === hover || pi === active) ? 1 : 0
      a.dim = reducedMotion ? dimT : dimT > a.dim ? Math.min(1, a.dim + dt / DIM_MS) : Math.max(0, a.dim - dt / DIM_MS)
      monumentShown[i] = a.vis * fade * smooth(fr[i].facing, FACE_FADE[0], FACE_FADE[1])
    }

    // pass 2: instance matrices + the drawn footprints (label / glyph obstacles)
    for (const rec of meshes) rec.mesh.count = 0
    monumentBoxes.length = 0
    let visible = 0
    let tris = 0
    const { base, U2, F2, Xr, Zr, p, m } = tmp
    const wideView = smooth(lod.viewKm, UPRIGHT_KM[0], UPRIGHT_KM[1])
    const upright = UPRIGHT * wideView
    const lift = LIFT_H * wideView
    for (const s of slots) {
      const i = s.info.index
      const f = fr[i]
      const rec = meshes[s.mesh]
      const vis = monumentShown[i]
      if (vis <= 0.001) continue
      const kMain = f.scale / s.mainSize
      const k = s.part ? kMain * s.part.s : f.scale / s.size
      U.copy(f.base)
      const foot = NATURAL.has(s.arch) ? s.size * k * 0.35 : 0
      const r = 1 + groundM(U, foot) * lod.heightScale - 0.04 * s.height * k
      base.copy(U).multiplyScalar(r)
      groundFrame(ctx, U, F, X)
      v.copy(ctx.camLocal).sub(base).normalize()
      const theta = Math.acos(Math.min(1, Math.max(-1, v.dot(U))))
      const lean = Math.max(0, MIN_VIEW_ANGLE - theta)
      U2.copy(U).multiplyScalar(Math.cos(lean)).addScaledVector(F, -Math.sin(lean))
      F2.copy(F).multiplyScalar(Math.cos(lean)).addScaledVector(U, Math.sin(lean))
      if (upright > 0) {
        // wide views: the miniature stands upright on screen, seen from VIEW_ELEV above
        // (a ground-normal stance would show the lower half of the disc its roofs and
        // lay the limb ones on their side); a share of the ground lean is kept
        const { toCam, vUp, vF } = tmp
        toCam.copy(ctx.camLocal).sub(base).normalize()
        vUp.copy(ctx.camUpLocal).addScaledVector(toCam, -ctx.camUpLocal.dot(toCam)).normalize()
        vF.copy(toCam).multiplyScalar(COS_E).addScaledVector(vUp, -SIN_E)
        vUp.multiplyScalar(COS_E).addScaledVector(toCam, SIN_E)
        U2.multiplyScalar(1 - upright).addScaledVector(vUp, upright).normalize()
        F2.multiplyScalar(1 - upright).addScaledVector(vF, upright)
        F2.addScaledVector(U2, -F2.dot(U2)).normalize()
        X.crossVectors(U2, F2).normalize()
      }
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw)
      Xr.copy(X).multiplyScalar(c).addScaledVector(F2, -sn)
      Zr.copy(X).multiplyScalar(sn).addScaledVector(F2, c)
      p.copy(base)
      if (s.part) p.addScaledVector(Xr, s.part.x * kMain).addScaledVector(Zr, s.part.z * kMain)
      const dimShrink = 1 - 0.12 * anim[i].dim
      const kk = k * vis * dimShrink
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
      rec.iLift.setX(j, lift)
      if (!s.part) visible++
      tris += rec.tris
      // footprint: base and top projected, widened by half the form's width (+2 px)
      if (vis > 0.3 && anim[i].dim < 0.5 && ctx.project(p, scr)) {
        top.copy(p).addScaledVector(U2, s.height * kk)
        if (ctx.project(top, scr2)) {
          const hw = s.width * kk * f.ppu * 0.5 + 2
          monumentBoxes.push(Math.min(scr[0], scr2[0]) - hw, Math.min(scr[1], scr2[1]) - 2, Math.max(scr[0], scr2[0]) + hw, Math.max(scr[1], scr2[1]) + 3)
        }
      }
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
      rec.iLift.needsUpdate = true
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
