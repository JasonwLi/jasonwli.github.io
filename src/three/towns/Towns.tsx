/**
 * Town miniatures at the visited places (EU4 province-city style; mid/high tiers, null on
 * low, like the monuments and ships). Lazy chunk; one InstancedMesh per regional variant
 * (townKit: the four size classes are forms of one geometry, iVar picks the class), so
 * draw calls = variants on screen (1-3 in practice).
 *
 * Which: every place with photos (0-photo places keep only their dashed pin). Size class
 * by photo count (1 hamlet, 2-3 village, 4 walled town, 5 walled city); variant by country
 * (townKit.townVariantOf). Phones skip hamlets.
 * Where: at the place's TRUE lat/lon, the model's origin (its square) under the pin; the
 * pin (depthTest off, renderOrder 30) is drawn on the square, the tall buildings stand
 * behind it, up the screen. Stance and lift as the monuments: upright on screen, seen from
 * 32 deg above at wide views, the ground normal leaned to >= 55 deg off vertical at close
 * zoom; seated on the lowest ground under its footprint, slid toward the eye by the relief
 * that rises around it on the exaggerated terrain (monuments' RELIEF rule), depth-tested.
 * When: none above 4300 km (the hero / travel views belong to the monuments and pins);
 * fading in 4300 -> 3400 km while a city grows from 11 px wide (4000) to 16 (3000), 28
 * (1500) and caps at 36 px (<= 800 km); the other classes are smaller in proportion (one
 * model unit = a city's width). Phones x0.8.
 * Declutter (screen space, greedy): the active place first, then photo count, incumbents
 * ahead of newcomers; a town's box may not overlap a placed town (incumbents get 2 px of
 * slack), the drawn monuments (all of them, dimmed ones included) or the 2D landmark
 * glyphs: there the MONUMENT WINS — the town first shrinks to 65%, else waits; inside the
 * deep-zoom neatline; at most 40 (phones 12). Each town scales in / fades over 260 ms;
 * horizon-faded (facing 0.1 -> 0.3); faded with the section dim (gone in work / contact).
 * Active place: its town stays full while the other towns dim slightly (x0.86, iDim 0.28)
 * and the active one grows 6%; no vermilion on the model (the pin is the vermilion).
 * Obstacles: the drawn boxes are published (screenObstacles.townBoxes: names keep off
 * them; ships too) and, per place, how far its town reaches left / right of the pin
 * (townLabelReach: the place name sets beside its own town).
 * renderOrder 18 (under the ships 18.5, map labels 19, place labels 24 and pins 30).
 *
 * Debug (?debug=1): __globe.towns() → drawn towns (place, variant, class, px, box, alpha)
 * and stats; __globe.townBench(n) → ms/frame with and without the towns; ?towns=0 disables.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Tier } from '../globeState'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { registerDebug } from '../debugHooks'
import { locations } from '../../data/travel'
import { pinLocal } from '../instrument/pinsPx'
import { LIFT } from '../geo/radii'
import { GLYPH_BOX_PX, glyphBoxes, monumentFootprints, neatGuard, townBoxes, townLabelReach } from '../instrument/screenObstacles'
import { CameraContext, dirOf, groundM, groundMaxM, isCoarsePointer } from '../monuments/landmarkFrame'
import { guardThemeColours } from '../monuments/material'
import { TOWN_VARIANTS, buildTown, townClassOf, townVariantOf, type TownClass } from './townKit'
import { attachTownAttributes, makeTownMaterial } from './material'

/** city width (CSS px) over viewKm (log-interpolated) */
const SIZE_KM = [4000, 3000, 1500, 800]
const SIZE_PX = [11, 16, 28, 36]
const PHONE_K = 0.8
const SHOW_KM: [number, number] = [3400, 4300] // full below, none above (faint at 4000)
const BUDGET = 40
const BUDGET_PHONE = 12
const SHRINK = 0.65
const GAP_PX = 2
const KEEP_SLACK_PX = 2
const MON_GAP_PX = 3
const FACING_ON = 0.12
const FACING_KEEP = 0.08
const FACE_FADE: [number, number] = [0.1, 0.3]
const SCREEN_MARGIN_PX = 40
const SCALE_IN_MS = 260
const SHRINK_MS = 180
const DIM_MS = 180
const READY_MS = 400
const DIM_OTHERS = 0.28
const ACTIVE_GROW = 1.06
/** stance (as Monuments) */
const MIN_VIEW_ANGLE = (55 * Math.PI) / 180
const UPRIGHT = 0.8
const VIEW_ELEV = (32 * Math.PI) / 180
const COS_E = Math.cos(VIEW_ELEV)
const SIN_E = Math.sin(VIEW_ELEV)
const UPRIGHT_KM: [number, number] = [1800, 3600]
const LIFT_W = 0.5 // wide-view depth lift, model units (city widths)
const RELIEF_MARGIN = 0.05
const RELIEF_LIFT_MAX = 0.8
const SINK = 0.012
const GRACE_FRAMES = 2
const LEAN_MARGIN = 0.04

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('towns') === '0'
const smooth = THREE.MathUtils.smoothstep

