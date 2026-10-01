/**
 * Camera rig (C1 owns after F0): outer/inner globe groups, scroll choreography,
 * camera (computeCamera), zoom damping, LOD bus (computeLod), controls
 * (attachControls). Its useFrame runs at priority −3 (NEVER positive: a positive
 * priority turns off r3f's automatic render). Children render INSIDE the inner
 * (globe-local, R = 1) group.
 *
 * C1 model (plan §4, critiques 1/12/13):
 *  - choreography targets are screen-space (centre px, silhouette R px) from the
 *    choreography table, damped λ 8, then turned into a lens shift
 *    (screenTargetPx) and a scale s with R = f·s/√(CAM_Z² − s²); the globe stays
 *    on the optical axis, so the silhouette is an exact circle
 *  - zoom moves the camera toward the surface (log viewKm, controls.view depth);
 *    tilt orbits the camera about the view target; nothing scales the globe
 *  - the disc (centre, true silhouette radius) is re-measured every frame (bug #1)
 *  - mobile layout follows the CSS breakpoint (≤ 860 px), not aspect < 0.8 (brief §6.2)
 *  - DPR drops to 1 while the globe is dimmed behind the work log (brief §6.6)
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { globeState } from './globeState'
import { damp, facingAngles, nearestAngle } from './globeMath'
import { sceneRefs } from './sceneRefs'
import {
  attachControls,
  debugSetView,
  depthSpan,
  flyTo,
  rig,
  tickControls,
  tickFly,
  tickInertia,
  tiltFor,
  view,
} from './controls'
import {
  CAM_Z,
  FOV,
  altFromViewKm,
  computeCamera,
  measureDisc,
  scaleFromR,
  viewKmFromAlt,
} from './camera'
import { computeLod, zoom01 } from './lod'
import { choreography } from '../theme/choreography'
import { MIN_VIEW_KM } from './geo/radii'
import { registerDebug } from './debugHooks'
import { TIER_DPR } from './tier'
import { useSite } from '../state/store'

/** CSS breakpoint where the travel column collapses (site.css @media max-width 860px) */
const MOBILE_MQ = '(max-width: 860px)'

function easeInOut(t: number) {
  return t * t * (3 - 2 * t)
}

/** Choreography targets: the theme table (src/theme/choreography.ts). */

registerDebug('setView', debugSetView)

