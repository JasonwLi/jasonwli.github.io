/**
 * Seasonal colour (step 6): the season map (shared equirect, scripts/terrain/bake_season.py)
 * and the uniforms the terrain cube shader and the tree shader share
 * (shaders/season.glsl.ts). The phase comes from globeState.seasonPhase (the visitor's
 * date, or ?season=YYYY-MM-DD), fixed for the page load.
 *
 * seasonUniforms() returns uniform objects this module keeps bound (the climate chunk's
 * pattern): the map is fetched once on first use (outside the loader's stages: one small
 * lossless file, ~190 KB), and uSeasonOn fades 0 -> 1 over look.seasonFadeMs once it is
 * on the GPU, so nothing pops. If the fetch fails the land simply keeps its summer paint.
 * LOW (equirect) tier: skipped by design (the spec allows it; the cheap path stays cheap).
 */
import { Color, Vector2, Vector4, type IUniform, type Texture } from 'three'
import { globeState, subscribeFrame } from '../globeState'
import { debugEnabled, registerDebug } from '../debugHooks'
import { equirectFromBlob } from './dataTextures'
import { dummy2D } from './materials/dummies'
import { terrainUrl } from './manifest'
import { look } from './look'

/** bake_season.py output (bump ?v= with the printed hash when re-baked) */
export const SEASON_MAP = 'shared/season_1440x720.webp?v=fec6c285'

type U = Record<string, IUniform>
const sets = new Set<U>()
let tex: Texture | null = null
let started = false
let on = 0
let unsubFrame: (() => void) | null = null

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function setOn(v: number) {
  on = v
  for (const u of sets) u.uSeasonOn.value = v
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  void (async () => {
    try {
      const r = await fetch(terrainUrl(SEASON_MAP))
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const t = await equirectFromBlob(await r.blob(), { srgb: false, name: 'season' })
      tex = t
      for (const u of sets) u.uSeasonMap.value = t
      if (reducedMotion()) return setOn(1)
      unsubFrame = subscribeFrame((dt) => {
        setOn(Math.min(1, on + (dt * 1000) / look.seasonFadeMs))
        if (on >= 1) {
          unsubFrame?.()
          unsubFrame = null
        }
      })
    } catch (e) {
      console.warn(`[terrain] season map: ${e instanceof Error ? e.message : String(e)} (keeping the summer paint)`)
    }
  })()
}

export function seasonUniforms(): U {
  const p = globeState.seasonPhase
  const u: U = {
    uSeasonMap: { value: tex ?? dummy2D() },
    uSeasonOn: { value: on },
    uSeasonPhase: { value: new Vector2(Math.cos(p), Math.sin(p)) },
    cAutRusset: { value: new Color(look.seasonAutumn[0]) },
    cAutOchre: { value: new Color(look.seasonAutumn[1]) },
    cAutAmber: { value: new Color(look.seasonAutumn[2]) },
    cSeasonBare: { value: new Color(look.seasonBare) },
    cSeasonSpring: { value: new Color(look.seasonSpring) },
    cSeasonDry: { value: new Color(look.seasonDry) },
    cSeasonWet: { value: new Color(look.seasonWet) },
    uSeasonAmt: { value: new Vector4(...look.seasonAmt) },
  }
  sets.add(u)
  start()
  return u
}

if (debugEnabled) {
  registerDebug('season', () => ({
    phase: globeState.seasonPhase,
    dayOfYear: Math.round((globeState.seasonPhase * 365.25) / (2 * Math.PI) + 15),
    season: globeState.season,
    on,
    loaded: !!tex,
  }))
}
