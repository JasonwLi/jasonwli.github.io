/**
 * Manifest stage plans (C2a). Pure functions over the frozen manifest schema
 * (manifest.ts, imported as types only) so they run under
 * `node --experimental-strip-types` as well as in the browser.
 *
 * Stage keys are dotted paths: "preview.albedo", "tiers.<tier>.<layer>" (resolved
 * through tiers.<tier>.layers), "shared.<asset>". Unknown keys resolve to null and
 * are skipped with a warning, so a later manifest that adds layers never breaks
 * an older loader.
 */
import type {
  EquirectLayer,
  FaceCubeLayer,
  HeightGridAsset,
  JsonAsset,
  Ktx2ArrayLayer,
  Ktx2CubeLayer,
  TerrainManifest,
  TreeDensityAsset,
} from './manifest.ts'
import type { TerrainStage, Tier } from '../globeState.ts'

/** terrainTextures fields a stage key may fill ('preview.albedo' / 'preview.data' fill terrainTextures.preview). */
export type TextureField =
  | 'preview.albedo'
  | 'preview.data'
  | 'albedoEq'
  | 'dataEq'
  | 'koppenColorEq'
  | 'albedo'
  | 'terrain'
  | 'hydro'
  | 'heightHi'
  | 'splatA'
  | 'splatB'
  | 'splatC'
  | 'detail'
  | 'koppenColor'
  | 'koppenIdx'

export type LayerRef =
  | { key: string; kind: 'equirect'; field: TextureField; layer: EquirectLayer }
  | { key: string; kind: 'ktx2cube'; field: TextureField; layer: Ktx2CubeLayer }
  | { key: string; kind: 'ktx2array'; field: TextureField; layer: Ktx2ArrayLayer }
  | { key: string; kind: 'faces'; field: TextureField; layer: FaceCubeLayer }
  | { key: string; kind: 'json'; name: 'labels' | 'rivers'; asset: JsonAsset }
  | { key: string; kind: 'heightGrid'; asset: HeightGridAsset }
  | { key: string; kind: 'treeDensity'; asset: TreeDensityAsset }

const CUBE_FIELDS = new Set<TextureField>([
  'albedo', 'terrain', 'hydro', 'heightHi', 'splatA', 'splatB', 'splatC', 'detail', 'koppenColor', 'koppenIdx',
])
const LOW_FIELDS: Record<string, TextureField> = { albedo: 'albedoEq', data: 'dataEq', koppenColor: 'koppenColorEq' }

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function classify(key: string, field: TextureField, layer: unknown): LayerRef | null {
  if (!isObj(layer)) return null
  if (Array.isArray(layer.faces)) return { key, kind: 'faces', field, layer: layer as unknown as FaceCubeLayer }
  if (layer.format === 'ktx2') {
    if (layer.type === 'cube') return { key, kind: 'ktx2cube', field, layer: layer as unknown as Ktx2CubeLayer }
    if (layer.type === '2darray') return { key, kind: 'ktx2array', field, layer: layer as unknown as Ktx2ArrayLayer }
    return null
  }
  if (typeof layer.url === 'string' && typeof layer.w === 'number') {
    return { key, kind: 'equirect', field, layer: layer as unknown as EquirectLayer }
  }
  return null
}

/** Resolve one dotted stage key against the manifest (null = unknown / unsupported). */
export function resolveKey(m: TerrainManifest, key: string): LayerRef | null {
  const p = key.split('.')
  if (p[0] === 'preview' && p.length === 2 && (p[1] === 'albedo' || p[1] === 'data')) {
    return classify(key, p[1] === 'albedo' ? 'preview.albedo' : 'preview.data', m.preview?.[p[1]])
  }
  if (p[0] === 'tiers' && p.length === 3) {
    const t = p[1] as Tier
    const tier = (m.tiers as unknown as Record<string, { kind: string; layers: Record<string, unknown> } | undefined>)[t]
    if (!tier || !isObj(tier.layers)) return null
    const layer = tier.layers[p[2]]
    if (tier.kind === 'equirect') {
      const f = LOW_FIELDS[p[2]]
      return f ? classify(key, f, layer) : null
    }
    const f = p[2] as TextureField
    return CUBE_FIELDS.has(f) ? classify(key, f, layer) : null
  }
  if (p[0] === 'shared' && p.length === 2) {
    const a = (m.shared as Record<string, unknown>)[p[1]]
    if (!isObj(a) || typeof a.url !== 'string') return null
    if (p[1] === 'labels' || p[1] === 'rivers') return { key, kind: 'json', name: p[1], asset: a as unknown as JsonAsset }
    if (p[1] === 'heightGrid') return { key, kind: 'heightGrid', asset: a as unknown as HeightGridAsset }
    if (p[1] === 'treeDensity') return { key, kind: 'treeDensity', asset: a as unknown as TreeDensityAsset }
  }
  return null
}

