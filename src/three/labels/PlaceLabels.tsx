/**
 * Visited-place names (C4). Thin, lazy shell over placeLabelSystem.ts (troika chunk,
 * imported once useLabelGate opens). Replaces F0's always-on drei <Html> labels and
 * hover tooltip: names exist only below VIEW_GATES.placeLabelsKm, never for the active
 * or hovered place (the readout / T1c hover label own those).
 *
 * Debug (?debug=1): __globe.placeLabels() → placed count + visible names.
 */
import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { registerDebug } from '../debugHooks'
import type { PlaceLabelSystem } from './placeLabelSystem'
import { useLabelGate } from './useLabelGate'

export function PlaceLabels() {
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  const open = useLabelGate()
  const [sys, setSys] = useState<PlaceLabelSystem | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    let made: PlaceLabelSystem | null = null
    import('./placeLabelSystem')
      .then((mod) => {
        if (!live) return
        made = new mod.PlaceLabelSystem()
        setSys(made)
        registerDebug('placeLabels', () => made?.debugInfo())
      })
      .catch((err: unknown) => console.warn('[labels] place labels failed to load', err))
    return () => {
      live = false
      made?.dispose()
      setSys(null)
    }
  }, [open])
  useFrame(({ camera }, dt) => sys?.frame(dt * 1000, camera, reducedMotion))
  return sys ? <primitive object={sys.batch} /> : null
}

export default PlaceLabels
