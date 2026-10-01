/**
 * Painted river ribbons (C6; default export, lazy; every tier except LOW).
 *
 * - Data: loadJson('rivers') (D2 rivers.json, NE scalerank <= 8), requested once the
 *   view comes below RIVERS_LOAD_KM. The strip is built ONCE in ribbon.worker.ts
 *   (Chaikin x2, arc-length resampling 2.5 / 3.5 km, mitred tangent-plane offsets) and
 *   drawn as ONE indexed mesh (1 draw call, <= 400k vertices: 332k with ranks <= 8,
 *   366k with ranks <= 9). Phones keep ranks <= 7 (269k).
 * - Handover with the terrain shader's raster rivers: the raster fades OUT over
 *   look.riverOutKm (4500 -> 3500 km) and the ribbons fade IN over exactly the same span
 *   (complementary), so no river is drawn twice. Finish review, stream-order culling:
 *   only ranks <= 4 come in at the hand-over; ranks 5-6 add over look.riverRank56Km
 *   (1500 -> 1150 km) and ranks 7+ over look.riverRank7Km (1150 -> 850 km).
 *   Ranks 9+ are used when rivers.json carries them.
 * - Lift: the terrain mesh's own height texture (see surfaceLift.ts) + LIFT.ribbon,
 *   polygonOffset (-1, -1), depthTest on, depthWrite off, renderOrder 5.
 * - Hidden in Climate mode: alpha x (1 - modeMix) (C3 hides the raster rivers there).
 *
 * Debug (?debug=1): __globe.rivers() -> build + draw stats.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { globeState } from '../globeState'
import { useSite } from '../../state/store'
import { smoothstep } from '../lod'
import { registerDebug } from '../debugHooks'
import { loadJson } from '../terrain/loader'
import type { RiversFile } from '../terrain/manifest'
import type { RibbonBuild } from './buildRibbons'
import { bindLift, makeLiftUniforms } from './surfaceLift'
import { makeRibbonMaterial } from './ribbonMaterial'
import { look } from '../terrain/look'

/** start fetching + building when the view comes this close (the fade starts at look.riverOutKm[0]) */
const RIVERS_LOAD_KM = 6500

type WorkerReply = { ok: true; build: RibbonBuild } | { ok: false; error: string }

const disabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('rivers') === '0'

export function RiverRibbons() {
  const size = useThree((s) => s.size)
  const tier = useSite((s) => s.tier) ?? globeState.tier
  const parts = useMemo(() => {
    const lift = makeLiftUniforms(tier === 'high' ? 'high' : 'mid')
    const material = makeRibbonMaterial(lift)
    const geometry = new THREE.BufferGeometry()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'river-ribbons'
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    mesh.visible = false
    mesh.raycast = () => {}
    return { lift, material, geometry, mesh, state: 'idle' as 'idle' | 'loading' | 'ready' | 'failed', stats: null as RibbonBuild['stats'] | null, error: '' }
  }, [tier])
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => bindLift(parts.lift), [parts])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
      parts.geometry.dispose()
      parts.material.dispose()
    },
    [parts],
  )

  useEffect(() => {
    registerDebug('rivers', () => ({
      state: parts.state,
      error: parts.error || undefined,
      build: parts.stats,
      visible: parts.mesh.visible,
      fade: parts.material.uniforms.uFade.value.toArray().map((v) => +v.toFixed(3)),
      modeMix: globeState.modeMix,
      drawCalls: parts.mesh.visible ? 1 : 0,
    }))
  }, [parts])

  const start = () => {
    parts.state = 'loading'
    const maxRank = globeState.isPhone ? 7 : 12
    loadJson<RiversFile>('rivers')
      .then((file) => {
        if (parts.state !== 'loading') return
        const w = new Worker(new URL('./ribbon.worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = w
        w.onmessage = (e: MessageEvent<WorkerReply>) => {
          w.terminate()
          if (workerRef.current === w) workerRef.current = null
          const r = e.data
          if (!r.ok) {
            parts.state = 'failed'
            parts.error = r.error
            console.error(`[rivers] build failed: ${r.error}`)
            return
          }
          const b = r.build
          const g = parts.geometry
          g.setAttribute('position', new THREE.BufferAttribute(b.dir, 3))
          g.setAttribute('aOff', new THREE.BufferAttribute(b.off, 3))
          g.setAttribute('aMeta', new THREE.BufferAttribute(b.meta, 2))
          g.setIndex(new THREE.BufferAttribute(b.index, 1))
          parts.stats = b.stats
          parts.state = 'ready'
        }
        w.onerror = (ev) => {
          parts.state = 'failed'
          parts.error = ev.message || 'worker error'
          console.error(`[rivers] worker error: ${parts.error}`)
        }
        w.postMessage({ rivers: file.rivers, opts: { maxRank } })
      })
      .catch((e: unknown) => {
        parts.state = 'failed'
        parts.error = e instanceof Error ? e.message : String(e)
        console.error(`[rivers] ${parts.error}`)
      })
  }

  useFrame(() => {
    const g = globeState
    const lod = g.lod
    if (disabled || g.tier === 'low') {
      parts.mesh.visible = false
      return
    }
    if (parts.state === 'idle' && lod.viewKm < RIVERS_LOAD_KM) start()
    const u = parts.material.uniforms
    const climate = 1 - Math.min(1, Math.max(0, g.modeMix))
    // complementary to the raster's smooth01(3500, 4500, viewKm) (TerrainGlobe uRiverAlpha),
    // then the minor ranks by stream order
    const f = smoothstep(look.riverOutKm[0], look.riverOutKm[1], lod.viewKm) * climate
    const f56 = f * smoothstep(look.riverRank56Km[0], look.riverRank56Km[1], lod.viewKm)
    const f7 = f * smoothstep(look.riverRank7Km[0], look.riverRank7Km[1], lod.viewKm)
    u.uFade.value.set(f, f56, f7)
    const on = parts.state === 'ready' && f > 0.002
    parts.mesh.visible = on
    if (!on) return
    u.uHeightScale.value = lod.heightScale
    u.uViewH.value = size.height
    u.uViewport.value.set(size.width, size.height)
    u.uDim.value = g.dim
  })

  if (disabled || tier === 'low') return null
  return <primitive object={parts.mesh} />
}

export default RiverRibbons
