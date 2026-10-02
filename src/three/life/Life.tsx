/**
 * Life on the map (EU4-style atmospheric touches, restrained). Mid/high tiers only (null on
 * low); lazy chunk; ONE instanced quad mesh (life/material.ts), one draw call, <= 48
 * instances placed on the CPU each frame.
 *
 *  - VOLCANO SMOKE at the landmarks that are volcanoes (Vesuvius, Fuji, Teide, Agung, El
 *    Misti; there is no Etna landmark): six soft puffs are born in the crater, swell, lean a
 *    little downwind (screen right) and thin out over an 8 s cycle each (a new puff every
 *    1.33 s). The summit is the drawn 3D form's top (landmarkFrame.monumentTop) while the
 *    monument is drawn, else the 2D glyph's peak (its pin-clearance shift included), else the
 *    highest drawn relief at the site (exaggerated terrain included). Plume 22 px tall at
 *    3000 km, 30 at 1500, 40 at <= 600 (phones x0.8); fades in 3600 -> 3000 km. Smoke and mist
 *    are drawn only while their source sits inside the globe's free area (never on the travel
 *    column or the phone sheet; inside the deep-zoom neatline).
 *  - WATERFALL MIST at Iguazu, Victoria and Niagara: a steady spray puff at the foot of the
 *    falls with three slower puffs breathing up out of it (10 s), and a faint three-band bow
 *    (muted rose / sage / pale blue) behind; 30 -> 46 px wide from 1500 to 600 km; fades in
 *    1800 -> 1500 km.
 *  - CLOUD WISPS: flat painted wisps (EU4 map clouds) lying on a shell above the relief,
 *    seeded on a Fibonacci lattice (|lat| < 64) and drifting very slowly (east in the
 *    westerlies, west in the trade-wind belt; ~0.5 px/s at 4000 km). Only in the mid band:
 *    in 6200 -> 5000 km, out 2000 -> 1500 km (the hero globe and close zoom stay clean). A
 *    wisp shows only while its whole painted extent keeps off the pins (the active place by a
 *    wide margin), the place and region names, the monuments, glyphs and towns, the readout,
 *    and stays inside the globe's free area (never over the travel column; inside the
 *    deep-zoom neatline); greedy, incumbents first, at most 4 (phones 2); each fades in / out
 *    over 1.6 s as it drifts clear of / onto something. Horizon-faded (facing 0.25 -> 0.45).
 * All: faded with the travel section (travelIn 0.35 -> 0.5) and the section dim, so none in
 * the hero, work or contact; horizon-faded; depth-tested, never depth-writing (billboards
 * take their anchor's depth, slid toward the eye along the view ray so they sit in front of
 * their own summit; clouds are real geometry above the relief). One clock drives all motion;
 * it stops while the tab is hidden and under prefers-reduced-motion (the plumes and mist then
 * stand as a still, evenly spread image; the clouds hold still and switch without fades).
 * renderOrder 17.5: under the towns (18), glyphs (18), ships (18.5), names (19+) and pins (30).
 *
 * Debug (?debug=1): __globe.life() → drawn instances, anchors and clouds (with why a cloud is
 * held back); __globe.lifeBench(n) → ms/frame with and without the layer; __globe.lifeClock(s)
 * sets the clock (s) for repeatable frames; __globe.lifeDepth(on) toggles the depth test (occlusion
 * checks); ?life=0 disables.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Tier } from '../globeState'
import { globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { registerDebug } from '../debugHooks'
import { LIFT, EARTH_KM } from '../geo/radii'
import { LANDMARKS } from '../../data/landmarks'
import { instrumentLayout } from '../instrument/anchors'
import { GLYPH_BOX_PX, glyphBoxes, mapLabelRects, monumentFootprints, neatGuard, readoutBox, townBoxes } from '../instrument/screenObstacles'
import { placeRects } from '../labels/declutter'
import {
  CameraContext, dirOf, glyphShiftPx, glyphShown, groundMaxM, isCoarsePointer, landmarkInfos, monumentBase, monumentShown, monumentTop,
} from '../monuments/landmarkFrame'
import { makeLifeGeometry, makeLifeMaterial } from './material'

const DEG = Math.PI / 180
const VOLCANO_IDS = ['mount-vesuvius', 'mount-fuji', 'mount-teide', 'mount-agung', 'el-misti']
const FALLS_IDS = ['iguazu-falls', 'victoria-falls', 'niagara-falls']
const PHONE_K = 0.8

// smoke
const PUFFS = 6
const SMOKE_PERIOD_S = 8
const SMOKE_KM = [3000, 1500, 600]
const SMOKE_H_PX = [22, 30, 40]
const SMOKE_SHOW: [number, number] = [3000, 3600] // full below, none above
const PULL_PX = 24
/** the mountain glyph's peak above its anchor (glyphPaths: apex at (40, 10) of 64; quad centre 17 px up) */
const GLYPH_PEAK: [number, number] = [((40 - 32) / 64) * GLYPH_BOX_PX, 17 + GLYPH_BOX_PX / 2 - (10 / 64) * GLYPH_BOX_PX]
/** over the waterfall glyph the spray sits at its foot */
const GLYPH_POOL: [number, number] = [0, 4]

