/**
 * Canvas + mounts (F0; INT owns after wave 0). The tree matches the frozen
 * component_apis contract, with the critique amendments: no Starfield and no
 * .globe-vignette (the Astrolabe removes both), and the globe surface's Suspense
 * fallback is the EngravedSphere loading plate.
 *
 * Frame order: CameraRig useFrame −3 (pose, camera, disc, LOD, controls) →
 * Instrument −2 (pinsPx, anchors, emitFrame) → layers at 0. Never positive.
 */
import { Suspense, lazy, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraRig } from './CameraRig'
import { Instrument } from './instrument/Instrument'
import { EngravedSphere } from './instrument/EngravedSphere'
import { NightGlobe } from './legacy/NightGlobe'
import { sceneRefs } from './sceneRefs'
import { TIER_DPR, probeTier, tierOverride } from './tier'
import { CAM_Z, FOV } from './camera'
import './debugHooks'
import { useSite } from '../state/store'
import { InstrumentOverlay } from '../sections/InstrumentOverlay'
import { dismissBootShell } from './bootShell'

const TerrainGlobe = lazy(() => import('./terrain/TerrainGlobe'))
const RiverRibbons = lazy(() => import('./rivers/RiverRibbons'))
const Trees = lazy(() => import('./trees/Trees'))
const Monuments = lazy(() => import('./monuments/Monuments'))
const LandmarkGlyphs = lazy(() => import('./monuments/LandmarkGlyphs'))
const Ships = lazy(() => import('./ships/Ships'))
const Towns = lazy(() => import('./towns/Towns'))
const Life = lazy(() => import('./life/Life'))
const MapLabels = lazy(() => import('./labels/MapLabels'))
const PlaceLabels = lazy(() => import('./labels/PlaceLabels'))

/** Fades out index.html's static boot plate once the canvas has drawn two frames. */
function BootHandover() {
  const n = useRef(0)
  useFrame(() => {
    if (n.current > 2) return
    if (++n.current === 2) dismissBootShell()
  })
  return null
}

/** Context losses tolerated before handing over to the SVG FallbackGlobe (theme: 2nd loss). */
const MAX_CONTEXT_LOSSES = 2

export function GlobeScene({ reducedMotion, onContextFailed }: { reducedMotion: boolean; onContextFailed?: () => void }) {
  const setTier = useSite((s) => s.setTier)
  const storeTier = useSite((s) => s.tier)
  // before the GL context exists only ?tier= is known; antialias is fixed at creation
  const initialTier = useMemo(() => tierOverride() ?? 'mid', [])
  const tier = storeTier ?? initialTier
  // App routes no-WebGL2 browsers to the SVG FallbackGlobe; NightGlobe is the ?gstyle=night style
  const night = useMemo(() => new URLSearchParams(window.location.search).get('gstyle') === 'night', [])

  return (
    <div className="globe-canvas" aria-hidden="true">
      <Canvas
        flat
        dpr={TIER_DPR[tier]}
        camera={{ fov: FOV, near: 0.01, far: 100, position: [0, 0, CAM_Z] }}
        gl={{ antialias: initialTier !== 'low', alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          sceneRefs.gl = gl
          setTier(probeTier(gl))
          // three restores after a loss; the second loss hands over to the SVG globe
          let losses = 0
          gl.domElement.addEventListener('webglcontextlost', () => {
            losses++
            if (losses >= MAX_CONTEXT_LOSSES) onContextFailed?.()
          })
        }}
      >
        <BootHandover />
        <CameraRig reducedMotion={reducedMotion}>
          <Suspense fallback={<EngravedSphere />}>
            {night ? <NightGlobe reducedMotion={reducedMotion} /> : <TerrainGlobe reducedMotion={reducedMotion} tier={tier} />}
          </Suspense>
          <Suspense fallback={null}>
            <RiverRibbons />
            <Trees tier={tier} reducedMotion={reducedMotion} />
            <Monuments tier={tier} />
            <LandmarkGlyphs />
            <MapLabels tier={tier} />
            <PlaceLabels />
          </Suspense>
          {/* the towns read the monuments' footprints of the same frame: mounted after them */}
          <Suspense fallback={null}>
            <Towns tier={tier} reducedMotion={reducedMotion} />
          </Suspense>
          {/* its own boundary: the ships' chunk never holds back the labels and monuments */}
          <Suspense fallback={null}>
            <Ships tier={tier} reducedMotion={reducedMotion} />
          </Suspense>
          {/* smoke, mist and cloud wisps: read the glyphs', monuments', towns' and names' boxes of the same frame */}
          <Suspense fallback={null}>
            <Life tier={tier} reducedMotion={reducedMotion} />
          </Suspense>
          <Instrument reducedMotion={reducedMotion} />
        </CameraRig>
      </Canvas>
      <InstrumentOverlay />
    </div>
  )
}
