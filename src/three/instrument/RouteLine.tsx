/**
 * Route course line (I1; theme ROUTE, critique 'I1 RouteLine vs theme ROUTE').
 *
 * Joins places in first-visit order. Each leg is a great-circle slerp sampled
 * every 1.5°, lifted as a parabola: h(t) = max(floor, peak·4t(1−t)) with
 * peak = 0.008 + 0.04·angle/π and floor = (local max terrain height)·heightScale
 * + 0.004. The terrain height is the CPU height grid's max over ±2 samples (≈ ±3°)
 * once it is ready, and 8848 m (conservative) before; leg ends sit at the pin lift
 * (1 + LIFT.pin + h·heightScale, as pinsPx.ts) so the line meets its pins, but only once terrain
 * displacement is possible (globeState.stage ≥ 'B'); the floor only bites when the
 * terrain is displaced (heightScale > 0), and positions are rewritten in place when
 * heightScale moves by more than 5%.
 *
 * Two LineMaterial passes in screen-space widths: an incise under-stroke at 2.5 px
 * / 55%, then silver at 1 px / 75%. Legs longer than 2500 km (air) are dashed
 * 6/4 px; overland legs are solid. The two legs touching the active place go to
 * 1.25 px at 100% (an overlay). No gilt, no vermilion. Opacity × anchors.routeOpacity
 * (hero 0.55, work follows dim, travel 1, Climate ×0.6).
 *
 * depthTest on: the globe occludes the far side. Draw-on at hero load: 600→2200 ms
 * after the globe surface first mounts, legs in order, each leg's duration
 * proportional to its arc length, via instanceCount. Pre-drawn under reduced motion.
 *
 * Restraint (INT, review finding "route reads as a web"): the route is one quiet
 * course line. Each segment carries a per-endpoint fade (instanceFade attribute,
 * patched into LineMaterial):
 *  - hero and wide travel (viewKm ≥ ~4000): every leg, faint (base passes × 0.6 in travel);
 *  - viewKm below ~4000: only the legs touching the active place plus legs whose
 *    two endpoints are both on screen (per-leg weights damped, no popping);
 *  - legs longer than 9000 km never draw as full arcs in travel: they fade to a
 *    short stub at each end (1200 km; 2400 km for the active legs);
 *  - a screen-space clip at the true silhouette circle stops lifted arcs poking past
 *    the limb.
 * The drawn segments/fades are published in screenObstacles.ts for the label declutter.
 */
import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { locations } from '../../data/travel'
import { tokens } from '../../theme/tokens'
import { EARTH_KM, LIFT } from '../geo/radii'
import { heightGridReady, sampleHeightM } from '../geo/heightGrid'
import { globeState } from '../globeState'
import { registerDebug } from '../debugHooks'
import { smoothstep } from '../lod'
import { drawnRoute } from './screenObstacles'
import { pinHeightM, pinLiftVersion } from './pinsPx'

const DEG = Math.PI / 180
const SAMPLE_RAD = 1.5 * DEG
const AIR_KM = 2500
const FLOOR_LIFT = 0.004
const CONSERVATIVE_M = 8848
const DRAW_START_MS = 600
const DRAW_MS = 1600
const WINDOW = 2
/** legs longer than this never draw as full arcs in travel */
const LONG_KM = 9000
const STUB_KM = 1200
const STUB_ACTIVE_KM = 2400
/** below this view span only active / on-screen legs draw */
const WIDE_KM: readonly [number, number] = [3500, 4500]
/** base passes' opacity factor in travel (the active legs' overlay stays at 100%) */
const TRAVEL_FAINT = 0.6
const ONSCREEN_MARGIN = 24

interface Leg {
  from: number // location index
  dashed: boolean
  angle: number
  segs: number
  /** start offset (segments) inside its kind's buffer */
  offset: number
  km: number
  /** damped draw weight (0..1) and the stub mix last written */
  w: number
  wDrawn: number
  stubDrawn: number
}