interface TownRec {
  place: number
  dir: THREE.Vector3
  cls: TownClass
  variant: number
  photos: number
  yaw: number
  mirror: number
  /** screen extents per unit px (the form's bbox seen from ~33 deg): half width, up, down */
  hw: number
  up: number
  down: number
  height: number
  /** how far the form reaches behind its origin (model units): sinks under a leaned stance */
  back: number
  // state
  vis: number
  shrink: number
  dim: number
  kept: boolean
  /** frames an incumbent has failed placement in a row (a one-frame glitch is ridden out) */
  miss: number
  // per frame
  ok: boolean
  facing: number
  px: number
  ppu: number
  bx: number
  by: number
  k: number // target shrink this frame
}

/** city width in CSS px at a view */
function unitPx(viewKm: number): number {
  if (viewKm >= SIZE_KM[0]) return SIZE_PX[0]
  if (viewKm <= SIZE_KM[SIZE_KM.length - 1]) return SIZE_PX[SIZE_PX.length - 1]
  const lv = Math.log(viewKm)
  for (let i = 0; i + 1 < SIZE_KM.length; i++) {
    const a = Math.log(SIZE_KM[i]), b = Math.log(SIZE_KM[i + 1])
    if (lv <= a && lv >= b) {
      const t = (a - lv) / (a - b)
      return SIZE_PX[i] + (SIZE_PX[i + 1] - SIZE_PX[i]) * t
    }
  }
  return SIZE_PX[SIZE_PX.length - 1]
}