export interface StagePlan {
  tier: Tier
  A: LayerRef[]
  B: LayerRef[]
  C: LayerRef[]
  onDemand: LayerRef[]
  /** keys the manifest lists that this loader does not understand (skipped) */
  unknown: string[]
}

export function stagePlan(m: TerrainManifest, tier: Tier): StagePlan {
  const s = m.stages[tier]
  const unknown: string[] = []
  const map = (keys: string[] | undefined) =>
    (keys ?? []).flatMap((k) => {
      const r = resolveKey(m, k)
      if (!r) unknown.push(k)
      return r ? [r] : []
    })
  return { tier, A: map(s.A), B: map(s.B), C: map(s.C), onDemand: map(s.onDemand), unknown }
}

/** Every URL the ref fetches (manifest-relative). */
export function urlsOf(r: LayerRef): string[] {
  switch (r.kind) {
    case 'faces':
      return [...r.layer.faces]
    case 'equirect':
    case 'ktx2cube':
    case 'ktx2array':
      return [r.layer.url]
    default:
      return [r.asset.url]
  }
}

/** Identity of the payload (shared files dedupe: e.g. low albedo == preview albedo on placeholders). */
export function refId(r: LayerRef): string {
  const kind = r.kind === 'faces' ? `faces:${r.layer.upload ?? 'RGBA8'}:${r.layer.filter ?? 'linear'}` : r.kind
  return `${kind}|${urlsOf(r).join('|')}`
}

export function declaredBytes(r: LayerRef): number {
  const b = r.kind === 'json' || r.kind === 'heightGrid' || r.kind === 'treeDensity' ? r.asset.bytes : r.layer.bytes
  return Number.isFinite(b) && b > 0 ? b : 0
}

/** Unique refs (by payload identity), first occurrence wins. */
export function uniqueRefs(refs: LayerRef[]): LayerRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const id = refId(r)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Stage order for comparisons ('none' < A < B < C < D). */
export const STAGE_RANK: Record<TerrainStage, number> = { none: 0, A: 1, B: 2, C: 3, D: 4 }

// ---------------------------------------------------------------- VRAM estimate (manifest-only)

const MIP = 4 / 3

/** Bytes per texel when transcoded, by the best format the GPU offers (ETC1S/UASTC -> BC7/ASTC 1 B, ETC2/BC1 0.5 B, RGBA32 4 B). */
export type KtxTarget = 'bc7' | 'astc' | 'etc2' | 'bc1' | 'rgba32'
export const KTX_BPP: Record<KtxTarget, number> = { bc7: 1, astc: 1, etc2: 0.5, bc1: 0.5, rgba32: 4 }

/**
 * Estimated GPU bytes of one ref (CPU-side assets -> 0). ETC1S colour always lands in a 0.5 B/texel
 * format: ETC2 where offered, otherwise ktx2.ts transcodes it with a BC7-disabled loader -> BC1
 * (INT-B; three would pick 1 B/texel BC7). UASTC prefers BC7/ASTC (1 B).
 */
export function estimateRefVram(r: LayerRef, ktx: { etc1s: KtxTarget; uastc: KtxTarget } = { etc1s: 'bc1', uastc: 'bc7' }): number {
  switch (r.kind) {
    case 'equirect':
      return r.layer.w * r.layer.h * 4 * MIP
    case 'faces': {
      const n = r.layer.faceSize
      const bpp = r.layer.upload === 'R8' ? 1 : 4
      const mips = r.layer.filter === 'nearest' || r.layer.mips === false ? 1 : MIP
      return n * n * 6 * bpp * mips
    }
    case 'ktx2cube': {
      const n = r.layer.faceSize
      return n * n * 6 * KTX_BPP[ktx[r.layer.codec]] * (r.layer.mips ? MIP : 1)
    }
    case 'ktx2array': {
      const n = r.layer.size
      return n * n * r.layer.layers * KTX_BPP[ktx[r.layer.codec]] * (r.layer.mips ? MIP : 1)
    }
    default:
      return 0
  }
}

/** Steady-state estimate after stage C plus Köppen (previews released after the A->B swap on cube tiers). */
export function estimateTierVram(m: TerrainManifest, tier: Tier, ktx?: { etc1s: KtxTarget; uastc: KtxTarget }): { total: number; byKey: Record<string, number> } {
  const p = stagePlan(m, tier)
  const refs = uniqueRefs([...(tier === 'low' ? p.A : []), ...p.B, ...p.C, ...p.onDemand])
  const byKey: Record<string, number> = {}
  let total = 0
  for (const r of refs) {
    const b = estimateRefVram(r, ktx)
    if (b > 0) {
      byKey[r.key] = Math.round(b)
      total += b
    }
  }
  return { total: Math.round(total), byKey }
}
