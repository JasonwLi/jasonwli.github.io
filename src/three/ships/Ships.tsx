/**
 * Ships on the route (follow-up to the route restraint): little carracks, Renaissance-chart /
 * EU-style, that sail the sea stretches of the drawn course line. Mid/high tiers (null on
 * low, like the monuments); one InstancedMesh (hull outline + model in its one draw call),
 * lazy chunk, CPU work only for a handful of instances.
 *
 * Where:
 *  - a leg is the route's own great circle (RouteLine: first-visit order, zero-length legs
 *    skipped). Once the CPU height grid lands each leg is sampled every 20 km for land /
 *    sea (landmarkFrame.isLandDir, the monuments' land test) and split into SEA RUNS; runs
 *    shorter than 300 km carry no ship;
 *  - a ship shows only where RouteLine draws the line this frame (screenObstacles
 *    routeFadeAt: restraint weight, long-leg stubs, the active overlay), after the draw-on,
 *    and only while its whole image is over water: the hull's length (plus a look-ahead off
 *    the bow), its beam and the ground under its sails (screen-up of the hull) are sampled
 *    at the drawn size every frame, so near a coast, an island or a strait it fades out
 *    before it can touch land;
 *  - few at once: at most 4 (phones 2) sailing ships, legs touching the active place first,
 *    then the longest runs, incumbents kept; 3.2 ship lengths (>= 64 px) apart on screen;
 *    off the drawn monuments and pins, and inside the deep-zoom neatline;
 *  - never on the far side: horizon-faded (facing 0.12 -> 0.3) and depth-tested.
 * Motion: each run's ship sails it from end to end, in the route's direction, in 25-40 s
 * (by run length) and never faster than 24 CSS px/s on screen, then reappears at the start
 * (faded at both ends); its heading is the great circle's tangent; a slow roll and pitch
 * (5.3 s / 3.9 s, +-2.6 / 1.4 deg). Positions come from a per-run clock seeded by the run's
 * index (deterministic, no randomness). The clock stops while the tab is hidden and under
 * prefers-reduced-motion, where each ship stands still mid-run, no bob.
 * Active place: the sea point on its legs nearest the place (by path, within 1500 km) whose
 * ship body is all water and >= 34 px from the pin gets a resting ship: it fades in a
 * little astern of that point and eases to rest there (1.4 s), then only bobs.
 * Look: the monument material and outline (three painted tones, upper-left key, L <= 0.70),
 * hatching off, per-instance alpha; stance as the wide-view monuments (upright on screen,
 * seen from 32 deg above at wide views; at close zoom the ground normal leaned until the
 * view is >= 55 deg off vertical). Size (bow to stern): 18 -> 26 px desktop, 16 -> 20 px
 * phone as the view closes from 4500 to 1200 km, x the globe-size factor. renderOrder 18.5:
 * below the map labels (19, depth test off), place labels (24) and pins (30); the ship's
 * depth hides the course line where it sails over it. Faded with the section dim (gone in
 * work and contact).
 *
 * Debug (?debug=1): __globe.ships() → drawn ships (leg, t, px, screen xy, alpha, water) and
 * stats; __globe.shipBench(n) → ms/frame with and without the ships; ?ships=0 disables.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Tier } from '../globeState'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { registerDebug } from '../debugHooks'
import { locations } from '../../data/travel'
import { EARTH_KM } from '../geo/radii'
import { heightGridReady } from '../geo/heightGrid'
import { drawnRoute, monumentBoxes, neatGuard, routeFadeAt } from '../instrument/screenObstacles'
import { CameraContext, groundM, isCoarsePointer, isLandDir } from '../monuments/landmarkFrame'
import { guardThemeColours } from '../monuments/material'
import { buildCaravel } from './caravel'
import { attachShipAttributes, makeShipMaterial } from './material'

const DEG = Math.PI / 180
const SAMPLE_KM = 20
const MIN_RUN_KM = 300
const MAX_SHIPS = 4
const MAX_SHIPS_PHONE = 2
const CAPACITY = 8
/** ship length in CSS px: [wide, close] over viewKm SIZE_KM[0] -> SIZE_KM[1] */
const SIZE_PX: [number, number] = [18, 26]
const SIZE_PX_PHONE: [number, number] = [16, 20]
const SIZE_KM: [number, number] = [4500, 1200]
const REF_R = 300
const REF_R_PHONE = 140
const GLOBE_K_MIN = 0.75
const SEP_K = 3.2
const SEP_MIN_PX = 64
/** run duration (s) by run length (km) */
const DUR_S: [number, number] = [25, 40]
const DUR_KM: [number, number] = [800, 10000]
const MAX_SPEED_PX = 24
const ENVELOPE = 0.045
const ROUTE_ON = 0.35
const FACING_ON = 0.12
const FACE_FADE: [number, number] = [0.12, 0.3]
const SCREEN_MARGIN_PX = 30
const FADE_MS = 280
/** active place rest */
const REST_MAX_KM = 1500
const REST_PX = 34
const REST_BACK_PX = 70
const REST_EASE_S = 1.4
const REST_DEPART_K = 1.15
/** bob */
const ROLL = 2.6 * DEG
const PITCH = 1.4 * DEG
const ROLL_S = 5.3
const PITCH_S = 3.9
/** stance (as Monuments) */
const MIN_VIEW_ANGLE = 55 * DEG
const UPRIGHT = 0.8
const VIEW_ELEV = 32 * DEG
const COS_E = Math.cos(VIEW_ELEV)
const SIN_E = Math.sin(VIEW_ELEV)
const UPRIGHT_KM: [number, number] = [1800, 3600]
const LIFT_H = 1.2
const LIFT_CLOSE_H = 0.1

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ships') === '0'
const smooth = THREE.MathUtils.smoothstep