// mist
const MIST_PUFFS = 3
const MIST_PERIOD_S = 10
const MIST_KM = [1500, 600]
const MIST_W_PX = [30, 46]
const MIST_SHOW: [number, number] = [1500, 1800]
const BOW_ALPHA = 0.3

// clouds
const CLOUD_SEEDS = 120
const CLOUD_MAX_LAT = 64
const CLOUD_MAX = 4
const CLOUD_MAX_PHONE = 2
const CLOUD_IN: [number, number] = [5000, 6200] // full below 5000, none above 6200
const CLOUD_OUT: [number, number] = [1500, 2000] // none below 1500, full above 2000
const CLOUD_LEN_KM: [number, number] = [380, 720]
const CLOUD_ASPECT: [number, number] = [0.3, 0.42]
const CLOUD_ALT = 0.0025 // radius units above the drawn relief (~16 km)
const DRIFT_DEG_S = 0.022
const TRADE_LAT = 26
const CLOUD_FADE_MS = 1600
const CLOUD_FACE: [number, number] = [0.25, 0.45]
const PIN_CLEAR_PX = 10
const ACTIVE_CLEAR_PX = 70
const OBST_GAP_PX = 6
const FREE_INSET_PX = 12

const CAPACITY = VOLCANO_IDS.length * PUFFS + FALLS_IDS.length * (MIST_PUFFS + 2) + CLOUD_MAX

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('life') === '0'
const smooth = THREE.MathUtils.smoothstep

/** log-interpolated px over a descending viewKm table */
function sizeAt(viewKm: number, km: number[], px: number[]): number {
  if (viewKm >= km[0]) return px[0]
  if (viewKm <= km[km.length - 1]) return px[px.length - 1]
  const lv = Math.log(viewKm)
  for (let i = 0; i + 1 < km.length; i++) {
    const a = Math.log(km[i]), b = Math.log(km[i + 1])
    if (lv <= a && lv >= b) return px[i] + ((px[i + 1] - px[i]) * (a - lv)) / (a - b)
  }
  return px[px.length - 1]
}

function fract(x: number): number {
  return x - Math.floor(x)
}

interface Site {
  index: number
  id: string
  dir: THREE.Vector3
  seed: number
}

interface Cloud {
  lat: number
  lon0: number
  lenRad: number
  aspect: number
  rot: number
  seed: number
  drift: number
  // state
  vis: number
  target: number
  why: string
  // per frame
  dir: THREE.Vector3
  x: number
  y: number
  hx: number
  hy: number
}

