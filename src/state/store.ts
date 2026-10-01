import { create } from 'zustand'
import type { TravelLocation } from '../data/travel'
import { globeState, type MapMode, type Tier, type TerrainStage } from '../three/globeState'

interface SiteState {
  /** location whose gallery is open, or null */
  active: TravelLocation | null
  /** location currently hovered on the globe (tooltip) */
  hovered: TravelLocation | null
  lightbox: { location: TravelLocation; index: number } | null
  setActive: (loc: TravelLocation | null) => void
  setHovered: (loc: TravelLocation | null) => void
  setLightbox: (v: { location: TravelLocation; index: number } | null) => void

  mapMode: MapMode
  /** also writes globeState.mapMode + targetModeMix */
  setMapMode: (m: MapMode) => void
  tier: Tier | null
  /** also writes globeState.tier */
  setTier: (t: Tier) => void
  terrainStage: TerrainStage
  /** also writes globeState.stage */
  setTerrainStage: (s: TerrainStage) => void
  /** Köppen group isolated in the climate legend: 0..4 = A..E, -1 none */
  isolateGroup: number
  /** also writes globeState.isolateGroup */
  setIsolateGroup: (g: number) => void
}

export const useSite = create<SiteState>()((set) => ({
  active: null,
  hovered: null,
  lightbox: null,
  setActive: (active) => set({ active }),
  setHovered: (hovered) => set({ hovered }),
  setLightbox: (lightbox) => set({ lightbox }),

  mapMode: 'terrain',
  setMapMode: (mapMode) => {
    globeState.mapMode = mapMode
    globeState.targetModeMix = mapMode === 'climate' ? 1 : 0
    set({ mapMode })
  },
  tier: null,
  setTier: (tier) => {
    globeState.tier = tier
    set({ tier })
  },
  terrainStage: 'none',
  setTerrainStage: (terrainStage) => {
    globeState.stage = terrainStage
    set({ terrainStage })
  },
  isolateGroup: -1,
  setIsolateGroup: (isolateGroup) => {
    globeState.isolateGroup = isolateGroup
    set({ isolateGroup })
  },
}))

// dev-only hook for driving the UI from automated checks
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__site = useSite
}