interface ShipLeg {
  from: number
  a: THREE.Vector3
  b: THREE.Vector3
  axis: THREE.Vector3 // normalize(a x b): the tangent at p is axis x p
  angle: number
  km: number
  n: number // samples - 1
  water: Uint8Array // per sample (n + 1), 1 = sea
}

interface Ship {
  leg: number
  t0: number
  t1: number
  km: number
  dur: number
  u: number
  vis: number
  /** run index (stable priority tiebreak, seed) */
  id: number
  phase: number
  // per frame
  t: number
  ok: boolean
  x: number
  y: number
  water: boolean
}

function dirOfLoc(i: number, out: THREE.Vector3) {
  const l = locations[i]
  const la = l.lat * DEG
  const lo = l.lon * DEG
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo))
}

/** point at parameter t of a leg */
function legPoint(L: ShipLeg, t: number, out: THREE.Vector3) {
  const s = Math.sin(L.angle)
  if (s < 1e-6) return out.copy(L.a).lerp(L.b, t).normalize()
  const wa = Math.sin((1 - t) * L.angle) / s
  const wb = Math.sin(t * L.angle) / s
  return out.set(L.a.x * wa + L.b.x * wb, L.a.y * wa + L.b.y * wb, L.a.z * wa + L.b.z * wb).normalize()
}

function buildLegs(): ShipLeg[] {
  const legs: ShipLeg[] = []
  for (let i = 0; i + 1 < locations.length; i++) {
    const a = dirOfLoc(i, new THREE.Vector3())
    const b = dirOfLoc(i + 1, new THREE.Vector3())
    const angle = Math.acos(Math.max(-1, Math.min(1, a.dot(b))))
    if (angle < 1e-5) continue
    const km = angle * EARTH_KM
    const axis = new THREE.Vector3().crossVectors(a, b)
    if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0)
    axis.normalize()
    legs.push({ from: i, a, b, axis, angle, km, n: Math.max(1, Math.ceil(km / SAMPLE_KM)), water: new Uint8Array(0) })
  }
  return legs
}

/** Sea runs of every leg (needs the CPU height grid). */
function buildRuns(legs: ShipLeg[]): Ship[] {
  const ships: Ship[] = []
  const p = new THREE.Vector3()
  legs.forEach((L, li) => {
    L.water = new Uint8Array(L.n + 1)
    for (let j = 0; j <= L.n; j++) L.water[j] = isLandDir(legPoint(L, j / L.n, p)) ? 0 : 1
    let j = 0
    while (j <= L.n) {
      if (!L.water[j]) {
        j++
        continue
      }
      const j0 = j
      while (j <= L.n && L.water[j]) j++
      const j1 = j - 1
      const t0 = j0 / L.n
      const t1 = j1 / L.n
      const km = (t1 - t0) * L.km
      if (km < MIN_RUN_KM) continue
      const id = ships.length
      const dur = DUR_S[0] + (DUR_S[1] - DUR_S[0]) * smooth(km, DUR_KM[0], DUR_KM[1])
      // deterministic spread of the ships along their runs (golden-ratio sequence)
      const u = (id * 0.6180339887 + 0.23) % 1
      ships.push({ leg: li, t0, t1, km, dur, u, vis: 0, id, phase: (id * 2.39996) % (Math.PI * 2), t: 0, ok: false, x: 0, y: 0, water: false })
    }
  })
  return ships
}

