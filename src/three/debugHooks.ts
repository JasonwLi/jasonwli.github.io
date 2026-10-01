/**
 * Debug surface for automated checks (scripts/shot.mjs, probe-anchors.mjs).
 * Active when import.meta.env.DEV or ?debug=1:
 *   window.__globe = { state, setView({lat, lon, km, tilt}), setMode(m), stage(), ...registered }
 * registerDebug(name, fn) adds or replaces functions (C1 re-registers setView with
 * viewKm + tilt; C3 re-registers setMode).
 */
import { globeState, subscribeFrame, type MapMode } from './globeState'
import { sceneRefs } from './sceneRefs'
import { loadManifest } from './terrain/manifest'
import { globeActions } from './controls'
import { useSite } from '../state/store'

type Fn = (...args: never[]) => unknown

export const debugEnabled =
  typeof window !== 'undefined' &&
  (import.meta.env.DEV || new URLSearchParams(window.location.search).get('debug') === '1')

interface GlobeDebug {
  state: typeof globeState
  setView: (v: { lat?: number; lon?: number; km?: number; tilt?: number }) => void
  setMode: (m: MapMode) => void
  stage: () => string
  [name: string]: unknown
}

declare global {
  interface Window {
    __globe?: GlobeDebug
  }
}

if (debugEnabled) {
  window.__globe = {
    state: globeState,
    // C1 (CameraRig) registers the real setView (viewKm + tilt) on mount
    setView: () => {},
    setMode: (m: MapMode) => useSite.getState().setMapMode(m),
    stage: () => globeState.stage,
    subscribeFrame,
    /** renderer frame counter (checks that emitFrame fires once per rendered frame) */
    renderFrame: () => sceneRefs.gl?.info.render.frame ?? -1,
    loadManifest,
    actions: globeActions,
  }
}

export function registerDebug(name: string, fn: Fn): void {
  if (!debugEnabled || !window.__globe) return
  window.__globe[name] = fn
}