/** Per-kind (solid / dashed) segment store: endpoints' dirs, static parabola, terrain height. */
interface Store {
  n: number
  dir: Float32Array // 6 per seg
  base: Float32Array // 2 per seg
  hM: Float32Array // 2 per seg (window max, metres)
  /** 2 per seg: NaN inside a leg; at a leg end the place's height in metres (0 until the grid is ready) so the line meets the pin */
  hEnd: Float32Array
  pos: Float32Array // 6 per seg (the LineSegmentsGeometry's own array)
  start: Float32Array // draw-on start time per seg, ms after the clock starts
  fade: Float32Array // 2 per seg: per-endpoint alpha factor (instanceFade)
}

function slerpDir(a: THREE.Vector3, b: THREE.Vector3, angle: number, t: number, out: THREE.Vector3) {
  const s = Math.sin(angle)
  if (s < 1e-6) return out.copy(a).lerp(b, t).normalize()
  const wa = Math.sin((1 - t) * angle) / s
  const wb = Math.sin(t * angle) / s
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize()
}

function dirOf(i: number, out: THREE.Vector3) {
  const l = locations[i]
  const la = l.lat * DEG
  const lo = l.lon * DEG
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo))
}

function heightAt(d: THREE.Vector3): number {
  if (!heightGridReady()) return CONSERVATIVE_M
  const lat = Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG
  const lon = Math.atan2(-d.z, d.x) / DEG
  return Math.max(0, sampleHeightM(lat, lon))
}