const envelope = (u: number) => smooth(u, 0, ENVELOPE) * (1 - smooth(u, 1 - ENVELOPE, 1))

export function Ships({ tier, reducedMotion }: { tier: Tier; reducedMotion: boolean }) {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const parts = useMemo(() => {
    const ship = buildCaravel()
    const material = makeShipMaterial()
    const g = new THREE.BufferGeometry()
    for (const [n, at] of Object.entries(ship.geometry.attributes)) g.setAttribute(n, at as THREE.BufferAttribute)
    // the theme guard, as every monument form: no gilt or vermilion faces
    g.setAttribute('aCol', guardThemeColours(ship.geometry.getAttribute('aCol') as THREE.BufferAttribute).attr)
    g.setIndex(ship.geometry.index)
    const attrs = attachShipAttributes(g, CAPACITY)
    const mesh = new THREE.InstancedMesh(g, material, CAPACITY)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.raycast = () => {}
    mesh.renderOrder = 18.5
    mesh.visible = false
    mesh.count = 0
    mesh.name = 'ships'
    const legs = buildLegs()
    const legByFrom = new Int32Array(Math.max(1, locations.length)).fill(-1)
    legs.forEach((L, i) => (legByFrom[L.from] = i))
    const anchor = { place: -1, leg: -1, t: 0, tRest: 0, has: false, vis: 0, x: 0, y: 0, water: false, ok: false, phase: 1.3 }
    return {
      ship, material, mesh, attrs, legs, legByFrom, ships: [] as Ship[], anchor, ready: 0, clock: 0, ctx: new CameraContext(),
      stats: { drawn: 0, runs: 0, cpuMs: 0, px: 0 },
      restWhy: { legs: 0, route: 0, place: 0, pin: 0, land: 0 },
    }
  }, [])

  useEffect(() => {
    registerDebug('ships', () => {
      const { ships, legs, anchor, stats } = parts
      const list = ships
        .filter((s) => s.vis > 0.01)
        .map((s) => ({ from: legs[s.leg].from, t: +s.t.toFixed(4), u: +s.u.toFixed(3), vis: +s.vis.toFixed(2), x: Math.round(s.x), y: Math.round(s.y), water: s.water }))
      if (anchor.vis > 0.01) list.unshift({ from: legs[anchor.leg]?.from ?? -1, t: +anchor.t.toFixed(4), u: -1, vis: +anchor.vis.toFixed(2), x: Math.round(anchor.x), y: Math.round(anchor.y), water: anchor.water })
      return {
        tier, runs: ships.length, drawn: stats.drawn, px: +stats.px.toFixed(1), cpuMs: +stats.cpuMs.toFixed(3), tris: parts.ship.tris,
        activeIndex: globeState.anchors.activeIndex,
        restScan: { ...parts.restWhy },
        anchor: anchor.has ? { place: anchor.place, legFrom: legs[anchor.leg]?.from, t: +anchor.t.toFixed(4), tRest: +anchor.tRest.toFixed(4) } : null,
        ships: list,
      }
    })
    registerDebug('shipBench', (n = 60) => {
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const run = () => {
        gl.render(scene, camera)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      const was = parts.mesh.visible
      const time = (on: boolean, k: number) => {
        parts.mesh.visible = on && was
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
      parts.mesh.visible = was
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]
      return {
        msWith: +med(on).toFixed(3), msWithout: +med(off).toFixed(3), shipMs: +med(on.map((v, i) => v - off[i])).toFixed(3),
        shipCalls: calls - callsOff, shipTriangles: tris - trisOff, cpuMs: +parts.stats.cpuMs.toFixed(3), drawn: parts.stats.drawn,
      }
    })
  }, [parts, gl, scene, camera, tier])

  useEffect(
    () => () => {
      parts.mesh.geometry.dispose()
      parts.mesh.dispose()
      parts.material.dispose()
    },
    [parts],
  )

  const tmp = useMemo(
    () => ({
      p: new THREE.Vector3(), q: new THREE.Vector3(), U: new THREE.Vector3(), T: new THREE.Vector3(), S: new THREE.Vector3(), base: new THREE.Vector3(),
      F: new THREE.Vector3(), X: new THREE.Vector3(), U2: new THREE.Vector3(), H: new THREE.Vector3(), Z: new THREE.Vector3(),
      v: new THREE.Vector3(), toCam: new THREE.Vector3(), vUp: new THREE.Vector3(), m: new THREE.Matrix4(),
      scr: [0, 0] as [number, number], placed: [] as number[], order: [] as number[],
    }),
    [],
  )

  useFrame((_, rawDt) => {
    const g = globeState
    const inner = sceneRefs.inner
    const { mesh, attrs, legs, legByFrom, anchor, ctx, stats, material, ship } = parts
    const dt = Math.min(rawDt, 0.1)
    const surface = g.surfaceReady && (g.stage === 'B' || g.stage === 'C' || g.stage === 'D')
    const gridReady = heightGridReady()
    if (gridReady && !parts.ships.length && legs.length) {
      parts.ships = buildRuns(legs)
      stats.runs = parts.ships.length
    }
    const ships = parts.ships
    const readyT = !disabled && tier !== 'low' && surface && gridReady && drawnRoute.drawn ? 1 : 0
    parts.ready = reducedMotion ? readyT : readyT > parts.ready ? Math.min(1, parts.ready + dt / 0.4) : Math.max(0, parts.ready - dt / 0.4)
    // the work / contact plates dim the globe: the ships leave with the dim, and with the route
    const fade = parts.ready * (1 - smooth(g.dim, 0.12, 0.35)) * smooth(drawnRoute.opacity, 0.05, 0.3)
    if (!inner || !ships.length || (fade <= 0 && anchor.vis <= 0.001 && !ships.some((s) => s.vis > 0.001))) {
      mesh.visible = false
      mesh.count = 0
      stats.drawn = 0
      for (const s of ships) s.vis = 0
      anchor.vis = 0
      return
    }
    const t0perf = performance.now()
    ctx.update(camera, inner, size.width, size.height)
    const lod = g.lod
    const phone = g.isPhone || isCoarsePointer()
    const range = phone ? SIZE_PX_PHONE : SIZE_PX
    const globeK = THREE.MathUtils.clamp(g.radiusPx / (phone ? REF_R_PHONE : REF_R), GLOBE_K_MIN, 1)
    const px = (range[0] + (range[1] - range[0]) * (1 - smooth(lod.viewKm, SIZE_KM[1], SIZE_KM[0]))) * globeK
    stats.px = px
    const budget = phone ? MAX_SHIPS_PHONE : MAX_SHIPS
    const running = !reducedMotion && !(typeof document !== 'undefined' && document.hidden)
    if (running) parts.clock += dt
    const fadeK = reducedMotion ? 1 : 1 - Math.exp((-dt * 1000) / FADE_MS)
    const { p, q, T, S, scr } = tmp
    const pxPerKm = Math.max(1e-6, lod.pxPerKm)

    /** the route-drawn strength at parameter t of a leg */
    const routeAt = (li: number, t: number) => {
      const dl = drawnRoute.legs[li]
      return dl && dl.from === legs[li].from ? routeFadeAt(dl, t) : 0
    }
    /**
     * The ship's whole image over water: the hull's length (with a look-ahead off the bow
     * while sailing) and beam, and the ground under the masts and sails, which stand up the
     * screen from the hull (the upright token covers the ground screen-up of its base)
     */
    const U = tmp.U
    const overWater = (pt: THREE.Vector3, Tt: THREE.Vector3, lenRad: number, ahead: boolean) => {
      S.crossVectors(pt, Tt).normalize()
      U.copy(ctx.camUpLocal).addScaledVector(pt, -ctx.camUpLocal.dot(pt))
      if (U.lengthSq() < 1e-9) U.copy(S)
      U.normalize()
      for (const s of ahead ? [-0.55, -0.25, 0, 0.3, 0.6, 0.9] : [-0.5, -0.25, 0, 0.25, 0.5]) {
        q.copy(pt).addScaledVector(Tt, s * lenRad).normalize()
        if (isLandDir(q)) return false
      }
      for (const s of [-0.2, 0.2]) {
        q.copy(pt).addScaledVector(S, s * lenRad).normalize()
        if (isLandDir(q)) return false
      }
      for (const up of [0.35, 0.75])
        for (const s of [-0.35, 0, 0.35]) {
          q.copy(pt).addScaledVector(U, up * lenRad).addScaledVector(Tt, s * lenRad).normalize()
          if (isLandDir(q)) return false
        }
      return true
    }
    const bodyWater = (pt: THREE.Vector3, Tt: THREE.Vector3, lenRad: number) => overWater(pt, Tt, lenRad, true)
    /** position and tangent at t on leg L; facing, screen; returns false when not drawable here */
    const place = (L: ShipLeg, t: number, out: { x: number; y: number }) => {
      legPoint(L, t, p)
      T.crossVectors(L.axis, p).normalize()
      if (ctx.facing(p, p) < FACING_ON) return false
      if (!ctx.project(p, scr)) return false
      out.x = scr[0]
      out.y = scr[1]
      return !(scr[0] < -SCREEN_MARGIN_PX || scr[1] < -SCREEN_MARGIN_PX || scr[0] > size.width + SCREEN_MARGIN_PX || scr[1] > size.height + SCREEN_MARGIN_PX)
    }
    const lenRadAt = (pt: THREE.Vector3) => px / Math.max(1e-6, ctx.pxPerUnit(pt))

    const placed = tmp.placed
    placed.length = 0
    const sep = Math.max(SEP_MIN_PX, SEP_K * px)
    const clear = (x: number, y: number) => {
      for (let i = 0; i < placed.length; i += 2) if (Math.hypot(placed[i] - x, placed[i + 1] - y) < sep) return false
      return true
    }
    // the ship's screen box (upright token: base at y, masts up to ~0.95 px above)
    const pinsPx = g.pinsPx
    const obstacleFree = (x: number, y: number, skipPin: number) => {
      const x0 = x - 0.55 * px, x1 = x + 0.55 * px, y0 = y - px, y1 = y + 0.2 * px
      // deep zoom: inside the neatline's paint
      if (neatGuard.on && (x0 < neatGuard.x0 || x1 > neatGuard.x1 || y0 < neatGuard.y0 || y1 > neatGuard.y1)) return false
      // off the drawn monuments
      const mb = monumentBoxes
      for (let i = 0; i + 3 < mb.length; i += 4) if (x1 > mb[i] - 2 && x0 < mb[i + 2] + 2 && y1 > mb[i + 1] - 2 && y0 < mb[i + 3] + 2) return false
      // off the visible pins (a pin and a gap)
      for (let i = 0; i + 3 < pinsPx.length; i += 4) {
        if (pinsPx[i + 2] < 0.35 || i >> 2 === skipPin) continue
        const dx = Math.max(x0 - pinsPx[i], 0, pinsPx[i] - x1)
        const dy = Math.max(y0 - pinsPx[i + 1], 0, pinsPx[i + 1] - y1)
        if (dx * dx + dy * dy < 64) return false
      }
      return true
    }

    /** at rest: no look-ahead */
    const hullWater = (pt: THREE.Vector3, Tt: THREE.Vector3, lenRad: number) => overWater(pt, Tt, lenRad, false)
    const restWhy = parts.restWhy
    restWhy.route = restWhy.place = restWhy.pin = restWhy.land = restWhy.legs = 0

    // ——— the active place's resting ship ———
    const ai = g.anchors.activeIndex
    let restLeg = -1
    let restT = 0
    if (ai >= 0 && fade > 0) {
      const pin = g.pinsPx
      const pinX = pin[ai * 4], pinY = pin[ai * 4 + 1]
      let bestKm = Infinity
      for (const [li, arriving] of [[legByFrom[ai - 1] ?? -1, true], [legByFrom[ai] ?? -1, false]] as [number, boolean][]) {
        if (li < 0) continue
        restWhy.legs++
        const L = legs[li]
        const maxJ = Math.min(L.n, Math.ceil(REST_MAX_KM / SAMPLE_KM))
        for (let k = 1; k <= maxJ; k++) {
          const j = arriving ? L.n - k : k
          if (!L.water[j]) continue
          const km = k * (L.km / L.n) * (arriving ? 1 : REST_DEPART_K)
          if (km >= bestKm) break
          const t = j / L.n
          if (routeAt(li, t) < ROUTE_ON) {
            restWhy.route++
            continue
          }
          const o = { x: 0, y: 0 }
          if (!place(L, t, o)) {
            restWhy.place++
            continue
          }
          if (Math.hypot(o.x - pinX, o.y - pinY) < REST_PX || !obstacleFree(o.x, o.y, -1)) {
            restWhy.pin++
            continue
          }
          if (!hullWater(p, T, lenRadAt(p))) {
            restWhy.land++
            continue
          }
          bestKm = km
          restLeg = li
          restT = t
          break
        }
      }
    }
    if (ai !== anchor.place) {
      anchor.place = ai
      anchor.has = false
    }
    if (restLeg >= 0) {
      const L = legs[restLeg]
      if (!anchor.has || anchor.leg !== restLeg) {
        // fade in a little astern of the rest point and sail up to it
        anchor.has = true
        anchor.leg = restLeg
        anchor.vis = 0
        const backT = reducedMotion ? 0 : REST_BACK_PX / Math.max(1e-6, L.km * pxPerKm)
        anchor.t = Math.max(0, restT - backT)
      }
      anchor.tRest = restT
      anchor.t = reducedMotion ? restT : anchor.t + (restT - anchor.t) * (1 - Math.exp(-dt / (REST_EASE_S / 3)))
    } else if (anchor.has && anchor.vis <= 0.001) {
      anchor.has = false
    }
    let target = 0
    if (anchor.has) {
      const L = legs[anchor.leg]
      const o = { x: 0, y: 0 }
      anchor.ok = place(L, anchor.t, o)
      anchor.x = o.x
      anchor.y = o.y
      anchor.water = anchor.ok && hullWater(p, T, lenRadAt(p))
      if (anchor.ok && anchor.water && restLeg >= 0 && routeAt(anchor.leg, anchor.t) >= ROUTE_ON) {
        target = 1
        placed.push(o.x, o.y)
      }
    }
    anchor.vis = reducedMotion ? target : anchor.vis + (target - anchor.vis) * fadeK
    const nAnchor = target > 0 ? 1 : 0

    // ——— sailing ships: advance, then admit by priority within the budget ———
    const order = tmp.order
    order.length = 0
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i]
      if (running) {
        const sp = ((s.km / s.dur) * pxPerKm) / MAX_SPEED_PX
        s.u = (s.u + (dt / s.dur) / Math.max(1, sp)) % 1
      }
      const u = reducedMotion ? 0.5 : s.u
      s.t = s.t0 + (s.t1 - s.t0) * u
      order.push(i)
    }
    const pri = (s: Ship) => {
      const dl = drawnRoute.legs[s.leg]
      return (dl?.active ? 1e6 : 0) + (s.vis > 0.5 ? 5e5 : 0) + s.km
    }
    order.sort((a, b) => pri(ships[b]) - pri(ships[a]) || a - b)
    let n = nAnchor
    for (const i of order) {
      const s = ships[i]
      s.ok = false
      s.water = false
      let want = 0
      if (n < budget && fade > 0 && routeAt(s.leg, s.t) >= ROUTE_ON && (reducedMotion || envelope(s.u) > 0.02)) {
        const o = { x: 0, y: 0 }
        if (place(legs[s.leg], s.t, o)) {
          s.x = o.x
          s.y = o.y
          s.ok = true
          s.water = bodyWater(p, T, lenRadAt(p))
          if (s.water && clear(o.x, o.y) && obstacleFree(o.x, o.y, -1)) {
            want = 1
            placed.push(o.x, o.y)
            n++
          }
        }
      }
      s.vis = reducedMotion ? want : s.vis + (want - s.vis) * fadeK
      if (s.vis < 0.002) s.vis = 0
    }

    // ——— instances ———
    const { base, F, X, U2, H, Z, v, toCam, vUp, m } = tmp
    const wideView = smooth(lod.viewKm, UPRIGHT_KM[0], UPRIGHT_KM[1])
    const upright = UPRIGHT * wideView
    const lift = LIFT_CLOSE_H + (LIFT_H - LIFT_CLOSE_H) * wideView
    let count = 0
    const emit = (li: number, t: number, alpha: number, phase: number) => {
      if (alpha < 0.004 || count >= CAPACITY) return
      const L = legs[li]
      legPoint(L, t, p)
      T.crossVectors(L.axis, p).normalize()
      const facing = ctx.facing(p, p)
      const a = alpha * smooth(facing, FACE_FADE[0], FACE_FADE[1]) * fade * smooth(routeAt(li, t), 0.2, 0.6)
      if (a < 0.004) return
      const ppu = ctx.pxPerUnit(p)
      const kk = px / Math.max(1e-6, ppu) // model length 1 = px
      const r = 1 + Math.max(0, groundM(p)) * lod.heightScale
      base.copy(p).multiplyScalar(r)
      // ground frame: F toward the viewer on the ground, X screen-right
      F.copy(ctx.camUpLocal).addScaledVector(p, -ctx.camUpLocal.dot(p))
      if (F.lengthSq() < 1e-9) F.set(1, 0, 0).addScaledVector(p, -p.x)
      F.normalize().negate()
      v.copy(ctx.camLocal).sub(base).normalize()
      const theta = Math.acos(Math.min(1, Math.max(-1, v.dot(p))))
      const lean = Math.max(0, MIN_VIEW_ANGLE - theta)
      U2.copy(p).multiplyScalar(Math.cos(lean)).addScaledVector(F, -Math.sin(lean))
      if (upright > 0) {
        toCam.copy(ctx.camLocal).sub(base).normalize()
        vUp.copy(ctx.camUpLocal).addScaledVector(toCam, -ctx.camUpLocal.dot(toCam)).normalize()
        vUp.multiplyScalar(COS_E).addScaledVector(toCam, SIN_E)
        U2.multiplyScalar(1 - upright).addScaledVector(vUp, upright).normalize()
      }
      // heading: the great circle's tangent in the plane the ship stands on
      H.copy(T).addScaledVector(U2, -T.dot(U2))
      if (H.lengthSq() < 1e-8) H.copy(X.crossVectors(U2, F))
      H.normalize()
      // bob: roll about the heading, pitch about the beam (paused with the clock)
      const tc = reducedMotion ? 0 : parts.clock
      const roll = reducedMotion ? 0 : ROLL * Math.sin((2 * Math.PI * tc) / ROLL_S + phase)
      const pitch = reducedMotion ? 0 : PITCH * Math.sin((2 * Math.PI * tc) / PITCH_S + phase * 1.7)
      Z.crossVectors(H, U2).normalize()
      U2.multiplyScalar(Math.cos(roll)).addScaledVector(Z, Math.sin(roll)).normalize()
      Z.crossVectors(H, U2).normalize()
      X.copy(H)
      H.multiplyScalar(Math.cos(pitch)).addScaledVector(U2, Math.sin(pitch)).normalize()
      U2.multiplyScalar(Math.cos(pitch)).addScaledVector(X, -Math.sin(pitch)).normalize()
      // sit at the waterline
      base.addScaledVector(U2, -ship.waterline * kk)
      m.set(
        H.x * kk, U2.x * kk, Z.x * kk, base.x,
        H.y * kk, U2.y * kk, Z.y * kk, base.y,
        H.z * kk, U2.z * kk, Z.z * kk, base.z,
        0, 0, 0, 1,
      )
      const j = count++
      mesh.setMatrixAt(j, m)
      attrs.iVar.setX(j, 0)
      attrs.iDim.setX(j, 0)
      attrs.iUp.setXYZ(j, p.x, p.y, p.z)
      attrs.iLift.setX(j, lift)
      attrs.iAlpha.setX(j, a)
    }
    if (anchor.has) emit(anchor.leg, anchor.t, anchor.vis, anchor.phase)
    for (const s of ships) if (s.vis > 0) emit(s.leg, s.t, s.vis * (reducedMotion ? 1 : envelope(s.u)), s.phase)
    mesh.count = count
    mesh.visible = count > 0
    if (count > 0) {
      mesh.instanceMatrix.needsUpdate = true
      attrs.iVar.needsUpdate = true
      attrs.iDim.needsUpdate = true
      attrs.iUp.needsUpdate = true
      attrs.iLift.needsUpdate = true
      attrs.iAlpha.needsUpdate = true
    }
    material.uniforms.uViewport.value.set(size.width, size.height)
    material.uniforms.uPxRatio.value = gl.getPixelRatio()
    material.uniforms.uDim.value = g.dim
    stats.drawn = count
    stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0perf) * 0.1
  })

  if (tier === 'low' || disabled || locations.length < 2) return null
  return <primitive object={parts.mesh} />
}

export default Ships
