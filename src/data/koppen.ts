/**
 * Köppen–Geiger classes for the Climate map mode (C3).
 *
 * koppen-palette.json is the ONE colour source: the climate shader's palette
 * uniform (src/three/terrain/shaders/climate.glsl.ts), the legend swatches and
 * D3's baked Köppen colour (scripts/terrain/bake_albedo.py) all read it, so the
 * legend matches the globe. Colours are a desaturated EU-style grade for the
 * dark steel page: OKLab L <= 0.66 (land cap), no saturated primaries, one hue
 * family per group (A green-teal, B ochre/terracotta, C olive, D mauve/violet,
 * E cool grey). Changing a hex after D3's bake needs D3's Köppen step re-run.
 */
import palette from './koppen-palette.json'

export type KoppenGroupKey = 'A' | 'B' | 'C' | 'D' | 'E'

export interface KoppenClass {
  /** 1..30 (0 = ocean / no data), matches the koppenIdx texture (value = idx * 8) */
  idx: number
  code: string
  name: string
  group: KoppenGroupKey
  /** sRGB hex */
  hex: string
}

export interface KoppenGroup {
  key: KoppenGroupKey
  /** 0..4, the value of store.isolateGroup / the shader's uIsolate */
  index: number
  name: string
  /** the legend swatch: the group's representative painted colour */
  hex: string
  classes: KoppenClass[]
}

export const KOPPEN_CLASSES: readonly KoppenClass[] = (palette as KoppenClass[]).slice().sort((a, b) => a.idx - b.idx)

const GROUP_DEFS: { key: KoppenGroupKey; name: string; rep: string }[] = [
  { key: 'A', name: 'Tropical', rep: 'Am' },
  { key: 'B', name: 'Arid', rep: 'BWh' },
  { key: 'C', name: 'Temperate', rep: 'Cfa' },
  { key: 'D', name: 'Continental', rep: 'Dfb' },
  { key: 'E', name: 'Polar', rep: 'ET' },
]

export const KOPPEN_GROUPS: readonly KoppenGroup[] = GROUP_DEFS.map((g, index) => {
  const classes = KOPPEN_CLASSES.filter((c) => c.group === g.key)
  return {
    key: g.key,
    index,
    name: g.name,
    hex: classes.find((c) => c.code === g.rep)?.hex ?? classes[0].hex,
    classes,
  }
})

/** group index (0..4) of a class index (1..30); -1 for ocean / unknown */
export function groupOfIdx(idx: number): number {
  if (idx < 1) return -1
  if (idx <= 3) return 0
  if (idx <= 7) return 1
  if (idx <= 16) return 2
  if (idx <= 28) return 3
  if (idx <= 30) return 4
  return -1
}