export function Life({ tier, reducedMotion }: { tier: Tier; reducedMotion: boolean }) {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const parts = useMemo(() => {
    const infos = landmarkInfos()
    const site = (id: string, k: number): Site | null => {
      const index = LANDMARKS.findIndex((l) => l.id === id)
      return index < 0 ? null : { index, id, dir: infos[index].dir, seed: fract(0.618 * (index + 1) + 0.13 * k) }
    }
    const volcanoes = VOLCANO_IDS.map(site).filter((s): s is Site => !!s)
    const falls = FALLS_IDS.map(site).filter((s): s is Site => !!s)
    // cloud seeds: a Fibonacci lattice, deterministic shapes
    const clouds: Cloud[] = []
    const ga = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < CLOUD_SEEDS; i++) {
      const y = 1 - (2 * (i + 0.5)) / CLOUD_SEEDS
      const lat = Math.asin(y) / DEG
      if (Math.abs(lat) > CLOUD_MAX_LAT) continue
      const h = fract(Math.sin(i * 12.9898 + 78.233) * 43758.5453)
      const h2 = fract(h * 91.7 + 0.31)
      const h3 = fract(h * 37.3 + 0.77)
      clouds.push({
        lat, lon0: ((i * ga) / DEG) % 360,
        lenRad: (CLOUD_LEN_KM[0] + (CLOUD_LEN_KM[1] - CLOUD_LEN_KM[0]) * h) / EARTH_KM,
        aspect: CLOUD_ASPECT[0] + (CLOUD_ASPECT[1] - CLOUD_ASPECT[0]) * h2,
        rot: (h3 - 0.5) * 0.5,
        seed: fract(h * 7.31 + i * 0.137) * 10,
        drift: (Math.abs(lat) < TRADE_LAT ? -0.7 : 1) * (0.8 + 0.4 * h2) * DRIFT_DEG_S,
        vis: 0, target: 0, why: '', dir: new THREE.Vector3(), x: 0, y: 0, hx: 0, hy: 0,
      })
    }
    const geo = makeLifeGeometry(CAPACITY)
    const material = makeLifeMaterial()
    const mesh = new THREE.Mesh(geo.geometry, material)
    mesh.frustumCulled = false
    mesh.raycast = () => {}
    mesh.renderOrder = 17.5
    mesh.visible = false
    mesh.name = 'life'
    return {
      volcanoes, falls, clouds, geo, material, mesh, ctx: new CameraContext(), clock: 0, ready: 0, n: 0,
      cand: [] as number[], placed: [] as number[],
      stats: { smoke: 0, mist: 0, clouds: 0, instances: 0, cpuMs: 0, running: false },
      anchors: {} as Record<string, { x: number; y: number; a: number; src: string; px: number }>,
    }
  }, [])

  useEffect(() => {
    registerDebug('life', () => {
      const { stats, clouds, anchors } = parts
      return {
        tier, clock: +parts.clock.toFixed(2), ...stats, cpuMs: +stats.cpuMs.toFixed(3), anchors,
        clouds: clouds
          .filter((c) => c.vis > 0.01 || c.why)
          .map((c) => ({ lat: +c.lat.toFixed(1), x: Math.round(c.x), y: Math.round(c.y), hx: Math.round(c.hx), hy: Math.round(c.hy), vis: +c.vis.toFixed(2), why: c.why })),
      }
    })
    registerDebug('lifeDepth', (on: boolean) => {
      parts.material.depthTest = on
      return on
    })
    registerDebug('lifeClock', (s: number) => {
      parts.clock = s
      return parts.clock
    })
    registerDebug('lifeBench', (n = 60) => {
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
      let calls = 0, callsOff = 0
      for (let r = 0; r < rounds; r++) {
        on.push(time(true, k))
        calls = gl.info.render.calls
        off.push(time(false, k))
        callsOff = gl.info.render.calls
      }
      parts.mesh.visible = was
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]
      return {
        msWith: +med(on).toFixed(3), msWithout: +med(off).toFixed(3), lifeMs: +med(on.map((v, i) => v - off[i])).toFixed(3),
        lifeCalls: calls - callsOff, instances: parts.n, cpuMs: +parts.stats.cpuMs.toFixed(3),
      }
    })
  }, [parts, gl, scene, camera, tier])

  useEffect(
    () => () => {
      parts.geo.geometry.dispose()
      parts.material.dispose()
    },
    [parts],
  )

  const tmp = useMemo(
    () => ({
      A: new THREE.Vector3(), B: new THREE.Vector3(), toCam: new THREE.Vector3(), E: new THREE.Vector3(), N: new THREE.Vector3(),
      P: new THREE.Vector3(), scr: [0, 0] as [number, number], scr2: [0, 0] as [number, number], box: [0, 0, 0, 0],
    }),
    [],
  )

  useFrame((_, rawDt) => {
    const g = globeState
    const lod = g.lod
    const inner = sceneRefs.inner
    const p = parts
    const { mesh, geo, ctx, stats } = p
    const dt = Math.max(0, Math.min(rawDt, 0.1))
    const running = !reducedMotion && !(typeof document !== 'undefined' && document.hidden)
    stats.running = running
    if (running) p.clock += dt
    const surface = g.surfaceReady && (g.stage === 'B' || g.stage === 'C' || g.stage === 'D')
    const readyT = !disabled && tier !== 'low' && surface ? 1 : 0
    p.ready = reducedMotion ? readyT : readyT > p.ready ? Math.min(readyT, p.ready + dt / 0.4) : Math.max(readyT, p.ready - dt / 0.4)
    const section = p.ready * smooth(g.travelIn, 0.35, 0.5) * (1 - smooth(g.dim, 0.12, 0.35))
    const km = lod.viewKm
    const smokeZoom = 1 - smooth(km, SMOKE_SHOW[0], SMOKE_SHOW[1])
    const mistZoom = 1 - smooth(km, MIST_SHOW[0], MIST_SHOW[1])
    const cloudZoom = (1 - smooth(km, CLOUD_IN[0], CLOUD_IN[1])) * smooth(km, CLOUD_OUT[0], CLOUD_OUT[1])
    const anyCloud = p.clouds.some((c) => c.vis > 0.001)
    if (!inner || section <= 0 || (smokeZoom <= 0 && mistZoom <= 0 && cloudZoom <= 0 && !anyCloud)) {
      mesh.visible = false
      geo.geometry.instanceCount = 0
      p.n = 0
      for (const c of p.clouds) {
        c.vis = 0
        c.why = ''
      }
      stats.smoke = stats.mist = stats.clouds = stats.instances = 0
      return
    }
    const t0 = performance.now()
    ctx.update(camera, inner, size.width, size.height)
    const phone = g.isPhone || isCoarsePointer()
    const k = phone ? PHONE_K : 1
    const hs = lod.heightScale
    const { A, B, toCam, E, N, P, scr, scr2, box } = tmp
    const { iPos, iRect, iE, iN, iMeta } = geo
    let n = 0
    const push = (pos: THREE.Vector3, kind: number, alpha: number, seed: number, age: number, ox: number, oy: number, hw: number, hh: number) => {
      if (n >= CAPACITY || alpha < 0.004) return
      iPos.setXYZ(n, pos.x, pos.y, pos.z)
      iRect.setXYZW(n, ox, oy, hw, hh)
      iMeta.setXYZW(n, kind, alpha, seed, age)
      n++
    }
    for (const key in p.anchors) delete p.anchors[key]

    /**
     * The anchor of a landmark's effect (A, globe-local) and its px offset: the drawn 3D
     * form (base -> top at `up`), else the glyph (its offset), else the drawn relief.
     * Returns [ox, oy] in out; false if not facing.
     */
    const anchor = (s: Site, up: number, glyphAt: [number, number], out: [number, number]) => {
      const i = s.index
      const w = smooth(monumentShown[i], 0, 1)
      const gA = glyphShown[i] * (1 - w)
      // the relief (with the glyph's own lift while it is drawn)
      const r = 1 + groundMaxM(s.dir, 0.0015) * hs + LIFT.glyph * Math.min(1, gA * 4)
      A.copy(s.dir).multiplyScalar(r)
      if (w > 0) {
        const o = i * 3
        B.set(monumentBase[o], monumentBase[o + 1], monumentBase[o + 2])
        P.set(monumentTop[o], monumentTop[o + 1], monumentTop[o + 2])
        B.lerp(P, up)
        A.lerp(B, w)
      }
      out[0] = (glyphShiftPx[i] + glyphAt[0]) * gA
      out[1] = glyphAt[1] * gA
      // slide toward the eye along the view ray (same screen point, in front of the summit)
      const ppu = ctx.pxPerUnit(A)
      toCam.copy(ctx.camLocal).sub(A).normalize()
      A.addScaledVector(toCam, PULL_PX / Math.max(1e-6, ppu))
      return { w, gA }
    }
    const off: [number, number] = [0, 0]
    /** the effect's anchor (+ px offset) projects within the viewport, with its own size as margin */
    // (and its source inside the globe's free area: never over the travel column, the phone
    // sheet or the deep-zoom neatline frame)
    const onScreen = (pos: THREE.Vector3, ox: number, oy: number, m: number) => {
      if (!ctx.project(pos, scr)) return false
      const x = scr[0] + ox, y = scr[1] - oy
      const f = instrumentLayout.free
      let x0 = Math.max(0, f.x0) + 0.5 * m, y0 = Math.max(0, f.y0) + m, x1 = Math.min(size.width, f.x1) - 0.5 * m, y1 = Math.min(size.height, f.y1)
      if (neatGuard.on) {
        x0 = Math.max(x0, neatGuard.x0 + 0.5 * m)
        y0 = Math.max(y0, neatGuard.y0 + m)
        x1 = Math.min(x1, neatGuard.x1 - 0.5 * m)
        y1 = Math.min(y1, neatGuard.y1)
      }
      return x > x0 && x < x1 && y > y0 && y < y1
    }

    // ——— clouds (drawn first: under the plumes and the mist) ———
    let nClouds = 0
    if (cloudZoom > 0 || anyCloud) {
      const free = instrumentLayout.free
      const pins = g.pinsPx
      const active = g.anchors.activeIndex
      const maxN = phone ? CLOUD_MAX_PHONE : CLOUD_MAX
      const hits = (b: number[], q: number[], stride: number, gap: number) => {
        for (let j = 0; j + 3 < q.length; j += stride) if (b[2] > q[j] - gap && b[0] < q[j + 2] + gap && b[3] > q[j + 1] - gap && b[1] < q[j + 3] + gap) return true
        return false
      }
      const blockedBy = (b: number[]): string => {
        const fx0 = Math.max(free.x0, 0) + FREE_INSET_PX, fy0 = Math.max(free.y0, 0) + FREE_INSET_PX
        const fx1 = Math.min(free.x1, size.width) - FREE_INSET_PX, fy1 = Math.min(free.y1, size.height) - FREE_INSET_PX
        if (b[0] < fx0 || b[1] < fy0 || b[2] > fx1 || b[3] > fy1) return 'free'
        if (neatGuard.on && (b[0] < neatGuard.x0 || b[1] < neatGuard.y0 || b[2] > neatGuard.x1 || b[3] > neatGuard.y1)) return 'neat'
        for (let j = 0; j + 3 < pins.length; j += 4) {
          if (pins[j + 2] < 0.2) continue
          const m = (j >> 2) === active ? ACTIVE_CLEAR_PX : PIN_CLEAR_PX
          if (pins[j] > b[0] - m && pins[j] < b[2] + m && pins[j + 1] > b[1] - m && pins[j + 1] < b[3] + m) return 'pin'
        }
        if (active >= 0 && g.anchors.activePx) {
          const [ax, ay] = g.anchors.activePx
          if (ax > b[0] - ACTIVE_CLEAR_PX && ax < b[2] + ACTIVE_CLEAR_PX && ay > b[1] - ACTIVE_CLEAR_PX && ay < b[3] + ACTIVE_CLEAR_PX) return 'active'
        }
        for (const r of placeRects) if (b[2] > r.x0 - OBST_GAP_PX && b[0] < r.x1 + OBST_GAP_PX && b[3] > r.y0 - OBST_GAP_PX && b[1] < r.y1 + OBST_GAP_PX) return 'place-name'
        if (hits(b, mapLabelRects, 4, OBST_GAP_PX)) return 'map-name'
        if (hits(b, monumentFootprints, 5, OBST_GAP_PX)) return 'monument'
        if (hits(b, townBoxes, 4, OBST_GAP_PX)) return 'town'
        const h = GLYPH_BOX_PX / 2
        for (let j = 0; j + 1 < glyphBoxes.length; j += 2) {
          if (b[2] > glyphBoxes[j] - h - OBST_GAP_PX && b[0] < glyphBoxes[j] + h + OBST_GAP_PX && b[3] > glyphBoxes[j + 1] - h - OBST_GAP_PX && b[1] < glyphBoxes[j + 1] + h + OBST_GAP_PX) return 'glyph'
        }
        if (readoutBox.on && b[2] > readoutBox.x0 && b[0] < readoutBox.x1 && b[3] > readoutBox.y0 && b[1] < readoutBox.y1) return 'readout'
        return ''
      }
      // pass 1: where each wisp is now (screen box from its projected axes)
      const cand = p.cand
      cand.length = 0
      for (let ci = 0; ci < p.clouds.length; ci++) {
        const c = p.clouds[ci]
        c.why = ''
        const lon = c.lon0 + c.drift * p.clock
        dirOf(c.lat, lon, c.dir)
        const facing = ctx.facing(c.dir, c.dir)
        if (facing < CLOUD_FACE[0] && c.vis <= 0.001) {
          c.target = 0
          continue
        }
        if (!ctx.project(c.dir, scr)) {
          c.target = 0
          c.vis = 0
          continue
        }
        const ppu = ctx.pxPerUnit(c.dir)
        const rough = c.lenRad * ppu * 0.5
        if ((scr[0] < -rough || scr[1] < -rough || scr[0] > size.width + rough || scr[1] > size.height + rough) && c.vis <= 0.001) {
          c.target = 0
          continue
        }
        c.x = scr[0]
        c.y = scr[1]
        // screen half extents of the rotated ellipse
        const la = c.lat * DEG, lo = lon * DEG
        E.set(-Math.sin(lo), 0, -Math.cos(lo))
        N.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo))
        const cr = Math.cos(c.rot), sr = Math.sin(c.rot)
        P.copy(E).multiplyScalar(cr).addScaledVector(N, sr) // along
        N.multiplyScalar(cr).addScaledVector(E, -sr) // across
        E.copy(P)
        const half = c.lenRad * 0.5
        P.copy(c.dir).addScaledVector(E, half)
        ctx.project(P, scr2)
        const axx = scr2[0] - scr[0], axy = scr2[1] - scr[1]
        P.copy(c.dir).addScaledVector(N, half * c.aspect)
        ctx.project(P, scr2)
        const ayx = scr2[0] - scr[0], ayy = scr2[1] - scr[1]
        // the painted extent is ~85% of the quad
        c.hx = 0.85 * Math.hypot(axx, ayx)
        c.hy = 0.85 * Math.hypot(axy, ayy)
        c.target = 0
        if (cloudZoom > 0 && facing >= CLOUD_FACE[0]) cand.push(ci)
      }
      // pass 2: greedy, incumbents first, then lattice order
      cand.sort((a, b) => (p.clouds[b].vis > 0.5 ? 1 : 0) - (p.clouds[a].vis > 0.5 ? 1 : 0) || a - b)
      const placed = p.placed
      placed.length = 0
      for (const ci of cand) {
        const c = p.clouds[ci]
        if (placed.length / 4 >= maxN) {
          c.why = 'budget'
          continue
        }
        box[0] = c.x - c.hx
        box[1] = c.y - c.hy
        box[2] = c.x + c.hx
        box[3] = c.y + c.hy
        const why = blockedBy(box) || (hits(box, placed, 4, 24) ? 'cloud' : '')
        c.why = why
        if (why) continue
        c.target = 1
        placed.push(box[0], box[1], box[2], box[3])
      }
      // pass 3: ease and draw
      const step = reducedMotion ? 1 : (dt * 1000) / CLOUD_FADE_MS
      for (const c of p.clouds) {
        c.vis = reducedMotion ? c.target : c.target > c.vis ? Math.min(1, c.vis + step) : Math.max(0, c.vis - step)
        if (c.vis <= 0.001) continue
        const facing = ctx.facing(c.dir, c.dir)
        const a = c.vis * cloudZoom * section * smooth(facing, CLOUD_FACE[0], CLOUD_FACE[1])
        if (a < 0.004 || n >= CAPACITY) continue
        const lon = c.lon0 + c.drift * p.clock
        const la = c.lat * DEG, lo = lon * DEG
        E.set(-Math.sin(lo), 0, -Math.cos(lo))
        N.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo))
        const cr = Math.cos(c.rot), sr = Math.sin(c.rot)
        P.copy(E).multiplyScalar(cr).addScaledVector(N, sr)
        N.multiplyScalar(cr).addScaledVector(E, -sr)
        E.copy(P)
        const r = 1 + CLOUD_ALT + (hs > 0 ? groundMaxM(c.dir, c.lenRad * 0.5) * hs : 0)
        A.copy(c.dir).multiplyScalar(r)
        const half = c.lenRad * 0.5 * r
        iE.setXYZ(n, E.x * half, E.y * half, E.z * half)
        iN.setXYZ(n, N.x * half * c.aspect, N.y * half * c.aspect, N.z * half * c.aspect)
        push(A, 3, a, c.seed, 0, 0, 0, 0, 0)
        nClouds++
      }
    }

    // ——— waterfall mist (and the bow) ———
    let nMist = 0
    if (mistZoom > 0) {
      const W = sizeAt(km, MIST_KM, MIST_W_PX) * k
      for (const s of p.falls) {
        const facing = ctx.facing(s.dir, s.dir)
        const a = section * mistZoom * smooth(facing, 0.1, 0.3)
        if (a < 0.004) continue
        const { w } = anchor(s, 0.3, GLYPH_POOL, off)
        const [ox, oy] = off
        if (!onScreen(A, ox, oy, W)) continue
        p.anchors[s.id] = { x: Math.round(scr[0] + ox), y: Math.round(scr[1] - oy), a: +a.toFixed(2), src: w > 0.5 ? 'monument' : glyphShown[s.index] > 0.5 ? 'glyph' : 'relief', px: +W.toFixed(1) }
        // the bow stands on the spray: ends at its level, crown 0.62 W above it
        push(A, 2, a * BOW_ALPHA, s.seed, 0, ox, oy + 0.31 * W, 0.56 * W, 0.31 * W)
        push(A, 1, a * 0.9, s.seed * 3.1, 0, ox, oy + W * 0.02, W * 0.5, W * 0.26)
        for (let j = 0; j < MIST_PUFFS; j++) {
          const u = fract(p.clock / MIST_PERIOD_S + j / MIST_PUFFS + s.seed)
          const life = smooth(u, 0, 0.25) * (1 - smooth(u, 0.55, 1))
          const x = (j - 1) * W * 0.26 + Math.sin((u + j * 0.37) * Math.PI * 2) * W * 0.03
          push(A, 1, a * 0.8 * life, s.seed * 5.3 + j * 0.71, u, ox + x, oy + W * (0.06 + 0.32 * u), W * (0.26 + 0.14 * u), W * (0.17 + 0.08 * u))
        }
        nMist++
      }
    }

    // ——— volcano smoke ———
    let nSmoke = 0
    if (smokeZoom > 0) {
      const H = sizeAt(km, SMOKE_KM, SMOKE_H_PX) * k
      for (const s of p.volcanoes) {
        const facing = ctx.facing(s.dir, s.dir)
        const a = section * smokeZoom * smooth(facing, 0.1, 0.3)
        if (a < 0.004) continue
        const { w } = anchor(s, 1, GLYPH_PEAK, off)
        const [ox, oy] = off
        if (!onScreen(A, ox, oy, H)) continue
        p.anchors[s.id] = { x: Math.round(scr[0] + ox), y: Math.round(scr[1] - oy), a: +a.toFixed(2), src: w > 0.5 ? 'monument' : glyphShown[s.index] > 0.5 ? 'glyph' : 'relief', px: +H.toFixed(1) }
        // oldest (highest) first so the newer puffs paint over them
        const base = p.clock / SMOKE_PERIOD_S + s.seed
        const j0 = Math.floor(fract(base) * PUFFS)
        for (let q = 0; q < PUFFS; q++) {
          const j = (j0 + PUFFS - q) % PUFFS
          const u = fract(base + j / PUFFS)
          // born small in the crater, swelling, leaning downwind and thinning as it climbs
          const life = smooth(u, 0, 0.08) * (1 - smooth(u, 0.45, 1))
          const rise = H * 0.86 * u
          const lean = H * 0.36 * Math.pow(u, 1.5) + Math.sin((u * 0.9 + j * 0.31 + s.seed) * Math.PI * 2) * H * 0.025
          const r = H * (0.09 + 0.24 * u)
          push(A, 0, a * life, s.seed * 7.7 + j * 0.53, u, ox + lean, oy + rise, r * (1 + 0.25 * u), r * 0.86)
        }
        nSmoke++
      }
    }

    p.n = n
    geo.geometry.instanceCount = n
    mesh.visible = n > 0
    if (n > 0) {
      for (const at of [iPos, iRect, iE, iN, iMeta]) {
        at.needsUpdate = true
        at.clearUpdateRanges()
        at.addUpdateRange(0, n * at.itemSize)
      }
    }
    p.material.uniforms.uViewport.value.set(size.width, size.height)
    p.material.uniforms.uPxRatio.value = gl.getPixelRatio()
    stats.smoke = nSmoke
    stats.mist = nMist
    stats.clouds = nClouds
    stats.instances = n
    stats.cpuMs = stats.cpuMs * 0.9 + (performance.now() - t0) * 0.1
  })

  if (tier === 'low' || disabled) return null
  return <primitive object={parts.mesh} />
}

export default Life
