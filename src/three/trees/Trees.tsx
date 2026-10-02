/**
 * Instanced trees in tilted close views (C6; default export, lazy).
 * MID/HIGH only, NEVER on phones (globeState.isPhone or pointer:coarse), null on LOW.
 *
 * - Density: loadTreeDensity() (D3 equirect, R conifer, G broadleaf, B palm = tropical
 *   rainforest -> broad jungle canopy trees on the broadleaf mesh + 25% palms), fetched
 *   when the view first comes below DENSITY_LOAD_KM and transferred once to
 *   scatter.worker.ts. While lod.treeFade = 0 the worker is never asked for anything.
 * - Scatter: world-anchored (scatter.ts): every tree is a fixed point on the globe with
 *   a fixed threshold, so orbiting / re-scattering never moves or re-deals a tree.
 *   The region is the visible ground footprint (screen rays onto the sphere) x 1.15.
 *   Re-scatter when the footprint leaves the region, the zoom passes the headroom
 *   (x1.4), or the region is > 2.5x the footprint; at most 2 requests per second.
 * - Density on screen: spacing s = max(0.8 x tree height, viewKm / k) with
 *   k = sqrt(budget / 1.92), level τ = (cellKm / s)^2; tree height = 4.5 km (EU4
 *   exaggeration) clamped to 7..16 px. Zooming grows / shrinks individual trees.
 * - Hard budget: HIGH 36 000 instances, MID 16 000 (3 draw calls, one per species).
 *   When a region would exceed it the worker keeps the lowest thresholds and reports
 *   tauEff; the shader's level is capped by it (ramped, so a swap never pops).
 * - Fade: lod.treeFade (below 1400 km AND tilted) x (1 - modeMix) scales trees in from
 *   the ground; they leave in Climate mode like the rivers (TREES_IN_CLIMATE).
 * - Never cover monuments: trees shrink away within KEEP_PX of every landmark near
 *   the view (monuments sit there, pushed <= ~30 px off their pin). Pins (depthTest
 *   off, renderOrder 30) and labels (depthTest off) draw above trees anyway.
 * - No tree stands in a river: trees shrink away within 3.6 km of a river centreline
 *   (the terrain's hydro river band, the same ranks the ribbons draw).
 * - No sway or any idle animation; reduced motion only affects the cap ramp (instant).
 *
 * Debug (?debug=1): __globe.trees() stats; __globe.c6Bench(n) ms with / without
 * ribbons + trees; ?trees=0 disables.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { globeState, type Tier } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { registerDebug } from '../debugHooks'
import { loadTreeDensity, loadTreeDensityBlob } from '../terrain/loader'
import { LANDMARKS } from '../../data/landmarks'
import { bindHydro, bindLift, makeHydroUniforms, makeLiftUniforms } from '../rivers/surfaceLift'
import { SPECIES, buildTreeGeometry, treeTris } from './treeGeometry'
import { MAX_KEEPOUTS, makeTreeMaterial, makeTreeShared } from './treeMaterial'
import { TREE_COLOURS, TREE_VALUE_JITTER } from './palette'
import type { ScatterResult } from './scatter'

const R_KM = 6371
const TREE_BUDGET = { high: 36_000, mid: 16_000 } as const
/** grid cell = the closest spacing (0.8 x 4.5 km) so τ <= 1 */
const CELL_KM = 3.6
const TREE_KM = 4.5
const TREE_MIN_PX = 7
const TREE_MAX_PX = 16
const HEADROOM = 1.4
const DENSITY_LOAD_KM = 2200
const MIN_REQUEST_MS = 500
const KEEP_PX = 34
const CAP_RAMP_MS = 300
/** region = footprint radius x REGION_MARGIN + 0.01 rad */
const REGION_MARGIN = 1.15
/** design toggle: false = trees scale out in Climate mode (green canopy on Köppen colours misreads as data) */
const TREES_IN_CLIMATE = false

