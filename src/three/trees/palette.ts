/**
 * Tree colours (C6, critique amendment 9): D3's painted palette, NOT a private green
 * set. Values are copied from scripts/terrain/palette.json (OKLCH L, C, h°) — forest,
 * jungle and grass — and converted here to LINEAR sRGB for the shader (R1). If D3
 * retunes the palette, update these three entries to match.
 */

type Oklch = readonly [number, number, number]

export const D3_PALETTE = {
  forest: { light: [0.505, 0.11, 136], dark: [0.405, 0.098, 142] },
  jungle: { light: [0.47, 0.125, 146], dark: [0.375, 0.108, 152] },
  grass: { light: [0.6, 0.108, 125], dark: [0.545, 0.102, 129] },
} as const satisfies Record<string, { light: Oklch; dark: Oklch }>

/** OKLCH -> linear sRGB (clamped to gamut) */
export function oklchToLinear([L, C, h]: Oklch): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const c = (x: number) => Math.min(1, Math.max(0, x))
  return [
    c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function mixLin(a: Oklch, b: Oklch, t: number): [number, number, number] {
  const x = oklchToLinear(a)
  const y = oklchToLinear(b)
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]
}

/**
 * Per species canopy colour (linear) and the savanna/grass tint broadleaf trees take
 * where tree cover is sparse (IGBP 8-9 woody savanna): conifer = forest dark,
 * broadleaf = between forest light and dark, jungle canopy trees and palms = jungle.
 */
export const TREE_COLOURS = {
  conifer: oklchToLinear(D3_PALETTE.forest.dark),
  broadleaf: mixLin(D3_PALETTE.forest.light, D3_PALETTE.forest.dark, 0.45),
  // INT-B: jungle crowns a step DARKER than the jungle ground (the 0.1 mix of light/dark sat on the
  // ground's own value and vanished at 600-900 km); the key light then lifts their tops into relief
  jungle: oklchToLinear([0.34, 0.105, 151]),
  palm: oklchToLinear([0.37, 0.11, 148]),
  grass: oklchToLinear(D3_PALETTE.grass.dark),
  /** trunk: a dark warm umber, mostly hidden under the canopy */
  trunk: oklchToLinear([0.3, 0.025, 75]),
} as const

/** ±6% per-instance value jitter (critique amendment 9) */
export const TREE_VALUE_JITTER = 0.06
