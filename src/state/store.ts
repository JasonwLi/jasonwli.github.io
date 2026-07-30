import { create } from 'zustand'
import type { TravelLocation } from '../data/travel'

interface SiteState {
  /** location whose gallery is open, or null */
  active: TravelLocation | null
  /** location currently hovered on the globe (tooltip) */
  hovered: TravelLocation | null
  lightbox: { location: TravelLocation; index: number } | null
  setActive: (loc: TravelLocation | null) => void
  setHovered: (loc: TravelLocation | null) => void
  setLightbox: (v: { location: TravelLocation; index: number } | null) => void
}

export const useSite = create<SiteState>()((set) => ({
  active: null,
  hovered: null,
  lightbox: null,
  setActive: (active) => set({ active }),
  setHovered: (hovered) => set({ hovered }),
  setLightbox: (lightbox) => set({ lightbox }),
}))

// dev-only hook for driving the UI from automated checks
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__site = useSite
}