type Reply =
  | { ok: true; result: ScatterResult; init?: undefined }
  | { ok: false; id: number; error: string; init?: undefined }
  | { ok: boolean; init: true; error?: string }

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('trees') === '0'

function coarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

const LANDMARK_DIRS = LANDMARKS.map((l) => {
  const la = (l.lat * Math.PI) / 180
  const lo = (l.lon * Math.PI) / 180
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo))
})

export function Trees({ tier, reducedMotion }: { tier: Tier; reducedMotion: boolean }) {
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const allowed = !disabled && tier !== 'low' && !globeState.isPhone && !coarsePointer()
  const budget = tier === 'high' ? TREE_BUDGET.high : TREE_BUDGET.mid
  const kView = Math.sqrt(budget / 1.92)

  const parts = useMemo(() => {
    const lift = makeLiftUniforms(tier === 'high' ? 'high' : 'mid')
    const hydro = makeHydroUniforms()
    const shared = makeTreeShared(lift, hydro)
    const group = new THREE.Group()
    group.name = 'trees'
    const meshes = SPECIES.map((sp) => {
      const g = buildTreeGeometry(sp)
      const iA = new THREE.InstancedBufferAttribute(new Float32Array(budget * 4), 4).setUsage(THREE.DynamicDrawUsage)
      const iB = new THREE.InstancedBufferAttribute(new Float32Array(budget * 4), 4).setUsage(THREE.DynamicDrawUsage)
      g.setAttribute('iA', iA)
      g.setAttribute('iB', iB)
      g.instanceCount = 0
      const mat = makeTreeMaterial(shared, TREE_COLOURS[sp], sp === 'broadleaf')
      const mesh = new THREE.Mesh(g, mat)
      mesh.name = `trees:${sp}`
      mesh.frustumCulled = false
      mesh.visible = false
      mesh.raycast = () => {}
      group.add(mesh)
      return { sp, g, iA, iB, mat, mesh, tris: treeTris(sp) }
    })
    return {
      lift, hydro, shared, group, meshes,
      density: 'idle' as 'idle' | 'loading' | 'ready' | 'failed',
      error: '',
      cur: null as null | { centre: THREE.Vector3; radius: number; tauHi: number; tauEff: number; counts: number[]; stats: ScatterResult['stats'] },
      pending: null as ScatterResult | null,
      inFlight: false,
      reqId: 0,
      lastReq: -1e9,
      tauCap: 0,
      tauCapTarget: 0,
      swaps: 0,
      requests: 0,
      foot: { centre: new THREE.Vector3(), radius: 0 },
      tau: 0,
      force: false,
    }
  }, [tier, budget])
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    const a = bindLift(parts.lift)
    const b = bindHydro(parts.hydro)
    return () => {
      a()
      b()
    }
  }, [parts])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
      for (const m of parts.meshes) {
        m.g.dispose()
        m.mat.dispose()
      }
    },
    [parts],
  )

  // scratch
  const tmp = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      inv: new THREE.Matrix4(),
      o: new THREE.Vector3(),
      d: new THREE.Vector3(),
      hit: new THREE.Vector3(),
      sum: new THREE.Vector3(),
      hits: Array.from({ length: 25 }, () => new THREE.Vector3()),
      keep: [] as { i: number; c: number }[],
    }),
    [],
  )

  const swapIn = (r: ScatterResult) => {
    let total = 0
    const counts: number[] = []
    for (let k = 0; k < 3; k++) {
      const m = parts.meshes[k]
      const s = r.species[k]
      ;(m.iA.array as Float32Array).set(s.a)
      ;(m.iB.array as Float32Array).set(s.b)
      m.iA.clearUpdateRanges()
      m.iB.clearUpdateRanges()
      m.iA.addUpdateRange(0, s.count * 4)
      m.iB.addUpdateRange(0, s.count * 4)
      m.iA.needsUpdate = true
      m.iB.needsUpdate = true
      m.g.instanceCount = s.count
      counts.push(s.count)
      total += s.count
    }
    parts.cur = {
      centre: new THREE.Vector3(...r.centre),
      radius: r.radius,
      tauHi: r.tauHi,
      tauEff: r.tauEff,
      counts,
      stats: { ...r.stats, kept: total },
    }
    parts.swaps++
  }

  const onReply = (e: MessageEvent<Reply>) => {
    const r = e.data
    if (r.init) {
      if (r.ok) parts.density = 'ready'
      else {
        // the worker could not decode (no OffscreenCanvas): decode here and hand the bytes over
        loadTreeDensity()
          .then((f) => {
            workerRef.current?.postMessage({ kind: 'init', field: f, valueJitter: TREE_VALUE_JITTER }, [f.data.buffer])
            parts.density = 'ready'
          })
          .catch(densityFailed)
      }
      return
    }
    parts.inFlight = false
    if (!r.ok) {
      console.error(`[trees] scatter failed: ${r.error}`)
      return
    }
    const res = r.result
    if (!parts.cur || res.tauEff >= parts.tauCap) {
      // the new set covers everything on screen now: swap at once, cap ramps up
      if (!parts.cur) parts.tauCap = res.tauEff
      parts.pending = null
      swapIn(res)
      parts.tauCapTarget = res.tauEff
    } else {
      // the new set covers less: ramp the cap down on the old set first, then swap
      parts.pending = res
      parts.tauCapTarget = res.tauEff
    }
  }

  const densityFailed = (e: unknown) => {
    parts.density = 'failed'
    parts.error = e instanceof Error ? e.message : String(e)
    console.error(`[trees] density: ${parts.error}`)
  }

  const loadDensity = () => {
    parts.density = 'loading'
    // the encoded image goes to the worker, which decodes it off the main thread;
    // 'ready' once it acknowledges (onReply init)
    loadTreeDensityBlob()
      .then(({ blob, w: fw, h: fh }) => {
        const w = new Worker(new URL('./scatter.worker.ts', import.meta.url), { type: 'module' })
        w.onmessage = onReply
        w.onerror = (ev) => {
          parts.inFlight = false
          parts.error = ev.message || 'worker error'
          console.error(`[trees] worker error: ${parts.error}`)
        }
        w.postMessage({ kind: 'initBlob', blob, w: fw, h: fh, valueJitter: TREE_VALUE_JITTER })
        workerRef.current = w
      })
      .catch(densityFailed)
  }

  /** visible ground footprint: 5x5 screen rays onto the unit sphere (misses -> the limb) */
  const footprint = (inner: THREE.Object3D) => {
    const { ray, ndc, inv, o, d, hit, sum, hits } = tmp
    inner.updateWorldMatrix(true, false)
    inv.copy(inner.matrixWorld).invert()
    sum.set(0, 0, 0)
    let k = 0
    for (let iy = 0; iy < 5; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        ndc.set(-1 + ix * 0.5, -1 + iy * 0.5)
        ray.setFromCamera(ndc, camera)
        o.copy(ray.ray.origin).applyMatrix4(inv)
        d.copy(ray.ray.direction).transformDirection(inv)
        const b = o.dot(d)
        const c = o.lengthSq() - 1
        const disc = b * b - c
        if (disc >= 0) hit.copy(o).addScaledVector(d, -b - Math.sqrt(disc))
        else hit.copy(o).addScaledVector(d, -b)
        hit.normalize()
        hits[k++].copy(hit)
        sum.add(hit)
      }
    }
    const centre = parts.foot.centre.copy(sum).normalize()
    let rad = 0
    for (let i = 0; i < k; i++) rad = Math.max(rad, Math.acos(Math.min(1, Math.max(-1, hits[i].dot(centre)))))
    parts.foot.radius = rad
    return parts.foot
  }

  useEffect(() => {
    registerDebug('trees', () => {
      const tau = parts.shared.uTau.value
      let visible = 0
      for (const m of parts.meshes) {
        const b = m.iB.array as Float32Array
        for (let i = 0; i < m.g.instanceCount; i++) if (tau / b[i * 4 + 2] > 1) visible++
      }
      return {
        allowed,
        tier,
        budget,
        density: parts.density,
        error: parts.error || undefined,
        fade: +globeState.lod.treeFade.toFixed(3),
        viewKm: Math.round(globeState.lod.viewKm),
        tilt: +globeState.lod.tilt.toFixed(3),
        tau: +parts.tau.toFixed(5),
        tauCap: +parts.tauCap.toFixed(5),
        uTau: +tau.toFixed(5),
        treeKm: +(parts.shared.uSize.value * R_KM).toFixed(2),
        instances: parts.meshes.map((m) => m.g.instanceCount),
        submitted: parts.meshes.reduce((a, m) => a + m.g.instanceCount, 0),
        visible,
        drawCalls: parts.meshes.filter((m) => m.mesh.visible).length,
        trisPerTree: parts.meshes.map((m) => m.tris),
        region: parts.cur ? { radiusKm: Math.round(parts.cur.radius * R_KM), tauHi: +parts.cur.tauHi.toFixed(5), tauEff: +parts.cur.tauEff.toFixed(5), stats: parts.cur.stats } : null,
        footprintKm: Math.round(parts.foot.radius * R_KM),
        keepouts: parts.shared.uKeepN.value,
        requests: parts.requests,
        swaps: parts.swaps,
        pending: !!parts.pending,
        inFlight: parts.inFlight,
      }
    })
    /** force one re-scatter of the same view (swap-stability check) */
    registerDebug('treesRescatter', () => {
      parts.force = true
      parts.lastReq = -1e9
      return parts.swaps
    })
    registerDebug('c6Bench', (n = 60) => {
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const run = () => {
        gl.render(scene, camera)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      const rivers = scene.getObjectByName('river-ribbons')
      const measure = () => {
        for (let i = 0; i < 4; i++) run()
        const t0 = performance.now()
        for (let i = 0; i < n; i++) run()
        return { ms: (performance.now() - t0) / n, calls: gl.info.render.calls, tris: gl.info.render.triangles }
      }
      const rv = rivers?.visible ?? false
      const tv = parts.group.visible
      const both = measure()
      parts.group.visible = false
      const noTrees = measure()
      if (rivers) rivers.visible = false
      const none = measure()
      parts.group.visible = tv
      if (rivers) rivers.visible = rv
      return {
        msAll: +both.ms.toFixed(3),
        msNoTrees: +noTrees.ms.toFixed(3),
        msNone: +none.ms.toFixed(3),
        treesMs: +(both.ms - noTrees.ms).toFixed(3),
        riversMs: +(noTrees.ms - none.ms).toFixed(3),
        c6Ms: +(both.ms - none.ms).toFixed(3),
        calls: both.calls,
        treeCalls: both.calls - noTrees.calls,
        riverCalls: noTrees.calls - none.calls,
        treeTris: both.tris - noTrees.tris,
        riverTris: noTrees.tris - none.tris,
      }
    })
  }, [parts, allowed, tier, budget, gl, scene, camera])

  useFrame((_, rawDt) => {
    const g = globeState
    const lod = g.lod
    const inner = sceneRefs.inner
    const hide = () => {
      for (const m of parts.meshes) m.mesh.visible = false
    }
    if (!allowed || g.isPhone || !inner) return hide()
    if (parts.density === 'idle' && lod.viewKm < DENSITY_LOAD_KM) loadDensity()
    // Climate mode is a data plate (C3 hides the rivers there too): trees scale out
    const fade = lod.treeFade * (TREES_IN_CLIMATE ? 1 : 1 - Math.min(1, Math.max(0, g.modeMix)))
    if (fade <= 0.001 || parts.density !== 'ready') return hide()

    // level from the zoom
    const pxPerKm = Math.max(lod.pxPerKm, 1e-4)
    const treeKm = Math.min(Math.max(TREE_KM, TREE_MIN_PX / pxPerKm), TREE_MAX_PX / pxPerKm)
    const s = Math.max(0.8 * treeKm, lod.viewKm / kView)
    const tau = Math.min(1, (CELL_KM / s) ** 2)
    parts.tau = tau

    // region bookkeeping + requests (throttled; one in flight)
    const foot = footprint(inner)
    const now = performance.now()
    const cur = parts.cur
    let need = !cur || parts.force
    if (cur) {
      const off = Math.acos(Math.min(1, Math.max(-1, cur.centre.dot(foot.centre))))
      if (off + foot.radius > cur.radius * 0.98) need = true
      if (tau > cur.tauHi * 1.0001) need = true
      if (cur.radius > 2.5 * foot.radius * REGION_MARGIN + 0.01) need = true
      if (tau < cur.tauHi / (HEADROOM * HEADROOM * HEADROOM * HEADROOM)) need = true
      // budget-capped below the wanted level: a tighter region buys a denser forest
      if (cur.tauEff < tau * 0.97 && cur.radius > (foot.radius * REGION_MARGIN + 0.01) * 1.15) need = true
    }
    const w = workerRef.current
    if (need && w && !parts.inFlight && now - parts.lastReq >= MIN_REQUEST_MS) {
      parts.inFlight = true
      parts.force = false
      parts.lastReq = now
      parts.requests++
      const c = foot.centre
      w.postMessage({
        kind: 'scatter',
        id: ++parts.reqId,
        centre: [c.x, c.y, c.z],
        radius: Math.min(Math.PI, foot.radius * REGION_MARGIN + 0.01),
        tauHi: Math.min(1, tau * HEADROOM * HEADROOM),
        budget,
        cellKm: CELL_KM,
      })
    }

    // cap ramp (log space) and the pending swap
    const dt = Math.min(rawDt, 0.1) * 1000
    if (parts.tauCap !== parts.tauCapTarget) {
      if (reducedMotion || parts.tauCap <= 0) parts.tauCap = parts.tauCapTarget
      else {
        const k = Math.min(1, dt / CAP_RAMP_MS)
        const lc = Math.log(parts.tauCap)
        const lt = Math.log(Math.max(parts.tauCapTarget, 1e-9))
        const step = Math.sign(lt - lc) * Math.max(Math.abs(lt - lc) * k, 0.02 * k)
        parts.tauCap = Math.abs(lt - lc) <= Math.abs(step) ? parts.tauCapTarget : Math.exp(lc + step)
      }
    }
    if (parts.pending && parts.tauCap <= parts.tauCapTarget * 1.0001) {
      swapIn(parts.pending)
      parts.pending = null
    }

    // uniforms
    const u = parts.shared
    u.uTau.value = Math.min(tau, parts.tauCap)
    u.uFade.value = fade
    u.uSize.value = treeKm / R_KM
    u.uHeightScale.value = lod.heightScale
    u.uViewH.value = size.height
    u.uDim.value = g.dim
    // keep-outs: landmarks (monuments) near the footprint, nearest first
    const keep = tmp.keep
    keep.length = 0
    const keepAng = KEEP_PX / (pxPerKm * R_KM)
    const lim = Math.cos(Math.min(Math.PI, foot.radius + keepAng * 1.4))
    for (let i = 0; i < LANDMARK_DIRS.length; i++) {
      const c = LANDMARK_DIRS[i].dot(foot.centre)
      if (c >= lim) keep.push({ i, c })
    }
    keep.sort((a, b) => b.c - a.c)
    const nk = Math.min(MAX_KEEPOUTS, keep.length)
    for (let k = 0; k < nk; k++) {
      const d = LANDMARK_DIRS[keep[k].i]
      u.uKeep.value[k].set(d.x, d.y, d.z, keepAng)
    }
    u.uKeepN.value = nk
    for (const m of parts.meshes) m.mesh.visible = m.g.instanceCount > 0
  })

  if (!allowed) return null
  return <primitive object={parts.group} />
}

export default Trees