export function CameraRig({ reducedMotion, children }: { reducedMotion: boolean; children?: ReactNode }) {
  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const { gl, size, scene, camera } = useThree()
  const setDpr = useThree((s) => s.setDpr)
  const active = useSite((s) => s.active)
  const mobileMq = useRef<MediaQueryList | null>(null)
  const dprLowered = useRef(false)

  const sectionEls = useRef<Record<'hero' | 'work' | 'travel' | 'contact' | 'col', HTMLElement | null>>({
    hero: null,
    work: null,
    travel: null,
    contact: null,
    col: null,
  })
  const wasInTravel = useRef(false)
  const enteredTravel = useRef(false)
  const zoomedInTravel = useRef(false)
  const frame = useRef({ init: false, cx: 0, cy: 0, R: 1 })
  const lastTargetLn = useRef(Number.NaN)
  const lastLnMax = useRef(0)
  const devWarnAt = useRef(0)

  useEffect(() => {
    sceneRefs.outer = outer.current
    sceneRefs.inner = inner.current
    sceneRefs.camera = camera as THREE.PerspectiveCamera
    mobileMq.current = window.matchMedia(MOBILE_MQ)
    return () => {
      sceneRefs.outer = null
      sceneRefs.inner = null
      sceneRefs.camera = null
    }
  }, [camera])

  // arrival: the planet settles into place on first load
  useEffect(() => {
    if (reducedMotion) return
    globeState.yaw = globeState.targetYaw - 1.15
    globeState.pitch = globeState.targetPitch + 0.4
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__three = { scene, camera, gl }
    }
  }, [scene, camera, gl])

  // drag / wheel / pinch / double-click (controls.ts)
  useEffect(() => attachControls(gl.domElement, { reducedMotion }), [gl, reducedMotion])

  // fly to the active location when a gallery opens: the place rests at the
  // theme's sight point with the full limb kept (controls.flyTo)
  useEffect(() => {
    if (active) flyTo(active, reducedMotion)
  }, [active, reducedMotion])

  useFrame((_, rawDt) => {
    const g = globeState
    // clamp: a backgrounded tab returning after minutes must not snap-rotate
    const dt = Math.min(rawDt, 0.05)
    const now = performance.now()
    const site = useSite.getState()

    // ——— scroll choreography (table → screen target + scale) ———
    const vh = window.innerHeight
    const els = sectionEls.current
    if (!els.hero || !els.hero.isConnected) {
      els.hero = document.getElementById('hero')
      els.work = document.getElementById('work')
      els.travel = document.getElementById('travel')
      els.contact = document.getElementById('contact')
      els.col = document.querySelector<HTMLElement>('.travel-col')
    }
    const { hero: heroEl, work: workEl, travel: travelEl } = els
    const W = size.width
    const H = size.height
    const mobile = mobileMq.current ? mobileMq.current.matches : W / H < 0.8
    const colRight = mobile ? 0 : (els.col?.getBoundingClientRect().right ?? 0)
    const cctx = { w: W, h: H, mobile, colRightPx: colRight }

    const hero = choreography('hero', cctx)
    let cx = hero.centerPx[0]
    let cy = hero.centerPx[1]
    let R = hero.Rpx
    let dim = hero.dim
    let travelInGlobal = 0
    let footInGlobal = 0

    if (heroEl && workEl && travelEl) {
      const workR = workEl.getBoundingClientRect()
      const travelR = travelEl.getBoundingClientRect()
      const workIn = easeInOut(THREE.MathUtils.clamp((vh * 0.85 - workR.top) / (vh * 0.6), 0, 1))
      const travelIn = easeInOut(THREE.MathUtils.clamp((vh * 0.9 - travelR.top) / (vh * 0.65), 0, 1))
      travelInGlobal = travelIn
      g.travelIn = travelIn
      g.workIn = workIn

      const work = choreography('work', cctx)
      const travel = choreography('travel', cctx)
      const lerp = THREE.MathUtils.lerp
      cx = lerp(cx, work.centerPx[0], workIn)
      cy = lerp(cy, work.centerPx[1], workIn)
      R = lerp(R, work.Rpx, workIn)
      dim = lerp(dim, work.dim, workIn)
      cx = lerp(cx, travel.centerPx[0], travelIn)
      cy = lerp(cy, travel.centerPx[1], travelIn)
      R = lerp(R, travel.Rpx, travelIn)
      dim = lerp(dim, travel.dim, travelIn)

      // soften the globe behind the footer so contact text carries
      const footEl = els.contact
      let footIn = 0
      if (footEl) {
        const footR = footEl.getBoundingClientRect()
        footIn = easeInOut(THREE.MathUtils.clamp((vh * 0.75 - footR.top) / (vh * 0.55), 0, 1))
        dim = lerp(dim, choreography('footer', cctx).dim, footIn)
      }
      g.footIn = footIn
      footInGlobal = footIn

      // auto-close the gallery when *leaving* the travel section — edge-triggered,
      // so a gallery opened from the hero survives the glide down
      const { active: act, setActive } = site
      if (travelIn > 0.6) wasInTravel.current = true

      // arriving at the globe: face the densest stretch of the route (the
      // Mediterranean → Levant cluster) instead of whatever the idle spin left
      // us on. Edge-triggered; skipped when a gallery already owns the view.
      if (travelIn > 0.5 && !enteredTravel.current) {
        enteredTravel.current = true
        if (!act && !g.dragging) {
          const f = facingAngles(33, 22)
          g.targetYaw = nearestAngle(f.yaw, g.yaw)
          g.targetPitch = f.pitch
          g.lastInteraction = now
          if (reducedMotion) {
            g.yaw = g.targetYaw
            g.pitch = g.targetPitch
          }
        }
      } else if (travelIn < 0.2) {
        enteredTravel.current = false
      }
      if (act && wasInTravel.current && travelIn < 0.45) {
        setActive(null)
        wasInTravel.current = false
      }
    }

    // damped framing in screen space (λ 8): lens-shift target + silhouette radius
    const fr = frame.current
    if (!fr.init) {
      fr.init = true
      fr.cx = cx
      fr.cy = cy
      fr.R = R
    }
    fr.cx = damp(fr.cx, cx, 8, dt)
    fr.cy = damp(fr.cy, cy, 8, dt)
    fr.R = damp(fr.R, R, 8, dt)
    g.dim = damp(g.dim, dim, 8, dt)
    g.modeMix = damp(g.modeMix, g.targetModeMix, 9, dt)
    const s = scaleFromR(fr.R, H)
    g.scale = s
    // the globe stays on the optical axis; the lens shift places it (critique 13)
    g.posX = 0
    g.posY = 0

    // ——— zoom (log viewKm as a depth below the framing) ———
    const maxViewKm = viewKmFromAlt(Math.max(CAM_Z - s, 1e-4), s)
    const lnMax = Math.log(maxViewKm)
    g.maxViewKm = maxViewKm
    // viewKm spans the viewport HEIGHT: on a portrait phone the same floor shows less than
    // half the ground across, magnifying the tier's texels past what they hold (mid at 500 km
    // was a blur). Scale the floor by the aspect so the narrow side keeps the tier's floor.
    const aspectFloor = Math.max(1, H / Math.max(1, W))
    g.minViewKm = Math.min(MIN_VIEW_KM[g.tier] * aspectFloor, maxViewKm)
    // an external write to targetLogViewKm (not ours from last frame) is honoured
    if (Math.abs(g.targetLogViewKm - lastTargetLn.current) > 1e-9) {
      view.targetDepth = lastLnMax.current - g.targetLogViewKm
    }
    rig.C.set(0, 0, 0)
    rig.s = s
    rig.screenTargetPx[0] = fr.cx
    rig.screenTargetPx[1] = fr.cy
    rig.w = W
    rig.h = H
    rig.lnMax = lnMax
    rig.lnMin = Math.log(g.minViewKm)
    const span = depthSpan()
    // leaving travel (up to work, or down into the contact plate) resets the zoom, so a
    // deep-zoomed globe never parks behind the footer (edge-triggered so a debug setView
    // elsewhere holds)
    if (travelInGlobal > 0.55 && footInGlobal < 0.2) zoomedInTravel.current = true
    else if ((travelInGlobal < 0.3 || footInGlobal > 0.3) && zoomedInTravel.current) {
      zoomedInTravel.current = false
      view.targetDepth = 0
      view.tiltOverride = null
      // reduced motion: the globe snaps back to its framing instead of gliding out
      if (reducedMotion) {
        view.depth = 0
        g.tilt = 0
      }
    }
    view.targetDepth = THREE.MathUtils.clamp(view.targetDepth, 0, span)
    view.depth = THREE.MathUtils.clamp(damp(view.depth, view.targetDepth, 6, dt), 0, span)
    if (Math.abs(view.depth - view.targetDepth) < 1e-5) view.depth = view.targetDepth
    const viewKm = Math.exp(lnMax - view.depth)
    g.logViewKm = Math.log(viewKm)
    g.targetLogViewKm = lnMax - view.targetDepth
    lastTargetLn.current = g.targetLogViewKm
    lastLnMax.current = lnMax
    g.targetTilt = tiltFor(viewKm)
    g.tilt = damp(g.tilt, g.targetTilt, 5, dt)
    const z01 = zoom01(viewKm, maxViewKm, g.minViewKm)

    // leaned in on a phone, touch drags pan the surface instead of scrolling the
    // page; at the framing the page keeps its scroll gesture
    const ta = travelInGlobal > 0.55 && z01 > 0.02 ? 'none' : 'pan-y'
    if (gl.domElement.style.touchAction !== ta) gl.domElement.style.touchAction = ta

    // ——— rotation: fly-to, inertia, auto-rotate, damping ———
    tickFly(reducedMotion)
    if (!g.dragging) tickInertia(dt)
    // auto-rotate resumes after 3 s idle at the framing, never while a gallery is
    // open or a pin is hovered (the tooltip must stay put); debug setView turns it off
    if (
      g.autoRotate &&
      !reducedMotion &&
      !g.dragging &&
      !site.active &&
      !site.hovered &&
      z01 < 0.05 &&
      now - g.lastInteraction > 3000
    ) {
      g.targetYaw += dt * 0.045
    }
    g.yaw = damp(g.yaw, g.targetYaw, 6, dt)
    g.pitch = damp(g.pitch, g.targetPitch, 6, dt)
    if (inner.current) inner.current.rotation.set(g.pitch, g.yaw, 0)
    if (outer.current) {
      outer.current.position.set(0, 0, 0)
      outer.current.scale.setScalar(s)
    }

    // ——— camera ———
    const cam = camera as THREE.PerspectiveCamera
    computeCamera(
      { C: rig.C, Rw: s, viewKm, tilt: g.tilt, screenTargetPx: rig.screenTargetPx, viewport: { w: W, h: H }, fov: FOV },
      cam,
    )
    cam.updateMatrixWorld()

    // ——— disc, viewport, LOD (every frame; bug #1) ———
    if (outer.current) {
      outer.current.updateMatrixWorld()
      const disc = measureDisc(cam, outer.current, W, H)
      g.centerPx = [disc.cx, disc.cy]
      g.radiusPx = disc.r
      // dev check: at the framing the silhouette sits exactly on the table entry
      if (import.meta.env.DEV && z01 < 1e-4 && g.tilt < 1e-4 && now - devWarnAt.current > 2000) {
        const e = Math.hypot(disc.cx - fr.cx, disc.cy - fr.cy) + Math.abs(disc.r - fr.R)
        if (e > 1) {
          devWarnAt.current = now
          console.warn(`[CameraRig] framing off by ${e.toFixed(2)} px`)
        }
      }
    }
    g.viewport.w = W
    g.viewport.h = H
    g.viewport.freeLeftPx = travelInGlobal > 0.5 ? colRight : 0
    const alt = Math.min(Math.max(CAM_Z - s, 1e-4), altFromViewKm(viewKm, s))
    computeLod(viewKm, g.tilt, alt / s, g.tier, g.radiusPx, g.viewport, g.lod)
    g.lod.zoom01 = z01

    tickControls(now)

    // brief §6.6: no need to shade a dimmed, parked globe at DPR 2
    const maxDpr = TIER_DPR[g.tier][1]
    if (!dprLowered.current && g.dim > 0.8) {
      dprLowered.current = true
      setDpr(1)
    } else if (dprLowered.current && g.dim < 0.75) {
      dprLowered.current = false
      setDpr([1, maxDpr])
    }
  }, -3)

  return (
    <group ref={outer}>
      <group ref={inner}>{children}</group>
    </group>
  )
}

export default CameraRig
