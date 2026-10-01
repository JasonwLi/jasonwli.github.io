/**
 * Terrain asset manifest (public/textures/terrain/manifest.json). Types frozen by F0
 * and mirrored exactly by D5's writer/validator. All `url`s are relative to
 * public/textures/terrain/ and carry ?v=<sha256-first-8>.
 *
 * Channel rules: every data image is 8-bit RGB with no alpha and no colour chunks;
 * cube faces are N×N, row 0 = top per the GL table (src/three/geo/cubemap.ts);
 * equirects are 2:1, row 0 = north, column 0 = lon −180; KTX2 cube layer order is
 * px, nx, py, ny, pz, nz; the detail array layer order equals the splat order.
 */

export type ManifestColorSpace = 'srgb' | 'none'
/** px, nx, py, ny, pz, nz */
export type SixFaces = [string, string, string, string, string, string]

export interface CubeConvention {
  faceOrder: ['px', 'nx', 'py', 'ny', 'pz', 'nz']
  convention: 'gl'
  rows: string // "row0=top; upload flipY=false"
  table: string
  latLon: string // "lat=asin(y), lon=atan2(-z,x)"
}

export interface SqrtEncoding { in: string; curve: 'sqrt'; maxM: number }
export interface SdfEncoding { in: string; zero: number; halfRangeKm: number; positive: 'land' | 'water' }
export interface ManifestEncodings {
  height: SqrtEncoding // terrain.r
  bathy: SqrtEncoding // terrain.g
  coastSdf: SdfEncoding // terrain.b, positive land
  river: { in: string; curve: '1-d/band'; bandKm: number } // hydro.r
  lakeSdf: SdfEncoding // hydro.g, positive water
  snow: { in: string; curve: 'linear'; permanent: number } // hydro.b
  heightHi: SqrtEncoding // heightHi.r
  koppenIdx: { in: string; scale: number; classes: number; ocean: number; filter: 'nearest' }
  splat: {
    order: ['forest', 'jungle', 'grass', 'farm', 'steppe', 'desert', 'rock', 'marsh', 'ice']
    files: { splatA: [number, number, number]; splatB: [number, number, number]; splatC: [number, number, number] }
    sum: number
  }
  lowData: { r: 'coastSdf'; g: 'bathy'; b: 'snow' }
  treeDensity: { r: 'conifer'; g: 'broadleaf'; b: 'palm' }
  heightGrid: {
    type: 'uint16le'
    unit: 'm'
    land: string
    ocean: number
    rows: string
    cellCentres: string
  }
}

/** Equirect image (preview, LOW tier). */
export interface EquirectLayer {
  url: string
  kind?: 'equirect'
  w: number
  h: number
  format: 'webp' | 'png'
  lossless: boolean
  colorSpace: ManifestColorSpace
  packs?: 'lowData'
  bytes: number
}

/** KTX2 (Basis ETC1S / UASTC LDR 4x4 only, R10) cube map. */
export interface Ktx2CubeLayer {
  url: string
  format: 'ktx2'
  codec: 'etc1s' | 'uastc'
  type: 'cube'
  faceSize: number
  mips: boolean
  colorSpace: ManifestColorSpace
  bytes: number
}

/** KTX2 2D array (detail luminance layers). */
export interface Ktx2ArrayLayer {
  url: string
  format: 'ktx2'
  codec: 'etc1s' | 'uastc'
  type: '2darray'
  layers: number
  size: number
  mips: boolean
  colorSpace: ManifestColorSpace
  bytes: number
}

/** Six lossless face images, uploaded as new THREE.CubeTexture(bitmaps) with NoColorSpace (R7). */
export interface FaceCubeLayer {
  faces: SixFaces
  format: 'webp' | 'png'
  lossless: true
  faceSize: number
  colorSpace: ManifestColorSpace
  mips?: 'runtime' | false
  filter?: 'nearest' | 'linear'
  upload?: 'RGBA8' | 'R8'
  bytes: number
}

