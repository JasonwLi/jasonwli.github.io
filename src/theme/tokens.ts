/**
 * The Astrolabe palette as sRGB hex, converted from the OKLCH values in the theme
 * spec (src/styles/tokens.css, T1). THREE.Color parses hex as sRGB and converts to
 * linear under ColorManagement, so shader uniforms built from these are correct (R1).
 *
 * Colours flow one way: this file -> I1 / C2b / C3 / C4 / C5 / C6. T1 owns it after
 * F0 and keeps it in parity with tokens.css (scripts/check-tokens.mjs, within 1 LSB).
 */
export const tokens = {
  // ground: heat-blued steel
  steel: '#011844', //        oklch(0.225 0.088 260) page ground, the mater face (heat-blued cobalt)
  steelDeep: '#021032', //    oklch(0.185 0.072 262) lightbox, pin cores, footer plate
  steelField: '#03224d', //   oklch(0.260 0.088 258) column plate, loading sphere
  steelRaised: '#0c2a52', //  oklch(0.288 0.082 257) hovered row / pin core
  incise: '#020516', //       oklch(0.125 0.040 264) groove wall, halos on the globe
  // fire-gilt brass
  gilt: '#e1b761', //         oklch(0.800 0.115 84)
  gilt2: '#b18c4a', //        oklch(0.660 0.095 80) minor ticks, fillets, pin rings
  giltWorn: '#69502e', //     oklch(0.450 0.060 75) long rules at rest, graticule
  // silver: every word a person reads
  silver: '#e1e5ea', //       oklch(0.920 0.008 250)
  silver2: '#b1b8c0', //      oklch(0.780 0.014 252)
  silver3: '#8b939d', //      oklch(0.660 0.018 255)
  // vermilion: the one active place
  vermilion: '#ee4b2b', //    oklch(0.640 0.205 33)
  vermilionHi: '#f96d47', //  oklch(0.700 0.180 36)
  // quiet lines
  line: '#2e4361', //         oklch(0.380 0.058 257)
  rule: '#465973', //         oklch(0.460 0.048 256)
  // browser surfaces
  focus: '#f7cb65', //        oklch(0.860 0.130 86)
  selectionBg: '#2b496f', //  oklch(0.400 0.075 256)
  selectionFg: '#eff2f6', //  oklch(0.960 0.006 250)
  scrollThumb: '#3f4e63', //  oklch(0.420 0.040 256)
  // globe-side labels
  labelLand: '#321f0f', //    oklch(0.260 0.040 60) umber ink for ranges/deserts
  labelSea: '#bbd2de', //     oklch(0.850 0.030 230) italic sea/ocean names
  labelClimate: '#020516', // oklch(0.125 0.040 264 / 0.75); alpha in labelClimateAlpha

  // F0 contract names (kept as aliases so wave-1 code written against them resolves)
  giltDim: '#b18c4a', //      = gilt2
  silverDim: '#8b939d', //    = silver3
  inkOnLand: '#321f0f', //    = labelLand
  seaLabel: '#bbd2de', //     = labelSea
} as const

export type TokenName = keyof typeof tokens

/** Alpha that goes with tokens.labelClimate. */
export const labelClimateAlpha = 0.75
/** Post-light OKLab L cap for painted land, both map modes, deserts included. */
export const landCapL = 0.66
/** Mean OKLab L of the sea (hue 240-250), continuing the steel family. */
export const seaL = 0.34
