import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { Globe } from './Globe'
import { Pings, PING_RADIUS } from './Pings'
import { globeState } from './globeState'
import { damp, facingAngles, latLonToVec3, nearestAngle } from './globeMath'
import { useSite } from '../state/store'
import { countryName, locations } from '../data/travel'

const CAM_Z = 3.35
const FOV = 42

function easeInOut(t: number) {
  return t * t * (3 - 2 * t)
}

function Starfield() {
  const geometry = useMemo(() => {
    const n = 1100
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      )
        .normalize()
        .multiplyScalar(26 + Math.random() * 8)
      pos.set([v.x, v.y, v.z], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [])
  return (
    <points geometry={geometry}>
      <pointsMaterial
        size={0.05}
        sizeAttenuation
        transparent
        opacity={0.45}
        color="#aab4c8"
        depthWrite={false}
      />
    </points>
  )
}

/** atlas-style labels for the most-photographed places */
function LandmarkLabels({ earthRef }: { earthRef: React.RefObject<THREE.Mesh | null> }) {
  const tops = useMemo(() => {
    // most-photographed first, thinned so labels never crowd each other
    const sorted = [...locations]
      .filter((l) => l.photos.length > 0)
      .sort((a, b) => b.photos.length - a.photos.length)
    const picked: typeof sorted = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    for (const loc of sorted) {
      if (picked.length >= 14) break
      a.copy(latLonToVec3(loc.lat, loc.lon, 1))
      const crowded = picked.some(
        (p) => a.angleTo(b.copy(latLonToVec3(p.lat, p.lon, 1))) < 0.12, // ~760 km
      )
      if (!crowded) picked.push(loc)
    }
    return picked
  }, [])
  const divRefs = useRef<(HTMLDivElement | null)[]>([])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const center = useMemo(() => new THREE.Vector3(), [])
  const toCam = useMemo(() => new THREE.Vector3(), [])
  const local = useMemo(() => tops.map((l) => latLonToVec3(l.lat, l.lon, 1.03)), [tops])

  useFrame(({ camera }) => {
    const group = earthRef.current?.parent
    if (!group) return
    group.getWorldPosition(center)
    const show = globeState.travelIn > 0.35
    for (let i = 0; i < tops.length; i++) {
      const el = divRefs.current[i]
      if (!el) continue
      tmp.copy(local[i])
      group.localToWorld(tmp)
      toCam.copy(camera.position).sub(tmp)
      const front = tmp.sub(center).dot(toCam) > 0
      el.style.opacity = show && front ? '1' : '0'
    }
  })

  return (
    <>
      {tops.map((loc, i) => (
        <Html
          key={loc.slug}
          position={local[i]}
          zIndexRange={[2, 2]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="landmark-label map-label"
            ref={(el) => {
              divRefs.current[i] = el
            }}
          >
            {loc.name}
          </div>
        </Html>
      ))}
    </>
  )
}

function HoverLabel() {
  const hovered = useSite((s) => s.hovered)
  const active = useSite((s) => s.active)
  const loc = hovered && hovered !== active ? hovered : null
  if (!loc) return null
  return (
    <Html
      position={latLonToVec3(loc.lat, loc.lon, 1.05)}
      center
      style={{ pointerEvents: 'none', transform: 'translateY(-1.9rem)' }}
      zIndexRange={[5, 5]}
    >
      <span className="ping-tooltip">
        <em className="map-label">{loc.name}</em>
        <span className="mono">{countryName(loc.cc)}</span>
      </span>
    </Html>
  )
}

function Rig({ reducedMotion }: { reducedMotion: boolean }) {
  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const { gl, size, scene, camera } = useThree()
  const active = useSite((s) => s.active)

  const sectionEls = useRef<Record<'hero' | 'work' | 'travel' | 'contact', HTMLElement | null>>({
    hero: null,
    work: null,
    travel: null,
    contact: null,
  })
  const wasInTravel = useRef(false)
  const earthRef = useRef<THREE.Mesh>(null)

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

  // drag to rotate + screen-space ping picking (deterministic, no raycast)
  useEffect(() => {
    const el = gl.domElement
    el.style.touchAction = 'pan-y'
    let px = 0
    let py = 0
    let dragDist = 0
    const pingLocals = locations.map((loc) => latLonToVec3(loc.lat, loc.lon, PING_RADIUS))
    const tmp = new THREE.Vector3()
    const center = new THREE.Vector3()
    const toCam = new THREE.Vector3()
    const outward = new THREE.Vector3()

    const pingAt = (clientX: number, clientY: number) => {
      const innerG = inner.current
      if (!innerG) return null
      const rect = el.getBoundingClientRect()
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      innerG.getWorldPosition(center)
      let best: (typeof locations)[number] | null = null
      let bestD = 22
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i]
        tmp.copy(pingLocals[i])
        innerG.localToWorld(tmp)
        // skip far-side pings
        toCam.copy(camera.position).sub(tmp)
        if (outward.copy(tmp).sub(center).dot(toCam) < 0) continue
        tmp.project(camera)
        const x = ((tmp.x + 1) / 2) * rect.width
        const y = ((1 - tmp.y) / 2) * rect.height
        const d = Math.hypot(x - sx, y - sy)
        if (d < bestD) {
          bestD = d
          best = loc
        }
      }
      return best
    }

    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      globeState.dragging = true
      globeState.lastInteraction = performance.now()
      px = e.clientX
      py = e.clientY
      dragDist = 0
    }
    const updatePointerInGlobe = (clientX: number, clientY: number) => {
      const o = outer.current
      if (!o) return
      const rect = el.getBoundingClientRect()
      const c = o.getWorldPosition(new THREE.Vector3()).project(camera as THREE.PerspectiveCamera)
      const cx = ((c.x + 1) / 2) * rect.width
      const cy = ((1 - c.y) / 2) * rect.height
      // screen radius: project a point one globe-radius to the camera's right
      const camRight = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .multiplyScalar(o.scale.x)
      const rEdge = o.getWorldPosition(new THREE.Vector3()).add(camRight).project(camera as THREE.PerspectiveCamera)
      const rPx = Math.hypot((((rEdge.x + 1) / 2) * rect.width) - cx, (((1 - rEdge.y) / 2) * rect.height) - cy)
      globeState.pointerInGlobe =
        Math.hypot(clientX - rect.left - cx, clientY - rect.top - cy) < rPx * 1.04
    }

    const move = (e: PointerEvent) => {
      updatePointerInGlobe(e.clientX, e.clientY)
      if (globeState.dragging) {
        const dx = e.clientX - px
        const dy = e.clientY - py
        px = e.clientX
        py = e.clientY
        dragDist += Math.abs(dx) + Math.abs(dy)
        // finer control while leaned in
        const k = 1 / Math.max(globeState.zoom, 1)
        globeState.targetYaw += dx * 0.0052 * k
        globeState.targetPitch = THREE.MathUtils.clamp(
          globeState.targetPitch + dy * 0.0032 * k,
          -1.25,
          1.25,
        )
        globeState.lastInteraction = performance.now()
      } else if (e.target === el) {
        const hit = pingAt(e.clientX, e.clientY)
        const { hovered, setHovered } = useSite.getState()
        if (hit !== hovered) setHovered(hit)
        el.style.cursor = hit ? 'pointer' : ''
      }
    }

    // wheel over the globe disc zooms (page scrolls normally elsewhere)
    const wheel = (e: WheelEvent) => {
      if (!(globeState.pointerInGlobe && globeState.travelIn > 0.55)) return
      e.preventDefault()
      globeState.targetZoom = THREE.MathUtils.clamp(
        globeState.targetZoom * Math.exp(-e.deltaY * 0.0014),
        1,
        2.8,
      )
      globeState.lastInteraction = performance.now()
    }
    const up = (e: PointerEvent) => {
      const wasDragging = globeState.dragging
      globeState.dragging = false
      globeState.lastInteraction = performance.now()
      if (wasDragging && dragDist < 8 && e.target === el) {
        const hit = pingAt(e.clientX, e.clientY)
        if (hit) {
          useSite.getState().setActive(hit)
          // a ping pressed from the hero/work sections glides you to the globe
          const travelEl = document.getElementById('travel')
          if (travelEl && travelEl.getBoundingClientRect().top > window.innerHeight * 0.35) {
            travelEl.scrollIntoView({ behavior: 'smooth' })
          }
        }
      }
    }
    const leave = () => {
      const { hovered, setHovered } = useSite.getState()
      if (hovered) setHovered(null)
      el.style.cursor = ''
    }
    // double-click: zoom in toward the point under the cursor
    const dbl = (e: MouseEvent) => {
      if (e.target !== el || !outer.current || !inner.current) return
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera as THREE.PerspectiveCamera)
      const c = outer.current.getWorldPosition(new THREE.Vector3())
      const R = outer.current.scale.x
      const hit = new THREE.Vector3()
      if (!ray.ray.intersectSphere(new THREE.Sphere(c, R), hit)) {
        globeState.targetZoom = 1 // double-click off the globe resets
        return
      }
      const local = inner.current.worldToLocal(hit.clone()).normalize()
      const lat = (Math.asin(THREE.MathUtils.clamp(local.y, -1, 1)) * 180) / Math.PI
      const theta = Math.atan2(local.z, -local.x)
      let lon = (theta * 180) / Math.PI - 180
      if (lon < -180) lon += 360
      const f = facingAngles(lat, lon)
      globeState.targetYaw = nearestAngle(f.yaw, globeState.yaw)
      globeState.targetPitch = f.pitch
      globeState.targetZoom = Math.min(globeState.targetZoom < 1.5 ? 1.8 : globeState.targetZoom + 0.5, 2.8)
      globeState.lastInteraction = performance.now()
    }
    // touch scrolling fires pointercancel, not pointerup — without this the
    // globe keeps rotating with every scroll gesture
    const cancel = () => {
      globeState.dragging = false
      globeState.lastInteraction = performance.now()
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('dblclick', dbl)
    window.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('dblclick', dbl)
      window.removeEventListener('wheel', wheel)
    }
  }, [gl, camera])

  // fly to the active location when a gallery opens
  useEffect(() => {
    if (!active) return
    const { yaw, pitch } = facingAngles(active.lat, active.lon)
    globeState.targetYaw = nearestAngle(yaw, globeState.yaw)
    globeState.targetPitch = pitch
    globeState.autoRotate = false
    if (reducedMotion) {
      globeState.yaw = globeState.targetYaw
      globeState.pitch = globeState.targetPitch
    }
  }, [active, reducedMotion])

  useFrame((_, rawDt) => {
    const g = globeState
    // clamp: a backgrounded tab returning after minutes must not snap-rotate
    const dt = Math.min(rawDt, 0.05)

    // auto-rotate resumes after 3s idle, never while a gallery is open or a
    // ping is hovered (the tooltip must stay put)
    const site = useSite.getState()
    if (
      !reducedMotion &&
      !g.dragging &&
      !site.active &&
      !site.hovered &&
      g.zoom < 1.15 &&
      performance.now() - g.lastInteraction > 3000
    ) {
      g.targetYaw += dt * 0.045
    }

    g.yaw = damp(g.yaw, g.targetYaw, 6, dt)
    g.pitch = damp(g.pitch, g.targetPitch, 6, dt)
    if (inner.current) {
      inner.current.rotation.set(g.pitch, g.yaw, 0)
    }

    // ——— scroll choreography ———
    const vh = window.innerHeight
    const els = sectionEls.current
    if (!els.hero || !els.hero.isConnected) {
      els.hero = document.getElementById('hero')
      els.work = document.getElementById('work')
      els.travel = document.getElementById('travel')
      els.contact = document.getElementById('contact')
    }
    const { hero: heroEl, work: workEl, travel: travelEl } = els
    const aspect = size.width / size.height
    const vpH = 2 * Math.tan((FOV * Math.PI) / 360) * CAM_Z
    const vpW = vpH * aspect
    const mobile = aspect < 0.8

    let x = mobile ? 0 : vpW * 0.215
    let y = mobile ? -0.98 : -0.06
    let s = mobile ? 0.44 : 0.74
    let dim = 0
    let travelInGlobal = 0

    if (heroEl && workEl && travelEl) {
      const workR = workEl.getBoundingClientRect()
      const travelR = travelEl.getBoundingClientRect()
      const workIn = easeInOut(
        THREE.MathUtils.clamp((vh * 0.85 - workR.top) / (vh * 0.6), 0, 1),
      )
      const travelIn = easeInOut(
        THREE.MathUtils.clamp((vh * 0.9 - travelR.top) / (vh * 0.65), 0, 1),
      )
      travelInGlobal = travelIn
      g.travelIn = travelIn

      const wx = mobile ? 0 : vpW * 0.36
      const wy = mobile ? -1.05 : 0.02
      const ws = mobile ? 0.42 : 0.5
      const galleryOpen = !!useSite.getState().active
      const tx = mobile || !galleryOpen ? 0 : -vpW * 0.13
      const ty = mobile ? -0.12 : -0.04
      const ts = mobile ? 0.66 : 0.84

      x = THREE.MathUtils.lerp(x, wx, workIn)
      y = THREE.MathUtils.lerp(y, wy, workIn)
      s = THREE.MathUtils.lerp(s, ws, workIn)
      dim = THREE.MathUtils.lerp(0, 0.87, workIn)

      x = THREE.MathUtils.lerp(x, tx, travelIn)
      y = THREE.MathUtils.lerp(y, ty, travelIn)
      s = THREE.MathUtils.lerp(s, ts, travelIn)
      dim = THREE.MathUtils.lerp(dim, 0, travelIn)

      // soften the globe behind the footer so contact text carries
      const footEl = els.contact
      if (footEl) {
        const footR = footEl.getBoundingClientRect()
        const footIn = easeInOut(
          THREE.MathUtils.clamp((vh * 0.75 - footR.top) / (vh * 0.55), 0, 1),
        )
        dim = THREE.MathUtils.lerp(dim, 0.5, footIn)
      }

      // auto-close the gallery when *leaving* the travel section — edge-triggered,
      // so a gallery opened from the hero survives the glide down
      const { active: act, setActive } = useSite.getState()
      if (travelIn > 0.6) wasInTravel.current = true
      if (act && wasInTravel.current && travelIn < 0.45) {
        setActive(null)
        wasInTravel.current = false
      }
    }

    // user zoom applies only while the travel section owns the view
    g.zoom = damp(g.zoom, g.targetZoom, 6, dt)
    if (travelInGlobal < 0.3) g.targetZoom = 1
    s *= THREE.MathUtils.lerp(1, g.zoom, travelInGlobal)

    g.posX = damp(g.posX, x, 8, dt)
    g.posY = damp(g.posY, y, 8, dt)
    g.scale = damp(g.scale, s, 8, dt)
    g.dim = damp(g.dim, dim, 8, dt)

    if (outer.current) {
      outer.current.position.set(g.posX, g.posY, 0)
      outer.current.scale.setScalar(g.scale)
    }
  })

  return (
    <group ref={outer}>
      <group ref={inner}>
        <Suspense fallback={null}>
          <Globe ref={earthRef} />
        </Suspense>
        <Pings reducedMotion={reducedMotion} />
        <HoverLabel />
        <LandmarkLabels earthRef={earthRef} />
      </group>
    </group>
  )
}

export function GlobeScene({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="globe-canvas" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [0, 0, CAM_Z] }}
        gl={{ antialias: true, alpha: true }}
      >
        <Starfield />
        <Rig reducedMotion={reducedMotion} />
      </Canvas>
      <div className="globe-vignette" />
    </div>
  )
}
