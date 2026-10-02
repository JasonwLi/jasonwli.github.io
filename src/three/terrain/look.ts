/**
 * The painted-globe look (C2b). Every colour is sRGB hex (THREE.Color converts to
 * linear, R1); every number is a plain constant. INT may retune; D3 owns the albedo
 * palette (scripts/terrain/palette.json), this file owns what the shader adds on top.
 *
 * Binding amendments (critique): no atmosphere, no rim glow, no specular glint, no
 * idle animation (foam and waves are a static spatial pattern), ONE upper-left key
 * light (relief and the soft day ramp share it), land OKLab L <= 0.66 in both modes,
 * the sea continues the steel family at OKLab L ~0.34, hue 240-250.
 *
 * Sea ramp (OKLCH -> hex): shelf L0.40 C0.058 h240, deep L0.34 C0.056 h246,
 * abyss L0.28 C0.050 h250 (the D3 palette's sea, so LOW and cube agree).
 */
export const look = {
  // water (steel family)
  shelf: '#284c64', //      oklch(0.40 0.058 240)
  deep: '#1d3b53', //       oklch(0.34 0.056 246)
  abyss: '#142a41', //      oklch(0.28 0.050 250)
  coastLine: '#405f74', //  oklch(0.47 0.050 238) painted offshore line
  foam: '#728a98', //       oklch(0.62 0.035 232) static surf, close zoom only
  river: '#325772', //      oklch(0.44 0.062 242)
  lake: '#24465f', //       oklch(0.38 0.058 242)
  // snow / ice
  snow: '#cfd9e0', //       oklch(0.88 0.014 236) cool white
  snowShadow: '#8ea1b4', // oklch(0.70 0.035 250) relief-shaded blue shadow
  /** monument face tones (finish review): the relief paint's warm light and cool shade hues */
  monumentWarm: '#e2c99a', // oklch(0.84 0.060 82) sunlit ochre
  monumentCool: '#5f7290', // oklch(0.54 0.050 258) blued shade
  /**
   * life on the map (life/Life.tsx): volcano smoke, waterfall mist, cloud wisps. Whites are
   * capped at OKLab L 0.80 so nothing glares on the dark page; shades take the steel's blue.
   * The bow is three thin muted bands (C <= 0.06, far from gilt's 84 and vermilion's 33 hue at C 0.2): never gilt, never vermilion.
   */
  lifeSmokeLit: '#bdb6ae', //   oklch(0.78 0.014 75) pale warm ash
  lifeSmokeShade: '#6b7681', // oklch(0.56 0.022 252) blued shade
  lifeMist: '#b7bfc3', //       oklch(0.80 0.010 225) cool spray
  lifeCloudLit: '#c1bdb7', //   oklch(0.80 0.010 80) warm paper-white
  lifeCloudShade: '#7b8896', // oklch(0.62 0.026 250) blued shade
  lifeBow: ['#c6959f', '#9bb395', '#7fa3c2'] as [string, string, string], // rose / sage / pale blue: oklch(0.72 0.06 5), (0.74 0.05 140), (0.70 0.06 245)

  /** OKLab L caps after lighting (theme: land <= 0.66 in both modes; ice/snow 0.86) */
  landLumaCap: 0.66,
  snowLumaCap: 0.86,
  capKnee: 0.05,

  /** one key light, view space, upper-left (matches the engraved incise convention) */
  lightView: [-0.52, 0.58, 0.63] as [number, number, number],
  /** soft ambient day ramp from the same light: mix(min, max, n.L*0.5+0.5) */
  day: [0.78, 1.06] as [number, number],

  /** relief: z = exag * sqrt(h km) km (sqrt-compressed like D3's LOW hillshade) */
  reliefStrength: 1.0,
  reliefExag: { far: 36, near: 14 },
  /** shade = clamp(1 + gain*(n_relief.L - n_flat.L), min, max) */
  reliefGain: 1.6,
  reliefMin: 0.36,
  reliefMax: 1.3,
  /** sea-floor relief relative to land (BRIEF: 0.35x) */
  seaRelief: 0.35,
  /** relief ramps in over this long once the cube data lands (theme: P1 relief 0->1 / 400 ms) */
  reliefRampMs: 400,

  /** painted depth bands near the shelves */
  bandStepM: 250,
  bandAmount: 0.6,
  /** offshore painted coast line: width = max(km, px * kmPerPx) */
  coastLineKm: 5,
  coastLinePx: 1.6,
  coastLineAlpha: 0.55,
  /** static surf band (close zoom, lod.waveFade) */
  foamWidthKm: 9,
  foamAlpha: 0.3,
  waveAmount: 0.05,

  /** rivers (hydro.r = 1 - d/24 km): half width = max(riverPx screen px, riverMinKm) */
  riverPx: 0.75,
  riverMinKm: 1.2,
  /** river opacity ramps in between these view spans (km) ... */
  riverFadeKm: [9000, 3500] as [number, number],
  /**
   * ... and hands over to C6's vector ribbons between these (finish review: the raster has
   * no stream order, so the ribbons, which do, carry every river below 3500 km and cull
   * by rank; the raster keeps only its strongest crests, the major rivers, above that)
   */
  riverOutKm: [4500, 3500] as [number, number],
  /**
   * Stream-order culling at mid zoom (ribbons, by NE scalerank): ranks <= 4 from the
   * hand-over down; ranks 5-6 fade in over riverRank56Km, ranks 7+ over riverRank7Km.
   */
  riverRank56Km: [1500, 1150] as [number, number],
  riverRank7Km: [1150, 850] as [number, number],
  /** raster gate: only crests as strong as a river this wide (km) at the field's texel size */
  riverRasterMinWidthKm: 4.5,
  riverAlpha: 0.7,

  /** snow: threshold = 0.95 - winterReach * winter + bias */
  snowWinterReach: 0.5,
  snowBias: 0,

  /** detail splatting: km per tile (fine, coarse) and per-class strength (order = splat order) */
  detailScaleKm: [20, 90] as [number, number],
  // forest, jungle, grass, farm, steppe, desert, rock, marsh, ice
  detailStrength: [0.5, 0.5, 0.55, 0.5, 0.5, 0.35, 0.75, 0.55, 0.25],
  /** fade a detail octave when one tile spans fewer than these screen px (moire guard; the
   *  mipmapped array already band-limits, this only hides tiling). INT-B: 16/16 switched the fine
   *  20 km octave off below ~1000 km on phones / 1300 km on desktop, which read as MID blur */
  detailMinTilePx: [7, 10] as [number, number],

  /** cube mesh */
  maxLevel: { mid: 6, high: 7 },
  patchPx: { mid: 220, high: 160 },
  maxPatches: 700,
  /** skirt depth in node sizes (radius units per node span) */
  skirtDepth: 0.015,

  /** crossfades (ms) */
  paintMs: 600, // plate before painting -> paint (theme uPaint)
  stageMs: 350, // stage A preview -> stage B cube data
} as const

export type Look = typeof look
