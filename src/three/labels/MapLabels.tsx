/**
 * Region names on the globe (C4). Thin, lazy shell: once useLabelGate opens it loads
 * labels.json (loader.loadJson) and the troika engine (mapLabelSystem.ts, its own
 * chunk), then drives MapLabelSystem.frame() every frame. See mapLabelSystem.ts for
 * the typography, sizing, curvature, horizon and declutter rules.
 *
 * Debug (?debug=1): __globe.labels() → pass stats + visible ids;
 * __globe.labelBench(n) → ms per full frame with / without both label layers.
 */
import { useEffect, useMemo, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import type { Tier } from '../globeState'
import { loadJson } from '../terrain/loader'
import type { LabelsFile } from '../terrain/manifest'
import { registerDebug } from '../debugHooks'
import type { MapLabelSystem } from './mapLabelSystem'
import { useLabelGate } from './useLabelGate'

export function MapLabels({ tier }: { tier: Tier }) {
  void tier // labels are the same on every tier (LOW included); sizes are screen-space
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  const open = useLabelGate()
  const [sys, setSys] = useState<MapLabelSystem | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    let made: MapLabelSystem | null = null
    Promise.all([loadJson<LabelsFile>('labels'), import('./mapLabelSystem')])
      .then(([file, mod]) => {
        if (!live || !file?.labels?.length) return
        made = new mod.MapLabelSystem(file)
        setSys(made)
      })
      .catch((err: unknown) => console.warn('[labels] map labels failed to load', err))
    return () => {
      live = false
      made?.dispose()
      setSys(null)
    }
  }, [open])

  const { gl, scene, camera: cam } = useThree()
  useEffect(() => {
    registerDebug('labels', () => sys?.debugInfo())
    // GPU+CPU cost of the lettering: full frames with vs without both label layers
    registerDebug('labelBench', (n = 60) => {
      const ctx = gl.getContext()
      const px = new Uint8Array(4)
      const layers = ['MapLabels', 'PlaceLabels'].map((k) => scene.getObjectByName(k)).filter(Boolean) as THREE.Object3D[]
      const run = () => {
        gl.render(scene, cam)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
      }
      const time = () => {
        for (let i = 0; i < 5; i++) run()
        const t0 = performance.now()
        for (let i = 0; i < n; i++) run()
        return [(performance.now() - t0) / n, gl.info.render.calls]
      }
      const vis = layers.map((o) => o.visible)
      const [withLabels, callsWith] = time()
      layers.forEach((o) => (o.visible = false))
      const [without, callsWithout] = time()
      layers.forEach((o, i) => (o.visible = vis[i]))
      const t1 = performance.now()
      for (let i = 0; i < n; i++) sys?.frame(16, cam, true)
      const cpuFrame = (performance.now() - t1) / n
      return {
        msWithLabels: withLabels,
        msWithout: without,
        labelMs: withLabels - without,
        cpuFrameMs: cpuFrame,
        labelDrawCalls: callsWith - callsWithout,
      }
    })
  }, [gl, scene, cam, sys])

  useFrame(({ camera }, dt) => sys?.frame(dt * 1000, camera, reducedMotion))
  return sys ? <primitive object={sys.group} /> : null
}

export default MapLabels