export interface LowTier {
  kind: 'equirect'
  minViewKm: number
  layers: { albedo: EquirectLayer; data: EquirectLayer; koppenColor: EquirectLayer }
}

export interface CubeTierLayers {
  albedo: Ktx2CubeLayer
  terrain: FaceCubeLayer
  hydro: FaceCubeLayer
  heightHi?: FaceCubeLayer // HIGH only
  splatA: FaceCubeLayer
  splatB: FaceCubeLayer
  splatC: FaceCubeLayer
  detail: Ktx2ArrayLayer
  /** legacy: no longer shipped (INT-B) — mid/high climate reads koppenIdx + the shader LUT */
  koppenColor?: Ktx2CubeLayer
  koppenIdx: FaceCubeLayer
}

export interface CubeTier {
  kind: 'cube'
  minViewKm: number
  layers: CubeTierLayers
}

export interface JsonAsset { url: string; bytes: number }
/** format 'webp' (INT-B): metres as uint16 packed hi byte in R, lo byte in G of a lossless RGB WebP; absent = raw uint16le */
export interface HeightGridAsset { url: string; w: number; h: number; format?: 'webp' | 'u16'; bytes: number }
export interface TreeDensityAsset {
  url: string
  w: number
  h: number
  lossless: true
  colorSpace: 'none'
  bytes: number
}

/** Dotted keys into the manifest, e.g. "preview.albedo", "tiers.mid.terrain", "shared.labels". */
export type StageKey = string
export interface TierStages { A: StageKey[]; B: StageKey[]; C: StageKey[]; onDemand: StageKey[] }

export interface ManifestCredit { id: string; text: string }

export interface TerrainManifest {
  schema: 'terrain-manifest/1'
  generated: string
  placeholder: boolean
  cube: CubeConvention
  encodings: ManifestEncodings
  preview: { albedo: EquirectLayer; data: EquirectLayer }
  tiers: { low: LowTier; mid: CubeTier; high: CubeTier }
  shared: {
    labels: JsonAsset
    rivers: JsonAsset
    heightGrid: HeightGridAsset
    treeDensity: TreeDensityAsset
  }
  stages: { low: TierStages; mid: TierStages; high: TierStages }
  credits: ManifestCredit[]
}

/** labels.json (D2 bake_labels / C4). */
export interface LabelsFile {
  v: 1
  labels: {
    id: string
    t: string // text
    k: 'ocean' | 'sea' | 'bay' | 'strait' | 'range' | 'desert' | 'plateau' | 'plain' | 'basin' | 'peninsula' | 'island' | 'lake' | 'river' | 'peak' | 'region'
    r: number // rank 0..9
    lat: number
    lon: number
    b: number // baseline bearing, deg clockwise from east in the local tangent plane
    a: number // arc radius km; 0 straight; sign = bend toward local north
    s: number // cap height km
    ls: number // letter spacing em
  }[]
}

/** rivers.json (D2 bake_rivers / C6). p = [lon, lat, lon, lat, ...] */
export interface RiversFile {
  v: 1
  rivers: { n: string; r: number; p: number[] }[]
}

export const TERRAIN_BASE = `${import.meta.env.BASE_URL}textures/terrain/`

/** Absolute URL for a manifest-relative url. */
export function terrainUrl(rel: string): string {
  return TERRAIN_BASE + rel
}

export async function loadManifest(): Promise<TerrainManifest> {
  const r = await fetch(`${TERRAIN_BASE}manifest.json`, { cache: 'no-cache' })
  if (!r.ok) throw new Error(`terrain manifest: HTTP ${r.status}`)
  const m = (await r.json()) as TerrainManifest
  if (m.schema !== 'terrain-manifest/1') throw new Error(`terrain manifest: unknown schema ${String(m.schema)}`)
  return m
}
