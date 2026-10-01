/**
 * The globe instrument (I1): pins, route, and the per-frame sync that feeds the DOM
 * overlay. Its useFrame runs at priority −2, right after CameraRig (−3):
 *   updatePinLift → updatePinsPx → updateAnchors → updateNeatline → emitFrame
 * so the overlay moves in the same frame as the canvas. Pins and route draw at the
 * default priority (0) and read the anchors written here. Never use a positive
 * priority (it disables r3f's automatic render).
 *
 * The route lives in its own lazy chunk (Line2 shaders stay out of the entry
 * bundle); it draws on 600 ms after the surface mounts, so the chunk is in time.
 */
import { Suspense, lazy, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { emitFrame, globeState } from '../globeState'
import { sceneRefs } from '../sceneRefs'
import { StarPins } from './StarPins'
import { updatePinLift, updatePinsPx } from './pinsPx'
import { updateAnchors } from './anchors'
import { updateNeatline } from './neatline'

const RouteLine = lazy(() => import('./RouteLine'))

export function Instrument({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const { outer, inner } = sceneRefs
    // bug #5: no pins until a globe surface (loading plate or globe) is mounted
    if (group.current) group.current.visible = globeState.surfaceReady
    if (outer && inner) {
      updatePinLift(globeState.lod.heightScale)
      updatePinsPx(camera, inner, globeState.viewport)
      updateAnchors(dt, camera, outer, inner, globeState.viewport, reducedMotion)
      updateNeatline(camera, outer, inner)
    }
    emitFrame(dt)
  }, -2)

  return (
    <group ref={group} visible={false}>
      <Suspense fallback={null}>
        <RouteLine reducedMotion={reducedMotion} />
      </Suspense>
      <StarPins reducedMotion={reducedMotion} />
    </group>
  )
}

export default Instrument