function buildRoute() {
  const n = locations.length
  const legs: Leg[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  let segsSolid = 0
  let segsDashed = 0
  let totalArc = 0
  for (let i = 0; i + 1 < n; i++) {
    dirOf(i, a)
    dirOf(i + 1, b)
    const angle = Math.acos(Math.max(-1, Math.min(1, a.dot(b))))
    if (angle < 1e-5) continue
    const segs = Math.max(1, Math.ceil(angle / SAMPLE_RAD))
    const dashed = angle * EARTH_KM > AIR_KM
    legs.push({ from: i, dashed, angle, segs, offset: dashed ? segsDashed : segsSolid, km: angle * EARTH_KM, w: 1, wDrawn: -1, stubDrawn: -1 })
    if (dashed) segsDashed += segs
    else segsSolid += segs
    totalArc += angle
  }
  const mk = (count: number): Store => ({
    n: count,
    dir: new Float32Array(count * 6),
    base: new Float32Array(count * 2),
    hM: new Float32Array(count * 2),
    hEnd: new Float32Array(count * 2),
    pos: new Float32Array(Math.max(1, count) * 6),
    start: new Float32Array(count),
    fade: new Float32Array(Math.max(1, count) * 2).fill(1),
  })
  const solid = mk(segsSolid)
  const dashed = mk(segsDashed)
  const d = new THREE.Vector3()
  let arcSoFar = 0
  let maxSegs = 1
  for (const leg of legs) {
    const st = leg.dashed ? dashed : solid
    dirOf(leg.from, a)
    dirOf(leg.from + 1, b)
    const peak = 0.008 + (0.04 * leg.angle) / Math.PI
    const pts = leg.segs + 1
    const pd = new Float32Array(pts * 3)
    const pb = new Float32Array(pts)
    const ph = new Float32Array(pts)
    for (let j = 0; j < pts; j++) {
      const t = j / leg.segs
      slerpDir(a, b, leg.angle, t, d)
      pd[j * 3] = d.x
      pd[j * 3 + 1] = d.y
      pd[j * 3 + 2] = d.z
      pb[j] = peak * 4 * t * (1 - t)
      ph[j] = heightAt(d)
    }
    for (let j = 0; j < leg.segs; j++) {
      const k = leg.offset + j
      for (let e = 0; e < 2; e++) {
        const p = j + e
        st.dir[k * 6 + e * 3] = pd[p * 3]
        st.dir[k * 6 + e * 3 + 1] = pd[p * 3 + 1]
        st.dir[k * 6 + e * 3 + 2] = pd[p * 3 + 2]
        st.base[k * 2 + e] = pb[p]
        let hm = 0
        for (let q = Math.max(0, p - WINDOW); q <= Math.min(pts - 1, p + WINDOW); q++) hm = Math.max(hm, ph[q])
        st.hM[k * 2 + e] = hm
        // leg ends at the pins' own height (mesh texels when known, as pinsPx) so they meet
        st.hEnd[k * 2 + e] = p === 0 || p === pts - 1 ? (heightGridReady() ? pinHeightM[p === 0 ? leg.from : leg.from + 1] ?? ph[p] : 0) : NaN
      }
      st.start[k] = totalArc > 0 ? DRAW_START_MS + (DRAW_MS * (arcSoFar + (leg.angle * j) / leg.segs)) / totalArc : 0
    }
    arcSoFar += leg.angle
    maxSegs = Math.max(maxSegs, leg.segs)
  }
  return { legs, solid, dashed, maxSegs, gridReady: heightGridReady() }
}

/** Rewrite store positions for a heightScale: r = 1 + max(hM·hs + 0.004, base). */
function writePositions(st: Store, hs: number) {
  for (let k = 0; k < st.n; k++) {
    for (let e = 0; e < 2; e++) {
      const he = st.hEnd[k * 2 + e]
      // leg ends sit exactly at the pin's lift; the interior clears the terrain floor
      const r = he === he ? 1 + LIFT.pin + he * hs : 1 + Math.max(st.hM[k * 2 + e] * hs + FLOOR_LIFT, st.base[k * 2 + e])
      const o = k * 6 + e * 3
      st.pos[o] = st.dir[o] * r
      st.pos[o + 1] = st.dir[o + 1] * r
      st.pos[o + 2] = st.dir[o + 2] * r
    }
  }
}

function markDirty(geom: LineSegmentsGeometry) {
  const attr = geom.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute | undefined
  if (attr) attr.data.needsUpdate = true
}

/** Count of segments whose draw-on start time has passed (start[] is ascending). */
function drawnCount(start: Float32Array, n: number, elapsed: number): number {
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (start[mid] <= elapsed) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Per-segment fade (2 floats per segment) as instanced attributes on a line geometry. */
function attachFade(geom: LineSegmentsGeometry, fade: Float32Array) {
  const buf = new THREE.InstancedInterleavedBuffer(fade, 2, 1)
  geom.setAttribute('instanceFadeStart', new THREE.InterleavedBufferAttribute(buf, 1, 0))
  geom.setAttribute('instanceFadeEnd', new THREE.InterleavedBufferAttribute(buf, 1, 1))
}

function markFadeDirty(geom: LineSegmentsGeometry) {
  const attr = geom.getAttribute('instanceFadeStart') as THREE.InterleavedBufferAttribute | undefined
  if (attr) attr.data.needsUpdate = true
}

/** Silhouette clip circle in framebuffer px (GL origin bottom-left): x, y, R, enabled. */
const clipUniform = { value: new THREE.Vector4(0, 0, 1e6, 0) }

/** LineMaterial + per-segment fade and a soft clip at the globe silhouette. */
function patchLine(mat: LineMaterial) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uClip = clipUniform
    sh.vertexShader = sh.vertexShader
      .replace('attribute vec3 instanceStart;', 'attribute vec3 instanceStart;\nattribute float instanceFadeStart;\nattribute float instanceFadeEnd;\nvarying float vFade;')
      .replace('void main() {', 'void main() {\n\tvFade = ( position.y < 0.5 ) ? instanceFadeStart : instanceFadeEnd;')
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vFade;\nuniform vec4 uClip;\nvoid main() {\n\tif ( vFade < 0.004 ) discard;')
      .replace(
        'gl_FragColor = vec4( diffuseColor.rgb, alpha );',
        'float clipK = uClip.w > 0.5 ? 1.0 - smoothstep( uClip.z - 1.5, uClip.z + 0.5, distance( gl_FragCoord.xy, uClip.xy ) ) : 1.0;\n\tgl_FragColor = vec4( diffuseColor.rgb, alpha * vFade * clipK );',
      )
  }
  mat.customProgramCacheKey = () => 'route-fade-clip'
}

function makeLine(geom: LineSegmentsGeometry, color: string, width: number, dashed: boolean, order: number) {
  const mat = new LineMaterial({
    linewidth: width,
    worldUnits: false,
    dashed,
    dashSize: 6,
    gapSize: 4,
    dashScale: 1,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  // the diffuse uniform is a THREE.Color: .set(hex) converts sRGB → linear (R1)
  mat.color = new THREE.Color(color)
  patchLine(mat)
  const line = new LineSegments2(geom, mat)
  line.frustumCulled = false
  line.renderOrder = order
  line.raycast = () => {}
  return { line, mat }
}

export function RouteLine({ reducedMotion }: { reducedMotion: boolean }) {
  const parts = useMemo(() => {
    const route = buildRoute()
    const hs0 = 0 // re-lifted on the first frame once heightScale and the stage are known
    writePositions(route.solid, hs0)
    writePositions(route.dashed, hs0)
    const gSolid = new LineSegmentsGeometry().setPositions(route.solid.pos)
    const gDashed = new LineSegmentsGeometry().setPositions(route.dashed.pos)
    attachFade(gSolid, route.solid.fade)
    attachFade(gDashed, route.dashed.fade)
    // overlay: the (up to) two legs at the active place, one buffer per kind
    const ovCap = 2 * route.maxSegs
    const ovSolid: Store = {
      n: 0,
      dir: new Float32Array(ovCap * 6),
      base: new Float32Array(ovCap * 2),
      hM: new Float32Array(ovCap * 2),
      hEnd: new Float32Array(ovCap * 2),
      pos: new Float32Array(ovCap * 6),
      start: new Float32Array(0),
      fade: new Float32Array(ovCap * 2).fill(1),
    }
    const ovDashed: Store = { ...ovSolid, dir: new Float32Array(ovCap * 6), base: new Float32Array(ovCap * 2), hM: new Float32Array(ovCap * 2), hEnd: new Float32Array(ovCap * 2), pos: new Float32Array(ovCap * 6), fade: new Float32Array(ovCap * 2).fill(1) }
    const gOvSolid = new LineSegmentsGeometry().setPositions(ovSolid.pos)
    const gOvDashed = new LineSegmentsGeometry().setPositions(ovDashed.pos)
    attachFade(gOvSolid, ovSolid.fade)
    attachFade(gOvDashed, ovDashed.fade)
    /** overlay legs: [leg, start offset in its overlay store] */
    const ovLegs: { leg: Leg; offset: number }[] = []
    gOvSolid.instanceCount = 0
    gOvDashed.instanceCount = 0

    const lines = [
      // base: incise under-stroke, then silver
      { ...makeLine(gSolid, tokens.incise, 2.5, false, 20), alpha: 0.55, kind: 'base' as const },
      { ...makeLine(gDashed, tokens.incise, 2.5, true, 20), alpha: 0.55, kind: 'base' as const },
      { ...makeLine(gSolid, tokens.silver, 1, false, 21), alpha: 0.75, kind: 'base' as const },
      { ...makeLine(gDashed, tokens.silver, 1, true, 21), alpha: 0.75, kind: 'base' as const },
      // active legs
      { ...makeLine(gOvSolid, tokens.incise, 2.75, false, 22), alpha: 0.7, kind: 'overlay' as const },
      { ...makeLine(gOvDashed, tokens.incise, 2.75, true, 22), alpha: 0.7, kind: 'overlay' as const },
      { ...makeLine(gOvSolid, tokens.silver, 1.25, false, 23), alpha: 1, kind: 'overlay' as const },
      { ...makeLine(gOvDashed, tokens.silver, 1.25, true, 23), alpha: 1, kind: 'overlay' as const },
    ]
    lines[1].line.computeLineDistances()
    const group = new THREE.Group()
    for (const l of lines) group.add(l.line)
    return {
      route,
      group,
      lines,
      gSolid,
      gDashed,
      gOvSolid,
      gOvDashed,
      ovSolid,
      ovDashed,
      ovLegs,
      state: { hs: hs0, gridReady: route.gridReady, active: -2, clock0: 0, drawn: false, ovStub: -1, pinV: -1 },
    }
  }, [])

  // probe surface: draw-on progress and the active-leg overlay (debug builds only)
  useEffect(() => {
    registerDebug('route', () => ({
      solid: [parts.gSolid.instanceCount, parts.route.solid.n],
      dashed: [parts.gDashed.instanceCount, parts.route.dashed.n],
      legs: parts.route.legs.length,
      drawn: parts.state.drawn,
      overlay: [parts.ovSolid.n, parts.ovDashed.n],
      legWeights: parts.route.legs.map((l) => +l.w.toFixed(2)),
      drawnLegs: parts.route.legs.filter((l) => l.w > 0.05).length,
      visible: parts.group.visible,
      opacity: parts.lines.map((l) => +l.mat.opacity.toFixed(3)),
    }))
  }, [parts])

  useEffect(() => {
    drawnRoute.mounted = true
    drawnRoute.parts = [
      { pos: parts.route.solid.pos, fade: parts.route.solid.fade, count: 0 },
      { pos: parts.route.dashed.pos, fade: parts.route.dashed.fade, count: 0 },
      { pos: parts.ovSolid.pos, fade: parts.ovSolid.fade, count: 0 },
      { pos: parts.ovDashed.pos, fade: parts.ovDashed.fade, count: 0 },
    ]
    drawnRoute.emphasis = [false, false, true, true]
    return () => {
      drawnRoute.mounted = false
      drawnRoute.parts = []
    }
  }, [parts])

  useEffect(
    () => () => {
      for (const l of parts.lines) l.mat.dispose()
      parts.gSolid.dispose()
      parts.gDashed.dispose()
      parts.gOvSolid.dispose()
      parts.gOvDashed.dispose()
    },
    [parts],
  )

  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)

  useFrame((_, rawDt) => {
    const g = globeState
    const a = g.anchors
    const { route, lines, gSolid, gDashed, gOvSolid, gOvDashed, ovSolid, ovDashed, ovLegs, state } = parts
    const op = a.routeOpacity
    parts.group.visible = op > 0.005 && g.surfaceReady
    const dp = drawnRoute.parts
    if (!parts.group.visible) {
      for (const p of dp) p.count = 0
      if (state.drawn) return
    }
    const dt = Math.min(rawDt, 0.05)

    // ——— silhouette clip (framebuffer px, GL origin bottom-left) ———
    const dpr = gl.getPixelRatio()
    const R = a.silhouetteRpx
    clipUniform.value.set(a.globeCenterPx[0] * dpr, (size.height - a.globeCenterPx[1]) * dpr, R * dpr, R > 2 ? 1 : 0)

    // ——— heights: re-lift when heightScale moves > 5% or the height grid lands ———
    // displaced terrain needs the stage-B cube; before the CPU grid lands the floor
    // uses the conservative 8848 m only once displacement is possible (stage ≥ B)
    const ready = heightGridReady()
    const displaced = g.stage === 'B' || g.stage === 'C' || g.stage === 'D'
    const hs = ready || displaced ? g.lod.heightScale : 0
    let relift = false
    if (ready && !state.gridReady) {
      state.gridReady = true
      resampleHeights(route)
      relift = true
    }
    if (ready && pinLiftVersion !== state.pinV) {
      // pins re-lifted (mesh height source / mip): the leg ends follow them
      state.pinV = pinLiftVersion
      refreshEnds(route)
      state.active = -2 // refill the overlay copies
      relift = true
    }
    if ((hs === 0) !== (state.hs === 0) || Math.abs(hs - state.hs) > 0.05 * Math.max(state.hs, 1e-12)) relift = true
    if (relift) {
      state.hs = hs
      writePositions(route.solid, hs)
      writePositions(route.dashed, hs)
      markDirty(gSolid)
      markDirty(gDashed)
      if (ovSolid.n) writePositions(ovSolid, hs)
      if (ovDashed.n) writePositions(ovDashed, hs)
      markDirty(gOvSolid)
      markDirty(gOvDashed)
    }

    // ——— draw-on clock: starts the first frame a globe surface is mounted ———
    if (!state.drawn) {
      if (!g.surfaceReady) {
        gSolid.instanceCount = 0
        gDashed.instanceCount = 0
        return
      }
      const now = performance.now()
      if (!state.clock0) state.clock0 = now
      const elapsed = reducedMotion ? Infinity : now - state.clock0
      gSolid.instanceCount = drawnCount(route.solid.start, route.solid.n, elapsed)
      gDashed.instanceCount = drawnCount(route.dashed.start, route.dashed.n, elapsed)
      if (gSolid.instanceCount >= route.solid.n && gDashed.instanceCount >= route.dashed.n) state.drawn = true
    }

    // ——— active legs overlay ———
    const ai = a.activeIndex
    let ovChanged = false
    if (ai !== state.active) {
      state.active = ai
      fillOverlay(route, ai, ovSolid, ovDashed, state.hs, ovLegs)
      markDirty(gOvSolid)
      markDirty(gOvDashed)
      gOvSolid.instanceCount = ovSolid.n
      gOvDashed.instanceCount = ovDashed.n
      if (ovDashed.n) lines[5].line.computeLineDistances() // on click only, never per frame
      ovChanged = true
    }

    // ——— restraint: per-leg weights and long-leg stubs ———
    const travel = g.travelIn
    const stubMix = smoothstep(0.35, 0.75, travel)
    const wide = smoothstep(WIDE_KM[0], WIDE_KM[1], g.lod.viewKm)
    const k = 1 - Math.exp(-dt * 8)
    const px = g.pinsPx
    const vp = g.viewport
    const onScreen = (i: number) => {
      if (i * 4 + 3 >= px.length || px[i * 4 + 2] < 0.5) return false
      const x = px[i * 4]
      const y = px[i * 4 + 1]
      return x > -ONSCREEN_MARGIN && x < vp.w + ONSCREEN_MARGIN && y > -ONSCREEN_MARGIN && y < vp.h + ONSCREEN_MARGIN
    }
    let dirtyS = false
    let dirtyD = false
    for (const leg of route.legs) {
      const touches = ai >= 0 && (leg.from === ai || leg.from + 1 === ai)
      const target = touches || wide >= 0.999 ? 1 : Math.max(wide, onScreen(leg.from) && onScreen(leg.from + 1) ? 1 : 0)
      leg.w = reducedMotion || !state.drawn ? target : leg.w + (target - leg.w) * k
      if (Math.abs(leg.w - target) < 0.002) leg.w = target
      const sm = leg.km > LONG_KM ? stubMix : 0
      if (Math.abs(leg.w - leg.wDrawn) > 0.004 || Math.abs(sm - leg.stubDrawn) > 0.004 || (leg.w !== leg.wDrawn && (leg.w === 0 || leg.w === 1))) {
        leg.wDrawn = leg.w
        leg.stubDrawn = sm
        writeLegFade(leg.dashed ? route.dashed : route.solid, leg.offset, leg, leg.w, sm, STUB_KM)
        if (leg.dashed) dirtyD = true
        else dirtyS = true
      }
    }
    if (dirtyS) markFadeDirty(gSolid)
    if (dirtyD) markFadeDirty(gDashed)
    if (ovChanged || Math.abs(stubMix - state.ovStub) > 0.004) {
      state.ovStub = stubMix
      for (const o of ovLegs) writeLegFade(o.leg.dashed ? ovDashed : ovSolid, o.offset, o.leg, 1, o.leg.km > LONG_KM ? stubMix : 0, STUB_ACTIVE_KM)
      markFadeDirty(gOvSolid)
      markFadeDirty(gOvDashed)
    }

    // ——— opacity and screen-space dashes ———
    const pxPerUnit = Math.max(1e-3, g.lod.pxPerKm * EARTH_KM)
    const faint = 1 - (1 - TRAVEL_FAINT) * travel
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const show = l.kind === 'base' || state.drawn
      l.line.visible = show
      l.mat.opacity = l.alpha * op * (l.kind === 'base' ? faint : 1)
      if (l.mat.dashed) l.mat.dashScale = pxPerUnit
    }

    // ——— publish the drawn segments for the label declutter ———
    if (dp.length === 4 && parts.group.visible) {
      dp[0].count = gSolid.instanceCount
      dp[1].count = gDashed.instanceCount
      dp[2].count = state.drawn ? ovSolid.n : 0
      dp[3].count = state.drawn ? ovDashed.n : 0
    }
  })

  if (locations.length < 2) return null
  return <primitive object={parts.group} />
}

function resampleHeights(route: ReturnType<typeof buildRoute>) {
  // re-run the build's height sampling for both kinds with the real grid
  const fresh = buildRoute()
  route.solid.hM.set(fresh.solid.hM)
  route.dashed.hM.set(fresh.dashed.hM)
  route.solid.hEnd.set(fresh.solid.hEnd)
  route.dashed.hEnd.set(fresh.dashed.hEnd)
}

/** Leg ends take the pins' current heights (pinsPx.pinHeightM). */
function refreshEnds(route: ReturnType<typeof buildRoute>) {
  for (const leg of route.legs) {
    const st = leg.dashed ? route.dashed : route.solid
    const a = pinHeightM[leg.from]
    const b = pinHeightM[leg.from + 1]
    if (a !== undefined) st.hEnd[leg.offset * 2] = a
    if (b !== undefined) st.hEnd[(leg.offset + leg.segs - 1) * 2 + 1] = b
  }
}

/** Per-endpoint fade for one leg: weight × (full arc, or a stub at each end by stubMix). */
function writeLegFade(st: Store, offset: number, leg: Leg, w: number, stubMix: number, stubKm: number) {
  const s0 = 0.5 * stubKm
  for (let j = 0; j < leg.segs; j++) {
    for (let e = 0; e < 2; e++) {
      let f = w
      if (stubMix > 0) {
        const t = (j + e) / leg.segs
        const fromEnd = Math.min(t, 1 - t) * leg.km
        const stub = 1 - smoothstep(s0, stubKm, fromEnd)
        f *= 1 + (stub - 1) * stubMix
      }
      st.fade[(offset + j) * 2 + e] = f
    }
  }
}

function fillOverlay(route: ReturnType<typeof buildRoute>, ai: number, ovS: Store, ovD: Store, hs: number, ovLegs: { leg: Leg; offset: number }[]) {
  ovS.n = 0
  ovD.n = 0
  ovLegs.length = 0
  if (ai < 0) return
  for (const leg of route.legs) {
    if (leg.from !== ai - 1 && leg.from !== ai) continue
    const src = leg.dashed ? route.dashed : route.solid
    const dst = leg.dashed ? ovD : ovS
    ovLegs.push({ leg, offset: dst.n })
    for (let j = 0; j < leg.segs; j++) {
      const k = leg.offset + j
      const o = dst.n
      if ((o + 1) * 6 > dst.dir.length) break
      for (let c = 0; c < 6; c++) dst.dir[o * 6 + c] = src.dir[k * 6 + c]
      dst.base[o * 2] = src.base[k * 2]
      dst.base[o * 2 + 1] = src.base[k * 2 + 1]
      dst.hM[o * 2] = src.hM[k * 2]
      dst.hM[o * 2 + 1] = src.hM[k * 2 + 1]
      dst.hEnd[o * 2] = src.hEnd[k * 2]
      dst.hEnd[o * 2 + 1] = src.hEnd[k * 2 + 1]
      dst.n++
    }
  }
  writePositions(ovS, hs)
  writePositions(ovD, hs)
}

export default RouteLine
