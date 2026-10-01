/**
 * CPU copy of the height the terrain MESH is displaced with (INT; C6 request
 * "pins/monuments: sample mesh height instead of the CPU grid below 1500 km").
 *
 * The CPU height grid (heightGrid.ts) is a ~20 km equirect; the mesh displaces from
 * heightHi (HIGH, R8 DataTexture faces, CPU bytes retained) or the terrain cube's .r
 * (MID, ImageBitmap faces, read back once off the critical path). The two differ by up
 * to ±1 km in the Alps, ×12 exaggeration = pins and monuments floating or sinking by
 * ~12 km at deep zoom. Sampling the very texels the mesh uses, at the mip the mesh's
 * vertex spacing selects (terrain.vert: log2(faceSize / verts)), puts them on the
 * drawn relief. Same decode as terrain.vert: h_m = (byte/255)² · 9000.
 *
 * Entry-chunk safe: depends only on the texture registry and the cube-face table.
 */
import { Vector3 } from 'three'
import { onTerrainTextures, terrainTextures, type TerrainTextures } from '../terrain/textures'
import { dirToFaceUV, latLonToDir } from './cubemap'
import { sampleHeightM } from './heightGrid'
import { EARTH_KM } from './radii'
import { globeState } from '../globeState'

/** quadtree split size per tier (mirrors look.patchPx; the terrain chunk owns look.ts) */
const PATCH_PX = { low: 220, mid: 220, high: 160 } as const

interface Level {
  n: number
  faces: Uint8Array[]
}

let source: unknown = null
let levels: Level[] = []
let version = 0
const listeners = new Set<() => void>()

function notify() {
  version++
  for (const cb of listeners) cb()
}

/** Bumps whenever the mesh height source changes (or is read back). */
export function meshHeightVersion(): number {
  return version
}

export function meshHeightReady(): boolean {
  return levels.length > 0
}

export function onMeshHeight(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function readR(img: CanvasImageSource & { width: number; height: number }): Uint8Array | null {
  const w = img.width
  const h = img.height
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
  if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  else {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    ctx = c.getContext('2d', { willReadFrequently: true })
  }
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data
  const r = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < r.length; i++, j += 4) r[i] = d[j]
  return r
}

const idle = (fn: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 16)

function bind(t: TerrainTextures) {
  const tex = t.heightHi ?? t.terrain
  if (tex === source) return
  source = tex ?? null
  if (!tex) {
    if (levels.length) {
      levels = []
      notify()
    }
    return
  }
  const img = (tex as unknown as { image: unknown[] }).image
  if (!Array.isArray(img) || img.length !== 6) return
  const first = img[0] as { isDataTexture?: boolean; image?: { data: Uint8Array; width: number } }
  if (first.isDataTexture && first.image) {
    // R8 DataTexture faces (heightHi): the bytes are already on the CPU
    levels = [{ n: first.image.width, faces: img.map((f) => (f as { image: { data: Uint8Array } }).image.data) }]
    notify()
    return
  }
  // ImageBitmap faces (MID terrain cube): one face per idle slice
  const faces: Uint8Array[] = []
  const want = tex
  const step = (i: number) => {
    if (source !== want) return
    try {
      const r = readR(img[i] as CanvasImageSource & { width: number; height: number })
      if (!r) return
      faces.push(r)
    } catch {
      return // a closed bitmap or a tainted canvas: keep the CPU grid
    }
    if (i < 5) idle(() => step(i + 1))
    else {
      levels = [{ n: (img[0] as { width: number }).width, faces }]
      notify()
    }
  }
  idle(() => step(0))
}

if (typeof window !== 'undefined') {
  bind(terrainTextures)
  onTerrainTextures(bind)
}

/** 2×2 box-filtered mip of a level (built lazily, like the GPU chain). */
function level(m: number): Level {
  while (levels.length <= m) {
    const p = levels[levels.length - 1]
    const n = Math.max(1, p.n >> 1)
    const faces = p.faces.map((f) => {
      const o = new Uint8Array(n * n)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const a = 2 * y * p.n + 2 * x
          o[y * n + x] = (f[a] + f[a + 1] + f[a + p.n] + f[a + p.n + 1] + 2) >> 2
        }
      return o
    })
    levels.push({ n, faces })
  }
  return levels[m]
}

function bilinear(L: Level, face: number, s: number, t: number): number {
  const n = L.n
  const f = L.faces[face]
  const x = Math.min(n - 1, Math.max(0, ((s + 1) / 2) * n - 0.5))
  const y = Math.min(n - 1, Math.max(0, ((t + 1) / 2) * n - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(n - 1, x0 + 1)
  const y1 = Math.min(n - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = f[y0 * n + x0] * (1 - fx) + f[y0 * n + x1] * fx
  const bot = f[y1 * n + x0] * (1 - fx) + f[y1 * n + x1] * fx
  return (top * (1 - fy) + bot * fy) / 255
}

/** The mesh's height mip for the current view (vertex spacing ≈ 0.75·patchPx/32 px). */
export function meshMip(pxPerKm = globeState.lod.pxPerKm): number {
  if (!levels.length) return 0
  const n0 = levels[0].n
  const vertexKm = (0.75 * PATCH_PX[globeState.tier]) / 32 / Math.max(pxPerKm, 1e-6)
  const texelKm = ((Math.PI / 2) * EARTH_KM) / n0
  return Math.min(Math.log2(n0), Math.max(0, Math.log2(vertexKm / texelKm)))
}

const _d = new Vector3()

/** Mesh height in metres at lat/lon for a (fractional) mip, or null before the source lands. */
export function sampleMeshHeightM(lat: number, lon: number, mip = meshMip()): number | null {
  if (!levels.length) return null
  const { face, s, t } = dirToFaceUV(latLonToDir(lat, lon, _d))
  const m0 = Math.floor(mip)
  const fr = mip - m0
  let r = bilinear(level(m0), face, s, t)
  if (fr > 0.01) r = r * (1 - fr) + bilinear(level(m0 + 1), face, s, t) * fr
  return r * r * 9000
}

/** Height the drawn surface has at lat/lon: the mesh's texels when known, else the CPU grid. */
export function surfaceHeightM(lat: number, lon: number, mip?: number): number {
  return Math.max(0, sampleMeshHeightM(lat, lon, mip) ?? sampleHeightM(lat, lon))
}