export function Towns({ tier, reducedMotion }: { tier: Tier; reducedMotion: boolean }) {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const parts = useMemo(() => {
    const material = makeTownMaterial()
    const towns: TownRec[] = []
    locations.forEach((l, place) => {
      const cls = townClassOf(l.photos.length)
      if (cls < 0) return
      const v = TOWN_VARIANTS.indexOf(townVariantOf(l.cc, l.lat, l.lon))
      const h = (place * 2654435761) >>> 0
      towns.push({
        place, dir: dirOf(l.lat, l.lon), cls: cls as TownClass, variant: v, photos: l.photos.length,
        yaw: -0.3 + ((h % 1000) / 1000 - 0.5) * 0.36, mirror: (h >> 11) & 1 ? -1 : 1,
        hw: 0, up: 0, down: 0, height: 0, back: 0,
        vis: 0, shrink: 1, dim: 0, kept: false, miss: 0, ok: false, facing: 0, px: 0, ppu: 1, bx: 0, by: 0, k: 1,
      })
    })
    const counts = TOWN_VARIANTS.map((_, v) => towns.filter((t) => t.variant === v).length)
    const meshes = TOWN_VARIANTS.map((name, v) => {
      if (!counts[v]) return null
      const src = buildTown(name)
      const g = new THREE.BufferGeometry()
      for (const [n, at] of Object.entries(src.geometry.attributes)) g.setAttribute(n, at as THREE.BufferAttribute)
      g.setAttribute('aCol', guardThemeColours(src.geometry.getAttribute('aCol') as THREE.BufferAttribute).attr)
      g.setIndex(src.geometry.index)
      const attrs = attachTownAttributes(g, counts[v])
      const mesh = new THREE.InstancedMesh(g, material, counts[v])
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.frustumCulled = false
      mesh.raycast = () => {}
      mesh.renderOrder = 18
      mesh.visible = false
      mesh.count = 0
      mesh.name = `towns:${name}`
      return { mesh, attrs, forms: src.forms }
    })
    for (const t of towns) {
      const b = meshes[t.variant]!.forms[t.cls].box // [minX, minY, minZ, maxX, maxY, maxZ]
      t.hw = Math.max(-b[0], b[3], -b[2], b[5]) // yaw / mirror safe
      t.up = Math.max(-b[2] * SIN_E + b[4] * COS_E, 0)
      t.down = b[5] * SIN_E
      t.height = b[4]
      t.back = Math.max(0, -b[2])
    }
    const group = new THREE.Group()
    group.name = 'towns'
    for (const m of meshes) if (m) group.add(m.mesh)
    return {
      material, towns, meshes, group, ready: 0, ctx: new CameraContext(),
      order: [] as number[], placed: [] as number[],
      stats: { drawn: 0, calls: 0, tris: 0, cpuMs: 0, unitPx: 0, budget: 0, shrunk: 0, blocked: 0 },
    }
  }, [])

  useEffect(() => {
    registerDebug('towns', () => {
      const { towns, stats } = parts
      return {
        tier, towns: towns.length, ...stats, cpuMs: +stats.cpuMs.toFixed(3), unitPx: +stats.unitPx.toFixed(1),
        trisPerClass: Object.fromEntries(TOWN_VARIANTS.map((n, v) => [n, parts.meshes[v]?.forms.map((f) => f.tris) ?? buildTown(n).forms.map((f) => f.tris)])),
        list: towns
          .filter((t) => t.vis > 0.01)
          .map((t) => ({
            slug: locations[t.place].slug, variant: TOWN_VARIANTS[t.variant], cls: t.cls, px: +(t.px * t.shrink).toFixed(1), vis: +t.vis.toFixed(2),
            shrink: +t.shrink.toFixed(2), dim: +t.dim.toFixed(2), x: Math.round(t.bx), y: Math.round(t.by),
          })),
        boxes: townBoxes.length / 4,
      }
    })
    registerDebug('townBench', (n = 60) => {
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
      let calls = 0, callsOff = 0, tris = 0, trisOff = 0
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
      return {
        msWith: +med(on).toFixed(3), msWithout: +med(off).toFixed(3), townMs: +med(on.map((v, i) => v - off[i])).toFixed(3),
        townCalls: calls - callsOff, townTriangles: tris - trisOff, cpuMs: +parts.stats.cpuMs.toFixed(3), drawn: parts.stats.drawn,
      }
    })
  }, [parts, gl, scene, camera, tier])

  useEffect(
    () => () => {
      for (const m of parts.meshes) {
        if (!m) continue
        m.mesh.geometry.dispose()
        m.mesh.dispose()
      }
      parts.material.dispose()
      townBoxes.length = 0
      townLabelReach.length = 0
    },
    [parts],
  )

  const tmp = useMemo(
    () => ({
      base: new THREE.Vector3(), F: new THREE.Vector3(), X: new THREE.Vector3(), U2: new THREE.Vector3(), F2: new THREE.Vector3(),
      Xr: new THREE.Vector3(), Zr: new THREE.Vector3(), v: new THREE.Vector3(), toCam: new THREE.Vector3(), vUp: new THREE.Vector3(),
      vF: new THREE.Vector3(), m: new THREE.Matrix4(), scr: [0, 0] as [number, number],
    }),
    [],
  )

  useFrame((_, rawDt) => {
    const g = globeState
    const lod = g.lod
    const inner = sceneRefs.inner
    const { towns, meshes, ctx, stats, material, order, placed } = parts
    // (never negative: a timer-driven frame clock can step back)
    const dt = Math.max(0, Math.min(rawDt, 0.1)) * 1000
    const surface = g.surfaceReady && (g.stage === 'B' || g.stage === 'C' || g.stage === 'D')
    const readyT = !disabled && tier !== 'low' && surface ? 1 : 0
    parts.ready = reducedMotion ? readyT : readyT > parts.ready ? Math.min(readyT, parts.ready + dt / READY_MS) : Math.max(readyT, parts.ready - dt / READY_MS)
    const zoomFade = 1 - smooth(lod.viewKm, SHOW_KM[0], SHOW_KM[1])
    const fade = parts.ready * (1 - smooth(g.dim, 0.12, 0.35)) * zoomFade
    townBoxes.length = 0
    if (townLabelReach.length !== locations.length * 2) townLabelReach.length = locations.length * 2
    townLabelReach.fill(0)
    if (!inner || (fade <= 0 && !towns.some((t) => t.vis > 0.001))) {
      for (const m of meshes) {
        if (!m) continue
        m.mesh.visible = false
        m.mesh.count = 0
      }
      for (const t of towns) {
        t.vis = 0
        t.kept = false
      }
      stats.drawn = stats.calls = stats.tris = 0
      return
    }
    const t0 = performance.now()
    ctx.update(camera, inner, size.width, size.height)
    const phone = g.isPhone || isCoarsePointer()
    const upx = unitPx(lod.viewKm) * (phone ? PHONE_K : 1)
    stats.unitPx = upx
    const budget = phone ? BUDGET_PHONE : BUDGET
    stats.budget = budget
    const active = g.anchors.activeIndex
    const hover = g.anchors.hoverIndex
    const { scr } = tmp

    // pass 1: eligibility, screen base and footprint
    order.length = 0
    for (let i = 0; i < towns.length; i++) {
      const t = towns[i]
      t.ok = false
      if (fade <= 0 || (phone && t.cls === 0)) continue
      t.facing = ctx.facing(t.dir, t.dir)
      if (t.facing <= (t.kept ? FACING_KEEP : FACING_ON)) continue
      if (!ctx.project(t.dir, scr)) continue
      // the town is seated on its pin: its screen base is the drawn pin's
      const pp = g.pinsPx
      const seatPx = pp.length >= t.place * 4 + 4
      t.bx = seatPx ? pp[t.place * 4] : scr[0]
      t.by = seatPx ? pp[t.place * 4 + 1] : scr[1]
      if (t.bx < -SCREEN_MARGIN_PX || t.by < -SCREEN_MARGIN_PX || t.bx > size.width + SCREEN_MARGIN_PX || t.by > size.height + SCREEN_MARGIN_PX) continue
      t.ppu = ctx.pxPerUnit(t.dir)
      t.px = upx * (t.place === active ? ACTIVE_GROW : 1)
      t.ok = true
      order.push(i)
    }
    const rank = (t: TownRec) => (t.place === active ? 100 : 0) + t.photos * 2 + (t.kept ? 1 : 0)
    order.sort((a, b) => rank(towns[b]) - rank(towns[a]) || a - b)

    // pass 2: greedy declutter; the monuments (and their glyphs) win
    placed.length = 0
    const boxOf = (t: TownRec, k: number, out: number[]) => {
      const s = t.px * k
      out[0] = t.bx - t.hw * s
      out[1] = t.by - t.up * s
      out[2] = t.bx + t.hw * s
      out[3] = t.by + t.down * s
      return out
    }
    const bx = [0, 0, 0, 0]
    const hitsMonument = (b: number[]) => {
      const mb = monumentFootprints
      for (let q = 0; q + 3 < mb.length; q += 4) {
        if (b[2] > mb[q] - MON_GAP_PX && b[0] < mb[q + 2] + MON_GAP_PX && b[3] > mb[q + 1] - MON_GAP_PX && b[1] < mb[q + 3] + MON_GAP_PX) return true
      }
      const h = GLYPH_BOX_PX / 2 - 4 // the glyph's ink, not its declutter box
      for (let q = 0; q + 1 < glyphBoxes.length; q += 2) {
        const cx = glyphBoxes[q], cy = glyphBoxes[q + 1]
        if (b[2] > cx - h && b[0] < cx + h && b[3] > cy - h && b[1] < cy + h) return true
      }
      return false
    }
    const inNeat = (b: number[]) => !neatGuard.on || (b[0] >= neatGuard.x0 && b[2] <= neatGuard.x1 && b[1] >= neatGuard.y0 && b[3] <= neatGuard.y1)
    const clearOfTowns = (b: number[], kept: boolean) => {
      for (let q = 0; q < placed.length; q += 5) {
        const g2 = GAP_PX - (kept && placed[q + 4] ? KEEP_SLACK_PX : 0)
        if (b[2] + g2 > placed[q] && b[0] - g2 < placed[q + 2] && b[3] + g2 > placed[q + 1] && b[1] - g2 < placed[q + 3]) return false
      }
      return true
    }
    let n = 0
    stats.shrunk = stats.blocked = 0
    for (const t of towns) t.k = 0
    for (const i of order) {
      if (n >= budget) break
      const t = towns[i]
      let k = 0
      for (const kk of [1, SHRINK]) {
        boxOf(t, kk, bx)
        if (!inNeat(bx) || hitsMonument(bx)) continue
        if (!clearOfTowns(bx, t.kept)) break // a stronger town owns the spot: shrinking is for monuments only
        k = kk
        break
      }
      if (!k && t.kept && t.miss < GRACE_FRAMES && t.vis > 0.99) {
        // an incumbent rides out a frame or two of stale obstacles (the neatline guard and
        // the monuments' footprints settle a frame after an instant view change)
        t.miss++
        k = t.shrink
        boxOf(t, k, bx)
      } else if (k) t.miss = 0
      if (!k) {
        stats.blocked++
        continue
      }
      if (k < 1) stats.shrunk++
      t.k = k
      placed.push(bx[0], bx[1], bx[2], bx[3], t.kept ? 1 : 0)
      n++
    }

    // pass 3: ease, then instances
    for (const m of meshes) if (m) m.mesh.count = 0
    const { base, F, X, U2, F2, Xr, Zr, v, toCam, vUp, vF, m } = tmp
    const wideView = smooth(lod.viewKm, UPRIGHT_KM[0], UPRIGHT_KM[1])
    const upright = UPRIGHT * wideView
    const wideLift = LIFT_W * wideView
    const kIn = reducedMotion ? 1 : dt / SCALE_IN_MS
    let drawn = 0
    let tris = 0
    for (const t of towns) {
      const want = t.k > 0 ? 1 : 0
      t.kept = want === 1
      if (!t.kept) t.miss = 0
      t.vis = reducedMotion ? want : want > t.vis ? Math.min(want, t.vis + kIn) : Math.max(want, t.vis - kIn)
      if (t.k > 0) t.shrink = reducedMotion ? t.k : t.shrink + (t.k - t.shrink) * Math.min(1, dt / SHRINK_MS)
      const dimT = active >= 0 && t.place !== active && t.place !== hover ? DIM_OTHERS : 0
      t.dim = reducedMotion ? dimT : t.dim + (dimT - t.dim) * Math.min(1, dt / DIM_MS)
      if (t.vis <= 0.001) continue
      if (t.k === 0 && !t.ok) {
        // gone behind the horizon / off screen without a frame: fade from the last pose
        t.facing = ctx.facing(t.dir, t.dir)
        t.ppu = ctx.pxPerUnit(t.dir)
      }
      const alpha = t.vis * fade * smooth(t.facing, FACE_FADE[0], FACE_FADE[1])
      if (alpha < 0.004) continue
      const rec = meshes[t.variant]
      if (!rec) continue
      const U = t.dir
      // drawn scale: model unit = px; scale-in from 55%
      const kk = ((t.px * t.shrink) / Math.max(1e-6, t.ppu)) * (0.55 + 0.45 * t.vis)
      // seated on the pin: the origin (the square) at the pin's own lifted point, so the
      // pin is drawn on the square at every tilt; the form is then slid back along the view
      // rays by that lift (material iLift < 0: same screen position, ground depth)
      const pi3 = t.place * 3
      const seated = pinLocal.length >= pi3 + 3
      const r = seated
        ? Math.hypot(pinLocal[pi3], pinLocal[pi3 + 1], pinLocal[pi3 + 2])
        : 1 + groundM(U, 0.35 * kk) * lod.heightScale
      base.copy(U).multiplyScalar(r)
      const seatBack = (seated ? LIFT.pin : 0) + SINK * kk
      F.copy(ctx.camUpLocal).addScaledVector(U, -ctx.camUpLocal.dot(U))
      if (F.lengthSq() < 1e-9) F.set(1, 0, 0).addScaledVector(U, -U.x)
      F.normalize().negate()
      X.crossVectors(U, F).normalize()
      v.copy(ctx.camLocal).sub(base).normalize()
      const theta = Math.acos(Math.min(1, Math.max(-1, v.dot(U))))
      const lean = Math.max(0, MIN_VIEW_ANGLE - theta)
      U2.copy(U).multiplyScalar(Math.cos(lean)).addScaledVector(F, -Math.sin(lean))
      F2.copy(F).multiplyScalar(Math.cos(lean)).addScaledVector(U, Math.sin(lean))
      if (upright > 0) {
        toCam.copy(ctx.camLocal).sub(base).normalize()
        vUp.copy(ctx.camUpLocal).addScaledVector(toCam, -ctx.camUpLocal.dot(toCam)).normalize()
        vF.copy(toCam).multiplyScalar(COS_E).addScaledVector(vUp, -SIN_E)
        vUp.multiplyScalar(COS_E).addScaledVector(toCam, SIN_E)
        U2.multiplyScalar(1 - upright).addScaledVector(vUp, upright).normalize()
        F2.multiplyScalar(1 - upright).addScaledVector(vF, upright)
        F2.addScaledVector(U2, -F2.dot(U2)).normalize()
        X.crossVectors(U2, F2).normalize()
      }
      const c = Math.cos(t.yaw), sn = Math.sin(t.yaw)
      Xr.copy(X).multiplyScalar(c).addScaledVector(F2, -sn).multiplyScalar(t.mirror)
      Zr.copy(X).multiplyScalar(sn).addScaledVector(F2, c)
      // a wide footprint leaned back (close zoom) tips its rear under the curved ground:
      // slide it toward the eye by that depth (screen position unchanged, material iLift)
      const leanNow = Math.acos(Math.min(1, Math.max(-1, U2.dot(U))))
      let lift = Math.max(wideLift, t.back * Math.sin(leanNow) + LEAN_MARGIN) - seatBack / kk
      if (lod.heightScale > 0 && kk > 1e-9) {
        const above = 1 + groundMaxM(U, 0.6 * kk) * lod.heightScale - r
        if (above > -seatBack) lift = Math.max(lift, Math.min(RELIEF_LIFT_MAX, (above + seatBack) / kk + RELIEF_MARGIN + t.back * Math.sin(leanNow)) - seatBack / kk)
      }
      m.set(
        Xr.x * kk, U2.x * kk, Zr.x * kk, base.x,
        Xr.y * kk, U2.y * kk, Zr.y * kk, base.y,
        Xr.z * kk, U2.z * kk, Zr.z * kk, base.z,
        0, 0, 0, 1,
      )
      const j = rec.mesh.count++
      rec.mesh.setMatrixAt(j, m)
      rec.attrs.iVar.setX(j, t.cls)
      rec.attrs.iDim.setX(j, t.dim)
      rec.attrs.iUp.setXYZ(j, U.x, U.y, U.z)
      rec.attrs.iLift.setX(j, lift)
      rec.attrs.iAlpha.setX(j, alpha)
      drawn++
      tris += rec.forms[t.cls].tris + rec.forms[t.cls].hullTris
      // obstacles: the drawn box (names, ships) and the reach either side of the pin
      if (alpha > 0.3 && t.k > 0) {
        boxOf(t, t.shrink * (0.55 + 0.45 * t.vis), bx)
        townBoxes.push(bx[0], bx[1], bx[2], bx[3])
        townLabelReach[t.place * 2] = bx[2] - t.bx
        townLabelReach[t.place * 2 + 1] = t.bx - bx[0]
      }
    }
    let calls = 0
    for (const rec of meshes) {
      if (!rec) continue
      const live = rec.mesh.count > 0
      rec.mesh.visible = live
      if (!live) continue
      calls++
      rec.mesh.instanceMatrix.needsUpdate = true
      for (const a of [rec.attrs.iVar, rec.attrs.iDim, rec.attrs.iUp, rec.attrs.iLift, rec.attrs.iAlpha]) a.needsUpdate = true
    }
    material.uniforms.uViewport.value.set(size.width, size.height)
    material.uniforms.uPxRatio.value = gl.getPixelRatio()
    material.uniforms.uDim.value = g.dim
    stats.drawn = drawn
    stats.calls = calls
    stats.tris = tris
    stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1
  })

  if (tier === 'low' || disabled || !parts.towns.length) return null
  return <primitive object={parts.group} />
}

export default Towns
